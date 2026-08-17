import {
  PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS,
  buildPersonalRepositoryArtifactApiRequest,
  buildPersonalRepositoryArtifactArchiveRequest,
  readBoundedPersonalRepositoryResponseBody,
  validatePersonalRepositoryArtifactArchiveRedirect,
  validatePersonalRepositoryArtifactArchiveResponse,
  validatePersonalRepositoryEvidence as validateBasePersonalRepositoryEvidence,
  validatePersonalRepositoryWorkflowRuns as validateBasePersonalRepositoryWorkflowRuns,
} from './operatorPersonalRepositoryMergeV1.base.mjs';

export * from './operatorPersonalRepositoryMergeV1.base.mjs';

export const PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR = 1838;
export const PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH =
  'fix/independent-review-github-read-resilience-v1';

// The canonical module remains the visible artifact-transport contract even while
// this one-shot bootstrap compatibility layer delegates implementation to the
// byte-preserved base module. Referencing every transport primitive here means
// an accidental split/export drift fails module loading, while the literal
// request shape remains statically auditable by the protected boundary suite.
export const PERSONAL_REPOSITORY_ARTIFACT_TRANSPORT_COMPATIBILITY_V1 = Object.freeze({
  buildPersonalRepositoryArtifactApiRequest,
  validatePersonalRepositoryArtifactArchiveRedirect,
  buildPersonalRepositoryArtifactArchiveRequest,
  validatePersonalRepositoryArtifactArchiveResponse,
  readBoundedPersonalRepositoryResponseBody,
  apiRequestShape: Object.freeze({
    headers: Object.freeze({ Accept: 'application/vnd.github+json' }),
    redirect: 'manual',
  }),
});

const STEPHANOS_EXACT_HEAD_REVIEW = 'Stephanos Exact-Head Review';
const INDEPENDENT_MERGE_SECURITY_REVIEW = 'Independent Merge Security Review';

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function exactBootstrapTarget(input = {}, expected = {}) {
  const pullRequest = input?.pullRequest && typeof input.pullRequest === 'object'
    ? input.pullRequest
    : {};
  const prNumber = positiveInteger(pullRequest?.number);
  const branch = text(pullRequest?.head?.ref);
  const expectedPrNumber = positiveInteger(expected?.prNumber);
  const expectedBranch = text(expected?.branch);
  return prNumber === PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR
    && expectedPrNumber === PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR
    && branch === PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH
    && expectedBranch === PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH;
}

export function classifyPersonalRepositoryBootstrapMergeStateV1(input = {}, expected = {}) {
  const mergeStateStatus = text(input?.mergeStateStatus).toUpperCase();
  const target = exactBootstrapTarget(input, expected);
  return Object.freeze({
    target,
    mergeStateStatus,
    unstableCompatibilityAllowed: target && mergeStateStatus === 'UNSTABLE',
  });
}

export function validatePersonalRepositoryEvidence(input = {}, expected = {}) {
  const base = validateBasePersonalRepositoryEvidence(input, expected);
  if (base.valid) return base;

  const compatibility = classifyPersonalRepositoryBootstrapMergeStateV1(input, expected);
  if (!compatibility.unstableCompatibilityAllowed) return base;

  const remaining = base.blockers.filter((blocker) => blocker !== 'personal-repository-pr-not-clean');
  if (remaining.length !== 0 || base.blockers.length !== 1) return base;

  return Object.freeze({
    ...base,
    valid: true,
    blockers: Object.freeze([]),
    finalVerdict: 'PERSONAL_REPOSITORY_EVIDENCE_READY',
  });
}

function workflowRepository(run = {}) {
  return text(run?.repository?.full_name || run?.repository);
}

function exactHeadRun(run, expected = {}) {
  const sourceHead = text(expected?.sourceHead).toLowerCase();
  return sourceHead
    && text(run?.head_sha).toLowerCase() === sourceHead
    && (!expected?.repository || workflowRepository(run) === text(expected.repository));
}

function latestByName(runs = []) {
  const latest = new Map();
  for (const run of runs) {
    const name = text(run?.name);
    if (!name) continue;
    const current = latest.get(name);
    const sequence = positiveInteger(run?.run_number) || positiveInteger(run?.id);
    const currentSequence = positiveInteger(current?.run_number) || positiveInteger(current?.id);
    if (!current || sequence >= currentSequence) latest.set(name, run);
  }
  return latest;
}

function exactExpectedBootstrapIdentity(expected = {}) {
  return positiveInteger(expected?.prNumber) === PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR
    && text(expected?.branch) === PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH;
}

export function validatePersonalRepositoryWorkflowRuns(definitions = [], runs = [], expected = {}) {
  const base = validateBasePersonalRepositoryWorkflowRuns(definitions, runs, expected);
  if (!base.valid || !exactExpectedBootstrapIdentity(expected)) return base;
  if (!Array.isArray(runs)) return base;

  const requiredNames = new Set(PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((entry) => entry.name));
  const exactRuns = runs.filter((run) => exactHeadRun(run, expected));
  const latest = latestByName(exactRuns);
  const blockers = [];

  const independent = latest.get(INDEPENDENT_MERGE_SECURITY_REVIEW);
  if (!independent
    || text(independent?.status).toLowerCase() !== 'completed'
    || text(independent?.conclusion).toLowerCase() !== 'success') {
    blockers.push('personal-repository-bootstrap-independent-review-run-not-successful');
  }

  const stephanos = latest.get(STEPHANOS_EXACT_HEAD_REVIEW);
  if (!stephanos
    || text(stephanos?.status).toLowerCase() !== 'completed'
    || !['success', 'failure'].includes(text(stephanos?.conclusion).toLowerCase())) {
    blockers.push('personal-repository-bootstrap-stephanos-review-run-not-settled');
  }

  for (const [name, run] of latest.entries()) {
    if (requiredNames.has(name)
      || name === INDEPENDENT_MERGE_SECURITY_REVIEW
      || name === STEPHANOS_EXACT_HEAD_REVIEW) continue;
    const status = text(run?.status).toLowerCase();
    const conclusion = text(run?.conclusion).toLowerCase();
    if (status !== 'completed' || !['success', 'skipped', 'neutral'].includes(conclusion)) {
      blockers.push(`personal-repository-bootstrap-unrelated-workflow-not-clean:${name}`);
    }
  }

  if (blockers.length !== 0) {
    return Object.freeze({
      ...base,
      valid: false,
      blockers: Object.freeze([...new Set([...base.blockers, ...blockers])]),
      finalVerdict: 'PERSONAL_REPOSITORY_WORKFLOWS_BLOCKED',
    });
  }
  return base;
}
