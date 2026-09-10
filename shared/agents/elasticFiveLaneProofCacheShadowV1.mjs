export const ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_SCHEMA_VERSION =
  'stephanos.elastic-five-lane-proof-cache-shadow.v1';

export const ELASTIC_FIVE_LANE_REUSABLE_PROOF_CLASSES_V1 = Object.freeze([
  'DETERMINISTIC_TEST',
  'STATIC_ANALYSIS',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INPUT_KEYS = Object.freeze(['candidate', 'entries', 'observedAtUtc']);
const IDENTITY_KEYS = Object.freeze([
  'repository',
  'sourceHead',
  'sourceTree',
  'proofClass',
  'testDefinitionVersion',
  'testDefinitionDigest',
  'environmentIdentity',
  'environmentDigest',
  'toolchainVersion',
  'toolchainDigest',
  'policyVersion',
  'policyDigest',
  'resultDigest',
]);
const ENTRY_KEYS = Object.freeze([
  ...IDENTITY_KEYS,
  'cacheKey',
  'receiptId',
  'terminalState',
  'completedAtUtc',
  'expiresAtUtc',
  'signatureVerified',
]);
const ZERO_AUTHORITY = Object.freeze({
  cacheReadAllowed: false,
  cacheWriteAllowed: false,
  proofExecutionAllowed: false,
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  deploymentAllowed: false,
  approvalReuseAllowed: false,
  mergeAllowed: false,
  controllerAuthorityTransferAllowed: false,
  fiveLaneCutoverAllowed: false,
});

function text(value, limit = 240) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function canonicalPlainData(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    return false;
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
}

function canonicalArray(value, maximum = 512) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length > maximum) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function validUtc(value) {
  const normalized = text(value, 32);
  return ISO_UTC.test(normalized) && Number.isFinite(Date.parse(normalized));
}

function validateIdentity(identity, keys = IDENTITY_KEYS) {
  if (!canonicalPlainData(identity, keys)) return 'PROOF_IDENTITY_NOT_CANONICAL_PLAIN_DATA';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text(identity.repository, 200))) {
    return 'REPOSITORY_IDENTITY_INVALID';
  }
  if (!SHA40.test(text(identity.sourceHead, 40).toLowerCase())) return 'SOURCE_HEAD_INVALID';
  if (!SHA40.test(text(identity.sourceTree, 40).toLowerCase())) return 'SOURCE_TREE_INVALID';
  if (!ELASTIC_FIVE_LANE_REUSABLE_PROOF_CLASSES_V1.includes(text(identity.proofClass, 80))) {
    return 'PROOF_CLASS_NOT_REUSABLE';
  }
  for (const key of ['testDefinitionVersion', 'environmentIdentity', 'toolchainVersion', 'policyVersion']) {
    if (!text(identity[key], 160)) return `PROOF_IDENTITY_${key.toUpperCase()}_MISSING`;
  }
  for (const key of [
    'testDefinitionDigest', 'environmentDigest', 'toolchainDigest', 'policyDigest', 'resultDigest',
  ]) {
    if (!SHA256.test(text(identity[key], 64).toLowerCase())) return `PROOF_IDENTITY_${key.toUpperCase()}_INVALID`;
  }
  return '';
}

function identityFingerprint(value) {
  return IDENTITY_KEYS.map((key) => `${key}=${text(value[key], 240)}`).join('|');
}

function safeHold(reasonCodes = ['PROOF_CACHE_INPUT_INVALID']) {
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'SAFE_HOLD',
    reuseDecision: 'REUSE_DENIED',
    matchedReceiptId: null,
    exactIdentityMatch: false,
    staleProofRejected: false,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    finalVerdict: 'ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_SAFE_HOLD',
  });
}

function miss(reasonCodes, { staleProofRejected = false } = {}) {
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'CACHE_MISS_SHADOW',
    reuseDecision: 'RUN_FRESH_PROOF_SHADOW',
    matchedReceiptId: null,
    exactIdentityMatch: false,
    staleProofRejected,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    finalVerdict: 'ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_MISS_NO_AUTHORITY',
  });
}

function project(input) {
  if (!canonicalPlainData(input, INPUT_KEYS)) {
    return safeHold(['PROOF_CACHE_INPUT_NOT_CANONICAL_PLAIN_DATA']);
  }
  if (!validUtc(input.observedAtUtc)) return safeHold(['OBSERVATION_TIME_INVALID']);
  const candidateBlocker = validateIdentity(input.candidate);
  if (candidateBlocker) return safeHold([candidateBlocker]);
  if (!canonicalArray(input.entries)) return safeHold(['PROOF_CACHE_ENTRIES_INVALID']);

  const cacheKeys = new Set();
  const receiptIds = new Set();
  const validEntries = [];
  for (const entry of input.entries) {
    const identityBlocker = validateIdentity(entry, ENTRY_KEYS);
    if (identityBlocker) return safeHold([identityBlocker]);
    const cacheKey = text(entry.cacheKey, 180);
    const receiptId = text(entry.receiptId, 180);
    if (!cacheKey || !receiptId) return safeHold(['PROOF_CACHE_ENTRY_IDENTITY_MISSING']);
    if (cacheKeys.has(cacheKey)) return safeHold(['DUPLICATE_PROOF_CACHE_KEY']);
    if (receiptIds.has(receiptId)) return safeHold(['DUPLICATE_PROOF_RECEIPT_ID']);
    cacheKeys.add(cacheKey);
    receiptIds.add(receiptId);
    if (!validUtc(entry.completedAtUtc) || !validUtc(entry.expiresAtUtc)) {
      return safeHold(['PROOF_CACHE_ENTRY_TIME_INVALID']);
    }
    if (Date.parse(entry.completedAtUtc) >= Date.parse(entry.expiresAtUtc)) {
      return safeHold(['PROOF_CACHE_ENTRY_TIME_ORDER_INVALID']);
    }
    if (entry.signatureVerified !== true) return safeHold(['PROOF_CACHE_ENTRY_SIGNATURE_UNPROVEN']);
    if (text(entry.terminalState, 40) !== 'SUCCESS') return safeHold(['PROOF_CACHE_ENTRY_NOT_SUCCESSFUL']);
    validEntries.push(entry);
  }

  const fingerprint = identityFingerprint(input.candidate);
  const exactMatches = validEntries.filter((entry) => identityFingerprint(entry) === fingerprint);
  if (exactMatches.length > 1) return safeHold(['MULTIPLE_EXACT_PROOF_CACHE_MATCHES']);
  if (exactMatches.length === 0) return miss(['EXACT_PROOF_IDENTITY_CACHE_MISS']);

  const match = exactMatches[0];
  if (Date.parse(match.expiresAtUtc) <= Date.parse(input.observedAtUtc)) {
    return miss(['MATCHED_PROOF_EXPIRED'], { staleProofRejected: true });
  }
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'CACHE_HIT_SHADOW',
    reuseDecision: 'REUSE_EXACT_PROOF_SHADOW',
    matchedReceiptId: text(match.receiptId, 180),
    matchedCacheKey: text(match.cacheKey, 180),
    exactIdentityMatch: true,
    staleProofRejected: false,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze(['EXACT_IMMUTABLE_PROOF_REUSE_SHADOW_ELIGIBLE']),
    finalVerdict: 'ELASTIC_FIVE_LANE_PROOF_CACHE_SHADOW_HIT_NO_AUTHORITY',
  });
}

export function projectElasticFiveLaneProofCacheShadowV1(input = {}) {
  try {
    return project(input);
  } catch {
    return safeHold(['PROOF_CACHE_INPUT_INSPECTION_FAILED']);
  }
}
