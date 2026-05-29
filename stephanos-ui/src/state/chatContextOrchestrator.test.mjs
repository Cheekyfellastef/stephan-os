import test from 'node:test';
import assert from 'node:assert/strict';
import { INTENT_RULES, buildChatContextPack, normalizeIntentInputForMatching } from './chatContextOrchestrator.js';

test('buildChatContextPack returns compact structured context', () => {
  const pack = buildChatContextPack({ operatorMessage: 'this pane is broken', uiRealityStatus: { severity: 'FAIL' }, routeTruth: { routeKind: 'cloud', routeUsableState: 'yes', executedProvider: 'groq' } });
  assert.equal(pack.version, 'v1');
  assert.equal(pack.recommendedResponseMode, 'diagnosis');
  assert.ok(Array.isArray(pack.relevantCanon));
  assert.ok(pack.warnings.some((w) => w.includes('UI Reality FAIL')));
});

test('intent mapping: merge decision and codex prompt', () => {
  assert.equal(buildChatContextPack({ operatorMessage: 'do I merge this' }).recommendedResponseMode, 'merge-decision');
  assert.equal(buildChatContextPack({ operatorMessage: 'give me a Codex prompt' }).recommendedResponseMode, 'codex-prompt');
});


test('live classify/build path maps exact normalized merge prompt to merge-decision', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.equal(pack.intentClassifierMatchedRule, 'merge-decision');
  assert.equal(pack.classifierDebug.classifierFallbackApplied, 'no');
  assert.ok(pack.compactSummary.relevantCanonCount > 0);
  assert.ok(Array.isArray(pack.affectedSubsystems) && pack.affectedSubsystems.length > 0);
});

test('merge rule test returns true for do i merge this pr', () => {
  const normalizedInput = normalizeIntentInputForMatching('do I merge this PR?');
  assert.equal(normalizedInput, 'do i merge this pr');
  const pack = buildChatContextPack({ operatorMessage: normalizedInput });
  assert.equal(pack.classifierDebug.classifierMatchInput, 'do i merge this pr');
  assert.equal(pack.classifierDebug.classifierMergeRuleTestResult, 'yes');
  assert.equal(pack.classifierDebug.classifierFirstMatchingRule, 'merge-decision');
  assert.equal(pack.matchInput, 'do i merge this pr');
  assert.equal(pack.mergeRuleTestResult, 'yes');
  assert.equal(pack.firstMatchingRule, 'merge-decision');
  assert.ok(pack.evaluatedRuleResults.includes('merge-decision:1'));
});

test('UI tasks include source/dist canon', () => {
  const pack = buildChatContextPack({ operatorMessage: 'this UI pane is broken' });
  const canonText = pack.relevantCanon.map((entry) => entry.text).join(' | ');
  assert.match(canonText, /dist is never source of truth/);
});


test('merge-decision pack includes merge canon and non-direct next action', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  const canonText = pack.relevantCanon.map((entry) => entry.text).join(' | ');
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.match(canonText, /do not merge when checks\/build\/verify fail/);
  assert.match(canonText, /prefer amendment to existing PR when PR is still open/);
  assert.match(canonText, /do not treat terminal-only UI checks as complete/);
  assert.match(pack.recommendedNextAction, /merge|proof|PR/i);
});


test('merge-decision classifier catches common merge question variants', () => {
  const a = buildChatContextPack({ operatorMessage: 'do I merge this PR?' });
  const b = buildChatContextPack({ operatorMessage: 'should I merge this' });
  const c = buildChatContextPack({ operatorMessage: 'can I merge this PR' });
  const d = buildChatContextPack({ operatorMessage: 'merge this one?' });
  const e = buildChatContextPack({ operatorMessage: 'do I merge this one?' });
  const f = buildChatContextPack({ operatorMessage: 'merge this pr' });
  const g = buildChatContextPack({ operatorMessage: 'do i merge this pr' });

  for (const pack of [a, b, c, d, e, f, g]) {
    assert.equal(pack.compactSummary.status, 'active');
    assert.equal(pack.recommendedResponseMode, 'merge-decision');
    assert.equal(pack.intentClassifierMatchedRule, 'merge-decision');
    assert.ok(pack.compactSummary.relevantCanonCount > 0);
    assert.equal(pack.classifierDebug.classifierFallbackApplied, 'no');
    assert.ok(pack.affectedSubsystems.length > 0);
    assert.match(pack.recommendedNextAction, /merge|proof|check/i);
  }
});


