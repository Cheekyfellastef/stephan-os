import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperatorReliefProjection, buildAgentRealityLoopProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';
import { buildProjectAwarenessProjection } from '../stephanos-ui/src/state/projectAwarenessProjection.js';

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
  assert.equal(r.agentRealityLoopProjection.recommendedLead, 'codex');
  assert.equal(typeof r.agentRealityLoopProjection.copyCodexPacket.nextBestAction, 'string');
  assert.equal(r.agentRealityLoopProjection.hasDuplicatePaneRisk, 'no');
});

test('Agent Reality Loop chooses OpenClaw for live proof and blocks merge when browser proof is absent', () => {
  const r = deriveOperatorReliefProjection({
    prEvidenceModel: { changedFiles: ['stephanos-ui/src/components/MissionConsoleTile.jsx'] },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true, testsRun: ['node --test tests/a.test.mjs'] } }, browserChecksObserved: [] },
  });
  assert.equal(r.agentRealityLoopProjection.recommendedLead, 'operator');
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
  assert.notEqual(r.builderMeshProjection.recommendedBuilder, 'codex');
  assert.equal(r.builderMeshProjection.codexRequired, false);
  assert.equal(r.builderMeshProjection.zeroCostRouteAvailable, true);
});

test('Builder Mesh GitHub inspection task recommends github-inspection when PR evidence is available', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Inspect the PR diff and checks' } },
    prEvidenceModel: { prUrl: 'https://github.example/pr/1', changedFiles: ['stephanos-ui/src/state/operatorReliefProjection.js'] },
    supportSnapshot: { builderMeshTaskKind: 'github-inspection', githubIntegrationStatus: 'connected' },
  });
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'hold');
  assert.equal(r.builderMeshProjection.githubCanHelp, 'yes-read-only-pr-diff-status-evidence');
});

test('Builder Mesh implementation task uses Codex fallback only with a clear non-default reason', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Implement a bounded patch after planning' } },
    supportSnapshot: { builderMeshTaskKind: 'implementation', localAiConnected: true, openClawApprovalGateOpen: true },
  });
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'codex');
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
  for (const key of ['localAiReviewPacket', 'openClawResearchPacket', 'openClawPatchPlannerPacket', 'githubInspectionPacket', 'codexFallbackPacket', 'operatorApprovalChecklist']) {
    assert.ok(packets[key], `${key} should exist`);
    assert.ok(JSON.stringify(packets[key]).length < 9000, `${key} should be bounded`);
    assert.match(JSON.stringify(packets[key]), /Do not mutate repo files/);
  }
});

test('Builder Workbench V1 parses safe local AI review intake and keeps approval before patch required', async () => {
  const { parseBuilderWorkbenchResult } = await import('../stephanos-ui/src/state/operatorReliefProjection.js');
  const parsed = parseBuilderWorkbenchResult(`Summary: Review found a small projection-only follow-up.\nSuspected files: stephanos-ui/src/state/operatorReliefProjection.js, tests/operator-relief-projection.test.mjs\nProposed change type: read-only-review\nRisk level: low\nTests recommended: node --test tests/operator-relief-projection.test.mjs\nConfidence: 88%\nRequires Codex fallback: no\nRequires operator approval: yes`);
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
        openClawResearchText: `Summary: Patch plan is source-only and approval-gated.\nSuspected files: stephanos-ui/src/state/operatorReliefProjection.js, stephanos-ui/src/components/MissionConsoleTile.jsx\nProposed change type: patch-plan\nRisk level: medium\nTests recommended: node --test tests/operator-relief-projection.test.mjs, npm run stephanos:build\nConfidence: high\nRequires Codex fallback: no\nRequires operator approval: yes
Forbidden actions detected: none
Reasoning: Safe parsed runner output.`,
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




test('OpenClaw Sanity Gate passes exact payload with CLI banner for stephanos-scout llama route', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        openClawResearchText: `OpenClaw CLI banner: stephanos-scout ollama/llama3.2:3b
OPENCLAW_SANITY_PASS`,
      },
    },
  });
  const sanity = r.builderMeshProjection.builderWorkbenchProjection.openClawSanityGate;
  assert.equal(sanity.sanityStatus, 'passed');
  assert.equal(sanity.exactResponseStatus, 'passed');
  assert.equal(sanity.exactResponsePayload, 'OPENCLAW_SANITY_PASS');
  assert.equal(sanity.cliBannerIgnored, 'yes');
  assert.equal(sanity.routeTrustStatus, 'basic-sanity-pass');
  assert.equal(sanity.trustedForBuilderRouting, 'no');
  assert.equal(sanity.trustedForPatchPlanning, 'no');
});

test('OpenClaw Sanity Gate fails qwen14 exact-response template leakage', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        openClawResearchText: '<your response>   --- a change request or PRs',
      },
    },
  });
  const sanity = r.builderMeshProjection.builderWorkbenchProjection.openClawSanityGate;
  assert.equal(sanity.sanityStatus, 'failed');
  assert.equal(sanity.exactResponseStatus, 'failed');
  assert.equal(sanity.templateLeakageDetected, 'yes');
  assert.equal(sanity.trustedForBuilderRouting, 'no');
  assert.equal(r.builderMeshProjection.openClawCanHelp, 'blocked-sanity-failed');
});


