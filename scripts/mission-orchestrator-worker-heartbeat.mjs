import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const MISSION_WORKER_HEARTBEAT_SCHEMA = 'stephanos.mission-orchestrator-worker-heartbeat.v1';
export const MISSION_WORKER_TASK_NAME = 'Stephanos Mission Orchestrator Worker';
export const MISSION_WORKER_HEARTBEAT_FILE = 'mission-orchestrator-worker-heartbeat.json';
const SHA_40 = /^[0-9a-f]{40}$/i;

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
