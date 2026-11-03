import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  applyMissionOrchestratorEvent,
  buildMissionOperationsSnapshot,
  createMissionOrchestratorState,
} from '../../shared/agents/missionOrchestrator.mjs';

const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const LOCK_ATTEMPTS = 40;
const LOCK_DELAY_MS = 50;
export const MISSION_STATE_LOCK_BUSY = 'MISSION_STATE_LOCK_BUSY';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function safeMissionId(value) {
  const missionId = text(value).toLowerCase();
  if (!MISSION_ID_PATTERN.test(missionId)) throw new Error('Mission id is missing or invalid.');
  return missionId;
}

function safeEventId(value) {
  const eventId = text(value).toLowerCase();
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Event id is missing or invalid.');
  return eventId;
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function resolveMissionOrchestratorRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_ORCHESTRATOR_DIR);
  if (configured) return resolve(configured);
  const userProfile = text(env.USERPROFILE);
  return userProfile
    ? resolve(userProfile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'orchestrator')
    : '';
}

export function resolveMissionOperationsSnapshotRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_OPERATIONS_DIR);
  if (configured) return resolve(configured);
  const userProfile = text(env.USERPROFILE);
  return userProfile
    ? resolve(userProfile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'proof', 'mission-operations')
    : '';
}

// Closed identity for a failed worker result. Stored atomically with the
// resulting failed state; old unbound failures do not gain replay authority.
export function failedMissionWorkerResultIdentityV1(event = {}) {
  const missionId = text(event.missionId).toLowerCase();
  const eventId = text(event.eventId).toLowerCase();
  const actionId = text(event.actionId).toLowerCase();
  const adapter = text(event.adapter).toLowerCase();
  const resultId = text(event.resultId);
  if (text(event.eventType).toUpperCase() !== 'AGENT_RESULT_RECEIVED' || event.success !== false
      || !MISSION_ID_PATTERN.test(missionId) || !EVENT_ID_PATTERN.test(eventId)
      || !/^[a-z0-9][a-z0-9._:-]{2,160}$/.test(actionId) || !adapter || !resultId)
    return '';
  return sha256(JSON.stringify({ schemaVersion: 'stephanos.failed-worker-result-identity.v1',
    missionId, eventId, actionId, adapter, resultId, success: false,
    changedFiles: Array.isArray(event.changedFiles) ? event.changedFiles : [],
    receipt: event.receipt ?? null, error: text(event.error),
    sourceArtifactEscrow: event.sourceArtifactEscrow ?? null,
    offlinePublicationOutbox: event.offlinePublicationOutbox ?? null,
  }));
}

function missionPaths(root, missionId) {
  const safeId = safeMissionId(missionId);
  const resolvedRoot = resolve(root);
  return {
    root: resolvedRoot,
    statePath: resolve(resolvedRoot, `${safeId}.state.json`),
    eventPath: resolve(resolvedRoot, `${safeId}.events.ndjson`),
    lockPath: resolve(resolvedRoot, `${safeId}.lock`),
    safeId,
  };
}

