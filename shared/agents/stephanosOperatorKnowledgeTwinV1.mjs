import { createHash } from 'node:crypto';

export const STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION =
  'stephanos.operator-knowledge-twin.v1';

export const STEPHANOS_OPERATOR_KNOWLEDGE_SCOPE = Object.freeze({
  CURRENT_SHARED_THREAD: 'CURRENT_SHARED_THREAD',
  AUTHORISED_PROJECT_CHATS: 'AUTHORISED_PROJECT_CHATS',
  ALL_AUTHORISED_CHATS: 'ALL_AUTHORISED_CHATS',
});

export const STEPHANOS_OPERATOR_KNOWLEDGE_CLASS = Object.freeze({
  KNOWLEDGE: 'KNOWLEDGE',
  DECISION: 'DECISION',
  PREFERENCE: 'PREFERENCE',
  LESSON: 'LESSON',
  GOAL: 'GOAL',
  OPEN_THREAD: 'OPEN_THREAD',
  CORRECTION: 'CORRECTION',
  NONE: 'NONE',
});

export const STEPHANOS_OPERATOR_RETENTION_INTENT = Object.freeze({
  CONTEXT_ONLY: 'CONTEXT_ONLY',
  LEARNING_CANDIDATE: 'LEARNING_CANDIDATE',
  REMEMBER_DURABLY: 'REMEMBER_DURABLY',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_REF = /^(?:chat|message|operator|participant|project|goal|intent|pr|decision|lesson|workspace|memory|surface|evidence):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/i;
const ALLOWED_ROLES = new Set(['operator', 'chatgpt', 'stephanos']);
const ALLOWED_SURFACES = new Set(['chatgpt-web', 'chatgpt-app', 'battle-bridge', 'shared-workspace']);
const MAX_ITEMS = 128;
const MAX_TEXT = 6000;
const MAX_SERIALIZED_BYTES = 192 * 1024;
const SECRET_SHAPED_TEXT =
  /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+)/i;
const PSYCHOLOGICAL_PROFILE =
  /\b(?:psychological profile|mental diagnosis|personality disorder|intelligence score|iq score|mental state inference)\b/i;
const HIGH_SENSITIVITY =
  /\b(?:medical diagnosis|health condition|sexual life|sexual orientation|religious belief|racial identity|ethnic identity|political affiliation|trade union|criminal history)\b/i;

const INPUT_KEYS = Object.freeze([
  'observedAtUtc',
  'operatorConsent',
  'items',
]);
const CONSENT_KEYS = Object.freeze([
  'visibilityAllowed',
  'learningCandidatesAllowed',
  'durableLearningAllowed',
  'scope',
]);
const ITEM_KEYS = Object.freeze([
  'chatId',
  'messageId',
  'role',
  'sourceSurface',
  'createdAtUtc',
  'text',
  'knowledgeClass',
  'retentionIntent',
  'explicitOperatorTeaching',
  'supersedesKnowledgeId',
  'sourceRefs',
]);

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  correctionAllowed: false,
  forgetAllowed: false,
  providerPromptUseAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactIso(value) {
  if (typeof value !== 'string' || !value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function exactObject(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort(compareText);
    const expected = [...keys].sort(compareText);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return null;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function denseRefs(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 32) return null;
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') return null;
      const ref = value[index].trim();
      if (!SAFE_REF.test(ref) || ref.includes('..')) return null;
      output.push(ref);
    }
    return Object.freeze([...new Set(output)]);
  } catch {
    return null;
  }
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : '';
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeHold(errors) {
  return Object.freeze({
    schemaVersion: STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION,
    projectionKind: 'OPERATOR_KNOWLEDGE_TWIN',
    twinId: '',
    observedAtUtc: '',
    visibilityScope: '',
    visibleItems: Object.freeze([]),
    knowledgeCandidates: Object.freeze([]),
    durableTeachingCandidates: Object.freeze([]),
    historicalLinks: Object.freeze([]),
    omissions: Object.freeze([]),
    authority: AUTHORITY,
    valid: false,
    verdict: 'SAFE_HOLD',
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function normalizeItem(value, index, observedAtMs, consent, errors, omissions) {
  const item = exactObject(value, ITEM_KEYS);
  const prefix = `item-${index + 1}`;
  if (!item) {
    errors.push(`${prefix}:invalid-exact-data-shape`);
    return null;
  }

  const chatId = safeId(item.chatId);
  const messageId = safeId(item.messageId);
  const role = typeof item.role === 'string' ? item.role.trim().toLowerCase() : '';
  const sourceSurface = typeof item.sourceSurface === 'string' ? item.sourceSurface.trim() : '';
  const createdAtMs = exactIso(item.createdAtUtc);
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  const knowledgeClass = typeof item.knowledgeClass === 'string' ? item.knowledgeClass.trim() : '';
  const retentionIntent = typeof item.retentionIntent === 'string' ? item.retentionIntent.trim() : '';
  const refs = denseRefs(item.sourceRefs);
  const supersedesKnowledgeId = item.supersedesKnowledgeId === ''
    ? ''
    : safeId(item.supersedesKnowledgeId);

  if (!chatId) errors.push(`${prefix}:chatId-invalid`);
  if (!messageId) errors.push(`${prefix}:messageId-invalid`);
  if (!ALLOWED_ROLES.has(role)) errors.push(`${prefix}:role-invalid`);
  if (!ALLOWED_SURFACES.has(sourceSurface)) errors.push(`${prefix}:sourceSurface-invalid`);
  if (createdAtMs === null || createdAtMs > observedAtMs) errors.push(`${prefix}:createdAtUtc-invalid-or-future`);
  if (!text || text.length > MAX_TEXT) errors.push(`${prefix}:text-invalid`);
  if (SECRET_SHAPED_TEXT.test(text)) errors.push(`${prefix}:secret-shaped-text-blocked`);
  if (PSYCHOLOGICAL_PROFILE.test(text)) errors.push(`${prefix}:psychological-profile-content-blocked`);
  if (!Object.values(STEPHANOS_OPERATOR_KNOWLEDGE_CLASS).includes(knowledgeClass)) errors.push(`${prefix}:knowledgeClass-invalid`);
  if (!Object.values(STEPHANOS_OPERATOR_RETENTION_INTENT).includes(retentionIntent)) errors.push(`${prefix}:retentionIntent-invalid`);
  if (typeof item.explicitOperatorTeaching !== 'boolean') errors.push(`${prefix}:explicitOperatorTeaching-invalid`);
  if (!refs) errors.push(`${prefix}:sourceRefs-invalid`);
  if (item.supersedesKnowledgeId !== '' && !supersedesKnowledgeId) errors.push(`${prefix}:supersedesKnowledgeId-invalid`);

  if (item.explicitOperatorTeaching && role !== 'operator') {
    errors.push(`${prefix}:explicit-teaching-must-be-operator`);
  }
  if (retentionIntent !== STEPHANOS_OPERATOR_RETENTION_INTENT.CONTEXT_ONLY && !consent.learningCandidatesAllowed) {
    errors.push(`${prefix}:learning-candidate-consent-required`);
  }
  if (retentionIntent === STEPHANOS_OPERATOR_RETENTION_INTENT.REMEMBER_DURABLY && !consent.durableLearningAllowed) {
    errors.push(`${prefix}:durable-learning-consent-required`);
  }
  if (retentionIntent === STEPHANOS_OPERATOR_RETENTION_INTENT.REMEMBER_DURABLY && !item.explicitOperatorTeaching) {
    errors.push(`${prefix}:durable-learning-requires-explicit-operator-teaching`);
  }
  if (retentionIntent === STEPHANOS_OPERATOR_RETENTION_INTENT.REMEMBER_DURABLY && knowledgeClass === 'NONE') {
    errors.push(`${prefix}:durable-learning-requires-knowledge-class`);
  }

  const sensitivity = HIGH_SENSITIVITY.test(text) ? 'HIGH' : 'NORMAL';
  if (sensitivity === 'HIGH' && retentionIntent !== STEPHANOS_OPERATOR_RETENTION_INTENT.CONTEXT_ONLY) {
    omissions.push(`${prefix}:high-sensitivity-not-promoted-by-default`);
  }

  if (errors.some((error) => error.startsWith(`${prefix}:`))) return null;

  const knowledgeId = `knowledge-${digest({ chatId, messageId, role, createdAtUtc: item.createdAtUtc, text, knowledgeClass }).slice(0, 24)}`;
  const eligibleForCandidate = role === 'operator'
    && knowledgeClass !== 'NONE'
    && retentionIntent !== STEPHANOS_OPERATOR_RETENTION_INTENT.CONTEXT_ONLY
    && sensitivity !== 'HIGH';
  const eligibleForDurableTeaching = eligibleForCandidate
    && item.explicitOperatorTeaching
    && retentionIntent === STEPHANOS_OPERATOR_RETENTION_INTENT.REMEMBER_DURABLY;

  return Object.freeze({
    chatId,
    messageId,
    role,
    sourceSurface,
    createdAtUtc: item.createdAtUtc,
    createdAtMs,
    text,
    knowledgeClass,
    retentionIntent,
    explicitOperatorTeaching: item.explicitOperatorTeaching,
    supersedesKnowledgeId,
    sourceRefs: refs,
    sensitivity,
    knowledgeId,
    eligibleForCandidate,
    eligibleForDurableTeaching,
  });
}

function candidateFrom(item) {
  return Object.freeze({
    knowledgeId: item.knowledgeId,
    subjectRef: 'operator://stephan',
    knowledgeClass: item.knowledgeClass,
    summary: item.text,
    origin: 'OPERATOR_TEACHING',
    authorityClass: 'PENDING_LOCAL_INTENT',
    currentState: 'CURRENT',
    observedAtUtc: item.createdAtUtc,
    supersedesKnowledgeId: item.supersedesKnowledgeId,
    sourceRefs: Object.freeze([
      `chat://${item.chatId}`,
      `message://${item.messageId}`,
      ...item.sourceRefs,
    ]),
    durablePromotionRequested: item.eligibleForDurableTeaching,
    promotionStillRequiresMemoryGovernance: true,
  });
}

export function buildStephanosOperatorKnowledgeTwinV1(input = {}) {
  const top = exactObject(input, INPUT_KEYS);
  if (!top) return safeHold(['input-invalid-exact-data-shape']);

  const errors = [];
  const omissions = [];
  const observedAtMs = exactIso(top.observedAtUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');

  const consent = exactObject(top.operatorConsent, CONSENT_KEYS);
  if (!consent) errors.push('operatorConsent-invalid-exact-data-shape');
  if (consent) {
    if (consent.visibilityAllowed !== true) errors.push('operator-visibility-consent-required');
    if (typeof consent.learningCandidatesAllowed !== 'boolean') errors.push('learningCandidatesAllowed-invalid');
    if (typeof consent.durableLearningAllowed !== 'boolean') errors.push('durableLearningAllowed-invalid');
    if (!Object.values(STEPHANOS_OPERATOR_KNOWLEDGE_SCOPE).includes(consent.scope)) errors.push('scope-invalid');
  }

  let itemsArrayValid = false;
  try {
    itemsArrayValid = Array.isArray(top.items)
      && Object.getPrototypeOf(top.items) === Array.prototype
      && top.items.length >= 1
      && top.items.length <= MAX_ITEMS
      && Object.keys(Object.getOwnPropertyDescriptors(top.items)).length === top.items.length + 1;
  } catch {
    itemsArrayValid = false;
  }
  if (!itemsArrayValid) errors.push('items-must-be-dense-bounded-array');

  if (errors.length) return safeHold(errors);

  const normalized = [];
  for (let index = 0; index < top.items.length; index += 1) {
    const item = normalizeItem(top.items[index], index, observedAtMs, consent, errors, omissions);
    if (item) normalized.push(item);
  }

  const messageKeys = normalized.map((item) => `${item.chatId}:${item.messageId}`);
  if (new Set(messageKeys).size !== messageKeys.length) errors.push('chat-message-identities-must-be-unique');
  const knowledgeIds = normalized.map((item) => item.knowledgeId);
  if (new Set(knowledgeIds).size !== knowledgeIds.length) errors.push('knowledge-identities-must-be-unique');

  const byKnowledgeId = new Map(normalized.map((item) => [item.knowledgeId, item]));
  const historicalLinks = [];
  for (const item of normalized) {
    if (!item.supersedesKnowledgeId) continue;
    const prior = byKnowledgeId.get(item.supersedesKnowledgeId);
    if (!prior) {
      errors.push(`knowledge-${item.knowledgeId}:supersedes-missing-from-packet`);
      continue;
    }
    if (prior.knowledgeId === item.knowledgeId) errors.push(`knowledge-${item.knowledgeId}:cannot-supersede-self`);
    if (prior.knowledgeClass !== item.knowledgeClass && item.knowledgeClass !== 'CORRECTION') {
      errors.push(`knowledge-${item.knowledgeId}:supersession-class-mismatch`);
    }
    historicalLinks.push(Object.freeze({
      olderKnowledgeId: prior.knowledgeId,
      newerKnowledgeId: item.knowledgeId,
      relation: 'SUPERSEDED_BY',
    }));
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (serializedBytes > MAX_SERIALIZED_BYTES) errors.push('serialized-size-exceeds-bound');
  if (errors.length) return safeHold(errors);

  const visibleItems = [...normalized]
    .sort((left, right) => left.createdAtMs - right.createdAtMs || compareText(left.messageId, right.messageId))
    .map((item) => Object.freeze({
      chatId: item.chatId,
      messageId: item.messageId,
      role: item.role,
      sourceSurface: item.sourceSurface,
      createdAtUtc: item.createdAtUtc,
      text: item.text,
      knowledgeId: item.knowledgeId,
      knowledgeClass: item.knowledgeClass,
      retentionIntent: item.retentionIntent,
      sensitivity: item.sensitivity,
      sourceRefs: item.sourceRefs,
    }));

  const knowledgeCandidates = normalized.filter((item) => item.eligibleForCandidate).map(candidateFrom);
  const durableTeachingCandidates = normalized.filter((item) => item.eligibleForDurableTeaching).map(candidateFrom);

  const payload = {
    schemaVersion: STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION,
    observedAtUtc: top.observedAtUtc,
    visibilityScope: consent.scope,
    visibleItems,
    knowledgeCandidates,
    durableTeachingCandidates,
    historicalLinks,
  };

  return Object.freeze({
    schemaVersion: STEPHANOS_OPERATOR_KNOWLEDGE_TWIN_SCHEMA_VERSION,
    projectionKind: 'OPERATOR_KNOWLEDGE_TWIN',
    twinId: `operator-twin-${digest(payload).slice(0, 24)}`,
    observedAtUtc: top.observedAtUtc,
    visibilityScope: consent.scope,
    visibleItems: Object.freeze(visibleItems),
    knowledgeCandidates: Object.freeze(knowledgeCandidates),
    durableTeachingCandidates: Object.freeze(durableTeachingCandidates),
    historicalLinks: Object.freeze(historicalLinks),
    omissions: Object.freeze([...new Set(omissions)]),
    authority: AUTHORITY,
    valid: true,
    verdict: durableTeachingCandidates.length
      ? 'READY_WITH_DURABLE_TEACHING_CANDIDATES'
      : (knowledgeCandidates.length ? 'READY_WITH_LEARNING_CANDIDATES' : 'READY_CONTEXT_ONLY'),
    validationErrors: Object.freeze([]),
  });
}
