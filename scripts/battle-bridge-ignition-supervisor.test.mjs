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
  runApprovedOpenClawGateway18789Start,
  defaultBattleBridgeSharedWorkspace,
  runBattleBridgeIgnitionSupervisor,
  evaluateServedRuntimeExactHeadProof,
} from './battle-bridge-ignition-supervisor.mjs';
import { buildOpenClawGatewayStartupTarget, npmGlobalBinCandidatesForOpenClaw, resolveOpenClawGatewayStartupExecution } from '../shared/agents/openClawGatewayStartup.mjs';


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
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.killsProcesses, true);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.mutatesOpenClaw, true);
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





test('OpenClaw gateway start blocks with startup-approval-required without approval when 18789 is down', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-no-approval-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: {},
    approved: false,
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('unapproved start must not spawn'); },
    fetchFn: async () => { throw new Error('18789 down'); },
  });

  const exitLog = JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8'));
  const healthLog = JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8'));
  assert.equal(result.unavailable, true);
  assert.equal(result.reason, 'startup-approval-required');
  assert.equal(exitLog.error, 'startup-approval-required');
  assert.equal(healthLog.skipped, true);
  assert.equal(healthLog.reason, 'startup-approval-required');
  assert.equal(spawnCalls.length, 0);
});

test('approved OpenClaw gateway start uses config-safe start command shape, env token, health retries, and canonical logs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-start-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    token: 'test-token',
    approved: true,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      queueMicrotask(() => { child.stdout.end('openclaw stdout proof\n'); child.stderr.end('openclaw stderr proof\n'); });
      return child;
    },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('not listening before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ service: 'openclaw-gateway' }) };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(result.ready, true);
  assert.equal(spawnCalls[0].command, 'openclaw');
  assert.deepEqual(spawnCalls[0].args, ['gateway', 'start', '--json']);
  assert.doesNotMatch(result.target.commandText, /openclaw config set/);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /openclaw config set/);
  assert.match(`${spawnCalls[0].command} ${spawnCalls[0].args.join(' ')}`, /openclaw gateway start --json/);
  assert.equal(spawnCalls[0].options.env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN, 'test-token');
  assert.equal(spawnCalls[0].options.env.OPENCLAW_GATEWAY_TOKEN, 'test-token');
  assert.equal(healthCalls >= 2, true);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /openclaw gateway run --force/);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /--port 18789 --bind loopback|--host/);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.match(result.logPath, /logs[\\/]openclaw-gateway-18789-start/);
  assert.equal(fs.readFileSync(result.logs.stdoutLogPath, 'utf8'), 'openclaw stdout proof\n');
  assert.equal(fs.readFileSync(result.logs.stderrLogPath, 'utf8'), 'openclaw stderr proof\n');
});

test('approved OpenClaw gateway start runs without token and writes non-skipped exit and health logs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-no-token-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: {},
    approved: true,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        return healthCalls <= 1
          ? Promise.reject(new Error('not ready yet'))
          : { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ service: 'openclaw-gateway' }) };
    },
  });

  const exitLog = JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8'));
  const healthLog = JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8'));
  assert.equal(result.ready, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(`${spawnCalls[0].command} ${spawnCalls[0].args.join(' ')}`, 'openclaw gateway start --json');
  assert.equal(spawnCalls[0].options.env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN, undefined);
  assert.equal(spawnCalls[0].options.env.OPENCLAW_GATEWAY_TOKEN, undefined);
  assert.equal(exitLog.error, null);
  assert.notEqual(exitLog.error, 'startup-token-missing');
  assert.equal(healthLog.skipped, undefined);
  assert.notEqual(healthLog.reason, 'startup-token-missing');
  assert.equal(healthLog.ready, true);
});

test('OpenClaw config write startup targets still require token and never become gateway start commands', () => {
  const noToken = buildOpenClawGatewayStartupTarget({
    commandText: 'openclaw config set gateway.token secret',
    env: {},
    approved: true,
  });
  const withToken = buildOpenClawGatewayStartupTarget({
    commandText: 'openclaw config set gateway.token secret',
    token: 'test-token',
    approved: true,
  });

  assert.equal(noToken.available, false);
  assert.equal(noToken.reason, 'startup-token-missing');
  assert.equal(noToken.mutatesOpenClawConfig, true);
  assert.equal(withToken.available, false);
  assert.equal(withToken.reason, 'startup-command-violates-guardrails');
  assert.equal(withToken.mutatesOpenClawConfig, true);
  assert.doesNotMatch(noToken.commandText, /^openclaw gateway start --json$/);
  assert.doesNotMatch(withToken.commandText, /^openclaw gateway start --json$/);
});



