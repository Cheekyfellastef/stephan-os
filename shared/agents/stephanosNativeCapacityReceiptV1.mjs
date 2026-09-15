import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export const STEPHANOS_NATIVE_CAPACITY_PAYLOAD_SCHEMA = 'stephanos.native-capacity-payload.v1';
export const STEPHANOS_NATIVE_CAPACITY_RECEIPT_SCHEMA = 'stephanos.native-capacity-receipt.v1';
export const STEPHANOS_NATIVE_AUTHORITY_SCHEMA = 'stephanos.native-source-authority.v1';
export const STEPHANOS_NATIVE_ROUTE = 'STEPHANOS_NATIVE';
export const STEPHANOS_NATIVE_ADAPTER = 'stephanos-native';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ALLOWED_ENDPOINTS = new Set(['http://127.0.0.1:11434','http://localhost:11434']);
const PAYLOAD_KEYS = Object.freeze([
  'schemaVersion','receiptId','repository','sourceHead','workerId','provider','transport','endpoint','model',
  'modelInventorySha256','qualificationId','supportedTaskClasses','supportedOperations','observedAtUtc','expiresAtUtc',
  'queueDepth','p95StartLatencySeconds','loadState','requestSha256','responseSha256','proofRefs',
]);
const RECEIPT_KEYS = Object.freeze(['schemaVersion','algorithm','keyId','payload','signatureBase64']);
const AUTHORITY_KEYS = Object.freeze([
  'schemaVersion','authorityId','repository','sourceHead','workerId','capacityReceiptId','qualificationId',
  'allowedOperations','allowedTaskClasses','issuedAtUtc','expiresAtUtc','leaseSeizureAllowed','mergeAuthority','arbitraryCommandAllowed',
]);
const EXPECTED_KEYS = Object.freeze(['repository','sourceHead','workerId','nowUtc']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== 'string')) return false;
  if (JSON.stringify([...ownKeys].sort()) !== JSON.stringify([...keys].sort())) return false;
  return ownKeys.every((key) => {
    const descriptor = descriptors[key];
    return Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable === true;
  });
}
function dataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
function plainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string') || keys.length !== value.length + 1 || !Object.prototype.hasOwnProperty.call(descriptors, 'length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return false;
  }
  return true;
}
function uniqueStrings(value) {
  if (!plainArray(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const out = Array.from({ length:value.length }, (_, index) => text(descriptors[String(index)].value));
  return out.every(Boolean) && out.length === new Set(out).size ? out : null;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function frozen(value) { return Object.freeze(value); }
function ed25519PrivateKey(value) {
  if (!text(value)) return null;
  try {
    const key = createPrivateKey(value);
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}
function ed25519PublicKey(value) {
  if (!text(value)) return null;
  try {
    const key = createPublicKey(value);
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}
function normalizeVerificationContext(expected) {
  if (!exactKeys(expected, EXPECTED_KEYS)) return null;
  const repository = text(expected.repository);
  const sourceHead = text(expected.sourceHead).toLowerCase();
  const workerId = text(expected.workerId);
  const nowUtc = text(expected.nowUtc);
  if (!REPOSITORY.test(repository) || !SHA40.test(sourceHead) || !SAFE_ID.test(workerId) || timestamp(nowUtc) === null) return null;
  return frozen({ repository, sourceHead, workerId, nowUtc });
}

export function validateStephanosNativeCapacityPayload(payload = {}, expected = {}) {
  const errors = [];
  if (!exactKeys(payload, PAYLOAD_KEYS)) return frozen({ valid:false, errors:frozen(['payload-shape-invalid']), payload:null });
  if (payload.schemaVersion !== STEPHANOS_NATIVE_CAPACITY_PAYLOAD_SCHEMA) errors.push('payload-schema-invalid');
  if (!SAFE_ID.test(text(payload.receiptId))) errors.push('receipt-id-invalid');
  if (!REPOSITORY.test(text(payload.repository)) || (expected.repository && payload.repository !== expected.repository)) errors.push('repository-invalid');
  if (!SHA40.test(text(payload.sourceHead).toLowerCase()) || (expected.sourceHead && text(payload.sourceHead).toLowerCase() !== text(expected.sourceHead).toLowerCase())) errors.push('source-head-invalid');
  if (!SAFE_ID.test(text(payload.workerId)) || (expected.workerId && payload.workerId !== expected.workerId)) errors.push('worker-id-invalid');
  if (payload.provider !== 'ollama-local' || payload.transport !== 'http-loopback-fixed' || !ALLOWED_ENDPOINTS.has(payload.endpoint)) errors.push('local-transport-invalid');
  if (!SAFE_ID.test(text(payload.model)) || !SHA256.test(text(payload.modelInventorySha256))) errors.push('model-proof-invalid');
  if (!SAFE_ID.test(text(payload.qualificationId))) errors.push('qualification-id-invalid');
  const classes = uniqueStrings(payload.supportedTaskClasses);
  const operations = uniqueStrings(payload.supportedOperations);
  const refs = uniqueStrings(payload.proofRefs);
  if (!classes?.length || !operations?.includes('SOURCE_CONSTRUCTION') || !operations?.includes('FOCUSED_TESTS')) errors.push('capability-invalid');
  if (operations?.some((operation) => ['MERGE_PULL_REQUEST','DEPLOY_RUNTIME','ARBITRARY_COMMAND','LEASE_SEIZURE'].includes(operation))) errors.push('authority-widening-forbidden');
  if (!refs?.length || refs.some((ref) => !/^proofs?\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/.test(ref))) errors.push('proof-refs-invalid');
  const observed = timestamp(payload.observedAtUtc);
  const expires = timestamp(payload.expiresAtUtc);
  const now = timestamp(expected.nowUtc || payload.observedAtUtc);
  if (observed === null || expires === null || now === null || observed > now + 60_000 || expires <= now || expires <= observed || expires - observed > 15 * 60 * 1000) errors.push('freshness-invalid');
  if (!Number.isSafeInteger(payload.queueDepth) || payload.queueDepth < 0 || payload.queueDepth > 64) errors.push('queue-depth-invalid');
  if (!Number.isFinite(payload.p95StartLatencySeconds) || payload.p95StartLatencySeconds < 0 || payload.p95StartLatencySeconds > 600) errors.push('latency-invalid');
  if (!['READY','PRESSURED'].includes(payload.loadState)) errors.push('load-state-invalid');
  if (!SHA256.test(text(payload.requestSha256)) || !SHA256.test(text(payload.responseSha256))) errors.push('execution-digest-invalid');
  if (payload.loadState !== 'READY') errors.push('load-not-ready');
  return frozen({ valid:errors.length === 0, errors:frozen([...new Set(errors)]), payload:errors.length ? null : payload });
}

export function createStephanosNativeCapacityReceipt(payload, options = {}) {
  if (!exactKeys(payload, PAYLOAD_KEYS)) return null;
  const keyId = text(dataValue(options, 'keyId'));
  const privateKey = ed25519PrivateKey(dataValue(options, 'privateKeyPem'));
  if (!privateKey || !SAFE_ID.test(keyId)) return null;
  const validation = validateStephanosNativeCapacityPayload(payload, { nowUtc:payload.observedAtUtc });
  if (!validation.valid) return null;
  const bytes = Buffer.from(canonical(payload), 'utf8');
  let signatureBase64 = '';
  try {
    signatureBase64 = cryptoSign(null, bytes, privateKey).toString('base64');
  } catch {
    return null;
  }
  return frozen({ schemaVersion:STEPHANOS_NATIVE_CAPACITY_RECEIPT_SCHEMA, algorithm:'Ed25519', keyId, payload, signatureBase64 });
}

export function verifyStephanosNativeCapacityReceipt(receipt = {}, options = {}) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) return frozen({ valid:false, errors:frozen(['receipt-shape-invalid']), payload:null });
  if (receipt.schemaVersion !== STEPHANOS_NATIVE_CAPACITY_RECEIPT_SCHEMA || receipt.algorithm !== 'Ed25519' || !SAFE_ID.test(text(receipt.keyId))) errors.push('receipt-identity-invalid');
  const expected = normalizeVerificationContext(dataValue(options, 'expected'));
  if (!expected) errors.push('verification-context-invalid');
  const payloadValidation = validateStephanosNativeCapacityPayload(receipt.payload, expected || {});
  if (!payloadValidation.valid) errors.push(...payloadValidation.errors);
  const publicKey = ed25519PublicKey(dataValue(options, 'publicKeyPem'));
  if (!publicKey) errors.push('verification-key-invalid');
  let signatureValid = false;
  if (payloadValidation.valid && publicKey && typeof receipt.signatureBase64 === 'string') {
    try {
      signatureValid = cryptoVerify(
        null,
        Buffer.from(canonical(receipt.payload), 'utf8'),
        publicKey,
        Buffer.from(receipt.signatureBase64, 'base64'),
      );
    } catch {
      signatureValid = false;
    }
  }
  if (!signatureValid) errors.push('signature-invalid');
  return frozen({ valid:errors.length === 0, errors:frozen([...new Set(errors)]), payload:errors.length ? null : receipt.payload });
}

export function createStephanosNativeSourceAuthority(receipt, options = {}) {
  const verification = verifyStephanosNativeCapacityReceipt(receipt, {
    publicKeyPem:dataValue(options, 'publicKeyPem'),
    expected:dataValue(options, 'expected'),
  });
  if (!verification.valid) return null;
  const payload = verification.payload;
  const requestedAuthorityId = text(dataValue(options, 'authorityId'));
  const authority = {
    schemaVersion:STEPHANOS_NATIVE_AUTHORITY_SCHEMA,
    authorityId:requestedAuthorityId || `native-authority-${hash(`${payload.receiptId}\n${payload.sourceHead}`).slice(0,24)}`,
    repository:payload.repository,
    sourceHead:text(payload.sourceHead).toLowerCase(),
    workerId:payload.workerId,
    capacityReceiptId:payload.receiptId,
    qualificationId:payload.qualificationId,
    allowedOperations:frozen(['SOURCE_CONSTRUCTION','FOCUSED_TESTS']),
    allowedTaskClasses:frozen([...payload.supportedTaskClasses]),
    issuedAtUtc:payload.observedAtUtc,
    expiresAtUtc:payload.expiresAtUtc,
    leaseSeizureAllowed:false,
    mergeAuthority:false,
    arbitraryCommandAllowed:false,
  };
  return SAFE_ID.test(authority.authorityId) ? frozen(authority) : null;
}

export function validateStephanosNativeSourceAuthority(authority = {}, receipt = {}, options = {}) {
  const verification = verifyStephanosNativeCapacityReceipt(receipt, {
    publicKeyPem:dataValue(options, 'publicKeyPem'),
    expected:dataValue(options, 'expected'),
  });
  if (!verification.valid) return frozen({ valid:false, errors:frozen([`capacity-receipt-invalid:${verification.errors[0] || 'unknown'}`]) });
  const payload = verification.payload;
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.schemaVersion !== STEPHANOS_NATIVE_AUTHORITY_SCHEMA) return frozen({ valid:false, errors:frozen(['authority-shape-invalid']) });
  const errors = [];
  if (!SAFE_ID.test(text(authority.authorityId))) errors.push('authority-id-invalid');
  if (authority.repository !== payload.repository
    || text(authority.sourceHead).toLowerCase() !== text(payload.sourceHead).toLowerCase()
    || authority.workerId !== payload.workerId
    || authority.capacityReceiptId !== payload.receiptId
    || authority.qualificationId !== payload.qualificationId) errors.push('authority-binding-mismatch');
  const authorityOperations = uniqueStrings(authority.allowedOperations);
  if (!authorityOperations
    || authorityOperations.length !== 2
    || authorityOperations[0] !== 'SOURCE_CONSTRUCTION'
    || authorityOperations[1] !== 'FOCUSED_TESTS') errors.push('authority-operations-invalid');
  const authorityTaskClasses = uniqueStrings(authority.allowedTaskClasses);
  const payloadTaskClasses = uniqueStrings(payload.supportedTaskClasses);
  if (!authorityTaskClasses?.length
    || !payloadTaskClasses?.length
    || authorityTaskClasses.length !== payloadTaskClasses.length
    || authorityTaskClasses.some((taskClass, index) => taskClass !== payloadTaskClasses[index])) errors.push('authority-task-classes-invalid');
  if (authority.leaseSeizureAllowed !== false || authority.mergeAuthority !== false || authority.arbitraryCommandAllowed !== false) errors.push('authority-widening-forbidden');
  if (authority.issuedAtUtc !== payload.observedAtUtc || authority.expiresAtUtc !== payload.expiresAtUtc) errors.push('authority-freshness-binding-invalid');
  return frozen({ valid:errors.length === 0, errors:frozen([...new Set(errors)]) });
}
