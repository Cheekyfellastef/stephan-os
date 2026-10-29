import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Wire encoding only. Neither well-formed bytes nor a signature-input digest
// enrolls a producer, authenticates a transaction or relaxes the rotation fence.
export const MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2 = 'stephanos.canonical-mailbox-native-evidence.v2';
export const MAILBOX_NATIVE_EVIDENCE_MAX_BYTES_V2 = 16 * 1024;
const repository = 'Cheekyfellastef/stephan-os';
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha40 = /^[a-f0-9]{40}$/;
const sha64 = /^[a-f0-9]{64}$/;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const envelopeKeys = ['schemaVersion', 'algorithm', 'enrollmentId', 'keyId', 'payload', 'signatureBase64'];
const payloadKeys = ['kind', 'repository', 'deviceIdSha256', 'producerId', 'producerPrincipalSha256',
  'producerProfileSha256', 'requestId', 'transitionId', 'phase', 'result', 'origin', 'source',
  'activation', 'epoch', 'barrier', 'guard', 'drain', 'originalTerminalSha256', 'proofArtifactSha256',
  'observedAtUtc', 'expiresAtUtc'];

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function assert(test, code = 'MAILBOX_NATIVE_EVIDENCE_SHAPE_INVALID') { if (!test) reject(code); }

