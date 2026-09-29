import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindIndependentReviewReceiptToBase,
  buildAtomicMergeRefUpdatePlan,
  buildBaseBoundApprovalReceipt,
  buildMergeQueueApprovalReceipt,
  independentReviewBaseProofRef,
  validateBaseBoundApprovalReceipt,
  validateIndependentReviewBaseBinding,
  validateIndependentWorkflowBaseBinding,
  validateMainRefBaseBinding,
  validateMergeCommitBaseAndHeadBinding,
  validateMergeGroupEvidence,
  validateMergeQueueApprovalReceipt,
  validateMergeQueueConfiguration,
  validatePullRequestBaseBinding,
} from './operatorMergeBaseBindingV1.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const movedBaseSha = 'c'.repeat(40);
const prNumber = 1580;
const runId = 12345;
const runAttempt = 2;
const repository = 'Cheekyfellastef/stephan-os';
const branch = 'feat/protected-approval';
const approvedAtUtc = '2026-07-30T10:00:00.000Z';
const reviewRunId = 67890;
const reviewRunAttempt = 3;
const artifactId = 24680;
const artifactDigest = `sha256:${'d'.repeat(64)}`;
const payloadSha256 = 'e'.repeat(64);
const mergeGroupSha = 'd'.repeat(40);
const requiredCheckIntegrationId = 15368;

function artifactIdentity() {
  return {
    independentReviewWorkflowRunId: reviewRunId,
    independentReviewWorkflowRunAttempt: reviewRunAttempt,
    independentReviewArtifactId: artifactId,
    independentReviewArtifactDigest: artifactDigest,
    independentReviewPayloadSha256: payloadSha256,
  };
}

function mergeGroupEvidence(overrides = {}) {
  const pullRequest = {
    number: prNumber,
    state: 'open',
    draft: false,
    head: { sha: headSha, ref: branch },
    base: { sha: baseSha, ref: 'main' },
  };
  return {
    repository,
    eventName: 'merge_group',
    action: 'checks_requested',
    mergeGroup: {
      head_sha: mergeGroupSha,
      base_sha: baseSha,
      base_ref: 'refs/heads/main',
    },
    associatedPullRequests: [pullRequest],
    pullRequest,
    liveMainRef: { object: { sha: baseSha } },
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    unresolvedThreadCount: 0,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    ...overrides,
  };
}

function mergeQueueConfiguration(overrides = {}) {
  const rulesetId = 99;
  return {
    activeRules: [
      {
        type: 'pull_request',
        ruleset_id: rulesetId,
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
        ruleset_id: rulesetId,
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{
            context: 'operator-merge-queue-boundary',
            integration_id: requiredCheckIntegrationId,
          }],
        },
      },
      {
        type: 'merge_queue',
        ruleset_id: rulesetId,
        parameters: {
          max_entries_to_build: 1,
          max_entries_to_merge: 1,
          min_entries_to_merge: 1,
          merge_method: 'MERGE',
        },
      },
      { type: 'non_fast_forward', ruleset_id: rulesetId },
    ],
    rulesets: [{ id: rulesetId, enforcement: 'active', bypass_actors: [] }],
    ...overrides,
  };
}

function reviewReceipt() {
  return {
    schemaVersion: 'stephanos.provider-neutral-review.v1',
    kind: 'stephanos.provider-neutral.review',
    reviewScope: ['complete-exact-head-diff'],
    proofRefs: [`proofs/independent-review/head-${headSha.slice(0, 12)}`],
  };
}

function approvalReceipt() {
  return {
    schemaVersion: 'stephanos.protected-operator-approval.v1',
    kind: 'stephanos.protected-operator-approval',
    repository,
    prNumber,
    sourceHead: headSha,
    branch,
    environment: 'operator-merge-approval',
    requiredReviewer: 'Cheekyfellastef',
    workflowPath: '.github/workflows/operator-merge-approval-gate.yml',
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    ...artifactIdentity(),
    approvedAtUtc,
    mergeExecutionAuthority: 'github-actions-protected-environment-only',
    reusableAcrossHeads: false,
  };
}

