import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUARDED_GOAL_RUNNER_V1_OUTCOMES as O } from '../shared/agents/guardedGoalRunnerV1.mjs';
import {
  isDirectCliEntrypoint,
  runGuardedGoalRunnerCurrent,
  SUPERVISOR_CURRENT_RELATIVE_PATH,
  GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH,
  GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH,
} from './guarded-goal-runner-current.mjs';

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

function writePrProof(workspace, proof) {
  const file = path.join(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`);
  return file;
}

function safePrProof() {
  return {
    schema: 'stephanos.guarded-goal-runner-pr-proof.v1',
    issue: 1497,
    prNumber: 1497,
    prUrl: 'https://github.com/example/stephan-os/pull/1497',
    publicationState: 'published',
    baseBranch: 'main',
    baseSha: 'd7fb4c67bfd6e15f25507150373ecc4d5fd00e0c',
    expectedBaseSha: 'd7fb4c67bfd6e15f25507150373ecc4d5fd00e0c',
    headSha: head,
    expectedHeadSha: head,
    mergeable: true,
    conflicting: false,
    draft: false,
    changedFiles: { count: 2, summary: 'Guarded Goal Runner PR proof intake.' },
    testsRun: { allGreen: true, commands: [{ command: 'node --test shared/agents/guardedGoalRunner*.test.mjs', status: 'green' }] },
    operatorApprovalRequired: true,
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

test('direct CLI entrypoint detection works for POSIX-style paths', () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'guarded-goal-runner-current.mjs');
  assert.equal(isDirectCliEntrypoint({ metaUrl: pathToFileURL(scriptPath).href, argv1: './scripts/guarded-goal-runner-current.mjs', cwd: repoRoot, platform: 'linux' }), true);
});

test('direct CLI entrypoint detection works for Windows-style paths', () => {
  assert.equal(isDirectCliEntrypoint({
    metaUrl: 'file:///C:/Users/Stephan%20Callear/Documents/Stephanos-openclaw-workspace/scripts/guarded-goal-runner-current.mjs',
    argv1: String.raw`C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace\scripts\guarded-goal-runner-current.mjs`,
    cwd: String.raw`C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace`,
    platform: 'win32',
  }), true);
});

test('direct CLI invocation writes automated-publication current packet', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, greenRecord());
  const scriptPath = path.join(repoRoot, 'scripts', 'guarded-goal-runner-current.mjs');
  const result = spawnSync(process.execPath, [scriptPath, '--repoRoot', repoRoot, '--sharedWorkspaceRoot', workspace, '--currentHead', head], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const outputPath = path.join(workspace, GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH);
  assert.equal(result.stdout.trim(), outputPath);
  const packet = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(packet.outcome, O.ROUTE_TO_AUTOMATED_PUBLICATION);
  assert.equal(packet.allowedNextStep, 'route-to-authenticated-pr-publisher');
  assert.equal(packet.currentHead, head);
}));

test('green exact-head supervisor record routes to automated publication', () => withWorkspace((workspace) => {
  const sourceProofPath = writeSupervisor(workspace, greenRecord());
  const { outputPath, packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(outputPath, path.join(workspace, GUARDED_GOAL_RUNNER_CURRENT_RELATIVE_PATH));
  assert.equal(packet.outcome, O.ROUTE_TO_AUTOMATED_PUBLICATION);
  assert.equal(packet.allowedNextStep, 'route-to-authenticated-pr-publisher');
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

test('stale exact-head proof emits exact-head blocker instead of openclaw-health-live', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, greenRecord(otherHead));
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.notEqual(packet.outcome, O.GOAL_GREEN);
  assert.equal(packet.outcome, O.KNOWN_BLOCKER_NEXT_PATCH);
  assert.equal(packet.blockerId, 'exact-head-mismatch');
  assert.notEqual(packet.blockerId, 'openclaw-health-live');
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
  assert.equal(packet.outcome, O.ROUTE_TO_AUTOMATED_PUBLICATION);
  assert.equal(packet.proofSummary.runtimeOnlyDirtCaveat.id, 'runtime-only-dirt');
  assert.notEqual(packet.blockerId, 'runtime-only-dirt');
}));

test('replay combines Battle Bridge green proof and PR proof into safe merge gate without merging', () => withWorkspace((workspace) => {
  const sourceProofPath = writeSupervisor(workspace, greenRecord());
  const prProofPath = writePrProof(workspace, safePrProof());
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(packet.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(packet.sourceProofPath, sourceProofPath);
  assert.equal(packet.prProofPath, prProofPath);
  assert.equal(packet.safeToMerge, true);
  assert.equal(packet.performsMerge, false);
  assert.equal(packet.performsShellExecution, false);
  assert.match(packet.nextOperatorAction, /external exact-head guarded merge step/);
  assert.equal(packet.prProofSummary.prNumber, 1497);
}));

test('pending legacy operator-click state is converged to automated publication', () => withWorkspace((workspace) => {
  writeSupervisor(workspace, greenRecord());
  writePrProof(workspace, { ...safePrProof(), prNumber: null, prUrl: null, publicationState: 'pending-operator-create-pr-click' });
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-07-10T01:00:00.000Z' });
  assert.equal(packet.outcome, O.ROUTE_TO_AUTOMATED_PUBLICATION);
  assert.equal(packet.allowedNextStep, 'route-to-authenticated-pr-publisher');
  assert.match(packet.nextOperatorAction, /authenticated bounded publication connector/);
}));
