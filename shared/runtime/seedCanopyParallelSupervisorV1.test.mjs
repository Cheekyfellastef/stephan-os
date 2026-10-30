import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parallelSeedManifestHashV1,
  makeParallelSeedExactApprovalV1,
  evaluateParallelSeedExactApprovalV1,
  selectParallelSeedApprovedTaskV1,
  selectParallelSeedInventoryBatchTaskV1,
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
  const held = { ...accepted, request: { ...request, taskId: 'held-case', targetPath: 'docs/architecture/held-case.md' },
    approval: { ...approved, taskId: 'held-case', targetPath: 'docs/architecture/held-case.md' }, existingClaim: true };
  const bad = { ...accepted, request: { ...request, taskId: 'expired-case', targetPath: 'docs/architecture/expired-case.md' },
    approval: { ...approved, taskId: 'expired-case', targetPath: 'docs/architecture/expired-case.md',
      expiresAtUtc: '2026-10-13T15:00:00.000Z' } };
  const result = selectParallelSeedApprovedTaskV1([held, bad, accepted], NOW);
  assert.equal(result.selected.request.taskId, request.taskId);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.blocked.length, 2);
  assert.ok(result.blocked.some((entry) => entry.reason === 'PRESERVED_SOURCE_CUSTODY'));
});

test('malformed and duplicate inbox rows cannot jam unrelated Seed Canopy selection', () => {
  const usable = { request, manifestSha256, approval: approved };
  const duplicate = { ...usable, request: { ...request, taskId: 'duplicate-seed-task', targetPath: 'docs/architecture/duplicate.md' },
    approval: { ...approved, taskId: 'duplicate-seed-task', targetPath: 'docs/architecture/duplicate.md' } };
  const candidates = [null, 19, {}, undefined, duplicate, { ...duplicate }, usable];
  const result = selectParallelSeedApprovedTaskV1(candidates, NOW);
  assert.equal(result.selected.request.taskId, request.taskId);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.blocked.length, 6);
  assert.equal(result.blocked.filter(row =>
    row.reason === 'DUPLICATE_TASK_ID_OWNERSHIP_AMBIGUOUS').length, 2);
  assert.equal(result.blocked.filter(row =>
    row.reason === 'INVALID_INBOX_TASK_ENVELOPE').length, 4);
  assert.equal(selectParallelSeedApprovedTaskV1(null, NOW).selected, null);
  assert.equal(selectParallelSeedApprovedTaskV1([], NOW).selected, null);
  assert.equal(result.selected.existingClaim, undefined);
});

test('overlapping source-path custody parks only conflicting tasks across modes', () => {
  const make = (taskId, targetPath, generationMode = 'CANONICAL_INVENTORY_V1') => {
    const next = { ...request, taskId, targetPath, generationMode };
    const hash = parallelSeedManifestHashV1(JSON.stringify(next));
    return { request: next, manifestSha256: hash,
      approval: makeParallelSeedExactApprovalV1({
        request: next, manifestSha256: hash,
        nowUtc: '2026-10-13T15:30:00.000Z',
        expiryUtc: '2026-10-14T15:30:00.000Z',
      }) };
  };
  const first = make('aaa-first', 'docs/architecture/shared-target.md');
  const second = make('aab-second', 'docs/architecture/shared-target.md');
  const disjoint = make('aac-disjoint', 'docs/architecture/disjoint-target.md');
  const selected = selectParallelSeedApprovedTaskV1([first, second, disjoint], NOW);
  assert.equal(selected.selected.request.taskId, 'aac-disjoint');
  assert.equal(selected.eligibleCount, 1);
  assert.deepEqual(selected.blocked.map(row => row.reason), [
    'RESOURCE_PATH_OWNERSHIP_AMBIGUOUS', 'RESOURCE_PATH_OWNERSHIP_AMBIGUOUS']);
  const otherModeRequest = { ...second.request };
  delete otherModeRequest.generationMode;
  const otherModeHash = parallelSeedManifestHashV1(JSON.stringify(otherModeRequest));
  const otherMode = { request: otherModeRequest, manifestSha256: otherModeHash,
    approval: makeParallelSeedExactApprovalV1({
      request: otherModeRequest, manifestSha256: otherModeHash,
      nowUtc: '2026-10-13T15:30:00.000Z',
      expiryUtc: '2026-10-14T15:30:00.000Z',
    }) };
  assert.equal(selectParallelSeedInventoryBatchTaskV1([first, otherMode, disjoint], NOW)
    .selected.request.taskId, 'aac-disjoint',
  'another task mode cannot hide a conflicting writer from inventory selection');
  const claimed = { ...second, approval: null, existingClaim: true };
  assert.equal(selectParallelSeedApprovedTaskV1([first, claimed, disjoint], NOW)
    .selected.request.taskId, 'aac-disjoint',
  'an existing claim reserves its source path');
  const unapproved = { ...second, approval: null };
  assert.equal(selectParallelSeedApprovedTaskV1([first, unapproved, disjoint], NOW)
    .selected.request.taskId, 'aaa-first',
  'unapproved inbox data cannot starve an authenticated path owner');
});

