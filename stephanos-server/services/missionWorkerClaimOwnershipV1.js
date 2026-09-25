import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

import { acquireSharedWorkspaceOperationLock } from '../../shared/agents/executionReceiptV1.mjs';

export const MISSION_WORKER_CLAIM_OWNER_SCHEMA = 'stephanos.mission-worker-claim-owner.v1';

const SAFE_ADAPTER = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,180}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function canonicalTimestamp(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

export function probeMissionWorkerClaimProcessIdentity(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid < 1) return Object.freeze({ state: 'unknown', processStartedAtUtc: '' });
  const platform = text(options.platform || process.platform).toLowerCase();
  const killFn = options.killFn || process.kill.bind(process);

  if (platform !== 'win32') {
    try {
      killFn(pid, 0);
      return Object.freeze({ state: 'known', processStartedAtUtc: '' });
    } catch (error) {
      if (error?.code === 'ESRCH') return Object.freeze({ state: 'dead', processStartedAtUtc: '' });
      if (error?.code === 'EPERM') return Object.freeze({ state: 'known', processStartedAtUtc: '' });
      return Object.freeze({ state: 'unknown', processStartedAtUtc: '' });
    }
  }

  const script = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if ($null -eq $p) { exit 3 }',
    "[Console]::Out.Write($p.StartTime.ToUniversalTime().ToString('o'))",
  ].join('; ');
  const spawn = options.spawnSync || spawnSync;
  let result;
  try {
    result = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 10_000,
    });
  } catch {
    return Object.freeze({ state: 'unknown', processStartedAtUtc: '' });
  }
  if (result?.status === 3) return Object.freeze({ state: 'dead', processStartedAtUtc: '' });
  if (result?.error || result?.status !== 0) return Object.freeze({ state: 'unknown', processStartedAtUtc: '' });
  const processStartedAtUtc = canonicalTimestamp(result?.stdout);
  return processStartedAtUtc
    ? Object.freeze({ state: 'known', processStartedAtUtc })
    : Object.freeze({ state: 'unknown', processStartedAtUtc: '' });
}

function queueItemSha256(bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8');
  return createHash('sha256').update(payload).digest('hex');
}

function ownershipPaths(queueRoot, adapter, actionId) {
  const root = resolve(text(queueRoot));
  const normalizedAdapter = text(adapter).toLowerCase();
  const normalizedActionId = text(actionId).toLowerCase();
  if (!root || !SAFE_ADAPTER.test(normalizedAdapter) || !SAFE_ACTION_ID.test(normalizedActionId)) return null;
  const ownerRoot = resolve(root, normalizedAdapter, 'claim-owners');
  const ownerPath = resolve(ownerRoot, `${normalizedActionId}.json`);
  if (resolve(ownerPath, '..') !== ownerRoot) return null;
  return Object.freeze({ root, adapter: normalizedAdapter, actionId: normalizedActionId, ownerRoot, ownerPath });
}

function validOwner(owner, expected = {}) {
  return Boolean(
    owner
    && typeof owner === 'object'
    && !Array.isArray(owner)
    && owner.schemaVersion === MISSION_WORKER_CLAIM_OWNER_SCHEMA
    && SAFE_TOKEN.test(text(owner.token))
    && SAFE_ADAPTER.test(text(owner.adapter))
    && SAFE_ACTION_ID.test(text(owner.actionId))
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0
    && text(owner.hostname)
    && Number.isFinite(Date.parse(text(owner.acquiredAtUtc)))
    && Number.isFinite(Date.parse(text(owner.processStartedAtUtc)))
    && SHA256.test(text(owner.queueItemSha256))
    && (!expected.adapter || text(owner.adapter) === text(expected.adapter).toLowerCase())
    && (!expected.actionId || text(owner.actionId).toLowerCase() === text(expected.actionId).toLowerCase())
    && (!expected.queueItemSha256 || text(owner.queueItemSha256) === text(expected.queueItemSha256).toLowerCase())
  );
}

