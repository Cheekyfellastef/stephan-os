import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERSONAL_REPOSITORY_AUTHORITY,
  PERSONAL_REPOSITORY_MODE,
  PERSONAL_REPOSITORY_REQUIRED_CHECK,
  PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS,
  buildPersonalRepositoryApprovalReceipt,
  parsePersonalRepositoryDispatchInputs,
  validatePersonalRepositoryApprovalReceipt,
  validatePersonalRepositoryConfiguration,
  validatePersonalRepositoryEvidence,
  validatePersonalRepositorySquashCompletion,
  validatePersonalRepositoryWorkflowRuns,
} from './operatorPersonalRepositoryMergeV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1739;
const branch = 'agent/watchdog-acceptance-pid-binding-v1';
const sourceHead = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);
const baseSha = 'c'.repeat(40);
const runId = 31390000001;
const runAttempt = 1;
const integrationId = 15368;
const review = Object.freeze({
  workflowRunId: 31376952437,
  workflowRunAttempt: 1,
  artifactId: 9058301333,
  artifactDigest: `sha256:${'d'.repeat(64)}`,
  payloadSha256: 'e'.repeat(64),
});

function dispatchInputs(overrides = {}) {
  return {
    mode: PERSONAL_REPOSITORY_MODE,
    pr_number: String(prNumber),
    expected_branch: branch,
    expected_head: sourceHead,
    expected_head_tree: sourceTree,
    expected_base: baseSha,
    independent_review_run_id: String(review.workflowRunId),
    independent_review_run_attempt: String(review.workflowRunAttempt),
    independent_review_artifact_id: String(review.artifactId),
    independent_review_artifact_digest: review.artifactDigest,
    independent_review_payload_sha256: review.payloadSha256,
    ...overrides,
  };
}

function workflowDefinitions() {
  return PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((required, index) => ({
    id: 7100 + index,
    name: required.name,
    path: required.path,
    state: 'active',
  }));
}

function workflowRuns() {
  return PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((required, index) => ({
    id: 9100 + index,
    run_number: 100 + index,
    run_attempt: 1,
    workflow_id: 7100 + index,
    name: required.name,
    path: `${repository}/${required.path}@refs/heads/${branch}`,
    event: required.event,
    repository: { full_name: repository },
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'success',
    check_suite_id: 8100 + index,
    pull_requests: [{
      number: prNumber,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    }],
  }));
}

function evidenceInput(overrides = {}) {
  return {
    repository,
    repositoryOwnerType: 'User',
    eventName: 'workflow_dispatch',
    triggeringActor: 'Cheekyfellastef',
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    pullRequest: {
      number: prNumber,
      state: 'open',
      draft: false,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    },
    liveMainRef: { object: { sha: baseSha } },
    headCommit: { sha: sourceHead, tree: { sha: sourceTree } },
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    unresolvedThreadCount: 0,
    comparison: {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      base_commit: { sha: baseSha },
      merge_base_commit: { sha: baseSha },
    },
    ...overrides,
  };
}

function environment() {
  return {
    name: 'operator-merge-approval',
    can_admins_bypass: false,
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
    protection_rules: [{
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef' } }],
    }],
  };
}

function activeRules() {
  return [
    { type: 'deletion', ruleset_id: 91 },
    { type: 'non_fast_forward', ruleset_id: 91 },
    {
      type: 'pull_request',
      ruleset_id: 91,
      parameters: {
        required_approving_review_count: 0,
        required_review_thread_resolution: true,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: false,
        require_code_owner_review: false,
      },
    },
    {
      type: 'required_status_checks',
      ruleset_id: 91,
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{
          context: PERSONAL_REPOSITORY_REQUIRED_CHECK,
          integration_id: integrationId,
        }],
      },
    },
  ];
}

