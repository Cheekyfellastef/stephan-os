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
  assert.equal(r.harnessAgentProjection.protectedSubsystems.includes('COMMAND_DECK'), true);
});

test('Harness Agent V1 classifies ignition startup work as HIGH risk', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['scripts/ignite-stephanos-local.mjs'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(r.harnessAgentProjection.harnessStatus, 'blocked-until-proof');
  assert.equal(r.harnessAgentProjection.protectedSubsystems.includes('IGNITION'), true);
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





test('Harness Agent V1.2 version is emitted in projection and copy contract payload fields', () => {
  const harness = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(harness.harnessVersion, 'v1.2');
  assert.equal(harness.harnessAgentProjection?.harnessVersion, 'v1.2');
});

test('Harness Agent V1.2 applies conservative canon fallback for default idle high-risk contract', () => {
  const harness = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Awaiting operator Intent-to-Build input.' } },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: false, verifyRun: false } } },
  }).harnessAgentProjection;
  assert.equal(harness.mergeRecommendation, 'hold-for-operator-review');
  assert.equal(harness.protectedCanonClauses.length > 0, true);
  assert.equal(harness.protectedCanonWarning, 'Affected subsystem unknown; conservative protected canon fallback applied.');
  assert.equal(harness.protectedCanonClauses.some((c) => c.includes('source-only PR rule')), true);
  assert.equal(harness.protectedCanonClauses.some((c) => c.includes('read-only/adjudication only')), true);
  assert.equal(harness.nextOperatorAction.includes('Review conservative canon fallback'), true);
});

test('Harness Agent V1.2 applies conservative fallback for high-risk unknown task and preserves key protected surfaces', () => {
  const harness = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['scripts/guard-pr-clean-runner.mjs'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  }).harnessAgentProjection;
  assert.equal(harness.protectedCanonClauses.length > 0, true);
  assert.equal(harness.protectedSubsystems.includes('COMMAND_DECK'), true);
  assert.equal(harness.protectedSubsystems.includes('IGNITION'), true);
  assert.equal(harness.protectedSubsystems.includes('PR_HYGIENE'), true);
});
test('Harness Agent V1.2 hydrates protected canon clauses by subsystem and risk', () => {
  const commandDeck = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/hooks/useAIConsole.test.mjs'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  }).harnessAgentProjection;
  assert.equal(commandDeck.protectedCanonClauses.some((c) => c.includes('Answer Delivery Contract')), true);
  assert.equal(commandDeck.protectedCanonClauses.some((c) => c.includes('deliveryAnchoredAssistantAnswerId')), true);
  assert.equal(commandDeck.protectedCanonClauses.some((c) => c.includes('composer/input/execute visibility')), true);
  assert.equal(commandDeck.protectedCanonClauses.some((c) => c.includes('no-jump nearest outer reveal behavior')), true);
  assert.equal(commandDeck.protectedCanonClauses.some((c) => c.includes('Never use git add .')), true);

  const ignition = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['scripts/windows-launcher-defaults.test.mjs'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  }).harnessAgentProjection;
  assert.equal(ignition.protectedCanonClauses.some((c) => c.includes('Launch-Stephanos-Local.cmd')), true);
  assert.equal(ignition.protectedCanonClauses.some((c) => c.includes('Housekeeper preflight')), true);
  assert.equal(ignition.protectedCanonClauses.some((c) => c.includes('build + verify')), true);
  assert.equal(ignition.protectedCanonClauses.some((c) => c.includes('compact default ignition output')), true);

  const provider = deriveOperatorReliefProjection({ prEvidenceModel: { changedFiles: ['src/provider-routing.md'] } }).harnessAgentProjection;
  assert.equal(provider.protectedCanonClauses.some((c) => c.includes('requested vs selected vs executable vs actual provider separation')), true);
  assert.equal(provider.protectedCanonClauses.some((c) => c.includes('reachability vs usability vs browser compatibility')), true);

  const memory = deriveOperatorReliefProjection({ prEvidenceModel: { changedFiles: ['notes/memory-retrieval.txt'] } }).harnessAgentProjection;
  assert.equal(memory.protectedCanonClauses.some((c) => c.includes('memory write gates')), true);
  assert.equal(memory.protectedCanonClauses.some((c) => c.includes('provenance requirements')), true);

  const missionBrain = deriveOperatorReliefProjection({ prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] } }).harnessAgentProjection;
  assert.equal(missionBrain.protectedCanonClauses.some((c) => c.includes('read-only/adjudication only')), true);
  assert.equal(missionBrain.protectedCanonClauses.some((c) => c.includes('duplicate panes or parallel authority')), true);
  assert.equal(missionBrain.protectedCanonClauses.some((c) => c.includes('final merge approver')), true);

  const docsOnly = deriveOperatorReliefProjection({ prEvidenceModel: { changedFiles: ['docs/README.md'] } }).harnessAgentProjection;
  assert.equal(docsOnly.protectedCanonClauses.length > 0, true);
  assert.equal(docsOnly.protectedCanonClauses.some((c) => c.includes('source-only PR rule')), true);
  assert.equal(docsOnly.protectedCanonClauses.some((c) => c.includes('Answer Delivery Contract')), false);
  assert.equal(docsOnly.protectedCanonClauses.some((c) => c.includes('Housekeeper preflight')), false);
});


