import { createHash } from 'node:crypto';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_SEMANTIC_MEMORY_SCHEMA_VERSION = 'stephanos.semantic-memory.v1';
export const STEPHANOS_SEMANTIC_MEMORY_PROJECTION_VERSION = 'stephanos.semantic-memory-projection.v1';
export const STEPHANOS_SEMANTIC_MEMORY_MAX_CLAIMS = 512;
export const STEPHANOS_SEMANTIC_MEMORY_MAX_REFS = 24;
export const STEPHANOS_SEMANTIC_MEMORY_MAX_SERIALIZED_BYTES = 256 * 1024;

export const STEPHANOS_SEMANTIC_MEMORY_FRESHNESS = Object.freeze([
  'FRESH', 'STALE', 'UNKNOWN', 'CONFLICTING',
]);
export const STEPHANOS_SEMANTIC_MEMORY_STATES = Object.freeze([
  'CURRENT', 'SUPERSEDED', 'UNKNOWN',
]);
export const STEPHANOS_SEMANTIC_MEMORY_ORIGINS = Object.freeze([
  'OPERATOR_TEACHING',
  'PROJECT_EVIDENCE',
  'RUNTIME_EVIDENCE',
  'EXTERNAL_EVIDENCE',
  'MODEL_INFERENCE',
  'UNKNOWN',
]);

const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const FRESHNESS = new Set(STEPHANOS_SEMANTIC_MEMORY_FRESHNESS);
const STATES = new Set(STEPHANOS_SEMANTIC_MEMORY_STATES);
const ORIGINS = new Set(STEPHANOS_SEMANTIC_MEMORY_ORIGINS);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_PREDICATE = /^[a-z][a-z0-9._:-]{0,95}$/i;
const SAFE_REF = /^(?:operator|participant|project|architecture|goal|intent|pr|component|runtime|world|provider|surface|claim|decision|correction|receipt|evidence|workspace|memory):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|raw prompt|raw response|psychological profile|mental diagnosis|personality disorder)\b/i;
const GENERIC_TOKEN_CREDENTIAL = /(?:\btoken\b["']?\s*[:=]\s*["']?\S+|\btoken\b\s+(?:credential|secret)\b|\btoken\b\s+(?:is|was|equals?)\s+["']?[a-z0-9._~+/=-]{16,}\b|\btoken\b\s+[a-z0-9._~+/=-]{16,}\b)/i;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/(?!\/)[^\s/]+(?:\/[^\s]*)?|\.\.\/|\.\.\\)/;
const CLAIM_KEYS = Object.freeze([
  'schemaVersion',
  'claimId',
  'subjectRef',
  'predicate',
  'valueSummary',
  'claimOrigin',
  'authorityClass',
  'confidence',
  'freshness',
  'state',
  'validFromUtc',
  'validUntilUtc',
  'lastVerifiedAtUtc',
  'supersedesClaimId',
  'supersededByClaimId',
  'sourceRefs',
  'proofRefs',
  'contradictionClaimIds',
  'tags',
]);
const INPUT_KEYS = Object.freeze(['observedAtUtc', 'claims']);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  correctionAllowed: false,
  forgetAllowed: false,
  contradictionResolutionAllowed: false,
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

function denseStringArray(value, maximum = STEPHANOS_SEMANTIC_MEMORY_MAX_REFS) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return INVALID;
    if (Object.keys(descriptors).length !== length + 1) return INVALID;
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

function containsSensitiveText(value) {
  return SENSITIVE_TEXT.test(value) || GENERIC_TOKEN_CREDENTIAL.test(value);
}

function safeText(value, maximum) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !containsSensitiveText(value)
    && !LOCAL_PATH.test(value);
}

function safeRef(value) {
  return typeof value === 'string'
    && SAFE_REF.test(value)
    && !value.includes('..')
    && !containsSensitiveText(value)
    && !LOCAL_PATH.test(value);
}