function ownerLiveness(owner, options = {}) {
  if (!validOwner(owner)) return 'invalid';
  const localHostname = text(options.hostname || hostname()).toLowerCase();
  if (text(owner.hostname).toLowerCase() !== localHostname) return 'unknown';

  if (typeof options.killFn === 'function' && typeof options.processIdentityProbe !== 'function') {
    try {
      options.killFn(owner.pid, 0);
      return 'alive';
    } catch (error) {
      if (error?.code === 'ESRCH') return 'dead';
      if (error?.code === 'EPERM') return 'alive';
      return 'unknown';
    }
  }

  const probe = options.processIdentityProbe
    || ((pid) => probeMissionWorkerClaimProcessIdentity(pid, options));
  let identity;
  try { identity = probe(owner.pid); }
  catch { return 'unknown'; }
  if (identity?.state === 'dead') return 'dead';
  if (identity?.state !== 'known') return 'unknown';

  const liveStartedAtUtc = canonicalTimestamp(identity.processStartedAtUtc);
  const ownerStartedAtUtc = canonicalTimestamp(owner.processStartedAtUtc);
  if (liveStartedAtUtc && ownerStartedAtUtc && liveStartedAtUtc !== ownerStartedAtUtc) return 'reused';
  return 'alive';
}

async function durableExclusiveWrite(path, payload) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function inspectMissionWorkerClaimOwnership(input = {}, options = {}) {
  const paths = ownershipPaths(input.queueRoot, input.adapter, input.actionId);
  if (!paths) return Object.freeze({ ok: false, state: 'invalid', reason: 'MISSION_WORKER_CLAIM_OWNER_IDENTITY_INVALID' });
  let owner;
  try {
    owner = JSON.parse(await readFile(paths.ownerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({ ok: true, state: 'missing', reason: 'MISSION_WORKER_CLAIM_OWNER_MISSING', paths });
    }
    return Object.freeze({ ok: false, state: 'invalid', reason: 'MISSION_WORKER_CLAIM_OWNER_READ_FAILED', paths });
  }
  const expectedDigest = text(input.queueItemSha256).toLowerCase();
  if (!validOwner(owner, {
    adapter: paths.adapter,
    actionId: paths.actionId,
    queueItemSha256: expectedDigest || undefined,
  })) {
    return Object.freeze({ ok: false, state: 'invalid', reason: 'MISSION_WORKER_CLAIM_OWNER_INVALID', owner, paths });
  }
  const state = ownerLiveness(owner, options);
  return Object.freeze({
    ok: state !== 'invalid',
    state,
    reason: `MISSION_WORKER_CLAIM_OWNER_${state.toUpperCase()}`,
    owner: Object.freeze({ ...owner }),
    paths,
  });
}

async function retireDeadOwner(evidence) {
  const tombstone = `${evidence.paths.ownerPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(evidence.paths.ownerPath, tombstone);
  } catch (error) {
    if (['ENOENT', 'EEXIST'].includes(error?.code)) return false;
    throw error;
  }
  await unlink(tombstone).catch(() => {});
  return true;
}

function takeoverLockSegments(paths) {
  const digest = createHash('sha256')
    .update(`${paths.adapter}\n${paths.actionId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return Object.freeze(['claim-owner-takeover-locks', `claim-${digest}.lock`]);
}

function acquiredOwnerResult(paths, owner) {
  return Object.freeze({
    ok: true,
    acquired: true,
    reason: 'MISSION_WORKER_CLAIM_OWNER_ACQUIRED',
    owner,
    paths,
    async release() {
      let current;
      try {
        current = JSON.parse(await readFile(paths.ownerPath, 'utf8'));
      } catch {
        return false;
      }
      if (current?.token !== owner.token || current?.queueItemSha256 !== owner.queueItemSha256) return false;
      try {
        await unlink(paths.ownerPath);
        return true;
      } catch {
        return false;
      }
    },
  });
}

function newClaimOwner(paths, digest, input = {}, options = {}) {
  const acquiredAtUtc = text(input.acquiredAtUtc) || new Date().toISOString();
  const ownerPid = Number.isSafeInteger(input.pid) && input.pid > 0 ? input.pid : process.pid;
  let processStartedAtUtc = canonicalTimestamp(input.processStartedAtUtc);
  if (!processStartedAtUtc && typeof options.killFn !== 'function') {
    const probe = options.processIdentityProbe
      || ((pid) => probeMissionWorkerClaimProcessIdentity(pid, options));
    try {
      const identity = probe(ownerPid);
      if (identity?.state === 'known') processStartedAtUtc = canonicalTimestamp(identity.processStartedAtUtc);
    } catch { /* Fall through to bounded local estimate. */ }
  }
  if (!processStartedAtUtc) {
    processStartedAtUtc = new Date(Date.now() - (process.uptime() * 1000)).toISOString();
  }
  return Object.freeze({
    schemaVersion: MISSION_WORKER_CLAIM_OWNER_SCHEMA,
    token: `${process.pid}-${randomUUID()}`,
    adapter: paths.adapter,
    actionId: paths.actionId,
    pid: ownerPid,
    hostname: text(input.hostname || hostname()).toLowerCase(),
    acquiredAtUtc,
    processStartedAtUtc,
    queueItemSha256: digest,
  });
}

export async function acquireMissionWorkerClaimOwnership(input = {}, options = {}) {
  const paths = ownershipPaths(input.queueRoot, input.adapter, input.actionId);
  const digest = text(input.queueItemSha256).toLowerCase();
  if (!paths || !SHA256.test(digest)) {
    return Object.freeze({ ok: false, acquired: false, reason: 'MISSION_WORKER_CLAIM_OWNER_INPUT_INVALID' });
  }
  await mkdir(paths.ownerRoot, { recursive: true, mode: 0o700 });

  const owner = newClaimOwner(paths, digest, input, options);
  try {
    await durableExclusiveWrite(paths.ownerPath, owner);
    return acquiredOwnerResult(paths, owner);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      return Object.freeze({
        ok: false,
        acquired: false,
        reason: 'MISSION_WORKER_CLAIM_OWNER_WRITE_FAILED',
        errorCode: error?.code || '',
      });
    }
  }

  const acquireTakeoverLock = options.acquireTakeoverLock || acquireSharedWorkspaceOperationLock;
  const takeoverLock = await acquireTakeoverLock(
    paths.root,
    takeoverLockSegments(paths),
    {
      repoRoot: options.repoRoot,
      operationLockTimeoutMs: options.claimTakeoverLockTimeoutMs,
      operationLockRetryMs: options.claimTakeoverLockRetryMs,
      operationStaleLockMs: options.claimTakeoverStaleLockMs,
      operationLockHeartbeatMs: options.claimTakeoverLockHeartbeatMs,
    },
  );
  if (takeoverLock?.ok !== true) {
    return Object.freeze({
      ok: false,
      acquired: false,
      reason: takeoverLock?.reason || 'MISSION_WORKER_CLAIM_OWNER_TAKEOVER_LOCK_BLOCKED',
      takeoverLock,
    });
  }

  try {
    // Re-read ownership only after serializing takeover. This closes the
    // stale-evidence race where a second rescuer could otherwise retire a
    // newly-live owner using evidence captured before the first takeover.
    const evidence = await inspectMissionWorkerClaimOwnership({
      queueRoot: paths.root,
      adapter: paths.adapter,
      actionId: paths.actionId,
      queueItemSha256: digest,
    }, options);
    if (!['dead', 'reused'].includes(evidence.state)) {
      return Object.freeze({
        ok: evidence.ok,
        acquired: false,
        reason: evidence.reason || 'MISSION_WORKER_CLAIM_OWNER_BUSY',
        evidence,
      });
    }
    if (!(await retireDeadOwner(evidence))) {
      return Object.freeze({
        ok: false,
        acquired: false,
        reason: 'MISSION_WORKER_CLAIM_OWNER_TAKEOVER_RACE',
        evidence,
      });
    }

    try {
      await durableExclusiveWrite(paths.ownerPath, owner);
      return acquiredOwnerResult(paths, owner);
    } catch (error) {
      return Object.freeze({
        ok: false,
        acquired: false,
        reason: error?.code === 'EEXIST'
          ? 'MISSION_WORKER_CLAIM_OWNER_TAKEOVER_RACE'
          : 'MISSION_WORKER_CLAIM_OWNER_WRITE_FAILED',
        errorCode: error?.code || '',
      });
    }
  } finally {
    await takeoverLock.release();
  }
}

export function missionWorkerQueueItemSha256(bytes) {
  return queueItemSha256(bytes);
}
