import { createHash } from 'node:crypto';
import {
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
} from './codexDispatchQueue.mjs';
import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';
import {
  createAgentCapabilityRecord,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
} from './sharedAgentWorkspaceStore.mjs';
import { buildBattleBridgeSupervisorContract } from './battleBridgeSupervisor.mjs';
import { runVerificationHarness } from './verificationHarness.mjs';

export const AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION = 'automated-codex-dispatcher.v1';
export const BLOCKED_BY_MISSING_INTEGRATION = 'BLOCKED_BY_MISSING_INTEGRATION';

export const CODEX_DISPATCHER_STATE = Object.freeze({
  IDLE: 'IDLE',
  SCANNING: 'SCANNING',
  READY: 'READY',
  WAITING_FOR_OPERATOR: 'WAITING_FOR_OPERATOR',
  DISPATCHING: 'DISPATCHING',
  WAITING_FOR_RESULT: 'WAITING_FOR_RESULT',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  BLOCKED_BY_MISSING_INTEGRATION,
});

export const CODEX_DISPATCH_CAPABILITY = Object.freeze({
  MANUAL_ONLY: 'MANUAL_ONLY',
  AUTOMATED_SUPPORTED: 'AUTOMATED_SUPPORTED',
  AUTOMATED_UNAVAILABLE: 'AUTOMATED_UNAVAILABLE',
});

export const CODEX_DISPATCH_DECISION = Object.freeze({
  DISPATCHED: 'DISPATCHED',
  MANUAL_PACKET_READY: 'MANUAL_PACKET_READY',
  WAITING_FOR_QUEUE: 'WAITING_FOR_QUEUE',
  BLOCKED_BY_INVALID_QUEUE_ITEM: 'BLOCKED_BY_INVALID_QUEUE_ITEM',
  BLOCKED_BY_OPERATOR_APPROVAL: 'BLOCKED_BY_OPERATOR_APPROVAL',
  BLOCKED_BY_QUEUE_NOT_READY: 'BLOCKED_BY_QUEUE_NOT_READY',
  BLOCKED_BY_MISSING_INTEGRATION,
});

export const CODEX_DISPATCHER_GUARDRAILS = Object.freeze({
  arbitraryShellAllowed: false,
  uncontrolledMutationAllowed: false,
  dirtyMainWritesAllowed: false,
  mergeAllowed: false,
  branchDeletionAllowed: false,
  hardResetAllowed: false,
  approvalSpoofingAllowed: false,
  approvalBypassAllowed: false,
  fakeDispatchAllowed: false,
  browserAutomationAllowed: false,
  sourceRepositoryWritesAllowed: false,
  sharedWorkspaceWritesAllowed: true,
});

