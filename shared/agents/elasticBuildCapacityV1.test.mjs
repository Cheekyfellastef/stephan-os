import test from 'node:test';
import assert from 'node:assert/strict';
// Goal #3006: exercise the surge-capacity contract in existing hosted scheduler tests.
import './surgeBuilderQualificationV1.test.mjs';
import {
  MAXIMUM_BUILD_LANES,
  MINIMUM_BUILD_LANES,
  deriveElasticBuildWidth,
  projectCanonicalResourceIds,
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

// Goal #2002: supplied policy limits are authority-bearing bounds, not hints.
// Before this correction malformed maximumLanes silently selected MAX_SAFE_INTEGER.
test('malformed supplied elastic policy limits fail closed rather than silently widening capacity', () => {
  const base = { activeLaneCount:2, readyIndependentWorkCount:10, availableExecutorSlots:20 };
  for (const supplied of [
    { maximumLanes:-1 }, { maximumLanes:null }, { maximumLanes:'8' },
    { maximumLanes:2 ** 53 }, { minimumLanes:null }, { minimumLanes:'5' },
  ]) {
    const held = deriveElasticBuildWidth({ ...base, ...supplied });
    assert.equal(held.status, 'SAFE_HOLD_INVALID_CAPACITY', JSON.stringify(supplied));
    assert.equal(held.scaleAction, 'SAFE_HOLD');
    assert.equal(held.desiredWidth, 0);
    assert.equal(held.remainingAdmissionSlots, 0);
    assert.ok(held.reasonCodes.includes('INVALID_CAPACITY_EVIDENCE'));
  }
  const valid = deriveElasticBuildWidth({ ...base, maximumLanes:8 });
  assert.equal(valid.status, 'RUNNING');
  assert.equal(valid.desiredWidth, 8);
  assert.equal(valid.remainingAdmissionSlots, 6);
  assert.equal(deriveElasticBuildWidth(base).desiredWidth, 12);
});

test('combined elastic demand exceeding safe integer precision cannot certify a lane width', () => {
  const held = deriveElasticBuildWidth({
    activeLaneCount:Number.MAX_SAFE_INTEGER,
    readyIndependentWorkCount:1,
    availableExecutorSlots:Number.MAX_SAFE_INTEGER,
  });
  assert.equal(held.status, 'SAFE_HOLD_INVALID_CAPACITY');
  assert.equal(held.scaleAction, 'SAFE_HOLD');
  assert.equal(held.desiredWidth, 0);
  assert.ok(held.reasonCodes.includes('INVALID_CAPACITY_EVIDENCE'));
  const exact = deriveElasticBuildWidth({
    activeLaneCount:Number.MAX_SAFE_INTEGER - 1,
    readyIndependentWorkCount:1,
    availableExecutorSlots:Number.MAX_SAFE_INTEGER,
  });
  assert.equal(exact.status, 'RUNNING');
  assert.equal(exact.desiredWidth, Number.MAX_SAFE_INTEGER);
  assert.equal(exact.remainingAdmissionSlots, 1);
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

test('repository-wide scope conflicts with every path inside that repository', () => {
  const rootFirst = selectResourceDisjointCandidates([
    { candidateId:'repo-wide', resourceIds:['repo:cheekyfellastef/stephan-os'] },
    { candidateId:'path-lane', resourceIds:['repo:cheekyfellastef/stephan-os:path:shared/agents/programmeAuthorityV1.mjs'] },
  ], { limit:5, activeResourceIds:[] });
  assert.deepEqual(rootFirst.selected.map(({ candidateId }) => candidateId), ['repo-wide']);
  assert.equal(rootFirst.held[0].reasonCode, 'RESOURCE_CONFLICT');

  const pathAlreadyActive = selectResourceDisjointCandidates([
    { candidateId:'repo-wide', resourceIds:['repo:cheekyfellastef/stephan-os'] },
  ], {
    limit:5,
    activeResourceIds:['repo:cheekyfellastef/stephan-os:path:shared/runtime/missionScheduler.mjs'],
  });
  assert.deepEqual(pathAlreadyActive.selected, []);
  assert.equal(pathAlreadyActive.held[0].reasonCode, 'RESOURCE_CONFLICT');
});

test('reserved repository namespace refuses malformed roots and pseudo-paths before concurrent admission', () => {
  const root = 'repo:cheekyfellastef/stephan-os';
  const path = 'repo:cheekyfellastef/stephan-os:path:shared/agents/goalBuildingAgentV1.mjs';
  assert.equal(projectCanonicalResourceIds([root]).finalVerdict, 'RESOURCE_IDS_CANONICAL');
  assert.equal(projectCanonicalResourceIds([path]).finalVerdict, 'RESOURCE_IDS_CANONICAL');
  assert.deepEqual(projectCanonicalResourceIds(['goal:42']).resourceIds, ['goal:42']);
  for (const malformed of [
    'repo:main',
    'repo:cheekyfellastef/stephan-os/path:shared/agents/goalBuildingAgentV1.mjs',
    'repo:cheekyfellastef/stephan-os/third',
    'repo:cheekyfellastef/stephan-os:file:shared/agents/x.mjs',
    'repo:cheekyfellastef/stephan-os/third:path:shared/x.mjs',
  ]) {
    const projected = projectCanonicalResourceIds([malformed]);
    assert.equal(projected.valid, false, malformed);
    assert.equal(projected.finalVerdict, 'RESOURCE_IDS_INVALID', malformed);
    const selected = selectResourceDisjointCandidates([
      { candidateId:'repository-owner', resourceIds:[root] },
      { candidateId:'malformed-candidate', resourceIds:[malformed] },
    ], { limit:5, activeResourceIds:[] });
    assert.deepEqual(selected.selected.map(({ candidateId }) => candidateId), ['repository-owner'], malformed);
    assert.equal(selected.held[0].reasonCode, 'RESOURCE_SCOPE_REQUIRED', malformed);
  }
  const overlapping = selectResourceDisjointCandidates([
    { candidateId:'repository-owner', resourceIds:[root] },
    { candidateId:'path-owner', resourceIds:[path] },
  ], { limit:5, activeResourceIds:[] });
  assert.deepEqual(overlapping.selected.map(({ candidateId }) => candidateId), ['repository-owner']);
  assert.equal(overlapping.held[0].reasonCode, 'RESOURCE_CONFLICT');
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
    { candidateId:'conflict', resourceIds:['goal:main'] },
    { candidateId:'safe', resourceIds:['goal:42'] },
  ], { limit:5, activeResourceIds:['goal:main'] });
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
