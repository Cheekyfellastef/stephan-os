import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAXIMUM_REVIEW_SLOTS,
  MINIMUM_REVIEW_SLOTS,
  deriveElasticIndependentReviewWidth,
  planElasticIndependentReviewAssignments,
} from './elasticIndependentReviewCapacityV1.mjs';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const HEAD_C = 'c'.repeat(40);
const BASE = 'd'.repeat(40);
const OTHER_BASE = 'e'.repeat(40);

function request(overrides = {}) {
  return {
    requestId:'review-pr-100',
    repository:'Cheekyfellastef/stephan-os',
    prNumber:100,
    branch:'agent/example-v1',
    sourceHead:HEAD_A,
    baseSha:BASE,
    priorityClass:'STANDARD',
    riskTier:'standard',
    queuedAtUtc:'2026-08-22T10:00:00.000Z',
    implementerProvider:'builder-provider',
    implementerSessionId:'builder-session',
    ...overrides,
  };
}

function reviewer(overrides = {}) {
  return {
    reviewerId:'reviewer-general-1',
    provider:'github-review',
    sessionId:'review-session-1',
    reviewerClass:'github-first',
    state:'available',
    availableSlots:1,
    qualifiedRiskTiers:['low','standard'],
    supportsIndependentReview:true,
    ...overrides,
  };
}

test('review width preserves a bounded baseline and scales to independent demand', () => {
  const baseline = deriveElasticIndependentReviewWidth({
    activeReviewCount:0,
    readyReviewCount:1,
    criticalRecoveryReadyCount:0,
    availableReviewerSlots:6,
  });
  assert.equal(baseline.status, 'RUNNING');
  assert.equal(baseline.desiredWidth, MINIMUM_REVIEW_SLOTS);

  const widened = deriveElasticIndependentReviewWidth({
    activeReviewCount:2,
    readyReviewCount:4,
    criticalRecoveryReadyCount:2,
    availableReviewerSlots:8,
  });
  assert.equal(widened.desiredWidth, 6);
  assert.equal(widened.remainingAdmissionSlots, 4);
  assert.equal(widened.scaleAction, 'SCALE_OUT');
  assert.equal(widened.mergeAuthority, false);
});

test('capacity evidence fails closed below policy baseline or above maximum', () => {
  assert.equal(deriveElasticIndependentReviewWidth({
    activeReviewCount:0,
    readyReviewCount:1,
    criticalRecoveryReadyCount:0,
    availableReviewerSlots:3,
    minimumSlots:MINIMUM_REVIEW_SLOTS - 1,
  }).status, 'SAFE_HOLD_INVALID_CAPACITY');

  assert.equal(deriveElasticIndependentReviewWidth({
    activeReviewCount:0,
    readyReviewCount:1,
    criticalRecoveryReadyCount:0,
    availableReviewerSlots:20,
    maximumSlots:MAXIMUM_REVIEW_SLOTS + 1,
  }).status, 'SAFE_HOLD_INVALID_CAPACITY');
});

test('explicit malformed capacity bounds fail closed instead of silently defaulting', () => {
  for (const invalidBounds of [
    { minimumSlots:-1 },
    { maximumSlots:-1 },
    { minimumSlots:null },
    { maximumSlots:null },
  ]) {
    const result = deriveElasticIndependentReviewWidth({
      activeReviewCount:0,
      readyReviewCount:1,
      criticalRecoveryReadyCount:0,
      availableReviewerSlots:3,
      ...invalidBounds,
    });
    assert.equal(result.status, 'SAFE_HOLD_INVALID_CAPACITY');
    assert.equal(result.scaleAction, 'SAFE_HOLD');
  }
});

test('critical recovery review is assigned before ordinary programme work', () => {
  const result = planElasticIndependentReviewAssignments([
    request({ requestId:'standard', prNumber:101, sourceHead:HEAD_A, priorityClass:'STANDARD' }),
    request({
      requestId:'ignition-recovery',
      prNumber:1946,
      sourceHead:HEAD_B,
      branch:'fix/battle-bridge-recovery-proof-compatibility-v1',
      priorityClass:'CRITICAL_RECOVERY',
      riskTier:'high',
      queuedAtUtc:'2026-08-22T10:01:00.000Z',
    }),
  ], [
    reviewer(),
    reviewer({
      reviewerId:'windows-specialist',
      provider:'external-review',
      sessionId:'specialist-session',
      reviewerClass:'external-qualified',
      qualifiedRiskTiers:['standard','high'],
    }),
  ], { maxAssignments:2, activeReviewIdentities:[] });

  assert.deepEqual(result.assignments.map(({ requestId }) => requestId), ['ignition-recovery','standard']);
  assert.equal(result.assignments[0].reviewerId, 'windows-specialist');
  assert.equal(result.criticalRecoveryAssignments, 1);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('same provider and session as implementer cannot satisfy independent review', () => {
  const result = planElasticIndependentReviewAssignments([
    request(),
  ], [
    reviewer({
      reviewerId:'not-independent',
      provider:'builder-provider',
      sessionId:'builder-session',
      availableSlots:3,
    }),
    reviewer({ reviewerId:'independent', provider:'other-provider', sessionId:'other-session' }),
  ], { maxAssignments:1, activeReviewIdentities:[] });

  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].reviewerId, 'independent');
});

