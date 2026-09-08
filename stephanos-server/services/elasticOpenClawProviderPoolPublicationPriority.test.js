import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveElasticExternalCapacityCandidates,
} from './elasticOpenClawProviderPoolService.js';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-07T23:10:00.000Z';

function mission() {
  return {
    missionId: 'critical-1725-elastic-goal-publication-priority',
    title: 'Prefer currently publishable source handoffs',
    repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'AGENT_IMPLEMENTATION',
    allowedFiles: ['shared/agents/publication-priority/**'],
  };
}

test('currently publishable source lane outranks faster OpenClaw capacity without hiding OpenClaw', () => {
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { openClawHostContexts: [{ slot: 'fast-openclaw' }] },
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
          queueDepth: 2,
          p95StartLatencySeconds: 30,
        }],
      }),
      routeOpenClaw: () => ({
        route: 'OPENCLAW_LOCAL',
        adapter: 'openclaw-local',
        workerId: 'openclaw-fast-01',
        dispatchAllowed: true,
        selectedCapacityReceiptId: 'openclaw-capacity-fast-01',
        proofRefs: ['receipts/openclaw/capacity-fast-01.json'],
        openClawCapacity: {
          receipt: {
            queueDepth: 0,
            p95StartLatencySeconds: 1,
          },
        },
      }),
    },
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((candidate) => candidate.adapter), [
    'chatgpt-github',
    'openclaw-local',
  ]);
  assert.equal(result[0].p95StartLatencySeconds, 30);
  assert.equal(result[1].p95StartLatencySeconds, 1);
});

test('OpenClaw remains latency ordered when it is the only qualified external source capacity', () => {
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { openClawHostContexts: [{ slot: 'slow' }, { slot: 'fast' }] },
    HEAD,
    NOW,
    {
      routeCapacity: () => ({ fallbackCandidates: [] }),
      routeOpenClaw: (_input, context) => ({
        route: 'OPENCLAW_LOCAL',
        adapter: 'openclaw-local',
        workerId: `openclaw-${context.slot}`,
        dispatchAllowed: true,
        selectedCapacityReceiptId: `openclaw-capacity-${context.slot}`,
        proofRefs: [`receipts/openclaw/${context.slot}.json`],
        openClawCapacity: {
          receipt: {
            queueDepth: 0,
            p95StartLatencySeconds: context.slot === 'fast' ? 2 : 8,
          },
        },
      }),
    },
  );

  assert.deepEqual(result.map((candidate) => candidate.workerId), [
    'openclaw-fast',
    'openclaw-slow',
  ]);
});