test('OpenClaw Sanity Gate treats dashboard NO as task-frame failure and blocks routing', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      nextBuilderTaskKind: 'read-only',
      builderWorkbenchInput: {
        openClawRouteId: 'dashboard',
        openClawResearchText: 'NO',
      },
    },
  });
  const sanity = r.builderMeshProjection.builderWorkbenchProjection.openClawSanityGate;
  assert.equal(sanity.routeId, 'dashboard');
  assert.equal(sanity.routeTaskFrameStatus, 'failed');
  assert.deepEqual(sanity.dashboardFailureExamples, ['NO']);
  assert.equal(sanity.trustedForPatchPlanning, 'no');
  assert.notEqual(r.builderMeshProjection.recommendedBuilder, 'openclaw');
  assert.equal(r.builderMeshProjection.openClawCanHelp, 'blocked-sanity-failed');
});


test('OpenClaw Sanity Gate tracks doctor route/session/model warnings without making manual-mode findings blockers', () => {
  const doctorText = `Gateway local is reachable at ws://127.0.0.1:18789.
Dashboard is reachable at http://127.0.0.1:18789/.
Gateway service and Node service are not installed.
Channels are not configured.
14 active sessions exist, including old dashboard/qwen sessions.
agent:stephanos-scout-qwen14:dashboard session is pinned to ollama/llama3.2:3b even though qwen14 config primary is ollama/qwen:14b.
agent:main:main is pinned to ollama/qwen:14b even though config primary is openai/gpt-5.5.
Doctor warns plaintext gateway tokens exist in openclaw.json.
Doctor says memory search explicitly disabled.
Command owner is not configured.`;
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      nextBuilderTaskKind: 'read-only',
      builderWorkbenchInput: {
        openClawRouteId: 'dashboard',
        openClawStatusText: doctorText,
        openClawResearchText: 'Summary: route status only.',
      },
    },
  });
  const sanity = r.builderMeshProjection.builderWorkbenchProjection.openClawSanityGate;
  assert.equal(sanity.routeId, 'dashboard');
  assert.equal(sanity.routeTrustStatus, 'untrusted-by-default');
  assert.equal(sanity.activeSessionCount, '14');
  assert.equal(sanity.activeSessionContaminationRisk, 'yes');
  assert.equal(sanity.routeModelMismatchDetected, 'yes');
  assert.match(sanity.modelPinMismatchWarnings.join(' | '), /stephanos-scout-qwen14/);
  assert.equal(sanity.plaintextTokenSecurityWarning, 'yes');
  assert.match(sanity.doctorNonBlockingFindings.join(' | '), /service-not-installed-intentional-no-autostart/);
  assert.match(sanity.doctorNonBlockingFindings.join(' | '), /channels-not-configured-manual-local-ok/);
  assert.match(sanity.doctorNonBlockingFindings.join(' | '), /command-owner-not-configured-manual-local-ok/);
  assert.match(sanity.doctorNonBlockingFindings.join(' | '), /memory-search-disabled-not-builder-blocker/);
  assert.notEqual(r.builderMeshProjection.recommendedBuilder, 'openclaw');
  assert.equal(r.builderMeshProjection.openClawCanHelp, 'blocked-route-untrusted');
});

test('OpenClaw Sanity Gate fails template-contaminated wrapper outputs before Builder Mesh routing', () => {
  const contaminatedOutputs = [
    'As a language model, I can help you... say next... <your question or action request>',
    '## <response> C:\\Users\\Stephan Callear\\GitHub\\stephanos.',
    '<END-TOOL >',
  ];
  for (const openClawResearchText of contaminatedOutputs) {
    const r = deriveOperatorReliefProjection({
      supportSnapshot: {
        nextBuilderTaskKind: 'read-only',
        builderWorkbenchInput: {
          openClawPatchPlanJudgedAt: '2026-05-30T00:00:00.000Z',
          openClawResearchText,
        },
      },
    });
    const workbench = r.builderMeshProjection.builderWorkbenchProjection;
    assert.equal(workbench.openClawSanityGate.sanityStatus, 'failed');
    assert.equal(workbench.openClawSanityGate.trustedForBuilderRouting, 'no');
    assert.notEqual(r.builderMeshProjection.recommendedBuilder, 'openclaw');
    assert.equal(r.builderMeshProjection.openClawCanHelp, 'blocked-sanity-failed');
    assert.match(workbench.openClawSanityGate.nextOperatorAction, /Do not route this OpenClaw result/i);
  }
});

test('OpenClaw Sanity Gate flags wrong repo paths and allows only the canonical Windows repo path', () => {
  const bad = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        openClawPatchPlanJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawResearchText: 'Summary: inspect C:\\Users\\Stephan Callear\\GitHub\\stephanos for files.',
      },
    },
  }).builderMeshProjection.builderWorkbenchProjection.openClawSanityGate;
  assert.equal(bad.wrongRepoPathDetected, 'yes');
  assert.equal(bad.sanityStatus, 'failed');

  const good = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        openClawPatchPlanJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawResearchText: `Summary: Specific plan uses the canonical operator repo path only.
Likely files: stephanos-ui/src/state/operatorReliefProjection.js
Required tests: node --test tests/operator-relief-projection.test.mjs
Risk level: low
Patch scope: source-only
Browser proof required: no
Requires Codex fallback: no
Codex fallback reason: specific plan
Repo path: C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os`,
      },
    },
  }).builderMeshProjection.builderWorkbenchProjection.openClawSanityGate;
  assert.equal(good.wrongRepoPathDetected, 'no');
  assert.equal(good.sanityStatus, 'needs-route-proof');
  assert.equal(good.trustedForBuilderRouting, 'no');
});

