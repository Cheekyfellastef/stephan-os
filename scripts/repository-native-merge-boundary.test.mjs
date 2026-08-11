import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publishScript = new URL('./repository-native-publish-merge-lane.mjs', import.meta.url);
const protectedMergeScript = new URL('./operator-protected-merge-gate-v2.mjs', import.meta.url);
const personalRepositoryMergeScript = new URL('./operator-protected-personal-repository-merge.mjs', import.meta.url);
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

test('protected boundary keeps the native queue and adds only the exact user-owned dispatch fallback', async () => {
  const protectedSource = await readFile(protectedWorkflow, 'utf8');
  const independentSource = await readFile(independentWorkflow, 'utf8');
  assert.match(protectedSource, /^  merge_group:\s*$/m);
  assert.match(protectedSource, /^    types: \[checks_requested\]\s*$/m);
  assert.match(protectedSource, /^  workflow_dispatch:\s*$/m);
  assert.match(protectedSource, /run-name: Protected operator merge \$\{\{ github\.event\.merge_group\.head_sha \|\| inputs\.expected_head \|\| github\.run_id \}\}/);
  assert.doesNotMatch(protectedSource, /pull_request_target:|^\s+pull_request:\s*$/m);
  assert.equal(
    [...protectedSource.matchAll(/ref: \$\{\{ github\.event\.merge_group\.base_sha \}\}/g)].length,
    2,
  );
  assert.equal([...protectedSource.matchAll(/ref: \$\{\{ github\.sha \}\}/g)].length, 3);
  assert.equal([...protectedSource.matchAll(/persist-credentials: false/g)].length, 5);
  assert.match(protectedSource, /merge-group-evidence:/);
  assert.match(protectedSource, /operator-merge-queue-boundary:/);
  assert.match(protectedSource, /needs: \[merge-group-evidence\]/);
  assert.match(protectedSource, /operator-protected-merge-gate-v2\.mjs evidence/);
  assert.match(protectedSource, /operator-protected-merge-gate-v2\.mjs approve/);
  assert.match(protectedSource, /group: protected-operator-merge-\$\{\{ github\.event\.merge_group\.head_sha \|\| inputs\.expected_head \|\| github\.run_id \}\}/);
  assert.match(protectedSource, /cancel-in-progress: false/);
  assert.match(protectedSource, /personal-repository-evidence:/);
  assert.match(protectedSource, /operator-personal-repository-approval:/);
  assert.match(protectedSource, /operator-personal-repository-squash-merge:/);
  assert.match(protectedSource, /needs: \[personal-repository-evidence, operator-personal-repository-approval\]/);
  assert.equal([...protectedSource.matchAll(/contents: write/g)].length, 1);
  assert.equal([...protectedSource.matchAll(/issues: write/g)].length, 1);
  assert.equal([...protectedSource.matchAll(/pull-requests: write/g)].length, 1);
  assert.equal([...protectedSource.matchAll(/actions\/create-github-app-token@v2/g)].length, 1);
  assert.equal([...protectedSource.matchAll(/secrets\.STEPHANOS_RULESET_PROOF_APP_ID/g)].length, 1);
  assert.equal([...protectedSource.matchAll(/secrets\.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY/g)].length, 1);
  assert.equal([...protectedSource.matchAll(/STEPHANOS_RULESET_PROOF_TOKEN:/g)].length, 1);
  assert.match(protectedSource, /permission-administration: read/);
  const approvalJob = protectedSource.slice(
    protectedSource.indexOf('  operator-personal-repository-approval:'),
    protectedSource.indexOf('  operator-personal-repository-squash-merge:'),
  );
  assert.match(approvalJob, /actions\/create-github-app-token@v2/);
  assert.match(approvalJob, /STEPHANOS_RULESET_PROOF_TOKEN: \$\{\{ steps\.ruleset-proof-token\.outputs\.token \}\}/);
  assert.doesNotMatch(protectedSource, /\b(?:actions|deployments|statuses|checks): write\b/);
  assert.doesNotMatch(protectedSource, /recover|repository_dispatch|workflow_call|continue-on-error/);

  assert.match(independentSource, /pull_request_target:/);
  assert.match(independentSource, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(independentSource, /persist-credentials: false/);
  assert.match(independentSource, /independent-merge-security-review-v2\.mjs/);
});

test('personal-repository executor is workflow-dispatch-only and performs one exact-head squash without branch deletion', async () => {
  const source = await readFile(personalRepositoryMergeScript, 'utf8');
  assert.match(source, /GITHUB_EVENT_NAME !== 'workflow_dispatch'/);
  assert.match(source, /triggering_actor\?\.login \|\| run\?\.actor\?\.login/);
  assert.match(source, /validatePersonalRepositoryEvidence/);
  assert.match(source, /validatePersonalRepositoryConfiguration/);
  assert.match(source, /validatePersonalRepositoryWorkflowRuns/);
  assert.match(source, /authorization === 'omit' && \(method !== 'GET' \|\| body !== null\)/);
  assert.match(source, /personal-repository-public-rules-api/);
  assert.match(source, /rules\/branches\/main[\s\S]*?authorization: 'omit'/);
  assert.match(source, /rulesets\/\$\{rulesetId\}[\s\S]*?authorization: requireBypassProof \? 'ruleset-proof' : 'omit'/);
  assert.match(source, /STEPHANOS_RULESET_PROOF_TOKEN/);
  assert.match(source, /Ruleset proof token is restricted to bounded repository ruleset-detail GET requests/);
  assert.doesNotMatch(source, /GH_TOKEN[^\n]*rules|GITHUB_TOKEN[^\n]*rules/);
  assert.match(source, /loadSelectedIndependentReview/);
  assert.match(source, /personal-repository-prior-attempt-exists/);
  assert.match(source, /expectedDisplayTitle = `Protected operator merge \$\{context\.dispatch\.identity\.sourceHead\}`/);
  assert.doesNotMatch(source, /expectedDisplayTitle = `Protected operator merge PR #/);
  assert.match(source, /validatePersonalRepositoryApprovalReceipt/);
  assert.match(source, /method: 'PUT',[\s\S]*?merge_method: 'squash',[\s\S]*?sha: receipt\.sourceHead/);
  assert.equal([...source.matchAll(/pulls\/\$\{receipt\.prNumber\}\/merge/g)].length, 1);
  assert.doesNotMatch(source, /delete_branch|DELETE|git\s+(?:push|reset|clean|rebase)|--force/);
  assert.doesNotMatch(source, /\b(?:eval|execSync)\s*\(|shell\s*:\s*true/);
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
