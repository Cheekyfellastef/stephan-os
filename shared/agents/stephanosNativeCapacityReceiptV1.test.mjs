import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  STEPHANOS_NATIVE_CAPACITY_PAYLOAD_SCHEMA,
  createStephanosNativeCapacityReceipt,
  createStephanosNativeSourceAuthority,
  validateStephanosNativeCapacityPayload,
  validateStephanosNativeSourceAuthority,
  verifyStephanosNativeCapacityReceipt,
} from './stephanosNativeCapacityReceiptV1.mjs';

const hash=(v)=>createHash('sha256').update(v).digest('hex');
const HEAD='b'.repeat(40);
const NOW='2026-09-15T14:41:00Z';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const privateKeyPem=privateKey.export({type:'pkcs8',format:'pem'});
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const {privateKey:rsaPrivateKey,publicKey:rsaPublicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const rsaPrivateKeyPem=rsaPrivateKey.export({type:'pkcs8',format:'pem'});
const rsaPublicKeyPem=rsaPublicKey.export({type:'spki',format:'pem'});
function payload(overrides={}) { return {
  schemaVersion:STEPHANOS_NATIVE_CAPACITY_PAYLOAD_SCHEMA, receiptId:'native-capacity-1', repository:'Cheekyfellastef/stephan-os', sourceHead:HEAD,
  workerId:'stephanos-native-battle-bridge', provider:'ollama-local', transport:'http-loopback-fixed', endpoint:'http://127.0.0.1:11434', model:'qwen:14b',
  modelInventorySha256:hash('qwen:14b\nqwen:32b'), qualificationId:'native-source-qualification-v1',
  supportedTaskClasses:['FOCUSED_REPAIR'], supportedOperations:['SOURCE_CONSTRUCTION','FOCUSED_TESTS'],
  observedAtUtc:'2026-09-15T14:40:00Z', expiresAtUtc:'2026-09-15T14:50:00Z', queueDepth:0, p95StartLatencySeconds:3, loadState:'READY',
  requestSha256:hash('request'), responseSha256:hash('response'), proofRefs:['proof/native-model-live-v1'], ...overrides,
}; }
function expected(p=payload(), overrides={}) { return {
  repository:p.repository,
  sourceHead:p.sourceHead,
  workerId:p.workerId,
  nowUtc:NOW,
  ...overrides,
}; }
function signedReceipt(p=payload()) {
  return createStephanosNativeCapacityReceipt(p,{privateKeyPem,keyId:'battle-bridge-native-capacity-key-v1'});
}
function authorityOptions(p=payload(), overrides={}) {
  return {publicKeyPem,expected:expected(p),...overrides};
}

test('fresh local Ollama capacity signs, verifies against exact target and yields non-seizing source authority',()=>{
  const p=payload();
  assert.equal(validateStephanosNativeCapacityPayload(p,expected(p)).valid,true);
  const receipt=signedReceipt(p);
  assert.ok(receipt);
  assert.equal(verifyStephanosNativeCapacityReceipt(receipt,{publicKeyPem,expected:expected(p)}).valid,true);
  const authority=createStephanosNativeSourceAuthority(receipt,authorityOptions(p));
  assert.ok(authority);
  assert.equal(validateStephanosNativeSourceAuthority(authority,receipt,authorityOptions(p)).valid,true);
  assert.equal(authority.leaseSeizureAllowed,false);
  assert.equal(authority.mergeAuthority,false);
});

test('verification requires independent clock and exact repository/head/worker bindings',()=>{
  const p=payload();
  const receipt=signedReceipt(p);
  const complete=expected(p);
  for (const missing of ['repository','sourceHead','workerId','nowUtc']) {
    const incomplete={...complete};
    delete incomplete[missing];
    const verdict=verifyStephanosNativeCapacityReceipt(receipt,{publicKeyPem,expected:incomplete});
    assert.equal(verdict.valid,false,`missing ${missing} must fail closed`);
    assert.ok(verdict.errors.includes('verification-context-invalid'));
  }
  const replay=verifyStephanosNativeCapacityReceipt(receipt,{publicKeyPem,expected:expected(p,{nowUtc:'2027-09-15T14:41:00Z'})});
  assert.equal(replay.valid,false);
  assert.ok(replay.errors.includes('freshness-invalid'));
});

test('source authority can only derive from a verified fresh receipt and exact context',()=>{
  const p=payload();
  const receipt=signedReceipt(p);
  assert.ok(createStephanosNativeSourceAuthority(receipt,authorityOptions(p)));
  assert.equal(createStephanosNativeSourceAuthority(receipt,{publicKeyPem,expected:expected(p,{nowUtc:'2027-09-15T14:41:00Z'})}),null);
  assert.equal(createStephanosNativeSourceAuthority(receipt,{publicKeyPem,expected:expected(p,{repository:'other/repo'})}),null);
  assert.equal(createStephanosNativeSourceAuthority(p,authorityOptions(p)),null);
  const tampered={...receipt,payload:{...receipt.payload,model:'qwen:32b'}};
  assert.equal(createStephanosNativeSourceAuthority(tampered,authorityOptions(p)),null);
});

test('tamper, replay/staleness, remote transport and authority widening fail closed',()=>{
  const p=payload();
  const receipt=signedReceipt(p);
  const tampered={...receipt,payload:{...receipt.payload,model:'qwen:32b'}};
  assert.equal(verifyStephanosNativeCapacityReceipt(tampered,{publicKeyPem,expected:expected(p)}).valid,false);
  assert.equal(validateStephanosNativeCapacityPayload(p,expected(p,{nowUtc:'2026-09-15T15:00:00Z'})).valid,false);
  assert.equal(validateStephanosNativeCapacityPayload(payload({endpoint:'http://192.168.1.2:11434'}),{nowUtc:NOW}).valid,false);
  assert.equal(validateStephanosNativeCapacityPayload(payload({supportedOperations:['SOURCE_CONSTRUCTION','FOCUSED_TESTS','MERGE_PULL_REQUEST']}),{nowUtc:NOW}).valid,false);
});

test('wrong repository/head/worker and pressured load cannot become routable truth',()=>{
  const p=payload();
  for (const target of [
    expected(p,{repository:'other/repo'}),
    expected(p,{sourceHead:'c'.repeat(40)}),
    expected(p,{workerId:'other-worker'}),
  ]) assert.equal(validateStephanosNativeCapacityPayload(p,target).valid,false);
  assert.equal(validateStephanosNativeCapacityPayload(payload({loadState:'PRESSURED'}),{nowUtc:NOW}).valid,false);
});

test('source authority cannot widen task classes beyond the verified signed capacity payload',()=>{
  const p=payload();
  const receipt=signedReceipt(p);
  const authority=createStephanosNativeSourceAuthority(receipt,authorityOptions(p));
  assert.equal(validateStephanosNativeSourceAuthority(authority,receipt,authorityOptions(p)).valid,true);
  const widened={...authority,allowedTaskClasses:['EXACT_HEAD_REVIEW']};
  const verdict=validateStephanosNativeSourceAuthority(widened,receipt,authorityOptions(p));
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('authority-task-classes-invalid'));
});

