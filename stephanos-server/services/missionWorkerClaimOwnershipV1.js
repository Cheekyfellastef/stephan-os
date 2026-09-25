import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';

export const MISSION_WORKER_CLAIM_OWNER_SCHEMA = 'stephanos.mission-worker-claim-owner.v1';

const SAFE_ADAPTER = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,180}$/i;

function text(value) {
  return String(value ?? '').trim();
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
  const killFn = options.killFn || process.kill.bind(process);
  try {
    killFn(owner.pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    if (error?.code === 'EPERM') return 'alive';
    return 'unknown';
  }
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

export async function acquireMissionWorkerClaimOwnership(input = {}, options = {}) {
  const paths = ownershipPaths(input.queueRoot, input.adapter, input.actionId);
  const digest = text(input.queueItemSha256).toLowerCase();
  if (!paths || !SHA256.test(digest)) {
    return Object.freeze({ ok: false, acquired: false, reason: 'MISSION_WORKER_CLAIM_OWNER_INPUT_INVALID' });
  }
  await mkdir(paths.ownerRoot, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const acquiredAtUtc = text(input.acquiredAtUtc) || new Date().toISOString();
    const owner = Object.freeze({
      schemaVersion: MISSION_WORKER_CLAIM_OWNER_SCHEMA,
      token: `${process.pid}-${randomUUID()}`,
      adapter: paths.adapter,
      actionId: paths.actionId,
      pid: Number.isSafeInteger(input.pid) && input.pid > 0 ? input.pid : process.pid,
      hostname: text(input.hostname || hostname()).toLowerCase(),
      acquiredAtUtc,
      processStartedAtUtc: text(input.processStartedAtUtc)
        || new Date(Date.now() - (process.uptime() * 1000)).toISOString(),
      queueItemSha256: digest,
    });
    try {
      await durableExclusiveWrite(paths.ownerPath, owner);
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
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return Object.freeze({ ok: false, acquired: false, reason: 'MISSION_WORKER_CLAIM_OWNER_WRITE_FAILED', errorCode: error?.code || '' });
      }
    }

    const evidence = await inspectMissionWorkerClaimOwnership({
      queueRoot: paths.root,
      adapter: paths.adapter,
      actionId: paths.actionId,
      queueItemSha256: digest,
    }, options);
    if (evidence.state !== 'dead') {
      return Object.freeze({
        ok: evidence.ok,
        acquired: false,
        reason: evidence.reason || 'MISSION_WORKER_CLAIM_OWNER_BUSY',
        evidence,
      });
    }
    if (!(await retireDeadOwner(evidence))) continue;
  }

  return Object.freeze({ ok: false, acquired: false, reason: 'MISSION_WORKER_CLAIM_OWNER_TAKEOVER_RACE' });
}

export function missionWorkerQueueItemSha256(bytes) {
  return queueItemSha256(bytes);
}
