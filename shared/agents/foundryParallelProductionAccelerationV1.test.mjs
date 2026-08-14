import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOUNDRY_ACCELERATION_DECISIONS,
  FOUNDRY_ACCELERATION_SCHEMA,
  FOUNDRY_CAPACITY_SCHEMA,
  FOUNDRY_M3_LIVE_SCHEMA,
  PROVIDER_CAPACITY_SCHEMA,
  planFoundryParallelProductionAcceleration,
} from './foundryParallelProductionAccelerationV1.mjs';

const MAIN = 'a'.repeat(40);
const NOW = '2026-08-14T15:00:00Z';

function capacity(providerId, overrides = {}) {
  return {
    schemaVersion: providerId === 'foundry' ? FOUNDRY_CAPACITY_SCHEMA : PROVIDER_CAPACITY_SCHEMA,
    providerId,
    exactMainHead: MAIN,
    observedAtUtc: '2026-08-14T14:59:00Z',
    availableSlots: 2,
    queueDepth: 0,
    receiptRef: `receipts/capacity/${providerId}-latest.json`,
    ...overrides,
  };
}

function provider(providerId, overrides = {}) {
  const availableSlots = overrides.availableSlots ?? 2;
  const queueDepth = overrides.queueDepth ?? 0;
  return {
    providerId,
    state: 'READY',
    capabilities: ['source-test', 'linux-proof'],
    availableSlots,
    queueDepth,
    medianStartDelaySeconds: providerId === 'github' ? 180 : 10,
    medianExecutionSeconds: providerId === 'github' ? 600 : 240,
    reviewIntegrationSeconds: providerId === 'github' ? 120 : 60,
    successRate: 0.95,
    reworkRate: 0.05,
    capacityReceipt: capacity(providerId, { availableSlots, queueDepth }),
    ...(providerId === 'foundry' ? {
      m3RuntimeReceipt: {
        schemaVersion: FOUNDRY_M3_LIVE_SCHEMA,
        exactMainHead: MAIN,
        observedAtUtc: '2026-08-14T14:59:00Z',
        canCarryRealWork: true,
        teardownVerdict: 'ZERO_RESIDUAL_AUTHORITY',
        receiptRef: 'receipts/forge/m3-live-capacity.json',
      },
    } : {}),
    ...overrides,
  };
}

function candidate(candidateId, overrides = {}) {
  return {
    candidateId,
    goalId: `goal-${candidateId}`,
    baseHead: MAIN,
    resourceIds: [`goal:${candidateId}`],
    requiredCapabilities: ['source-test'],
    criticalPathWeight: 500,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: MAIN,
    nowUtc: NOW,
    capacityFreshnessSeconds: 300,
    minimumNetSavingsSeconds: 60,
    providers: [provider('github'), provider('foundry')],
    candidates: [candidate('candidate-1')],
    activeResourceIds: [],
    ...overrides,
  };
}

test('routes eligible work to proven M3 Foundry only when net acceleration is positive', () => {
  const result = planFoundryParallelProductionAcceleration(input());

  assert.equal(result.schemaVersion, FOUNDRY_ACCELERATION_SCHEMA);
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.READY);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].providerId, 'foundry');
  assert.ok(result.assignments[0].predictedNetSecondsSaved >= 60);
  assert.equal(result.assignments[0].runtimeReceiptRef, 'receipts/forge/m3-live-capacity.json');
  assert.equal(result.foundryTelemetry.status, 'READY');
  assert.equal(result.foundryTelemetry.activePackets, 1);
});

test('source-ready or historical M3 evidence is never treated as routable capacity', () => {
  const foundry = provider('foundry');
  foundry.m3RuntimeReceipt = {
    ...foundry.m3RuntimeReceipt,
    canCarryRealWork: false,
    teardownVerdict: 'CONSTRUCTION_PROOF_ONLY',
  };
  const result = planFoundryParallelProductionAcceleration(input({ providers: [provider('github'), foundry] }));

  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_M3);
  assert.equal(result.assignments.length, 0);
  const status = result.providerStatus.find(({ providerId }) => providerId === 'foundry');
  assert.ok(status.blockers.includes('foundry-m3-not-routable'));
  assert.ok(status.blockers.includes('foundry-m3-teardown-unproven'));
  assert.equal(result.foundryTelemetry.operatorRequired, true);
});

test('stale or wrong-head Foundry capacity fails closed for routing while GitHub remains the baseline', () => {
  const foundry = provider('foundry');
  foundry.capacityReceipt = capacity('foundry', {
    exactMainHead: 'b'.repeat(40),
    observedAtUtc: '2026-08-14T14:00:00Z',
  });
  const result = planFoundryParallelProductionAcceleration(input({ providers: [provider('github'), foundry] }));

  assert.equal(result.assignments.length, 0);
  const status = result.providerStatus.find(({ providerId }) => providerId === 'foundry');
  assert.ok(status.blockers.includes('provider-capacity-head-mismatch'));
  assert.ok(status.blockers.includes('provider-capacity-stale'));
});

