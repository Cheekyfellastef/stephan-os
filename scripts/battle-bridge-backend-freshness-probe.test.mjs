import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_BACKEND_BASE_URL,
  runBattleBridgeBackendFreshnessProbe,
} from './battle-bridge-backend-freshness-probe.mjs';

function fetchWithStatuses(statuses) {
  return async (url) => ({ status: statuses[new URL(url).pathname] ?? 500 });
}

test('fixed Battle Bridge probe reuses both canonical backend freshness routes', async () => {
  const proof = await runBattleBridgeBackendFreshnessProbe({
    fetchImpl: fetchWithStatuses({ '/api/health': 200, '/api/mission-operations': 200 }),
  });
  assert.equal(BATTLE_BRIDGE_BACKEND_BASE_URL, 'http://127.0.0.1:8787');
  assert.equal(proof.backendCurrent, true);
  assert.equal(proof.finalVerdict, 'BACKEND_CURRENT');
  assert.deepEqual(proof.requiredRoutes, ['/api/health', '/api/mission-operations']);
});

test('health-only responder is stale and cannot authorize backend reuse', async () => {
  const proof = await runBattleBridgeBackendFreshnessProbe({
    fetchImpl: fetchWithStatuses({ '/api/health': 200, '/api/mission-operations': 404 }),
  });
  assert.equal(proof.backendCurrent, false);
  assert.equal(proof.finalVerdict, 'BACKEND_STALE_ROUTE_MISSING');
});
