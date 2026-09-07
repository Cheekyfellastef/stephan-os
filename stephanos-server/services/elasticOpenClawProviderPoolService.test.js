import assert from 'node:assert/strict';
import test from 'node:test';

import { MAXIMUM_BUILD_LANES } from '../../shared/agents/elasticBuildCapacityV1.mjs';
import {
  OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA,
  OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE,
  openClawHostContextsFromCapacityRouting,
  readElasticMissionControllerCapacityRoutingInput,
  resolveElasticExternalCapacityCandidates,
} from './elasticOpenClawProviderPoolService.js';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-07T15:20:00.000Z';

function mission() {
  return {
    missionId: 'critical-1725-elastic-goal-openclaw-pool',
    title: 'Use elastic OpenClaw capacity',
    repository: 'Cheekyfellastef/stephan-os',
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

test('capacity reader exposes a bounded canonical OpenClaw host-context pool', async () => {
  const contexts = [{ slot: 'one' }, { slot: 'two' }];
  const result = await readElasticMissionControllerCapacityRoutingInput({
    root: '/tmp/stephanos-workspace',
    repoRoot: '/tmp/stephan-os',
    nowUtc: NOW,
    readBaseInput: async () => ({ nowUtc: NOW, githubLaneReceipt: null, forgeLaneReceipt: null }),
    readFileImpl: async (file) => {
      assert.match(String(file), new RegExp(`${OPENCLAW_ELASTIC_PROVIDER_POOL_STATUS_FILE}$`));
      return JSON.stringify({ schemaVersion: OPENCLAW_ELASTIC_PROVIDER_POOL_SCHEMA, hostContexts: contexts });
    },
  });
  assert.equal(result.openClawHostContexts.length, 2);
  assert.equal(result.openClawHostContexts[0].slot, 'one');
  assert.equal(result.openClawHostContext.slot, 'one');
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
