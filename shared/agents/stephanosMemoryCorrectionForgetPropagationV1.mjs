import { createHash } from 'node:crypto';

export const STEPHANOS_MEMORY_CHANGE_INPUT_SCHEMA_V1 = 'stephanos.memory-change-propagation-input.v1';
export const STEPHANOS_MEMORY_CHANGE_PLAN_SCHEMA_V1 = 'stephanos.memory-change-propagation-plan.v1';
export const STEPHANOS_MEMORY_CHANGE_OPERATIONS = Object.freeze(['CORRECT', 'FORGET']);
export const STEPHANOS_MEMORY_DERIVATIVE_TYPES = Object.freeze([
  'RETRIEVAL_INDEX',
  'CONTEXT_PACK_CACHE',
  'RELATIONSHIP_PROJECTION',
  'SEMANTIC_PROJECTION',
  'PROVIDER_SUMMARY_CACHE',
  'LOCAL_MIRROR',
  'ARCHIVE_INDEX',
  'LESSON_OR_METHOD_CANDIDATE',
]);
export const STEPHANOS_MEMORY_PROPAGATION_DISPOSITIONS = Object.freeze([
  'CURRENT_OK',
  'INVALIDATE_REQUIRED',
  'REBUILD_REQUIRED',
  'TOMBSTONE_REQUIRED',
  'HOLD_AUTHORITY',
  'HOLD_CONFLICT',
  'NO_INFLUENCE',
]);
export const STEPHANOS_MEMORY_CHANGE_MAX_DERIVATIVES = 256;
export const STEPHANOS_MEMORY_CHANGE_MAX_REFS = 8;
export const STEPHANOS_MEMORY_CHANGE_MAX_PLAN_BYTES = 384 * 1024;

export const STEPHANOS_MEMORY_CHANGE_AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  correctionExecutionAllowed: false,
  forgetExecutionAllowed: false,
  deleteAllowed: false,
  tombstoneWriteAllowed: false,
  derivativeMutationAllowed: false,
  cacheInvalidationExecutionAllowed: false,
  archiveMutationAllowed: false,
  providerPromptUseAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

const TOP_KEYS = new Set(['schemaVersion', 'changeReceipt', 'derivatives']);
const RECEIPT_KEYS = new Set([
  'changeId', 'operation', 'recordId', 'authorityConfirmed', 'authorityClass',
  'occurredAtUtc', 'oldDigest', 'newDigest', 'sourceRefs', 'proofRefs',
]);
const DERIVATIVE_KEYS = new Set([
  'derivativeId', 'derivativeType', 'sourceRecordId', 'sourceDigest', 'state',
  'authorityClass', 'influenceAllowed', 'surface', 'sourceRefs',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,191}$/;
const SAFE_TEXT = /^[\p{L}\p{N} _./:#@+()\[\]-]{0,256}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const AUTHORITY_CLASSES = new Set([
  'SHARED_AUTHORITY', 'OPERATOR_CONFIRMED', 'CANONICAL_PROJECT_EVIDENCE',
  'LOCAL_MIRROR', 'PENDING_INTENT', 'INFERRED', 'UNKNOWN',
]);
const DERIVATIVE_STATES = new Set(['ACTIVE', 'INVALIDATED', 'TOMBSTONE', 'SUPERSEDED']);

