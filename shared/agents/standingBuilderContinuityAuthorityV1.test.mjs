import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDING_BUILDER_CONTINUITY_AUTHORITY_SCHEMA,
  STANDING_BUILDER_CONTINUITY_POLICY_VERSION,
  evaluateStandingBuilderContinuityFallbackV1,
  validateStandingBuilderContinuityAuthorityV1,
} from './standingBuilderContinuityAuthorityV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function authority(overrides = {}) {
  return {
    schemaVersion: STANDING_BUILDER_CONTINUITY_AUTHORITY_SCHEMA,
    authorityId: 'builder-continuity-stephan-v1',
    operatorIdentity: 'Cheekyfellastef',
    missionClass: 'BUILDER_CONTINUITY',
    canonicalGoalRefs: [1291, 1497, 1556, 1557, 1622, 1637],
    repository: 'Cheekyfellastef/stephan-os',
    allowedActionClasses: ['BOUNDED_SOURCE_REPAIR', 'PROTECTED_ADMISSION_REPROOF'],
    forbiddenActionClasses: ['ARBITRARY_SHELL', 'CREDENTIAL_CHANGE', 'DIRECT_MAIN_WRITE', 'RUNTIME_MUTATION'],
    createdAtUtc: '2026-09-14T07:00:00Z',
    revocationState: 'ACTIVE',
    policyVersion: STANDING_BUILDER_CONTINUITY_POLICY_VERSION,
    ...overrides,
  };
}

function eligibleInput(overrides = {}) {
  return {
    authority: authority(),
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2222,
    goalRef: 1622,
    sourceHead: HEAD,
    baseSha: BASE,
    actionClass: 'PROTECTED_ADMISSION_REPROOF',
    builderContinuityPurpose: true,
    scopeBounded: true,
    newAuthoritySurfaceIntroduced: false,
    exactHostedChecksGreen: true,
    deterministicHighRiskTestsGreen: true,
    providerUnavailableProven: true,
    sourceIdentityCurrent: true,
    resourceOwnershipUnambiguous: true,
    mergeable: true,
    unresolvedReviewThreads: 0,
    independentFindings: [
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/a.ps1' },
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/b.ps1' },
    ],
    quorumProofs: [
      'exact-head-hosted-checks',
      'deterministic-high-risk-tests',
      'independent-review-no-substantive-p0-p1',
      'provider-unavailability-proof',
      'operator-standing-authority-proof',
    ],
    ...overrides,
  };
}

test('validates the bounded active builder-continuity standing envelope', () => {
  const result = validateStandingBuilderContinuityAuthorityV1(authority());
  assert.equal(result.valid, true);
  assert.equal(result.finalVerdict, 'STANDING_BUILDER_CONTINUITY_AUTHORITY_VALID');
});

test('revoked standing authority fails closed', () => {
  const result = validateStandingBuilderContinuityAuthorityV1(authority({ revocationState: 'REVOKED' }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('standing-authority-revoked'));
});

test('provider-unavailable specialist escalation can become eligibility only, never merge authority', () => {
  const result = evaluateStandingBuilderContinuityFallbackV1(eligibleInput());
  assert.equal(result.eligible, true);
  assert.equal(result.finalVerdict, 'STANDING_AUTHORITY_ELIGIBLE');
  assert.equal(result.specialistReviewSatisfied, false);
  assert.equal(result.protectedExecutionAuthority, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.requiresProtectedWorkflowReproof, true);
});

test('a real P1 remains a hard blocker rather than provider friction', () => {
  const result = evaluateStandingBuilderContinuityFallbackV1(eligibleInput({
    independentFindings: [
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/a.ps1' },
      { severity: 'P1', code: 'unsafe-authority-widening', path: 'scripts/windows/a.ps1' },
    ],
  }));
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('standing-authority-substantive-p0-p1-present'));
  assert.equal(result.mergeAuthority, false);
});

test('specialist availability failure must be independently proven', () => {
  const result = evaluateStandingBuilderContinuityFallbackV1(eligibleInput({ providerUnavailableProven: false }));
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('standing-authority-provider-unavailability-not-proven'));
});

test('identity drift, unresolved threads and ownership ambiguity remain blockers', () => {
  const result = evaluateStandingBuilderContinuityFallbackV1(eligibleInput({
    sourceIdentityCurrent: false,
    resourceOwnershipUnambiguous: false,
    unresolvedReviewThreads: 1,
  }));
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('standing-authority-source-identity-not-current'));
  assert.ok(result.blockers.includes('standing-authority-resource-owner-ambiguous'));
  assert.ok(result.blockers.includes('standing-authority-unresolved-review-threads'));
});

test('missing exact deterministic quorum evidence fails closed', () => {
  const result = evaluateStandingBuilderContinuityFallbackV1(eligibleInput({
    quorumProofs: ['exact-head-hosted-checks'],
  }));
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('standing-authority-quorum-missing:')));
});

test('new authority surfaces are never eligible under continuity standing authority', () => {
  const result = evaluateStandingBuilderContinuityFallbackV1(eligibleInput({ newAuthoritySurfaceIntroduced: true }));
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('standing-authority-new-authority-surface-forbidden'));
});