// Snapshot descriptors rather than reading properties: no getters, toJSON,
// inherited fields, symbols or proxy traps may contribute signed bytes.
function snapshot(value, depth = 0, budget = { nodes: 0 }) {
  assert(++budget.nodes <= 512 && depth <= 12, 'MAILBOX_NATIVE_EVIDENCE_COMPLEXITY_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assert(value.length <= MAILBOX_NATIVE_EVIDENCE_MAX_BYTES_V2 && value.isWellFormed(), 'MAILBOX_NATIVE_EVIDENCE_STRING_INVALID');
    return value;
  }
  if (typeof value === 'number') {
    assert(Number.isSafeInteger(value) && !Object.is(value, -0), 'MAILBOX_NATIVE_EVIDENCE_INTEGER_REQUIRED');
    return value;
  }
  assert(typeof value === 'object' && !types.isProxy(value), 'MAILBOX_NATIVE_EVIDENCE_PLAIN_DATA_REQUIRED');
  const prototype = Object.getPrototypeOf(value);
  assert(prototype === Object.prototype || prototype === null, 'MAILBOX_NATIVE_EVIDENCE_PLAIN_DATA_REQUIRED');
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    assert(typeof key === 'string' && key.length <= 128 && key.isWellFormed(), 'MAILBOX_NATIVE_EVIDENCE_FIELD_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'MAILBOX_NATIVE_EVIDENCE_PLAIN_DATA_REQUIRED');
    result[key] = snapshot(descriptor.value, depth + 1, budget);
  }
  return result;
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function closed(value, fields) {
  assert(value !== null && typeof value === 'object');
  const keys = Object.keys(value);
  assert(keys.length === fields.length && keys.every(key => fields.includes(key)), 'MAILBOX_NATIVE_EVIDENCE_CLOSED_SCHEMA_REQUIRED');
}
function id(value) { assert(typeof value === 'string' && idPattern.test(value)); }
function digest(value) { assert(typeof value === 'string' && sha64.test(value)); }
function git(value) { assert(typeof value === 'string' && sha40.test(value)); }
function count(value, positive = false) { assert(Number.isSafeInteger(value) && value >= (positive ? 1 : 0)); }
function timestamp(value) {
  assert(typeof value === 'string' && iso.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value, 'MAILBOX_NATIVE_EVIDENCE_TIMESTAMP_INVALID');
}
function validatePayload(value) {
  closed(value, payloadKeys);
  assert(['CONTROL_TERMINAL', 'DRAIN_OBSERVATION'].includes(value.kind) && value.repository === repository);
  for (const key of ['deviceIdSha256', 'producerPrincipalSha256', 'producerProfileSha256', 'originalTerminalSha256', 'proofArtifactSha256']) digest(value[key]);
  // Phase/result are bounded wire tokens. The canonical transaction/state model
  // adjudicates their meaning; encoding never turns a token into an admission.
  for (const key of ['producerId', 'requestId', 'transitionId', 'phase', 'result']) id(value[key]);
  const origin = value.origin;
  closed(origin, ['kind', 'prNumber', 'commentId', 'commentBodySha256', 'createdAtUtc']);
  assert(origin.kind === 'ACTIVATION_PR_OWNER_CONTROL_V2');
  count(origin.prNumber, true); count(origin.commentId, true); digest(origin.commentBodySha256); timestamp(origin.createdAtUtc);
  const source = value.source;
  closed(source, ['protectedMainHead', 'protectedMainTreeSha', 'installedHead', 'installedTreeSha', 'installedClosureSha256', 'sourceRole']);
  for (const key of ['protectedMainHead', 'protectedMainTreeSha', 'installedHead', 'installedTreeSha']) git(source[key]);
  digest(source.installedClosureSha256); assert(['PREPARATION', 'ADOPTED'].includes(source.sourceRole));
  const activation = value.activation;
  closed(activation, ['prNumber', 'headSha', 'baseSha', 'treeSha', 'mergeCommitSha']);
  count(activation.prNumber, true);
  for (const key of ['headSha', 'baseSha', 'treeSha']) git(activation[key]);
  if (activation.mergeCommitSha !== null) git(activation.mergeCommitSha);
  closed(value.epoch, ['predecessorIssue', 'successorIssue']);
  count(value.epoch.predecessorIssue, true); count(value.epoch.successorIssue, true);
  assert(value.epoch.successorIssue > value.epoch.predecessorIssue);
  closed(value.barrier, ['highestCommandCommentId', 'inventorySha256', 'commentCount']);
  count(value.barrier.highestCommandCommentId); count(value.barrier.commentCount); digest(value.barrier.inventorySha256);
  closed(value.guard, ['generationId', 'ownerInstanceId', 'transactionSha256']);
  id(value.guard.generationId); id(value.guard.ownerInstanceId); digest(value.guard.transactionSha256);
  const drain = value.drain;
  const counts = ['acceptedCount', 'inlinePublicationCount', 'segmentedPublicationCount', 'ordinaryReceiptDebtCount',
    'historyPendingBeforeCount', 'historyPendingAfterCount', 'orphanAcceptedCount', 'actionPendingAggregateCount', 'actionBlockingCount'];
  closed(drain, [...counts, 'outboxInventorySha256', 'actionsInventorySha256', 'actionsObservedAtUtc']);
  for (const key of counts) count(drain[key]);
  digest(drain.outboxInventorySha256); digest(drain.actionsInventorySha256); timestamp(drain.actionsObservedAtUtc);
  timestamp(value.observedAtUtc); timestamp(value.expiresAtUtc);
}
function validateEnvelope(value) {
  closed(value, envelopeKeys);
  assert(value.schemaVersion === MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2 && value.algorithm === 'Ed25519');
  id(value.enrollmentId); id(value.keyId);
  assert(typeof value.signatureBase64 === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value.signatureBase64)
    && Buffer.from(value.signatureBase64, 'base64').length === 64
    && Buffer.from(value.signatureBase64, 'base64').toString('base64') === value.signatureBase64,
  'MAILBOX_NATIVE_EVIDENCE_SIGNATURE_ENCODING_INVALID');
  validatePayload(value.payload);
}

