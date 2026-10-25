// Fixed adapter to the existing maintenance recovery owner, never a shell route.
import { projectMaintenanceSourceDiagnosticV1 } from './sovereignMaintenanceSourceDiagnosticV1.mjs';

export const MAINTENANCE_RECOVERY_OPERATIONS = Object.freeze([
  'OBSERVE_SOVEREIGN_MAINTENANCE_RECOVERY',
  'PREPARE_SOVEREIGN_MAINTENANCE_RECOVERY',
]);
const fields = new Set(['schemaVersion', 'requestId', 'operation', 'repository',
  'issueNumber', 'branch', 'operatorApproval', 'expectedHead', 'expiresAt',
  'expectedCycle', 'expectedReportSha256']);
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = blocker => Object.freeze({ ok: false, requested: true, verdict: 'BLOCKED', blocker,
  custodyReleased: false, pcRestartAllowed: false, sourceLeaseReleased: false });

// Exact native failure vocabulary only. A diagnostic is never custody, source,
// boot, approval or execution proof, and cannot reveal an error's private text.
const fixedDiagnosticCodes = new Set([
  'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
  'NATIVE_WINDOWS_BOOT_WITNESS_REQUIRED', 'WINDOWS_BOOT_WITNESS_UNAVAILABLE', 'WINDOWS_BOOT_WITNESS_INVALID',
  'CUSTODY_DIRECTORY_UNSAFE', 'CUSTODY_AUTHENTICATION_REQUIRED',
  'CUSTODY_RECORD_AUTHENTICATION_FAILED', 'CUSTODY_RECORD_UNSAFE', 'CUSTODY_RECORD_INVALID', 'CUSTODY_RECORD_UNBOUNDED',
  'MAINTENANCE_OS_ANCHOR_UNAVAILABLE', 'MAINTENANCE_OS_ANCHOR_IDENTITY_INVALID',
  'MAINTENANCE_OS_ANCHOR_ENCODING_INVALID', 'MAINTENANCE_OS_ANCHOR_AUTHENTICATION_FAILED',
  'MAINTENANCE_OS_ANCHOR_UNPROVEN', 'MAINTENANCE_OS_ANCHOR_UNBOUNDED',
  'MAINTENANCE_OS_ANCHOR_PREVIOUS_ID_REQUIRED', 'MAINTENANCE_OS_ANCHOR_APPEND_UNPROVEN',
  'MAINTENANCE_CUSTODY_STATE_MISSING', 'MAINTENANCE_CUSTODY_RESERVED', 'MAINTENANCE_CUSTODY_STATE_UNPROVEN',
  'MAINTENANCE_CUSTODY_RESERVATION_UNPROVEN',
  'LEGACY_MAINTENANCE_REPORT_UNBOUNDED', 'LEGACY_MAINTENANCE_EXACT_LIVE_HOLD_REQUIRED',
]);
const filesystemDiagnosticCodes = new Set([
  'ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR', 'EEXIST', 'ELOOP', 'EBUSY', 'EIO', 'ENOSPC', 'EROFS',
]);
const diagnosticCodes = new Set([...fixedDiagnosticCodes, ...filesystemDiagnosticCodes, 'TIMEOUT', 'UNKNOWN']);
const diagnostic = (code, source = {}) => {
  const safeCode = typeof code === 'string' && diagnosticCodes.has(code) ? code : 'UNKNOWN';
  return Object.freeze({ code: safeCode, diagnosticOnly: true,
    ...(safeCode === 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN'
      ? projectMaintenanceSourceDiagnosticV1(source?.sourceCode, source?.sourceStep) : {}),
  });
};
const blockerDiagnostic = code => diagnostic(fixedDiagnosticCodes.has(code) ? code : 'UNKNOWN');
function caughtDiagnostic(error) {
  try {
    if (fixedDiagnosticCodes.has(error?.message)) return diagnostic(error.message, error);
    if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') return diagnostic('TIMEOUT');
    if (filesystemDiagnosticCodes.has(error?.code)) return diagnostic(error.code);
  } catch { /* Malformed errors are unknown, never a reason to expose raw data. */ }
  return diagnostic('UNKNOWN');
}

export function projectMaintenanceRecoveryReceiptV1(value = {}, operation = '') {
  if (!MAINTENANCE_RECOVERY_OPERATIONS.includes(operation)) return {};
  value = value?.maintenanceRecovery || value || {};
  const detail = value.diagnostic;
  const typedDiagnostic = detail && typeof detail === 'object' && !Array.isArray(detail)
    && detail.diagnosticOnly === true;
  return { maintenanceRecovery: Object.freeze({
    originalHoldMatched: value.originalHoldMatched === true,
    prepared: value.prepared === true, held: value.held === true,
    digest: hash.test(value.digest ?? '') ? value.digest : '',
    cycleId: uuid.test(value.cycleId ?? '') ? value.cycleId : '',
    reportSha256: hash.test(value.reportSha256 ?? '') ? value.reportSha256 : '',
    ...(Object.hasOwn(value, 'diagnostic') ? {
      diagnostic: diagnostic(typedDiagnostic ? detail.code : 'UNKNOWN', typedDiagnostic ? detail : undefined),
    } : {}),
    custodyReleased: false, pcRestartAllowed: false, sourceLeaseReleased: false,
  }) };
}

