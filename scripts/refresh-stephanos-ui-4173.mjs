#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  collectServedRuntimeExactHeadProof,
  getCurrentGitHead,
} from './battle-bridge-ignition-supervisor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticServerScript = path.join(repoRoot, 'scripts', 'serve-stephanos-dist.mjs');
const healthUrl = 'http://127.0.0.1:4173/__stephanos/health';
const restartUrl = 'http://127.0.0.1:4173/__stephanos/restart';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 4_000);
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Cache-Control': 'no-cache',
      ...(options.headers || {}),
    },
  });
}

export function resolveNpmStep(platform, scriptName) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'run', scriptName],
    };
  }

  return {
    command: 'npm',
    args: ['run', scriptName],
  };
}

export function runCheckedStep(label, command, args, {
  cwd = repoRoot,
  env = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  console.log(`[UI 4173 REFRESH] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSyncFn(command, args, {
    cwd,
    env,
    shell: false,
    stdio: 'inherit',
  });

  if (result?.error || result?.status !== 0) {
    const details = [
      `status=${result?.status ?? 'null'}`,
      `signal=${result?.signal ?? 'null'}`,
      `error=${result?.error?.message || 'none'}`,
    ].join(', ');
    throw new Error(`${label} failed (${details})`);
  }

  return true;
}

export async function probeUiHealth({ fetchFn = timeoutFetch } = {}) {
  try {
    const response = await fetchFn(healthUrl, {
      headers: { Accept: 'application/json' },
      timeoutMs: 3_000,
    });
    return {
      reachable: Boolean(response?.ok),
      status: response?.status ?? null,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error: error?.message || String(error),
    };
  }
}

export async function requestUiRestart({ fetchFn = timeoutFetch } = {}) {
  const response = await fetchFn(restartUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'battle-bridge-ignition-entry',
      reason: 'stale-live-runtime-refresh',
    }),
    timeoutMs: 5_000,
  });

  if (!response?.ok && response?.status !== 202) {
    throw new Error(`4173 restart endpoint returned ${response?.status || 'unknown'}`);
  }

  return {
    accepted: true,
    status: response?.status ?? 202,
  };
}

export async function waitForUiHealthState({
  expectedReachable,
  probeFn = probeUiHealth,
  timeoutMs = 20_000,
  intervalMs = 250,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  do {
    last = await probeFn();
    if (Boolean(last?.reachable) === Boolean(expectedReachable)) {
      return { reached: true, last };
    }
    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  } while (Date.now() <= deadline);

  return { reached: false, last };
}

function defaultSharedWorkspace(env = process.env) {
  return env.STEPHANOS_SHARED_WORKSPACE
    || env.STEPHANOS_OPENCLAW_WORKSPACE
    || path.join(env.USERPROFILE || env.HOME || os.homedir(), 'Documents', 'Stephanos-openclaw-workspace');
}

export function startStaticServerDetached({
  spawnFn = spawn,
  env = process.env,
  sharedWorkspace = defaultSharedWorkspace(env),
  now = () => new Date(),
} = {}) {
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(sharedWorkspace, 'logs', 'stephanos-ui-4173-refresh', stamp);
  mkdirSync(logPath, { recursive: true });
  const stdoutLogPath = path.join(logPath, 'stdout.log');
  const stderrLogPath = path.join(logPath, 'stderr.log');
  const stdoutFd = openSync(stdoutLogPath, 'a');
  const stderrFd = openSync(stderrLogPath, 'a');

  let child;
  try {
    child = spawnFn(process.execPath, [staticServerScript], {
      cwd: repoRoot,
      env: {
        ...env,
        STEPHANOS_IGNITION_MODE: 'launcher-root',
      },
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  if (!child || !Number(child.pid || 0)) {
    throw new Error('Static server process did not return a PID.');
  }

  child.unref?.();
  return {
    started: true,
    pid: Number(child.pid),
    logPath,
    stdoutLogPath,
    stderrLogPath,
  };
}

export async function waitForExactHeadProof({
  currentHead,
  proofFn = collectServedRuntimeExactHeadProof,
  fetchFn = timeoutFetch,
  timeoutMs = 120_000,
  intervalMs = 500,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = '';

  do {
    try {
      last = await proofFn({ currentHead, fetchFn });
      if (last?.ready === true) {
        return { ready: true, proof: last, error: '' };
      }
    } catch (error) {
      lastError = error?.message || String(error);
    }

    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  } while (Date.now() <= deadline);

  return {
    ready: false,
    proof: last,
    error: lastError || 'served runtime did not converge to exact HEAD before timeout',
  };
}

export async function refreshStephanosUi4173({
  platform = process.platform,
  expectedHead = '',
  currentHeadFn = getCurrentGitHead,
  runStepFn = runCheckedStep,
  probeHealthFn = probeUiHealth,
  requestRestartFn = requestUiRestart,
  waitForHealthStateFn = waitForUiHealthState,
  startServerFn = startStaticServerDetached,
  waitForExactHeadFn = waitForExactHeadProof,
} = {}) {
  const expected = String(expectedHead || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected)) throw new Error('UI_4173_REFRESH_EXPECTED_HEAD_REQUIRED');
  const proveExpectedHead = () => {
    const observed = String(currentHeadFn({ cwd: repoRoot, platform }) || '').trim().toLowerCase();
    if (observed !== expected) throw new Error('UI_4173_REFRESH_EXPECTED_HEAD_MISMATCH');
    return observed;
  };
  const currentHead = proveExpectedHead();
  const build = resolveNpmStep(platform, 'stephanos:build');
  const verify = resolveNpmStep(platform, 'stephanos:verify');

  runStepFn('build-current-ui', build.command, build.args);
  runStepFn('verify-current-ui', verify.command, verify.args);
  proveExpectedHead();

  const before = await probeHealthFn();
  let restart = { requested: false, accepted: false };
  if (before.reachable) {
    proveExpectedHead();
    const restartResult = await requestRestartFn();
    restart = { requested: true, ...restartResult };
    const stopped = await waitForHealthStateFn({ expectedReachable: false });
    if (!stopped.reached) {
      throw new Error('Existing 4173 server accepted restart but did not stop within the bounded handoff window.');
    }
  }

  proveExpectedHead();
  const start = startServerFn();
  const exactHead = await waitForExactHeadFn({ currentHead: expected });
  if (!exactHead.ready) {
    throw new Error(`Replacement 4173 server failed exact-head proof (${exactHead.error || 'unknown proof failure'}). Logs: ${start.logPath || 'unavailable'}`);
  }

  return {
    schema: 'stephanos.ui-4173-refresh.v1',
    refreshed: true,
    currentHead,
    before,
    restart,
    start,
    exactHeadProof: exactHead.proof,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const expectedHeadIndex = process.argv.indexOf('--expected-head');
    const expectedHead = expectedHeadIndex >= 0 ? process.argv[expectedHeadIndex + 1] : '';
    const result = await refreshStephanosUi4173({ expectedHead });
    console.log(`[UI 4173 REFRESH] result=${JSON.stringify(result)}`);
    process.exitCode = 0;
  } catch (error) {
    console.error(`[UI 4173 REFRESH] failed: ${error?.stack || error?.message || String(error)}`);
    process.exitCode = 1;
  }
}