function configuration(overrides = {}) {
  return {
    repository: {
      owner: { type: 'User' },
      private: false,
      visibility: 'public',
      default_branch: 'main',
      allow_squash_merge: true,
      delete_branch_on_merge: false,
    },
    environment: environment(),
    activeRules: activeRules(),
    rulesets: [{ id: 91, enforcement: 'active', bypass_actors: [] }],
    ...overrides,
  };
}

const expectedEvidence = Object.freeze({
  repository,
  prNumber,
  branch,
  sourceHead,
  sourceTree,
  baseSha,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
});

test('dispatch inputs require an exact positive identity and immutable review artifact', () => {
  assert.equal(parsePersonalRepositoryDispatchInputs(dispatchInputs()).valid, true);
  for (const [key, value, blocker] of [
    ['mode', 'other', 'personal-repository-mode-not-exact'],
    ['pr_number', '0', 'personal-repository-pr-invalid'],
    ['expected_head', 'abc', 'personal-repository-head-invalid'],
    ['expected_head_tree', 'abc', 'personal-repository-tree-invalid'],
    ['expected_base', 'abc', 'personal-repository-base-invalid'],
    ['independent_review_run_id', '-1', 'personal-repository-review-run-invalid'],
    ['independent_review_artifact_digest', 'sha256:nope', 'personal-repository-review-artifact-digest-invalid'],
    ['independent_review_payload_sha256', 'nope', 'personal-repository-review-payload-digest-invalid'],
  ]) {
    const result = parsePersonalRepositoryDispatchInputs(dispatchInputs({ [key]: value }));
    assert.ok(result.blockers.includes(blocker), `${key} should produce ${blocker}`);
  }
});

test('all seven universally applicable exact-head workflow identities must be active and successful', () => {
  assert.deepEqual(PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((workflow) => workflow.name), [
    'OpenClaw GitHub Operator',
    'Protected Operator Merge Source Proof',
    'Exact-Head Review Dispatch',
    'PR Clean Guard',
    'Build Stephanos UI',
    'Battle Bridge Publisher Proof',
    'Codex Dispatch Queue Proof',
  ]);
  const ready = validatePersonalRepositoryWorkflowRuns(
    workflowDefinitions(),
    workflowRuns(),
    expectedEvidence,
  );
  assert.equal(ready.valid, true);
  assert.equal(ready.evidence.length, 7);

  const failed = workflowRuns();
  failed[3] = { ...failed[3], conclusion: 'failure' };
  const blocked = validatePersonalRepositoryWorkflowRuns(
    workflowDefinitions(),
    failed,
    expectedEvidence,
  );
  assert.ok(blocked.blockers.includes(
    `personal-repository-workflow-run-not-exact-green:${PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS[3].name}`,
  ));
});

test('personal repository evidence binds operator, PR, branch, head, tree and current base', () => {
  assert.equal(validatePersonalRepositoryEvidence(evidenceInput(), expectedEvidence).valid, true);
  for (const [overrides, blocker] of [
    [{ repositoryOwnerType: 'Organization' }, 'personal-repository-owner-not-user'],
    [{ triggeringActor: 'someone-else' }, 'personal-repository-triggering-actor-not-operator'],
    [{ liveMainRef: { object: { sha: 'f'.repeat(40) } } }, 'personal-repository-live-main-mismatch'],
    [{ unresolvedThreadCount: 1 }, 'personal-repository-conversations-not-resolved'],
    [{ comparison: { ...evidenceInput().comparison, behind_by: 1 } }, 'personal-repository-comparison-not-exact-forward'],
  ]) {
    assert.ok(validatePersonalRepositoryEvidence(evidenceInput(overrides), expectedEvidence).blockers.includes(blocker));
  }
  const drifted = validatePersonalRepositoryEvidence(evidenceInput(), {
    ...expectedEvidence,
    sourceHead: 'f'.repeat(40),
  });
  assert.ok(drifted.blockers.includes('personal-repository-expected-head-mismatch'));
});

