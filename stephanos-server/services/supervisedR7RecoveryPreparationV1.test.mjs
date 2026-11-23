import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prepareSupervisedR7RecoveryV1, inspectSupervisedR7ApprovalV1 } from './supervisedR7RecoveryPreparationV1.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const NOW = Date.parse('2026-10-24T10:30:00.000Z');
function fixture() {
  const missionId = 'critical-2962-elastic-goal';
  const mission = { missionId, revision: 7, repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'REPAIR_REQUIRED', git: { branch: 'openclaw/elastic-goal-2962', worktreePath: '/owned/test-worktree' },
    pullRequest: { number: 2987, headSha: 'a'.repeat(40) },
    dispatch: { status: 'complete', adapter: 'foundry-forge' } };
  const lease = { leaseId: `${missionId}-r7-lease`, laneId: missionId, repository: mission.repository,
    issueNumber: 2962, prNumber: 2987, branch: mission.git.branch, headSha: mission.pullRequest.headSha,
    ownerId: 'mission-worker', expiresAtUtc: '2026-10-10T10:00:00.000Z' };
  const request = { requestId: 'supervised-r7-source-test', commandId: 'supervised-r7-command-test',
    sourceRevision: 'b'.repeat(40), originalLeaseDigest: sha(lease) };
  const target = { repository: mission.repository, missionId, revision: 7, leaseId: lease.leaseId,
    originalLeaseDigest: request.originalLeaseDigest, issueNumber: 2962, prNumber: 2987,
    branch: lease.branch, headSha: lease.headSha, worktreePath: mission.git.worktreePath,
    sourceRevision: request.sourceRevision };
  const maintenance = { schemaVersion: 'stephanos.supervised-r7-maintenance-observation.v1', target,
    observedAtUtc: '2026-10-24T10:29:59.000Z', expiresAtUtc: '2026-10-24T10:31:00.000Z',
    preservationVerified: true, preservationDigest: 'c'.repeat(64), maintenanceDigest: 'd'.repeat(64),
    originalExecutionStopped: true, staleQueueResumePrevented: true, stalePublicationPrevented: true,
    conflictingWriterObserved: false, unexplainedMutationObserved: false };
  const snapshot = { sourceRevision: request.sourceRevision, mission,
    leaseRead: { ok: true, record: lease, validation: { valid: true, stale: true, active: false } },
    queuesIdle: true, maintenance };
  return { request, snapshot, now: () => NOW, readSnapshot: async () => snapshot };
}
async function prepared(f = fixture()) { return prepareSupervisedR7RecoveryV1(f.request, f); }
function approving(expected) {
  return { ...expected, authenticated: true, consumed: false, lowerAssuranceExplicitlyAccepted: true,
    approvalEvidenceDigest: 'e'.repeat(64), approvedAtUtc: '2026-10-24T10:30:00.000Z',
    expiresAtUtc: '2026-10-24T10:30:50.000Z' };
}
const zeroAuthority = result => {
  assert.equal(result.historicalExecutionOutcome, 'UNKNOWN');
  for (const key of ['historicalTerminalReceiptReconstructed', 'hostileWriterExclusionProven',
    'witnessCommissioned', 'leaseReleaseAuthority', 'sourceMutationAuthority',
    'cancellationAuthority', 'automaticDeploymentAllowed']) assert.equal(result[key], false, key);
};

test('prepares exact original recovery without a historical receipt or new signer', async () => {
  const f = fixture(), before = JSON.stringify(f.snapshot), p = await prepared(f);
  assert.equal(p.packet.target.originalLeaseDigest, sha(f.snapshot.leaseRead.record));
  assert.equal(p.packet.target.revision, 7);
  assert.equal(p.packetDigest, sha(p.packet));
  assert.equal(p.packet.unattendedRefillsRequiredBeforeFirstBuild, false);
  assert.equal(p.packet.firstBuildAcceptance, 'EXISTING_WORKER_PICKUP_DIFF_TESTS_COMMIT');
  zeroAuthority(p.packet);
  assert.equal(JSON.stringify(f.snapshot), before);
  assert.ok(Object.isFrozen(p.packet.maintenanceEvidence.target));
});

