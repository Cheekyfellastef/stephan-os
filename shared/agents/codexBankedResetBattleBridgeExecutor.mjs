import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const CODEX_BANKED_RESET_EXECUTOR_SCHEMA_VERSION = 'stephanos.codex-banked-reset-executor.v1';
export const CODEX_BANKED_RESET_OPERATION = 'REDEEM_BANKED_CODEX_RATE_LIMIT_RESET';
export const CODEX_BANKED_RESET_POLICY_REF = 'operator-policy/codex-banked-reset-v1';
export const CODEX_BANKED_RESET_EXECUTION_SURFACE = 'BATTLE_BRIDGE_AUTHENTICATED_CODEX_UI';

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SAFE_RESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_OUTPUT_BYTES = 64 * 1024;

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'CODEX_BANKED_RESET_EXECUTION_BLOCKED',
    ...details,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    repeatedPressAllowed: false,
  });
}

function iso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function sanitizeText(value, limit = 500) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function safeTextList(value, { limit = 10, itemLimit = 240 } = {}) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => sanitizeText(item, itemLimit)).filter(Boolean))].slice(0, limit)
    : [];
}

export function validateCodexBankedResetExecutionCommand(command = {}, { now = new Date() } = {}) {
  if (command.operation !== CODEX_BANKED_RESET_OPERATION) return blocked('RESET_OPERATION_MISMATCH');
  if (!SAFE_REQUEST_ID_PATTERN.test(String(command.requestId || ''))) return blocked('RESET_REQUEST_ID_INVALID');
  if (!SAFE_RESET_ID_PATTERN.test(String(command.resetId || ''))) return blocked('RESET_ID_INVALID');
  if (command.standingOperatorPolicyRef !== CODEX_BANKED_RESET_POLICY_REF) return blocked('RESET_POLICY_MISMATCH');
  if (command.executionSurface !== CODEX_BANKED_RESET_EXECUTION_SURFACE) return blocked('RESET_EXECUTION_SURFACE_MISMATCH');
  if (command.fixedUiActionOnly !== true) return blocked('RESET_FIXED_UI_ACTION_REQUIRED');
  if (command.singlePressOnly !== true) return blocked('RESET_SINGLE_PRESS_REQUIRED');
  if (command.expectedHead && !SHA_PATTERN.test(String(command.expectedHead))) return blocked('RESET_EXPECTED_HEAD_INVALID');

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const resetExpiry = Date.parse(String(command.resetExpiresAtUtc || ''));
  const latestSafe = Date.parse(String(command.latestSafeExecutionUtc || ''));
  const commandExpiry = Date.parse(String(command.expiresAt || ''));
  if (![nowMs, resetExpiry, latestSafe, commandExpiry].every(Number.isFinite)) return blocked('RESET_TIME_INVALID');
  if (commandExpiry <= nowMs) return blocked('RESET_COMMAND_EXPIRED');
  if (latestSafe <= nowMs) return blocked('RESET_ACTION_EXPIRED');
  if (resetExpiry <= nowMs) return blocked('RESET_ALREADY_EXPIRED');
  if (latestSafe > commandExpiry) return blocked('RESET_LATEST_SAFE_AFTER_COMMAND_EXPIRY');
  if (latestSafe > resetExpiry) return blocked('RESET_LATEST_SAFE_AFTER_RESET_EXPIRY');

  return Object.freeze({
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_EXECUTION_COMMAND_VALID',
    command: Object.freeze({
      operation: CODEX_BANKED_RESET_OPERATION,
      requestId: String(command.requestId),
      resetId: String(command.resetId),
      resetExpiresAtUtc: new Date(resetExpiry).toISOString(),
      latestSafeExecutionUtc: new Date(latestSafe).toISOString(),
      standingOperatorPolicyRef: CODEX_BANKED_RESET_POLICY_REF,
      executionSurface: CODEX_BANKED_RESET_EXECUTION_SURFACE,
      fixedUiActionOnly: true,
      singlePressOnly: true,
      expectedHead: String(command.expectedHead || '').toLowerCase(),
      expiresAt: new Date(commandExpiry).toISOString(),
    }),
  });
}

