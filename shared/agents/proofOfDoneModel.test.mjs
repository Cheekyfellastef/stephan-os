import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateProofOfDone, createProofOfDoneChecklist, WORLD_WORKSPACE_PROOF_OF_DONE } from './proofOfDoneModel.mjs';

test('visual-ui checklist includes operator-visible checks', () => {
  const checklist = createProofOfDoneChecklist('visual-ui');
  assert.equal(checklist.taskType, 'visual-ui');
  assert.ok(checklist.requiredChecks.includes('target surface is visible'));
  assert.equal(checklist.manualVerificationRequired, true);
});

test('proof adjudication reports operator proof pending until required checks pass', () => {
  const adjudicated = adjudicateProofOfDone({
    taskType: 'visual-ui',
    requiredChecks: WORLD_WORKSPACE_PROOF_OF_DONE.requiredChecks,
    buildVerified: true,
    runtimeVerified: false,
    checksPassed: ['World Tile visible on landing page'],
  });
  assert.equal(adjudicated.proofStatus, 'operator_proof_pending');
  assert.equal(adjudicated.operatorVisibleProofPending, true);
  assert.equal(adjudicated.manualVerificationRequired, true);
});

test('world workspace proof set captures three module error guard', () => {
  assert.ok(WORLD_WORKSPACE_PROOF_OF_DONE.requiredChecks.includes('no Failed to resolve module specifier "three" browser error'));
});