test('buildChatContextPack keeps prEvidence provider summary with parsed PR number context', () => {
  const pack = buildChatContextPack({
    operatorMessage: 'do i merge PR 123',
    githubPrEvidence: { status: 'needs-connector', prNumber: 123, parsedPrNumber: 123, mergeReadiness: 'wait' },
  });
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.match(String(pack.providerSummaries.prEvidence.prNumber), /123|unknown/);
  assert.match(String(pack.providerSummaries.prEvidence.parsedPrNumber), /123|unknown/);
  assert.match(String(pack.providerSummaries.prEvidence.status), /needs-connector|evidence-unavailable/);
});


test('buildChatContextPack uses retrieval_query as PR evidence parse input when operatorPrompt absent', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this', retrieval_query: 'do i merge PR 123' });
  assert.match(String(pack.providerSummaries.prEvidence.prNumber), /123|unknown/);
  assert.match(String(pack.providerSummaries.prEvidence.parsedPrNumber), /123|unknown/);
  assert.match(String(pack.providerSummaries.prEvidence.status), /needs-connector|evidence-unavailable/);
});
test('missing PR evidence does not downgrade merge-decision and keeps canon/subsystems', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do I merge this PR?', supportSnapshot: {} });
  assert.equal(pack.recommendedResponseMode, 'merge-decision');
  assert.equal(pack.intentClassifierMatchedRule, 'merge-decision');
  assert.ok(pack.relevantCanon.length > 0);
  assert.ok(pack.affectedSubsystems.includes('merge'));
  assert.ok(pack.affectedSubsystems.includes('pr'));
});

test('direct-answer remains fallback for generic prompts', () => {
  const pack = buildChatContextPack({ operatorMessage: 'hello there' });
  assert.equal(pack.recommendedResponseMode, 'direct-answer');
  assert.equal(pack.intentClassifierMatchedRule, 'direct-answer');
  assert.equal(pack.classifierDebug.classifierFirstMatchingRule, 'direct-answer');
  assert.equal(pack.classifierDebug.classifierMergeRuleTestResult, 'no');
});

test('mission-state questions route to mission-planning with mission intelligence context', () => {
  const pack = buildChatContextPack({
    operatorMessage: 'What is the current main mission and what is the next best action?',
    missionState: {
      mode: 'active',
      operatorReliefProjection: {
        missionIntelligenceSummary: {
          currentMissionSummary: 'Reduce operator complexity while keeping main-first/main-only.',
          nextBestAction: 'Bridge Mission Brain context into Command Deck response planner.',
          codexReady: 'yes',
          openClawReady: 'pending',
        },
      },
    },
  });
  assert.equal(pack.recommendedResponseMode, 'mission-planning');
  assert.equal(pack.intentClassifierMatchedRule, 'mission-planning');
  assert.equal(pack.classifierDebug.classifierFirstMatchingRule, 'mission-planning');
  assert.ok(pack.compactSummary.contextSourcesUsed.includes('missionIntelligence'));
  assert.equal(pack.compactSummary.missionIntelligence.missionSummary, 'Reduce operator complexity while keeping main-first/main-only.');
  assert.equal(pack.compactSummary.missionIntelligence.nextBestAction, 'Bridge Mission Brain context into Command Deck response planner.');
  assert.ok(pack.compactSummary.contextSourcesUsed.includes('projectAwareness'));
  assert.equal(pack.compactSummary.projectAwareness.operatorWorkflowPreference.includes('main-first/main-only'), true);
  assert.match(pack.compactSummary.projectAwareness.status, /available|degraded/);
  assert.equal(pack.compactSummary.projectAwareness.currentMissionSummary.includes('Reduce operator complexity'), true);
  for (const id of ['missionState', 'proofState', 'canonRules']) {
    assert.ok(pack.contextProviderIdsUsed.includes(id));
  }
});

test('codex/openclaw routing prompts classify as work-routing and include co-builder context', () => {
  const prompts = [
    'Can Codex and OpenClaw help with the next task, and who should do what?',
    'Who should do the next task?',
    'Should Codex or OpenClaw handle this?',
    'What packet should I copy next?',
    'Can OpenClaw help with this?',
    'Can Codex help with this?',
    'What should the next round be?',
    'How do I avoid becoming the click monkey again?',
  ];
  const missionState = {
    mode: 'active',
    operatorReliefProjection: {
      missionIntelligenceSummary: { currentMissionSummary: 'Route correctly.', nextBestAction: 'Use Co-Builder packets.' },
      agentWorkRoutingProjection: { openClawExecutionReady: 'no', operatorApprovalRequired: 'yes', openClawResearchReady: 'yes', codexReady: 'yes' },
      coBuilderLoopProjection: { openClawResearchPacketAvailable: 'yes', codexPacketAvailable: 'yes', verificationPacketAvailable: 'yes', repairPacketAvailable: 'no' },
    },
  };
  for (const operatorMessage of prompts) {
    const pack = buildChatContextPack({ operatorMessage, missionState });
    assert.equal(pack.recommendedResponseMode, 'work-routing');
    assert.ok(['work-routing', 'builder-mesh-routing'].includes(pack.intentClassifierMatchedRule));
    assert.ok(pack.compactSummary.contextSourcesUsed.includes('coBuilderLoop'));
    assert.ok(pack.compactSummary.contextSourcesUsed.includes('agentWorkRouting'));
    assert.equal(pack.compactSummary.missionIntelligence.agentWorkRouting.openClawExecutionReady, 'no');
    assert.equal(pack.compactSummary.missionIntelligence.agentWorkRouting.operatorApprovalRequired, 'yes');
    assert.equal(pack.compactSummary.missionIntelligence.coBuilderLoop.packetAvailability.openClawResearch, 'yes');
    assert.equal(pack.compactSummary.missionIntelligence.coBuilderLoop.packetAvailability.codexImplementation, 'yes');
  }
});

