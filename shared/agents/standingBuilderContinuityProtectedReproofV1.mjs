import {
  STANDING_BUILDER_CONTINUITY_VERDICTS,
  evaluateStandingBuilderContinuityFallbackV1,
} from './standingBuilderContinuityAuthorityV1.mjs';

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const SAFE_PATH = /^(?:[a-z0-9]|\.[a-z0-9])[a-z0-9._/-]{0,240}$/i;
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';

export const STANDING_BUILDER_CONTINUITY_PROTECTED_REPROOF_SCHEMA =
  'stephanos.standing-builder-continuity-protected-reproof.v1';
export const STANDING_BUILDER_CONTINUITY_PROTECTED_WORKFLOW =
  '.github/workflows/operator-merge-approval-gate.yml';
export const STANDING_BUILDER_CONTINUITY_PROTECTED_MODE = 'user-owned-protected-squash';

function text(value) {
  return String(value ?? '').trim();
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function exactDigest(value) {
  const normalized = text(value).toLowerCase();
  return SHA256.test(normalized) ? normalized : '';
}

function boundTupleEvidence(value, { repository, prNumber, branch, sourceHead, baseSha, payloadSha256, kind }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return text(value.kind) === kind
    && text(value.repository) === repository
    && Number(value.prNumber) === prNumber
    && text(value.branch) === branch
    && exactSha(value.sourceHead) === sourceHead
    && exactSha(value.baseSha) === baseSha
    && (!payloadSha256 || exactDigest(value.payloadSha256) === payloadSha256)
    && exactDigest(value.receiptSha256);
}

function exactPaths(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const paths = value.map((item) => text(item).replace(/\\/g, '/'));
  if (paths.some((item) => !SAFE_PATH.test(item) || item.includes('..'))) return null;
  if (new Set(paths).size !== paths.length) return null;
  return Object.freeze([...paths].sort());
}

export function buildStandingBuilderContinuityProtectedReproofV1(input = {}) {
  const blockers = [];
  const eligibility = evaluateStandingBuilderContinuityFallbackV1(input.eligibilityInput || {});

  if (!eligibility.eligible
    || eligibility.finalVerdict !== STANDING_BUILDER_CONTINUITY_VERDICTS.ELIGIBLE
    || eligibility.specialistReviewSatisfied !== false
    || eligibility.protectedExecutionAuthority !== false
    || eligibility.mergeAuthority !== false
    || eligibility.runtimeMutationAuthority !== false
    || eligibility.requiresProtectedWorkflowReproof !== true) {
    blockers.push('standing-reproof-eligibility-not-exact');
  }

  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = exactSha(input.sourceHead);
  const sourceTree = exactSha(input.sourceTree);
  const baseSha = exactSha(input.baseSha);
  const currentMain = exactSha(input.currentMain);
  const changedPaths = exactPaths(input.changedPaths);
  const changedEstateSha256 = exactDigest(input.changedEstateSha256);
  const independentReviewPayloadSha256 = exactDigest(input.independentReviewPayloadSha256);

  if (repository !== CANONICAL_REPOSITORY) blockers.push('standing-reproof-repository-invalid');
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) blockers.push('standing-reproof-pr-invalid');
  if (!SAFE_BRANCH.test(branch) || branch.includes('..')) blockers.push('standing-reproof-branch-invalid');
  if (!sourceHead) blockers.push('standing-reproof-head-invalid');
  if (!sourceTree) blockers.push('standing-reproof-tree-invalid');
  if (!baseSha) blockers.push('standing-reproof-base-invalid');
  if (!currentMain) blockers.push('standing-reproof-current-main-invalid');
  if (baseSha && currentMain && baseSha !== currentMain) blockers.push('standing-reproof-current-main-drift');
  if (!changedPaths) blockers.push('standing-reproof-changed-estate-invalid');
  if (!changedEstateSha256) blockers.push('standing-reproof-changed-estate-digest-invalid');
  if (!independentReviewPayloadSha256) blockers.push('standing-reproof-review-payload-digest-invalid');

  if (text(eligibility.repository) !== repository) blockers.push('standing-reproof-eligibility-repository-drift');
  if (Number(eligibility.prNumber) !== prNumber) blockers.push('standing-reproof-eligibility-pr-drift');
  if (text(eligibility.sourceHead).toLowerCase() !== sourceHead) blockers.push('standing-reproof-eligibility-head-drift');
  if (text(eligibility.baseSha).toLowerCase() !== baseSha) blockers.push('standing-reproof-eligibility-base-drift');

  if (input.pullRequestOpen !== true) blockers.push('standing-reproof-pr-not-open');
  if (input.pullRequestDraft !== false) blockers.push('standing-reproof-pr-still-draft');
  if (input.pullRequestMerged === true) blockers.push('standing-reproof-pr-already-merged');
  if (input.mergeable !== true) blockers.push('standing-reproof-not-mergeable');
  if (!Number.isSafeInteger(input.unresolvedReviewThreads) || input.unresolvedReviewThreads < 0) {
    blockers.push('standing-reproof-unresolved-review-threads-unknown');
  } else if (input.unresolvedReviewThreads !== 0) {
    blockers.push('standing-reproof-unresolved-review-threads');
  }
  if (input.exactHostedChecksGreen !== true) blockers.push('standing-reproof-hosted-checks-not-green');
  if (input.deterministicHighRiskTestsGreen !== true) blockers.push('standing-reproof-high-risk-tests-not-green');
  const reviewEvidenceBound = boundTupleEvidence(input.independentReviewEvidence, {
    repository, prNumber, branch, sourceHead, baseSha,
    payloadSha256: independentReviewPayloadSha256,
    kind: 'INDEPENDENT_REVIEW',
  });
  if (!reviewEvidenceBound) blockers.push('standing-reproof-independent-review-not-bound');
  const providerEvidenceBound = boundTupleEvidence(input.providerCapacityEvidence, {
    repository, prNumber, branch, sourceHead, baseSha,
    payloadSha256: '',
    kind: 'PROVIDER_CAPACITY_UNAVAILABLE',
  }) && text(input.providerCapacityEvidence?.capability) === 'specialistReview'
    && text(input.providerCapacityEvidence?.verdict) === 'NO_QUALIFIED_PROVIDER_AVAILABLE';
  if (!providerEvidenceBound) blockers.push('standing-reproof-provider-unavailability-not-proven');
  if (input.resourceOwnershipUnambiguous !== true) blockers.push('standing-reproof-resource-owner-ambiguous');
  if (input.noNewAuthoritySurface !== true) blockers.push('standing-reproof-authority-surface-widened');
  if (input.changedEstateMatchesEligibleScope !== true) blockers.push('standing-reproof-changed-estate-drift');

  const uniqueBlockers = Object.freeze([...new Set(blockers)]);
  const ready = uniqueBlockers.length === 0;

  return Object.freeze({
    schemaVersion: STANDING_BUILDER_CONTINUITY_PROTECTED_REPROOF_SCHEMA,
    ready,
    finalVerdict: ready
      ? 'STANDING_AUTHORITY_PROTECTED_EXECUTION'
      : 'STANDING_AUTHORITY_PROTECTED_REPROOF_BLOCKED',
    blockers: uniqueBlockers,
    workflowDispatch: ready ? Object.freeze({
      workflowPath: STANDING_BUILDER_CONTINUITY_PROTECTED_WORKFLOW,
      mode: STANDING_BUILDER_CONTINUITY_PROTECTED_MODE,
      repository,
      prNumber,
      branch,
      expectedHead: sourceHead,
      expectedHeadTree: sourceTree,
      expectedBase: baseSha,
      changedPaths,
      changedEstateSha256,
      independentReviewPayloadSha256,
      authorityClass: 'BUILDER_CONTINUITY',
      protectedWorkflowReproofRequired: true,
    }) : null,
    specialistReviewSatisfied: false,
    rawMergeAllowed: false,
    protectedEnvironmentBypassAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
  });
}
