import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { spawnSync } from 'node:child_process';
import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';
import { constants as fsConstants } from 'node:fs';
import { SELF_HOSTING_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import { validateSeedGrowthWorkV1, SOURCE_SCOPE_RECONCILIATION_REQUIRED,
  projectSeedSourceAssociationV1, validateSeedSourceWorkDescriptorShapeV1,
  classifyElasticMissionIdentityV1 } from '../../shared/runtime/seedGrowthWorkV1.mjs';
import { readCurrentOwnerAdmittedGoalPlanV1, readUnadmittedSeedSourceCorrectionDecisionV1,
  readConsumedSeedSourceContractCorrectionEvidenceV1, readUnadmittedSeedGithubGoalV1 } from './githubPrEvidenceService.js';
import { sourceScope } from './elasticGoalMissionAdmissionService.js';
import { projectGoalAdmissionRequiredTestsV1 } from '../../shared/agents/goalAdmissionRequiredTestsV1.mjs';
import { readSharedWorkspaceRecordDirectory } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { getDefaultSharedWorkspaceRoot } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { inspectBattleBridgeGitTopology, resolveBattleBridgeGitExecution,
  validateBattleBridgeLocalGitConfiguration } from '../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { withOriginalSourceLeaseFenceGuard, readSourceMutationLease } from './programmeAuthorityService.js';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import { acquireSharedWorkspaceOperationLock } from '../../shared/agents/executionReceiptV1.mjs';
import { writeAtomicJson, createSharedWorkspaceEventRecord, resolveSharedWorkspacePath,
  validateSharedWorkspaceWriteAncestors, validateSharedWorkspaceRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { KNOWN_MALFORMED_PATCH_REPAIR_V1, knownMalformedPatchEvidenceMatchesV1 } from '../../shared/agents/knownMalformedPatchRetryV1.mjs';
import {
  appendFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  applyMissionOrchestratorEvent,
  buildMissionOperationsSnapshot,
  createMissionOrchestratorState,
  projectMissionSourceScopeShapeV1,
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
  if (classifyElasticMissionIdentityV1(value).kind === 'NONCANONICAL_ELASTIC') {
    throw new Error('NONCANONICAL_ELASTIC_MISSION_IDENTITY');
  }
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
function canonicalRepository(value) {
  return typeof value === 'string' && value === value.trim()
    && value.toLowerCase() === 'cheekyfellastef/stephan-os';
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
    durable: Boolean(value.storeMetadata?.supervisedRecoveryMaintenance
      || value.currentOrdinarySourcePlan || value.storeMetadata?.pendingSourcePlanAuditEvent
      || value.seedSourceWorkDescriptor || value.storeMetadata?.pendingSeedMissionGenesisAudit),
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

const CURRENT_ORDINARY_SOURCE_PLAN_SCHEMA = 'stephanos.current-ordinary-source-plan.v1';
const CURRENT_ORDINARY_SOURCE_PLAN_PURPOSE = 'REAFFIRM_EXISTING_ORDINARY_SOURCE_PLAN';
const PENDING_SOURCE_PLAN_AUDIT_SCHEMA = 'stephanos.pending-source-plan-audit.v1';
const PRIVATE_SOURCE_PLAN_EVENTS = new Set(['SOURCE_CONTRACT_CORRECTED', 'SOURCE_PLAN_SUPERSEDED',
  'ORDINARY_SOURCE_PLAN_REAFFIRMED']);

async function reconcilePendingSourcePlanAudit(state, paths) {
  const pending = state?.storeMetadata?.pendingSourcePlanAuditEvent;
  if (pending === undefined) return state;
  const event = pending?.event, serial = JSON.stringify(event);
  if (pending.schemaVersion !== PENDING_SOURCE_PLAN_AUDIT_SCHEMA
      || !serial || Buffer.byteLength(serial) > MAX_QUARANTINE_AUDIT_BYTES
      || event?.eventType !== 'ORDINARY_SOURCE_PLAN_REAFFIRMED'
      || event.missionId !== state.missionId || event.resultingRevision !== state.revision
      || pending.eventId !== state.storeMetadata?.lastEventId || event.eventId !== pending.eventId
      || !state.storeMetadata?.processedEventIds?.includes(pending.eventId)
      || pending.eventSha256 !== sha256(serial)
      || JSON.stringify(event.currentOrdinarySourcePlan) !== JSON.stringify(state.currentOrdinarySourcePlan)) {
    throw new Error('SOURCE_PLAN_AUDIT_JOURNAL_INVALID');
  }
  const log = await readFile(paths.eventPath, 'utf8');
  if (Buffer.byteLength(log) > MAX_MISSION_AUDIT_BYTES) throw new Error('SOURCE_PLAN_AUDIT_LOG_UNBOUNDED');
  const validLength = log.lastIndexOf('\n') + 1, suffix = log.slice(validLength);
  const lines = log.slice(0, validLength).split('\n').filter(Boolean);
  if (lines.length > 2048) throw new Error('SOURCE_PLAN_AUDIT_LOG_UNBOUNDED');
  let matches = 0;
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { throw new Error('SOURCE_PLAN_AUDIT_LOG_CORRUPT'); }
    if (parsed.eventId === pending.eventId) {
      if (line !== serial) throw new Error('SOURCE_PLAN_AUDIT_EVENT_CONFLICT');
      matches++;
    }
  }
  if (matches > 1 || (matches === 1 && suffix)) throw new Error('SOURCE_PLAN_AUDIT_EVENT_DUPLICATE');
  if (!matches) {
    if (suffix) {
      if (!serial.startsWith(suffix)) throw new Error('SOURCE_PLAN_AUDIT_LOG_CORRUPT');
      const handle = await open(paths.eventPath, 'r+');
      try { await handle.truncate(Buffer.byteLength(log.slice(0, validLength))); await handle.sync(); }
      finally { await handle.close(); }
    }
    await appendFile(paths.eventPath, serial + '\n', { encoding: 'utf8', flush: true });
  }
  const clean = structuredClone(state);
  delete clean.storeMetadata.pendingSourcePlanAuditEvent;
  await writeMissionJsonAtomically(paths.statePath, clean, { durable: true });
  return clean;
}

async function reconcilePendingMissionAudit(state, paths, options = {}) {
  return reconcilePendingSeedMissionGenesisAudit(
    await reconcilePendingSourcePlanAudit(await reconcilePendingQuarantineAudit(state, paths, options), paths), paths);
}

async function reconcilePendingSeedMissionGenesisAudit(state, paths) {
  const pending = state.storeMetadata?.pendingSeedMissionGenesisAudit;
  if (!pending) return state;
  const event = pending.event, serial = JSON.stringify(event);
  if (pending.schemaVersion !== 'stephanos.pending-seed-mission-genesis-audit.v1'
      || pending.eventSha256 !== sha256(serial) || event?.eventType !== 'MISSION_CREATED'
      || event.missionId !== state.missionId || event.timestamp !== state.createdAt
      || event.sourcePlanFingerprint !== state.seedSourceWorkDescriptor?.authorityPlanFingerprint
      || event.contractFingerprint !== ordinaryContractFingerprint(state)
      || JSON.stringify(event.seedGrowthWork) !== JSON.stringify(state.seedGrowthWork)
      || JSON.stringify(event.seedSourceWorkDescriptor) !== JSON.stringify(state.seedSourceWorkDescriptor)
      || !state.storeMetadata.processedEventIds?.includes(event.eventId)) throw new Error('SEED_MISSION_GENESIS_AUDIT_INVALID');
  let log;
  try { log = await readFile(paths.eventPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; log = ''; }
  if (Buffer.byteLength(log) > MAX_MISSION_AUDIT_BYTES) throw new Error('SEED_MISSION_GENESIS_AUDIT_UNBOUNDED');
  const validLength = log.lastIndexOf('\n') + 1, suffix = log.slice(validLength);
  const lines = log.slice(0, validLength).split('\n').filter(Boolean), matching = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { throw new Error('SEED_MISSION_GENESIS_AUDIT_CORRUPT'); }
    if (entry.eventId === event.eventId) matching.push(line);
  }
  if (matching.length > 1 || (matching.length && (matching[0] !== serial || suffix))) {
    throw new Error('SEED_MISSION_GENESIS_AUDIT_CONFLICT');
  }
  if (!matching.length) {
    if (suffix) {
      if (!serial.startsWith(suffix)) throw new Error('SEED_MISSION_GENESIS_AUDIT_CORRUPT');
      const handle = await open(paths.eventPath, 'r+');
      try { await handle.truncate(Buffer.byteLength(log.slice(0, validLength))); await handle.sync(); }
      finally { await handle.close(); }
    }
    await appendFile(paths.eventPath, serial + '\n', { encoding: 'utf8', flush: true });
  }
  const clean = structuredClone(state); delete clean.storeMetadata.pendingSeedMissionGenesisAudit;
  await writeMissionJsonAtomically(paths.statePath, clean, { durable: true });
  return clean;
}

async function proveSeedMissionGenesis(state, paths) {
  if (state.storeMetadata?.pendingSeedMissionGenesisAudit) throw new Error('SEED_MISSION_GENESIS_RECOVERY_REQUIRED');
  const info = await lstat(paths.eventPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_MISSION_AUDIT_BYTES) {
    throw new Error('SEED_MISSION_GENESIS_AUDIT_UNSAFE');
  }
  const lines = (await readFile(paths.eventPath, 'utf8')).split('\n').filter(Boolean);
  if (lines.length > 2048) throw new Error('SEED_MISSION_GENESIS_AUDIT_UNBOUNDED');
  const events = lines.map(line => JSON.parse(line)).filter(event => event.eventType === 'MISSION_CREATED');
  if (events.length !== 1 || events[0].missionId !== state.missionId || events[0].timestamp !== state.createdAt
      || events[0].sourcePlanFingerprint !== state.seedSourceWorkDescriptor?.authorityPlanFingerprint
      || events[0].contractFingerprint !== ordinaryContractFingerprint(state)
      || JSON.stringify(events[0].seedGrowthWork) !== JSON.stringify(state.seedGrowthWork)
      || JSON.stringify(events[0].seedSourceWorkDescriptor) !== JSON.stringify(state.seedSourceWorkDescriptor)) {
    throw new Error('SEED_MISSION_GENESIS_PROOF_REQUIRED');
  }
}

function ordinaryContractFingerprint(state) {
  return sha256(JSON.stringify({ repository: state.repository, missionId: state.missionId,
    repositoryRoot: state.repositoryRoot, worktreePath: state.git?.worktreePath,
    baseBranch: state.git?.baseBranch, branch: state.git?.branch,
    providerRouteIntent: state.providerRouteIntent || 'AUTO',
    allowedFiles: state.allowedFiles, requiredTests: state.requiredTests,
    requiredEvidence: state.requiredEvidence, operatorIntent: state.operatorIntent,
    intendedOutcome: state.intendedOutcome, browserProofRequired: state.browserProofRequired }));
}

async function proveOrdinaryPlanRecorded(state, paths) {
  const plan = state.currentOrdinarySourcePlan;
  if (!Number.isSafeInteger(plan?.recordedAtRevision) || plan.recordedAtRevision < 1
      || plan.recordedAtRevision > state.revision || !EVENT_ID_PATTERN.test(plan.reaffirmationEventId || '')
      || !state.storeMetadata?.processedEventIds?.includes(plan.reaffirmationEventId)) {
    throw new Error('CURRENT_SOURCE_PLAN_COMMIT_PROOF_REQUIRED');
  }
  const info = await lstat(paths.eventPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_MISSION_AUDIT_BYTES) {
    throw new Error('CURRENT_SOURCE_PLAN_AUDIT_UNSAFE');
  }
  const bytes = await readFile(paths.eventPath), after = await lstat(paths.eventPath);
  if (bytes.length !== info.size || after.ino !== info.ino || after.dev !== info.dev
      || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('CURRENT_SOURCE_PLAN_AUDIT_CHANGED');
  const lines = bytes.toString('utf8').split('\n').filter(Boolean);
  if (lines.length > 2048) throw new Error('CURRENT_SOURCE_PLAN_AUDIT_UNBOUNDED');
  const events = lines.map(line => JSON.parse(line));
  const matching = events.filter(event => event.eventId === plan.reaffirmationEventId);
  if (matching.length !== 1 || matching[0].eventType !== 'ORDINARY_SOURCE_PLAN_REAFFIRMED'
      || matching[0].missionId !== state.missionId || matching[0].resultingRevision !== plan.recordedAtRevision
      || matching[0].expectedRevision !== plan.recordedAtRevision - 1
      || JSON.stringify(matching[0].currentOrdinarySourcePlan) !== JSON.stringify(plan)) {
    throw new Error('CURRENT_SOURCE_PLAN_COMMIT_PROOF_REQUIRED');
  }
}

function storedSeedAssociation(state, goal, issueBody = '', ownerSeedAssociation) {
  const retainedHistory = JSON.stringify({ repair: state.repair?.history,
    continuity: state.continuity?.history, sourcePlan: state.seedSourceWorkDescriptor });
  if (Object.hasOwn(state, 'seedGrowthWork') || (goal && Object.hasOwn(goal, 'seedGrowthWork'))
      || ownerSeedAssociation?.associated === true) return true;
  return projectSeedSourceAssociationV1({ ...state, issueBody,
    retainedHistory: retainedHistory + '\n' + JSON.stringify(goal || {}) }).associated;
}

function readOrdinaryRuntimePolicyHead(repoRoot, env, identity = false) {
  if (typeof repoRoot !== 'string' || !repoRoot) throw new Error('CURRENT_SOURCE_PLAN_POLICY_ROOT_REQUIRED');
  const topology = inspectBattleBridgeGitTopology(repoRoot);
  if (topology.ok !== true) throw new Error(topology.blocker || 'CURRENT_SOURCE_PLAN_POLICY_TOPOLOGY_UNPROVEN');
  const boundary = resolveBattleBridgeGitExecution({ environment: env });
  const run = args => {
    const result = spawnSync(boundary.executable, [...boundary.fixedConfigArgs, '--no-optional-locks', '-C', repoRoot, ...args], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024,
      env: boundary.environment, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
      throw new Error('CURRENT_SOURCE_PLAN_POLICY_GIT_READ_FAILED');
    }
    return result.stdout;
  };
  if (!validateBattleBridgeLocalGitConfiguration(run(['config', '--no-includes', '--local', '--null', '--list'])).ok) {
    throw new Error('CURRENT_SOURCE_PLAN_POLICY_GIT_CONFIG_UNPROVEN');
  }
  const head = run(['rev-parse', '--verify', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('CURRENT_SOURCE_PLAN_POLICY_HEAD_UNPROVEN');
  if (!identity) return head;
  const tree = run(['rev-parse', '--verify', 'HEAD^{tree}']).trim();
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('CURRENT_SOURCE_PLAN_POLICY_TREE_UNPROVEN');
  if (Number.isSafeInteger(identity) && identity > 0) {
    // Preserve both status columns and expose both sides of a rename. Runtime
    // output is classified by the canonical policy, never by a local allowlist.
    const status = run(['-c', 'status.renames=false', 'status', '--porcelain=v1', '--untracked-files=all']);
    const lines = status === '' ? [] : status.replace(/\r?\n$/, '').split(/\r?\n/);
    if ((status && !status.endsWith('\n')) || lines.some(line =>
      !/^(?:[ MADTU]{2}|\?\?) [^\x00-\x1f\x7f]+$/.test(line) || line.startsWith('  ')
      || line.slice(3) !== line.slice(3).trim() || line.slice(3).includes('\\')
      || line.slice(3).startsWith('/') || /^[A-Za-z]:/.test(line.slice(3))
      || line.slice(3).split('/').some(part => part === '.' || part === '..'))
        || classifyDirt(lines).blocksSync) {
      throw new Error('SEED_GOAL_CANONICAL_SOURCE_NOT_CLEAN');
    }
    const branch = `refs/heads/openclaw/elastic-goal-${identity}`;
    const branchRead = spawnSync(boundary.executable, [...boundary.fixedConfigArgs, '--no-optional-locks', '-C', repoRoot,
      'show-ref', '--verify', '--quiet', branch], { shell: false, windowsHide: true, encoding: 'utf8',
      timeout: 5000, maxBuffer: 16384, env: boundary.environment, stdio: ['ignore', 'pipe', 'pipe'] });
    if (branchRead.error || branchRead.status !== 1) {
      throw new Error(branchRead.status === 0 ? 'SEED_GOAL_PRIOR_LOCAL_BRANCH_PRESENT' : 'SEED_GOAL_LOCAL_BRANCH_ABSENCE_UNPROVEN');
    }
  }
  return { head, tree };
}

function seedGoalContract(goal) {
  const tests = projectGoalAdmissionRequiredTestsV1(goal.requiredTests);
  if (!tests.valid) throw new Error('SEED_GOAL_PRIOR_TEST_CONTRACT_INVALID');
  if ((goal.sourceContractRevision !== undefined && (!Number.isSafeInteger(goal.sourceContractRevision) || goal.sourceContractRevision < 0))
      || (goal.resourceIds !== undefined && (!Array.isArray(goal.resourceIds) || goal.resourceIds.length > 64
        || goal.resourceIds.some(value => typeof value !== 'string')))
      || (goal.requiredEvidence !== undefined && (!Array.isArray(goal.requiredEvidence) || goal.requiredEvidence.length > 16
        || goal.requiredEvidence.some(value => typeof value !== 'string' || !value)))) throw new Error('SEED_GOAL_PRIOR_CONTRACT_INVALID');
  return { repository: goal.repository, goalId: goal.goalId, issueNumber: goal.issueNumber,
    participantId: goal.participantId, seedGrowthWork: goal.seedGrowthWork,
    resourceIds: goal.resourceIds || [], requiredTests: tests.supplied ? tests.commands : ['npm run stephanos:verify'],
    requiredEvidence: goal.requiredEvidence || [], sourceContractRevision: goal.sourceContractRevision || 0 };
}

// First intake requires absence of responsibility, including terminal and
// orphaned history. The active-work predicate intentionally cannot prove this.
const ORIGINAL_HISTORY_SCHEMAS = new Set([
  'stephanos.mission-orchestrator.v1', 'stephanos.mission-orchestrator-event.v1',
  'stephanos.mission-worker-queue-item.v1', 'stephanos.mission-worker-consumption-result.v1',
  'stephanos.mission-worker-pending-capacity-admission.v1',
  'stephanos.source-artifact-complete-file-bundle.v1', 'stephanos.source-artifact-escrow.v1',
  'stephanos.offline-publication-outbox.v1', 'stephanos.execution-receipt.v1',
  'shared-agent-workspace-record.v1', 'shared-agent-workspace.v1',
]);

function originalHistoryHasOwnership(record, issueNumber, budget, depth = 0, repository) {
  if (++budget.nodes > 200000 || depth > 32) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNBOUNDED');
  if (!record || typeof record !== 'object') return false;
  const missionId = `critical-${issueNumber}-elastic-goal`, branch = `openclaw/elastic-goal-${issueNumber}`;
  const repo = typeof record.repository === 'string' ? record.repository : repository;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['missionId', 'executorMissionId', 'laneId', 'actionId', 'executionId', 'leaseKey', 'leaseId', 'correlationId'].includes(key)
          && (normalized === missionId || normalized.startsWith(missionId + '-'))) return true;
      if (['branch', 'canonicalBranch'].includes(key)
          && [branch, 'refs/heads/' + branch].includes(normalized)) return true;
      if (key === 'goalId' && normalized === `goal-${issueNumber}`) return true;
    }
    if (['issueNumber', 'canonicalIssue', 'relatedIssue'].includes(key)
        && (value === issueNumber || value === String(issueNumber) || value === '#' + issueNumber)
        && (!repo || canonicalRepository(repo))) return true;
    if (value && typeof value === 'object'
        && originalHistoryHasOwnership(value, issueNumber, budget, depth + 1, repo)) return true;
  }
  return false;
}

function assertOriginalHistoryRecord(record, issueNumber, budget) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('SEED_GOAL_PRIOR_HISTORY_MALFORMED');
  if (originalHistoryHasOwnership(record, issueNumber, budget)) throw new Error('SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT');
  if (!ORIGINAL_HISTORY_SCHEMAS.has(record.schemaVersion)
      && !(typeof record.eventType === 'string' && typeof record.missionId === 'string')) {
    throw new Error('SEED_GOAL_PRIOR_HISTORY_SCHEMA_UNKNOWN');
  }
  // Decoration is not authority. Require only the retained ownership identity,
  // not optional summaries, labels, presentation text or current receipt age.
  if (record.schemaVersion?.startsWith('stephanos.mission-')
      && (typeof record.missionId !== 'string' || !MISSION_ID_PATTERN.test(record.missionId)
        || (record.schemaVersion !== 'stephanos.mission-orchestrator.v1'
          && record.schemaVersion !== 'stephanos.mission-orchestrator-event.v1'
          && (typeof record.actionId !== 'string' || !record.actionId)))) {
    throw new Error('SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
  }
  if (['stephanos.source-artifact-complete-file-bundle.v1', 'stephanos.source-artifact-escrow.v1',
    'stephanos.offline-publication-outbox.v1'].includes(record.schemaVersion)
      && (typeof record.missionId !== 'string' || !MISSION_ID_PATTERN.test(record.missionId)
        || typeof record.actionId !== 'string' || !record.actionId || !canonicalRepository(record.repository))) {
    throw new Error('SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
  }
  if (['shared-agent-workspace-record.v1', 'shared-agent-workspace.v1'].includes(record.schemaVersion)
      && (typeof record.kind !== 'string' || !record.kind.startsWith('stephanos.shared_workspace.')
        || typeof record.participantId !== 'string' || !record.participantId
        || (record.schemaVersion === 'shared-agent-workspace-record.v1' && !validateSharedWorkspaceRecord(record).valid))) {
    throw new Error('SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
  }
  if (record.schemaVersion === 'stephanos.execution-receipt.v1'
      && (typeof record.executionId !== 'string' || !record.executionId
        || typeof record.leaseKey !== 'string' || !record.leaseKey || !canonicalRepository(record.repository))) {
    throw new Error('SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
  }
}

async function inspectOriginalHistoryTree(directory, issueNumber, budget,
  { optional = false, skip = new Set(), ownedLock, sourceLeaseStatusesOnly = false } = {}, depth = 0) {
  if (depth > 8) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNBOUNDED');
  let info;
  try { info = await lstat(directory); }
  catch (error) { if (optional && error.code === 'ENOENT') return; throw new Error('SEED_GOAL_PRIOR_HISTORY_UNREADABLE'); }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNSAFE');
  const entries = await readdir(directory, { withFileTypes: true });
  budget.entries += entries.length;
  if (entries.length > 4096 || budget.entries > 8192) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNBOUNDED');
  const names = entries.map(entry => entry.name).sort();
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    // Status decoration is outside this proof. These are the existing fixed
    // source-authority status namespaces, including retained release markers.
    if (sourceLeaseStatusesOnly && entry.name !== 'source-mutation-lease-current.json'
        && !entry.name.startsWith('source-lease-release-')) continue;
    const filePath = join(directory, entry.name), file = await lstat(filePath);
    if (file.isSymbolicLink() || entry.isSymbolicLink()) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNSAFE');
    const missionId = `critical-${issueNumber}-elastic-goal`;
    if (entry.name === missionId + '.lock' && ownedLock && file.isFile() && file.nlink === 1) {
      const locked = await ownedLock.stat();
      if (locked.ino !== file.ino || locked.dev !== file.dev) throw new Error('SEED_GOAL_MISSION_LOCK_CHANGED');
      continue;
    }
    if (entry.name.toLowerCase().includes(missionId)) throw new Error('SEED_GOAL_PRIOR_MISSION_HISTORY_PRESENT');
    if (file.isDirectory()) {
      if (sourceLeaseStatusesOnly) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNSAFE');
      await inspectOriginalHistoryTree(filePath, issueNumber, budget, {}, depth + 1);
      continue;
    }
    if (!file.isFile() || file.nlink !== 1) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNSAFE');
    if (file.size > 2 * 1024 * 1024 || (budget.bytes += file.size) > 16 * 1024 * 1024) {
      throw new Error('SEED_GOAL_PRIOR_HISTORY_UNBOUNDED');
    }
    const handle = await open(filePath, 'r');
    let bytes;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== file.dev || opened.ino !== file.ino
          || opened.size !== file.size || opened.mtimeMs !== file.mtimeMs) throw new Error('SEED_GOAL_PRIOR_HISTORY_CHANGED');
      bytes = Buffer.alloc(file.size + 1);
      const read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat(), pathAfter = await lstat(filePath);
      if (read.bytesRead !== file.size || after.size !== file.size || after.mtimeMs !== file.mtimeMs
          || after.nlink !== 1 || pathAfter.isSymbolicLink() || pathAfter.nlink !== 1
          || pathAfter.dev !== file.dev || pathAfter.ino !== file.ino || pathAfter.size !== file.size
          || pathAfter.mtimeMs !== file.mtimeMs) throw new Error('SEED_GOAL_PRIOR_HISTORY_CHANGED');
      bytes = bytes.subarray(0, read.bytesRead);
    } finally { await handle.close(); }
    let raw, records;
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (raw.includes('\0')) throw new Error();
      const lineJournal = /\.(?:ndjson|jsonl)$/.test(entry.name);
      if (lineJournal && raw && !raw.endsWith('\n')) throw new Error();
      records = lineJournal ? raw.split('\n').filter(Boolean).map(line => JSON.parse(line)) : [JSON.parse(raw)];
    } catch { throw new Error('SEED_GOAL_PRIOR_HISTORY_MALFORMED'); }
    if ((budget.records += records.length) > 8192) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNBOUNDED');
    if (entry.name.endsWith('.lock')) {
      if (records.length !== 1 || !Number.isSafeInteger(records[0].pid) || records[0].pid <= 0
          || !Number.isFinite(Date.parse(records[0].acquiredAt))
          || Object.keys(records[0]).some(key => !['pid', 'acquiredAt'].includes(key))) {
        throw new Error('SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
      }
    } else for (const record of records) {
      if (sourceLeaseStatusesOnly && (!['stephanos.source-mutation-lease.v1', 'stephanos.source-mutation-lease-release.v1'].includes(record.schema)
          || typeof record.laneId !== 'string' || !MISSION_ID_PATTERN.test(record.laneId)
          || typeof record.leaseId !== 'string' || !record.leaseId || !canonicalRepository(record.repository))) {
        throw new Error('SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
      }
      assertOriginalHistoryRecord(record, issueNumber, budget);
    }
  }
  const after = await lstat(directory), finalNames = (await readdir(directory)).sort();
  if (!after.isDirectory() || after.isSymbolicLink() || after.ino !== info.ino || after.dev !== info.dev
      || JSON.stringify(finalNames) !== JSON.stringify(names)) throw new Error('SEED_GOAL_PRIOR_HISTORY_CHANGED');
}

async function proveOriginalMissionAbsent(issueNumber, options, ownedLock) {
  const env = options.env || process.env, missionId = `critical-${issueNumber}-elastic-goal`;
  const root = options.orchestratorRoot || options.root || resolveMissionOrchestratorRoot(env);
  if (!root) throw new Error('SEED_GOAL_MISSION_STORE_UNAVAILABLE');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('SEED_GOAL_MISSION_STORE_UNSAFE');
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > 4096) throw new Error('SEED_GOAL_MISSION_STORE_UNBOUNDED');
  for (const entry of entries) {
    if (!entry.name.toLowerCase().startsWith(missionId + '.')) continue;
    if (entry.name !== missionId + '.lock' || !ownedLock) throw new Error('SEED_GOAL_PRIOR_MISSION_HISTORY_PRESENT');
    const locked = await ownedLock.stat(), pathInfo = await lstat(join(root, entry.name));
    if (!entry.isFile() || pathInfo.isSymbolicLink() || locked.ino !== pathInfo.ino || locked.dev !== pathInfo.dev) {
      throw new Error('SEED_GOAL_MISSION_LOCK_CHANGED');
    }
  }
  const queueEnv = { ...env, STEPHANOS_MISSION_ORCHESTRATOR_DIR: root };
  const queueRoot = resolveMissionWorkerQueueRoot(queueEnv);
  if (!queueRoot) throw new Error('SEED_GOAL_QUEUE_STORE_UNAVAILABLE');
  const queueInfo = await lstat(queueRoot);
  if (!queueInfo.isDirectory() || queueInfo.isSymbolicLink()) throw new Error('SEED_GOAL_QUEUE_STORE_UNSAFE');
  const budget = { entries: 0, bytes: 0, records: 0, nodes: 0 };
  try {
    await inspectOriginalHistoryTree(root, issueNumber, budget,
      { skip: new Set(resolve(queueRoot) === resolve(root, 'worker-queue') ? ['worker-queue'] : []), ownedLock });
    await inspectOriginalHistoryTree(queueRoot, issueNumber, budget);
  } catch (error) {
    if (error.message?.startsWith('SEED_GOAL_')) throw error;
    throw new Error('SEED_GOAL_PRIOR_HISTORY_UNREADABLE');
  }
  const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
  const workspaceInfo = await lstat(workspaceRoot);
  if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()) throw new Error('SEED_GOAL_PRIOR_HISTORY_UNSAFE');
  // These existing stores retain ownership after queue terminalization and after
  // publication. Inventory every state/descendant, including orphan sidecars.
  for (const directory of ['receipts', 'source-artifacts', 'publication-outbox', 'outbox', 'inbox', 'archive']) {
    try { await inspectOriginalHistoryTree(join(workspaceRoot, directory), issueNumber, budget, { optional: true }); }
    catch (error) {
      if (error.message?.startsWith('SEED_GOAL_')) throw error;
      throw new Error('SEED_GOAL_PRIOR_HISTORY_UNREADABLE');
    }
  }
  await inspectOriginalHistoryTree(join(workspaceRoot, 'status'), issueNumber, budget,
    { optional: true, sourceLeaseStatusesOnly: true });
  const workspaceAfter = await lstat(workspaceRoot);
  if (!workspaceAfter.isDirectory() || workspaceAfter.isSymbolicLink() || workspaceAfter.ino !== workspaceInfo.ino
      || workspaceAfter.dev !== workspaceInfo.dev) throw new Error('SEED_GOAL_PRIOR_HISTORY_CHANGED');
  const lease = await readSourceMutationLease({ root: workspaceRoot, repoRoot: options.repoRoot, nowUtc: new Date().toISOString() });
  if (lease.record && (lease.record.laneId === missionId || lease.record.missionId === missionId
      || lease.record.issueNumber === issueNumber || String(lease.record.leaseId || '').startsWith(missionId + '-'))) {
    throw new Error('SEED_GOAL_PRIOR_LEASE_HISTORY_PRESENT');
  }
  if (lease.ok !== true && lease.reason !== 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT') {
    throw new Error('SEED_GOAL_SOURCE_LEASE_OBSERVATION_UNPROVEN');
  }
}

async function observeUnadmittedSeedGoal(issueNumber, options, ownedLock) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('SEED_GOAL_ISSUE_INVALID');
  const env = options.env || process.env;
  const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
  const cohort = await readCanonicalSourceGoalRecords(workspaceRoot, options);
  const candidates = cohort.records.filter(record => canonicalRepository(record.repository)
    && record.goalId === `goal-${issueNumber}` && record.issueNumber === issueNumber);
  if (candidates.length !== 1 || !validateSeedGrowthWorkV1(candidates[0]?.seedGrowthWork || {})) {
    throw new Error('SEED_GOAL_ORIGINAL_PROVENANCE_REQUIRED');
  }
  const goal = candidates[0], work = goal.seedGrowthWork;
  if (['COMPLETE', 'CLOSED', 'CANCELLED'].includes(String(goal.status || '').toUpperCase())
      || goal.operatorLaneContainment?.active === true) throw new Error('SEED_GOAL_TERMINAL_OR_CONTAINED');
  const pressureOwners = cohort.records.filter(record => canonicalRepository(record.repository)
    && validateSeedGrowthWorkV1(record.seedGrowthWork || {}) && record.seedGrowthWork.seedId === work.seedId
    && record.seedGrowthWork.pressureKey === work.pressureKey);
  if (pressureOwners.length !== 1) throw new Error('SEED_GOAL_IDENTITY_CONFLICT');
  await proveOriginalMissionAbsent(issueNumber, options, ownedLock);
  const identity = readOrdinaryRuntimePolicyHead(options.repoRoot, env, issueNumber);
  const contract = seedGoalContract(goal);
  return { goal, work, identity, contract, workspaceRoot,
    goalContractFingerprint: sha256(JSON.stringify(contract)),
    cohortFingerprint: sha256(JSON.stringify(cohort.records.map(record => ({ goalId: record.goalId,
      repository: record.repository, issueNumber: record.issueNumber, seedGrowthWork: record.seedGrowthWork || null }))
      .sort((left, right) => String(left.goalId).localeCompare(String(right.goalId))))) };
}

export async function readUnadmittedSeedSourceGoalEvidenceV1(issueNumber, options = {}) {
  try {
    const actual = await observeUnadmittedSeedGoal(issueNumber, options);
    return Object.freeze({ status: 'observed', classification: 'UNADMITTED_SEED', issueNumber,
      goal: actual.goal, goalContractFingerprint: actual.goalContractFingerprint, cohortFingerprint: actual.cohortFingerprint,
      runtimePolicyHead: actual.identity.head, executionParentHead: actual.identity.head, executionParentTree: actual.identity.tree,
      originalMissionAbsent: true, prospectiveMissionId: `critical-${issueNumber}-elastic-goal`,
      prospectiveBranch: `openclaw/elastic-goal-${issueNumber}`, sourceAuthority: false, dispatchAllowed: false });
  } catch (error) {
    return Object.freeze({ status: 'held', reasonCode: error.message, sourceAuthority: false, dispatchAllowed: false });
  }
}

const SEED_GOAL_CORRECTION_SCHEMA = 'stephanos.seed-goal-source-correction.v1';
const PENDING_SEED_GOAL_AUDIT_SCHEMA = 'stephanos.pending-seed-goal-source-audit.v1';
const FLEET_TRANSFER_CONTRACT = 'FLEET_SOURCE_ADMISSION_DIAGNOSTIC_TRANSFER_V1';
const FLEET_TRANSFER_SOURCE = 'shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
const FLEET_TRANSFER_TEST = 'shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.test.mjs';

function correctedGoalScope(plan, goal) {
  const shape = projectMissionSourceScopeShapeV1(plan.allowedFiles);
  if (!shape.valid || shape.allowedFiles.length > 4) throw new Error('SEED_GOAL_CORRECTED_SCOPE_INVALID');
  const literal = shape.allowedFiles.filter(path => !path.endsWith('/**'));
  if (!literal.length || literal.some(path => path.includes('*'))
      || shape.allowedFiles.some(path => path.endsWith('/**') && !literal.includes(path.slice(0, -3)))) {
    throw new Error('SEED_GOAL_CORRECTED_LITERAL_SCOPE_REQUIRED');
  }
  if (plan.domainAcceptanceContract !== FLEET_TRANSFER_CONTRACT || goal.seedGrowthWork.seedId !== 'goal-conveyor-fleet-care'
      || JSON.stringify([...literal].sort()) !== JSON.stringify([FLEET_TRANSFER_SOURCE, FLEET_TRANSFER_TEST].sort())
      || !plan.requiredTests.includes('node --test ' + FLEET_TRANSFER_TEST)) {
    throw new Error('SEED_GOAL_ACCEPTANCE_CONTRACT_UNREGISTERED');
  }
  const resourceIds = literal.map(path => `repo:cheekyfellastef/stephan-os:path:${path}`);
  const scope = sourceScope({ repository: goal.repository, resourceIds }, { repository: goal.repository, resourceIds });
  if (!scope.valid || JSON.stringify(scope.allowedFiles) !== JSON.stringify(plan.allowedFiles)) {
    throw new Error('SEED_GOAL_CORRECTED_CANONICAL_SCOPE_REQUIRED');
  }
  const previous = seedGoalContract(goal), tests = projectGoalAdmissionRequiredTestsV1(plan.requiredTests);
  if (!tests.valid || !tests.supplied || previous.requiredTests.some(test => !tests.commands.includes(test))
      || previous.requiredEvidence.some(ref => !plan.requiredEvidence.includes(ref))) {
    throw new Error('SEED_GOAL_CORRECTED_TEST_PLAN_WEAKENED');
  }
  if (!tests.commands.some(command => command.startsWith('node --test ')
      && !literal.includes(command.slice('node --test '.length)))) throw new Error('SEED_GOAL_INDEPENDENT_TEST_REQUIRED');
  if (plan.executionRelationship !== 'SELF' || plan.usefulOutcome !== goal.seedGrowthWork.nextBestAction) {
    throw new Error('SEED_GOAL_ORIGINAL_OUTCOME_BINDING_UNPROVEN');
  }
  return { resourceIds, allowedFiles: scope.allowedFiles, requiredTests: tests.commands, requiredEvidence: plan.requiredEvidence };
}

function correctionOriginalBinding(goal, evidence) {
  const body = evidence.originalIntentBody, work = goal.seedGrowthWork;
  // These are necessary identity checks only. Actual path/test authority comes
  // from the independently read immutable closed OWNER CORRECT decision.
  if (typeof body !== 'string' || !body.includes(work.pressureKey) || !body.includes(work.nextBestAction)
      || (!body.includes(`goal-${goal.issueNumber}`) && !body.includes(`#${goal.issueNumber}`))) {
    throw new Error('SEED_GOAL_ORIGINAL_INTENT_BINDING_UNPROVEN');
  }
}

async function readGoalCorrectionEvent(goal, options) {
  const mint = goal.sourceContractCorrection, descriptor = goal.seedSourceWorkDescriptor;
  if (!mint || mint.schemaVersion !== SEED_GOAL_CORRECTION_SCHEMA || mint.goalId !== goal.goalId
      || mint.issueNumber !== goal.issueNumber || !validateSeedSourceWorkDescriptorShapeV1(descriptor)
      || descriptor.authorityPlanFingerprint !== mint.authorityPlanFingerprint
      || mint.correctedContractFingerprint !== sha256(JSON.stringify(seedGoalContract(goal)))
      || mint.descriptorSha256 !== sha256(JSON.stringify(descriptor))) throw new Error('SEED_GOAL_CORRECTION_MINT_UNPROVEN');
  const workspaceRoot = options.sharedWorkspaceRoot || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
    || getDefaultSharedWorkspaceRoot({ env: options.env || process.env });
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot: options.repoRoot,
    segments: ['events', mint.auditEventId + '.json'] });
  if (!resolved.ok) throw new Error('SEED_GOAL_CORRECTION_AUDIT_UNRESOLVED');
  const info = await lstat(resolved.path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 128 * 1024) {
    throw new Error('SEED_GOAL_CORRECTION_AUDIT_UNSAFE');
  }
  const bytes = await readFile(resolved.path), after = await lstat(resolved.path);
  if (bytes.length !== info.size || after.dev !== info.dev || after.ino !== info.ino || after.mtimeMs !== info.mtimeMs) {
    throw new Error('SEED_GOAL_CORRECTION_AUDIT_CHANGED');
  }
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (event.eventKind !== 'seed-source-contract-corrected' || event.eventId !== mint.auditEventId
      || event.goalId !== goal.goalId || event.issueNumber !== goal.issueNumber
      || sha256(JSON.stringify(event)) !== mint.auditEventSha256
      || sha256(JSON.stringify(event.before)) !== mint.originalContractFingerprint
      || sha256(JSON.stringify(event.after)) !== mint.correctedContractFingerprint
      || JSON.stringify(event.descriptor) !== JSON.stringify(descriptor)
      || event.decisionProof?.decisionBodySha256 !== mint.decisionBodySha256
      || event.decisionProof?.decisionCommentId !== mint.decisionCommentId
      || event.decisionProof?.appliedAtUtc !== mint.appliedAtUtc) throw new Error('SEED_GOAL_CORRECTION_AUDIT_UNPROVEN');
  return { mint, descriptor, event };
}