test('agent reality loop prompts classify as mission-planning and inject ARL projection', () => {
  const pack = buildChatContextPack({
    operatorMessage: 'tell me about the agent reality loop',
    missionState: {
      operatorReliefProjection: {
        agentRealityLoopProjection: { loopStatus: 'active', recommendedLead: 'codex' },
      },
    },
  });
  assert.equal(pack.recommendedResponseMode, 'mission-planning');
  assert.equal(pack.intentClassifierMatchedRule, 'agent-reality-loop');
  assert.ok(pack.affectedSubsystems.includes('operator-relief'));
  assert.ok(pack.contextProviderIdsUsed.includes('missionState'));
  assert.match(pack.recommendedNextAction, /Agent Reality Loop V1 projection/i);
  assert.equal(pack.compactSummary.projectAwareness.agentRealityLoopProjectionStatus, 'active');
  assert.equal(pack.compactSummary.agentRealityLoopContextInjected, 'yes');
  assert.equal(pack.compactSummary.agentRealityLoopProjectionSource, 'operator-relief-bridge');
  assert.equal(pack.compactSummary.missionIntelligence.agentRealityLoop.projectionAvailable, 'yes');
});

test('project awareness keeps agent reality loop projection available from canonical projection status field', () => {
  const pack = buildChatContextPack({
    operatorMessage: 'tell me about the agent reality loop',
    missionState: {
      operatorReliefProjection: {
        agentRealityLoopProjection: { status: 'active', recommendedLead: 'codex' },
      },
    },
  });
  assert.equal(pack.compactSummary.projectAwareness.agentRealityLoopProjectionStatus, 'active');
  assert.equal(pack.compactSummary.agentRealityLoopContextInjected, 'yes');
  assert.equal(pack.compactSummary.agentRealityLoopProjectionSource, 'operator-relief-bridge');
  assert.equal(pack.compactSummary.missionIntelligence.agentRealityLoop.projectionAvailable, 'yes');
});

test('project awareness degrades truthfully when mission intelligence is missing', () => {
  const pack = buildChatContextPack({ operatorMessage: 'what is the current main mission?', missionState: { mode: 'active' } });
  assert.equal(pack.compactSummary.projectAwareness.status, 'degraded');
  assert.equal(pack.compactSummary.projectAwareness.currentMissionSummary, 'unknown');
});


test('buildChatContextPack emits canonical classifierProof for do i merge this pr', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this pr' });
  assert.equal(pack.classifierProof.matchInput, 'do i merge this pr');
  assert.match(pack.classifierProof.mergeRulePattern, /contains: merge/);
  assert.equal(pack.classifierProof.mergeRuleTestResult, 'yes');
  assert.equal(pack.classifierProof.firstMatchingRule, 'merge-decision');
  assert.ok(pack.classifierProof.evaluatedRuleResults.includes('merge-decision:1'));
  assert.equal(pack.classifierProof.intentClassifierMatchedRule, 'merge-decision');
  assert.equal(pack.classifierProof.responseMode, 'merge-decision');
  assert.equal(pack.classifierProof.defaultPackUsed, 'no');
});


test('merge-decision uses required context providers and stays compact', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this pr' });
  assert.equal(pack.contextProviderRegistryStatus, 'active');
  assert.ok(Array.isArray(pack.contextProviderIdsRegistered));
  for (const id of ['uiReality', 'proofState', 'prEvidence', 'canonRules', 'runtimeTruth', 'providerTruth', 'missionState']) {
    assert.ok(pack.contextProviderIdsUsed.includes(id));
  }
  assert.ok(pack.contextProviderCanonLinksCount > 0);
  assert.ok(pack.relevantCanon.length > 0);
  assert.equal(typeof pack.providerSummaries, 'object');
  assert.equal(pack.providerSummaries.rawSupportSnapshot, undefined);
});

