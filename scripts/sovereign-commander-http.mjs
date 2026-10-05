#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createSovereignCommanderMcpHandler } from './sovereign-commander-mcp.mjs';

export const SOVEREIGN_COMMANDER_HTTP_HOST = '127.0.0.1';
export const SOVEREIGN_COMMANDER_HTTP_PORT = 18791;
export const SOVEREIGN_COMMANDER_HTTP_MAX_BODY_BYTES = 1024 * 1024;
export const SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION = '2026-10-05-continuous-repair-liveness-v3';
export const SOVEREIGN_COMMANDER_REMOTE_IGNITION_PATH = '/ignite';
export const SOVEREIGN_COMMANDER_REMOTE_IGNITION_NONCE_TTL_MS = 5 * 60 * 1000;
export const SOVEREIGN_COMMANDER_REMOTE_IGNITION_MAX_NONCES = 32;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_START_DELAY_MS = 5_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_INTERVAL_MS = 60_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_RUNTIME_MS = 240_000;
export const SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_OUTPUT_BYTES = 64 * 1024;
const SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER = 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=';

function text(value) {
  return String(value ?? '').trim();
}

function loopbackHost(value) {
  return ['127.0.0.1', '::1', 'localhost'].includes(text(value).toLowerCase());
}

function parseContinuousRepairReceipt(stdout = '') {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith(SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER))
    .at(-1);
  if (!line) return {};
  try {
    const parsed = JSON.parse(line.slice(SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER.length));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function appendBoundedOutput(current, chunk, maxBytes) {
  const joined = String(current || '') + String(chunk || '');
  if (Buffer.byteLength(joined, 'utf8') <= maxBytes) return joined;
  return Buffer.from(joined, 'utf8').subarray(-maxBytes).toString('utf8');
}

export function startSovereignCommanderContinuousRepairGuardian(options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const now = options.now || (() => new Date().toISOString());
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const repairScript = options.repairScript
    || fileURLToPath(new URL('./sovereign-commander-stephanos-repair.mjs', import.meta.url));
  const repoRoot = options.repoRoot || fileURLToPath(new URL('..', import.meta.url));
  const startDelayMs = Number.isSafeInteger(Number(options.startDelayMs))
    ? Math.max(0, Number(options.startDelayMs))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_START_DELAY_MS;
  const intervalMs = Number.isSafeInteger(Number(options.intervalMs))
    ? Math.max(1_000, Number(options.intervalMs))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_INTERVAL_MS;
  const maxRuntimeMs = Number.isSafeInteger(Number(options.maxRuntimeMs))
    ? Math.max(1_000, Number(options.maxRuntimeMs))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_RUNTIME_MS;
  const maxOutputBytes = Number.isSafeInteger(Number(options.maxOutputBytes))
    ? Math.max(1_024, Number(options.maxOutputBytes))
    : SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_MAX_OUTPUT_BYTES;

  let stopped = false;
  let scheduledTimer = null;
  let killTimer = null;
  let child = null;
  const state = {
    enabled: true,
    running: false,
    scheduled: false,
    cycleCount: 0,
    successCount: 0,
    failureCount: 0,
    lastStartedAtUtc: '',
    lastCompletedAtUtc: '',
    lastOk: null,
    lastBlocker: '',
    lastFinalVerdict: '',
  };

  const status = () => Object.freeze({ ...state });

  const schedule = (delayMs) => {
    if (stopped) return;
    state.scheduled = true;
    scheduledTimer = setTimeoutImpl(() => {
      scheduledTimer = null;
      state.scheduled = false;
      runNow();
    }, delayMs);
    scheduledTimer?.unref?.();
  };

  const runNow = () => {
    if (stopped || child) return false;
    state.running = true;
    state.scheduled = false;
    state.cycleCount += 1;
    state.lastStartedAtUtc = now();
    state.lastBlocker = '';
    state.lastFinalVerdict = '';

    let stdout = '';
    let stderr = '';
    let settled = false;
    let currentChild;
    const finish = (code, fallbackBlocker = '') => {
      if (settled) return;
      settled = true;
      if (killTimer) {
        clearTimeoutImpl(killTimer);
        killTimer = null;
      }
      const receipt = parseContinuousRepairReceipt(stdout);
      const ok = Number(code) === 0 && receipt?.ok === true;
      state.running = false;
      state.lastCompletedAtUtc = now();
      state.lastOk = ok;
      state.lastFinalVerdict = text(receipt?.finalVerdict || (ok ? 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_GREEN' : 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED'));
      state.lastBlocker = ok
        ? ''
        : text(receipt?.blocker || fallbackBlocker || stderr || 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_FAILED').slice(0, 160);
      if (ok) state.successCount += 1;
      else state.failureCount += 1;
      child = null;
      schedule(intervalMs);
    };

    try {
      currentChild = spawnImpl(nodeExecutable, [repairScript], {
        cwd: repoRoot,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = currentChild;
      currentChild.stdout?.on?.('data', (chunk) => {
        stdout = appendBoundedOutput(stdout, chunk, maxOutputBytes);
      });
      currentChild.stderr?.on?.('data', (chunk) => {
        stderr = appendBoundedOutput(stderr, chunk, maxOutputBytes);
      });
      currentChild.once?.('error', (error) => {
        finish(null, text(error?.code || error?.message || 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_SPAWN_FAILED'));
      });
      currentChild.once?.('close', (code) => finish(code));
      killTimer = setTimeoutImpl(() => {
        try { currentChild.kill?.(); } catch {}
        finish(null, 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT');
      }, maxRuntimeMs);
      killTimer?.unref?.();
    } catch (error) {
      finish(null, text(error?.code || error?.message || 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_SPAWN_FAILED'));
    }
    return true;
  };

  schedule(startDelayMs);

  return Object.freeze({
    status,
    runNow,
    stop: () => {
      stopped = true;
      state.enabled = false;
      state.scheduled = false;
      state.running = false;
      if (scheduledTimer) clearTimeoutImpl(scheduledTimer);
      if (killTimer) clearTimeoutImpl(killTimer);
      try { child?.kill?.(); } catch {}
      scheduledTimer = null;
      killTimer = null;
      child = null;
    },
  });
}

function tokenFile(env = process.env) {
  const configured = text(env.STEPHANOS_SOVEREIGN_COMMANDER_TOKEN_FILE);
  if (configured) return resolve(configured);
  const profile = text(env.USERPROFILE || env.HOME) || homedir();
  return resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt');
}

export async function loadSovereignCommanderToken(options = {}) {
  if (text(options.token)) return text(options.token);
  const path = options.tokenFile || tokenFile(options.env || process.env);
  try {
    const token = text(await (options.readFileImpl || readFile)(path, 'utf8'));
    return token.length >= 32 ? token : '';
  } catch {
    return '';
  }
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(req) {
  const auth = text(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? text(match[1]) : '';
}

async function readJsonBody(req, maxBytes = SOVEREIGN_COMMANDER_HTTP_MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('REQUEST_BODY_TOO_LARGE'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); }
  catch { throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }); }
}

function sendJson(res, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function remoteIgnitionHtml(nonce) {
  const safeNonce = JSON.stringify(String(nonce || ''));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Stephanos Remote Ignition</title>
<style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d14;color:#eef4ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
main{width:min(92vw,520px);padding:28px;box-sizing:border-box;text-align:center}
h1{font-size:clamp(28px,7vw,44px);margin:0 0 12px}p{opacity:.78;line-height:1.45}
button{width:100%;min-height:84px;margin-top:22px;border:0;border-radius:22px;font-size:24px;font-weight:750;cursor:pointer}
button:disabled{opacity:.55;cursor:wait}#status{min-height:52px;margin-top:20px;font-weight:650}
small{display:block;margin-top:28px;opacity:.5}
</style>
</head>
<body>
<main>
<h1>🔥 Stephanos Ignition</h1>
<p>Private Battle Bridge control over your Tailscale network.</p>
<button id="ignite" type="button">Ignite Stephanos</button>
<div id="status" role="status" aria-live="polite"></div>
<small>Fixed action only. No arbitrary shell or PC restart authority.</small>
</main>
<script>
const nonce=${safeNonce};
const button=document.getElementById('ignite');
const status=document.getElementById('status');
button.addEventListener('click',async()=>{
  button.disabled=true; status.textContent='Igniting…';
  try{
    const response=await fetch('/ignite',{
      method:'POST',
      headers:{'content-type':'application/json','x-stephanos-ignition-nonce':nonce},
      body:JSON.stringify({action:'ignite-stephanos'})
    });
    const body=await response.json();
    status.textContent=body.ok?'Ignition command accepted ✅':('Blocked: '+(body.blocker||body.finalVerdict||response.status));
  }catch{status.textContent='Could not reach Sovereign Commander.'}
  finally{button.disabled=false}
});
</script>
</body>
</html>`;
}

function pruneIgnitionNonces(nonces, nowMs) {
  for (const [nonce, expiry] of nonces) {
    if (!Number.isFinite(expiry) || expiry <= nowMs) nonces.delete(nonce);
  }
  while (nonces.size >= SOVEREIGN_COMMANDER_REMOTE_IGNITION_MAX_NONCES) {
    const oldest = nonces.keys().next().value;
    if (!oldest) break;
    nonces.delete(oldest);
  }
}

async function executeFixedRemoteIgnition(handlerFactory) {
  const handler = handlerFactory();
  await handler('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'tailnet-remote-ignition', version: '1.0.0' },
    capabilities: {},
  }, { id: 1, isRequest: true, isNotification: false });
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  const listed = await handler('tools/list', {}, { id: 2, isRequest: true, isNotification: false });
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  if (!tools.some((tool) => text(tool?.name) === 'maintenance_action')) {
    return Object.freeze({ ok: false, blocker: 'REMOTE_IGNITION_MAINTENANCE_ACTION_UNAVAILABLE', finalVerdict: 'REMOTE_IGNITION_BLOCKED' });
  }
  const called = await handler('tools/call', {
    name: 'maintenance_action',
    arguments: { actionId: 'ignite-stephanos' },
  }, { id: 3, isRequest: true, isNotification: false });
  const outer = called?.structuredContent && typeof called.structuredContent === 'object' && !Array.isArray(called.structuredContent)
    ? called.structuredContent
    : {};
  const inner = outer?.structuredContent && typeof outer.structuredContent === 'object' && !Array.isArray(outer.structuredContent)
    ? outer.structuredContent
    : outer;
  const ok = called?.isError !== true && outer?.ok === true;
  return Object.freeze({
    ok,
    blocker: ok ? '' : text(inner?.blocker || outer?.blocker || 'REMOTE_IGNITION_EXECUTION_BLOCKED'),
    finalVerdict: text(inner?.finalVerdict || outer?.finalVerdict || (ok ? 'REMOTE_IGNITION_ACCEPTED' : 'REMOTE_IGNITION_BLOCKED')),
  });
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function validRpcMessage(message) {
  const object = Boolean(message) && typeof message === 'object' && !Array.isArray(message);
  const hasId = object && Object.prototype.hasOwnProperty.call(message, 'id');
  const idOk = !hasId || typeof message.id === 'string' || Number.isSafeInteger(message.id);
  return object && message.jsonrpc === '2.0' && typeof message.method === 'string' && idOk;
}

export async function createSovereignCommanderHttpServer(options = {}) {
  const env = options.env || process.env;
  const host = text(options.host || env.STEPHANOS_SOVEREIGN_COMMANDER_HOST) || SOVEREIGN_COMMANDER_HTTP_HOST;
  const port = Number.isSafeInteger(Number(options.port ?? env.STEPHANOS_SOVEREIGN_COMMANDER_PORT))
    ? Number(options.port ?? env.STEPHANOS_SOVEREIGN_COMMANDER_PORT)
    : SOVEREIGN_COMMANDER_HTTP_PORT;
  if (!loopbackHost(host) && options.allowNonLoopback !== true) {
    throw new Error('SOVEREIGN_COMMANDER_NON_LOOPBACK_BIND_REQUIRES_EXPLICIT_APPROVAL');
  }

  const token = await loadSovereignCommanderToken(options);
  if (!token) throw new Error('SOVEREIGN_COMMANDER_BEARER_TOKEN_REQUIRED');

  const sessions = new Map();
  const ignitionNonces = new Map();
  const handlerFactory = options.handlerFactory || (() => createSovereignCommanderMcpHandler({ repoRoot: options.repoRoot }));
  const now = options.now || (() => new Date().toISOString());
  const nowMs = options.nowMs || (() => {
    const value = Date.parse(now());
    return Number.isFinite(value) ? value : Date.now();
  });
  const continuousRepairGuardian = options.continuousRepairEnabled === true
    ? startSovereignCommanderContinuousRepairGuardian({
      repoRoot: options.repoRoot,
      spawnImpl: options.continuousRepairSpawnImpl,
      setTimeoutImpl: options.continuousRepairSetTimeoutImpl,
      clearTimeoutImpl: options.continuousRepairClearTimeoutImpl,
      now,
      startDelayMs: options.continuousRepairStartDelayMs,
      intervalMs: options.continuousRepairIntervalMs,
      maxRuntimeMs: options.continuousRepairMaxRuntimeMs,
    })
    : null;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'stephanos-sovereign-commander',
          capabilityVersion: SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION,
          transport: 'authenticated-http-jsonrpc',
          observedAtUtc: now(),
          remoteIgnitionPath: SOVEREIGN_COMMANDER_REMOTE_IGNITION_PATH,
          remoteIgnitionAction: 'ignite-stephanos',
          remoteIgnitionTailnetOnlyExpected: true,
          remoteIgnitionCsrfProtected: true,
          continuousRepairGuardian: continuousRepairGuardian?.status() || {
            enabled: false,
            running: false,
            scheduled: false,
            cycleCount: 0,
            successCount: 0,
            failureCount: 0,
            lastStartedAtUtc: '',
            lastCompletedAtUtc: '',
            lastOk: null,
            lastBlocker: '',
            lastFinalVerdict: '',
          },
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
        });
      }

      if (url.pathname === SOVEREIGN_COMMANDER_REMOTE_IGNITION_PATH) {
        const fetchSite = text(req.headers['sec-fetch-site']).toLowerCase();
        if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
          return sendJson(res, 403, { ok: false, blocker: 'REMOTE_IGNITION_CROSS_SITE_BLOCKED' });
        }
        if (req.method === 'GET') {
          const currentMs = nowMs();
          pruneIgnitionNonces(ignitionNonces, currentMs);
          const nonce = randomUUID();
          ignitionNonces.set(nonce, currentMs + SOVEREIGN_COMMANDER_REMOTE_IGNITION_NONCE_TTL_MS);
          return sendHtml(res, 200, remoteIgnitionHtml(nonce));
        }
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, blocker: 'METHOD_NOT_ALLOWED' });
        const nonce = text(req.headers['x-stephanos-ignition-nonce']);
        const currentMs = nowMs();
        pruneIgnitionNonces(ignitionNonces, currentMs);
        const expiry = ignitionNonces.get(nonce);
        if (!nonce || !Number.isFinite(expiry) || expiry <= currentMs) {
          return sendJson(res, 403, { ok: false, blocker: 'REMOTE_IGNITION_NONCE_INVALID_OR_EXPIRED' });
        }
        ignitionNonces.delete(nonce);
        const body = await readJsonBody(req, 4096);
        if (Object.keys(body).length !== 1 || body.action !== 'ignite-stephanos') {
          return sendJson(res, 400, { ok: false, blocker: 'REMOTE_IGNITION_ACTION_NOT_ALLOWED' });
        }
        const ignition = await executeFixedRemoteIgnition(handlerFactory);
        return sendJson(res, ignition.ok ? 200 : 409, {
          ok: ignition.ok,
          action: 'ignite-stephanos',
          blocker: ignition.blocker,
          finalVerdict: ignition.finalVerdict,
          arbitraryShellAllowed: false,
          pcRestartAllowed: false,
        });
      }

      if (url.pathname !== '/mcp') return sendJson(res, 404, { ok: false, blocker: 'NOT_FOUND' });
      if (!safeTokenEqual(bearerToken(req), token)) {
        return sendJson(res, 401, { ok: false, blocker: 'SOVEREIGN_COMMANDER_AUTH_REQUIRED' }, { 'www-authenticate': 'Bearer' });
      }

      if (req.method === 'DELETE') {
        const sessionId = text(req.headers['mcp-session-id']);
        if (!sessionId || !sessions.has(sessionId)) return sendJson(res, 404, { ok: false, blocker: 'MCP_SESSION_NOT_FOUND' });
        sessions.delete(sessionId);
        res.writeHead(204, { 'cache-control': 'no-store' });
        return res.end();
      }

      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, blocker: 'METHOD_NOT_ALLOWED' });
      const message = await readJsonBody(req, options.maxBodyBytes);
      if (!validRpcMessage(message)) return sendJson(res, 400, rpcError(message?.id, -32600, 'Invalid Request'));

      let sessionId = text(req.headers['mcp-session-id']);
      let handler = sessionId ? sessions.get(sessionId) : null;
      const initializing = message.method === 'initialize';

      if (initializing) {
        if (handler || sessionId) return sendJson(res, 409, rpcError(message.id, -32000, 'Session already supplied for initialize'));
        sessionId = randomUUID();
        handler = handlerFactory();
      } else if (!handler) {
        return sendJson(res, 400, rpcError(message.id, -32001, 'MCP session required'));
      }

      const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
      const isRequest = hasId;
      const isNotification = !hasId;
      const result = await handler(message.method, message.params || {}, {
        id: message.id,
        isRequest,
        isNotification,
        transportKind: 'authenticated-http-jsonrpc',
        transportAuthenticated: true,
      });
      if (initializing) sessions.set(sessionId, handler);
      const headers = { 'mcp-session-id': sessionId };

      if (isNotification || result === undefined) {
        res.writeHead(202, { 'cache-control': 'no-store', ...headers });
        return res.end();
      }
      return sendJson(res, 200, { jsonrpc: '2.0', id: message.id, result }, headers);
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      return sendJson(res, statusCode, rpcError(null, -32603, String(error?.message || error)));
    }
  });

  server.once('close', () => continuousRepairGuardian?.stop());

  return Object.freeze({
    server,
    host,
    port,
    tokenFile: options.tokenFile || tokenFile(env),
    sessionCount: () => sessions.size,
    ignitionNonceCount: () => ignitionNonces.size,
    continuousRepairStatus: () => continuousRepairGuardian?.status() || Object.freeze({ enabled: false }),
  });
}

export async function runSovereignCommanderHttpServer(options = {}) {
  const created = await createSovereignCommanderHttpServer({
    ...options,
    continuousRepairEnabled: options.continuousRepairEnabled ?? true,
  });
  await new Promise((resolveListen, rejectListen) => {
    created.server.once('error', rejectListen);
    created.server.listen(created.port, created.host, resolveListen);
  });
  const address = created.server.address();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'stephanos.sovereign-commander-http.v1',
    ok: true,
    host: created.host,
    port: typeof address === 'object' && address ? address.port : created.port,
    transport: 'authenticated-http-jsonrpc',
    capabilityVersion: SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_HTTP_READY',
  })}\n`);
  return created;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSovereignCommanderHttpServer();
}
