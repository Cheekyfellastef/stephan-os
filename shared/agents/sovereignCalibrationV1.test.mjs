import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSovereignCalibrationV1 as evaluate,
  sovereignCalibrationManifestV1 as manifest,
  SOVEREIGN_CALIBRATION_CASE_COUNT as count } from './sovereignCalibrationV1.mjs';
const input={
  repository:'Cheekyfellastef/stephan-os',sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
  implementerPrincipal:'github-builder-01',reviewerPrincipal:'local-reviewer-02',
  implementerProvider:'github-builder',reviewerProvider:'local-ollama',
  reviewerSessionId:'review-session-02',
};
const truth=new Map(manifest().challenges.map(x=>[x.id,x]));
const paths=id=>'src/examples/'+id+'.js';
const correct=async(_prompt,meta)=>{
  const findings=truth.get(meta.challengeId)?.expected==='findings'
    ? [{code:'unsafe-change',path:paths(meta.challengeId),
      severity:'P1',summary:'This new source change introduces a serious regression.'}]:[];
  return JSON.stringify({challengeId:meta.challengeId,diffSha256:meta.diffSha256,
    verdict:findings.length?'findings':'clean',findings});
};
const noAuthority=r=>{
  for(const p of ['specialistAuthority','independentReviewSatisfied',
    'protectedMergeAuthority','sourceMutationAuthority','leaseReleaseAuthority',
    'windowsCommissioningAuthority','physicalPickupProven']) assert.equal(r[p],false,p);
};
test('fixed ten-case examiner tests eight unsafe changes and two safe changes',()=>{
  assert.equal(count,10);
  assert.equal(manifest().challenges.filter(c=>c.expected==='findings').length,8);
  assert.equal(manifest().challenges.filter(c=>c.expected==='clean').length,2);
  noAuthority(manifest());
});
test('a perfect synthetic model is still not an independently trusted reviewer',async()=>{
  let calls=0;
  const r=await evaluate(input,{invokeModel:(prompt,meta)=>{
    calls++;assert.match(prompt,/<UNTRUSTED_PATCH>/);
    assert.doesNotMatch(prompt,/expected: clean|expected: findings/);
    return correct(prompt,meta);
  }});
  assert.equal(calls,10);assert.equal(r.passedCases,10);
  assert.equal(r.status,'CALIBRATION_CANDIDATE_PASSED_UNATTESTED');
  assert.equal(r.signatureVerified,false);
  noAuthority(r);
});
test('all-clean model misses eight unsafe changes',async()=>{
  const r=await evaluate(input,{invokeModel:(_,m)=>JSON.stringify({
    challengeId:m.challengeId,diffSha256:m.diffSha256,verdict:'clean',findings:[],
  })});
  assert.equal(r.status,'CALIBRATION_HELD');assert.equal(r.passedCases,2);noAuthority(r);
});
test('P2-only findings do not qualify high-risk regressions',async()=>{
  const r=await evaluate(input,{invokeModel:async(p,m)=>{
    const o=JSON.parse(await correct(p,m));o.findings=o.findings.map(f=>({...f,severity:'P2'}));
    return JSON.stringify(o);
  }});
  assert.equal(r.passedCases,2);noAuthority(r);
});
test('rejects collusion, wrong head and same provider',async()=>{
  for(const update of [{sourceHead:'invalid'},{baseSha:input.sourceHead},
    {reviewerPrincipal:input.implementerPrincipal},
    {reviewerProvider:input.implementerProvider},{reviewerSessionId:input.implementerPrincipal}]){
    const r=await evaluate({...input,...update},{invokeModel:correct});
    assert.equal(r.reason,'EXACT_SOURCE_OR_INDEPENDENT_REVIEW_IDENTITY_MISSING');
    noAuthority(r);
  }
});
test('rejects forged reply, extra authority, unavailable model and broken JSON',async()=>{
  for(const cb of [
    async(_,m)=>JSON.stringify({challengeId:'wrong',diffSha256:m.diffSha256,verdict:'clean',findings:[]}),
    async(p,m)=>JSON.stringify({...JSON.parse(await correct(p,m)),mergeAuthority:true}),
    async()=>'{',
    async()=>{throw Error('offline')},
    undefined,
  ]){
    const r=await evaluate(input,{invokeModel:cb});
    assert.equal(r.status,'CALIBRATION_HELD');noAuthority(r);
  }
});
