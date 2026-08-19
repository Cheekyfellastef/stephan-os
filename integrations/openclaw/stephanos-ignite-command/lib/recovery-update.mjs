import path from 'node:path';

import { syncBattleBridgeExactHeadV1 } from '../../../../shared/agents/battleBridgeExactHeadSyncGuardV1.mjs';
import { updateStephanosFromChat } from '../../../../shared/agents/stephanosChatUpdate.mjs';

export const OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE = 'OPENCLAW_WHATSAPP_EXACT_HEAD';

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

function sanitizedCode(value, fallback = '') {
  const normalized = text(value).toUpperCase();
  return SAFE_VERDICT.test(normalized) ? normalized : fallback;
}

export function sanitizeOpenClawBattleBridgeUpdateResult(result = {}, expectedHead = '') {
  const normalizedExpectedHead = normalizeOpenClawExactHead(expectedHead);
  const sourceHead = normalizeOpenClawExactHead(result?.sourceHead);
  return Object.freeze({
    ok: result?.ok === true,
    status: sanitizedCode(result?.status, 'FAILED'),
    finalVerdict: sanitizedCode(result?.finalVerdict || result?.verdict, 'UPDATE_FAILED'),
    blocker: sanitizedCode(result?.blocker, ''),
    expectedHead: normalizedExpectedHead,
    sourceHead,
    expectedHeadMatch: result?.expectedHeadMatch === true && sourceHead === normalizedExpectedHead,
    sourceInstalled: result?.sourceInstalled === true,
    runtimeProofPassed: result?.runtimeProofPassed === true,
    runtimeProofPending: result?.runtimeProofPending === true,
    servedUiExactHead: result?.servedUiProof?.exactHead === true,
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
