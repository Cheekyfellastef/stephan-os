import { createHash } from 'node:crypto';

export const STEPHANOS_WORKING_MEMORY_INPUT_SCHEMA_VERSION =
  'stephanos.working-memory-session-input.v1';
export const STEPHANOS_WORKING_MEMORY_ITEM_SCHEMA_VERSION =
  'stephanos.working-memory-item.v1';
export const STEPHANOS_WORKING_MEMORY_PROJECTION_SCHEMA_VERSION =
  'stephanos.working-memory-session-projection.v1';

export const STEPHANOS_WORKING_MEMORY_ITEM_TYPES = Object.freeze([
  'TASK_STATE',
  'IMMEDIATE_FACT',
  'HYPOTHESIS',
  'OPEN_LOOP',
  'OPERATOR_PREFERENCE',
]);
export const STEPHANOS_WORKING_MEMORY_TRUTH_CLASSES = Object.freeze([
  'CONFIRMED',
  'INFERRED',
  'UNKNOWN',
]);
export const STEPHANOS_WORKING_MEMORY_SOURCE_CLASSES = Object.freeze([
  'OPERATOR_SUPPLIED',
  'SYSTEM_OBSERVED',
  'CANONICAL_PROJECT_EVIDENCE',
  'MODEL_INFERENCE',
  'UNKNOWN',
]);
export const STEPHANOS_WORKING_MEMORY_STATUSES = Object.freeze([
  'ACTIVE',
  'BLOCKED',
  'RESOLVED',
  'REJECTED',
  'SUPERSEDED',
]);
export const STEPHANOS_WORKING_MEMORY_SENSITIVITY_CLASSES = Object.freeze([
  'TRANSIENT_TASK',
  'PROJECT_CONTEXT',
  'OPERATOR_PREFERENCE',
  'OMITTED_SENSITIVE',
]);
export const STEPHANOS_WORKING_MEMORY_RETENTION_CLASS = 'WORKING_SESSION_ONLY';
export const STEPHANOS_WORKING_MEMORY_SOURCE_SESSION_SCHEMA_VERSION = 1;

export const STEPHANOS_WORKING_MEMORY_MAX_ITEMS = 64;
export const STEPHANOS_WORKING_MEMORY_MAX_SOURCE_REFS = 8;
export const STEPHANOS_WORKING_MEMORY_MAX_SESSION_MS = 8 * 60 * 60 * 1000;
export const STEPHANOS_WORKING_MEMORY_FRESH_AFTER_MS = 30 * 60 * 1000;
export const STEPHANOS_WORKING_MEMORY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const STEPHANOS_WORKING_MEMORY_MAX_INPUT_BYTES = 128 * 1024;
export const STEPHANOS_WORKING_MEMORY_MAX_PROJECTION_BYTES = 96 * 1024;
export const STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_ITEMS = 24;
export const STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_BYTES = 32 * 1024;

const MAX_DATE_MS = 8_640_000_000_000_000;
const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'sessionId',
  'actorId',
  'surfaceId',
  'startedAtUtc',
  'updatedAtUtc',
  'expiresAtUtc',
  'sourceSessionMemorySchemaVersion',
  'items',
]);
const OPTION_KEYS = Object.freeze(['evaluationNowMs']);
const ITEM_KEYS = Object.freeze([
  'schemaVersion',
  'itemId',
  'itemType',
  'truthClass',
  'sourceClass',
  'status',
  'summary',
  'observedAtUtc',
  'validUntilUtc',
  'sourceRefs',
  'relatedGoalRef',
  'relatedPrRef',
  'confidence',
  'sensitivityClass',
  'retentionClass',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_PR_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_SOURCE_REF =
  /^(?:issue|pr|receipt|evidence|workspace|memory|operator|runtime|project):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/;
const SENSITIVE_TEXT =
  /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|account[-_ ]?(?:number|no|id)|sort[-_ ]?code|iban|swift|identity document|raw prompt|raw response|psychological profile|mental diagnosis)\b/i;
const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LONG_DIGIT_SEQUENCE = /(?:^|\D)\d{8,}(?:\D|$)/;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\)/;