for (const [label, change] of [
  ['wrong mission', s => { s.mission.missionId = 'critical-2963-elastic-goal'; }],
  ['wrong revision', s => { s.mission.revision = 8; }],
  ['wrong branch', s => { s.mission.git.branch = 'other'; }],
  ['wrong PR', s => { s.mission.pullRequest.number = 1; }],
  ['moved PR head', s => { s.mission.pullRequest.headSha = 'e'.repeat(40); }],
  ['wrong protected source', s => { s.sourceRevision = 'e'.repeat(40); }],
  ['missing worktree', s => { s.mission.git.worktreePath = ''; }],
  ['already cancelled', s => { s.mission.cancelled = true; }],
  ['already fenced', s => { s.mission.storeMetadata = { originalSourceAttemptFence: {} }; }],
  ['running dispatch', s => { s.mission.dispatch.status = 'running'; }],
  ['lease renewal', s => { s.leaseRead.record.expiresAtUtc = '2026-10-24T11:00:00.000Z'; }],
  ['lease not observable', s => { s.leaseRead.ok = false; }],
  ['active lease', s => { s.leaseRead.validation.active = true; }],
  ['unvalidated lease', s => { s.leaseRead.validation.valid = false; }],
  ['wrong lease owner', s => { s.leaseRead.record.ownerId = 'another-worker'; }],
  ['wrong held lease', s => { s.leaseRead.record.leaseId += '-replacement'; }],
]) test(`target refuses ${label}`, async () => {
  const f = fixture(); change(f.snapshot);
  await assert.rejects(prepared(f), /SUPERVISED_R7_TARGET_MISMATCH/);
});

for (const [label, change] of [
  ['preservation failed', m => { m.preservationVerified = false; }],
  ['backup digest missing', m => { m.preservationDigest = ''; }],
  ['maintenance digest missing', m => { m.maintenanceDigest = ''; }],
  ['old worker not stopped', m => { m.originalExecutionStopped = false; }],
  ['queue can resume', m => { m.staleQueueResumePrevented = false; }],
  ['publisher can resume', m => { m.stalePublicationPrevented = false; }],
  ['competing writer', m => { m.conflictingWriterObserved = true; }],
  ['unknown competing writer', m => { m.conflictingWriterObserved = null; }],
  ['unexplained mutation', m => { m.unexplainedMutationObserved = true; }],
  ['expiry boundary', m => { m.expiresAtUtc = '2026-10-24T10:30:00.000Z'; }],
  ['future evidence', m => { m.observedAtUtc = '2026-10-24T10:30:01.000Z'; }],
  ['overlong validity', m => { m.expiresAtUtc = '2026-10-24T11:00:00.000Z'; }],
  ['wrong evidence target', m => { m.target.originalLeaseDigest = 'f'.repeat(64); }],
]) test(`maintenance refuses ${label}`, async () => {
  const f = fixture(); change(f.snapshot.maintenance);
  await assert.rejects(prepared(f), /SUPERVISED_R7_MAINTENANCE_UNPROVEN/);
});

for (const queuesIdle of [false, null, undefined, 1]) test(`unknown/nonidle queues ${String(queuesIdle)} hold`, async () => {
  const f = fixture();
  if (queuesIdle === undefined) delete f.snapshot.queuesIdle; else f.snapshot.queuesIdle = queuesIdle;
  await assert.rejects(prepared(f), /SUPERVISED_R7_MAINTENANCE_UNPROVEN/);
});

