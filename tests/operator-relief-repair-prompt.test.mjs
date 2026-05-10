import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';

test('repair prompt generated from failed tests and browser console errors', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { title: 'Fix music', repoArchitectureContext: { testsLikelyRequired: ['node --test tests/music.test.mjs'] } } },
    proofOfDoneModel: { verificationJudge: { parsed: { hasFailure: true, buildRun: false, verifyRun: false }, proofOfDoneStatus: 'pending' }, consoleErrors: ['TypeError in Build Journey'] },
  });
  assert.equal(r.repairPrompt.available, true);
  assert.match(r.repairPrompt.prompt, /Do not create new canon/);
  assert.match(r.repairPrompt.prompt, /TypeError/);
});
