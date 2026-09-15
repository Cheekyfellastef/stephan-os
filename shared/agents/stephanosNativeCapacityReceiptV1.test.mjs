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

test('fresh local Ollama capacity signs, verifies against exact target and yields non-seizing source authority',()=>{
  const p=payload();
  assert.equal(validateStephanosNativeCapacityPayload(p,expected(p)).valid,true);
  const receipt=createStephanosNativeCapacityReceipt(p,{privateKeyPem,keyId:'battle-bridge-native-capacity-key-v1'});
  assert.ok(receipt);
  assert.equal(verifyStephanosNativeCapacityReceipt(receipt,{publicKeyPem,expected:expected(p)}).valid,true);
  const authority=createStephanosNativeSourceAuthority(p);
  assert.equal(validateStephanosNativeSourceAuthority(authority,p).valid,true);
  assert.equal(authority.leaseSeizureAllowed,false);
  assert.equal(authority.mergeAuthority,false);
});

test('verification requires independent clock and exact repository/head/worker bindings',()=>{
  const p=payload();
  const receipt=createStephanosNativeCapacityReceipt(p,{privateKeyPem,keyId:'battle-bridge-native-capacity-key-v1'});
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

test('tamper, replay/staleness, remote transport and authority widening fail closed',()=>{
  const p=payload();
  const receipt=createStephanosNativeCapacityReceipt(p,{privateKeyPem,keyId:'battle-bridge-native-capacity-key-v1'});
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

test('source authority cannot widen task classes beyond the signed capacity payload',()=>{
  const p=payload();
  const authority=createStephanosNativeSourceAuthority(p);
  assert.equal(validateStephanosNativeSourceAuthority(authority,p).valid,true);
  const widened={...authority,allowedTaskClasses:['EXACT_HEAD_REVIEW']};
  const verdict=validateStephanosNativeSourceAuthority(widened,p);
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('authority-task-classes-invalid'));
});
