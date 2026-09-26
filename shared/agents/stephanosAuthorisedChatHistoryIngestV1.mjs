import {
  STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION,
  buildStephanosOperatorKnowledgeTwinV1,
} from './stephanosOperatorKnowledgeTwinV1.mjs';

export const STEPHANOS_AUTHORISED_CHAT_HISTORY_INGEST_SCHEMA_VERSION =
  'stephanos.authorised-chat-history-ingest.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const MAX_ITEMS = 128;
const MAX_TEXT = 6000;
const ALLOWED_ROLES = new Set(['operator', 'chatgpt', 'stephanos']);
const ALLOWED_SURFACES = new Set(['chatgpt-web', 'chatgpt-app', 'shared-workspace']);
const KNOWLEDGE_SCOPES = new Set(['CURRENT_SHARED_THREAD', 'AUTHORISED_PROJECT_CHATS', 'ALL_AUTHORISED_CHATS']);
const ITEM_KEYS = Object.freeze([
  'chatId',
  'messageId',
  'role',
  'sourceSurface',
  'originalCreatedAtUtc',
  'text',
  'knowledgeClass',
  'retentionIntent',
  'explicitOperatorTeaching',
  'supersedesKnowledgeId',
  'sourceRefs',
  'authorised',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function exactObject(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
    const out = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
      out[key] = descriptor.value;
    }
    return Object.freeze(out);
  } catch {
    return null;
  }
}

function exactIso(value) {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString() === value ? ms : null;
}

function sourceRefs(value) {
  if (!Array.isArray(value) || value.length > 32) return null;
  const out = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') return null;
    const ref = value[index].trim();
    if (!ref || ref.length > 256 || ref.includes('..')) return null;
    out.push(ref);
  }
  return Object.freeze([...new Set(out)]);
}

function scopeBindings(input, scope) {
  if (!KNOWLEDGE_SCOPES.has(scope)) return { ok: false, reason: 'operatorConsent-scope-invalid' };
  if (scope === 'ALL_AUTHORISED_CHATS') return { ok: true, currentChatId: '', authorisedChatIds: null };

  if (scope === 'CURRENT_SHARED_THREAD') {
    const currentChatId = text(input.currentSharedThreadChatId);
    if (!SAFE_ID.test(currentChatId)) return { ok: false, reason: 'currentSharedThreadChatId-required' };
    return { ok: true, currentChatId, authorisedChatIds: new Set([currentChatId]) };
  }

  if (!Array.isArray(input.authorisedProjectChatIds) || input.authorisedProjectChatIds.length === 0 || input.authorisedProjectChatIds.length > MAX_ITEMS) {
    return { ok: false, reason: 'authorisedProjectChatIds-required' };
  }
  const authorised = new Set();
  for (const value of input.authorisedProjectChatIds) {
    const chatId = text(value);
    if (!SAFE_ID.test(chatId)) return { ok: false, reason: 'authorisedProjectChatIds-invalid' };
    authorised.add(chatId);
  }
  return { ok: true, currentChatId: '', authorisedChatIds: authorised };
}

function messageIdentity(chatId, messageId) {
  return JSON.stringify([chatId, messageId]);
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    memoryWriteAllowed: false,
    durablePromotionAllowed: false,
    correctionAllowed: false,
    forgetAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    schedulerCreationAllowed: false,
    workerCreationAllowed: false,
    providerSelectionAuthorityAdded: false,
  });
}

function blocked(errors = []) {
  return Object.freeze({
    schemaVersion: STEPHANOS_AUTHORISED_CHAT_HISTORY_INGEST_SCHEMA_VERSION,
    valid: false,
    classification: 'AUTHORISED_CHAT_HISTORY_INGEST_BLOCKED',
    importedItemCount: 0,
    deduplicatedItemCount: 0,
    sourceLineage: Object.freeze([]),
    knowledgeTwin: null,
    errors: Object.freeze([...new Set(errors)]),
    authority: authorityBoundary(),
  });
}

