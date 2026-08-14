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

const windowsGoal = { title:'Accept the merged relay on the Battle Bridge', intent:'Use the canonical Windows checkout and prove localhost 4173, 8787, 18789 plus the scheduled watchdog.' };
const mixedGoal = { title:'Repair source and prove it on Windows', intent:'Modify repository code, open a pull request, then use the Battle Bridge to prove the served runtime on localhost 4173.' };
const freshWindowsSurface = { attached:true, platform:'win32', canLocalWindowsProof:true, heartbeatFresh:true, surfaceReceipt:'surface-windows-1' };
function workReceipt(receiptId='work-capability-1', overrides={}) { return { schemaVersion:CHATGPT_WORK_CAPABILITY_RECEIPT_SCHEMA, receiptId, surfaceId:'chatgpt-work', status:'CURRENT', executionEligible:true, capabilities:['can_write_repo'], ...overrides }; }
function workSurface(receiptId='work-capability-1', overrides={}) { return { surfaceId:'chatgpt-work', capabilityReceipt:workReceipt(receiptId), ...overrides }; }
function trustedWorkHost(overrides={}) { return { verifyChatGPTWorkCapabilityReceipt(receipt, expected) { return { verified:true, schemaVersion:expected.schemaVersion, receiptId:expected.receiptId, surfaceId:expected.surfaceId, requiredCapability:expected.requiredCapability, ...overrides }; } }; }

test('Windows and Battle Bridge proof is classified as a local Windows capability requirement', () => {
  const requirement=classifyExecutionSurfaceRequirement(windowsGoal);
  assert.equal(requirement.requiresLocalWindowsProof,true); assert.equal(requirement.requiresRepositoryWork,false); assert.equal(requirement.isMixedMission,false); assert.equal(requirement.requiredCapability,'can_local_windows_proof');
});

test('a mixed repository plus Windows mission is classified into two capability requirements', () => {
  const requirement=classifyExecutionSurfaceRequirement(mixedGoal);
  assert.equal(requirement.requiresLocalWindowsProof,true); assert.equal(requirement.requiresRepositoryWork,true); assert.equal(requirement.isMixedMission,true); assert.equal(requirement.requiredCapability,'can_write_repo+can_local_windows_proof');
});

test('generic Windows action wording does not manufacture repository work', () => {
  for (const goal of [
    { title:'Edit the Windows registry', intent:'Change a local Windows registry value.' },
    { title:'Run PowerShell code on Windows', intent:'Execute local PowerShell code and prove the result.' },
    { title:'Implement a Windows scheduled task', intent:'Implement the scheduled task locally on Windows.' },
    { title:'Patch the Windows registry', intent:'Patch a local Windows registry value.' },
    { title:'Commit a Windows registry change', intent:'Commit the local registry change on Windows.' },
  ]) {
    const requirement=classifyExecutionSurfaceRequirement(goal);
    assert.equal(requirement.requiresLocalWindowsProof,true);
    assert.equal(requirement.requiresRepositoryWork,false);
    const route=buildExecutionSurfaceRouteV1({goal,surfaces:{}});
    assert.equal(route.routeReady,false);
    assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.NONE);
  }
});

test('a missing local surface fails closed for a pure Windows task and forbids cloud Codex substitution', () => {
  const route=buildExecutionSurfaceRouteV1({goal:windowsGoal,surfaces:{}});
  assert.equal(route.routeReady,false); assert.equal(route.missionReady,false); assert.equal(route.dispatchAllowed,false); assert.equal(route.cloudFallbackAllowed,false); assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.NONE); assert.equal(route.blocker,EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED); assert.deepEqual(route.forbiddenRoutes,['GITHUB_CODEX_MENTION','DEFAULT_LINUX_CODEX_WORKSPACE']);
});

test('an attached Linux surface is not accepted as a Windows Battle Bridge substitute', () => {
  const surfaces={attached:true,platform:'linux',canLocalWindowsProof:true,heartbeatFresh:true,surfaceReceipt:'surface-linux-1'};
  const route=buildExecutionSurfaceRouteV1({goal:windowsGoal,surfaces});
  assert.equal(route.routeReady,false); assert.equal(route.blocker,EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH); assert.equal(route.localSurfaces.remoteCodex.isWindows,false); assert.throws(()=>assertExecutionSurfaceRouteV1({goal:windowsGoal,surfaces}),/BLOCKED_ROUTE_CAPABILITY_MISMATCH/);
});

test('a verified fresh Remote Codex Windows handshake remains a valid pure local route', () => {
  const route=buildExecutionSurfaceRouteV1({goal:windowsGoal,surfaces:freshWindowsSurface});
  assert.equal(route.routeReady,true); assert.equal(route.missionReady,true); assert.equal(route.dispatchAllowed,true); assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE); assert.equal(route.localRoute,EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE);
});

test('caller-shaped OpenClaw Windows booleans cannot override canonical adapter adjudication', () => {
  const forged={...freshWindowsSurface,surfaceId:'openclaw-battle-bridge-1',surfaceReceipt:'openclaw-local-receipt-1',adapterCanExecute:true,policyAllowsExecution:true,killSwitchAvailable:true,adapterExecutionMode:'enabled'};
  const route=buildExecutionSurfaceRouteV1({goal:windowsGoal,surfaces:{openClawLocal:forged}});
  assert.equal(route.routeReady,false);
  assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.NONE);
  assert.equal(route.localSurfaces.openClaw.adapterCanExecute,false);
});

