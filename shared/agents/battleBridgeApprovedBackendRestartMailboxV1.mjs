import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { win32 } from 'node:path';

export const BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION = 'RESTART_APPROVED_STEPHANOS_BACKEND';
export const BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_SCHEMA = 'stephanos.battle-bridge-approved-backend-restart-mailbox.v1';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_BLOCKER_PATTERN = /^[A-Z0-9_:-]{3,120}$/;
const ALLOWED_COMMAND_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function safeBlocker(value, fallback = 'APPROVED_BACKEND_RESTART_BLOCKED') {
  const normalized = String(value || '').trim().toUpperCase();
  return SAFE_BLOCKER_PATTERN.test(normalized) ? normalized : fallback;
}

function parseLastJsonObject(stdout = '') {
  const lines = String(stdout || '').replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
  }
  return null;
}

export function validateApprovedBackendRestartCommandShape(command = {}) {
  if (String(command?.operation || '') !== BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
    return fail('APPROVED_BACKEND_RESTART_OPERATION_MISMATCH');
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_COMMAND_FIELDS.has(field));
  if (unexpectedField) return fail('APPROVED_BACKEND_RESTART_FIELD_NOT_ALLOWED', { field: unexpectedField });
  const expectedHead = String(command?.expectedHead || '').trim().toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) return fail('APPROVED_BACKEND_RESTART_EXPECTED_HEAD_REQUIRED');
  return Object.freeze({
    ok: true,
    verdict: 'APPROVED_BACKEND_RESTART_COMMAND_SHAPE_VALID',
    expectedHead,
  });
}

export function normalizeApprovedBackendRestartCommand(command = {}, validatedEnvelope = {}) {
  const shape = validateApprovedBackendRestartCommandShape(command);
  if (!shape.ok) return shape;
  if (!validatedEnvelope?.ok || !validatedEnvelope?.command) {
    return fail(String(validatedEnvelope?.blocker || 'APPROVED_BACKEND_RESTART_ENVELOPE_INVALID'));
  }
  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_ACCEPTED',
    command: Object.freeze({
      ...validatedEnvelope.command,
      operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
      expectedHead: shape.expectedHead,
    }),
  });
}

export async function executeApprovedBackendRestartOnBattleBridge(command = {}, {
  platform = process.platform,
  env = process.env,
  home = homedir(),
  spawnSyncFn = spawnSync,
  existsSyncFn = existsSync,
} = {}) {
  const shape = validateApprovedBackendRestartCommandShape(command);
  if (!shape.ok) return shape;
  if (platform !== 'win32') return fail('APPROVED_BACKEND_RESTART_WINDOWS_REQUIRED');
  const userProfile = String(env?.USERPROFILE || home || '').trim();
  const systemRoot = String(env?.SystemRoot || env?.SYSTEMROOT || '').trim();
  if (!userProfile) return fail('APPROVED_BACKEND_RESTART_USERPROFILE_REQUIRED');
  if (!systemRoot) return fail('APPROVED_BACKEND_RESTART_SYSTEMROOT_REQUIRED');

  const repoRoot = win32.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  const restartScript = win32.resolve(repoRoot, 'scripts', 'windows', 'restart-approved-stephanos-runtime.ps1');
  const powershellExe = win32.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!existsSyncFn(restartScript)) return fail('APPROVED_BACKEND_RESTART_SCRIPT_MISSING');
  if (!existsSyncFn(powershellExe)) return fail('APPROVED_BACKEND_RESTART_POWERSHELL_MISSING');

  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', restartScript,
    '-Target', 'backend',
    '-ExpectedHead', shape.expectedHead,
    '-TimeoutSeconds', '90',
  ];
  const invocation = spawnSyncFn(powershellExe, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 1024 * 1024,
  });
  const payload = parseLastJsonObject(invocation?.stdout);
  if (!payload) {
    return fail(invocation?.error ? 'APPROVED_BACKEND_RESTART_EXECUTOR_FAILED' : 'APPROVED_BACKEND_RESTART_RESPONSE_INVALID');
  }
  if (invocation?.error || invocation?.status !== 0 || payload?.ok !== true) {
    return fail(safeBlocker(payload?.blocker), {
      finalVerdict: 'APPROVED_BACKEND_RESTART_BLOCKED',
      expectedHead: shape.expectedHead,
    });
  }

  const sourceHead = String(payload?.sourceHead || '').trim().toLowerCase();
  const expectedHead = String(payload?.expectedHead || '').trim().toLowerCase();
  const proofValid = payload?.schemaVersion === 'stephanos.approved-runtime-restart.v1'
    && payload?.target === 'backend'
    && payload?.taskName === 'Stephanos Battle Bridge Backend'
    && expectedHead === shape.expectedHead
    && sourceHead === shape.expectedHead
    && payload?.exactHeadProofOk === true
    && payload?.canonicalActionVerified === true
    && payload?.proofFresh === true
    && payload?.unrelatedTasksChanged === false
    && payload?.arbitraryTaskTargetAllowed === false
    && payload?.arbitraryProcessKillAllowed === false
    && payload?.verifiedOwnedProcessTerminationOnly === true
    && payload?.liveOpenClawUpdatePerformed === false
    && payload?.finalVerdict === 'APPROVED_RUNTIME_RESTART_PASS';
  if (!proofValid) return fail('APPROVED_BACKEND_RESTART_PROOF_INVALID');

  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_SCHEMA,
    operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    target: 'backend',
    taskName: 'Stephanos Battle Bridge Backend',
    expectedHead: shape.expectedHead,
    sourceHead,
    exactHeadProofOk: true,
    canonicalActionVerified: true,
    proofKind: String(payload.proofKind || ''),
    proofFresh: true,
    terminatedVerifiedOwnedProcess: payload?.terminatedVerifiedOwnedProcess === true,
    unrelatedTasksChanged: false,
    arbitraryTaskTargetAllowed: false,
    arbitraryProcessKillAllowed: false,
    verifiedOwnedProcessTerminationOnly: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
    liveOpenClawUpdatePerformed: false,
    finalVerdict: 'BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_PASS',
  });
}