async function recoverSeedGoalCorrectionAudit(goal, options) {
  const pending = goal.pendingSeedSourceCorrectionAudit;
  if (!pending) return goal;
  const event = pending.event, mint = goal.sourceContractCorrection;
  if (pending.schemaVersion !== PENDING_SEED_GOAL_AUDIT_SCHEMA || !mint
      || pending.eventSha256 !== sha256(JSON.stringify(event)) || pending.eventSha256 !== mint.auditEventSha256
      || event?.eventId !== mint.auditEventId || event.goalId !== goal.goalId
      || event.eventKind !== 'seed-source-contract-corrected'
      || JSON.stringify(event.descriptor) !== JSON.stringify(goal.seedSourceWorkDescriptor)) {
    throw new Error('SEED_GOAL_PENDING_AUDIT_INVALID');
  }
  const workspaceRoot = options.sharedWorkspaceRoot || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
    || getDefaultSharedWorkspaceRoot({ env: options.env || process.env });
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot: options.repoRoot,
    segments: ['events', event.eventId + '.json'] });
  if (!resolved.ok) throw new Error('SEED_GOAL_CORRECTION_AUDIT_UNRESOLVED');
  try {
    const existing = JSON.parse(await readFile(resolved.path, 'utf8'));
    if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error('SEED_GOAL_CORRECTION_AUDIT_CONFLICT');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const published = await writeAtomicJson(workspaceRoot, ['events', event.eventId + '.json'], event,
      { repoRoot: options.repoRoot, durable: true });
    if (!published.ok) throw new Error(published.reason);
  }
  await readGoalCorrectionEvent(goal, options);
  const clean = structuredClone(goal); delete clean.pendingSeedSourceCorrectionAudit;
  const write = await writeAtomicJson(workspaceRoot, ['goals', goal.goalId + '.json'], clean,
    { repoRoot: options.repoRoot, durable: true });
  if (!write.ok) throw new Error(write.reason);
  return clean;
}

