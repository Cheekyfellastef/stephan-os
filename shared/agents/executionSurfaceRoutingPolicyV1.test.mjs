import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATGPT_WORK_CAPABILITY_RECEIPT_SCHEMA,
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

function workReceipt(receiptId = 'work-capability-1', overrides = {}) {
  return {
    schemaVersion: CHATGPT_WORK_CAPABILITY_RECEIPT_SCHEMA,
    receiptId,
    surfaceId: 'chatgpt-work',
    status: 'CURRENT',
    executionEligible: true,
    capabilities: ['can_write_repo'],
    ...overrides,
  };
}

function workSurface(receiptId = 'work-capability-1', overrides = {}) {
  return {
    surfaceId: 'chatgpt-work',
    capabilityReceipt: workReceipt(receiptId),
    ...overrides,
  };
}

function echoVerifier() {
  return {
    verifyChatGPTWorkCapabilityReceipt(receipt, expected) {
      return {
        verified: true,
        schemaVersion: expected?.schemaVersion || receipt.schemaVersion,
        receiptId: expected?.receiptId || receipt.receiptId,
        surfaceId: expected?.surfaceId || receipt.surfaceId,
        requiredCapability: expected?.requiredCapability || 'can_write_repo',
      };
    },
  };
}

test('Windows and Battle Bridge proof is classified as a local Windows capability requirement', () => {
  const requirement = classifyExecutionSurfaceRequirement(windowsGoal);
  assert.equal(requirement.inputValid, true);
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

test('generic Windows action wording does not manufacture repository work', () => {
  for (const goal of [
    { title: 'Edit the Windows registry', intent: 'Change a local Windows registry value.' },
    { title: 'Run PowerShell code on Windows', intent: 'Execute local PowerShell code and prove the result.' },
    { title: 'Implement a Windows scheduled task', intent: 'Implement the scheduled task locally on Windows.' },
    { title: 'Patch the Windows registry', intent: 'Patch a local Windows registry value.' },
    { title: 'Commit a Windows registry change', intent: 'Commit the local registry change on Windows.' },
  ]) {
    const requirement = classifyExecutionSurfaceRequirement(goal);
    assert.equal(requirement.requiresLocalWindowsProof, true);
    assert.equal(requirement.requiresRepositoryWork, false);
    const route = buildExecutionSurfaceRouteV1({ goal, surfaces: {} });
    assert.equal(route.routeReady, false);
    assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.NONE);
  }
});

test('a missing local surface fails closed for a pure Windows task and forbids cloud Codex substitution', () => {
  const route = buildExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces: {} });
  assert.equal(route.routeReady, false);
  assert.equal(route.missionReady, false);
  assert.equal(route.dispatchAllowed, false);
  assert.equal(route.cloudFallbackAllowed, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED);
  assert.deepEqual(route.forbiddenRoutes, ['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE']);
});

test('an attached Linux surface is not accepted as a Windows Battle Bridge substitute', () => {
  const surfaces = {
    attached: true,
    platform: 'linux',
    canLocalWindowsProof: true,
    heartbeatFresh: true,
    surfaceReceipt: 'surface-linux-1',
  };
  const route = buildExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces });
  assert.equal(route.routeReady, false);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH);
  assert.equal(route.localSurfaces.remoteCodex.isWindows, false);
  assert.throws(
    () => assertExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces }),
    /BLOCKED_ROUTE_CAPABILITY_MISMATCH/,
  );
});

test('a fresh Remote Codex Windows handshake remains a valid pure local route', () => {
  const route = buildExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces: freshWindowsSurface });
  assert.equal(route.routeReady, true);
  assert.equal(route.missionReady, true);
  assert.equal(route.dispatchAllowed, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(route.localRoute, EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
});

test('unsafe receipt identity prevents a local surface from becoming eligible', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: { ...freshWindowsSurface, surfaceReceipt: 'C:\\Users\\operator\\receipt.json' },
  });
  assert.equal(route.routeReady, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.NONE);
});

