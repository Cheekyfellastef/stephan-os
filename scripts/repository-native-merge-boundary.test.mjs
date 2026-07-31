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

test('protected boundary is an exact merge-group required check with read-only permissions', async () => {
  const protectedSource = await readFile(protectedWorkflow, 'utf8');
  const independentSource = await readFile(independentWorkflow, 'utf8');
  assert.match(protectedSource, /^  merge_group:\s*$/m);
  assert.match(protectedSource, /^    types: \[checks_requested\]\s*$/m);
  assert.doesNotMatch(protectedSource, /pull_request_target:|^\s+pull_request:\s*$/m);
  assert.equal(
    [...protectedSource.matchAll(/ref: \$\{\{ github\.event\.merge_group\.base_sha \}\}/g)].length,
    2,
  );
  assert.equal([...protectedSource.matchAll(/persist-credentials: false/g)].length, 2);
  assert.match(protectedSource, /merge-group-evidence:/);
  assert.match(protectedSource, /operator-merge-queue-boundary:/);
  assert.match(protectedSource, /needs: \[merge-group-evidence\]/);
  assert.match(protectedSource, /operator-protected-merge-gate-v2\.mjs evidence/);
  assert.match(protectedSource, /operator-protected-merge-gate-v2\.mjs approve/);
  assert.match(protectedSource, /group: protected-operator-merge-group-\$\{\{ github\.event\.merge_group\.head_sha \}\}/);
  assert.match(protectedSource, /cancel-in-progress: false/);
  assert.doesNotMatch(protectedSource, /\b(?:actions|contents|deployments|issues|pull-requests|statuses|checks): write\b/);
  assert.doesNotMatch(protectedSource, /recover|dispatch|deploy|continue-on-error/);

  assert.match(independentSource, /pull_request_target:/);
  assert.match(independentSource, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(independentSource, /persist-credentials: false/);
  assert.match(independentSource, /independent-merge-security-review-v2\.mjs/);
});

test('independent review binds the complete review to the exact base without merge authority', async () => {
  const source = await readFile(independentReviewScript, 'utf8');
  assert.match(source, /event\?\.pull_request\?\.base\?\.sha/);
  assert.match(source, /buildIndependentReviewArtifact/);
  assert.match(source, /validatePullRequestBaseBinding/);
  assert.match(source, /validateMainRefBaseBinding/);
  assert.match(source, /git\/ref\/heads\/main/);
  assert.doesNotMatch(source, /\bgh\s+pr\s+(?:ready|merge)\b/);
  assert.doesNotMatch(source, /git\s+(?:push|reset|clean|rebase)/);
});

test('protected executor only verifies the exact merge group and never mutates or claims delivery', async () => {
  const source = await readFile(protectedMergeScript, 'utf8');
  assert.match(source, /GITHUB_ACTIONS !== 'true'/);
  assert.match(source, /GITHUB_EVENT_NAME !== 'merge_group'/);
  assert.match(source, /event\.action !== 'checks_requested'/);
  assert.match(source, /commits\/\$\{context\.mergeGroupSha\}\/pulls/);
  assert.doesNotMatch(source, /merge_group\?\.head_ref|merge_group\.head_ref/);
  assert.match(source, /validateMergeGroupEvidence/);
  assert.match(source, /validateMergeQueueConfiguration/);
  assert.match(source, /native change-request state/);
  assert.match(source, /Object\.hasOwn\(pullRequest, 'reviewDecision'\)/);
  assert.match(source, /buildMergeQueueApprovalReceipt/);
  assert.match(source, /validateMergeQueueApprovalReceipt/);
  assert.match(source, /validateIndependentReviewArtifact/);
  assert.match(source, /git\/ref\/heads\/main/);
  assert.match(source, /rules\/branches\/main/);
  assert.match(source, /CONFIGURATION_NOT_PROVED:ruleset-detail-read/);
  assert.match(source, /MERGE_QUEUE_REQUIRED_CHECK_READY/);
  assert.match(source, /mutationAuthority: false/);
  assert.doesNotMatch(source, /\bgit\s+(?:push|reset|clean|rebase)|--force-with-lease|commit-tree|merge-tree/);
  assert.doesNotMatch(source, /pulls\/\$\{[^}]+\}\/merge|\/statuses|check-runs|dispatches/);
  assert.doesNotMatch(source, /MERGED|DELIVERED|PAGES_DEPLOY|windowsRuntimeStatus|browserRuntimeStatus/);
});

test('single-owner queue policy does not depend on impossible native self-approval', async () => {
  const source = await readFile(
    new URL('../shared/agents/operatorMergeBaseBindingV1.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /required_approving_review_count !== 0/);
  assert.match(source, /merge-group-changes-requested/);
  assert.match(source, /require_last_push_approval !== false/);
  assert.match(source, /require_code_owner_review !== false/);
  assert.doesNotMatch(source, /reviewDecision !== 'APPROVED'/);
  assert.doesNotMatch(source, /required_approving_review_count < 1/);
});
