#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  collectServedRuntimeExactHeadProof,
  getCurrentGitHead,
  runBattleBridgeIgnitionSupervisor,
} from './battle-bridge-ignition-supervisor.mjs';
import { runIgnitionHousekeep } from './ignite-stephanos-local.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendStarterScript = path.join(repoRoot, 'scripts', 'windows', 'start-stephanos-backend.ps1');
const DIST_MUTATION_LABELS = new Set([
  'git-restore-auto-generated',
  'git-clean-dist-untracked',
]);

export function runStep(label, command, args, { cwd = repoRoot, env = process.env } = {}) {
  console.log(`[IGNITION ENTRY] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env,
  });

  if (result.error || result.status !== 0) {
    const details = [
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error?.message || 'none'}`,
    ].join(', ');
    console.error(`[IGNITION ENTRY] ${label} failed (${details})`);
    return false;
  }

  return true;
}

export function createSupervisorHousekeepRunStep({ runStepFn = runStep } = {}) {
  return (label, command, args) => {
    if (DIST_MUTATION_LABELS.has(label)) {
      console.log(`[IGNITION ENTRY] ${label} deferred: preserve the currently served generated dist until exact-head browser proof completes.`);
      return true;
    }

    const ok = runStepFn(label, command, args);
    if (!ok) throw new Error(`${label} failed during Battle Bridge supervisor housekeeping.`);
    return true;
  };
}

export function runSupervisorHousekeepPreservingLiveDist(
  options = {},
  { housekeepFn = runIgnitionHousekeep, runStepFn = runStep } = {},
) {
  return housekeepFn({
    ...options,
    runStepFn: createSupervisorHousekeepRunStep({ runStepFn }),
  });
}

function timeoutFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 4_000);
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json,text/html,*/*',
      'Cache-Control': 'no-cache',
      ...(options.headers || {}),
    },
  });
}

export async function probeLiveUiExactHead({
  currentHeadFn = getCurrentGitHead,
  proofFn = collectServedRuntimeExactHeadProof,
  fetchFn = timeoutFetch,
} = {}) {
  const currentHead = currentHeadFn({ cwd: repoRoot });
  try {
    const proof = await proofFn({ currentHead, fetchFn });
    return {
      reachable: true,
      ready: proof?.ready === true,
      currentHead,
      proof,
      error: '',
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      currentHead,
      proof: null,
      error: error?.message || String(error),
    };
  }
}

function canonicalUiRefreshInvocation(platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root'],
    };
  }

  return {
    command: 'npm',
    args: ['run', 'stephanos:ignite:launcher-root'],
  };
}

export async function waitForLiveUiExactHead({
  probeFn = probeLiveUiExactHead,
  timeoutMs = 120_000,
  intervalMs = 500,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  do {
    last = await probeFn();
    if (last.ready) return last;
    if (Date.now() >= deadline) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  } while (Date.now() <= deadline);

  return last || { reachable: false, ready: false, error: 'no exact-head proof collected' };
}

export async function ensureLiveUiConvergedBeforeSupervisor({
  platform = process.platform,
  probeFn = probeLiveUiExactHead,
  waitFn = waitForLiveUiExactHead,
  runStepFn = runStep,
} = {}) {
  const before = await probeFn();

  if (!before.reachable) {
    console.log(`[IGNITION ENTRY] 4173 preflight: no live UI proof available (${before.error || 'listener unavailable'}); the full supervisor remains responsible for cold-start repair.`);
    return { action: 'defer-cold-start-to-supervisor', before, after: null };
  }

  if (before.ready) {
    console.log(`[IGNITION ENTRY] 4173 preflight: existing served runtime is exact-head and reusable (${before.currentHead}).`);
    return { action: 'reuse-exact-head-ui', before, after: before };
  }

  console.log(`[IGNITION ENTRY] 4173 preflight: live UI is stale; refreshing through the canonical launcher-root build/verify/restart path.`);
  const invocation = canonicalUiRefreshInvocation(platform);
  const refreshStarted = runStepFn('refresh-stale-ui-4173', invocation.command, invocation.args);
  if (!refreshStarted) {
    throw new Error('Canonical launcher-root refresh failed before Battle Bridge supervisor proof.');
  }

  const after = await waitFn();
  if (!after?.ready) {
    throw new Error(`Canonical launcher-root refresh completed without exact-head browser proof (${after?.error || 'served runtime remained stale'}).`);
  }

  console.log(`[IGNITION ENTRY] 4173 preflight: stale runtime converged to exact HEAD ${after.currentHead}.`);
  return { action: 'refreshed-stale-ui', before, after };
}

function sharedWorkspaceFromArgs(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--shared-workspace');
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main({ platform = process.platform } = {}) {
  if (platform === 'win32') {
    const backendReady = runStep('backend-8787-preflight', 'powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      backendStarterScript,
      '-StartupTimeoutSeconds',
      '90',
      '-PollIntervalSeconds',
      '2',
    ]);

    if (!backendReady) {
      console.error('[IGNITION ENTRY] Battle Bridge supervisor not started because the backend-only 8787 preflight failed.');
      return 1;
    }
  }

  await ensureLiveUiConvergedBeforeSupervisor({ platform });

  const result = await runBattleBridgeIgnitionSupervisor({
    sharedWorkspace: sharedWorkspaceFromArgs(),
    housekeepFn: (options) => runSupervisorHousekeepPreservingLiveDist(options),
  });

  return result.ok ? 0 : 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