function fail(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlain(value, allowed, label) {
  if (!isPlainObject(value)) fail('INVALID_SHAPE', `${label} must be a plain data object`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.has(key)) fail('UNEXPECTED_FIELD', `${label}.${key} is not allowed`);
    if (!('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}.${key} must be a data property`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
}

function denseArray(value, label, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('INVALID_ARRAY', `${label} must be a standard array`);
  if (value.length > max) fail('LIMIT_EXCEEDED', `${label} exceeds ${max}`);
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) fail('SPARSE_ARRAY_REJECTED', `${label} must be dense`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}[${i}] must be a data property`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
  return [...value];
}

function text(value, label, { required = false, id = false, digest = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('MISSING_FIELD', `${label} is required`);
    return null;
  }
  if (typeof value !== 'string') fail('INVALID_STRING', `${label} must be a string`);
  if (id && !SAFE_ID.test(value)) fail('INVALID_ID', `${label} is unsafe`);
  if (digest && !DIGEST.test(value)) fail('INVALID_DIGEST', `${label} must be sha256:<64 lowercase hex>`);
  if (!id && !digest && !SAFE_TEXT.test(value)) fail('INVALID_TEXT', `${label} contains unsupported characters or is too long`);
  return value;
}

function iso(value, label) {
  const captured = text(value, label, { required: true });
  const ms = Date.parse(captured);
  if (!Number.isFinite(ms)) fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  return new Date(ms).toISOString();
}

function refs(value, label) {
  if (value === undefined || value === null) return [];
  const list = denseArray(value, label, STEPHANOS_MEMORY_CHANGE_MAX_REFS);
  return [...new Set(list.map((entry, index) => text(entry, `${label}[${index}]`, { required: true, id: true })))].sort();
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeReceipt(input) {
  assertPlain(input, RECEIPT_KEYS, 'changeReceipt');
  const operation = text(input.operation, 'changeReceipt.operation', { required: true });
  if (!STEPHANOS_MEMORY_CHANGE_OPERATIONS.includes(operation)) fail('INVALID_OPERATION', 'changeReceipt.operation is unsupported');
  if (typeof input.authorityConfirmed !== 'boolean') fail('INVALID_AUTHORITY', 'changeReceipt.authorityConfirmed must be boolean');
  const authorityClass = text(input.authorityClass, 'changeReceipt.authorityClass', { required: true });
  if (!AUTHORITY_CLASSES.has(authorityClass)) fail('INVALID_AUTHORITY', 'changeReceipt.authorityClass is unsupported');
  const oldDigest = text(input.oldDigest, 'changeReceipt.oldDigest', { required: true, digest: true });
  const newDigest = text(input.newDigest, 'changeReceipt.newDigest', { digest: true });
  if (operation === 'CORRECT' && !newDigest) fail('MISSING_NEW_DIGEST', 'CORRECT requires changeReceipt.newDigest');
  if (operation === 'FORGET' && newDigest) fail('FORGET_HAS_NEW_CONTENT', 'FORGET must not carry a new content digest');
  return {
    changeId: text(input.changeId, 'changeReceipt.changeId', { required: true, id: true }),
    operation,
    recordId: text(input.recordId, 'changeReceipt.recordId', { required: true, id: true }),
    authorityConfirmed: input.authorityConfirmed,
    authorityClass,
    occurredAtUtc: iso(input.occurredAtUtc, 'changeReceipt.occurredAtUtc'),
    oldDigest,
    newDigest,
    sourceRefs: refs(input.sourceRefs, 'changeReceipt.sourceRefs'),
    proofRefs: refs(input.proofRefs, 'changeReceipt.proofRefs'),
  };
}

function normalizeDerivative(input, index) {
  assertPlain(input, DERIVATIVE_KEYS, `derivatives[${index}]`);
  const derivativeType = text(input.derivativeType, `derivatives[${index}].derivativeType`, { required: true });
  if (!STEPHANOS_MEMORY_DERIVATIVE_TYPES.includes(derivativeType)) fail('INVALID_DERIVATIVE_TYPE', `derivatives[${index}].derivativeType is unsupported`);
  const state = text(input.state, `derivatives[${index}].state`, { required: true });
  if (!DERIVATIVE_STATES.has(state)) fail('INVALID_STATE', `derivatives[${index}].state is unsupported`);
  const authorityClass = text(input.authorityClass, `derivatives[${index}].authorityClass`, { required: true });
  if (!AUTHORITY_CLASSES.has(authorityClass)) fail('INVALID_AUTHORITY', `derivatives[${index}].authorityClass is unsupported`);
  if (typeof input.influenceAllowed !== 'boolean') fail('INVALID_INFLUENCE', `derivatives[${index}].influenceAllowed must be boolean`);
  return {
    derivativeId: text(input.derivativeId, `derivatives[${index}].derivativeId`, { required: true, id: true }),
    derivativeType,
    sourceRecordId: text(input.sourceRecordId, `derivatives[${index}].sourceRecordId`, { required: true, id: true }),
    sourceDigest: text(input.sourceDigest, `derivatives[${index}].sourceDigest`, { required: true, digest: true }),
    state,
    authorityClass,
    influenceAllowed: input.influenceAllowed,
    surface: text(input.surface, `derivatives[${index}].surface`),
    sourceRefs: refs(input.sourceRefs, `derivatives[${index}].sourceRefs`),
  };
}

function assertUniqueDerivatives(derivatives) {
  const ids = new Set();
  for (const derivative of derivatives) {
    if (ids.has(derivative.derivativeId)) fail('DUPLICATE_DERIVATIVE', `duplicate derivativeId ${derivative.derivativeId}`);
    ids.add(derivative.derivativeId);
  }
}

function classifyDerivative(receipt, derivative) {
  if (derivative.sourceRecordId !== receipt.recordId) {
    return ['NO_INFLUENCE', 'derivative is not sourced from the changed canonical record'];
  }
  if (!receipt.authorityConfirmed || !['SHARED_AUTHORITY', 'OPERATOR_CONFIRMED'].includes(receipt.authorityClass)) {
    return ['HOLD_AUTHORITY', 'change receipt is not authority-confirmed canonical memory'];
  }
  if (derivative.state === 'INVALIDATED' || derivative.state === 'TOMBSTONE') {
    return ['NO_INFLUENCE', 'derivative is already non-influential'];
  }

  if (receipt.operation === 'FORGET') {
    if (derivative.sourceDigest !== receipt.oldDigest) {
      return ['HOLD_CONFLICT', 'derivative digest does not match the forgotten canonical digest'];
    }
    return derivative.influenceAllowed
      ? ['INVALIDATE_REQUIRED', 'forgotten canonical memory must stop influencing derived retrieval or context']
      : ['NO_INFLUENCE', 'derivative already cannot influence future reasoning'];
  }

  if (derivative.sourceDigest === receipt.newDigest) {
    return ['CURRENT_OK', 'derivative already references the corrected canonical digest'];
  }
  if (derivative.sourceDigest === receipt.oldDigest) {
    return ['REBUILD_REQUIRED', 'derivative references the superseded canonical digest and must be rebuilt from corrected truth'];
  }
  return ['HOLD_CONFLICT', 'derivative references neither the old nor corrected canonical digest'];
}

function buildAuditTombstone(receipt) {
  if (receipt.operation !== 'FORGET' || !receipt.authorityConfirmed || !['SHARED_AUTHORITY', 'OPERATOR_CONFIRMED'].includes(receipt.authorityClass)) return null;
  const core = {
    schemaVersion: 'stephanos.memory-forget-audit-tombstone.v1',
    recordId: receipt.recordId,
    changeId: receipt.changeId,
    forgottenAtUtc: receipt.occurredAtUtc,
    priorDigest: receipt.oldDigest,
    authorityClass: receipt.authorityClass,
    sourceRefs: receipt.sourceRefs,
    proofRefs: receipt.proofRefs,
    contentRetained: false,
    futureInfluenceAllowed: false,
  };
  return { ...core, tombstoneDigest: digest(core) };
}

export function buildStephanosMemoryCorrectionForgetPropagationPlanV1(packet) {
  assertPlain(packet, TOP_KEYS, 'packet');
  if (packet.schemaVersion !== STEPHANOS_MEMORY_CHANGE_INPUT_SCHEMA_V1) fail('UNSUPPORTED_SCHEMA', 'packet.schemaVersion is unsupported');
  const receipt = normalizeReceipt(packet.changeReceipt);
  const derivatives = denseArray(packet.derivatives, 'derivatives', STEPHANOS_MEMORY_CHANGE_MAX_DERIVATIVES)
    .map(normalizeDerivative)
    .sort((a, b) => a.derivativeId.localeCompare(b.derivativeId));
  assertUniqueDerivatives(derivatives);

  const items = derivatives.map((derivative) => {
    const [disposition, reason] = classifyDerivative(receipt, derivative);
    return {
      derivativeId: derivative.derivativeId,
      derivativeType: derivative.derivativeType,
      sourceRecordId: derivative.sourceRecordId,
      sourceDigest: derivative.sourceDigest,
      disposition,
      reason,
    };
  });

  const summary = Object.fromEntries(STEPHANOS_MEMORY_PROPAGATION_DISPOSITIONS.map((entry) => [entry, 0]));
  for (const item of items) summary[item.disposition] += 1;
  const auditTombstone = buildAuditTombstone(receipt);
  if (auditTombstone) summary.TOMBSTONE_REQUIRED += 1;

  const core = {
    schemaVersion: STEPHANOS_MEMORY_CHANGE_PLAN_SCHEMA_V1,
    changeId: receipt.changeId,
    operation: receipt.operation,
    recordId: receipt.recordId,
    authorityConfirmed: receipt.authorityConfirmed,
    authorityClass: receipt.authorityClass,
    occurredAtUtc: receipt.occurredAtUtc,
    oldDigest: receipt.oldDigest,
    newDigest: receipt.newDigest,
    auditTombstone,
    itemCount: items.length,
    summary,
    items,
  };
  const planDigest = digest(core);
  const result = { ...core, planDigest, authority: STEPHANOS_MEMORY_CHANGE_AUTHORITY };
  const bytes = Buffer.byteLength(canonical(result), 'utf8');
  if (bytes > STEPHANOS_MEMORY_CHANGE_MAX_PLAN_BYTES) fail('PLAN_TOO_LARGE', 'propagation plan exceeds bounded serialized size');
  return deepFreeze({ ...result, serializedBytes: bytes });
}
