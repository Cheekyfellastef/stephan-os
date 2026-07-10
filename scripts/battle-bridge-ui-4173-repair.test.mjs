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

test('no user supplied command text reaches cmd.exe invocation', () => {
  const blocked = evaluateUi4173Repair({ readinessReport: report(), dryRun: false, commandIdentity: { commandText: 'npm run evil && calc.exe', id: 'bad', source: 'test', purpose: 'test' } });
  const invocation = resolveUi4173RepairInvocation('win32');
  assert.equal(blocked.allowedToStart, false);
  assert.deepEqual(invocation.commandArgs, ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root']);
  assert.equal(invocation.commandArgs.includes('evil'), false);
  assert.equal(invocation.commandArgs.includes('calc.exe'), false);
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

test('Windows start uses controlled cmd.exe wrapper with fixed args for the canonical npm script', async () => {
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
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, process.cwd());
  const output = json();
  assert.equal(output.invocation.kind, 'CONTROLLED_WINDOWS_NPM_WRAPPER');
  assert.equal(output.invocation.command, 'cmd.exe');
  assert.deepEqual(output.invocation.commandArgs, ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root']);
  assert.equal(output.invocation.wrappedCommand, 'npm.cmd');
  assert.deepEqual(output.invocation.wrappedCommandArgs, ['run', 'stephanos:ignite:launcher-root']);
  assert.equal(output.invocation.cwd, process.cwd());
  assert.equal(output.action, 'start-ui-4173-started');
  assert.equal(output.started, true);
  assert.equal(output.pid, 4173);
});

test('non-Windows start remains controlled direct npm for the canonical npm script', async () => {
  const calls = [];
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: false,
    platform: 'linux',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      return { pid: 4173, unref() {} };
    },
  });
  assert.equal(code, 0);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:ignite:launcher-root']);
  assert.equal(calls[0].options.cwd, process.cwd());
  const output = json();
  assert.equal(output.invocation.kind, 'CONTROLLED_DIRECT_NPM');
  assert.equal(output.invocation.command, 'npm');
  assert.equal(output.invocation.cwd, process.cwd());
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
  assert.equal(output.invocation.kind, 'CONTROLLED_WINDOWS_NPM_WRAPPER');
  assert.equal(output.invocation.cwd, process.cwd());
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
  const output = json();
  assert.equal(output.action, 'dry-run-plan-ui-4173-start');
  assert.equal(output.started, null);
  assert.equal(output.invocation, undefined);
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
  assert.deepEqual(resolveUi4173RepairInvocation('win32'), {
    kind: 'CONTROLLED_WINDOWS_NPM_WRAPPER',
    command: 'cmd.exe',
    commandArgs: ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root'],
    wrappedCommand: 'npm.cmd',
    wrappedCommandArgs: ['run', 'stephanos:ignite:launcher-root'],
    shell: false,
    cwd: process.cwd(),
  });
  assert.deepEqual(resolveUi4173RepairInvocation('linux'), {
    kind: 'CONTROLLED_DIRECT_NPM',
    command: 'npm',
    commandArgs: ['run', 'stephanos:ignite:launcher-root'],
    shell: false,
    cwd: process.cwd(),
  });
});
