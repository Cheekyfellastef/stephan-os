import { createHash } from 'node:crypto';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_PROCEDURAL_MEMORY_SCHEMA_VERSION = 'stephanos.procedural-memory.v1';
export const STEPHANOS_PROCEDURAL_MEMORY_PROJECTION_VERSION = 'stephanos.procedural-memory-projection.v1';
export const STEPHANOS_PROCEDURAL_MEMORY_MAX_METHODS = 256;
export const STEPHANOS_PROCEDURAL_MEMORY_MAX_STEPS = 24;
export const STEPHANOS_PROCEDURAL_MEMORY_MAX_REFS = 24;
export const STEPHANOS_PROCEDURAL_MEMORY_MAX_SERIALIZED_BYTES = 256 * 1024;

export const STEPHANOS_PROCEDURAL_MEMORY_STATES = Object.freeze([
  'CURRENT', 'SUPERSEDED', 'RETIRED', 'UNKNOWN',
]);
export const STEPHANOS_PROCEDURAL_MEMORY_VALIDATION = Object.freeze([
  'VALIDATED', 'CANDIDATE', 'REJECTED', 'UNKNOWN',
]);
export const STEPHANOS_PROCEDURAL_MEMORY_FRESHNESS = Object.freeze([
  'FRESH', 'STALE', 'UNKNOWN', 'CONFLICTING',
]);

