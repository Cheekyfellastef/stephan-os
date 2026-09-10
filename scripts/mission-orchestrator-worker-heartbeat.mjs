import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { readMissionWorkerActiveClaim } from './mission-orchestrator-worker-heartbeat-active-claim.mjs';

export const MISSION_WORKER_HEARTBEAT_SCHEMA = 'stephanos.mission-orchestrator-worker-heartbeat.v1';
export const MISSION_WORKER_LAUNCH_IDENTITY_SCHEMA = 'stephanos.mission-worker-launch-identity.v1';
export const MISSION_WORKER_TASK_NAME = 'Stephanos Mission Orchestrator Worker';
export const MISSION_WORKER_HEARTBEAT_FILE = 'mission-orchestrator-worker-heartbeat.json';
export const DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS = 120_000;
export const MAX_MISSION_WORKER_LAUNCH_IDENTITY_BYTES = 8_192;
export const MISSION_WORKER_LAUNCH_RECEIPT_RETRY_ATTEMPTS = 40;
export const MISSION_WORKER_LAUNCH_RECEIPT_RETRY_DELAY_MS = 50;
const SHA_40 = /^[0-9a-f]{40}$/i;
const ID_64 = /^[0-9a-f]{64}$/i;
const ACTIVE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const ACTIVE_PHASE = /^[a-z0-9][a-z0-9._:/ -]{0,159}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const CANONICAL_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const LAUNCH_IDENTITY_KEYS = Object.freeze([
  'schemaVersion',
  'launchIdentityId',
  'launchKind',
  'restartInvocationId',
  'taskName',
  'repositoryRoot',
  'branch',
  'headSha',
  'workerPid',
  'workerStartedAtUtc',
  'canonicalNode',
  'canonicalWorkerScript',
  'createdAtUtc',
]);
const AFFIRMATIVE_WORKER_TICK_VERDICTS = new Set([
  'MISSION_WORKER_RUNNING',
  'MISSION_WORKER_TICK_RUNNING',
  'MISSION_WORKER_TICK_PASS',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeActiveClaim(activeClaim) {
  if (!activeClaim || typeof activeClaim !== 'object' || Array.isArray(activeClaim)) return null;
  const activeTaskId = text(activeClaim.activeTaskId);
  const activeReceiptId = text(activeClaim.activeReceiptId);
  const executionPhase = text(activeClaim.executionPhase);
  if (!ACTIVE_ID.test(activeTaskId) || !ACTIVE_ID.test(activeReceiptId) || !ACTIVE_PHASE.test(executionPhase)) return null;
  return Object.freeze({ activeTaskId, activeReceiptId, executionPhase });
}

export function resolveCanonicalMissionWorkerPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repositoryRoot: path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os'),
    workspaceRoot,
    heartbeatPath: path.resolve(workspaceRoot, 'status', MISSION_WORKER_HEARTBEAT_FILE),
  });
}