const ITEM_TYPES = new Set(STEPHANOS_WORKING_MEMORY_ITEM_TYPES);
const TRUTH_CLASSES = new Set(STEPHANOS_WORKING_MEMORY_TRUTH_CLASSES);
const SOURCE_CLASSES = new Set(STEPHANOS_WORKING_MEMORY_SOURCE_CLASSES);
const STATUSES = new Set(STEPHANOS_WORKING_MEMORY_STATUSES);
const SENSITIVITY_CLASSES = new Set(STEPHANOS_WORKING_MEMORY_SENSITIVITY_CLASSES);
const SNAPSHOT_INVALID = Symbol('SNAPSHOT_INVALID');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  sharedAuthorityClaimAllowed: false,
  correctionAllowed: false,
  forgetAllowed: false,
  providerPromptUseAllowed: false,
  commandExecutionAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function snapshotExactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return SNAPSHOT_INVALID;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return SNAPSHOT_INVALID;
    if (Object.getOwnPropertySymbols(value).length > 0) return SNAPSHOT_INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) return SNAPSHOT_INVALID;
    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get ||
        descriptor.set
      ) {
        return SNAPSHOT_INVALID;
      }
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return SNAPSHOT_INVALID;
  }
}

function snapshotDenseArray(value, maximumLength, snapshotEntry = (entry) => entry) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return SNAPSHOT_INVALID;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return SNAPSHOT_INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    ) {
      return SNAPSHOT_INVALID;
    }
    const length = lengthDescriptor.value;
    const expectedKeys = ['length', ...Array.from({ length }, (_, index) => String(index))]
      .sort(compareText);
    const actualKeys = Object.keys(descriptors).sort(compareText);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return SNAPSHOT_INVALID;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get ||
        descriptor.set
      ) {
        return SNAPSHOT_INVALID;
      }
      const entry = snapshotEntry(descriptor.value, index);
      if (entry === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
      output.push(entry);
    }
    return Object.freeze(output);
  } catch {
    return SNAPSHOT_INVALID;
  }
}

function snapshotStringArray(value, maximumLength) {
  return snapshotDenseArray(value, maximumLength, (entry) =>
    typeof entry === 'string' ? entry : SNAPSHOT_INVALID,
  );
}

