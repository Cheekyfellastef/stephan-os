import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publishScript = new URL('./repository-native-publish-merge-lane.mjs', import.meta.url);
const protectedMergeScript = new URL('./operator-protected-merge-gate-v2.mjs', import.meta.url);
const personalRepositoryMergeScript = new URL('./operator-protected-personal-repository-merge.mjs', import.meta.url);
const independentReviewScript = new URL('./independent-merge-security-review-v2.mjs', import.meta.url);
const personalRepositoryMergeContract = new URL('../shared/agents/operatorPersonalRepositoryMergeV1.mjs', import.meta.url);
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

test('protected boundary keeps the native queue and adds only the exact mobile-safe user-owned dispatch fallback', async () => {
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
  assert.equal([...protectedSource.matchAll(/actions\/create-github-app-token@v2/g)].length, 3);
  assert.equal([...protectedSource.matchAll(/secrets\.STEPHANOS_RULESET_PROOF_APP_ID/g)].length, 3);
  assert.equal([...protectedSource.matchAll(/secrets\.STEPHANOS_RULESET_PROOF_APP_PRIVATE_KEY/g)].length, 3);
  assert.equal([...protectedSource.matchAll(/STEPHANOS_RULESET_PROOF_TOKEN:/g)].length, 3);
  assert.equal([...protectedSource.matchAll(/permission-administration: write/g)].length, 3);
  assert.equal([...protectedSource.matchAll(/steps\.ruleset-proof-token\.outputs\.token/g)].length, 3);
  assert.doesNotMatch(protectedSource, /permission-(?!administration: write)/);
  assert.doesNotMatch(protectedSource, /skip-token-revoke:/);
  assert.equal([...protectedSource.matchAll(/name: operator-merge-approval/g)].length, 1);
  assert.match(protectedSource, /readonly CANONICAL_OPERATOR='Cheekyfellastef'/);
  const mergeQueueJob = protectedSource.slice(
    protectedSource.indexOf('  operator-merge-queue-boundary:'),
    protectedSource.indexOf('  personal-repository-evidence:'),
  );
  const evidenceJob = protectedSource.slice(
    protectedSource.indexOf('  personal-repository-evidence:'),
    protectedSource.indexOf('  operator-personal-repository-approval:'),
  );
  const approvalJob = protectedSource.slice(
    protectedSource.indexOf('  operator-personal-repository-approval:'),
    protectedSource.indexOf('  operator-personal-repository-squash-merge:'),
  );
  const mergeJob = protectedSource.slice(
    protectedSource.indexOf('  operator-personal-repository-squash-merge:'),
  );
  assert.match(mergeQueueJob, /environment:\s*\n      name: operator-merge-approval/);
  assert.match(evidenceJob, /actions\/create-github-app-token@v2/);
  assert.match(evidenceJob, /STEPHANOS_RULESET_PROOF_TOKEN: \$\{\{ steps\.ruleset-proof-token\.outputs\.token \}\}/);
  assert.doesNotMatch(evidenceJob, /environment:\s*\n      name: operator-merge-approval/);
  assert.match(evidenceJob, /Collect exact personal-repository evidence after protected admission/);
  assert.doesNotMatch(evidenceJob, /contents: write|issues: write|pull-requests: write/);
  assert.match(approvalJob, /actions\/create-github-app-token@v2/);
  assert.match(approvalJob, /STEPHANOS_RULESET_PROOF_TOKEN: \$\{\{ steps\.ruleset-proof-token\.outputs\.token \}\}/);
  assert.match(approvalJob, /needs: \[personal-repository-evidence\]/);
  assert.match(approvalJob, /Re-prove immutable evidence after protected approval/);
  assert.doesNotMatch(approvalJob, /environment:\s*\n      name: operator-merge-approval/);
  assert.doesNotMatch(approvalJob, /contents: write|issues: write|pull-requests: write/);
  assert.match(mergeJob, /actions\/create-github-app-token@v2/);
  assert.match(mergeJob, /STEPHANOS_RULESET_PROOF_TOKEN: \$\{\{ steps\.ruleset-proof-token\.outputs\.token \}\}/);
  assert.match(mergeJob, /needs: \[personal-repository-evidence, operator-personal-repository-approval\]/);
  assert.match(mergeJob, /Re-prove, squash exact head and publish the bounded receipt/);
  assert.doesNotMatch(mergeJob, /environment:\s*\n      name: operator-merge-approval/);
  assert.doesNotMatch(protectedSource, /\b(?:actions|deployments|statuses|checks): write\b/);
  assert.doesNotMatch(protectedSource, /recover|repository_dispatch|workflow_call|continue-on-error/);
  assert.doesNotMatch(protectedSource, /STEPHANOS_RULESET_PROOF_TOKEN[^\n]*(?:GITHUB_OUTPUT|GITHUB_ENV|upload-artifact)/i);

  assert.match(independentSource, /pull_request_target:/);
  assert.match(independentSource, /^  workflow_dispatch:\s*$/m);
  assert.match(independentSource, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(independentSource, /ref: \$\{\{ github\.sha \}\}/);
  assert.equal([...independentSource.matchAll(/persist-credentials: false/g)].length, 2);
  assert.match(independentSource, /independent-merge-security-review-entry-v1\.mjs/);
});

test('personal-repository executor is workflow-dispatch-only and performs one exact-head squash without branch deletion', async () => {
  const source = await readFile(personalRepositoryMergeScript, 'utf8');
  assert.match(source, /GITHUB_EVENT_NAME !== 'workflow_dispatch'/);
  assert.match(source, /triggering_actor\?\.login \|\| run\?\.actor\?\.login/);
  assert.match(source, /validatePersonalRepositoryEvidence/);
  assert.match(source, /validatePersonalRepositoryCheckRunsWithBoundedReread/);
  assert.match(source, /validatePersonalRepositoryWorkflowRunHydration/);
  assert.match(source, /hydrateExactHeadWorkflowRuns/);
  assert.match(source, /actions\/runs\/\$\{run\?\.id\}/);
  assert.doesNotMatch(source, /CHECK_SNAPSHOT_REREAD_DELAY_MS/);
  assert.match(source, /if \(attempt === 1\) return initialCheckSnapshot/);
  assert.match(source, /snapshotAttempts: checks\.snapshotAttempts/);
  assert.match(source, /acceptedWorkflowRuns = checks\.selectedSnapshot\.workflowRuns/);
  assert.match(source, /validatePersonalRepositoryWorkflowRuns\([\s\S]*?acceptedWorkflowRuns/);
  assert.match(source, /validatePersonalRepositoryConfiguration/);
  assert.match(source, /validatePersonalRepositoryWorkflowRuns/);
  assert.match(source, /authorization === 'omit' && \(method !== 'GET' \|\| body !== null\)/);
  assert.match(source, /validatePersonalRepositoryRulesetProofRequest/);
  assert.match(source, /executeBoundedPersonalRepositoryRead/);
  assert.match(source, /request: \(\) => fetch/);
  assert.match(source, /redirect: authorization === 'ruleset-proof' \? 'error' : 'follow'/);
  assert.match(source, /validatePersonalRepositoryRulesetProofResponse/);
  assert.match(source, /consume: async \(boundedResponse\) => Buffer\.from\(await boundedResponse\.arrayBuffer\(\)\)/);
  assert.equal([...source.matchAll(/executeBoundedPersonalRepositoryRead/g)].length, 2);
  assert.match(source, /executePersonalRepositoryArtifactArchiveTransport/);
  assert.match(source, /accept = 'application\/vnd\.github\+json'/);
  assert.match(source, /requestApiRedirect: \(request\) => fetch\(request\.url/);
  assert.match(source, /requestArchive: \(request\) => fetch\(request\.url/);
  assert.doesNotMatch(source, /accept: 'application\/octet-stream'/);
  assert.match(source, /personal-repository-public-rules-api/);
  assert.match(source, /repos\/\$\{context\.owner\}\/\$\{context\.repo\}`, \{ authorization: 'ruleset-proof' \}/);
  assert.match(source, /rules\/branches\/main[\s\S]*?authorization: 'ruleset-proof'/);
  assert.match(source, /rulesets\/\$\{rulesetId\}[\s\S]*?authorization: 'ruleset-proof'/);
  assert.match(source, /STEPHANOS_RULESET_PROOF_TOKEN/);
  assert.match(source, /extractPersonalRepositoryArtifactZip\(archiveBytes, INDEPENDENT_REVIEW_ARTIFACT_FILE\)/);
  assert.doesNotMatch(source, /node:child_process|\bspawn(?:Sync)?\b|\bexec(?:File|Sync)?\b|\bunzip\b|shell\s*:/i);
  assert.doesNotMatch(source, /mkdtempSync|writeFileSync|rmSync|node:os|node:path/);
  assert.doesNotMatch(source, /adm-zip|jszip|yauzl|unzipper|node-stream-zip/i);
  assert.match(source, /Ruleset proof token is restricted to bounded repository-configuration GET requests/);
  assert.doesNotMatch(source, /GH_TOKEN[^\n]*rules|GITHUB_TOKEN[^\n]*rules/);
  assert.match(source, /loadSelectedIndependentReview/);
  assert.match(source, /personal-repository-prior-attempt-exists/);
  assert.match(source, /execution\.replayRunIds\.length > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX/);
  assert.match(source, /execution\.blockers\.includes\('personal-repository-prior-run-attempt-limit-exceeded'\)/);
  assert.match(source, /actions\/runs\/\$\{runId\}\/jobs/);
  assert.match(source, /jobs\?filter=all/);
  assert.match(source, /retryablePriorFailures: execution\.retryablePriorFailures/);
  assert.match(source, /retryablePriorFailures: collected\.packet\.retryablePriorFailures/);
  assert.match(source, /expectedDisplayTitle = `Protected operator merge \$\{context\.dispatch\.identity\.sourceHead\}`/);
  assert.doesNotMatch(source, /expectedDisplayTitle = `Protected operator merge PR #/);
  assert.match(source, /mismatches: runIdentityMismatches/);
  assert.doesNotMatch(source, /mismatches:[^\n]*run\?\./);
  assert.doesNotMatch(source, /jobs\?filter=latest/);
  assert.match(source, /validatePersonalRepositoryApprovalReceipt/);
  assert.match(source, /PERSONAL_REPOSITORY_EVIDENCE_READY_AFTER_PROTECTED_ADMISSION/);
  assert.match(source, /PERSONAL_REPOSITORY_PROTECTED_APPROVAL_READY/);
  assert.match(source, /PERSONAL_REPOSITORY_PROTECTED_SQUASH_MERGED/);
  assert.doesNotMatch(source, /PREAPPROVAL|BEFORE_PROTECTED_ENVIRONMENT|Pre-environment|before protected approval/i);
  assert.match(source, /method: 'PUT',[\s\S]*?merge_method: 'squash',[\s\S]*?sha: receipt\.sourceHead/);
  assert.equal([...source.matchAll(/pulls\/\$\{receipt\.prNumber\}\/merge/g)].length, 1);
  assert.doesNotMatch(source, /delete_branch|DELETE|git\s+(?:push|reset|clean|rebase)|--force/);
  assert.doesNotMatch(source, /\b(?:eval|execSync)\s*\(|shell\s*:\s*true/);
});

test('native and personal merge executors share one bounded artifact transport contract', async () => {
  const [nativeSource, personalSource, contractSource] = await Promise.all([
    readFile(protectedMergeScript, 'utf8'),
    readFile(personalRepositoryMergeScript, 'utf8'),
    readFile(personalRepositoryMergeContract, 'utf8'),
  ]);
  for (const source of [nativeSource, personalSource]) {
    assert.match(source, /executePersonalRepositoryArtifactArchiveTransport/);
    assert.match(source, /requestApiRedirect: \(request\) => fetch\(request\.url/);
    assert.match(source, /requestArchive: \(request\) => fetch\(request\.url/);
    assert.doesNotMatch(source, /application\/octet-stream/);
    const archiveRequest = source.slice(
      source.indexOf('    requestArchive:'),
      source.indexOf('\n    }),', source.indexOf('    requestArchive:')),
    );
    assert.match(archiveRequest, /\.\.\.request\.headers/);
    assert.doesNotMatch(archiveRequest, /Authorization|GH_TOKEN|GITHUB_TOKEN|STEPHANOS_RULESET_PROOF_TOKEN/);
    assert.match(source, /extractPersonalRepositoryArtifactZip\(archiveBytes, INDEPENDENT_REVIEW_ARTIFACT_FILE\)/);
    assert.doesNotMatch(source, /node:child_process|\bspawn(?:Sync)?\b|\bexec(?:File|Sync)?\b|\bunzip\b|shell\s*:/i);
  }
  assert.match(contractSource, /buildPersonalRepositoryArtifactApiRequest/);
  assert.match(contractSource, /Accept: 'application\/vnd\.github\+json'/);
  assert.match(contractSource, /validatePersonalRepositoryArtifactArchiveRedirect/);
  assert.match(contractSource, /buildPersonalRepositoryArtifactArchiveRequest/);
  assert.match(contractSource, /validatePersonalRepositoryArtifactArchiveResponse/);
  assert.match(contractSource, /readBoundedPersonalRepositoryResponseBody/);
  assert.match(contractSource, /redirect: 'manual'/);
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
