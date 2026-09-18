import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const CODEX_BANKED_RESET_STATUS_READER_SCHEMA_VERSION = 'stephanos.codex-banked-reset-status-reader.v1';
export const CODEX_BANKED_RESET_STATUS_OPERATION = 'READ_CODEX_BANKED_RESET_STATUS';
export const CODEX_BANKED_RESET_STATUS_EXECUTION_SURFACE = 'BATTLE_BRIDGE_AUTHENTICATED_CODEX_UI_READ_ONLY';

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SECRET_PATTERN = /secret|token|session|password|credential|authorization|bearer|oauth|client[_ -]?secret|access[_ -]?key|private[_-]?key|api[_-]?key|x-api-key|x-auth-token|cookie|set-cookie|\.env\b|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY/i;
const MAX_OUTPUT_BYTES = 64 * 1024;

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_BLOCKED',
    ...details,
    readOnly: true,
    pressAttempted: false,
    pressCount: 0,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
  });
}

function sanitizeText(value, limit = 300) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function sanitizeDiagnosticText(value, limit = 300) {
  const text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text && !SECRET_PATTERN.test(text) ? text.slice(0, limit) : '';
}

function safeTextList(value, { limit = 20, itemLimit = 220 } = {}) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => sanitizeText(item, itemLimit)).filter(Boolean))].slice(0, limit)
    : [];
}

function iso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

export function validateCodexBankedResetStatusCommand(command = {}, { now = new Date() } = {}) {
  if (command.operation !== CODEX_BANKED_RESET_STATUS_OPERATION) return blocked('RESET_STATUS_OPERATION_MISMATCH');
  if (!SAFE_REQUEST_ID_PATTERN.test(String(command.requestId || ''))) return blocked('RESET_STATUS_REQUEST_ID_INVALID');
  if (command.expectedHead && !SHA_PATTERN.test(String(command.expectedHead))) return blocked('RESET_STATUS_EXPECTED_HEAD_INVALID');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const commandExpiry = Date.parse(String(command.expiresAt || ''));
  if (!Number.isFinite(nowMs) || !Number.isFinite(commandExpiry)) return blocked('RESET_STATUS_TIME_INVALID');
  if (commandExpiry <= nowMs) return blocked('RESET_STATUS_COMMAND_EXPIRED');
  return Object.freeze({
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_COMMAND_VALID',
    command: Object.freeze({
      operation: CODEX_BANKED_RESET_STATUS_OPERATION,
      requestId: String(command.requestId),
      expectedHead: String(command.expectedHead || '').toLowerCase(),
      expiresAt: new Date(commandExpiry).toISOString(),
      executionSurface: CODEX_BANKED_RESET_STATUS_EXECUTION_SURFACE,
      readOnly: true,
    }),
  });
}

export function buildCodexBankedResetStatusPowerShellInvocation(command = {}, {
  platform = process.platform,
  repoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os'),
  now = new Date(),
} = {}) {
  const validation = validateCodexBankedResetStatusCommand(command, { now });
  if (!validation.ok) return validation;
  if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');
  const scriptPath = join(resolve(repoRoot), 'scripts', 'windows', 'read-codex-banked-reset-status-with-navigation.ps1');
  if (!existsSync(scriptPath)) return blocked('RESET_STATUS_READER_SCRIPT_MISSING', { scriptPath });
  return Object.freeze({
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_FIXED_INVOCATION_READY',
    executable: 'powershell.exe',
    args: Object.freeze([
      '-NoProfile',
      '-Sta',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-RequestId', validation.command.requestId,
    ]),
    cwd: resolve(repoRoot),
    scriptPath,
    command: validation.command,
    shell: false,
    fixedCommand: true,
    readOnly: true,
    pressAttempted: false,
    pressCount: 0,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
  });
}

