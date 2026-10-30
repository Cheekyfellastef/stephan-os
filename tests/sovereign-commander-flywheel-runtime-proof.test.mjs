import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateFlywheelRuntimeObservation,
} from '../scripts/sovereign-commander-flywheel-runtime-proof.mjs';

function connected(overrides = {}) {
  return {
    feed: {
      httpOk: true,
      httpStatus: 200,
      telemetryValid: true,
      workspaceValid: true,
      state: 'stale',
      responseMs: 1661,
      starfieldSeedPlanted: true,
      ...overrides.feed,
    },
    browser: {
      liveState: 'stale',
      liveLabel: 'STALE',
      backendUnreachableVisible: false,
      seedVisible: true,
      ...overrides.browser,
    },
    consoleErrors: overrides.consoleErrors || [],
    pageErrors: overrides.pageErrors || [],
  };
}

test('Flywheel runtime proof accepts truthful connected STALE feed and served workspace', () => {
  const result = evaluateFlywheelRuntimeObservation(connected());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.blockers, []);
});

test('Flywheel runtime proof blocks dead backend and missing live Starfield seed', () => {
  const result = evaluateFlywheelRuntimeObservation(connected({
    feed: {
      httpOk: false,
      httpStatus: 503,
      starfieldSeedPlanted: false,
    },
    browser: {
      backendUnreachableVisible: true,
      seedVisible: false,
    },
  }));
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('FLYWHEEL_FEED_HTTP_UNAVAILABLE'));
  assert.ok(result.blockers.includes('FLYWHEEL_STARFIELD_SEED_NOT_LIVE'));
  assert.ok(result.blockers.includes('FLYWHEEL_BROWSER_BACKEND_UNREACHABLE'));
  assert.ok(result.blockers.includes('FLYWHEEL_BROWSER_SEED_NOT_VISIBLE'));
});

test('Flywheel runtime proof enforces the existing 10 second client budget', () => {
  const result = evaluateFlywheelRuntimeObservation(connected({
    feed: { responseMs: 10001 },
  }));
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('FLYWHEEL_FEED_EXCEEDED_CLIENT_BUDGET'));
});