test('configuration requires the exact protected environment and an active no-bypass main ruleset', () => {
  const ready = validatePersonalRepositoryConfiguration(configuration(), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.equal(ready.valid, true);

  for (const repositoryOverride of [
    { ...configuration().repository, private: true, visibility: 'private' },
    { ...configuration().repository, visibility: '' },
  ]) {
    assert.ok(validatePersonalRepositoryConfiguration(configuration({ repository: repositoryOverride }), {
      requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
      expectedIntegrationId: integrationId,
    }).blockers.includes('personal-repository-rules-api-not-public'));
  }

  const unsafeEnvironment = environment();
  unsafeEnvironment.can_admins_bypass = true;
  assert.ok(validatePersonalRepositoryConfiguration(configuration({ environment: unsafeEnvironment }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('environment-admin-bypass-not-disabled'));

  const bypass = validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', bypass_actors: [{ actor_id: 1 }] }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(bypass.blockers.includes('personal-repository-ruleset-bypass-present:91'));

  const queueRule = validatePersonalRepositoryConfiguration(configuration({
    activeRules: [...activeRules(), { type: 'merge_queue', ruleset_id: 91 }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(queueRule.blockers.includes('personal-repository-unavailable-merge-queue-rule-present'));
});

test('approval receipt is exact-head, exact-base, immutable-review and squash-only', () => {
  const evidence = validatePersonalRepositoryEvidence(evidenceInput(), expectedEvidence);
  const workflows = validatePersonalRepositoryWorkflowRuns(workflowDefinitions(), workflowRuns(), expectedEvidence);
  const config = validatePersonalRepositoryConfiguration(configuration(), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  const receipt = buildPersonalRepositoryApprovalReceipt({
    evidence,
    workflows,
    configuration: config,
    independentReviewWorkflowRunId: review.workflowRunId,
    independentReviewWorkflowRunAttempt: review.workflowRunAttempt,
    independentReviewArtifactId: review.artifactId,
    independentReviewArtifactDigest: review.artifactDigest,
    independentReviewPayloadSha256: review.payloadSha256,
    evidenceSha256: 'f'.repeat(64),
    approvedAtUtc: '2026-08-10T12:00:00Z',
  });
  assert.equal(receipt.authority, PERSONAL_REPOSITORY_AUTHORITY);
  assert.equal(receipt.mergeMethod, 'squash');
  assert.equal(receipt.reusableAcrossHeads, false);
  assert.equal(receipt.reusableAcrossBases, false);
  assert.equal(validatePersonalRepositoryApprovalReceipt(receipt, receipt).valid, true);
  assert.ok(validatePersonalRepositoryApprovalReceipt(receipt, {
    ...receipt,
    sourceHead: '0'.repeat(40),
  }).blockers.includes('personal-repository-approval-head-mismatch'));
});

test('squash completion requires one base parent, the reviewed tree and a retained source branch', () => {
  const mergeSha = '9'.repeat(40);
  const completion = validatePersonalRepositorySquashCompletion({
    mergeResponse: { merged: true, sha: mergeSha },
    pullRequest: { merged: true, merge_commit_sha: mergeSha },
    liveMainRef: { object: { sha: mergeSha } },
    mergeCommit: { sha: mergeSha, tree: { sha: sourceTree }, parents: [{ sha: baseSha }] },
    branchRef: { object: { sha: sourceHead } },
  }, expectedEvidence);
  assert.equal(completion.valid, true);

  const deletedBranch = validatePersonalRepositorySquashCompletion({
    mergeResponse: { merged: true, sha: mergeSha },
    pullRequest: { merged: true, merge_commit_sha: mergeSha },
    liveMainRef: { object: { sha: mergeSha } },
    mergeCommit: { sha: mergeSha, tree: { sha: sourceTree }, parents: [{ sha: baseSha }] },
    branchRef: {},
  }, expectedEvidence);
  assert.ok(deletedBranch.blockers.includes('personal-repository-source-branch-deleted-or-moved'));
});