test('bounded model-free inventory selector moves past one blocked lane without R7 lease', () => {
  const entry = (taskId, targetPath, generationMode = 'CANONICAL_INVENTORY_V1') => {
    const candidate = { ...request, taskId, targetPath, generationMode };
    const hash = parallelSeedManifestHashV1(JSON.stringify(candidate));
    return {
      request: candidate, manifestSha256: hash,
      approval: makeParallelSeedExactApprovalV1({
        request: candidate, manifestSha256: hash,
        nowUtc: '2026-10-13T15:30:00.000Z',
        expiryUtc: '2026-10-14T15:30:00.000Z',
      }),
    };
  };
  const blocked = { ...entry('aaa-blocked', 'docs/architecture/one.md'),
    existingClaim: true };
  const first = entry('aab-first', 'docs/architecture/two.md');
  const second = entry('aac-second', 'docs/architecture/three.md');
  const heavy = entry('aaa-model', 'docs/architecture/model.md', undefined);
  const normal = { ...heavy, request: { ...heavy.request, generationMode: undefined } };
  const candidates = [blocked, first, second, normal];
  const firstPick = selectParallelSeedInventoryBatchTaskV1(candidates, NOW);
  assert.equal(firstPick.selected.request.taskId, 'aab-first');
  assert.equal(firstPick.eligibleCount, 2);
  const nextPick = selectParallelSeedInventoryBatchTaskV1(
    candidates, NOW, ['aab-first']);
  assert.equal(nextPick.selected.request.taskId, 'aac-second');
  const exhausted = selectParallelSeedInventoryBatchTaskV1(
    candidates, NOW, ['aab-first', 'aac-second']);
  assert.equal(exhausted.selected, null);
  assert.equal(exhausted.eligibleCount, 0);
  assert.equal(selectParallelSeedInventoryBatchTaskV1(null, NOW).selected, null);
  assert.equal(selectParallelSeedInventoryBatchTaskV1(candidates, NOW, []).selected.request.generationMode,
    'CANONICAL_INVENTORY_V1');
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
      commitSha: 'b'.repeat(40), independentGitHeadVerified: true },
  ];
  const projected = projectParallelSeedReceiptStatusV1(claims, receipts, NOW);
  assert.equal(projected.taskCount, 2);
  assert.equal(projected.tasks[0].recovery, 'INSPECT_TASK_WORKTREE_NO_AUTO_RELEASE');
  assert.equal(projected.tasks[0].sourceTruth, 'STALE_OR_UNKNOWN');
  assert.equal(projected.tasks[0].merged, false);
  // A same-account Git readback cannot serve as its own independent proof.
  assert.equal(projected.tasks[1].localCommitReadbackMatched, true);
  assert.equal(projected.tasks[1].candidateCommitted, false);
  assert.equal(projected.localCommitReadbackMatchedUntrusted, true);
  assert.equal(projected.localSourceCandidateProven, false);
  assert.equal(projected.candidateTrustBlocker, 'INDEPENDENT_CANDIDATE_PROVENANCE_NOT_COMMISSIONED');
  assert.equal(projected.liveBuildProven, false);
  const spoofed = projectParallelSeedReceiptStatusV1(claims, receipts.map((receipt) =>
    receipt.taskId === 'finished-two' ? { ...receipt, independentGitHeadVerified: false } : receipt), NOW);
  assert.equal(spoofed.tasks[1].candidateCommitted, false);
  assert.equal(spoofed.tasks[1].localCommitReadbackMatched, false);
  assert.equal(spoofed.localSourceCandidateProven, false);
  assert.equal(spoofed.liveBuildProven, false);
  assert.equal(projected.tasks[1].deployed, false);
  assert.equal(projected.doesNotDependOnCanonicalConveyor, true);
});

test('ambiguous duplicate receipt or claim cannot manufacture local commit proof or jam disjoint tasks', () => {
  const first = { taskId: 'ambiguous-one', seedId: request.seedId,
    targetPath: request.targetPath, createdAtUtc: '2026-10-13T15:30:00.000Z' };
  const second = { taskId: 'independent-two', seedId: request.seedId,
    targetPath: 'docs/architecture/independent.md', createdAtUtc: '2026-10-13T15:30:00.000Z' };
  const committed = (taskId) => ({ taskId, stage: 'COMMITTED',
    recordedAtUtc: '2026-10-13T15:40:00.000Z',
    commitSha: 'c'.repeat(40), independentGitHeadVerified: true });
  const receipts = [committed(first.taskId),
    { ...committed(first.taskId), commitSha: 'd'.repeat(40) },
    committed(second.taskId)];
  const projected = projectParallelSeedReceiptStatusV1([first, second], receipts, NOW);
  assert.equal(projected.tasks[0].stage, 'AMBIGUOUS_SOURCE_CUSTODY');
  assert.equal(projected.tasks[0].sourceTruth, 'STALE_OR_UNKNOWN');
  assert.equal(projected.tasks[0].localCommitReadbackMatched, false);
  assert.equal(projected.tasks[0].recovery, 'INSPECT_TASK_WORKTREE_NO_AUTO_RELEASE');
  assert.equal(projected.tasks[1].localCommitReadbackMatched, true,
    'one ambiguous task must not suppress disjoint observational readback');
  assert.equal(projected.localSourceCandidateProven, false);
  assert.equal(projected.liveBuildProven, false);

  const duplicateClaim = projectParallelSeedReceiptStatusV1(
    [first, { ...first, targetPath: 'docs/architecture/other.md' }, second],
    [committed(first.taskId), committed(second.taskId)], NOW);
  assert.equal(duplicateClaim.tasks[0].stage, 'AMBIGUOUS_SOURCE_CUSTODY');
  assert.equal(duplicateClaim.tasks[1].stage, 'AMBIGUOUS_SOURCE_CUSTODY');
  assert.equal(duplicateClaim.tasks[2].localCommitReadbackMatched, true);
  assert.equal(projectParallelSeedReceiptStatusV1(null, null, NOW).taskCount, 0,
    'malformed optional arrays must not jam the independent supervisor');
});