export async function writeMissionJsonAtomically(path, value, options = {}) {
  const renameFn = options.renameFn || rename;
  const openFn = options.openFn || open;
  const rmFn = options.rmFn || rm;
  const writeFileFn = options.writeFileFn || writeFile;
  const platform = options.platform || process.platform;
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const nowMs = typeof options.nowMs === 'function' ? options.nowMs : Date.now;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryPath = `${path}.tmp-${pid}-${nowMs()}`;

  await writeFileFn(temporaryPath, payload, { encoding: 'utf8', flag: 'wx', ...(options.durable ? { flush: true } : {}) });
  try {
    await renameFn(temporaryPath, path);
    return Object.freeze({ fallbackUsed: false, temporaryPath });
  } catch (error) {
    if (options.durable || platform !== 'win32' || error?.code !== 'EPERM') {
      await rmFn(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }

    let handle;
    try {
      try {
        handle = await openFn(path, 'r+');
      } catch (openError) {
        if (openError?.code !== 'ENOENT') throw openError;
        handle = await openFn(path, 'w+');
      }
      await handle.writeFile(payload, 'utf8');
      await handle.truncate(Buffer.byteLength(payload));
      await handle.sync();
    } catch (fallbackError) {
      await rmFn(temporaryPath, { force: true }).catch(() => {});
      throw fallbackError;
    } finally {
      await handle?.close().catch(() => {});
    }
    await rmFn(temporaryPath, { force: true });
    return Object.freeze({ fallbackUsed: true, temporaryPath });
  }
}

async function atomicWriteJson(path, value) {
  await writeMissionJsonAtomically(path, value, {
    durable: Boolean(value.storeMetadata?.supervisedRecoveryMaintenance),
  });
}

// Same mission lock/state, not a new lease or controller. The trusted service
// authenticates an exact maintenance decision while this lock is held.
export async function recordSupervisedOriginalSourceMaintenance(authorize, options = {}) {
  if (typeof authorize !== 'function') throw new Error('SUPERVISED_R7_AUTHENTICATOR_REQUIRED');
  const missionId = 'critical-2962-elastic-goal';
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('SUPERVISED_R7_STORE_UNAVAILABLE');
  const paths = missionPaths(root, missionId);
  const guarded = await runWithMissionStatePrecondition(missionId,
    { expectedRevision: 7, expectedCurrentPhase: 'REPAIR_REQUIRED' }, async current => {
      const maintenance = await authorize(structuredClone(current));
      if (maintenance?.schemaVersion !== 'stephanos.supervised-r7-maintenance.v1'
          || maintenance.target?.missionId !== missionId || maintenance.target.revision !== 7
          || !/^[a-f0-9]{64}$/.test(maintenance.approvalEvidenceDigest || '')) {
        throw new Error('SUPERVISED_R7_MAINTENANCE_RECORD_INVALID');
      }
      const prior = current.storeMetadata?.supervisedRecoveryMaintenance;
      if (prior) {
        if (JSON.stringify(prior) === JSON.stringify(maintenance)) return current;
        if (prior.commandId === maintenance.commandId || prior.requestId === maintenance.requestId)
          throw new Error('SUPERVISED_R7_MAINTENANCE_ALREADY_RESERVED');
      }
      const history = current.storeMetadata?.supervisedRecoveryMaintenanceHistory || [];
      if (history.length >= 20) throw new Error('SUPERVISED_R7_MAINTENANCE_HISTORY_LIMIT');
      const next = withStoreMetadata(current, { supervisedRecoveryMaintenance: maintenance,
        ...(prior ? { supervisedRecoveryMaintenanceHistory: [...history, prior] } : {}) });
      await atomicWriteJson(paths.statePath, next);
      return next;
    }, { ...options, root });
  if (guarded.preconditionFailed) throw new Error('SUPERVISED_R7_MISSION_CHANGED');
  return guarded.result;
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, 'utf8');
      return handle;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (attempt === LOCK_ATTEMPTS - 1) throw Object.assign(new Error('Mission state lock is busy.'), {
        code: MISSION_STATE_LOCK_BUSY,
        missionId: basename(lockPath, '.lock'),
      });
      await delay(LOCK_DELAY_MS);
    }
  }
  throw new Error('Mission state lock could not be acquired.');
}