export function buildCodexBankedResetPowerShellInvocation(command = {}, {
  platform = process.platform,
  repoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os'),
  now = new Date(),
} = {}) {
  const validation = validateCodexBankedResetExecutionCommand(command, { now });
  if (!validation.ok) return validation;
  if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');

  const scriptPath = join(resolve(repoRoot), 'scripts', 'windows', 'invoke-codex-banked-reset-ui-with-navigation.ps1');
  if (!existsSync(scriptPath)) return blocked('RESET_EXECUTOR_SCRIPT_MISSING', { scriptPath });
  const normalized = validation.command;
  return Object.freeze({
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_FIXED_INVOCATION_READY',
    executable: 'powershell.exe',
    args: Object.freeze([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-RequestId', normalized.requestId,
      '-ResetId', normalized.resetId,
      '-ResetExpiresAtUtc', normalized.resetExpiresAtUtc,
      '-LatestSafeExecutionUtc', normalized.latestSafeExecutionUtc,
      '-StandingOperatorPolicyRef', normalized.standingOperatorPolicyRef,
    ]),
    cwd: resolve(repoRoot),
    scriptPath,
    command: normalized,
    shell: false,
    fixedCommand: true,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
  });
}

export function normalizeCodexBankedResetExecutionResult(raw = {}, command = {}) {
  const result = raw && typeof raw === 'object' ? raw : {};
  const meterBefore = sanitizeText(result.meterBefore, 200);
  const meterAfter = sanitizeText(result.meterAfter, 200);
  const usageSurfaceMatched = result.usageSurfaceMatched === true;
  const resetControlDisappeared = result.resetControlDisappeared === true;
  const confirmationEvidencePresent = Boolean(meterBefore) && (Boolean(meterAfter) || resetControlDisappeared);
  const ok = result.ok === true
    && result.finalVerdict === 'CODEX_BANKED_RESET_CONFIRMED'
    && usageSurfaceMatched
    && result.pressAttempted === true
    && result.pressCount === 1
    && result.meterRestored === true
    && confirmationEvidencePresent;
  const safe = Object.freeze({
    schemaVersion: CODEX_BANKED_RESET_EXECUTOR_SCHEMA_VERSION,
    ok,
    blocker: ok ? '' : sanitizeText(result.blocker || 'RESET_CONFIRMATION_NOT_PROVEN', 120),
    finalVerdict: ok ? 'CODEX_BANKED_RESET_CONFIRMED' : 'CODEX_BANKED_RESET_EXECUTION_BLOCKED',
    requestId: sanitizeText(result.requestId || command.requestId, 120),
    resetId: sanitizeText(result.resetId || command.resetId, 120),
    resetExpiresAtUtc: iso(result.resetExpiresAtUtc || command.resetExpiresAtUtc),
    observedAtUtc: iso(result.observedAtUtc),
    completedAtUtc: iso(result.completedAtUtc),
    matchedWindow: sanitizeText(result.matchedWindow, 160),
    matchedProfileControl: sanitizeText(result.matchedProfileControl, 120),
    matchedUsageControl: sanitizeText(result.matchedUsageControl, 160),
    matchedUsageLabel: sanitizeText(result.matchedUsageLabel, 160),
    usageControlResolution: sanitizeText(result.usageControlResolution, 80),
    navigationAttempted: result.navigationAttempted === true,
    profileMenuOpened: result.profileMenuOpened === true,
    usagePanelOpened: result.usagePanelOpened === true,
    matchedButton: sanitizeText(result.matchedButton, 120),
    matchedExpiryText: sanitizeText(result.matchedExpiryText, 160),
    meterBefore,
    meterAfter,
    pressAttempted: result.pressAttempted === true,
    pressCount: Number(result.pressCount || 0),
    meterRestored: result.meterRestored === true,
    resetControlDisappeared,
    desktopInteractive: result.desktopInteractive === true,
    appWindowFound: result.appWindowFound === true,
    usageSurfaceMatched,
    confirmationEvidencePresent,
    fixedUiActionOnly: true,
    singlePressOnly: true,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    repeatedPressAllowed: false,
    proofRefs: safeTextList(result.proofRefs),
  });
  return safe;
}

export function executeCodexBankedResetOnBattleBridge(command = {}, {
  platform = process.platform,
  repoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os'),
  now = new Date(),
  spawn = spawnSync,
} = {}) {
  const invocation = buildCodexBankedResetPowerShellInvocation(command, { platform, repoRoot, now });
  if (!invocation.ok) return invocation;

  const result = spawn(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result?.error) return blocked('RESET_EXECUTOR_PROCESS_FAILED', { error: sanitizeText(result.error.message, 300) });

  const stdout = String(result?.stdout || '');
  if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) return blocked('RESET_EXECUTOR_OUTPUT_TOO_LARGE');
  let parsed;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch (error) {
    return blocked('RESET_EXECUTOR_OUTPUT_INVALID', {
      error: sanitizeText(error?.message, 300),
      stderr: sanitizeText(result?.stderr, 500),
    });
  }
  const normalized = normalizeCodexBankedResetExecutionResult(parsed, invocation.command);
  if (result?.status !== 0 && normalized.ok) {
    return blocked('RESET_EXECUTOR_EXIT_CODE_MISMATCH', { status: result.status });
  }
  return normalized;
}
