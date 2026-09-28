import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const GITHUB_OBSERVATION_BROKER_SCHEMA = 'stephanos.github-observation-broker.v1';
export const DEFAULT_GITHUB_OBSERVATION_TTL_MS = 75_000;
export const DEFAULT_GITHUB_OBSERVATION_MAX_STALE_MS = 15 * 60 * 1000;
export const DEFAULT_GITHUB_PUBLICATION_HEARTBEAT_MS = 5 * 60 * 1000;
export const GITHUB_OBSERVATION_BROKER_MAX_BYTES = 2 * 1024 * 1024;

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/?-]{1,500}$/;

function text(value) {
  return String(value ?? '').trim();
}

function boundedMs(value, fallback, minimum = 1_000, maximum = 24 * 60 * 60 * 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return Math.min(Math.trunc(parsed), maximum);
}

function digest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function resolveWorkspaceRoot({ workspaceRoot, env = process.env } = {}) {
  return resolve(
    workspaceRoot
      || env.STEPHANOS_SHARED_AGENT_WORKSPACE
      || join(env.USERPROFILE || env.HOME || homedir(), 'Documents', 'Stephanos-openclaw-workspace'),
  );
}

function brokerPaths({ workspaceRoot, key, env } = {}) {
  const normalizedKey = text(key);
  if (!SAFE_KEY.test(normalizedKey) || normalizedKey.includes('..')) throw new Error('GITHUB_OBSERVATION_BROKER_KEY_INVALID');
  const root = join(resolveWorkspaceRoot({ workspaceRoot, env }), 'status', 'github-observation-broker');
  const id = digest(normalizedKey);
  return Object.freeze({
    root,
    snapshot: join(root, `read-${id}.json`),
    readLock: join(root, `read-${id}.lock`),
    publication: join(root, `write-${id}.json`),
    writeLock: join(root, `write-${id}.lock`),
  });
}

function readJsonFile(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > GITHUB_OBSERVATION_BROKER_MAX_BYTES) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeAtomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(temp, path);
}

function acquireLock(path, staleMs = 30_000) {
  mkdirSync(dirname(path), { recursive: true });
  const attempt = () => {
    const fd = openSync(path, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAtUtc: new Date().toISOString() }), 'utf8');
    closeSync(fd);
    return true;
  };
  try {
    return attempt();
  } catch (error) {
    if (error?.code !== 'EEXIST') return false;
  }
  try {
    const ageMs = Date.now() - statSync(path).mtimeMs;
    if (ageMs <= staleMs) return false;
    rmSync(path, { force: true });
    return attempt();
  } catch {
    return false;
  }
}

function releaseLock(path) {
  try { rmSync(path, { force: true }); } catch {}
}

function captureGithub({
  endpoint,
  args = [],
  ghCommand = process.env.STEPHANOS_GH_COMMAND || 'gh',
  spawnSyncFn = spawnSync,
  cwd,
  timeoutMs = 120_000,
} = {}) {
  const result = spawnSyncFn(ghCommand, ['api', endpoint, ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: GITHUB_OBSERVATION_BROKER_MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: text(result?.stderr || result?.error?.message || ''),
    errorCode: text(result?.error?.code),
  });
}

