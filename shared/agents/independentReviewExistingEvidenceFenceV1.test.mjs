import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findExistingIndependentReviewEvidenceHintV1 as evaluate } from './independentReviewExistingEvidenceFenceV1.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), DIGEST = 'c'.repeat(64);
const PR = 3315, RUN = 40916781623, ARTIFACT = 12916836185;
const branch = 'patch-escrow/issue-1567-58b2f477ab53';
const params = {repository:REPO,prNumber:PR,branch,expectedHead:HEAD,expectedBase:BASE};
const owner = {id:267490109,login:'Cheekyfellastef',type:'User'};
const actions = {id:41898282,login:'github-actions[bot]',type:'Bot'};
const comment = (body,user=owner) => ({id:6503160905,user,body});
const realOwner = `<!-- original receipt -->\nOriginal PR #${PR}, HEAD ${HEAD}, protected main ${BASE}, independent security review CLEAN.\nIndependent [review ${RUN}](https://github.com/${REPO}/actions/runs/${RUN}) passed.\nImmutable [artifact ${ARTIFACT}](https://github.com/${REPO}/actions/runs/${RUN}/artifacts/${ARTIFACT}), sha256 ${DIGEST}.`;
const result = comments => evaluate({...params,comments});

test('holds a real owner-authenticated exact-head review+artifact reference without claiming review',()=>{
  const found=result([comment(realOwner)]);
  assert.equal(found.status,'HOLD_EXISTING_REVIEW_NEEDS_READBACK');
  assert.equal(found.runId,RUN);assert.equal(found.artifactId,ARTIFACT);
  assert.equal(found.reviewQualified,false);assert.equal(found.mutationAllowed,false);
});
test('forged author, wrong type, unrelated repository or absent artifact cannot suppress',()=>{
  const variants=[
    comment(realOwner,{...owner,id:1}),comment(realOwner,{...owner,type:'Bot'}),
    comment(realOwner.replaceAll(REPO,'other/repo')),
    comment(realOwner.replace(`/artifacts/${ARTIFACT}`,'/other/path')),
    comment(realOwner.replace(DIGEST,'not-a-digest')),
  ];
  for(const candidate of variants)assert.equal(result([candidate]).status,'NO_EXISTING_EVIDENCE_HINT');
});
test('wrong PR, base, head, or review verdict never suppresses',()=>{
  for (const changed of [
    realOwner.replace(`PR #${PR}`,`PR #999`),realOwner.replace(BASE,'d'.repeat(40)),
    realOwner.replace(HEAD,'e'.repeat(40)),realOwner.replace('CLEAN','FAILED'),
  ])assert.equal(result([comment(changed)]).status,'NO_EXISTING_EVIDENCE_HINT');
});
test('a trusted GitHub Actions exact-head artifact index holds without becoming independent authority',()=>{
 const receipt={schemaVersion:'stephanos.provider-neutral-review.v1',kind:'stephanos.provider-neutral.review',
   verdict:'clean',repository:REPO,prNumber:PR,branch,sourceHead:HEAD,
   reviewerSessionId:`github-actions-independent-review-run-${RUN}-attempt-1`,
   proofRefs:[`proofs/independent-review/base-${BASE}`]};
 const body=`<!-- stephanos:independent-review-artifact-index:v1 -->\n<!-- stephanos-protected-security-review -->\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\``;
 const found=result([comment(body,actions)]);
 assert.equal(found.status,'HOLD_EXISTING_REVIEW_NEEDS_READBACK');
 assert.equal(found.kind,'TRUSTED_ACTIONS_ARTIFACT_INDEX');assert.equal(found.runId,RUN);
 assert.equal(result([comment(body,{...actions,id:1})]).status,'NO_EXISTING_EVIDENCE_HINT');
 assert.equal(result([comment(body.replace(BASE,'f'.repeat(40)),actions)]).status,'NO_EXISTING_EVIDENCE_HINT');
 assert.equal(result([comment(body.replace('"verdict":"clean"','"verdict":"failed"'),actions)]).status,'NO_EXISTING_EVIDENCE_HINT');
});
test('missing or malformed exact preflight identity always holds',()=>{
 for(const candidate of [{...params,comments:null},{...params,expectedHead:'bad',comments:[]},{...params,prNumber:0,comments:[]}]){
  const r=evaluate(candidate);assert.equal(r.status,'HOLD_INVALID_PREFLIGHT');assert.equal(r.mutationAllowed,false);
 }
});
test('owner review request without finished run and artifact is not a finished-review hint',()=>{
 const body=`PR #${PR} HEAD ${HEAD} BASE ${BASE}: please run independent review, no existing artifact.`;
 assert.equal(result([comment(body)]).status,'NO_EXISTING_EVIDENCE_HINT');
});

test('the real launcher fences both initial and final dispatch admission',()=>{
 const source=readFileSync(new URL('../../scripts/launch-missing-independent-review-v1.mjs',import.meta.url),'utf8');
 assert.match(source,/import \{ findExistingIndependentReviewEvidenceHintV1 \} from '\.\.\/shared\/agents\/independentReviewExistingEvidenceFenceV1\.mjs'/);
 assert.equal([...source.matchAll(/if \(suppressOnPriorReviewEvidence\(context, repository\)\) return;/g)].length,2);
});