test('rechecks the whole lease after awaited observation', async () => {
  const f = fixture(); let count = 0;
  f.readSnapshot = async () => { if (++count === 2) f.snapshot.leaseRead.record.extraRenewal = 'changed'; return f.snapshot; };
  await assert.rejects(prepared(f), /SUPERVISED_R7_TARGET_MISMATCH/);
  assert.equal(count, 2);
});
test('retains a detached first snapshot when provider reuses a mutable object', async () => {
  const f = fixture(); let count = 0;
  f.readSnapshot = async () => { if (++count === 2) f.snapshot.maintenance.maintenanceDigest = 'e'.repeat(64); return f.snapshot; };
  await assert.rejects(prepared(f), /SUPERVISED_R7_SNAPSHOT_CHANGED/);
});
test('clock is resampled after slow IO', async () => {
  const f = fixture(); let t = NOW, count = 0;
  f.now = () => t;
  f.readSnapshot = async () => { if (++count === 2) t += 61000; return f.snapshot; };
  await assert.rejects(prepared(f), /SUPERVISED_R7_MAINTENANCE_UNPROVEN/);
});
test('caller approval booleans cannot turn preparation into a permission', async () => {
  const f = fixture(); f.request.approved = true;
  await assert.rejects(prepared(f), /SUPERVISED_R7_REQUEST_INVALID/);
});
test('missing canonical reader holds', async () => {
  const f = fixture(); delete f.readSnapshot;
  await assert.rejects(prepared(f), /CANONICAL_READER_NOT_INSTALLED/);
});
test('accessors, proxies and toJSON are refused without running them', async () => {
  const f = fixture(); let invoked = 0;
  const getter = Object.defineProperty({}, 'requestId', { enumerable: true, get() { invoked++; return ''; } });
  const proxy = new Proxy({}, { ownKeys() { invoked++; return []; } });
  for (const bad of [getter, proxy, { toJSON() { invoked++; return f.request; } }]) {
    await assert.rejects(prepareSupervisedR7RecoveryV1(bad, f), /INPUT_NOT_DATA/);
  }
  assert.equal(invoked, 0);
});
test('missing approval adapter never accepts caller-supplied approval', async () => {
  await assert.rejects(inspectSupervisedR7ApprovalV1(await prepared(), { now: () => NOW, approved: true }), /APPROVAL_ADAPTER_NOT_INSTALLED/);
});
test('authenticated exact approval remains a preflight, not cancellation/release', async () => {
  const p = await prepared(); let calls = 0;
  const result = await inspectSupervisedR7ApprovalV1(p, { now: () => NOW,
    authenticateOperatorApproval: async expected => { calls++; assert.equal(expected.packetDigest, p.packetDigest); return approving(expected); } });
  assert.equal(calls, 1); zeroAuthority(result);
  assert.equal(result.approvalConsumed, false);
  assert.equal(result.canonicalAuditCommitted, false);
  assert.equal(result.leaseReleased, false);
});
for (const [label, change] of [
  ['unauthenticated', a => { a.authenticated = false; }],
  ['used approval', a => { a.consumed = true; }],
  ['wrong packet', a => { a.packetDigest = 'f'.repeat(64); }],
  ['wrong command', a => { a.commandId = 'different-command'; }],
  ['wrong request', a => { a.requestId = 'different-request'; }],
  ['wrong lease', a => { a.originalLeaseDigest = 'f'.repeat(64); }],
  ['wrong source', a => { a.sourceRevision = 'f'.repeat(40); }],
  ['wrong purpose', a => { a.purpose = 'RELEASE_ALL_LEASES'; }],
  ['lower assurance not accepted', a => { a.lowerAssuranceExplicitlyAccepted = false; }],
  ['expired approval', a => { a.expiresAtUtc = '2026-10-24T10:30:00.000Z'; }],
  ['pre-packet approval', a => { a.approvedAtUtc = '2026-10-24T10:29:59.000Z'; }],
]) test(`approval refuses ${label}`, async () => {
  const p = await prepared();
  await assert.rejects(inspectSupervisedR7ApprovalV1(p, { now: () => NOW,
    authenticateOperatorApproval: async expected => { const a = approving(expected); change(a); return a; } }), /APPROVAL_UNPROVEN/);
});
test('approval expiry is checked after authenticator returns', async () => {
  const p = await prepared(); let t = NOW;
  await assert.rejects(inspectSupervisedR7ApprovalV1(p, { now: () => t,
    authenticateOperatorApproval: async expected => { t += 61000; return approving(expected); } }), /APPROVAL_UNPROVEN/);
});
for (const [label, change] of [
  ['different mission', p => { p.target.missionId = 'critical-2963-elastic-goal'; }],
  ['different branch', p => { p.target.branch = 'main'; }],
  ['different lease revision', p => { p.target.revision = 8; }],
  ['invented completion', p => { p.historicalExecutionOutcome = 'SUCCESS'; }],
  ['lease authority', p => { p.leaseReleaseAuthority = true; }],
  ['custody authority', p => { p.hostileWriterExclusionProven = true; }],
]) test(`rehashing a forged packet cannot authorise ${label}`, async () => {
  const p = copy(await prepared()); change(p.packet); p.packetDigest = sha(p.packet); let calls = 0;
  await assert.rejects(inspectSupervisedR7ApprovalV1(p, { now: () => NOW,
    authenticateOperatorApproval: async expected => { calls++; return approving(expected); } }), /PACKET_INVALID/);
  assert.equal(calls, 0);
});
test('ordinary strict proof and cancellation retain the reviewed canonical LF bytes', async () => {
  // Windows Git may check text out with CRLF. Compare the canonical Git text
  // bytes without allowing any other source change through this regression.
  const service = (await readFile(new URL('./originalSourceAttemptFenceService.js', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n');
  const strict = service.slice(service.indexOf('export async function proveOriginalSourceQuarantine('),
    service.indexOf('export async function verifyOriginalSourceAttemptFence('));
  assert.equal(createHash('sha256').update(strict).digest('hex'), '395efbe092ef0840c664c1093fde3c65be2e74be1aed7f99aca06ce286204171');
  const preparationOnly = service.slice(service.indexOf('export async function prepareSupervisedOriginalSourceRecovery('),
    service.indexOf('// Explicit alternative only;'));
  assert.doesNotMatch(preparationOnly, /\b(?:appendMissionEvent|withOriginalSourceLeaseFenceGuard|releaseLease|writeFile|spawn|execFile)\s*\(/);
});
