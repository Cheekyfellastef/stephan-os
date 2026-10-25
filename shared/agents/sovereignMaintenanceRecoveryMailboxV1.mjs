// Fixed adapter to the existing maintenance recovery owner, never a shell route.
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
      ...(proven ? {} : { blocker: 'RECOVERY_MAILBOX_RECOVERY_UNPROVEN' }),
      originalHoldMatched: result?.originalHoldMatched === true,
      prepared: preparing && proven, held: status?.held === true,
      digest: hash.test(status?.digest ?? '') ? status.digest : '',
      cycleId: uuid.test(result?.cycleId ?? '') ? result.cycleId : '',
      reportSha256: hash.test(result?.reportSha256 ?? '') ? result.reportSha256 : '',
      custodyReleased: false, pcRestartAllowed: false, sourceLeaseReleased: false,
      arbitraryShellAllowed: false, mergeAuthority: false,
    });
  } catch { return fail('RECOVERY_MAILBOX_RECOVERY_UNPROVEN'); }
}
