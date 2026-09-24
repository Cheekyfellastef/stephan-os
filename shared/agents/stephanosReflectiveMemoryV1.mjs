import { createHash } from 'node:crypto';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_REFLECTIVE_MEMORY_SCHEMA_VERSION = 'stephanos.reflective-memory.v1';
export const STEPHANOS_REFLECTIVE_MEMORY_PROJECTION_VERSION = 'stephanos.reflective-memory-projection.v1';
export const STEPHANOS_REFLECTIVE_MEMORY_MAX_REFLECTIONS = 256;
export const STEPHANOS_REFLECTIVE_MEMORY_MAX_REFS = 24;
export const STEPHANOS_REFLECTIVE_MEMORY_MAX_SERIALIZED_BYTES = 256 * 1024;

export const STEPHANOS_REFLECTIVE_MEMORY_KINDS = Object.freeze([
  'SUCCESS_PATTERN', 'FAILURE_PATTERN', 'RECOVERY_PATTERN', 'CORRECTION_PATTERN',
  'METHOD_CANDIDATE', 'GENERAL_LESSON',
]);
export const STEPHANOS_REFLECTIVE_MEMORY_ORIGINS = Object.freeze([
  'DETERMINISTIC_SYNTHESIS', 'MODEL_SYNTHESIS', 'OPERATOR_TEACHING', 'UNKNOWN',
]);
export const STEPHANOS_REFLECTIVE_MEMORY_PROMOTION = Object.freeze([
  'CONFIRMED', 'CANDIDATE', 'REJECTED', 'UNKNOWN',
]);
export const STEPHANOS_REFLECTIVE_MEMORY_STATES = Object.freeze([
  'CURRENT', 'SUPERSEDED', 'RETIRED', 'UNKNOWN',
]);
export const STEPHANOS_REFLECTIVE_MEMORY_FRESHNESS = Object.freeze([
  'FRESH', 'STALE', 'UNKNOWN', 'CONFLICTING',
]);

const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const KINDS = new Set(STEPHANOS_REFLECTIVE_MEMORY_KINDS);
const ORIGINS = new Set(STEPHANOS_REFLECTIVE_MEMORY_ORIGINS);
const PROMOTION = new Set(STEPHANOS_REFLECTIVE_MEMORY_PROMOTION);
const STATES = new Set(STEPHANOS_REFLECTIVE_MEMORY_STATES);
const FRESHNESS = new Set(STEPHANOS_REFLECTIVE_MEMORY_FRESHNESS);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_REF = /^(?:episode|evidence|proof|lesson|method|goal|issue|pr|project|component|workspace|memory|correction|receipt):\/\/[a-z0-9][a-z0-9._:/#@-]{0,220}$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|raw prompt|raw response|psychological profile|mental diagnosis|personality disorder|hidden motivation|credential)\b/i;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\)/;
const REFLECTION_KEYS = Object.freeze([
  'schemaVersion', 'reflectionId', 'patternKey', 'reflectionKind', 'origin', 'promotionState',
  'patternSummary', 'scopeSummary', 'authorityClass', 'confidence', 'freshness', 'state',
  'createdAtUtc', 'validatedAtUtc', 'lastVerifiedAtUtc', 'sourceEpisodeRefs', 'evidenceRefs',
  'counterexampleRefs', 'derivedCandidateRefs', 'supersedesReflectionId', 'supersededByReflectionId',
]);
const INPUT_KEYS = Object.freeze(['reflections']);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  reflectiveMemoryWriteAllowed: false,
  durablePromotionAllowed: false,
  semanticFactPromotionAllowed: false,
  methodPromotionAllowed: false,
  lessonPromotionAllowed: false,
  schedulerMutationAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  authorityExpansionAllowed: false,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    if (Object.getOwnPropertySymbols(value).length) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return INVALID;
    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function denseStringArray(value, maximum = STEPHANOS_REFLECTIVE_MEMORY_MAX_REFS) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Object.keys(descriptors).length !== length + 1) return INVALID;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || typeof descriptor.value !== 'string') return INVALID;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function safeText(value, maximum) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !SENSITIVE_TEXT.test(value)
    && !LOCAL_PATH.test(value);
}

