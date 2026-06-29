import { createSharedWorkspaceMessage, validateSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

export const STEPHANOS_COMMAND_RESPONSE_SCHEMA_VERSION = 'stephanos-command-response.v1';

export const STEPHANOS_REPLY_STATUS = Object.freeze({
  BUILDING: 'BUILDING',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_CODEX: 'WAITING_FOR_CODEX',
  WAITING_FOR_OPENCLAW: 'WAITING_FOR_OPENCLAW',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  DONE: 'DONE',
});

export const STEPHANOS_REPLY_GUARDRAILS = Object.freeze({
  genericReplyAllowed: false,
  mustNameActiveGoal: true,
  mustNameNextAction: true,
  mustNameProofOrBlocker: true,
  mustAvoidInventedProof: true,
  mustUseExactOperatorHandoffWhenRequired: true,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(), -]{0,300}$/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item, '')).filter(Boolean);
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
  const status = asText(value, STEPHANOS_REPLY_STATUS.BUILDING).toUpperCase();
  return Object.values(STEPHANOS_REPLY_STATUS).includes(status) ? status : STEPHANOS_REPLY_STATUS.BUILDING;
}

function sanitizeItems(items, limit = 12) {
  return asList(items).map((item) => safeText(item, '')).filter(Boolean).slice(0, limit);
}

export function buildStephanosCommandResponseContract() {
  return {
    schemaVersion: STEPHANOS_COMMAND_RESPONSE_SCHEMA_VERSION,
    contractKind: 'stephanos.command_response.contract',
    statuses: Object.values(STEPHANOS_REPLY_STATUS),
    requiredResponseFields: [
      'schemaVersion',
      'kind',
      'responseId',
      'activeGoal',
      'status',
      'missionState',
      'proofState',
      'blockerState',
      'nextAction',
      'operatorHandoff',
      'sharedWorkspaceMessage',
    ],
    guardrails: { ...STEPHANOS_REPLY_GUARDRAILS },
    finalVerdict: 'STEPHANOS_COMMAND_RESPONSE_CONTRACT_READY',
  };
}

export function createStephanosCommandResponse(input = {}) {
  const activeGoal = safeText(input.activeGoal, '#1280');
  const status = normalizeStatus(input.status);
  const responseId = safeId(input.responseId, `stephanos-${activeGoal.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${status.toLowerCase()}`);
  const nextAction = safeText(input.nextAction, 'Name the next source, proof, blocker, or merge action.');
  const blockerState = sanitizeItems(input.blockerState);
  const proofState = sanitizeItems(input.proofState);
  const operatorHandoff = status === STEPHANOS_REPLY_STATUS.WAITING_FOR_OPERATOR_APPROVAL
    ? safeText(input.operatorHandoff, 'Operator approval is required with exact approval text.')
    : safeText(input.operatorHandoff, '');

  return {
    schemaVersion: STEPHANOS_COMMAND_RESPONSE_SCHEMA_VERSION,
    kind: 'stephanos.command_response.reply',
    responseId,
    activeGoal,
    status,
    missionState: sanitizeItems(input.missionState, 20),
    proofState,
    blockerState,
    nextAction,
    operatorHandoff,
    conciseReply: safeText(input.conciseReply, `${activeGoal} is ${status}. Next: ${nextAction}`),
    generic: false,
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: responseId,
      sender: 'stephanos',
      recipient: 'operator',
      channel: 'stephanos-command',
      kind: status === STEPHANOS_REPLY_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION ? 'blocked-reason' : 'status',
      severity: status === STEPHANOS_REPLY_STATUS.DONE ? 'info' : 'warning',
      correlationId: activeGoal,
      relatedGoal: activeGoal,
      summary: input.conciseReply || `${activeGoal} is ${status}.`,
      status,
      proofRefs: ['proof/stephanos-command-response.json'],
      requiresOperator: status === STEPHANOS_REPLY_STATUS.WAITING_FOR_OPERATOR_APPROVAL || status === STEPHANOS_REPLY_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    }),
  };
}

export function validateStephanosCommandResponse(response = {}) {
  const errors = [];
  if (response.schemaVersion !== STEPHANOS_COMMAND_RESPONSE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (response.kind !== 'stephanos.command_response.reply') errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(asText(response.responseId, ''))) errors.push('invalid-response-id');
  if (!asText(response.activeGoal, '')) errors.push('missing-active-goal');
  if (!Object.values(STEPHANOS_REPLY_STATUS).includes(response.status)) errors.push('invalid-status');
  if (!Array.isArray(response.missionState) || response.missionState.length === 0) errors.push('missing-mission-state');
  if (!Array.isArray(response.proofState)) errors.push('missing-proof-state');
  if (!Array.isArray(response.blockerState)) errors.push('missing-blocker-state');
  if (!asText(response.nextAction, '')) errors.push('missing-next-action');
  if (response.generic === true) errors.push('generic-reply');
  if (response.status === STEPHANOS_REPLY_STATUS.WAITING_FOR_OPERATOR_APPROVAL && !asText(response.operatorHandoff, '')) errors.push('missing-operator-handoff');
  if (response.status === STEPHANOS_REPLY_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && response.blockerState.length === 0) errors.push('missing-blocker-state-for-blocked-response');
  const messageValidation = validateSharedWorkspaceMessage(response.sharedWorkspaceMessage);
  if (!messageValidation.valid) errors.push('invalid-shared-workspace-message');

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'STEPHANOS_COMMAND_RESPONSE_PASS' : 'STEPHANOS_COMMAND_RESPONSE_BLOCKED',
  };
}

export function summarizeStephanosResponse(response = {}) {
  const reply = createStephanosCommandResponse(response);
  return [
    reply.conciseReply,
    `Active goal: ${reply.activeGoal}`,
    `Status: ${reply.status}`,
    `Next action: ${reply.nextAction}`,
    reply.blockerState.length ? `Blocker: ${reply.blockerState[0]}` : '',
    reply.operatorHandoff ? `Operator handoff: ${reply.operatorHandoff}` : '',
  ].filter(Boolean).join('\n');
}
