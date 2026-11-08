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


// Read-only GitHub-shape evidence regressions for ORIGINAL #1802, not
// qualification of a second review or authorization of a source mutation.
import { classifyProtectedReadyReviewGitHubReadbackV1 as githubReadback } from './protectedReadyReviewRecoveryV1.mjs';
function githubFixture() {
  const sourceHead = 'b'.repeat(40), sourceTree = 'a'.repeat(40), baseSha = 'e'.repeat(40);
  const identity = { repository: 'Cheekyfellastef/stephan-os', prNumber: 3451,
    branch: 'fix/2963-mailbox-legacy-reconciliation-proof-v1',
    sourceHead, sourceTree, baseSha };
  const actor = { login: 'Cheekyfellastef', id: 267490109 };
  const bot = { login: 'github-actions[bot]', id: 41898282 };
  return {
    identity,
    pull: { number: 3451, state: 'open', merged: false, draft: false,
      head: { ref: identity.branch, sha: sourceHead, repo: { full_name: identity.repository } },
      base: { ref: 'main', sha: baseSha, repo: { full_name: identity.repository } } },
    main: { object: { sha: baseSha } }, commit: { sha: sourceHead, tree: { sha: sourceTree } },
    workflow: { id: 123, path: '.github/workflows/stephanos-exact-head-review.yml',
      name: 'Stephanos Exact-Head Review', state: 'active' },
    runs: [{ id: 42496400604, workflow_id: 123,
      display_title: 'protected-ready-review-pr-3451-head-' + sourceHead
        + '-ready-42496363172-binding-' + 'c'.repeat(64),
      path: '.github/workflows/stephanos-exact-head-review.yml',
      event: 'workflow_dispatch', head_sha: baseSha, head_branch: 'main',
      repository: { full_name: identity.repository }, head_repository: { full_name: identity.repository },
      actor, triggering_actor: bot, run_attempt: 1, status: 'completed',
      conclusion: 'failure', run_started_at: '2026-11-08T15:45:16Z' }],
    runInventoryTotalCount: 1,
    job: { id: 128779581121, run_id: 42496400604, run_attempt: 1,
      name: 'exact-head-review', status: 'completed', conclusion: 'failure',
      started_at: '2026-11-08T15:45:19Z', completed_at: '2026-11-08T15:45:32Z',
      steps: [{ name: 'Build immutable exact-head review input', conclusion: 'success' },
        { name: 'Review ready head with the unchanged engine and qualified escalation',
          conclusion: 'failure' }] },
    log: 'PROTECTED_READY_REVIEW_BLOCKED:CURRENT_PR_HEAD_TREE_BASE_OR_DRAFT_CHANGED',
    events: [
      { id: 35499411849, event: 'ready_for_review', actor: bot,
        created_at: '2026-11-08T15:39:02Z' },
      { id: 35499690108, event: 'convert_to_draft', actor,
        created_at: '2026-11-08T15:45:27Z' },
      { id: 35500258891, event: 'ready_for_review', actor: bot,
        created_at: '2026-11-08T15:58:27Z' },
    ],
    eventInventoryTotalCount: 3,
    ownerComment: null, nowUtc: '2026-11-08T18:00:00Z',
  };
}
test('GitHub-shaped actual history refuses without new qualified owner evidence', () => {
  const result = githubReadback(githubFixture());
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'READY_REVIEW_RECOVERY_FRESH_OWNER_RECOVERY_AUTHORITY_UNPROVEN');
  assert.equal(result.reviewLaunchAllowed, false);
  assert.equal(result.mergeAuthority, false);
});
test('GitHub-shaped synthetic author record never grants execution even if eligible', () => {
  const f = githubFixture();
  f.ownerComment = { id: 99800001, author: 'Cheekyfellastef',
    issueNumber: 3258, operation: 'MARK_PROTECTED_PR_READY',
    scope: 'review-recovery-only', prNumber: 3451,
    headSha: f.identity.sourceHead, treeSha: f.identity.sourceTree,
    baseSha: f.identity.baseSha, bodySha256: 'd'.repeat(64),
    createdAtUtc: '2026-11-08T18:00:10Z', expiresAtUtc: '2026-11-08T18:07:10Z' };
  f.nowUtc = '2026-11-08T18:00:11Z';
  const result = githubReadback(f);
  assert.equal(result.eligibleForOwnerQualifiedRecovery, true);
  assert.equal(result.reviewLaunchAllowed, false);
  assert.equal(result.mergeAuthority, false);
});
test('GitHub-shaped readback adversarial provenance rejects without dispatch', async t => {
  const bad = [
    ['head changed', x => { x.pull.head.sha = '0'.repeat(40); }],
    ['main changed', x => { x.main.object.sha = '0'.repeat(40); }],
    ['tree changed', x => { x.commit.tree.sha = '0'.repeat(40); }],
    ['draft', x => { x.pull.draft = true; }],
    ['wrong workflow', x => { x.workflow.path = 'evil'; }],
    ['missing run', x => { x.runs = []; }],
    ['duplicate run', x => { x.runs.push({...x.runs[0], id: 42500000000}); }],
    ['different review identity', x => { x.runs[0].display_title = 'foreign'; }],
    ['wrong base', x => { x.runs[0].head_sha = '0'.repeat(40); }],
    ['wrong actor', x => { x.runs[0].actor = {login:'other', id:1}; }],
    ['rerun', x => { x.runs[0].run_attempt = 2; }],
    ['pending', x => { x.runs[0].status = 'in_progress'; }],
    ['bad job', x => { x.job.run_id += 1; }],
    ['wrong job step', x => { x.job.steps[1].name = 'unrelated'; }],
    ['other refusal', x => { x.log = 'PROTECTED_READY_REVIEW_BLOCKED:OWNER_BINDING'; }],
    ['two errors', x => { x.log += '\n' + x.log; }],
    ['missing history', x => { x.events.shift(); }],
    ['extra history', x => { x.events.push({...x.events[2], id:1}); }],
    ['duplicate event', x => { x.events.push({...x.events[2]}); }],
    ['false actor', x => { x.events[1].actor = {login:'other',id:1}; }],
  ];
  for (const [label, mutate] of bad) await t.test(label, () => {
    const f = githubFixture();
    mutate(f);
    const result = githubReadback(f);
    assert.equal(result.ok, false);
    assert.equal(result.reviewLaunchAllowed, false);
    assert.equal(result.mergeAuthority, false);
  });
});

test('GitHub raw inventory rejects omissions, extra matching runs and hidden timeline events', async sub => {
  const cases = [
    ['run count incomplete', x => { x.runInventoryTotalCount = 2; }],
    ['event count incomplete', x => { x.eventInventoryTotalCount = 4; }],
    ['two matching reviewer launches', x => {
      x.runs.push({ ...x.runs[0], id: 42500000001 }); x.runInventoryTotalCount = 2;
    }],
    ['duplicate run identity', x => {
      x.runs.push({ ...x.runs[0] }); x.runInventoryTotalCount = 2;
    }],
    ['unbound extra workflow run', x => {
      x.runs.push({ ...x.runs[0], id: 42500000002, display_title: 'manual' });
      x.runInventoryTotalCount = 2;
    }],
  ];
  for (const [name, mutate] of cases) await sub.test(name, () => {
    const x = githubFixture();
    mutate(x);
    const result = githubReadback(x);
    assert.equal(result.ok, false);
    assert.equal(result.reviewLaunchAllowed, false);
    assert.equal(result.mergeAuthority, false);
  });
});
