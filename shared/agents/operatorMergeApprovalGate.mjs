import { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;

export const OPERATOR_MERGE_ENVIRONMENT = 'operator-merge-approval';
export const OPERATOR_MERGE_REVIEWER = 'Cheekyfellastef';
export const OPERATOR_MERGE_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const OPERATOR_MERGE_GATE_JOB = 'operator-approval-gate';
export const OPERATOR_MERGE_EXECUTOR_JOB = 'operator-approved-exact-head-merge';
export const PROTECTED_APPROVAL_MARKER = '<!-- stephanos-protected-operator-approval -->';
export const REQUIRED_EXACT_HEAD_WORKFLOWS = Object.freeze([
  'Build Stephanos UI',
  'PR Clean Guard',
  'Exact-Head Review Dispatch',
  'Battle Bridge Publisher Proof',
  'Codex Dispatch Queue Proof',
  'OpenClaw GitHub Operator',
  'Protected Operator Merge Source Proof',
]);

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function latestByName(runs = []) {
  const latest = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const name = text(run?.name);
    if (!name) continue;
    const sequence = Number(run?.run_number || run?.id || 0);
    const current = latest.get(name);
    const currentSequence = Number(current?.run_number || current?.id || 0);
    if (!current || sequence >= currentSequence) latest.set(name, run);
  }
  return latest;
}

function reviewerLogins(environment = {}) {
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const requiredRule = rules.find((rule) => rule?.type === 'required_reviewers');
  const reviewers = Array.isArray(requiredRule?.reviewers) ? requiredRule.reviewers : [];
  return Object.freeze(reviewers
    .filter((entry) => text(entry?.type).toLowerCase() === 'user')
    .map((entry) => text(entry?.reviewer?.login).toLowerCase())
    .filter(Boolean));
}

export function extractJsonObjects(markdown = '') {
  const objects = [];
  const pattern = /```json\s*([\s\S]*?)```/gi;
  for (const match of text(markdown).matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) objects.push(parsed);
    } catch {
      // Malformed JSON blocks are ignored and therefore cannot satisfy a gate.
    }
  }
  return Object.freeze(objects);
}

export function validateProtectedEnvironment(environment = {}, options = {}) {
  const expectedName = text(options.expectedName || OPERATOR_MERGE_ENVIRONMENT);
  const expectedReviewer = text(options.expectedReviewer || OPERATOR_MERGE_REVIEWER).toLowerCase();
  const blockers = [];
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const requiredRule = rules.find((rule) => rule?.type === 'required_reviewers');
  const logins = reviewerLogins(environment);

  if (text(environment.name) !== expectedName) blockers.push('protected-environment-name-mismatch');
  if (!requiredRule) blockers.push('required-reviewer-rule-missing');
  if (!logins.includes(expectedReviewer)) blockers.push('required-operator-reviewer-missing');
  if (environment.can_admins_bypass !== false) blockers.push('environment-admin-bypass-not-disabled');
  if (environment?.deployment_branch_policy?.protected_branches !== true
    || environment?.deployment_branch_policy?.custom_branch_policies !== false) {
    blockers.push('environment-not-limited-to-protected-branches');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    environment: text(environment.name),
    requiredReviewerLogins: logins,
    preventSelfReview: requiredRule?.prevent_self_review === true,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'PROTECTED_ENVIRONMENT_BLOCKED' : 'PROTECTED_ENVIRONMENT_READY',
  });
}

export function validateExactHeadWorkflowRuns(runs = [], options = {}) {
  const expectedHead = text(options.expectedHead).toLowerCase();
  const requiredNames = Array.isArray(options.requiredNames)
    ? options.requiredNames.map(text).filter(Boolean)
    : REQUIRED_EXACT_HEAD_WORKFLOWS;
  const latest = latestByName(runs);
  const blockers = [];
  const evidence = [];

  for (const name of requiredNames) {
    const run = latest.get(name);
    if (!run) {
      blockers.push(`missing-workflow:${name}`);
      continue;
    }
    const head = text(run.head_sha || run.headSha).toLowerCase();
    const conclusion = text(run.conclusion).toLowerCase();
    const status = text(run.status).toLowerCase();
    evidence.push(Object.freeze({ name, head, status, conclusion, runId: integer(run.id) }));
    if (!SHA_PATTERN.test(expectedHead) || head !== expectedHead) blockers.push(`workflow-head-mismatch:${name}`);
    if (status !== 'completed' || conclusion !== 'success') blockers.push(`workflow-not-green:${name}`);
  }

  return Object.freeze({
    valid: blockers.length === 0,
    evidence: Object.freeze(evidence),
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'EXACT_HEAD_WORKFLOWS_BLOCKED' : 'EXACT_HEAD_WORKFLOWS_READY',
  });
}

