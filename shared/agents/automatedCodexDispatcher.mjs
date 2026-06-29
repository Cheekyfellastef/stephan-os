import {
  CODEX_QUEUE_STATUS,
  createCodexDispatchClaim,
  createCodexDispatchResult,
  createCodexQueueItem,
  validateCodexQueueItem,
} from './codexDispatchQueue.mjs';
import { createSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

export const AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION = 'automated-codex-dispatcher.v1';

export const CODEX_DISPATCH_DECISION = Object.freeze({
  DISPATCH_READY_ITEM: 'DISPATCH_READY_ITEM',
  WAIT_FOR_READY_ITEM: 'WAIT_FOR_READY_ITEM',
  BLOCKED_BY_METER: 'BLOCKED_BY_METER',
  BLOCKED_BY_INVALID_QUEUE_ITEM: 'BLOCKED_BY_INVALID_QUEUE_ITEM',
  BLOCKED_BY_OPERATOR_APPROVAL: 'BLOCKED_BY_OPERATOR_APPROVAL',
  WAITING_FOR_RESULT: 'WAITING_FOR_RESULT',
  COMPLETE: 'COMPLETE',
});

export const CODEX_DISPATCHER_GUARDRAILS = Object.freeze({
  zeroCostDefault: true,
  dispatchWhenMeterUnavailableAllowed: false,
  dispatchInvalidQueueItemAllowed: false,
  mergeWithoutOperatorApprovalAllowed: false,
  arbitraryPromptMutationAllowed: false,
  visibleClipboardCourierRequired: false,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/#() -]{0,240}$/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text || FORBIDDEN_TEXT_PATTERN.test(text)) return fallback;
  return SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function safeId(value, fallback) {
  const text = asText(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function latestReadyItem(items = []) {
  return items.map(createCodexQueueItem).find((item) => item.status === CODEX_QUEUE_STATUS.READY) || null;
}

export function buildAutomatedCodexDispatcherContract() {
  return {
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    contractKind: 'stephanos.automated_codex_dispatcher.contract',
    decisions: Object.values(CODEX_DISPATCH_DECISION),
    requiredDecisionFields: [
      'schemaVersion',
      'kind',
      'decisionId',
      'decision',
      'queueItemId',
      'summary',
      'requiresOperator',
      'exactUnblockAction',
      'sharedWorkspaceMessage',
    ],
    guardrails: { ...CODEX_DISPATCHER_GUARDRAILS },
    finalVerdict: 'AUTOMATED_CODEX_DISPATCHER_CONTRACT_READY',
  };
}

export function createCodexDispatchDecision(input = {}) {
  const queueItem = input.queueItem ? createCodexQueueItem(input.queueItem) : latestReadyItem(input.queueItems || []);
  const queueValidation = queueItem ? validateCodexQueueItem(queueItem) : { valid: false, errors: ['missing-queue-item'] };
  const meterAvailable = input.codexMeterAvailable !== false;
  const operatorApproved = input.operatorApproved === true;
  const activeDispatch = input.activeDispatch === true;
  const completed = input.completed === true;
  let decision = CODEX_DISPATCH_DECISION.WAIT_FOR_READY_ITEM;
  let exactUnblockAction = '';
  let requiresOperator = false;

  if (completed) {
    decision = CODEX_DISPATCH_DECISION.COMPLETE;
  } else if (activeDispatch) {
    decision = CODEX_DISPATCH_DECISION.WAITING_FOR_RESULT;
  } else if (!queueItem) {
    decision = CODEX_DISPATCH_DECISION.WAIT_FOR_READY_ITEM;
    exactUnblockAction = 'Create a READY Codex queue item with allowed files, required tests, and required evidence.';
  } else if (!queueValidation.valid) {
    decision = CODEX_DISPATCH_DECISION.BLOCKED_BY_INVALID_QUEUE_ITEM;
    exactUnblockAction = `Repair Codex queue item ${queueItem.queueItemId}: ${queueValidation.errors.join(', ')}`;
    requiresOperator = true;
  } else if (!meterAvailable) {
    decision = CODEX_DISPATCH_DECISION.BLOCKED_BY_METER;
    exactUnblockAction = 'Codex meter is unavailable. Keep item queued and do not dispatch until zero-cost/approved capacity is available.';
    requiresOperator = true;
  } else if (!operatorApproved && input.requireOperatorApprovalBeforeDispatch === true) {
    decision = CODEX_DISPATCH_DECISION.BLOCKED_BY_OPERATOR_APPROVAL;
    exactUnblockAction = `Operator must approve dispatch for ${queueItem.queueItemId}.`;
    requiresOperator = true;
  } else {
    decision = CODEX_DISPATCH_DECISION.DISPATCH_READY_ITEM;
  }

  const queueItemId = queueItem?.queueItemId || '';
  const decisionId = safeId(input.decisionId, queueItemId ? `dispatch-${queueItemId}` : 'dispatch-waiting-for-queue-item');
  const summary = safeText(input.summary, decision === CODEX_DISPATCH_DECISION.DISPATCH_READY_ITEM
    ? `Codex queue item ${queueItemId} is ready to dispatch.`
    : `Codex dispatcher decision: ${decision}`);

  return {
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.automated_codex_dispatcher.decision',
    decisionId,
    decision,
    queueItemId,
    queueItem,
    summary,
    requiresOperator,
    exactUnblockAction,
    dispatchClaim: decision === CODEX_DISPATCH_DECISION.DISPATCH_READY_ITEM
      ? createCodexDispatchClaim(queueItem, {
        claimedBy: 'codex-dispatcher',
        claimedAtUtc: input.decidedAtUtc,
        claimExpiresAtUtc: input.claimExpiresAtUtc,
      })
      : null,
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: decisionId,
      sender: 'codex',
      recipient: 'operator',
      channel: 'automated-codex-dispatcher',
      kind: decision === CODEX_DISPATCH_DECISION.DISPATCH_READY_ITEM ? 'codex-dispatch-attempted' : decision === CODEX_DISPATCH_DECISION.BLOCKED_BY_METER ? 'codex-blocked-by-meter' : 'operator-action-required',
      severity: requiresOperator ? 'warning' : 'info',
      correlationId: queueItem?.relatedGoal || queueItemId || decisionId,
      relatedGoal: queueItem?.relatedGoal || '',
      relatedPr: queueItem?.relatedPr || '',
      summary,
      status: decision,
      changedFiles: queueItem?.allowedFiles?.filter((path) => !path.endsWith('/**')) || [],
      proofRefs: ['proof/automated-codex-dispatcher-decision.json'],
      requiresOperator,
    }),
    finalVerdict: decision === CODEX_DISPATCH_DECISION.DISPATCH_READY_ITEM
      ? 'CODEX_DISPATCHER_READY_TO_DISPATCH'
      : requiresOperator
        ? 'CODEX_DISPATCHER_BLOCKED'
        : 'CODEX_DISPATCHER_WAITING',
  };
}

export function createCodexDispatcherResult(input = {}) {
  const decision = createCodexDispatchDecision(input.decision || {});
  const result = createCodexDispatchResult(decision.queueItem || input.queueItem || {}, {
    success: input.success,
    evidence: input.evidence,
    commandOutputHash: input.commandOutputHash,
    proofRefs: input.proofRefs,
    reason: input.reason,
    exactUnblockAction: input.exactUnblockAction,
    completedAtUtc: input.completedAtUtc,
    durationMs: input.durationMs,
  });

  return {
    schemaVersion: AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.automated_codex_dispatcher.result',
    decisionId: decision.decisionId,
    queueItemId: result.queueItemId,
    success: input.success === true,
    dispatchResult: result,
    finalVerdict: input.success === true && result.finalVerdict === 'CODEX_DISPATCH_RESULT_PASS'
      ? 'AUTOMATED_CODEX_DISPATCHER_RESULT_PASS'
      : 'AUTOMATED_CODEX_DISPATCHER_RESULT_BLOCKED',
  };
}
