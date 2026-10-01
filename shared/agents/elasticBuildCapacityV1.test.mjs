import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAXIMUM_BUILD_LANES,
  MINIMUM_BUILD_LANES,
  deriveElasticBuildWidth,
  selectResourceDisjointCandidates,
} from './elasticBuildCapacityV1.mjs';

test('healthy fabric preserves five baseline lanes and widens to independent demand', () => {
  const baseline = deriveElasticBuildWidth({ activeLaneCount:0, readyIndependentWorkCount:2, availableExecutorSlots:8 });
  assert.equal(baseline.status, 'RUNNING');
  assert.equal(baseline.desiredWidth, MINIMUM_BUILD_LANES);
  assert.equal(baseline.remainingAdmissionSlots, MINIMUM_BUILD_LANES);

  const widened = deriveElasticBuildWidth({ activeLaneCount:4, readyIndependentWorkCount:5, availableExecutorSlots:12 });
  assert.equal(widened.desiredWidth, 9);
  assert.equal(widened.remainingAdmissionSlots, 5);
  assert.equal(widened.scaleAction, 'SCALE_OUT');
});

test('capacity evidence fails closed below the five-lane baseline without imposing a fixed scale-out ceiling', () => {
  for (const input of [
    { activeLaneCount:0, readyIndependentWorkCount:1, availableExecutorSlots:8, minimumLanes:4 },
    { activeLaneCount:-1, readyIndependentWorkCount:1, availableExecutorSlots:8 },
  ]) assert.equal(deriveElasticBuildWidth(input).status, 'SAFE_HOLD_INVALID_CAPACITY');

  const widened = deriveElasticBuildWidth({
    activeLaneCount:16,
    readyIndependentWorkCount:24,
    availableExecutorSlots:64,
  });
  assert.equal(widened.status, 'RUNNING');
  assert.equal(widened.desiredWidth, 40);
  assert.equal(widened.remainingAdmissionSlots, 24);
  assert.equal(widened.scaleAction, 'SCALE_OUT');
  assert.equal(widened.reasonCodes.includes('POLICY_MAXIMUM_REACHED'), false);

  const policyBounded = deriveElasticBuildWidth({
    activeLaneCount:16,
    readyIndependentWorkCount:24,
    availableExecutorSlots:64,
    maximumLanes:32,
  });
  assert.equal(policyBounded.desiredWidth, 32);
  assert.ok(policyBounded.reasonCodes.includes('POLICY_MAXIMUM_REACHED'));

  const degraded = deriveElasticBuildWidth({ activeLaneCount:2, readyIndependentWorkCount:8, availableExecutorSlots:3 });
  assert.equal(degraded.status, 'DEGRADED_CAPACITY');
  assert.equal(degraded.scaleAction, 'SAFE_HOLD');
  assert.ok(degraded.reasonCodes.includes('BASELINE_CAPACITY_SHORTFALL'));
});

test('resource selection admits more than sixteen proven disjoint candidates when capacity exists', () => {
  const candidates = Array.from({ length:24 }, (_, index) => ({
    candidateId:`goal-wide-${index + 1}`,
    resourceIds:[`repo:cheekyfellastef/stephan-os:path:generated/lane-${index + 1}.mjs`],
  }));
  const result = selectResourceDisjointCandidates(candidates, { limit:24, activeResourceIds:[] });
  assert.equal(result.selected.length, 24);
  assert.deepEqual(result.held, []);
});

test('resource selection admits five isolated candidates and holds only conflicts or overflow', () => {
  const candidates = Array.from({ length:7 }, (_, index) => ({
    candidateId:`goal-${index + 1}`,
    resourceIds:[`goal:${index + 1}`],
  }));
  candidates[5] = { candidateId:'goal-6', resourceIds:['goal:1'] };
  const result = selectResourceDisjointCandidates(candidates, { limit:5, activeResourceIds:[] });
  assert.deepEqual(result.selected.map(({ candidateId }) => candidateId), ['goal-1','goal-2','goal-3','goal-4','goal-5']);
  assert.equal(result.held.find(({ candidateId }) => candidateId === 'goal-6').reasonCode, 'RESOURCE_CONFLICT');
  assert.equal(result.held.find(({ candidateId }) => candidateId === 'goal-7').reasonCode, 'PARALLEL_CAPACITY_FULL');
});

test('missing, malformed, sparse or active-conflicting resource scope is never admitted', () => {
  const result = selectResourceDisjointCandidates([
    { candidateId:'missing' },
    { candidateId:'malformed', resourceIds:['../unsafe'] },
    { candidateId:'conflict', resourceIds:['repo:main'] },
    { candidateId:'safe', resourceIds:['goal:42'] },
  ], { limit:5, activeResourceIds:['repo:main'] });
  assert.deepEqual(result.selected.map(({ candidateId }) => candidateId), ['safe']);
  assert.equal(result.held.find(({ candidateId }) => candidateId === 'conflict').reasonCode, 'RESOURCE_CONFLICT');

  const sparse = selectResourceDisjointCandidates(new Array(1), { limit:5, activeResourceIds:[] });
  assert.deepEqual(sparse.reasonCodes, ['INVALID_CANDIDATE_INVENTORY']);
});

test('resource selection fails closed for duplicate candidate identities', () => {
  const result = selectResourceDisjointCandidates([
    { candidateId:'duplicate', resourceIds:['goal:1'] },
    { candidateId:'duplicate', resourceIds:['goal:2'] },
    { candidateId:'otherwise-safe', resourceIds:['goal:3'] },
  ], { limit:5, activeResourceIds:[] });
  assert.deepEqual(result.selected,[]);
  assert.deepEqual(result.held.map(({ reasonCode }) => reasonCode), [
    'DUPLICATE_CANDIDATE_ID',
    'DUPLICATE_CANDIDATE_ID',
    'INVALID_CANDIDATE_INVENTORY',
  ]);
  assert.ok(result.reasonCodes.includes('DUPLICATE_CANDIDATE_ID'));
});