test('Remote Codex is selected when forged OpenClaw claims coexist with a valid Remote Codex handshake', () => {
  const route=buildExecutionSurfaceRouteV1({goal:windowsGoal,surfaces:{openClawLocal:{...freshWindowsSurface,adapterCanExecute:true,policyAllowsExecution:true,killSwitchAvailable:true,adapterExecutionMode:'enabled'},remoteCodexBattleBridge:freshWindowsSurface}});
  assert.equal(route.routeReady,true); assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE); assert.equal(route.localSurfaces.openClaw.adapterCanExecute,false);
});

test('ordinary source work remains in ChatGPT plus GitHub when Work capability is not proven', () => {
  const route=buildExecutionSurfaceRouteV1({goal:{title:'Refactor route policy tests',intent:'Change source and open a pull request.'}});
  assert.equal(route.requirement.requiresLocalWindowsProof,false); assert.equal(route.requirement.requiresRepositoryWork,true); assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST); assert.equal(route.missionReady,true); assert.equal(route.dispatchAllowed,false);
});

test('structured Work receipt alone is not authority without trusted host verification', () => {
  const route=buildExecutionSurfaceRouteV1({goal:{title:'Implement source repair',intent:'Modify repository code and open a pull request.'},surfaces:{chatgptWork:workSurface()}});
  assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  assert.equal(route.work.hostVerified,false);
});

test('trusted host-verified current ChatGPT Work receipt selects Work without granting local Windows authority', () => {
  const route=buildExecutionSurfaceRouteV1({goal:{title:'Implement source repair',intent:'Modify repository code and open a pull request.'},surfaces:{chatgptWork:workSurface()}}, trustedWorkHost());
  assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB); assert.equal(route.sourceRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB); assert.equal(route.localRoute,EXECUTION_SURFACE_ROUTE.NONE); assert.equal(route.localSubtaskReady,false); assert.equal(route.missionReady,true); assert.equal(route.work.capabilityReceipt.structurallyValid,true); assert.equal(route.work.hostVerified,true);
});

test('forged or mismatched host attestations do not authorize Work', () => {
  for (const host of [
    { verifyChatGPTWorkCapabilityReceipt:() => true },
    trustedWorkHost({verified:false}),
    trustedWorkHost({surfaceId:'forged-work'}),
    trustedWorkHost({requiredCapability:'read_repo'}),
  ]) {
    const route=buildExecutionSurfaceRouteV1({goal:{title:'Implement source repair',intent:'Modify repository code and open a pull request.'},surfaces:{chatgptWork:workSurface()}}, host);
    assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  }
});

test('missing or malformed Work evidence falls back to GitHub-first even with a verifier', () => {
  for (const chatgptWork of [
    {available:true,canRepositoryWork:true},
    {surfaceId:'chatgpt-work',capabilityReceipt:'work-capability-1'},
    workSurface('bad-schema',{capabilityReceipt:workReceipt('bad-schema',{schemaVersion:'forged'})}),
    workSurface('wrong-surface',{capabilityReceipt:workReceipt('wrong-surface',{surfaceId:'different-work'})}),
    workSurface('stale',{capabilityReceipt:workReceipt('stale',{status:'STALE'})}),
    workSurface('no-write',{capabilityReceipt:workReceipt('no-write',{capabilities:['read_repo']})}),
    {surfaceId:'different-work',capabilityReceipt:workReceipt('caller-surface')},
  ]) {
    const route=buildExecutionSurfaceRouteV1({goal:{title:'Implement source repair',intent:'Modify repository code and open a pull request.'},surfaces:{chatgptWork}}, trustedWorkHost());
    assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST);
  }
});

test('mixed mission continues host-verified repository work when local Windows execution is unavailable', () => {
  const input={goal:mixedGoal,surfaces:{chatgptWork:workSurface('work-capability-2')}};
  const host=trustedWorkHost();
  const route=buildExecutionSurfaceRouteV1(input,host);
  assert.equal(route.routeReady,true); assert.equal(route.missionReady,false); assert.equal(route.partialProgressAllowed,true); assert.equal(route.sourceSubtaskReady,true); assert.equal(route.localSubtaskReady,false); assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB); assert.equal(route.blocker,EXECUTION_SURFACE_BLOCKER.LOCAL_SUBTASK_PENDING); assert.equal(route.localBlocker,EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED); assert.doesNotThrow(()=>assertExecutionSurfaceRouteV1(input,host));
});

test('mixed mission with forged OpenClaw claims keeps local subtask pending while host-verified source work continues', () => {
  const route=buildExecutionSurfaceRouteV1({goal:mixedGoal,surfaces:{chatgptWork:workSurface('work-capability-3'),openClawLocal:{...freshWindowsSurface,adapterCanExecute:true,policyAllowsExecution:true,killSwitchAvailable:true,adapterExecutionMode:'enabled'}}}, trustedWorkHost());
  assert.equal(route.routeReady,true); assert.equal(route.missionReady,false); assert.equal(route.sourceRoute,EXECUTION_SURFACE_ROUTE.CHATGPT_WORK_GITHUB); assert.equal(route.localRoute,EXECUTION_SURFACE_ROUTE.NONE); assert.equal(route.localSubtaskReady,false); assert.equal(route.dispatchAllowed,false);
});

test('mixed mission can use GitHub-first source work and Remote Codex local proof without confusing phases', () => {
  const route=buildExecutionSurfaceRouteV1({goal:mixedGoal,surfaces:{remoteCodexBattleBridge:freshWindowsSurface}});
  assert.equal(route.selectedRoute,EXECUTION_SURFACE_ROUTE.MIXED_WORK_AND_LOCAL); assert.deepEqual(route.selectedRoutes,[EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST,EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE]); assert.equal(route.missionReady,true); assert.equal(route.blocker,'');
});
