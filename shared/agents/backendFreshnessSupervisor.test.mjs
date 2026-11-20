import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKEND_FRESHNESS_VERDICTS,
  adjudicateBackendFreshnessProof,
  probeBackendFreshness,
} from './backendFreshnessSupervisor.mjs';

function fetchWithStatuses(statuses) {
  return async (url) => ({ status: statuses[new URL(url).pathname] ?? 500 });
}

test('backend reuse allowed when /api/health and /api/mission-operations pass', async () => {
  const proof = await probeBackendFreshness({
    fetchImpl: fetchWithStatuses({ '/api/health': 200, '/api/mission-operations': 200 }),
  });

  assert.equal(proof.backendCurrent, true);
  assert.equal(proof.finalVerdict, BACKEND_FRESHNESS_VERDICTS.CURRENT);
  assert.equal(proof.exactOperatorAction, '');
});

test('backend reuse blocked when /api/health passes but /api/mission-operations is 404', async () => {
  const proof = await probeBackendFreshness({
    fetchImpl: fetchWithStatuses({ '/api/health': 200, '/api/mission-operations': 404 }),
  });

  assert.equal(proof.backendCurrent, false);
  assert.equal(proof.finalVerdict, 'BACKEND_STALE_ROUTE_MISSING');
  assert.equal(proof.routeProofs.find((route) => route.route === '/api/mission-operations').missing, true);
});

test('stale backend emits exact operator action for safe allowlisted restart path', () => {
  const proof = adjudicateBackendFreshnessProof({
    routeProofs: [
      { route: '/api/health', status: 200 },
      { route: '/api/mission-operations', status: 500 },
    ],
    safeRestartAvailable: true,
  });

  assert.equal(proof.finalVerdict, 'BACKEND_STALE_RESTART_REQUIRED');
  assert.match(proof.exactOperatorAction, /Restart only the allowlisted Stephanos backend process/);
  assert.equal(proof.arbitraryShellAllowed, false);
});

test('no fake backend current claim when any required freshness route fails', () => {
  const proof = adjudicateBackendFreshnessProof({
    routeProofs: [
      { route: '/api/health', status: 200 },
      { route: '/api/mission-operations', status: 404 },
    ],
  });

  assert.equal(proof.backendCurrent, false);
  assert.notEqual(proof.finalVerdict, 'BACKEND_CURRENT');
  assert.match(proof.exactOperatorAction, /stephanos-server dev process/);
});
