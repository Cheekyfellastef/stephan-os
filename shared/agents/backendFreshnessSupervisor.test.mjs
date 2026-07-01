import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackendFreshnessProbe,
  assertBackendReuseAllowed,
  BACKEND_FRESHNESS_STATUS,
} from './backendFreshnessSupervisor.mjs';

test('backend freshness passes only when health and mission operations routes pass', () => {
  const probe = buildBackendFreshnessProbe({
    routeProbes: [
      { route: '/api/health', ok: true, statusCode: 200 },
      { route: '/api/mission-operations', ok: true, statusCode: 200 },
    ],
  });

  assert.equal(probe.status, BACKEND_FRESHNESS_STATUS.CURRENT);
  assert.equal(probe.finalVerdict, BACKEND_FRESHNESS_STATUS.REFRESH_PROOF_PASS);
  assert.equal(probe.backendCurrent, true);
  assert.equal(probe.reuseAllowed, true);
  assert.deepEqual(probe.missingRoutes, []);
});

test('backend freshness blocks reuse when health passes but mission operations route is missing', () => {
  const probe = buildBackendFreshnessProbe({
    routeProbes: [
      { route: '/api/health', ok: true, statusCode: 200 },
      { route: '/api/mission-operations', ok: false, statusCode: 404 },
    ],
  });

  assert.equal(probe.status, BACKEND_FRESHNESS_STATUS.STALE_ROUTE_MISSING);
  assert.equal(probe.finalVerdict, BACKEND_FRESHNESS_STATUS.STALE_RESTART_REQUIRED);
  assert.equal(probe.backendCurrent, false);
  assert.equal(probe.reuseAllowed, false);
  assert.deepEqual(probe.missingRoutes, ['/api/mission-operations']);
  assert.match(probe.exactOperatorAction, /Restart the Stephanos backend/);
  assert.equal(probe.noFakeBackendCurrentClaim, true);
});

test('backend freshness fails when health is unavailable', () => {
  const probe = buildBackendFreshnessProbe({
    routeProbes: [
      { route: '/api/health', ok: false, statusCode: 0 },
      { route: '/api/mission-operations', ok: false, statusCode: 0 },
    ],
  });

  assert.equal(probe.status, BACKEND_FRESHNESS_STATUS.REFRESH_PROOF_FAILED);
  assert.equal(probe.finalVerdict, BACKEND_FRESHNESS_STATUS.REFRESH_PROOF_FAILED);
  assert.equal(probe.reuseAllowed, false);
});

test('reuse assertion preserves blocked state for stale backend', () => {
  const result = assertBackendReuseAllowed({
    routeProbes: [
      { route: '/api/health', ok: true, statusCode: 200 },
      { route: '/api/mission-operations', ok: false, statusCode: 404 },
    ],
  });

  assert.equal(result.actionStatus, 'REUSE_BLOCKED');
  assert.equal(result.backendCurrent, false);
  assert.equal(result.noFakeBackendCurrentClaim, true);
});