export function readBrokeredGithubJson({
  key,
  endpoint,
  args = [],
  workspaceRoot,
  env = process.env,
  ttlMs = DEFAULT_GITHUB_OBSERVATION_TTL_MS,
  maxStaleMs = DEFAULT_GITHUB_OBSERVATION_MAX_STALE_MS,
  nowMs = Date.now(),
  ghCommand,
  spawnSyncFn,
  cwd,
  timeoutMs,
} = {}) {
  const paths = brokerPaths({ workspaceRoot, key, env });
  const ttl = boundedMs(ttlMs, DEFAULT_GITHUB_OBSERVATION_TTL_MS);
  const staleLimit = boundedMs(maxStaleMs, DEFAULT_GITHUB_OBSERVATION_MAX_STALE_MS, ttl);
  const requestFingerprint = digest(JSON.stringify([text(endpoint), Array.isArray(args) ? args.map(String) : []]));
  const cachedCandidate = readJsonFile(paths.snapshot);
  const cached = cachedCandidate?.requestFingerprint === requestFingerprint ? cachedCandidate : null;
  const cachedAtMs = Date.parse(text(cached?.observedAtUtc));
  const ageMs = Number.isFinite(cachedAtMs) ? Math.max(0, nowMs - cachedAtMs) : Number.POSITIVE_INFINITY;
  if (cached?.schemaVersion === GITHUB_OBSERVATION_BROKER_SCHEMA && ageMs <= ttl) {
    return Object.freeze({ ok: true, source: 'SHARED_CACHE', payload: cached.payload, observedAtUtc: cached.observedAtUtc, ageMs, upstreamCalls: 0 });
  }

  if (!acquireLock(paths.readLock)) {
    if (cached?.schemaVersion === GITHUB_OBSERVATION_BROKER_SCHEMA && ageMs <= staleLimit) {
      return Object.freeze({ ok: true, source: 'SHARED_CACHE_STALE_WHILE_REFRESHING', payload: cached.payload, observedAtUtc: cached.observedAtUtc, ageMs, upstreamCalls: 0 });
    }
    return Object.freeze({ ok: false, reason: 'GITHUB_OBSERVATION_REFRESH_IN_PROGRESS', upstreamCalls: 0 });
  }

  try {
    const afterLockCandidate = readJsonFile(paths.snapshot);
    const afterLock = afterLockCandidate?.requestFingerprint === requestFingerprint ? afterLockCandidate : null;
    const afterMs = Date.parse(text(afterLock?.observedAtUtc));
    const afterAgeMs = Number.isFinite(afterMs) ? Math.max(0, nowMs - afterMs) : Number.POSITIVE_INFINITY;
    if (afterLock?.schemaVersion === GITHUB_OBSERVATION_BROKER_SCHEMA && afterAgeMs <= ttl) {
      return Object.freeze({ ok: true, source: 'SHARED_CACHE', payload: afterLock.payload, observedAtUtc: afterLock.observedAtUtc, ageMs: afterAgeMs, upstreamCalls: 0 });
    }

    const result = captureGithub({ endpoint, args, ghCommand, spawnSyncFn, cwd, timeoutMs });
    if (!result.ok) {
      if (cached?.schemaVersion === GITHUB_OBSERVATION_BROKER_SCHEMA && ageMs <= staleLimit) {
        return Object.freeze({ ok: true, source: 'SHARED_CACHE_STALE_AFTER_UPSTREAM_FAILURE', payload: cached.payload, observedAtUtc: cached.observedAtUtc, ageMs, upstreamCalls: 1, upstreamStatus: result.status });
      }
      return Object.freeze({ ok: false, reason: result.errorCode === 'ENOENT' ? 'GH_CLI_NOT_INSTALLED' : 'GITHUB_OBSERVATION_UPSTREAM_FAILED', upstreamCalls: 1, upstreamStatus: result.status, error: result.stderr.slice(0, 500) });
    }
    let payload;
    try { payload = JSON.parse(result.stdout); } catch {
      return Object.freeze({ ok: false, reason: 'GITHUB_OBSERVATION_JSON_INVALID', upstreamCalls: 1 });
    }
    const observedAtUtc = new Date(nowMs).toISOString();
    writeAtomicJson(paths.snapshot, {
      schemaVersion: GITHUB_OBSERVATION_BROKER_SCHEMA,
      key: text(key),
      endpoint: text(endpoint),
      requestFingerprint,
      observedAtUtc,
      payload,
      arbitraryShellAllowed: false,
      mutationAllowed: false,
    });
    return Object.freeze({ ok: true, source: 'UPSTREAM_REFRESH', payload, observedAtUtc, ageMs: 0, upstreamCalls: 1 });
  } finally {
    releaseLock(paths.readLock);
  }
}

export function publishBrokeredGithubMutation({
  key,
  body,
  material = body,
  publish,
  workspaceRoot,
  env = process.env,
  heartbeatMs = DEFAULT_GITHUB_PUBLICATION_HEARTBEAT_MS,
  nowMs = Date.now(),
} = {}) {
  if (typeof publish !== 'function') return Object.freeze({ ok: false, reason: 'GITHUB_PUBLICATION_CALLBACK_REQUIRED', published: false });
  const paths = brokerPaths({ workspaceRoot, key, env });
  const heartbeat = boundedMs(heartbeatMs, DEFAULT_GITHUB_PUBLICATION_HEARTBEAT_MS, 5_000);
  const materialDigest = digest(material);
  const previous = readJsonFile(paths.publication);
  const previousAtMs = Date.parse(text(previous?.publishedAtUtc));
  const ageMs = Number.isFinite(previousAtMs) ? Math.max(0, nowMs - previousAtMs) : Number.POSITIVE_INFINITY;
  if (previous?.schemaVersion === GITHUB_OBSERVATION_BROKER_SCHEMA && previous.materialDigest === materialDigest && ageMs < heartbeat) {
    return Object.freeze({ ok: true, reason: 'GITHUB_PUBLICATION_DEDUPED', published: false, ageMs, upstreamCalls: 0 });
  }
  if (!acquireLock(paths.writeLock)) {
    return Object.freeze({ ok: true, reason: 'GITHUB_PUBLICATION_COALESCED', published: false, upstreamCalls: 0 });
  }
  try {
    const latest = readJsonFile(paths.publication);
    const latestAtMs = Date.parse(text(latest?.publishedAtUtc));
    const latestAgeMs = Number.isFinite(latestAtMs) ? Math.max(0, nowMs - latestAtMs) : Number.POSITIVE_INFINITY;
    if (latest?.schemaVersion === GITHUB_OBSERVATION_BROKER_SCHEMA && latest.materialDigest === materialDigest && latestAgeMs < heartbeat) {
      return Object.freeze({ ok: true, reason: 'GITHUB_PUBLICATION_DEDUPED', published: false, ageMs: latestAgeMs, upstreamCalls: 0 });
    }
    const result = publish(body);
    if (result?.ok !== true) return Object.freeze({ ...(result || {}), ok: false, published: false, upstreamCalls: 1 });
    const publishedAtUtc = new Date(nowMs).toISOString();
    writeAtomicJson(paths.publication, {
      schemaVersion: GITHUB_OBSERVATION_BROKER_SCHEMA,
      key: text(key),
      publishedAtUtc,
      materialDigest,
      arbitraryShellAllowed: false,
    });
    return Object.freeze({ ...result, ok: true, published: true, publishedAtUtc, upstreamCalls: 1 });
  } finally {
    releaseLock(paths.writeLock);
  }
}
