import { createHash } from 'node:crypto';

export const GITHUB_READ_RESILIENCE_SCHEMA_VERSION = 'stephanos.github-read-resilience.v1';
export const INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_SCHEMA_VERSION = 'stephanos.independent-review-infrastructure-blocked.v1';
export const INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_KIND = 'stephanos.independent-review.infrastructure-blocked';
export const INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_MODE = 'infrastructure-blocked';
export const INDEPENDENT_REVIEW_RESULT_FILE = 'independent-review-result.json';
export const GITHUB_READ_MAX_ATTEMPTS = 3;

const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const PR_GLOBAL_ID_404 = /Could not resolve to a node with the global id of ["']?PR_[A-Za-z0-9_-]+["']?/i;
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_DELAYS_MS = Object.freeze([250, 750]);
const FAILURE_CODES = new Set([
  'GITHUB_READ_NETWORK',
  'GITHUB_READ_TRANSIENT_HTTP',
  'GITHUB_READ_PR_GLOBAL_ID_404',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function payloadSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function classifyGitHubReadFailure(input = {}) {
  const method = text(input.method || 'GET').toUpperCase();
  const status = Number.isInteger(input.status) ? input.status : 0;
  const body = text(input.body);
  const networkError = input.networkError === true;
  if (method !== 'GET') {
    return Object.freeze({
      schemaVersion: GITHUB_READ_RESILIENCE_SCHEMA_VERSION,
      retryable: false,
      code: 'GITHUB_NON_READ_OPERATION',
    });
  }
  if (networkError) {
    return Object.freeze({
      schemaVersion: GITHUB_READ_RESILIENCE_SCHEMA_VERSION,
      retryable: true,
      code: 'GITHUB_READ_NETWORK',
    });
  }
  if (TRANSIENT_HTTP_STATUSES.has(status)) {
    return Object.freeze({
      schemaVersion: GITHUB_READ_RESILIENCE_SCHEMA_VERSION,
      retryable: true,
      code: 'GITHUB_READ_TRANSIENT_HTTP',
    });
  }
  if (status === 404 && PR_GLOBAL_ID_404.test(body)) {
    return Object.freeze({
      schemaVersion: GITHUB_READ_RESILIENCE_SCHEMA_VERSION,
      retryable: true,
      code: 'GITHUB_READ_PR_GLOBAL_ID_404',
    });
  }
  return Object.freeze({
    schemaVersion: GITHUB_READ_RESILIENCE_SCHEMA_VERSION,
    retryable: false,
    code: 'GITHUB_READ_PERMANENT',
  });
}

export function githubReadRetryDelayMs(completedAttempt) {
  const attempt = positiveInteger(completedAttempt);
  if (!attempt || attempt >= GITHUB_READ_MAX_ATTEMPTS) return 0;
  return RETRY_DELAYS_MS[attempt - 1] ?? 0;
}

export class GitHubReadInfrastructureError extends Error {
  constructor(input = {}) {
    const method = text(input.method || 'GET').toUpperCase();
    const path = text(input.path);
    const status = Number.isInteger(input.status) && input.status > 0 ? input.status : null;
    const attempts = positiveInteger(input.attempts);
    const code = text(input.code);
    if (method !== 'GET' || !path.startsWith('/') || !attempts || !FAILURE_CODES.has(code)) {
      throw new Error('GitHub read infrastructure error identity is invalid.');
    }
    super(`REVIEW_INFRASTRUCTURE_BLOCKED: ${code} after ${attempts} attempt(s) for ${method} ${path}${status ? ` (${status})` : ''}`);
    this.name = 'GitHubReadInfrastructureError';
    this.code = code;
    this.method = method;
    this.path = path;
    this.status = status;
    this.attempts = attempts;
  }
}

export function buildIndependentReviewInfrastructureBlockedArtifact(input = {}) {
  const repository = text(input.repository);
  const prNumber = positiveInteger(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const workflowRunId = positiveInteger(input.workflowRunId);
  const workflowRunAttempt = positiveInteger(input.workflowRunAttempt);
  const createdAtUtc = text(input.createdAtUtc || new Date().toISOString());
  const failure = input.failure instanceof GitHubReadInfrastructureError
    ? input.failure
    : null;

  if (!REPOSITORY.test(repository)
    || !prNumber
    || !BRANCH.test(branch)
    || branch.includes('..')
    || !FULL_SHA.test(sourceHead)
    || !FULL_SHA.test(baseSha)
    || !workflowRunId
    || !workflowRunAttempt
    || !EXPLICIT_TIMEZONE.test(createdAtUtc)
    || !Number.isFinite(Date.parse(createdAtUtc))
    || !failure) {
    throw new Error('Independent review infrastructure-blocked artifact identity is invalid.');
  }

  const blocker = Object.freeze({
    code: 'REVIEW_INFRASTRUCTURE_BLOCKED',
    providerCode: failure.code,
    method: failure.method,
    path: failure.path,
    status: failure.status,
    attempts: failure.attempts,
    retryable: true,
    messageSha256: createHash('sha256').update(failure.message, 'utf8').digest('hex'),
  });
  const core = {
    schemaVersion: INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_SCHEMA_VERSION,
    kind: INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_KIND,
    artifactName: `stephanos-independent-review-${workflowRunId}-attempt-${workflowRunAttempt}`,
    artifactFile: INDEPENDENT_REVIEW_RESULT_FILE,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    reviewMode: INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_MODE,
    createdAtUtc,
    blocker,
  };
  return Object.freeze({
    ...core,
    payloadSha256: payloadSha256(core),
  });
}

export function validateIndependentReviewInfrastructureBlockedArtifact(artifact = {}, options = {}) {
  const blockers = [];
  const expectedRepository = text(options.repository);
  const expectedPrNumber = positiveInteger(options.prNumber);
  const expectedBranch = text(options.branch);
  const expectedHead = text(options.sourceHead).toLowerCase();
  const expectedBase = text(options.baseSha).toLowerCase();
  const expectedRunId = positiveInteger(options.workflowRunId);
  const expectedAttempt = positiveInteger(options.workflowRunAttempt);

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) blockers.push('artifact-invalid');
  if (artifact.schemaVersion !== INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_SCHEMA_VERSION) blockers.push('schema-mismatch');
  if (artifact.kind !== INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_KIND) blockers.push('kind-mismatch');
  if (artifact.reviewMode !== INDEPENDENT_REVIEW_INFRASTRUCTURE_BLOCKED_MODE) blockers.push('mode-mismatch');
  if (artifact.artifactFile !== INDEPENDENT_REVIEW_RESULT_FILE) blockers.push('file-mismatch');
  if (artifact.repository !== expectedRepository) blockers.push('repository-mismatch');
  if (artifact.prNumber !== expectedPrNumber) blockers.push('pr-mismatch');
  if (artifact.branch !== expectedBranch) blockers.push('branch-mismatch');
  if (artifact.sourceHead !== expectedHead) blockers.push('head-mismatch');
  if (artifact.baseSha !== expectedBase) blockers.push('base-mismatch');
  if (artifact.workflowRunId !== expectedRunId) blockers.push('run-mismatch');
  if (artifact.workflowRunAttempt !== expectedAttempt) blockers.push('attempt-mismatch');
  if (artifact.artifactName !== `stephanos-independent-review-${expectedRunId}-attempt-${expectedAttempt}`) blockers.push('name-mismatch');
  if (artifact.blocker?.code !== 'REVIEW_INFRASTRUCTURE_BLOCKED'
    || artifact.blocker?.retryable !== true
    || !FAILURE_CODES.has(text(artifact.blocker?.providerCode))
    || text(artifact.blocker?.method) !== 'GET'
    || !text(artifact.blocker?.path).startsWith('/')
    || !positiveInteger(artifact.blocker?.attempts)
    || !SHA256.test(text(artifact.blocker?.messageSha256))) {
    blockers.push('blocker-invalid');
  }
  const createdAtUtc = text(artifact.createdAtUtc);
  if (!EXPLICIT_TIMEZONE.test(createdAtUtc) || !Number.isFinite(Date.parse(createdAtUtc))) blockers.push('time-invalid');
  const payload = { ...artifact };
  delete payload.payloadSha256;
  if (!SHA256.test(text(artifact.payloadSha256)) || payloadSha256(payload) !== artifact.payloadSha256) {
    blockers.push('payload-digest-mismatch');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length
      ? 'INDEPENDENT_REVIEW_INFRASTRUCTURE_ARTIFACT_BLOCKED'
      : 'INDEPENDENT_REVIEW_INFRASTRUCTURE_ARTIFACT_VALID',
  });
}