test('Mission Intelligence Summary is derived and deterministic from existing projections', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { title: 'Mission A', objective: 'Integrate projections' } },
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(typeof r.missionIntelligenceSummary?.missionIntelligenceStatus, 'string');
  assert.equal(r.missionIntelligenceSummary?.commandDeckContextAvailable, true);
  assert.equal(Array.isArray(r.missionIntelligenceSummary?.currentBlockers), true);
  assert.match(r.missionIntelligenceSummary?.nextBestAction || '', /./);
});


test('Co-Builder Loop projection is deterministic, approval-gated, and bounded to maxRounds default 3', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Build co-builder loop', repoArchitectureContext: { testsLikelyRequired: ['node --test tests/a.test.mjs'] } } },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } }, browserChecksObserved: [] },
    supportSnapshot: { coBuilderLoopRound: 4 },
  });
  assert.equal(r.coBuilderLoopProjection.maxRounds, 3);
  assert.equal(r.coBuilderLoopProjection.coBuilderStatus, 'blocked');
  assert.equal(r.coBuilderLoopProjection.openClawExecutionPacketAvailable, 'no');
  assert.equal(r.coBuilderLoopProjection.operatorApprovalRequired, 'yes');
  assert.equal(r.coBuilderLoopProjection.repairPacketAvailable, 'yes');
});

test('Agent Reality Loop chooses Codex for bounded code work and emits copy packets', () => {
  const observed = ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'];
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/a.test.mjs'] }, mergeReadyCandidate: true }, browserChecksObserved: observed },
    supportSnapshot: { aiConsoleScrollDiagnostics: { answerPaneCount: 1, latestFinalAssistantAnswerPresent: true, requested: 'yes', requestReason: 'final-assistant-answer-rendered', targetKind: 'latest-assistant-answer-pane', targetFound: 'yes', containerFound: 'yes', containerScrollable: 'yes', scrollMethod: 'container-scroll', scrollCompleted: 'yes', skipReason: 'none', targetHasPromptRow: 'no', targetHasPendingRow: 'no', targetHasStaleRow: 'no' } },
  });
  assert.equal(r.agentRealityLoopProjection.recommendedLead, 'Codex');
  assert.equal(typeof r.agentRealityLoopProjection.copyCodexPacket.nextBestAction, 'string');
  assert.equal(r.agentRealityLoopProjection.hasDuplicatePaneRisk, 'no');
});

test('Agent Reality Loop chooses OpenClaw for live proof and blocks merge when browser proof is absent', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/components/MissionConsoleTile.jsx'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/a.test.mjs'] } }, browserChecksObserved: [] },
  });
  assert.equal(r.agentRealityLoopProjection.recommendedLead, 'hold');
  assert.equal(r.agentRealityLoopProjection.mergeRecommendation, 'hold-browser-proof-missing');
  assert.equal(r.agentRealityLoopProjection.operatorApprovalRequired, true);
  assert.match(r.agentRealityLoopProjection.copyOpenClawPacket.liveProofFirst, /Support Snapshot/);
});

