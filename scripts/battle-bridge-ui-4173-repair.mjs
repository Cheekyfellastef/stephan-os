#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLauncherReadinessLiveFacts } from './launcher-readiness-live-facts.mjs';
import { isAllowedLauncherStartCommand, planLauncherReadiness } from './launcher-readiness-planner.mjs';

export const UI_4173_REPAIR_SCHEMA = 'stephanos.battle-bridge-ui-4173-repair-plan.v1';
const CANONICAL_NPM_SCRIPT_ARGS = Object.freeze(['run', 'stephanos:ignite:launcher-root']);
const WINDOWS_NPM_WRAPPER_ARGS = Object.freeze(['/d', '/s', '/c', 'npm.cmd', ...CANONICAL_NPM_SCRIPT_ARGS]);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_ROOT = resolve(REPO_ROOT, 'stephanos-ui');
const REQUIRED_UI_BUILD_DEPENDENCIES = Object.freeze(['vite', '@vitejs/plugin-react']);
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const NO_LOCKFILE_INSTALL_ACTION = 'npm install --prefix .\\stephanos-ui --no-audit --no-fund --package-lock=false';

export function resolveUi4173RepairInvocation(platform = process.platform) {
  if (platform === 'win32') {
    return Object.freeze({
      kind: 'CONTROLLED_WINDOWS_NPM_WRAPPER',
      command: 'cmd.exe',
      commandArgs: WINDOWS_NPM_WRAPPER_ARGS,
      wrappedCommand: 'npm.cmd',
      wrappedCommandArgs: CANONICAL_NPM_SCRIPT_ARGS,
      shell: false,
      cwd: REPO_ROOT,
    });
  }

  return Object.freeze({
    kind: 'CONTROLLED_DIRECT_NPM',
    command: 'npm',
    commandArgs: CANONICAL_NPM_SCRIPT_ARGS,
    shell: false,
    cwd: REPO_ROOT,
  });
}

export const UI_4173_REPAIR_COMMAND_IDENTITY = Object.freeze({
  id: 'npm-script:stephanos:ignite:launcher-root',
  commandText: 'npm run stephanos:ignite:launcher-root',
  source: 'package.json#scripts.stephanos:ignite:launcher-root',
  purpose: 'start only the Stephanos launcher-root UI listener on 4173 through the canonical source-controlled ignition path',
});
export const UI_4173_REPAIR_INVOCATION = resolveUi4173RepairInvocation();
export const UI_4173_REPAIR_COMMAND = Object.freeze({
  ...UI_4173_REPAIR_COMMAND_IDENTITY,
  invocationKind: UI_4173_REPAIR_INVOCATION.kind,
  command: UI_4173_REPAIR_INVOCATION.command,
  commandArgs: UI_4173_REPAIR_INVOCATION.commandArgs,
});
export const UI_4173_REPAIR_AUTHORITY = Object.freeze({
  explicitOperatorInvocationRequired: true,
  startsStephanosUi4173Only: true,
  startsBackend8787: false,
  startsOpenClawGateway18789: false,
  killsProcesses: false,
  executesArbitraryShell: false,
  mutatesUserRuntimeDataInDryRun: false,
});


export function preflightUiBuildDependencies({ uiRoot = UI_ROOT, required = REQUIRED_UI_BUILD_DEPENDENCIES } = {}) {
  const requireFromUi = createRequire(resolve(uiRoot, 'package.json'));
  const missing = [];
  const resolved = {};
  for (const name of required) {
    try {
      resolved[name] = requireFromUi.resolve(name);
    } catch {
      missing.push(name);
    }
  }
  const noLockfileDetected = !existsSync(resolve(uiRoot, 'package-lock.json'));
  return {
    ok: missing.length === 0,
    uiRoot,
    resolvedFrom: resolve(uiRoot, 'package.json'),
    required: [...required],
    missing,
    resolved,
    noLockfileDetected,
    nextOperatorAction: noLockfileDetected ? NO_LOCKFILE_INSTALL_ACTION : 'npm install --prefix .\\stephanos-ui --no-audit --no-fund',
  };
}

function resolveSharedWorkspaceLogRoot(sharedWorkspace) {
  const root = resolve(sharedWorkspace || process.env.STEPHANOS_SHARED_WORKSPACE || join(process.env.USERPROFILE || process.env.HOME || REPO_ROOT, 'Documents', 'Stephanos-openclaw-workspace'));
  return join(root, 'logs', 'battle-bridge-ui-4173-repair');
}

function containedPath(root, leaf) {
  const path = resolve(root, leaf);
  const rel = relative(resolve(root), path);
  if (rel.startsWith('..') || rel === '' || rel.includes('..')) throw new Error('log path escaped shared workspace');
  return path;
}