test('OpenClaw Patch Planner V1 defaults keep mutation locked and auto-start forbidden', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: { builderMeshTaskKind: 'read-only', builderWorkbenchInput: {} },
  });
  const planner = r.builderMeshProjection.builderWorkbenchProjection.openClawPatchPlanner;
  assert.equal(planner.patchPlannerStatus, 'idle');
  assert.equal(planner.mutationAuthority, 'locked');
  assert.equal(planner.autoStart, 'forbidden');
  assert.equal(planner.operatorApprovalRequired, 'yes');
  assert.equal(planner.trustedForPatch, 'no');
});

test('OpenClaw Patch Planner V1 detects specific files, tests, browser proof, and no Codex fallback', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      nextBuilderTaskKind: 'implementation',
      builderWorkbenchInput: {
        openClawPatchPlanJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawResearchText: `Summary: Extend the existing Builder Workbench projection and UI for patch planning.
Likely files: stephanos-ui/src/state/operatorReliefProjection.js, stephanos-ui/src/components/MissionConsoleTile.jsx, stephanos-ui/src/state/supportSnapshot.js
Required tests: node --test tests/operator-relief-projection.test.mjs, npm run stephanos:build
Risk level: medium
Patch scope: ui-runtime
Browser proof required: yes
Requires Codex fallback: no
Codex fallback reason: Specific read-only plan is enough for operator handoff.
Requires operator approval: yes
Mutation authority: locked
Auto-start: forbidden
Next operator action: Review handoff and approve exact files before mutation.`,
      },
    },
  });
  const planner = r.builderMeshProjection.builderWorkbenchProjection.openClawPatchPlanner;
  assert.equal(planner.patchPlannerStatus, 'passed');
  assert.equal(planner.likelyFiles.includes('stephanos-ui/src/state/operatorReliefProjection.js'), true);
  assert.equal(planner.requiredTests.includes('node --test tests/operator-relief-projection.test.mjs'), true);
  assert.equal(planner.browserProofRequired, 'yes');
  assert.equal(planner.codexFallbackNeeded, 'no');
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'operator');
});

test('OpenClaw Patch Planner V1 fails generic placeholder boilerplate and requires Codex fallback reason', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        openClawPatchPlanJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawResearchText: `Summary: <answer>
Likely files: appropriate files
Required tests: run the tests
Risk level: low
Requires Codex fallback: unknown`,
      },
    },
  });
  const planner = r.builderMeshProjection.builderWorkbenchProjection.openClawPatchPlanner;
  assert.equal(planner.patchPlannerStatus, 'failed');
  assert.equal(planner.placeholderLeakageDetected, 'yes');
  assert.equal(planner.planSpecificity, 'low');
  assert.equal(planner.codexFallbackNeeded, 'yes');
  assert.match(planner.codexFallbackReason, /Placeholder|specificity|sanity|template/i);
});

test('OpenClaw Patch Planner V1 catches forbidden edit commit push and run-command claims', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        openClawPatchPlanJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawResearchText: `Summary: I edited the source file and ran npm run stephanos:build.
Likely files: stephanos-ui/src/state/operatorReliefProjection.js
Required tests: npm run stephanos:build
Risk level: low
Requires Codex fallback: no`,
      },
    },
  });
  const planner = r.builderMeshProjection.builderWorkbenchProjection.openClawPatchPlanner;
  assert.equal(planner.forbiddenActionsDetected, 'yes');
  assert.equal(planner.patchPlannerStatus, 'failed');
  assert.equal(planner.codexFallbackNeeded, 'yes');
});

test('Builder Workbench Local AI Runner safe result updates verdict and routes to operator checklist', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Review workbench local AI runner output' } },
    supportSnapshot: {
      nextBuilderTaskKind: 'implementation',
      localAiConnected: true,
      builderWorkbenchInput: {
        localAiRunnerStatus: 'succeeded',
        localAiRunnerSelectedModel: 'llama3.2:3b',
        localAiRunnerLastRunResult: 'succeeded',
        localAiRunnerLastRunBlockedReason: 'none',
        localAiRunnerDispatchAttempted: 'yes',
        localAiRunnerRequestSent: 'yes',
        localAiRunnerResponseRetained: 'yes',
        localAiRunnerParseAttempted: 'yes',
        localAiRunnerParseResultStatus: 'parsed',
        localAiRunnerRawResponse: `Summary: Safe projection-only review found no blocker.
Suspected files: stephanos-ui/src/state/operatorReliefProjection.js
Proposed change type: read-only-review
Risk level: low
Tests recommended: node --test tests/operator-relief-projection.test.mjs
Confidence: 90%
Requires Codex fallback: no
Requires operator approval: yes
Forbidden actions detected: none
Reasoning: Safe parsed runner output.`,
      },
    },
  });
  const workbench = r.builderMeshProjection.builderWorkbenchProjection;
  assert.equal(workbench.localAiRunnerStatus, 'succeeded');
  assert.equal(workbench.localAiRunnerSelectedModel, 'llama3.2:3b');
  assert.equal(workbench.localAiRunnerParsedResultPresent, true);
  assert.equal(workbench.workbenchAnswerContextUsed, 'no');
  assert.equal(workbench.workbenchParsedResultSource, 'local-ai-runner');
  assert.equal(workbench.localAiRunnerDispatchAttempted, 'yes');
  assert.equal(workbench.localAiRunnerRequestSent, 'yes');
  assert.equal(workbench.localAiRunnerResponseRetained, 'yes');
  assert.equal(workbench.localAiRunnerParseAttempted, 'yes');
  assert.equal(workbench.localAiRunnerParseResultStatus, 'parsed');
  assert.equal(workbench.workbenchOutputViewportStatus, 'usable-css-hooks-present');
  assert.equal(workbench.codexFallbackStillNeeded, false);
  assert.equal(workbench.verdict, 'operator-review-before-patch');
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'operator');
  assert.match(r.builderMeshProjection.nextBestAction, /Operator Approval Checklist|workbench findings/i);
  assert.equal(r.builderMeshProjection.codexRequired, false);
});

