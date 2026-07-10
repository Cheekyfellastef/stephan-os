import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {
  BATTLE_BRIDGE_IGNITION_AUTHORITY,
  BATTLE_BRIDGE_IGNITION_PHASES,
  BATTLE_BRIDGE_IGNITION_PHASE_STATES,
  createBattleBridgeSupervisorStatus,
  projectBattleBridgeSupervisorStatus,
  runApprovedBackend8787Start,
  defaultBattleBridgeSharedWorkspace,
  runBattleBridgeIgnitionSupervisor,
  evaluateServedRuntimeExactHeadProof,
} from './battle-bridge-ignition-supervisor.mjs';


const readyRuntimeProof = async () => ({ ready: true, currentHead: '51600ceb00000000000000000000000000000000', healthOk: true, distOk: true, gitCommitMatches: true, runtimeMarkerMatches: true, gitCommit: '51600ceb', runtimeMarker: 'antifriction-live-v3::51600ceb::fixture' });

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
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
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
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
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
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.phases['Stephanos UI 4173'].state, 'blocked');
  assert.notEqual(result.status.phases.ready.state, 'ready');
});

test('non-main stale branch reports blocker to splash/status model', async () => {
  const blocker = { id: 'non-main-source-truth', detail: 'non-main branch', nextOperatorAction: 'Switch through approved source update path.' };
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ blocker }), runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
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
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
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
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-repair-failed');
  assert.equal(result.status.phases['browser/runtime proof'].state, 'pending');
  assert.match(result.status.nextOperatorAction, /backend repair logs|npm run stephanos:battle-bridge:repair/);
});

test('backend start unavailable returns adapter blocker', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ unavailable: true }),
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.status.blockerId, 'backend-8787-start-unavailable');
  assert.match(result.status.nextOperatorAction, /safe backend start adapter/);
});



test('default shared workspace is canonical Documents path, not temp Battle Bridge workspace', () => {
  const workspace = defaultBattleBridgeSharedWorkspace({ env: { USERPROFILE: 'C:\\Users\\Stephan' }, platform: 'win32' });
  assert.equal(workspace, path.join('C:\\Users\\Stephan', 'Documents', 'Stephanos-openclaw-workspace'));
  assert.doesNotMatch(workspace, /AppData|Temp|stephanos-battle-bridge-workspace/i);
});



test('approved backend repair command captures stdout stderr exit code and canonical log paths', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-repair-'));
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  const promise = runApprovedBackend8787Start({
    sharedWorkspace: workspace,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.end('backend stdout proof\n');
        child.stderr.end('backend stderr proof\n');
        child.emit('exit', 0, null);
      });
      return child;
    },
  });
  const result = await promise;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(spawnCalls[0].command, 'npm');
  assert.deepEqual(spawnCalls[0].args, ['run', 'stephanos:battle-bridge:repair']);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(result.exitCode, 0);
  assert.match(result.logPath, /battle-bridge-backend-8787-repair/);
  assert.equal(fs.readFileSync(result.logs.stdoutLogPath, 'utf8'), 'backend stdout proof\n');
  assert.equal(fs.readFileSync(result.logs.stderrLogPath, 'utf8'), 'backend stderr proof\n');
});


test('backend repair success without health proof blocks with no-health-proof and surfaces canonical logPath', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-supervisor-canonical-'));
  const logPath = path.join(workspace, 'logs', 'battle-bridge-backend-8787-repair', 'fixture');
  const result = await runBattleBridgeIgnitionSupervisor({
    sharedWorkspace: workspace, housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ started: true, exitCode: 0, logPath, logs: { logPath, stdoutLogPath: path.join(logPath, 'stdout.log'), stderrLogPath: path.join(logPath, 'stderr.log') } }),
    repairFn: async () => { throw new Error('ui repair must not run without backend health proof'); },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-repair-no-health-proof');
  assert.equal(result.status.phases['backend 8787'].logPath, logPath);
  assert.equal(result.status.services.backend8787.repair.logPath, logPath);
});

test('backend repair nonzero blocks with backend repair failed and does not run UI repair', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ started: false, exitCode: 7, logPath: '/canonical/log' }),
    repairFn: async () => { calls.push('ui-repair'); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-repair-failed');
  assert.deepEqual(calls, []);
});


test('backend and OpenClaw ready with UI missing refreshes publisher before UI repair', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => { calls.push('publisher'); }, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => { collectCount += 1; return collectCount === 1 ? factsFor({ ui: false, stale: ['old UNKNOWN'] }) : factsFor({ ui: collectCount > 2 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true })); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(calls.indexOf('publisher') < calls.indexOf('repair'), true);
  assert.equal(result.ok, true);
});

test('served runtime exact-head proof accepts full or unambiguous short head in gitCommit and runtimeMarker', () => {
  const currentHead = '51600ceb1234567890abcdef1234567890abcdef';
  const proof = evaluateServedRuntimeExactHeadProof({
    currentHead,
    health: { ok: true, gitCommit: '51600ceb', runtimeMarker: 'antifriction-live-v3::51600ceb::fixture', buildTimestamp: '2026-07-10T00:00:00.000Z' },
    dist: { ok: true, statusCode: 200 },
  });
  assert.equal(proof.ready, true);
});

test('supervisor blocks with served-runtime-stale when 4173 reports old gitCommit after guarded repair', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor(),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'ready' }),
    currentHeadFn: () => '51600ceb1234567890abcdef1234567890abcdef',
    runtimeProofFn: async ({ currentHead }) => evaluateServedRuntimeExactHeadProof({ currentHead, health: { ok: true, gitCommit: '0f0aa30d', runtimeMarker: 'antifriction-live-v3::0f0aa30d::fixture' }, dist: { ok: true, statusCode: 200 } }),
    repairFn: async ({ stdout }) => { stdout.write(JSON.stringify({ ready: true })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'served-runtime-stale');
  assert.equal(result.status.currentPhase, 'browser/runtime proof');
  assert.match(result.status.nextOperatorAction, /Rebuild\/restart 4173 through guarded UI repair/);
});

test('stale served runtime triggers guarded repair and final ready only after exact-head proof', async () => {
  let proofCount = 0;
  let repairCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor(),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'ready' }),
    currentHeadFn: () => '51600ceb1234567890abcdef1234567890abcdef',
    runtimeProofFn: async ({ currentHead }) => {
      proofCount += 1;
      const commit = proofCount > 1 ? '51600ceb' : '0f0aa30d';
      return evaluateServedRuntimeExactHeadProof({ currentHead, health: { ok: true, gitCommit: commit, runtimeMarker: `antifriction-live-v3::${commit}::fixture` }, dist: { ok: true, statusCode: 200 } });
    },
    repairFn: async ({ stdout }) => { repairCount += 1; stdout.write(JSON.stringify({ ready: true })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.equal(repairCount, 1);
  assert.equal(result.status.services.stephanosUi4173.servedRuntimeProof.ready, true);
});
