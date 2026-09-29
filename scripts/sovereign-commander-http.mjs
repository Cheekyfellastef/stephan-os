#!/usr/bin/env node
import { timingSafeEqual } from 'node:crypto';
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

function text(value) {
  return String(value ?? '').trim();
}

function loopbackHost(value) {
  return ['127.0.0.1', '::1', 'localhost'].includes(text(value).toLowerCase());
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
  const handlerFactory = options.handlerFactory || (() => createSovereignCommanderMcpHandler({ repoRoot: options.repoRoot }));
  const now = options.now || (() => new Date().toISOString());

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'stephanos-sovereign-commander',
          transport: 'authenticated-http-jsonrpc',
          observedAtUtc: now(),
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
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
        sessionId = crypto.randomUUID();
        handler = handlerFactory();
        sessions.set(sessionId, handler);
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
      });
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

  return Object.freeze({
    server,
    host,
    port,
    tokenFile: options.tokenFile || tokenFile(env),
    sessionCount: () => sessions.size,
  });
}

export async function runSovereignCommanderHttpServer(options = {}) {
  const created = await createSovereignCommanderHttpServer(options);
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
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_HTTP_READY',
  })}\n`);
  return created;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSovereignCommanderHttpServer();
}