function createRepairLogs(sharedWorkspace) {
  const logRoot = resolveSharedWorkspaceLogRoot(sharedWorkspace);
  mkdirSync(logRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = containedPath(logRoot, stamp);
  mkdirSync(dir, { recursive: true });
  return {
    logPath: dir,
    stdoutLogPath: join(dir, 'stdout.log'),
    stderrLogPath: join(dir, 'stderr.log'),
  };
}

function logMetadata(logs) {
  const stdoutBytes = existsSync(logs.stdoutLogPath) ? statSync(logs.stdoutLogPath).size : 0;
  const stderrBytes = existsSync(logs.stderrLogPath) ? statSync(logs.stderrLogPath).size : 0;
  return { ...logs, logBytes: { stdout: stdoutBytes, stderr: stderrBytes } };
}

async function waitForUiReady({ probeFetch = fetch, timeoutMs = DEFAULT_READY_TIMEOUT_MS, intervalMs = 250 } = {}) {
  const started = Date.now();
  const attempts = [];
  while (Date.now() - started <= timeoutMs) {
    for (const url of ['http://127.0.0.1:4173/__stephanos/health', 'http://127.0.0.1:4173/']) {
      try {
        const response = await probeFetch(url);
        attempts.push({ url, ok: response.ok, status: response.status });
        if (response.ok) return { ready: true, url, status: response.status, attempts };
      } catch (error) {
        attempts.push({ url, ok: false, error: error?.code || error?.message || String(error) });
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  return { ready: false, attempts: attempts.slice(-6), timeoutMs };
}

function serviceReady(report, id) {
  return report?.observedServices?.[id]?.ready === true;
}

function hasFreshWorkspace(report) {
  return serviceReady(report, 'shared-workspace') && !(report?.staleWorkspaceRecords || []).length;
}

export function evaluateUi4173Repair({ readinessReport, dryRun = true, commandIdentity = UI_4173_REPAIR_COMMAND_IDENTITY } = {}) {
  const finalVerdict = String(readinessReport?.finalVerdict || '').toLowerCase();
  const blockers = [];
  if (!serviceReady(readinessReport, 'backend')) blockers.push({ id: 'backend-8787-not-connected', detail: 'Backend 8787 must already be connected before UI-only repair.' });
  if (!serviceReady(readinessReport, 'openclaw-gateway')) blockers.push({ id: 'openclaw-gateway-18789-not-connected', detail: 'OpenClaw gateway 18789 must already be connected before UI-only repair.' });
  if (!hasFreshWorkspace(readinessReport)) blockers.push({ id: 'shared-workspace-not-fresh', detail: 'Shared workspace records must be fresh and not UNKNOWN before UI-only repair.', records: readinessReport?.staleWorkspaceRecords || [] });
  if (serviceReady(readinessReport, 'stephanos-ui')) blockers.push({ id: 'stephanos-ui-already-ready', detail: 'Stephanos UI 4173 is already reachable; no repair start is needed.' });
  if (finalVerdict !== 'partial-ui-missing') blockers.push({ id: 'readiness-not-partial-ui-missing', detail: `Expected partial-ui-missing readiness verdict, got ${readinessReport?.finalVerdict || 'unknown'}.` });
  for (const blocker of readinessReport?.safetyBlockers || []) blockers.push({ id: `safety-${blocker.id || 'blocker'}`, detail: blocker.detail || 'Readiness safety blocker present.', blocker });
  if (!isAllowedLauncherStartCommand(commandIdentity.commandText)) blockers.push({ id: 'command-not-allowlisted', detail: 'Resolved UI start command is not allowlisted.', commandText: commandIdentity.commandText });

  const allowedToStart = blockers.length === 0;
  return {
    schema: UI_4173_REPAIR_SCHEMA,
    before: readinessReport,
    action: allowedToStart ? (dryRun ? 'dry-run-plan-ui-4173-start' : 'start-ui-4173-spawned') : 'blocked',
    commandIdentity: { id: commandIdentity.id, commandText: commandIdentity.commandText, source: commandIdentity.source, purpose: commandIdentity.purpose },
    dryRun,
    allowedToStart,
    blockers,
    authority: UI_4173_REPAIR_AUTHORITY,
    afterProofInstruction: 'After UI repair starts, rerun: node scripts/battle-bridge-shared-workspace-publisher.mjs --shared-workspace <path> --json && node scripts/launcher-readiness-live-facts.mjs --report --json --shared-workspace <path>. Do not claim live health without Battle Bridge/browser proof.',
  };
}


function formatInvocation(invocation) {
  const formatted = {
    kind: invocation.kind,
    command: invocation.command,
    commandArgs: [...invocation.commandArgs],
    cwd: invocation.cwd,
    shell: invocation.shell,
  };
  if (invocation.wrappedCommand) {
    formatted.wrappedCommand = invocation.wrappedCommand;
    formatted.wrappedCommandArgs = [...invocation.wrappedCommandArgs];
  }
  return formatted;
}

function spawnUi4173Repair({ spawnFn, platform, logs }) {
  const invocation = resolveUi4173RepairInvocation(platform);
  let child;
  try {
    child = spawnFn(invocation.command, invocation.commandArgs, { cwd: invocation.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: invocation.shell });
    if (child?.stdout?.pipe) child.stdout.pipe(createWriteStream(logs.stdoutLogPath, { flags: 'a' }));
    if (child?.stderr?.pipe) child.stderr.pipe(createWriteStream(logs.stderrLogPath, { flags: 'a' }));
  } catch (error) {
    return Promise.resolve({ ok: false, invocation, error });
  }

  if (!(child instanceof EventEmitter) && typeof child?.on !== 'function') {
    if (typeof child?.unref === 'function') child.unref();
    return Promise.resolve({ ok: true, invocation, child });
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once('error', (error) => settle({ ok: false, invocation, error }));
    child.once('spawn', () => {
      if (typeof child.unref === 'function') child.unref();
      settle({ ok: true, invocation, child });
    });
    queueMicrotask(() => {
      if (Number(child?.pid || 0)) {
        if (typeof child.unref === 'function') child.unref();
        settle({ ok: true, invocation, child });
      }
    });
  });
}

export async function runUi4173Repair({ sharedWorkspace = null, dryRun = true, spawnFn = spawn, stdout = process.stdout, platform = process.platform, collectFactsFn = collectLauncherReadinessLiveFacts, plannerFn = planLauncherReadiness, preflightDepsFn = preflightUiBuildDependencies, probeFetch = fetch, readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS } = {}) {
  const facts = await collectFactsFn({ sharedWorkspace });
  const readinessReport = plannerFn(facts);
  const result = evaluateUi4173Repair({ readinessReport, dryRun });
  if (result.allowedToStart && !dryRun) {
    const dependencyPreflight = preflightDepsFn();
    result.dependencyPreflight = dependencyPreflight;
    if (!dependencyPreflight.ok) {
      result.action = 'blocked';
      result.allowedToStart = false;
      result.blockers.push({ id: 'ui-build-dependencies-missing', detail: 'Stephanos UI build dependencies required by ignition are missing.', missing: dependencyPreflight.missing, noLockfileDetected: dependencyPreflight.noLockfileDetected, nextOperatorAction: dependencyPreflight.nextOperatorAction });
      result.missing = dependencyPreflight.missing;
      result.noLockfileDetected = dependencyPreflight.noLockfileDetected;
      result.nextOperatorAction = dependencyPreflight.nextOperatorAction;
      result.started = false;
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 2;
    }
    const logs = createRepairLogs(sharedWorkspace);
    const spawnResult = await spawnUi4173Repair({ spawnFn, platform, logs });
    if (!spawnResult.ok) {
      result.action = 'start-ui-4173-failed';
      result.started = false;
      result.spawnError = {
        code: spawnResult.error?.code || null,
        message: spawnResult.error?.message || String(spawnResult.error || 'spawn failed'),
      };
      result.invocation = formatInvocation(spawnResult.invocation);
      result.ready = false;
      result.logs = logMetadata(logs);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 1;
    }
    result.action = 'start-ui-4173-spawned';
    result.invocation = formatInvocation(spawnResult.invocation);
    result.started = true;
    result.ready = false;
    result.pid = Number(spawnResult.child?.pid || 0) || null;
    const portProof = await waitForUiReady({ probeFetch, timeoutMs: readyTimeoutMs });
    result.portProof = portProof;
    result.processAlive = spawnResult.child?.exitCode == null && spawnResult.child?.signalCode == null ? 'unknown' : false;
    result.logs = logMetadata(logs);
    if (portProof.ready) {
      result.action = 'start-ui-4173-ready';
      result.ready = true;
      result.processAlive = true;
    } else {
      result.action = spawnResult.child?.exitCode != null || spawnResult.child?.signalCode != null ? 'start-ui-4173-failed' : 'start-ui-4173-spawned-but-not-ready';
      result.exit = spawnResult.child?.exitCode != null || spawnResult.child?.signalCode != null ? { code: spawnResult.child.exitCode ?? null, signal: spawnResult.child.signalCode ?? null } : null;
      result.nextOperatorAction = `Inspect captured repair logs at ${logs.logPath}; then rerun Battle Bridge proof commands before claiming UI health.`;
    }
  } else {
    result.started = null;
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.allowedToStart || dryRun ? 0 : 2;
}

function parseArgs(argv) {
  const args = { dryRun: true, sharedWorkspace: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run' || argv[i] === '--report-only') args.dryRun = true;
    else if (argv[i] === '--start' || argv[i] === '--repair') args.dryRun = false;
    else if (argv[i] === '--shared-workspace') { args.sharedWorkspace = argv[i + 1]; i += 1; }
    else if (argv[i] === '--json') {}
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    process.exitCode = await runUi4173Repair(args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
