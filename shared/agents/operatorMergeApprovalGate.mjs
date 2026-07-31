import {
  createProviderNeutralReviewReceipt,
  validateProviderNeutralReviewReceipt,
} from './providerNeutralReviewV1.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REVIEW_SESSION_PATTERN = /^github-actions-independent-review-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

export const OPERATOR_MERGE_ENVIRONMENT = 'operator-merge-approval';
export const OPERATOR_MERGE_PROTECTION_BOUNDARY = 'github-protected-environment:operator-merge-approval';
export const OPERATOR_MERGE_REVIEWER = 'Cheekyfellastef';
export const OPERATOR_MERGE_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const OPERATOR_MERGE_GATE_JOB = 'operator-approval-gate';
export const OPERATOR_MERGE_EXECUTOR_JOB = 'operator-approved-exact-head-merge';
export const INDEPENDENT_REVIEW_WORKFLOW_PATH = '.github/workflows/independent-merge-security-review.yml';
export const INDEPENDENT_REVIEW_WORKFLOW_NAME = 'Independent Merge Security Review';
export const INDEPENDENT_REVIEW_JOB = 'independent-security-review';
export const PROTECTED_REVIEW_MARKER = '<!-- stephanos-protected-security-review -->';
export const PROTECTED_APPROVAL_MARKER = '<!-- stephanos-protected-operator-approval -->';
export const PROTECTED_REVIEWER_ID = 'github-actions-independent-security-review';
export const PROTECTED_REVIEWER_CLASS = 'external-qualified';
export const PROTECTED_REVIEW_PROVIDER = 'github-actions-independent-review';
export const PROTECTED_REVIEW_MODEL_CLASS = 'source-controlled-high-assurance';
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

const APPROVAL_BOUNDARY_PATHS = Object.freeze([
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
  'scripts/operator-protected-merge-gate.mjs',
  'scripts/independent-merge-security-review.mjs',
  'shared/agents/operatorMergeApprovalGate.mjs',
  'shared/agents/operatorMergeApprovalGate.test.mjs',
  'shared/agents/repositoryNativePublishMergeLane.mjs',
  'scripts/repository-native-publish-merge-lane.mjs',
]);

const UNSUPPORTED_HIGH_RISK_PATH_PATTERNS = Object.freeze([
  /(^|\/)scripts\/windows\//i,
  /(^|\/)openclaw/i,
  /credential|secret|token|billing|payment/i,
  /(^|\/)deployment/i,
]);

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function unique(values) {
  return [...new Set(values)];
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

function independentReviewerSessionId(workflowRunId, workflowRunAttempt) {
  return `github-actions-independent-review-run-${integer(workflowRunId)}-attempt-${integer(workflowRunAttempt)}`;
}

function implementationSessionId(prNumber) {
  return `pr-${integer(prNumber)}-implementation-lane`;
}

function finding(severity, code, summary, path) {
  return Object.freeze({ severity, code, summary, path });
}

function changedFilePath(item) {
  return text(typeof item === 'string' ? item : item?.filename ?? item?.path);
}

function diffForPath(diff, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(diff || '').match(new RegExp(`(?:^|\\n)diff --git a/${escaped} b/${escaped}([\\s\\S]*?)(?=\\ndiff --git a/|$)`));
  return match?.[1] || '';
}

export function extractJsonObjects(markdown = '') {
  const objects = [];
  const pattern = /```json\s*([\s\S]*?)```/gi;
  for (const match of text(markdown).matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) objects.push(parsed);
    } catch {
      // Malformed JSON cannot satisfy a gate.
    }
  }
  return Object.freeze(objects);
}

export function parseIndependentReviewSessionId(value) {
  const match = text(value).match(REVIEW_SESSION_PATTERN);
  if (!match) return null;
  return Object.freeze({ workflowRunId: integer(match[1]), workflowRunAttempt: integer(match[2]) });
}

