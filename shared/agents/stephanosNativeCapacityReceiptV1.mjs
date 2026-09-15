import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

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

function text(v) { return typeof v === 'string' ? v.trim() : ''; }
function timestamp(v) { const s=text(v); if(!/(?:Z|[+-]\d{2}:\d{2})$/i.test(s)) return null; const n=Date.parse(s); return Number.isFinite(n)?n:null; }
function exactKeys(v, keys) { return v && Object.getPrototypeOf(v) === Object.prototype && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort()); }
function plainArray(v) { return Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype; }
function uniqueStrings(v) { if(!plainArray(v)) return null; const out=v.map(text); return out.every(Boolean) && out.length===new Set(out).size ? out : null; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function frozen(v){ return Object.freeze(v); }

export function validateStephanosNativeCapacityPayload(payload = {}, expected = {}) {
  const errors=[];
  if(!exactKeys(payload,PAYLOAD_KEYS)) errors.push('payload-shape-invalid');
  if(payload.schemaVersion!==STEPHANOS_NATIVE_CAPACITY_PAYLOAD_SCHEMA) errors.push('payload-schema-invalid');
  if(!SAFE_ID.test(text(payload.receiptId))) errors.push('receipt-id-invalid');
  if(!REPOSITORY.test(text(payload.repository)) || (expected.repository && payload.repository!==expected.repository)) errors.push('repository-invalid');
  if(!SHA40.test(text(payload.sourceHead).toLowerCase()) || (expected.sourceHead && text(payload.sourceHead).toLowerCase()!==text(expected.sourceHead).toLowerCase())) errors.push('source-head-invalid');
  if(!SAFE_ID.test(text(payload.workerId)) || (expected.workerId && payload.workerId!==expected.workerId)) errors.push('worker-id-invalid');
  if(payload.provider!=='ollama-local' || payload.transport!=='http-loopback-fixed' || !ALLOWED_ENDPOINTS.has(payload.endpoint)) errors.push('local-transport-invalid');
  if(!SAFE_ID.test(text(payload.model)) || !SHA256.test(text(payload.modelInventorySha256))) errors.push('model-proof-invalid');
  if(!SAFE_ID.test(text(payload.qualificationId))) errors.push('qualification-id-invalid');
  const classes=uniqueStrings(payload.supportedTaskClasses); const operations=uniqueStrings(payload.supportedOperations); const refs=uniqueStrings(payload.proofRefs);
  if(!classes?.length || !operations?.includes('SOURCE_CONSTRUCTION') || !operations?.includes('FOCUSED_TESTS')) errors.push('capability-invalid');
  if(operations?.some((op)=>['MERGE_PULL_REQUEST','DEPLOY_RUNTIME','ARBITRARY_COMMAND','LEASE_SEIZURE'].includes(op))) errors.push('authority-widening-forbidden');
  if(!refs?.length || refs.some((ref)=>!/^proofs?\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/.test(ref))) errors.push('proof-refs-invalid');
  const observed=timestamp(payload.observedAtUtc); const expires=timestamp(payload.expiresAtUtc); const now=timestamp(expected.nowUtc||payload.observedAtUtc);
  if(observed===null||expires===null||now===null||observed>now+60000||expires<=now||expires<=observed||expires-observed>15*60*1000) errors.push('freshness-invalid');
  if(!Number.isSafeInteger(payload.queueDepth)||payload.queueDepth<0||payload.queueDepth>64) errors.push('queue-depth-invalid');
  if(!Number.isFinite(payload.p95StartLatencySeconds)||payload.p95StartLatencySeconds<0||payload.p95StartLatencySeconds>600) errors.push('latency-invalid');
  if(!['READY','PRESSURED'].includes(payload.loadState)) errors.push('load-state-invalid');
  if(!SHA256.test(text(payload.requestSha256))||!SHA256.test(text(payload.responseSha256))) errors.push('execution-digest-invalid');
  if(payload.loadState!=='READY') errors.push('load-not-ready');
  return frozen({valid:errors.length===0,errors:frozen([...new Set(errors)]),payload:errors.length?null:payload});
}

export function createStephanosNativeCapacityReceipt(payload, { privateKeyPem, keyId } = {}) {
  const validation=validateStephanosNativeCapacityPayload(payload,{nowUtc:payload?.observedAtUtc});
  if(!validation.valid||!text(privateKeyPem)||!SAFE_ID.test(text(keyId))) return null;
  const bytes=Buffer.from(canonical(payload),'utf8');
  const signatureBase64=cryptoSign(null,bytes,privateKeyPem).toString('base64');
  return frozen({schemaVersion:STEPHANOS_NATIVE_CAPACITY_RECEIPT_SCHEMA,algorithm:'Ed25519',keyId, payload, signatureBase64});
}

export function verifyStephanosNativeCapacityReceipt(receipt={}, { publicKeyPem, expected={} } = {}) {
  const errors=[];
  if(!exactKeys(receipt,RECEIPT_KEYS)) errors.push('receipt-shape-invalid');
  if(receipt.schemaVersion!==STEPHANOS_NATIVE_CAPACITY_RECEIPT_SCHEMA||receipt.algorithm!=='Ed25519'||!SAFE_ID.test(text(receipt.keyId))) errors.push('receipt-identity-invalid');
  const payloadValidation=validateStephanosNativeCapacityPayload(receipt.payload,expected);
  if(!payloadValidation.valid) errors.push(...payloadValidation.errors);
  let signatureValid=false;
  if(text(publicKeyPem)&&typeof receipt.signatureBase64==='string') {
    try { signatureValid=cryptoVerify(null,Buffer.from(canonical(receipt.payload),'utf8'),publicKeyPem,Buffer.from(receipt.signatureBase64,'base64')); } catch { signatureValid=false; }
  }
  if(!signatureValid) errors.push('signature-invalid');
  return frozen({valid:errors.length===0,errors:frozen([...new Set(errors)]),payload:errors.length?null:receipt.payload});
}

export function createStephanosNativeSourceAuthority(payload, options={}) {
  const observed=timestamp(payload?.observedAtUtc); const expires=timestamp(payload?.expiresAtUtc);
  if(observed===null||expires===null) return null;
  const authority={
    schemaVersion:STEPHANOS_NATIVE_AUTHORITY_SCHEMA,
    authorityId:text(options.authorityId)||`native-authority-${hash(`${payload.receiptId}\n${payload.sourceHead}`).slice(0,24)}`,
    repository:payload.repository, sourceHead:text(payload.sourceHead).toLowerCase(), workerId:payload.workerId,
    capacityReceiptId:payload.receiptId, qualificationId:payload.qualificationId,
    allowedOperations:frozen(['SOURCE_CONSTRUCTION','FOCUSED_TESTS']),
    allowedTaskClasses:frozen([...(payload.supportedTaskClasses||[])]),
    issuedAtUtc:payload.observedAtUtc, expiresAtUtc:payload.expiresAtUtc,
    leaseSeizureAllowed:false, mergeAuthority:false, arbitraryCommandAllowed:false,
  };
  return frozen(authority);
}

export function validateStephanosNativeSourceAuthority(authority={}, payload={}) {
  const errors=[];
  if(!exactKeys(authority,AUTHORITY_KEYS)||authority.schemaVersion!==STEPHANOS_NATIVE_AUTHORITY_SCHEMA) errors.push('authority-shape-invalid');
  if(!SAFE_ID.test(text(authority.authorityId))) errors.push('authority-id-invalid');
  if(authority.repository!==payload.repository||text(authority.sourceHead).toLowerCase()!==text(payload.sourceHead).toLowerCase()||authority.workerId!==payload.workerId||authority.capacityReceiptId!==payload.receiptId||authority.qualificationId!==payload.qualificationId) errors.push('authority-binding-mismatch');
  if(JSON.stringify(authority.allowedOperations)!==JSON.stringify(['SOURCE_CONSTRUCTION','FOCUSED_TESTS'])) errors.push('authority-operations-invalid');
  if(!plainArray(authority.allowedTaskClasses)||!authority.allowedTaskClasses.length) errors.push('authority-task-classes-invalid');
  if(authority.leaseSeizureAllowed!==false||authority.mergeAuthority!==false||authority.arbitraryCommandAllowed!==false) errors.push('authority-widening-forbidden');
  if(authority.issuedAtUtc!==payload.observedAtUtc||authority.expiresAtUtc!==payload.expiresAtUtc) errors.push('authority-freshness-binding-invalid');
  return frozen({valid:errors.length===0,errors:frozen([...new Set(errors)])});
}
