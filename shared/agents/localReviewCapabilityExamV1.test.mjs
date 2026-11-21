import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  LOCAL_REVIEW_EXAM_SCHEMA as schema,
  LOCAL_REVIEW_EXAM_CHALLENGES as baseline,
  LOCAL_REVIEW_EXAM_PRIVILEGED as windows,
  assessLocalReviewCapabilityExam as assess,
} from './localReviewCapabilityExamV1.mjs';
const now = Date.parse('2026-10-15T04:00:00.000Z');
const keys = generateKeyPairSync('ed25519');
const pem = keys.publicKey.export({format:'pem', type:'spki'});
const trust = Object.freeze({pinnedAuditorPublicKeyPem:pem,
  pinnedAuditorPublicKeySha256:createHash('sha256').update(pem).digest('hex'),
  provisioningVerified:true});
const sample = {repository:'Cheekyfellastef/stephan-os',
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
  implementerPrincipal:'build-worker-01',reviewerPrincipal:'local-review-01',auditorPrincipal:'auditor-02',
  implementerProvider:'github-build', reviewerProvider:'sovereign-local',
  hardcodedCodexSpecialistGateStillRequired:true};
function receipt(challengeId, patch={}) {
  const item = {schemaVersion:schema,challengeId,
    repository:sample.repository,sourceHead:sample.sourceHead,baseSha:sample.baseSha,
    reviewerPrincipal:sample.reviewerPrincipal,auditorPrincipal:sample.auditorPrincipal,
    observedAtUtc:'2026-10-15T03:59:00.000Z',outcome:'passed',evidenceSha256:'e'.repeat(64)};
  Object.assign(item,patch);
  const signature = sign(null, Buffer.from(schema+'\0'+JSON.stringify(item)), keys.privateKey).toString('base64');
  return {...item,signatureBase64:signature};
}
const run = (changes={},ctx={})=>assess({...sample, receipts:baseline.map(x=>receipt(x)), ...changes},
  {nowMs:now,trust,...ctx});
function denies(r) {
  for (const k of ['qualifiedWindowsSpecialist','independentSecurityReviewSatisfied',
    'protectedMergeAuthority','sourceMutationAuthority','leaseReleaseAuthority',
    'serviceInstallationAuthority','signedWindowsCustodyProven']) assert.equal(r[k],false,k);
}
test('baseline 10 signed, source-bound challenges are only readiness for independent admission',()=>{
  const r=run();
  assert.equal(r.status,'QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION');
  assert.equal(r.baselineEvidenceComplete,true);
  assert.equal(r.windowsEvidenceComplete,false);
  assert.equal(r.missingPrivileged.length,5);
  denies(r);
});
test('even all Windows signed assertions never grant authority or replace current specialist',()=>{
  const r=run({receipts:[...baseline,...windows].map(x=>receipt(x))});
  assert.equal(r.windowsEvidenceComplete,true);
  assert.equal(r.nextGate,'EXTERNAL_TRUST_BOOTSTRAP_AND_PROTECTED_POLICY_REVIEW');
  assert.equal(r.currentWindowsReviewProvider,'chatgpt-codex-connector');
  denies(r);
});
test('missing, duplicated and false results fail closed',()=>{
  for (const receipts of [[],baseline.slice(1).map(x=>receipt(x)),
    [...baseline.map(x=>receipt(x)),receipt(baseline[0])],
    baseline.map((x,i)=>receipt(x,i===0?{outcome:'failed'}:{}))]) {
    const r=run({receipts});
    assert.equal(r.status,'QUALIFICATION_EVIDENCE_HELD');
    denies(r);
  }
});
test('tampering, wrong head, wrong auditor and stale or future evidence fail closed',()=>{
  for (const patch of [
    {sourceHead:'c'.repeat(40)}, {baseSha:'c'.repeat(40)},
    {auditorPrincipal:'impostor-05'}, {evidenceSha256:'f'.repeat(64)},
    {observedAtUtc:'2026-10-13T00:00:00.000Z'},
    {observedAtUtc:'2026-10-15T06:00:00.000Z'},
  ]) {
    const receipts=baseline.map((id,i)=>i===0?{...receipt(id),...patch}:receipt(id));
    const r=run({receipts});
    assert.equal(r.status,'QUALIFICATION_EVIDENCE_HELD',JSON.stringify(patch));
    denies(r);
  }
});
test('untrusted pins and a self-reported provisioning claim cannot bootstrap reviewer trust',()=>{
  for(const tr of [{},{...trust,provisioningVerified:false},
    {...trust,pinnedAuditorPublicKeySha256:'0'.repeat(64)}]) {
    const r=run({}, {trust:tr});
    assert.equal(r.status,'QUALIFICATION_EVIDENCE_HELD');
    denies(r);
  }
});
test('independent human/agent identities and provider separation are obligatory',()=>{
  for(const change of [
    {reviewerPrincipal:sample.implementerPrincipal},
    {auditorPrincipal:sample.reviewerPrincipal},
    {reviewerProvider:sample.implementerProvider},
    {hardcodedCodexSpecialistGateStillRequired:false},
    {sourceHead:sample.baseSha},
  ]) {
    const r=run(change);
    assert.equal(r.status,'QUALIFICATION_EVIDENCE_HELD',JSON.stringify(change));
    denies(r);
  }
});
test('unknown receipt challenge and forged extra authority fields never qualify',()=>{
  const receipts=[...baseline.map(x=>receipt(x)),receipt('custom-claim')];
  assert.equal(run({receipts}).status,'QUALIFICATION_EVIDENCE_HELD');
  const bad={...receipt(baseline[0]),specialistAuthority:true};
  assert.equal(run({receipts:[bad,...baseline.slice(1).map(x=>receipt(x))]}).status,'QUALIFICATION_EVIDENCE_HELD');
});
