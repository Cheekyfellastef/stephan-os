import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSovereignReviewerQualificationLadderV1 as assess } from './sovereignReviewerQualificationLadderV1.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40), digest = 'c'.repeat(64);
const source = { repository:'Cheekyfellastef/stephan-os', prNumber: 3200,
  branch: 'repair/1574-reviewer-native-preexecution-hold-20261022', sourceHead:head, baseSha:base };
const flags = Object.fromEntries([
  'qualifiedWindowsSpecialist','independentSecurityReviewSatisfied','independentHostAttestation',
  'signatureVerified','protectedMergeAuthority','serviceInstallationAuthority',
  'sourceMutationAuthority','leaseReleaseAuthority','signedWindowsCustodyProven',
  'physicalPickupProven',
].map(k=>[k,false]));
const host = { expectedHeadMatch:true, sourceHead:head, observation:{
  ollama:{reachable:true,loadedModelCount:1}, gpu:{available:true} } };
const windows = { schemaVersion:'stephanos.sovereign-windows-calibration-remote.v1',
  status:'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED',reason:'',sourceHead:head,
  baseSha:base,manifestSha256:digest,observationsSha256:digest,
  modelDigestSha256:digest,completedCases:13,passedCases:13,
  qualification:'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',...flags };
const exam = {schemaVersion:'stephanos.local-review-capability-exam.v1',
  status:'QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION', sourceHead:head,
  baseSha:base,challengeCount:15,baselineChallengeCount:10,baselineEvidenceComplete:true,
  windowsEvidenceComplete:true,blockers:[],missingBaseline:[],missingPrivileged:[],
  qualifiedWindowsSpecialist:false,protectedMergeAuthority:false,leaseReleaseAuthority:false};
const packet = { source,hostObservation:host,windowsCalibration:windows,signedCapabilityExam:exam };

test('no evidence starts at exact source identity and every authority remains denied',()=>{
  const result=assess({});
  assert.equal(result.nextGate,'EXACT_SOURCE_PAIR');
  assert.equal(result.sourceHead,'');
  assert.equal(result.status,'SOVEREIGN_REVIEWER_QUALIFICATION_HELD');
  assert.deepEqual(Object.keys(result).filter(k=>k.endsWith('Authority') && result[k]!==false),[]);
  assert.equal(result.qualifiedSpecialist,false);
  assert.equal(result.independentlyCommissioned,undefined);
  assert.equal(result.evidenceProvenance,'UNTRUSTED_INPUT_CANDIDATE_ONLY');
});

test('exact identity alone moves missing work to physical model observation',()=>{
  const result=assess({source});
  assert.equal(result.nextGate,'PHYSICAL_MODEL_OBSERVATION');
  assert.equal(result.rungs[0].state,'IDENTITY_REPORTED_UNATTESTED');
  assert.equal(result.rungs[1].state,'HELD');
});

test('real-looking host telemetry is observation not signed model or gaming proof',()=>{
  const result=assess({source,hostObservation:host});
  assert.equal(result.nextGate,'WINDOWS_13_CASE_CANDIDATE');
  assert.equal(result.rungs[1].state,'OBSERVED_UNATTESTED');
  assert.equal(result.qualifiedSpecialist,false);
});

test('13/13 and 10+5 can never self-enroll the reviewer',()=>{
  const result=assess(packet);
  assert.equal(result.rungs[2].state,'CANDIDATE_UNATTESTED');
  assert.equal(result.rungs[3].state,'EXAM_REPORTED_UNATTESTED');
  assert.equal(result.rungs[4].state,'HELD');
  assert.equal(result.nextGate,'PROTECTED_AUDITOR_AND_POLICY_ADMISSION');
  assert.equal(result.qualifiedSpecialist,false);
  assert.equal(result.reviewerEnrolled,false);
  assert.equal(result.originalR7LeaseReleaseAuthority,false);
  assert.equal(result.status,'SOVEREIGN_REVIEWER_QUALIFICATION_HELD');
});

test('stale source, model substitution, missing authority denials and incomplete scores hold',()=>{
  const variants=[
    {source:{...source,baseSha:head}},
    {windowsCalibration:{...windows,sourceHead:'d'.repeat(40)}},
    {windowsCalibration:{...windows,modelDigestSha256:''}},
    {windowsCalibration:{...windows,passedCases:12}},
    {windowsCalibration:{...windows,qualifiedWindowsSpecialist:true}},
    {windowsCalibration:{...windows,leaseReleaseAuthority:true}},
    {signedCapabilityExam:{...exam,missingPrivileged:['original-writer-negative-write']}},
    {signedCapabilityExam:{...exam,sourceHead:'e'.repeat(40)}},
    {hostObservation:{...host,sourceHead:'e'.repeat(40)}},
    {hostObservation:{...host,observation:{ollama:{reachable:true,loadedModelCount:0},gpu:{available:true}}}},
  ];
  for(const changed of variants){
    const result=assess({...packet,...changed});
    assert.equal(result.qualifiedSpecialist,false);
    assert.ok(result.rungs.slice(0,4).some(x=>x.state==='HELD'));
  }
});

test('caller-supplied authority, signer and provider labels cannot alter no-authority projection',()=>{
  const hostile={...packet,qualifiedSpecialist:true,sourceMutationAuthority:true,
    reviewPolicyAdmitted:true,independentAuditorCommissioned:true,originalR7LeaseReleased:true,
    windowsCalibration:{...windows,signerCreationAuthority:true},
    signedCapabilityExam:{...exam,protectedMergeAuthority:true}};
  const result=assess(hostile);
  assert.equal(result.diagnostics.reviewerPolicyAdmitted,false);
  assert.equal(result.independentAuditorCommissioned,false);
  assert.equal(result.windowsServiceInstallationAuthority,false);
  assert.equal(result.originalR7LeaseReleaseAuthority,false);
  assert.equal(result.rungs[3].state,'HELD');
});

test('accessor, proxy, cyclic and hostile oversized packets fail without executing getters',()=>{
  let accessed = 0;
  const getter = Object.defineProperty({},'source',{enumerable:true,get(){accessed++;throw Error('do not call');}});
  const cycle = {};cycle.self=cycle;
  const proxy = new Proxy({}, { ownKeys(){throw Error('trapped');} });
  for(const input of [getter,cycle,proxy,{source,extra:Array(65).fill('x')},
      Object.create({ source }),{source,hostObservation:{observation:{gpu:{get available(){accessed++;return true;}}}}}]){
    const result=assess(input);
    assert.equal(result.nextGate,'EXACT_SOURCE_PAIR');
    assert.equal(result.rungs[0].reason,'UNTRUSTED_INPUT_INVALID');
    assert.equal(result.qualifiedSpecialist,false);
  }
  assert.equal(accessed,0);
});