export function buildStephanosAuthorisedChatHistoryIngestV1(input = {}) {
  try {
    const observedAtUtc = text(input.observedAtUtc);
    const observedAtMs = exactIso(observedAtUtc);
    if (observedAtMs === null) return blocked(['observedAtUtc-invalid']);
    if (!input.operatorConsent || typeof input.operatorConsent !== 'object' || Array.isArray(input.operatorConsent)) {
      return blocked(['operatorConsent-required']);
    }
    if (!Array.isArray(input.historyItems) || input.historyItems.length === 0 || input.historyItems.length > MAX_ITEMS) {
      return blocked(['historyItems-count-invalid']);
    }

    const scope = text(input.operatorConsent.scope);
    const bindings = scopeBindings(input, scope);
    if (!bindings.ok) return blocked([bindings.reason]);

    const canonical = [];
    const lineage = [];
    const identities = new Map();
    let deduplicatedItemCount = 0;

    for (let index = 0; index < input.historyItems.length; index += 1) {
      const item = exactObject(input.historyItems[index], ITEM_KEYS);
      if (!item) return blocked([`historyItems[${index}]-shape-invalid`]);
      if (item.authorised !== true) return blocked([`historyItems[${index}]-not-authorised`]);

      const chatId = text(item.chatId);
      const messageId = text(item.messageId);
      const role = text(item.role);
      const sourceSurface = text(item.sourceSurface);
      const createdAtMs = exactIso(item.originalCreatedAtUtc);
      const body = text(item.text);
      const refs = sourceRefs(item.sourceRefs);

      if (!SAFE_ID.test(chatId) || !SAFE_ID.test(messageId)) return blocked([`historyItems[${index}]-identity-invalid`]);
      if (!ALLOWED_ROLES.has(role)) return blocked([`historyItems[${index}]-role-invalid`]);
      if (!ALLOWED_SURFACES.has(sourceSurface)) return blocked([`historyItems[${index}]-surface-invalid`]);
      if (bindings.authorisedChatIds && !bindings.authorisedChatIds.has(chatId)) {
        return blocked([`historyItems[${index}]-outside-selected-visibility-scope`]);
      }
      if (createdAtMs === null || createdAtMs > observedAtMs) return blocked([`historyItems[${index}]-timestamp-invalid`]);
      if (!body || body.length > MAX_TEXT) return blocked([`historyItems[${index}]-text-invalid`]);
      if (!refs) return blocked([`historyItems[${index}]-sourceRefs-invalid`]);

      const identity = messageIdentity(chatId, messageId);
      const normalized = Object.freeze({
        chatId,
        messageId,
        role,
        sourceSurface,
        createdAtUtc: item.originalCreatedAtUtc,
        text: body,
        knowledgeClass: text(item.knowledgeClass),
        retentionIntent: text(item.retentionIntent),
        explicitOperatorTeaching: item.explicitOperatorTeaching === true,
        supersedesKnowledgeId: text(item.supersedesKnowledgeId),
        sourceRefs: refs,
      });
      const serialized = JSON.stringify(normalized);
      if (identities.has(identity)) {
        if (identities.get(identity) !== serialized) return blocked([`historyItems[${index}]-duplicate-conflict`]);
        deduplicatedItemCount += 1;
        continue;
      }
      identities.set(identity, serialized);
      canonical.push(normalized);
      lineage.push(Object.freeze({
        chatId,
        messageId,
        originalCreatedAtUtc: item.originalCreatedAtUtc,
        sourceSurface,
        sourceRefs: refs,
      }));
    }

    const knowledgeTwin = buildStephanosOperatorKnowledgeTwinV1({
      observedAtUtc,
      operatorConsent: input.operatorConsent,
      items: canonical,
    });
    if (!knowledgeTwin?.valid || knowledgeTwin.schemaVersion !== STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION) {
      return blocked([
        'operator-knowledge-twin-rejected-history',
        ...(Array.isArray(knowledgeTwin?.validationErrors) ? knowledgeTwin.validationErrors : []),
      ]);
    }

    return Object.freeze({
      schemaVersion: STEPHANOS_AUTHORISED_CHAT_HISTORY_INGEST_SCHEMA_VERSION,
      valid: true,
      classification: 'AUTHORISED_CHAT_HISTORY_CONTEXT_READY',
      importedItemCount: canonical.length,
      deduplicatedItemCount,
      sourceLineage: Object.freeze(lineage),
      knowledgeTwin,
      errors: Object.freeze([]),
      authority: authorityBoundary(),
    });
  } catch {
    return blocked(['authorised-chat-history-ingest-failed-closed']);
  }
}
