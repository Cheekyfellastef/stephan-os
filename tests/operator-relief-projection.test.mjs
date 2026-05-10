import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';

test('Projection composes mission objective, codex delta, and test/build/verify status', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { title: 'Music tile fix', objective: 'Fix panel', repoArchitectureContext: { testsLikelyRequired: ['node --test tests/a.test.mjs'] } } },
    prEvidenceModel: { prTitle: 'Fix panel routing', normalizedStatus: 'merge_ready_candidate' },
    proofOfDoneModel: { verificationJudge: { parsed: { testsRun: ['node --test tests/a.test.mjs'], buildRun: true, verifyRun: true }, mergeReadyCandidate: true, proofOfDoneStatus: 'reported' }, browserChecksObserved: ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'] },
  });
  assert.equal(r.missionObjective, 'Fix panel');
  assert.equal(r.codexDeltaSummary, 'Fix panel routing');
  assert.equal(r.tests.buildPassed, true);
  assert.equal(r.tests.verifyPassed, true);
  assert.equal(r.mission.title, 'Music tile fix');
  assert.equal(r.codex.prTitle, 'Fix panel routing');
});
