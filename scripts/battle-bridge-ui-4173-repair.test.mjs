import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { evaluateUi4173Repair, resolveUi4173RepairInvocation, runUi4173Repair } from './battle-bridge-ui-4173-repair.mjs';

function report({ backend = true, ui = false, openclaw = true, workspace = true, verdict = 'partial-ui-missing', stale = [], safety = [] } = {}) {
  return {
    finalVerdict: verdict,
    observedServices: {
      backend: { ready: backend },
      'stephanos-ui': { ready: ui },
      'openclaw-gateway': { ready: openclaw },
      'shared-workspace': { ready: workspace },
    },
    staleWorkspaceRecords: stale,
    safetyBlockers: safety,
  };
}

test('fixture PARTIAL_UI_MISSING + backend/OpenClaw/shared workspace ready plans UI-only start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report(), dryRun: true });
  assert.equal(result.allowedToStart, true);
  assert.equal(result.action, 'dry-run-plan-ui-4173-start');
  assert.equal(result.authority.startsBackend8787, false);
  assert.equal(result.authority.startsOpenClawGateway18789, false);
  assert.equal(result.authority.killsProcesses, false);
});

test('fixture READY does not start or plan start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ ui: true, verdict: 'ready' }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /stephanos-ui-already-ready/);
});

test('fixture STALE_WORKSPACE blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ workspace: false, stale: ['proof stale'] }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /shared-workspace-not-fresh/);
});

test('fixture backend missing blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ backend: false }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /backend-8787-not-connected/);
});

test('fixture OpenClaw missing blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ openclaw: false }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /openclaw-gateway-18789-not-connected/);
});

test('fixture source dirt/safety blocker blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ safety: [{ id: 'dirty-source', detail: 'dirty' }] }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /safety-dirty-source/);
});

test('command allowlist prevents arbitrary shell', () => {
  const result = evaluateUi4173Repair({ readinessReport: report(), dryRun: true, commandIdentity: { commandText: 'bash -c rm -rf /', id: 'bad', source: 'test', purpose: 'test' } });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /command-not-allowlisted/);
});


function stdoutCapture() {
  let text = '';
  return {
    stdout: { write: (chunk) => { text += chunk; } },
    json: () => JSON.parse(text),
  };
}

function fakeCollector() {
  return Promise.resolve({});
}

function readyPlanner() {
  return report();
}

test('Windows start uses npm.cmd for the canonical npm script', async () => {
  const calls = [];
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: false,
    platform: 'win32',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      return { pid: 4173, unref() {} };
    },
  });
  assert.equal(code, 0);
  assert.equal(calls[0].command, 'npm.cmd');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:ignite:launcher-root']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(json().invocation.command, 'npm.cmd');
});

test('non-Windows start uses npm for the canonical npm script', async () => {
  const calls = [];
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: false,
    platform: 'linux',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn(command, args) {
      calls.push({ command, args });
      return { pid: 4173, unref() {} };
    },
  });
  assert.equal(code, 0);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:ignite:launcher-root']);
  assert.equal(json().invocation.command, 'npm');
});

test('spawn errors return structured JSON and non-zero exit', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: false,
    platform: 'win32',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn() {
      const error = new Error('spawn EINVAL');
      error.code = 'EINVAL';
      throw error;
    },
  });
  const output = json();
  assert.equal(code, 1);
  assert.equal(output.started, false);
  assert.equal(output.action, 'start-ui-4173-failed');
  assert.deepEqual(output.spawnError, { code: 'EINVAL', message: 'spawn EINVAL' });
  assert.match(output.afterProofInstruction, /Do not claim live health/);
});

test('asynchronous spawn errors return structured JSON and non-zero exit', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: false,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn() {
      const child = new EventEmitter();
      child.pid = 0;
      child.unref = () => {};
      queueMicrotask(() => {
        const error = new Error('spawn EINVAL');
        error.code = 'EINVAL';
        child.emit('error', error);
      });
      return child;
    },
  });
  assert.equal(code, 1);
  assert.equal(json().spawnError.code, 'EINVAL');
});

test('dry-run still does not spawn', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: true,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn() {
      throw new Error('spawn should not be called during dry-run');
    },
  });
  assert.equal(code, 0);
  assert.equal(json().action, 'dry-run-plan-ui-4173-start');
  assert.equal(json().started, null);
});

test('authority forbids backend/OpenClaw starts, kill authority, and arbitrary shell', () => {
  const result = evaluateUi4173Repair({ readinessReport: report(), dryRun: true });
  assert.equal(result.authority.startsBackend8787, false);
  assert.equal(result.authority.startsOpenClawGateway18789, false);
  assert.equal(result.authority.killsProcesses, false);
  assert.equal(result.authority.executesArbitraryShell, false);
});

test('existing blocked readiness/report-only behavior remains unchanged', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: true,
    collectFactsFn: fakeCollector,
    plannerFn: () => report({ ui: true, verdict: 'ready' }),
    stdout,
    spawnFn() {
      throw new Error('blocked report-only should not spawn');
    },
  });
  const output = json();
  assert.equal(code, 0);
  assert.equal(output.allowedToStart, false);
  assert.equal(output.action, 'blocked');
  assert.match(output.blockers.map((b) => b.id).join(','), /stephanos-ui-already-ready/);
});

test('platform invocation resolver is source-coded and not arbitrary shell', () => {
  assert.deepEqual(resolveUi4173RepairInvocation('win32'), { command: 'npm.cmd', commandArgs: ['run', 'stephanos:ignite:launcher-root'] });
  assert.deepEqual(resolveUi4173RepairInvocation('linux'), { command: 'npm', commandArgs: ['run', 'stephanos:ignite:launcher-root'] });
});