const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const STATES = new Set(STEPHANOS_PROCEDURAL_MEMORY_STATES);
const VALIDATION = new Set(STEPHANOS_PROCEDURAL_MEMORY_VALIDATION);
const FRESHNESS = new Set(STEPHANOS_PROCEDURAL_MEMORY_FRESHNESS);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_VERSION = /^(?:v)?[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9.-]+)?$/i;
const SAFE_DOMAIN = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SAFE_REF = /^(?:method|goal|issue|pr|component|agent|workspace|memory|evidence|receipt|proof|project|architecture|lesson|experiment):\/\/[a-z0-9][a-z0-9._:/#@-]{0,220}$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|raw prompt|raw response|credential)\b/i;
const EXECUTION_SHAPED_TEXT = /(?:\b(?:powershell|cmd\.exe|bash|sh -c|sudo|invoke-expression|eval\(|exec\(|start-process|schtasks|reg\.exe|curl\s+https?:\/\/|wget\s+https?:\/\/)\b|(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\))/i;
const METHOD_KEYS = Object.freeze([
  'schemaVersion', 'recordId', 'methodId', 'version', 'problemClass', 'methodSummary',
  'validationState', 'state', 'authorityClass', 'confidence', 'freshness',
  'validatedAtUtc', 'lastVerifiedAtUtc', 'supersedesRecordId', 'supersededByRecordId',
  'prerequisiteRefs', 'evidenceRefs', 'applicableDomains', 'failureModes', 'steps',
]);
const STEP_KEYS = Object.freeze(['stepId', 'instructionSummary', 'expectedEvidenceClass']);
const INPUT_KEYS = Object.freeze(['methods']);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  methodLibraryWriteAllowed: false,
  proceduralMemoryWriteAllowed: false,
  durablePromotionAllowed: false,
  methodValidationAllowed: false,
  methodRetirementAllowed: false,
  commandExecutionAllowed: false,
  arbitraryCommandAllowed: false,
  arbitraryPathAllowed: false,
  arbitraryExecutableAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
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

function denseArray(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Object.keys(descriptors).length !== length + 1) return INVALID;
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
      values.push(descriptor.value);
    }
    return Object.freeze(values);
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
    && !EXECUTION_SHAPED_TEXT.test(value);
}

function normalizeOptionalId(value, field, errors) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeOptionalTimestamp(value, field, errors) {
  if (value === null) return null;
  if (!exactTimestamp(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeStringList(value, field, maximum, errors, validator) {
  const values = denseArray(value, maximum);
  if (values === INVALID || values.some((item) => typeof item !== 'string')) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const accepted = [];
  for (const item of values) {
    if (!validator(item)) errors.push(`${field}-contains-unsafe-value`);
    else accepted.push(item);
  }
  if (new Set(accepted).size !== accepted.length) errors.push(`${field}-contains-duplicate`);
  return accepted;
}

function normalizeSteps(value, errors) {
  const values = denseArray(value, STEPHANOS_PROCEDURAL_MEMORY_MAX_STEPS);
  if (values === INVALID || values.length === 0) {
    errors.push('steps-must-be-non-empty-dense-bounded-array');
    return [];
  }
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const step = exactObject(values[index], STEP_KEYS);
    if (step === INVALID) {
      errors.push(`step-${index}:invalid-exact-data-shape`);
      continue;
    }
    if (!SAFE_ID.test(step.stepId || '')) errors.push(`step-${index}:stepId-invalid`);
    if (!safeText(step.instructionSummary, 320)) errors.push(`step-${index}:instructionSummary-invalid`);
    if (!SAFE_ID.test(step.expectedEvidenceClass || '')) errors.push(`step-${index}:expectedEvidenceClass-invalid`);
    output.push(Object.freeze({
      stepId: step.stepId,
      instructionSummary: step.instructionSummary,
      expectedEvidenceClass: step.expectedEvidenceClass,
    }));
  }
  const ids = output.map((step) => step.stepId);
  if (new Set(ids).size !== ids.length) errors.push('stepIds-must-be-unique');
  return output;
}

function normalizeMethod(value, index) {
  const errors = [];
  const method = exactObject(value, METHOD_KEYS);
  if (method === INVALID) return { method: null, errors: [`method-${index}:invalid-exact-data-shape`] };

  if (method.schemaVersion !== STEPHANOS_PROCEDURAL_MEMORY_SCHEMA_VERSION) errors.push('schemaVersion-mismatch');
  if (!SAFE_ID.test(method.recordId || '')) errors.push('recordId-invalid');
  if (!SAFE_ID.test(method.methodId || '')) errors.push('methodId-invalid');
  if (typeof method.version !== 'string' || !SAFE_VERSION.test(method.version)) errors.push('version-invalid');
  if (!safeText(method.problemClass, 240)) errors.push('problemClass-invalid');
  if (!safeText(method.methodSummary, 640)) errors.push('methodSummary-invalid');

  const validationState = VALIDATION.has(method.validationState) ? method.validationState : 'UNKNOWN';
  if (!VALIDATION.has(method.validationState)) errors.push('validationState-invalid');
  const state = STATES.has(method.state) ? method.state : 'UNKNOWN';
  if (!STATES.has(method.state)) errors.push('state-invalid');
  const authorityClass = AUTHORITY_CLASSES.has(method.authorityClass)
    ? method.authorityClass : STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
  if (!AUTHORITY_CLASSES.has(method.authorityClass)) errors.push('authorityClass-invalid');
  const confidence = typeof method.confidence === 'number' && Number.isFinite(method.confidence)
    && method.confidence >= 0 && method.confidence <= 1 ? method.confidence : null;
  if (confidence === null) errors.push('confidence-invalid');
  const freshness = FRESHNESS.has(method.freshness) ? method.freshness : 'UNKNOWN';
  if (!FRESHNESS.has(method.freshness)) errors.push('freshness-invalid');

  const validatedAtUtc = normalizeOptionalTimestamp(method.validatedAtUtc, 'validatedAtUtc', errors);
  const lastVerifiedAtUtc = normalizeOptionalTimestamp(method.lastVerifiedAtUtc, 'lastVerifiedAtUtc', errors);
  if (validationState === 'VALIDATED' && !validatedAtUtc) errors.push('validated-method-requires-validatedAtUtc');
  if (validationState !== 'VALIDATED' && validatedAtUtc) errors.push('nonvalidated-method-cannot-claim-validatedAtUtc');
  if (validationState === 'VALIDATED' && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY) {
    errors.push('validated-method-requires-shared-authority');
  }

  const supersedesRecordId = normalizeOptionalId(method.supersedesRecordId, 'supersedesRecordId', errors);
  const supersededByRecordId = normalizeOptionalId(method.supersededByRecordId, 'supersededByRecordId', errors);
  if (supersedesRecordId === method.recordId || supersededByRecordId === method.recordId) errors.push('method-record-cannot-supersede-itself');
  if (state === 'SUPERSEDED' && !supersededByRecordId) errors.push('superseded-state-requires-supersededByRecordId');
  if (state === 'CURRENT' && supersededByRecordId) errors.push('current-state-cannot-have-supersededByRecordId');

  const prerequisiteRefs = normalizeStringList(method.prerequisiteRefs, 'prerequisiteRefs', STEPHANOS_PROCEDURAL_MEMORY_MAX_REFS, errors, (item) => SAFE_REF.test(item) && !item.includes('..'));
  const evidenceRefs = normalizeStringList(method.evidenceRefs, 'evidenceRefs', STEPHANOS_PROCEDURAL_MEMORY_MAX_REFS, errors, (item) => SAFE_REF.test(item) && !item.includes('..'));
  if (validationState === 'VALIDATED' && evidenceRefs.length === 0) errors.push('validated-method-requires-evidence');
  const applicableDomains = normalizeStringList(method.applicableDomains, 'applicableDomains', STEPHANOS_PROCEDURAL_MEMORY_MAX_REFS, errors, (item) => SAFE_DOMAIN.test(item));
  if (applicableDomains.length === 0) errors.push('applicableDomains-required');
  const failureModes = normalizeStringList(method.failureModes, 'failureModes', STEPHANOS_PROCEDURAL_MEMORY_MAX_REFS, errors, (item) => safeText(item, 320));
  const steps = normalizeSteps(method.steps, errors);

  return {
    method: Object.freeze({
      recordId: method.recordId,
      methodId: method.methodId,
      version: method.version,
      problemClass: method.problemClass,
      methodSummary: method.methodSummary,
      validationState,
      state,
      authorityClass,
      confidence,
      freshness,
      validatedAtUtc,
      lastVerifiedAtUtc,
      supersedesRecordId,
      supersededByRecordId,
      prerequisiteRefs: Object.freeze(prerequisiteRefs),
      evidenceRefs: Object.freeze(evidenceRefs),
      applicableDomains: Object.freeze(applicableDomains),
      failureModes: Object.freeze(failureModes),
      steps: Object.freeze(steps),
    }),
    errors: errors.map((error) => `method-${index}:${error}`),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeHold(errors) {
  return deepFreeze({
    schemaVersion: STEPHANOS_PROCEDURAL_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_PROCEDURAL_MEMORY',
    projectionId: '',
    verdict: 'SAFE_HOLD',
    methods: [],
    reusableMethods: [],
    candidateMethods: [],
    historicalMethods: [],
    rejectedMethods: [],
    methodConflicts: [],
    authority: AUTHORITY,
    valid: false,
    validationErrors: errors,
  });
}

function projectionId(methods) {
  return `procedural-${createHash('sha256').update(JSON.stringify(methods)).digest('hex').slice(0, 32)}`;
}

export function buildStephanosProceduralMemoryV1(input = {}) {
  const observed = exactObject(input, INPUT_KEYS);
  if (observed === INVALID) return safeHold(['input-invalid-exact-data-shape']);
  const errors = [];
  const values = denseArray(observed.methods, STEPHANOS_PROCEDURAL_MEMORY_MAX_METHODS);
  if (values === INVALID) return safeHold(['methods-must-be-dense-bounded-array']);

  const methods = [];
  for (let index = 0; index < values.length; index += 1) {
    const normalized = normalizeMethod(values[index], index);
    errors.push(...normalized.errors);
    if (normalized.method) methods.push(normalized.method);
  }

  const recordIds = methods.map((method) => method.recordId);
  if (new Set(recordIds).size !== recordIds.length) errors.push('recordIds-must-be-unique');
  const byRecordId = new Map(methods.map((method) => [method.recordId, method]));

  for (const method of methods) {
    if (method.supersedesRecordId) {
      const prior = byRecordId.get(method.supersedesRecordId);
      if (!prior) errors.push(`method-${method.recordId}:supersedes-not-present:${method.supersedesRecordId}`);
      else {
        if (prior.methodId !== method.methodId) errors.push(`method-${method.recordId}:supersedes-different-method`);
        if (prior.supersededByRecordId !== method.recordId) errors.push(`method-${method.recordId}:supersession-not-reciprocal`);
      }
    }
    if (method.supersededByRecordId) {
      const replacement = byRecordId.get(method.supersededByRecordId);
      if (!replacement) errors.push(`method-${method.recordId}:supersededBy-not-present:${method.supersededByRecordId}`);
      else {
        if (replacement.methodId !== method.methodId) errors.push(`method-${method.recordId}:supersededBy-different-method`);
        if (replacement.supersedesRecordId !== method.recordId) errors.push(`method-${method.recordId}:supersession-not-reciprocal`);
      }
    }
  }

  for (const method of methods) {
    const visited = new Set();
    let cursor = method;
    while (cursor?.supersedesRecordId) {
      if (visited.has(cursor.recordId)) {
        errors.push(`method-${method.recordId}:supersession-cycle-detected`);
        break;
      }
      visited.add(cursor.recordId);
      cursor = byRecordId.get(cursor.supersedesRecordId);
    }
  }

  if (Buffer.byteLength(JSON.stringify(methods), 'utf8') > STEPHANOS_PROCEDURAL_MEMORY_MAX_SERIALIZED_BYTES) {
    errors.push('methods-serialized-size-exceeds-bound');
  }

  const ordered = [...methods].sort((a, b) => compareText(a.methodId, b.methodId)
    || compareText(a.version, b.version) || compareText(a.recordId, b.recordId));
  const reusableMethods = ordered.filter((method) => method.validationState === 'VALIDATED'
    && method.state === 'CURRENT'
    && method.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY
    && method.freshness !== 'CONFLICTING');
  const candidateMethods = ordered.filter((method) => method.validationState === 'CANDIDATE' && method.state === 'CURRENT');
  const historicalMethods = ordered.filter((method) => method.state === 'SUPERSEDED' || method.state === 'RETIRED');
  const rejectedMethods = ordered.filter((method) => method.validationState === 'REJECTED');

  const methodConflicts = [];
  const currentValidatedByMethod = new Map();
  for (const method of reusableMethods) {
    const existing = currentValidatedByMethod.get(method.methodId) || [];
    existing.push(method.recordId);
    currentValidatedByMethod.set(method.methodId, existing);
  }
  for (const [methodId, ids] of currentValidatedByMethod) {
    if (ids.length > 1) methodConflicts.push(Object.freeze({ methodId, recordIds: Object.freeze([...ids].sort(compareText)) }));
  }
  methodConflicts.sort((a, b) => compareText(a.methodId, b.methodId));

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) return safeHold(uniqueErrors);

  const verdict = methodConflicts.length
    ? 'PROCEDURAL_MEMORY_PROJECTED_WITH_CONFLICTS'
    : 'PROCEDURAL_MEMORY_PROJECTED';

  return deepFreeze({
    schemaVersion: STEPHANOS_PROCEDURAL_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_PROCEDURAL_MEMORY',
    projectionId: projectionId(ordered),
    verdict,
    methods: ordered,
    reusableMethods,
    candidateMethods,
    historicalMethods,
    rejectedMethods,
    methodConflicts,
    authority: AUTHORITY,
    valid: true,
    validationErrors: [],
  });
}
