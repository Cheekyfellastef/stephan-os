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

function factsFor({ ui = true, stale = [], caveats = [], blockers = [] } = {}) {
  return {
    observedServices: { ...readyServices, 'stephanos-ui': { ready: ui }, 'shared-workspace': { ready: stale.length === 0 } },
    staleWorkspaceRecords: stale,
    caveats,
    safetyBlockers: blockers,
    finalVerdict: ui && stale.length === 0 && blockers.length === 0 ? 'ready' : 'partial-ui-missing',
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
      return collectCount === 1 ? factsFor({ ui: false, stale: ['old UNKNOWN'] }) : factsFor({ ui: true });
    },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true, logs: { logPath: path.join(workspace, 'logs', 'repair') } })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(0, 4), ['housekeeping', 'publisher', 'collect-1', 'repair']);
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
  assert.equal(result.status.phases['Stephanos UI 4173'].state, 'degraded');
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
