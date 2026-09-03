import {
  createProviderNeutralReviewReceipt,
  validateProviderNeutralReviewReceipt,
} from './providerNeutralReviewV1.mjs';
import { createHash } from 'node:crypto';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_BLOB_SHA_PATTERN = /^[a-f0-9]{40}$/;
const REVIEW_SESSION_PATTERN = /^github-actions-independent-review-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

export const OPERATOR_MERGE_ENVIRONMENT = 'operator-merge-approval';
export const OPERATOR_MERGE_PROTECTION_BOUNDARY = 'github-protected-environment:operator-merge-approval';
export const OPERATOR_MERGE_REVIEWER = 'Cheekyfellastef';
export const OPERATOR_MERGE_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const OPERATOR_MERGE_EVIDENCE_JOB = 'independent-review-evidence';
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
export const APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE = 'approval-boundary-v2-self-change-requires-qualified-review';
export const APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE = 'operator-protected-bootstrap-required';
export const PROGRAMME_CONTROL_ISSUE = 1568;
export const PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION = 'stephanos.protected-workflow-source.v1';
export const PROTECTED_WORKFLOW_SOURCE_MAX_BYTES = 256 * 1024;
export const PROTECTED_WORKFLOW_SOURCE_PATHS = Object.freeze([
  '.github/workflows/operator-merge-approval-gate.yml',
  '.github/workflows/independent-merge-security-review.yml',
]);
export const REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES = Object.freeze([
  Object.freeze({ name: 'Build Stephanos UI', path: '.github/workflows/build-stephanos-ui.yml', event: 'pull_request' }),
  Object.freeze({ name: 'PR Clean Guard', path: '.github/workflows/pr-clean.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Exact-Head Review Dispatch', path: '.github/workflows/exact-head-review-dispatch.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Battle Bridge Publisher Proof', path: '.github/workflows/battle-bridge-publisher-proof.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Codex Dispatch Queue Proof', path: '.github/workflows/codex-dispatch-queue-proof.yml', event: 'pull_request' }),
  Object.freeze({ name: 'OpenClaw GitHub Operator', path: '.github/workflows/openclaw-github-operator.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Protected Operator Merge Source Proof', path: '.github/workflows/operator-merge-approval-gate-test.yml', event: 'pull_request' }),
]);
export const REQUIRED_EXACT_HEAD_WORKFLOWS = Object.freeze(
  REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES.map((workflow) => workflow.name),
);

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

function strictPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
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

function workflowRepository(run = {}) {
  return text(run?.repository?.full_name || run?.repository);
}