test('Operator-Approved Repair Loop routes projection bridge loss to OpenClaw while keeping approval valid', () => {
  const r = deriveOperatorReliefProjection({
    missionRepairLoopModel: { approvedMissionId: 'arl-1', approvedMissionTitle: 'Repair ARL bridge', retryCount: 1, maxRetries: 3 },
    supportSnapshot: { executionMetadata: { agent_reality_loop_projection_available: 'no', agent_reality_loop_availability_blocker: 'projection-missing-from-command-deck-path', operator_relief_bridge_drop_boundary: 'request-runtime-status' } },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.equal(r.operatorApprovedRepairLoopProjection.failureClass, 'projection-bridge-loss');
  assert.equal(r.operatorApprovedRepairLoopProjection.recommendedLead, 'openclaw');
  assert.equal(r.operatorApprovedRepairLoopProjection.operatorApprovalStillValid, 'yes');
  assert.equal(r.operatorApprovedRepairLoopProjection.scopeChangeRequired, 'no');
});

test('Builder Harness projection exposes read-only OpenClaw/local AI/GitHub readiness and copy packets', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Enable OpenClaw builder harness' } },
    prEvidenceModel: { branch: 'builder-harness', prUrl: 'https://github.com/example/repo/pull/1', changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    proofOfDoneModel: {
      verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/operator-relief-projection.test.mjs'] } },
      browserChecksObserved: ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'],
    },
    supportSnapshot: { localAvailable: true, openClawKillSwitchState: 'armed' },
  });

  assert.equal(r.builderHarnessProjection.builderHarnessStatus, 'ready-read-only');
  assert.equal(r.builderHarnessProjection.connectedLocalAiStatus, 'connected-read-only-review');
  assert.equal(r.builderHarnessProjection.githubIntegrationStatus, 'inspectable-read-only');
  assert.equal(r.builderHarnessProjection.repoInspectionCapability, 'available-read-only');
  assert.equal(r.builderHarnessProjection.patchPlanningCapability, 'available-proposal-only');
  assert.equal(r.builderHarnessProjection.testExecutionCapability, 'operator-approved-command-only');
  assert.equal(r.builderHarnessProjection.approvalRequired, true);
  assert.equal(r.builderHarnessProjection.mutationAllowed, false);
  assert.equal(r.builderHarnessProjection.noAutoMerge, true);
  assert.equal(r.builderHarnessProjection.codexRole, 'fallback-specialist-only');
  assert.equal(r.builderHarnessProjection.copyLocalAiReviewPacket.packetType, 'local_ai_review_packet');
  assert.equal(r.builderHarnessProjection.copyOpenClawPatchPlanPacket.packetType, 'openclaw_patch_plan_packet');
  assert.equal(r.builderHarnessProjection.copyGithubPrInspectionPacket.packetType, 'github_pr_inspection_packet');
  assert.equal(r.builderHarnessProjection.copyCodexFallbackPacket.codexRole, 'fallback-specialist-only');
  assert.match(r.builderHarnessProjection.nextBestAction, /operator approval/i);
});

test('Builder Mesh low-risk read-only task recommends zero-cost builder and not Codex', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Review next task without implementation', repoArchitectureContext: { testsLikelyRequired: [] } } },
    supportSnapshot: { builderMeshTaskKind: 'read-only', localAiConnected: true, openClawApprovalGateOpen: true },
  });
  assert.ok(['local-ai', 'openclaw'].includes(r.builderMeshProjection.recommendedBuilder));
  assert.notEqual(r.builderMeshProjection.recommendedBuilder, 'codex-fallback');
  assert.equal(r.builderMeshProjection.codexRequired, false);
  assert.equal(r.builderMeshProjection.zeroCostRouteAvailable, true);
});

test('Builder Mesh GitHub inspection task recommends github-inspection when PR evidence is available', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Inspect the PR diff and checks' } },
    prEvidenceModel: { prUrl: 'https://github.example/pr/1', changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    supportSnapshot: { builderMeshTaskKind: 'github-inspection', githubIntegrationStatus: 'connected' },
  });
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'github-inspection');
  assert.equal(r.builderMeshProjection.githubCanHelp, 'yes-read-only-pr-diff-status-evidence');
});

test('Builder Mesh implementation task uses Codex fallback only with a clear non-default reason', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Implement a bounded patch after planning' } },
    supportSnapshot: { builderMeshTaskKind: 'implementation', localAiConnected: true, openClawApprovalGateOpen: true },
  });
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'codex-fallback');
  assert.equal(r.builderMeshProjection.codexRequired, false);
  assert.match(r.builderMeshProjection.codexReason, /no approved local\/OpenClaw mutation path is proven/i);
});