export function validateMaintenanceRecoveryCommandShape(command = {}) {
  if (!MAINTENANCE_RECOVERY_OPERATIONS.includes(command?.operation))
    return Object.freeze({ ok: true, requested: false });
  if (Object.keys(command).some(key => !fields.has(key))) return fail('RECOVERY_MAILBOX_FIELD_NOT_ALLOWED');
  if (command.repository !== 'Cheekyfellastef/stephan-os' || command.issueNumber !== 3149
      || command.branch !== 'main' || command.operatorApproval !== 'operator-approved'
      || !sha.test(command.expectedHead ?? '')) return fail('RECOVERY_MAILBOX_EXACT_ENVELOPE_REQUIRED');
  if (command.operation === MAINTENANCE_RECOVERY_OPERATIONS[1]) {
    if (!uuid.test(command.expectedCycle ?? '') || !hash.test(command.expectedReportSha256 ?? ''))
      return fail('RECOVERY_MAILBOX_EXACT_INCIDENT_REQUIRED');
  } else if (command.expectedCycle !== undefined || command.expectedReportSha256 !== undefined) {
    return fail('RECOVERY_MAILBOX_FIELD_NOT_ALLOWED');
  }
  return Object.freeze({ ok: true, requested: true, command: Object.freeze({ ...command }) });
}

export function isTerminalizableMaintenanceRecoveryBlocker(value) {
  return ['RECOVERY_MAILBOX_FIELD_NOT_ALLOWED', 'RECOVERY_MAILBOX_EXACT_ENVELOPE_REQUIRED',
    'RECOVERY_MAILBOX_EXACT_INCIDENT_REQUIRED'].includes(value);
}

export async function executeMaintenanceRecoveryOnBattleBridge(command, options = {}) {
  const shape = validateMaintenanceRecoveryCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;
  try {
    // No command-supplied path, executable, environment, token or boot witness.
    const { readMaintenanceRecoverySourceV1 } = await import('../../scripts/sovereign-maintenance-custody-store-v1.mjs');
    const sourceReader = options.readMaintenanceRecoverySourceFn || readMaintenanceRecoverySourceV1;
    if (sourceReader() !== command.expectedHead) return fail('RECOVERY_MAILBOX_CANONICAL_HEAD_CHANGED');
    const { runMaintenanceCustodyRecoveryV1 } = await import('../../scripts/sovereign-maintenance-custody-recovery.mjs');
    const runner = options.runMaintenanceCustodyRecoveryFn || runMaintenanceCustodyRecoveryV1;
    const result = await runner({
      mode: command.operation === MAINTENANCE_RECOVERY_OPERATIONS[0] ? 'status' : 'prepare',
      expectedMain: command.expectedHead, expectedCycle: command.expectedCycle,
      expectedReportSha256: command.expectedReportSha256, operatorApproval: command.operatorApproval,
    });
    // Public mailbox gets only typed status and exact opaque bindings, never
    // the machine witness, signing key, full custody record or report contents.
    const status = result?.persistentCustody;
    const preparing = command.operation === MAINTENANCE_RECOVERY_OPERATIONS[1];
    const proven = result?.ok === true && (!preparing || (result.prepared === true
      && status?.held === true && hash.test(status?.digest ?? '')
      && status?.reservationId === command.expectedCycle));
    return Object.freeze({ ok: proven,
      verdict: proven ? 'COMMAND_EXECUTION_COMPLETE' : 'COMMAND_EXECUTION_BLOCKED',
      operation: command.operation, requestId: command.requestId, expectedHead: command.expectedHead,
      ...(proven ? (status?.held === true && Object.hasOwn(status, 'blocker')
        ? { diagnostic: blockerDiagnostic(status.blocker) } : {})
        : { blocker: 'RECOVERY_MAILBOX_RECOVERY_UNPROVEN', diagnostic: blockerDiagnostic(result?.blocker) }),
      originalHoldMatched: result?.originalHoldMatched === true,
      prepared: preparing && proven, held: status?.held === true,
      digest: hash.test(status?.digest ?? '') ? status.digest : '',
      cycleId: uuid.test(result?.cycleId ?? '') ? result.cycleId : '',
      reportSha256: hash.test(result?.reportSha256 ?? '') ? result.reportSha256 : '',
      custodyReleased: false, pcRestartAllowed: false, sourceLeaseReleased: false,
      arbitraryShellAllowed: false, mergeAuthority: false,
    });
  } catch (error) {
    return Object.freeze({ ...fail('RECOVERY_MAILBOX_RECOVERY_UNPROVEN'), diagnostic: caughtDiagnostic(error) });
  }
}