test('resource-disjoint candidates can use Foundry and another provider in the same plan', () => {
  const openclaw = provider('openclaw', {
    capabilities: ['windows-proof'],
    medianStartDelaySeconds: 5,
    medianExecutionSeconds: 180,
    reviewIntegrationSeconds: 50,
  });
  const result = planFoundryParallelProductionAcceleration(input({
    providers: [provider('github', { capabilities: ['source-test', 'windows-proof'] }), provider('foundry'), openclaw],
    candidates: [
      candidate('source', { criticalPathWeight: 900 }),
      candidate('windows', { requiredCapabilities: ['windows-proof'], criticalPathWeight: 800 }),
    ],
  }));

  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.READY);
  assert.deepEqual(result.assignments.map(({ providerId }) => providerId).sort(), ['foundry', 'openclaw']);
  assert.equal(result.assignments.length, 2);
});

test('active and newly selected resource leases prevent overlapping parallel work', () => {
  const result = planFoundryParallelProductionAcceleration(input({
    activeResourceIds: ['repo:shared/agents/owned.mjs'],
    candidates: [
      candidate('active-conflict', { resourceIds: ['repo:shared/agents/owned.mjs'], criticalPathWeight: 900 }),
      candidate('winner', { resourceIds: ['repo:shared/agents/new.mjs'], criticalPathWeight: 800 }),
      candidate('later-conflict', { resourceIds: ['repo:shared/agents/new.mjs'], criticalPathWeight: 700 }),
    ],
  }));

  assert.deepEqual(result.assignments.map(({ candidateId }) => candidateId), ['winner']);
  assert.equal(result.heldCandidates.find(({ candidateId }) => candidateId === 'active-conflict').reason, 'RESOURCE_CONFLICT');
  assert.equal(result.heldCandidates.find(({ candidateId }) => candidateId === 'later-conflict').reason, 'RESOURCE_CONFLICT');
});

test('Foundry is not selected merely to keep runners busy when it saves too little time', () => {
  const slowFoundry = provider('foundry', {
    medianStartDelaySeconds: 170,
    medianExecutionSeconds: 590,
    reviewIntegrationSeconds: 120,
  });
  const result = planFoundryParallelProductionAcceleration(input({
    minimumNetSavingsSeconds: 120,
    providers: [provider('github'), slowFoundry],
  }));

  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.NO_POSITIVE_GAIN);
  assert.equal(result.assignments.length, 0);
  assert.equal(result.heldCandidates[0].reason, 'NO_POSITIVE_NET_ACCELERATION_USE_GITHUB');
});

test('critical-path ordering and provider selection are stable regardless of input order', () => {
  const high = candidate('high', { criticalPathWeight: 900, resourceIds: ['shared:one'] });
  const low = candidate('low', { criticalPathWeight: 100, resourceIds: ['shared:two'] });
  const foundry = provider('foundry', { availableSlots: 1 });
  const left = planFoundryParallelProductionAcceleration(input({ providers: [provider('github'), foundry], candidates: [low, high] }));
  const right = planFoundryParallelProductionAcceleration(input({ providers: [foundry, provider('github')], candidates: [high, low] }));

  assert.deepEqual(left.assignments.map(({ candidateId }) => candidateId), ['high']);
  assert.deepEqual(right.assignments.map(({ candidateId }) => candidateId), ['high']);
  assert.equal(left.heldCandidates.find(({ candidateId }) => candidateId === 'low').reason, 'NO_POSITIVE_NET_ACCELERATION_USE_GITHUB');
});

test('duplicate candidates and stale candidate bases block the complete recommendation inventory', () => {
  const duplicate = candidate('duplicate');
  const duplicated = planFoundryParallelProductionAcceleration(input({ candidates: [duplicate, duplicate] }));
  assert.equal(duplicated.valid, false);
  assert.ok(duplicated.blockers.includes('candidate-id-duplicate'));

  const stale = planFoundryParallelProductionAcceleration(input({
    candidates: [candidate('stale', { baseHead: 'b'.repeat(40) })],
  }));
  assert.equal(stale.valid, false);
  assert.ok(stale.blockers.includes('candidate-base-head-stale-or-invalid:stale'));
});

test('malformed, sparse and hostile observations fail closed without throwing', () => {
  const sparseProviders = new Array(1);
  assert.equal(planFoundryParallelProductionAcceleration(input({ providers: sparseProviders })).valid, false);

  const hostile = new Proxy({}, { get() { throw new Error('hostile getter'); } });
  const hostileResult = planFoundryParallelProductionAcceleration(hostile);
  assert.equal(hostileResult.valid, false);
  assert.ok(hostileResult.blockers.includes('hostile-input-observation-failed'));
});

test('planner never grants dispatch, mutation, merge, runtime or credential authority', () => {
  const result = planFoundryParallelProductionAcceleration(input());
  assert.deepEqual(result.authority, {
    dispatch: false,
    sourceMutation: false,
    branchMutation: false,
    publication: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    credentialAccess: false,
    arbitraryCommand: false,
    recommendationOnly: true,
  });
  assert.equal(result.assignments[0].dispatchAuthority, false);
});

test('empty candidate inventory is a truthful idle state with telemetry intact', () => {
  const result = planFoundryParallelProductionAcceleration(input({ candidates: [] }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.IDLE);
  assert.equal(result.foundryTelemetry.status, 'READY');
  assert.equal(result.totalCriticalPathSecondsSaved, 0);
});
