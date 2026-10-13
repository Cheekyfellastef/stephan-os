import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parallelSeedManifestHashV1,
  makeParallelSeedExactApprovalV1,
  evaluateParallelSeedExactApprovalV1,
  selectParallelSeedApprovedTaskV1,
  projectParallelSeedReceiptStatusV1,
} from './seedCanopyParallelSupervisorV1.mjs';

const NOW = Date.parse('2026-10-13T16:00:00.000Z');
const request = {
  seedId: 'stephanos-full-sovereignty-every-function',
  taskId: 'test-isolated-doc',
  targetPath: 'docs/architecture/seed-proposal.md',
  ownerIssue: '#3026',
  baseSha: 'a'.repeat(40),
};
const raw = JSON.stringify(request);
const manifestSha256 = parallelSeedManifestHashV1(raw);
const approved = makeParallelSeedExactApprovalV1({
  request, manifestSha256,
  nowUtc: '2026-10-13T15:30:00.000Z',
  expiryUtc: '2026-10-14T15:30:00.000Z',
});

test('exact approval binds all source task identities, bytes and expiry', () => {
  assert.equal(evaluateParallelSeedExactApprovalV1({ request, manifestSha256, approval: approved, nowMs: NOW }).ok, true);
  const changes = [
    { request: { ...request, ownerIssue: '#7' } },
    { request: { ...request, targetPath: 'docs/architecture/other.md' } },
    { request: { ...request, baseSha: 'b'.repeat(40) } },
    { manifestSha256: parallelSeedManifestHashV1(raw + ' ') },
    { approval: { ...approved, grant: 'MERGE_ALL' } },
    { approval: { ...approved, mode: 'UNBOUNDED' } },
    { nowMs: Date.parse('2026-10-14T15:30:00.000Z') },
    { nowMs: Date.parse('2026-10-13T15:00:00.000Z') },
  ];
  for (const delta of changes) {
    const result = evaluateParallelSeedExactApprovalV1({
      request, manifestSha256, approval: approved, nowMs: NOW, ...delta,
    });
    assert.equal(result.ok, false, JSON.stringify(delta));
  }
  assert.throws(() => makeParallelSeedExactApprovalV1({
    request, manifestSha256, nowUtc: '2026-10-13T15:30:00.000Z',
    expiryUtc: '2026-10-14T15:30:01.000Z',
  }), /APPROVAL_WINDOW_TOO_WIDE/);
});

test('one independently approved candidate gets selected, held tasks do not block others', () => {
  const accepted = { request, manifestSha256, approval: approved };
  const held = { ...accepted, request: { ...request, taskId: 'held-case' },
    approval: { ...approved, taskId: 'held-case' }, existingClaim: true };
  const bad = { ...accepted, request: { ...request, taskId: 'expired-case' },
    approval: { ...approved, taskId: 'expired-case', expiresAtUtc: '2026-10-13T15:00:00.000Z' } };
  const result = selectParallelSeedApprovedTaskV1([held, bad, accepted], NOW);
  assert.equal(result.selected.request.taskId, request.taskId);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.blocked.length, 2);
  assert.ok(result.blocked.some((entry) => entry.reason === 'PRESERVED_SOURCE_CUSTODY'));
});

test('supervisor status marks stale unfinished task, never claims merging or deployment', () => {
  const claims = [
    { taskId: 'blocked-one', seedId: request.seedId, targetPath: request.targetPath,
      createdAtUtc: '2026-10-13T12:00:00.000Z' },
    { taskId: 'finished-two', seedId: request.seedId, targetPath: 'docs/architecture/success.md',
      createdAtUtc: '2026-10-13T15:30:00.000Z' },
  ];
  const receipts = [
    { taskId: 'blocked-one', stage: 'CLAIMED', recordedAtUtc: '2026-10-13T12:05:00.000Z' },
    { taskId: 'finished-two', stage: 'COMMITTED', recordedAtUtc: '2026-10-13T15:40:00.000Z',
      commitSha: 'b'.repeat(40) },
  ];
  const projected = projectParallelSeedReceiptStatusV1(claims, receipts, NOW);
  assert.equal(projected.taskCount, 2);
  assert.equal(projected.tasks[0].recovery, 'INSPECT_TASK_WORKTREE_NO_AUTO_RELEASE');
  assert.equal(projected.tasks[0].sourceTruth, 'STALE_OR_UNKNOWN');
  assert.equal(projected.tasks[0].merged, false);
  assert.equal(projected.tasks[1].candidateCommitted, true);
  assert.equal(projected.tasks[1].deployed, false);
  assert.equal(projected.doesNotDependOnCanonicalConveyor, true);
});
