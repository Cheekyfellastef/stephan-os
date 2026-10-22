import assert from 'node:assert/strict';
import test from 'node:test';

import { MISSION_CONTROLLER_ROUTE } from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  readElasticMissionControllerCapacityRoutingInput,
  resolveElasticExternalCapacityCandidates,
} from './elasticOpenClawProviderPoolService.js';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-22T17:45:00.000Z';

function mission(overrides = {}) {
  return {
    missionId: 'critical-2009-elastic-goal-native-live',
    title: 'Prove native elastic construction',
    repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'AGENT_IMPLEMENTATION',
    allowedFiles: ['shared/agents/native-live-proof.mjs'],
    ...overrides,
  };
}

function enoent() {
  const error = new Error('not found');
  error.code = 'ENOENT';
  return error;
}

test('elastic capacity reader requests only trusted focused-repair native capacity at exact current head', async () => {
  const seen = [];
  const native = Object.freeze({ marker: 'focused' });
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
      return { ok: true, candidate: native };
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].taskClass, 'FOCUSED_REPAIR');
  assert.equal(seen[0].sourceHead, HEAD);
  assert.equal(result.nativeRoutingCandidatesByTaskClass.FOCUSED_REPAIR, native);
  assert.equal(result.nativeRoutingCandidatesByTaskClass.MULTI_MODULE_IMPLEMENTATION, undefined);
});

test('verified native routing candidate reaches the existing elastic list for one-file focused repair', () => {
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

test('native routing stays closed for focused missions with more than one allowed file', () => {
  const native = Object.freeze({ marker: 'verified-native-candidate' });
  const result = resolveElasticExternalCapacityCandidates(
    mission({ allowedFiles: ['one.mjs', 'two.mjs'] }),
    { nativeRoutingCandidatesByTaskClass: { FOCUSED_REPAIR: native } },
    HEAD,
    NOW,
    {
      routeCapacity: (input) => {
        assert.equal(input.nativeRoutingCandidate, null);
        return { task: { taskClass: 'FOCUSED_REPAIR' }, fallbackCandidates: [] };
      },
      routeOpenClaw: () => ({ dispatchAllowed: false }),
    },
  );
  assert.deepEqual(result, []);
});

test('native routing stays closed for multi-module task class', () => {
  const native = Object.freeze({ marker: 'verified-native-candidate' });
  const result = resolveElasticExternalCapacityCandidates(
    mission({ allowedFiles: ['one.mjs', 'two.mjs', 'three.mjs'] }),
    { nativeRoutingCandidatesByTaskClass: { FOCUSED_REPAIR: native } },
    HEAD,
    NOW,
    {
      routeCapacity: (input) => {
        assert.equal(input.nativeRoutingCandidate, null);
        return { task: { taskClass: 'MULTI_MODULE_IMPLEMENTATION' }, fallbackCandidates: [] };
      },
      routeOpenClaw: () => ({ dispatchAllowed: false }),
    },
  );
  assert.deepEqual(result, []);
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