test('Builder Workbench Local AI Runner malformed/empty result does not break UI projection', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderMeshTaskKind: 'read-only',
      localAiConnected: true,
      builderWorkbenchInput: {
        localAiRunnerStatus: 'failed',
        localAiRunnerSelectedModel: 'llama3.2:3b',
        localAiRunnerLastRunResult: 'failed',
        localAiRunnerLastRunBlockedReason: 'Local AI response missing required Workbench field(s): summary.',
        localAiRunnerDispatchAttempted: 'yes',
        localAiRunnerRequestSent: 'yes',
        localAiRunnerResponseRetained: 'yes',
        localAiRunnerParseAttempted: 'yes',
        localAiRunnerParseResultStatus: 'malformed',
        localAiRunnerRawResponse: 'not parseable',
        localAiReviewText: '',
      },
    },
  });
  const workbench = r.builderMeshProjection.builderWorkbenchProjection;
  assert.equal(workbench.workbenchStatus, 'ready');
  assert.equal(workbench.localAiRunnerStatus, 'failed');
  assert.equal(workbench.localAiRunnerParsedResultPresent, false);
  assert.equal(workbench.localAiRunnerParseResultStatus, 'malformed');
  assert.equal(workbench.localAiRunnerDispatchAttempted, 'yes');
  assert.equal(workbench.localAiRunnerRequestSent, 'yes');
  assert.equal(workbench.codexFallbackStillNeeded, false);
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

test('Builder Mesh context includes OpenClaw web research intake state and bounded routing guidance', () => {
  const r = deriveOperatorReliefProjection({
    intentToBuildModel: { missionSpec: { objective: 'Research VR conversion techniques' } },
    supportSnapshot: {
      builderMeshTaskKind: 'read-only',
      localAiConnected: true,
      builderWorkbenchInput: {
        openClawResearchText: 'Sources:\n- https://example.com/vr\nTechnique taxonomy: flat-to-VR depth reconstruction. Starfield VR relevance. Unknowns. Confidence: medium',
      },
    },
  });
  assert.equal(r.builderMeshProjection.openClawWebResearchIntake.validUrlCount, 1);
  assert.equal(r.builderMeshProjection.openClawWebResearchIntake.mutationAuthority, 'locked');
  assert.equal(r.builderMeshProjection.openClawWebResearchIntake.recommendedUse, 'research-only');
  assert.match(r.builderMeshProjection.openClawResearchScoutGuidance, /minimum viable|bounded source-pack|llama3\.2/i);
  assert.match(r.builderMeshProjection.openClawResearchScoutGuidance, /cannot mutate files/i);
  assert.match(r.builderMeshProjection.openClawResearchScoutGuidance, /Codex remains fallback implementation lane/i);
  assert.match(r.builderMeshProjection.openClawResearchScoutGuidance, /operator approval/i);
});

const BUILDER_MESH_SOURCE_PACK_TEXT = `SOURCE PACK START
Topic:
Builder Mesh research routing
Source 1 title:
Support Snapshot proof
Source 1 URL:
https://example.test/support
Source 1 notes:
OpenClaw workspace hygiene is clean. Mutation authority is locked. Source Pack Runner output is bounded and read-only.
TASK:
Extract only what is supported by the source pack.
SOURCE PACK END`;

const BUILDER_MESH_GOOD_SOURCE_PACK_OUTPUT = `SOURCE_PACK_STATUS: bounded
SUMMARY:
The source pack says OpenClaw workspace hygiene is clean, mutation authority is locked, and the output is bounded/read-only.
USEFUL_FACTS:
- Workspace hygiene is clean.
- Mutation authority is locked.
UNKNOWNS:
- Whether any newer route proof exists is unknown.
RISKS:
- Treating this as mutation authority would be unsafe.
NEXT_RESEARCH_QUESTIONS:
- Is there newer operator proof?
STEPHANOS_HANDOFF_PACKET:
status: bounded
source: https://example.test/support`;

test('Builder Mesh V1 failed Source Pack result blocks OpenClaw build/canon routing', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderMeshTaskKind: 'research',
      builderWorkbenchInput: {
        openClawSourcePackText: BUILDER_MESH_SOURCE_PACK_TEXT,
        openClawSourcePackOutput: `${BUILDER_MESH_GOOD_SOURCE_PACK_OUTPUT}\n<your response>`,
      },
    },
  });
  const mesh = r.builderMeshProjection;
  assert.equal(mesh.openClawEligible, false);
  assert.notEqual(mesh.recommendedBuilder, 'openclaw');
  assert.match(mesh.blockers.join(' | '), /Source Pack Runner failed judgment|not clean\/trusted/i);
  assert.equal(mesh.mutationAllowed, false);
});

test('Builder Mesh V1 stale Source Pack result blocks OpenClaw build/canon routing', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderMeshTaskKind: 'research',
      builderWorkbenchInput: {
        openClawSourcePackJudgedAt: '2026-06-02T00:00:00.000Z',
        openClawSourcePackLastJudgedText: BUILDER_MESH_SOURCE_PACK_TEXT,
        openClawSourcePackLastJudgedOutput: BUILDER_MESH_GOOD_SOURCE_PACK_OUTPUT,
        openClawSourcePackText: `${BUILDER_MESH_SOURCE_PACK_TEXT}\nchanged`,
        openClawSourcePackOutput: BUILDER_MESH_GOOD_SOURCE_PACK_OUTPUT,
      },
    },
  });
  const mesh = r.builderMeshProjection;
  assert.equal(mesh.builderWorkbenchProjection.openClawSourcePackRunner.sourcePackStatus, 'stale');
  assert.equal(mesh.openClawEligible, false);
  assert.notEqual(mesh.recommendedBuilder, 'openclaw');
});

