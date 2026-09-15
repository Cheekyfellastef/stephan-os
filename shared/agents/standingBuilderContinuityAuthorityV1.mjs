const SHA40 = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,100}$/i;
const SAFE_ACTION = /^[A-Z][A-Z0-9_]{2,80}$/;
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const REQUIRED_MISSION_CLASS = 'BUILDER_CONTINUITY';
const ALLOWED_OPERATOR_IDENTITIES = new Set(['Cheekyfellastef']);
const ALLOWED_REVOCATION_STATES = new Set(['ACTIVE', 'REVOKED']);
const REQUIRED_HIGH_RISK_QUORUM = Object.freeze([
  'exact-head-hosted-checks',
  'deterministic-high-risk-tests',
  'independent-review-no-substantive-p0-p1',
  'provider-unavailability-proof',
  'operator-standing-authority-proof',
]);

export const STANDING_BUILDER_CONTINUITY_AUTHORITY_SCHEMA =
  'stephanos.standing-builder-continuity-authority.v1';
export const STANDING_BUILDER_CONTINUITY_POLICY_VERSION = '1.0.0';
export const STANDING_BUILDER_CONTINUITY_ALLOWED_ACTION_CLASSES = Object.freeze([
  'PROTECTED_ADMISSION_REPROOF',
  'PROTECTED_REPROOF',
]);
export const STANDING_BUILDER_CONTINUITY_FORBIDDEN_ACTION_CLASSES = Object.freeze([
  'ARBITRARY_SHELL',
  'CREDENTIAL_CHANGE',
  'DIRECT_MAIN_WRITE',
  'RUNTIME_MUTATION',
]);
export const STANDING_BUILDER_CONTINUITY_VERDICTS = Object.freeze({
  ELIGIBLE: 'STANDING_AUTHORITY_ELIGIBLE',
  BLOCKED: 'STANDING_AUTHORITY_BLOCKED',
});

const ENVELOPE_KEYS = Object.freeze([
  'schemaVersion',
  'authorityId',
  'operatorIdentity',
  'missionClass',
  'canonicalGoalRefs',
  'repository',
  'allowedActionClasses',
  'forbiddenActionClasses',
  'createdAtUtc',
  'revocationState',
  'policyVersion',
]);

function text(value) {
  return String(value ?? '').trim();
}

function sameKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function positiveGoalRefs(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const refs = value.map(Number);
  if (refs.some((item) => !Number.isSafeInteger(item) || item <= 0)) return null;
  if (new Set(refs).size !== refs.length) return null;
  return Object.freeze([...refs].sort((left, right) => left - right));
}

function actionClasses(value) {
  if (!Array.isArray(value)) return null;
  const actions = value.map(text);
  if (actions.some((item) => !SAFE_ACTION.test(item))) return null;
  if (new Set(actions).size !== actions.length) return null;
  return Object.freeze([...actions].sort());
}

function sameActionClasses(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((action, index) => action === expected[index]);
}

function explicitTimestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return '';
  return Number.isFinite(Date.parse(normalized)) ? normalized : '';
}

export function validateStandingBuilderContinuityAuthorityV1(envelope = {}) {
  const blockers = [];
  if (!sameKeys(envelope, ENVELOPE_KEYS)) blockers.push('standing-authority-envelope-schema-unbounded');
  if (envelope.schemaVersion !== STANDING_BUILDER_CONTINUITY_AUTHORITY_SCHEMA) blockers.push('standing-authority-schema-mismatch');
  if (!SAFE_ID.test(text(envelope.authorityId))) blockers.push('standing-authority-id-invalid');
  if (!ALLOWED_OPERATOR_IDENTITIES.has(text(envelope.operatorIdentity))) blockers.push('standing-authority-operator-invalid');
  if (text(envelope.missionClass) !== REQUIRED_MISSION_CLASS) blockers.push('standing-authority-mission-class-invalid');
  const goalRefs = positiveGoalRefs(envelope.canonicalGoalRefs);
  if (!goalRefs) blockers.push('standing-authority-goal-refs-invalid');
  if (text(envelope.repository) !== CANONICAL_REPOSITORY) blockers.push('standing-authority-repository-invalid');
  const allowed = actionClasses(envelope.allowedActionClasses);
  const forbidden = actionClasses(envelope.forbiddenActionClasses);
  if (!allowed || allowed.length === 0) blockers.push('standing-authority-allowed-actions-invalid');
  if (!forbidden || forbidden.length === 0) blockers.push('standing-authority-forbidden-actions-invalid');
  if (allowed && !sameActionClasses(allowed, STANDING_BUILDER_CONTINUITY_ALLOWED_ACTION_CLASSES)) {
    blockers.push('standing-authority-allowed-actions-not-canonical');
  }
  if (forbidden && !sameActionClasses(forbidden, STANDING_BUILDER_CONTINUITY_FORBIDDEN_ACTION_CLASSES)) {
    blockers.push('standing-authority-forbidden-actions-not-canonical');
  }
  if (allowed && forbidden && allowed.some((action) => forbidden.includes(action))) blockers.push('standing-authority-action-overlap');
  if (!explicitTimestamp(envelope.createdAtUtc)) blockers.push('standing-authority-created-at-invalid');
  if (!ALLOWED_REVOCATION_STATES.has(text(envelope.revocationState))) blockers.push('standing-authority-revocation-state-invalid');
  if (text(envelope.policyVersion) !== STANDING_BUILDER_CONTINUITY_POLICY_VERSION) blockers.push('standing-authority-policy-version-invalid');
  if (text(envelope.revocationState) !== 'ACTIVE') blockers.push('standing-authority-revoked');

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length === 0
      ? 'STANDING_BUILDER_CONTINUITY_AUTHORITY_VALID'
      : 'STANDING_BUILDER_CONTINUITY_AUTHORITY_INVALID',
  });
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function findingIsOnlySpecialistEscalation(finding = {}) {
  return text(finding.severity).toUpperCase() === 'P0'
    && text(finding.code) === 'unsupported-high-risk-surface';
}

