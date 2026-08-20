import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reviewerWorkflow = readFileSync(
  new URL('../../.github/workflows/independent-merge-security-review.yml', import.meta.url),
  'utf8',
);
const coordinatorWorkflow = readFileSync(
  new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url),
  'utf8',
);
const reviewerSource = readFileSync(
  new URL('../../scripts/independent-merge-security-review-v2.mjs', import.meta.url),
  'utf8',
);
const preflightSource = readFileSync(
  new URL('../../scripts/prepare-independent-review-workflow-dispatch-v1.mjs', import.meta.url),
  'utf8',
);
const launcherSource = readFileSync(
  new URL('../../scripts/launch-missing-independent-review-v1.mjs', import.meta.url),
  'utf8',
);

const sixInputs = [
  'pr_number',
  'source_head',
  'base_sha',
  'head_branch',
  'handoff_binding_sha256',
  'handoff_run_receipt_sha256',
];

test('independent reviewer exposes only the closed-world Stage-2 workflow_dispatch contract', () => {
  assert.match(reviewerWorkflow, /workflow_dispatch:\s*\n/);
  for (const input of sixInputs) {
    assert.match(reviewerWorkflow, new RegExp(`\\n\\s{6}${input}:\\n[\\s\\S]*?required: true`));
  }
  assert.match(
    reviewerWorkflow,
    /run-name:[\s\S]*Independent Merge Security Review PR #\{0\} head \{1\} base \{2\}/,
  );
  assert.match(reviewerWorkflow, /Preflight exact Stage-1 workflow-dispatch identity/);
  assert.match(reviewerWorkflow, /Download exact immutable coordinator handoff receipt/);
  assert.match(reviewerWorkflow, /run-id: \$\{\{ steps\.dispatch_preflight\.outputs\.coordinator_run_id \}\}/);
  assert.doesNotMatch(reviewerWorkflow, /contents:\s*write|deployments:\s*write|packages:\s*write/);
});

test('workflow_dispatch review executes only after Stage-1 identity and immutable receipt validation', () => {
  assert.match(reviewerSource, /validateIndependentReviewWorkflowDispatchRunV1\(/);
  assert.match(reviewerSource, /eventName === 'pull_request_target'/);
  assert.match(reviewerSource, /eventName !== 'workflow_dispatch'/);
  assert.match(reviewerSource, /workflowDispatchInputs/);
  assert.match(reviewerSource, /STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_IDENTITY_PATH/);
  assert.match(reviewerSource, /STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_PATH/);
  assert.match(preflightSource, /selectExactReviewDispatchCommentV1/);
  assert.match(preflightSource, /validateIndependentReviewHandoffIdentityV1/);
  assert.doesNotMatch(preflightSource, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
});

test('canonical coordinator launches only through the bounded launcher and suppresses immediate retry after launch', () => {
  assert.match(coordinatorWorkflow, /Launch one missing exact independent review/);
  assert.match(coordinatorWorkflow, /node scripts\/launch-missing-independent-review-v1\.mjs/);
  assert.match(coordinatorWorkflow, /steps\.launch_missing_review\.outputs\.launch_requested != 'true'/);
  assert.match(launcherSource, /planIndependentReviewMissingRunLaunchV1/);
  assert.match(launcherSource, /INDEPENDENT_REVIEW_RETRY_DECISION\.NO_MATCHING_RUN/);
  assert.match(launcherSource, /exactRunAbsenceImmediatelyBeforeDispatch|loadLaunchState/);
  assert.match(launcherSource, /actions\/workflows\/\$\{state\.workflow\.id\}\/dispatches/);
  assert.match(launcherSource, /ref: 'main'/);
  assert.doesNotMatch(launcherSource, /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|contents:\s*write/i);
});