function canonicalWorkflowRunPath(run = {}) {
  const repository = workflowRepository(run);
  let path = text(run?.path);
  if (repository && path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const refSeparator = path.indexOf('@');
  if (refSeparator !== -1) {
    if (refSeparator === 0 || refSeparator === path.length - 1) return '';
    if (path.indexOf('@', refSeparator + 1) !== -1) return '';
    const workflowRef = path.slice(refSeparator + 1);
    const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    if (pullRequests.length !== 1) return '';
    const pullRequest = pullRequests[0];
    const pullRequestNumber = strictPositiveInteger(pullRequest?.number);
    const headBranch = text(pullRequest?.head?.ref);
    const baseBranch = text(pullRequest?.base?.ref);
    const pullRequestRefs = new Set([
      pullRequestNumber ? `refs/pull/${pullRequestNumber}/merge` : '',
      headBranch,
      headBranch ? `refs/heads/${headBranch}` : '',
      baseBranch,
      baseBranch ? `refs/heads/${baseBranch}` : '',
    ].filter(Boolean));
    const pullRequestTargetRefs = new Set([
      baseBranch,
      baseBranch ? `refs/heads/${baseBranch}` : '',
    ].filter(Boolean));
    const validPullRequestRef = text(run?.event) === 'pull_request'
      && pullRequestRefs.has(workflowRef);
    const validPullRequestTargetRef = text(run?.event) === 'pull_request_target'
      && pullRequestTargetRefs.has(workflowRef);
    if (!validPullRequestRef && !validPullRequestTargetRef) return '';
    path = path.slice(0, refSeparator);
  }
  return path;
}

function latestWorkflowRun(runs = []) {
  return [...runs].sort((left, right) => (
    strictPositiveInteger(right?.run_number) - strictPositiveInteger(left?.run_number)
    || strictPositiveInteger(right?.id) - strictPositiveInteger(left?.id)
  ))[0] || null;
}

function exactWorkflowRunIdentity(run, identity) {
  return Boolean(
    text(run?.name) === identity.name
    && canonicalWorkflowRunPath(run) === identity.path
    && strictPositiveInteger(run?.workflow_id ?? run?.workflowId) === identity.workflowId
    && text(run?.event) === identity.event
    && workflowRepository(run) === identity.repository
  );
}

export function bindRequiredExactHeadWorkflowIdentities(definitions = [], options = {}) {
  const repository = text(options.repository);
  const blockers = [];
  const workflows = Array.isArray(definitions) ? definitions : [];
  const identities = [];
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)) {
    blockers.push('required-workflow-repository-invalid');
  }
  if (!Array.isArray(definitions)) blockers.push('required-workflow-definitions-invalid');
  for (const required of REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES) {
    const pathMatches = workflows.filter((workflow) => text(workflow?.path) === required.path);
    const nameCollisions = workflows.filter((workflow) => (
      text(workflow?.name) === required.name
      && text(workflow?.path) !== required.path
    ));
    if (pathMatches.length !== 1) {
      blockers.push(`required-workflow-definition-count:${required.name}`);
      continue;
    }
    const definition = pathMatches[0];
    const workflowId = strictPositiveInteger(definition?.id);
    if (text(definition?.name) !== required.name) {
      blockers.push(`required-workflow-definition-name-mismatch:${required.name}`);
    }
    if (!workflowId) blockers.push(`required-workflow-definition-id-invalid:${required.name}`);
    if (text(definition?.state).toLowerCase() !== 'active') {
      blockers.push(`required-workflow-definition-not-active:${required.name}`);
    }
    if (nameCollisions.length) blockers.push(`required-workflow-definition-name-ambiguous:${required.name}`);
    if (
      repository
      && workflowId
      && text(definition?.name) === required.name
      && text(definition?.state).toLowerCase() === 'active'
      && nameCollisions.length === 0
    ) {
      identities.push(Object.freeze({
        ...required,
        workflowId,
        repository,
      }));
    }
  }
  const workflowIds = identities.map((identity) => identity.workflowId);
  const duplicateWorkflowIds = workflowIds.filter((id, index) => workflowIds.indexOf(id) !== index);
  if (duplicateWorkflowIds.length) blockers.push('required-workflow-definition-id-ambiguous');
  return Object.freeze({
    valid: blockers.length === 0 && identities.length === REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES.length,
    repository,
    identities: Object.freeze(identities),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'REQUIRED_WORKFLOW_IDENTITIES_BLOCKED'
      : 'REQUIRED_WORKFLOW_IDENTITIES_READY',
  });
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

const PROTECTED_WORKFLOW_SOURCE_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'path',
  'ref',
  'exists',
  'size',
  'blobSha',
  'content',
]);

const PROTECTED_WORKFLOW_FINAL_POLICIES = Object.freeze({
  '.github/workflows/independent-merge-security-review.yml': Object.freeze({
    events: Object.freeze(['pull_request_target']),
    checkoutRefExpressions: Object.freeze([
      Object.freeze({ expression: 'github\\.event\\.pull_request\\.base\\.sha', count: 1 }),
    ]),
    checkoutCount: 1,
    permissionSignatures: Object.freeze([
      'actions:read,contents:read,issues:write,pull-requests:read',
    ]),
  }),
  '.github/workflows/operator-merge-approval-gate.yml': Object.freeze({
    events: Object.freeze(['merge_group', 'workflow_dispatch']),
    checkoutRefExpressions: Object.freeze([
      Object.freeze({ expression: 'github\\.event\\.merge_group\\.base_sha', count: 2 }),
      Object.freeze({ expression: 'github\\.sha', count: 3 }),
    ]),
    checkoutCount: 5,
    permissionSignatures: Object.freeze([
      'actions:read,checks:read,contents:read,pull-requests:read',
      'actions:read,checks:read,contents:read,pull-requests:read',
      'actions:read,checks:read,contents:read,deployments:read,pull-requests:read',
      'actions:read,checks:read,contents:read,deployments:read,pull-requests:read',
      'actions:read,checks:read,contents:write,deployments:read,issues:write,pull-requests:write',
    ]),
  }),
});