test('Builder Mesh V1 clean trusted research result can recommend OpenClaw for read-only research only', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      builderMeshTaskKind: 'research',
      openClawApprovalGateOpen: true,
      localAiConnected: false,
      builderWorkbenchInput: {
        openClawSourcePackText: BUILDER_MESH_SOURCE_PACK_TEXT,
        openClawSourcePackOutput: BUILDER_MESH_GOOD_SOURCE_PACK_OUTPUT,
      },
    },
  });
  const mesh = r.builderMeshProjection;
  assert.equal(mesh.taskKind, 'research');
  assert.equal(mesh.recommendedBuilder, 'openclaw');
  assert.equal(mesh.openClawEligible, true);
  assert.equal(mesh.mutationAllowed, false);
  assert.match(mesh.recommendedBuilderReason, /read-only research\/intake only/i);
});

test('Builder Mesh V1 implementation without proven local mutation recommends Codex fallback', () => {
  const r = deriveOperatorReliefProjection({ supportSnapshot: { builderMeshTaskKind: 'implementation', localAiConnected: true } });
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'codex');
  assert.equal(r.builderMeshProjection.codexEligible, true);
  assert.match(r.builderMeshProjection.recommendedBuilderReason, /fallback implementation specialist/i);
});

test('Builder Mesh V1 unknown task recommends hold/operator clarification', () => {
  const r = deriveOperatorReliefProjection({ supportSnapshot: { builderMeshTaskKind: 'unknown', localAiConnected: true } });
  assert.equal(r.builderMeshProjection.taskKind, 'unknown');
  assert.equal(r.builderMeshProjection.recommendedBuilder, 'hold');
  assert.match(r.builderMeshProjection.recommendedBuilderReason, /operator clarification/i);
});

test('Packet Bay V1 projection returns empty clean state when no packet sources exist', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const bay = derivePacketBayProjection({});
  assert.equal(bay.packetBayStatus, 'empty-clean');
  assert.equal(bay.counts.inbox, 0);
  assert.equal(bay.counts.outbox, 0);
  assert.equal(bay.mutationAllowed, false);
  assert.equal(bay.openClawMutationLocked, true);
});

test('Packet Bay V1 Builder Mesh local-ai verification recommendation creates a local-ai outbox packet', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const bay = derivePacketBayProjection({
    builderMeshProjection: {
      recommendedBuilder: 'local-ai',
      recommendedBuilderReason: 'Builder Mesh recommends local-ai read-only verification.',
      copyablePacketAvailable: true,
      taskKind: 'verification',
      requiredProof: ['support snapshot'],
      missingProof: ['browser proof'],
      nextBestAction: 'Copy Local AI Review Packet and keep it read-only.',
    },
  });
  assert.equal(bay.counts.outbox, 1);
  assert.equal(bay.outbox[0].target, 'local-ai');
  assert.equal(bay.outbox[0].status, 'ready-to-copy');
  assert.match(bay.outbox[0].copyText, /Local AI read-only verification/);
});

test('Packet Bay V1 OpenClaw Source Pack needs-output creates source-pack operator next-action packet', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const bay = derivePacketBayProjection({
    builderMeshProjection: {
      recommendedBuilder: 'hold',
      builderWorkbenchProjection: { openClawSourcePackRunner: { sourcePackStatus: 'needs-output', nextOperatorAction: 'Paste output and judge.' } },
    },
  });
  assert.equal(bay.counts.inbox, 1);
  assert.equal(bay.inbox[0].target, 'operator');
  assert.equal(bay.inbox[0].kind, 'source-pack');
  assert.equal(bay.inbox[0].mutationAllowed, false);
});

test('Packet Bay V1 keeps OpenClaw mutation locked and Codex copyable without auto-dispatch', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const bay = derivePacketBayProjection({
    builderMeshProjection: {
      recommendedBuilder: 'codex',
      copyablePacketAvailable: true,
      taskKind: 'implementation',
      codexReason: 'Codex fallback after operator approval.',
      requiredProof: ['npm run stephanos:verify'],
    },
  });
  assert.equal(bay.openClawMutationLocked, true);
  assert.equal(bay.mutationAllowed, false);
  assert.equal(bay.codexAutoDispatchAllowed, false);
  assert.equal(bay.outbox[0].target, 'codex');
  assert.equal(bay.outbox[0].autoDispatchAllowed, false);
  assert.match(bay.outbox[0].copyText, /Auto-dispatch: forbidden/);
});

test('Packet Bay V1 packet IDs are stable and copy text has no placeholder leakage', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const input = { builderMeshProjection: { recommendedBuilder: 'local-ai', copyablePacketAvailable: true, taskKind: 'proof', recommendedBuilderReason: 'same truth' } };
  const first = derivePacketBayProjection(input);
  const second = derivePacketBayProjection(input);
  assert.equal(first.outbox[0].id, second.outbox[0].id);
  assert.doesNotMatch(first.outbox[0].copyText, /<your answer>|placeholder|TODO_PLACEHOLDER/i);
});

