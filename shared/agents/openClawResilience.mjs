import { createSharedWorkspaceMessage, validateSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';
import { createVerifierResult, validateVerifierResult, VERIFICATION_STATUS } from './verificationHarness.mjs';

export const OPENCLAW_RESILIENCE_SCHEMA_VERSION = 'openclaw-resilience.v1';

export const OPENCLAW_FALLBACK_KIND = Object.freeze({
  SCOUT: 'SCOUT',
  TEST: 'TEST',
  PROOF: 'PROOF',
  PATCH_PREP: 'PATCH_PREP',
});

export const OPENCLAW_RESILIENCE_STATUS = Object.freeze({
  READY: 'READY',
  WAITING_FOR_OPENCLAW: 'WAITING_FOR_OPENCLAW',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  DONE: 'DONE',
});

export const OPENCLAW_RESILIENCE_GUARDRAILS = Object.freeze({
  readonlyDefault: true,
  sourceMutationAllowed: false,
  githubMutationAllowed: false,
  inventedProofAllowed: false,
  operatorApprovalRequiredForPatchPrep: true,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(), -]{0,240}$/i;
const SAFE_PATH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const UNSAFE_PATH_PATTERN = /(^|\/)(\.git|node_modules|apps\/stephanos\/dist|stephanos-server\/data)(\/|$)|^(runtime|runtime-data|root-data|data|tmp)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;

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
  return text && SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function safeId(value, fallback) {
  const text = asText(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function normalizeKind(value) {
  const kind = asText(value, OPENCLAW_FALLBACK_KIND.SCOUT).toUpperCase();
  return Object.values(OPENCLAW_FALLBACK_KIND).includes(kind) ? kind : OPENCLAW_FALLBACK_KIND.SCOUT;
}

function normalizeStatus(value) {
  const status = asText(value, OPENCLAW_RESILIENCE_STATUS.READY).toUpperCase();
  return Object.values(OPENCLAW_RESILIENCE_STATUS).includes(status) ? status : OPENCLAW_RESILIENCE_STATUS.READY;
}

function normalizePath(value) {
  return asText(value, '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\/+/, '');
}

function isSafePath(value) {
  const path = normalizePath(value);
  if (!path || path.startsWith('/') || path.startsWith('//') || /^[a-z]:\//i.test(path)) return false;
  if (path.split('/').some((part) => part === '..')) return false;
  return SAFE_PATH_PATTERN.test(path) && !UNSAFE_PATH_PATTERN.test(path);
}

function safePaths(value) {
  return [...new Set(asList(value).map(normalizePath).filter(isSafePath))].slice(0, 40);
}

export function buildOpenClawResilienceContract() {
  return {
    schemaVersion: OPENCLAW_RESILIENCE_SCHEMA_VERSION,
    contractKind: 'stephanos.openclaw_resilience.contract',
    fallbackKinds: Object.values(OPENCLAW_FALLBACK_KIND),
    statuses: Object.values(OPENCLAW_RESILIENCE_STATUS),
    guardrails: { ...OPENCLAW_RESILIENCE_GUARDRAILS },
    requiredRequestFields: [
      'schemaVersion',
      'kind',
      'requestId',
      'fallbackKind',
      'status',
      'summary',
      'allowedReadPaths',
      'requiredEvidence',
      'sharedWorkspaceMessage',
    ],
    finalVerdict: 'OPENCLAW_RESILIENCE_CONTRACT_READY',
  };
}

export function createOpenClawFallbackRequest(input = {}) {
  const fallbackKind = normalizeKind(input.fallbackKind);
  const status = normalizeStatus(input.status || OPENCLAW_RESILIENCE_STATUS.READY);
  const requestId = safeId(input.requestId, `openclaw-${fallbackKind.toLowerCase()}-request`);
  const blocked = status === OPENCLAW_RESILIENCE_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  const patchPrep = fallbackKind === OPENCLAW_FALLBACK_KIND.PATCH_PREP;

  return {
    schemaVersion: OPENCLAW_RESILIENCE_SCHEMA_VERSION,
    kind: 'stephanos.openclaw_resilience.fallback_request',
    requestId,
    fallbackKind,
    status,
    relatedGoal: safeText(input.relatedGoal, '#1284'),
    relatedPr: safeText(input.relatedPr, ''),
    summary: safeText(input.summary, 'OpenClaw fallback request ready.'),
    allowedReadPaths: safePaths(input.allowedReadPaths),
    requiredEvidence: asList(input.requiredEvidence).map((item) => safeText(item, '')).filter(Boolean).slice(0, 20),
    suggestedPatchPaths: patchPrep ? safePaths(input.suggestedPatchPaths) : [],
    sourceMutationAllowed: false,
    githubMutationAllowed: false,
    requiresOperator: blocked || patchPrep,
    exactUnblockAction: blocked ? safeText(input.exactUnblockAction, 'Unblock OpenClaw fallback, then rerun resilience proof.') : '',
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: requestId,
      sender: 'openclaw',
      recipient: 'operator',
      channel: 'openclaw-resilience',
      kind: blocked ? 'operator-action-required' : 'request',
      severity: blocked || patchPrep ? 'warning' : 'info',
      correlationId: input.relatedGoal || requestId,
      relatedGoal: input.relatedGoal || '#1284',
      relatedPr: input.relatedPr || '',
      summary: input.summary || 'OpenClaw fallback request ready.',
      status,
      changedFiles: [],
      proofRefs: ['proof/openclaw-resilience/request.json'],
      requiresOperator: blocked || patchPrep,
    }),
  };
}

export function validateOpenClawFallbackRequest(request = {}) {
  const errors = [];
  if (request.schemaVersion !== OPENCLAW_RESILIENCE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (request.kind !== 'stephanos.openclaw_resilience.fallback_request') errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(asText(request.requestId, ''))) errors.push('invalid-request-id');
  if (!Object.values(OPENCLAW_FALLBACK_KIND).includes(request.fallbackKind)) errors.push('invalid-fallback-kind');
  if (!Object.values(OPENCLAW_RESILIENCE_STATUS).includes(request.status)) errors.push('invalid-status');
  if (request.sourceMutationAllowed === true) errors.push('source-mutation-not-allowed');
  if (request.githubMutationAllowed === true) errors.push('github-mutation-not-allowed');
  for (const path of asList(request.allowedReadPaths)) if (!isSafePath(path)) errors.push('unsafe-read-path');
  for (const path of asList(request.suggestedPatchPaths)) if (!isSafePath(path)) errors.push('unsafe-patch-path');
  if (request.fallbackKind === OPENCLAW_FALLBACK_KIND.PATCH_PREP && request.requiresOperator !== true) errors.push('patch-prep-requires-operator');
  if (request.status === OPENCLAW_RESILIENCE_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !asText(request.exactUnblockAction, '')) errors.push('missing-exact-unblock-action');
  const messageValidation = validateSharedWorkspaceMessage(request.sharedWorkspaceMessage);
  if (!messageValidation.valid) errors.push('invalid-shared-workspace-message');

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'OPENCLAW_FALLBACK_REQUEST_PASS' : 'OPENCLAW_FALLBACK_REQUEST_BLOCKED',
  };
}

export function createOpenClawFallbackResult(request = {}, input = {}) {
  const fallbackRequest = createOpenClawFallbackRequest(request);
  const success = input.success === true;
  const verifierResult = createVerifierResult({
    checkId: `openclaw-${fallbackRequest.requestId}`.slice(0, 120),
    verifierType: 'OpenClawVerifier',
    status: success ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: fallbackRequest.relatedGoal || fallbackRequest.requestId,
    evidence: input.evidence || [],
    reason: success ? '' : input.reason || 'OpenClaw fallback did not produce grounded evidence.',
    proofRefs: input.proofRefs || ['proof/openclaw-resilience/result.json'],
    commandOutputHash: input.commandOutputHash,
  });
  const verifierValidation = validateVerifierResult(verifierResult);

  return {
    schemaVersion: OPENCLAW_RESILIENCE_SCHEMA_VERSION,
    kind: 'stephanos.openclaw_resilience.fallback_result',
    requestId: fallbackRequest.requestId,
    status: success && verifierValidation.valid ? OPENCLAW_RESILIENCE_STATUS.DONE : OPENCLAW_RESILIENCE_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
    fallbackRequest,
    verifierResult,
    valid: validateOpenClawFallbackRequest(fallbackRequest).valid && verifierValidation.valid,
    finalVerdict: success && verifierValidation.valid ? 'OPENCLAW_RESILIENCE_RESULT_PASS' : 'OPENCLAW_RESILIENCE_RESULT_BLOCKED',
  };
}