async function releaseLock(handle, lockPath) {
  try {
    await handle?.close();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function sanitizeEventForLog(event) {
  const sanitized = structuredClone(event);
  if (Object.hasOwn(sanitized, 'approvalToken')) sanitized.approvalToken = '[REDACTED]';
  return sanitized;
}


const PENDING_QUARANTINE_AUDIT_SCHEMA = 'stephanos.pending-quarantine-audit.v1';
const MAX_QUARANTINE_AUDIT_BYTES = 128 * 1024;
const MAX_MISSION_AUDIT_BYTES = 2 * 1024 * 1024;

// The quarantine state replacement and its NDJSON event are separate files.
// Record the exact sanitised audit event inside the atomic state first. A
// process crash after state replacement can then replay only these bytes under
// the existing mission lock, never infer or synthesize a second cancellation.
async function reconcilePendingQuarantineAudit(state, paths, options = {}) {
  const pending = state?.storeMetadata?.pendingQuarantineAuditEvent;
  if (pending === undefined) return state;
  const event = pending?.event;
  const serial = JSON.stringify(event);
  const fail = (reason) => { throw new Error(reason); };
  if (pending?.schemaVersion !== PENDING_QUARANTINE_AUDIT_SCHEMA
      || !serial || Buffer.byteLength(serial) > MAX_QUARANTINE_AUDIT_BYTES
      || pending.eventId !== state.storeMetadata?.lastEventId
      || !state.storeMetadata?.processedEventIds?.includes(pending.eventId)
      || event?.eventId !== pending.eventId || event?.missionId !== state.missionId
      || event?.eventType !== 'MISSION_CANCELLED'
      || event?.originalSourceQuarantineRequested !== true
      || !state.storeMetadata?.originalSourceAttemptFence
      || sha256(JSON.stringify(event.originalSourceAttemptFence))
        !== sha256(JSON.stringify(state.storeMetadata.originalSourceAttemptFence))
      || pending.eventSha256 !== sha256(serial)) {
    fail('ORIGINAL_QUARANTINE_AUDIT_JOURNAL_INVALID');
  }
  const log = await readFile(paths.eventPath, 'utf8');
  if (Buffer.byteLength(log) > MAX_MISSION_AUDIT_BYTES) {
    fail('ORIGINAL_QUARANTINE_AUDIT_LOG_UNBOUNDED');
  }
  const validLength = log.lastIndexOf('\n') + 1;
  const suffix = log.slice(validLength);
  const lines = log.slice(0, validLength).split('\n').filter(Boolean);
  if (lines.length > 2048) fail('ORIGINAL_QUARANTINE_AUDIT_LOG_UNBOUNDED');
  let matching = 0;
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { fail('ORIGINAL_QUARANTINE_AUDIT_LOG_CORRUPT'); }
    if (parsed?.eventId === pending.eventId) {
      if (line !== serial) fail('ORIGINAL_QUARANTINE_AUDIT_EVENT_CONFLICT');
      matching += 1;
    }
  }
  if (matching > 1 || (matching === 1 && suffix)) {
    fail('ORIGINAL_QUARANTINE_AUDIT_EVENT_DUPLICATE');
  }
  if (matching === 0) {
    if (suffix) {
      // A torn write is recoverable only if every trailing byte is an exact
      // prefix of this one persisted, hash-bound canonical event.
      if (!serial.startsWith(suffix)) fail('ORIGINAL_QUARANTINE_AUDIT_LOG_CORRUPT');
      const handle = await open(paths.eventPath, 'r+');
      try {
        await handle.truncate(Buffer.byteLength(log.slice(0, validLength)));
        await handle.sync();
      } finally { await handle.close(); }
    }
    const appendAudit = options.appendMissionAuditFile || appendFile;
    await appendAudit(paths.eventPath, serial + '\n',
      state.storeMetadata?.supervisedRecoveryMaintenance ? { encoding: 'utf8', flush: true } : 'utf8');
  }
  const clean = structuredClone(state);
  delete clean.storeMetadata.pendingQuarantineAuditEvent;
  await atomicWriteJson(paths.statePath, clean);
  return clean;
}

function withStoreMetadata(state, additions = {}) {
  return {
    ...state,
    storeMetadata: {
      processedEventIds: [],
      ...state.storeMetadata,
      ...additions,
    },
  };
}

function missionStatePreconditionFailed(state, precondition = {}) {
  const expectedRevision = Number(precondition.expectedRevision);
  const expectedCurrentPhase = text(precondition.expectedCurrentPhase).toUpperCase();
  return (
    (Number.isSafeInteger(expectedRevision) && state.revision !== expectedRevision)
    || (expectedCurrentPhase && state.currentPhase !== expectedCurrentPhase)
  );
}

async function publishSnapshot(state, snapshotRoot) {
  if (!snapshotRoot) return { published: false, path: '' };
  const root = resolve(snapshotRoot);
  await mkdir(root, { recursive: true });
  const path = resolve(root, `${safeMissionId(state.missionId)}.orchestrator.snapshot.json`);
  await atomicWriteJson(path, buildMissionOperationsSnapshot(state));
  return { published: true, path };
}

export async function createMissionRecord(input, options = {}) {
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const state = withStoreMetadata(createMissionOrchestratorState(input, options), {
    createdBy: text(options.createdBy, 'stephanos-server'),
    lastEventId: '',
  });
  const paths = missionPaths(root, state.missionId);
  await mkdir(paths.root, { recursive: true });
  try {
    await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Mission already exists: ${state.missionId}`);
    throw error;
  }
  await appendFile(paths.eventPath, `${JSON.stringify({
    eventId: `created-${state.missionId}`,
    eventType: 'MISSION_CREATED',
    missionId: state.missionId,
    timestamp: state.createdAt,
    summary: 'Mission created through bounded intent intake.',
  })}\n`, 'utf8');
  const snapshot = await publishSnapshot(state, options.snapshotRoot || resolveMissionOperationsSnapshotRoot(options.env || process.env));
  return { state, statePath: paths.statePath, eventPath: paths.eventPath, snapshot };
}

export async function readMissionRecord(missionId, options = {}) {
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, missionId);
  const state = JSON.parse(await readFile(paths.statePath, 'utf8'));
  return { state, statePath: paths.statePath, eventPath: paths.eventPath };
}

export async function listMissionRecords(options = {}) {
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const states = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith('.state.json'))) {
    try {
      const state = JSON.parse(await readFile(join(root, entry.name), 'utf8'));
      states.push(state);
    } catch {
      states.push({
        missionId: basename(entry.name, '.state.json'),
        currentPhase: 'BLOCKED',
        finalVerdict: 'STATE_READ_FAILED',
        blockers: ['Mission state file could not be read.'],
        updatedAt: '',
      });
    }
  }
  return states.sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
}

export async function runWithMissionStatePrecondition(
  missionId,
  precondition,
  operation,
  options = {},
) {
  if (typeof operation !== 'function') {
    throw new TypeError('Mission state precondition operation must be a function.');
  }
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, missionId);
  await mkdir(paths.root, { recursive: true });
  const lockHandle = await acquireLock(paths.lockPath);
  try {
    const stored = JSON.parse(await readFile(paths.statePath, 'utf8'));
    const current = await reconcilePendingQuarantineAudit(stored, paths, options);
    if (missionStatePreconditionFailed(current, precondition)) {
      return {
        state: current,
        preconditionFailed: true,
        reason: 'MISSION_STATE_PRECONDITION_FAILED',
        result: null,
      };
    }
    return {
      state: current,
      preconditionFailed: false,
      reason: '',
      result: await operation(current),
    };
  } finally {
    await releaseLock(lockHandle, paths.lockPath);
  }
}

export async function appendMissionEvent(missionId, event, options = {}) {
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, missionId);
  await mkdir(paths.root, { recursive: true });
  const lockHandle = await acquireLock(paths.lockPath);
  try {
    const stored = JSON.parse(await readFile(paths.statePath, 'utf8'));
    const current = await reconcilePendingQuarantineAudit(stored, paths, options);
    if (current.storeMetadata?.supervisedRecoveryMaintenance
        && event.eventType !== 'MISSION_CANCELLED') {
      // Preserve the exact reserved revision against stale repair/retry/result
      // snapshots. Only the separately proven cancellation may advance it.
      throw new Error('ORIGINAL_SOURCE_ATTEMPT_FENCED');
    }
    const eventId = safeEventId(event.eventId);
    const processedEventIds = Array.isArray(current.storeMetadata?.processedEventIds)
      ? current.storeMetadata.processedEventIds
      : [];
    if (processedEventIds.includes(eventId)) {
      return { state: current, duplicate: true, eventId, snapshot: { published: false, path: '' } };
    }
    if (missionStatePreconditionFailed(current, event)) {
      return {
        state: current,
        duplicate: false,
        eventId,
        preconditionFailed: true,
        reason: 'MISSION_STATE_PRECONDITION_FAILED',
        snapshot: { published: false, path: '' },
      };
    }

    const preparedEvent = {
      ...event,
      eventId,
      missionId: safeMissionId(missionId),
    };
    if (preparedEvent.eventType === 'OPERATOR_APPROVAL_RECORDED') {
      preparedEvent.approvalTokenHash = sha256(preparedEvent.approvalToken);
    }
    const commit = async () => {
      let originalSourceAttemptFence = current.storeMetadata?.originalSourceAttemptFence;
      if (preparedEvent.originalSourceQuarantineRequested === true) {
        if (preparedEvent.eventType !== 'MISSION_CANCELLED'
            || typeof options.proveOriginalSourceQuarantine !== 'function') {
          throw new Error('ORIGINAL_SOURCE_QUARANTINE_PROOF_REQUIRED');
        }
        originalSourceAttemptFence = await options.proveOriginalSourceQuarantine(current);
        preparedEvent.originalSourceAttemptFence = originalSourceAttemptFence;
      }
      const quarantine = preparedEvent.originalSourceQuarantineRequested === true;
      const logEvent = sanitizeEventForLog(preparedEvent);
      const serial = JSON.stringify(logEvent);
      if (quarantine && Buffer.byteLength(serial) > MAX_QUARANTINE_AUDIT_BYTES) {
        throw new Error('ORIGINAL_QUARANTINE_AUDIT_EVENT_UNBOUNDED');
      }
      const transitioned = applyMissionOrchestratorEvent(current, preparedEvent, options);
      const failedResultIdentity = current.dispatch?.status === 'running'
        && preparedEvent.adapter === current.dispatch?.adapter
        && transitioned.dispatch?.status === 'failed'
        ? failedMissionWorkerResultIdentityV1(preparedEvent) : '';
      const next = withStoreMetadata(transitioned, {
        ...(text(preparedEvent.eventType).toUpperCase() === 'AGENT_RESULT_RECEIVED'
          ? { lastFailedWorkerResultIdentityV1: failedResultIdentity } : {}),
        ...(originalSourceAttemptFence ? { originalSourceAttemptFence } : {}),
        processedEventIds: [...processedEventIds, eventId].slice(-1000),
        lastEventId: eventId,
        ...(quarantine ? { pendingQuarantineAuditEvent: {
          schemaVersion: PENDING_QUARANTINE_AUDIT_SCHEMA,
          eventId, eventSha256: sha256(serial), event: logEvent,
        } } : {}),
      });
      // A result collector may have waited for the mission lock/audit I/O.
      if (options.assertResultCustody) options.assertResultCustody(current, preparedEvent);
      if (text(preparedEvent.eventType).toUpperCase() === 'AGENT_DISPATCHED' && options.assertClaimCustody)
        options.assertClaimCustody();
      await atomicWriteJson(paths.statePath, next);
      const completed = quarantine
        ? await reconcilePendingQuarantineAudit(next, paths, options)
        : next;
      if (!quarantine) await appendFile(paths.eventPath, serial + '\n', 'utf8');
      const snapshot = await publishSnapshot(completed, options.snapshotRoot || resolveMissionOperationsSnapshotRoot(options.env || process.env));
      return { state: completed, duplicate: false, eventId, snapshot };
    };
    if (preparedEvent.originalSourceQuarantineRequested === true) {
      if (typeof options.withOriginalSourceLeaseFenceGuard !== 'function') {
        throw new Error('ORIGINAL_SOURCE_LEASE_FENCE_GUARD_REQUIRED');
      }
      return await options.withOriginalSourceLeaseFenceGuard(commit);
    }
    return await commit();
  } finally {
    await releaseLock(lockHandle, paths.lockPath);
  }
}
