import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectUi4173ServedExactHeadProof, evaluateUi4173Repair, getUi4173RepairCurrentGitHead, resolveUi4173RepairInvocation, runUi4173Repair } from './battle-bridge-ui-4173-repair.mjs';
import { BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

const EXACT_HEAD = 'a'.repeat(40);

function exactHeadProof(overrides = {}) {
  return {
    expectedHead: EXACT_HEAD,
    currentHeadFn: () => EXACT_HEAD,
    ...overrides,
  };
}

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

function fakeChild(pid = 4173) { const child = new EventEmitter(); child.pid = pid; child.stdout = Readable.from(['child stdout\n']); child.stderr = Readable.from(['child stderr\n']); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; }
function okFetch(url) {
  const health = String(url).includes('__stephanos/health');
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => health ? JSON.stringify({ ok: true, gitCommit: EXACT_HEAD, runtimeMarker: `antifriction-live-v3::${EXACT_HEAD}::fixture` }) : '<html></html>',
  });
}
function failFetch() { return Promise.reject(new Error('ECONNREFUSED')); }
function depsOk() { return { ok: true, missing: [], noLockfileDetected: true, nextOperatorAction: 'none' }; }
function fakeCollector() {
  return Promise.resolve({});
}

function readyPlanner() {
  return report();
}

test('UI repair current-head proof uses the fixed platform Git boundary', () => {
  const calls = [];
  const head = getUi4173RepairCurrentGitHead({
    platform: 'linux',
    environment: { PATH: '/attacker', NODE_OPTIONS: '--require=/attacker/inject.cjs' },
    spawnSyncFn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: `${EXACT_HEAD}\n`, stderr: '' };
    },
  });
  assert.equal(head, EXACT_HEAD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE);
  assert.deepEqual(calls[0].args.slice(-2), ['rev-parse', 'HEAD']);
  assert.equal(calls[0].options.env.PATH, '/usr/bin:/bin');
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(calls[0].options.shell, false);
});

test('UI repair blocks exact-head drift immediately before spawn', async () => {
  let spawnCalls = 0;
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    ...exactHeadProof({ currentHeadFn: () => 'b'.repeat(40) }),
    dryRun: false,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    preflightDepsFn: depsOk,
    stdout,
    spawnFn() {
      spawnCalls += 1;
      throw new Error('drifted UI repair must not spawn');
    },
  });
  const output = json();
  assert.equal(code, 2);
  assert.equal(spawnCalls, 0);
  assert.equal(output.action, 'blocked');
  assert.equal(output.started, false);
  assert.equal(output.expectedHead, EXACT_HEAD);
  assert.equal(output.observedHead, 'b'.repeat(40));
  assert.match(output.blockers.map((blocker) => blocker.id).join(','), /ui-repair-exact-head-changed/);
});

test('UI repair post-start proof rejects a served runtime that drifted from the proven head', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    ...exactHeadProof(),
    dryRun: false,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    preflightDepsFn: depsOk,
    stdout,
    spawnFn: () => fakeChild(4173),
    probeFetch: okFetch,
    servedRuntimeProofFn: async () => ({ ready: false, expectedHead: EXACT_HEAD, gitCommit: 'b'.repeat(40) }),
    readyTimeoutMs: 1,
  });
  const output = json();
  assert.equal(code, 1);
  assert.equal(output.ready, false);
  assert.equal(output.action, 'start-ui-4173-exact-head-unproven');
  assert.match(output.blockers.map((blocker) => blocker.id).join(','), /ui-repair-served-runtime-head-mismatch/);
});

test('UI repair rechecks the fixed source head after served-runtime proof before ready', async () => {
  let headReads = 0;
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    ...exactHeadProof({
      currentHeadFn: () => {
        headReads += 1;
        return headReads < 3 ? EXACT_HEAD : 'b'.repeat(40);
      },
    }),
    dryRun: false,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    preflightDepsFn: depsOk,
    stdout,
    spawnFn: () => fakeChild(4173),
    probeFetch: okFetch,
    readyTimeoutMs: 1,
  });
  const output = json();
  assert.equal(code, 1);
  assert.equal(headReads, 3);
  assert.equal(output.ready, false);
  assert.equal(output.postStartObservedHead, EXACT_HEAD);
  assert.equal(output.postProofObservedHead, 'b'.repeat(40));
  assert.match(output.blockers.map((blocker) => blocker.id).join(','), /ui-repair-post-start-head-changed/);
});

test('served UI repair exact-head proof requires health commit marker and dist parity', async () => {
  const proof = await collectUi4173ServedExactHeadProof({ expectedHead: EXACT_HEAD, fetchFn: okFetch });
  assert.equal(proof.ready, true);
  assert.equal(proof.gitCommitMatches, true);
  assert.equal(proof.runtimeMarkerMatches, true);
  assert.equal(proof.distOk, true);
});

