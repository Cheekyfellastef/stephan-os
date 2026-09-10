import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { win32 } from 'node:path';

export const BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION = 'RESTART_APPROVED_STEPHANOS_BACKEND';
export const BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_SCHEMA = 'stephanos.battle-bridge-approved-backend-restart-mailbox.v1';
export const BATTLE_BRIDGE_LEGACY_BACKEND_MIGRATION_SCHEMA = 'stephanos.legacy-backend-listener-migration.v1';

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
      schemaVersion: validatedEnvelope.command.schemaVersion,
      requestId: validatedEnvelope.command.requestId,
      operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
      repository: validatedEnvelope.command.repository,
      issueNumber: validatedEnvelope.command.issueNumber,
      branch: validatedEnvelope.command.branch,
      operatorApproval: validatedEnvelope.command.operatorApproval,
      expectedHead: shape.expectedHead,
      expiresAt: validatedEnvelope.command.expiresAt,
    }),
  });
}

function validateRestartPayload(payload, expectedHead) {
  const sourceHead = String(payload?.sourceHead || '').trim().toLowerCase();
  const payloadExpectedHead = String(payload?.expectedHead || '').trim().toLowerCase();
  const proofValid = payload?.schemaVersion === 'stephanos.approved-runtime-restart.v1'
    && payload?.target === 'backend'
    && payload?.taskName === 'Stephanos Battle Bridge Backend'
    && payloadExpectedHead === expectedHead
    && sourceHead === expectedHead
    && payload?.exactHeadProofOk === true
    && payload?.canonicalActionVerified === true
    && payload?.proofFresh === true
    && payload?.unrelatedTasksChanged === false
    && payload?.arbitraryTaskTargetAllowed === false
    && payload?.arbitraryProcessKillAllowed === false
    && payload?.verifiedOwnedProcessTerminationOnly === true
    && payload?.liveOpenClawUpdatePerformed === false
    && payload?.finalVerdict === 'APPROVED_RUNTIME_RESTART_PASS';
  return proofValid ? Object.freeze({ ok: true, sourceHead }) : fail('APPROVED_BACKEND_RESTART_PROOF_INVALID');
}

function validateLegacyMigrationPayload(payload, expectedHead) {
  const replacedSourceHead = String(payload?.replacedSourceHead || '').trim().toLowerCase();
  const proofValid = payload?.schemaVersion === BATTLE_BRIDGE_LEGACY_BACKEND_MIGRATION_SCHEMA
    && payload?.ok === true
    && payload?.finalVerdict === 'LEGACY_BACKEND_LISTENER_MIGRATED'
    && String(payload?.expectedHead || '').trim().toLowerCase() === expectedHead
    && SHA_PATTERN.test(replacedSourceHead)
    && replacedSourceHead !== expectedHead
    && payload?.canonicalNodeVerified === true
    && payload?.legacyCommandVerified === true
    && payload?.healthIdentityVerified === true
    && payload?.staleSourceAncestor === true
    && payload?.stableProcessIdentity === true
    && payload?.terminatedVerifiedOwnedProcess === true
    && payload?.arbitraryPidAllowed === false
    && payload?.arbitraryExecutableAllowed === false
    && payload?.arbitraryCommandAllowed === false
    && payload?.arbitraryTaskAllowed === false
    && payload?.arbitraryShellAllowed === false
    && payload?.sourceMutationAllowed === false
    && payload?.pcRestartAllowed === false
    && payload?.liveOpenClawUpdatePerformed === false;
  return proofValid
    ? Object.freeze({ ok: true, replacedSourceHead })
    : fail('LEGACY_BACKEND_MIGRATION_PROOF_INVALID');
}

function runPowerShell(spawnSyncFn, powershellExe, scriptPath, scriptArgs, repoRoot) {
  return spawnSyncFn(powershellExe, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    ...scriptArgs,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 1024 * 1024,
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
  const legacyMigrationScript = win32.resolve(repoRoot, 'scripts', 'windows', 'migrate-legacy-stephanos-backend-listener-v1.ps1');
  const powershellExe = win32.resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!existsSyncFn(restartScript)) return fail('APPROVED_BACKEND_RESTART_SCRIPT_MISSING');
  if (!existsSyncFn(powershellExe)) return fail('APPROVED_BACKEND_RESTART_POWERSHELL_MISSING');

  const restartArgs = [
    '-Target', 'backend',
    '-ExpectedHead', shape.expectedHead,
    '-TimeoutSeconds', '90',
  ];
  let invocation = runPowerShell(spawnSyncFn, powershellExe, restartScript, restartArgs, repoRoot);
  let payload = parseLastJsonObject(invocation?.stdout);
  let legacyMigrationPerformed = false;
  let legacyReplacedSourceHead = '';

  if (invocation?.error || invocation?.status !== 0 || payload?.ok !== true) {
    const initialBlocker = safeBlocker(payload?.blocker);
    if (initialBlocker !== 'BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED') {
      return fail(initialBlocker, {
        finalVerdict: 'APPROVED_BACKEND_RESTART_BLOCKED',
        expectedHead: shape.expectedHead,
      });
    }

    if (!existsSyncFn(legacyMigrationScript)) {
      return fail('LEGACY_BACKEND_MIGRATION_SCRIPT_MISSING', {
        finalVerdict: 'APPROVED_BACKEND_RESTART_BLOCKED',
        expectedHead: shape.expectedHead,
      });
    }
    const migrationInvocation = runPowerShell(
      spawnSyncFn,
      powershellExe,
      legacyMigrationScript,
      ['-ExpectedHead', shape.expectedHead],
      repoRoot,
    );
    const migrationPayload = parseLastJsonObject(migrationInvocation?.stdout);
    if (migrationInvocation?.error || migrationInvocation?.status !== 0 || migrationPayload?.ok !== true) {
      return fail(safeBlocker(migrationPayload?.blocker, 'LEGACY_BACKEND_MIGRATION_FAILED'), {
        finalVerdict: 'APPROVED_BACKEND_RESTART_BLOCKED',
        expectedHead: shape.expectedHead,
      });
    }
    const migrationProof = validateLegacyMigrationPayload(migrationPayload, shape.expectedHead);
    if (!migrationProof.ok) return migrationProof;
    legacyMigrationPerformed = true;
    legacyReplacedSourceHead = migrationProof.replacedSourceHead;

    invocation = runPowerShell(spawnSyncFn, powershellExe, restartScript, restartArgs, repoRoot);
    payload = parseLastJsonObject(invocation?.stdout);
    if (invocation?.error || invocation?.status !== 0 || payload?.ok !== true) {
      return fail(safeBlocker(payload?.blocker, 'APPROVED_BACKEND_RESTART_AFTER_LEGACY_MIGRATION_FAILED'), {
        finalVerdict: 'APPROVED_BACKEND_RESTART_BLOCKED',
        expectedHead: shape.expectedHead,
      });
    }
  }

  const proof = validateRestartPayload(payload, shape.expectedHead);
  if (!proof.ok) return proof;

  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_SCHEMA,
    operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    target: 'backend',
    taskName: 'Stephanos Battle Bridge Backend',
    expectedHead: shape.expectedHead,
    sourceHead: proof.sourceHead,
    exactHeadProofOk: true,
    canonicalActionVerified: true,
    proofKind: String(payload.proofKind || ''),
    proofFresh: true,
    legacyMigrationPerformed,
    legacyReplacedSourceHead,
    terminatedVerifiedOwnedProcess: payload?.terminatedVerifiedOwnedProcess === true || legacyMigrationPerformed,
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