function safeRef(value) {
  return typeof value === 'string' && SAFE_REF.test(value) && !value.includes('..')
    && !SENSITIVE_TEXT.test(value) && !LOCAL_PATH.test(value);
}

function normalizeOptionalTimestamp(value, field, errors) {
  if (value === null) return null;
  if (!exactTimestamp(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeOptionalId(value, field, errors) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeRefs(value, field, errors) {
  const values = denseStringArray(value);
  if (values === INVALID) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const output = [];
  for (const item of values) {
    if (!safeRef(item)) errors.push(`${field}-contains-unsafe-ref`);
    else output.push(item);
  }
  if (new Set(output).size !== output.length) errors.push(`${field}-contains-duplicate`);
  return output;
}

function normalizeReflection(value, index) {
  const errors = [];
  const reflection = exactObject(value, REFLECTION_KEYS);
  if (reflection === INVALID) return { reflection: null, errors: [`reflection-${index}:invalid-exact-data-shape`] };

  if (reflection.schemaVersion !== STEPHANOS_REFLECTIVE_MEMORY_SCHEMA_VERSION) errors.push('schemaVersion-mismatch');
  if (!SAFE_ID.test(reflection.reflectionId || '')) errors.push('reflectionId-invalid');
  if (!SAFE_ID.test(reflection.patternKey || '')) errors.push('patternKey-invalid');
  const reflectionKind = KINDS.has(reflection.reflectionKind) ? reflection.reflectionKind : 'GENERAL_LESSON';
  if (!KINDS.has(reflection.reflectionKind)) errors.push('reflectionKind-invalid');
  const origin = ORIGINS.has(reflection.origin) ? reflection.origin : 'UNKNOWN';
  if (!ORIGINS.has(reflection.origin)) errors.push('origin-invalid');
  const promotionState = PROMOTION.has(reflection.promotionState) ? reflection.promotionState : 'UNKNOWN';
  if (!PROMOTION.has(reflection.promotionState)) errors.push('promotionState-invalid');
  if (!safeText(reflection.patternSummary, 640)) errors.push('patternSummary-invalid');
  if (!safeText(reflection.scopeSummary, 640)) errors.push('scopeSummary-invalid');

  const authorityClass = AUTHORITY_CLASSES.has(reflection.authorityClass)
    ? reflection.authorityClass : STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
  if (!AUTHORITY_CLASSES.has(reflection.authorityClass)) errors.push('authorityClass-invalid');
  const confidence = typeof reflection.confidence === 'number' && Number.isFinite(reflection.confidence)
    && reflection.confidence >= 0 && reflection.confidence <= 1 ? reflection.confidence : null;
  if (confidence === null) errors.push('confidence-invalid');
  const freshness = FRESHNESS.has(reflection.freshness) ? reflection.freshness : 'UNKNOWN';
  if (!FRESHNESS.has(reflection.freshness)) errors.push('freshness-invalid');
  const state = STATES.has(reflection.state) ? reflection.state : 'UNKNOWN';
  if (!STATES.has(reflection.state)) errors.push('state-invalid');

  if (origin === 'MODEL_SYNTHESIS' && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED) errors.push('model-synthesis-must-remain-inferred');
  if (origin === 'MODEL_SYNTHESIS' && promotionState === 'CONFIRMED') errors.push('model-synthesis-cannot-self-confirm');
  if (promotionState === 'CONFIRMED' && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY) errors.push('confirmed-reflection-requires-shared-authority');

  if (!exactTimestamp(reflection.createdAtUtc)) errors.push('createdAtUtc-invalid');
  const validatedAtUtc = normalizeOptionalTimestamp(reflection.validatedAtUtc, 'validatedAtUtc', errors);
  const lastVerifiedAtUtc = normalizeOptionalTimestamp(reflection.lastVerifiedAtUtc, 'lastVerifiedAtUtc', errors);
  if (promotionState === 'CONFIRMED' && !validatedAtUtc) errors.push('confirmed-reflection-requires-validatedAtUtc');
  if (promotionState !== 'CONFIRMED' && validatedAtUtc) errors.push('nonconfirmed-reflection-cannot-claim-validatedAtUtc');

  const sourceEpisodeRefs = normalizeRefs(reflection.sourceEpisodeRefs, 'sourceEpisodeRefs', errors);
  if (sourceEpisodeRefs.length < 2) errors.push('reflection-requires-at-least-two-source-episodes');
  if (sourceEpisodeRefs.some((ref) => !ref.startsWith('episode://'))) errors.push('sourceEpisodeRefs-must-be-episode-refs');
  const evidenceRefs = normalizeRefs(reflection.evidenceRefs, 'evidenceRefs', errors);
  if (evidenceRefs.length === 0) errors.push('evidenceRefs-required');
  const counterexampleRefs = normalizeRefs(reflection.counterexampleRefs, 'counterexampleRefs', errors);
  const derivedCandidateRefs = normalizeRefs(reflection.derivedCandidateRefs, 'derivedCandidateRefs', errors);
  if (derivedCandidateRefs.some((ref) => !ref.startsWith('method://') && !ref.startsWith('lesson://'))) {
    errors.push('derivedCandidateRefs-must-be-method-or-lesson-refs');
  }

  const supersedesReflectionId = normalizeOptionalId(reflection.supersedesReflectionId, 'supersedesReflectionId', errors);
  const supersededByReflectionId = normalizeOptionalId(reflection.supersededByReflectionId, 'supersededByReflectionId', errors);
  if (supersedesReflectionId === reflection.reflectionId || supersededByReflectionId === reflection.reflectionId) errors.push('reflection-cannot-supersede-itself');
  if (state === 'SUPERSEDED' && !supersededByReflectionId) errors.push('superseded-state-requires-supersededByReflectionId');
  if (state === 'CURRENT' && supersededByReflectionId) errors.push('current-state-cannot-have-supersededByReflectionId');

  return {
    reflection: Object.freeze({
      reflectionId: reflection.reflectionId,
      patternKey: reflection.patternKey,
      reflectionKind,
      origin,
      promotionState,
      patternSummary: reflection.patternSummary,
      scopeSummary: reflection.scopeSummary,
      authorityClass,
      confidence,
      freshness,
      state,
      createdAtUtc: reflection.createdAtUtc,
      validatedAtUtc,
      lastVerifiedAtUtc,
      sourceEpisodeRefs: Object.freeze(sourceEpisodeRefs),
      evidenceRefs: Object.freeze(evidenceRefs),
      counterexampleRefs: Object.freeze(counterexampleRefs),
      derivedCandidateRefs: Object.freeze(derivedCandidateRefs),
      supersedesReflectionId,
      supersededByReflectionId,
    }),
    errors: errors.map((error) => `reflection-${index}:${error}`),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeHold(errors) {
  return deepFreeze({
    schemaVersion: STEPHANOS_REFLECTIVE_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_REFLECTIVE_MEMORY',
    projectionId: '',
    verdict: 'SAFE_HOLD',
    reflections: [],
    confirmedReflections: [],
    candidateReflections: [],
    historicalReflections: [],
    rejectedReflections: [],
    patternConflicts: [],
    authority: AUTHORITY,
    valid: false,
    validationErrors: errors,
  });
}

function projectionId(reflections) {
  return `reflective-${createHash('sha256').update(JSON.stringify(reflections)).digest('hex').slice(0, 32)}`;
}

export function buildStephanosReflectiveMemoryV1(input = {}) {
  const observed = exactObject(input, INPUT_KEYS);
  if (observed === INVALID) return safeHold(['input-invalid-exact-data-shape']);
  let descriptors;
  try {
    if (!Array.isArray(observed.reflections) || Object.getPrototypeOf(observed.reflections) !== Array.prototype) throw new Error();
    descriptors = Object.getOwnPropertyDescriptors(observed.reflections);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > STEPHANOS_REFLECTIVE_MEMORY_MAX_REFLECTIONS || Object.keys(descriptors).length !== length + 1) throw new Error();
  } catch {
    return safeHold(['reflections-must-be-dense-bounded-array']);
  }

  const errors = [];
  const reflections = [];
  for (let index = 0; index < descriptors.length.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      errors.push(`reflection-${index}:must-be-own-enumerable-data-entry`);
      continue;
    }
    const normalized = normalizeReflection(descriptor.value, index);
    errors.push(...normalized.errors);
    if (normalized.reflection) reflections.push(normalized.reflection);
  }

  const ids = reflections.map((reflection) => reflection.reflectionId);
  if (new Set(ids).size !== ids.length) errors.push('reflectionIds-must-be-unique');
  const byId = new Map(reflections.map((reflection) => [reflection.reflectionId, reflection]));
  for (const reflection of reflections) {
    if (reflection.supersedesReflectionId) {
      const prior = byId.get(reflection.supersedesReflectionId);
      if (!prior) errors.push(`reflection-${reflection.reflectionId}:supersedes-not-present:${reflection.supersedesReflectionId}`);
      else {
        if (prior.patternKey !== reflection.patternKey) errors.push(`reflection-${reflection.reflectionId}:supersedes-different-pattern-key`);
        if (prior.supersededByReflectionId !== reflection.reflectionId) errors.push(`reflection-${reflection.reflectionId}:supersession-not-reciprocal`);
      }
    }
    if (reflection.supersededByReflectionId) {
      const replacement = byId.get(reflection.supersededByReflectionId);
      if (!replacement) errors.push(`reflection-${reflection.reflectionId}:supersededBy-not-present:${reflection.supersededByReflectionId}`);
      else {
        if (replacement.patternKey !== reflection.patternKey) errors.push(`reflection-${reflection.reflectionId}:supersededBy-different-pattern-key`);
        if (replacement.supersedesReflectionId !== reflection.reflectionId) errors.push(`reflection-${reflection.reflectionId}:supersession-not-reciprocal`);
      }
    }
  }

  for (const reflection of reflections) {
    const visited = new Set();
    let cursor = reflection;
    while (cursor?.supersedesReflectionId) {
      if (visited.has(cursor.reflectionId)) {
        errors.push(`reflection-${reflection.reflectionId}:supersession-cycle-detected`);
        break;
      }
      visited.add(cursor.reflectionId);
      cursor = byId.get(cursor.supersedesReflectionId);
    }
  }

  if (Buffer.byteLength(JSON.stringify(reflections), 'utf8') > STEPHANOS_REFLECTIVE_MEMORY_MAX_SERIALIZED_BYTES) {
    errors.push('reflections-serialized-size-exceeds-bound');
  }
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) return safeHold(uniqueErrors);

  const ordered = [...reflections].sort((a, b) => compareText(a.patternKey, b.patternKey)
    || compareText(a.createdAtUtc, b.createdAtUtc) || compareText(a.reflectionId, b.reflectionId));
  const confirmedReflections = ordered.filter((reflection) => reflection.promotionState === 'CONFIRMED'
    && reflection.state === 'CURRENT'
    && reflection.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY
    && reflection.freshness !== 'CONFLICTING');
  const candidateReflections = ordered.filter((reflection) => reflection.promotionState === 'CANDIDATE' && reflection.state === 'CURRENT');
  const historicalReflections = ordered.filter((reflection) => ['SUPERSEDED', 'RETIRED'].includes(reflection.state));
  const rejectedReflections = ordered.filter((reflection) => reflection.promotionState === 'REJECTED');

  const patternConflicts = [];
  const currentByPattern = new Map();
  for (const reflection of confirmedReflections) {
    const group = currentByPattern.get(reflection.patternKey) || [];
    group.push(reflection.reflectionId);
    currentByPattern.set(reflection.patternKey, group);
  }
  for (const [patternKey, reflectionIds] of currentByPattern) {
    if (reflectionIds.length > 1) patternConflicts.push(Object.freeze({ patternKey, reflectionIds: Object.freeze([...reflectionIds].sort(compareText)) }));
  }
  patternConflicts.sort((a, b) => compareText(a.patternKey, b.patternKey));

  const verdict = patternConflicts.length
    ? 'REFLECTIVE_MEMORY_PROJECTED_WITH_CONFLICTS'
    : 'REFLECTIVE_MEMORY_PROJECTED';

  return deepFreeze({
    schemaVersion: STEPHANOS_REFLECTIVE_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_REFLECTIVE_MEMORY',
    projectionId: projectionId(ordered),
    verdict,
    reflections: ordered,
    confirmedReflections,
    candidateReflections,
    historicalReflections,
    rejectedReflections,
    patternConflicts,
    authority: AUTHORITY,
    valid: true,
    validationErrors: [],
  });
}
