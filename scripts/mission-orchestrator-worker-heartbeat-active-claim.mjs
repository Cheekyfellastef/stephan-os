import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { resolveMissionWorkerQueueRoot } from '../stephanos-server/services/missionOrchestratorWorkerService.js';

export const MISSION_WORKER_ACTIVE_CLAIM_SCHEMA = 'stephanos.mission-worker-active-claim.v1';
export const MISSION_WORKER_ACTIVE_CLAIM_MAX_BYTES = 128 * 1024;

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const ACTIVE_WORKER_ADAPTERS = new Set([
  'codex',
  'openclaw-github-readonly',
  'openclaw-readonly',
  'openclaw-signed',
]);

function text(value) {
  return String(value ?? '').trim();
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function exactGrantIdentity(actionGrant = {}) {
  const missionId = safeId(actionGrant?.missionId);
  const actionId = safeId(actionGrant?.actionId);
  const adapter = text(actionGrant?.adapter).toLowerCase();
  const actionKind = text(actionGrant?.actionKind);
  const operation = text(actionGrant?.operation).toLowerCase();
  if (
    actionGrant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || actionGrant?.boundedActionCount !== 1
    || !missionId
    || !actionId
    || !ACTIVE_WORKER_ADAPTERS.has(adapter)
  ) return null;
  return Object.freeze({ missionId, actionId, adapter, actionKind, operation });
}

function payloadMatchesGrant(payload, grant) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const payloadAdapter = text(payload.adapter).toLowerCase();
  return safeId(payload.missionId) === grant.missionId
    && safeId(payload.actionId) === grant.actionId
    && (!payloadAdapter || payloadAdapter === grant.adapter)
    && (!grant.actionKind || text(payload.actionKind) === grant.actionKind)
    && text(payload.operation).toLowerCase() === grant.operation;
}

export async function readMissionWorkerActiveClaim({
  env = process.env,
  actionGrant,
  queueRoot = resolveMissionWorkerQueueRoot(env),
  lstatFn = lstat,
  readFileFn = readFile,
} = {}) {
  const grant = exactGrantIdentity(actionGrant);
  const root = text(queueRoot);
  if (!grant || !root || !path.isAbsolute(root)) return null;

  const processingRoot = path.resolve(root, grant.adapter, 'processing');
  const claimPath = path.resolve(processingRoot, `${grant.actionId}.json`);
  if (path.dirname(claimPath) !== processingRoot) return null;

  let info;
  try {
    info = await lstatFn(claimPath);
  } catch {
    return null;
  }
  if (!info?.isFile?.() || info.isSymbolicLink?.() || info.size <= 0 || info.size > MISSION_WORKER_ACTIVE_CLAIM_MAX_BYTES) {
    return null;
  }

  let bytes;
  try {
    const raw = await readFileFn(claimPath);
    bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  } catch {
    return null;
  }
  if (bytes.length <= 0 || bytes.length > MISSION_WORKER_ACTIVE_CLAIM_MAX_BYTES) return null;

  let item;
  try {
    item = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (
    item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
    || text(item.adapter).toLowerCase() !== grant.adapter
    || safeId(item.missionId) !== grant.missionId
    || safeId(item.actionId) !== grant.actionId
    || !payloadMatchesGrant(item.payload, grant)
  ) return null;

  const claimDigest = createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({
    schemaVersion: MISSION_WORKER_ACTIVE_CLAIM_SCHEMA,
    missionId: grant.missionId,
    activeTaskId: grant.actionId,
    activeReceiptId: `claim:${claimDigest}`,
    executionPhase: `processing:${grant.adapter}`,
  });
}
