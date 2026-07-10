import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BATTLE_BRIDGE_IGNITION_AUTHORITY,
  BATTLE_BRIDGE_IGNITION_PHASES,
  BATTLE_BRIDGE_IGNITION_PHASE_STATES,
  createBattleBridgeSupervisorStatus,
  projectBattleBridgeSupervisorStatus,
  runBattleBridgeIgnitionSupervisor,
} from './battle-bridge-ignition-supervisor.mjs';

const readyServices = {
  backend: { ready: true },
  'openclaw-gateway': { ready: true },
  'stephanos-ui': { ready: true },
  'shared-workspace': { ready: true },
};

function factsFor({ backend = true, openclaw = true, ui = true, stale = [], caveats = [], blockers = [] } = {}) {
  return {
    observedServices: { ...readyServices, backend: { ready: backend }, 'openclaw-gateway': { ready: openclaw }, 'stephanos-ui': { ready: ui }, 'shared-workspace': { ready: stale.length === 0 } },
    staleWorkspaceRecords: stale,
    caveats,
    safetyBlockers: blockers,
    finalVerdict: backend && openclaw && ui && stale.length === 0 && blockers.length === 0 ? 'ready' : 'partial-ui-missing',
  };
}

test('supervisor status model exposes required phases and states', () => {
  const status = createBattleBridgeSupervisorStatus();
  assert.deepEqual(Object.keys(status.phases), [...BATTLE_BRIDGE_IGNITION_PHASES]);
  assert.deepEqual([...BATTLE_BRIDGE_IGNITION_PHASE_STATES], ['pending', 'running', 'ready', 'degraded', 'blocked', 'failed']);
  const updated = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: 'ready', readinessReport: factsFor() });
  assert.equal(updated.currentPhase, 'backend 8787');
  assert.equal(updated.services.backend8787.ready, true);
  assert.equal(updated.trafficLight, 'blue');
});

test('publisher is refreshed before UI repair and stale records are refreshed by supervisor', async () => {
  const calls = [];
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-supervisor-'));
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    sharedWorkspace: workspace,
    housekeepFn: () => calls.push('housekeeping'),
    publisherFn: async () => { calls.push('publisher'); },
    sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => {
      collectCount += 1;
      calls.push(`collect-${collectCount}`);
      return collectCount === 1 ? factsFor({ ui: false, stale: ['old UNKNOWN'] }) : factsFor({ ui: collectCount > 2 });
    },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready && !(facts.staleWorkspaceRecords || []).length ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true, logs: { logPath: path.join(workspace, 'logs', 'repair') } })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(0, 5), ['housekeeping', 'publisher', 'collect-1', 'publisher', 'collect-2']);
  assert.equal(calls.includes('repair'), true);
  assert.equal(calls.includes('publisher'), true);
  assert.equal(fs.existsSync(path.join(workspace, 'status', 'battle-bridge-ignition-supervisor-current.json')), true);
});

test('partial-ui-missing triggers repair and ready is only reported after 4173 proof', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {},
    publisherFn: async () => {},
    sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => { collectCount += 1; return factsFor({ ui: collectCount > 1 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true })); return 0; },
    stdout: { write() {} },
  });
  assert.deepEqual(calls, ['repair']);
  assert.equal(result.status.phases.ready.state, 'ready');
});

test('missing 4173 repair attempt records structured degraded result when proof does not become ready', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { stdout.write(JSON.stringify({ ready: false, action: 'start-ui-4173-spawned-but-not-ready' })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.phases['Stephanos UI 4173'].state, 'blocked');
  assert.notEqual(result.status.phases.ready.state, 'ready');
});

test('non-main stale branch reports blocker to splash/status model', async () => {
  const blocker = { id: 'non-main-source-truth', detail: 'non-main branch', nextOperatorAction: 'Switch through approved source update path.' };
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ blocker }), stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'non-main-source-truth');
  assert.equal(result.status.phases['source truth'].state, 'blocked');
});

test('tracked runtime activity dirt guidance and runtime-only dist caveat are separate', () => {
  const trackedBlocker = { id: 'tracked-runtime-activity-dirt', detail: 'Preserve then restore runtime activity.', nextOperatorAction: 'Preserve runtime activity, restore tracked files, then retry.' };
  const status = projectBattleBridgeSupervisorStatus({ status: createBattleBridgeSupervisorStatus(), readinessReport: factsFor({ caveats: [{ id: 'runtime-only-dirt', detail: 'dist dirt caveat' }], blockers: [trackedBlocker] }) });
  assert.equal(status.blockerId, 'tracked-runtime-activity-dirt');
  assert.equal(status.runtimeOnlyDirtCaveat.id, 'runtime-only-dirt');
  assert.match(status.nextOperatorAction, /Preserve runtime activity/);
});

test('supervisor authority introduces no arbitrary shell, process kill, or OpenClaw mutation', () => {
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.executesArbitraryShell, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.killsProcesses, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.mutatesOpenClaw, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.uiRepairAuthority.executesArbitraryShell, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.uiRepairAuthority.killsProcesses, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.uiRepairAuthority.startsOpenClawGateway18789, false);
});

test('backend missing plus UI missing does not enter browser/runtime proof and starts approved backend first', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => { collectCount += 1; return factsFor({ backend: collectCount > 1, ui: false }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices.backend.ready ? 'partial-ui-missing' : 'blocked-needs-supervisor-repair' }),
    backendStartFn: async ({ commandIdentity }) => { calls.push(commandIdentity.commandText); return { started: true, commandIdentity }; },
    repairFn: async ({ stdout }) => { calls.push('ui-repair'); stdout.write(JSON.stringify({ ready: false })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(calls[0], 'npm run stephanos:battle-bridge:repair');
  assert.equal(result.status.blockerId, 'stephanos-ui-4173-missing');
});

test('backend missing has deterministic backend blocker and no empty blockerId when approved start fails proof', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ started: false }),
    repairFn: async () => { throw new Error('ui repair must not run without backend'); },
    stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-missing');
  assert.equal(result.status.phases['browser/runtime proof'].state, 'pending');
  assert.match(result.status.nextOperatorAction, /npm run stephanos:battle-bridge:repair/);
});

test('backend start unavailable returns adapter blocker', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ unavailable: true }),
    stdout: { write() {} },
  });
  assert.equal(result.status.blockerId, 'backend-8787-start-unavailable');
  assert.match(result.status.nextOperatorAction, /safe backend start adapter/);
});

test('backend and OpenClaw ready with UI missing refreshes publisher before UI repair', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => { calls.push('publisher'); }, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => { collectCount += 1; return collectCount === 1 ? factsFor({ ui: false, stale: ['old UNKNOWN'] }) : factsFor({ ui: collectCount > 2 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(calls.indexOf('publisher') < calls.indexOf('repair'), true);
  assert.equal(result.ok, true);
});
