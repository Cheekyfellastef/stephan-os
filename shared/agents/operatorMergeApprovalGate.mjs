import {
  createProviderNeutralReviewReceipt,
  validateProviderNeutralReviewReceipt,
} from './providerNeutralReviewV1.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;

export const OPERATOR_MERGE_ENVIRONMENT = 'operator-merge-approval';
export const OPERATOR_MERGE_REVIEWER = 'Cheekyfellastef';
export const OPERATOR_MERGE_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const OPERATOR_MERGE_GATE_JOB = 'operator-approval-gate';
export const OPERATOR_MERGE_EXECUTOR_JOB = 'operator-approved-exact-head-merge';
export const PROTECTED_REVIEW_MARKER = '<!-- stephanos-protected-security-review -->';
export const PROTECTED_APPROVAL_MARKER = '<!-- stephanos-protected-operator-approval -->';
export const PROTECTED_REVIEWER_ID = 'github-actions-protected-security-gate';
export const PROTECTED_REVIEWER_CLASS = 'external-qualified';
export const PROTECTED_REVIEW_PROVIDER = 'github-protected-environment-security';
export const PROTECTED_REVIEW_MODEL_CLASS = 'human-plus-deterministic';
export const PROGRAMME_CONTROL_ISSUE = 1568;
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

function reviewerConfiguration(environment = {}) {
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const requiredRules = rules.filter((rule) => rule?.type === 'required_reviewers');
  const requiredRule = requiredRules[0] || null;
  const reviewers = Array.isArray(requiredRule?.reviewers) ? requiredRule.reviewers : [];
  const normalizedReviewers = reviewers.map((entry) => Object.freeze({
    type: text(entry?.type).toLowerCase(),
    login: text(entry?.reviewer?.login).toLowerCase(),
    slug: text(entry?.reviewer?.slug).toLowerCase(),
  }));
  const userLogins = normalizedReviewers
    .filter((entry) => entry.type === 'user' && entry.login)
    .map((entry) => entry.login);
  return Object.freeze({
    requiredRules: Object.freeze(requiredRules),
    requiredRule,
    reviewers: Object.freeze(reviewers),
    normalizedReviewers: Object.freeze(normalizedReviewers),
    userLogins: Object.freeze(userLogins),
  });
}

function trustedReviewerSessionId(workflowRunId, workflowRunAttempt) {
  return `github-actions-run-${integer(workflowRunId)}-attempt-${integer(workflowRunAttempt)}`;
}

