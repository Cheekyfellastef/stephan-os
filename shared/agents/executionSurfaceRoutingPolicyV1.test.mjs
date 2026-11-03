import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_SURFACE_BLOCKER,
  EXECUTION_SURFACE_ROUTE,
  assertExecutionSurfaceRouteV1,
  buildExecutionSurfaceRouteV1,
  classifyExecutionSurfaceRequirement,
} from './executionSurfaceRoutingPolicyV1.mjs';

const windowsGoal = {
  title: 'Accept the merged relay on the Battle Bridge',
  intent: 'Use the canonical Windows checkout and prove localhost 4173, 8787, 18789 plus the scheduled watchdog.',
};

test('Windows and Battle Bridge proof is classified as a local Windows capability requirement', () => {
  const requirement = classifyExecutionSurfaceRequirement(windowsGoal);
  assert.equal(requirement.requiresLocalWindowsProof, true);
  assert.equal(requirement.requiredCapability, 'can_local_windows_proof');
});

test('a missing Battle Bridge surface fails closed and forbids cloud Codex substitution', () => {
  const route = buildExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces: {} });
  assert.equal(route.routeReady, false);
  assert.equal(route.dispatchAllowed, false);
  assert.equal(route.cloudFallbackAllowed, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED);
  assert.deepEqual(route.forbiddenRoutes, ['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE']);
  assert.match(route.exactNextAction, /Do not use a plain GitHub @codex mention/);
});

test('an attached Linux surface is not accepted as a Windows Battle Bridge substitute', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: {
      attached: true,
      platform: 'linux',
      canLocalWindowsProof: true,
      heartbeatFresh: true,
      surfaceReceipt: 'surface-linux-1',
    },
  });
  assert.equal(route.routeReady, false);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH);
  assert.equal(route.battleBridge.isWindows, false);
  assert.throws(() => assertExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces: route.battleBridge }), /BLOCKED_ROUTE_CAPABILITY_MISMATCH/);
});

test('a verified fresh Windows handshake selects only the Remote Codex Battle Bridge route', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: {
      attached: true,
      platform: 'win32',
      canLocalWindowsProof: true,
      heartbeatFresh: true,
      surfaceReceipt: 'surface-windows-1',
    },
  });
  assert.equal(route.routeReady, true);
  assert.equal(route.dispatchAllowed, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(route.cloudFallbackAllowed, false);
  assert.equal(route.blocker, '');
});

test('ordinary source work remains in the ChatGPT plus GitHub lane', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Refactor route policy tests', intent: 'Change source and open a pull request.' },
  });
  assert.equal(route.requirement.requiresLocalWindowsProof, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.dispatchAllowed, false);
  assert.match(route.exactNextAction, /ChatGPT plus GitHub/);
});
