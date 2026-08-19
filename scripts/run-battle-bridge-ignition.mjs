#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  collectServedRuntimeExactHeadProof,
  createBattleBridgeSupervisorStatus,
  defaultBattleBridgeSharedWorkspace,
  getCurrentGitHead,
  projectBattleBridgeSupervisorStatus,
  runBattleBridgeIgnitionSupervisor,
} from './battle-bridge-ignition-supervisor.mjs';
import { runIgnitionHousekeep } from './ignite-stephanos-local.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendStarterScript = path.join(repoRoot, 'scripts', 'windows', 'start-stephanos-backend.ps1');
const ui4173RefreshScript = path.join(repoRoot, 'scripts', 'refresh-stephanos-ui-4173.mjs');
const SUPERVISOR_PRESERVED_MUTATION_LABELS = new Map([
  ['git-restore-auto-generated', 'preserve the currently served generated dist until exact-head browser proof completes'],
  ['git-clean-dist-untracked', 'preserve the currently served generated dist until exact-head browser proof completes'],
  ['git-restore-runtime-tracked', 'preserve runtime-owned durable memory; runtime dirt is evidence, not source cleanup authority'],
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
    const preservationReason = SUPERVISOR_PRESERVED_MUTATION_LABELS.get(label);
    if (preservationReason) {
      console.log(`[IGNITION ENTRY] ${label} deferred: ${preservationReason}.`);
      return true;
    }

    const ok = runStepFn(label, command, args);
    if (!ok) throw new Error(`${label} failed during Battle Bridge supervisor housekeeping.`);
    return true;
  };
}

export function runSupervisorHousekeepPreservingLiveRuntime(
  options = {},
  { housekeepFn = runIgnitionHousekeep, runStepFn = runStep } = {},
) {
  return housekeepFn({
    ...options,
    runStepFn: createSupervisorHousekeepRunStep({ runStepFn }),
  });
}

export const runSupervisorHousekeepPreservingLiveDist = runSupervisorHousekeepPreservingLiveRuntime;

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

function canonicalUiRefreshInvocation() {
  return {
    command: process.execPath,
    args: [ui4173RefreshScript],
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

  console.log('[IGNITION ENTRY] 4173 preflight: live UI is stale; running bounded build, verify, restart handoff, and exact-head proof.');
  const invocation = canonicalUiRefreshInvocation(platform);
  const refreshStarted = runStepFn('refresh-stale-ui-4173', invocation.command, invocation.args);
  if (!refreshStarted) {
    throw new Error('Bounded UI 4173 refresh failed before Battle Bridge supervisor proof.');
  }

  const after = await waitFn();
  if (!after?.ready) {
    throw new Error(`Bounded UI 4173 refresh completed without exact-head browser proof (${after?.error || 'served runtime remained stale'}).`);
  }

  console.log(`[IGNITION ENTRY] 4173 preflight: stale runtime converged to exact HEAD ${after.currentHead}.`);
  return { action: 'refreshed-stale-ui', before, after };
}

function sharedWorkspaceFromArgs(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--shared-workspace');
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function writePreSupervisorFailureStatus({
  sharedWorkspace = defaultBattleBridgeSharedWorkspace(),
  phase = 'backend 8787',
  blockerId = 'ignition-pre-supervisor-failure',
  detail = 'Ignition failed before the Battle Bridge supervisor could start.',
  nextOperatorAction = 'Inspect the bounded ignition child logs, resolve the exact blocker, then retry Ignition.',
} = {}) {
  let status = createBattleBridgeSupervisorStatus();
  status = projectBattleBridgeSupervisorStatus({
    status,
    phase,
    phaseState: 'blocked',
    blocker: {
      id: blockerId,
      detail,
      nextOperatorAction,
    },
  });

  const statusDir = path.resolve(sharedWorkspace, 'status');
  const statusPath = path.join(statusDir, 'battle-bridge-ignition-supervisor-current.json');
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  return { statusPath, status };
}

export async function main({ platform = process.platform } = {}) {
  process.chdir(repoRoot);
  const sharedWorkspace = sharedWorkspaceFromArgs();

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
      await writePreSupervisorFailureStatus({
        sharedWorkspace,
        phase: 'backend 8787',
        blockerId: 'backend-8787-preflight-failed-before-supervisor',
        detail: 'The bounded backend 8787 preflight failed before the Battle Bridge supervisor could publish its first heartbeat.',
        nextOperatorAction: 'Inspect the bounded backend preflight logs, resolve the reported source/runtime or listener blocker, then retry Ignition.',
      });
      console.error('[IGNITION ENTRY] Battle Bridge supervisor not started because the backend-only 8787 preflight failed.');
      return 1;
    }
  }

  try {
    await ensureLiveUiConvergedBeforeSupervisor({ platform });
  } catch (error) {
    await writePreSupervisorFailureStatus({
      sharedWorkspace,
      phase: 'Stephanos UI 4173',
      blockerId: 'stephanos-ui-4173-preflight-failed-before-supervisor',
      detail: error?.message || 'The bounded UI 4173 preflight failed before the Battle Bridge supervisor could publish its first heartbeat.',
      nextOperatorAction: 'Inspect the bounded UI refresh/proof logs, resolve the exact-head served-runtime blocker, then retry Ignition.',
    });
    throw error;
  }

  const result = await runBattleBridgeIgnitionSupervisor({
    sharedWorkspace,
    housekeepFn: (options) => runSupervisorHousekeepPreservingLiveRuntime(options),
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