export function validateProtectedEnvironment(environment = {}, options = {}) {
  const expectedName = text(options.expectedName || OPERATOR_MERGE_ENVIRONMENT);
  const expectedReviewer = text(options.expectedReviewer || OPERATOR_MERGE_REVIEWER).toLowerCase();
  const blockers = [];
  const configuration = reviewerConfiguration(environment);
  const { requiredRules, requiredRule, reviewers, normalizedReviewers, userLogins } = configuration;
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

export function analyzeIndependentSecurityReview(input = {}) {
  const changedFiles = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .map(changedFilePath)
    .filter(Boolean);
  const diff = String(input.diff || '');
  const findings = [];
  const proofRefs = [];

  if (!changedFiles.length) {
    findings.push(finding('P0', 'review-diff-empty', 'No changed files were available to the independent reviewer.', 'pull-request-diff'));
  }
  if (!diff.includes('diff --git ')) {
    findings.push(finding('P0', 'review-patch-missing', 'A complete unified diff was not available to the independent reviewer.', 'pull-request-diff'));
  }
  if (changedFiles.length > 100) {
    findings.push(finding('P0', 'review-scope-too-large', 'The deterministic reviewer refuses more than 100 changed files.', 'pull-request-diff'));
  }

  const unsupported = changedFiles.filter((path) => UNSUPPORTED_HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(path)));
  for (const path of unsupported) {
    findings.push(finding('P0', 'unsupported-high-risk-surface', 'This high-risk surface requires a separate qualified specialist reviewer.', path));
  }

  const publicationPaths = [
    'shared/agents/repositoryNativePublishMergeLane.mjs',
    'scripts/repository-native-publish-merge-lane.mjs',
  ];
  for (const path of publicationPaths.filter((item) => changedFiles.includes(item))) {
    const patch = diffForPath(diff, path);
    if (/^\+.*\bgh\s+pr\s+(?:ready|merge)\b/im.test(patch)) {
      findings.push(finding('P0', 'ordinary-publication-gained-merge-authority', 'The ordinary publication lane may not mark ready or merge.', path));
    }
  }

  if (changedFiles.includes('scripts/operator-protected-merge-gate.mjs')) {
    const patch = diffForPath(diff, 'scripts/operator-protected-merge-gate.mjs');
    if (/^\+.*buildProtectedSecurityReviewReceipt\s*\(/m.test(patch)) {
      findings.push(finding('P0', 'operator-gate-synthesizes-review', 'The operator approval workflow may not mint its own specialist review conclusion.', 'scripts/operator-protected-merge-gate.mjs'));
    }
    if (!/--match-head-commit/.test(diff)) {
      findings.push(finding('P0', 'exact-head-merge-guard-missing', 'The protected merge executor must use --match-head-commit.', 'scripts/operator-protected-merge-gate.mjs'));
    }
  }

  if (changedFiles.includes('.github/workflows/operator-merge-approval-gate.yml')) {
    const patch = diffForPath(diff, '.github/workflows/operator-merge-approval-gate.yml');
    if (!/ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(patch)
      || !/persist-credentials:\s*false/.test(patch)) {
      findings.push(finding('P0', 'write-workflow-does-not-use-trusted-source', 'The write-authority workflow must execute only trusted default-branch code with credential persistence disabled.', '.github/workflows/operator-merge-approval-gate.yml'));
    }
    if (/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/.test(patch)) {
      findings.push(finding('P0', 'write-workflow-checks-out-pr-source', 'The write-authority workflow may not check out pull-request source.', '.github/workflows/operator-merge-approval-gate.yml'));
    }
  }

  if (changedFiles.some((path) => APPROVAL_BOUNDARY_PATHS.includes(path))) {
    const required = [
      '.github/workflows/independent-merge-security-review.yml',
      'scripts/independent-merge-security-review.mjs',
    ];
    for (const path of required) {
      if (!changedFiles.includes(path) && input.requireReviewerFilesInDiff === true) {
        findings.push(finding('P0', 'independent-reviewer-source-missing', 'Approval-boundary changes must include the independent reviewer source during bootstrap.', path));
      }
    }
  }

  if (changedFiles.includes('.github/workflows/independent-merge-security-review.yml')) {
    const patch = diffForPath(diff, '.github/workflows/independent-merge-security-review.yml');
    if (!/pull_request_target:/.test(patch)
      || !/ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(patch)
      || !/persist-credentials:\s*false/.test(patch)) {
      findings.push(finding('P0', 'independent-review-workflow-not-trusted', 'The independent reviewer must run trusted default-branch code under pull_request_target.', '.github/workflows/independent-merge-security-review.yml'));
    }
    if (/contents:\s*write/.test(patch) || /pull-requests:\s*write/.test(patch)) {
      findings.push(finding('P0', 'independent-reviewer-has-source-authority', 'The independent reviewer may not receive source or pull-request mutation authority.', '.github/workflows/independent-merge-security-review.yml'));
    }
  }

  if (changedFiles.includes('scripts/independent-merge-security-review.mjs')) {
    const patch = diffForPath(diff, 'scripts/independent-merge-security-review.mjs');
    if (/\bgh\s+pr\s+(?:ready|merge)\b/.test(patch)
      || /repos\/[^\s]+\/contents/.test(patch)
      || /git\s+(?:push|reset|clean|rebase)/.test(patch)) {
      findings.push(finding('P0', 'independent-reviewer-gained-mutation-authority', 'The independent reviewer must remain read-only except for its bounded receipt comment.', 'scripts/independent-merge-security-review.mjs'));
    }
  }

  for (const path of changedFiles) proofRefs.push(`proofs/changed-file/${path}`);
  const counts = {
    P0: findings.filter((item) => item.severity === 'P0').length,
    P1: findings.filter((item) => item.severity === 'P1').length,
    P2: findings.filter((item) => item.severity === 'P2').length,
  };
  const verdict = counts.P0 || counts.P1 || counts.P2 ? 'findings' : 'clean';
  return Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: Object.freeze(findings),
    counts: Object.freeze(counts),
    verdict,
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: verdict === 'clean' ? 'INDEPENDENT_SECURITY_REVIEW_CLEAN' : 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
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
  const analysis = input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  if (!repository || !prNumber || !SHA_PATTERN.test(sourceHead) || !branch || !workflowRunId || !workflowRunAttempt) {
    throw new Error('Independent security review receipt requires repository, PR, branch, exact head and workflow run identity.');
  }
  if (analysis.finalVerdict !== 'INDEPENDENT_SECURITY_REVIEW_CLEAN'
    || analysis.verdict !== 'clean'
    || !Array.isArray(analysis.findings)
    || analysis.findings.length !== 0) {
    throw new Error('Independent security review analysis must be clean before a receipt is created.');
  }
  return createProviderNeutralReviewReceipt({
    receiptId: `independent-review-pr${prNumber}-run${workflowRunId}-attempt${workflowRunAttempt}`,
    repository,
    issueNumber: PROGRAMME_CONTROL_ISSUE,
    prNumber,
    branch,
    sourceHead,
    reviewerId: PROTECTED_REVIEWER_ID,
    reviewerClass: PROTECTED_REVIEWER_CLASS,
    provider: PROTECTED_REVIEW_PROVIDER,
    modelClass: PROTECTED_REVIEW_MODEL_CLASS,
    reviewerSessionId: independentReviewerSessionId(workflowRunId, workflowRunAttempt),
    implementerProvider: 'canonical-programme-builder',
    implementerSessionId: implementationSessionId(prNumber),
    riskTier: 'high',
    assuranceMode: 'specialist',
    reviewScope: [
      'complete-exact-head-diff',
      'changed-file-risk-classification',
      'approval-boundary-invariants',
      'merge-authority-separation',
      'forbidden-authority-scan',
    ],
    findings: [],
    verdict: 'clean',
    timestampUtc,
    proofRefs: unique([
      `proofs/independent-review/run-${workflowRunId}`,
      `proofs/independent-review/head-${sourceHead.slice(0, 12)}`,
      ...(Array.isArray(analysis.proofRefs) ? analysis.proofRefs : []),
    ]),
    quorumChecks: [],
    blocker: '',
  });
}

export function validateIndependentReviewWorkflowRun(run = {}, jobs = [], options = {}) {
  const repository = text(options.repository);
  const prNumber = integer(options.prNumber);
  const expectedHead = text(options.expectedHead).toLowerCase();
  const workflowRunId = integer(options.workflowRunId);
  const workflowRunAttempt = integer(options.workflowRunAttempt);
  const blockers = [];
  const runPullRequests = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  const boundPr = runPullRequests.find((item) => integer(item?.number) === prNumber);
  const boundHead = text(boundPr?.head?.sha).toLowerCase();
  const reviewJob = (Array.isArray(jobs) ? jobs : []).find((job) => text(job?.name) === INDEPENDENT_REVIEW_JOB);

  if (integer(run.id) !== workflowRunId) blockers.push('independent-review-run-id-mismatch');
  if (integer(run.run_attempt) !== workflowRunAttempt) blockers.push('independent-review-run-attempt-mismatch');
  if (text(run.name) !== INDEPENDENT_REVIEW_WORKFLOW_NAME) blockers.push('independent-review-workflow-name-mismatch');
  if (text(run.path) !== INDEPENDENT_REVIEW_WORKFLOW_PATH) blockers.push('independent-review-workflow-path-mismatch');
  if (text(run.event) !== 'pull_request_target') blockers.push('independent-review-event-untrusted');
  if (text(run.repository?.full_name || run.repository) !== repository) blockers.push('independent-review-repository-mismatch');
  if (text(run.status).toLowerCase() !== 'completed' || text(run.conclusion).toLowerCase() !== 'success') {
    blockers.push('independent-review-run-not-green');
  }
  if (!boundPr) blockers.push('independent-review-pr-binding-missing');
  if (boundHead && boundHead !== expectedHead) blockers.push('independent-review-head-mismatch');
  if (!reviewJob || text(reviewJob.status).toLowerCase() !== 'completed' || text(reviewJob.conclusion).toLowerCase() !== 'success') {
    blockers.push('independent-review-job-not-green');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'INDEPENDENT_REVIEW_WORKFLOW_BLOCKED' : 'INDEPENDENT_REVIEW_WORKFLOW_READY',
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
  if (receipt.reviewerSessionId !== independentReviewerSessionId(workflowRunId, workflowRunAttempt)) {
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
    blockers: Object.freeze(unique(blockers)),
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
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PROTECTED_OPERATOR_PREREQUISITES_BLOCKED'
      : 'PROTECTED_OPERATOR_PREREQUISITES_READY',
  });
}

export function validateProtectedOperatorMergeEvidence(input = {}) {
  const prerequisites = validateProtectedOperatorMergePrerequisites(input);
  const reviewWorkflow = validateIndependentReviewWorkflowRun(
    input.reviewWorkflowRun,
    input.reviewWorkflowJobs,
    {
      repository: prerequisites.repository,
      prNumber: prerequisites.prNumber,
      expectedHead: prerequisites.sourceHead,
      workflowRunId: input.reviewWorkflowRunId,
      workflowRunAttempt: input.reviewWorkflowRunAttempt,
    },
  );
  const review = validateTrustedProtectedReviewReceipt(input.trustedReviewReceipt, {
    repository: prerequisites.repository,
    prNumber: prerequisites.prNumber,
    branch: prerequisites.branch,
    expectedHead: prerequisites.sourceHead,
    workflowRunId: input.reviewWorkflowRunId,
    workflowRunAttempt: input.reviewWorkflowRunAttempt,
  });
  const blockers = [...prerequisites.blockers];
  if (!reviewWorkflow.valid) blockers.push(...reviewWorkflow.blockers);
  if (!review.valid) blockers.push(...review.blockers);

  return Object.freeze({
    schemaVersion: 'stephanos.protected-operator-merge-evidence.v3',
    repository: prerequisites.repository,
    prNumber: prerequisites.prNumber,
    sourceHead: prerequisites.sourceHead,
    branch: prerequisites.branch,
    environment: prerequisites.environment,
    workflows: prerequisites.workflows,
    reviewWorkflow,
    review,
    blockers: Object.freeze(unique(blockers)),
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
    protectionBoundary: OPERATOR_MERGE_PROTECTION_BOUNDARY,
    requiredReviewer: OPERATOR_MERGE_REVIEWER,
    workflowPath: OPERATOR_MERGE_WORKFLOW_PATH,
    workflowRunId: integer(input.workflowRunId),
    workflowRunAttempt: integer(input.workflowRunAttempt),
    approvedAtUtc: text(input.approvedAtUtc),
    mergeExecutionAuthority: 'github-actions-protected-environment-only',
    reusableAcrossHeads: false,
  });
}

export function validateProtectedApprovalReceipt(receipt = {}, options = {}) {
  const blockers = [];
  const approvedAtUtc = text(receipt?.approvedAtUtc);
  const approvedAtMs = EXPLICIT_TIMEZONE.test(approvedAtUtc)
    ? Date.parse(approvedAtUtc)
    : Number.NaN;
  const nowUtc = text(options.nowUtc);
  const nowMs = EXPLICIT_TIMEZONE.test(nowUtc) ? Date.parse(nowUtc) : Number.NaN;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    blockers.push('approval-receipt-invalid');
  }
  if (![
    'stephanos.protected-operator-approval.v1',
    'stephanos.protected-operator-approval.v2',
  ].includes(receipt?.schemaVersion)) {
    blockers.push('approval-schema-mismatch');
  }
  if (receipt?.kind !== 'stephanos.protected-operator-approval') {
    blockers.push('approval-kind-mismatch');
  }
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(text(receipt?.repository))) {
    blockers.push('approval-repository-invalid');
  }
  if (!integer(receipt?.prNumber)) blockers.push('approval-pr-invalid');
  if (!SHA_PATTERN.test(text(receipt?.sourceHead).toLowerCase())) {
    blockers.push('approval-head-invalid');
  }
  if (!/^[a-z0-9][a-z0-9._/-]{0,239}$/i.test(text(receipt?.branch))
    || text(receipt?.branch).includes('..')) {
    blockers.push('approval-branch-invalid');
  }
  if (Object.prototype.hasOwnProperty.call(receipt ?? {}, 'environment')
    && receipt?.environment !== OPERATOR_MERGE_ENVIRONMENT) {
    blockers.push('approval-environment-mismatch');
  }
  if (receipt?.protectionBoundary !== OPERATOR_MERGE_PROTECTION_BOUNDARY) {
    blockers.push('approval-protection-boundary-mismatch');
  }
  if (text(receipt?.requiredReviewer).toLowerCase() !== OPERATOR_MERGE_REVIEWER.toLowerCase()) {
    blockers.push('approval-reviewer-mismatch');
  }
  if (receipt?.workflowPath !== OPERATOR_MERGE_WORKFLOW_PATH) {
    blockers.push('approval-workflow-path-mismatch');
  }
  if (!integer(receipt?.workflowRunId)) blockers.push('approval-run-invalid');
  if (!integer(receipt?.workflowRunAttempt)) blockers.push('approval-attempt-invalid');
  if (!Number.isFinite(approvedAtMs)) blockers.push('approval-timestamp-invalid');
  if (Number.isFinite(nowMs) && Number.isFinite(approvedAtMs) && approvedAtMs > nowMs) {
    blockers.push('approval-timestamp-in-future');
  }
  if (receipt?.mergeExecutionAuthority !== 'github-actions-protected-environment-only') {
    blockers.push('approval-execution-authority-mismatch');
  }
  if (receipt?.reusableAcrossHeads !== false) blockers.push('approval-reusable-across-heads');
  if (receipt?.schemaVersion === 'stephanos.protected-operator-approval.v2') {
    if (!SHA_PATTERN.test(text(receipt?.baseSha).toLowerCase())) blockers.push('approval-base-invalid');
    if (receipt?.reusableAcrossBases !== false) blockers.push('approval-reusable-across-bases');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
    approvedAtUtc: Number.isFinite(approvedAtMs) ? new Date(approvedAtMs).toISOString() : null,
    finalVerdict: blockers.length
      ? 'PROTECTED_OPERATOR_APPROVAL_RECEIPT_BLOCKED'
      : 'PROTECTED_OPERATOR_APPROVAL_RECEIPT_READY',
  });
}

