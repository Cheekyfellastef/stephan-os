#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectLauncherReadinessLiveFacts } from './launcher-readiness-live-facts.mjs';
import { isAllowedLauncherStartCommand, planLauncherReadiness } from './launcher-readiness-planner.mjs';

export const UI_4173_REPAIR_SCHEMA = 'stephanos.battle-bridge-ui-4173-repair-plan.v1';
export function resolveUi4173RepairInvocation(platform = process.platform) {
  return Object.freeze({
    command: platform === 'win32' ? 'npm.cmd' : 'npm',
    commandArgs: Object.freeze(['run', 'stephanos:ignite:launcher-root']),
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
    action: allowedToStart ? (dryRun ? 'dry-run-plan-ui-4173-start' : 'start-ui-4173') : 'blocked',
    commandIdentity: { id: commandIdentity.id, commandText: commandIdentity.commandText, source: commandIdentity.source, purpose: commandIdentity.purpose },
    dryRun,
    allowedToStart,
    blockers,
    authority: UI_4173_REPAIR_AUTHORITY,
    afterProofInstruction: 'After UI repair starts, rerun: node scripts/battle-bridge-shared-workspace-publisher.mjs --shared-workspace <path> --json && node scripts/launcher-readiness-live-facts.mjs --report --json --shared-workspace <path>. Do not claim live health without Battle Bridge/browser proof.',
  };
}


function spawnUi4173Repair({ spawnFn, platform }) {
  const invocation = resolveUi4173RepairInvocation(platform);
  let child;
  try {
    child = spawnFn(invocation.command, invocation.commandArgs, { cwd: process.cwd(), detached: true, stdio: 'ignore', shell: false });
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

export async function runUi4173Repair({ sharedWorkspace = null, dryRun = true, spawnFn = spawn, stdout = process.stdout, platform = process.platform, collectFactsFn = collectLauncherReadinessLiveFacts, plannerFn = planLauncherReadiness } = {}) {
  const facts = await collectFactsFn({ sharedWorkspace });
  const readinessReport = plannerFn(facts);
  const result = evaluateUi4173Repair({ readinessReport, dryRun });
  if (result.allowedToStart && !dryRun) {
    const spawnResult = await spawnUi4173Repair({ spawnFn, platform });
    if (!spawnResult.ok) {
      result.action = 'start-ui-4173-failed';
      result.started = false;
      result.spawnError = {
        code: spawnResult.error?.code || null,
        message: spawnResult.error?.message || String(spawnResult.error || 'spawn failed'),
      };
      result.invocation = { command: spawnResult.invocation.command, commandArgs: [...spawnResult.invocation.commandArgs] };
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 1;
    }
    result.invocation = { command: spawnResult.invocation.command, commandArgs: [...spawnResult.invocation.commandArgs] };
    result.started = { pid: Number(spawnResult.child?.pid || 0) || null, commandId: UI_4173_REPAIR_COMMAND_IDENTITY.id };
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
