import { spawnSync } from 'node:child_process';
import { openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { projectMissionWorkerHeartbeat, resolveCanonicalMissionWorkerPaths } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { resolveGoalDiscoveryWorkspaceV1 } from './goalDiscoveryWorkspaceV1.mjs';
import { resolveBattleBridgeGitExecutable, battleBridgeCanonicalRepositoryArgs,
  battleBridgeGitFixedConfigArgs, createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export function canonicalMissionWorkerEvidenceAllowsWork(age) {
  return typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 120_000;
}

export function readCanonicalMissionWorkerSourceIdentity({ env = process.env, spawnSyncFn = spawnSync } = {}) {
  const root = resolveCanonicalMissionWorkerPaths({ env }).repositoryRoot;
  const git = args => {
    const result = spawnSyncFn(resolveBattleBridgeGitExecutable(), [
      ...battleBridgeGitFixedConfigArgs(), ...battleBridgeCanonicalRepositoryArgs(root), ...args,
    ], { cwd: root, env: createBattleBridgeMinimalChildEnvironment(env, { git: true }),
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 5_000, maxBuffer: 4096 });
    if (result.error || result.status !== 0 || result.signal) throw new Error('WORKER_SOURCE_IDENTITY_UNPROVEN');
    return String(result.stdout || '').trim();
  };
  const sourceHead = git(['rev-parse', '--verify', 'HEAD']);
  const branch = git(['symbolic-ref', '--short', 'HEAD']);
  return Object.freeze({ ok: /^[a-f0-9]{40}$/.test(sourceHead) && branch === 'main', sourceHead, branch });
}

export function readCanonicalMissionWorkerHeartbeatAgeMs({
  env = process.env, nowMs, workspaceRoot = resolveGoalDiscoveryWorkspaceV1({ env }), expectedSourceHead,
  readSourceIdentity = () => readCanonicalMissionWorkerSourceIdentity({ env }),
} = {}) {
  let fd;
  try {
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
    const source = readSourceIdentity();
    if (source?.ok !== true || source.branch !== 'main'
        || (expectedSourceHead !== undefined && source.sourceHead !== expectedSourceHead)) return null;
    // Source identity invokes bounded synchronous Git calls. Production time
    // must be sampled after those calls, not captured at reader entry.
    // Explicit nowMs remains a deterministic projection seam for fixtures.
    const admissionNowMs = nowMs === undefined ? Date.now() : nowMs;
    const projection = projectMissionWorkerHeartbeat(JSON.parse(bytes), {
      nowUtc: new Date(admissionNowMs).toISOString(), expectedRepositoryRoot: paths.repositoryRoot,
      expectedHeadSha: source.sourceHead,
    });
    return projection.valid && projection.fresh && projection.lastTickConsumptionReady
      && Date.parse(projection.timestampUtc) <= admissionNowMs ? projection.ageMs : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

// Sample at the mutation boundary, never carry an earlier readiness result
// across an awaited network, queue, handoff or capacity operation.
export function assertCanonicalMissionWorkerCustody(options = {}) {
  const read = options.readWorkerHeartbeatAgeMs || readCanonicalMissionWorkerHeartbeatAgeMs;
  let age;
  try { age = read({ env: options.env, workspaceRoot: options.workerWorkspaceRoot }); }
  catch { throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN'); }
  if (!canonicalMissionWorkerEvidenceAllowsWork(age)) throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN');
}