test('Windows start uses controlled cmd.exe wrapper with fixed args for the canonical npm script', async () => {
  const calls = [];
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    ...exactHeadProof(),
    dryRun: false,
    platform: 'win32',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild(4173);
    },
    preflightDepsFn: depsOk,
    probeFetch: okFetch,
    readyTimeoutMs: 1,
  });
  assert.equal(code, 0);
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, process.cwd());
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, EXACT_HEAD);
  const output = json();
  assert.equal(output.invocation.kind, 'CONTROLLED_WINDOWS_NPM_WRAPPER');
  assert.equal(output.invocation.command, 'cmd.exe');
  assert.deepEqual(output.invocation.commandArgs, ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root']);
  assert.equal(output.invocation.wrappedCommand, 'npm.cmd');
  assert.deepEqual(output.invocation.wrappedCommandArgs, ['run', 'stephanos:ignite:launcher-root']);
  assert.equal(output.invocation.cwd, process.cwd());
  assert.equal(output.action, 'start-ui-4173-ready');
  assert.equal(output.ready, true);
  assert.equal(output.started, true);
  assert.equal(output.pid, 4173);
});

test('non-Windows start remains controlled direct npm for the canonical npm script', async () => {
  const calls = [];
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    ...exactHeadProof(),
    dryRun: false,
    platform: 'linux',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    spawnFn(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild(4173);
    },
    preflightDepsFn: depsOk,
    probeFetch: okFetch,
    readyTimeoutMs: 1,
  });
  assert.equal(code, 0);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'stephanos:ignite:launcher-root']);
  assert.equal(calls[0].options.cwd, process.cwd());
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, EXACT_HEAD);
  const output = json();
  assert.equal(output.invocation.kind, 'CONTROLLED_DIRECT_NPM');
  assert.equal(output.invocation.command, 'npm');
  assert.equal(output.invocation.cwd, process.cwd());
  assert.equal(output.action, 'start-ui-4173-ready');
  assert.equal(output.ready, true);
  assert.equal(output.started, true);
  assert.equal(output.pid, 4173);
});

test('spawn errors return structured JSON and non-zero exit', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    ...exactHeadProof(),
    dryRun: false,
    platform: 'win32',
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    preflightDepsFn: depsOk,
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
    ...exactHeadProof(),
    dryRun: false,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    preflightDepsFn: depsOk,
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


test('missing UI build dependencies block without spawning and give no-lockfile npm install guidance', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: false,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    preflightDepsFn: () => ({ ok: false, missing: ['vite', '@vitejs/plugin-react'], noLockfileDetected: true, nextOperatorAction: 'npm install --prefix .\\stephanos-ui --no-audit --no-fund --package-lock=false' }),
    spawnFn() { throw new Error('must not spawn'); },
  });
  const output = json();
  assert.equal(code, 2);
  assert.equal(output.action, 'blocked');
  assert.deepEqual(output.missing, ['vite', '@vitejs/plugin-react']);
  assert.equal(output.noLockfileDetected, true);
  assert.match(output.nextOperatorAction, /npm install --prefix \.\\stephanos-ui/);
  assert.doesNotMatch(output.nextOperatorAction, /npm ci/);
});

test('spawned but port never opens reports not ready with log paths under shared workspace', async () => {
  const sharedWorkspace = mkdtempSync(join(tmpdir(), 'bb-ui-repair-'));
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({ ...exactHeadProof(), dryRun: false, sharedWorkspace, collectFactsFn: fakeCollector, plannerFn: readyPlanner, stdout, preflightDepsFn: depsOk, probeFetch: failFetch, readyTimeoutMs: 1, spawnFn: () => fakeChild(4174) });
  const output = json();
  assert.equal(code, 1);
  assert.equal(output.action, 'start-ui-4173-spawned-but-not-ready');
  assert.equal(output.started, true);
  assert.equal(output.ready, false);
  assert.equal(output.logs.logPath.startsWith(join(sharedWorkspace, 'logs', 'battle-bridge-ui-4173-repair')), true);
  assert.equal(JSON.stringify(output).includes('process.env'), false);
});


test('child exits early reports failed with exit metadata', async () => {
  const child = fakeChild(4175);
  child.exitCode = 1;
  child.signalCode = null;
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({ ...exactHeadProof(), dryRun: false, collectFactsFn: fakeCollector, plannerFn: readyPlanner, stdout, preflightDepsFn: depsOk, probeFetch: failFetch, readyTimeoutMs: 1, spawnFn: () => child });
  const output = json();
  assert.equal(code, 1);
  assert.equal(output.action, 'start-ui-4173-failed');
  assert.deepEqual(output.exit, { code: 1, signal: null });
});

test('dry-run still does not spawn', async () => {
  const { stdout, json } = stdoutCapture();
  const code = await runUi4173Repair({
    dryRun: true,
    collectFactsFn: fakeCollector,
    plannerFn: readyPlanner,
    stdout,
    probeFetch() { throw new Error('probe should not be called during dry-run'); },
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