function sameKeys(candidate, expectedKeys) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const keys = Object.keys(candidate).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === [...expectedKeys].sort()[index]);
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function yamlEventKeys(source) {
  const lines = String(source).split(/\r?\n/);
  const onIndexes = lines
    .map((line, index) => (/^on:\s*$/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (onIndexes.length !== 1) return [];
  const keys = [];
  for (let index = onIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = indentation(line);
    if (indent === 0) break;
    const directKey = line.match(/^ {2}([a-zA-Z0-9_-]+):(?:\s.*)?$/);
    if (directKey) keys.push(directKey[1]);
  }
  return keys;
}

function yamlWorkflowDispatchInputKeys(source) {
  const lines = String(source).split(/\r?\n/);
  const dispatchIndex = lines.findIndex((line) => /^ {2}workflow_dispatch:\s*$/.test(line));
  if (dispatchIndex < 0) return [];
  const inputsIndex = lines.findIndex((line, index) => (
    index > dispatchIndex && /^ {4}inputs:\s*$/.test(line)
  ));
  if (inputsIndex < 0) return [];
  const keys = [];
  for (let index = inputsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = indentation(line);
    if (indent <= 4) break;
    const directKey = line.match(/^ {6}([a-zA-Z0-9_-]+):\s*$/);
    if (directKey) keys.push(directKey[1]);
  }
  return keys;
}

function checkoutBlocks(source) {
  const lines = String(source).split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*uses:\s*actions\/checkout@/.test(lines[index])) continue;
    const usesIndent = indentation(lines[index]);
    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim() && !candidate.trimStart().startsWith('#')
        && indentation(candidate) < usesIndent) break;
      end += 1;
    }
    blocks.push(Object.freeze({
      uses: lines[index].trim(),
      lines: Object.freeze(lines.slice(index, end)),
      usesIndent,
    }));
  }
  return Object.freeze(blocks);
}

function permissionSignatures(source) {
  const lines = String(source).split(/\r?\n/);
  const signatures = [];
  let topLevelEmptyCount = 0;
  let invalid = false;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^( *)permissions:\s*(.*?)\s*$/);
    if (!match) continue;
    const permissionIndent = match[1].length;
    const inline = match[2];
    if (permissionIndent === 0 && inline === '{}') {
      topLevelEmptyCount += 1;
      continue;
    }
    if (permissionIndent === 0 || inline) {
      invalid = true;
      continue;
    }
    const entries = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const childIndent = indentation(line);
      if (childIndent <= permissionIndent) break;
      const entry = line.match(new RegExp(`^ {${permissionIndent + 2}}([a-z][a-z-]*):\\s*(read|write|none)\\s*$`));
      if (!entry) {
        invalid = true;
        continue;
      }
      entries.push(`${entry[1]}:${entry[2]}`);
    }
    if (!entries.length || new Set(entries).size !== entries.length) invalid = true;
    signatures.push(entries.sort().join(','));
  }
  return Object.freeze({
    valid: !invalid && topLevelEmptyCount === 1,
    signatures: Object.freeze(signatures.sort()),
  });
}

