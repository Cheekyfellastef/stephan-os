import test from 'node:test';
import assert from 'node:assert/strict';
import {runSovereignReviewCoverageV1 as run} from './sovereign-review-coverage-v1-engine.mjs';

const snapshot={
  repository:'Cheekyfellastef/stephan-os',prNumber:3168,
  branch:'goal-1574-sovereign-windows-calibration-20261018',
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
  changedFiles:['src/windows/Stephanos.OriginalR7CustodyWitness/Program.cs'],
  diff:'DO NOT PRINT ME: secret source text',
};
test('existing fixed local Git source snapshot produces read-only, no-authority domain inventory',()=>{
  let called=0;
  const r=run({}, {snapshot:()=>{called++;return snapshot;}});
  assert.equal(called,1);
  assert.equal(r.status,'HIGH_RISK_LOCAL_CANDIDATE_SCOPE_ONLY');
  assert.ok(r.domains.includes('windows-os-and-services'));
  assert.equal(r.meteredReviewReplacementQualified,false);
  assert.equal(r.privilegedWindowsAuthority,false);
  assert.equal(r.reviewPackets[0].candidateOnly,true);
  assert.doesNotMatch(JSON.stringify(r),/DO NOT PRINT ME|secret source text/);
});
test('missing exact local Git snapshot never becomes review or dispatch',()=>{
  const r=run({}, {snapshot:()=>{throw Error('private checkout path')}});
  assert.equal(r.status,'REVIEW_COVERAGE_HELD');
  assert.equal(r.reason,'EXACT_LOCAL_REVIEW_SOURCE_UNVERIFIED');
  assert.equal(r.meteredReviewReplacementQualified,false);
  assert.doesNotMatch(JSON.stringify(r),/private checkout path/);
});
test('untrusted caller-provided proof and approval booleans are ignored',()=>{
  const r=run({}, {snapshot:()=>({...snapshot,reviewApproved:true,
    specialistAuthority:true,mergeAuthority:true})});
  assert.equal(r.meteredReviewReplacementQualified,false);
  assert.equal(r.specialistAuthority,false);
  assert.equal(r.protectedMergeAuthority,false);
});
