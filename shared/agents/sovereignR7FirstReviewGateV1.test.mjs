import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSovereignR7FirstReviewGateV1 as evaluate,
  SOVEREIGN_R7_FIRST_REVIEW_GATE_SCHEMA,
} from './sovereignR7FirstReviewGateV1.mjs';
import { sovereignWindowsCalibrationManifestV1 } from './sovereignWindowsCalibrationV1.mjs';

const r7Files=Object.freeze([
  'src/windows/Stephanos.OriginalR7CustodyWitness/Program.cs',
  'scripts/windows/inspect-original-source-custody-readonly.ps1',
]);
const source={
  repository:'Cheekyfellastef/stephan-os',prNumber:3153,
  branch:'goal-3123-sovereign-witness-readonly-preflight-20261017',
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
  changedFiles:[...r7Files],
};
function fixture(patch={}){
  const manifest=sovereignWindowsCalibrationManifestV1();
  return {
    ...source,
    calibration:{
      schemaVersion:'stephanos.sovereign-windows-calibration.v1',
      status:'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
      repository:source.repository,sourceHead:source.sourceHead,baseSha:source.baseSha,
      manifestSha256:manifest.manifestSha256,
      observationsSha256:'c'.repeat(64),
      completedCases:manifest.challengeCount,passedCases:manifest.challengeCount,
      qualification:'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',
      qualifiedWindowsSpecialist:false,independentSecurityReviewSatisfied:false,
      leaseReleaseAuthority:false,
    },
    highRiskReview:{
      status:'HIGH_RISK_LOCAL_CANDIDATE_READY',specialistAuthority:false,mergeAuthority:false,
      candidateEvidence:{
        schemaVersion:'stephanos.sovereign-high-risk-review-candidate.v1',
        repository:source.repository,prNumber:source.prNumber,
        branch:source.branch,sourceHead:source.sourceHead,baseSha:source.baseSha,
        changedFiles:[...r7Files],fullDiffSha256:'d'.repeat(64),
        reviewPacketSha256:'e'.repeat(64),
        chunkCount:2,reviewedChunks:[
          {path:r7Files[0],contentSha256:'1'.repeat(64)},
          {path:r7Files[1],contentSha256:'2'.repeat(64)},
        ],
        verdict:'candidate-clean',findings:[],riskTier:'high',
        qualification:'PENDING_INDEPENDENT_SPECIALIST_ATTESTATION',
        specialistAuthority:false,approvalAuthority:false,mergeAuthority:false,
      },
    },
    ...patch,
  };
}
function noAuthority(v){
  for(const name of [
    'qualifiedWindowsSpecialist','independentReviewAttested',
    'reviewAcceptanceAuthority','reviewerTrustEnrollmentAuthority',
    'privilegedHostAuthority','witnessInstalled','signedCustodyWitnessProven',
    'operatorSignerProven','originalWriterDenied','originalR7LeaseReleased',
    'sourceMutationAuthority','protectedMergeAuthority','originalR7BuilderPickedUp',
  ]) assert.equal(v[name],false,name);
}
test('complete synthetic R7 source review and 13-case exam remain candidate only',()=>{
  const r=evaluate(fixture());
  assert.equal(r.schemaVersion,SOVEREIGN_R7_FIRST_REVIEW_GATE_SCHEMA);
  assert.equal(r.status,'R7_SOURCE_REVIEW_CANDIDATE_READY_UNATTESTED');
  assert.equal(r.leaseId,'critical-2962-elastic-goal-r7-lease');
  assert.equal(r.modelExerciseCount,13);
  assert.equal(r.reviewedChunkCount,2);
  assert.equal(r.reviewedFileCount,2);
  assert.ok(r.outstandingProofs.includes('ACTUAL_ORIGINAL_WRITER_TOKEN_HANDLES_TASK_WMI_COM_REENTRY_DENIAL'));
  assert.ok(r.outstandingProofs.includes('INDEPENDENT_PROTECTED_WITNESS_SIGNER_AND_OPERATOR_SIGNATURE'));
  noAuthority(r);
});
test('original R7 cannot be mistaken for generic Windows/other PRs',()=>{
  const r=evaluate(fixture({changedFiles:['src/windows/OtherProgram.cs']}));
  assert.equal(r.status,'R7_REVIEW_PREQUALIFICATION_HELD');noAuthority(r);
  const wrong=evaluate(fixture({repository:'unknown/repo'}));
  assert.equal(wrong.reason,'EXACT_PR_IDENTITY_UNVERIFIED');noAuthority(wrong);
});
test('stale heads, incomplete models or invalid results fail before source review',()=>{
  const base=fixture();
  for(const patch of [
    {sourceHead:'d'.repeat(40)},
    {calibration:{...base.calibration,sourceHead:'e'.repeat(40)}},
    {calibration:{...base.calibration,passedCases:12}},
    {calibration:{...base.calibration,completedCases:14,passedCases:14}},
    {calibration:{...base.calibration,qualifiedWindowsSpecialist:true}},
    {calibration:{...base.calibration,manifestSha256:'0'.repeat(64)}},
    {calibration:{...base.calibration,observationsSha256:''}},
  ]){
    const r=evaluate({...base,...patch});
    assert.equal(r.status,'R7_REVIEW_PREQUALIFICATION_HELD');
    noAuthority(r);
  }
});
test('incomplete or forged code review cannot become an R7 candidate',()=>{
  const base=fixture();const ev=base.highRiskReview.candidateEvidence;
  for(const delta of [
    {status:'HIGH_RISK_LOCAL_CANDIDATE_HELD'},
    {specialistAuthority:true},
    {candidateEvidence:{...ev,baseSha:'c'.repeat(40)}},
    {candidateEvidence:{...ev,reviewedChunks:[ev.reviewedChunks[0]]}},
    {candidateEvidence:{...ev,changedFiles:[r7Files[0]]}},
    {candidateEvidence:{...ev,fullDiffSha256:'not-sha'}},
    {candidateEvidence:{...ev,riskTier:'standard'}},
    {candidateEvidence:{...ev,qualification:'QUALIFIED_WINDOWS_SPECIALIST'}},
  ]){
    const r=evaluate({...base,highRiskReview:{...base.highRiskReview,...delta}});
    assert.equal(r.status,'R7_REVIEW_PREQUALIFICATION_HELD');
    noAuthority(r);
  }
});
test('any finding or unproven reviewed chunk stops R7 prequalification',()=>{
  const base=fixture(),ev=base.highRiskReview.candidateEvidence;
  for(const evDelta of [
    {findings:[{severity:'P2',code:'uncertain',path:r7Files[0]}],verdict:'findings'},
    {verdict:'clean'},
    {reviewedChunks:[ev.reviewedChunks[0],{...ev.reviewedChunks[1],contentSha256:'bad'}]},
  ]){
    const r=evaluate({...base,highRiskReview:{
      ...base.highRiskReview,candidateEvidence:{...ev,...evDelta},
    }});
    assert.equal(r.status,'R7_REVIEW_PREQUALIFICATION_HELD');
    noAuthority(r);
  }
});
test('caller-forged physical receipts, signatures and approvals confer nothing',()=>{
  const r=evaluate(fixture({
    witnessInstalled:true,originalWriterDenied:true,
    operatorSignerProven:true,originalR7LeaseReleased:true,
    independentSecurityReviewSatisfied:true,
  }));
  assert.equal(r.status,'R7_SOURCE_REVIEW_CANDIDATE_READY_UNATTESTED');
  noAuthority(r);
});
