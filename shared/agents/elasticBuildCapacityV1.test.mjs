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

test('capacity evidence fails closed and policy cannot shrink below five or exceed sixteen', () => {
  for (const input of [
    { activeLaneCount:0, readyIndependentWorkCount:1, availableExecutorSlots:8, minimumLanes:4 },
    { activeLaneCount:0, readyIndependentWorkCount:1, availableExecutorSlots:8, maximumLanes:MAXIMUM_BUILD_LANES + 1 },
    { activeLaneCount:-1, readyIndependentWorkCount:1, availableExecutorSlots:8 },
  ]) assert.equal(deriveElasticBuildWidth(input).status, 'SAFE_HOLD_INVALID_CAPACITY');

  const degraded = deriveElasticBuildWidth({ activeLaneCount:2, readyIndependentWorkCount:8, availableExecutorSlots:3 });
  assert.equal(degraded.status, 'DEGRADED_CAPACITY');
  assert.equal(degraded.scaleAction, 'SAFE_HOLD');
  assert.ok(degraded.reasonCodes.includes('BASELINE_CAPACITY_SHORTFALL'));
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

test('repository directory ownership conflicts with descendant files but not sibling paths', () => {
  const result = selectResourceDisjointCandidates([
    {
      candidateId:'descendant-conflict',
      resourceIds:['repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs'],
    },
    {
      candidateId:'sibling-safe',
      resourceIds:['repo:cheekyfellastef/stephan-os:path:shared/runtime/example.mjs'],
    },
  ], {
    limit:5,
    activeResourceIds:['repo:cheekyfellastef/stephan-os:path:shared/agents'],
  });
  assert.deepEqual(result.selected.map(({ candidateId }) => candidateId), ['sibling-safe']);
  assert.deepEqual(result.held[0], {
    candidateId:'descendant-conflict',
    reasonCode:'RESOURCE_CONFLICT',
    conflictingResourceIds:['repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs'],
  });
});

test('repository path resources are canonical before hierarchical conflict indexing', () => {
  const aliases = [
    'repo:cheekyfellastef/stephan-os:path:shared/x/../agents/example.mjs',
    'repo:cheekyfellastef/stephan-os:path:shared/./agents/example.mjs',
    'repo:cheekyfellastef/stephan-os:path:shared//agents/example.mjs',
    'repo:cheekyfellastef/stephan-os:path:/shared/agents/example.mjs',
    'repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs/',
    'repo:cheekyfellastef/stephan-os:path:shared/agents./example.mjs',
    'repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs.',
    'repo:cheekyfellastef/stephan-os:path:shared/agents/example.mjs:stream',
    'repo:cheekyfellastef/stephan-os:path:shared/con/readme.md',
    'repo:cheekyfellastef/stephan-os:path:shared/LPT1.txt/readme.md',
  ];
  const result = selectResourceDisjointCandidates(aliases.map((resourceId, index) => ({
    candidateId:`alias-${index}`,
    resourceIds:[resourceId],
  })), {
    limit:5,
    activeResourceIds:['repo:cheekyfellastef/stephan-os:path:shared/agents'],
  });
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.held.map(({ reasonCode }) => reasonCode), aliases.map(() => 'RESOURCE_SCOPE_REQUIRED'));

  const invalidActive = selectResourceDisjointCandidates([
    { candidateId:'otherwise-safe', resourceIds:['goal:42'] },
  ], {
    limit:5,
    activeResourceIds:['repo:cheekyfellastef/stephan-os:path:shared/./agents'],
  });
  assert.deepEqual(invalidActive.reasonCodes, ['INVALID_PARALLEL_SELECTION_POLICY']);

  const duplicateScope = selectResourceDisjointCandidates([
    { candidateId:'duplicate-scope', resourceIds:['goal:42', 'GOAL:42'] },
  ], { limit:5, activeResourceIds:[] });
  assert.equal(duplicateScope.held[0].reasonCode, 'RESOURCE_SCOPE_REQUIRED');
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
