import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publishScript = new URL('./repository-native-publish-merge-lane.mjs', import.meta.url);
const protectedMergeScript = new URL('./operator-protected-merge-gate.mjs', import.meta.url);
const independentReviewScript = new URL('./independent-merge-security-review.mjs', import.meta.url);
const protectedWorkflow = new URL('../.github/workflows/operator-merge-approval-gate.yml', import.meta.url);
const independentReviewWorkflow = new URL('../.github/workflows/independent-merge-security-review.yml', import.meta.url);
const packageFile = new URL('../package.json', import.meta.url);

test('ordinary publication path cannot mark ready or merge', async () => {
  const source = await readFile(publishScript, 'utf8');
  assert.match(source, /--draft/);
  assert.match(source, /AWAITING_PROTECTED_OPERATOR_APPROVAL/);
  assert.match(source, /mergeAuthority: false/);
  assert.doesNotMatch(source, /\['pr', 'ready'/);
  assert.doesNotMatch(source, /\['pr', 'merge'/);
  assert.doesNotMatch(source, /APPROVE_REPOSITORY_NATIVE_EXACT_HEAD_MERGE/);
});

test('no local npm command exposes merge authority', async () => {
  const packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
  assert.equal(packageJson.scripts['stephanos:approved-merge'], undefined);
  assert.equal(packageJson.scripts['stephanos:publish-merge'], 'node scripts/repository-native-publish-merge-lane.mjs');
});

test('trusted merge gate runs from pull_request_target and checks out only default-branch code', async () => {
  const workflow = await readFile(protectedWorkflow, 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /name: operator-merge-approval/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /operator-approval-gate/);
  assert.match(workflow, /operator-approved-exact-head-merge/);
});

test('independent reviewer is a separate read-only trusted-default-branch workflow', async () => {
  const workflow = await readFile(independentReviewWorkflow, 'utf8');
  const source = await readFile(independentReviewScript, 'utf8');
  assert.match(workflow, /name: Independent Merge Security Review/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.match(source, /buildProtectedSecurityReviewReceipt/);
  assert.match(source, /analyzeIndependentSecurityReview/);
  assert.match(source, /validateExactHeadWorkflowRuns/);
  assert.match(source, /PROTECTED_REVIEW_MARKER/);
  assert.doesNotMatch(source, /\bgh\s+pr\s+(?:ready|merge)\b/);
  assert.doesNotMatch(source, /git\s+(?:push|reset|clean|rebase)/);
});

test('operator approval consumes but cannot mint the independent review receipt', async () => {
  const source = await readFile(protectedMergeScript, 'utf8');
  assert.match(source, /GITHUB_ACTIONS !== 'true'/);
  assert.match(source, /GITHUB_EVENT_NAME !== 'pull_request_target'/);
  assert.match(source, /OPERATOR_MERGE_GATE_JOB/);
  assert.match(source, /OPERATOR_MERGE_EXECUTOR_JOB/);
  assert.match(source, /github-actions\[bot\]/);
  assert.match(source, /PROTECTED_REVIEW_MARKER/);
  assert.doesNotMatch(source, /buildProtectedSecurityReviewReceipt/);
  assert.match(source, /loadIndependentReview/);
  assert.match(source, /parseIndependentReviewSessionId/);
  assert.match(source, /validateIndependentReviewWorkflowRun/);
  assert.match(source, /validateProtectedOperatorMergeEvidence/);
  assert.match(source, /actions\/runs\/\$\{candidate\.identity\.workflowRunId\}\/jobs/);
  assert.match(source, /actions\/runs\/\$\{runId\}\/jobs/);
  assert.match(source, /--match-head-commit/);
  assert.match(source, /'pr', 'merge'/);
  assert.doesNotMatch(source, /reviewBodies/);
  assert.doesNotMatch(source, /request\.approvalReceipt/);
  assert.doesNotMatch(source, /request\.trustedReviewReceipt/);
  assert.doesNotMatch(source, /nonce/);
});