export function createMissionWorkerHeartbeatRecord({
  timestampUtc = new Date().toISOString(),
  repositoryRoot,
  branch,
  headSha,
  pid = process.pid,
  launchIdentityId,
  workerStartedAtUtc,
  taskName = MISSION_WORKER_TASK_NAME,
  lastTickVerdict = 'MISSION_WORKER_RUNNING',
  activeClaim = null,
} = {}) {
  const resolvedRepositoryRoot = path.resolve(text(repositoryRoot));
  const normalizedBranch = text(branch).toLowerCase();
  const normalizedHead = text(headSha).toLowerCase();
  const normalizedTaskName = text(taskName);
  const normalizedPid = Number.parseInt(pid, 10);
  const normalizedLaunchIdentityId = text(launchIdentityId).toLowerCase();
  const normalizedWorkerStartedAtUtc = text(workerStartedAtUtc);
  const requestedTickVerdict = text(lastTickVerdict, 'MISSION_WORKER_RUNNING');
  const activeExecution = requestedTickVerdict === 'MISSION_WORKER_TICK_RUNNING'
    ? normalizeActiveClaim(activeClaim)
    : null;
  const effectiveTickVerdict = requestedTickVerdict === 'MISSION_WORKER_TICK_RUNNING' && !activeExecution
    ? 'MISSION_WORKER_TICK_PASS'
    : requestedTickVerdict;
  const timestampMs = EXPLICIT_TIMEZONE.test(text(timestampUtc)) ? Date.parse(timestampUtc) : Number.NaN;
  const workerStartedAtMs = EXPLICIT_TIMEZONE.test(normalizedWorkerStartedAtUtc)
    ? Date.parse(normalizedWorkerStartedAtUtc)
    : Number.NaN;
  if (!Number.isFinite(timestampMs)) throw new Error('Mission worker heartbeat timestamp is invalid.');
  if (!resolvedRepositoryRoot) throw new Error('Mission worker heartbeat repository root is required.');
  if (normalizedBranch !== 'main') throw new Error('Mission worker heartbeat requires branch main.');
  if (!SHA_40.test(normalizedHead)) throw new Error('Mission worker heartbeat requires a 40-character Git head.');
  if (normalizedTaskName !== MISSION_WORKER_TASK_NAME) throw new Error('Mission worker heartbeat task identity is not allowlisted.');
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) throw new Error('Mission worker heartbeat pid is invalid.');
  if (!ID_64.test(normalizedLaunchIdentityId)) throw new Error('Mission worker heartbeat launch identity is invalid.');
  if (!Number.isFinite(workerStartedAtMs) || workerStartedAtMs >= timestampMs) {
    throw new Error('Mission worker heartbeat process-start identity is invalid.');
  }
  return Object.freeze({
    schemaVersion: MISSION_WORKER_HEARTBEAT_SCHEMA,
    timestampUtc,
    repositoryRoot: resolvedRepositoryRoot,
    branch: normalizedBranch,
    headSha: normalizedHead,
    taskName: normalizedTaskName,
    pid: normalizedPid,
    launchIdentityId: normalizedLaunchIdentityId,
    workerStartedAtUtc: normalizedWorkerStartedAtUtc,
    lastTickVerdict: effectiveTickVerdict,
    ...(activeExecution || {}),
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
  });
}

