import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectOperatorIntentStandingAuthorityV1,
  evaluateDirectOperatorIntentStandingAuthorityV1,
} from './directOperatorIntentStandingAuthorityV1.mjs';

function receipt(overrides = {}) {
  return buildDirectOperatorIntentStandingAuthorityV1({
    requestId: 'chat-2026-09-28-001',
    goalId: 'spatial-workspace-v1',
    originSurface: 'chatgpt',
    intent: 'Build the requested change, prove it, merge it through the protected path and make it live without repeated ceremonial approval.',
    ...overrides,
  });
}

test('direct bounded operator request carries standing continuation through protected merge and guarded live update', () => {
  const result = evaluateDirectOperatorIntentStandingAuthorityV1(receipt());
  assert.equal(result.valid, true);
  assert.equal(result.requiresNewOperatorApproval, false);
  assert.equal(result.protectedMergeEnvironmentApprovalEligible, true);
  assert.equal(result.protectedExactHeadMergeEligible, true);
  assert.equal(result.guardedLiveUpdateEligible, true);
  assert.ok(result.allows.includes('review-fix'));
  assert.ok(result.allows.includes('protected-exact-head-squash-merge'));
  assert.ok(result.excludes.includes('ruleset-or-safety-bypass'));
  assert.equal(result.mergeAuthority, false);
});

test('standing intent fails closed when scope widens into new sensitive authority', () => {
  const result = evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ requiresNewSensitiveAuthority: true }));
  assert.equal(result.valid, false);
  assert.equal(result.requiresNewOperatorApproval, true);
  assert.ok(result.blockers.includes('new-sensitive-authority-required'));
});

test('standing intent fails closed when revoked or not direct', () => {
  for (const candidate of [receipt({ revoked: true }), receipt({ directOperatorRequest: false })]) {
    const result = evaluateDirectOperatorIntentStandingAuthorityV1(candidate);
    assert.equal(result.valid, false);
    assert.equal(result.continuationAllowed, false);
  }
});

test('standing intent accepts the user-facing chat and spatial origin surfaces only', () => {
  assert.equal(evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ originSurface: 'stephanos-chat' })).valid, true);
  assert.equal(evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ originSurface: 'spatial-workspace' })).valid, true);
  assert.equal(evaluateDirectOperatorIntentStandingAuthorityV1(receipt({ originSurface: 'unknown-provider' })).valid, false);
});
