import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_INPUT_SCHEMA_V1 =
  'stephanos.memory-adequacy-evidence-collectors-input.v1';
export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_OUTPUT_SCHEMA_V1 =
  'stephanos.memory-adequacy-evidence-collectors-output.v1';

export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_FAMILIES = Object.freeze([
  'GITHUB_GOAL_PR',
  'RUNTIME_PROOF',
  'LESSON_RELATIONSHIP',
  'SHARED_WORKSPACE_RECEIPT',
]);

export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  authorityUpgradeAllowed: false,
  sharedWorkspaceMutationAllowed: false,
  githubMutationAllowed: false,
  runtimeMutationAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
});

export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_MAX_ITEMS = 512;
export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_MAX_REFS = 8;
export const STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_MAX_BYTES = 512 * 1024;

const TOP_KEYS = new Set(['schemaVersion', 'observedAtUtc', 'evidence']);
const EVIDENCE_KEYS = new Set([
  'evidenceId',
  'family',
  'subjectRef',
  'state',
  'authorityClass',
  'observedAtUtc',
  'source',
  'proofRefs',
  'relationshipRefs',
  'retentionDeclared',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,191}$/;
const SAFE_TEXT = /^[\p{L}\p{N} _./:#@+()\[\]-]{1,240}$/u;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipt|receipts|evidence|github|shared-workspace|runtime|memory)\/[A-Za-z0-9][A-Za-z0-9._/#:@-]{0,239}$/;
const AUTHORITY_VALUES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const AUTHORITY_RANK = new Map([
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN, 0],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED, 1],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR, 2],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.PENDING_LOCAL_INTENT, 2],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE, 3],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY, 4],
]);
const FAMILY_DOMAIN = Object.freeze({
  GITHUB_GOAL_PR: 'goal-decision-memory',
  RUNTIME_PROOF: 'runtime-proof-memory',
  LESSON_RELATIONSHIP: 'lessons-incident-memory',
  SHARED_WORKSPACE_RECEIPT: 'project-architecture-memory',
});
const FAMILY_SOURCE = Object.freeze({
  GITHUB_GOAL_PR: 'github-goal-pr-evidence',
  RUNTIME_PROOF: 'runtime-proof-evidence',
  LESSON_RELATIONSHIP: 'lesson-relationship-evidence',
  SHARED_WORKSPACE_RECEIPT: 'shared-workspace-receipt-evidence',
});

