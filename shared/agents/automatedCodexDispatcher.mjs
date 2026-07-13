import {
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  createCodexQueueRecord,
  transitionCodexQueueRecord,
  validateCodexQueueRecord,
} from './codexDispatchQueue.mjs';
import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

export const AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION = 'automated-codex-dispatcher.v1';
export const BLOCKED_BY_MISSING_INTEGRATION = 'BLOCKED_BY_MISSING_INTEGRATION';

export const CODEX_DISPATCH_DECISION = Object.freeze({
  DISPATCHED: 'DISPATCHED',
  WAITING_FOR_QUEUE: 'WAITING_FOR_QUEUE',
  BLOCKED_BY_INVALID_QUEUE_ITEM: 'BLOCKED_BY_INVALID_QUEUE_ITEM',
  BLOCKED_BY_OPERATOR_APPROVAL: 'BLOCKED_BY_OPERATOR_APPROVAL',
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
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function queued(records = []) {
  return records.map(createCodexQueueRecord).find((record) => record.status === CODEX_QUEUE_STATUS.QUEUED) || null;
}

function eventKindFor(status) {
  return {
    [CODEX_QUEUE_STATUS.DISPATCHED]: 'codex-job-dispatched',
    [CODEX_QUEUE_STATUS.RUNNING]: 'codex-job-running',
    [CODEX_QUEUE_STATUS.WAITING_PROOF]: 'codex-job-proof',
    [CODEX_QUEUE_STATUS.BLOCKED]: 'codex-job-blocked',
    [CODEX_QUEUE_STATUS.SUCCEEDED]: 'codex-job-complete',
    [CODEX_QUEUE_STATUS.FAILED]: 'codex-job-blocked',
  }[status] || 'codex-job-created';
}

function missingCapabilities(integration = {}) {
  const caps = integration.capabilities || {};
  return [
    ['launchCodexJob', caps.launchCodexJob === true],
    ['returnDispatchReceipt', caps.returnDispatchReceipt === true],
    ['returnProofMetadata', caps.returnProofMetadata === true],
  ].filter(([, ok]) => !ok).map(([name]) => name);
}

export function buildAutomatedCodexDispatcherContract() {
  return Object.freeze({
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    contractKind: 'stephanos.automated_codex_dispatcher.contract',
    decisions: Object.values(CODEX_DISPATCH_DECISION),
    consumes: buildCodexDispatchQueueContract().contractKind,
    requiredMessages: [
      'codex-job-created',
      'codex-job-dispatched',
      'codex-job-running',
      'codex-job-proof',
      'codex-job-blocked',
      'codex-job-complete',
    ],
    dashboardFields: ['queueDepth', 'currentJob', 'lastProof', 'lastBlocker'],
    guardrails: { ...CODEX_DISPATCHER_GUARDRAILS },
    finalVerdict: 'AUTOMATED_CODEX_DISPATCHER_CONTRACT_READY',
  });
}

export function assessCodexIntegration(integration = {}) {
  const missing = missingCapabilities(integration);
  return Object.freeze({
    supported: missing.length === 0,
    missingCapabilities: missing,
    finalVerdict: missing.length === 0 ? 'CODEX_AUTO_DISPATCH_INTEGRATION_SUPPORTED' : BLOCKED_BY_MISSING_INTEGRATION,
  });
}

export function createCodexWorkspaceMessage(record, status, input = {}) {
  return createSharedWorkspaceMessage({
    messageId: `${record.jobId}-${status}`,
    sender: 'codex',
    recipient: 'operator',
    channel: 'automated-codex-dispatcher',
    kind: eventKindFor(status),
    severity: status === CODEX_QUEUE_STATUS.BLOCKED || status === CODEX_QUEUE_STATUS.FAILED ? 'warning' : 'info',
    correlationId: `issue-${record.issueNumber}`,
    relatedGoal: `#${record.issueNumber}`,
    summary: input.summary || `Codex job ${record.jobId} moved to ${status}.`,
    status,
    proofRefs: input.proofRefs || [`proof/${record.jobId}.json`],
    requiresOperator: status === CODEX_QUEUE_STATUS.BLOCKED,
  });
}

export function createDispatcherDashboard(input = {}) {
  const records = (input.queueRecords || []).map(createCodexQueueRecord);
  const active = records.find((record) => [CODEX_QUEUE_STATUS.DISPATCHED, CODEX_QUEUE_STATUS.RUNNING, CODEX_QUEUE_STATUS.WAITING_PROOF].includes(record.status)) || null;
  const lastProof = records.map((record) => record.resultMetadata).filter((meta) => meta && Object.keys(meta).length).at(-1) || null;
  const lastBlocker = records.map((record) => record.blockerMetadata).filter((meta) => meta && Object.keys(meta).length).at(-1) || null;
  return Object.freeze({
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.automated_codex_dispatcher.dashboard',
    queueDepth: records.filter((record) => record.status === CODEX_QUEUE_STATUS.QUEUED).length,
    currentJob: active ? active.jobId : '',
    lastProof,
    lastBlocker,
    finalVerdict: 'CODEX_DISPATCHER_DASHBOARD_READY',
  });
}

export function dispatchQueuedCodexJob(input = {}) {
  const record = input.queueRecord ? createCodexQueueRecord(input.queueRecord) : queued(input.queueRecords || []);
  if (!record) {
    return Object.freeze({ decision: CODEX_DISPATCH_DECISION.WAITING_FOR_QUEUE, finalVerdict: 'CODEX_DISPATCHER_WAITING' });
  }
  const validation = validateCodexQueueRecord(record);
  if (!validation.valid) {
    return Object.freeze({ decision: CODEX_DISPATCH_DECISION.BLOCKED_BY_INVALID_QUEUE_ITEM, record, errors: validation.errors, finalVerdict: 'CODEX_DISPATCHER_BLOCKED' });
  }
  if (record.approvalRequirements.requiresOperatorApprovalBeforeDispatch && !record.approvalRequirements.approvalReceipt) {
    return Object.freeze({ decision: CODEX_DISPATCH_DECISION.BLOCKED_BY_OPERATOR_APPROVAL, record, finalVerdict: 'CODEX_DISPATCHER_BLOCKED' });
  }
  const integration = assessCodexIntegration(input.integration || {});
  if (!integration.supported) {
    const blocked = transitionCodexQueueRecord(record, CODEX_QUEUE_STATUS.BLOCKED, {
      timestamp: input.now || 'pending',
      reason: BLOCKED_BY_MISSING_INTEGRATION,
      blockerMetadata: {
        code: BLOCKED_BY_MISSING_INTEGRATION,
        missingCapabilities: integration.missingCapabilities,
      },
    }).record;
    return Object.freeze({
      decision: CODEX_DISPATCH_DECISION.BLOCKED_BY_MISSING_INTEGRATION,
      record: blocked,
      missingCapabilities: integration.missingCapabilities,
      blockerMetadata: blocked.blockerMetadata,
      sharedWorkspaceMessage: createCodexWorkspaceMessage(blocked, CODEX_QUEUE_STATUS.BLOCKED, { summary: `${BLOCKED_BY_MISSING_INTEGRATION}: ${integration.missingCapabilities.join(', ')}` }),
      finalVerdict: BLOCKED_BY_MISSING_INTEGRATION,
    });
  }
  const receipt = input.integration.dispatch?.(record) || input.dispatchReceipt || null;
  if (!receipt) {
    throw new Error('dispatcher invariant violated: supported integration must return a dispatch receipt; fake dispatch is forbidden');
  }
  const dispatched = createCodexQueueRecord({
    ...record,
    status: CODEX_QUEUE_STATUS.DISPATCHED,
    dispatchedAt: input.now || 'pending',
    resultMetadata: { dispatchReceipt: receipt, proofMetadata: input.proofMetadata || null },
  });
  return Object.freeze({
    decision: CODEX_DISPATCH_DECISION.DISPATCHED,
    record: dispatched,
    dispatchReceipt: receipt,
    proofMetadata: input.proofMetadata || null,
    sharedWorkspaceMessage: createCodexWorkspaceMessage(dispatched, CODEX_QUEUE_STATUS.DISPATCHED),
    finalVerdict: 'CODEX_JOB_DISPATCHED',
  });
}

export const createCodexDispatchDecision = dispatchQueuedCodexJob;
export const createCodexDispatcherResult = dispatchQueuedCodexJob;
