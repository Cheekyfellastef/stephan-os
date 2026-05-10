import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';

const base = { intentToBuildModel:{ missionSpec:{ repoArchitectureContext:{ testsLikelyRequired:['t'] } } }, proofOfDoneModel:{ verificationJudge:{ parsed:{ testsRun:['t'], buildRun:true, verifyRun:true }, mergeReadyCandidate:true, proofOfDoneStatus:'reported' }, browserChecksObserved:['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'] }, prEvidenceModel:{ normalizedStatus:'merge_ready_candidate' } };

test('merge verdict rules and operator approval gate', () => {
  assert.equal(deriveOperatorReliefProjection({ ...base, proofOfDoneModel:{ verificationJudge:{ parsed:{ hasFailure:true } } } }).mergeSafety.verdict, 'not-safe');
  assert.equal(deriveOperatorReliefProjection({ ...base, proofOfDoneModel:{ verificationJudge:{ parsed:{ buildRun:false, verifyRun:false } } } }).mergeSafety.verdict, 'needs-tests');
  assert.equal(deriveOperatorReliefProjection({ ...base, proofOfDoneModel:{ verificationJudge:{ parsed:{ testsRun:['t'], buildRun:true, verifyRun:true }, proofOfDoneStatus:'pending' }, browserChecksObserved:[] } }).mergeSafety.verdict, 'needs-browser-proof');
  const ok = deriveOperatorReliefProjection(base);
  assert.equal(ok.status, 'merge-candidate');
  assert.equal(ok.operatorDecision.required, true);
});