test('Windows OpenClaw gateway execution uses cmd.exe wrapper for openclaw.cmd instead of direct shim spawn', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  fs.mkdirSync(npmBin, { recursive: true });
  const cmdShim = path.join(npmBin, 'openclaw.cmd');
  fs.writeFileSync(cmdShim, '@echo off\n');
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, Path: '' },
    approved: true,
    platform: 'win32',
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => { spawnCalls.push({ command, args, options }); return child; },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('down before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ service: 'openclaw-gateway' }) };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, 'cmd.exe');
  assert.notEqual(spawnCalls[0].command, 'openclaw');
  assert.deepEqual(spawnCalls[0].args, ['/d', '/s', '/c', `""${cmdShim}" gateway start --json"`]);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(result.target.commandText, 'openclaw gateway start --json');
  assert.equal(result.execution.strategy, 'cmd-shim');
  assert.equal(result.execution.resolvedOpenClawPath, cmdShim);
  assert.doesNotMatch(result.target.commandText, /openclaw config set/);
});

test('Windows OpenClaw gateway execution prefers APPDATA npm node entrypoint when openclaw.mjs exists', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-node-entry-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  const openClawPackage = path.join(npmBin, 'node_modules', 'openclaw');
  const nodeDir = path.join(workspace, 'nodejs');
  fs.mkdirSync(openClawPackage, { recursive: true });
  fs.mkdirSync(nodeDir, { recursive: true });
  const cmdShim = path.join(npmBin, 'openclaw.cmd');
  const openClawMjs = path.win32.join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
  const localMjs = path.join(openClawPackage, 'openclaw.mjs');
  const nodeExe = path.join(nodeDir, 'node.exe');
  fs.writeFileSync(cmdShim, '@echo off\n');
  fs.writeFileSync(localMjs, 'export {};\n');
  fs.writeFileSync(nodeExe, '');
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, Path: nodeDir },
    approved: true,
    platform: 'win32',
    existsSync: (candidate) => candidate === cmdShim || candidate === localMjs || candidate === openClawMjs || candidate === nodeExe,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => { spawnCalls.push({ command, args, options }); return child; },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('down before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ service: 'openclaw-gateway' }) };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, nodeExe);
  assert.deepEqual(spawnCalls[0].args, [openClawMjs, 'gateway', 'start', '--json']);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(result.execution.strategy, 'node-entrypoint');
  assert.equal(result.execution.resolvedOpenClawPath, openClawMjs);
  assert.equal(result.target.commandText, 'openclaw gateway start --json');
});

test('Windows OpenClaw resolver includes APPDATA npm fallback and only accepts fixed allowlisted command', () => {
  const env = { APPDATA: 'C:\\Users\\operator\\AppData\\Roaming', Path: 'C:\\Windows\\System32' };
  const candidates = npmGlobalBinCandidatesForOpenClaw({ env });
  assert.equal(candidates.includes('C:\\Users\\operator\\AppData\\Roaming' + path.sep + 'npm'), true);
  const target = buildOpenClawGatewayStartupTarget({ commandText: 'openclaw gateway start --json', env, approved: true });
  const resolved = resolveOpenClawGatewayStartupExecution({
    target,
    env,
    platform: 'win32',
    existsSync: (candidate) => candidate.endsWith(`npm${path.sep}openclaw.cmd`),
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.command, 'cmd.exe');
  assert.deepEqual(resolved.commandArgs.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(resolved.commandArgs[3], /^"".*openclaw\.cmd" gateway start --json"$/);
  assert.equal(resolved.strategy, 'cmd-shim');
  assert.equal(resolved.executesArbitraryShell, false);

  const badTarget = { ...target, commandText: 'openclaw gateway start --json && openclaw config set gateway.token secret' };
  const blocked = resolveOpenClawGatewayStartupExecution({ target: badTarget, env, platform: 'win32', existsSync: () => true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'startup-command-not-fixed-allowlisted');
});

test('Windows unresolved OpenClaw executable is classified as start-failed with canonical logs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-missing-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: path.join(workspace, 'missing-appdata'), Path: '' },
    approved: true,
    platform: 'win32',
    existsSync: () => false,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('must not spawn unresolved openclaw'); },
    fetchFn: async () => { throw new Error('fetch failed'); },
  });
  assert.equal(spawnCalls.length, 0);
  assert.equal(result.ready, false);
  assert.equal(result.error, 'openclaw-executable-not-found');
  assert.equal(fs.existsSync(result.logs.stdoutLogPath), true);
  assert.equal(fs.existsSync(result.logs.stderrLogPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8')).error, 'openclaw-executable-not-found');
  assert.equal(JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8')).error, 'fetch failed');
});

test('approved OpenClaw gateway start writes all log paths on timeout', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-timeout-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    token: 'test-token',
    approved: true,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: () => child,
    fetchFn: async () => { throw new Error('still down'); },
  });

  assert.equal(result.ready, false);
  assert.equal(result.started, true);
  assert.equal(fs.existsSync(result.logs.stdoutLogPath), true);
  assert.equal(fs.existsSync(result.logs.stderrLogPath), true);
  assert.equal(fs.existsSync(result.logs.exitLogPath), true);
  assert.equal(fs.existsSync(result.logs.healthProofLogPath), true);
  assert.match(fs.readFileSync(result.logs.healthProofLogPath, 'utf8'), /still down/);
});

