import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOVEREIGNTY_CAPABILITY_SCHEMA_VERSION,
  SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION,
  buildSovereigntyWorkspaceProjectionV1,
  createSovereigntyCapacityObservationsV1,
  validateSovereigntySystemObservationV1,
} from './sovereigntyWorkspaceProjectionV1.mjs';

const NOW = '2026-08-14T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function system(systemId, providerId, overrides = {}) {
  return {
    schemaVersion: SOVEREIGNTY_SYSTEM_OBSERVATION_SCHEMA_VERSION,
    systemId,
    providerId,
    systemClass: 'BUILD_OR_AGENT_SYSTEM',
    sourceKind: 'CANONICAL_SHARED_WORKSPACE_STATUS',
    observedAtUtc: '2026-08-14T11:55:00.000Z',
    truthState: 'CURRENT',
    capacityState: 'AVAILABLE_NOW',
    evidenceRefs: [`receipts/sovereignty/${systemId}.json`],
    metrics: {
      remainingPercent: null,
      queueDepth: 0,
      p95StartLatencySeconds: 20,
      throughputPerHour: null,
      failureRatePercent: null,
      costPerUsefulResult: null,
      criticalPathSharePercent: null,
    },
    explanation: `${systemId} has current evidence.`,
    ...overrides,
  };
}

function capability(capabilityId, primarySystemId, overrides = {}) {
  return {
    schemaVersion: SOVEREIGNTY_CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    primarySystemId,
    alternativeSystemIds: [],
    localFallbackSystemId: null,
    nativeOptionSystemId: null,
    criticality: 'HIGH',
    evidenceRefs: [`proofs/sovereignty/${capabilityId}`],
    ...overrides,
  };
}

function codexStatus(overrides = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: '2026-08-14T11:58:00.000Z',
    remainingPercent: 38,
    availability: 'AVAILABLE',
    proofRefs: ['receipts/codex/meter.json'],
    ...overrides,
  };
}

function laneStatus(statusId, route, overrides = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId,
    timestampUtc: '2026-08-14T11:58:00.000Z',
    proofRefs: [`receipts/${route.toLowerCase()}/capacity.json`],
    capacityReceipt: {
      schemaVersion: 'stephanos.build-lane-capacity-receipt.v1',
      receiptId: `${route.toLowerCase()}-capacity`,
      route,
      repository: 'Cheekyfellastef/stephan-os',
      workerId: `${route.toLowerCase()}-worker`,
      state: 'READY',
      supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
      supportedTaskClasses: ['FOCUSED_REPAIR'],
      observedAtUtc: '2026-08-14T11:58:00.000Z',
      expiresAtUtc: '2026-08-14T12:13:00.000Z',
      queueDepth: 0,
      p95StartLatencySeconds: 20,
      authorityReceiptIds: [],
      proofRefs: [`receipts/${route.toLowerCase()}/capacity.json`],
    },
    ...overrides,
  };
}

function mutateReceipt(statusId, route, mutation) {
  const original = laneStatus(statusId, route);
  return {
    ...original,
    capacityReceipt: {
      ...original.capacityReceipt,
      ...mutation,
    },
  };
}

test('canonical Codex, GitHub and Forge capacity evidence normalize without inventing unsupported metrics', () => {
  const observations = createSovereigntyCapacityObservationsV1({
    codexStatus: codexStatus(),
    githubLaneStatus: laneStatus('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB'),
    forgeLaneStatus: laneStatus('foundry-forge-build-capacity-current', 'FOUNDRY_FORGE'),
  }, { nowMs: NOW_MS });

  assert.equal(observations.length, 3);
  assert.deepEqual(observations.map((item) => item.providerId), ['openai', 'github', 'stephanos-local']);
  assert.equal(observations.every((item) => item.truthState === 'CURRENT'), true);
  assert.equal(observations[0].metrics.remainingPercent, 38);
  assert.equal(observations[0].metrics.throughputPerHour, null);
  assert.equal(observations[1].metrics.queueDepth, 0);
  assert.equal(observations[2].metrics.costPerUsefulResult, null);
});