test('Builder Mesh high-risk mutation routes to operator approval before mutation', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Approve high-risk mutation' } },
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/hooks/useAIConsole.js'] },
    supportSnapshot: { builderMeshTaskKind: 'high-risk-mutation', localAiConnected: true },
  });
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'operator');
  assert.equal(r.builderMeshProjection.approvalRequiredBeforeMutation, true);
  assert.notEqual(r.builderMeshProjection.codexRequired, true);
});

test('Builder Mesh copy packets exist and stay bounded/read-only', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Route next build task' } },
    supportSnapshot: { builderMeshTaskKind: 'read-only', localAiConnected: true },
  });
  const packets = r.builderMeshProjection.copyPackets;
  for (const key of ['localAiReviewPacket', 'openClawResearchPacket', 'githubInspectionPacket', 'codexFallbackPacket', 'operatorApprovalChecklist']) {
    assert.ok(packets[key], `${key} should exist`);
    assert.ok(JSON.stringify(packets[key]).length < 5000, `${key} should be bounded`);
    assert.match(JSON.stringify(packets[key]), /Do not mutate repo files/);
  }
});

test('Builder Workbench V1 parses safe local AI review intake and keeps approval before patch required', async () => {
  const { parseBuilderWorkbenchResult } = await import('../stephanos-ui/src/state/operatorReliefProjection.js');
  const parsed = parseBuilderWorkbenchResult(`Summary: Review found a small projection-only follow-up.\nFiles suspected: stephanos-ui/src/state/operatorReliefProjection.js, tests/operator-relief-projection.test.mjs\nProposed change type: read-only-review\nRisk level: low\nTests recommended: node --test tests/operator-relief-projection.test.mjs\nConfidence: 88%\nRequires Codex fallback: no\nRequires operator approval: yes`);
  assert.equal(parsed.safeForWorkbench, true);
  assert.equal(parsed.summary, 'Review found a small projection-only follow-up.');
  assert.equal(parsed.filesSuspected.includes('stephanos-ui/src/state/operatorReliefProjection.js'), true);
  assert.equal(parsed.riskLevel, 'low');
  assert.equal(parsed.requiresCodexFallback, 'no');
  assert.equal(parsed.requiresOperatorApproval, 'yes');
});

test('Builder Workbench V1 parses safe OpenClaw patch plan and can reduce Codex fallback need', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Implement bounded workbench projection', repoArchitectureContext: { testsLikelyRequired: [] } } },
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } }, browserChecksObserved: ['tile opens'] },
    supportSnapshot: {
      nextBuilderTaskKind: 'implementation',
      builderWorkbenchInput: {
        openClawResearchText: `Summary: Patch plan is source-only and approval-gated.\nFiles suspected: stephanos-ui/src/state/operatorReliefProjection.js, stephanos-ui/src/components/MissionConsoleTile.jsx\nProposed change type: patch-plan\nRisk level: medium\nTests recommended: node --test tests/operator-relief-projection.test.mjs, npm run stephanos:build\nConfidence: high\nRequires Codex fallback: no\nRequires operator approval: yes`,
      },
    },
  });
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.workbenchStatus, 'ready');
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.openClawResearchResultPresent, true);
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.patchPlanPresent, true);
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.patchPlanRisk, 'medium');
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.approvalRequiredBeforePatch, true);
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.codexFallbackStillNeeded, false);
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'operator');
  assert.equal(r.builderMeshProjection.codexRequired, false);
});

test('Builder Workbench V1 blocks forbidden mutation language in pasted results', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Implement bounded workbench projection' } },
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    supportSnapshot: {
      nextBuilderTaskKind: 'implementation',
      builderWorkbenchInput: {
        localAiReviewText: 'Summary: I edited the source file and applied the patch without operator approval.\nRequires Codex fallback: no',
      },
    },
  });
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.localAiReviewResultPresent, true);
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.blockers.includes('Forbidden mutation/autonomy language detected in pasted workbench result.'), true);
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.codexFallbackStillNeeded, true);
  assert.equal(r.builderMeshProjection.builderWorkbenchProjection.localAiReview.safeForWorkbench, false);
});
