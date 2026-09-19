import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveElasticIndependentReviewWidth,
  planElasticIndependentReviewAssignments,
} from './elasticIndependentReviewCapacityV1.mjs';

const BASE = 'f'.repeat(40);

function request(index) {
  return {
    requestId:`five-lane-review-${index}`,
    repository:'Cheekyfellastef/stephan-os',
    prNumber:2100 + index,
    branch:`agent/five-lane-shadow-${index}`,
    sourceHead:String(index).repeat(40),
    baseSha:BASE,
    priorityClass:'PROGRAMME_CRITICAL',
    riskTier:'standard',
    queuedAtUtc:`2026-08-26T15:0${index}:00.000Z`,
    implementerProvider:`builder-${index}`,
    implementerSessionId:`builder-session-${index}`,
  };
}

function reviewer(index) {
  return {
    reviewerId:`five-lane-reviewer-${index}`,
    provider:`github-review-${index}`,
    sessionId:`review-session-${index}`,
    reviewerClass:'github-first',
    state:'available',
    availableSlots:1,
    qualifiedRiskTiers:['standard'],
    supportsIndependentReview:true,
  };
}

test('five resource-disjoint review lanes can be shadow-planned without dispatch or merge authority', () => {
  const width = deriveElasticIndependentReviewWidth({
    activeReviewCount:0,
    readyReviewCount:5,
    criticalRecoveryReadyCount:0,
    availableReviewerSlots:5,
  });

  assert.equal(width.status, 'RUNNING');
  assert.equal(width.desiredWidth, 5);
  assert.equal(width.remainingAdmissionSlots, 5);
  assert.equal(width.dispatchAuthority, false);
  assert.equal(width.mergeAuthority, false);
  assert.equal(width.runtimeMutationAuthority, false);

  const requests = Array.from({ length:5 }, (_, index) => request(index + 1));
  const reviewers = Array.from({ length:5 }, (_, index) => reviewer(index + 1));
  const plan = planElasticIndependentReviewAssignments(requests, reviewers, {
    maxAssignments:5,
    activeReviewIdentities:[],
  });

  assert.equal(plan.status, 'ASSIGNMENT_PLAN_READY');
  assert.equal(plan.assignments.length, 5);
  assert.equal(plan.held.length, 0);
  assert.equal(new Set(plan.assignments.map(({ reviewerId }) => reviewerId)).size, 5);
  assert.equal(new Set(plan.assignments.map(({ reviewIdentity }) => reviewIdentity)).size, 5);
  assert.equal(plan.dispatchAuthority, false);
  assert.equal(plan.approvalAuthority, false);
  assert.equal(plan.mergeAuthority, false);
  assert.equal(plan.deploymentAuthority, false);
  assert.equal(plan.runtimeMutationAuthority, false);
  assert.equal(plan.providerQualificationAuthority, false);
});