function fail(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isPlain(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlain(value, allowed, label) {
  if (!isPlain(value)) fail('INVALID_SHAPE', `${label} must be a plain data object`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.has(key)) fail('UNEXPECTED_FIELD', `${label}.${key} is not allowed`);
    if (!('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}.${key} must be a data value`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
}

function denseArray(value, label, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('INVALID_ARRAY', `${label} must be a standard array`);
  }
  if (value.length > max) fail('LIMIT_EXCEEDED', `${label} exceeds ${max}`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail('SPARSE_ARRAY_REJECTED', `${label} must be dense`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}[${index}] must be a data value`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
  return [...value];
}

function id(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail('INVALID_ID', `${label} is required and must be safe`);
  return value;
}

function safeText(value, label) {
  if (typeof value !== 'string' || !SAFE_TEXT.test(value)) fail('INVALID_TEXT', `${label} is required and must be bounded safe text`);
  return value;
}

function iso(value, label) {
  if (typeof value !== 'string') fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  return { utc: new Date(ms).toISOString(), ms };
}

function refs(value, label, proof = false) {
  const input = denseArray(value, label, STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_MAX_REFS);
  const normalized = input.map((entry, index) => {
    if (typeof entry !== 'string') fail('INVALID_REF', `${label}[${index}] must be a string`);
    if (proof) {
      if (!SAFE_PROOF_REF.test(entry) || entry.includes('..')) fail('UNSAFE_PROOF_REF', `${label}[${index}] is unsafe`);
      return entry;
    }
    return id(entry, `${label}[${index}]`);
  });
  if (new Set(normalized).size !== normalized.length) fail('DUPLICATE_REF', `${label} contains duplicates`);
  return normalized.sort();
}

function normalizeEvidence(input, index) {
  const label = `evidence[${index}]`;
  assertPlain(input, EVIDENCE_KEYS, label);
  if (!STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_FAMILIES.includes(input.family)) {
    fail('INVALID_FAMILY', `${label}.family is unsupported`);
  }
  if (!AUTHORITY_VALUES.has(input.authorityClass)) fail('INVALID_AUTHORITY', `${label}.authorityClass is unsupported`);
  if (typeof input.retentionDeclared !== 'boolean') fail('INVALID_RETENTION', `${label}.retentionDeclared must be boolean`);
  const observed = iso(input.observedAtUtc, `${label}.observedAtUtc`);
  return {
    evidenceId: id(input.evidenceId, `${label}.evidenceId`),
    family: input.family,
    subjectRef: id(input.subjectRef, `${label}.subjectRef`),
    state: safeText(input.state, `${label}.state`),
    authorityClass: input.authorityClass,
    observedAtUtc: observed.utc,
    observedAtMs: observed.ms,
    source: safeText(input.source, `${label}.source`),
    proofRefs: refs(input.proofRefs, `${label}.proofRefs`, true),
    relationshipRefs: refs(input.relationshipRefs, `${label}.relationshipRefs`),
    retentionDeclared: input.retentionDeclared,
  };
}

function weakestAuthority(items) {
  return [...items]
    .sort((left, right) => (AUTHORITY_RANK.get(left.authorityClass) ?? -1) - (AUTHORITY_RANK.get(right.authorityClass) ?? -1))[0]
    ?.authorityClass || STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
}

function buildObservation(family, items) {
  const oldest = Math.min(...items.map((item) => item.observedAtMs));
  const proofRefs = [...new Set(items.flatMap((item) => item.proofRefs))].sort().slice(0, 32);
  const indexable = items.filter((item) => item.subjectRef && item.state && item.source && item.proofRefs.length > 0).length;
  const compactMetadata = items.map((item) => ({
    evidenceId: item.evidenceId,
    subjectRef: item.subjectRef,
    state: item.state,
    authorityClass: item.authorityClass,
    source: item.source,
    relationshipRefs: item.relationshipRefs,
  }));
  return Object.freeze({
    domain: FAMILY_DOMAIN[family],
    authorityClass: weakestAuthority(items),
    recordCount: items.length,
    approximateBytes: Buffer.byteLength(JSON.stringify(compactMetadata), 'utf8'),
    observedAtUtc: new Date(oldest).toISOString(),
    source: FAMILY_SOURCE[family],
    retrievalCoverage: items.length ? Math.round((indexable / items.length) * 10_000) / 10_000 : 0,
    retentionPolicy: items.every((item) => item.retentionDeclared) ? 'DECLARED' : 'UNKNOWN',
    deletionState: 'UNKNOWN',
    conflictState: 'UNKNOWN',
    backupState: 'UNKNOWN',
    proofRefs: Object.freeze(proofRefs),
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function buildStephanosMemoryAdequacyEvidenceCollectorsV1(packet) {
  assertPlain(packet, TOP_KEYS, 'packet');
  if (packet.schemaVersion !== STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_INPUT_SCHEMA_V1) {
    fail('UNSUPPORTED_SCHEMA', 'packet.schemaVersion is unsupported');
  }
  const collectorTime = iso(packet.observedAtUtc, 'packet.observedAtUtc');
  const evidence = denseArray(packet.evidence, 'packet.evidence', STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_MAX_ITEMS)
    .map(normalizeEvidence)
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const ids = new Set();
  for (const item of evidence) {
    if (ids.has(item.evidenceId)) fail('DUPLICATE_EVIDENCE', `duplicate evidenceId ${item.evidenceId}`);
    ids.add(item.evidenceId);
    if (item.observedAtMs > collectorTime.ms + 60_000) fail('FUTURE_EVIDENCE', `${item.evidenceId} is future-dated beyond tolerance`);
  }

  const byFamily = new Map();
  for (const item of evidence) {
    if (!byFamily.has(item.family)) byFamily.set(item.family, []);
    byFamily.get(item.family).push(item);
  }
  const observations = STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_FAMILIES
    .filter((family) => byFamily.has(family))
    .map((family) => buildObservation(family, byFamily.get(family)));

  const result = {
    schemaVersion: STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_OUTPUT_SCHEMA_V1,
    kind: 'stephanos.memory_adequacy.evidence_collectors',
    readOnly: true,
    observedAtUtc: collectorTime.utc,
    evidenceCount: evidence.length,
    observationCount: observations.length,
    observations,
    authority: STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_AUTHORITY,
  };
  const serializedBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (serializedBytes > STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_MAX_BYTES) {
    fail('OUTPUT_TOO_LARGE', 'collector output exceeds bounded serialized size');
  }
  return deepFreeze({ ...result, serializedBytes });
}