export async function correctUnadmittedSeedSourceGoalV1(issueNumber, options = {}) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || !Number.isSafeInteger(options.correctionCommentId)
      || options.correctionCommentId < 1) throw new Error('SEED_GOAL_CORRECTION_SELECTOR_INVALID');
  const env = options.env || process.env;
  const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
  const orchestratorRoot = options.orchestratorRoot || options.root || resolveMissionOrchestratorRoot(env);
  const guard = await acquireSharedWorkspaceOperationLock(workspaceRoot, ['locks', 'flywheel-canonical-goal-admission.lock'], {
    repoRoot: options.repoRoot, operationLockTimeoutMs: 5000, operationLockRetryMs: 25, operationStaleLockMs: 60000 });
  if (!guard.ok) throw new Error(guard.reason);
  let lockHandle;
  const paths = missionPaths(orchestratorRoot, `critical-${issueNumber}-elastic-goal`);
  try {
    lockHandle = await acquireLock(paths.lockPath);
    const actualOptions = { ...options, env, root: orchestratorRoot, orchestratorRoot, sharedWorkspaceRoot: workspaceRoot };
    let first = await observeUnadmittedSeedGoal(issueNumber, actualOptions, lockHandle);
    if (first.goal.pendingSeedSourceCorrectionAudit) {
      await recoverSeedGoalCorrectionAudit(first.goal, actualOptions);
      first = await observeUnadmittedSeedGoal(issueNumber, actualOptions, lockHandle);
    }
    if (first.goal.sourceContractCorrection) {
      const current = await readSeedSourceGoalAdmissionEvidenceV1(issueNumber, actualOptions);
      if (current.status !== 'observed' || current.correctionCommentId !== options.correctionCommentId) {
        throw new Error(current.reasonCode || 'SEED_GOAL_CORRECTION_ALREADY_COMMITTED');
      }
      return { corrected: false, duplicate: true, goal: first.goal, evidence: current };
    }
    if (options.expectedGoalContractFingerprint !== undefined
        && options.expectedGoalContractFingerprint !== first.goalContractFingerprint) throw new Error('SEED_GOAL_CONTRACT_PRECONDITION_FAILED');
    const expected = { childIssueNumber: issueNumber, missionId: paths.safeId, seedId: first.work.seedId,
      pressureKey: first.work.pressureKey, targetRung: first.work.targetRung, contractPreimageSha256: first.goalContractFingerprint };
    const owner = await readUnadmittedSeedSourceCorrectionDecisionV1(expected, options.correctionCommentId, { env, workspaceRoot });
    if (owner.status !== 'observed') throw new Error(owner.reasonCode);
    correctionOriginalBinding(first.goal, owner);
    const remote = await readUnadmittedSeedGithubGoalV1(issueNumber, { env, workspaceRoot });
    if (remote.status !== 'observed' || !remote.issueBody.includes(first.work.pressureKey)) {
      throw new Error(remote.reasonCode || 'SEED_GOAL_REMOTE_SEED_IDENTITY_UNPROVEN');
    }
    if (remote.mainHead !== first.identity.head) throw new Error('SEED_GOAL_CURRENT_REMOTE_POLICY_HEAD_MISMATCH');
    const plan = owner.decision.sourceContract, scope = correctedGoalScope(plan, first.goal);
    if (owner.decision.runtimePolicyHead !== first.identity.head || owner.decision.runtimePolicyTree !== first.identity.tree) {
      throw new Error('SEED_GOAL_CORRECTION_POLICY_SOURCE_MISMATCH');
    }
    return await withOriginalSourceLeaseFenceGuard(async () => {
      const fresh = await observeUnadmittedSeedGoal(issueNumber, actualOptions, lockHandle);
      const currentOwner = await readUnadmittedSeedSourceCorrectionDecisionV1(expected, options.correctionCommentId, { env, workspaceRoot });
      const currentRemote = await readUnadmittedSeedGithubGoalV1(issueNumber, { env, workspaceRoot });
      const final = await observeUnadmittedSeedGoal(issueNumber, actualOptions, lockHandle);
      if (currentOwner.status !== 'observed' || currentOwner.decisionBodySha256 !== owner.decisionBodySha256
          || currentRemote.status !== 'observed' || currentRemote.frameFingerprint !== remote.frameFingerprint
          || fresh.goalContractFingerprint !== first.goalContractFingerprint || final.goalContractFingerprint !== first.goalContractFingerprint
          || final.cohortFingerprint !== first.cohortFingerprint || fresh.cohortFingerprint !== first.cohortFingerprint
          || JSON.stringify(final.identity) !== JSON.stringify(first.identity)) throw new Error('SEED_GOAL_CORRECTION_AUTHORITY_CHANGED');
      const appliedAtUtc = new Date().toISOString();
      if (Date.parse(owner.decision.expiresAtUtc) <= Date.parse(appliedAtUtc)) throw new Error('SEED_GOAL_CORRECTION_DECISION_EXPIRED');
      const authorityPlanFingerprint = sha256(JSON.stringify({ purpose: 'CORRECT_UNADMITTED_ORIGINAL_SEED_SOURCE_GOAL',
        original: expected, decisionBodySha256: owner.decisionBodySha256, plan,
        runtimePolicyHead: first.identity.head, runtimePolicyTree: first.identity.tree }));
      const descriptor = { schemaVersion: 'stephanos.seed-source-work-descriptor.v1', executionRelationship: 'SELF',
        seedId: first.work.seedId, ownerIssueRef: first.work.ownerIssueRef, declarationSource: first.work.contractSource,
        pressureKey: first.work.pressureKey, targetRung: first.work.targetRung, childIssueNumber: issueNumber,
        missionId: paths.safeId, branch: `openclaw/elastic-goal-${issueNumber}`, allowedFiles: scope.allowedFiles,
        requiredTests: scope.requiredTests, authorityPlanFingerprint, runtimePolicyHead: first.identity.head,
        executionParentHead: first.identity.head, executionParentTree: first.identity.tree,
        correctionEvidenceRef: `https://github.com/Cheekyfellastef/stephan-os/issues/${issueNumber}#issuecomment-${owner.decisionCommentId}`,
        acceptanceContractRef: plan.domainAcceptanceContract };
      if (!validateSeedSourceWorkDescriptorShapeV1(descriptor)) throw new Error('SEED_GOAL_CORRECTED_DESCRIPTOR_INVALID');
      const next = { ...final.goal, resourceIds: scope.resourceIds, requiredTests: scope.requiredTests,
        requiredEvidence: scope.requiredEvidence, seedSourceWorkDescriptor: descriptor,
        sourceContractRevision: first.contract.sourceContractRevision + 1, timestampUtc: appliedAtUtc };
      const after = seedGoalContract(next), auditEventId = `seed-source-correction-${authorityPlanFingerprint.slice(0, 32)}`;
      const event = { ...createSharedWorkspaceEventRecord({ eventId: auditEventId,
        participantId: first.goal.participantId, timestampUtc: appliedAtUtc }),
        eventKind: 'seed-source-contract-corrected', goalId: first.goal.goalId, issueNumber,
        before: first.contract, after, descriptor, decisionProof: { decisionCommentId: owner.decisionCommentId,
          decisionBodySha256: owner.decisionBodySha256, appliedAtUtc } };
      next.sourceContractCorrection = { schemaVersion: SEED_GOAL_CORRECTION_SCHEMA, goalId: next.goalId, issueNumber,
        originalBinding: owner.decision.binding, originalContractFingerprint: first.goalContractFingerprint,
        correctedContractFingerprint: sha256(JSON.stringify(after)), descriptorSha256: sha256(JSON.stringify(descriptor)),
        authorityPlanFingerprint, decisionCommentId: owner.decisionCommentId, decisionBodySha256: owner.decisionBodySha256,
        decisionCreatedAtUtc: owner.decisionCreatedAtUtc, decisionExpiresAtUtc: owner.decision.expiresAtUtc,
        appliedAtUtc, auditEventId, auditEventSha256: sha256(JSON.stringify(event)) };
      next.pendingSeedSourceCorrectionAudit = { schemaVersion: PENDING_SEED_GOAL_AUDIT_SCHEMA,
        eventSha256: next.sourceContractCorrection.auditEventSha256, event };
      if (Buffer.byteLength(JSON.stringify(next)) > 128 * 1024) throw new Error('SEED_GOAL_CORRECTION_RECORD_UNBOUNDED');
      const write = await writeAtomicJson(workspaceRoot, ['goals', next.goalId + '.json'], next,
        { repoRoot: options.repoRoot, durable: true });
      if (!write.ok) throw new Error(write.reason);
      const goal = await recoverSeedGoalCorrectionAudit(next, actualOptions);
      return { corrected: true, duplicate: false, goal, authorityPlanFingerprint, correctionCommentId: owner.decisionCommentId };
    }, { root: workspaceRoot, repoRoot: options.repoRoot });
  } finally {
    try { if (lockHandle) await releaseLock(lockHandle, paths.lockPath); }
    finally { if (!await guard.release()) throw new Error('SEED_GOAL_ADMISSION_LOCK_RELEASE_UNPROVEN'); }
  }
}