function implementationSessionId(prNumber) {
  return `pr-${integer(prNumber)}-implementation-lane`;
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
  const configuration = reviewerConfiguration(environment);
  const {
    requiredRules,
    requiredRule,
    reviewers,
    normalizedReviewers,
    userLogins,
  } = configuration;
  const soleReviewer = normalizedReviewers[0] || null;

  if (text(environment.name) !== expectedName) blockers.push('protected-environment-name-mismatch');
  if (!requiredRule) blockers.push('required-reviewer-rule-missing');
  if (requiredRules.length !== 1) blockers.push('required-reviewer-rule-count-not-exact');
  if (!userLogins.includes(expectedReviewer)) blockers.push('required-operator-reviewer-missing');
  if (reviewers.length !== 1
    || soleReviewer?.type !== 'user'
    || soleReviewer?.login !== expectedReviewer
    || Boolean(soleReviewer?.slug)) {
    blockers.push('required-reviewer-set-not-exact');
  }
  if (environment.can_admins_bypass !== false) blockers.push('environment-admin-bypass-not-disabled');
  if (environment?.deployment_branch_policy?.protected_branches !== true
    || environment?.deployment_branch_policy?.custom_branch_policies !== false) {
    blockers.push('environment-not-limited-to-protected-branches');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    environment: text(environment.name),
    requiredReviewerLogins: userLogins,
    requiredReviewerCount: reviewers.length,
    requiredReviewerTypes: Object.freeze(normalizedReviewers.map((entry) => entry.type)),
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

export function buildProtectedSecurityReviewReceipt(input = {}) {
  const repository = text(input.repository);
  const prNumber = integer(input.prNumber);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const branch = text(input.branch);
  const workflowRunId = integer(input.workflowRunId);
  const workflowRunAttempt = integer(input.workflowRunAttempt);
  const timestampUtc = text(input.timestampUtc || new Date().toISOString());
  if (!repository || !prNumber || !SHA_PATTERN.test(sourceHead) || !branch || !workflowRunId || !workflowRunAttempt) {
    throw new Error('Protected security review receipt requires repository, PR, branch, exact head and workflow run identity.');
  }
  return createProviderNeutralReviewReceipt({
    receiptId: `protected-review-pr${prNumber}-run${workflowRunId}-attempt${workflowRunAttempt}`,
    repository,
    issueNumber: PROGRAMME_CONTROL_ISSUE,
    prNumber,
    branch,
    sourceHead,
    reviewerId: PROTECTED_REVIEWER_ID,
    reviewerClass: PROTECTED_REVIEWER_CLASS,
    provider: PROTECTED_REVIEW_PROVIDER,
    modelClass: PROTECTED_REVIEW_MODEL_CLASS,
    reviewerSessionId: trustedReviewerSessionId(workflowRunId, workflowRunAttempt),
    implementerProvider: 'canonical-programme-builder',
    implementerSessionId: implementationSessionId(prNumber),
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: [
      'protected-environment-human-release',
      'trusted-default-branch-gate',
      'exact-head-workflows',
      'review-thread-resolution',
      'merge-authority-separation',
    ],
    findings: [],
    verdict: 'clean',
    timestampUtc,
    proofRefs: [
      `proofs/operator-merge/run-${workflowRunId}`,
      `proofs/operator-merge/head-${sourceHead.slice(0, 12)}`,
      `proofs/operator-merge/environment-${OPERATOR_MERGE_ENVIRONMENT}`,
    ],
    quorumChecks: [],
    blocker: '',
  });
}

export function validateTrustedProtectedReviewReceipt(receipt = {}, options = {}) {
  const repository = text(options.repository);
  const prNumber = integer(options.prNumber);
  const branch = text(options.branch);
  const expectedHead = text(options.expectedHead).toLowerCase();
  const workflowRunId = integer(options.workflowRunId);
  const workflowRunAttempt = integer(options.workflowRunAttempt);
  const validation = validateProviderNeutralReviewReceipt(receipt, {
    repository,
    prNumber,
    branch,
    expectedHead,
    riskTier: 'high',
  });
  const blockers = [...validation.errors];

  if (receipt.issueNumber !== PROGRAMME_CONTROL_ISSUE) blockers.push('protected-review-issue-mismatch');
  if (receipt.reviewerId !== PROTECTED_REVIEWER_ID) blockers.push('protected-reviewer-id-mismatch');
  if (receipt.reviewerClass !== PROTECTED_REVIEWER_CLASS) blockers.push('protected-reviewer-class-mismatch');
  if (receipt.provider !== PROTECTED_REVIEW_PROVIDER) blockers.push('protected-review-provider-mismatch');
  if (receipt.modelClass !== PROTECTED_REVIEW_MODEL_CLASS) blockers.push('protected-review-model-class-mismatch');
  if (receipt.reviewerSessionId !== trustedReviewerSessionId(workflowRunId, workflowRunAttempt)) {
    blockers.push('protected-review-workflow-session-mismatch');
  }
  if (receipt.implementerProvider !== 'canonical-programme-builder'
    || receipt.implementerSessionId !== implementationSessionId(prNumber)) {
    blockers.push('protected-review-implementation-binding-mismatch');
  }
  if (receipt.riskTier !== 'high' || receipt.assuranceMode !== 'specialist') {
    blockers.push('protected-review-assurance-mismatch');
  }
  if (receipt.verdict !== 'clean' || receipt.findings?.length !== 0 || receipt.blocker !== '') {
    blockers.push('protected-review-not-clean');
  }
  if (!workflowRunId || !workflowRunAttempt) blockers.push('protected-review-workflow-identity-missing');

  return Object.freeze({
    valid: blockers.length === 0,
    receipt,
    validation,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length ? 'TRUSTED_PROTECTED_REVIEW_BLOCKED' : 'TRUSTED_PROTECTED_REVIEW_READY',
  });
}

export function validateProtectedOperatorMergePrerequisites(input = {}) {
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
  if (integer(input.unresolvedThreadCount) !== 0) blockers.push('unresolved-review-threads');

  return Object.freeze({
    schemaVersion: 'stephanos.protected-operator-merge-prerequisites.v1',
    repository,
    prNumber: expectedPrNumber,
    sourceHead: expectedHead,
    branch: expectedBranch,
    environment,
    workflows,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length
      ? 'PROTECTED_OPERATOR_PREREQUISITES_BLOCKED'
      : 'PROTECTED_OPERATOR_PREREQUISITES_READY',
  });
}

export function validateProtectedOperatorMergeEvidence(input = {}) {
  const prerequisites = validateProtectedOperatorMergePrerequisites(input);
  const review = validateTrustedProtectedReviewReceipt(input.trustedReviewReceipt, {
    repository: prerequisites.repository,
    prNumber: prerequisites.prNumber,
    branch: prerequisites.branch,
    expectedHead: prerequisites.sourceHead,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
  });
  const blockers = [...prerequisites.blockers];
  if (!review.valid) blockers.push(...review.blockers);

  return Object.freeze({
    schemaVersion: 'stephanos.protected-operator-merge-evidence.v2',
    repository: prerequisites.repository,
    prNumber: prerequisites.prNumber,
    sourceHead: prerequisites.sourceHead,
    branch: prerequisites.branch,
    environment: prerequisites.environment,
    workflows: prerequisites.workflows,
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
