import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute, dirname } from 'node:path';
import { readMissionRecord, recordSupervisedOriginalSourceMaintenance } from './missionOrchestratorStore.js';
import { readSourceMutationLease, withOriginalSourceLeaseFenceGuard } from './programmeAuthorityService.js';
import { originalMissionHasQueuedWork } from './elasticPrHeadLeaseService.js';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import { projectMissionWorkerHeartbeat, resolveCanonicalMissionWorkerPaths } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { supervisedR7SnapshotTarget, prepareSupervisedR7RecoveryV1,
  inspectSupervisedR7ApprovalV1, SUPERVISED_R7_APPROVAL_PURPOSE } from './supervisedR7RecoveryPreparationV1.mjs';
import { resolveBattleBridgeGitExecutable } from '../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { readGithubOwnerApprovalComment } from './githubPrEvidenceService.js';

export const SUPERVISED_R7_FENCE_SCHEMA = 'stephanos.supervised-r7-retirement-fence.v1';
const MISSION = 'critical-2962-elastic-goal';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{7,95}$/;
const fail = code => { throw new Error(code); };
export const supervisedRecoveryDigest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bytesDigest = v => createHash('sha256').update(v).digest('hex');
const nowMs = options => (options.now || Date.now)();

function git(root, args) {
  return execFileSync(process.platform === 'win32' ? resolveBattleBridgeGitExecutable() : 'git',
    ['-c', 'core.fsmonitor=false', '-C', root, ...args],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
}
export function readSupervisedRecoverySourceHead(root) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) fail('SUPERVISED_R7_SOURCE_UNPROVEN');
  return head;
}
function request(input) {
  const keys = ['requestId', 'commandId', 'sourceRevision', 'originalLeaseDigest'];
  if (!input || Object.keys(input).some(k => !keys.includes(k))
      || !ID.test(input.requestId) || !ID.test(input.commandId)
      || !/^[a-f0-9]{40}$/.test(input.sourceRevision) || !HASH.test(input.originalLeaseDigest))
    fail('SUPERVISED_R7_REQUEST_INVALID');
  return { ...input };
}
function pathsOf(options) {
  const p = options.paths;
  if (!p?.workspaceRoot || !p.repoRoot || !p.orchestratorRoot)
    fail('SUPERVISED_R7_CANONICAL_PATHS_UNPROVEN');
  return p;
}
async function regularBytes(root, name, max = 16 * 1024 * 1024) {
  const path = resolve(root, name), rel = relative(resolve(root), path);
  if (rel.startsWith('..') || isAbsolute(rel)) fail('SUPERVISED_R7_PRESERVATION_ESCAPE');
  let parent = path;
  while (true) {
    const info = await lstat(parent);
    if (info.isSymbolicLink()) fail('SUPERVISED_R7_PRESERVATION_LINK');
    if (parent === resolve(root)) break;
    parent = dirname(parent);
  }
  const before = await lstat(path);
  if (!before.isFile() || before.size > max || before.nlink !== 1)
    fail('SUPERVISED_R7_PRESERVATION_FILE_INVALID');
  const bytes = await readFile(path), after = await lstat(path);
  if (before.ino !== after.ino || before.dev !== after.dev || before.size !== bytes.length
      || before.mtimeMs !== after.mtimeMs) fail('SUPERVISED_R7_PRESERVATION_CHANGED');
  return bytes;
}
async function durableCreate(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
function artifactRoot(paths, commandId) {
  if (!ID.test(commandId)) fail('SUPERVISED_R7_COMMAND_INVALID');
  return join(paths.workspaceRoot, 'source-artifacts', 'supervised-r7', commandId);
}

// Authenticates an actual immutable owner-authored GitHub decision. The public
// request supplies only its comment ID; it cannot supply approval booleans,
// principals, an endpoint, response data or an authenticator.
export async function readSupervisedR7OperatorApproval(commentId, expected, options = {}) {
  const comment = await readGithubOwnerApprovalComment(commentId, options);
  if (comment.issue_url !== `https://api.github.com/repos/${REPOSITORY}/issues/2961`)
    fail('SUPERVISED_R7_APPROVAL_NOT_OWNER_IMMUTABLE');
  const matches = [...String(comment.body).matchAll(/```stephanos-supervised-r7-approval\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) fail('SUPERVISED_R7_APPROVAL_SHAPE');
  const decision = JSON.parse(matches[0][1]);
  const keys = ['schemaVersion', ...Object.keys(expected), 'lowerAssuranceExplicitlyAccepted', 'expiresAtUtc'];
  if (Object.keys(decision).length !== keys.length || Object.keys(decision).some(k => !keys.includes(k))
      || decision.schemaVersion !== 'stephanos.supervised-r7-operator-approval.v1'
      || Object.entries(expected).some(([k, v]) => decision[k] !== v)
      || decision.lowerAssuranceExplicitlyAccepted !== true) fail('SUPERVISED_R7_APPROVAL_BINDING');
  const approved = Date.parse(comment.created_at), expires = Date.parse(decision.expiresAtUtc), now = nowMs(options);
  if (!Number.isFinite(approved) || !Number.isFinite(expires) || approved > now || expires <= now
      || expires - approved > 600000 || expires <= approved) fail('SUPERVISED_R7_APPROVAL_EXPIRED');
  return { ...expected, authenticated: true, consumed: false, lowerAssuranceExplicitlyAccepted: true,
    approvedAtUtc: new Date(approved).toISOString(), expiresAtUtc: new Date(expires).toISOString(),
    approvalEvidenceDigest: supervisedRecoveryDigest({ commentId, authorId: comment.user.id,
      createdAt: comment.created_at, body: comment.body }) };
}

async function targetSnapshot(input, options) {
  const paths = pathsOf(options), env = options.env || process.env;
  const sourceRevision = readSupervisedRecoverySourceHead(paths.repoRoot);
  const { state: mission } = await readMissionRecord(MISSION, { root: paths.orchestratorRoot, env });
  const leaseRead = await readSourceMutationLease({ root: paths.workspaceRoot, repoRoot: paths.repoRoot,
    nowUtc: new Date(nowMs(options)).toISOString() });
  return { sourceRevision, mission, leaseRead };
}
export async function describeSupervisedR7Maintenance(input, options = {}) {
  const normalized = request(input), snapshot = await targetSnapshot(normalized, options);
  const target = supervisedR7SnapshotTarget(snapshot, normalized);
  return { purpose: 'BEGIN_EXACT_R7_COOPERATIVE_MAINTENANCE', ...normalized, target,
    priorMaintenanceDigest: snapshot.mission.storeMetadata?.supervisedRecoveryMaintenance
      ? supervisedRecoveryDigest(snapshot.mission.storeMetadata.supervisedRecoveryMaintenance) : null,
    assurance: 'COOPERATIVE_WORKER_MAINTENANCE_ONLY',
    effect: 'Block this original attempt in existing claim, retry, commit and publication paths; preserve its files. No lease release or worker restart.' };
}

export async function beginSupervisedR7Maintenance(input, approvalCommentId, options = {}) {
  const packet = await describeSupervisedR7Maintenance(input, options);
  const expected = { purpose: packet.purpose, packetDigest: supervisedRecoveryDigest(packet),
    requestId: packet.requestId, commandId: packet.commandId,
    sourceRevision: packet.sourceRevision, originalLeaseDigest: packet.originalLeaseDigest };
  const paths = pathsOf(options);
  return recordSupervisedOriginalSourceMaintenance(async current => {
    return withOriginalSourceLeaseFenceGuard(async () => {
      const snapshot = await targetSnapshot(input, options);
      if (supervisedRecoveryDigest(snapshot.mission) !== supervisedRecoveryDigest(current)
          || supervisedRecoveryDigest(supervisedR7SnapshotTarget(snapshot, input)) !== supervisedRecoveryDigest(packet.target))
        fail('SUPERVISED_R7_TARGET_CHANGED');
      const prior = current.storeMetadata?.supervisedRecoveryMaintenance;
      if (prior && prior.commandId === packet.commandId && prior.requestId === packet.requestId
          && prior.approvalCommentId === approvalCommentId
          && supervisedRecoveryDigest(prior.target) === supervisedRecoveryDigest(packet.target)) return prior;
      const approval = await readSupervisedR7OperatorApproval(approvalCommentId, expected, options);
      const again = await targetSnapshot(input, options);
      supervisedR7SnapshotTarget(again, input);
      if (Date.parse(approval.expiresAtUtc) <= nowMs(options)) fail('SUPERVISED_R7_APPROVAL_EXPIRED');
      return { schemaVersion: 'stephanos.supervised-r7-maintenance.v1', target: packet.target,
        requestId: packet.requestId, commandId: packet.commandId, approvalCommentId,
        approvalEvidenceDigest: approval.approvalEvidenceDigest, approvalConsumed: true,
        startedAtUtc: new Date(nowMs(options)).toISOString(),
        historicalExecutionOutcome: 'UNKNOWN', hostileWriterExclusionProven: false,
        witnessCommissioned: false, leaseReleased: false };
    }, { root: paths.workspaceRoot, repoRoot: paths.repoRoot, env: options.env });
  }, { root: paths.orchestratorRoot, env: options.env });
}

async function quiescence(maintenance, options) {
  const paths = pathsOf(options), env = options.env || process.env;
  if (maintenance?.schemaVersion !== 'stephanos.supervised-r7-maintenance.v1'
      || maintenance.approvalConsumed !== true || !HASH.test(maintenance.approvalEvidenceDigest || ''))
    fail('SUPERVISED_R7_MAINTENANCE_NOT_RESERVED');
  if (await originalMissionHasQueuedWork({ missionId: MISSION, leaseId: maintenance.target.leaseId, env }) !== false)
    fail('SUPERVISED_R7_QUEUE_NOT_QUIESCENT');
  const workerPaths = resolveCanonicalMissionWorkerPaths({ env });
  if (resolve(workerPaths.repositoryRoot) !== resolve(paths.repoRoot)
      || resolve(workerPaths.workspaceRoot) !== resolve(paths.workspaceRoot))
    fail('SUPERVISED_R7_WORKER_ROOT_MISMATCH');
  const heartbeat = JSON.parse(await regularBytes(paths.workspaceRoot, 'status/mission-orchestrator-worker-heartbeat.json', 16384));
  const projection = projectMissionWorkerHeartbeat(heartbeat, {
    nowUtc: new Date(nowMs(options)).toISOString(), expectedRepositoryRoot: paths.repoRoot,
    expectedHeadSha: maintenance.target.sourceRevision });
  if (!projection.valid || !projection.fresh || !projection.lastTickAffirmative
      || Date.parse(heartbeat.timestampUtc) < Date.parse(maintenance.startedAtUtc)
      || Date.parse(heartbeat.timestampUtc) > nowMs(options)
      || heartbeat.activeTaskId || heartbeat.activeReceiptId
      || readSupervisedRecoverySourceHead(paths.repoRoot) !== maintenance.target.sourceRevision)
    fail('SUPERVISED_R7_COOPERATIVE_WORKER_NOT_IDLE');
  // This is evidence from the cooperative installed worker, not a Windows
  // census or a claim that a hostile privileged writer has been excluded.
}

async function treeFiles(root, prefix = '', result = []) {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const e of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    if (result.length >= 4096 || e.isSymbolicLink()) fail('SUPERVISED_R7_PRESERVATION_INVENTORY_UNSAFE');
    const name = join(prefix, e.name);
    if (!prefix && e.name === 'supervised-r7') continue;
    if (e.isDirectory()) await treeFiles(root, name, result);
    else if (e.isFile()) result.push(name);
    else fail('SUPERVISED_R7_PRESERVATION_INVENTORY_UNSAFE');
  }
  return result;
}
async function sourceInventory(maintenance) {
  const worktree = maintenance.target.worktreePath;
  if (readSupervisedRecoverySourceHead(worktree) !== maintenance.target.headSha
      || git(worktree, ['symbolic-ref', '--short', 'HEAD']).trim() !== maintenance.target.branch)
    fail('SUPERVISED_R7_ORIGINAL_SOURCE_CHANGED');
  const dirty = [...new Set([
    ...git(worktree, ['diff', '--name-only', '-z', 'HEAD']).split('\0'),
    ...git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))].sort();
  const records = [];
  for (const name of dirty) {
    try { records.push({ group: 'dirty', name, bytes: await regularBytes(worktree, name) }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; records.push({ group: 'dirty', name, deleted: true }); }
  }
  // Preserve staged bytes separately from worktree bytes and retain the exact
  // original commit in the repository. The backup also contains a Git bundle.
  records.push({ group: 'git', name: 'index.patch', bytes: Buffer.from(git(worktree, ['diff', '--cached', '--binary', 'HEAD'])) });
  return records;
}
async function preservationInventory(maintenance, options) {
  const paths = pathsOf(options);
  const records = await sourceInventory(maintenance);
  for (const [group, root] of [
    ['queue', resolveMissionWorkerQueueRoot(options.env || process.env)],
    ['source-artifacts', join(paths.workspaceRoot, 'source-artifacts')],
    ['publication-outbox', join(paths.workspaceRoot, 'publication-outbox')],
  ]) {
    try {
      const files = await treeFiles(root);
      for (const name of files) {
        if (group === 'source-artifacts' && (name === 'supervised-r7' || name.startsWith('supervised-r7/'))) continue;
        records.push({ group, name, bytes: await regularBytes(root, name) });
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  for (const name of [`${MISSION}.state.json`, `${MISSION}.events.ndjson`])
    records.push({ group: 'mission', name, bytes: await regularBytes(paths.orchestratorRoot, name) });
  for (const name of ['execution-receipts.jsonl', `${maintenance.target.leaseId}.json`]) {
    try { records.push({ group: 'receipts', name, bytes: await regularBytes(join(paths.workspaceRoot, 'receipts'), name) }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (records.length > 4096 || records.reduce((n, r) => n + (r.bytes?.length || 0), 0) > 128 * 1024 * 1024)
    fail('SUPERVISED_R7_PRESERVATION_UNBOUNDED');
  return records;
}
const manifestEntries = records => records.map(({ group, name, bytes, deleted }) =>
  ({ group, name, ...(deleted ? { deleted: true } : { size: bytes.length, sha256: bytesDigest(bytes) }) }));

export async function preserveSupervisedR7Maintenance(options = {}) {
  const paths = pathsOf(options);
  const { state } = await readMissionRecord(MISSION, { root: paths.orchestratorRoot, env: options.env });
  const maintenance = state.storeMetadata?.supervisedRecoveryMaintenance;
  await quiescence(maintenance, options);
  const records = await preservationInventory(maintenance, options);
  const root = artifactRoot(paths, maintenance.commandId);
  // CREATE_NEW keeps partial attempts visible and never replaces preserved work.
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { recursive: false, mode: 0o700 });
  git(maintenance.target.worktreePath, ['bundle', 'create', join(root, 'original-history.bundle'), 'HEAD']);
  git(maintenance.target.worktreePath, ['bundle', 'verify', join(root, 'original-history.bundle')]);
  const bundleHandle = await open(join(root, 'original-history.bundle'), 'r+');
  try { await bundleHandle.sync(); } finally { await bundleHandle.close(); }
  const bundle = await regularBytes(root, 'original-history.bundle', 256 * 1024 * 1024);
  for (const record of records) if (!record.deleted)
    await durableCreate(join(root, record.group, record.name), record.bytes);
  const entries = manifestEntries(records);
  if (supervisedRecoveryDigest(entries) !== supervisedRecoveryDigest(manifestEntries(await preservationInventory(maintenance, options))))
    fail('SUPERVISED_R7_PRESERVATION_CHANGED');
  await quiescence(maintenance, options);
  const observedAtUtc = new Date(nowMs(options)).toISOString();
  const manifest = { schemaVersion: 'stephanos.supervised-r7-preservation.v1', target: maintenance.target,
    maintenanceDigest: supervisedRecoveryDigest(maintenance), entries, observedAtUtc,
    gitBundleDigest: bytesDigest(bundle),
    expiresAtUtc: new Date(Date.parse(observedAtUtc) + 600000).toISOString() };
  await durableCreate(join(root, 'manifest.json'), JSON.stringify(manifest));
  return { preservationDigest: supervisedRecoveryDigest(manifest), entryCount: entries.length };
}

export async function readSupervisedRecoveryMaintenance({ paths, env = process.env, now = Date.now }) {
  const options = { paths, env, now };
  const { state } = await readMissionRecord(MISSION, { root: paths.orchestratorRoot, env });
  const maintenance = state.storeMetadata?.supervisedRecoveryMaintenance;
  await quiescence(maintenance, options);
  const root = artifactRoot(paths, maintenance.commandId);
  const manifest = JSON.parse(await regularBytes(root, 'manifest.json', 2 * 1024 * 1024));
  if (manifest.schemaVersion !== 'stephanos.supervised-r7-preservation.v1'
      || manifest.maintenanceDigest !== supervisedRecoveryDigest(maintenance)
      || supervisedRecoveryDigest(manifest.target) !== supervisedRecoveryDigest(maintenance.target)
      || !Array.isArray(manifest.entries)) fail('SUPERVISED_R7_PRESERVATION_INVALID');
  if (bytesDigest(await regularBytes(root, 'original-history.bundle', 256 * 1024 * 1024)) !== manifest.gitBundleDigest)
    fail('SUPERVISED_R7_HISTORY_PRESERVATION_FAILED');
  for (const entry of manifest.entries) {
    if (entry.deleted) continue;
    const bytes = await regularBytes(root, join(entry.group, entry.name));
    if (bytes.length !== entry.size || bytesDigest(bytes) !== entry.sha256) fail('SUPERVISED_R7_PRESERVATION_FAILED');
  }
  const actual = manifestEntries(await preservationInventory(maintenance, options));
  if (supervisedRecoveryDigest(actual) !== supervisedRecoveryDigest(manifest.entries))
    fail('SUPERVISED_R7_UNEXPLAINED_SOURCE_MUTATION');
  return { schemaVersion: 'stephanos.supervised-r7-maintenance-observation.v1',
    target: maintenance.target, observedAtUtc: manifest.observedAtUtc, expiresAtUtc: manifest.expiresAtUtc,
    preservationVerified: true, preservationDigest: supervisedRecoveryDigest(manifest),
    maintenanceDigest: supervisedRecoveryDigest(maintenance), originalExecutionStopped: true,
    staleQueueResumePrevented: true, stalePublicationPrevented: true,
    conflictingWriterObserved: false, unexplainedMutationObserved: false };
}

export async function prepareRuntimeSupervisedR7(input, options = {}) {
  request(input);
  return prepareSupervisedR7RecoveryV1(input, { now: options.now || Date.now,
    readSnapshot: async () => ({ ...await targetSnapshot(input, options), queuesIdle: true,
      maintenance: await readSupervisedRecoveryMaintenance({ ...options, paths: pathsOf(options) }) }) });
}

export async function persistRuntimeSupervisedR7Packet(input, options = {}) {
  const prepared = await prepareRuntimeSupervisedR7(input, options);
  const file = join(artifactRoot(pathsOf(options), input.commandId), 'prepared.json');
  await durableCreate(file, JSON.stringify(prepared));
  return prepared;
}

export async function readRuntimeSupervisedR7Packet(input, options = {}) {
  request(input);
  const data = JSON.parse(await regularBytes(artifactRoot(pathsOf(options), input.commandId), 'prepared.json'));
  const p = data.packet;
  if (data.packetDigest !== supervisedRecoveryDigest(p)
      || p.requestId !== input.requestId || p.commandId !== input.commandId
      || p.target.sourceRevision !== input.sourceRevision
      || p.target.originalLeaseDigest !== input.originalLeaseDigest)
    fail('SUPERVISED_R7_PACKET_BINDING_CHANGED');
  return data;
}

export function supervisedR7FenceBindsLease(fence, lease) {
  const p = fence?.prepared?.packet, t = p?.target;
  return Boolean(fence?.schemaVersion === SUPERVISED_R7_FENCE_SCHEMA
    && p?.purpose === SUPERVISED_R7_APPROVAL_PURPOSE
    && fence.prepared.packetDigest === supervisedRecoveryDigest(p)
    && t?.missionId === MISSION && t.revision === 7 && t.leaseId === `${MISSION}-r7-lease`
    && t.repository === REPOSITORY && t.issueNumber === 2962 && t.prNumber === 2987
    && t.branch === 'openclaw/elastic-goal-2962' && t.originalLeaseDigest === supervisedRecoveryDigest(lease)
    && lease?.leaseId === t.leaseId && lease.laneId === t.missionId && lease.ownerId === 'mission-worker'
    && lease.repository === t.repository && lease.issueNumber === t.issueNumber && lease.prNumber === t.prNumber
    && lease.branch === t.branch && lease.headSha === t.headSha
    && fence.missionId === t.missionId && fence.originalRevision === 7
    && fence.originalLeaseId === t.leaseId && fence.originalLeaseDigest === t.originalLeaseDigest
    && fence.worktreePath === t.worktreePath && fence.approvalConsumed === true
    && HASH.test(fence.approvalEvidenceDigest || '') && Number.isSafeInteger(fence.approvalCommentId)
    && Number.isFinite(Date.parse(fence.approvalConsumedAtUtc))
    && Date.parse(fence.approvalConsumedAtUtc) >= Date.parse(p.preparedAtUtc)
    && Date.parse(fence.approvalConsumedAtUtc) < Date.parse(p.expiresAtUtc)
    && fence.recoveryDisposition === 'OPERATOR_APPROVED_SUPERVISED_RETIREMENT'
    && fence.historicalExecutionOutcome === 'UNKNOWN' && fence.historicalTerminalReceiptReconstructed === false
    && fence.hostileWriterExclusionProven === false && fence.witnessCommissioned === false
    && fence.goalComplete === false && fence.leaseSeizureAllowed === false
    && fence.sourceMutationAuthority === false && fence.leaseReleaseAuthority === false);
}

// Verification after cancellation does not compare the now-cancelled state to
// its preserved pre-cancellation bytes. It still rechecks the actual original
// dirty files and immutable backup and authenticates the same consumed decision.
export async function verifyRuntimeSupervisedR7Fence(fence, lease, paths, env) {
  if (!supervisedR7FenceBindsLease(fence, lease)) return false;
  const packet = fence.prepared.packet;
  const verifyEvidence = async () => {
    const { state } = await readMissionRecord(MISSION, { root: paths.orchestratorRoot, env });
    await quiescence(state.storeMetadata?.supervisedRecoveryMaintenance, { paths, env });
    const root = artifactRoot(paths, packet.commandId);
    const manifest = JSON.parse(await regularBytes(root, 'manifest.json', 2 * 1024 * 1024));
    if (supervisedRecoveryDigest(manifest) !== packet.maintenanceEvidence.preservationDigest) return false;
    if (supervisedRecoveryDigest(state.storeMetadata.supervisedRecoveryMaintenance) !== packet.maintenanceEvidence.maintenanceDigest
        || bytesDigest(await regularBytes(root, 'original-history.bundle', 256 * 1024 * 1024)) !== manifest.gitBundleDigest)
      return false;
    for (const entry of manifest.entries) {
      if (!entry.deleted && bytesDigest(await regularBytes(root, join(entry.group, entry.name))) !== entry.sha256) return false;
    }
    const expectedSource = manifest.entries.filter(e => ['dirty', 'git'].includes(e.group));
    const currentSource = manifestEntries(await sourceInventory(state.storeMetadata.supervisedRecoveryMaintenance));
    if (supervisedRecoveryDigest(currentSource) !== supervisedRecoveryDigest(expectedSource)) return false;
    await quiescence(state.storeMetadata.supervisedRecoveryMaintenance, { paths, env });
    return true;
  };
  if (!await verifyEvidence()) return false;
  const inspected = await authenticateRuntimeSupervisedR7(fence.prepared, fence.approvalCommentId,
    { now: () => Date.parse(fence.approvalConsumedAtUtc) });
  // The GitHub read can yield to source changes or new queue/worker activity.
  // Re-observe the entire bound estate after that IO, while the reconciler
  // still holds the canonical mission lock, immediately before lease CAS.
  return inspected.approvalEvidenceDigest === fence.approvalEvidenceDigest && await verifyEvidence();
}

export async function authenticateRuntimeSupervisedR7(prepared, approvalCommentId, options = {}) {
  return inspectSupervisedR7ApprovalV1(prepared, { now: options.now || Date.now,
    authenticateOperatorApproval: expected => readSupervisedR7OperatorApproval(approvalCommentId, expected, options) });
}
