import assert from 'node:assert/strict';
import test from 'node:test';

import { MAXIMUM_BUILD_LANES } from '../../shared/agents/elasticBuildCapacityV1.mjs';
import {
  foundryForgeWorkerCapacityStatusId,
} from '../../shared/agents/githubContinuityCapacityPublicationV1.mjs';
import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  createBuildLaneCapacityStatusRecord,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA,
  OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE,
  openClawHostContextsFromCapacityRouting,
  readElasticMissionControllerCapacityRoutingInput,
  resolveElasticExternalCapacityCandidates,
} from './elasticOpenClawProviderPoolService.js';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-07T15:20:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';

function mission() {
  return {
    missionId: 'critical-1725-elastic-goal-openclaw-pool',
    title: 'Use elastic external capacity',
    repository: REPOSITORY,
    currentPhase: 'AGENT_IMPLEMENTATION',
    allowedFiles: ['shared/agents/openclaw-pool/**'],
  };
}

function routedOpenClaw(context) {
  return {
    route: 'OPENCLAW_LOCAL',
    adapter: 'openclaw-local',
    workerId: `openclaw-${context.slot}`,
    dispatchAllowed: true,
    selectedCapacityReceiptId: `capacity-${context.slot}`,
    proofRefs: [`receipts/openclaw/${context.slot}.json`],
    openClawCapacity: {
      receipt: {
        queueDepth: context.queueDepth ?? 0,
        p95StartLatencySeconds: context.latency ?? 5,
      },
    },
  };
}

function forgeReceipt(workerId, overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: `forge-capacity-${workerId}`,
    route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
    repository: REPOSITORY,
    workerId,
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc: '2026-09-07T15:19:00.000Z',
    expiresAtUtc: '2026-09-07T15:24:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: workerId.endsWith('02') ? 4 : 8,
    authorityReceiptIds: ['forge-m2-current', 'forge-m3-current'],
    proofRefs: [`receipts/forge/${workerId}.json`],
    ...overrides,
  };
}

function forgeWorkerRecord(receipt) {
  return {
    ...createBuildLaneCapacityStatusRecord(receipt, { nowUtc: NOW }),
    statusId: foundryForgeWorkerCapacityStatusId(receipt.workerId),
    workerScopedCapacity: true,
  };
}

function enoent() {
  const error = new Error('not found');
  error.code = 'ENOENT';
  return error;
}

test('capacity reader exposes a bounded canonical OpenClaw host-context pool', async () => {
  const contexts = [{ slot: 'one' }, { slot: 'two' }];
  const result = await readElasticMissionControllerCapacityRoutingInput({
    root: '/tmp/stephanos-workspace',
    repoRoot: '/tmp/stephan-os',
    nowUtc: NOW,
    readBaseInput: async () => ({ nowUtc: NOW, githubLaneReceipt: null, forgeLaneReceipt: null }),
    readdirImpl: async () => [],
    readFileImpl: async (file) => {
      assert.match(String(file), new RegExp(`${OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE}$`));
      return JSON.stringify({ schemaVersion: OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA, hostContexts: contexts });
    },
  });
  assert.equal(result.openClawHostContexts.length, 2);
  assert.equal(result.openClawHostContexts[0].slot, 'one');
  assert.equal(result.openClawHostContext.slot, 'one');
  assert.deepEqual(result.forgeLaneReceipts, []);
});

test('capacity reader retains independently proven Forge workers instead of collapsing to the legacy aggregate', async () => {
  const first = forgeReceipt('stephanos-forge-builder-01');
  const second = forgeReceipt('stephanos-forge-builder-02');
  const records = new Map([
    [`${foundryForgeWorkerCapacityStatusId(first.workerId)}.json`, forgeWorkerRecord(first)],
    [`${foundryForgeWorkerCapacityStatusId(second.workerId)}.json`, forgeWorkerRecord(second)],
  ]);
  const result = await readElasticMissionControllerCapacityRoutingInput({
    root: '/tmp/stephanos-workspace',
    repoRoot: '/tmp/stephan-os',
    nowUtc: NOW,
    readBaseInput: async () => ({ nowUtc: NOW, forgeLaneReceipt: second }),
    readdirImpl: async () => [...records.keys(), 'unrelated-status.json'],
    readFileImpl: async (file) => {
      const name = String(file).split(/[\\/]/).pop();
      if (records.has(name)) return JSON.stringify(records.get(name));
      throw enoent();
    },
  });
  assert.equal(result.forgeLaneReceipts.length, 2);
  assert.deepEqual(result.forgeLaneReceipts.map((receipt) => receipt.workerId).sort(), [
    'stephanos-forge-builder-01',
    'stephanos-forge-builder-02',
  ]);
  assert.equal(result.forgeLaneReceipt.workerId, second.workerId);
});

test('malformed, stale or filename-mismatched Forge worker records add no elastic capacity', async () => {
  const receipt = forgeReceipt('stephanos-forge-builder-01');
  const validRecord = forgeWorkerRecord(receipt);
  const candidates = [
    { ...validRecord, workerScopedCapacity: false },
    { ...validRecord, statusId: 'foundry-forge-build-capacity-worker-deadbeefdeadbeefdeadbeef' },
    { ...validRecord, timestampUtc: '2026-09-07T12:00:00.000Z' },
  ];
  for (const record of candidates) {
    const file = `${foundryForgeWorkerCapacityStatusId(receipt.workerId)}.json`;
    const result = await readElasticMissionControllerCapacityRoutingInput({
      root: '/tmp/stephanos-workspace',
      repoRoot: '/tmp/stephan-os',
      nowUtc: NOW,
      readBaseInput: async () => ({ nowUtc: NOW }),
      readdirImpl: async () => [file],
      readFileImpl: async (path) => {
        if (String(path).endsWith(file)) return JSON.stringify(record);
        throw enoent();
      },
    });
    assert.deepEqual(result.forgeLaneReceipts, []);
  }
});