test('signing rejects accessor-bearing payload before reading observedAtUtc',()=>{
  let invoked=0;
  const p=payload();
  const descriptors=Object.fromEntries(Object.entries(p).map(([key,value])=>[key,{value,enumerable:true,writable:true,configurable:true}]));
  descriptors.observedAtUtc={get(){invoked+=1;throw new Error('must-not-run');},enumerable:true,configurable:true};
  const hostile=Object.create(Object.prototype,descriptors);
  assert.equal(createStephanosNativeCapacityReceipt(hostile,{privateKeyPem,keyId:'battle-bridge-native-capacity-key-v1'}),null);
  assert.equal(invoked,0);
});

test('authority list accessors fail closed before any element getter executes',()=>{
  let invoked=0;
  const p=payload();
  const receipt=signedReceipt(p);
  const authority=createStephanosNativeSourceAuthority(receipt,authorityOptions(p));
  const hostileOperations=['SOURCE_CONSTRUCTION','FOCUSED_TESTS'];
  Object.defineProperty(hostileOperations,'0',{get(){invoked+=1;throw new Error('must-not-run');},enumerable:true,configurable:true});
  const hostile={...authority,allowedOperations:hostileOperations};
  const verdict=validateStephanosNativeSourceAuthority(hostile,receipt,authorityOptions(p));
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('authority-operations-invalid'));
  assert.equal(invoked,0);
});

test('receipt cryptographic policy accepts only actual Ed25519 keys',()=>{
  const p=payload();
  assert.equal(createStephanosNativeCapacityReceipt(p,{privateKeyPem:rsaPrivateKeyPem,keyId:'rsa-misconfigured-key'}),null);
  const receipt=signedReceipt(p);
  const verdict=verifyStephanosNativeCapacityReceipt(receipt,{publicKeyPem:rsaPublicKeyPem,expected:expected(p)});
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('verification-key-invalid'));
});

test('accessor-bearing capacity payload fails closed without invoking expected fields',()=>{
  let invoked=0;
  const p=payload();
  const descriptors=Object.fromEntries(Object.entries(p).map(([key,value])=>[key,{value,enumerable:true,writable:true,configurable:true}]));
  descriptors.model={get(){invoked+=1;throw new Error('must-not-run');},enumerable:true,configurable:true};
  const hostile=Object.create(Object.prototype,descriptors);
  const verdict=validateStephanosNativeCapacityPayload(hostile,expected(p));
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('payload-shape-invalid'));
  assert.equal(invoked,0);
});

test('accessor-bearing verification options fail closed without invoking getters',()=>{
  let invoked=0;
  const p=payload();
  const receipt=signedReceipt(p);
  const options=Object.create(Object.prototype,{
    publicKeyPem:{get(){invoked+=1;throw new Error('must-not-run');},enumerable:true,configurable:true},
    expected:{value:expected(p),enumerable:true,writable:true,configurable:true},
  });
  const verdict=verifyStephanosNativeCapacityReceipt(receipt,options);
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('verification-key-invalid'));
  assert.equal(invoked,0);
});