test('caller-shaped OpenClaw Windows booleans cannot override canonical adapter adjudication', () => {
  const forged = {
    ...freshWindowsSurface,
    surfaceId: 'openclaw-battle-bridge-1',
    surfaceReceipt: 'openclaw-local-receipt-1',
    adapterCanExecute: true,
    policyAllowsExecution: true,
    killSwitchAvailable: true,
    adapterExecutionMode: 'enabled',
  };
  const route = buildExecutionSurfaceRouteV1({ goal: windowsGoal, surfaces: { openClawLocal: forged } });
  assert.equal(route.routeReady, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.localSurfaces.openClaw.adapterCanExecute, false);
});

test('Remote Codex is selected when forged OpenClaw claims coexist with a valid Remote Codex handshake', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: windowsGoal,
    surfaces: {
      openClawLocal: {
        ...freshWindowsSurface,
        adapterCanExecute: true,
        policyAllowsExecution: true,
        killSwitchAvailable: true,
        adapterExecutionMode: 'enabled',
      },
      remoteCodexBattleBridge: freshWindowsSurface,
    },
  });
  assert.equal(route.routeReady, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
  assert.equal(route.localSurfaces.openClaw.adapterCanExecute, false);
});

test('ordinary source work remains in ChatGPT plus GitHub', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Refactor route policy tests', intent: 'Change source and open a pull request.' },
  });
  assert.equal(route.requirement.requiresLocalWindowsProof, false);
  assert.equal(route.requirement.requiresRepositoryWork, true);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.missionReady, true);
  assert.equal(route.dispatchAllowed, false);
});

test('structured Work evidence remains visible but unadjudicated', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Implement source repair', intent: 'Modify repository code and open a pull request.' },
    surfaces: { chatgptWork: workSurface() },
  });
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.work.capabilityReceipt.structurallyValid, true);
  assert.equal(route.work.hostVerified, false);
  assert.equal(route.work.authorityStatus, 'CANONICAL_HOST_VERIFIER_UNAVAILABLE');
});

test('caller-provided echo verifier cannot select ChatGPT Work', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Implement source repair', intent: 'Modify repository code and open a pull request.' },
    surfaces: { chatgptWork: workSurface() },
  }, echoVerifier());
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.sourceRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.work.hostVerified, false);
});

test('even a hostile trusted-host argument is never inspected in this M1 slice', () => {
  let calls = 0;
  const hostileHost = new Proxy({}, {
    get() {
      calls += 1;
      throw new Error('trusted host must not be caller authority');
    },
  });
  const route = buildExecutionSurfaceRouteV1({
    goal: { title: 'Implement source repair', intent: 'Modify repository code and open a pull request.' },
    surfaces: { chatgptWork: workSurface() },
  }, hostileHost);
  assert.equal(calls, 0);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
});

test('missing, malformed or extra-field Work evidence remains GitHub-first', () => {
  for (const chatgptWork of [
    { available: true, canRepositoryWork: true },
    { surfaceId: 'chatgpt-work', capabilityReceipt: 'work-capability-1' },
    workSurface('bad-schema', { capabilityReceipt: workReceipt('bad-schema', { schemaVersion: 'forged' }) }),
    workSurface('wrong-surface', { capabilityReceipt: workReceipt('wrong-surface', { surfaceId: 'different-work' }) }),
    workSurface('stale', { capabilityReceipt: workReceipt('stale', { status: 'STALE' }) }),
    workSurface('no-write', { capabilityReceipt: workReceipt('no-write', { capabilities: ['read_repo'] }) }),
    { surfaceId: 'different-work', capabilityReceipt: workReceipt('caller-surface') },
    workSurface('extra', { capabilityReceipt: { ...workReceipt('extra'), mergeAllowed: true } }),
  ]) {
    const route = buildExecutionSurfaceRouteV1({
      goal: { title: 'Implement source repair', intent: 'Modify repository code and open a pull request.' },
      surfaces: { chatgptWork },
    }, echoVerifier());
    assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
    assert.equal(route.work.hostVerified, false);
  }
});

