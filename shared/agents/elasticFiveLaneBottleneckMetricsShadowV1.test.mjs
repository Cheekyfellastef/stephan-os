import assert from 'node:assert/strict';
import test from 'node:test';

import { projectElasticFiveLaneBottleneckMetricsShadowV1 } from './elasticFiveLaneBottleneckMetricsShadowV1.mjs';

const H = (value) => value.repeat(40);

const ROLES = ['SOURCE', 'REVIEW', 'PROOF', 'RUNTIME', 'EXPERIENCE'];

function lane(index, overrides = {}) {
  const role = ROLES[index] ?? 'DOCUMENTATION';
  return {
    laneId: `lane-${index + 1}`,
    role,
    state: 'RUNNING',
    sourceHead: H('a'),
    correlationId: `correlation-${index + 1}`,
    queueDepth: 1,
    oldestQueueAgeMs: 1_000,
    waitTimeMs: 500,
    criticalPath: index === 0,
    capacityHealthy: true,
    provider: index === 3 ? 'battle-bridge' : 'github-provider-neutral',
    resourceIds: [`resource:${index + 1}`],
    ...overrides,
  };
}

function lease(index, overrides = {}) {
  return {
    leaseId: `lease-${index + 1}`,
    laneId: `lane-${index + 1}`,
    resourceId: `resource:${index + 1}`,
    mode: 'MUTATION',
    heartbeatAtUtc: '2026-08-27T06:59:30Z',
    expiresAtUtc: '2026-08-27T07:10:00Z',
    sourceHead: H('a'),
    signatureVerified: true,
    ...overrides,
  };
}

function fixture() {
  return {
    sourceHead: H('a'),
    sourceTree: H('b'),
    observedAtUtc: '2026-08-27T07:00:00Z',
    policy: {
      minWidth: 5,
      maxWidth: 10,
      staleAfterMs: 120_000,
      queueAgePressureMs: 60_000,
      waitPressureMs: 30_000,
      cooldownMs: 60_000,
      lastWidthChangeAtUtc: '2026-08-27T06:00:00Z',
    },
    lanes: ROLES.map((_, index) => lane(index)),
    leases: ROLES.map((_, index) => lease(index)),
    demand: {
      readyNonConflictingWork: 1,
      blockedWork: 0,
      criticalPathWork: 1,
    },
    capacity: {
      githubHealthy: true,
      providerHealthy: true,
      battleBridgeHealthy: true,
      cpuPressure: false,
      memoryPressure: false,
      rateLimitPressure: false,
      costPressure: false,
    },
  };
}