export async function readSeedSourceGoalAdmissionEvidenceV1(issueNumber, options = {}) {
  try {
    const env = options.env || process.env;
    const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
    const cohort = await readCanonicalSourceGoalRecords(workspaceRoot, options);
    const goals = cohort.records.filter(goal => canonicalRepository(goal.repository) && goal.issueNumber === issueNumber
      && goal.goalId === `goal-${issueNumber}`);
    if (goals.length !== 1 || !validateSeedGrowthWorkV1(goals[0].seedGrowthWork || {})) throw new Error('SEED_GOAL_ORIGINAL_PROVENANCE_REQUIRED');
    const goal = goals[0], work = goal.seedGrowthWork;
    if (['COMPLETE', 'CLOSED', 'CANCELLED'].includes(String(goal.status || '').toUpperCase())
        || goal.operatorLaneContainment?.active === true) throw new Error('SEED_GOAL_TERMINAL_OR_CONTAINED');
    if (goal.pendingSeedSourceCorrectionAudit) throw new Error('SEED_GOAL_AUDIT_RECOVERY_REQUIRED');
    if (cohort.records.filter(record => canonicalRepository(record.repository) && validateSeedGrowthWorkV1(record.seedGrowthWork || {})
      && record.seedGrowthWork.seedId === work.seedId && record.seedGrowthWork.pressureKey === work.pressureKey).length !== 1) {
      throw new Error('SEED_GOAL_IDENTITY_CONFLICT');
    }
    const { mint, descriptor, event } = await readGoalCorrectionEvent(goal, options);
    const owner = await readConsumedSeedSourceContractCorrectionEvidenceV1(mint.originalBinding, {
      decisionCommentId: mint.decisionCommentId, decisionBodySha256: mint.decisionBodySha256, appliedAtUtc: mint.appliedAtUtc }, { env, workspaceRoot });
    if (owner.status !== 'observed') throw new Error(owner.reasonCode);
    correctionOriginalBinding(goal, owner);
    const expected = { childIssueNumber: issueNumber, missionId: `critical-${issueNumber}-elastic-goal`, seedId: work.seedId,
      pressureKey: work.pressureKey, targetRung: work.targetRung, contractPreimageSha256: sha256(JSON.stringify(event.before)) };
    const actualPlan = owner.decision.sourceContract, scope = correctedGoalScope(actualPlan, event.before);
    const actualAuthority = sha256(JSON.stringify({ purpose: 'CORRECT_UNADMITTED_ORIGINAL_SEED_SOURCE_GOAL',
      original: expected, decisionBodySha256: owner.decisionBodySha256, plan: actualPlan,
      runtimePolicyHead: descriptor.runtimePolicyHead, runtimePolicyTree: descriptor.executionParentTree }));
    if (work.seedId !== descriptor.seedId || work.pressureKey !== descriptor.pressureKey || work.targetRung !== descriptor.targetRung
        || work.ownerIssueRef !== descriptor.ownerIssueRef || work.contractSource !== descriptor.declarationSource
        || Object.keys(expected).some(key => owner.decision.binding[key] !== expected[key])
        || actualAuthority !== descriptor.authorityPlanFingerprint || actualAuthority !== mint.authorityPlanFingerprint
        || JSON.stringify(scope.resourceIds) !== JSON.stringify(goal.resourceIds)
        || JSON.stringify(actualPlan.requiredEvidence) !== JSON.stringify(goal.requiredEvidence)
        || actualPlan.domainAcceptanceContract !== descriptor.acceptanceContractRef
        || actualPlan.usefulOutcome !== work.nextBestAction
        || goal.sourceContractRevision !== event.before.sourceContractRevision + 1
        || owner.decision.runtimePolicyHead !== descriptor.runtimePolicyHead
        || owner.decision.runtimePolicyTree !== descriptor.executionParentTree
        || JSON.stringify(owner.decision.sourceContract.allowedFiles) !== JSON.stringify(descriptor.allowedFiles)
        || JSON.stringify(owner.decision.sourceContract.requiredTests) !== JSON.stringify(descriptor.requiredTests)
        || sha256(JSON.stringify(event.before)) !== owner.decision.binding.contractPreimageSha256
        || readOrdinaryRuntimePolicyHead(options.repoRoot, env) !== descriptor.runtimePolicyHead) {
      throw new Error('SEED_GOAL_CURRENT_CONTRACT_PROOF_MISMATCH');
    }
    const finalCohort = await readCanonicalSourceGoalRecords(workspaceRoot, options);
    const final = finalCohort.records.filter(record => record.goalId === goal.goalId && canonicalRepository(record.repository));
    if (final.length !== 1 || sha256(JSON.stringify(seedGoalContract(final[0]))) !== mint.correctedContractFingerprint
        || JSON.stringify(final[0].sourceContractCorrection) !== JSON.stringify(mint)
        || JSON.stringify(final[0].seedSourceWorkDescriptor) !== JSON.stringify(descriptor)
        || final[0].pendingSeedSourceCorrectionAudit || final[0].operatorLaneContainment?.active === true
        || ['COMPLETE', 'CLOSED', 'CANCELLED'].includes(String(final[0].status || '').toUpperCase())
        || finalCohort.records.filter(record => canonicalRepository(record.repository) && validateSeedGrowthWorkV1(record.seedGrowthWork || {})
          && record.seedGrowthWork.seedId === work.seedId && record.seedGrowthWork.pressureKey === work.pressureKey).length !== 1) {
      throw new Error('SEED_GOAL_CURRENT_CONTRACT_CHANGED');
    }
    return Object.freeze({ status: 'observed', classification: 'CORRECTED_ORIGINAL_SEED', goal,
      descriptor, authorityPlanFingerprint: descriptor.authorityPlanFingerprint,
      sourcePlanKind: 'SEED_SELF', correctionCommentId: mint.decisionCommentId, sourceAuthority: true, dispatchAllowed: false });
  } catch (error) {
    return Object.freeze({ status: 'held', reasonCode: error.message, sourceAuthority: false, dispatchAllowed: false });
  }
}

