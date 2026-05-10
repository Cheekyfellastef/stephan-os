import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';

const base = { intentToBuildModel:{ missionSpec:{ repoArchitectureContext:{ testsLikelyRequired:['t'] } } }, proofOfDoneModel:{ verificationJudge:{ parsed:{ testsRun:['t'], buildRun:true, verifyRun:true }, mergeReadyCandidate:true, proofOfDoneStatus:'reported' }, browserChecksObserved:['tile opens','Build Journey works','no console red errors','expected panels visible','Spotify link behaviour verified','AI action does not spin forever','output is visible in correct panel'] }, prEvidenceModel:{ normalizedStatus:'merge_ready_candidate' } };

test('merge verdict rules and operator approval gate', () => {
  assert.equal(deriveOperatorReliefProjection({ ...base, proofOfDoneModel:{ verificationJudge:{ parsed:{ hasFailure:true } } } }).mergeSafety.verdict, 'not-safe');
  assert.equal(deriveOperatorReliefProjection({ ...base, proofOfDoneModel:{ verificationJudge:{ parsed:{ buildRun:false, verifyRun:false } } } }).mergeSafety.verdict, 'needs-tests');
  assert.equal(deriveOperatorReliefProjection({ ...base, proofOfDoneModel:{ verificationJudge:{ parsed:{ testsRun:['t'], buildRun:true, verifyRun:true }, proofOfDoneStatus:'pending' }, browserChecksObserved:[] } }).mergeSafety.verdict, 'needs-browser-proof');
  const ok = deriveOperatorReliefProjection(base);
  assert.equal(ok.status, 'merge-candidate');
  assert.equal(ok.operatorDecision.required, true);
});