export function projectMissionWorkerHeartbeat(record = {}, {
  nowUtc = new Date().toISOString(),
  maxAgeMs = DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
  expectedRepositoryRoot,
  expectedHeadSha,
} = {}) {
  const errors = [];
  const heartbeatTimestamp = text(record?.timestampUtc);
  const workerStartedAtTimestamp = text(record?.workerStartedAtUtc);
  const observationTimestamp = text(nowUtc);
  const heartbeatMs = EXPLICIT_TIMEZONE.test(heartbeatTimestamp) ? Date.parse(heartbeatTimestamp) : Number.NaN;
  const workerStartedAtMs = EXPLICIT_TIMEZONE.test(workerStartedAtTimestamp)
    ? Date.parse(workerStartedAtTimestamp)
    : Number.NaN;
  const nowMs = EXPLICIT_TIMEZONE.test(observationTimestamp) ? Date.parse(observationTimestamp) : Number.NaN;
  const boundedMaxAgeMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? maxAgeMs
    : DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS;
  const recordRepositoryRoot = text(record?.repositoryRoot);
  const recordRepositoryRootIsAbsolute = Boolean(
    recordRepositoryRoot
    && (
      path.isAbsolute(recordRepositoryRoot)
      || /^[a-z]:[\\/]/i.test(recordRepositoryRoot)
      || /^\\\\/.test(recordRepositoryRoot)
    )
  );
  const normalizedExpectedRepositoryRoot = text(expectedRepositoryRoot);
  const normalizedExpectedHead = text(expectedHeadSha).toLowerCase();
  if (!record || typeof record !== 'object' || Array.isArray(record)) errors.push('invalid-record');
  if (record?.schemaVersion !== MISSION_WORKER_HEARTBEAT_SCHEMA) errors.push('invalid-worker-heartbeat-schema');
  if (!Number.isFinite(heartbeatMs)) errors.push('invalid-worker-heartbeat-time');
  if (!Number.isFinite(nowMs)) errors.push('invalid-observation-time');
  if (text(record?.branch).toLowerCase() !== 'main') errors.push('worker-branch-not-main');
  if (!SHA_40.test(text(record?.headSha))) errors.push('invalid-worker-head');
  if (!normalizedExpectedRepositoryRoot) errors.push('expected-worker-repository-missing');
  if (!recordRepositoryRoot) errors.push('worker-repository-missing');
  else if (!recordRepositoryRootIsAbsolute) errors.push('worker-repository-not-absolute');
  else if (normalizedExpectedRepositoryRoot && path.resolve(recordRepositoryRoot) !== path.resolve(normalizedExpectedRepositoryRoot)) {
    errors.push('worker-repository-mismatch');
  }
  if (!SHA_40.test(normalizedExpectedHead)) errors.push('expected-worker-head-invalid');
  else if (text(record?.headSha).toLowerCase() !== normalizedExpectedHead) errors.push('worker-head-mismatch');
  if (text(record?.taskName) !== MISSION_WORKER_TASK_NAME) errors.push('worker-task-not-allowlisted');
  if (!Number.isInteger(record?.pid) || record.pid <= 0) errors.push('invalid-worker-pid');
  if (!ID_64.test(text(record?.launchIdentityId))) errors.push('invalid-worker-launch-identity');
  if (!Number.isFinite(workerStartedAtMs)) errors.push('invalid-worker-process-start-identity');
  else if (Number.isFinite(heartbeatMs) && workerStartedAtMs >= heartbeatMs) {
    errors.push('worker-heartbeat-not-after-process-start');
  }
  if (!AFFIRMATIVE_WORKER_TICK_VERDICTS.has(text(record?.lastTickVerdict))) {
    errors.push('worker-last-tick-not-affirmative');
  }
  if (record?.sourceMutationAllowed !== false) errors.push('worker-source-mutation-forbidden');
  if (record?.arbitraryShellAllowed !== false) errors.push('worker-arbitrary-shell-forbidden');
  if (Number.isFinite(heartbeatMs) && Number.isFinite(nowMs) && heartbeatMs - nowMs > 60_000) errors.push('future-worker-heartbeat');
  const ageMs = Number.isFinite(heartbeatMs) && Number.isFinite(nowMs)
    ? Math.max(0, nowMs - heartbeatMs)
    : null;
  const valid = errors.length === 0;
  const fresh = valid && ageMs <= boundedMaxAgeMs;
  return Object.freeze({
    valid,
    fresh,
    stale: valid && !fresh,
    ageMs,
    timestampUtc: Number.isFinite(heartbeatMs) ? new Date(heartbeatMs).toISOString() : null,
    repositoryRoot: text(record?.repositoryRoot),
    expectedRepositoryRoot: normalizedExpectedRepositoryRoot || null,
    branch: text(record?.branch).toLowerCase(),
    headSha: text(record?.headSha).toLowerCase(),
    expectedHeadSha: SHA_40.test(normalizedExpectedHead) ? normalizedExpectedHead : null,
    taskName: text(record?.taskName),
    pid: Number.isInteger(record?.pid) ? record.pid : null,
    launchIdentityId: ID_64.test(text(record?.launchIdentityId))
      ? text(record?.launchIdentityId).toLowerCase()
      : null,
    workerStartedAtUtc: Number.isFinite(workerStartedAtMs)
      ? new Date(workerStartedAtMs).toISOString()
      : null,
    lastTickVerdict: text(record?.lastTickVerdict),
    errors: Object.freeze([...new Set(errors)]),
    authority: 'mission-worker-only',
    controllerHeartbeatAuthority: false,
    finalVerdict: !valid
      ? 'MISSION_WORKER_HEARTBEAT_BLOCKED'
      : fresh
        ? 'MISSION_WORKER_HEARTBEAT_FRESH'
        : 'MISSION_WORKER_HEARTBEAT_STALE',
  });
}