test('two independently evidenced providers make one capability visibly diversified', () => {
  const projection = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('codex', 'openai'), system('github-builder', 'github')],
    capabilities: [capability('source-construction', 'codex', { alternativeSystemIds: ['github-builder'] })],
  }, { nowMs: NOW_MS });

  assert.equal(projection.status, 'CURRENT');
  assert.equal(projection.posture, 'DIVERSIFIED');
  assert.equal(projection.capabilityPostures[0].currentViableProviderCount, 2);
  assert.equal(projection.evidenceCoveragePercent, 100);
  assert.equal(projection.diversificationCoveragePercent, 100);
  assert.match(projection.scoreExplanation, /criticality weight/);
});

test('two routes on the same provider remain concentrated rather than gaming diversity', () => {
  const projection = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('provider-route-a', 'provider-one'), system('provider-route-b', 'provider-one')],
    capabilities: [capability('source-construction', 'provider-route-a', { alternativeSystemIds: ['provider-route-b'] })],
  }, { nowMs: NOW_MS });

  assert.equal(projection.posture, 'CONCENTRATED');
  assert.equal(projection.capabilityPostures[0].currentViableSystemCount, 2);
  assert.equal(projection.capabilityPostures[0].currentViableProviderCount, 1);
  assert.equal(projection.diversificationCoveragePercent, 0);
});

test('provider aliases are canonicalized before concentration is computed', () => {
  const projection = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('route-a', 'openai'), system('route-b', 'OpenAI')],
    capabilities: [capability('source-construction', 'route-a', { alternativeSystemIds: ['route-b'] })],
  }, { nowMs: NOW_MS });

  assert.equal(projection.status, 'CURRENT');
  assert.deepEqual(projection.systems.map((item) => item.providerId), ['openai', 'openai']);
  assert.equal(projection.posture, 'CONCENTRATED');
  assert.equal(projection.capabilityPostures[0].currentViableProviderCount, 1);
  assert.equal(projection.diversificationCoveragePercent, 0);
});

test('one declared provider is explicitly a single point of failure', () => {
  const projection = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('only-builder', 'only-provider')],
    capabilities: [capability('source-construction', 'only-builder')],
  }, { nowMs: NOW_MS });

  assert.equal(projection.posture, 'SINGLE_POINT');
  assert.equal(projection.currentBottlenecks.length, 1);
  assert.match(projection.capabilityPostures[0].explanation, /single point of failure/);
});

test('stale or future primary evidence makes capability posture UNKNOWN instead of green', () => {
  for (const observedAtUtc of ['2026-08-14T09:00:00.000Z', '2026-08-14T12:00:00.001Z', '2026-08-14T13:00:01.000Z']) {
    const projection = buildSovereigntyWorkspaceProjectionV1({
      systemObservations: [system('primary', 'provider-one', { observedAtUtc })],
      capabilities: [capability('source-construction', 'primary')],
    }, { nowMs: NOW_MS, staleAfterMs: 60 * 60 * 1000 });
    assert.equal(projection.status, 'CURRENT');
    assert.equal(projection.posture, 'UNKNOWN');
    assert.equal(projection.evidenceCoveragePercent, 0);
    assert.equal(projection.diversificationCoveragePercent, null);
  }
});

test('CURRENT observations require real proof refs and metrics remain bounded', () => {
  const noProof = validateSovereigntySystemObservationV1(system('builder', 'provider', { evidenceRefs: [] }), { nowMs: NOW_MS });
  assert.equal(noProof.valid, false);
  assert.ok(noProof.errors.includes('current-observation-requires-evidence'));

  const impossiblePercentage = validateSovereigntySystemObservationV1(system('builder', 'provider', {
    metrics: {
      remainingPercent: 101,
      queueDepth: 0,
      p95StartLatencySeconds: 1,
      throughputPerHour: null,
      failureRatePercent: null,
      costPerUsefulResult: null,
      criticalPathSharePercent: null,
    },
  }), { nowMs: NOW_MS });
  assert.equal(impossiblePercentage.valid, false);
  assert.ok(impossiblePercentage.errors.includes('metrics-remainingPercent-invalid'));
});