test('Packet Bay V1 OpenClaw recommendation creates read-only openclaw outbox packet with mutation locked', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const bay = derivePacketBayProjection({
    builderMeshProjection: {
      recommendedBuilder: 'openclaw',
      recommendedBuilderReason: 'Clean bounded Source Pack proof allows read-only research/intake only.',
      copyablePacketAvailable: true,
      taskKind: 'research',
      requiredProof: ['source-pack-runner-judged'],
      builderWorkbenchProjection: { activePacketTarget: 'openclaw', activePacketType: 'openclaw-source-pack-runner' },
    },
  });
  assert.equal(bay.counts.outbox, 1);
  assert.equal(bay.outbox[0].target, 'openclaw');
  assert.equal(bay.outbox[0].kind, 'source-pack');
  assert.equal(bay.outbox[0].status, 'awaiting-result');
  assert.equal(bay.outbox[0].mutationAllowed, false);
  assert.match(bay.outbox[0].copyText, /Mutation authority|mutationAuthority/);
});

test('Packet Bay V1 operator recommendation creates inbox approval review packet', async () => {
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const bay = derivePacketBayProjection({
    builderMeshProjection: {
      recommendedBuilder: 'operator',
      recommendedBuilderReason: 'High-risk work requires operator approval.',
      copyablePacketAvailable: true,
      missingProof: ['operator approval'],
    },
  });
  assert.equal(bay.counts.inbox, 1);
  assert.equal(bay.inbox[0].target, 'operator');
  assert.equal(bay.inbox[0].status, 'draft');
  assert.equal(bay.inbox[0].approvalRequired, true);
  assert.equal(bay.inbox[0].mutationAllowed, false);
});

test('Agent Reality Loop V1 empty truth holds unavailable with mutation locked', () => {
  const r = buildAgentRealityLoopProjection({});
  assert.equal(r.status, 'unavailable');
  assert.equal(r.recommendedLead, 'hold');
  assert.equal(r.mutationAllowed, false);
  assert.equal(r.openClawMutationLocked, true);
  assert.equal(r.codexAutoDispatchAllowed, false);
});

test('Agent Reality Loop V1 recommends local-ai from ready Packet Bay truth', () => {
  const r = buildAgentRealityLoopProjection({
    packetBayProjection: {
      packets: [{ id: 'packet-local', target: 'local-ai', kind: 'proof', status: 'ready-to-copy', copyText: 'copy me', reason: 'local-ai packet ready', nextAction: 'Copy Local AI packet.' }],
      sourceTruths: ['Packet Bay projection'],
    },
    builderMeshProjection: { recommendedBuilder: 'local-ai' },
  });
  assert.equal(r.status, 'ready');
  assert.equal(r.recommendedLead, 'local-ai');
  assert.equal(r.nextPacketTarget, 'local-ai');
  assert.equal(r.copyPacketsAvailable, true);
});

test('Agent Reality Loop V1 recommends OpenClaw read-only and locked from ready OpenClaw packet', () => {
  const r = buildAgentRealityLoopProjection({
    packetBayProjection: {
      packets: [{ id: 'packet-openclaw', target: 'openclaw', kind: 'source-pack', status: 'ready-to-copy', copyText: 'copy openclaw', reason: 'openclaw packet ready', nextAction: 'Copy OpenClaw packet.' }],
      sourceTruths: ['Packet Bay projection'],
    },
    builderMeshProjection: { recommendedBuilder: 'openclaw' },
  });
  assert.equal(r.recommendedLead, 'openclaw');
  assert.equal(r.openClawMutationLocked, true);
  assert.equal(r.mutationAllowed, false);
});

test('Agent Reality Loop V1 keeps Codex copyable only and auto-dispatch false', () => {
  const r = buildAgentRealityLoopProjection({
    packetBayProjection: {
      packets: [{ id: 'packet-codex', target: 'codex', kind: 'repair', status: 'ready-to-copy', copyText: 'copy codex', reason: 'codex fallback packet ready', nextAction: 'Copy Codex packet.' }],
      sourceTruths: ['Packet Bay projection'],
    },
    builderMeshProjection: { recommendedBuilder: 'codex' },
  });
  assert.equal(r.recommendedLead, 'codex');
  assert.equal(r.codexAutoDispatchAllowed, false);
  assert.equal(r.mutationAllowed, false);
});

test('Agent Reality Loop V1 awaiting Packet Bay result produces awaiting-result status', () => {
  const r = buildAgentRealityLoopProjection({
    packetBayProjection: {
      packets: [{ id: 'packet-awaiting', target: 'local-ai', kind: 'proof', status: 'awaiting-result', reason: 'result pending' }],
      sourceTruths: ['Packet Bay projection'],
    },
  });
  assert.equal(r.status, 'awaiting-result');
  assert.equal(r.awaitingResultFrom, 'local-ai');
  assert.equal(r.expectedResultKind, 'proof');
});

test('Agent Reality Loop V1 Source Pack needs-output plus collapsed Mission Console blocks with mount action', () => {
  const r = buildAgentRealityLoopProjection({
    openClawSourcePackRunner: { sourcePackStatus: 'needs-output' },
    missionConsoleTruth: { missionConsoleCollapsed: true },
    builderMeshProjection: { recommendedBuilder: 'openclaw' },
  });
  assert.equal(r.status, 'blocked');
  assert.match(r.nextAction, /Expand Agent Mission Console \/ mount Source Pack Runner/);
});

