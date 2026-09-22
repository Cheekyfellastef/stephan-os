import assert from 'node:assert/strict';
import test from 'node:test';

import { MISSION_CONTROLLER_ROUTE } from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  readElasticMissionControllerCapacityRoutingInput,
  resolveElasticExternalCapacityCandidates,
} from './elasticOpenClawProviderPoolService.js';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-22T17:45:00.000Z';

function mission() {
  return {
    missionId: 'critical-2009-elastic-goal-native-live',
    title: 'Prove native elastic construction',
    repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'AGENT_IMPLEMENTATION',
    allowedFiles: ['shared/agents/native-live-proof.mjs'],
  };
}

function enoent() {
  const error = new Error('not found');
  error.code = 'ENOENT';
  return error;
}

test('elastic capacity reader requests only trusted native source task classes at exact current head', async () => {
  const seen = [];
  const candidates = {
    FOCUSED_REPAIR: Object.freeze({ marker: 'focused' }),
    MULTI_MODULE_IMPLEMENTATION: Object.freeze({ marker: 'multi' }),
  };
  const result = await readElasticMissionControllerCapacityRoutingInput({
    root: '/tmp/stephanos-workspace',
    repoRoot: '/tmp/stephan-os',
    nowUtc: NOW,
    sourceRevision: HEAD,
    env: { USERPROFILE: '/tmp/operator' },
    readBaseInput: async () => ({ nowUtc: NOW }),
    readdirImpl: async () => [],
    readFileImpl: async () => { throw enoent(); },
    readNativeCandidate: async (input) => {
      seen.push(input);
      return { ok: true, candidate: candidates[input.taskClass] };
    },
  });

  assert.deepEqual(seen.map((entry) => entry.taskClass).sort(), [
    'FOCUSED_REPAIR',
    'MULTI_MODULE_IMPLEMENTATION',
  ]);
  assert.ok(seen.every((entry) => entry.sourceHead === HEAD));
  assert.equal(result.nativeRoutingCandidatesByTaskClass.FOCUSED_REPAIR, candidates.FOCUSED_REPAIR);
  assert.equal(result.nativeRoutingCandidatesByTaskClass.MULTI_MODULE_IMPLEMENTATION, candidates.MULTI_MODULE_IMPLEMENTATION);
});

test('verified native routing candidate reaches the existing elastic candidate list', () => {
  const native = Object.freeze({ marker: 'verified-native-candidate' });
  let routeCalls = 0;
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    { nativeRoutingCandidatesByTaskClass: { FOCUSED_REPAIR: native } },
    HEAD,
    NOW,
    {
      routeCapacity: (input) => {
        routeCalls += 1;
        const task = { taskClass: 'FOCUSED_REPAIR' };
        if (input.nativeRoutingCandidate !== native) return { task, fallbackCandidates: [] };
        return {
          task,
          fallbackCandidates: [{
            route: MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE,
            adapter: 'stephanos-native',
            workerId: 'stephanos-native-battle-bridge',
            receiptId: 'native-capacity-current-001',
            proofRefs: ['receipts/native/capacity-001.json'],
            queueDepth: 0,
            p95StartLatencySeconds: 2,
          }],
        };
      },
      routeOpenClaw: () => ({ dispatchAllowed: false }),
    },
  );

  assert.ok(routeCalls >= 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].route, MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE);
  assert.equal(result[0].adapter, 'stephanos-native');
  assert.equal(result[0].workerId, 'stephanos-native-battle-bridge');
});

test('no verified native candidate means no native elastic width is manufactured', () => {
  const result = resolveElasticExternalCapacityCandidates(
    mission(),
    {},
    HEAD,
    NOW,
    {
      routeCapacity: () => ({ task: { taskClass: 'FOCUSED_REPAIR' }, fallbackCandidates: [] }),
      routeOpenClaw: () => ({ dispatchAllowed: false }),
    },
  );
  assert.deepEqual(result, []);
});