function safeTag(value) {
  return typeof value === 'string'
    && SAFE_ID.test(value)
    && value.length <= 80
    && !containsSensitiveText(value);
}

function normalizedBoundedNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value : null;
}

function normalizeOptionalTimestamp(value, field, errors) {
  if (value === null) return null;
  if (!exactTimestamp(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeOptionalClaimId(value, field, errors) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function safeStringList(value, field, errors, validator) {
  const values = denseStringArray(value);
  if (values === INVALID) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const output = [];
  for (const item of values) {
    if (!validator(item)) errors.push(`${field}-contains-unsafe-value`);
    else output.push(item);
  }
  if (new Set(output).size !== output.length) errors.push(`${field}-contains-duplicate`);
  return output;
}

function normalizeClaim(value, index, observedAtMs) {
  const errors = [];
  const claim = exactObject(value, CLAIM_KEYS);
  if (claim === INVALID) return { claim: null, errors: [`claim-${index}:invalid-exact-data-shape`] };

  if (claim.schemaVersion !== STEPHANOS_SEMANTIC_MEMORY_SCHEMA_VERSION) errors.push('schemaVersion-mismatch');
  const claimId = typeof claim.claimId === 'string' && SAFE_ID.test(claim.claimId) ? claim.claimId : '';
  if (!claimId) errors.push('claimId-invalid');
  if (!safeRef(claim.subjectRef)) errors.push('subjectRef-invalid');
  if (typeof claim.predicate !== 'string' || !SAFE_PREDICATE.test(claim.predicate)) errors.push('predicate-invalid');
  if (!safeText(claim.valueSummary, 640)) errors.push('valueSummary-invalid');

  const claimOrigin = ORIGINS.has(claim.claimOrigin) ? claim.claimOrigin : 'UNKNOWN';
  if (!ORIGINS.has(claim.claimOrigin)) errors.push('claimOrigin-invalid');
  const authorityClass = AUTHORITY_CLASSES.has(claim.authorityClass)
    ? claim.authorityClass : STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
  if (!AUTHORITY_CLASSES.has(claim.authorityClass)) errors.push('authorityClass-invalid');
  if (claimOrigin === 'MODEL_INFERENCE' && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED) {
    errors.push('model-inference-must-remain-inferred');
  }
  if (claimOrigin === 'OPERATOR_TEACHING' && authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED) {
    errors.push('operator-teaching-cannot-be-inferred');
  }

  const confidence = normalizedBoundedNumber(claim.confidence);
  if (confidence === null) errors.push('confidence-invalid');
  const freshness = FRESHNESS.has(claim.freshness) ? claim.freshness : 'UNKNOWN';
  if (!FRESHNESS.has(claim.freshness)) errors.push('freshness-invalid');
  const state = STATES.has(claim.state) ? claim.state : 'UNKNOWN';
  if (!STATES.has(claim.state)) errors.push('state-invalid');

  if (!exactTimestamp(claim.validFromUtc)) errors.push('validFromUtc-invalid');
  const validUntilUtc = normalizeOptionalTimestamp(claim.validUntilUtc, 'validUntilUtc', errors);
  const lastVerifiedAtUtc = normalizeOptionalTimestamp(claim.lastVerifiedAtUtc, 'lastVerifiedAtUtc', errors);
  const validFromMs = exactTimestamp(claim.validFromUtc) ? Date.parse(claim.validFromUtc) : 0;
  const validUntilMs = validUntilUtc ? Date.parse(validUntilUtc) : null;
  const lastVerifiedAtMs = lastVerifiedAtUtc ? Date.parse(lastVerifiedAtUtc) : null;
  if (validUntilMs !== null && validUntilMs < validFromMs) errors.push('validUntilUtc-before-validFromUtc');
  if (lastVerifiedAtMs !== null && lastVerifiedAtMs < validFromMs) errors.push('lastVerifiedAtUtc-before-validFromUtc');
  if (lastVerifiedAtMs !== null && observedAtMs !== null && lastVerifiedAtMs > observedAtMs) errors.push('lastVerifiedAtUtc-after-observedAtUtc');

  const supersedesClaimId = normalizeOptionalClaimId(claim.supersedesClaimId, 'supersedesClaimId', errors);
  const supersededByClaimId = normalizeOptionalClaimId(claim.supersededByClaimId, 'supersededByClaimId', errors);
  if (supersedesClaimId === claimId || supersededByClaimId === claimId) errors.push('claim-cannot-supersede-itself');
  if (state === 'SUPERSEDED' && !supersededByClaimId) errors.push('superseded-state-requires-supersededByClaimId');
  if (state === 'CURRENT' && supersededByClaimId) errors.push('current-state-cannot-have-supersededByClaimId');

  const sourceRefs = safeStringList(claim.sourceRefs, 'sourceRefs', errors, safeRef);
  const proofRefs = safeStringList(claim.proofRefs, 'proofRefs', errors, safeRef);
  if (!sourceRefs.length && !proofRefs.length) errors.push('source-or-proof-ref-required');
  const contradictionClaimIds = safeStringList(claim.contradictionClaimIds, 'contradictionClaimIds', errors, (item) => SAFE_ID.test(item));
  if (claimId && contradictionClaimIds.includes(claimId)) errors.push('claim-cannot-contradict-itself');
  const tags = safeStringList(claim.tags, 'tags', errors, safeTag);

  const normalized = Object.freeze({
    claimId,
    subjectRef: claim.subjectRef,
    predicate: claim.predicate,
    semanticKey: `${claim.subjectRef}|${claim.predicate}`,
    valueSummary: claim.valueSummary,
    claimOrigin,
    authorityClass,
    confidence,
    freshness,
    state,
    validFromUtc: claim.validFromUtc,
    validFromMs,
    validUntilUtc,
    validUntilMs,
    lastVerifiedAtUtc,
    lastVerifiedAtMs,
    supersedesClaimId,
    supersededByClaimId,
    sourceRefs: Object.freeze(sourceRefs),
    proofRefs: Object.freeze(proofRefs),
    contradictionClaimIds: Object.freeze(contradictionClaimIds),
    tags: Object.freeze(tags),
  });

  return { claim: normalized, errors: errors.map((error) => `claim-${index}:${error}`) };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function projectionId(observedAtUtc, claims) {
  return `semantic-${createHash('sha256')
    .update(JSON.stringify({ observedAtUtc, claims }))
    .digest('hex').slice(0, 32)}`;
}

function publicClaim(claim, observedAtMs) {
  const temporallyEffective = claim.validFromMs <= observedAtMs
    && (claim.validUntilMs === null || observedAtMs <= claim.validUntilMs);
  const {
    semanticKey,
    validFromMs,
    validUntilMs,
    lastVerifiedAtMs,
    ...rest
  } = claim;
  return Object.freeze({ ...rest, temporallyEffective });
}

function safeHold(validationErrors) {
  return deepFreeze({
    schemaVersion: STEPHANOS_SEMANTIC_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_SEMANTIC_MEMORY',
    projectionId: '',
    observedAtUtc: '',
    verdict: 'SAFE_HOLD',
    claims: [],
    currentClaims: [],
    historicalClaims: [],
    unknownClaims: [],
    semanticSubjects: [],
    unresolvedContradictions: [],
    authority: AUTHORITY,
    valid: false,
    validationErrors,
  });
}

export function buildStephanosSemanticMemoryV1(input = {}) {
  const errors = [];
  const observed = exactObject(input, INPUT_KEYS);
  if (observed === INVALID) return safeHold(['input-invalid-exact-data-shape']);
  const observedAtValid = exactTimestamp(observed.observedAtUtc);
  if (!observedAtValid) errors.push('observedAtUtc-invalid');
  const observedAtMs = observedAtValid ? Date.parse(observed.observedAtUtc) : null;

  let descriptors;
  try {
    if (!Array.isArray(observed.claims) || Object.getPrototypeOf(observed.claims) !== Array.prototype) throw new Error();
    descriptors = Object.getOwnPropertyDescriptors(observed.claims);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > STEPHANOS_SEMANTIC_MEMORY_MAX_CLAIMS || Object.keys(descriptors).length !== length + 1) throw new Error();
  } catch {
    errors.push('claims-must-be-dense-bounded-array');
  }

  const claims = [];
  if (descriptors && !errors.includes('claims-must-be-dense-bounded-array')) {
    for (let index = 0; index < descriptors.length.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        errors.push(`claim-${index}:must-be-own-enumerable-data-entry`);
        continue;
      }
      const normalized = normalizeClaim(descriptor.value, index, observedAtMs);
      errors.push(...normalized.errors);
      if (normalized.claim) claims.push(normalized.claim);
    }
  }

  const ids = claims.map((claim) => claim.claimId);
  if (new Set(ids).size !== ids.length) errors.push('claimIds-must-be-unique');
  const byId = new Map(claims.map((claim) => [claim.claimId, claim]));

  for (const claim of claims) {
    for (const contradictionId of claim.contradictionClaimIds) {
      const contradictory = byId.get(contradictionId);
      if (!contradictory) {
        errors.push(`claim-${claim.claimId}:contradiction-not-present:${contradictionId}`);
        continue;
      }
      if (contradictory.semanticKey !== claim.semanticKey) {
        errors.push(`claim-${claim.claimId}:contradiction-must-share-semantic-key:${contradictionId}`);
      }
    }

    if (claim.supersedesClaimId) {
      const prior = byId.get(claim.supersedesClaimId);
      if (!prior) {
        errors.push(`claim-${claim.claimId}:supersedes-not-present:${claim.supersedesClaimId}`);
      } else {
        if (prior.semanticKey !== claim.semanticKey) errors.push(`claim-${claim.claimId}:supersedes-different-semantic-key`);
        if (claim.validFromMs < prior.validFromMs) errors.push(`claim-${claim.claimId}:superseding-claim-starts-before-prior`);
        if (prior.supersededByClaimId !== claim.claimId) errors.push(`claim-${claim.claimId}:supersession-not-reciprocal`);
      }
    }
    if (claim.supersededByClaimId) {
      const replacement = byId.get(claim.supersededByClaimId);
      if (!replacement) {
        errors.push(`claim-${claim.claimId}:supersededBy-not-present:${claim.supersededByClaimId}`);
      } else {
        if (replacement.semanticKey !== claim.semanticKey) errors.push(`claim-${claim.claimId}:supersededBy-different-semantic-key`);
        if (replacement.supersedesClaimId !== claim.claimId) errors.push(`claim-${claim.claimId}:supersession-not-reciprocal`);
      }
    }
  }

  const normalizedForSize = claims.map((claim) => ({
    claimId: claim.claimId,
    subjectRef: claim.subjectRef,
    predicate: claim.predicate,
    valueSummary: claim.valueSummary,
    claimOrigin: claim.claimOrigin,
    authorityClass: claim.authorityClass,
    confidence: claim.confidence,
    freshness: claim.freshness,
    state: claim.state,
    validFromUtc: claim.validFromUtc,
    validUntilUtc: claim.validUntilUtc,
    lastVerifiedAtUtc: claim.lastVerifiedAtUtc,
    supersedesClaimId: claim.supersedesClaimId,
    supersededByClaimId: claim.supersededByClaimId,
    sourceRefs: claim.sourceRefs,
    proofRefs: claim.proofRefs,
    contradictionClaimIds: claim.contradictionClaimIds,
    tags: claim.tags,
  }));
  if (Buffer.byteLength(JSON.stringify(normalizedForSize), 'utf8') > STEPHANOS_SEMANTIC_MEMORY_MAX_SERIALIZED_BYTES) {
    errors.push('claims-serialized-size-exceeds-bound');
  }

  for (const claim of claims) {
    const visited = new Set();
    let cursor = claim;
    while (cursor?.supersedesClaimId) {
      if (visited.has(cursor.claimId)) {
        errors.push(`claim-${claim.claimId}:supersession-cycle-detected`);
        break;
      }
      visited.add(cursor.claimId);
      cursor = byId.get(cursor.supersedesClaimId);
    }
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) return safeHold(uniqueErrors);

  const ordered = [...claims].sort((a, b) => compareText(a.subjectRef, b.subjectRef)
    || compareText(a.predicate, b.predicate)
    || a.validFromMs - b.validFromMs
    || compareText(a.claimId, b.claimId));
  const publicClaims = ordered.map((claim) => publicClaim(claim, observedAtMs));

  const currentClaims = publicClaims.filter((claim) => claim.state === 'CURRENT' && claim.temporallyEffective);
  const historicalClaims = publicClaims.filter((claim) => claim.state === 'SUPERSEDED'
    || (claim.state === 'CURRENT' && !claim.temporallyEffective));
  const unknownClaims = publicClaims.filter((claim) => claim.state === 'UNKNOWN');

  const currentByKey = new Map();
  for (const claim of currentClaims) {
    const key = `${claim.subjectRef}|${claim.predicate}`;
    const group = currentByKey.get(key) || [];
    group.push(claim);
    currentByKey.set(key, group);
  }

  const unresolvedContradictions = [];
  for (const [semanticKey, group] of currentByKey) {
    const distinctValues = [...new Set(group.map((claim) => claim.valueSummary))];
    if (distinctValues.length < 2) continue;
    const claimIds = group.map((claim) => claim.claimId).sort(compareText);
    const allCrossValuePairsDeclared = group.every((claim) => group
      .filter((other) => other.valueSummary !== claim.valueSummary)
      .every((other) => claim.contradictionClaimIds.includes(other.claimId)));
    unresolvedContradictions.push(Object.freeze({
      semanticKey,
      claimIds: Object.freeze(claimIds),
      distinctValueCount: distinctValues.length,
      explicitlyDeclared: allCrossValuePairsDeclared,
    }));
  }
  unresolvedContradictions.sort((a, b) => compareText(a.semanticKey, b.semanticKey));

  const semanticSubjects = [...new Set(publicClaims.map((claim) => claim.subjectRef))].sort(compareText).map((subjectRef) => {
    const subjectClaims = publicClaims.filter((claim) => claim.subjectRef === subjectRef);
    return Object.freeze({
      subjectRef,
      predicates: Object.freeze([...new Set(subjectClaims.map((claim) => claim.predicate))].sort(compareText)),
      currentClaimIds: Object.freeze(currentClaims.filter((claim) => claim.subjectRef === subjectRef).map((claim) => claim.claimId)),
      historicalClaimIds: Object.freeze(historicalClaims.filter((claim) => claim.subjectRef === subjectRef).map((claim) => claim.claimId)),
    });
  });

  const verdict = unresolvedContradictions.length
    ? 'SEMANTIC_MEMORY_PROJECTED_WITH_UNRESOLVED_CONTRADICTIONS'
    : 'SEMANTIC_MEMORY_PROJECTED';

  return deepFreeze({
    schemaVersion: STEPHANOS_SEMANTIC_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_SEMANTIC_MEMORY',
    projectionId: projectionId(observed.observedAtUtc, publicClaims),
    observedAtUtc: observed.observedAtUtc,
    verdict,
    claims: publicClaims,
    currentClaims,
    historicalClaims,
    unknownClaims,
    semanticSubjects,
    unresolvedContradictions,
    authority: AUTHORITY,
    valid: true,
    validationErrors: [],
  });
}
