import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  recoverBattleBridgeExactHeadFromOpenClaw,
} from './recovery-update.mjs';

const RECEIPT_ID = /^[a-f0-9]{32}$/;
const EXACT_HEAD = /^[a-f0-9]{40}$/;

function readReceipt(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isQueuedReceipt(receipt, receiptId, expectedHead) {
  return receipt?.schemaVersion === OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA
    && receipt?.status === 'QUEUED'
    && receipt?.receiptId === receiptId
    && receipt?.expectedHead === expectedHead;
}

function writeExclusiveJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function executeQueuedOpenClawUpdate({
  receiptId,
  expectedHead,
  env = process.env,
  recoverFn = recoverBattleBridgeExactHeadFromOpenClaw,
  now = () => new Date(),
} = {}) {
  if (!RECEIPT_ID.test(String(receiptId || '')) || !EXACT_HEAD.test(String(expectedHead || '')) || !env.USERPROFILE) {
    return { ok: false, blocker: 'QUEUED_UPDATE_INPUT_INVALID' };
  }
  const root = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update');
  const receiptPath = path.resolve(root, `${receiptId}.json`);
  const claimedPath = path.resolve(root, `${receiptId}.claimed.json`);
  if (path.dirname(receiptPath) !== root || path.dirname(claimedPath) !== root) {
    return { ok: false, blocker: 'QUEUED_UPDATE_RECEIPT_INVALID' };
  }

  const observed = readReceipt(receiptPath);
  if (observed?.status === 'CLAIMED' && observed?.receiptId === receiptId && observed?.expectedHead === expectedHead) {
    return { ok: false, blocker: 'QUEUED_UPDATE_ALREADY_CLAIMED' };
  }
  if (!isQueuedReceipt(observed, receiptId, expectedHead)) {
    return { ok: false, blocker: 'QUEUED_UPDATE_RECEIPT_INVALID' };
  }

  try {
    renameSync(receiptPath, claimedPath);
  } catch {
    const current = readReceipt(receiptPath);
    if (current?.status === 'CLAIMED' && current?.receiptId === receiptId && current?.expectedHead === expectedHead) {
      return { ok: false, blocker: 'QUEUED_UPDATE_ALREADY_CLAIMED' };
    }
    return { ok: false, blocker: 'QUEUED_UPDATE_CLAIM_FAILED' };
  }

  const queued = readReceipt(claimedPath);
  if (!isQueuedReceipt(queued, receiptId, expectedHead)) {
    try { renameSync(claimedPath, receiptPath); } catch {}
    return { ok: false, blocker: 'QUEUED_UPDATE_RECEIPT_INVALID' };
  }

  const claimedAtUtc = now().toISOString();
  const claimed = {
    ...queued,
    status: 'CLAIMED',
    claimedAtUtc,
    pluginReloadProof: 'PENDING',
  };
  try {
    writeExclusiveJson(receiptPath, claimed);
  } catch {
    try { renameSync(claimedPath, receiptPath); } catch {}
    return { ok: false, blocker: 'QUEUED_UPDATE_CLAIM_FAILED' };
  }

  let result;
  try {
    result = await recoverFn({
      expectedHead,
      env,
      platform: 'win32',
      authenticatedContext: {
        authenticatedByHost: true,
        commandName: 'stephanos-ignite',
        command: 'update',
        senderIsOwner: true,
      },
    });
  } catch {
    result = {
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'UPDATE_EXECUTOR_FAILED',
      blocker: 'UPDATE_EXECUTOR_FAILED',
      sourceHead: '',
      sourceInstalled: false,
    };
  }

  const completed = {
    ...claimed,
    status: result.sourceInstalled ? 'PLUGIN_RELOAD_PROOF_PENDING' : result.status,
    finalVerdict: result.sourceInstalled ? 'PLUGIN_RELOAD_PROOF_PENDING' : result.finalVerdict,
    blocker: result.blocker,
    sourceHead: result.sourceHead,
    sourceInstalled: result.sourceInstalled,
    runtimeProofPassed: false,
    pluginReloadProof: 'PENDING',
    completedAtUtc: now().toISOString(),
  };
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(completed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporaryPath, receiptPath);
  try { unlinkSync(claimedPath); } catch {}
  return completed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await executeQueuedOpenClawUpdate({ receiptId: process.argv[2], expectedHead: process.argv[3] });
}
