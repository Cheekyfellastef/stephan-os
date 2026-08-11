import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERSONAL_REPOSITORY_AUTHORITY,
  PERSONAL_REPOSITORY_MODE,
  PERSONAL_REPOSITORY_REQUIRED_CHECK,
  PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS,
  PERSONAL_REPOSITORY_WORKFLOW_NAME,
  PERSONAL_REPOSITORY_WORKFLOW_PATH,
  buildPersonalRepositoryConfigurationEvidence,
  buildPersonalRepositoryApprovalReceipt,
  parsePersonalRepositoryDispatchInputs,
  validatePersonalRepositoryApprovalReceipt,
  validatePersonalRepositoryConfiguration,
  validatePersonalRepositoryDispatchExecution,
  validatePersonalRepositoryDispatchWorkflowDefinition,
  validatePersonalRepositoryEvidence,
  validatePersonalRepositoryRulesetProofRequest,
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
const dispatchWorkflowId = 7199;
const dispatchTitle = `Protected operator merge ${sourceHead}`;

function dispatchWorkflowDefinition(overrides = {}) {
  return {
    id: dispatchWorkflowId,
    name: PERSONAL_REPOSITORY_WORKFLOW_NAME,
    path: PERSONAL_REPOSITORY_WORKFLOW_PATH,
    state: 'active',
    ...overrides,
  };
}

function dispatchRun(overrides = {}) {
  return {
    id: runId,
    run_attempt: runAttempt,
    workflow_id: dispatchWorkflowId,
    name: dispatchTitle,
    display_title: dispatchTitle,
    event: 'workflow_dispatch',
    repository: { full_name: repository },
    head_sha: baseSha,
    head_branch: 'main',
    path: `${repository}/${PERSONAL_REPOSITORY_WORKFLOW_PATH}@refs/heads/main`,
    triggering_actor: { login: 'Cheekyfellastef' },
    status: 'in_progress',
    ...overrides,
  };
}

function dispatchExecutionInput(overrides = {}) {
  return {
    definitions: [dispatchWorkflowDefinition()],
    run: dispatchRun(),
    priorRuns: [dispatchRun()],
    ...overrides,
  };
}

const expectedDispatchExecution = Object.freeze({
  repository,
  sourceHead,
  baseSha,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
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
    rulesets: [{
      id: 91,
      enforcement: 'active',
      updated_at: '2026-08-10T12:00:00Z',
      bypass_actors: [],
    }],
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

test('ruleset proof authority is read-only and restricted to exact configuration GET surfaces', () => {
  for (const path of [
    '/repos/Cheekyfellastef/stephan-os',
    '/repos/Cheekyfellastef/stephan-os/rules/branches/main?per_page=100&page=1',
    '/repos/Cheekyfellastef/stephan-os/rules/branches/main?per_page=100&page=20',
    '/repos/Cheekyfellastef/stephan-os/rulesets/20640195?includes_parents=true',
  ]) {
    assert.equal(validatePersonalRepositoryRulesetProofRequest({ path, repository }).valid, true, path);
  }

  for (const input of [
    { path: '/repos/Cheekyfellastef/stephan-os', method: 'POST' },
    { path: '/repos/Cheekyfellastef/stephan-os', body: {} },
    { path: '/repos/Cheekyfellastef/stephan-os/pulls/1762' },
    { path: '/repos/Cheekyfellastef/stephan-os/rules/branches/feature?per_page=100&page=1' },
    { path: '/repos/Cheekyfellastef/stephan-os/rules/branches/main?per_page=100&page=21' },
    { path: '/repos/Cheekyfellastef/stephan-os/rules/branches/main?page=1&per_page=100' },
    { path: '/repos/Cheekyfellastef/stephan-os/rulesets/20640195' },
    { path: '/repos/Cheekyfellastef/other', repository },
  ]) {
    const blocked = validatePersonalRepositoryRulesetProofRequest({ repository, ...input });
    assert.equal(blocked.valid, false, JSON.stringify(input));
    assert.ok(blocked.blockers.length > 0, JSON.stringify(input));
  }
});

test('dispatch workflow definition must be one exact static active definition', () => {
  const ready = validatePersonalRepositoryDispatchWorkflowDefinition([
    dispatchWorkflowDefinition(),
  ]);
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.definition, dispatchWorkflowDefinition());

  for (const definitions of [
    null,
    [],
    [dispatchWorkflowDefinition({ name: 'Protected operator merge dynamic-title' })],
    [dispatchWorkflowDefinition({ path: '.github/workflows/lookalike.yml' })],
    [dispatchWorkflowDefinition({ state: 'disabled_manually' })],
    [dispatchWorkflowDefinition({ id: String(dispatchWorkflowId) })],
    [dispatchWorkflowDefinition(), dispatchWorkflowDefinition({ id: dispatchWorkflowId + 1 })],
  ]) {
    const blocked = validatePersonalRepositoryDispatchWorkflowDefinition(definitions);
    assert.equal(blocked.valid, false);
    assert.ok(blocked.blockers.length > 0);
  }
});

test('current protected dispatch binds every exact dynamic run identity field', () => {
  const ready = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput(),
    expectedDispatchExecution,
  );
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.currentMismatches, []);

  const mutations = [
    ['run-id', { id: runId + 1 }],
    ['run-attempt', { run_attempt: runAttempt + 1 }],
    ['workflow-id', { workflow_id: dispatchWorkflowId + 1 }],
    ['run-name', { name: 'Protected Operator Merge Queue Boundary' }],
    ['display-title', { display_title: `${dispatchTitle}-widened` }],
    ['event', { event: 'repository_dispatch' }],
    ['repository', { repository: { full_name: 'Cheekyfellastef/lookalike' } }],
    ['base-head', { head_sha: 'f'.repeat(40) }],
    ['base-branch', { head_branch: 'lookalike-main' }],
    ['workflow-path', { path: `${repository}/${PERSONAL_REPOSITORY_WORKFLOW_PATH}@feature` }],
    ['triggering-actor', { triggering_actor: { login: 'lookalike-operator' } }],
    ['run-status', { status: 'completed' }],
  ];
  for (const [field, mutation] of mutations) {
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({ run: dispatchRun(mutation) }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, field);
    assert.ok(blocked.currentMismatches.includes(field), field);
  }

  const widened = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({ run: [dispatchRun(), dispatchRun()] }),
    expectedDispatchExecution,
  );
  assert.equal(widened.valid, false);
  assert.ok(widened.currentMismatches.length > 0);
});