test('Agent Reality Loop V1 dirty OpenClaw workspace blocks and keeps mutation locked', () => {
  const r = buildAgentRealityLoopProjection({
    openClawWorkspaceHygiene: { workspaceDirtDetected: 'yes', workspaceBlocksIgnition: 'yes', workspaceDirtCount: 1, workspaceNextOperatorAction: 'Housekeep OpenClaw dirt.' },
    builderMeshProjection: { recommendedBuilder: 'openclaw' },
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.openClawMutationLocked, true);
  assert.equal(r.mutationAllowed, false);
});

test('Agent Reality Loop V1 UI Reality not OK blocks on browser proof', () => {
  const r = buildAgentRealityLoopProjection({
    uiRealityTruth: { status: 'BROKEN' },
    builderMeshProjection: { recommendedBuilder: 'local-ai' },
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.missingProof.includes('browser/UI proof'), true);
});

test('Project Awareness derives degraded mission from Packet Bay, ARL, and Builder Mesh when no active mission storage exists', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: { uiRealityStatus: 'OK' },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: true, verifyRun: true } } },
  });
  assert.notEqual(r.projectAwarenessProjection.status, 'unavailable');
  assert.equal(r.projectAwarenessProjection.missionId, 'derived-runtime-mission');
  assert.equal(r.projectAwarenessProjection.rehydrationSource, 'derived-runtime-packet-truth');
  assert.match(r.projectAwarenessProjection.title, /Stephanos Mission Stack Verification|Mission/);
  assert.equal(r.projectAwarenessProjection.durableWriteAllowed, false);
});

test('Project Awareness local-ai proof packet sets verification phase and recommends local-ai read-only review', () => {
  const r = buildProjectAwarenessProjection({
    packetBayProjection: { packets: [{ id: 'p1', target: 'local-ai', kind: 'proof', status: 'ready-to-copy', copyText: 'proof' }] },
    builderMeshProjection: { recommendedBuilder: 'local-ai', recommendedBuilderReason: 'Builder Mesh recommends local-ai read-only verification/review.', nextBestAction: 'Copy local-ai proof packet.' },
    agentRealityLoopProjection: { projectionSource: 'agent-reality-loop-v1-runtime-truth-projection' },
    supportSnapshot: { uiRealityStatus: 'OK' },
  });
  assert.equal(r.phase, 'verification');
  assert.equal(r.recommendedRoute, 'local-ai');
  assert.match(r.recommendedRouteReason, /local-ai read-only verification\/review/);
});

test('Project Awareness surfaces ARL missing proof and never emits merge-ready wording while verification is pending', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: { uiRealityStatus: 'OK' },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: false, verifyRun: false } } },
  });
  assert.ok(r.projectAwarenessProjection.missingProof.length > 0);
  assert.match(r.projectAwarenessProjection.nextBestAction, /Resolve proof blockers|Review Project Awareness|proof/i);
  assert.doesNotMatch(`${r.projectAwarenessProjection.nextBestAction} ${r.projectAwarenessProjection.recommendedRouteReason}`, /merge-ready/i);
});

test('Project Awareness blocks on dirty OpenClaw workspace and UI Reality failures', () => {
  const dirty = buildProjectAwarenessProjection({
    packetBayProjection: { packetBayStatus: 'active' },
    openClawWorkspaceHygiene: { workspaceDirtDetected: 'yes', workspaceDirtCount: 2, workspaceBlocksIgnition: 'yes' },
    supportSnapshot: { uiRealityStatus: 'OK' },
  });
  assert.equal(dirty.status, 'blocked');
  assert.match(dirty.nextBestAction, /Housekeep OpenClaw workspace/);
  const uiFail = buildProjectAwarenessProjection({ packetBayProjection: { packetBayStatus: 'active' }, uiRealityTruth: { status: 'FAIL' } });
  assert.equal(uiFail.status, 'blocked');
  assert.ok(uiFail.missingProof.includes('browser/UI proof'));
});

test('Project Awareness prompt block is bounded, source-backed, and weak truth is not injectable', () => {
  const r = deriveOperatorReliefProjection({ supportSnapshot: { uiRealityStatus: 'OK' } });
  assert.equal(r.projectAwarenessProjection.promptInjectable, true);
  assert.ok(r.projectAwarenessProjection.promptBlock.length > 0 && r.projectAwarenessProjection.promptBlock.length <= 1400);
  assert.doesNotMatch(r.projectAwarenessProjection.promptBlock, /Support Snapshot proof:/i);
  const weak = buildAgentRealityLoopProjection({});
  assert.equal(weak.projectAwarenessContextInjected, 'no');
});

test('Agent Reality Loop receives Project Awareness context source when projection exists', () => {
  const r = deriveOperatorReliefProjection({ supportSnapshot: { uiRealityStatus: 'OK' } });
  assert.equal(r.agentRealityLoopProjection.projectAwarenessContextInjected, 'yes');
  assert.equal(r.agentRealityLoopProjection.supportSnapshotFields.agent_reality_loop_context_injected, 'yes');
  assert.notEqual(r.agentRealityLoopProjection.supportSnapshotFields.agent_reality_loop_context_source, 'none');
});