export function findCleanSpecialistReview(markdownBodies = [], options = {}) {
  const candidates = [];
  for (const body of Array.isArray(markdownBodies) ? markdownBodies : []) {
    candidates.push(...extractJsonObjects(body));
  }
  const validations = candidates.map((receipt) => ({
    receipt,
    validation: validateProviderNeutralReviewReceipt(receipt, {
      repository: options.repository,
      prNumber: options.prNumber,
      branch: options.branch,
      expectedHead: options.expectedHead,
      riskTier: 'high',
    }),
  }));
  const accepted = validations.find(({ receipt, validation }) => (
    validation.valid
    && receipt.verdict === 'clean'
    && receipt.riskTier === 'high'
    && receipt.assuranceMode === 'specialist'
    && validation.findingCounts.p0 === 0
    && validation.findingCounts.p1 === 0
    && validation.findingCounts.p2 === 0
  ));
  return Object.freeze({
    valid: Boolean(accepted),
    receipt: accepted?.receipt || null,
    attemptedReceiptCount: validations.length,
    refusalReasons: Object.freeze(validations
      .filter(({ validation }) => !validation.valid)
      .map(({ validation }) => validation.refusalReason)
      .filter(Boolean)),
    finalVerdict: accepted ? 'SPECIALIST_REVIEW_READY' : 'SPECIALIST_REVIEW_BLOCKED',
  });
}

export function validateProtectedOperatorMergeEvidence(input = {}) {
  const repository = text(input.repository);
  const expectedPrNumber = integer(input.prNumber);
  const expectedHead = text(input.sourceHead).toLowerCase();
  const expectedBranch = text(input.branch);
  const expectedBase = text(input.baseBranch || 'main');
  const pullRequest = input.pullRequest && typeof input.pullRequest === 'object' ? input.pullRequest : {};
  const workflowRun = input.workflowRun && typeof input.workflowRun === 'object' ? input.workflowRun : {};
  const blockers = [];

  const environment = validateProtectedEnvironment(input.environment, {
    expectedName: OPERATOR_MERGE_ENVIRONMENT,
    expectedReviewer: OPERATOR_MERGE_REVIEWER,
  });
  if (!environment.valid) blockers.push(...environment.blockers);

  if (!SHA_PATTERN.test(expectedHead)) blockers.push('invalid-exact-head');
  if (integer(pullRequest.number) !== expectedPrNumber) blockers.push('pull-request-number-mismatch');
  if (text(pullRequest.state).toLowerCase() !== 'open') blockers.push('pull-request-not-open');
  if (pullRequest.draft !== false) blockers.push('pull-request-still-draft');
  if (text(pullRequest?.head?.sha).toLowerCase() !== expectedHead) blockers.push('pull-request-head-mismatch');
  if (text(pullRequest?.head?.ref) !== expectedBranch) blockers.push('pull-request-branch-mismatch');
  if (text(pullRequest?.base?.ref) !== expectedBase) blockers.push('pull-request-base-mismatch');
  if (text(workflowRun.event) !== 'pull_request_target') blockers.push('untrusted-workflow-event');
  if (text(workflowRun.path) !== OPERATOR_MERGE_WORKFLOW_PATH) blockers.push('untrusted-workflow-path');
  if (text(workflowRun.repository?.full_name || workflowRun.repository) !== repository) blockers.push('workflow-repository-mismatch');

  const workflows = validateExactHeadWorkflowRuns(input.workflowRuns, { expectedHead });
  if (!workflows.valid) blockers.push(...workflows.blockers);

  const review = findCleanSpecialistReview(input.reviewBodies, {
    repository,
    prNumber: expectedPrNumber,
    branch: expectedBranch,
    expectedHead,
  });
  if (!review.valid) blockers.push('clean-high-risk-specialist-review-missing');

  if (integer(input.unresolvedThreadCount) !== 0) blockers.push('unresolved-review-threads');

  return Object.freeze({
    schemaVersion: 'stephanos.protected-operator-merge-evidence.v1',
    repository,
    prNumber: expectedPrNumber,
    sourceHead: expectedHead,
    branch: expectedBranch,
    environment,
    workflows,
    review,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length ? 'PROTECTED_OPERATOR_MERGE_BLOCKED' : 'PROTECTED_OPERATOR_MERGE_READY',
  });
}

export function buildProtectedApprovalReceipt(input = {}) {
  if (input?.verdict?.finalVerdict !== 'PROTECTED_OPERATOR_MERGE_READY') {
    throw new Error('Protected operator merge evidence must be ready before a receipt is created.');
  }
  return Object.freeze({
    schemaVersion: 'stephanos.protected-operator-approval.v1',
    kind: 'stephanos.protected-operator-approval',
    repository: input.verdict.repository,
    prNumber: input.verdict.prNumber,
    sourceHead: input.verdict.sourceHead,
    branch: input.verdict.branch,
    environment: OPERATOR_MERGE_ENVIRONMENT,
    requiredReviewer: OPERATOR_MERGE_REVIEWER,
    workflowPath: OPERATOR_MERGE_WORKFLOW_PATH,
    workflowRunId: integer(input.workflowRunId),
    workflowRunAttempt: integer(input.workflowRunAttempt),
    approvedAtUtc: text(input.approvedAtUtc),
    mergeExecutionAuthority: 'github-actions-protected-environment-only',
    reusableAcrossHeads: false,
  });
}