const REQUIRED_AUTOMATED_CAPABILITIES = Object.freeze(['launchCodexJob', 'returnDispatchReceipt', 'returnProofMetadata']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function dispatchable(records = []) {
  return records.find((record) => record?.status === CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH) || null;
}

function eventKindFor(status) {
  return {
    [CODEX_QUEUE_STATUS.DISPATCHED]: 'codex-job-dispatched',
    [CODEX_QUEUE_STATUS.RUNNING]: 'codex-job-running',
    [CODEX_QUEUE_STATUS.WAITING_PROOF]: 'codex-job-proof',
    [CODEX_QUEUE_STATUS.BLOCKED]: 'codex-job-blocked',
    [CODEX_QUEUE_STATUS.SUCCEEDED]: 'codex-job-complete',
    [CODEX_QUEUE_STATUS.FAILED]: 'codex-job-blocked',
  }[status] || 'codex-job-ready';
}

function missingCapabilities(integration = {}) {
  const caps = integration.capabilities || {};
  return REQUIRED_AUTOMATED_CAPABILITIES.filter((name) => caps[name] !== true);
}

function stableReceiptHash(receipt) {
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
}

export function buildAutomatedCodexDispatcherContract() {
  return Object.freeze({
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    contractKind: 'stephanos.automated_codex_dispatcher.contract',
    states: Object.values(CODEX_DISPATCHER_STATE),
    capabilityModes: Object.values(CODEX_DISPATCH_CAPABILITY),
    decisions: Object.values(CODEX_DISPATCH_DECISION),
    consumes: buildCodexDispatchQueueContract().contractKind,
    reuses: {
      sharedAgentWorkspace: 'stephanos.shared_workspace.contract',
      verificationHarness: 'stephanos.verification.contract',
      battleBridgeSupervisor: buildBattleBridgeSupervisorContract().contractKind,
      codexDispatchQueue: buildCodexDispatchQueueContract().contractKind,
    },
    requiredMessages: [
      'codex-job-ready',
      'codex-job-dispatched',
      'codex-job-running',
      'codex-job-proof',
      'codex-job-blocked',
      'codex-job-complete',
      'codex-waiting-operator',
    ],
    dashboardFields: ['queueDepth', 'currentJob', 'dispatcherState', 'capabilityMode', 'lastDispatchReceipt', 'lastProof', 'lastBlocker', 'operatorActionRequired'],
    guardrails: { ...CODEX_DISPATCHER_GUARDRAILS },
    finalVerdict: 'AUTOMATED_CODEX_DISPATCHER_CONTRACT_READY',
  });
}

export function assessCodexIntegration(integration = {}) {
  const manualAvailable = integration.manualDispatch === true || integration.mode === CODEX_DISPATCH_CAPABILITY.MANUAL_ONLY;
  const missing = missingCapabilities(integration);
  const automated = missing.length === 0 && typeof integration.dispatch === 'function';
  const mode = automated ? CODEX_DISPATCH_CAPABILITY.AUTOMATED_SUPPORTED : (manualAvailable ? CODEX_DISPATCH_CAPABILITY.MANUAL_ONLY : CODEX_DISPATCH_CAPABILITY.AUTOMATED_UNAVAILABLE);
  return Object.freeze({
    supported: automated,
    mode,
    missingCapabilities: automated ? [] : missing,
    manualAvailable,
    exactReason: automated ? '' : (manualAvailable ? 'Manual dispatch available; automated Codex launch integration is not proven.' : `Missing automated Codex integration capability: ${missing.join(', ') || 'dispatch function'}.`),
    finalVerdict: automated ? 'CODEX_AUTO_DISPATCH_INTEGRATION_SUPPORTED' : (manualAvailable ? 'CODEX_MANUAL_DISPATCH_ONLY' : BLOCKED_BY_MISSING_INTEGRATION),
  });
}

export function createDispatchPacket(record, input = {}) {
  return Object.freeze({
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.automated_codex_dispatcher.dispatch_packet',
    packetId: `dispatch-packet-${record.jobId}`,
    jobId: record.jobId,
    issueNumber: record.issueNumber,
    branch: record.branch,
    prompt: record.prompt,
    requestedProofCommands: [...record.requestedProofCommands],
    approvalRequirements: { ...record.approvalRequirements },
    queueRecordRef: record.jobId,
    sharedWorkspaceOnly: true,
    mergeAuthority: false,
    operatorInstruction: input.operatorInstruction || 'Paste this packet into a supported Codex surface. Return a structured dispatch receipt before the dispatcher may claim work started.',
    finalVerdict: 'CODEX_DISPATCH_PACKET_READY',
  });
}

export function createDispatchReceipt(input = {}) {
  const receipt = {
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.automated_codex_dispatcher.dispatch_receipt',
    receiptId: text(input.receiptId, `dispatch-receipt-${text(input.jobId, 'pending')}`),
    jobId: text(input.jobId, 'pending'),
    mode: Object.values(CODEX_DISPATCH_CAPABILITY).includes(input.mode) ? input.mode : CODEX_DISPATCH_CAPABILITY.MANUAL_ONLY,
    accepted: input.accepted === true,
    started: input.started === true,
    timestampUtc: text(input.timestampUtc, 'pending'),
    integrationId: text(input.integrationId, 'manual-operator'),
    proofRefs: Array.isArray(input.proofRefs) ? input.proofRefs.map(String) : [],
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : 0,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
  };
  return Object.freeze({ ...receipt, commandOutputHash: text(input.commandOutputHash, stableReceiptHash(receipt)), finalVerdict: receipt.accepted ? 'CODEX_DISPATCH_RECEIPT_ACCEPTED' : 'CODEX_DISPATCH_RECEIPT_RECORDED' });
}

export function createCodexWorkspaceMessage(record, status, input = {}) {
  const waitingOperator = input.dispatcherState === CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR;
  return createSharedWorkspaceMessage({
    messageId: `${record.jobId}-${text(input.messageSuffix, status)}`,
    sender: 'codex',
    recipient: 'operator',
    channel: 'automated-codex-dispatcher',
    kind: waitingOperator ? 'codex-waiting-operator' : eventKindFor(status),
    severity: status === CODEX_QUEUE_STATUS.BLOCKED || status === CODEX_QUEUE_STATUS.FAILED ? 'warning' : 'info',
    correlationId: `issue-${record.issueNumber}`,
    relatedGoal: `#${record.issueNumber}`,
    summary: input.summary || `Codex job ${record.jobId} moved to ${status}.`,
    status: input.dispatcherState || status,
    proofRefs: input.proofRefs || [`proof/${record.jobId}.json`],
    requiresOperator: waitingOperator || status === CODEX_QUEUE_STATUS.BLOCKED,
  });
}

export function createDispatcherWorkspacePublication(input = {}) {
  const record = input.record || input.queueRecord || {};
  const validation = validateCodexQueueRecord(record);
  if (!validation.valid) return Object.freeze({ valid: false, validation, statusRecord: null, eventRecord: null });
  const state = input.dispatcherState || CODEX_DISPATCHER_STATE.IDLE;
  const timestampUtc = text(input.timestampUtc || input.now, 'pending');
  return Object.freeze({
    valid: true,
    statusRecord: createSharedWorkspaceStatusRecord({
      statusId: `codex-dispatcher-${record.jobId}`,
      timestampUtc,
      status: state,
      summary: input.summary || `Automated Codex Dispatcher ${state} for ${record.jobId}`,
      proofRefs: input.proofRefs || record.proofRequirements.refs,
    }),
    eventRecord: createSharedWorkspaceEventRecord({
      eventId: `codex-dispatcher-${record.jobId}-${state.toLowerCase().replaceAll('_', '-')}`,
      timestampUtc,
      eventKind: state === CODEX_DISPATCHER_STATE.BLOCKED_BY_MISSING_INTEGRATION ? 'blocked-reason' : 'codex-dispatch-attempted',
      summary: input.summary || state,
    }),
  });
}

export function verifyDispatchReceipt(input = {}) {
  const receipt = createDispatchReceipt(input.receipt || input);
  return runVerificationHarness({
    aggregateId: `codex-dispatch-${receipt.jobId}`,
    timestampUtc: receipt.timestampUtc,
    verifiers: ['CommandReceiptVerifier', 'ProofReferenceVerifier'],
    packets: {
      CommandReceiptVerifier: receipt,
      ProofReferenceVerifier: { proofRefs: receipt.proofRefs.length ? receipt.proofRefs : [`receipts/${receipt.receiptId}.json`] },
    },
  });
}

export function createDispatcherDashboard(input = {}) {
  const records = (input.queueRecords || []).filter((record) => validateCodexQueueRecord(record).valid);
  const active = records.find((record) => [CODEX_QUEUE_STATUS.DISPATCHED, CODEX_QUEUE_STATUS.RUNNING, CODEX_QUEUE_STATUS.WAITING_PROOF].includes(record.status)) || null;
  const lastProof = records.map((record) => record.resultMetadata?.proofMetadata || record.resultMetadata).filter((meta) => meta && Object.keys(meta).length).at(-1) || null;
  const lastBlocker = records.map((record) => record.blockerMetadata).filter((meta) => meta && Object.keys(meta).length).at(-1) || null;
  const lastDispatchReceipt = records.map((record) => record.resultMetadata?.dispatchReceipt).filter(Boolean).at(-1) || null;
  return Object.freeze({
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.automated_codex_dispatcher.dashboard',
    queueDepth: records.filter((record) => record.status === CODEX_QUEUE_STATUS.QUEUED).length,
    currentJob: active ? active.jobId : '',
    dispatcherState: input.dispatcherState || (active ? CODEX_DISPATCHER_STATE.WAITING_FOR_RESULT : CODEX_DISPATCHER_STATE.IDLE),
    capabilityMode: input.capabilityMode || CODEX_DISPATCH_CAPABILITY.AUTOMATED_UNAVAILABLE,
    lastDispatchReceipt,
    lastProof,
    lastBlocker,
    operatorActionRequired: input.operatorActionRequired === true || input.dispatcherState === CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR,
    finalVerdict: 'CODEX_DISPATCHER_DASHBOARD_READY',
  });
}

function invalidTransitionResult(record, transition) {
  return Object.freeze({
    dispatcherState: CODEX_DISPATCHER_STATE.FAILED,
    decision: CODEX_DISPATCH_DECISION.BLOCKED_BY_INVALID_QUEUE_ITEM,
    record,
    errors: transition.errors || [transition.error],
    finalVerdict: 'CODEX_DISPATCHER_BLOCKED',
  });
}

export function dispatchQueuedCodexJob(input = {}) {
  const record = input.queueRecord || dispatchable(input.queueRecords || []);
  if (!record) return Object.freeze({ dispatcherState: CODEX_DISPATCHER_STATE.IDLE, decision: CODEX_DISPATCH_DECISION.WAITING_FOR_QUEUE, finalVerdict: 'CODEX_DISPATCHER_WAITING' });
  const validation = validateCodexQueueRecord(record);
  if (!validation.valid) return Object.freeze({ dispatcherState: CODEX_DISPATCHER_STATE.FAILED, decision: CODEX_DISPATCH_DECISION.BLOCKED_BY_INVALID_QUEUE_ITEM, record, errors: validation.errors, finalVerdict: 'CODEX_DISPATCHER_BLOCKED' });

  const capability = assessCodexIntegration(input.integration || {});
  if (!capability.supported && capability.mode !== CODEX_DISPATCH_CAPABILITY.MANUAL_ONLY) {
    const transition = transitionCodexQueueRecord(record, CODEX_QUEUE_STATUS.BLOCKED, {
      timestamp: input.now || 'pending',
      reason: BLOCKED_BY_MISSING_INTEGRATION,
      blockerMetadata: { code: BLOCKED_BY_MISSING_INTEGRATION, reason: capability.exactReason, missingCapabilities: capability.missingCapabilities },
    });
    if (!transition.valid) return invalidTransitionResult(record, transition);
    const blocked = transition.record;
    return Object.freeze({
      dispatcherState: CODEX_DISPATCHER_STATE.BLOCKED_BY_MISSING_INTEGRATION,
      decision: CODEX_DISPATCH_DECISION.BLOCKED_BY_MISSING_INTEGRATION,
      capability,
      record: blocked,
      dispatchPacket: createDispatchPacket(record, input),
      missingCapabilities: capability.missingCapabilities,
      blockerMetadata: blocked.blockerMetadata,
      sharedWorkspaceMessage: createCodexWorkspaceMessage(blocked, CODEX_QUEUE_STATUS.BLOCKED, { summary: `${BLOCKED_BY_MISSING_INTEGRATION}: ${capability.exactReason}` }),
      workspacePublication: createDispatcherWorkspacePublication({ record: blocked, dispatcherState: CODEX_DISPATCHER_STATE.BLOCKED_BY_MISSING_INTEGRATION, timestampUtc: input.now, summary: capability.exactReason }),
      finalVerdict: BLOCKED_BY_MISSING_INTEGRATION,
    });
  }

  const approvalMissing = !record.approvalRequirements.approvalReceipt;
  if (record.status !== CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH || approvalMissing) {
    return Object.freeze({
      dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR,
      decision: approvalMissing ? CODEX_DISPATCH_DECISION.BLOCKED_BY_OPERATOR_APPROVAL : CODEX_DISPATCH_DECISION.BLOCKED_BY_QUEUE_NOT_READY,
      record,
      requiredStatus: CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH,
      finalVerdict: 'CODEX_DISPATCHER_BLOCKED',
    });
  }

  const dispatchPacket = createDispatchPacket(record, input);
  if (capability.mode === CODEX_DISPATCH_CAPABILITY.MANUAL_ONLY) {
    return Object.freeze({
      dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR,
      decision: CODEX_DISPATCH_DECISION.MANUAL_PACKET_READY,
      capability,
      record,
      dispatchPacket,
      sharedWorkspaceMessage: createCodexWorkspaceMessage(record, record.status, { dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR, summary: capability.exactReason }),
      workspacePublication: createDispatcherWorkspacePublication({ record, dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_OPERATOR, timestampUtc: input.now, summary: capability.exactReason }),
      finalVerdict: 'CODEX_MANUAL_DISPATCH_PACKET_READY',
    });
  }

  const receipt = createDispatchReceipt({ ...(input.integration.dispatch(dispatchPacket) || {}), jobId: record.jobId, mode: CODEX_DISPATCH_CAPABILITY.AUTOMATED_SUPPORTED, timestampUtc: input.now || 'pending', integrationId: input.integration.integrationId || 'codex-automated-integration' });
  if (!receipt.accepted) throw new Error('dispatcher invariant violated: supported integration must return an accepted dispatch receipt; fake dispatch is forbidden');
  const verification = verifyDispatchReceipt({ receipt });
  const transition = transitionCodexQueueRecord(record, CODEX_QUEUE_STATUS.DISPATCHED_MANUAL, {
    timestamp: input.now || 'pending',
    reason: 'dispatch receipt recorded',
    resultMetadata: { dispatchReceipt: receipt, proofMetadata: verification },
  });
  if (!transition.valid) return invalidTransitionResult(record, transition);
  const dispatched = transition.record;
  return Object.freeze({
    dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_RESULT,
    decision: CODEX_DISPATCH_DECISION.DISPATCHED,
    capability,
    record: dispatched,
    dispatchPacket,
    dispatchReceipt: receipt,
    proofMetadata: verification,
    capabilityRecord: createAgentCapabilityRecord({ agentId: 'codex', mode: 'automated_dispatch_supported', boundedWritePath: 'shared-workspace', timestampUtc: input.now || 'pending', proofRefs: receipt.proofRefs }),
    sharedWorkspaceMessage: createCodexWorkspaceMessage(dispatched, CODEX_QUEUE_STATUS.DISPATCHED),
    workspacePublication: createDispatcherWorkspacePublication({ record: dispatched, dispatcherState: CODEX_DISPATCHER_STATE.WAITING_FOR_RESULT, timestampUtc: input.now, summary: 'Automated dispatch receipt recorded; waiting for Codex result.', proofRefs: receipt.proofRefs }),
    finalVerdict: 'CODEX_JOB_DISPATCHED',
  });
}

export const createCodexDispatchDecision = dispatchQueuedCodexJob;
export const createCodexDispatcherResult = dispatchQueuedCodexJob;
