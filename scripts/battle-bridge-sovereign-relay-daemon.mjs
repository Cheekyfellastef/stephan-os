#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_RELAY_SCHEMA = 'stephanos.sovereign-relay-daemon.v1';
export const SOVEREIGN_RELAY_FAST_POLL_MS = 2500;
export const SOVEREIGN_RELAY_CHILD_TIMEOUT_MS = 16 * 60 * 1000;

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(homedir(), 'Documents', 'GitHub', 'stephan-os');
const guardPath = resolve(repoRoot, 'scripts', 'battle-bridge-github-command-mailbox-outbox-guard-v1.mjs');

function text(value) {
  return String(value ?? '').trim();
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function boundedText(value, max = 160) {
  return text(value).replace(/[\r\n\0]/g, ' ').slice(0, max);
}

function parseGuardResult(stdout = '') {
  const candidate = text(stdout);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export function classifySovereignRelayGuardCycle({ exitCode = null, stdout = '', stderr = '', error = null } = {}) {
  const parsed = parseGuardResult(stdout);
  const blocker = boundedText(parsed?.blocker || '');
  const detail = boundedText(parsed?.error || stderr || error?.message || '');
  const busy = blocker === 'MAILBOX_OUTBOX_GUARD_FAILED' && /MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING/i.test(detail);
  const ok = exitCode === 0 && parsed?.ok === true;
  return Object.freeze({
    ok: ok || busy,
    busy,
    blocker: ok || busy ? '' : (blocker || 'SOVEREIGN_RELAY_GUARD_CYCLE_BLOCKED'),
    guardVerdict: boundedText(parsed?.finalVerdict || ''),
    detail: ok || busy ? '' : detail,
    childExitCode: Number.isInteger(exitCode) ? exitCode : null,
  });
}

export async function runSovereignRelayGuardCycle({
  spawnFn = spawn,
  env = process.env,
  childTimeoutMs = SOVEREIGN_RELAY_CHILD_TIMEOUT_MS,
} = {}) {
  return new Promise((resolveCycle) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawnFn(process.execPath, [guardPath], {
      cwd: repoRoot,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCycle(result);
    };
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 128 * 1024) stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 32 * 1024) stderr += String(chunk);
    });
    child.once('error', (error) => {
      finish(classifySovereignRelayGuardCycle({ stdout, stderr, error }));
    });
    child.once('exit', (code) => {
      finish(classifySovereignRelayGuardCycle({ exitCode: code, stdout, stderr }));
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(Object.freeze({
        ok: false,
        busy: false,
        blocker: 'SOVEREIGN_RELAY_GUARD_CYCLE_TIMEOUT',
        guardVerdict: '',
        detail: '',
        childExitCode: null,
      }));
    }, childTimeoutMs);
    timer.unref?.();
  });
}

export function buildSovereignRelayStatus({
  now = new Date(),
  cycle = {},
  cycleStartedAtMs = Date.now(),
  cycleCompletedAtMs = Date.now(),
} = {}) {
  const completedAt = now instanceof Date ? now : new Date(now);
  return Object.freeze({
    schemaVersion: SOVEREIGN_RELAY_SCHEMA,
    daemonHealthy: cycle?.ok === true,
    carrier: 'github-command-mailbox',
    executionOwner: 'sovereign-commander',
    authorityOwner: 'stephanos',
    fastPollMs: SOVEREIGN_RELAY_FAST_POLL_MS,
    cycleStartedAtUtc: new Date(cycleStartedAtMs).toISOString(),
    heartbeatAtUtc: completedAt.toISOString(),
    cycleDurationMs: Math.max(0, cycleCompletedAtMs - cycleStartedAtMs),
    carrierBusy: cycle?.busy === true,
    blocker: boundedText(cycle?.blocker || ''),
    guardVerdict: boundedText(cycle?.guardVerdict || ''),
    childExitCode: Number.isInteger(cycle?.childExitCode) ? cycle.childExitCode : null,
    externalCarrierRequiredForCloudChat: true,
    externalCarrierOwnsExecution: false,
    externalCarrierOwnsState: false,
    externalCarrierOwnsAuthority: false,
    vendorMeterRequiredForSovereignExecution: false,
    duplicateExecutionAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    retainedFallbacks: Object.freeze([
      'scheduled-github-mailbox',
      'tailscale-private',
      'openai-secure-mcp-tunnel',
      'remote-desktop-commander',
    ]),
    finalVerdict: cycle?.ok === true
      ? 'SOVEREIGN_RELAY_DAEMON_HEALTHY'
      : 'SOVEREIGN_RELAY_DAEMON_DEGRADED',
  });
}

export async function runSovereignRelayDaemon({
  env = process.env,
  pollMs = SOVEREIGN_RELAY_FAST_POLL_MS,
  runCycle = runSovereignRelayGuardCycle,
  now = () => new Date(),
  sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
  once = process.argv.includes('--once'),
} = {}) {
  if (process.platform === 'win32' && !samePath(repoRoot, expectedRepoRoot)) {
    throw new Error(`SOVEREIGN_RELAY_CANONICAL_CHECKOUT_REQUIRED:${expectedRepoRoot}`);
  }
  if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60_000) {
    throw new Error('SOVEREIGN_RELAY_POLL_INTERVAL_INVALID');
  }
  const workspace = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!workspace.ok) throw new Error(`SOVEREIGN_RELAY_WORKSPACE_BLOCKED:${workspace.reason}`);
  const statusPath = resolve(workspace.root, 'status', 'sovereign-relay-current.json');

  let lastStatus = null;
  do {
    const startedAtMs = Date.now();
    let cycle;
    try {
      cycle = await runCycle({ env });
    } catch (error) {
      cycle = Object.freeze({
        ok: false,
        busy: false,
        blocker: 'SOVEREIGN_RELAY_GUARD_CYCLE_EXCEPTION',
        guardVerdict: '',
        detail: boundedText(error?.message || error),
        childExitCode: null,
      });
    }
    const completedAtMs = Date.now();
    lastStatus = buildSovereignRelayStatus({
      now: now(),
      cycle,
      cycleStartedAtMs: startedAtMs,
      cycleCompletedAtMs: completedAtMs,
    });
    await atomicWriteJson(statusPath, lastStatus);
    process.stdout.write(`${JSON.stringify(lastStatus)}\n`);
    if (!once) await sleep(pollMs);
  } while (!once);

  return lastStatus;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runSovereignRelayDaemon().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: SOVEREIGN_RELAY_SCHEMA,
      daemonHealthy: false,
      blocker: boundedText(error?.message || error),
      arbitraryShellAllowed: false,
      finalVerdict: 'SOVEREIGN_RELAY_DAEMON_BLOCKED',
    })}\n`);
    process.exitCode = 1;
  });
}