test('binds an independent review receipt to the full exact base SHA', () => {
  const bound = bindIndependentReviewReceiptToBase(reviewReceipt(), baseSha);
  assert.ok(bound.reviewScope.includes('exact-base-sha-binding'));
  assert.ok(bound.proofRefs.includes(independentReviewBaseProofRef(baseSha)));
  assert.equal(validateIndependentReviewBaseBinding(bound, baseSha).valid, true);
  const moved = validateIndependentReviewBaseBinding(bound, movedBaseSha);
  assert.equal(moved.valid, false);
  assert.ok(moved.blockers.includes('independent-review-base-proof-missing'));
});

test('requires both the fresh PR base and live main ref to remain unchanged', () => {
  assert.equal(validatePullRequestBaseBinding({ base: { sha: baseSha } }, baseSha).valid, true);
  assert.equal(validateMainRefBaseBinding({ object: { sha: baseSha } }, baseSha).valid, true);
  assert.ok(validatePullRequestBaseBinding({ base: { sha: movedBaseSha } }, baseSha).blockers.includes('pull-request-base-sha-mismatch'));
  assert.ok(validateMainRefBaseBinding({ object: { sha: movedBaseSha } }, baseSha).blockers.includes('main-ref-sha-mismatch'));
});

test('requires the independent workflow run itself to identify the same base SHA', () => {
  const run = {
    pull_requests: [{ number: prNumber, head: { sha: headSha }, base: { sha: baseSha } }],
  };
  assert.equal(validateIndependentWorkflowBaseBinding(run, prNumber, baseSha).valid, true);
  const moved = validateIndependentWorkflowBaseBinding(run, prNumber, movedBaseSha);
  assert.ok(moved.blockers.includes('independent-review-base-sha-mismatch'));
});

test('builds a one-time operator approval bound to both head and base', () => {
  const bound = buildBaseBoundApprovalReceipt(approvalReceipt(), baseSha);
  assert.equal(bound.schemaVersion, 'stephanos.protected-operator-approval.v2');
  assert.equal(bound.baseSha, baseSha);
  assert.equal(bound.reusableAcrossBases, false);
  assert.equal(validateBaseBoundApprovalReceipt(bound, {
    prNumber,
    repository,
    branch,
    expectedHead: headSha,
    expectedBaseSha: baseSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    ...artifactIdentity(),
    nowUtc: approvedAtUtc,
  }).valid, true);
  const moved = validateBaseBoundApprovalReceipt(bound, {
    prNumber,
    repository,
    branch,
    expectedHead: headSha,
    expectedBaseSha: movedBaseSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    ...artifactIdentity(),
    nowUtc: approvedAtUtc,
  });
  assert.ok(moved.blockers.includes('approval-base-mismatch'));
});

test('protected approval validation rejects binding-shaped, future and coercive receipts', () => {
  const canonical = buildBaseBoundApprovalReceipt(approvalReceipt(), baseSha);
  const options = {
    repository,
    prNumber,
    branch,
    expectedHead: headSha,
    expectedBaseSha: baseSha,
    ...artifactIdentity(),
    nowUtc: approvedAtUtc,
  };
  assert.equal(validateBaseBoundApprovalReceipt({
    issue: 1497,
    activePr: prNumber,
    headSha,
    repository,
    branch,
  }, options).valid, false);
  assert.ok(validateBaseBoundApprovalReceipt({
    ...canonical,
    prNumber: String(prNumber),
  }, options).blockers.includes('approval-pr-invalid'));
  assert.ok(validateBaseBoundApprovalReceipt({
    ...canonical,
    approvedAtUtc: '2099-01-01T00:00:00.000Z',
  }, options).blockers.includes('approval-time-in-future'));
  const missingTrustedContext = validateBaseBoundApprovalReceipt(canonical, {
    prNumber,
    expectedHead: headSha,
    expectedBaseSha: baseSha,
  });
  assert.ok(missingTrustedContext.blockers.includes('approval-expected-repository-invalid'));
  assert.ok(missingTrustedContext.blockers.includes('approval-expected-branch-invalid'));
  assert.ok(missingTrustedContext.blockers.includes('approval-observation-time-invalid'));
  const malformedTrustedContext = validateBaseBoundApprovalReceipt(canonical, {
    ...options,
    repository: ['Cheekyfellastef/stephan-os'],
    branch: { value: branch },
    nowUtc: ['2026-07-30T10:00:00.000Z'],
  });
  assert.ok(malformedTrustedContext.blockers.includes('approval-expected-repository-invalid'));
  assert.ok(malformedTrustedContext.blockers.includes('approval-expected-branch-invalid'));
  assert.ok(malformedTrustedContext.blockers.includes('approval-observation-time-invalid'));
});