test('oversized or malformed pool records fail closed to zero OpenClaw capacity', async () => {
  const tooMany = Array.from({ length: MAXIMUM_BUILD_LANES + 1 }, (_, index) => ({ slot: String(index) }));
  for (const record of [
    { schemaVersion: 'wrong-schema', hostContexts: [{ slot: 'one' }] },
    { schemaVersion: OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA, hostContexts: tooMany },
    { schemaVersion: OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA, hostContexts: 'not-an-array' },
  ]) {
    const result = await readElasticMissionControllerCapacityRoutingInput({
      root: '/tmp/stephanos-workspace',
      repoRoot: '/tmp/stephan-os',
      nowUtc: NOW,
      readBaseInput: async () => ({ nowUtc: NOW }),
      readdirImpl: async () => [],
      readFileImpl: async () => JSON.stringify(record),
    });
    assert.deepEqual(result.openClawHostContexts, []);
    assert.equal(result.openClawHostContext, null);
  }
});

test('legacy single OpenClaw host context remains one bounded slot', () => {
  const legacy = { slot: 'legacy' };
  assert.deepEqual(openClawHostContextsFromCapacityRouting({ openClawHostContext: legacy }), [legacy]);
});

test('two independently qualified OpenClaw workers become two distinct elastic candidates', () => {
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { openClawHostContexts: [{ slot: 'one', latency: 8 }, { slot: 'two', latency: 4 }] },
    HEAD,
    NOW,
    {
      routeCapacity: () => ({ fallbackCandidates: [] }),
      routeOpenClaw: (_input, context) => routedOpenClaw(context),
    },
  );
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((candidate) => candidate.workerId), ['openclaw-two', 'openclaw-one']);
  assert.ok(result.every((candidate) => candidate.route === 'OPENCLAW_LOCAL'));
});

test('two distinct Forge worker receipts become two independently routable elastic candidates', () => {
  const first = forgeReceipt('stephanos-forge-builder-01');
  const second = forgeReceipt('stephanos-forge-builder-02');
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { forgeLaneReceipts: [first, second] },
    HEAD,
    NOW,
    {
      routeCapacity: (input) => {
        const receipt = input.forgeLaneReceipt;
        return receipt ? {
          fallbackCandidates: [{
            route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
            adapter: 'foundry-forge',
            workerId: receipt.workerId,
            receiptId: receipt.receiptId,
            proofRefs: receipt.proofRefs,
            queueDepth: receipt.queueDepth,
            p95StartLatencySeconds: receipt.p95StartLatencySeconds,
          }],
        } : { fallbackCandidates: [] };
      },
      routeOpenClaw: () => ({ dispatchAllowed: false }),
    },
  );
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((candidate) => candidate.workerId), [
    'stephanos-forge-builder-02',
    'stephanos-forge-builder-01',
  ]);
  assert.ok(result.every((candidate) => candidate.route === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE));
});

test('duplicate receipts for one OpenClaw worker cannot manufacture elastic width', () => {
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { openClawHostContexts: [{ slot: 'one', latency: 9 }, { slot: 'one', latency: 2 }] },
    HEAD,
    NOW,
    {
      routeCapacity: () => ({ fallbackCandidates: [] }),
      routeOpenClaw: (_input, context) => routedOpenClaw(context),
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].workerId, 'openclaw-one');
  assert.equal(result[0].p95StartLatencySeconds, 2);
});

test('same Forge worker cannot manufacture width even if the routing input repeats its receipt', () => {
  const slow = forgeReceipt('stephanos-forge-builder-01', { p95StartLatencySeconds: 9 });
  const fast = forgeReceipt('stephanos-forge-builder-01', {
    receiptId: 'forge-capacity-stephanos-forge-builder-01-refresh',
    p95StartLatencySeconds: 2,
  });
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { forgeLaneReceipts: [slow, fast] },
    HEAD,
    NOW,
    {
      routeCapacity: (input) => {
        const receipt = input.forgeLaneReceipt;
        return receipt ? {
          fallbackCandidates: [{
            route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
            adapter: 'foundry-forge',
            workerId: receipt.workerId,
            receiptId: receipt.receiptId,
            proofRefs: receipt.proofRefs,
            queueDepth: receipt.queueDepth,
            p95StartLatencySeconds: receipt.p95StartLatencySeconds,
          }],
        } : { fallbackCandidates: [] };
      },
      routeOpenClaw: () => ({ dispatchAllowed: false }),
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].workerId, 'stephanos-forge-builder-01');
  assert.equal(result[0].p95StartLatencySeconds, 2);
});

test('unqualified OpenClaw contexts add no capacity while GitHub and Forge candidates remain usable', () => {
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { openClawHostContexts: [{ slot: 'blocked' }] },
    HEAD,
    NOW,
    {
      routeCapacity: () => ({
        fallbackCandidates: [{
          route: 'CHATGPT_GITHUB',
          adapter: 'chatgpt-github',
          workerId: 'github-worker-01',
          receiptId: 'github-capacity-01',
          proofRefs: ['receipts/github/capacity-01.json'],
          queueDepth: 0,
          p95StartLatencySeconds: 3,
        }],
      }),
      routeOpenClaw: () => ({ dispatchAllowed: false, adapter: 'openclaw-local' }),
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].route, 'CHATGPT_GITHUB');
  assert.equal(result[0].workerId, 'github-worker-01');
});