test('same-base prior protected dispatch is a replay regardless of failed conclusion', () => {
  const priorRunId = runId + 10;
  const blocked = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [
        dispatchRun(),
        dispatchRun({
          id: priorRunId,
          status: 'completed',
          conclusion: 'failure',
        }),
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(blocked.valid, false);
  assert.deepEqual(blocked.replayRunIds, [priorRunId]);
  assert.ok(blocked.blockers.includes('personal-repository-prior-attempt-exists'));
});

test('retried current workflow run is a replay even when GitHub retains or omits the run ID', () => {
  for (const [attempt, priorRuns] of [
    [2, [dispatchRun({ run_attempt: 2 })]],
    [3, []],
  ]) {
    const retriedRun = dispatchRun({ run_attempt: attempt });
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({ run: retriedRun, priorRuns }),
      {
        ...expectedDispatchExecution,
        workflowRunAttempt: attempt,
      },
    );
    assert.equal(blocked.valid, false, attempt);
    assert.deepEqual(blocked.currentMismatches, [], attempt);
    assert.deepEqual(blocked.replayRunIds, [runId], attempt);
    assert.ok(blocked.blockers.includes('personal-repository-prior-attempt-exists'), attempt);
  }
});

test('malformed retried current run fails closed without claiming an exact replay', () => {
  const blocked = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      run: dispatchRun({
        run_attempt: 2,
        triggering_actor: { login: 'lookalike-operator' },
      }),
      priorRuns: [],
    }),
    {
      ...expectedDispatchExecution,
      workflowRunAttempt: 2,
    },
  );
  assert.equal(blocked.valid, false);
  assert.deepEqual(blocked.currentMismatches, ['triggering-actor']);
  assert.deepEqual(blocked.replayRunIds, []);
  assert.ok(blocked.blockers.includes('personal-repository-workflow-run-identity-mismatch'));
});

test('different exact base is a fresh protected dispatch identity, not a replay', () => {
  const priorRunId = runId + 11;
  const ready = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [
        dispatchRun(),
        dispatchRun({
          id: priorRunId,
          head_sha: 'f'.repeat(40),
          status: 'completed',
          conclusion: 'failure',
        }),
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.replayRunIds, []);
  assert.deepEqual(ready.differentBasePriorRunIds, [priorRunId]);
});

test('malformed source-matching prior run blocks instead of evading replay proof', () => {
  const malformedCandidates = [
    (value) => { delete value.head_sha; },
    (value) => { delete value.triggering_actor; },
    (value) => { value.run_attempt = String(value.run_attempt); },
    (value) => { value.workflow_id += 1; },
    (value) => { value.name = PERSONAL_REPOSITORY_WORKFLOW_NAME; },
    (value) => { value.display_title = `${dispatchTitle}-widened`; },
    (value) => { value.event = 'repository_dispatch'; },
    (value) => { value.repository = { full_name: 'Cheekyfellastef/lookalike' }; },
    (value) => { value.head_branch = 'lookalike-main'; },
    (value) => { value.path = `${repository}/${PERSONAL_REPOSITORY_WORKFLOW_PATH}@feature`; },
  ];
  for (const [index, mutate] of malformedCandidates.entries()) {
    const priorRunId = runId + 20 + index;
    const malformed = dispatchRun({ id: priorRunId });
    mutate(malformed);
    const blocked = validatePersonalRepositoryDispatchExecution(
      dispatchExecutionInput({ priorRuns: [dispatchRun(), malformed] }),
      expectedDispatchExecution,
    );
    assert.equal(blocked.valid, false, index);
    assert.deepEqual(blocked.malformedPriorRunIds, [priorRunId], index);
    assert.ok(blocked.blockers.includes('personal-repository-prior-attempt-invalid'), index);
  }

  const invalidContainer = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({ priorRuns: {} }),
    expectedDispatchExecution,
  );
  assert.equal(invalidContainer.valid, false);
  assert.ok(invalidContainer.blockers.includes('personal-repository-prior-runs-invalid'));
});

