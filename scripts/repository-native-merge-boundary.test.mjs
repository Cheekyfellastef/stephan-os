import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publishScript = new URL('./repository-native-publish-merge-lane.mjs', import.meta.url);
const protectedMergeScript = new URL('./operator-protected-merge-gate-v2.mjs', import.meta.url);
const independentReviewScript = new URL('./independent-merge-security-review-v2.mjs', import.meta.url);
const protectedWorkflow = new URL('../.github/workflows/operator-merge-approval-gate.yml', import.meta.url);
const independentWorkflow = new URL('../.github/workflows/independent-merge-security-review.yml', import.meta.url);
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

test('trusted workflows use default-branch code and the base-bound v2 executors', async () => {
  const protectedSource = await readFile(protectedWorkflow, 'utf8');
  const independentSource = await readFile(independentWorkflow, 'utf8');
  for (const source of [protectedSource, independentSource]) {
    assert.match(source, /pull_request_target:/);
    assert.doesNotMatch(source, /^\s+pull_request:\s*$/m);
    assert.match(source, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(source, /persist-credentials: false/);
    assert.doesNotMatch(source, /github\.event\.pull_request\.head\.sha/);
  }
  assert.match(protectedSource, /operator-protected-merge-gate-v2\.mjs approve/);
  assert.match(protectedSource, /operator-protected-merge-gate-v2\.mjs merge/);
  assert.match(independentSource, /independent-merge-security-review-v2\.mjs/);
});

test('independent review binds the complete review to the exact base without merge authority', async () => {
  const source = await readFile(independentReviewScript, 'utf8');
  assert.match(source, /event\?\.pull_request\?\.base\?\.sha/);
  assert.match(source, /bindIndependentReviewReceiptToBase/);
  assert.match(source, /validatePullRequestBaseBinding/);
  assert.match(source, /validateMainRefBaseBinding/);
  assert.match(source, /git\/ref\/heads\/main/);
  assert.doesNotMatch(source, /\bgh\s+pr\s+(?:ready|merge)\b/);
  assert.doesNotMatch(source, /git\s+(?:push|reset|clean|rebase)/);
});

test('only the protected GitHub Actions v2 script can merge and it revalidates exact head and base', async () => {
  const source = await readFile(protectedMergeScript, 'utf8');
  assert.match(source, /GITHUB_ACTIONS !== 'true'/);
  assert.match(source, /GITHUB_EVENT_NAME !== 'pull_request_target'/);
  assert.match(source, /OPERATOR_MERGE_GATE_JOB/);
  assert.match(source, /OPERATOR_MERGE_EXECUTOR_JOB/);
  assert.match(source, /github-actions\[bot\]/);
  assert.match(source, /validateIndependentReviewBaseBinding/);
  assert.match(source, /validateIndependentWorkflowBaseBinding/);
  assert.match(source, /validatePullRequestBaseBinding/);
  assert.match(source, /validateMainRefBaseBinding/);
  assert.match(source, /buildBaseBoundApprovalReceipt/);
  assert.match(source, /validateBaseBoundApprovalReceipt/);
  assert.match(source, /git\/ref\/heads\/main/);
  assert.match(source, /immediately-before-merge/);
  assert.match(source, /--match-head-commit/);
  assert.match(source, /'pr', 'merge'/);
  assert.doesNotMatch(source, /request\.approvalReceipt/);
  assert.doesNotMatch(source, /request\.trustedReviewReceipt/);
  assert.doesNotMatch(source, /nonce/);
});
