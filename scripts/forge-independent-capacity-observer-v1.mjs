import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Read-only, one-shot Forge model inventory. This is intentionally separate
 * from Mission Worker source admission and does not publish a READY receipt.
 * An observed model is not an authenticated worker, task claim, or pickup.
 */
export const FORGE_READONLY_OBSERVATION_SCHEMA = 'stephanos.forge-readonly-observation.v1';
export const FORGE_READONLY_DEFAULT_MODEL = 'qwen3-coder:30b';
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const SAFE_MODEL = /^[A-Za-z0-9_.:-]{1,128}$/;
const ENDPOINTS = new Set(['http://127.0.0.1:11434', 'http://localhost:11434']);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2500;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function deny(reason, sourceHead = '') {
  return Object.freeze({
    schemaVersion: FORGE_READONLY_OBSERVATION_SCHEMA,
    route: 'FOUNDRY_FORGE',
    ok: false,
    sourceHead,
    modelListed: false,
    readiness: 'UNPROVEN',
    reason,
    buildCapacityPublished: false,
    canDispatch: false,
    canClaim: false,
    physicalPickupProven: false,
    mergeAuthority: false,
  });
}

function readGitHead(repoRoot) {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 3000, maxBuffer: 1024,
    }).trim().toLowerCase();
  } catch {
    return '';
  }
}

export async function observeForgeReadOnlyCapacity(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const readHead = options.readHead || readGitHead;
  const sourceHead = String(await readHead(repoRoot) || '').trim().toLowerCase();
  if (!SOURCE_SHA.test(sourceHead)) return deny('FORGE_SOURCE_HEAD_UNPROVEN');

  const endpoint = String(options.endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = String(options.model || FORGE_READONLY_DEFAULT_MODEL);
  if (!ENDPOINTS.has(endpoint) || !SAFE_MODEL.test(model)) {
    return deny('FORGE_LOCAL_IDENTITY_INVALID', sourceHead);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
    return deny('FORGE_OBSERVATION_TIMEOUT_INVALID', sourceHead);
  }

  // A GET inventory is deliberately used instead of /api/generate. It cannot
  // start a large inference model while gaming or under held source custody.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(endpoint + '/api/tags', {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
    if (response.status !== 200 || response.ok !== true) {
      return deny('FORGE_LOCAL_INVENTORY_HTTP_UNAVAILABLE', sourceHead);
    }
    const advertisedBytes = Number(response.headers?.get?.('content-length') || 0);
    if (advertisedBytes > MAX_RESPONSE_BYTES) return deny('FORGE_LOCAL_INVENTORY_TOO_LARGE', sourceHead);
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
      return deny('FORGE_LOCAL_INVENTORY_TOO_LARGE', sourceHead);
    }
    let payload;
    try { payload = JSON.parse(raw); }
    catch { return deny('FORGE_LOCAL_INVENTORY_INVALID', sourceHead); }
    if (!Array.isArray(payload?.models) || payload.models.length > 2048) {
      return deny('FORGE_LOCAL_INVENTORY_INVALID', sourceHead);
    }
    const modelListed = payload.models.some((entry) =>
      entry && typeof entry === 'object' && (entry.name === model || entry.model === model));
    return Object.freeze({
      schemaVersion: FORGE_READONLY_OBSERVATION_SCHEMA,
      route: 'FOUNDRY_FORGE',
      ok: true,
      sourceHead,
      model,
      modelListed,
      readiness: 'OBSERVATION_ONLY',
      reason: modelListed ? 'FORGE_MODEL_LISTED_CONSUMER_UNPROVEN' : 'FORGE_CONFIGURED_MODEL_NOT_LISTED',
      buildCapacityPublished: false,
      canDispatch: false,
      canClaim: false,
      physicalPickupProven: false,
      mergeAuthority: false,
    });
  } catch (error) {
    return deny(error?.name === 'AbortError'
      ? 'FORGE_LOCAL_INVENTORY_TIMEOUT'
      : 'FORGE_LOCAL_INVENTORY_REQUEST_FAILED', sourceHead);
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  observeForgeReadOnlyCapacity().then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 1;
  });
}
