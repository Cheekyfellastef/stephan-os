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
    supportSnapshot: { routeStatus: 'ready', providerStatus: 'ready', aiConsoleScrollDiagnostics: { answerPaneCount: 1, latestFinalAssistantAnswerPresent: true, requested: 'yes', requestReason: 'final-assistant-answer-rendered', targetKind: 'latest-assistant-answer-pane', targetFound: 'yes', containerFound: 'yes', containerScrollable: 'yes', scrollMethod: 'container-scroll', scrollCompleted: 'yes', skipReason: 'none', targetHasPromptRow: 'no', targetHasPendingRow: 'no', targetHasStaleRow: 'no' } },
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

test('Harness Agent V1 classifies command deck work as HIGH risk', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['tests/command-deck-protected-canon.test.mjs', 'stephanos-ui/src/state/answerDeliveryTruth.test.mjs'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(r.harnessAgentProjection.harnessStatus, 'blocked-until-proof');
  assert.equal(r.harnessAgentProjection.protectedCanonAtRisk.includes('command-deck-answer-delivery'), true);
});

test('Harness Agent V1 classifies ignition startup work as HIGH risk', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['scripts/ignite-stephanos-local.mjs'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(r.harnessAgentProjection.harnessStatus, 'blocked-until-proof');
  assert.equal(r.harnessAgentProjection.protectedCanonAtRisk.includes('ignition-startup-flow'), true);
});

test('Harness Agent V1 classifies docs-only work as LOW risk and enforces source-only rule', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['docs/STEPHANOS_NORTH_STAR.md'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(r.harnessAgentProjection.harnessStatus, 'read-only-advisory');
  assert.equal(r.harnessAgentProjection.sourceOnlyRequired, true);
});

test('Harness Agent V1 requires browser proof for visible UI runtime changes and forbids generated artifacts', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/components/MissionConsoleTile.jsx', 'apps/stephanos/dist/index.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } }, browserChecksObserved: [] },
  });
  assert.equal(r.harnessAgentProjection.browserProofRequired, true);
  assert.equal(r.harnessAgentProjection.generatedArtifactRisk, true);
  assert.equal(r.harnessAgentProjection.forbiddenFileScopes.includes('apps/stephanos/dist/**'), true);
});

test('Layer 7 queue emits browser-proof action when proof is pending', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/components/MissionConsoleTile.jsx'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/a.test.mjs'] } }, browserChecksObserved: [] },
  });
  assert.equal(r.missionApprovalQueue.queue.some((item) => item.actionType === 'run-browser-proof'), true);
});

test('Layer 7 queue emits hold/request-repair items for forbidden artifacts and missing evidence with bounded payload', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['apps/stephanos/dist/index.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: false, verifyRun: false } }, browserChecksObserved: [] },
  });
  assert.equal(r.missionApprovalQueue.queue.some((item) => item.actionType === 'hold-merge'), true);
  assert.equal(r.missionApprovalQueue.queue.some((item) => item.actionType === 'request-repair'), true);
  assert.equal(r.missionApprovalQueue.queue.every((item) => (item.copyPayload || '').length <= 2400), true);
  assert.equal(r.missionApprovalQueue.queue.every((item) => Array.isArray(item.sourceEvidence)), true);
});

test('Layer 7 queue emits approve-merge-review when browser proof passed and no gaps while approval remains required', () => {
  const observed = ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'];
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/a.test.mjs'] }, mergeReadyCandidate: true }, browserChecksObserved: observed },
    supportSnapshot: { aiConsoleScrollDiagnostics: { answerPaneCount: 1, latestFinalAssistantAnswerPresent: true, requested: 'yes', requestReason: 'final-assistant-answer-rendered', targetKind: 'latest-assistant-answer-pane', targetFound: 'yes', containerFound: 'yes', containerScrollable: 'yes', scrollMethod: 'container-scroll', scrollCompleted: 'yes', skipReason: 'none', targetHasPromptRow: 'no', targetHasPendingRow: 'no', targetHasStaleRow: 'no' } },
    operatorDecisionQueue: { decisions: [{ id: 'd1', decisionType: 'approve-merge', label: 'Approve merge', recommendedChoice: 'approve-merge' }] },
  });
  const item = r.missionApprovalQueue.queue.find((entry) => entry.actionType === 'approve-merge-review');
  assert.equal(Boolean(item), true);
  assert.equal(item.approvalRequired, true);
});