test('buildChatContextPack do i merge this pr emits registered and used provider IDs', () => {
  const pack = buildChatContextPack({ operatorMessage: 'do i merge this pr' });
  assert.deepEqual(
    pack.contextProviderIdsRegistered,
    ['uiReality', 'runtimeTruth', 'providerTruth', 'missionState', 'proofState', 'prEvidence', 'canonRules', 'memoryContinuity', 'operatorProfile', 'conversationContinuity', 'agentState'],
  );
  assert.deepEqual(
    pack.contextProviderIdsUsed,
    ['uiReality', 'runtimeTruth', 'providerTruth', 'missionState', 'proofState', 'prEvidence', 'canonRules', 'memoryContinuity', 'operatorProfile', 'conversationContinuity', 'agentState'],
  );
});


test('operator profile is included in context providers and prompt context', () => {
  const pack = buildChatContextPack({ operatorMessage: 'hello', operatorProfile: { known: true, operatorName: 'Stephan', confidence: 'high', source: 'operator explicit statement' } });
  assert.ok(pack.contextProviderIdsUsed.includes('operatorProfile'));
  assert.equal(pack.operatorProfile.operatorName, 'Stephan');
});

test('identity recall prompt maps to identity-recall and carries compact operator line', () => {
  const pack = buildChatContextPack({ operatorMessage: 'can you remember my name?', operatorProfile: { known: true, operatorName: 'Stephan' } });
  assert.equal(pack.recommendedResponseMode, 'identity-recall');
  assert.match(pack.contextForPrompt.operatorProfileLine, /name is Stephan/i);
});


test('codex dispatch phrases map to codex-dispatch or codex-prompt', () => {
  assert.equal(buildChatContextPack({ operatorMessage: 'get Codex to fix this' }).recommendedResponseMode, 'codex-dispatch');
  assert.equal(buildChatContextPack({ operatorMessage: 'ask Codex to build the next step' }).recommendedResponseMode, 'codex-dispatch');
  assert.equal(buildChatContextPack({ operatorMessage: 'have Codex repair the failing PR' }).recommendedResponseMode, 'codex-dispatch');
  assert.equal(buildChatContextPack({ operatorMessage: 'give me a Codex prompt' }).recommendedResponseMode, 'codex-prompt');
});

test('Builder Mesh routing prompts use Builder Mesh context from Operator Relief', () => {
  const prompts = [
    'Can we keep building without using metered Codex?',
    'What builder should take the next task?',
    'Can my local AIs do this?',
    'How do we avoid using Codex?',
    'What is the Zero-Cost Builder Workbench status?',
  ];
  const missionState = {
    mode: 'active',
    operatorReliefProjection: {
      missionIntelligenceSummary: { currentMissionSummary: 'Route build work away from metered Codex.', nextBestAction: 'Use Builder Mesh.' },
      builderMeshProjection: {
        builderMeshStatus: 'ready-read-only',
        recommendedBuilder: 'local-ai',
        zeroCostRouteAvailable: true,
        codexRequired: false,
        codexReason: 'Codex is fallback only.',
        localAiCanHelp: 'yes-read-only-review',
        openClawCanHelp: 'yes-read-only-research-and-patch-planning',
        githubCanHelp: 'yes-read-only-pr-diff-status-evidence',
        approvalRequiredBeforeMutation: true,
        proofRequiredBeforeMerge: ['npm run stephanos:verify'],
        nextBestAction: 'Copy the Local AI Review Packet.',
        copyPackets: { localAiReviewPacket: {}, openClawResearchPacket: {}, githubInspectionPacket: {}, codexFallbackPacket: {}, operatorApprovalChecklist: {} },
      },
      agentWorkRoutingProjection: { openClawExecutionReady: 'no', operatorApprovalRequired: 'yes' },
      coBuilderLoopProjection: { openClawResearchPacketAvailable: 'yes', codexPacketAvailable: 'yes' },
    },
  };
  for (const operatorMessage of prompts) {
    const pack = buildChatContextPack({ operatorMessage, missionState });
    assert.equal(pack.recommendedResponseMode, 'work-routing');
    assert.equal(pack.intentClassifierMatchedRule, 'builder-mesh-routing');
    assert.ok(pack.compactSummary.contextSourcesUsed.includes('builderMesh'));
    assert.equal(pack.compactSummary.missionIntelligence.builderMesh.recommendedBuilder, 'local-ai');
    assert.equal(pack.compactSummary.missionIntelligence.builderMesh.zeroCostRouteAvailable, true);
    assert.equal(pack.compactSummary.missionIntelligence.builderMesh.codexRequired, false);
    assert.ok(pack.compactSummary.missionIntelligence.builderMesh.copyPacketNames.includes('operatorApprovalChecklist'));
  }
});