test('an already-active exact-head review is not dispatched again', () => {
  const activeIdentity = `Cheekyfellastef/stephan-os#100@${HEAD_A}`.toLowerCase();
  const result = planElasticIndependentReviewAssignments([
    request(),
  ], [reviewer()], {
    maxAssignments:1,
    activeReviewIdentities:[activeIdentity],
  });

  assert.equal(result.assignments.length, 0);
  assert.equal(result.held[0].reasonCode, 'EXACT_HEAD_REVIEW_ALREADY_ACTIVE');
});

test('high-risk work remains held when no specialist-qualified reviewer is available', () => {
  const result = planElasticIndependentReviewAssignments([
    request({ requestId:'high-risk', riskTier:'high', priorityClass:'CRITICAL_RECOVERY' }),
  ], [
    reviewer({ qualifiedRiskTiers:['low','standard','high'] }),
  ], { maxAssignments:1, activeReviewIdentities:[] });

  assert.equal(result.assignments.length, 0);
  assert.equal(result.held[0].reasonCode, 'NO_QUALIFIED_RISK_REVIEWER_AVAILABLE');
});

test('bounded reviewer slots widen across disjoint exact-head requests and hold overflow', () => {
  const result = planElasticIndependentReviewAssignments([
    request({ requestId:'r1', prNumber:101, sourceHead:HEAD_A }),
    request({ requestId:'r2', prNumber:102, sourceHead:HEAD_B, branch:'agent/example-v2' }),
    request({ requestId:'r3', prNumber:103, sourceHead:HEAD_C, branch:'agent/example-v3' }),
  ], [
    reviewer({ availableSlots:2 }),
    reviewer({ reviewerId:'reviewer-general-2', provider:'github-review-2', sessionId:'review-session-2' }),
  ], { maxAssignments:2, activeReviewIdentities:[] });

  assert.equal(result.assignments.length, 2);
  assert.equal(result.held.length, 1);
  assert.equal(result.held[0].reasonCode, 'PARALLEL_REVIEW_CAPACITY_FULL');
});

test('duplicate request IDs fail closed instead of double-spending review capacity', () => {
  const result = planElasticIndependentReviewAssignments([
    request({ requestId:'duplicate', prNumber:101 }),
    request({ requestId:'duplicate', prNumber:102, sourceHead:HEAD_B, branch:'agent/example-v2' }),
  ], [reviewer()], { maxAssignments:2, activeReviewIdentities:[] });

  assert.equal(result.status, 'SAFE_HOLD_DUPLICATE_REQUEST');
  assert.equal(result.assignments.length, 0);
  assert.deepEqual(result.held.map(({ reasonCode }) => reasonCode), ['DUPLICATE_REQUEST_ID','DUPLICATE_REQUEST_ID']);
});

test('same exact head with different request IDs is selected once and later duplicates are held', () => {
  const result = planElasticIndependentReviewAssignments([
    request({
      requestId:'ordinary-copy',
      priorityClass:'STANDARD',
      queuedAtUtc:'2026-08-22T09:59:00.000Z',
    }),
    request({
      requestId:'critical-copy',
      priorityClass:'CRITICAL_RECOVERY',
      queuedAtUtc:'2026-08-22T10:01:00.000Z',
    }),
  ], [reviewer({ availableSlots:2 })], { maxAssignments:2, activeReviewIdentities:[] });

  assert.deepEqual(result.assignments.map(({ requestId }) => requestId), ['critical-copy']);
  assert.deepEqual(result.held, [{
    requestId:'ordinary-copy',
    reasonCode:'DUPLICATE_EXACT_HEAD_REVIEW_REQUEST',
  }]);
  assert.equal(result.assignments[0].reviewIdentity, `cheekyfellastef/stephan-os#100@${HEAD_A}`);
});

test('conflicting bindings for one exact head fail closed for branch, base or risk drift', () => {
  const conflicts = [
    { branch:'agent/conflicting-branch' },
    { baseSha:OTHER_BASE },
    { riskTier:'high' },
  ];

  for (const conflict of conflicts) {
    const result = planElasticIndependentReviewAssignments([
      request({ requestId:'canonical-copy' }),
      request({ requestId:'conflicting-copy', ...conflict }),
    ], [
      reviewer({ availableSlots:2, qualifiedRiskTiers:['low','standard','high'] }),
      reviewer({
        reviewerId:'specialist',
        provider:'external-review',
        sessionId:'specialist-session',
        reviewerClass:'external-qualified',
        availableSlots:2,
        qualifiedRiskTiers:['standard','high'],
      }),
    ], { maxAssignments:2, activeReviewIdentities:[] });

    assert.equal(result.status, 'SAFE_HOLD_CONFLICTING_EXACT_HEAD_REQUEST');
    assert.equal(result.assignments.length, 0);
    assert.deepEqual(result.held.map(({ reasonCode }) => reasonCode), [
      'CONFLICTING_EXACT_HEAD_REVIEW_REQUEST',
      'CONFLICTING_EXACT_HEAD_REVIEW_REQUEST',
    ]);
  }
});
