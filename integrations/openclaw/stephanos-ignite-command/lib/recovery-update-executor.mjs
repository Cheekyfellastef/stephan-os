import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  recoverBattleBridgeExactHeadFromOpenClaw,
} from './recovery-update.mjs';

const RECEIPT_ID = /^[a-f0-9]{32}$/;
const EXACT_HEAD = /^[a-f0-9]{40}$/;

export async function executeQueuedOpenClawUpdate({ receiptId, expectedHead, env = process.env } = {}) {
  if (!RECEIPT_ID.test(String(receiptId || '')) || !EXACT_HEAD.test(String(expectedHead || '')) || !env.USERPROFILE) {
    return { ok: false, blocker: 'QUEUED_UPDATE_INPUT_INVALID' };
  }
  const root = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update');
  const receiptPath = path.resolve(root, `${receiptId}.json`);
  if (path.dirname(receiptPath) !== root) return { ok: false, blocker: 'QUEUED_UPDATE_RECEIPT_INVALID' };
  let queued;
  try { queued = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { return { ok: false, blocker: 'QUEUED_UPDATE_RECEIPT_INVALID' }; }
  if (queued?.schemaVersion !== OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA
      || queued?.status !== 'QUEUED' || queued?.receiptId !== receiptId || queued?.expectedHead !== expectedHead) {
    return { ok: false, blocker: 'QUEUED_UPDATE_RECEIPT_INVALID' };
  }
  const result = await recoverBattleBridgeExactHeadFromOpenClaw({
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
  const completed = {
    ...queued,
    status: result.sourceInstalled ? 'PLUGIN_RELOAD_PROOF_PENDING' : result.status,
    finalVerdict: result.sourceInstalled ? 'PLUGIN_RELOAD_PROOF_PENDING' : result.finalVerdict,
    blocker: result.blocker,
    sourceHead: result.sourceHead,
    sourceInstalled: result.sourceInstalled,
    runtimeProofPassed: false,
    pluginReloadProof: 'PENDING',
    completedAtUtc: new Date().toISOString(),
  };
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(completed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporaryPath, receiptPath);
  return completed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await executeQueuedOpenClawUpdate({ receiptId: process.argv[2], expectedHead: process.argv[3] });
}
