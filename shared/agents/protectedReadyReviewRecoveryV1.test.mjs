import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProtectedReadyReviewDraftRecoveryV1 as classify,
  READY_REVIEW_DRAFT_INTERLEAVE_CODE, READY_REVIEW_RECOVERY_STEP } from './protectedReadyReviewRecoveryV1.mjs';
const head = 'b'.repeat(40), base = 'e'.repeat(40), tree = 'a'.repeat(40);
function fixture() {
  return {
    identity: { repository: 'Cheekyfellastef/stephan-os', prNumber: 3451,
      branch: 'fix/2963-mailbox-legacy-reconciliation-proof-v1', sourceHead: head, sourceTree: tree, baseSha: base },
    currentPr: { repository: 'Cheekyfellastef/stephan-os', number: 3451, state: 'open', draft: false,
      merged: false, branch: 'fix/2963-mailbox-legacy-reconciliation-proof-v1', headSha: head, headTree: tree, baseSha: base },
    mainSha: base,
    priorRuns: [{ id: 42496400604, repository: 'Cheekyfellastef/stephan-os', prNumber: 3451,
      sourceHead: head, baseSha: base, status: 'completed', conclusion: 'failure', runAttempt: 1,
      startedAtUtc: '2026-11-08T15:44:30.000Z', completedAtUtc: '2026-11-08T15:45:31.000Z' }],
    priorJob: { id: 128779581121, runId: 42496400604, runAttempt: 1, name: 'exact-head-review',
      status: 'completed', conclusion: 'failure', steps: [
        { name: 'Authenticate immutable READY handoff before review reads', conclusion: 'success' },
        { name: READY_REVIEW_RECOVERY_STEP, conclusion: 'failure' },
      ] },
    priorFailure: { source: 'authenticated-github-job-log', runId: 42496400604, jobId: 128779581121,
      code: READY_REVIEW_DRAFT_INTERLEAVE_CODE },
    timeline: [{ id: 35499411849, event: 'ready_for_review', actor: 'github-actions[bot]', createdAtUtc: '2026-11-08T15:39:02.000Z' },
      { id: 35499690108, event: 'convert_to_draft', actor: 'Cheekyfellastef', createdAtUtc: '2026-11-08T15:45:27.000Z' },
      { id: 35500258891, event: 'ready_for_review', actor: 'github-actions[bot]', createdAtUtc: '2026-11-08T15:58:27.000Z' }],
    ownerComment: { id: 7000000000, author: 'Cheekyfellastef', issueNumber: 3258,
      operation: 'MARK_PROTECTED_PR_READY', scope: 'review-recovery-only', prNumber: 3451,
      headSha: head, treeSha: tree, baseSha: base, bodySha256: 'c'.repeat(64),
      createdAtUtc: '2026-11-08T15:59:00.000Z', expiresAtUtc: '2026-11-08T16:06:00.000Z' },
    nowUtc: '2026-11-08T16:00:00.000Z',
  };
}
test('candidate classified only, never approval or mutation', () => {
  const r = classify(fixture());
  assert.equal(r.ok, true); assert.equal(r.reviewLaunchAllowed, true);
  assert.equal(r.sourceMutationAllowed, false); assert.equal(r.reviewApprovalGranted, false);
  assert.equal(r.mergeAuthority, false); assert.equal(r.priorRunId, 42496400604);
});
test('no recovery on current stale/changed/draft source', async t => {
  const cases = [
    ['draft', f => { f.currentPr.draft = true; }],
    ['head advance', f => { f.currentPr.headSha = 'f'.repeat(40); }],
    ['tree drift', f => { f.currentPr.headTree = 'f'.repeat(40); }],
    ['main advance', f => { f.mainSha = 'f'.repeat(40); }],
    ['merged', f => { f.currentPr.merged = true; }],
    ['wrong repository', f => { f.currentPr.repository = 'other/repo'; }],
  ];
  for (const [name, attack] of cases) await t.test(name, () => { const f = fixture(); attack(f); assert.equal(classify(f).ok, false); });
});
test('one-use recovery refuses success, pending, canceled, unknown or second prior run', async t => {
  const cases = [
    ['already-successful', f => { f.priorRuns[0].conclusion = 'success'; }],
    ['pending', f => { f.priorRuns[0].status = 'in_progress'; f.priorRuns[0].conclusion = null; }],
    ['canceled', f => { f.priorRuns[0].conclusion = 'cancelled'; }],
    ['second launch', f => { f.priorRuns.push({...f.priorRuns[0], id: 42496400605}); }],
    ['missing prior', f => { f.priorRuns = []; }],
    ['attempt rerun', f => { f.priorRuns[0].runAttempt = 2; }],
    ['wrong head', f => { f.priorRuns[0].sourceHead = 'c'.repeat(40); }],
    ['job mismatch', f => { f.priorJob.runId++; }],
    ['wrong failed step', f => { f.priorJob.steps[1].name = 'Build immutable exact-head review input'; }],
    ['two failed steps', f => { f.priorJob.steps[0].conclusion = 'failure'; }],
    ['log not authenticated', f => { f.priorFailure.source = 'issue-comment'; }],
    ['different blocker', f => { f.priorFailure.code = 'SECURITY_REVIEW_BLOCKED'; }],
  ];
  for (const [name, attack] of cases) await t.test(name, () => { const f = fixture(); attack(f); assert.equal(classify(f).ok, false); });
});
test('draft interleave requires authenticated actual terminal window and later restoration', async t => {
  const cases = [
    ['draft outside run', f => { f.timeline[1].createdAtUtc = '2026-11-08T15:40:00.000Z'; }],
    ['draft after run', f => { f.timeline[1].createdAtUtc = '2026-11-08T15:46:00.000Z'; }],
    ['missing restored ready', f => { f.timeline.pop(); }],
    ['restoration too early', f => { f.timeline[2].createdAtUtc = '2026-11-08T15:45:00.000Z'; }],
    ['wrong draft actor', f => { f.timeline[1].actor = 'outsider'; }],
    ['extra event refuses silently truncated history', f => { f.timeline.push({...f.timeline[2], id: 3}); }],
    ['malformed restored date', f => { f.timeline[2].createdAtUtc = 'not-time'; }],
    ['first READY missing', f => { f.timeline.shift(); }],
    ['first READY after review launch', f => { f.timeline[0].createdAtUtc = '2026-11-08T15:45:00.000Z'; }],
    ['first READY wrong actor', f => { f.timeline[0].actor = 'outsider'; }],
    ['first READY misclassified', f => { f.timeline[0].event = 'labeled'; }],
    ['duplicate GitHub timeline event identity', f => { f.timeline[2].id = f.timeline[0].id; }],
  ];
  for (const [name, attack] of cases) await t.test(name, () => { const f = fixture(); attack(f); assert.equal(classify(f).ok, false); });
});
test('fresh original owner recovery only: no replay, expired window, wrong scope/identity', async t => {
  const cases = [
    ['old owner authorization', f => { f.ownerComment.createdAtUtc = '2026-11-08T15:30:00.000Z'; }],
    ['expired', f => { f.nowUtc = '2026-11-08T16:07:00.000Z'; }],
    ['overlong', f => { f.ownerComment.expiresAtUtc = '2026-11-08T16:20:00.000Z'; }],
    ['foreign author', f => { f.ownerComment.author = 'other'; }],
    ['wrong mailbox', f => { f.ownerComment.issueNumber = 3149; }],
    ['wrong operation', f => { f.ownerComment.operation = 'DISPATCH_PROTECTED_OPERATOR_MERGE'; }],
    ['not recovery only', f => { f.ownerComment.scope = 'source-mutation'; }],
    ['wrong head', f => { f.ownerComment.headSha = 'f'.repeat(40); }],
    ['wrong tree', f => { f.ownerComment.treeSha = 'f'.repeat(40); }],
    ['wrong base', f => { f.ownerComment.baseSha = 'f'.repeat(40); }],
    ['unknown comment hash', f => { f.ownerComment.bodySha256 = ''; }],
  ];
  for (const [name, attack] of cases) await t.test(name, () => { const f = fixture(); attack(f); assert.equal(classify(f).ok, false); });
});
