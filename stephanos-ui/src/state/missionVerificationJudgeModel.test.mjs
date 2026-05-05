import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateMissionVerificationJudge } from './missionVerificationJudgeModel.js';

const missionSpec = {
  missionId: 'm-1',
  repoArchitectureContext: {
    sourceFilesLikelyTouched: ['stephanos-ui/src/components/MissionConsoleTile.jsx'],
    testsLikelyRequired: ['MissionConsoleTile.render.test.mjs'],
    generatedOutputsLikelyTouched: ['apps/stephanos/dist/**'],
  },
  finishAuthority: { mergeAuthorityIncluded: false, operatorApprovalRecorded: false },
};

test('no verification return is not merge-ready', () => {
  const out = adjudicateMissionVerificationJudge({ missionSpec, verificationReturnText: '' });
  assert.equal(out.mergeReadyCandidate, false);
  assert.equal(out.judgment, 'no_return');
});

test('merge-ready claim without tests is insufficient evidence', () => {
  const out = adjudicateMissionVerificationJudge({ missionSpec, verificationReturnText: 'merge-ready candidate with no tests listed' });
  assert.equal(out.mergeReadyCandidate, false);
  assert.equal(out.judgment, 'insufficient_evidence');
});

test('required tests + build/verify + proof yields candidate', () => {
  const text = 'changed files stephanos-ui/src/components/MissionConsoleTile.jsx\nnode --test stephanos-ui/src/components/MissionConsoleTile.render.test.mjs\nnpm run stephanos:build pass\nnpm run stephanos:verify pass\noperator-visible proof attached';
  const out = adjudicateMissionVerificationJudge({ missionSpec, verificationReturnText: text });
  assert.equal(out.requiredTestsRun, true);
  assert.equal(out.mergeReadyCandidate, true);
});

test('openclaw execution claim is blocked', () => {
  const out = adjudicateMissionVerificationJudge({ missionSpec, verificationReturnText: 'OpenClaw executed shell and mutated files' });
  assert.equal(out.openClawBoundarySatisfied, false);
  assert.ok(out.blockers.includes('openclaw_boundary_violation'));
});
