import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { adjudicateBackendFreshnessProof } from '../shared/agents/backendFreshnessSupervisor.mjs';

export const BATTLE_BRIDGE_BACKEND_BASE_URL = 'http://127.0.0.1:8787';
export const BATTLE_BRIDGE_BACKEND_HEALTH_SCHEMA = 'stephanos.backend-health.v1';
export const BATTLE_BRIDGE_BACKEND_RUNTIME_ID = 'stephanos-battle-bridge-backend';
const EXACT_HEAD = /^[0-9a-f]{40}$/;
const MAX_IDENTITY_BYTES = 64 * 1024;

function failure(route, url, error, status = null) {
  return { route, url, status, ok: false, missing: status === 404 || status === 405, error };
}

async function probeIdentityRoute({ fetchImpl, route, expectedSourceHead, timeoutMs }) {
  const url = `${BATTLE_BRIDGE_BACKEND_BASE_URL}${route}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller?.signal });
    if (response.status >= 300 && response.status < 400) return failure(route, url, 'BACKEND_IDENTITY_REDIRECT_REJECTED', response.status);
    if (response.status < 200 || response.status >= 300) return failure(route, url, 'BACKEND_IDENTITY_HTTP_STATUS_REJECTED', response.status);
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IDENTITY_BYTES) return failure(route, url, 'BACKEND_IDENTITY_RESPONSE_TOO_LARGE', response.status);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_IDENTITY_BYTES) return failure(route, url, 'BACKEND_IDENTITY_RESPONSE_TOO_LARGE', response.status);
    let body;
    try { body = JSON.parse(text); }
    catch { return failure(route, url, 'BACKEND_IDENTITY_BODY_MALFORMED', response.status); }
    const routeSchemaOk = route === '/api/health'
      ? body?.schemaVersion === BATTLE_BRIDGE_BACKEND_HEALTH_SCHEMA
      : body?.schemaVersion === 'stephanos.mission-operations-feed.v1';
    if (!routeSchemaOk) return failure(route, url, 'BACKEND_IDENTITY_SCHEMA_MISMATCH', response.status);
    if (body?.backendIdentity?.runtimeId !== BATTLE_BRIDGE_BACKEND_RUNTIME_ID) return failure(route, url, 'BACKEND_RUNTIME_IDENTITY_MISMATCH', response.status);
    if (body?.backendIdentity?.sourceHead !== expectedSourceHead) return failure(route, url, 'BACKEND_SOURCE_IDENTITY_MISMATCH', response.status);
    return { route, url, status: response.status, ok: true, missing: false, error: '', identity: body.backendIdentity };
  } catch (error) {
    return failure(route, url, error?.message || String(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBattleBridgeBackendFreshnessProbe({ expectedSourceHead, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const normalizedHead = String(expectedSourceHead || '').trim().toLowerCase();
  if (!EXACT_HEAD.test(normalizedHead)) throw new Error('BATTLE_BRIDGE_BACKEND_EXPECTED_HEAD_INVALID');
  const routeProofs = [];
  for (const route of ['/api/health', '/api/mission-operations']) {
    routeProofs.push(await probeIdentityRoute({ fetchImpl, route, expectedSourceHead: normalizedHead, timeoutMs }));
  }
  return adjudicateBackendFreshnessProof({
    baseUrl: BATTLE_BRIDGE_BACKEND_BASE_URL,
    routeProofs,
    safeRestartAvailable: true,
  });
}

function isDirectEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isDirectEntrypoint()) {
  if (process.argv.length !== 4 || process.argv[2] !== '--expected-source-head') throw new Error('BATTLE_BRIDGE_BACKEND_FRESHNESS_ARGUMENTS_REJECTED');
  const proof = await runBattleBridgeBackendFreshnessProbe({ expectedSourceHead: process.argv[3] });
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}
