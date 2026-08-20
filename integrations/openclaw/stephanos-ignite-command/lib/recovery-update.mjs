import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { syncBattleBridgeExactHeadV1 } from '../../../../shared/agents/battleBridgeExactHeadSyncGuardV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import { updateStephanosFromChat } from '../../../../shared/agents/stephanosChatUpdate.mjs';

export const OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE = 'OPENCLAW_WHATSAPP_EXACT_HEAD';
export const OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA = 'stephanos.openclaw-exact-head-update-receipt.v1';

const EXACT_HEAD = /^[0-9a-f]{40}$/;
const SAFE_VERDICT = /^[A-Z0-9_]{1,120}$/;

function text(value) {
  return String(value ?? '').trim();
}

export function normalizeOpenClawExactHead(value) {
  const normalized = text(value).toLowerCase();
  return EXACT_HEAD.test(normalized) ? normalized : '';
}

function canonicalRepoRoot(env = process.env) {
  if (!env.USERPROFILE) return '';
  return path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
}

function updateReceiptRoot(env = process.env) {
  if (!env.USERPROFILE) return '';
  return path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update');
}

function writeNewReceipt(receiptPath, receipt) {
  const descriptor = openSync(receiptPath, 'wx', 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8'); } finally { closeSync(descriptor); }
}

function replaceReceipt(receiptPath, receipt) {
  const temporaryPath = `${receiptPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporaryPath, receiptPath);
}

function observeSpawn(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || typeof child.once !== 'function') {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once('spawn', () => finish(true));
    child.once('error', () => finish(false));
  });
}

export async function queueBattleBridgeExactHeadFromOpenClaw({
  expectedHead,
  authenticatedContext = null,
  env = process.env,
  platform = process.platform,
  spawnFn = spawn,
  nonce = randomUUID(),
  now = new Date(),
  launchTimeoutMs = 5000,
} = {}) {
  const normalizedExpectedHead = normalizeOpenClawExactHead(expectedHead);
  if (!normalizedExpectedHead) return Object.freeze({ ok: false, blocker: 'EXPECTED_HEAD_INVALID', expectedHead: '' });
  if (platform !== 'win32') return Object.freeze({ ok: false, blocker: 'WINDOWS_REQUIRED', expectedHead: normalizedExpectedHead });
  if (authenticatedContext?.authenticatedByHost !== true
      || authenticatedContext?.commandName !== 'stephanos-ignite'
      || authenticatedContext?.command !== 'update'
      || authenticatedContext?.senderIsOwner !== true) {
    return Object.freeze({ ok: false, blocker: 'OWNER_AUTH_REQUIRED', expectedHead: normalizedExpectedHead });
  }
  const receiptId = String(nonce).replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 32);
  const receiptRoot = updateReceiptRoot(env);
  if (!receiptRoot || !/^[a-f0-9]{32}$/.test(receiptId)) {
    return Object.freeze({ ok: false, blocker: 'UPDATE_RECEIPT_PATH_INVALID', expectedHead: normalizedExpectedHead });
  }
  mkdirSync(receiptRoot, { recursive: true });
  const receiptPath = path.resolve(receiptRoot, `${receiptId}.json`);
  if (path.dirname(receiptPath) !== receiptRoot) return Object.freeze({ ok: false, blocker: 'UPDATE_RECEIPT_PATH_INVALID', expectedHead: normalizedExpectedHead });
  const queued = {
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
    receiptId,
    status: 'QUEUED',
    expectedHead: normalizedExpectedHead,
    queuedAtUtc: now.toISOString(),
    pluginReloadProof: 'PENDING',
  };
  try {
    writeNewReceipt(receiptPath, queued);
    const executorPath = fileURLToPath(new URL('./recovery-update-executor.mjs', import.meta.url));
    const child = spawnFn(BATTLE_BRIDGE_WINDOWS_HOST.node, [executorPath, receiptId, normalizedExpectedHead], {
      cwd: canonicalRepoRoot(env), env, detached: true, shell: false, windowsHide: true, stdio: 'ignore',
    });
    const launched = await observeSpawn(child, launchTimeoutMs);
    if (!launched) {
      replaceReceipt(receiptPath, {
        ...queued,
        status: 'LAUNCH_FAILED',
        finalVerdict: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
        blocker: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
        launchFailedAtUtc: new Date(now.getTime()).toISOString(),
      });
      return Object.freeze({
        ok: false,
        status: 'LAUNCH_FAILED',
        finalVerdict: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
        blocker: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
        expectedHead: normalizedExpectedHead,
        receiptId,
        route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
        runtimeProofPassed: false,
        pluginReloadProofPending: true,
      });
    }
    child.unref?.();
  } catch {
    try {
      replaceReceipt(receiptPath, {
        ...queued,
        status: 'LAUNCH_FAILED',
        finalVerdict: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
        blocker: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
        launchFailedAtUtc: new Date(now.getTime()).toISOString(),
      });
    } catch {}
    return Object.freeze({
      ok: false,
      status: 'LAUNCH_FAILED',
      finalVerdict: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
      blocker: 'UPDATE_EXECUTOR_LAUNCH_FAILED',
      expectedHead: normalizedExpectedHead,
      receiptId,
      route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
      runtimeProofPassed: false,
      pluginReloadProofPending: true,
    });
  }
  return Object.freeze({
    ok: true,
    status: 'QUEUED',
    finalVerdict: 'PLUGIN_RELOAD_PROOF_PENDING',
    blocker: '',
    expectedHead: normalizedExpectedHead,
    receiptId,
    route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
    runtimeProofPassed: false,
    pluginReloadProofPending: true,
  });
}

function sanitizedCode(value, fallback = '') {
  const normalized = text(value).toUpperCase();
  return SAFE_VERDICT.test(normalized) ? normalized : fallback;
}

export function sanitizeOpenClawBattleBridgeUpdateResult(result = {}, expectedHead = '') {
  const normalizedExpectedHead = normalizeOpenClawExactHead(expectedHead);
  const sourceHead = normalizeOpenClawExactHead(result?.sourceHead);
  return Object.freeze({
    ok: result?.ok === true,
    status: result?.sourceInstalled === true ? 'PENDING' : sanitizedCode(result?.status, 'FAILED'),
    finalVerdict: result?.sourceInstalled === true
      ? 'PLUGIN_RELOAD_PROOF_PENDING'
      : sanitizedCode(result?.finalVerdict || result?.verdict, 'UPDATE_FAILED'),
    blocker: sanitizedCode(result?.blocker, ''),
    expectedHead: normalizedExpectedHead,
    sourceHead,
    expectedHeadMatch: result?.expectedHeadMatch === true && sourceHead === normalizedExpectedHead,
    sourceInstalled: result?.sourceInstalled === true,
    runtimeProofPassed: false,
    runtimeProofPending: result?.sourceInstalled === true || result?.runtimeProofPending === true,
    pluginReloadProofPending: result?.sourceInstalled === true,
    servedUiExactHead: false,
    route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
    destructiveGitAllowed: false,
    arbitraryShellAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedExecutableAllowed: false,
    pcRestartAllowed: false,
  });
}

export async function recoverBattleBridgeExactHeadFromOpenClaw({
  expectedHead,
  authenticatedContext = null,
  env = process.env,
  platform = process.platform,
  updateFn = updateStephanosFromChat,
  exactSyncFn = syncBattleBridgeExactHeadV1,
} = {}) {
  const normalizedExpectedHead = normalizeOpenClawExactHead(expectedHead);
  if (!normalizedExpectedHead) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'EXPECTED_HEAD_INVALID',
      blocker: 'EXPECTED_HEAD_INVALID',
      expectedHead: '',
      sourceHead: '',
      expectedHeadMatch: false,
      route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
      destructiveGitAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
    });
  }
  if (platform !== 'win32') {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'WINDOWS_REQUIRED',
      blocker: 'WINDOWS_REQUIRED',
      expectedHead: normalizedExpectedHead,
      sourceHead: '',
      expectedHeadMatch: false,
      route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
      destructiveGitAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
    });
  }
  if (authenticatedContext?.authenticatedByHost !== true
      || authenticatedContext?.commandName !== 'stephanos-ignite'
      || authenticatedContext?.command !== 'update'
      || authenticatedContext?.senderIsOwner !== true) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'OWNER_AUTH_REQUIRED',
      blocker: 'OWNER_AUTH_REQUIRED',
      expectedHead: normalizedExpectedHead,
      sourceHead: '',
      expectedHeadMatch: false,
      route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
      destructiveGitAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
    });
  }

  const repoRoot = canonicalRepoRoot(env);
  if (!repoRoot) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      finalVerdict: 'CANONICAL_REPO_ROOT_UNAVAILABLE',
      blocker: 'CANONICAL_REPO_ROOT_UNAVAILABLE',
      expectedHead: normalizedExpectedHead,
      sourceHead: '',
      expectedHeadMatch: false,
      route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
      destructiveGitAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
    });
  }

  const result = await updateFn({
    repoRoot,
    expectedBranch: 'main',
    expectedHead: normalizedExpectedHead,
    operatorApproval: 'operator-approved',
    platform,
    syncFn: (input) => exactSyncFn({ ...input, expectedHead: normalizedExpectedHead }),
  });
  return sanitizeOpenClawBattleBridgeUpdateResult(result, normalizedExpectedHead);
}
