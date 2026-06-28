import {
  createSharedWorkspaceMessage,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';

export const OPERATOR_AUTOMATION_SCHEMA_VERSION = 'operator-automation-layer.v1';

export const OPERATOR_DECISION_STATUS = Object.freeze({
  PROPOSED: 'PROPOSED',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  EXECUTION_READY: 'EXECUTION_READY',
  DONE: 'DONE',
});

export const OPERATOR_DECISION_KIND = Object.freeze({
  MERGE_APPROVAL: 'MERGE_APPROVAL',
  CODEX_DISPATCH_APPROVAL: 'CODEX_DISPATCH_APPROVAL',
  SERVICE_RESTART_APPROVAL: 'SERVICE_RESTART_APPROVAL',
  PROOF_REQUEST: 'PROOF_REQUEST',
  BLOCKER_UNBLOCK: 'BLOCKER_UNBLOCK',
});

export const OPERATOR_AUTOMATION_GUARDRAILS = Object.freeze({
  bestClickIsNoClick: true,
  approvalSpoofingAllowed: false,
  implicitMergeApprovalAllowed: false,
  implicitMeterSpendApprovalAllowed: false,
  mutationWithoutOperatorApprovalAllowed: false,
  exactHeadShaRequiredForMerge: true,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(), -]{0,240}$/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
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

function normalizeStatus(value) {
  const status = asText(value, OPERATOR_DECISION_STATUS.PROPOSED).toUpperCase();
  return Object.values(OPERATOR_DECISION_STATUS).includes(status) ? status : OPERATOR_DECISION_STATUS.PROPOSED;
}

function normalizeDecisionKind(value) {
  const kind = asText(value, OPERATOR_DECISION_KIND.PROOF_REQUEST).toUpperCase();
  return Object.values(OPERATOR_DECISION_KIND).includes(kind) ? kind : OPERATOR_DECISION_KIND.PROOF_REQUEST;
}

export function buildOperatorAutomationLayerContract() {
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    contractKind: 'stephanos.operator_automation.contract',
    decisionKinds: Object.values(OPERATOR_DECISION_KIND),
    statuses: Object.values(OPERATOR_DECISION_STATUS),
    requiredDecisionFields: [
      'schemaVersion',
      'kind',
      'decisionId',
      'decisionKind',
      'status',
      'summary',
      'requiresOperator',
      'exactApprovalText',
      'exactUnblockAction',
      'sharedWorkspaceMessage',
    ],
    guardrails: { ...OPERATOR_AUTOMATION_GUARDRAILS },
    finalVerdict: 'OPERATOR_AUTOMATION_LAYER_CONTRACT_READY',
  };
}

export function createOperatorDecision(input = {}) {
  const decisionKind = normalizeDecisionKind(input.decisionKind);
  const status = normalizeStatus(input.status || OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL);
  const decisionId = safeId(input.decisionId, `operator-${decisionKind.toLowerCase()}-${safeText(input.relatedPr || input.relatedGoal || 'pending', 'pending').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  const relatedPr = safeText(input.relatedPr, '');
  const expectedHeadSha = SHA_PATTERN.test(asText(input.expectedHeadSha, '')) ? asText(input.expectedHeadSha, '').toLowerCase() : '';
  const requiresOperator = input.requiresOperator !== false && [
    OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
    OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    OPERATOR_DECISION_STATUS.PROPOSED,
  ].includes(status);
  const exactApprovalText = decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL && relatedPr && expectedHeadSha
    ? `APPROVE MERGE PR ${relatedPr} EXACT HEAD ${expectedHeadSha}`
    : safeText(input.exactApprovalText, '');
  const exactUnblockAction = status === OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION
    ? safeText(input.exactUnblockAction, 'Resolve the operator automation blocker, then recreate the decision.')
    : '';

  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.decision',
    decisionId,
    decisionKind,
    status,
    relatedGoal: safeText(input.relatedGoal, ''),
    relatedPr,
    expectedHeadSha,
    summary: safeText(input.summary, 'Operator decision required.'),
    requiresOperator,
    exactApprovalText,
    exactUnblockAction,
    expiresAtUtc: safeText(input.expiresAtUtc, ''),
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: decisionId,
      sender: 'stephanos',
      recipient: 'operator',
      channel: 'operator-automation',
      kind: status === OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'operator-action-required' : 'approval-request',
      severity: requiresOperator ? 'warning' : 'info',
      correlationId: input.relatedGoal || relatedPr || decisionId,
      relatedGoal: input.relatedGoal,
      relatedPr,
      summary: input.summary || 'Operator decision required.',
      status,
      proofRefs: ['proof/operator-automation/decision.json'],
      requiresOperator,
    }),
  };
}

export function validateOperatorDecision(decision = {}) {
  const errors = [];
  if (decision.schemaVersion !== OPERATOR_AUTOMATION_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (decision.kind !== 'stephanos.operator_automation.decision') errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(asText(decision.decisionId, ''))) errors.push('invalid-decision-id');
  if (!Object.values(OPERATOR_DECISION_KIND).includes(decision.decisionKind)) errors.push('invalid-decision-kind');
  if (!Object.values(OPERATOR_DECISION_STATUS).includes(decision.status)) errors.push('invalid-status');
  if (decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL && !SHA_PATTERN.test(asText(decision.expectedHeadSha, ''))) errors.push('missing-exact-head-sha');
  if (decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL && !asText(decision.exactApprovalText, '').includes('EXACT HEAD')) errors.push('missing-exact-approval-text');
  if (decision.status === OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !asText(decision.exactUnblockAction, '')) errors.push('missing-exact-unblock-action');
  if (decision.requiresOperator === false && [
    OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
    OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
  ].includes(decision.status)) errors.push('operator-required-status-without-operator');
  const messageValidation = validateSharedWorkspaceMessage(decision.sharedWorkspaceMessage);
  if (!messageValidation.valid) errors.push('invalid-shared-workspace-message');

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'OPERATOR_DECISION_PASS' : 'OPERATOR_DECISION_BLOCKED',
  };
}

export function createOperatorAutomationBatch(input = {}) {
  const decisions = Array.isArray(input.decisions) ? input.decisions.map(createOperatorDecision) : [];
  const invalid = decisions.filter((decision) => !validateOperatorDecision(decision).valid);
  const waiting = decisions.filter((decision) => decision.requiresOperator === true);
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.batch',
    batchId: safeId(input.batchId, 'operator-automation-batch'),
    decisions,
    invalidDecisionIds: invalid.map((decision) => decision.decisionId),
    waitingDecisionIds: waiting.map((decision) => decision.decisionId),
    status: invalid.length ? OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : waiting.length ? OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL : OPERATOR_DECISION_STATUS.EXECUTION_READY,
    summary: invalid.length ? 'Operator automation batch has invalid decisions.' : waiting.length ? 'Operator automation batch is waiting for operator approval.' : 'Operator automation batch is execution ready.',
    finalVerdict: invalid.length ? 'OPERATOR_AUTOMATION_BATCH_BLOCKED' : waiting.length ? 'OPERATOR_AUTOMATION_BATCH_WAITING' : 'OPERATOR_AUTOMATION_BATCH_READY',
  };
}

export function applyOperatorApproval(decision = {}, approval = {}) {
  const current = createOperatorDecision(decision);
  const supplied = asText(approval.exactApprovalText, '');
  const approved = current.exactApprovalText && supplied === current.exactApprovalText;
  return {
    schemaVersion: OPERATOR_AUTOMATION_SCHEMA_VERSION,
    kind: 'stephanos.operator_automation.approval_result',
    decisionId: current.decisionId,
    approved,
    status: approved ? OPERATOR_DECISION_STATUS.APPROVED : OPERATOR_DECISION_STATUS.REJECTED,
    rejectionReason: approved ? '' : 'Exact operator approval text did not match.',
    finalVerdict: approved ? 'OPERATOR_APPROVAL_PASS' : 'OPERATOR_APPROVAL_REJECTED',
  };
}
