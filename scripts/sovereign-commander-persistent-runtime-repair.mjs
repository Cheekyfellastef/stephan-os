#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  battleBridgeCanonicalRepositoryArgs,
  resolveBattleBridgeGitExecution,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_SCHEMA =
  'stephanos.sovereign-persistent-runtime-repair-dispatch.v1';
export const SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_MARKER =
  'SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_RESULT=';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SHA40 = /^[a-f0-9]{40}$/;

const PLANS = Object.freeze({
  backend: Object.freeze({
    taskName: 'Stephanos Battle Bridge Backend',
    taskId: 'backend',
    logonType: '',
  }),
  frontend: Object.freeze({
    taskName: 'Stephanos Battle Bridge Frontend',
    taskId: 'frontend',
    logonType: 'S4U',
  }),
});

function text(value) {
  return String(value ?? '').trim();
}

function blocked(blocker, target = '', extra = {}) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_SCHEMA,
    ok: false,
    target,
    blocker,
    dispatchAttempted: false,
    taskDefinitionChanged: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    ...extra,
    finalVerdict: 'SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_BLOCKED',
  });
}

function currentSourceHead({ repoRoot = REPO_ROOT, platform = process.platform, environment = process.env, spawnSyncFn = spawnSync } = {}) {
  const git = resolveBattleBridgeGitExecution({ platform, environment });
  const base = [...git.fixedConfigArgs, ...battleBridgeCanonicalRepositoryArgs(repoRoot)];
  const run = args => spawnSyncFn(git.executable, [...base, ...args], {
    cwd: repoRoot,
    env: git.environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  const branch = run(['branch', '--show-current']);
  const head = run(['rev-parse', 'HEAD']);
  const observed = text(head?.stdout).toLowerCase();
  if (branch?.error || branch?.status !== 0 || text(branch?.stdout) !== 'main'
      || head?.error || head?.status !== 0 || !SHA40.test(observed)) return '';
  return observed;
}

function encodedTaskDispatch(plan, repoRoot) {
  const launcher = resolve(repoRoot, 'scripts', 'windows', 'run-stephanos-scheduled-task-windowless.vbs');
  const expectedArguments = `//B //NoLogo "${launcher}" ${plan.taskId}`;
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$taskName=" + JSON.stringify(plan.taskName),
    "$expectedExecute='C:\\Windows\\System32\\wscript.exe'",
    "$expectedArguments=" + JSON.stringify(expectedArguments),
    "$task=Get-ScheduledTask -TaskName $taskName -TaskPath '\\' -ErrorAction Stop",
    "if(@($task.Actions).Count -ne 1){throw 'PERSISTENT_RUNTIME_TASK_ACTION_COUNT_INVALID'}",
    "$action=@($task.Actions)[0]",
    "if(-not [string]::Equals([string]$action.Execute,$expectedExecute,[StringComparison]::OrdinalIgnoreCase)){throw 'PERSISTENT_RUNTIME_TASK_EXECUTABLE_CHANGED'}",
    "if([string]$action.Arguments -cne $expectedArguments){throw 'PERSISTENT_RUNTIME_TASK_ARGUMENTS_CHANGED'}",
    "if([string]$task.Principal.RunLevel -ne 'Limited'){throw 'PERSISTENT_RUNTIME_TASK_RUNLEVEL_CHANGED'}",
    ...(plan.logonType
      ? ["if([string]$task.Principal.LogonType -ne " + JSON.stringify(plan.logonType) + "){throw 'PERSISTENT_RUNTIME_TASK_LOGON_TYPE_CHANGED'}"]
      : []),
    "$before=[string]$task.State",
    "Start-ScheduledTask -TaskName $taskName -TaskPath '\\' -ErrorAction Stop",
    "[pscustomobject]@{ok=$true;taskName=$taskName;stateBefore=$before;dispatchAttempted=$true}|ConvertTo-Json -Compress",
  ].join("\n");
  return Buffer.from(ps, 'utf16le').toString('base64');
}

export function dispatchPersistentRuntimeRepair({
  target,
  expectedHead,
  repoRoot = REPO_ROOT,
  platform = process.platform,
  environment = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  const plan = PLANS[target];
  if (!plan) return blocked('PERSISTENT_RUNTIME_REPAIR_TARGET_NOT_ALLOWED', text(target));
  const expected = text(expectedHead).toLowerCase();
  if (!SHA40.test(expected)) return blocked('PERSISTENT_RUNTIME_REPAIR_EXPECTED_HEAD_REQUIRED', target);
  const beforeHead = currentSourceHead({ repoRoot, platform, environment, spawnSyncFn });
  if (beforeHead !== expected) return blocked('PERSISTENT_RUNTIME_REPAIR_SOURCE_CHANGED', target, { expectedHead: expected });

  const result = spawnSyncFn(POWERSHELL, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedTaskDispatch(plan, repoRoot),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 32 * 1024,
  });
  const afterHead = currentSourceHead({ repoRoot, platform, environment, spawnSyncFn });
  if (afterHead !== expected) return blocked('PERSISTENT_RUNTIME_REPAIR_SOURCE_CHANGED', target, {
    expectedHead: expected, dispatchAttempted: result?.status === 0,
  });

  let receipt = null;
  try { receipt = JSON.parse(text(result?.stdout)); } catch {}
  const ok = !result?.error && result?.status === 0 && receipt?.ok === true
    && receipt?.taskName === plan.taskName && receipt?.dispatchAttempted === true;
  const stderrToken = text(result?.stderr).split(/\r?\n/).map(value => value.trim())
    .find(value => /^[A-Z0-9_]{1,120}$/.test(value)) || '';
  if (!ok) return Object.freeze({
    ...blocked(stderrToken || 'PERSISTENT_RUNTIME_REPAIR_TASK_DISPATCH_UNPROVEN', target, {
      expectedHead: expected,
      dispatchAttempted: receipt?.dispatchAttempted === true,
    }),
  });

  return Object.freeze({
    schemaVersion: SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_SCHEMA,
    ok: true,
    target,
    expectedHead: expected,
    taskName: plan.taskName,
    stateBefore: text(receipt.stateBefore).slice(0, 40),
    dispatchAttempted: true,
    taskDefinitionChanged: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    finalVerdict: 'SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_DISPATCHED',
  });
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4
      || argv[0] !== '--target' || !Object.hasOwn(PLANS, argv[1])
      || argv[2] !== '--expected-head' || !SHA40.test(argv[3] || '')) {
    throw new Error('PERSISTENT_RUNTIME_REPAIR_ARGUMENTS_INVALID');
  }
  return Object.freeze({ target: argv[1], expectedHead: argv[3].toLowerCase() });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  try {
    const args = parseArgs(process.argv.slice(2));
    result = dispatchPersistentRuntimeRepair(args);
  } catch {
    result = blocked('PERSISTENT_RUNTIME_REPAIR_ARGUMENTS_INVALID');
  }
  process.stdout.write(SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_MARKER + JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 2;
}