export function normalizeCodexBankedResetStatusResult(raw = {}, command = {}) {
  const result = raw && typeof raw === 'object' ? raw : {};
  const meterSummary = sanitizeText(result.meterSummary, 300);
  const expiryTexts = safeTextList(result.expiryTexts, { limit: 12, itemLimit: 220 });
  const resetButtons = safeTextList(result.resetButtons, { limit: 12, itemLimit: 120 });
  const usageSurfaceMatched = result.usageSurfaceMatched === true;
  const usageSurfaceKind = [
    'authenticated-desktop-codex-usage',
    'authenticated-edge-codex-analytics',
  ].includes(result.usageSurfaceKind) ? result.usageSurfaceKind : '';
  const ok = result.ok === true
    && result.finalVerdict === 'CODEX_BANKED_RESET_STATUS_READY'
    && usageSurfaceMatched
    && Boolean(usageSurfaceKind)
    && result.pressAttempted !== true
    && Number(result.pressCount || 0) === 0;
  return Object.freeze({
    schemaVersion: CODEX_BANKED_RESET_STATUS_READER_SCHEMA_VERSION,
    ok,
    blocker: ok ? '' : sanitizeText(result.blocker || 'RESET_STATUS_NOT_PROVEN', 120),
    finalVerdict: ok ? 'CODEX_BANKED_RESET_STATUS_READY' : 'CODEX_BANKED_RESET_STATUS_BLOCKED',
    requestId: sanitizeText(result.requestId || command.requestId, 120),
    observedAtUtc: iso(result.observedAtUtc),
    matchedWindow: sanitizeText(result.matchedWindow, 160),
    matchedProfileControl: sanitizeText(result.matchedProfileControl, 120),
    matchedUsageControl: sanitizeText(result.matchedUsageControl, 160),
    matchedUsageLabel: sanitizeText(result.matchedUsageLabel, 160),
    usageControlResolution: sanitizeText(result.usageControlResolution, 80),
    usageSurfaceKind,
    navigationAttempted: result.navigationAttempted === true,
    navigationRetryCount: Math.max(0, Math.min(1, Number(result.navigationRetryCount || 0))),
    profileMenuOpened: result.profileMenuOpened === true,
    usagePanelOpened: result.usagePanelOpened === true,
    profileCandidates: safeTextList(result.profileCandidates, { limit: 10, itemLimit: 120 }),
    usageCandidates: safeTextList(result.usageCandidates, { limit: 10, itemLimit: 120 }),
    usageLabelCandidates: safeTextList(result.usageLabelCandidates, { limit: 10, itemLimit: 120 }),
    meterSummary,
    expiryTexts,
    resetButtons,
    activeCodexTask: result.activeCodexTask === true,
    desktopInteractive: result.desktopInteractive === true,
    appWindowFound: result.appWindowFound === true,
    usageSurfaceMatched,
    error: sanitizeDiagnosticText(result.error, 300),
    readOnly: true,
    pressAttempted: false,
    pressCount: 0,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    proofRefs: safeTextList(result.proofRefs, { limit: 10, itemLimit: 240 }),
  });
}

export function readCodexBankedResetStatusOnBattleBridge(command = {}, {
  platform = process.platform,
  repoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os'),
  now = new Date(),
  spawn = spawnSync,
} = {}) {
  const invocation = buildCodexBankedResetStatusPowerShellInvocation(command, { platform, repoRoot, now });
  if (!invocation.ok) return invocation;
  const result = spawn(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result?.error) return blocked('RESET_STATUS_READER_PROCESS_FAILED', { error: sanitizeDiagnosticText(result.error.message, 300) });
  const stdout = String(result?.stdout || '');
  if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) return blocked('RESET_STATUS_READER_OUTPUT_TOO_LARGE');
  let parsed;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch (error) {
    return blocked('RESET_STATUS_READER_OUTPUT_INVALID', {
      error: sanitizeDiagnosticText(error?.message, 300),
      stderr: sanitizeDiagnosticText(result?.stderr, 500),
    });
  }
  const normalized = normalizeCodexBankedResetStatusResult(parsed, invocation.command);
  if (result?.status !== 0 && normalized.ok) return blocked('RESET_STATUS_READER_EXIT_CODE_MISMATCH', { status: result.status });
  return normalized;
}