async function observeCurrentOrdinarySourcePlan(missionId, options = {}) {
  const env = options.env || process.env;
  const observed = await readSeedSourceCanonicalGoalCohortV1(missionId, options);
  const { state } = await readMissionRecord(missionId, { root: options.root, env });
  const fail = reason => { throw Object.assign(new Error(SOURCE_SCOPE_RECONCILIATION_REQUIRED), { reasonCode: reason }); };
  if (state.revision !== observed.missionRevision || !observed.cohortComplete || !observed.canonicalGoal) {
    fail(observed.reason || 'CURRENT_SOURCE_PLAN_CANONICAL_COHORT_REQUIRED');
  }
  if (storedSeedAssociation(state, observed.canonicalGoal) || observed.classification === 'SEED') {
    fail(observed.reason || 'SEED_SOURCE_CORRECTION_REQUIRED');
  }
  if (observed.canonicalGoal.operatorLaneContainment?.active === true) fail('CURRENT_SOURCE_PLAN_OPERATOR_CONTAINED');
  const match = /^critical-([1-9][0-9]*)-elastic-goal$/.exec(state.missionId);
  if (!match || state.missionId !== missionId || state.git?.branch !== `openclaw/elastic-goal-${match[1]}`) {
    fail('CURRENT_SOURCE_PLAN_ORIGINAL_MISSION_IDENTITY_REQUIRED');
  }
  const issueNumber = Number(match[1]);
  const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
  // No caller-supplied reader, response, authenticator or classification is
  // accepted. Tests replace the external HTTP boundary, not this producer.
  const owner = await readCurrentOwnerAdmittedGoalPlanV1(issueNumber, { env, workspaceRoot });
  if (owner.status !== 'observed' || owner.complete !== true) fail(owner.reasonCode);
  if (storedSeedAssociation(state, observed.canonicalGoal, owner.issueBody, owner.seedAssociation)) {
    fail('CURRENT_SOURCE_PLAN_SEED_ASSOCIATION_PRESENT');
  }
  const admission = owner.issue?.admission;
  const tests = projectGoalAdmissionRequiredTestsV1(admission?.requiredTests);
  const scope = sourceScope({ repository: state.repository, resourceIds: admission?.resourceIds },
    { repository: state.repository, resourceIds: admission?.resourceIds });
  if (!scope.valid || scope.repository.toLowerCase() !== state.repository.toLowerCase()
      || JSON.stringify(scope.allowedFiles) !== JSON.stringify(state.allowedFiles)
      || !tests.valid || !tests.supplied || JSON.stringify(tests.commands) !== JSON.stringify(state.requiredTests)) {
    fail('CURRENT_SOURCE_PLAN_RETAINED_CONTRACT_MISMATCH');
  }
  let runtimePolicyHead;
  try { runtimePolicyHead = readOrdinaryRuntimePolicyHead(options.repoRoot || state.repositoryRoot, env); }
  catch (error) { fail(error.message); }
  const contractFingerprint = ordinaryContractFingerprint(state);
  const authority = { schemaVersion: CURRENT_ORDINARY_SOURCE_PLAN_SCHEMA, purpose: CURRENT_ORDINARY_SOURCE_PLAN_PURPOSE,
    repository: state.repository, issueNumber, missionId: state.missionId, branch: state.git.branch,
    contractFingerprint, ownerAuthorityFingerprint: owner.authorityFingerprint, runtimePolicyHead };
  return { state, observed, owner, plan: { ...authority, authorityPlanFingerprint: sha256(JSON.stringify(authority)),
    observations: { observedAtUtc: owner.observedAtUtc, ownerFrameFingerprint: owner.frameFingerprint,
      cohortFingerprint: observed.cohortFingerprint } } };
}