export function projectProtectedApprovalReceiptForWorkspace(receipt = {}, options = {}) {
  const validation = validateProtectedApprovalReceipt(receipt, options);
  const nativeEnvironmentValid = Object.prototype.hasOwnProperty.call(receipt ?? {}, 'environment')
    && receipt?.environment === OPERATOR_MERGE_ENVIRONMENT;
  if (!validation.valid || !nativeEnvironmentValid) {
    return Object.freeze({
      valid: false,
      receipt: null,
      blockers: Object.freeze(unique([
        ...validation.blockers,
        ...(nativeEnvironmentValid ? [] : ['approval-environment-provenance-missing']),
      ])),
      finalVerdict: 'PROTECTED_OPERATOR_APPROVAL_WORKSPACE_PROJECTION_BLOCKED',
    });
  }
  const { environment: _protectedEnvironment, ...workspaceSafeReceipt } = receipt;
  return Object.freeze({
    valid: true,
    receipt: Object.freeze({
      ...workspaceSafeReceipt,
      protectionBoundary: OPERATOR_MERGE_PROTECTION_BOUNDARY,
    }),
    blockers: Object.freeze([]),
    finalVerdict: 'PROTECTED_OPERATOR_APPROVAL_WORKSPACE_PROJECTION_READY',
  });
}
