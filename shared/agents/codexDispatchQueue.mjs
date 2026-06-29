import { createHash } from 'node:crypto';
import {
  createSharedWorkspaceMessage,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';
import {
  createVerifierResult,
  validateVerifierResult,
  VERIFICATION_STATUS,
} from './verificationHarness.mjs';

export const CODEX_DISPATCH_QUEUE_SCHEMA_VERSION = 'codex-dispatch-queue.v1';
export const CODEX_DISPATCH_QUEUE_KIND = 'stephanos.codex_dispatch.queue_item';

export const CODEX_QUEUE_STATUS = Object.freeze({
  READY: 'READY',
  CLAIMED: 'CLAIMED',
  DISPATCHED: 'DISPATCHED',
  WAITING_FOR_RESULT: 'WAITING_FOR_RESULT',
  RESULT_RECEIVED: 'RESULT_RECEIVED',
  BLOCKED_BY_METER: 'BLOCKED_BY_METER',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  COMPLETE: 'COMPLETE',
});

export const CODEX_DISPATCH_GUARDRAILS = Object.freeze({
  zeroCostDefault: true,
  cloudMeterAutoSpendAllowed: false,
  autoDispatchWithoutQueueItemAllowed: false,
  arbitraryShellAllowed: false,
  mutationOutsideAllowedFilesAllowed: false,
  mergeWithoutOperatorApprovalAllowed: false,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/#() -]{0,240}$/i;
const SAFE_COMMAND_PATTERN = /^(node|npm|git|gh|powershell|pwsh)(\.exe)?(\s|$)/i;
const UNSAFE_PATH_PATTERN = /(^|\/)(\.git|node_modules|apps\/stephanos\/dist|stephanos-server\/data)(\/|$)|^(runtime|runtime-data|root-data|data|tmp)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;
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

function uniqueList(items) {
  return [...new Set(asList(items))];
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

function normalizePath(value) {
  return asText(value, '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\/+/, '');
}

function isUnsafePath(value) {
  const path = normalizePath(value);
  if (!path) return true;
  if (path.startsWith('/') || path.startsWith('//') || /^[a-z]:\//i.test(path)) return true;
  if (path.split('/').some((part) => part === '..')) return true;
  return UNSAFE_PATH_PATTERN.test(path);
}

function normalizeAllowedFiles(value) {
  return uniqueList(value).map(normalizePath).filter((path) => !isUnsafePath(path));
}

function normalizeRequiredTests(value) {
  return uniqueList(value).filter((command) => SAFE_COMMAND_PATTERN.test(command) && !FORBIDDEN_TEXT_PATTERN.test(command)).slice(0, 20);
}

function normalizeStatus(value) {
  const status = asText(value, CODEX_QUEUE_STATUS.READY).toUpperCase();
  return Object.values(CODEX_QUEUE_STATUS).includes(status) ? status : CODEX_QUEUE_STATUS.READY;
}

function queueIdFrom(input) {
  const goal = safeText(input.relatedGoal, 'goal');
  const summary = safeText(input.summary, 'codex job');
  return `codex-${createHash('sha256').update(`${goal}\n${summary}`).digest('hex').slice(0, 20)}`;
}

export function buildCodexDispatchQueueContract() {
  return {
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    contractKind: 'stephanos.codex_dispatch.queue.contract',
    statuses: Object.values(CODEX_QUEUE_STATUS),
    requiredQueueFields: [
      'schemaVersion',
      'kind',
      'queueItemId',
      'status',
      'relatedGoal',
      'summary',
      'allowedFiles',
      'requiredTests',
      'requiredEvidence',
      'createdAtUtc',
      'requiresOperatorApprovalBeforeMerge',
    ],
    guardrails: { ...CODEX_DISPATCH_GUARDRAILS },
    sharedWorkspaceEventKinds: [
      'codex-job-created',
      'codex-job-ready',
      'codex-dispatch-attempted',
      'codex-blocked-by-meter',
      'codex-result-received',
      'codex-complete',
    ],
    finalVerdict: 'CODEX_DISPATCH_QUEUE_CONTRACT_READY',
  };
}

export function createCodexQueueItem(input = {}) {
  const allowedFiles = normalizeAllowedFiles(input.allowedFiles);
  const requiredTests = normalizeRequiredTests(input.requiredTests);
  const requiredEvidence = uniqueList(input.requiredEvidence).map((item) => safeText(item, '')).filter(Boolean).slice(0, 20);
  const queueItemId = safeId(input.queueItemId, queueIdFrom(input));
  const status = normalizeStatus(input.status);

  return {
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    kind: CODEX_DISPATCH_QUEUE_KIND,
    queueItemId,
    status,
    relatedGoal: safeText(input.relatedGoal, ''),
    relatedPr: safeText(input.relatedPr, ''),
    summary: safeText(input.summary, 'Codex queue item ready.'),
    operatorIntent: asText(input.operatorIntent, '').slice(0, 1200),
    allowedFiles,
    requiredTests,
    requiredEvidence,
    createdAtUtc: safeText(input.createdAtUtc, 'pending'),
    claimedBy: status === CODEX_QUEUE_STATUS.CLAIMED ? safeText(input.claimedBy, 'codex') : safeText(input.claimedBy, ''),
    claimExpiresAtUtc: safeText(input.claimExpiresAtUtc, ''),
    requiresOperatorApprovalBeforeMerge: input.requiresOperatorApprovalBeforeMerge !== false,
    exactUnblockAction: status.startsWith('BLOCKED')
      ? safeText(input.exactUnblockAction, 'Resolve the queue blocker, then recreate a READY queue item.')
      : '',
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: queueItemId,
      sender: 'codex',
      recipient: 'operator',
      channel: 'codex-dispatch-queue',
      kind: status === CODEX_QUEUE_STATUS.BLOCKED_BY_METER ? 'codex-blocked-by-meter' : 'codex-job-ready',
      severity: status.startsWith('BLOCKED') ? 'warning' : 'info',
      correlationId: input.relatedGoal || queueItemId,
      relatedGoal: input.relatedGoal,
      relatedPr: input.relatedPr,
      summary: input.summary || 'Codex queue item ready.',
      status,
      changedFiles: allowedFiles.filter((path) => !path.endsWith('/**')),
      proofRefs: ['proof/codex-dispatch-queue.json'],
      requiresOperator: status.startsWith('BLOCKED'),
    }),
  };
}

export function validateCodexQueueItem(item = {}) {
  const errors = [];
  if (item.schemaVersion !== CODEX_DISPATCH_QUEUE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (item.kind !== CODEX_DISPATCH_QUEUE_KIND) errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(asText(item.queueItemId, ''))) errors.push('invalid-queue-item-id');
  if (!Object.values(CODEX_QUEUE_STATUS).includes(item.status)) errors.push('invalid-status');
  if (!asText(item.summary, '')) errors.push('missing-summary');
  if (!Array.isArray(item.allowedFiles) || item.allowedFiles.length === 0) errors.push('missing-allowed-files');
  for (const path of asList(item.allowedFiles)) {
    if (isUnsafePath(path)) errors.push('unsafe-allowed-file');
  }
  for (const command of asList(item.requiredTests)) {
    if (!SAFE_COMMAND_PATTERN.test(command) || FORBIDDEN_TEXT_PATTERN.test(command)) errors.push('unsafe-required-test');
  }
  if (item.status === CODEX_QUEUE_STATUS.COMPLETE && item.requiresOperatorApprovalBeforeMerge !== true) errors.push('missing-operator-merge-approval-guardrail');
  const messageValidation = validateSharedWorkspaceMessage(item.sharedWorkspaceMessage);
  if (!messageValidation.valid) errors.push('invalid-shared-workspace-message');

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'CODEX_QUEUE_ITEM_PASS' : 'CODEX_QUEUE_ITEM_BLOCKED',
  };
}

export function createCodexDispatchClaim(item = {}, input = {}) {
  const queueItem = createCodexQueueItem({ ...item, status: CODEX_QUEUE_STATUS.CLAIMED, claimedBy: input.claimedBy || 'codex' });
  return {
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    kind: 'stephanos.codex_dispatch.claim',
    queueItemId: queueItem.queueItemId,
    status: CODEX_QUEUE_STATUS.CLAIMED,
    claimedBy: safeText(input.claimedBy, 'codex'),
    claimedAtUtc: safeText(input.claimedAtUtc, 'pending'),
    claimExpiresAtUtc: safeText(input.claimExpiresAtUtc, 'pending'),
    queueItem,
    finalVerdict: validateCodexQueueItem(queueItem).valid ? 'CODEX_DISPATCH_CLAIM_PASS' : 'CODEX_DISPATCH_CLAIM_BLOCKED',
  };
}

export function createCodexDispatchResult(item = {}, input = {}) {
  const passed = input.success === true;
  const queueItem = createCodexQueueItem({
    ...item,
    status: passed ? CODEX_QUEUE_STATUS.COMPLETE : CODEX_QUEUE_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    exactUnblockAction: passed ? '' : input.exactUnblockAction,
  });
  const verifierResult = createVerifierResult({
    checkId: `codex-dispatch-${queueItem.queueItemId}`.slice(0, 120),
    verifierType: 'GitVerifier',
    status: passed ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: queueItem.relatedGoal || queueItem.queueItemId,
    evidence: input.evidence || [],
    reason: passed ? '' : input.reason || 'Codex dispatch did not complete.',
    durationMs: input.durationMs,
    timestampUtc: input.completedAtUtc,
    commandOutputHash: input.commandOutputHash,
    proofRefs: input.proofRefs || ['proof/codex-dispatch-result.json'],
  });
  const verifierValidation = validateVerifierResult(verifierResult);

  return {
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    kind: 'stephanos.codex_dispatch.result',
    queueItemId: queueItem.queueItemId,
    status: queueItem.status,
    queueItem,
    verifierResult,
    valid: validateCodexQueueItem(queueItem).valid && verifierValidation.valid,
    errors: [...validateCodexQueueItem(queueItem).errors, ...verifierValidation.errors],
    finalVerdict: passed && verifierValidation.valid ? 'CODEX_DISPATCH_RESULT_PASS' : 'CODEX_DISPATCH_RESULT_BLOCKED',
  };
}
