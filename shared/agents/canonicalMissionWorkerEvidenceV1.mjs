import { spawnSync } from 'node:child_process';
import { openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { projectMissionWorkerHeartbeat, readMissionWorkerLaunchIdentityReceipt, resolveCanonicalMissionWorkerPaths } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { resolveGoalDiscoveryWorkspaceV1 } from './goalDiscoveryWorkspaceV1.mjs';
import { resolveBattleBridgeGitExecutable, battleBridgeCanonicalRepositoryArgs,
  battleBridgeGitFixedConfigArgs, createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export function canonicalMissionWorkerEvidenceAllowsWork(age) {
  return typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 120_000;
}

export function readCanonicalMissionWorkerSourceIdentity({ env = process.env, spawnSyncFn = spawnSync, remainingMs } = {}) {
  const root = resolveCanonicalMissionWorkerPaths({ env }).repositoryRoot;
  const git = args => {
    const budget = typeof remainingMs === 'function' ? remainingMs() : 5_000;
    const timeout = Math.min(5_000, Math.floor(budget));
    if (!Number.isFinite(budget) || !Number.isFinite(timeout) || timeout <= 0) throw new Error('WORKER_SOURCE_IDENTITY_UNPROVEN');
    const result = spawnSyncFn(resolveBattleBridgeGitExecutable(), [
      ...battleBridgeGitFixedConfigArgs(), ...battleBridgeCanonicalRepositoryArgs(root), ...args,
    ], { cwd: root, env: createBattleBridgeMinimalChildEnvironment(env, { git: true }),
      encoding: 'utf8', shell: false, windowsHide: true, timeout, maxBuffer: 4096 });
    if (typeof remainingMs === 'function' && remainingMs() <= 0) throw new Error('WORKER_SOURCE_IDENTITY_UNPROVEN');
    if (result.error || result.status !== 0 || result.signal) throw new Error('WORKER_SOURCE_IDENTITY_UNPROVEN');
    return String(result.stdout || '').trim();
  };
  const sourceHead = git(['rev-parse', '--verify', 'HEAD']);
  const branch = git(['symbolic-ref', '--short', 'HEAD']);
  return Object.freeze({ ok: /^[a-f0-9]{40}$/.test(sourceHead) && branch === 'main', sourceHead, branch });
}

function readCanonicalMissionWorkerSnapshot({
  env = process.env, nowMs, workspaceRoot = resolveGoalDiscoveryWorkspaceV1({ env }), expectedSourceHead,
  remainingMs,
  readSourceIdentity = () => readCanonicalMissionWorkerSourceIdentity({ env, remainingMs }),
} = {}) {
  let fd;
  try {
    if (typeof remainingMs === 'function' && remainingMs() <= 0) return null;
    const paths = resolveCanonicalMissionWorkerPaths({ env });
    // Windows publishers/witnesses are still fixed to this tree. A configured
    // refill root cannot inherit their evidence until that whole estate moves.
    if (relative(paths.workspaceRoot, resolve(workspaceRoot)) !== '') return null;
    const before = lstatSync(paths.heartbeatPath);
    if (!before.isFile() || before.isSymbolicLink()) return null;
    fd = openSync(paths.heartbeatPath, 'r');
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= 0 || info.size > 16_384
        || info.dev !== before.dev || info.ino !== before.ino) return null;
    const buffer = Buffer.alloc(16_385);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    if (count <= 0 || count > 16_384) return null;
    const bytes = buffer.subarray(0, count).toString('utf8');
    if (typeof remainingMs === 'function' && remainingMs() <= 0) return null;
    const source = readSourceIdentity();
    if (source?.ok !== true || source.branch !== 'main'
        || (expectedSourceHead !== undefined && source.sourceHead !== expectedSourceHead)) return null;
    // Source identity invokes bounded synchronous Git calls. Production time
    // must be sampled after those calls, not captured at reader entry.
    // Explicit nowMs remains a deterministic projection seam for fixtures.
    const admissionNowMs = nowMs === undefined ? Date.now() : nowMs;
    const record = JSON.parse(bytes);
    const projection = projectMissionWorkerHeartbeat(record, {
      nowUtc: new Date(admissionNowMs).toISOString(), expectedRepositoryRoot: paths.repositoryRoot,
      expectedHeadSha: source.sourceHead,
    });
    return projection.valid && projection.fresh
      && Date.parse(projection.timestampUtc) <= admissionNowMs
      ? { projection, record, paths } : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function readCanonicalMissionWorkerHeartbeatAgeMs(options = {}) {
  const snapshot = readCanonicalMissionWorkerSnapshot(options);
  return snapshot?.projection.lastTickOperational === true ? snapshot.projection.ageMs : null;
}

function capacityObservationEligible(snapshot) {
  if (!snapshot?.projection.lastTickRecognized) return false;
  if (snapshot.projection.lastTickOperational) return true;
  // This is the worker's exact report, not proof that no persisted/native
  // execution exists. The current publisher omits execution metadata here.
  // Missing metadata stays UNREPORTED; it must never become positive IDLE.
  return snapshot.projection.lastTickVerdict === 'CONTROLLER_EXECUTION_DEFECT_NO_WORKER_GRANT'
    && ['activeTaskId', 'activeReceiptId', 'executionPhase'].every(key =>
      !Object.hasOwn(snapshot.record, key)
      || (typeof snapshot.record[key] === 'string' && snapshot.record[key] === ''));
}

export async function readCanonicalMissionWorkerCapacityObservationEvidenceV1(options = {}) {
  const before = readCanonicalMissionWorkerSnapshot(options);
  if (!capacityObservationEligible(before)) return null;
  const { projection, record, paths } = before;
  try {
    if (typeof options.remainingMs === 'function' && options.remainingMs() <= 0) return null;
    const launch = await readMissionWorkerLaunchIdentityReceipt({
      launchIdentityId: projection.launchIdentityId,
      launchReceiptPath: resolve(paths.workspaceRoot, 'status',
        `mission-orchestrator-worker-launch-identity-${projection.launchIdentityId}.json`),
      expectedPaths: paths, repositoryRoot: paths.repositoryRoot, branch: 'main',
      headSha: projection.headSha, pid: projection.pid,
    });
    if (typeof options.remainingMs === 'function' && options.remainingMs() <= 0) return null;
    if (launch.workerStartedAtUtc !== record.workerStartedAtUtc
      || Date.parse(launch.receipt.createdAtUtc) > Date.parse(record.timestampUtc)) return null;
    // An awaited launch read cannot carry an old worker/source identity forward.
    const after = readCanonicalMissionWorkerSnapshot(options);
    if (!capacityObservationEligible(after)) return null;
    const identityKeys = ['pid', 'launchIdentityId', 'workerStartedAtUtc', 'headSha', 'repositoryRoot', 'branch', 'taskName'];
    if (identityKeys.some(key => record[key] !== after.record[key])) return null;
    return Object.freeze({
      capacityObservationAllowed: true, sourceHead: after.projection.headSha,
      pid: after.projection.pid, launchIdentityId: after.projection.launchIdentityId,
      workerStartedAtUtc: after.record.workerStartedAtUtc,
      ageMs: after.projection.ageMs, observationOnly: true, workAuthorized: false,
      reportedTickVerdict: after.projection.lastTickVerdict,
      executionMetadataState: ['activeTaskId', 'activeReceiptId', 'executionPhase']
        .some(key => !Object.hasOwn(after.record, key)) ? 'UNREPORTED' : 'REPORTED',
      idleProven: false, physicalExclusionGranted: false,
    });
  } catch { return null; }
}

// Sample at the mutation boundary, never carry an earlier readiness boolean
// across an awaited network, queue, handoff or capacity operation.
export function assertCanonicalMissionWorkerCustody(options = {}) {
  const read = options.readWorkerHeartbeatAgeMs || readCanonicalMissionWorkerHeartbeatAgeMs;
  let age;
  try { age = read({ env: options.env, workspaceRoot: options.workerWorkspaceRoot }); }
  catch { throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN'); }
  if (!canonicalMissionWorkerEvidenceAllowsWork(age)) throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN');
}
