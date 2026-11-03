import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_EXECUTION_COMMAND_TELEMETRY_SCHEMA = 'stephanos.execution-command-telemetry.v1';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safeId(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}

function frozen(value) {
  return Object.freeze(value);
}

export function createStephanosExecutionCommandWorkspaceRecordsV1(envelope = {}, result = {}, options = {}) {
  const timestampUtc = text(options.timestampUtc, new Date().toISOString());
  const commandId = safeId(envelope.commandId);
  if (!commandId) {
    return frozen({ ok: false, reason: 'execution-command-id-invalid', records: null });
  }
  const relatedIssue = text(options.relatedIssue, envelope.relatedIssue);
  const relatedPr = text(options.relatedPr, envelope.relatedPr);
  if (!relatedIssue && !relatedPr) {
    return frozen({ ok: false, reason: 'execution-command-correlation-required', records: null });
  }
  const recordId = 'execution-command-' + commandId;
  const proofRef = 'proof/' + recordId + '.json';
  const completed = result.ok === true;
  const failed = result.ok === false;
  const statusValue = completed ? 'COMPLETED' : failed ? 'FAILED' : 'DISPATCHED';
  const summary = completed
    ? envelope.surface + ' completed ' + envelope.operation + ' for ' + envelope.missionId + '.'
    : failed
      ? envelope.surface + ' failed ' + envelope.operation + ' for ' + envelope.missionId + ': ' + text(result.blocker, result.finalVerdict || 'unknown failure') + '.'
      : envelope.surface + ' accepted ' + envelope.operation + ' for ' + envelope.missionId + '.';
  const status = frozen({
    ...createSharedWorkspaceStatusRecord({
      statusId: recordId,
      participantId: 'stephanos',
      timestampUtc,
      relatedIssue,
      relatedPr,
      status: statusValue,
      summary,
      proofRefs: [proofRef],
    }),
    commandId: envelope.commandId,
    missionId: envelope.missionId,
    surface: envelope.surface,
    adapter: envelope.adapter,
    operation: envelope.operation,
    executionVerdict: text(result.finalVerdict, envelope.finalVerdict),
    mergeAuthority: false,
    pcRestartAuthority: false,
    arbitraryUnboundedCommandAllowed: false,
  });
  const proof = frozen({
    ...createSharedWorkspaceProofRecord({
      proofId: recordId,
      participantId: 'stephanos',
      timestampUtc,
      correlationId: commandId,
      relatedIssue,
      relatedPr,
      status: completed ? 'PASS' : failed ? 'FAIL' : 'PENDING',
      summary,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    commandId: envelope.commandId,
    missionId: envelope.missionId,
    surface: envelope.surface,
    adapter: envelope.adapter,
    operation: envelope.operation,
    proofHash: text(result.proofHash),
    executionVerdict: text(result.finalVerdict, envelope.finalVerdict),
    receiptRequired: true,
  });
  const receipt = frozen({
    ...createSharedWorkspaceReceiptRecord({
      receiptId: recordId,
      participantId: text(envelope.adapter, 'stephanos'),
      timestampUtc,
      correlationId: commandId,
      relatedIssue,
      relatedPr,
      proofRefs: [proofRef],
      receivedRecordId: commandId,
      disposition: completed ? 'completed' : failed ? 'failed' : 'dispatched',
      summary,
    }),
    commandId: envelope.commandId,
    missionId: envelope.missionId,
    surface: envelope.surface,
    operation: envelope.operation,
    executionVerdict: text(result.finalVerdict, envelope.finalVerdict),
  });
  return frozen({ ok: true, reason: 'EXECUTION_COMMAND_WORKSPACE_RECORDS_READY', recordId, proofRef, records: frozen({ status, proof, receipt }) });
}
export async function publishStephanosExecutionCommandWorkspaceRecordsV1(root, envelope = {}, result = {}, options = {}) {
  const prepared = createStephanosExecutionCommandWorkspaceRecordsV1(envelope, result, options);
  if (!prepared.ok) return prepared;
  const writeOptions = {
    repoRoot: options.repoRoot,
    nowMs: Date.parse(options.timestampUtc || prepared.records.status.timestampUtc),
  };
  const writes = await Promise.all([
    writeAtomicJson(root, ['status', prepared.recordId + '.json'], prepared.records.status, writeOptions),
    writeAtomicJson(root, ['proof', prepared.recordId + '.json'], prepared.records.proof, writeOptions),
    writeAtomicJson(root, ['receipts', prepared.recordId + '.json'], prepared.records.receipt, writeOptions),
  ]);
  const failed = writes.find((write) => write.ok !== true);
  return frozen({
    ok: !failed,
    reason: failed ? failed.reason : 'EXECUTION_COMMAND_WORKSPACE_RECORDS_PUBLISHED',
    recordId: prepared.recordId,
    proofRef: prepared.proofRef,
    records: prepared.records,
    writes: frozen(writes),
  });
}
