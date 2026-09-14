import { createHash } from 'node:crypto';

import { STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION } from './stephanosRichConversationalResponseV1.mjs';

export const STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION = 'stephanos.conversation-canvas-handoff.v1';
export const STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION = 'stephanos.ui-agent.conversation-canvas-presenter.v1';
export const STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD = 'conversation_canvas_view';

const ALLOWED_SURFACES = new Set(['desktop-browser', 'ipad', 'iphone']);
const ALLOWED_STATES = new Set(['READY', 'PARTIAL']);
const MAX_TEXT = 24_000;
const MAX_EXPANDED_SECTIONS = 16;
const SAFE_ID = /^[a-z0-9][a-z0-9._:/#-]{0,255}$/i;
const SECRET_SHAPED_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|credential|api[_-]?key|private[_-]?key)\s*[:=])/i;

function text(value, maximum = MAX_TEXT) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate && candidate.length <= maximum && !SECRET_SHAPED_TEXT.test(candidate) ? candidate : '';
}

function dataObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    return value;
  } catch {
    return null;
  }
}

function uniqueStrings(value, limit = MAX_EXPANDED_SECTIONS) {
  if (!Array.isArray(value) || value.length > limit) return Object.freeze([]);
  const output = [];
  for (const item of value) {
    const candidate = text(item, 128);
    if (candidate) output.push(candidate);
  }
  return Object.freeze([...new Set(output)]);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAuthorityAdded: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerSelectionAuthorityAdded: false,
    publicRelayProjectionAllowed: false,
    presenterActionExecutionAllowed: false,
  });
}

function richResponseAuthorityIsZero(response) {
  const authority = dataObject(response?.authority);
  if (!authority) return false;
  for (const field of [
    'sourceMutationAllowed',
    'commandExecutionAllowed',
    'approvalAuthorityAdded',
    'mergeAllowed',
    'deploymentAllowed',
    'providerSelectionAuthorityAdded',
    'privateUiTruthAllowed',
  ]) {
    if (authority[field] !== false) return false;
  }
  return true;
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION,
    valid: false,
    state: 'SAFE_HOLD',
    handoffId: null,
    targetPresenterSchemaVersion: STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION,
    targetPayloadField: STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD,
    surface: null,
    continuity: null,
    presenterInput: null,
    privacy: Object.freeze({
      sharedWorkspacePrivateHandoffRequired: true,
      rawAnswerMayEnterPublicRelay: false,
      publicRelayProjectionAllowed: false,
    }),
    authority: authorityBoundary(),
    errors: Object.freeze([...new Set(errors)]),
  });
}

export function buildStephanosConversationCanvasHandoffV1(input = {}) {
  try {
    const packet = dataObject(input);
    const richResponse = dataObject(packet?.richResponse);
    if (!packet || !richResponse) return invalid(['rich-response-required']);
    if (richResponse.schemaVersion !== STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION || richResponse.valid !== true) {
      return invalid(['rich-response-not-valid']);
    }
    if (!richResponseAuthorityIsZero(richResponse)) return invalid(['rich-response-authority-must-remain-zero']);

    const directAnswer = text(richResponse.directAnswer);
    const continuity = dataObject(richResponse.continuity);
    const roundId = text(continuity?.roundId, 256);
    const questionId = text(continuity?.questionId, 256);
    const responseId = text(richResponse.responseId, 256);
    if (!directAnswer) return invalid(['direct-answer-required']);
    if (!SAFE_ID.test(roundId) || !SAFE_ID.test(questionId) || !SAFE_ID.test(responseId)) {
      return invalid(['continuity-identity-invalid']);
    }

    const surface = text(packet.surface, 64) || 'desktop-browser';
    if (!ALLOWED_SURFACES.has(surface)) return invalid(['unsupported-surface']);
    const derivedState = Array.isArray(richResponse.unknowns) && richResponse.unknowns.length > 0 ? 'PARTIAL' : 'READY';
    const requestedState = text(packet.state, 32).toUpperCase();
    const state = requestedState || derivedState;
    if (!ALLOWED_STATES.has(state)) return invalid(['unsupported-state']);
    if (derivedState === 'PARTIAL' && state === 'READY') return invalid(['partial-response-cannot-be-promoted-to-ready']);

    const expandedSections = uniqueStrings(packet.expandedSections);
    const prefersReducedMotion = packet.prefersReducedMotion === true;
    const statusMessage = text(packet.statusMessage, 1000);
    const presenterInput = Object.freeze({
      richResponse,
      surface,
      state,
      expandedSections,
      prefersReducedMotion,
      statusMessage,
    });
    const core = Object.freeze({
      schemaVersion: STEPHANOS_CONVERSATION_CANVAS_HANDOFF_SCHEMA_VERSION,
      state: 'PRIVATE_PRESENTATION_HANDOFF_READY',
      targetPresenterSchemaVersion: STEPHANOS_CONVERSATION_CANVAS_TARGET_PRESENTER_SCHEMA_VERSION,
      targetPayloadField: STEPHANOS_CONVERSATION_CANVAS_TARGET_PAYLOAD_FIELD,
      surface,
      continuity: Object.freeze({ roundId, questionId, responseId }),
      presenterInput,
      privacy: Object.freeze({
        sharedWorkspacePrivateHandoffRequired: true,
        rawAnswerMayEnterPublicRelay: false,
        publicRelayProjectionAllowed: false,
      }),
      authority: authorityBoundary(),
    });

    return Object.freeze({
      ...core,
      valid: true,
      handoffId: `conversation-canvas-handoff-${digest(core).slice(0, 24)}`,
      errors: Object.freeze([]),
    });
  } catch {
    return invalid(['conversation-canvas-handoff-failed-closed']);
  }
}
