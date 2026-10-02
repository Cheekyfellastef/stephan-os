#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_SCHEMA = 'stephanos.sovereign-commander-ignition-autoheal.v1';
export const SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_MARKER = 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_RESULT=';
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MCP_URL = 'http://127.0.0.1:18791/mcp';
const PROTOCOL = '2025-11-25';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const REQUIRED_COMMANDER_CAPABILITY_VERSION = '2026-10-02-mailbox-rollover-v2';

function text(value) {
  return String(value ?? '').trim();
}

function tokenPath(env = process.env, home = os.homedir()) {
  const profile = text(env.USERPROFILE || env.HOME || home);
  return resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt');
}

async function health(fetchFn) {
  try {
    const response = await fetchFn(HEALTH_URL, { method: 'GET' });
    if (!response.ok) return Object.freeze({ ok: false, capabilityVersion: '' });
    const body = await response.json();
    return Object.freeze({
      ok: body?.ok === true
        && body?.service === 'stephanos-sovereign-commander'
        && body?.capabilityVersion === REQUIRED_COMMANDER_CAPABILITY_VERSION,
      basicHealthy: body?.ok === true && body?.service === 'stephanos-sovereign-commander',
      capabilityVersion: text(body?.capabilityVersion),
    });
  } catch {
    return Object.freeze({ ok: false, basicHealthy: false, capabilityVersion: '' });
  }
}

async function post(fetchFn, token, message, sessionId = '') {
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetchFn(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  return Object.freeze({
    ok: response.ok,
    status: response.status,
    sessionId: text(response.headers?.get?.('mcp-session-id') || sessionId),
    body,
  });
}

async function ensureCommander({
  fetchFn,
  spawnSyncFn,
  repoRoot,
} = {}) {
  const beforeHealth = await health(fetchFn);
  if (beforeHealth.ok) return Object.freeze({ ok: true, bootstrapAttempted: false, staleCapabilityRecycleRequested: false });
  const runner = resolve(repoRoot, 'scripts', 'windows', 'run-sovereign-commander-hidden.ps1');
  const started = spawnSyncFn(POWERSHELL, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner,
    '-RequireCapabilityVersion', REQUIRED_COMMANDER_CAPABILITY_VERSION,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const observed = await health(fetchFn);
    if (observed.ok) return Object.freeze({ ok: true, bootstrapAttempted: true, staleCapabilityRecycleRequested: beforeHealth.basicHealthy === true });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return Object.freeze({
    ok: false,
    bootstrapAttempted: true,
    blocker: started?.error ? text(started.error.code || started.error.message) : 'SOVEREIGN_COMMANDER_HEALTH_UNAVAILABLE',
  });
}

export async function runSovereignCommanderIgnitionAutoheal({
  env = process.env,
  home = os.homedir(),
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  fetchFn = globalThis.fetch,
  readFileFn = readFile,
  spawnSyncFn = spawnSync,
} = {}) {
  const normalizedRepoRoot = resolve(repoRoot);
  const commander = await ensureCommander({ fetchFn, spawnSyncFn, repoRoot: normalizedRepoRoot });
  if (!commander.ok) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_SCHEMA,
      ok: false,
      blocker: commander.blocker,
      commanderBootstrapAttempted: commander.bootstrapAttempted,
      staleCapabilityRecycleRequested: commander.staleCapabilityRecycleRequested === true,
      finalVerdict: 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_BLOCKED',
    });
  }

  let token = '';
  try { token = text(await readFileFn(tokenPath(env, home), 'utf8')); } catch {}
  if (token.length < 32) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_SCHEMA,
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_TOKEN_UNAVAILABLE',
      commanderBootstrapAttempted: commander.bootstrapAttempted,
      finalVerdict: 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_BLOCKED',
    });
  }

  const init = await post(fetchFn, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL, clientInfo: { name: 'stephanos-ignition-autoheal', version: '1.0.0' }, capabilities: {} },
  });
  const sessionId = init.sessionId;
  if (!init.ok || !sessionId) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_SCHEMA,
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_MCP_INITIALIZE_FAILED',
      commanderBootstrapAttempted: commander.bootstrapAttempted,
      finalVerdict: 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_BLOCKED',
    });
  }

  const initialized = await post(fetchFn, token, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, sessionId);
  const listed = await post(fetchFn, token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionId);
  const maintenance = (listed.body?.result?.tools || []).find((tool) => tool?.name === 'maintenance_action');
  const actions = maintenance?.inputSchema?.properties?.actionId?.enum || [];
  if (!initialized.ok || !listed.ok || !actions.includes('repair-control-plane')) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_SCHEMA,
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_ACTION_UNAVAILABLE',
      commanderBootstrapAttempted: commander.bootstrapAttempted,
      finalVerdict: 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_BLOCKED',
    });
  }

  const called = await post(fetchFn, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'maintenance_action', arguments: { actionId: 'repair-control-plane' } },
  }, sessionId);
  const result = called.body?.result?.structuredContent || {};
  const ok = called.ok
    && called.body?.result?.isError !== true
    && result?.ok === true
    && result?.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED';

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_SCHEMA,
    ok,
    blocker: ok ? '' : text(result?.blocker || 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_FAILED'),
    commanderBootstrapAttempted: commander.bootstrapAttempted,
    staleCapabilityRecycleRequested: commander.staleCapabilityRecycleRequested === true,
    proofHash: text(result?.proofHash),
    commandFinalVerdict: text(result?.finalVerdict),
    repairOutput: text(result?.contentText).slice(0, 8000),
    finalVerdict: ok
      ? 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_GREEN'
      : 'SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runSovereignCommanderIgnitionAutoheal({
    repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  });
  process.stdout.write(SOVEREIGN_COMMANDER_IGNITION_AUTOHEAL_MARKER + JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