test('wrong actor or source title cannot become an exact prior operator replay', () => {
  const ready = validatePersonalRepositoryDispatchExecution(
    dispatchExecutionInput({
      priorRuns: [
        dispatchRun(),
        dispatchRun({ id: runId + 13, triggering_actor: { login: 'lookalike-operator' } }),
        dispatchRun({
          id: runId + 14,
          name: `Protected operator merge ${'9'.repeat(40)}`,
          display_title: `Protected operator merge ${'9'.repeat(40)}`,
        }),
      ],
    }),
    expectedDispatchExecution,
  );
  assert.equal(ready.valid, true);
  assert.deepEqual(ready.replayRunIds, []);
  assert.deepEqual(ready.malformedPriorRunIds, []);
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

  const restrictedTokenRepository = { ...configuration().repository };
  delete restrictedTokenRepository.allow_squash_merge;
  delete restrictedTokenRepository.delete_branch_on_merge;
  const hiddenSettings = validatePersonalRepositoryConfiguration(configuration({
    repository: restrictedTokenRepository,
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(hiddenSettings.blockers.includes('personal-repository-squash-not-enabled'));
  assert.ok(hiddenSettings.blockers.includes('personal-repository-auto-delete-not-disabled'));

  const contextOnlyRules = activeRules();
  delete contextOnlyRules[3].parameters.required_status_checks[0].integration_id;
  assert.ok(validatePersonalRepositoryConfiguration(configuration({
    activeRules: contextOnlyRules,
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('personal-repository-required-check-not-exact'));

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
    rulesets: [{
      id: 91,
      enforcement: 'active',
      updated_at: '2026-08-10T12:00:00Z',
      bypass_actors: [{ actor_id: 1 }],
    }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(bypass.blockers.includes('personal-repository-ruleset-bypass-present:91'));

  const publicPreapproval = validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', updated_at: '2026-08-10T12:00:00Z' }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
    requireBypassProof: false,
  });
  assert.equal(publicPreapproval.valid, true);
  assert.equal(publicPreapproval.bypassProven, false);
  assert.equal(
    publicPreapproval.finalVerdict,
    'PERSONAL_REPOSITORY_CONFIGURATION_PREAPPROVAL_READY',
  );
  assert.ok(validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', updated_at: '2026-08-10T12:00:00Z' }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('CONFIGURATION_NOT_PROVED:personal-repository-ruleset-bypass-actors:91'));
  assert.ok(validatePersonalRepositoryConfiguration(configuration({
    rulesets: [{ id: 91, enforcement: 'active', bypass_actors: [] }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  }).blockers.includes('CONFIGURATION_NOT_PROVED:personal-repository-ruleset-updated-at:91'));

  const queueRule = validatePersonalRepositoryConfiguration(configuration({
    activeRules: [...activeRules(), { type: 'merge_queue', ruleset_id: 91 }],
  }), {
    requiredCheck: PERSONAL_REPOSITORY_REQUIRED_CHECK,
    expectedIntegrationId: integrationId,
  });
  assert.ok(queueRule.blockers.includes('personal-repository-unavailable-merge-queue-rule-present'));
});

test('configuration evidence binds repository merge settings and exact bypass actors', () => {
  const exact = configuration();
  exact.repository.id = 1179385578;
  const baseline = buildPersonalRepositoryConfigurationEvidence(exact);
  assert.equal(baseline.repository.allow_squash_merge, true);
  assert.equal(baseline.repository.delete_branch_on_merge, false);
  assert.deepEqual(baseline.rulesets[0].bypass_actors, []);

  for (const changed of [
    configuration({ repository: { ...exact.repository, allow_squash_merge: false } }),
    configuration({ repository: { ...exact.repository, delete_branch_on_merge: true } }),
    configuration({ rulesets: [{ ...exact.rulesets[0], bypass_actors: [{ actor_id: 1 }] }] }),
  ]) {
    assert.notDeepEqual(buildPersonalRepositoryConfigurationEvidence(changed), baseline);
  }
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