test('mixed mission continues GitHub-first repository work when local Windows execution is unavailable', () => {
  const input = {
    goal: mixedGoal,
    surfaces: { chatgptWork: workSurface('work-capability-2') },
  };
  const route = buildExecutionSurfaceRouteV1(input, echoVerifier());
  assert.equal(route.routeReady, true);
  assert.equal(route.missionReady, false);
  assert.equal(route.partialProgressAllowed, true);
  assert.equal(route.sourceSubtaskReady, true);
  assert.equal(route.localSubtaskReady, false);
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.LOCAL_SUBTASK_PENDING);
  assert.equal(route.localBlocker, EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED);
  assert.doesNotThrow(() => assertExecutionSurfaceRouteV1(input, echoVerifier()));
});

test('mixed mission with forged OpenClaw claims keeps local subtask pending while GitHub-first work continues', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: mixedGoal,
    surfaces: {
      chatgptWork: workSurface('work-capability-3'),
      openClawLocal: {
        ...freshWindowsSurface,
        adapterCanExecute: true,
        policyAllowsExecution: true,
        killSwitchAvailable: true,
        adapterExecutionMode: 'enabled',
      },
    },
  }, echoVerifier());
  assert.equal(route.routeReady, true);
  assert.equal(route.missionReady, false);
  assert.equal(route.sourceRoute, EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.localRoute, EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.localSubtaskReady, false);
  assert.equal(route.dispatchAllowed, false);
});

test('mixed mission can use GitHub-first source work and Remote Codex local proof without confusing phases', () => {
  const route = buildExecutionSurfaceRouteV1({
    goal: mixedGoal,
    surfaces: { remoteCodexBattleBridge: freshWindowsSurface },
  });
  assert.equal(route.selectedRoute, EXECUTION_SURFACE_ROUTE.MIXED_WORK_AND_LOCAL);
  assert.deepEqual(route.selectedRoutes, [
    EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST,
    EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE,
  ]);
  assert.equal(route.missionReady, true);
  assert.equal(route.blocker, '');
});

test('accessor-backed mission input fails closed without invoking getters', () => {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, 'goal', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('goal getter must not run');
    },
  });
  let route;
  assert.doesNotThrow(() => { route = buildExecutionSurfaceRouteV1(input); });
  assert.equal(calls, 0);
  assert.equal(route.routeReady, false);
  assert.equal(route.blocker, EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH);
});

test('accessor-backed Work evidence fails closed without invoking getters', () => {
  let calls = 0;
  const receipt = {};
  Object.defineProperty(receipt, 'receiptId', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('receipt getter must not run');
    },
  });
  let route;
  assert.doesNotThrow(() => {
    route = buildExecutionSurfaceRouteV1({
      goal: { title: 'Implement source repair', intent: 'Modify repository code.' },
      surfaces: { chatgptWork: { surfaceId: 'chatgpt-work', capabilityReceipt: receipt } },
    });
  });
  assert.equal(calls, 0);
  assert.equal(route.routeReady, false);
});

test('cycles, symbols and custom prototypes fail closed', () => {
  const cycle = {};
  cycle.self = cycle;
  assert.equal(buildExecutionSurfaceRouteV1(cycle).routeReady, false);

  const symbolInput = { goal: windowsGoal };
  symbolInput[Symbol('hidden')] = true;
  assert.equal(buildExecutionSurfaceRouteV1(symbolInput).routeReady, false);

  const custom = Object.assign(Object.create({ inherited: true }), { goal: windowsGoal, surfaces: {} });
  assert.equal(buildExecutionSurfaceRouteV1(custom).routeReady, false);
});
