import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
  buildDirectOperatorIntentStandingAuthorityV1,
  evaluateDirectOperatorIntentStandingAuthorityV1,
} from './directOperatorIntentStandingAuthorityV1.mjs';

function receipt(overrides = {}) {
  return buildDirectOperatorIntentStandingAuthorityV1({
    requestId: 'chat-2026-09-28-001',
    goalId: 'goal-1506',
    originSurface: 'chatgpt',
    intent: 'Build the requested change, prove it, merge it through the protected path and make it live without repeated ceremonial approval.',
    ...overrides,
  });
}

function provenance(overrides = {}) {
  return {
    schemaVersion: DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
    authenticated: true,
    source: 'chatgpt-owner-authenticated-relay',
    repository: 'Cheekyfellastef/stephan-os',
    operator: 'Cheekyfellastef',
    requestId: 'chat-2026-09-28-001',
    goalId: 'goal-1506',
    evidenceRef: 'github-comment:4995844144',
    ...overrides,
  };
}

test('workspace receipt alone carries bounded intent but never protected authority', () => {
  const result = evaluateDirectOperatorIntentStandingAuthorityV1(receipt());
  assert.equal(result.valid, true);
  assert.equal(result.requiresNewOperatorApproval, false);
  assert.equal(result.requiresProtectedOperatorAuthentication, true);
  assert.equal(result.protectedMergeEnvironmentApprovalEligible, false);
  assert.equal(result.protectedExactHeadMergeEligible, false);
  assert.equal(result.guardedLiveUpdateEligible, false);
  assert.ok(result.allows.includes('review-fix'));
  assert.equal(result.allows.includes('protected-exact-head-squash-merge'), false);
  assert.ok(result.excludes.includes('ruleset-or-safety-bypass'));
  assert.equal(result.mergeAuthority, false);
});

test('trusted authenticated provenance unlocks only the protected continuation flags', () => {
  const result = evaluateDirectOperatorIntentStandingAuthorityV1(receipt(), {
    authenticatedProvenance: provenance(),
  });
  assert.equal(result.valid, true);
  assert.equal(result.protectedContinuationAuthenticated, true);
  assert.equal(result.requiresProtectedOperatorAuthentication, false);
  assert.equal(result.protectedMergeEnvironmentApprovalEligible, true);
  assert.equal(result.protectedExactHeadMergeEligible, true);
  assert.equal(result.guardedLiveUpdateEligible, true);
  assert.ok(result.allows.includes('protected-exact-head-squash-merge'));
  assert.equal(result.mergeAuthority, false);
});

test('forged or mismatched provenance fails closed for protected continuation', () => {
  for (const authenticatedProvenance of [
    provenance({ authenticated: false }),
    provenance({ operator: 'attacker' }),
    provenance({ requestId: 'different-request' }),
    provenance({ goalId: 'goal-9999' }),
    provenance({ source: 'workspace-self-asserted' }),
  ]) {
    const result = evaluateDirectOperatorIntentStandingAuthorityV1(receipt(), { authenticatedProvenance });
    assert.equal(result.valid, true);
    assert.equal(result.protectedContinuationAuthenticated, false);
    assert.equal(result.protectedExactHeadMergeEligible, false);
    assert.equal(result.guardedLiveUpdateEligible, false);
  }
});

test('standing intent fails closed when scope widens into new sensitive authority', () => {
  const result = evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ requiresNewSensitiveAuthority: true }), {
    authenticatedProvenance: provenance(),
  });
  assert.equal(result.valid, false);
  assert.equal(result.requiresNewOperatorApproval, true);
  assert.ok(result.blockers.includes('new-sensitive-authority-required'));
  assert.equal(result.protectedExactHeadMergeEligible, false);
});

test('standing intent fails closed when revoked or not direct', () => {
  for (const candidate of [receipt({ revoked: true }), receipt({ directOperatorRequest: false })]) {
    const result = evaluateDirectOperatorIntentStandingAuthorityV1(candidate, {
      authenticatedProvenance: provenance(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.continuationAllowed, false);
    assert.equal(result.protectedExactHeadMergeEligible, false);
  }
});

test('standing intent accepts the user-facing chat and spatial origin surfaces only', () => {
  assert.equal(evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ originSurface: 'stephanos-chat' })).valid, true);
  assert.equal(evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ originSurface: 'spatial-workspace' })).valid, true);
  assert.equal(evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ originSurface: 'unknown-provider' })).valid, false);
});