test('Operator Relief projection includes Mission Evidence Ledger from live Project Awareness, ARL, Packet Bay, and Builder Mesh truth', () => {
  const r = deriveOperatorReliefProjection({
    supportSnapshot: {
      uiRealityStatus: 'OK',
      builderMeshTaskKind: 'read-only',
      localAiConnected: true,
    },
    proofOfDoneModel: { verificationJudge: { parsed: { buildRun: false, verifyRun: false } } },
  });
  assert.ok(r.missionEvidenceLedgerProjection);
  assert.notEqual(r.missionEvidenceLedgerProjection.status, 'unavailable');
  assert.equal(r.missionEvidenceLedgerProjection.missionId, 'derived-runtime-mission');
  assert.equal(r.missionEvidenceLedgerProjection.missionPhase, 'verification');
  assert.ok(r.missionEvidenceLedgerProjection.entryCount > 0);
  assert.equal(r.missionEvidenceLedgerProjection.projectionSource, 'mission-evidence-ledger-v1a-runtime-truth-projection');
  assert.equal(r.missionEvidenceLedgerProjection.durableWriteAllowed, false);
  assert.equal(r.missionEvidenceLedgerProjection.mutationAllowed, false);
  assert.equal(r.missionEvidenceLedgerProjection.openClawMutationLocked, true);
  assert.equal(r.missionEvidenceLedgerProjection.codexAutoDispatchAllowed, false);
});

test('Mission Evidence Context V1B derives compact bounded summary from V1A ledger and preserves safety locks', async () => {
  const { deriveMissionEvidenceLedgerProjection, deriveMissionEvidenceContextSummary } = await import('../stephanos-ui/src/state/missionEvidenceLedgerModel.js');
  const ledger = deriveMissionEvidenceLedgerProjection({
    projectAwarenessProjection: { status: 'blocked', missionId: 'derived-runtime-mission', phase: 'verification', blockers: ['proof missing'] },
    builderMeshProjection: { recommendedBuilder: 'local-ai' },
    missionVerification: {},
    prEvidence: { status: 'disabled' },
  });
  const summary = deriveMissionEvidenceContextSummary(ledger);
  assert.equal(summary.available, true);
  assert.equal(summary.nextRequiredEvidence, ledger.nextRequiredEvidence);
  assert.equal(summary.trustedForMerge, false);
  assert.equal(summary.trustedForCanon, false);
  assert.equal(summary.mutationAllowed, false);
  assert.equal(summary.openClawMutationLocked, true);
  assert.equal(summary.codexAutoDispatchAllowed, false);
  assert.ok(summary.promptBlockLength <= 1200);
  assert.doesNotMatch(summary.promptBlock, /Support Snapshot|\{\s*"|merge-ready|canon-ready/);
  assert.match(summary.promptBlock, /mutation remains disabled/i);
});

test('Mission Evidence Context V1B feeds Project Awareness and Agent Reality Loop summaries', async () => {
  const { deriveMissionEvidenceLedgerProjection, deriveMissionEvidenceContextSummary } = await import('../stephanos-ui/src/state/missionEvidenceLedgerModel.js');
  const { buildProjectAwarenessProjection } = await import('../stephanos-ui/src/state/projectAwarenessProjection.js');
  const ledger = deriveMissionEvidenceLedgerProjection({ builderMeshProjection: { recommendedBuilder: 'local-ai' }, missionVerification: {}, prEvidence: { status: 'disabled' } });
  const evidence = deriveMissionEvidenceContextSummary(ledger);
  const pa = buildProjectAwarenessProjection({ builderMeshProjection: { recommendedBuilder: 'local-ai' }, packetBayProjection: { packets: [] }, missionEvidenceContextSummary: evidence });
  assert.equal(pa.evidenceCompleteness, evidence.completeness);
  assert.equal(pa.evidenceNextRequired, evidence.nextRequiredEvidence);
  assert.match(pa.evidenceMissingProofSummary, /missing-build-proof|local-ai-route-proof-needed/);
  const { buildAgentRealityLoopProjection } = await import('../stephanos-ui/src/state/operatorReliefProjection.js');
  const arl = buildAgentRealityLoopProjection({ packetBayProjection: { packets: [] }, builderMeshProjection: { recommendedBuilder: 'local-ai' }, missionEvidenceContextSummary: evidence });
  assert.equal(arl.evidenceContextSource, evidence.source);
  assert.equal(arl.evidenceNextRequired, evidence.nextRequiredEvidence);
  assert.equal(arl.mutationAllowed, false);
  assert.equal(arl.openClawMutationLocked, true);
  assert.equal(arl.codexAutoDispatchAllowed, false);
});

test('Packet Bay V1B creates deterministic evidence handoff packets without regressing existing packet IDs', async () => {
  const { deriveMissionEvidenceLedgerProjection, deriveMissionEvidenceContextSummary } = await import('../stephanos-ui/src/state/missionEvidenceLedgerModel.js');
  const { derivePacketBayProjection } = await import('../stephanos-ui/src/state/packetBayProjection.js');
  const ledger = deriveMissionEvidenceLedgerProjection({ builderMeshProjection: { recommendedBuilder: 'local-ai' }, missionVerification: {}, prEvidence: { status: 'disabled' } });
  const evidence = deriveMissionEvidenceContextSummary(ledger);
  const bay = derivePacketBayProjection({ builderMeshProjection: { recommendedBuilder: 'local-ai', copyablePacketAvailable: true }, missionEvidenceContextSummary: evidence });
  const ids = bay.packets.map((packet) => packet.id);
  assert.ok(ids.includes('packet-evidence-review-local-ai-proof-v1b'));
  assert.ok(ids.includes('packet-browser-proof-checklist-operator-v1b'));
  assert.ok(ids.includes('packet-pr-evidence-collection-v1b'));
  assert.ok(ids.some((id) => id.startsWith('packet-outbox-local-ai-proof-builder-mesh-local-ai-recommendation')));
  assert.equal(bay.evidencePacketCount, 3);
  assert.equal(bay.mutationAllowed, false);
  assert.equal(bay.openClawMutationLocked, true);
  assert.equal(bay.codexAutoDispatchAllowed, false);
});