function validateProtectedWorkflowYaml(path, source) {
  const policy = PROTECTED_WORKFLOW_FINAL_POLICIES[path];
  const blockers = [];
  if (!policy) return Object.freeze({ valid: false, blockers: Object.freeze(['protected-workflow-policy-missing']) });
  const events = yamlEventKeys(source);
  if (events.length !== policy.events.length
    || events.some((event, index) => event !== policy.events[index])) {
    blockers.push('protected-workflow-trigger-not-exact');
  }
  if (policy.events.includes('merge_group')
    && !/^ {4}types:\s*\[checks_requested\]\s*$/m.test(source)) {
    blockers.push('protected-workflow-merge-group-action-not-exact');
  }
  if (policy.events.includes('workflow_dispatch')) {
    const requiredInputs = [
      'mode',
      'pr_number',
      'expected_branch',
      'expected_head',
      'expected_head_tree',
      'expected_base',
      'authorization_head',
      'authorization_head_tree',
      'authorization_base',
      'independent_review_run_id',
      'independent_review_run_attempt',
      'independent_review_artifact_id',
      'independent_review_artifact_digest',
      'independent_review_payload_sha256',
      'authorization_comment_id',
    ];
    const dispatchInputs = yamlWorkflowDispatchInputKeys(source);
    if (dispatchInputs.length !== requiredInputs.length
      || dispatchInputs.some((input, index) => input !== requiredInputs[index])
      || !/^run-name: Protected operator merge \$\{\{ github\.event\.merge_group\.head_sha \|\| inputs\.expected_head \|\| github\.run_id \}\}\s*$/m.test(source)) {
      blockers.push('protected-workflow-dispatch-inputs-not-exact');
    }
  }
  const checkouts = checkoutBlocks(source);
  if (checkouts.length !== policy.checkoutCount) blockers.push('protected-workflow-checkout-count-mismatch');
  const observedRefCounts = new Map(policy.checkoutRefExpressions.map((entry) => [entry.expression, 0]));
  for (const checkout of checkouts) {
    const matchingRefs = policy.checkoutRefExpressions.filter((entry) => {
      const pattern = new RegExp(
        `^ {${checkout.usesIndent + 2}}ref:\\s*\\$\\{\\{\\s*${entry.expression}\\s*\\}\\}\\s*$`,
      );
      return checkout.lines.filter((line) => pattern.test(line)).length === 1;
    });
    const persistPattern = new RegExp(
      `^ {${checkout.usesIndent + 2}}persist-credentials:\\s*false\\s*$`,
    );
    if (checkout.uses !== 'uses: actions/checkout@v4'
      || matchingRefs.length !== 1
      || checkout.lines.filter((line) => persistPattern.test(line)).length !== 1) {
      blockers.push('protected-workflow-checkout-not-exact-base');
    } else {
      const expression = matchingRefs[0].expression;
      observedRefCounts.set(expression, observedRefCounts.get(expression) + 1);
    }
  }
  for (const expectedRef of policy.checkoutRefExpressions) {
    if (observedRefCounts.get(expectedRef.expression) !== expectedRef.count) {
      blockers.push('protected-workflow-checkout-ref-count-mismatch');
    }
  }
  if (/github\.event\.pull_request\.head\.sha/.test(source)
    || /github\.event\.repository\.default_branch/.test(source)) {
    blockers.push('protected-workflow-moving-or-pr-head-source');
  }
  const permissions = permissionSignatures(source);
  const expectedPermissions = [...policy.permissionSignatures].sort();
  if (!permissions.valid
    || permissions.signatures.length !== expectedPermissions.length
    || permissions.signatures.some((signature, index) => signature !== expectedPermissions[index])) {
    blockers.push('protected-workflow-permissions-not-exact');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
  });
}

export function validateProtectedWorkflowFinalSources(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const changedPaths = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .flatMap(changedFilePaths)
    .filter(Boolean);
  const expectedPaths = PROTECTED_WORKFLOW_SOURCE_PATHS.filter((path) => changedPaths.includes(path));
  const sources = Array.isArray(input.protectedWorkflowSources) ? input.protectedWorkflowSources : [];
  const findings = [];
  const proofRefs = [];

  for (const path of expectedPaths) {
    const candidates = sources.filter((source) => source?.path === path);
    if (candidates.length !== 1) {
      findings.push(finding(
        'P0',
        candidates.length ? 'protected-workflow-source-evidence-ambiguous' : 'protected-workflow-source-evidence-missing',
        'Changed protected workflow final source must have exactly one bounded exact-head evidence record.',
        path,
      ));
      continue;
    }
    const source = candidates[0];
    if (!sameKeys(source, PROTECTED_WORKFLOW_SOURCE_KEYS)
      || source.schemaVersion !== PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION
      || source.repository !== repository
      || !SHA_PATTERN.test(sourceHead)
      || source.ref !== sourceHead
      || source.exists !== true
      || typeof source.size !== 'number'
      || !Number.isSafeInteger(source.size)
      || source.size <= 0
      || source.size > PROTECTED_WORKFLOW_SOURCE_MAX_BYTES
      || typeof source.content !== 'string'
      || Buffer.byteLength(source.content, 'utf8') !== source.size
      || typeof source.blobSha !== 'string'
      || !GIT_BLOB_SHA_PATTERN.test(source.blobSha)
      || gitBlobSha(source.content) !== source.blobSha) {
      findings.push(finding(
        'P0',
        source?.exists === false
          ? 'protected-workflow-final-source-missing'
          : 'protected-workflow-source-evidence-invalid',
        'Changed protected workflow final source is missing or is not bound to the exact repository, path, ref, size and Git blob.',
        path,
      ));
      continue;
    }
    const yaml = validateProtectedWorkflowYaml(path, source.content);
    if (!yaml.valid) {
      const independent = path === '.github/workflows/independent-merge-security-review.yml';
      findings.push(finding(
        'P0',
        independent ? 'independent-review-workflow-not-trusted' : 'write-workflow-does-not-use-trusted-source',
        `The final exact-head workflow source violates: ${yaml.blockers.join(', ')}.`,
        path,
      ));
      if (independent && yaml.blockers.includes('protected-workflow-permissions-not-exact')) {
        findings.push(finding(
          'P0',
          'independent-reviewer-has-source-authority',
          'The final independent-review workflow permissions are not the exact bounded read-only-plus-display-comment set.',
          path,
        ));
      }
      continue;
    }
    proofRefs.push(`proofs/protected-workflow-source/${path}@${source.ref}#${source.blobSha}:${source.size}`);
  }

  const unexpected = sources.filter((source) => !expectedPaths.includes(text(source?.path)));
  for (const source of unexpected) {
    findings.push(finding(
      'P0',
      'protected-workflow-source-evidence-unexpected',
      'Protected workflow source evidence must correspond exactly to a changed protected workflow path.',
      text(source?.path) || 'unknown-protected-workflow',
    ));
  }
  return Object.freeze({
    valid: findings.length === 0,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
  });
}