function exactOwnKeyEstate(record, expectedKeys) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const keys = Object.keys(record);
  return keys.length === expectedKeys.length && expectedKeys.every((key, index) => keys[index] === key);
}

export async function readMissionWorkerLaunchIdentityReceipt({
  launchIdentityId,
  launchReceiptPath,
  expectedPaths,
  repositoryRoot,
  branch,
  headSha,
  taskName = MISSION_WORKER_TASK_NAME,
  pid = process.pid,
  expectedCanonicalNode = CANONICAL_NODE,
  expectedWorkerScript = path.resolve(expectedPaths?.repositoryRoot || repositoryRoot, 'scripts', 'mission-orchestrator-worker-supervised.mjs'),
  readFileFn = readFile,
  lstatFn = lstat,
} = {}) {
  const normalizedLaunchIdentityId = text(launchIdentityId).toLowerCase();
  if (!ID_64.test(normalizedLaunchIdentityId)) {
    throw new Error('Mission worker launch identity is invalid.');
  }
  const statusRoot = path.resolve(expectedPaths.workspaceRoot, 'status');
  const canonicalReceiptPath = path.resolve(
    statusRoot,
    `mission-orchestrator-worker-launch-identity-${normalizedLaunchIdentityId}.json`,
  );
  if (path.resolve(text(launchReceiptPath)) !== canonicalReceiptPath) {
    throw new Error('Mission worker launch identity receipt path is not canonical.');
  }
  const receiptStat = await lstatFn(canonicalReceiptPath);
  if (!receiptStat?.isFile?.() || receiptStat.isSymbolicLink?.() || receiptStat.size <= 0
      || receiptStat.size > MAX_MISSION_WORKER_LAUNCH_IDENTITY_BYTES) {
    throw new Error('Mission worker launch identity receipt file is invalid.');
  }
  const raw = await readFileFn(canonicalReceiptPath);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length <= 0 || bytes.length > MAX_MISSION_WORKER_LAUNCH_IDENTITY_BYTES) {
    throw new Error('Mission worker launch identity receipt exceeds the fixed bound.');
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Mission worker launch identity receipt is malformed.');
  }
  if (!exactOwnKeyEstate(receipt, LAUNCH_IDENTITY_KEYS)) {
    throw new Error('Mission worker launch identity receipt key estate is invalid.');
  }
  const normalizedPid = Number.parseInt(pid, 10);
  const workerStartedAtMs = EXPLICIT_TIMEZONE.test(text(receipt.workerStartedAtUtc))
    ? Date.parse(receipt.workerStartedAtUtc)
    : Number.NaN;
  const createdAtMs = EXPLICIT_TIMEZONE.test(text(receipt.createdAtUtc))
    ? Date.parse(receipt.createdAtUtc)
    : Number.NaN;
  const normalizedRestartInvocationId = text(receipt.restartInvocationId).toLowerCase();
  if (receipt.schemaVersion !== MISSION_WORKER_LAUNCH_IDENTITY_SCHEMA
      || text(receipt.launchIdentityId).toLowerCase() !== normalizedLaunchIdentityId
      || !['ordinary', 'guarded-restart'].includes(receipt.launchKind)
      || (receipt.launchKind === 'guarded-restart' && normalizedRestartInvocationId !== normalizedLaunchIdentityId)
      || (receipt.launchKind === 'ordinary' && normalizedRestartInvocationId !== '')
      || text(receipt.taskName) !== taskName
      || path.resolve(text(receipt.repositoryRoot)) !== path.resolve(repositoryRoot)
      || text(receipt.branch).toLowerCase() !== text(branch).toLowerCase()
      || text(receipt.headSha).toLowerCase() !== text(headSha).toLowerCase()
      || Number.parseInt(receipt.workerPid, 10) !== normalizedPid
      || !Number.isFinite(workerStartedAtMs)
      || !Number.isFinite(createdAtMs)
      || createdAtMs < workerStartedAtMs
      || !path.win32.isAbsolute(text(receipt.canonicalNode))
      || text(receipt.canonicalNode).toLowerCase() !== text(expectedCanonicalNode).toLowerCase()
      || path.resolve(text(receipt.canonicalWorkerScript)) !== path.resolve(expectedWorkerScript)) {
    throw new Error('Mission worker launch identity receipt does not match the canonical worker.');
  }
  return Object.freeze({
    launchIdentityId: normalizedLaunchIdentityId,
    workerStartedAtUtc: text(receipt.workerStartedAtUtc),
    receipt: Object.freeze({ ...receipt }),
  });
}