test('protected approval is cryptographically bound to one independent-review artifact', () => {
  const canonical = buildBaseBoundApprovalReceipt(approvalReceipt(), baseSha);
  const options = {
    repository,
    prNumber,
    branch,
    expectedHead: headSha,
    expectedBaseSha: baseSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
    nowUtc: approvedAtUtc,
    ...artifactIdentity(),
  };
  assert.equal(validateBaseBoundApprovalReceipt(canonical, options).valid, true);

  for (const [key, value, blocker] of [
    ['independentReviewWorkflowRunId', reviewRunId + 1, 'approval-independent-review-run-mismatch'],
    ['independentReviewWorkflowRunAttempt', reviewRunAttempt + 1, 'approval-independent-review-attempt-mismatch'],
    ['independentReviewArtifactId', artifactId + 1, 'approval-independent-review-artifact-id-mismatch'],
    ['independentReviewArtifactDigest', `sha256:${'f'.repeat(64)}`, 'approval-independent-review-artifact-digest-mismatch'],
    ['independentReviewPayloadSha256', 'f'.repeat(64), 'approval-independent-review-payload-digest-mismatch'],
  ]) {
    const validation = validateBaseBoundApprovalReceipt(canonical, { ...options, [key]: value });
    assert.ok(validation.blockers.includes(blocker), `${key} must be immutable`);
  }

  const unbound = { ...canonical };
  delete unbound.independentReviewArtifactId;
  assert.ok(validateBaseBoundApprovalReceipt(unbound, options).blockers.includes(
    'approval-independent-review-artifact-id-invalid',
  ));
});

test('merge-group evidence binds exactly one authoritative PR, head, base, group and workflow attempt', () => {
  const ready = validateMergeGroupEvidence(mergeGroupEvidence());
  assert.equal(ready.finalVerdict, 'MERGE_GROUP_EVIDENCE_READY');
  assert.deepEqual(ready.identity, {
    repository,
    prNumber,
    branch,
    sourceHead: headSha,
    baseSha,
    mergeGroupSha,
    workflowRunId: runId,
    workflowRunAttempt: runAttempt,
  });

  const multiple = validateMergeGroupEvidence(mergeGroupEvidence({
    associatedPullRequests: [
      mergeGroupEvidence().pullRequest,
      { ...mergeGroupEvidence().pullRequest, number: prNumber + 1 },
    ],
  }));
  assert.ok(multiple.blockers.includes('merge-group-associated-pr-count-not-one'));

  for (const [key, value, blocker] of [
    ['mergeGroupSha', 'f'.repeat(40), 'merge-group-expected-sha-mismatch'],
    ['baseSha', 'f'.repeat(40), 'merge-group-expected-base-mismatch'],
    ['sourceHead', 'f'.repeat(40), 'merge-group-expected-head-mismatch'],
    ['workflowRunAttempt', runAttempt + 1, 'merge-group-expected-attempt-mismatch'],
  ]) {
    const stale = validateMergeGroupEvidence(mergeGroupEvidence(), {
      repository,
      prNumber,
      sourceHead: headSha,
      baseSha,
      mergeGroupSha,
      workflowRunId: runId,
      workflowRunAttempt: runAttempt,
      [key]: value,
    });
    assert.ok(stale.blockers.includes(blocker), key);
  }
});

