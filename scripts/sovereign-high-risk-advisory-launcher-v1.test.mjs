import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHighRiskAdvisoryLaunchPlanV1, runFixedSovereignReviewEntryV1 }
  from './sovereign-high-risk-advisory-launcher-v1.mjs';
const env={STEPHANOS_REVIEW_EXACT_HEAD:'a'.repeat(40),STEPHANOS_REVIEW_EXACT_BASE:'b'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BRANCH:'fixture-review',STEPHANOS_REVIEW_REPOSITORY:'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_ISSUE:'1574',STEPHANOS_REVIEW_PR:'1',STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER:'fixture-builder',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION:'fixture-builder',STEPHANOS_REVIEW_SESSION:'fixture-reviewer',
  STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL:'fixture-builder',STEPHANOS_REVIEW_REVIEWER_PRINCIPAL:'fixture-reviewer'};
test('all existing high-risk wrappers select installed native producer with PR identity only as data',()=>{
  for(const entryPoint of ['advisory','windows-calibration','windows-calibration-remote','coverage']) {
    const plan=buildHighRiskAdvisoryLaunchPlanV1({platform:'win32',root:'C:\\writable-pr',entryPoint,
      env:{...env,NODE_OPTIONS:'--import=attacker',NODE_PATH:'attacker'}});
    assert.equal(plan.executable,'C:\\Program Files\\Stephanos\\SovereignReviewerV1\\host.exe');
    assert.deepEqual(plan.args,['--'+entryPoint]);
    assert.ok(plan.args.every(arg=>!arg.includes(env.STEPHANOS_REVIEW_EXACT_HEAD)));
    assert.equal(plan.env.STEPHANOS_REVIEW_EXACT_HEAD,env.STEPHANOS_REVIEW_EXACT_HEAD);
    assert.equal(plan.env.NODE_OPTIONS,undefined);assert.equal(plan.env.NODE_PATH,undefined);
  }
});
test('unsupported installation/platform and unknown route return false authority before candidate evaluation',()=>{
  assert.throws(()=>buildHighRiskAdvisoryLaunchPlanV1({platform:'win32',env:{}}),/REQUEST_INVALID/);
  assert.throws(()=>buildHighRiskAdvisoryLaunchPlanV1({platform:'linux',env}),/NATIVE_PROFILE_REQUIRED/);
  for(const entryPoint of ['advisory','windows-calibration','coverage','arbitrary-command']) {
    const held=runFixedSovereignReviewEntryV1(entryPoint,{platform:'linux',env});
    assert.match(held.status,/HELD$/);assert.equal(held.mergeAuthority,false);
    assert.equal(held.specialistAuthority,false);assert.equal(held.reviewerEnrollmentAuthority,false);
  }
});