export function evaluateStandingBuilderContinuityFallbackV1(input = {}) {
  const blockers = [];
  const authority = validateStandingBuilderContinuityAuthorityV1(input.authority);
  if (!authority.valid) blockers.push(...authority.blockers);

  const sourceHead = exactSha(input.sourceHead);
  const baseSha = exactSha(input.baseSha);
  if (!sourceHead) blockers.push('standing-authority-source-head-invalid');
  if (!baseSha) blockers.push('standing-authority-base-sha-invalid');
  if (text(input.repository) !== CANONICAL_REPOSITORY) blockers.push('standing-authority-target-repository-invalid');
  if (!Number.isSafeInteger(Number(input.prNumber)) || Number(input.prNumber) <= 0) blockers.push('standing-authority-pr-invalid');

  const goalRefs = positiveGoalRefs(input.authority?.canonicalGoalRefs) || [];
  if (!goalRefs.includes(Number(input.goalRef))) blockers.push('standing-authority-goal-not-covered');

  const allowedActions = actionClasses(input.authority?.allowedActionClasses) || [];
  if (!allowedActions.includes(text(input.actionClass))) blockers.push('standing-authority-action-not-covered');

  if (input.builderContinuityPurpose !== true) blockers.push('standing-authority-purpose-not-builder-continuity');
  if (input.scopeBounded !== true) blockers.push('standing-authority-scope-not-bounded');
  if (input.newAuthoritySurfaceIntroduced !== false) blockers.push('standing-authority-new-authority-surface-forbidden');
  if (input.exactHostedChecksGreen !== true) blockers.push('standing-authority-hosted-checks-not-green');
  if (input.deterministicHighRiskTestsGreen !== true) blockers.push('standing-authority-high-risk-tests-not-green');
  if (input.providerUnavailableProven !== true) blockers.push('standing-authority-provider-unavailability-not-proven');
  if (input.sourceIdentityCurrent !== true) blockers.push('standing-authority-source-identity-not-current');
  if (input.resourceOwnershipUnambiguous !== true) blockers.push('standing-authority-resource-owner-ambiguous');
  if (input.mergeable !== true) blockers.push('standing-authority-target-not-mergeable');
  if (!Number.isSafeInteger(input.unresolvedReviewThreads) || input.unresolvedReviewThreads < 0) {
    blockers.push('standing-authority-unresolved-review-threads-unknown');
  } else if (input.unresolvedReviewThreads !== 0) {
    blockers.push('standing-authority-unresolved-review-threads');
  }

  const findings = Array.isArray(input.independentFindings) ? input.independentFindings : [];
  const substantive = findings.filter((finding) => !findingIsOnlySpecialistEscalation(finding));
  if (substantive.some((finding) => ['P0', 'P1'].includes(text(finding.severity).toUpperCase()))) {
    blockers.push('standing-authority-substantive-p0-p1-present');
  }
  if (!findings.length || findings.some((finding) => !findingIsOnlySpecialistEscalation(finding))) {
    blockers.push('standing-authority-specialist-escalation-not-exclusive');
  }

  const quorum = Array.isArray(input.quorumProofs) ? [...new Set(input.quorumProofs.map(text))] : [];
  for (const required of REQUIRED_HIGH_RISK_QUORUM) {
    if (!quorum.includes(required)) blockers.push(`standing-authority-quorum-missing:${required}`);
  }

  return Object.freeze({
    schemaVersion: 'stephanos.standing-builder-continuity-fallback-decision.v1',
    repository: text(input.repository),
    prNumber: Number(input.prNumber) || 0,
    goalRef: Number(input.goalRef) || 0,
    sourceHead,
    baseSha,
    actionClass: text(input.actionClass),
    eligible: blockers.length === 0,
    protectedExecutionAuthority: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    specialistReviewSatisfied: false,
    requiresProtectedWorkflowReproof: true,
    requiredQuorum: REQUIRED_HIGH_RISK_QUORUM,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length === 0
      ? STANDING_BUILDER_CONTINUITY_VERDICTS.ELIGIBLE
      : STANDING_BUILDER_CONTINUITY_VERDICTS.BLOCKED,
  });
}
