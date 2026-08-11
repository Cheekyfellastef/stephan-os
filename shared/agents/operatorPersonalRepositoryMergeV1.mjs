import {
  OPERATOR_MERGE_ENVIRONMENT,
  OPERATOR_MERGE_REVIEWER,
  validateProtectedEnvironment,
} from './operatorMergeApprovalGate.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const PERSONAL_REPOSITORY_ACTIVE_RUN_STATUSES = new Set(['queued', 'in_progress']);

export const PERSONAL_REPOSITORY_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const PERSONAL_REPOSITORY_WORKFLOW_NAME = 'Protected Operator Merge Queue Boundary';
export const PERSONAL_REPOSITORY_EVIDENCE_JOB = 'personal-repository-evidence';
export const PERSONAL_REPOSITORY_APPROVAL_JOB = 'operator-personal-repository-approval';
export const PERSONAL_REPOSITORY_MERGE_JOB = 'operator-personal-repository-squash-merge';
export const PERSONAL_REPOSITORY_REQUIRED_CHECK = 'protected-merge-source-proof';
export const PERSONAL_REPOSITORY_MODE = 'user-owned-protected-squash';
export const PERSONAL_REPOSITORY_AUTHORITY = 'github-actions-protected-environment-exact-head-squash-only';

export const PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS = Object.freeze([
  Object.freeze({ name: 'OpenClaw GitHub Operator', path: '.github/workflows/openclaw-github-operator.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Protected Operator Merge Source Proof', path: '.github/workflows/operator-merge-approval-gate-test.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Exact-Head Review Dispatch', path: '.github/workflows/exact-head-review-dispatch.yml', event: 'pull_request' }),
  Object.freeze({ name: 'PR Clean Guard', path: '.github/workflows/pr-clean.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Build Stephanos UI', path: '.github/workflows/build-stephanos-ui.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Battle Bridge Publisher Proof', path: '.github/workflows/battle-bridge-publisher-proof.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Codex Dispatch Queue Proof', path: '.github/workflows/codex-dispatch-queue-proof.yml', event: 'pull_request' }),
]);

function text(value) {
  return String(value ?? '').trim();
}

function strictPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function parsePositiveInteger(value) {
  const raw = text(value);
  if (!/^[1-9][0-9]*$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const observed = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return observed.length === expected.length
    && observed.every((key, index) => key === expected[index]);
}

function workflowRepository(run = {}) {
  return text(run?.repository?.full_name || run?.repository);
}

function canonicalWorkflowPath(run = {}, repository = '') {
  let path = text(run?.path);
  if (repository && path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const at = path.indexOf('@');
  if (at === -1) return path;
  if (at === 0 || at === path.length - 1 || path.indexOf('@', at + 1) !== -1) return '';
  const suffix = path.slice(at + 1);
  const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
  const pullRequest = pullRequests.length === 1 ? pullRequests[0] : null;
  const allowed = new Set([
    text(pullRequest?.head?.ref),
    text(pullRequest?.base?.ref),
    text(pullRequest?.head?.ref) ? `refs/heads/${text(pullRequest.head.ref)}` : '',
    text(pullRequest?.base?.ref) ? `refs/heads/${text(pullRequest.base.ref)}` : '',
    strictPositiveInteger(pullRequest?.number) ? `refs/pull/${pullRequest.number}/merge` : '',
  ].filter(Boolean));
  if (!allowed.has(suffix)) return '';
  return path.slice(0, at);
}

function canonicalPersonalRepositoryDispatchWorkflowPath(run = {}, repository = '') {
  let path = text(run?.path);
  if (repository && path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const at = path.indexOf('@');
  if (at === -1) return path;
  if (at === 0 || at === path.length - 1 || path.indexOf('@', at + 1) !== -1) return '';
  if (!['main', 'refs/heads/main'].includes(path.slice(at + 1))) return '';
  return path.slice(0, at);
}

function personalRepositoryDispatchActor(run = {}) {
  return text(run?.triggering_actor?.login || run?.actor?.login).toLowerCase();
}

function personalRepositoryDispatchTitle(sourceHead = '') {
  return `Protected operator merge ${text(sourceHead).toLowerCase()}`;
}

export function validatePersonalRepositoryDispatchWorkflowDefinition(definitions = []) {
  const blockers = [];
  if (!Array.isArray(definitions)) {
    blockers.push('personal-repository-workflow-definitions-invalid');
  }
  const matches = (Array.isArray(definitions) ? definitions : []).filter((definition) => (
    text(definition?.path) === PERSONAL_REPOSITORY_WORKFLOW_PATH
  ));
  const definition = matches[0];
  if (matches.length !== 1
    || definition?.name !== PERSONAL_REPOSITORY_WORKFLOW_NAME
    || definition?.state !== 'active'
    || !strictPositiveInteger(definition?.id)) {
    blockers.push('personal-repository-workflow-definition-not-exact');
  }
  const valid = blockers.length === 0;
  return Object.freeze({
    valid,
    definition: valid ? Object.freeze({
      id: definition.id,
      name: definition.name,
      path: definition.path,
      state: definition.state,
    }) : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: valid
      ? 'PERSONAL_REPOSITORY_DISPATCH_WORKFLOW_DEFINITION_READY'
      : 'PERSONAL_REPOSITORY_DISPATCH_WORKFLOW_DEFINITION_BLOCKED',
  });
}

export function validatePersonalRepositoryDispatchExecution(input = {}, expected = {}) {
  const definitionValidation = validatePersonalRepositoryDispatchWorkflowDefinition(input.definitions);
  const definition = definitionValidation.definition;
  const run = input?.run && typeof input.run === 'object' && !Array.isArray(input.run)
    ? input.run
    : {};
  const priorRunsValid = Array.isArray(input?.priorRuns);
  const priorRuns = priorRunsValid ? input.priorRuns : [];
  const repository = text(expected.repository);
  const sourceHead = text(expected.sourceHead).toLowerCase();
  const baseSha = text(expected.baseSha).toLowerCase();
  const workflowRunId = strictPositiveInteger(expected.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(expected.workflowRunAttempt);
  const expectedTitle = personalRepositoryDispatchTitle(sourceHead);
  const expectedActor = OPERATOR_MERGE_REVIEWER.toLowerCase();
  const currentMismatches = [
    ['run-id', strictPositiveInteger(run?.id) === workflowRunId],
    ['run-attempt', strictPositiveInteger(run?.run_attempt) === workflowRunAttempt],
    ['workflow-id', Boolean(definition) && strictPositiveInteger(run?.workflow_id) === definition.id],
    ['run-name', text(run?.name) === expectedTitle],
    ['event', text(run?.event) === 'workflow_dispatch'],
    ['repository', workflowRepository(run) === repository],
    ['base-head', SHA_PATTERN.test(baseSha) && text(run?.head_sha).toLowerCase() === baseSha],
    ['base-branch', text(run?.head_branch) === 'main'],
    ['display-title', text(run?.display_title) === expectedTitle],
    ['workflow-path', canonicalPersonalRepositoryDispatchWorkflowPath(run, repository) === PERSONAL_REPOSITORY_WORKFLOW_PATH],
    ['triggering-actor', personalRepositoryDispatchActor(run) === expectedActor],
    ['run-status', PERSONAL_REPOSITORY_ACTIVE_RUN_STATUSES.has(text(run?.status).toLowerCase())],
  ].filter(([, matches]) => !matches).map(([field]) => field);

  const malformedPriorRunIds = [];
  const replayRunIds = [];
  const differentBasePriorRunIds = [];
  for (const candidate of priorRuns) {
    const candidateId = strictPositiveInteger(candidate?.id);
    if (candidateId && candidateId === workflowRunId) continue;
    const candidateActor = personalRepositoryDispatchActor(candidate);
    const sourceMatching = text(candidate?.name) === expectedTitle
      || text(candidate?.display_title) === expectedTitle;
    if (!sourceMatching || (candidateActor && candidateActor !== expectedActor)) continue;
    const candidateBase = text(candidate?.head_sha).toLowerCase();
    const exactIdentity = Boolean(
      candidateId
      && strictPositiveInteger(candidate?.run_attempt)
      && definition
      && strictPositiveInteger(candidate?.workflow_id) === definition.id
      && text(candidate?.name) === expectedTitle
      && text(candidate?.display_title) === expectedTitle
      && text(candidate?.event) === 'workflow_dispatch'
      && workflowRepository(candidate) === repository
      && SHA_PATTERN.test(candidateBase)
      && text(candidate?.head_branch) === 'main'
      && canonicalPersonalRepositoryDispatchWorkflowPath(candidate, repository) === PERSONAL_REPOSITORY_WORKFLOW_PATH
      && candidateActor === expectedActor
    );
    if (!exactIdentity) {
      malformedPriorRunIds.push(candidateId || 0);
      continue;
    }
    if (candidateBase === baseSha) replayRunIds.push(candidateId);
    else differentBasePriorRunIds.push(candidateId);
  }

  const blockers = [
    ...definitionValidation.blockers,
    ...(!priorRunsValid ? ['personal-repository-prior-runs-invalid'] : []),
    ...(currentMismatches.length ? ['personal-repository-workflow-run-identity-mismatch'] : []),
    ...(malformedPriorRunIds.length ? ['personal-repository-prior-attempt-invalid'] : []),
    ...(replayRunIds.length ? ['personal-repository-prior-attempt-exists'] : []),
  ];
  return Object.freeze({
    valid: blockers.length === 0,
    definition,
    currentMismatches: Object.freeze(currentMismatches),
    malformedPriorRunIds: Object.freeze(malformedPriorRunIds.sort((left, right) => left - right)),
    replayRunIds: Object.freeze(replayRunIds.sort((left, right) => left - right)),
    differentBasePriorRunIds: Object.freeze(differentBasePriorRunIds.sort((left, right) => left - right)),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_DISPATCH_EXECUTION_BLOCKED'
      : 'PERSONAL_REPOSITORY_DISPATCH_EXECUTION_READY',
  });
}

export function parsePersonalRepositoryDispatchInputs(inputs = {}) {
  const parsed = Object.freeze({
    mode: text(inputs.mode),
    prNumber: parsePositiveInteger(inputs.pr_number),
    branch: text(inputs.expected_branch),
    sourceHead: text(inputs.expected_head).toLowerCase(),
    sourceTree: text(inputs.expected_head_tree).toLowerCase(),
    baseSha: text(inputs.expected_base).toLowerCase(),
    independentReviewWorkflowRunId: parsePositiveInteger(inputs.independent_review_run_id),
    independentReviewWorkflowRunAttempt: parsePositiveInteger(inputs.independent_review_run_attempt),
    independentReviewArtifactId: parsePositiveInteger(inputs.independent_review_artifact_id),
    independentReviewArtifactDigest: text(inputs.independent_review_artifact_digest).toLowerCase(),
    independentReviewPayloadSha256: text(inputs.independent_review_payload_sha256).toLowerCase(),
  });
  const blockers = [];
  if (parsed.mode !== PERSONAL_REPOSITORY_MODE) blockers.push('personal-repository-mode-not-exact');
  if (!parsed.prNumber) blockers.push('personal-repository-pr-invalid');
  if (!BRANCH_PATTERN.test(parsed.branch) || parsed.branch.includes('..')) blockers.push('personal-repository-branch-invalid');
  for (const [key, blocker] of [
    ['sourceHead', 'personal-repository-head-invalid'],
    ['sourceTree', 'personal-repository-tree-invalid'],
    ['baseSha', 'personal-repository-base-invalid'],
  ]) {
    if (!SHA_PATTERN.test(parsed[key])) blockers.push(blocker);
  }
  if (parsed.sourceHead && parsed.sourceHead === parsed.baseSha) blockers.push('personal-repository-head-equals-base');
  if (!parsed.independentReviewWorkflowRunId) blockers.push('personal-repository-review-run-invalid');
  if (!parsed.independentReviewWorkflowRunAttempt) blockers.push('personal-repository-review-attempt-invalid');
  if (!parsed.independentReviewArtifactId) blockers.push('personal-repository-review-artifact-id-invalid');
  if (!ARTIFACT_DIGEST_PATTERN.test(parsed.independentReviewArtifactDigest)) {
    blockers.push('personal-repository-review-artifact-digest-invalid');
  }
  if (!SHA256_PATTERN.test(parsed.independentReviewPayloadSha256)) {
    blockers.push('personal-repository-review-payload-digest-invalid');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    identity: parsed,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_DISPATCH_BLOCKED'
      : 'PERSONAL_REPOSITORY_DISPATCH_READY',
  });
}

export function validatePersonalRepositoryWorkflowRuns(definitions = [], runs = [], expected = {}) {
  const blockers = [];
  const evidence = [];
  const repository = text(expected.repository);
  const prNumber = strictPositiveInteger(expected.prNumber);
  const branch = text(expected.branch);
  const sourceHead = text(expected.sourceHead).toLowerCase();
  const baseSha = text(expected.baseSha).toLowerCase();
  if (!Array.isArray(definitions)) blockers.push('personal-repository-workflow-definitions-invalid');
  if (!Array.isArray(runs)) blockers.push('personal-repository-workflow-runs-invalid');
  for (const required of PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS) {
    const matches = (Array.isArray(definitions) ? definitions : []).filter((definition) => (
      text(definition?.path) === required.path
    ));
    const definition = matches[0];
    if (matches.length !== 1
      || definition?.name !== required.name
      || definition?.state !== 'active'
      || !strictPositiveInteger(definition?.id)) {
      blockers.push(`personal-repository-workflow-definition-not-exact:${required.name}`);
      continue;
    }
    const candidates = (Array.isArray(runs) ? runs : []).filter((run) => (
      strictPositiveInteger(run?.workflow_id) === definition.id
      && text(run?.name) === required.name
      && canonicalWorkflowPath(run, repository) === required.path
      && text(run?.event) === required.event
      && workflowRepository(run) === repository
      && text(run?.head_sha).toLowerCase() === sourceHead
    )).sort((left, right) => (
      strictPositiveInteger(right?.run_number) - strictPositiveInteger(left?.run_number)
      || strictPositiveInteger(right?.id) - strictPositiveInteger(left?.id)
    ));
    const run = candidates[0];
    const bindings = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    const binding = bindings.length === 1 ? bindings[0] : null;
    if (!run
      || text(run?.status).toLowerCase() !== 'completed'
      || text(run?.conclusion).toLowerCase() !== 'success'
      || !strictPositiveInteger(run?.id)
      || !strictPositiveInteger(run?.run_attempt)
      || bindings.length !== 1
      || strictPositiveInteger(binding?.number) !== prNumber
      || text(binding?.head?.sha).toLowerCase() !== sourceHead
      || text(binding?.head?.ref) !== branch
      || text(binding?.base?.sha).toLowerCase() !== baseSha
      || text(binding?.base?.ref) !== 'main') {
      blockers.push(`personal-repository-workflow-run-not-exact-green:${required.name}`);
      continue;
    }
    evidence.push(Object.freeze({
      name: required.name,
      path: required.path,
      workflowId: definition.id,
      runId: run.id,
      runAttempt: run.run_attempt,
      checkSuiteId: strictPositiveInteger(run?.check_suite_id) || null,
    }));
  }
  return Object.freeze({
    valid: blockers.length === 0 && evidence.length === PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.length,
    evidence: Object.freeze(evidence),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_WORKFLOWS_BLOCKED'
      : 'PERSONAL_REPOSITORY_WORKFLOWS_READY',
  });
}

export function validatePersonalRepositoryEvidence(input = {}, expected = {}) {
  const blockers = [];
  const repository = text(input.repository);
  const pullRequest = input.pullRequest && typeof input.pullRequest === 'object' ? input.pullRequest : {};
  const liveMainRef = text(input?.liveMainRef?.object?.sha ?? input?.liveMainRef?.sha).toLowerCase();
  const sourceHead = text(pullRequest?.head?.sha).toLowerCase();
  const sourceTree = text(input?.headCommit?.tree?.sha ?? input?.headCommit?.tree).toLowerCase();
  const baseSha = text(pullRequest?.base?.sha).toLowerCase();
  const branch = text(pullRequest?.head?.ref);
  const prNumber = strictPositiveInteger(pullRequest?.number);
  const workflowRunId = strictPositiveInteger(input.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(input.workflowRunAttempt);
  const reviewDecisionObserved = Object.hasOwn(input, 'reviewDecision');
  const reviewDecision = text(input.reviewDecision).toUpperCase();
  const mergeable = text(input.mergeable).toUpperCase();
  const mergeStateStatus = text(input.mergeStateStatus).toUpperCase();
  const comparison = input.comparison && typeof input.comparison === 'object' ? input.comparison : {};

  if (!REPOSITORY_PATTERN.test(repository)) blockers.push('personal-repository-repository-invalid');
  if (input.eventName !== 'workflow_dispatch') blockers.push('personal-repository-event-not-workflow-dispatch');
  if (text(input.repositoryOwnerType).toLowerCase() !== 'user') blockers.push('personal-repository-owner-not-user');
  if (text(input.triggeringActor).toLowerCase() !== OPERATOR_MERGE_REVIEWER.toLowerCase()) {
    blockers.push('personal-repository-triggering-actor-not-operator');
  }
  if (!workflowRunId) blockers.push('personal-repository-workflow-run-invalid');
  if (!workflowRunAttempt) blockers.push('personal-repository-workflow-attempt-invalid');
  if (!prNumber) blockers.push('personal-repository-pr-number-invalid');
  if (text(pullRequest.state).toLowerCase() !== 'open') blockers.push('personal-repository-pr-not-open');
  if (pullRequest.draft !== false) blockers.push('personal-repository-pr-draft');
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..')) blockers.push('personal-repository-pr-branch-invalid');
  if (!SHA_PATTERN.test(sourceHead)) blockers.push('personal-repository-source-head-invalid');
  if (!SHA_PATTERN.test(sourceTree)) blockers.push('personal-repository-source-tree-invalid');
  if (text(input?.headCommit?.sha).toLowerCase() !== sourceHead) blockers.push('personal-repository-head-commit-mismatch');
  if (text(pullRequest?.base?.ref) !== 'main') blockers.push('personal-repository-base-ref-not-main');
  if (!SHA_PATTERN.test(baseSha)) blockers.push('personal-repository-base-sha-invalid');
  if (liveMainRef !== baseSha) blockers.push('personal-repository-live-main-mismatch');
  if (sourceHead && sourceHead === baseSha) blockers.push('personal-repository-head-equals-base');
  if (!reviewDecisionObserved) blockers.push('personal-repository-review-decision-missing');
  if (reviewDecision === 'CHANGES_REQUESTED') blockers.push('personal-repository-changes-requested');
  else if (!['', 'APPROVED'].includes(reviewDecision)) blockers.push('personal-repository-review-decision-unsupported');
  if (mergeable !== 'MERGEABLE') blockers.push('personal-repository-pr-not-mergeable');
  if (mergeStateStatus !== 'CLEAN') blockers.push('personal-repository-pr-not-clean');
  if (!Number.isSafeInteger(input.unresolvedThreadCount) || input.unresolvedThreadCount !== 0) {
    blockers.push('personal-repository-conversations-not-resolved');
  }
  if (text(comparison.status).toLowerCase() !== 'ahead'
    || !Number.isSafeInteger(comparison.ahead_by)
    || comparison.ahead_by < 1
    || comparison.behind_by !== 0
    || text(comparison?.base_commit?.sha).toLowerCase() !== baseSha
    || text(comparison?.merge_base_commit?.sha).toLowerCase() !== baseSha) {
    blockers.push('personal-repository-comparison-not-exact-forward');
  }

  for (const [key, observed, normalize, blocker] of [
    ['repository', repository, text(expected.repository), 'personal-repository-expected-repository-mismatch'],
    ['prNumber', prNumber, strictPositiveInteger(expected.prNumber), 'personal-repository-expected-pr-mismatch'],
    ['branch', branch, text(expected.branch), 'personal-repository-expected-branch-mismatch'],
    ['sourceHead', sourceHead, text(expected.sourceHead).toLowerCase(), 'personal-repository-expected-head-mismatch'],
    ['sourceTree', sourceTree, text(expected.sourceTree).toLowerCase(), 'personal-repository-expected-tree-mismatch'],
    ['baseSha', baseSha, text(expected.baseSha).toLowerCase(), 'personal-repository-expected-base-mismatch'],
    ['workflowRunId', workflowRunId, strictPositiveInteger(expected.workflowRunId), 'personal-repository-expected-run-mismatch'],
    ['workflowRunAttempt', workflowRunAttempt, strictPositiveInteger(expected.workflowRunAttempt), 'personal-repository-expected-attempt-mismatch'],
  ]) {
    if (Object.hasOwn(expected, key) && (!normalize || observed !== normalize)) blockers.push(blocker);
  }

  return Object.freeze({
    valid: blockers.length === 0,
    identity: Object.freeze({
      repository,
      prNumber,
      branch,
      sourceHead,
      sourceTree,
      baseSha,
      workflowRunId,
      workflowRunAttempt,
    }),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_EVIDENCE_BLOCKED'
      : 'PERSONAL_REPOSITORY_EVIDENCE_READY',
  });
}

function rulesOfType(activeRules, type) {
  return activeRules.filter((rule) => text(rule?.type).toLowerCase() === type);
}

function configurationNotProved(blockers, detail) {
  blockers.push(`CONFIGURATION_NOT_PROVED:${detail}`);
}

export function validatePersonalRepositoryConfiguration(input = {}, options = {}) {
  const blockers = [];
  const repository = input.repository && typeof input.repository === 'object' ? input.repository : {};
  const activeRules = Array.isArray(input.activeRules) ? input.activeRules : null;
  const rulesets = Array.isArray(input.rulesets) ? input.rulesets : null;
  const requiredCheck = text(options.requiredCheck || PERSONAL_REPOSITORY_REQUIRED_CHECK);
  const expectedIntegrationId = strictPositiveInteger(options.expectedIntegrationId);
  const requireBypassProof = options.requireBypassProof !== false;
  const environment = validateProtectedEnvironment(input.environment, {
    expectedName: OPERATOR_MERGE_ENVIRONMENT,
    expectedReviewer: OPERATOR_MERGE_REVIEWER,
  });
  if (!environment.valid) blockers.push(...environment.blockers);
  if (text(repository?.owner?.type).toLowerCase() !== 'user') blockers.push('personal-repository-configuration-owner-not-user');
  if (repository?.private !== false || text(repository?.visibility).toLowerCase() !== 'public') {
    blockers.push('personal-repository-rules-api-not-public');
  }
  if (text(repository.default_branch) !== 'main') blockers.push('personal-repository-default-branch-not-main');
  if (repository.allow_squash_merge !== true) blockers.push('personal-repository-squash-not-enabled');
  if (repository.delete_branch_on_merge !== false) blockers.push('personal-repository-auto-delete-not-disabled');
  if (!activeRules) configurationNotProved(blockers, 'personal-repository-active-main-rules');
  if (!rulesets) configurationNotProved(blockers, 'personal-repository-active-rulesets');
  if (!requiredCheck) configurationNotProved(blockers, 'personal-repository-required-check-identity');
  if (!expectedIntegrationId) configurationNotProved(blockers, 'personal-repository-required-check-integration');

  const rules = activeRules || [];
  const pullRequestRules = rulesOfType(rules, 'pull_request');
  const statusCheckRules = rulesOfType(rules, 'required_status_checks');
  const mergeQueueRules = rulesOfType(rules, 'merge_queue');
  const nonFastForwardRules = rulesOfType(rules, 'non_fast_forward');
  const deletionRules = rulesOfType(rules, 'deletion');
  if (pullRequestRules.length !== 1) configurationNotProved(blockers, 'personal-repository-pull-request-rule-not-exact');
  if (statusCheckRules.length !== 1) configurationNotProved(blockers, 'personal-repository-status-check-rule-not-exact');
  if (mergeQueueRules.length !== 0) blockers.push('personal-repository-unavailable-merge-queue-rule-present');
  if (nonFastForwardRules.length < 1) configurationNotProved(blockers, 'personal-repository-non-fast-forward-rule-missing');
  if (deletionRules.length < 1) configurationNotProved(blockers, 'personal-repository-deletion-rule-missing');

  const pullRequestParameters = pullRequestRules[0]?.parameters || {};
  if (pullRequestParameters.required_approving_review_count !== 0) blockers.push('personal-repository-native-approval-count-not-zero');
  if (pullRequestParameters.required_review_thread_resolution !== true) blockers.push('personal-repository-conversation-resolution-not-enforced');
  if (pullRequestParameters.dismiss_stale_reviews_on_push !== true) blockers.push('personal-repository-stale-review-dismissal-not-enforced');
  if (pullRequestParameters.require_last_push_approval !== false) blockers.push('personal-repository-last-push-approval-not-disabled');
  if (pullRequestParameters.require_code_owner_review !== false) blockers.push('personal-repository-code-owner-review-not-disabled');

  const statusParameters = statusCheckRules[0]?.parameters || {};
  const requiredStatusChecks = Array.isArray(statusParameters.required_status_checks)
    ? statusParameters.required_status_checks
    : null;
  if (!requiredStatusChecks) {
    configurationNotProved(blockers, 'personal-repository-required-status-check-list');
  } else {
    const exactChecks = requiredStatusChecks.filter((check) => (
      text(check?.context) === requiredCheck
      && strictPositiveInteger(check?.integration_id) === expectedIntegrationId
    ));
    if (exactChecks.length !== 1) blockers.push('personal-repository-required-check-not-exact');
  }
  if (statusParameters.strict_required_status_checks_policy !== true) {
    blockers.push('personal-repository-strict-status-policy-not-enforced');
  }

  const activeRulesetIds = unique(rules.map((rule) => strictPositiveInteger(rule?.ruleset_id)).filter(Boolean));
  if (!rules.length || activeRulesetIds.length === 0
    || rules.some((rule) => !strictPositiveInteger(rule?.ruleset_id))) {
    configurationNotProved(blockers, 'personal-repository-active-rule-identities');
  }
  const suppliedRulesets = rulesets || [];
  const suppliedRulesetIds = suppliedRulesets.map((ruleset) => strictPositiveInteger(ruleset?.id));
  if (suppliedRulesetIds.some((id) => !id)
    || suppliedRulesetIds.length !== activeRulesetIds.length
    || activeRulesetIds.some((id) => !suppliedRulesetIds.includes(id))) {
    configurationNotProved(blockers, 'personal-repository-ruleset-evidence-not-exact');
  }
  for (const ruleset of suppliedRulesets) {
    const rulesetId = strictPositiveInteger(ruleset?.id);
    if (text(ruleset?.enforcement).toLowerCase() !== 'active') {
      blockers.push(`personal-repository-ruleset-not-active:${rulesetId || 'unknown'}`);
    }
    if (!EXPLICIT_TIMEZONE.test(text(ruleset?.updated_at))
      || !Number.isFinite(Date.parse(ruleset.updated_at))) {
      configurationNotProved(blockers, `personal-repository-ruleset-updated-at:${rulesetId || 'unknown'}`);
    }
    if (requireBypassProof && !Array.isArray(ruleset?.bypass_actors)) {
      configurationNotProved(blockers, `personal-repository-ruleset-bypass-actors:${rulesetId || 'unknown'}`);
    } else if (Array.isArray(ruleset?.bypass_actors) && ruleset.bypass_actors.length !== 0) {
      blockers.push(`personal-repository-ruleset-bypass-present:${rulesetId || 'unknown'}`);
    }
  }

  return Object.freeze({
    valid: blockers.length === 0,
    environment,
    requiredCheck,
    requiredCheckIntegrationId: expectedIntegrationId,
    activeRulesetIds: Object.freeze(activeRulesetIds),
    bypassProven: requireBypassProof,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_CONFIGURATION_BLOCKED'
      : requireBypassProof
        ? 'PERSONAL_REPOSITORY_CONFIGURATION_READY'
        : 'PERSONAL_REPOSITORY_CONFIGURATION_PREAPPROVAL_READY',
  });
}

const APPROVAL_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'repository',
  'prNumber',
  'branch',
  'sourceHead',
  'sourceTree',
  'baseSha',
  'workflowPath',
  'workflowRunId',
  'workflowRunAttempt',
  'environment',
  'requiredReviewer',
  'independentReviewWorkflowRunId',
  'independentReviewWorkflowRunAttempt',
  'independentReviewArtifactId',
  'independentReviewArtifactDigest',
  'independentReviewPayloadSha256',
  'evidenceSha256',
  'approvedAtUtc',
  'authority',
  'mergeMethod',
  'reusableAcrossHeads',
  'reusableAcrossBases',
]);

export function buildPersonalRepositoryApprovalReceipt(input = {}) {
  if (input?.evidence?.finalVerdict !== 'PERSONAL_REPOSITORY_EVIDENCE_READY'
    || input?.configuration?.finalVerdict !== 'PERSONAL_REPOSITORY_CONFIGURATION_READY'
    || input?.workflows?.finalVerdict !== 'PERSONAL_REPOSITORY_WORKFLOWS_READY') {
    throw new Error('Personal-repository approval requires ready identity, workflow and configuration evidence.');
  }
  const identity = input.evidence.identity;
  const receipt = {
    schemaVersion: 'stephanos.personal-repository-approval.v1',
    kind: 'stephanos.personal-repository.protected-squash-approval',
    repository: identity.repository,
    prNumber: identity.prNumber,
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    sourceTree: identity.sourceTree,
    baseSha: identity.baseSha,
    workflowPath: PERSONAL_REPOSITORY_WORKFLOW_PATH,
    workflowRunId: identity.workflowRunId,
    workflowRunAttempt: identity.workflowRunAttempt,
    environment: OPERATOR_MERGE_ENVIRONMENT,
    requiredReviewer: OPERATOR_MERGE_REVIEWER,
    independentReviewWorkflowRunId: strictPositiveInteger(input.independentReviewWorkflowRunId),
    independentReviewWorkflowRunAttempt: strictPositiveInteger(input.independentReviewWorkflowRunAttempt),
    independentReviewArtifactId: strictPositiveInteger(input.independentReviewArtifactId),
    independentReviewArtifactDigest: text(input.independentReviewArtifactDigest).toLowerCase(),
    independentReviewPayloadSha256: text(input.independentReviewPayloadSha256).toLowerCase(),
    evidenceSha256: text(input.evidenceSha256).toLowerCase(),
    approvedAtUtc: text(input.approvedAtUtc),
    authority: PERSONAL_REPOSITORY_AUTHORITY,
    mergeMethod: 'squash',
    reusableAcrossHeads: false,
    reusableAcrossBases: false,
  };
  const validation = validatePersonalRepositoryApprovalReceipt(receipt, receipt);
  if (!validation.valid) throw new Error(`Personal-repository approval is invalid: ${validation.blockers.join(', ')}`);
  return Object.freeze(receipt);
}

export function validatePersonalRepositoryApprovalReceipt(receipt = {}, expected = {}) {
  const blockers = [];
  if (!sameKeys(receipt, APPROVAL_RECEIPT_KEYS)) blockers.push('personal-repository-approval-schema-unbounded');
  if (receipt.schemaVersion !== 'stephanos.personal-repository-approval.v1') blockers.push('personal-repository-approval-schema-mismatch');
  if (receipt.kind !== 'stephanos.personal-repository.protected-squash-approval') blockers.push('personal-repository-approval-kind-mismatch');
  if (!REPOSITORY_PATTERN.test(text(receipt.repository))) blockers.push('personal-repository-approval-repository-invalid');
  if (!strictPositiveInteger(receipt.prNumber)) blockers.push('personal-repository-approval-pr-invalid');
  if (!BRANCH_PATTERN.test(text(receipt.branch)) || text(receipt.branch).includes('..')) blockers.push('personal-repository-approval-branch-invalid');
  for (const [key, blocker] of [
    ['sourceHead', 'personal-repository-approval-head-invalid'],
    ['sourceTree', 'personal-repository-approval-tree-invalid'],
    ['baseSha', 'personal-repository-approval-base-invalid'],
  ]) {
    if (!SHA_PATTERN.test(text(receipt[key]).toLowerCase())) blockers.push(blocker);
  }
  if (receipt.workflowPath !== PERSONAL_REPOSITORY_WORKFLOW_PATH) blockers.push('personal-repository-approval-workflow-path-mismatch');
  if (!strictPositiveInteger(receipt.workflowRunId)) blockers.push('personal-repository-approval-run-invalid');
  if (!strictPositiveInteger(receipt.workflowRunAttempt)) blockers.push('personal-repository-approval-attempt-invalid');
  if (receipt.environment !== OPERATOR_MERGE_ENVIRONMENT) blockers.push('personal-repository-approval-environment-mismatch');
  if (receipt.requiredReviewer !== OPERATOR_MERGE_REVIEWER) blockers.push('personal-repository-approval-reviewer-mismatch');
  if (!strictPositiveInteger(receipt.independentReviewWorkflowRunId)) blockers.push('personal-repository-approval-review-run-invalid');
  if (!strictPositiveInteger(receipt.independentReviewWorkflowRunAttempt)) blockers.push('personal-repository-approval-review-attempt-invalid');
  if (!strictPositiveInteger(receipt.independentReviewArtifactId)) blockers.push('personal-repository-approval-artifact-id-invalid');
  if (!ARTIFACT_DIGEST_PATTERN.test(text(receipt.independentReviewArtifactDigest))) blockers.push('personal-repository-approval-artifact-digest-invalid');
  if (!SHA256_PATTERN.test(text(receipt.independentReviewPayloadSha256))) blockers.push('personal-repository-approval-payload-digest-invalid');
  if (!SHA256_PATTERN.test(text(receipt.evidenceSha256))) blockers.push('personal-repository-approval-evidence-digest-invalid');
  if (!EXPLICIT_TIMEZONE.test(text(receipt.approvedAtUtc)) || !Number.isFinite(Date.parse(receipt.approvedAtUtc))) {
    blockers.push('personal-repository-approval-time-invalid');
  }
  if (receipt.authority !== PERSONAL_REPOSITORY_AUTHORITY) blockers.push('personal-repository-approval-authority-mismatch');
  if (receipt.mergeMethod !== 'squash') blockers.push('personal-repository-approval-merge-method-mismatch');
  if (receipt.reusableAcrossHeads !== false) blockers.push('personal-repository-approval-reusable-across-heads');
  if (receipt.reusableAcrossBases !== false) blockers.push('personal-repository-approval-reusable-across-bases');
  for (const [key, blocker] of [
    ['repository', 'personal-repository-approval-repository-mismatch'],
    ['prNumber', 'personal-repository-approval-pr-mismatch'],
    ['branch', 'personal-repository-approval-branch-mismatch'],
    ['sourceHead', 'personal-repository-approval-head-mismatch'],
    ['sourceTree', 'personal-repository-approval-tree-mismatch'],
    ['baseSha', 'personal-repository-approval-base-mismatch'],
    ['workflowRunId', 'personal-repository-approval-run-mismatch'],
    ['workflowRunAttempt', 'personal-repository-approval-attempt-mismatch'],
    ['independentReviewWorkflowRunId', 'personal-repository-approval-review-run-mismatch'],
    ['independentReviewWorkflowRunAttempt', 'personal-repository-approval-review-attempt-mismatch'],
    ['independentReviewArtifactId', 'personal-repository-approval-artifact-id-mismatch'],
    ['independentReviewArtifactDigest', 'personal-repository-approval-artifact-digest-mismatch'],
    ['independentReviewPayloadSha256', 'personal-repository-approval-payload-digest-mismatch'],
    ['evidenceSha256', 'personal-repository-approval-evidence-digest-mismatch'],
  ]) {
    if (Object.hasOwn(expected, key) && receipt[key] !== expected[key]) blockers.push(blocker);
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_APPROVAL_BLOCKED'
      : 'PERSONAL_REPOSITORY_APPROVAL_READY',
  });
}

export function validatePersonalRepositorySquashCompletion(input = {}, expected = {}) {
  const blockers = [];
  const mergeSha = text(input?.mergeResponse?.sha).toLowerCase();
  const mainSha = text(input?.liveMainRef?.object?.sha ?? input?.liveMainRef?.sha).toLowerCase();
  const commitSha = text(input?.mergeCommit?.sha).toLowerCase();
  const commitTree = text(input?.mergeCommit?.tree?.sha ?? input?.mergeCommit?.tree).toLowerCase();
  const parents = Array.isArray(input?.mergeCommit?.parents) ? input.mergeCommit.parents : [];
  const branchSha = text(input?.branchRef?.object?.sha ?? input?.branchRef?.sha).toLowerCase();
  const expectedHead = text(expected.sourceHead).toLowerCase();
  const expectedTree = text(expected.sourceTree).toLowerCase();
  const expectedBase = text(expected.baseSha).toLowerCase();
  if (input?.mergeResponse?.merged !== true || !SHA_PATTERN.test(mergeSha)) blockers.push('personal-repository-merge-response-invalid');
  if (input?.pullRequest?.merged !== true || text(input?.pullRequest?.merge_commit_sha).toLowerCase() !== mergeSha) {
    blockers.push('personal-repository-pr-not-exactly-merged');
  }
  if (!SHA_PATTERN.test(mainSha) || mainSha !== mergeSha) blockers.push('personal-repository-main-not-merge-commit');
  if (commitSha !== mergeSha) blockers.push('personal-repository-merge-commit-sha-mismatch');
  if (!SHA_PATTERN.test(commitTree) || commitTree !== expectedTree) blockers.push('personal-repository-merge-tree-mismatch');
  if (parents.length !== 1 || text(parents[0]?.sha ?? parents[0]).toLowerCase() !== expectedBase) {
    blockers.push('personal-repository-squash-parent-not-exact-base');
  }
  if (branchSha !== expectedHead) blockers.push('personal-repository-source-branch-deleted-or-moved');
  if (mergeSha === expectedHead || mergeSha === expectedBase) blockers.push('personal-repository-merge-commit-not-distinct');
  return Object.freeze({
    valid: blockers.length === 0,
    mergeSha,
    mainSha,
    treeSha: commitTree,
    branchSha,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_SQUASH_COMPLETION_BLOCKED'
      : 'PERSONAL_REPOSITORY_SQUASH_COMPLETION_READY',
  });
}