test('unobserved primary mapping fails closed while unproven alternatives stay visible as concentration risk', () => {
  const missingPrimary = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('other', 'provider-two')],
    capabilities: [capability('source-construction', 'missing-primary')],
  }, { nowMs: NOW_MS });
  assert.equal(missingPrimary.status, 'UNKNOWN');
  assert.ok(missingPrimary.errors.includes('capability-primary-system-unobserved:source-construction'));

  const unprovenAlternative = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('primary', 'provider-one')],
    capabilities: [capability('source-construction', 'primary', { alternativeSystemIds: ['future-provider'] })],
  }, { nowMs: NOW_MS });
  assert.equal(unprovenAlternative.posture, 'CONCENTRATED');
  assert.deepEqual(unprovenAlternative.capabilityPostures[0].missingObservationSystemIds, ['future-provider']);
});

test('unknown future providers are accepted through provider-neutral ids when evidence is valid', () => {
  const projection = buildSovereigntyWorkspaceProjectionV1({
    systemObservations: [system('future-agent-x', 'future-provider-x')],
    capabilities: [capability('specialist-review', 'future-agent-x', { criticality: 'MEDIUM' })],
  }, { nowMs: NOW_MS });
  assert.equal(projection.status, 'CURRENT');
  assert.equal(projection.systems[0].providerId, 'future-provider-x');
});

test('caller input cannot turn Sovereignty advice into install, spend, routing, merge or deployment authority', () => {
  for (const field of ['installAllowed', 'purchaseAllowed', 'subscriptionAllowed', 'credentialChangeAllowed', 'providerAccountMutationAllowed', 'sourceMutationAllowed', 'mergeAllowed', 'deploymentAllowed', 'spendAllowed', 'routingMutationAllowed']) {
    const projection = buildSovereigntyWorkspaceProjectionV1({
      systemObservations: [system('builder', 'provider')],
      capabilities: [capability('source-construction', 'builder')],
      [field]: true,
    }, { nowMs: NOW_MS });
    assert.equal(projection.status, 'UNKNOWN', `${field} must fail closed`);
    assert.ok(projection.errors.includes(`authority-widening-forbidden:${field}`));
    assert.equal(projection.authority[field], false);
  }
});

test('canonical build-lane receipt invariants gate Sovereignty capacity', () => {
  const cases = [
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { schemaVersion: 'wrong-schema' }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { route: 'FOUNDRY_FORGE' }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { supportedOperations: ['SOURCE_CONSTRUCTION'] }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { supportedTaskClasses: ['MULTI_MODULE_IMPLEMENTATION'] }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { queueDepth: null }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { p95StartLatencySeconds: null }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { expiresAtUtc: '2026-08-14T13:30:00.000Z' }),
    mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', { repository: 'Other/repo' }),
  ];

  for (const githubLaneStatus of cases) {
    const observations = createSovereigntyCapacityObservationsV1({ githubLaneStatus }, { nowMs: NOW_MS });
    const github = observations[1];
    assert.equal(github.truthState, 'UNKNOWN');
    assert.equal(github.capacityState, 'UNKNOWN');
    assert.equal(github.metrics.queueDepth, null);
    assert.equal(github.metrics.p95StartLatencySeconds, null);
  }
});

test('Sovereignty rejects build-lane observations from even the canonical one-minute future tolerance', () => {
  const githubLaneStatus = mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', {
    observedAtUtc: '2026-08-14T12:00:30.000Z',
    expiresAtUtc: '2026-08-14T12:15:30.000Z',
  });
  const observations = createSovereigntyCapacityObservationsV1({ githubLaneStatus }, { nowMs: NOW_MS });
  assert.equal(observations[1].truthState, 'UNKNOWN');
  assert.equal(observations[1].capacityState, 'UNKNOWN');
});

test('canonical capacity adapters fail closed when receipts are expired, proofless or future meter evidence is supplied', () => {
  const observations = createSovereigntyCapacityObservationsV1({
    codexStatus: codexStatus({ observedAtUtc: '2026-08-14T12:00:00.001Z' }),
    githubLaneStatus: mutateReceipt('chatgpt-github-build-capacity-current', 'CHATGPT_GITHUB', {
      proofRefs: [],
    }),
    forgeLaneStatus: mutateReceipt('foundry-forge-build-capacity-current', 'FOUNDRY_FORGE', {
      expiresAtUtc: '2026-08-14T11:59:00.000Z',
    }),
  }, { nowMs: NOW_MS });

  assert.deepEqual(observations.map((item) => item.truthState), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.deepEqual(observations.map((item) => item.capacityState), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
});