async function readMissionWorkerLaunchIdentityReceiptAfterCreateRace(input, sleepFn) {
  for (let attempt = 0; attempt < MISSION_WORKER_LAUNCH_RECEIPT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await readMissionWorkerLaunchIdentityReceipt(input);
    } catch (error) {
      const receiptNotCreatedYet = error?.code === 'ENOENT';
      if (!receiptNotCreatedYet || attempt + 1 >= MISSION_WORKER_LAUNCH_RECEIPT_RETRY_ATTEMPTS) throw error;
      await sleepFn(MISSION_WORKER_LAUNCH_RECEIPT_RETRY_DELAY_MS);
    }
  }
  throw new Error('Mission worker launch identity receipt retry bound exhausted.');
}

export async function writeMissionWorkerHeartbeat({
  env = process.env,
  paths = resolveCanonicalMissionWorkerPaths({ env }),
  expectedPaths = resolveCanonicalMissionWorkerPaths({ env }),
  timestampUtc,
  repositoryRoot = env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT,
  branch = env.STEPHANOS_MISSION_WORKER_BRANCH,
  headSha = env.STEPHANOS_MISSION_WORKER_HEAD_SHA,
  taskName = env.STEPHANOS_MISSION_WORKER_TASK_NAME || MISSION_WORKER_TASK_NAME,
  pid = process.pid,
  launchIdentityId = env.STEPHANOS_MISSION_WORKER_LAUNCH_ID,
  launchReceiptPath = env.STEPHANOS_MISSION_WORKER_LAUNCH_RECEIPT_PATH,
  lastTickVerdict,
  activeActionGrant,
  activeClaimReader = readMissionWorkerActiveClaim,
  readFileFn,
  lstatFn,
  sleepFn = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
} = {}) {
  if (path.resolve(paths.repositoryRoot) !== path.resolve(expectedPaths.repositoryRoot)) {
    throw new Error('Mission worker heartbeat repository path is not canonical.');
  }
  if (path.resolve(paths.heartbeatPath) !== path.resolve(expectedPaths.heartbeatPath)) {
    throw new Error('Mission worker heartbeat output path is not canonical.');
  }
  if (path.resolve(repositoryRoot) !== path.resolve(expectedPaths.repositoryRoot)) {
    throw new Error('Mission worker heartbeat source repository is not canonical.');
  }
  const launchIdentity = await readMissionWorkerLaunchIdentityReceiptAfterCreateRace({
    launchIdentityId,
    launchReceiptPath,
    expectedPaths,
    repositoryRoot,
    branch,
    headSha,
    taskName,
    pid,
    readFileFn,
    lstatFn,
  }, sleepFn);
  let activeClaim = null;
  if (activeActionGrant) {
    try {
      activeClaim = await activeClaimReader({ env, actionGrant: activeActionGrant });
    } catch {
      activeClaim = null;
    }
  }
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc,
    repositoryRoot,
    branch,
    headSha,
    taskName,
    pid,
    launchIdentityId: launchIdentity.launchIdentityId,
    workerStartedAtUtc: launchIdentity.workerStartedAtUtc,
    lastTickVerdict,
    activeClaim,
  });
  await mkdir(path.dirname(paths.heartbeatPath), { recursive: true });
  const temporaryPath = `${paths.heartbeatPath}.${pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, paths.heartbeatPath);
  } catch (error) {
    try { await unlink(temporaryPath); } catch {}
    throw error;
  }
  return Object.freeze({ ok: true, heartbeatPath: paths.heartbeatPath, record });
}
