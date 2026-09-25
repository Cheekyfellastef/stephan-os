import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  applyMissionOrchestratorEvent,
  buildMissionOperationsSnapshot,
  createMissionOrchestratorState,
} from '../../shared/agents/missionOrchestrator.mjs';
import { acquireSharedWorkspaceOperationLock } from '../../shared/agents/executionReceiptV1.mjs';

const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const LOCK_ATTEMPTS = 40;
const LOCK_DELAY_MS = 50;

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

async function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, path);
}

function boundedPositive(value, fallback, minimum = 1) {
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function legacyMissionLockLiveness(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unknown';
  if (typeof options.missionStateProcessIsAlive === 'function') {
    try {
      const observed = options.missionStateProcessIsAlive(pid);
      if (observed === true) return 'alive';
      if (observed === false) return 'dead';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    if (error?.code === 'EPERM') return 'alive';
    return 'unknown';
  }
}

async function readLegacyMissionLock(lockPath, options = {}) {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ exists: false });
    throw error;
  }
  if (!lockStat.isFile()) {
    return Object.freeze({ exists: true, file: false, mtimeMs: lockStat.mtimeMs });
  }

  let payload = '';
  let owner = null;
  try {
    payload = await readFile(lockPath, 'utf8');
    owner = JSON.parse(payload);
  } catch {
    owner = null;
  }
  const acquiredAt = owner?.acquiredAt || owner?.acquiredAtUtc;
  const validLegacyOwner = Boolean(
    owner
    && typeof owner === 'object'
    && !Array.isArray(owner)
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0
    && Number.isFinite(Date.parse(String(acquiredAt || ''))),
  );
  return Object.freeze({
    exists: true,
    file: true,
    payload,
    owner,
    validLegacyOwner,
    liveness: validLegacyOwner
      ? legacyMissionLockLiveness(owner.pid, options)
      : 'invalid',
    mtimeMs: lockStat.mtimeMs,
  });
}

async function retireLegacyMissionLock(lockPath, evidence) {
  if (!evidence?.file) return false;
  let current;
  let currentStat;
  try {
    [current, currentStat] = await Promise.all([
      readFile(lockPath, 'utf8'),
      stat(lockPath),
    ]);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
  if (
    !currentStat.isFile()
    || current !== evidence.payload
    || currentStat.mtimeMs !== evidence.mtimeMs
  ) return false;

  const tombstone = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    await rename(lockPath, tombstone);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
  await rm(tombstone, { force: true }).catch(() => {});
  return true;
}

async function waitForLegacyMissionLock(paths, options = {}) {
  const timeoutMs = boundedPositive(
    options.missionStateLockTimeoutMs,
    LOCK_ATTEMPTS * LOCK_DELAY_MS,
  );
  const retryMs = boundedPositive(options.missionStateLockRetryMs, LOCK_DELAY_MS);
  const staleMs = boundedPositive(options.missionStateLegacyStaleLockMs, 30_000);
  const startedAt = Date.now();

  while (true) {
    const evidence = await readLegacyMissionLock(paths.lockPath, options);
    if (!evidence.exists || !evidence.file) return;
    const staleInvalid = evidence.liveness === 'invalid'
      && Date.now() - evidence.mtimeMs > staleMs;
    if (evidence.liveness === 'dead' || staleInvalid) {
      if (await retireLegacyMissionLock(paths.lockPath, evidence)) continue;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Mission state lock is busy.');
    }
    await delay(Math.min(retryMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
  }
}

async function acquireLock(paths, options = {}) {
  await waitForLegacyMissionLock(paths, options);

  const acquire = options.acquireMissionStateLock
    || acquireSharedWorkspaceOperationLock;
  const parentRoot = resolve(paths.root, '..');
  const rootSegment = basename(paths.root);
  const lock = await acquire(
    parentRoot,
    [rootSegment, `${paths.safeId}.lock`],
    {
      repoRoot: options.repoRoot,
      operationLockTimeoutMs: boundedPositive(
        options.missionStateLockTimeoutMs,
        LOCK_ATTEMPTS * LOCK_DELAY_MS,
      ),
      operationLockRetryMs: boundedPositive(
        options.missionStateLockRetryMs,
        LOCK_DELAY_MS,
      ),
      operationStaleLockMs: boundedPositive(
        options.missionStateStaleLockMs,
        30_000,
      ),
      operationLockHeartbeatMs: boundedPositive(
        options.missionStateLockHeartbeatMs,
        5_000,
      ),
    },
  );
  if (lock?.ok !== true) {
    throw new Error(`Mission state lock is busy: ${lock?.reason || 'lock-acquisition-failed'}`);
  }
  return lock;
}

async function releaseLock(lock) {
  if (lock?.release) await lock.release();
}

function sanitizeEventForLog(event) {
  const sanitized = structuredClone(event);
  if (Object.hasOwn(sanitized, 'approvalToken')) sanitized.approvalToken = '[REDACTED]';
  return sanitized;
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
  const lockHandle = await acquireLock(paths, options);
  try {
    const current = JSON.parse(await readFile(paths.statePath, 'utf8'));
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
    await releaseLock(lockHandle);
  }
}

export async function appendMissionEvent(missionId, event, options = {}) {
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, missionId);
  await mkdir(paths.root, { recursive: true });
  const lockHandle = await acquireLock(paths, options);
  try {
    const current = JSON.parse(await readFile(paths.statePath, 'utf8'));
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
    const next = withStoreMetadata(applyMissionOrchestratorEvent(current, preparedEvent, options), {
      processedEventIds: [...processedEventIds, eventId].slice(-1000),
      lastEventId: eventId,
    });
    await atomicWriteJson(paths.statePath, next);
    await appendFile(paths.eventPath, `${JSON.stringify(sanitizeEventForLog(preparedEvent))}\n`, 'utf8');
    const snapshot = await publishSnapshot(next, options.snapshotRoot || resolveMissionOperationsSnapshotRoot(options.env || process.env));
    return { state: next, duplicate: false, eventId, snapshot };
  } finally {
    await releaseLock(lockHandle);
  }
}
