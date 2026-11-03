import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GUARDED_GOAL_RUNNER_V1_OUTCOMES as O } from '../shared/agents/guardedGoalRunnerV1.mjs';
import { runGuardedGoalRunnerCurrent, SUPERVISOR_CURRENT_RELATIVE_PATH, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH } from './guarded-goal-runner-current.mjs';
import { buildGuardedGoalRunnerPrProofPacket, runGuardedGoalRunnerPrProofCurrent } from './guarded-goal-runner-pr-proof-current.mjs';

const head = 'baad917bebc836004b4f5665c0099fade8ae04cc';
const base = '1816b05b5dcaf4a42983370367155fd8b63e5bd6';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withWorkspace(fn) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-pr-proof-'));
  try { return fn(workspace); } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}

function writeSupervisor(workspace) {
  const file = path.join(workspace, SUPERVISOR_CURRENT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schema: 'stephanos.battle-bridge-ignition-supervisor.v1',
    currentPhase: 'ready',
    trafficLight: 'green',
    blockerId: 'served-runtime-exact-head-green',
    expectedHeadSha: head,
    services: { stephanosUi4173: { state: 'ready', ready: true, servedRuntimeProof: { ready: true, currentHead: head, expectedHead: head } } },
  }, null, 2)}\n`);
}

function args(overrides = {}) {
  const input = {
    sharedWorkspaceRoot: overrides.sharedWorkspaceRoot ?? '/tmp/not-used',
    issue: '1497',
    prNumber: '1497',
    prUrl: 'https://github.com/example/stephan-os/pull/1497',
    publicationState: 'published',
    baseBranch: 'main',
    baseSha: base,
    expectedBaseSha: base,
    headSha: head,
    expectedHeadSha: head,
    mergeable: 'true',
    conflicting: 'false',
    draft: 'false',
    testsGreen: 'true',
    ...overrides,
  };
  return Object.entries(input).flatMap(([key, value]) => value === undefined ? [] : [`--${key}`, String(value)]);
}

test('writes valid guarded-goal-runner-pr-current.json', () => withWorkspace((workspace) => {
  const { outputPath, packet } = runGuardedGoalRunnerPrProofCurrent({ argv: args({ sharedWorkspaceRoot: workspace }), now: '2026-07-12T00:00:00.000Z' });
  assert.equal(outputPath, path.join(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH));
  assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).schema, 'stephanos.guarded-goal-runner-pr-proof.v1');
  assert.equal(packet.generatedAt, '2026-07-12T00:00:00.000Z');
  assert.equal(packet.changedFiles.count, 0);
}));

test('valid mergeable PR packet causes runner outcome safe-to-merge-with-expected-head when Battle Bridge proof is green', () => withWorkspace((workspace) => {
  writeSupervisor(workspace);
  runGuardedGoalRunnerPrProofCurrent({ argv: args({ sharedWorkspaceRoot: workspace }), now: '2026-07-12T00:00:00.000Z' });
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head });
  assert.equal(packet.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
}));

test('stale base emits abort-stale-base', () => withWorkspace((workspace) => {
  writeSupervisor(workspace);
  runGuardedGoalRunnerPrProofCurrent({ argv: args({ sharedWorkspaceRoot: workspace, baseSha: 'differentbase' }) });
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head });
  assert.equal(packet.outcome, O.ABORT_STALE_BASE);
}));

test('conflicting PR emits abort-conflicting-pr', () => withWorkspace((workspace) => {
  writeSupervisor(workspace);
  runGuardedGoalRunnerPrProofCurrent({ argv: args({ sharedWorkspaceRoot: workspace, conflicting: 'true', mergeable: 'false' }) });
  const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head });
  assert.equal(packet.outcome, O.ABORT_CONFLICTING_PR);
}));

test('missing expectedHeadSha emits abort-missing-expected-head', () => withWorkspace((workspace) => {
  writeSupervisor(workspace);
  const packet = buildGuardedGoalRunnerPrProofPacket(Object.fromEntries(args({ expectedHeadSha: '' }).reduce((pairs, item, index, array) => index % 2 === 0 ? [...pairs, [item.slice(2), array[index + 1]]] : pairs, [])));
  fs.mkdirSync(path.join(workspace, 'status'), { recursive: true });
  fs.writeFileSync(path.join(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH), `${JSON.stringify({ ...packet, expectedHeadSha: null }, null, 2)}\n`);
  const { packet: runnerPacket } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head });
  assert.equal(runnerPacket.outcome, O.ABORT_MISSING_EXPECTED_HEAD);
}));

test('draft or tests-not-green emits stop-and-report', () => withWorkspace((workspace) => {
  writeSupervisor(workspace);
  runGuardedGoalRunnerPrProofCurrent({ argv: args({ sharedWorkspaceRoot: workspace, draft: 'true' }) });
  assert.equal(runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head }).packet.outcome, O.STOP_AND_REPORT);
  runGuardedGoalRunnerPrProofCurrent({ argv: args({ sharedWorkspaceRoot: workspace, testsGreen: 'false' }) });
  assert.equal(runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head }).packet.outcome, O.STOP_AND_REPORT);
}));

test('output packet preserves no merge/no shell authority', () => {
  const packet = buildGuardedGoalRunnerPrProofPacket(Object.fromEntries(args().reduce((pairs, item, index, array) => index % 2 === 0 ? [...pairs, [item.slice(2), array[index + 1]]] : pairs, [])));
  assert.equal(packet.performsMerge, false);
  assert.equal(packet.performsShellExecution, false);
});

test('Windows direct CLI invocation writes the PR proof packet', () => withWorkspace((workspace) => {
  const scriptPath = path.join(repoRoot, 'scripts', 'guarded-goal-runner-pr-proof-current.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...args({ sharedWorkspaceRoot: workspace })], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH));
  assert.equal(JSON.parse(fs.readFileSync(result.stdout.trim(), 'utf8')).performsMerge, false);
}));