test('Windows OpenClaw spawn EINVAL is captured in exit log for start-failed classification', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-einval-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  fs.mkdirSync(npmBin, { recursive: true });
  const cmdShim = path.join(npmBin, 'openclaw.cmd');
  fs.writeFileSync(cmdShim, '@echo off\n');
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, Path: '' },
    approved: true,
    platform: 'win32',
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: () => {
      const error = new Error('spawn EINVAL');
      error.code = 'EINVAL';
      throw error;
    },
    fetchFn: async () => { throw new Error('fetch failed'); },
  });
  const exitLog = JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8'));
  assert.equal(result.ready, false);
  assert.equal(result.error, 'spawn EINVAL');
  assert.equal(exitLog.error, 'spawn EINVAL');
  assert.equal(exitLog.commandText, 'openclaw gateway start --json');
  assert.equal(exitLog.execution.strategy, 'cmd-shim');
  assert.equal(fs.existsSync(result.logs.stdoutLogPath), true);
  assert.equal(fs.existsSync(result.logs.stderrLogPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8')).error, 'fetch failed');
});

test('approved OpenClaw gateway start reuses healthy 18789 and avoids duplicate start', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-reuse-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    token: 'test-token',
    approved: true,
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('duplicate start must not run'); },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ service: 'openclaw-gateway' }) };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.reusedExistingRuntime, true);
  assert.equal(result.duplicateStartAvoided, true);
  assert.equal(result.started, false);
  assert.equal(spawnCalls.length, 0);
  assert.match(result.logPath, /logs[\\/]openclaw-gateway-18789-start/);
});

test('supervisor calls approved OpenClaw startup adapter when 18789 is missing', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => { collectCount += 1; return factsFor({ openclaw: collectCount > 1 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['openclaw-gateway'].ready ? 'ready' : 'partial-openclaw-missing' }),
    openClawStartFn: async ({ sharedWorkspace }) => { calls.push(sharedWorkspace); return { ready: true, started: true, target: { commandText: 'openclaw gateway run --port 18789 --bind loopback' }, logPath: '/canonical/openclaw-log', logs: { logPath: '/canonical/openclaw-log' }, healthProof: { ready: true, health: { json: { ok: true } } } }; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(result.status.services.openClaw18789.start.logPath, '/canonical/openclaw-log');
});

test('OpenClaw command failure blocks with start-failed and does not run UI repair', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ openclaw: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'partial-openclaw-missing' }),
    openClawStartFn: async () => ({ ready: false, started: false, exitCode: 2, logPath: '/canonical/openclaw-log', logs: { logPath: '/canonical/openclaw-log' } }),
    repairFn: async () => { calls.push('ui-repair'); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'openclaw-gateway-18789-start-failed');
  assert.deepEqual(calls, []);
});

test('OpenClaw running without health proof blocks with no-health-proof and surfaces logPath', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ publicationState: 'source-current' }),
    collectFactsFn: async () => factsFor({ openclaw: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'partial-openclaw-missing' }),
    openClawStartFn: async () => ({ ready: false, started: true, exitCode: null, logPath: '/canonical/openclaw-log', logs: { logPath: '/canonical/openclaw-log' }, healthProof: { ready: false, health: { json: { service: 'openclaw-readonly-adapter-stub', status: 'healthy' } } } }),
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'openclaw-gateway-18789-no-health-proof');
  assert.equal(result.status.phases['OpenClaw gateway 18789'].logPath, '/canonical/openclaw-log');
  assert.match(result.status.nextOperatorAction, /\/canonical\/openclaw-log/);
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
