import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARDED_GOAL_RUNNER_V1_OUTCOMES as O } from '../shared/agents/guardedGoalRunnerV1.mjs';
import { runGuardedGoalRunnerCurrent, SUPERVISOR_CURRENT_RELATIVE_PATH, GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH } from './guarded-goal-runner-current.mjs';

const head = 'baad917bebc836004b4f5665c0099fade8ae04cc';
const otherHead = '37915edd61a319c3a1f3e456605986ab637a59fd';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withWorkspace(fn) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-current-'));
  try { return fn(workspace); } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}

function writeSupervisor(workspace, record) {
  const file = path.join(workspace, SUPERVISOR_CURRENT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function greenRecord(expectedHead = head) {
  return {
    schema: 'stephanos.battle-bridge-ignition-supervisor.v1',
    generatedAt: '2026-07-10T00:00:00.000Z',
    currentPhase: 'ready',
    trafficLight: 'green',
    blockerId: '',
    nextOperatorAction: 'Battle Bridge proof is green.',
    logPath: '/logs/supervisor.log',
    services: {
      backend8787: { state: 'ready', ready: true, evidence: { status: 200 }, repair: { logPath: '/logs/backend' } },
      openClaw18789: { state: 'ready', ready: true, evidence: { status: 'live' }, start: { logs: { stdoutLogPath: '/logs/openclaw/stdout.log', stderrLogPath: '/logs/openclaw/stderr.log' } } },
      stephanosUi4173: { state: 'ready', ready: true, evidence: { status: 200 }, servedRuntimeProof: { ready: true, currentHead: expectedHead, expectedHead } },
    },
    runtimeOnlyDirtCaveat: { id: 'runtime-only-dirt', detail: 'dist dirt caveat' },
  };
}

function redRecord() {
  return {
    schema: 'stephanos.battle-bridge-ignition-supervisor.v1',
    currentPhase: 'OpenClaw gateway 18789',
    trafficLight: 'red',
    blockerId: 'openclaw-health-live',
    nextOperatorAction: 'Repair OpenClaw health proof.',
    services: {
      backend8787: { state: 'ready', ready: true },
      openClaw18789: { state: 'blocked', ready: false, start: { logPath: '/logs/openclaw' } },
      stephanosUi4173: { state: 'pending', ready: false },
    },
  };
}

test('green exact-head supervisor record emits goal-green packet', () => withWorkspace((workspace) => {
  const sourceProofPath = writeSupervisor(workspace, greenRecord());
  const { outputPath, packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(outputPath, path.join(workspace, GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH));
  assert.equal(packet.outcome, O.GOAL_GREEN);
  assert.equal(packet.currentHead, head);
  assert.equal(packet.sourceProofPath, sourceProofPath);
  assert.equal(packet.proofSummary.backend8787.ready, true);
  assert.equal(packet.proofSummary.openClaw18789.ready, true);
  assert.equal(packet.proofSummary.stephanosUi4173.ready, true);
  assert.equal(packet.proofSummary.servedRuntimeProof.ready, true);
}));

test('red known blocker emits known-blocker-next-patch packet', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, redRecord());
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(packet.outcome, O.KNOWN_BLOCKER_NEXT_PATCH);
  assert.equal(packet.blockerId, 'openclaw-health-live');
  assert.equal(packet.allowedNextStep, 'write-bounded-source-or-proof-patch');
}));

test('missing supervisor file emits abort-missing-proof packet', () => withWorkspace((workspace) => {
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(packet.outcome, O.ABORT_MISSING_PROOF);
  assert.match(packet.abortReason, /Missing supervisor/);
}));

test('exact-head mismatch does not emit goal-green', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, greenRecord(otherHead));
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.notEqual(packet.outcome, O.GOAL_GREEN);
  assert.equal(packet.outcome, O.KNOWN_BLOCKER_NEXT_PATCH);
}));

test('output packet always states performsMerge=false and performsShellExecution=false', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, greenRecord());
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(packet.performsMerge, false);
  assert.equal(packet.performsShellExecution, false);
}));

test('runtime-only dirt caveat is preserved as caveat, not blocker', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, greenRecord());
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(packet.outcome, O.GOAL_GREEN);
  assert.equal(packet.proofSummary.runtimeOnlyDirtCaveat.id, 'runtime-only-dirt');
  assert.notEqual(packet.blockerId, 'runtime-only-dirt');
}));
