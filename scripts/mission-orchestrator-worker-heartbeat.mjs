import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const MISSION_WORKER_HEARTBEAT_SCHEMA = 'stephanos.mission-orchestrator-worker-heartbeat.v1';
export const MISSION_WORKER_TASK_NAME = 'Stephanos Mission Orchestrator Worker';
export const MISSION_WORKER_HEARTBEAT_FILE = 'mission-orchestrator-worker-heartbeat.json';
export const DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS = 120_000;
const SHA_40 = /^[0-9a-f]{40}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const AFFIRMATIVE_WORKER_TICK_VERDICTS = new Set([
  'MISSION_WORKER_RUNNING',
  'MISSION_WORKER_TICK_RUNNING',
  'MISSION_WORKER_TICK_PASS',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
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
  taskName = MISSION_WORKER_TASK_NAME,
  lastTickVerdict = 'MISSION_WORKER_RUNNING',
} = {}) {
  const resolvedRepositoryRoot = path.resolve(text(repositoryRoot));
  const normalizedBranch = text(branch).toLowerCase();
  const normalizedHead = text(headSha).toLowerCase();
  const normalizedTaskName = text(taskName);
  const normalizedPid = Number.parseInt(pid, 10);
  if (!Number.isFinite(Date.parse(timestampUtc))) throw new Error('Mission worker heartbeat timestamp is invalid.');
  if (!resolvedRepositoryRoot) throw new Error('Mission worker heartbeat repository root is required.');
  if (normalizedBranch !== 'main') throw new Error('Mission worker heartbeat requires branch main.');
  if (!SHA_40.test(normalizedHead)) throw new Error('Mission worker heartbeat requires a 40-character Git head.');
  if (normalizedTaskName !== MISSION_WORKER_TASK_NAME) throw new Error('Mission worker heartbeat task identity is not allowlisted.');
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) throw new Error('Mission worker heartbeat pid is invalid.');
  return Object.freeze({
    schemaVersion: MISSION_WORKER_HEARTBEAT_SCHEMA,
    timestampUtc,
    repositoryRoot: resolvedRepositoryRoot,
    branch: normalizedBranch,
    headSha: normalizedHead,
    taskName: normalizedTaskName,
    pid: normalizedPid,
    lastTickVerdict: text(lastTickVerdict, 'MISSION_WORKER_RUNNING'),
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
  const observationTimestamp = text(nowUtc);
  const heartbeatMs = EXPLICIT_TIMEZONE.test(heartbeatTimestamp) ? Date.parse(heartbeatTimestamp) : Number.NaN;
  const nowMs = EXPLICIT_TIMEZONE.test(observationTimestamp) ? Date.parse(observationTimestamp) : Number.NaN;
  const boundedMaxAgeMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? maxAgeMs
    : DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS;
  const normalizedExpectedRepositoryRoot = text(expectedRepositoryRoot);
  const normalizedExpectedHead = text(expectedHeadSha).toLowerCase();
  if (!record || typeof record !== 'object' || Array.isArray(record)) errors.push('invalid-record');
  if (record?.schemaVersion !== MISSION_WORKER_HEARTBEAT_SCHEMA) errors.push('invalid-worker-heartbeat-schema');
  if (!Number.isFinite(heartbeatMs)) errors.push('invalid-worker-heartbeat-time');
  if (!Number.isFinite(nowMs)) errors.push('invalid-observation-time');
  if (text(record?.branch).toLowerCase() !== 'main') errors.push('worker-branch-not-main');
  if (!SHA_40.test(text(record?.headSha))) errors.push('invalid-worker-head');
  if (!normalizedExpectedRepositoryRoot) errors.push('expected-worker-repository-missing');
  else if (path.resolve(text(record?.repositoryRoot)) !== path.resolve(normalizedExpectedRepositoryRoot)) {
    errors.push('worker-repository-mismatch');
  }
  if (!SHA_40.test(normalizedExpectedHead)) errors.push('expected-worker-head-invalid');
  else if (text(record?.headSha).toLowerCase() !== normalizedExpectedHead) errors.push('worker-head-mismatch');
  if (text(record?.taskName) !== MISSION_WORKER_TASK_NAME) errors.push('worker-task-not-allowlisted');
  if (!Number.isInteger(record?.pid) || record.pid <= 0) errors.push('invalid-worker-pid');
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
  lastTickVerdict,
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
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc,
    repositoryRoot,
    branch,
    headSha,
    taskName,
    pid,
    lastTickVerdict,
  });
  await mkdir(path.dirname(paths.heartbeatPath), { recursive: true });
  const temporaryPath = `${paths.heartbeatPath}.${pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporaryPath, paths.heartbeatPath);
  return Object.freeze({ ok: true, heartbeatPath: paths.heartbeatPath, record });
}
