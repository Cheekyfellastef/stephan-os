import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSovereignRescueMergeReadinessV1 as inspect } from './sovereignRescueMergeReadinessV1.mjs';
import { buildIndependentReviewArtifact } from './operatorMergeReviewArtifactV1.mjs';
import { PROTECTED_MERGE_REQUIRED_WORKFLOWS } from './protectedMergeCheckClassifierV1.mjs';

const repo = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40), base = 'b'.repeat(40), now = '2026-10-14T10:00:00.000Z';
const fixture = () => {
  const reviewArtifact = buildIndependentReviewArtifact({ repository: repo, prNumber: 3104,
    branch: 'rescue-island/preflight-v1-3103', sourceHead: head, baseSha: base,
    workflowRunId: 100, workflowRunAttempt: 1, createdAtUtc: now,
    analysis: { findings: [], counts: { P0: 0, P1: 0, P2: 0 }, verdict: 'clean',
      proofRefs: ['proofs/diff/complete'], finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN' } });
  return { repository: repo, nowUtc: now, observedAtUtc: now, mainHead: base,
    pullRequest: { number: 3104, title: 'Rescue Island preflight', state: 'open', merged: false,
      draft: false, mergeable: true, mergeable_state: 'unstable',
      head: { sha: head, ref: 'rescue-island/preflight-v1-3103', repo: { full_name: repo } },
      base: { sha: base, ref: 'main', repo: { full_name: repo } } },
    threads: { hasMore: false, totalCount: 1, items: [{ id: 'thread-1', is_resolved: true }] },
    checkRows: PROTECTED_MERGE_REQUIRED_WORKFLOWS.map(workflow => ({ workflow, name: 'proof', state: 'SUCCESS', sourceHead: head })),
    reviewArtifact, reviewArtifactMetadata: { total_count: 1, artifacts: [{ id: 200,
      name: reviewArtifact.artifactName, expired: false, size_in_bytes: 4096,
      digest: `sha256:${'c'.repeat(64)}`, workflow_run: { id: 100 } }] },
    priorRuns: { hasMore: false, totalCount: 0, items: [] }, priorJobSets: [],
  };
};
const prior = (overrides = {}) => ({ id: 300, run_attempt: 1, repository: { full_name: repo },
  event: 'workflow_dispatch', head_branch: 'main', head_sha: base,
  path: `${repo}/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main`,
  name: `Protected operator merge ${head}`, display_title: `Protected operator merge ${head}`,
  status: 'completed', conclusion: 'failure', ...overrides });
function withRun(run) { const x = fixture(); x.priorRuns = { hasMore: false, totalCount: 1, items: [run] }; return x; }
function held(input, blocker) { const r = inspect(input); assert.equal(r.verdict, 'HELD'); assert.ok(r.blockers.includes(blocker), r.blockers.join(',')); }

test('structural readiness never authenticates observations or grants any execution authority', () => {
  const r = inspect(fixture());
  assert.equal(r.verdict, 'STRUCTURALLY_READY_FOR_PROTECTED_REVALIDATION');
  for (const flag of ['observationsAuthenticated', 'dispatchAllowed', 'mergeAllowed',
    'runtimeMutationAllowed', 'reviewThreadResolutionAllowed', 'leaseAccessAllowed',
    'productionIslandCommissioningAllowed']) assert.equal(r[flag], false);
});
test('open, unknown or incomplete review thread inventories stop before dispatch', () => {
  for (const threads of [undefined, { hasMore: true, totalCount: 1, items: [] },
    { hasMore: false, totalCount: 2, items: [] },
    { hasMore: false, totalCount: 1, items: [{ id: 'thread-1', is_resolved: false }] }])
    held({ ...fixture(), threads }, 'COMPLETE_RESOLVED_TECHNICAL_THREADS_REQUIRED');
});
test('stacked child and stale base/evidence require fresh qualification', () => {
  const x = fixture(); x.pullRequest.base.ref = 'rescue-island/preflight-v1-3103';
  held(x, 'REQUALIFY_AGAINST_CURRENT_MAIN_REQUIRED');
  held({ ...fixture(), mainHead: 'd'.repeat(40) }, 'REQUALIFY_AGAINST_CURRENT_MAIN_REQUIRED');
  held({ ...fixture(), nowUtc: '2026-10-14T10:02:00.000Z' }, 'FRESH_PRIMARY_OBSERVATIONS_REQUIRED');
});
test('forged or other-head review artifacts, expired archives and non-green CI are held', () => {
  let x = fixture(); x.reviewArtifact = { ...x.reviewArtifact, sourceHead: 'd'.repeat(40) };
  held(x, 'EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');
  x = fixture(); x.reviewArtifactMetadata.artifacts[0].expired = true;
  held(x, 'EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');
  x = fixture(); x.checkRows[0].state = 'FAILURE';
  held(x, 'CANONICAL_EXACT_HEAD_CI_REQUIRED');
});
test('authority-stage same-base failure is held even after all threads become resolved', () => {
  const x = withRun(prior());
  x.priorJobSets = [{ runId: 300, jobs: [{ name: 'operator-personal-repository-squash-merge', conclusion: 'failure' }] }];
  held(x, 'SAME_BASE_PROTECTED_REPLAY_HELD');
});
test('active, completed-successful, rerun, malformed and omitted prior attempts cannot be hidden', () => {
  held(withRun(prior({ status: 'in_progress' })), 'MATCHING_PROTECTED_ATTEMPT_STILL_ACTIVE');
  held(withRun(prior({ conclusion: 'success' })), 'MATCHING_PROTECTED_ATTEMPT_NOT_A_FAILED_RUN');
  held(withRun(prior({ run_attempt: 2 })), 'PRIOR_PROTECTED_ATTEMPT_IDENTITY_UNPROVEN');
  held({ ...fixture(), priorRuns: { hasMore: true, totalCount: 0, items: [] } }, 'COMPLETE_PROTECTED_ATTEMPT_HISTORY_REQUIRED');
  held({ ...fixture(), priorJobSets: undefined }, 'COMPLETE_PROTECTED_ATTEMPT_HISTORY_REQUIRED');
  for (const path of [null, 3, ['wrong'], `${repo}/.github/workflows/operator-merge-approval-gate.yml@refs/heads/other`])
    held(withRun(prior({ path })), 'PRIOR_PROTECTED_ATTEMPT_IDENTITY_UNPROVEN');
});

test('duplicated thread identifiers cannot masquerade as a complete resolved inventory', () => {
  const x = fixture(); x.threads.items.push({ ...x.threads.items[0] }); x.threads.totalCount = 2;
  held(x, 'COMPLETE_RESOLVED_TECHNICAL_THREADS_REQUIRED');
});
test('different-base failed attempt uses existing continuation only after fresh review and CI', () => {
  const x = withRun(prior({ head_sha: 'd'.repeat(40) }));
  assert.equal(inspect(x).verdict, 'STRUCTURALLY_READY_FOR_PROTECTED_REVALIDATION');
  x.reviewArtifact = { ...x.reviewArtifact, baseSha: 'd'.repeat(40) };
  held(x, 'EXACT_HEAD_BASE_CLEAN_REVIEW_ARTIFACT_REQUIRED');
});
