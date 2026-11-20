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
// The synthetic callback identifies the defect from the patch, not leaked case labels.
const signatures=[
  ['process.env.API_KEY','credential-exposure'],
  ['return eval(value)','dynamic-code-execution'],
  ['while (true) await retry()','unbounded-retry'],
  ['removeLeaseById(leaseId)','lease-authorization-bypass'],
  ['dispatch.status===','false-worker-pickup'],
  ['"+id);','sql-injection'],
  ['element.innerHTML = comment','dom-xss'],
  ['readFile(request.query.path)','unrestricted-file-path'],
];
const pathInPrompt=prompt=>prompt.match(/\+\+\+ b\/(src\/examples\/case-[a-f0-9]{32}\.js)/)?.[1];
const correct=async(prompt,meta)=>{
  const code=signatures.find(([marker])=>prompt.includes(marker))?.[1];
  const findings=code?[{code,path:pathInPrompt(prompt),severity:'P1',
    summary:'The changed source introduces the identified serious regression.'}]:[];
  return JSON.stringify({challengeId:meta.challengeId,diffSha256:meta.diffSha256,
    verdict:findings.length?'findings':'clean',findings});
};
const noAuthority=r=>{
  for(const p of ['specialistAuthority','independentReviewSatisfied',
    'protectedMergeAuthority','sourceMutationAuthority','leaseReleaseAuthority',
    'windowsCommissioningAuthority','physicalPickupProven']) assert.equal(r[p],false,p);
};
test('candidate gets a general vocabulary but never an answer key or case labels', async () => {
  let observed = 0;
  const result = await evaluate(input, { invokeModel: async (prompt, meta) => {
    observed++;
    assert.match(prompt, /general taxonomy/);
    for (const code of [
      'credential-exposure', 'dynamic-code-execution', 'unbounded-retry',
      'lease-authorization-bypass', 'false-worker-pickup', 'sql-injection',
      'dom-xss', 'unrestricted-file-path', 'other-regression',
    ]) assert.ok(prompt.includes(code), code);
    assert.doesNotMatch(prompt, /expectedCode|expectedLabel|seeded defect/);
    assert.doesNotMatch(prompt, /safe-null-guard|safe-bounded-retry|secret-logging|unsafe-eval|infinite-retry|lease-cas-bypass|fake-worker-pickup|sql-concatenation|unsafe-inner-html|unbounded-file-path/);
    return correct(prompt, meta);
  }});
  assert.equal(observed, 10);
  assert.equal(result.passedCases, 10);
  assert.equal(result.status, 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED');
  noAuthority(result);
});
test('fixed ten-case examiner tests eight unsafe changes and two safe changes',()=>{
  assert.equal(count,10);
  assert.equal(manifest().challengeCount,10);
  assert.equal(manifest().unsafeCount,8);
  assert.equal(manifest().cleanCount,2);
  assert.equal(manifest().challenges,undefined);
  noAuthority(manifest());
});
test('a perfect synthetic model is still not an independently trusted reviewer',async()=>{
  let calls=0;
  const r=await evaluate(input,{invokeModel:(prompt,meta)=>{
    calls++;assert.match(prompt,/<UNTRUSTED_PATCH>/);
    assert.match(meta.challengeId,/^case-[a-f0-9]{32}$/);
    assert.ok(pathInPrompt(prompt));
    assert.doesNotMatch(prompt,/safe-null-guard|safe-bounded-retry|secret-logging|unsafe-eval|infinite-retry|lease-cas-bypass|fake-worker-pickup|sql-concatenation|unsafe-inner-html|unbounded-file-path/);
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
test('generic P1 findings cannot fabricate an eight-regression pass',async()=>{
  const r=await evaluate(input,{invokeModel:(prompt,meta)=>JSON.stringify({
    challengeId:meta.challengeId,diffSha256:meta.diffSha256,
    verdict:'findings',findings:[{code:'generic-regression',
      path:pathInPrompt(prompt),severity:'P1',
      summary:'A generic unrelated issue is alleged in this patch.'}],
  })});
  assert.equal(r.status,'CALIBRATION_HELD');
  assert.equal(r.passedCases,0);
  noAuthority(r);
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
