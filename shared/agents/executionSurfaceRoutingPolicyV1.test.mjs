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

const mixedGoal = {
  title: 'Repair source and prove it on Windows',
  intent: 'Modify repository code, open a pull request, then use the Battle Bridge to prove the served runtime on localhost 4173.',
};

const freshWindowsSurface = {
  attached: true,
  platform: 'win32',
  canLocalWindowsProof: true,
  heartbeatFresh: true,
  surfaceReceipt: 'surface-windows-1',
};

test('Windows and Battle Bridge proof is classified as a local Windows capability requirement', () => {
  const requirement = classifyExecutionSurfaceRequirement(windowsGoal);
  assert.equal(requirement.requiresLocalWindowsProof, true);
  assert.equal(requirement.requiresRepositoryWork, false);
  assert.equal(requirement.isMixedMission, false);
  assert.equal(requirement.requiredCapability, 'can_local_windows_proof');
});

test('a mixed repository plus Windows mission is classified into two capability requirements', () => {
  const requirement = classifyExecutionSurfaceRequirement(mixedGoal);
  assert.equal(requirement.requiresLocalWindowsProof, true);
  assert.equal(requirement.requiresRepositoryWork, true);
  assert.equal(requirement.isMixedMission, true);
  assert.equal(requirement.requiredCapability, 'can_write_repo+can_local_windows_proof');
});

test('a missing local surface still fails closed for a pure Windows task and forbids cloud Codex substitution', () => {
  const route = buildExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces: {} });
  assert.equal(route.routeReady, false);
  assert.equal(route.missionReady, false);
  assert.equal(route.dispatchAllowed, false);
  assert.equal(route.cloudFallbackAllowed, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED);
  assert.deepEqual(route.forbiddenRoutes, ['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE']);
  assert.match(route.exactNextAction, /OpenClaw Local or Remote Codex Battle Bridge/);
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
  assert.equal(route.localSurfaces.remoteCodex.isWindows, false);
  assert.throws(() => assertExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: {
      attached: true,
      platform: 'linux',
      canLocalWindowsProof: true,
      heartbeatFresh: true,
      surfaceReceipt: 'surface-linux-1',
    },
  }), /BLOCKED_ROUTE_CAPABILITY_MISMATCH/);
});

test('a verified fresh Remote Codex Windows handshake remains a valid pure local route', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: freshWindowsSurface,
  });
  assert.equal(route.routeReady, true);
  assert.equal(route.missionReady, true);
  assert.equal(route.dispatchAllowed, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(route.localRoute, EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(route.cloudFallbackAllowed, false);
  assert.equal(route.blocker, '');
});

test('a verified OpenClaw local Windows surface is preferred for local proof when available', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: {
      openClawLocal: {
        ...freshWindowsSurface,
        surfaceId: 'openclaw-battle-bridge-1',
        surfaceReceipt: 'openclaw-local-receipt-1',
      },
      remoteCodexBattleBridge: freshWindowsSurface,
    },
  });
  assert.equal(route.routeReady, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.OPENCLAW_LOCAL_BATTLE_BRIDGE);
  assert.equal(route.battleBridge.surfaceClass, 'OPENCLAW_LOCAL_BATTLE_BRIDGE');
});

test('ordinary source work remains in ChatGPT plus GitHub when Work capability is not proven', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Refactor route policy tests', intent: 'Change source and open a pull request.' },
  });
  assert.equal(route.requirement.requiresLocalWindowsProof, false);
  assert.equal(route.requirement.requiresRepositoryWork, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.missionReady, true);
  assert.equal(route.dispatchAllowed, false);
  assert.match(route.exactNextAction, /ChatGPT plus GitHub/);
});

test('proven ChatGPT Work repository capability is selected without granting local Windows authority', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Implement source repair', intent: 'Modify repository code and open a pull request.' },
    surfaces: {
      chatgptWork: {
        available: true,
        canRepositoryWork: true,
        capabilityReceipt: 'work-capability-1',
      },
    },
  });
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB);
  assert.equal(route.sourceRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB);
  assert.equal(route.localRoute, EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.localSubtaskReady, false);
  assert.equal(route.missionReady, true);
  assert.match(route.exactNextAction, /ChatGPT Work plus GitHub/);
});

test('mixed mission continues repository work when local Windows execution is temporarily unavailable', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: mixedGoal,
    surfaces: {
      chatgptWork: {
        available: true,
        canRepositoryWork: true,
        capabilityReceipt: 'work-capability-2',
      },
    },
  });
  assert.equal(route.routeReady, true);
  assert.equal(route.missionReady, false);
  assert.equal(route.partialProgressAllowed, true);
  assert.equal(route.sourceSubtaskReady, true);
  assert.equal(route.localSubtaskReady, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.LOCAL_SUBTASK_PENDING);
  assert.equal(route.localBlocker, EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED);
  assert.match(route.exactNextAction, /Continue the repository\/source phase/);
  assert.match(route.exactNextAction, /do not report the whole mission as unable to proceed/);
  assert.doesNotThrow(() => assertExecutionSurfaceRouteV1({
    goal: mixedGoal,
    surfaces: {
      chatgptWork: { available: true, canRepositoryWork: true },
    },
  }));
});

test('mixed mission routes repository and local subtasks independently when OpenClaw local is ready', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: mixedGoal,
    surfaces: {
      chatgptWork: { available: true, canRepositoryWork: true },
      openClawLocal: {
        ...freshWindowsSurface,
        surfaceId: 'openclaw-battle-bridge-2',
        surfaceReceipt: 'openclaw-local-receipt-2',
      },
    },
  });
  assert.equal(route.routeReady, true);
  assert.equal(route.missionReady, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.MIXED_WORK_AND_LOCAL);
  assert.deepEqual(route.selectedRoutes, [
    EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB,
    EXECUTION_SURFACE_ROUTE.OPENCLAW_LOCAL_BATTLE_BRIDGE,
  ]);
  assert.equal(route.sourceRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB);
  assert.equal(route.localRoute, EXECUTION_SURFACE_ROUTE.OPENCLAW_LOCAL_BATTLE_BRIDGE);
  assert.equal(route.sourceSubtaskReady, true);
  assert.equal(route.localSubtaskReady, true);
  assert.equal(route.dispatchAllowed, true);
  assert.match(route.exactNextAction, /Preserve one mission identity/);
});

test('mixed mission can use GitHub-first source work and Remote Codex local proof without confusing the two phases', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: mixedGoal,
    surfaces: {
      remoteCodexBattleBridge: freshWindowsSurface,
    },
  });
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.MIXED_WORK_AND_LOCAL);
  assert.deepEqual(route.selectedRoutes, [
    EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST,
    EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE,
  ]);
  assert.equal(route.missionReady, true);
  assert.equal(route.blocker, '');
});