test('single-owner merge-group evidence permits no native approval but blocks change requests', () => {
  const noNativeApproval = validateMergeGroupEvidence(mergeGroupEvidence({
    reviewDecision: null,
  }));
  assert.equal(noNativeApproval.finalVerdict, 'MERGE_GROUP_EVIDENCE_READY');

  const voluntaryApproval = validateMergeGroupEvidence(mergeGroupEvidence({
    reviewDecision: 'APPROVED',
  }));
  assert.equal(voluntaryApproval.finalVerdict, 'MERGE_GROUP_EVIDENCE_READY');

  const changesRequested = validateMergeGroupEvidence(mergeGroupEvidence({
    reviewDecision: 'CHANGES_REQUESTED',
  }));
  assert.ok(changesRequested.blockers.includes('merge-group-changes-requested'));

  const reviewRequired = validateMergeGroupEvidence(mergeGroupEvidence({
    reviewDecision: 'REVIEW_REQUIRED',
  }));
  assert.ok(reviewRequired.blockers.includes('merge-group-review-decision-unsupported'));

  const missing = mergeGroupEvidence();
  delete missing.reviewDecision;
  assert.ok(validateMergeGroupEvidence(missing).blockers.includes(
    'merge-group-review-decision-missing',
  ));
});

test('merge queue configuration requires the single-owner zero-approval policy, one-entry MERGE, conversations and no bypass', () => {
  const ready = validateMergeQueueConfiguration(mergeQueueConfiguration(), {
    requiredCheck: 'operator-merge-queue-boundary',
    expectedIntegrationId: requiredCheckIntegrationId,
  });
  assert.equal(ready.finalVerdict, 'MERGE_QUEUE_CONFIGURATION_READY');
  assert.deepEqual(ready.pullRequest, {
    requiredApprovingReviewCount: 0,
    requireConversationResolution: true,
    dismissStaleReviews: true,
    requireLastPushApproval: false,
    requireCodeOwnerReview: false,
  });

  for (const [parameter, value, blocker] of [
    ['required_approving_review_count', 1, 'merge-queue-native-approval-count-not-zero'],
    ['require_last_push_approval', true, 'merge-queue-last-push-native-approval-not-disabled'],
    ['require_code_owner_review', true, 'merge-queue-code-owner-native-approval-not-disabled'],
  ]) {
    const incompatibleNativeReview = validateMergeQueueConfiguration(mergeQueueConfiguration({
      activeRules: mergeQueueConfiguration().activeRules.map((rule) => (
        rule.type === 'pull_request'
          ? { ...rule, parameters: { ...rule.parameters, [parameter]: value } }
          : rule
      )),
    }), {
      requiredCheck: 'operator-merge-queue-boundary',
      expectedIntegrationId: requiredCheckIntegrationId,
    });
    assert.ok(incompatibleNativeReview.blockers.includes(blocker), parameter);
  }

  const wrongQueue = validateMergeQueueConfiguration(mergeQueueConfiguration({
    activeRules: mergeQueueConfiguration().activeRules.map((rule) => (
      rule.type === 'merge_queue'
        ? { ...rule, parameters: { ...rule.parameters, max_entries_to_build: 2, merge_method: 'SQUASH' } }
        : rule
    )),
  }), {
    requiredCheck: 'operator-merge-queue-boundary',
    expectedIntegrationId: requiredCheckIntegrationId,
  });
  assert.ok(wrongQueue.blockers.includes('merge-queue-not-one-entry'));
  assert.ok(wrongQueue.blockers.includes('merge-queue-method-not-merge'));

  const bypass = validateMergeQueueConfiguration(mergeQueueConfiguration({
    rulesets: [{
      id: 99,
      enforcement: 'active',
      bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }],
    }],
  }), {
    requiredCheck: 'operator-merge-queue-boundary',
    expectedIntegrationId: requiredCheckIntegrationId,
  });
  assert.ok(bypass.blockers.includes('merge-queue-bypass-present:99'));

  const unproved = validateMergeQueueConfiguration({
    ...mergeQueueConfiguration(),
    rulesets: [{ id: 99, enforcement: 'active' }],
  }, {
    requiredCheck: 'operator-merge-queue-boundary',
    expectedIntegrationId: requiredCheckIntegrationId,
  });
  assert.ok(unproved.blockers.includes('CONFIGURATION_NOT_PROVED:ruleset-bypass-actors:99'));

  const unreadable = validateMergeQueueConfiguration({}, {
    requiredCheck: 'operator-merge-queue-boundary',
    expectedIntegrationId: requiredCheckIntegrationId,
  });
  assert.ok(unreadable.blockers.includes('CONFIGURATION_NOT_PROVED:active-main-rules'));
  assert.ok(unreadable.blockers.includes('CONFIGURATION_NOT_PROVED:active-rulesets'));
});