function snapshotItem(value) {
  const item = snapshotExactObject(value, ITEM_KEYS);
  if (item === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  const sourceRefs = snapshotStringArray(item.sourceRefs, STEPHANOS_WORKING_MEMORY_MAX_SOURCE_REFS);
  if (sourceRefs === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  const output = Object.create(null);
  for (const key of ITEM_KEYS) {
    const fieldValue = key === 'sourceRefs' ? sourceRefs : item[key];
    if (key !== 'sourceRefs' && fieldValue !== null && typeof fieldValue === 'object') {
      return SNAPSHOT_INVALID;
    }
    Object.defineProperty(output, key, {
      value: fieldValue,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function snapshotInput(value) {
  const input = snapshotExactObject(value, TOP_LEVEL_KEYS);
  if (input === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  const items = snapshotDenseArray(input.items, STEPHANOS_WORKING_MEMORY_MAX_ITEMS, snapshotItem);
  if (items === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    sessionId: input.sessionId,
    actorId: input.actorId,
    surfaceId: input.surfaceId,
    startedAtUtc: input.startedAtUtc,
    updatedAtUtc: input.updatedAtUtc,
    expiresAtUtc: input.expiresAtUtc,
    sourceSessionMemorySchemaVersion: input.sourceSessionMemorySchemaVersion,
    items,
  });
}

function snapshotOptions(value) {
  const options = snapshotExactObject(value, OPTION_KEYS);
  if (options === SNAPSHOT_INVALID) return SNAPSHOT_INVALID;
  return Object.freeze({ evaluationNowMs: options.evaluationNowMs });
}

function validEvaluationNowMs(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString() === value ? milliseconds : null;
  } catch {
    return null;
  }
}

function containsSensitiveText(value) {
  return typeof value === 'string' && (
    SENSITIVE_TEXT.test(value) ||
    EMAIL_LIKE.test(value) ||
    LONG_DIGIT_SEQUENCE.test(value) ||
    LOCAL_PATH.test(value)
  );
}

function boundedText(value, maximumLength) {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !containsSensitiveText(value)
  );
}

function safeSourceRef(value) {
  return (
    typeof value === 'string' &&
    SAFE_SOURCE_REF.test(value) &&
    !value.includes('..') &&
    !containsSensitiveText(value)
  );
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function truthSourceCompatible(truthClass, sourceClass) {
  if (truthClass === 'CONFIRMED') {
    return ['OPERATOR_SUPPLIED', 'SYSTEM_OBSERVED', 'CANONICAL_PROJECT_EVIDENCE'].includes(sourceClass);
  }
  if (truthClass === 'INFERRED') {
    return ['MODEL_INFERENCE', 'SYSTEM_OBSERVED', 'CANONICAL_PROJECT_EVIDENCE'].includes(sourceClass);
  }
  return ['UNKNOWN', 'MODEL_INFERENCE', 'SYSTEM_OBSERVED'].includes(sourceClass);
}

function invalidProjection(errors, partial = {}) {
  return deepFreeze({
    schemaVersion: STEPHANOS_WORKING_MEMORY_PROJECTION_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_WORKING_MEMORY_SESSION',
    projectionId: '',
    sessionId: partial.sessionId || '',
    evaluatedAtUtc: partial.evaluatedAtUtc || '',
    sessionState: 'INVALID',
    freshness: 'UNKNOWN',
    verdict: 'SAFE_HOLD',
    items: [],
    contextPack: {
      items: [],
      selectionReasons: [],
      omittedSensitiveCount: 0,
      omittedStaleCount: 0,
      omittedInactiveCount: 0,
      budget: {
        maxItems: STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_ITEMS,
        maxBytes: STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_BYTES,
        actualItems: 0,
        actualBytes: 0,
      },
    },
    counts: {
      total: 0,
      active: 0,
      blocked: 0,
      resolved: 0,
      rejected: 0,
      superseded: 0,
      confirmed: 0,
      inferred: 0,
      unknown: 0,
      stale: 0,
      replayedDuplicates: 0,
    },
    memoryAdequacyObservationCandidate: null,
    limitations: [],
    unknowns: [],
    authority: AUTHORITY,
    valid: false,
    validationErrors: [...errors],
  });
}

function validateItem(item, context) {
  const errors = [];
  if (item.schemaVersion !== STEPHANOS_WORKING_MEMORY_ITEM_SCHEMA_VERSION) {
    errors.push('item-schema-version-mismatch');
  }
  if (!SAFE_ID.test(item.itemId || '')) errors.push('itemId-invalid');
  if (!ITEM_TYPES.has(item.itemType)) errors.push('itemType-invalid');
  if (!TRUTH_CLASSES.has(item.truthClass)) errors.push('truthClass-invalid');
  if (!SOURCE_CLASSES.has(item.sourceClass)) errors.push('sourceClass-invalid');
  if (!STATUSES.has(item.status)) errors.push('status-invalid');
  if (!SENSITIVITY_CLASSES.has(item.sensitivityClass)) errors.push('sensitivityClass-invalid');
  if (item.retentionClass !== STEPHANOS_WORKING_MEMORY_RETENTION_CLASS) {
    errors.push('retentionClass-must-be-working-session-only');
  }
  if (!boundedText(item.summary, 500)) errors.push('summary-invalid');
  if (TRUTH_CLASSES.has(item.truthClass) && SOURCE_CLASSES.has(item.sourceClass)
      && !truthSourceCompatible(item.truthClass, item.sourceClass)) {
    errors.push('truth-source-mismatch');
  }
  if (item.itemType === 'HYPOTHESIS' && item.truthClass === 'CONFIRMED') {
    errors.push('hypothesis-cannot-be-confirmed');
  }
  if (item.itemType === 'OPERATOR_PREFERENCE'
      && (item.truthClass !== 'CONFIRMED' || item.sourceClass !== 'OPERATOR_SUPPLIED')) {
    errors.push('operator-preference-requires-explicit-operator-confirmation');
  }
  if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
    errors.push('confidence-invalid');
  } else {
    if (item.truthClass === 'CONFIRMED' && item.confidence < 0.8) {
      errors.push('confirmed-confidence-too-low');
    }
    if (item.truthClass === 'UNKNOWN' && item.confidence !== 0) {
      errors.push('unknown-confidence-must-be-zero');
    }
  }
  if (item.relatedGoalRef !== null && !SAFE_GOAL_REF.test(item.relatedGoalRef)) {
    errors.push('relatedGoalRef-invalid');
  }
  if (item.relatedPrRef !== null && !SAFE_PR_REF.test(item.relatedPrRef)) {
    errors.push('relatedPrRef-invalid');
  }
  if (item.sourceRefs.length > STEPHANOS_WORKING_MEMORY_MAX_SOURCE_REFS) {
    errors.push('sourceRefs-too-many');
  }
  if (item.sourceRefs.some((reference) => !safeSourceRef(reference))) {
    errors.push('sourceRef-unsafe');
  }
  if (new Set(item.sourceRefs).size !== item.sourceRefs.length) {
    errors.push('sourceRefs-duplicate');
  }
  if (['CONFIRMED', 'INFERRED'].includes(item.truthClass) && item.sourceRefs.length === 0) {
    errors.push('grounded-item-requires-source-ref');
  }
  const observedAtMs = canonicalTimestamp(item.observedAtUtc);
  const validUntilMs = item.validUntilUtc === null ? null : canonicalTimestamp(item.validUntilUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');
  if (item.validUntilUtc !== null && validUntilMs === null) errors.push('validUntilUtc-invalid');
  if (observedAtMs !== null) {
    if (observedAtMs < context.startedAtMs) errors.push('observed-before-session-start');
    if (observedAtMs > context.updatedAtMs + STEPHANOS_WORKING_MEMORY_MAX_FUTURE_SKEW_MS) {
      errors.push('observed-after-session-update');
    }
    if (observedAtMs > context.evaluationNowMs + STEPHANOS_WORKING_MEMORY_MAX_FUTURE_SKEW_MS) {
      errors.push('observed-materially-future');
    }
    if (observedAtMs >= context.expiresAtMs) errors.push('observed-at-or-after-session-expiry');
  }
  if (validUntilMs !== null && observedAtMs !== null) {
    if (validUntilMs < observedAtMs) errors.push('valid-until-before-observed');
    if (validUntilMs > context.expiresAtMs) errors.push('valid-until-after-session-expiry');
  }
  if (item.sensitivityClass === 'OMITTED_SENSITIVE' && item.sourceRefs.length > 0) {
    errors.push('omitted-sensitive-item-must-not-carry-source-refs');
  }
  if (containsSensitiveText(item.itemId)
      || containsSensitiveText(item.summary)
      || item.sourceRefs.some(containsSensitiveText)) {
    errors.push('sensitive-content-rejected');
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    observedAtMs,
    validUntilMs,
  });
}

function itemTypePriority(itemType) {
  return {
    TASK_STATE: 0,
    OPEN_LOOP: 1,
    OPERATOR_PREFERENCE: 2,
    IMMEDIATE_FACT: 3,
    HYPOTHESIS: 4,
  }[itemType] ?? 99;
}

function buildProjectionInternal(input, options) {
  const snapshot = snapshotInput(input);
  const validatedOptions = snapshotOptions(options);
  if (snapshot === SNAPSHOT_INVALID) {
    return invalidProjection(['input-must-be-exact-dense-data-only-shape']);
  }
  if (validatedOptions === SNAPSHOT_INVALID) {
    return invalidProjection(['validation-options-mismatch']);
  }
  const evaluationNowMs = validatedOptions.evaluationNowMs;
  if (!validEvaluationNowMs(evaluationNowMs)) {
    return invalidProjection(['evaluationNowMs-invalid']);
  }
  const evaluatedAtUtc = new Date(evaluationNowMs).toISOString();
  const errors = [];
  if (snapshot.schemaVersion !== STEPHANOS_WORKING_MEMORY_INPUT_SCHEMA_VERSION) {
    errors.push('input-schema-version-mismatch');
  }
  for (const [field, value] of [
    ['sessionId', snapshot.sessionId],
    ['actorId', snapshot.actorId],
    ['surfaceId', snapshot.surfaceId],
  ]) {
    if (!SAFE_ID.test(value || '') || containsSensitiveText(value)) errors.push(`${field}-invalid`);
  }
  if (snapshot.sourceSessionMemorySchemaVersion
      !== STEPHANOS_WORKING_MEMORY_SOURCE_SESSION_SCHEMA_VERSION) {
    errors.push('sourceSessionMemorySchemaVersion-incompatible');
  }
  const startedAtMs = canonicalTimestamp(snapshot.startedAtUtc);
  const updatedAtMs = canonicalTimestamp(snapshot.updatedAtUtc);
  const expiresAtMs = canonicalTimestamp(snapshot.expiresAtUtc);
  if (startedAtMs === null) errors.push('startedAtUtc-invalid');
  if (updatedAtMs === null) errors.push('updatedAtUtc-invalid');
  if (expiresAtMs === null) errors.push('expiresAtUtc-invalid');
  if (startedAtMs !== null && updatedAtMs !== null && updatedAtMs < startedAtMs) {
    errors.push('updated-before-started');
  }
  if (updatedAtMs !== null && expiresAtMs !== null && expiresAtMs <= updatedAtMs) {
    errors.push('expires-not-after-updated');
  }
  if (startedAtMs !== null && expiresAtMs !== null
      && expiresAtMs - startedAtMs > STEPHANOS_WORKING_MEMORY_MAX_SESSION_MS) {
    errors.push('session-duration-exceeds-canonical-bound');
  }
  if (updatedAtMs !== null
      && updatedAtMs > evaluationNowMs + STEPHANOS_WORKING_MEMORY_MAX_FUTURE_SKEW_MS) {
    errors.push('updated-materially-future');
  }
  let inputBytes = 0;
  try {
    inputBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  } catch {
    errors.push('input-not-serializable');
  }
  if (inputBytes > STEPHANOS_WORKING_MEMORY_MAX_INPUT_BYTES) errors.push('input-too-large');
  if (errors.length > 0 || startedAtMs === null || updatedAtMs === null || expiresAtMs === null) {
    return invalidProjection(errors, { sessionId: snapshot.sessionId || '', evaluatedAtUtc });
  }

  const context = { evaluationNowMs, startedAtMs, updatedAtMs, expiresAtMs };
  const accepted = [];
  snapshot.items.forEach((item, index) => {
    const verdict = validateItem(item, context);
    if (!verdict.valid) {
      errors.push(...verdict.errors.map((error) => `items[${index}]:${error}`));
    } else {
      accepted.push({ item, observedAtMs: verdict.observedAtMs, validUntilMs: verdict.validUntilMs });
    }
  });

  const byId = new Map();
  const uniqueItems = [];
  let replayedDuplicates = 0;
  for (const entry of accepted) {
    const canonical = JSON.stringify(entry.item);
    if (byId.has(entry.item.itemId)) {
      if (byId.get(entry.item.itemId) === canonical) {
        replayedDuplicates += 1;
        continue;
      }
      errors.push(`conflicting-duplicate-itemId:${entry.item.itemId}`);
      continue;
    }
    byId.set(entry.item.itemId, canonical);
    uniqueItems.push(entry);
  }
  if (errors.length > 0) {
    return invalidProjection(errors, { sessionId: snapshot.sessionId, evaluatedAtUtc });
  }

  const sessionExpired = evaluationNowMs >= expiresAtMs;
  const projectedItems = uniqueItems.map(({ item, observedAtMs, validUntilMs }) => {
    const canonicalValidUntilMs = Math.min(
      validUntilMs ?? (observedAtMs + STEPHANOS_WORKING_MEMORY_FRESH_AFTER_MS),
      expiresAtMs,
    );
    const stale = sessionExpired || evaluationNowMs >= canonicalValidUntilMs;
    return Object.freeze({
      ...item,
      observedAtMs,
      derivedValidUntilUtc: new Date(canonicalValidUntilMs).toISOString(),
      derivedFreshness: stale ? 'STALE' : 'CURRENT',
      stale,
    });
  }).sort((left, right) => compareText(left.itemId, right.itemId));

  const inactiveStatuses = new Set(['RESOLVED', 'REJECTED', 'SUPERSEDED']);
  const eligible = projectedItems.filter((item) =>
    !item.stale
    && !inactiveStatuses.has(item.status)
    && item.sensitivityClass !== 'OMITTED_SENSITIVE',
  );
  const orderedEligible = [...eligible].sort((left, right) =>
    itemTypePriority(left.itemType) - itemTypePriority(right.itemType)
    || right.observedAtMs - left.observedAtMs
    || compareText(left.itemId, right.itemId),
  );
  const selected = [];
  let contextBytes = Buffer.byteLength('[]', 'utf8');
  for (const item of orderedEligible) {
    if (selected.length >= STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_ITEMS) break;
    const compact = Object.freeze({
      itemId: item.itemId,
      itemType: item.itemType,
      truthClass: item.truthClass,
      sourceClass: item.sourceClass,
      status: item.status,
      summary: item.summary,
      observedAtUtc: item.observedAtUtc,
      sourceRefs: item.sourceRefs,
      relatedGoalRef: item.relatedGoalRef,
      relatedPrRef: item.relatedPrRef,
      confidence: item.confidence,
    });
    const candidateBytes = Buffer.byteLength(JSON.stringify([...selected, compact]), 'utf8');
    if (candidateBytes > STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_BYTES) continue;
    selected.push(compact);
    contextBytes = candidateBytes;
  }

  const count = (predicate) => projectedItems.filter(predicate).length;
  const counts = Object.freeze({
    total: projectedItems.length,
    active: count((item) => item.status === 'ACTIVE'),
    blocked: count((item) => item.status === 'BLOCKED'),
    resolved: count((item) => item.status === 'RESOLVED'),
    rejected: count((item) => item.status === 'REJECTED'),
    superseded: count((item) => item.status === 'SUPERSEDED'),
    confirmed: count((item) => item.truthClass === 'CONFIRMED'),
    inferred: count((item) => item.truthClass === 'INFERRED'),
    unknown: count((item) => item.truthClass === 'UNKNOWN'),
    stale: count((item) => item.stale),
    replayedDuplicates,
  });
  const withRefs = projectedItems.filter((item) => item.sourceRefs.length > 0).length;
  const retrievalCoverage = projectedItems.length > 0
    ? Math.round((withRefs / projectedItems.length) * 10_000) / 10_000
    : 0;
  const core = {
    schemaVersion: STEPHANOS_WORKING_MEMORY_PROJECTION_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_WORKING_MEMORY_SESSION',
    sessionId: snapshot.sessionId,
    actorId: snapshot.actorId,
    surfaceId: snapshot.surfaceId,
    sourceSessionMemorySchemaVersion: snapshot.sourceSessionMemorySchemaVersion,
    evaluatedAtUtc,
    startedAtUtc: snapshot.startedAtUtc,
    updatedAtUtc: snapshot.updatedAtUtc,
    expiresAtUtc: snapshot.expiresAtUtc,
    sessionState: sessionExpired ? 'EXPIRED' : (counts.stale > 0 ? 'STALE_OR_MIXED' : 'ACTIVE'),
    freshness: sessionExpired
      ? 'EXPIRED'
      : (projectedItems.length === 0 ? 'EMPTY' : (counts.stale > 0 ? 'MIXED' : 'FRESH')),
    verdict: sessionExpired
      ? 'WORKING_MEMORY_SESSION_EXPIRED'
      : (selected.length > 0 ? 'WORKING_CONTEXT_AVAILABLE' : 'NO_CURRENT_WORKING_CONTEXT'),
    items: Object.freeze(projectedItems),
    contextPack: Object.freeze({
      items: Object.freeze(selected),
      selectionReasons: Object.freeze([
        'CURRENT_ONLY',
        'ACTIVE_OR_BLOCKED_ONLY',
        'SENSITIVE_DETAILS_OMITTED',
        'TASK_AND_OPEN_LOOP_PRIORITY',
        'BOUNDED_BY_ITEM_AND_BYTE_BUDGET',
      ]),
      omittedSensitiveCount: count((item) => item.sensitivityClass === 'OMITTED_SENSITIVE'),
      omittedStaleCount: counts.stale,
      omittedInactiveCount: count((item) => inactiveStatuses.has(item.status)),
      budget: Object.freeze({
        maxItems: STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_ITEMS,
        maxBytes: STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_BYTES,
        actualItems: selected.length,
        actualBytes: contextBytes,
      }),
    }),
    counts,
    limitations: Object.freeze([
      'LOCAL_SESSION_PROJECTION_NOT_SHARED_AUTHORITY',
      'NO_DURABLE_PROMOTION_CORRECTION_OR_FORGET_AUTHORITY',
      'NO_EXTERNAL_PROVIDER_PROMPT_AUTHORITY',
    ]),
    unknowns: Object.freeze([
      ...(projectedItems.length === 0 ? ['NO_WORKING_MEMORY_ITEMS'] : []),
      ...(counts.unknown > 0 ? ['UNKNOWN_WORKING_MEMORY_ITEMS_PRESENT'] : []),
      ...(counts.stale > 0 ? ['STALE_WORKING_MEMORY_ITEMS_PRESENT'] : []),
      ...(count((item) => item.itemType === 'TASK_STATE' && !item.stale) === 0
        ? ['CURRENT_TASK_STATE_UNAVAILABLE'] : []),
    ].sort(compareText)),
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  };
  const projectionId = `working-memory-${stableHash(core).slice(0, 24)}`;
  const result = {
    ...core,
    projectionId,
    memoryAdequacyObservationCandidate: Object.freeze({
      domain: 'ephemeral-working-context',
      authorityClass: 'LOCAL_MIRROR',
      recordCount: projectedItems.length,
      approximateBytes: inputBytes,
      observedAtUtc: snapshot.updatedAtUtc,
      source: 'stephanos-working-memory-session-v1',
      retrievalCoverage,
      retentionPolicy: 'ENFORCED',
      deletionState: 'UNKNOWN',
      conflictState: 'UNKNOWN',
      backupState: 'UNKNOWN',
      proofRefs: Object.freeze([`memory/session/${projectionId}`]),
    }),
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > STEPHANOS_WORKING_MEMORY_MAX_PROJECTION_BYTES) {
    return invalidProjection(['projection-too-large'], {
      sessionId: snapshot.sessionId,
      evaluatedAtUtc,
    });
  }
  return deepFreeze(result);
}

export function buildStephanosWorkingMemorySessionProjectionV1(input = {}, options = {}) {
  try {
    return buildProjectionInternal(input, options);
  } catch {
    return invalidProjection(['projection-build-failed-closed']);
  }
}