// Current ordinary source intent is reaffirmed, never inferred from historical
// absence of seed metadata. This is lifecycle evidence maintenance, not a
// source claim. All worker/class/resource/custody gates still apply.
export async function reaffirmCurrentOrdinarySourcePlanV1(missionId, options = {}) {
  const env = options.env || process.env;
  const root = options.root || resolveMissionOrchestratorRoot(env);
  if (!root) throw new Error('CURRENT_SOURCE_PLAN_STORE_REQUIRED');
  const paths = missionPaths(root, missionId), lockHandle = await acquireLock(paths.lockPath);
  try {
    const stored = JSON.parse(await readFile(paths.statePath, 'utf8'));
    const current = await reconcilePendingMissionAudit(stored, paths);
    if (options.expectedMissionRevision !== undefined && options.expectedMissionRevision !== current.revision) {
      throw new Error('MISSION_STATE_PRECONDITION_FAILED');
    }
    if (current.cancelled === true || ['COMPLETE', 'CANCELLED'].includes(current.currentPhase)) {
      throw new Error('CURRENT_SOURCE_PLAN_TERMINAL_MISSION_HELD');
    }
    if (current.dispatch?.status === 'running' || current.storeMetadata?.supervisedRecoveryMaintenance
        || current.storeMetadata?.originalSourceAttemptFence) throw new Error('CURRENT_SOURCE_PLAN_ORIGINAL_CUSTODY_HELD');
    const first = await observeCurrentOrdinarySourcePlan(missionId, { ...options, root });
    if (sha256(JSON.stringify(first.state)) !== sha256(JSON.stringify(current))) {
      throw new Error('CURRENT_SOURCE_PLAN_MISSION_CHANGED');
    }
    const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
    return await withOriginalSourceLeaseFenceGuard(async () => {
      const fresh = await observeCurrentOrdinarySourcePlan(missionId, { ...options, root });
      const finalCohort = await readSeedSourceCanonicalGoalCohortV1(missionId, { ...options, root });
      const finalState = (await readMissionRecord(missionId, { root, env })).state;
      if (sha256(JSON.stringify(fresh.state)) !== sha256(JSON.stringify(current))
          || sha256(JSON.stringify(finalState)) !== sha256(JSON.stringify(current))
          || fresh.plan.authorityPlanFingerprint !== first.plan.authorityPlanFingerprint
          || fresh.observed.cohortFingerprint !== first.observed.cohortFingerprint
          || finalCohort.cohortComplete !== true || finalCohort.cohortFingerprint !== first.observed.cohortFingerprint
          || storedSeedAssociation(finalState, finalCohort.canonicalGoal)
          || readOrdinaryRuntimePolicyHead(options.repoRoot || current.repositoryRoot, env) !== fresh.plan.runtimePolicyHead) {
        throw new Error('CURRENT_SOURCE_PLAN_AUTHORITY_CHANGED');
      }
      if (current.currentOrdinarySourcePlan?.authorityPlanFingerprint === fresh.plan.authorityPlanFingerprint) {
        await proveOrdinaryPlanRecorded(current, paths);
        await proveOrdinaryPlanRecorded(current, paths);
        return { state: current, reaffirmed: false, duplicate: true, observations: fresh.plan.observations };
      }
      const history = current.storeMetadata?.ordinarySourcePlanHistory || [];
      if (history.length >= 20) throw new Error('CURRENT_SOURCE_PLAN_HISTORY_LIMIT');
      const eventId = `ordinary-plan-${sha256(missionId).slice(0, 12)}-${current.revision}-${fresh.plan.authorityPlanFingerprint.slice(0, 12)}`;
      const timestamp = new Date().toISOString();
      const recordedPlan = { ...fresh.plan, recordedAtRevision: current.revision + 1, reaffirmationEventId: eventId };
      const event = { eventId, eventType: 'ORDINARY_SOURCE_PLAN_REAFFIRMED', missionId,
        timestamp, expectedRevision: current.revision, resultingRevision: current.revision + 1,
        currentOrdinarySourcePlan: recordedPlan };
      const serial = JSON.stringify(event);
      if (Buffer.byteLength(serial) > MAX_QUARANTINE_AUDIT_BYTES) throw new Error('SOURCE_PLAN_AUDIT_UNBOUNDED');
      const next = withStoreMetadata({ ...current, currentOrdinarySourcePlan: recordedPlan,
        revision: current.revision + 1, updatedAt: timestamp,
        timeline: [...current.timeline, { eventType: event.eventType, timestamp, summary: 'Current exact ordinary source plan reaffirmed.' }] }, {
        ...(current.currentOrdinarySourcePlan ? { ordinarySourcePlanHistory: [...history, current.currentOrdinarySourcePlan] } : {}),
        processedEventIds: [...(current.storeMetadata?.processedEventIds || []), eventId].slice(-1000), lastEventId: eventId,
        pendingSourcePlanAuditEvent: { schemaVersion: PENDING_SOURCE_PLAN_AUDIT_SCHEMA, eventId,
          eventSha256: sha256(serial), event },
      });
      await writeMissionJsonAtomically(paths.statePath, next, { durable: true });
      const state = await reconcilePendingSourcePlanAudit(next, paths);
      return { state, reaffirmed: true, duplicate: false, eventId, observations: fresh.plan.observations };
    }, { root: workspaceRoot, repoRoot: options.repoRoot || current.repositoryRoot });
  } finally { await releaseLock(lockHandle, paths.lockPath); }
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
  if (types.isProxy(input)) throw new Error('MISSION_INPUT_DATA_REQUIRED');
  if (classifyElasticMissionIdentityV1(input.missionId, input.branch).kind === 'NONCANONICAL_ELASTIC') {
    throw new Error('NONCANONICAL_ELASTIC_MISSION_IDENTITY');
  }
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, safeMissionId(input.missionId));
  await mkdir(paths.root, { recursive: true });
  const lockHandle = await acquireLock(paths.lockPath);
  try {
    let state = withStoreMetadata(createMissionOrchestratorState(input, options), {
      createdBy: text(options.createdBy, 'stephanos-server'), lastEventId: '',
    });
    try { await lstat(paths.statePath); throw new Error(`Mission already exists: ${state.missionId}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const match = /^critical-([1-9][0-9]*)-elastic-goal$/.exec(state.missionId);
    const registered = SELF_HOSTING_CRITICAL_BACKLOG.some(item => item.mission?.missionId === state.missionId
      && canonicalRepository(state.repository) && item.mission.branch === state.git.branch
      && item.mission.operatorIntent === state.operatorIntent && item.mission.intendedOutcome === state.intendedOutcome
      && JSON.stringify(item.mission.allowedFiles) === JSON.stringify(state.allowedFiles)
      && JSON.stringify(item.mission.requiredTests) === JSON.stringify(state.requiredTests)
      && !storedSeedAssociation(state));
    if (match && !registered) {
      const env = options.env || process.env;
      const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot({ env });
      let cohort;
      try { cohort = await readCanonicalSourceGoalRecords(workspaceRoot, options); }
      catch { throw new Error('SEED_SOURCE_GOAL_INTAKE_PROVENANCE_REQUIRED'); }
      const goals = cohort.records.filter(goal => canonicalRepository(goal.repository)
        && goal.goalId === `goal-${match[1]}` && goal.issueNumber === Number(match[1]));
      if (!canonicalRepository(state.repository) || goals.length !== 1) throw new Error('SEED_SOURCE_GOAL_INTAKE_PROVENANCE_REQUIRED');
      if (storedSeedAssociation(state, goals[0]) || state.seedSourceWorkDescriptor) {
        const actual = await readSeedSourceGoalAdmissionEvidenceV1(Number(match[1]), { ...options, root });
        if (actual.status !== 'observed') throw new Error('SEED_SOURCE_GOAL_INTAKE_AUTHORITY_REQUIRED:' + actual.reasonCode);
        if (JSON.stringify(state.seedGrowthWork) !== JSON.stringify(actual.goal.seedGrowthWork)
            || JSON.stringify(state.seedSourceWorkDescriptor) !== JSON.stringify(actual.descriptor)
            || JSON.stringify(state.allowedFiles) !== JSON.stringify(actual.descriptor.allowedFiles)
            || JSON.stringify(state.requiredTests) !== JSON.stringify(actual.descriptor.requiredTests)
            || state.git.branch !== actual.descriptor.branch
            || !state.operatorIntent.includes(actual.goal.seedGrowthWork.nextBestAction)
            || !state.operatorIntent.includes(actual.goal.seedGrowthWork.pressureKey)) throw new Error('SEED_SOURCE_GOAL_INTAKE_PLAN_CHANGED');
      }
    }
    const event = { eventId: `created-${state.missionId}`, eventType: 'MISSION_CREATED', missionId: state.missionId,
      timestamp: state.createdAt, summary: 'Mission created through bounded intent intake.',
      ...(state.seedSourceWorkDescriptor ? { sourcePlanFingerprint: state.seedSourceWorkDescriptor.authorityPlanFingerprint,
        contractFingerprint: ordinaryContractFingerprint(state),
        seedGrowthWork: state.seedGrowthWork, seedSourceWorkDescriptor: state.seedSourceWorkDescriptor } : {}) };
    if (state.seedSourceWorkDescriptor) {
      state = withStoreMetadata(state, { processedEventIds: [event.eventId], lastEventId: event.eventId,
        pendingSeedMissionGenesisAudit: { schemaVersion: 'stephanos.pending-seed-mission-genesis-audit.v1',
          eventSha256: sha256(JSON.stringify(event)), event } });
      const temp = paths.statePath + '.create-' + randomUUID();
      await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', flush: true, mode: 0o600 });
      try { await link(temp, paths.statePath); }
      finally { await rm(temp, { force: true }); }
      state = await reconcilePendingSeedMissionGenesisAudit(state, paths);
    } else {
      try { await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) { if (error.code === 'EEXIST') throw new Error(`Mission already exists: ${state.missionId}`); throw error; }
      await appendFile(paths.eventPath, JSON.stringify(event) + '\n', 'utf8');
    }
    const snapshot = await publishSnapshot(state, options.snapshotRoot || resolveMissionOperationsSnapshotRoot(options.env || process.env));
    return { state, statePath: paths.statePath, eventPath: paths.eventPath, snapshot };
  } finally { await releaseLock(lockHandle, paths.lockPath); }
}

export async function readMissionRecord(missionId, options = {}) {
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, missionId);
  const state = JSON.parse(await readFile(paths.statePath, 'utf8'));
  return { state, statePath: paths.statePath, eventPath: paths.eventPath };
}

// Classification is derived from actual canonical reads, never from caller
// classification flags or a missing seed field. The registered non-seed
// contract is positive source evidence; unregistered provenance stays UNKNOWN.
async function readCanonicalSourceGoalRecords(workspaceRoot, options = {}) {
  const result = (_classification, reason) => { throw new Error(reason); };
  let cohort;
  try {
    const goalDirectory = join(workspaceRoot, 'goals');
    const directory = await lstat(goalDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return result('UNKNOWN', 'SEED_CANONICAL_GOAL_COHORT_UNAVAILABLE');
    const physicalDirectory = await realpath(goalDirectory);
    const inventory = await readdir(goalDirectory, { withFileTypes: true });
    if (inventory.length > 4096) return result('UNKNOWN', 'SEED_CANONICAL_GOAL_COHORT_UNBOUNDED');
    const names = inventory.filter(entry => entry.name.endsWith('.json')).map(entry => {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^goal-[1-9][0-9]*\.json$/.test(entry.name)) {
        throw new Error('SEED_CANONICAL_GOAL_COHORT_ENTRY_UNSAFE');
      }
      return entry.name;
    }).sort();
    const known = new Set(names);
    let totalBytes = 0;
    const fixedReader = async pathname => {
      const name = basename(pathname);
      if (!known.has(name) || resolve(pathname) !== resolve(goalDirectory, name)) {
        throw new Error('SEED_CANONICAL_GOAL_COHORT_CHANGED');
      }
      const physicalPath = join(physicalDirectory, name), before = await lstat(physicalPath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
          || before.size < 0 || before.size > 128 * 1024) throw new Error('SEED_CANONICAL_GOAL_COHORT_ENTRY_UNSAFE');
      totalBytes += before.size;
      if (totalBytes > 16 * 1024 * 1024) throw new Error('SEED_CANONICAL_GOAL_COHORT_UNBOUNDED');
      const handle = await open(physicalPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      try {
        const opened = await handle.stat();
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || !opened.isFile()) {
          throw new Error('SEED_CANONICAL_GOAL_COHORT_CHANGED');
        }
        const bytes = Buffer.alloc(128 * 1024 + 1);
        let used = 0;
        while (used < bytes.length) {
          const read = await handle.read(bytes, used, bytes.length - used, null);
          if (!read.bytesRead) break;
          used += read.bytesRead;
        }
        const after = await handle.stat(), current = await lstat(physicalPath);
        if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
            || current.ino !== before.ino || current.dev !== before.dev || current.nlink !== 1
            || current.isSymbolicLink()) throw new Error('SEED_CANONICAL_GOAL_COHORT_CHANGED');
        const textBytes = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
        const raw = JSON.parse(textBytes), id = /^goal-([1-9][0-9]*)\.json$/.exec(name)[1];
        if (raw.goalId !== `goal-${id}` || raw.issueNumber !== Number(id)) {
          throw new Error('SEED_CANONICAL_GOAL_COHORT_IDENTITY_MISMATCH');
        }
        return textBytes;
      } finally { await handle.close(); }
    };
    cohort = await readSharedWorkspaceRecordDirectory(workspaceRoot, 'goals', {
      repoRoot: options.repoRoot, nowMs: options.now instanceof Date ? options.now.getTime() : Date.now(),
      readFile: fixedReader,
    });
    const afterDirectory = await lstat(goalDirectory);
    const afterNames = (await readdir(goalDirectory)).filter(name => name.endsWith('.json')).sort();
    if (afterDirectory.ino !== directory.ino || afterDirectory.dev !== directory.dev || afterDirectory.isSymbolicLink()
        || await realpath(goalDirectory) !== physicalDirectory || JSON.stringify(afterNames) !== JSON.stringify(names)) {
      return result('UNKNOWN', 'SEED_CANONICAL_GOAL_COHORT_CHANGED');
    }
  } catch {
    return result('UNKNOWN', 'SEED_CANONICAL_GOAL_COHORT_UNAVAILABLE');
  }
  if (!Array.isArray(cohort.records) || cohort.records.length > 4096
      || !Array.isArray(cohort.errors) || cohort.errors.length) {
    return result('UNKNOWN', 'SEED_CANONICAL_GOAL_COHORT_INCOMPLETE');
  }
  return cohort;
}

export async function readSeedSourceCanonicalGoalCohortV1(missionId, options = {}) {
  const env = options.env || process.env;
  const { state } = await readMissionRecord(missionId, { root: options.root, env });
  const result = (classification, reason, additions = {}) => Object.freeze({
    classification, reason, missionId: state?.missionId, missionRevision: state?.revision,
    sourceAuthority: false, dispatchAllowed: false, ...additions,
  });
  if (types.isProxy(state) || !state || state.missionId !== missionId
      || !canonicalRepository(state.repository)) {
    return result('UNKNOWN', SOURCE_SCOPE_RECONCILIATION_REQUIRED);
  }
  const registered = SELF_HOSTING_CRITICAL_BACKLOG.filter(item => item.mission?.missionId === state.missionId);
  if (registered.length === 1 && !storedSeedAssociation(state)) {
    const contract = registered[0].mission;
    if (canonicalRepository(contract.repository) && contract.branch === state.git?.branch
        && contract.operatorIntent === state.operatorIntent && contract.intendedOutcome === state.intendedOutcome
        && JSON.stringify(contract.allowedFiles) === JSON.stringify(state.allowedFiles)
        && JSON.stringify(contract.requiredTests) === JSON.stringify(state.requiredTests)
        && JSON.stringify(contract.requiredEvidence) === JSON.stringify(state.requiredEvidence)) {
      return result('VERIFIED_NON_SEED', 'SOURCE_CONTROLLED_NON_SEED_CONTRACT_MATCHED', {
        provenance: Object.freeze({ source: 'shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs',
          itemId: registered[0].itemId, approvalRef: registered[0].headlineApprovalRef }),
      });
    }
  }
  const match = /^critical-([1-9][0-9]*)-elastic-goal$/.exec(state.missionId);
  if (!match) return result('UNKNOWN', SOURCE_SCOPE_RECONCILIATION_REQUIRED);
  const issueNumber = Number(match[1]);
  const workspaceRoot = options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || getDefaultSharedWorkspaceRoot({ env });
  let cohort;
  try { cohort = await readCanonicalSourceGoalRecords(workspaceRoot, options); }
  catch (error) { return result('UNKNOWN', error.message); }
  const candidates = cohort.records.filter(goal => canonicalRepository(goal.repository)
    && goal.goalId === `goal-${issueNumber}` && goal.issueNumber === issueNumber);
  if (candidates.length !== 1) {
    return result('UNKNOWN', SOURCE_SCOPE_RECONCILIATION_REQUIRED);
  }
  const retainedHistory = JSON.stringify({ repair: state.repair?.history,
    continuity: state.continuity?.history, sourcePlan: state.seedSourceWorkDescriptor });
  const association = projectSeedSourceAssociationV1({ ...state,
    seedGrowthWork: candidates[0].seedGrowthWork ?? state.seedGrowthWork, retainedHistory });
  const cohortFingerprint = sha256(JSON.stringify(cohort.records.map(goal => ({
    repository: goal.repository, goalId: goal.goalId, issueNumber: goal.issueNumber,
    seedGrowthWork: goal.seedGrowthWork ?? null,
  })).sort((left, right) => String(left.goalId).localeCompare(String(right.goalId)))));
  if (!validateSeedGrowthWorkV1(candidates[0].seedGrowthWork || {})) {
    return result(association.associated ? association.classification : 'UNKNOWN',
      association.associated ? association.reason : 'CURRENT_OWNER_PLAN_REQUIRED', {
        canonicalGoal: candidates[0], cohortFingerprint, cohortComplete: true, retainedHistory,
      });
  }
  const goal = candidates[0], work = goal.seedGrowthWork;
  const pressureOwners = cohort.records.filter(record => canonicalRepository(record.repository)
    && validateSeedGrowthWorkV1(record.seedGrowthWork || {})
    && record.seedGrowthWork.seedId === work.seedId && record.seedGrowthWork.pressureKey === work.pressureKey);
  return result('SEED', pressureOwners.length === 1 ? SOURCE_SCOPE_RECONCILIATION_REQUIRED : 'SEED_GOAL_IDENTITY_CONFLICT', {
    goal, canonicalGoal: goal, cohortFingerprint, cohortComplete: true, retainedHistory,
    pressureOwners: Object.freeze(pressureOwners.map(record => record.issueNumber)),
    sourceEvidence: Object.freeze({ source: 'canonical-shared-workspace-goal-cohort',
      goalId: goal.goalId, seedId: work.seedId, pressureKey: work.pressureKey }),
  });
}

export async function assertSeedSourceContractAdmissionV1(missionId, options = {}) {
  const env = options.env || process.env;
  const { state } = await readMissionRecord(missionId, { root: options.root, env });
  const fail = reasonCode => { throw Object.assign(new Error(SOURCE_SCOPE_RECONCILIATION_REQUIRED), { reasonCode }); };
  if (classifyElasticMissionIdentityV1(state.missionId, state.git?.branch).kind === 'NONCANONICAL_ELASTIC') {
    fail('NONCANONICAL_ELASTIC_MISSION_IDENTITY');
  }
  if (state.storeMetadata?.pendingSourcePlanAuditEvent) fail('SOURCE_PLAN_AUDIT_RECOVERY_REQUIRED');
  if (options.expectedMissionRevision !== undefined && state.revision !== options.expectedMissionRevision) {
    fail('CURRENT_SOURCE_PLAN_MISSION_REVISION_MISMATCH');
  }
  const observed = await readSeedSourceCanonicalGoalCohortV1(missionId, options);
  if (observed.missionRevision !== state.revision) fail('CURRENT_SOURCE_PLAN_MISSION_CHANGED');
  if (observed.classification === 'SEED' && state.seedSourceWorkDescriptor) {
    if (options.expectedSourcePlanKind !== 'SEED_SELF') fail('SOURCE_PLAN_KIND_REQUIRED_OR_MISMATCHED');
    const match = /^critical-([1-9][0-9]*)-elastic-goal$/.exec(missionId);
    if (!match) fail('SEED_SOURCE_MISSION_IDENTITY_UNPROVEN');
    const actual = await readSeedSourceGoalAdmissionEvidenceV1(Number(match[1]), options);
    if (actual.status !== 'observed') fail(actual.reasonCode);
    if (JSON.stringify(state.seedGrowthWork) !== JSON.stringify(actual.goal.seedGrowthWork)
        || JSON.stringify(state.seedSourceWorkDescriptor) !== JSON.stringify(actual.descriptor)
        || JSON.stringify(state.allowedFiles) !== JSON.stringify(actual.descriptor.allowedFiles)
        || JSON.stringify(state.requiredTests) !== JSON.stringify(actual.descriptor.requiredTests)
        || state.git?.branch !== actual.descriptor.branch
        || !state.operatorIntent.includes(actual.goal.seedGrowthWork.nextBestAction)
        || !state.operatorIntent.includes(actual.goal.seedGrowthWork.pressureKey)
        || !Number.isFinite(Date.parse(state.createdAt))
        || Date.parse(state.createdAt) < Date.parse(actual.goal.sourceContractCorrection.appliedAtUtc)
        || (options.expectedSourcePlanFingerprint !== undefined
          && options.expectedSourcePlanFingerprint !== actual.authorityPlanFingerprint)
        || (options.runtimePolicyHead !== undefined && options.runtimePolicyHead !== actual.descriptor.runtimePolicyHead)) {
      fail('SEED_SOURCE_MISSION_CONTRACT_MISMATCH');
    }
    try { await proveSeedMissionGenesis(state, missionPaths(options.root || resolveMissionOrchestratorRoot(env), missionId)); }
    catch (error) { fail(error.message); }
    const finalState = (await readMissionRecord(missionId, { root: options.root, env })).state;
    if (finalState.revision !== state.revision || ordinaryContractFingerprint(finalState) !== ordinaryContractFingerprint(state)
        || JSON.stringify(finalState.seedSourceWorkDescriptor) !== JSON.stringify(state.seedSourceWorkDescriptor)
        || JSON.stringify(finalState.seedGrowthWork) !== JSON.stringify(state.seedGrowthWork)
        || finalState.storeMetadata?.pendingSeedMissionGenesisAudit) fail('SEED_SOURCE_MISSION_CHANGED');
    return Object.freeze({ classification: 'CORRECTED_ORIGINAL_SEED_SOURCE_PLAN_PROVEN',
      reason: 'CORRECTED_ORIGINAL_SEED_CURRENT_PROOF', missionId, missionRevision: state.revision,
      authorityPlanFingerprint: actual.authorityPlanFingerprint, runtimePolicyHead: actual.descriptor.runtimePolicyHead,
      sourcePlanKind: 'SEED_SELF',
      sourceAuthority: true, dispatchAllowed: false });
  }
  if (observed.classification === 'VERIFIED_NON_SEED') {
    if (options.expectedSourcePlanKind != null) fail('SOURCE_PLAN_KIND_STATIC_CONTRACT_MISMATCH');
    if (options.expectedSourcePlanFingerprint != null) fail('CURRENT_SOURCE_PLAN_FINGERPRINT_MISMATCH');
    if (options.runtimePolicyHead !== undefined && readOrdinaryRuntimePolicyHead(options.repoRoot || state.repositoryRoot, env) !== options.runtimePolicyHead) {
      fail('CURRENT_SOURCE_PLAN_POLICY_HEAD_MISMATCH');
    }
    return observed;
  }
  const retained = state.currentOrdinarySourcePlan;
  if (retained && options.expectedSourcePlanKind !== 'CURRENT_ORDINARY_SOURCE_PLAN') fail('SOURCE_PLAN_KIND_REQUIRED_OR_MISMATCHED');
  if (!retained || retained.schemaVersion !== CURRENT_ORDINARY_SOURCE_PLAN_SCHEMA
      || retained.purpose !== CURRENT_ORDINARY_SOURCE_PLAN_PURPOSE
      || retained.missionId !== state.missionId || retained.branch !== state.git?.branch
      || !/^[a-f0-9]{64}$/.test(retained.authorityPlanFingerprint || '')
      || (options.expectedSourcePlanFingerprint !== undefined
        && options.expectedSourcePlanFingerprint !== retained.authorityPlanFingerprint)) fail(observed.reason);
  try {
    await proveOrdinaryPlanRecorded(state, missionPaths(options.root || resolveMissionOrchestratorRoot(env), missionId));
  } catch (error) { fail(error.message); }
  const fresh = await observeCurrentOrdinarySourcePlan(missionId, options);
  if (fresh.state.revision !== state.revision || fresh.plan.contractFingerprint !== retained.contractFingerprint
      || fresh.plan.authorityPlanFingerprint !== retained.authorityPlanFingerprint
      || (options.runtimePolicyHead !== undefined && options.runtimePolicyHead !== fresh.plan.runtimePolicyHead)) {
    fail('CURRENT_SOURCE_PLAN_AUTHORITY_CHANGED');
  }
  const finalCohort = await readSeedSourceCanonicalGoalCohortV1(missionId, options);
  const final = await readMissionRecord(missionId, { root: options.root, env });
  if (final.state.revision !== state.revision || ordinaryContractFingerprint(final.state) !== fresh.plan.contractFingerprint
      || final.state.currentOrdinarySourcePlan?.authorityPlanFingerprint !== retained.authorityPlanFingerprint
      || final.state.storeMetadata?.pendingSourcePlanAuditEvent || !finalCohort.cohortComplete
      || finalCohort.cohortFingerprint !== fresh.observed.cohortFingerprint
      || storedSeedAssociation(final.state, finalCohort.canonicalGoal)
      || readOrdinaryRuntimePolicyHead(options.repoRoot || state.repositoryRoot, env) !== fresh.plan.runtimePolicyHead) {
    fail('CURRENT_SOURCE_PLAN_MISSION_CHANGED');
  }
  return Object.freeze({ classification: 'CURRENT_ORDINARY_SOURCE_PLAN_PROVEN',
    reason: 'CURRENT_ORDINARY_SOURCE_PLAN_REAFFIRMED', missionId, missionRevision: state.revision,
    sourceAuthority: true, dispatchAllowed: false, authorityPlanFingerprint: retained.authorityPlanFingerprint,
    sourcePlanKind: 'CURRENT_ORDINARY_SOURCE_PLAN',
    runtimePolicyHead: fresh.plan.runtimePolicyHead, observations: fresh.plan.observations });
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
    const current = await reconcilePendingMissionAudit(stored, paths, options);
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
  if (types.isProxy(event)) throw new Error('MISSION_EVENT_DATA_REQUIRED');
  // A source-contract correction needs its own fixed, private canonical
  // authenticator. No such producer is yet qualified; generic JSON, witnesses
  // or caller-selected callbacks cannot create this authority or any audit.
  if (PRIVATE_SOURCE_PLAN_EVENTS.has(text(event?.eventType).toUpperCase())) {
    throw new Error('SOURCE_CONTRACT_CORRECTION_AUTHENTICATOR_REQUIRED');
  }
  const root = options.root || resolveMissionOrchestratorRoot(options.env || process.env);
  if (!root) throw new Error('Mission orchestrator directory is not configured.');
  const paths = missionPaths(root, missionId);
  await mkdir(paths.root, { recursive: true });
  const lockHandle = await acquireLock(paths.lockPath);
  try {
    const stored = JSON.parse(await readFile(paths.statePath, 'utf8'));
    const current = await reconcilePendingMissionAudit(stored, paths, options);
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
    const knownPatchRetry = text(preparedEvent.eventType).toUpperCase() === 'AGENT_FAILURE_RETRY_ADMITTED'
      && ((current.missionId === KNOWN_MALFORMED_PATCH_REPAIR_V1.missionId
        && current.blockers?.includes(KNOWN_MALFORMED_PATCH_REPAIR_V1.blocker))
        || preparedEvent.retryKnownMalformedPatchProof !== undefined);
    if (knownPatchRetry) {
      // A JSON event cannot promote caller-provided source/terminal claims.
      // The server callback rechecks custody, owner plan and current source,
      // then preserves the original worktree while this mission lock is held.
      if (typeof options.authorizeKnownMalformedPatchRetry !== 'function') {
        throw new Error('KNOWN_MALFORMED_PATCH_RETRY_AUTHENTICATOR_REQUIRED');
      }
      const proof = await options.authorizeKnownMalformedPatchRetry(structuredClone(current), structuredClone(preparedEvent));
      if (!knownMalformedPatchEvidenceMatchesV1(proof, current, preparedEvent.retryPlanSourceHead)) {
        throw new Error('KNOWN_MALFORMED_PATCH_RETRY_AUTHENTICATION_FAILED');
      }
      preparedEvent.retryKnownMalformedPatchProof = proof;
    }
    if (preparedEvent.eventType === 'OPERATOR_APPROVAL_RECORDED') {
      preparedEvent.approvalTokenHash = sha256(preparedEvent.approvalToken);
    }
    const commit = async () => {
      if (text(preparedEvent.eventType).toUpperCase() === 'EXTERNAL_PULL_REQUEST_MERGE_OBSERVED') {
        // JSON events from generic clients cannot manufacture observation trust.
        if (typeof options.authorizeExternalMergeObservation !== 'function') {
          throw new Error('EXTERNAL_MERGE_OBSERVER_REQUIRED');
        }
        await options.authorizeExternalMergeObservation(current);
      }
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