test('merge queue approval receipt is non-reusable and bound to the current evidence digest', () => {
  const groupEvidence = validateMergeGroupEvidence(mergeGroupEvidence());
  const configuration = validateMergeQueueConfiguration(mergeQueueConfiguration(), {
    requiredCheck: 'operator-merge-queue-boundary',
    expectedIntegrationId: requiredCheckIntegrationId,
  });
  const evidenceSha256 = 'f'.repeat(64);
  const receipt = buildMergeQueueApprovalReceipt({
    groupEvidence,
    configuration,
    ...artifactIdentity(),
    evidenceSha256,
    approvedAtUtc,
  });
  assert.equal(receipt.authority, 'github-merge-queue-required-check-only');
  assert.equal(receipt.reusableAcrossMergeGroups, false);
  assert.equal(validateMergeQueueApprovalReceipt(receipt, receipt).valid, true);

  for (const [key, value, blocker] of [
    ['mergeGroupSha', 'e'.repeat(40), 'merge-queue-approval-group-mismatch'],
    ['baseSha', 'e'.repeat(40), 'merge-queue-approval-base-mismatch'],
    ['sourceHead', 'e'.repeat(40), 'merge-queue-approval-head-mismatch'],
    ['workflowRunAttempt', runAttempt + 1, 'merge-queue-approval-attempt-mismatch'],
    ['evidenceSha256', 'a'.repeat(64), 'merge-queue-approval-evidence-digest-mismatch'],
  ]) {
    assert.ok(validateMergeQueueApprovalReceipt(receipt, {
      ...receipt,
      [key]: value,
    }).blockers.includes(blocker), key);
  }
});

test('binds a normal merge commit to the exact base, exact head, parent order and merge tree', () => {
  const mergeSha = 'd'.repeat(40);
  const treeSha = 'e'.repeat(40);
  const candidate = {
    sha: mergeSha,
    tree: { sha: treeSha },
    parents: [{ sha: baseSha }, { sha: headSha }],
  };
  const ready = validateMergeCommitBaseAndHeadBinding(
    candidate,
    mergeSha,
    baseSha,
    headSha,
    treeSha,
  );
  assert.equal(ready.finalVerdict, 'MERGE_COMMIT_BASE_AND_HEAD_READY');

  for (const invalid of [
    { ...candidate, parents: [{ sha: headSha }, { sha: baseSha }] },
    { ...candidate, parents: [{ sha: baseSha }] },
    { ...candidate, tree: { sha: movedBaseSha } },
  ]) {
    assert.equal(validateMergeCommitBaseAndHeadBinding(
      invalid,
      mergeSha,
      baseSha,
      headSha,
      treeSha,
    ).valid, false);
  }
});

test('emits an exact leased main update only for a valid merge commit on the still-live approved base', () => {
  const mergeSha = 'd'.repeat(40);
  const treeSha = 'e'.repeat(40);
  const candidateCommit = {
    sha: mergeSha,
    tree: { sha: treeSha },
    parents: [{ sha: baseSha }, { sha: headSha }],
  };
  const ready = buildAtomicMergeRefUpdatePlan({
    candidateCommit,
    liveMainRef: { object: { sha: baseSha } },
    expectedMergeSha: mergeSha,
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
    expectedTreeSha: treeSha,
  });
  assert.equal(ready.finalVerdict, 'ATOMIC_MERGE_REF_UPDATE_READY');
  assert.deepEqual(ready.update, {
    ref: 'refs/heads/main',
    sha: mergeSha,
    expectedOldSha: baseSha,
    force: false,
  });

  const raced = buildAtomicMergeRefUpdatePlan({
    candidateCommit,
    liveMainRef: { object: { sha: movedBaseSha } },
    expectedMergeSha: mergeSha,
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
    expectedTreeSha: treeSha,
  });
  assert.equal(raced.valid, false);
  assert.equal(raced.update, null);
  assert.ok(raced.blockers.includes('live-base:main-ref-sha-mismatch'));
});