test('exposes five baseline lanes, leases, width and exact next action with zero authority', () => {
  const result = projectElasticFiveLaneBottleneckMetricsShadowV1(fixture());
  assert.equal(result.state, 'METRICS_READY_SHADOW');
  assert.equal(result.currentWidth, 5);
  assert.equal(result.healthyWidth, 5);
  assert.equal(result.blockedWidth, 0);
  assert.equal(result.nextAction, 'SCALE_OUT_CANDIDATE_SHADOW');
  assert.equal(result.recommendedWidth, 6);
  assert.equal(result.activeLanes.length, 5);
  assert.equal(result.activeLeases.length, 5);
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('one blocked lane is isolated while four resource-disjoint lanes continue', () => {
  const input = fixture();
  input.lanes[1].state = 'BLOCKED';
  input.lanes[1].oldestQueueAgeMs = 120_000;
  input.lanes[1].waitTimeMs = 90_000;
  const result = projectElasticFiveLaneBottleneckMetricsShadowV1(input);
  assert.equal(result.state, 'METRICS_READY_SHADOW');
  assert.equal(result.healthyWidth, 4);
  assert.equal(result.blockedWidth, 1);
  assert.equal(result.nextAction, 'CONTINUE_RESOURCE_DISJOINT_SHADOW');
  assert.ok(result.bottlenecks.some((item) => item.code === 'LANE_BLOCKED'));
  assert.deepEqual(result.reasonCodes, ['ONE_BLOCKED_LANE_ISOLATED']);
});

test('two blocked lanes force safe hold instead of false building', () => {
  const input = fixture();
  input.lanes[1].state = 'BLOCKED';
  input.lanes[4].state = 'PAUSED';
  const result = projectElasticFiveLaneBottleneckMetricsShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['MULTIPLE_BLOCKED_LANES_REQUIRE_SAFE_HOLD']);
});

test('healthy non-conflicting demand scales above five and idle width contracts back to five', () => {
  const scaleOut = fixture();
  scaleOut.demand.readyNonConflictingWork = 3;
  const out = projectElasticFiveLaneBottleneckMetricsShadowV1(scaleOut);
  assert.equal(out.nextAction, 'SCALE_OUT_CANDIDATE_SHADOW');
  assert.equal(out.recommendedWidth, 8);

  const scaleIn = fixture();
  scaleIn.lanes.push(lane(5, {
    laneId: 'lane-6',
    role: 'DOCUMENTATION',
    state: 'IDLE',
    correlationId: 'correlation-6',
    resourceIds: ['resource:6'],
  }));
  scaleIn.leases.push(lease(5, {
    leaseId: 'lease-6', laneId: 'lane-6', resourceId: 'resource:6', mode: 'READ_ONLY',
  }));
  scaleIn.demand.readyNonConflictingWork = 0;
  const inward = projectElasticFiveLaneBottleneckMetricsShadowV1(scaleIn);
  assert.equal(inward.currentWidth, 6);
  assert.equal(inward.nextAction, 'SCALE_IN_CANDIDATE_SHADOW');
  assert.equal(inward.recommendedWidth, 5);
});

test('capacity pressure and cooldown prevent scale-out recommendations', () => {
  const pressure = fixture();
  pressure.capacity.rateLimitPressure = true;
  const held = projectElasticFiveLaneBottleneckMetricsShadowV1(pressure);
  assert.equal(held.nextAction, 'HOLD_WIDTH_SHADOW');
  assert.ok(held.bottlenecks.some((item) => item.code === 'FLEET_CAPACITY_PRESSURE'));

  const cooldown = fixture();
  cooldown.policy.lastWidthChangeAtUtc = '2026-08-27T06:59:30Z';
  const cooling = projectElasticFiveLaneBottleneckMetricsShadowV1(cooldown);
  assert.equal(cooling.nextAction, 'HOLD_WIDTH_SHADOW');
  assert.deepEqual(cooling.reasonCodes, ['WIDTH_COOLDOWN_ACTIVE']);
});

test('duplicate mutation writers fail closed even when the same lane claims both leases', () => {
  const input = fixture();
  input.leases.push(lease(0, { leaseId: 'lease-duplicate' }));
  const result = projectElasticFiveLaneBottleneckMetricsShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE']);
});

test('source mismatch, unsigned lease, missing baseline role and stale lease remain explicit', () => {
  const source = fixture();
  source.lanes[0].sourceHead = H('c');
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(source).reasonCodes,
    ['LANE_SOURCE_HEAD_MISMATCH']);

  const unsigned = fixture();
  unsigned.leases[0].signatureVerified = false;
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(unsigned).reasonCodes,
    ['LEASE_SIGNATURE_UNPROVEN']);

  const role = fixture();
  role.lanes[4].role = 'DOCUMENTATION';
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(role).reasonCodes,
    ['BASELINE_LANE_ROLE_MISSING']);

  const stale = fixture();
  stale.leases[0].heartbeatAtUtc = '2026-08-27T06:00:00Z';
  stale.leases[0].expiresAtUtc = '2026-08-27T06:30:00Z';
  const projected = projectElasticFiveLaneBottleneckMetricsShadowV1(stale);
  assert.equal(projected.state, 'METRICS_READY_SHADOW');
  assert.ok(projected.bottlenecks.some((item) => item.code === 'LEASE_EXPIRED_OR_STALE'));
  assert.equal(projected.activeLeases.length, 4);
});

test('bottleneck ordering is deterministic and prioritises critical queue pressure', () => {
  const input = fixture();
  input.lanes[0].oldestQueueAgeMs = 180_000;
  input.lanes[0].waitTimeMs = 120_000;
  input.lanes[2].oldestQueueAgeMs = 90_000;
  const result = projectElasticFiveLaneBottleneckMetricsShadowV1(input);
  assert.deepEqual(result.bottlenecks.slice(0, 2).map((item) => item.code),
    ['QUEUE_AGE_PRESSURE', 'WAIT_TIME_PRESSURE']);
  assert.equal(result.oldestQueueAgeMs, 180_000);
  assert.equal(result.maximumWaitTimeMs, 120_000);
});

test('authority smuggling, symbols, accessors, sparse arrays and hostile reflection fail closed', () => {
  const extra = fixture();
  extra.capacity.mergeAllowed = true;
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(extra).reasonCodes,
    ['CAPACITY_NOT_CANONICAL_PLAIN_DATA']);

  const symbol = fixture();
  symbol.lanes[0][Symbol('approve')] = true;
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(symbol).reasonCodes,
    ['LANE_NOT_CANONICAL_PLAIN_DATA']);

  const accessor = fixture();
  Object.defineProperty(accessor.leases[0], 'approve', { get() { return true; }, enumerable: true });
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(accessor).reasonCodes,
    ['LEASE_NOT_CANONICAL_PLAIN_DATA']);

  const sparse = fixture();
  sparse.lanes = new Array(5);
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(sparse).reasonCodes,
    ['FIVE_BASELINE_LANES_NOT_PRESENT']);

  const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  assert.deepEqual(projectElasticFiveLaneBottleneckMetricsShadowV1(hostile).reasonCodes,
    ['BOTTLENECK_METRICS_INPUT_INSPECTION_FAILED']);
});