export function isApprovalBoundaryBootstrapAnalysis(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return Boolean(
    analysis?.finalVerdict === 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'
    && analysis?.verdict === 'findings'
    && findings.length > 0
    && findings.every((item) => (
      text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
      && text(item?.path)
    ))
    && strictPositiveInteger(analysis?.counts?.P0) === findings.length
    && Number(analysis?.counts?.P1) === 0
    && Number(analysis?.counts?.P2) === 0
  );
}

function isApprovalBoundaryBootstrapReceipt(receipt = {}) {
  const findings = Array.isArray(receipt?.findings) ? receipt.findings : [];
  const reviewScope = Array.isArray(receipt?.reviewScope) ? receipt.reviewScope.map(text) : [];
  return Boolean(
    receipt?.verdict === 'findings'
    && text(receipt?.blocker) === ''
    && reviewScope.includes(APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE)
    && findings.length > 0
    && findings.every((item) => (
      text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === APPROVAL_BOUNDARY_BOOTSTRAP_FINDING_CODE
      && text(item?.path)
    ))
  );
}

function changedFilePaths(item) {
  if (typeof item === 'string') return [text(item)].filter(Boolean);
  return unique([
    text(item?.filename ?? item?.path),
    text(item?.previous_filename),
  ]).filter(Boolean);
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
  // In a repository with no branch-protection rules GitHub admits every branch
  // under this mode; the merge mutation preflight separately proves that exact
  // no-rules state before it advances main.
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
  const requiredIdentities = Array.isArray(options.requiredIdentities)
    ? options.requiredIdentities
    : null;
  if (requiredIdentities) {
    const blockers = [];
    const evidence = [];
    const sourceRuns = Array.isArray(runs) ? runs : [];
    const expectedPrNumber = strictPositiveInteger(options.expectedPrNumber);
    const expectedBranch = text(options.expectedBranch);
    const expectedBaseBranch = text(options.expectedBaseBranch);
    const expectedBaseSha = text(options.expectedBaseSha).toLowerCase();
    if (!Array.isArray(runs)) blockers.push('workflow-runs-invalid');
    if (!expectedPrNumber) blockers.push('workflow-expected-pr-invalid');
    if (!expectedBranch) blockers.push('workflow-expected-head-branch-invalid');
    if (!expectedBaseBranch) blockers.push('workflow-expected-base-branch-invalid');
    if (!SHA_PATTERN.test(expectedBaseSha)) blockers.push('workflow-expected-base-sha-invalid');
    const identityNames = requiredIdentities.map((identity) => text(identity?.name));
    const identityPaths = requiredIdentities.map((identity) => text(identity?.path));
    const identityIds = requiredIdentities.map((identity) => strictPositiveInteger(identity?.workflowId));
    if (
      requiredIdentities.length !== REQUIRED_EXACT_HEAD_WORKFLOW_IDENTITIES.length
      || identityNames.some((name) => !name)
      || identityPaths.some((path) => !path)
      || identityIds.some((id) => !id)
      || new Set(identityNames).size !== identityNames.length
      || new Set(identityPaths).size !== identityPaths.length
      || new Set(identityIds).size !== identityIds.length
    ) {
      blockers.push('required-workflow-identities-invalid-or-ambiguous');
    }
    for (const identity of requiredIdentities) {
      const name = text(identity?.name);
      const candidatesByName = sourceRuns.filter((run) => text(run?.name) === name);
      const candidatesByPath = sourceRuns.filter((run) => (
        canonicalWorkflowRunPath(run) === text(identity?.path)
      ));
      const exactCandidates = candidatesByName.filter((run) => exactWorkflowRunIdentity(run, identity));
      if (candidatesByName.some((run) => !exactWorkflowRunIdentity(run, identity))) {
        blockers.push(`workflow-identity-spoof:${name}`);
      }
      if (candidatesByPath.some((run) => !exactWorkflowRunIdentity(run, identity))) {
        blockers.push(`workflow-path-identity-mismatch:${name}`);
      }
      const run = latestWorkflowRun(exactCandidates);
      if (!run) {
        blockers.push(`missing-workflow:${name}`);
        continue;
      }
      const head = text(run.head_sha || run.headSha).toLowerCase();
      const conclusion = text(run.conclusion).toLowerCase();
      const status = text(run.status).toLowerCase();
      const runPullRequests = Array.isArray(run.pull_requests) ? run.pull_requests : [];
      const boundPullRequests = runPullRequests.filter((item) => (
        strictPositiveInteger(item?.number) === expectedPrNumber
      ));
      const boundPullRequest = boundPullRequests[0] || null;
      const boundHead = text(boundPullRequest?.head?.sha).toLowerCase();
      const boundHeadBranch = text(boundPullRequest?.head?.ref);
      const boundBase = text(boundPullRequest?.base?.sha).toLowerCase();
      const boundBaseBranch = text(boundPullRequest?.base?.ref);
      evidence.push(Object.freeze({
        name,
        path: identity.path,
        workflowId: identity.workflowId,
        event: identity.event,
        repository: identity.repository,
        head,
        status,
        conclusion,
        runId: strictPositiveInteger(run.id),
        prNumber: strictPositiveInteger(boundPullRequest?.number),
        headBranch: boundHeadBranch,
        baseBranch: boundBaseBranch,
        baseSha: boundBase,
      }));
      if (!SHA_PATTERN.test(expectedHead) || head !== expectedHead) blockers.push(`workflow-head-mismatch:${name}`);
      if (status !== 'completed' || conclusion !== 'success') blockers.push(`workflow-not-green:${name}`);
      if (runPullRequests.length !== 1 || boundPullRequests.length !== 1) {
        blockers.push(`workflow-pr-binding-mismatch:${name}`);
      }
      if (boundHead !== expectedHead) blockers.push(`workflow-pr-head-mismatch:${name}`);
      if (boundHeadBranch !== expectedBranch) blockers.push(`workflow-head-branch-mismatch:${name}`);
      if (boundBaseBranch !== expectedBaseBranch) blockers.push(`workflow-base-branch-mismatch:${name}`);
      if (boundBase !== expectedBaseSha) blockers.push(`workflow-base-sha-mismatch:${name}`);
    }
    return Object.freeze({
      valid: blockers.length === 0,
      evidence: Object.freeze(evidence),
      blockers: Object.freeze(unique(blockers)),
      finalVerdict: blockers.length ? 'EXACT_HEAD_WORKFLOWS_BLOCKED' : 'EXACT_HEAD_WORKFLOWS_READY',
    });
  }
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

export function exactHeadWorkflowFailureIsTerminal(verdict = {}) {
  const evidenceByName = new Map((Array.isArray(verdict?.evidence) ? verdict.evidence : []).map((item) => [
    text(item?.name),
    item,
  ]));
  return (Array.isArray(verdict?.blockers) ? verdict.blockers : []).some((blocker) => {
    const normalized = text(blocker);
    if (normalized.startsWith('missing-workflow:')) return false;
    if (normalized.startsWith('workflow-not-green:')) {
      const name = normalized.slice('workflow-not-green:'.length);
      const evidence = evidenceByName.get(name);
      return text(evidence?.status).toLowerCase() === 'completed'
        && text(evidence?.conclusion).toLowerCase() !== 'success';
    }
    return true;
  });
}

export function analyzeIndependentSecurityReview(input = {}) {
  const changedFiles = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .flatMap(changedFilePaths)
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
  const protectedWorkflowSources = validateProtectedWorkflowFinalSources({
    repository: input.repository,
    sourceHead: input.sourceHead,
    changedFiles: input.changedFiles,
    protectedWorkflowSources: input.protectedWorkflowSources,
  });
  findings.push(...protectedWorkflowSources.findings);
  proofRefs.push(...protectedWorkflowSources.proofRefs);

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
  const clean = analysis.finalVerdict === 'INDEPENDENT_SECURITY_REVIEW_CLEAN'
    && analysis.verdict === 'clean'
    && Array.isArray(analysis.findings)
    && analysis.findings.length === 0;
  const bootstrapRequired = isApprovalBoundaryBootstrapAnalysis(analysis);
  if (!repository || !prNumber || !SHA_PATTERN.test(sourceHead) || !branch || !workflowRunId || !workflowRunAttempt) {
    throw new Error('Independent security review receipt requires repository, PR, branch, exact head and workflow run identity.');
  }
  if (!clean && !bootstrapRequired) {
    throw new Error('Independent security review must be clean or contain only qualified-bootstrap self-change findings before a receipt is created.');
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
      ...(bootstrapRequired ? [APPROVAL_BOUNDARY_BOOTSTRAP_REVIEW_SCOPE] : []),
    ],
    findings: bootstrapRequired ? analysis.findings : [],
    verdict: bootstrapRequired ? 'findings' : 'clean',
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
  const expectedBranch = text(options.expectedBranch);
  const expectedBaseBranch = text(options.expectedBaseBranch);
  const expectedBaseSha = text(options.expectedBaseSha).toLowerCase();
  const expectedWorkflowId = strictPositiveInteger(options.expectedWorkflowId);
  const expectedWorkflowRunName = text(options.expectedWorkflowRunName || INDEPENDENT_REVIEW_WORKFLOW_NAME);
  const workflowRunId = integer(options.workflowRunId);
  const workflowRunAttempt = integer(options.workflowRunAttempt);
  const blockers = [];
  const runPullRequests = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  const boundPr = runPullRequests.length === 1 && integer(runPullRequests[0]?.number) === prNumber
    ? runPullRequests[0]
    : null;
  const boundHead = text(boundPr?.head?.sha).toLowerCase();
  const boundBranch = text(boundPr?.head?.ref);
  const boundBase = text(boundPr?.base?.sha).toLowerCase();
  const boundBaseBranch = text(boundPr?.base?.ref);
  const reviewJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => (
    text(job?.name) === INDEPENDENT_REVIEW_JOB
    && strictPositiveInteger(job?.run_attempt) === workflowRunAttempt
  ));
  const reviewJob = reviewJobs[0];

  if (integer(run.id) !== workflowRunId) blockers.push('independent-review-run-id-mismatch');
  if (integer(run.run_attempt) !== workflowRunAttempt) blockers.push('independent-review-run-attempt-mismatch');
  if (!expectedWorkflowId || strictPositiveInteger(run.workflow_id) !== expectedWorkflowId) {
    blockers.push('independent-review-workflow-id-mismatch');
  }
  if (text(run.name) !== expectedWorkflowRunName) blockers.push('independent-review-workflow-name-mismatch');
  if (Object.hasOwn(options, 'expectedWorkflowRunName')
    && text(run.display_title) !== expectedWorkflowRunName) {
    blockers.push('independent-review-workflow-display-title-mismatch');
  }
  if (canonicalWorkflowRunPath(run) !== INDEPENDENT_REVIEW_WORKFLOW_PATH) {
    blockers.push('independent-review-workflow-path-mismatch');
  }
  if (text(run.event) !== 'pull_request_target') blockers.push('independent-review-event-untrusted');
  if (text(run.repository?.full_name || run.repository) !== repository) blockers.push('independent-review-repository-mismatch');
  if (text(run.status).toLowerCase() !== 'completed' || text(run.conclusion).toLowerCase() !== 'success') {
    blockers.push('independent-review-run-not-green');
  }
  if (runPullRequests.length !== 1) blockers.push('independent-review-pr-binding-count-not-one');
  if (!boundPr) blockers.push('independent-review-pr-binding-missing');
  if (!SHA_PATTERN.test(expectedHead) || boundHead !== expectedHead) blockers.push('independent-review-head-mismatch');
  if (!expectedBranch || boundBranch !== expectedBranch) blockers.push('independent-review-head-branch-mismatch');
  if (!SHA_PATTERN.test(expectedBaseSha) || boundBase !== expectedBaseSha) blockers.push('independent-review-base-mismatch');
  if (!expectedBaseBranch || boundBaseBranch !== expectedBaseBranch) {
    blockers.push('independent-review-base-branch-mismatch');
  }
  if (reviewJobs.length !== 1) blockers.push('independent-review-job-count-not-one');
  if (
    !reviewJob
    || text(reviewJob.status).toLowerCase() !== 'completed'
    || text(reviewJob.conclusion).toLowerCase() !== 'success'
    || (
      text(reviewJob.run_url)
      && !text(reviewJob.run_url).endsWith(`/actions/runs/${workflowRunId}`)
    )
  ) {
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
  const bootstrapRequired = isApprovalBoundaryBootstrapReceipt(receipt);

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
  if (
    !bootstrapRequired
    && (receipt.verdict !== 'clean' || receipt.findings?.length !== 0 || receipt.blocker !== '')
  ) {
    blockers.push('protected-review-not-clean');
  }
  if (!workflowRunId || !workflowRunAttempt) blockers.push('protected-review-workflow-identity-missing');

  return Object.freeze({
    valid: blockers.length === 0,
    receipt,
    validation,
    reviewMode: bootstrapRequired ? 'qualified-operator-bootstrap' : 'clean-independent',
    operatorBootstrapRequired: bootstrapRequired,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'TRUSTED_PROTECTED_REVIEW_BLOCKED'
      : bootstrapRequired
        ? 'TRUSTED_PROTECTED_BOOTSTRAP_REVIEW_READY'
        : 'TRUSTED_PROTECTED_REVIEW_READY',
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
  const reviewDecisionObserved = Object.hasOwn(input, 'reviewDecision');
  const mergeableObserved = Object.hasOwn(input, 'mergeable');
  const mergeStateStatusObserved = Object.hasOwn(input, 'mergeStateStatus');
  const reviewDecision = text(input.reviewDecision).toUpperCase();
  const mergeable = text(input.mergeable).toUpperCase();
  const mergeStateStatus = text(input.mergeStateStatus).toUpperCase();
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
  if (canonicalWorkflowRunPath(workflowRun) !== OPERATOR_MERGE_WORKFLOW_PATH) {
    blockers.push('untrusted-workflow-path');
  }
  if (text(workflowRun.repository?.full_name || workflowRun.repository) !== repository) blockers.push('workflow-repository-mismatch');
  if (!reviewDecisionObserved) blockers.push('pull-request-review-decision-missing');
  if (!mergeableObserved) blockers.push('pull-request-mergeable-evidence-missing');
  if (!mergeStateStatusObserved) blockers.push('pull-request-merge-state-evidence-missing');
  if (!['', 'APPROVED'].includes(reviewDecision)) blockers.push('pull-request-review-decision-blocked');
  if (mergeable !== 'MERGEABLE') blockers.push('pull-request-not-mergeable');
  if (mergeStateStatus !== 'CLEAN') blockers.push('pull-request-merge-state-not-clean');

  const workflowIdentityBinding = bindRequiredExactHeadWorkflowIdentities(
    input.workflowDefinitions,
    { repository },
  );
  if (!workflowIdentityBinding.valid) blockers.push(...workflowIdentityBinding.blockers);
  const workflows = validateExactHeadWorkflowRuns(input.workflowRuns, {
    expectedHead,
    expectedPrNumber,
    expectedBranch,
    expectedBaseBranch: expectedBase,
    expectedBaseSha: input.baseSha,
    requiredIdentities: workflowIdentityBinding.identities,
  });
  if (!workflows.valid) blockers.push(...workflows.blockers);
  if (integer(input.unresolvedThreadCount) !== 0) blockers.push('unresolved-review-threads');

  return Object.freeze({
    schemaVersion: 'stephanos.protected-operator-merge-prerequisites.v1',
    repository,
    prNumber: expectedPrNumber,
    sourceHead: expectedHead,
    branch: expectedBranch,
    reviewDecision: reviewDecision || null,
    mergeable,
    mergeStateStatus,
    environment,
    workflowIdentityBinding,
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
      expectedBranch: prerequisites.branch,
      expectedBaseBranch: text(input.baseBranch || 'main'),
      expectedBaseSha: text(input.baseSha).toLowerCase(),
      expectedWorkflowId: input.reviewWorkflowId,
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
  const independentReviewWorkflowRunId = strictPositiveInteger(input.independentReviewWorkflowRunId);
  const independentReviewWorkflowRunAttempt = strictPositiveInteger(input.independentReviewWorkflowRunAttempt);
  const independentReviewArtifactId = strictPositiveInteger(input.independentReviewArtifactId);
  const independentReviewArtifactDigest = text(input.independentReviewArtifactDigest).toLowerCase();
  const independentReviewPayloadSha256 = text(input.independentReviewPayloadSha256).toLowerCase();
  if (
    !independentReviewWorkflowRunId
    || !independentReviewWorkflowRunAttempt
    || !independentReviewArtifactId
    || !ARTIFACT_DIGEST_PATTERN.test(independentReviewArtifactDigest)
    || !SHA256_PATTERN.test(independentReviewPayloadSha256)
  ) {
    throw new Error('Protected operator approval requires an exact immutable independent-review artifact identity.');
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
    independentReviewWorkflowRunId,
    independentReviewWorkflowRunAttempt,
    independentReviewArtifactId,
    independentReviewArtifactDigest,
    independentReviewPayloadSha256,
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