// A bounded JSON reader detects duplicate *decoded* keys while constructing the
// document, before any whole-document JSON.parse could erase them. Only JSON
// string tokens use the platform parser. Arrays/floats have no place in this
// closed wire schema and are rejected rather than silently normalized.
function parseUnique(text) {
  let index = 0, nodes = 0;
  function whitespace() { while (/[\x20\t\r\n]/.test(text[index] || '\0')) index++; }
  function string() {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '\\') { index++; continue; }
      if (char === '"') {
        try { return JSON.parse(text.slice(start, index)); } catch { reject('MAILBOX_NATIVE_EVIDENCE_JSON_INVALID'); }
      }
    }
    reject('MAILBOX_NATIVE_EVIDENCE_JSON_INVALID');
  }
  function read(depth = 0) {
    assert(++nodes <= 512 && depth <= 12, 'MAILBOX_NATIVE_EVIDENCE_COMPLEXITY_LIMIT');
    whitespace();
    if (text[index] === '"') return string();
    if (text[index] === '{') {
      index++; whitespace();
      const result = Object.create(null);
      if (text[index] === '}') { index++; return result; }
      for (;;) {
        assert(text[index] === '"', 'MAILBOX_NATIVE_EVIDENCE_JSON_INVALID');
        const key = string();
        assert(!Object.hasOwn(result, key), 'MAILBOX_NATIVE_EVIDENCE_DUPLICATE_KEY');
        whitespace(); assert(text[index++] === ':', 'MAILBOX_NATIVE_EVIDENCE_JSON_INVALID');
        result[key] = read(depth + 1); whitespace();
        const separator = text[index++];
        if (separator === '}') return result;
        assert(separator === ',', 'MAILBOX_NATIVE_EVIDENCE_JSON_INVALID'); whitespace();
      }
    }
    for (const [literal, value] of [['null', null], ['true', true], ['false', false]]) {
      if (text.startsWith(literal, index)) { index += literal.length; return value; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(index));
    assert(match, 'MAILBOX_NATIVE_EVIDENCE_JSON_INVALID');
    index += match[0].length;
    const value = Number(match[0]);
    assert(Number.isSafeInteger(value) && !Object.is(value, -0), 'MAILBOX_NATIVE_EVIDENCE_INTEGER_REQUIRED');
    return value;
  }
  const result = read(); whitespace();
  assert(index === text.length, 'MAILBOX_NATIVE_EVIDENCE_JSON_INVALID');
  return result;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length').get;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
function snapshotBytes(bytes) {
  assert(!types.isProxy(bytes) && Buffer.isBuffer(bytes) && Object.getPrototypeOf(bytes) === Buffer.prototype,
    'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED');
  let length, offset, backing;
  try { length = typedLength.call(bytes); offset = typedOffset.call(bytes); backing = typedBuffer.call(bytes); }
  catch { reject('MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED'); }
  assert(length > 0 && length <= MAILBOX_NATIVE_EVIDENCE_MAX_BYTES_V2, 'MAILBOX_NATIVE_EVIDENCE_SIZE_LIMIT');
  assert(!types.isSharedArrayBuffer(backing), 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED');
  for (const key of Reflect.ownKeys(bytes)) {
    // Typed element properties are the only permitted own properties. In
    // particular, a caller-supplied length/getter must never run during hashing.
    assert(typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)
      && Number(key) < length, 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED');
  }
  return Buffer.from(new Uint8Array(backing, offset, length));
}
export function encodeMailboxNativeEvidenceV2(envelope) {
  const clean = snapshot(envelope);
  validateEnvelope(clean);
  const bytes = Buffer.from(canonical(clean), 'utf8');
  assert(bytes.length <= MAILBOX_NATIVE_EVIDENCE_MAX_BYTES_V2, 'MAILBOX_NATIVE_EVIDENCE_SIZE_LIMIT');
  return bytes;
}
export function decodeMailboxNativeEvidenceV2(bytes) {
  bytes = snapshotBytes(bytes);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { reject('MAILBOX_NATIVE_EVIDENCE_UTF8_INVALID'); }
  const envelope = snapshot(parseUnique(text));
  validateEnvelope(envelope);
  assert(canonical(envelope) === text, 'MAILBOX_NATIVE_EVIDENCE_NONCANONICAL');
  return Object.freeze({ envelope: freeze(envelope), artifactSha256: createHash('sha256').update(bytes).digest('hex'),
    encodingValid: true, signatureVerified: false, nativeAuthorityVerified: false });
}
export function mailboxNativeEvidenceSignatureInputV2(payload) {
  const clean = snapshot(payload);
  validatePayload(clean);
  const bytes = Buffer.from(canonical(clean), 'utf8');
  assert(bytes.length <= MAILBOX_NATIVE_EVIDENCE_MAX_BYTES_V2, 'MAILBOX_NATIVE_EVIDENCE_SIZE_LIMIT');
  return Buffer.concat([Buffer.from(MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2, 'ascii'), Buffer.from([0]), bytes]);
}
