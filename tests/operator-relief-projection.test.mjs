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

test('Projection promotes AIConsole autoscroll proof into completed proofs when diagnostics are complete', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Climb Layer 3/4', repoArchitectureContext: { testsLikelyRequired: [] } } },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
    supportSnapshot: { aiConsoleScrollDiagnostics: { answerPaneCount: 1, latestFinalAssistantAnswerPresent: true, requested: 'yes', requestReason: 'final-assistant-answer-rendered', targetKind: 'latest-assistant-answer-pane', targetFound: 'yes', containerFound: 'yes', containerScrollable: 'yes', scrollMethod: 'container-scroll', scrollCompleted: 'yes', skipReason: 'none', targetHasPromptRow: 'no', targetHasPendingRow: 'no', targetHasStaleRow: 'no' } },
  });
  assert.equal(r.missionBrainNextAction.completedProofs.some((proof) => proof.id === 'aiconsole-answer-pane-autoscroll'), true);
  assert.equal(r.missionBrainNextAction.currentPhase, 'Layer 3 → Layer 4 climb');
});

test('Projection reports missing-live-proof evidence gap and bounded codex prompt when autoscroll proof is missing', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Climb Layer 3/4', repoArchitectureContext: { testsLikelyRequired: ['node --test tests/a.test.mjs'] } } },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: false, verifyRun: false } } },
    supportSnapshot: { aiConsoleScrollDiagnostics: { answerPaneCount: 2, requested: 'no' } },
  });
  assert.equal(r.missionBrainNextAction.openEvidenceGaps.some((gap) => gap.id === 'missing-live-proof'), true);
  assert.equal(r.missionBrainNextAction.mergeReadiness, 'blocked');
  assert.match(r.missionBrainNextAction.codexPromptCandidate, /Mission objective:/);
  assert.match(r.missionBrainNextAction.codexPromptCandidate, /Completed proofs:/);
  assert.match(r.missionBrainNextAction.codexPromptCandidate, /Evidence gaps:/);
  assert.match(r.missionBrainNextAction.codexPromptCandidate, /Constraints:/);
  assert.match(r.missionBrainNextAction.codexPromptCandidate, /Tests required:/);
  assert.match(r.missionBrainNextAction.codexPromptCandidate, /Definition of done:/);
});

test('Layer 5 routing and Layer 6 verification intake classify proof pending for UI work', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'UI fix mission', repoArchitectureContext: { testsLikelyRequired: ['node --test tests/a.test.mjs'] } } },
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/components/MissionConsoleTile.jsx'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/a.test.mjs'] } }, browserChecksObserved: [] },
  });
  assert.equal(r.agentWorkRoutingProjection.approvalRequired, true);
  assert.equal(r.agentWorkRoutingProjection.requiredTests.length > 0, true);
  assert.equal(r.verificationReturnIntake.returnStatus, 'technically-clean-but-proof-pending');
  assert.equal(r.verificationReturnIntake.mergeRecommendation, 'blocked-pending-browser-proof');
});

test('Layer 6 verification intake blocks forbidden artifacts', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['apps/stephanos/dist/index.js', 'runtime/session.log'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } }, browserChecksObserved: [] },
  });
  assert.equal(r.verificationReturnIntake.mergeRecommendation, 'blocked');
  assert.equal(r.verificationReturnIntake.forbiddenArtifactRisk, true);
});
