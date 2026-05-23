import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportSnapshot } from './supportSnapshot.js';
import { processMissionBridgeIntent } from './missionBridge.js';

test('buildSupportSnapshot prefers canonical truth and labels unavailable fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      localAvailable: true,
      homeNodeReachable: false,
      cloudAvailable: true,
      uiVersion: '1.2.3',
      uiBuildTimestamp: '2026-03-25T00:00:00.000Z',
      lastFreshnessNeed: 'high',
      lastAnswerMode: 'fresh-web',
      lastAiPolicyMode: 'local-first-cloud-when-needed',
      lastAiPolicyReason: 'Cloud routing allowed and selected because current real-world truth is required.',
      lastGroqFreshCandidateModel: 'compound-beta-mini',
      lastZeroCostPolicy: 'true',
      lastPaidFreshRoutesEnabled: 'false',
      lastFreshCapabilityMode: 'zero-cost-only',
      lastStaleFallbackAttempted: 'no',
      lastContextAssemblyUsed: 'true',
      lastContextAssemblyMode: 'self-build-elevated',
      lastContextSourcesUsed: 'memory, runtimeTruth, operatorContext',
      lastSelfBuildPromptDetected: 'true',
      lastSelfBuildReason: 'matched:/roadmap/i',
      lastSystemAwarenessLevel: 'elevated-self-build',
      lastAugmentedPromptUsed: 'true',
      lastAugmentedPromptLength: '1320',
      lastContextIntegrityPreserved: 'true',
      lastContextAssemblyWarnings: 'retrieval context is historical/internal and not fresh-world validation',
      lastPlanningActive: 'true',
      lastPlanningMode: 'self-build-mission-synthesis',
      lastPlanningConfidence: 'high',
      lastPlanningMaturityEstimate: 'emerging-orchestration',
      lastRecommendedNextMove: 'Mission synthesis / self-planning layer maturation',
      lastRecommendationReason: 'High-value move with prerequisites currently observed.',
      lastPlanningCandidateMoveCount: '11',
      lastPlanningEvidenceSources: 'memory, runtimeTruth, operatorContext',
      lastPlanningTruthWarnings: 'proposal system signal not observed; proposal bridge moves are inferred priorities',
      lastProposalEligible: 'true',
      lastCodexHandoffEligible: 'true',
      lastProposalPacketActive: 'true',
      lastProposalPacketMode: 'self-build-mission-synthesis',
      lastProposalPacketConfidence: 'high',
      lastProposalPacketTruthPreserved: 'true',
      lastProposedMoveId: 'mission-synthesis-layer',
      lastProposedMoveTitle: 'Mission synthesis / self-planning layer maturation',
      lastProposedMoveRationale: 'High-value move with prerequisites currently observed.',
      lastProposalPacketWarnings: 'proposal system signal not observed; proposal bridge moves are inferred priorities',
      lastCodexHandoffAvailable: 'true',
      lastCodexPromptSummary: 'Codex handoff prepared for move mission-synthesis-layer with proposal-only constraints.',
      lastCodexConstraints: 'Do not auto-execute any command or mutate files without explicit operator request.',
      lastCodexSuccessCriteria: 'Proposal packet truth fields appear in execution metadata and support/status projections.',
      lastProposalOperatorActions: 'Create proposal packet for mission-synthesis-layer.',
      lastOperatorApprovalRequired: 'true',
      lastExecutionEligible: 'false',
      lastMemoryElevationActive: 'true',
      lastMemoryElevationMode: 'self-build-elevated',
      lastMemoryTruthPreserved: 'true',
      lastMemoryCandidatesConsidered: '7',
      lastElevatedMemoryCount: '5',
      lastGraphLinkedMemoryCount: '2',
      lastDeferredGraphLinkCount: '3',
      lastBuildRelevantMemoryCount: '4',
      lastMissionCriticalMemoryCount: '2',
      lastContinuityConfidence: 'high',
      lastContinuityReason: 'Mission-critical continuity memories were elevated with bounded confidence.',
      lastGraphLinkTruthPreserved: 'true',
      lastGraphLinkReason: 'Elevated memories linked to existing graph entities where matches were observed.',
      lastRecurrenceSignals: 'timeout truth drift (x3)',
      lastMemoryElevationWarnings: 'none',
      lastSourceProvenanceSummary: 'durable-memory:evt-1',
      lastTopMemoryInfluencers: 'mission-critical-continuity-memory:operator control:operator-state',
      lastMemoryInformedRecommendation: 'Prioritize mission-critical continuity memory first.',
      memoryCapabilityState: 'degraded-local',
      memoryCapabilityReady: 'yes',
      memoryCapabilityCanonical: 'no',
      memoryCapabilityReason: 'Shared backend memory is unavailable; degraded local mirror remains available.',
      latestMissionId: 'intent-build-mission-console-123',
      missionStatus: 'draft',
      approvalRequired: 'yes',
      generatedPromptAvailable: 'yes',
      verificationStatus: 'pending',
      missionMemoryContextCount: '2',
      missionMemoryInfluenceLevels: 'critical_canon|relevant_lesson',
      missionMemoryConflictCount: '1',
      missionMemoryLessonCandidatePending: 'yes',
      missionMemoryCapabilityGapPending: 'no',
      repoArchitectureAffectedSubsystemCount: '4',
      repoArchitectureAffectedSubsystems: 'mission-console|intent-to-build|support-snapshot|codex-handoff',
      repoArchitectureLikelyTestCount: '2',
      repoArchitectureGeneratedOutputTouched: 'yes',
      repoArchitectureSourceTruthWarning: 'apps/stephanos/dist is generated output, not source truth.',
      repoArchitectureRiskLevel: 'Mission Console:high|codex-handoff:medium',
      missionVerificationJudgment: 'insufficient_evidence',
      missionVerificationReadinessLevel: 'not_ready',
      missionVerificationMergeReadyCandidate: 'no',
      missionVerificationBlockerCount: '1',
      missionVerificationWarningCount: '2',
      missionVerificationProofStatus: 'pending',
      missionVerificationChangedFilesInScope: 'yes',
      missionVerificationRequiredTestsRun: 'no',

      prEvidenceInputDetected: 'yes',
      prEvidenceParseConfidence: 'high',
      prEvidenceParsedPrNumber: '77',
      prEvidenceParsedRepo: 'acme/stephan-os',
      prEvidenceParseWarningCount: '1',
      prEvidenceConnectorSource: 'manual_text_intake',

      taskFinisherPlanStatus: 'ready_for_routine_finish',
      taskFinisherSafeToContinue: 'yes',
      taskFinisherRoutineTaskCount: '4',
      taskFinisherBlockedTaskCount: '9',
      taskFinisherCodexRepairNeeded: 'no',
      taskFinisherRebuildDistNeeded: 'yes',
      taskFinisherMemoryReviewNeeded: 'yes',
      taskFinisherMergeOperatorControlled: 'yes',
      taskFinisherWarningLevel: 'medium',
      taskFinisherNextAction: 'rebuild generated dist and rerun stephanos verify',
      chatContextPackStatus: 'active',
      chatContextResponseMode: 'merge-decision',
      chatContextRelevantCanonCount: '3',
      chatContextAffectedSubsystems: 'ui|route',
      chatContextNextAction: 'Collect proof',
      chatContextWarnings: 'none',

    },
    routeTruthView: {
      routeKind: 'cloud',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      winnerReason: 'cloud route won',
      fallbackActive: false,
      backendReachableState: 'yes',
      uiReachableState: 'yes',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      operatorReason: 'No blocking route invariants detected.',
      fastResponseLaneEligible: true,
      fastResponseLaneActive: true,
      fastResponseLaneReason: 'short-local-private-prompt',
      fastResponseModel: 'llama3.2:3b',
      escalationModel: 'qwen:14b',
      escalationReason: 'fast-lane-not-selected',
    },
    runtimeSessionTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'desktop',
    },
    runtimeRouteTruth: {
      winningReason: 'cloud route won by adjudicator',
    },
    runtimeReachabilityTruth: {
      uiReachableState: 'reachable',
    },
    runtimeProviderTruth: {
      executableProvider: 'groq',
    },
    runtimeDiagnosticsTruth: {
      blockingIssues: [{ code: 'NONE', detail: 'none' }],
      invariantWarnings: [{ code: 'WARN_1', message: 'minor drift detected' }],
    },
    runtimeContext: {
      surfaceAwareness: {
        surfaceIdentity: { deviceClass: 'tablet', osFamily: 'ios', browserFamily: 'safari' },
        surfaceCapabilities: { touchPrimary: true, hoverReliable: false, finePointer: false, webxrAvailable: false },
        sessionContextSurfaceHints: { sessionKind: 'hosted-web' },
        operatorSurfaceOverrides: { mode: 'auto' },
        effectiveSurfaceExperience: {
          selectedProfileId: 'field-tablet',
          selectionReasons: ['auto selection from deviceClass=tablet sessionKind=hosted-web'],
          activeProtocolIds: ['touch-first-input', 'stacked-panels'],
          protocolSelectionReasons: ['embodiment bundle selected for field-tablet'],
          resolvedInputMode: 'touch-hybrid',
          resolvedPanelStrategy: 'stacked-docked',
          resolvedRoutingBiasHint: 'home-node-first',
        },
        recentFrictionEvents: [
          { frictionType: 'panel-dragging', subsystem: 'mission-console', confidence: 0.66 },
        ],
        frictionPatterns: [
          { frictionType: 'panel-dragging', patternStrength: 'emerging', recurrenceCount: 3 },
        ],
        surfaceProtocolRecommendations: [
          { id: 'rec-1', status: 'active' },
        ],
        acceptedSurfaceRules: [
          { id: 'rule-1' },
        ],
      },
      routeCandidates: [
        { candidateKey: 'home-node-tailscale', routeKind: 'home-node', transportKind: 'tailscale', rank: 1, score: 980, usable: true, active: true, reason: 'tailscale route healthy' },
        { candidateKey: 'cloud', routeKind: 'cloud', transportKind: 'internet', rank: 2, score: 780, usable: true, active: false, reason: 'cloud route ready' },
      ],
      routeCandidateWinner: { candidateKey: 'home-node-tailscale', routeKind: 'home-node', transportKind: 'tailscale' },
      routeSelectionSource: 'runtime-truth-adjudication',
      routeAutoSwitchActive: true,
      routeAutoSwitchReason: 'Auto-switched from cloud to home-node based on deterministic route scoring.',
      routeDiagnostics: {
        cloud: { usable: true, reason: 'public route reachable' },
        home: { usable: false, blockedReason: 'home node offline' },
      },
    },
    safeApiStatus: {
      frontendOrigin: 'https://console.stephanos.example',
    },
    statusSummary: {
      healthState: 'healthy',
      healthReason: 'provider online',
      providerCapability: {
        configuredModel: 'openai/gpt-oss-20b',
        configuredModelSupportsFreshWeb: false,
        candidateFreshRouteAvailable: true,
        candidateFreshWebModel: 'compound-beta-mini',
        freshWebPath: '/responses:web_search',
        zeroCostPolicy: true,
        paidFreshRoutesEnabled: false,
        freshCapabilityMode: 'zero-cost-only',
      },
    },
    now: { toISOString: () => '2026-03-25T00:00:01.000Z' },
    href: 'https://console.stephanos.example/status',
    finalAgentView: {
      selectedAgentId: 'research-agent',
      activeAgentIds: ['intent-engine'],
      actingAgentId: 'intent-engine',
      waitingAgentIds: ['research-agent'],
      blockedAgentIds: ['execution-agent'],
      visibleAgents: [
        {
          agentId: 'research-agent',
          state: 'waiting',
          stateReason: 'No current task assigned.',
          blockers: ['waiting for intent classification'],
          dependencies: ['intent-engine', 'provider-routing'],
          adjudicationGates: {
            surfaceGate: { passed: true },
            sessionGate: { passed: true },
            dependencyGate: { passed: true },
            autonomyGate: { passed: true },
            operatorEnableGate: { passed: true },
            masterToggleGate: { passed: true },
            safeModeGate: { passed: true },
            taskIntentGate: { passed: false },
            providerRouteGate: { passed: true },
          },
        },
      ],
    },
  });

  assert.match(snapshot, /Stephanos Support Snapshot/);
  assert.match(snapshot, /Requested Route Mode: auto/);
  assert.match(snapshot, /Surface Device Class: tablet/);
  assert.match(snapshot, /Surface Embodiment Profile: field-tablet/);
  assert.match(snapshot, /Surface Active Protocols: touch-first-input, stacked-panels/);
  assert.match(snapshot, /Task Finisher Plan Status: ready_for_routine_finish/);
  assert.match(snapshot, /Task Finisher Merge Operator Controlled: yes/);
  assert.match(snapshot, /Chat Context Pack Status: active/);
  assert.match(snapshot, /Chat Context Response Mode: merge-decision/);
  assert.match(snapshot, /PR Evidence Parse Confidence: high/);
  assert.match(snapshot, /PR Evidence Parsed Repo: acme\/stephan-os/);
  assert.match(snapshot, /Surface Friction Latest: panel-dragging \(mission-console\) confidence=0.66/);
  assert.match(snapshot, /Surface Friction Pattern Count: 1/);
  assert.match(snapshot, /Surface Friction Pattern Latest: panel-dragging strength=emerging recurrence=3/);
  assert.match(snapshot, /Surface Active Recommendations: 1/);
  assert.match(snapshot, /Surface Accepted Rules: 1/);
  assert.match(snapshot, /Fast Response Lane Active: true/);
  assert.match(snapshot, /Fast Response Model: llama3.2:3b/);
  assert.match(snapshot, /Streaming Requested: false/);
  assert.match(snapshot, /Streaming Mode Preference: auto/);
  assert.match(snapshot, /Streaming Preference Rehydrated: no/);
  assert.match(snapshot, /GitHub PR Evidence Availability: disabled/);
  assert.match(snapshot, /GitHub PR Evidence Truth Status: unknown-disabled/);
  assert.match(snapshot, /Streaming Persistence Source: default\/auto/);
  assert.match(snapshot, /Streaming Request Source: auto-default-off/);
  assert.match(snapshot, /Surface Routing Bias Hint: home-node-first/);
  assert.match(snapshot, /Winning Reason: cloud route won by adjudicator/);
  assert.match(snapshot, /Selected Provider State: healthy/);
  assert.match(snapshot, /Selected Provider Configured Model: openai\/gpt-oss-20b/);
  assert.match(snapshot, /Selected Provider Fresh Candidate Available: true/);
  assert.match(snapshot, /Selected Provider Fresh Candidate Model: compound-beta-mini/);
  assert.match(snapshot, /Zero Cost Policy: true/);
  assert.match(snapshot, /Paid Fresh Routes Enabled: false/);
  assert.match(snapshot, /Fresh Capability Mode: zero-cost-only/);
  assert.match(snapshot, /Last Groq Fresh Candidate Model: compound-beta-mini/);
  assert.match(snapshot, /Memory Capability State: degraded-local/);
  assert.match(snapshot, /Memory Capability Ready: yes/);
  assert.match(snapshot, /Memory Capability Canonical: no/);
  assert.match(snapshot, /Memory Capability Reason: Shared backend memory is unavailable; degraded local mirror remains available\./);
  assert.match(snapshot, /Last Zero Cost Policy: true/);
  assert.match(snapshot, /Last Paid Fresh Routes Enabled: false/);
  assert.match(snapshot, /Last Fresh Capability Mode: zero-cost-only/);
  assert.match(snapshot, /Last Stale Fallback Attempted: no/);
  assert.match(snapshot, /Context Assembly Used: true/);
  assert.match(snapshot, /Context Assembly Mode: self-build-elevated/);
  assert.match(snapshot, /Self-Build Prompt Detected: true/);
  assert.match(snapshot, /System Awareness Level: elevated-self-build/);
  assert.match(snapshot, /System Watcher Persistence: insufficient-evidence/);
  assert.match(snapshot, /System Watcher Temporal Confidence: limited/);
  assert.match(snapshot, /System Watcher Projection Mismatch: none-detected/);
  assert.match(snapshot, /Context Integrity Preserved: true/);
  assert.match(snapshot, /Planning Active: true/);
  assert.match(snapshot, /Planning Mode: self-build-mission-synthesis/);
  assert.match(snapshot, /Planning Confidence: high/);
  assert.match(snapshot, /Recommended Next Move: Mission synthesis \/ self-planning layer maturation/);
  assert.match(snapshot, /Proposal Eligible: true/);
  assert.match(snapshot, /Codex Handoff Eligible: true/);
  assert.match(snapshot, /Proposal Packet Active: true/);
  assert.match(snapshot, /Proposal Packet Mode: self-build-mission-synthesis/);
  assert.match(snapshot, /Proposed Move ID: mission-synthesis-layer/);
  assert.match(snapshot, /Codex Handoff Available: true/);
  assert.match(snapshot, /Approval Required: true/);
  assert.match(snapshot, /Execution Eligible: false/);
  assert.match(snapshot, /Intent-to-Build Latest Mission ID: intent-build-mission-console-123/);
  assert.match(snapshot, /Intent-to-Build Mission Status: draft/);
  assert.match(snapshot, /Intent-to-Build Approval Required: yes/);
  assert.match(snapshot, /Intent-to-Build Generated Prompt Available: yes/);
  assert.match(snapshot, /Intent-to-Build Verification Status: pending/);
  assert.match(snapshot, /Memory Elevation Active: true/);
  assert.match(snapshot, /Elevated Memory Count: 5/);
  assert.match(snapshot, /Graph Linked Memory Count: 2/);
  assert.match(snapshot, /Memory Informed Recommendation: Prioritize mission-critical continuity memory first\./);
  assert.match(snapshot, /Mission Memory Context Count: 2/);
  assert.match(snapshot, /Mission Memory Influence Levels: critical_canon\|relevant_lesson/);
  assert.match(snapshot, /Mission Memory Conflict Count: 1/);
  assert.match(snapshot, /Mission Memory Lesson Candidate Pending: yes/);
  assert.match(snapshot, /Mission Memory Capability Gap Pending: no/);
  assert.match(snapshot, /Route Winner Kind: home-node/);
  assert.match(snapshot, /Route Winner Transport Kind: tailscale/);
  assert.match(snapshot, /Route Auto Selection Source: runtime-truth-adjudication/);
  assert.match(snapshot, /Route Auto Switch Active: yes/);
  assert.match(snapshot, /Selected Agent ID: research-agent/);
  assert.match(snapshot, /Selected Agent State: waiting/);
  assert.match(snapshot, /Selected Agent State Reason: No current task assigned\./);
  assert.match(snapshot, /Selected Agent Adjudication Gates: .*task-intent:block/);
  assert.match(snapshot, /Agent Waiting IDs: research-agent/);
  assert.match(snapshot, /Agent Blocked IDs: execution-agent/);
  assert.match(snapshot, /Route Candidates:\n- home-node-tailscale \[home-node\/tailscale\]/);

  assert.match(snapshot, /Last Freshness Need: high/);
  assert.match(snapshot, /Last Answer Mode: fresh-web/);
  assert.match(snapshot, /AI Policy Mode: local-first-cloud-when-needed/);
  assert.match(snapshot, /AI Policy Reason: Cloud routing allowed and selected because current real-world truth is required\./);
  assert.match(snapshot, /Truth Inconsistent: no/);
  assert.match(snapshot, /Route Usability Conflict: no/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- cloud \[selected\]: usable \(public route reachable\)/);
  assert.match(snapshot, /invariantWarnings:\n- minor drift detected/);
});

test('buildSupportSnapshot prints explicit unavailable markers for empty diagnostics', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-03-25T00:00:02.000Z' },
  });

  assert.match(snapshot, /Origin: n\/a/);
  assert.match(snapshot, /Selected Route Kind: n\/a/);
  assert.match(snapshot, /blockingIssues:\n- n\/a/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- n\/a/);
});

test('buildSupportSnapshot includes local retrieval truth fields when available', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRetrievalMode: 'local-rag',
      lastRetrievalEligible: 'true',
      lastRetrievalUsed: 'true',
      lastRetrievalReason: 'Retrieved 3 local chunk(s).',
      lastRetrievedChunkCount: '3',
      lastRetrievedSources: [
        'structured-handoff:docs/reports/integration-hardening-sprint-report.md#0',
        'project-summary:stephanos-ui/src/ai/freshnessRouting.test.mjs#1',
      ],
      lastRetrievalQuery: 'what did we decide about hosted low-freshness routing',
      lastRetrievalIndexStatus: 'ready',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-03-25T00:00:03.000Z' },
  });

  assert.match(snapshot, /Retrieval Mode: local-rag/);
  assert.match(snapshot, /Retrieval Eligible: true/);
  assert.match(snapshot, /Retrieval Used: true/);
  assert.match(snapshot, /Retrieved Chunk Count: 3/);
  assert.match(snapshot, /Retrieval Index Status: ready/);
});

test('buildSupportSnapshot does not promote selected provider to executable when health is unknown', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
    },
    routeTruthView: {
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {
      executableProvider: '',
    },
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {
      healthState: 'unknown',
    },
    now: { toISOString: () => '2026-03-26T00:00:02.000Z' },
  });

  assert.match(snapshot, /Last Requested Provider: ollama/);
  assert.match(snapshot, /Selected Provider: ollama/);
  assert.match(snapshot, /Executable Provider: none/);
  assert.match(snapshot, /Selected Provider State: unknown/);
  assert.doesNotMatch(snapshot, /Executable Provider: ollama/);
});

test('buildSupportSnapshot classifies hosted healthy-route stale-contract boundary without blaming route', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      sessionKind: 'hosted-web',
      executionTruth: 'error',
      lastActualProviderUsed: 'unknown',
    },
    routeTruthView: {
      routeKind: 'home-node',
      backendReachableState: 'yes',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'none',
    },
    runtimeSessionTruth: { sessionKind: 'hosted-web' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: { executableProvider: '' },
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    orchestrationTruth: {
      canonicalSourceDistAlignment: {
        buildAlignmentState: 'unknown',
        buildTruthStatus: 'indeterminate',
      },
    },
  });

  assert.match(snapshot, /Route Layer Status: healthy/);
  assert.match(snapshot, /Backend Execution Contract Status: stale-or-incomplete/);
  assert.match(snapshot, /Route Healthy But Backend Contract Stale: yes/);
  assert.match(snapshot, /Likely Needs Battle Bridge Rebuild: yes/);
  assert.match(snapshot, /Operator Next Classification: rebuild Battle Bridge required before further provider testing/);
  assert.match(snapshot, /operatorGuidance:\n- Route healthy; backend execution contract appears stale\./);
});

test('buildSupportSnapshot keeps execution status healthy when streamed answer succeeded but stream finalization is missing', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      sessionKind: 'local-desktop',
      executionTruth: 'ok:ollama',
      executionStatus: 'ok:ollama',
      lastActualProviderUsed: 'ollama',
      lastModelUsed: 'llama3.2:3b',
      lastExecutionMetadata: {
        streaming_used: true,
        streaming_finalized: false,
      },
    },
    routeTruthView: {
      routeKind: 'local',
      backendReachableState: 'yes',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /Execution Truth: ok:ollama/);
  assert.match(snapshot, /Execution Status: ok:ollama/);
  assert.match(snapshot, /Route Layer Status: healthy/);
});

test('buildSupportSnapshot prefers last request provider truth over stale route truth provider', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      requestedRouteMode: 'explicit',
      effectiveRouteMode: 'explicit',
      lastRequestedProvider: 'groq',
      lastRequestedProviderForRequest: 'groq',
      lastActualProviderUsed: 'groq',
    },
    routeTruthView: {
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      executedProvider: 'groq',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-04T00:00:02.000Z' },
  });

  assert.match(snapshot, /Last Requested Provider For Request: groq/);
  assert.match(snapshot, /Last Requested Provider: groq/);
  assert.doesNotMatch(snapshot, /Last Requested Provider: ollama/);
});

test('buildSupportSnapshot includes Ollama model ladder execution truth fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastOllamaModelDefault: 'qwen:14b',
      lastOllamaModelPreferred: 'qwen:32b',
      lastOllamaModelRequested: 'qwen:14b',
      lastOllamaModelSelected: 'qwen:32b',
      lastOllamaLoadMode: 'cool',
      lastOllamaLoadPolicyApplied: 'true',
      lastOllamaLoadPolicyReason: 'cool-heavy-avoided-for-load-policy',
      lastOllamaHeavyModelRequested: 'true',
      lastOllamaHeavyModelAllowed: 'false',
      lastOllamaModelBeforeLoadPolicy: 'qwen:14b',
      lastOllamaModelAfterLoadPolicy: 'llama3.2:3b',
      lastOllamaReasoningMode: 'deep',
      lastOllamaEscalationActive: 'true',
      lastOllamaEscalationReason: 'operator-or-prompt requested deep reasoning',
      lastOllamaFallbackModel: 'gpt-oss:20b',
      lastOllamaFallbackModelUsed: 'false',
      lastOllamaFallbackReason: 'n/a',
      lastOllamaTimeoutMs: '22000',
      lastOllamaTimeoutSource: 'model-override',
      lastOllamaTimeoutModel: 'qwen:32b',
      lastUiRequestTimeoutMs: '121500',
      lastBackendRouteTimeoutMs: '120000',
      lastProviderTimeoutMs: '120000',
      lastModelTimeoutMs: '120000',
      lastTimeoutPolicySource: 'provider:ollama:model-override:qwen:32b:ui-grace',
      lastTimeoutOverrideApplied: 'true',
      lastTimeoutFailureLayer: 'ui',
      lastTimeoutFailureLabel: 'ui_request_timeout_ms',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-04T00:00:03.000Z' },
  });

  assert.match(snapshot, /Last Ollama Default Model: qwen:14b/);
  assert.match(snapshot, /Last Ollama Selected Model: qwen:32b/);
  assert.match(snapshot, /Last Ollama Load Mode: cool/);
  assert.match(snapshot, /Last Ollama Load Policy Applied: true/);
  assert.match(snapshot, /Last Ollama Model After Load Policy: llama3.2:3b/);
  assert.match(snapshot, /Last Ollama Escalation Active: true/);
  assert.match(snapshot, /Last Ollama Fallback Model: gpt-oss:20b/);
  assert.match(snapshot, /Last Ollama Timeout \(ms\): 22000/);
  assert.match(snapshot, /Last UI Request Timeout \(ms\): 121500/);
  assert.match(snapshot, /Last Backend Route Timeout \(ms\): 120000/);
  assert.match(snapshot, /Last Provider Timeout \(ms\): 120000/);
  assert.match(snapshot, /Last Timeout Failure Label: ui_request_timeout_ms/);
  assert.match(snapshot, /Last Ollama Timeout Source: model-override/);
  assert.match(snapshot, /Timeout Truth Degraded By Route Usability: no/);
});

test('buildSupportSnapshot flags timeout truth degradation when frontend fallback persists during route-usability veto', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastTimeoutPolicySource: 'frontend:api-runtime',
    },
    routeTruthView: {
      selectedRouteReachableState: 'yes',
      routeUsableState: 'no',
      backendReachableState: 'yes',
      providerState: 'READY',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:03.000Z' },
  });

  assert.match(snapshot, /Timeout Truth Degraded By Route Usability: yes/);
  assert.match(snapshot, /Timeout Truth Degradation Reason: frontend-timeout-fallback-persisted-while-route-usability-false/);
});

test('buildSupportSnapshot regression: healthy route + ollama execution keeps intent separate and timeout source canonical', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastUiRequestedProvider: 'gemini',
      lastUiDefaultProvider: 'gemini',
      lastRequestedProviderIntent: 'gemini',
      lastRequestedProviderForRequest: 'gemini',
      lastRequestedProvider: 'gemini',
      lastSelectedProvider: 'ollama',
      lastActualProviderUsed: 'ollama',
      lastTimeoutPolicySource: 'canonical-runtime-execution-truth:provider:ollama:default-timeout:ui-grace',
      lastUiRequestTimeoutMs: '13500',
      lastTimeoutEffectiveProvider: 'ollama',
      lastTimeoutEffectiveModel: 'qwen:14b',
    },
    routeTruthView: {
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      backendReachableState: 'yes',
      providerState: 'READY',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:04.000Z' },
  });

  assert.match(snapshot, /Last Requested Provider Intent: gemini/);
  assert.match(snapshot, /Last Request-Side Selected Provider: n\/a/);
  assert.match(snapshot, /Last Selected Provider: ollama/);
  assert.match(snapshot, /Last Actual Provider Used: ollama/);
  assert.match(snapshot, /Last Timeout Policy Source: canonical-runtime-execution-truth:provider:ollama:default-timeout:ui-grace/);
  assert.match(snapshot, /Last Timeout Effective Provider: ollama/);
  assert.doesNotMatch(snapshot, /Last Timeout Policy Source: frontend:api-runtime/);
  assert.match(snapshot, /Timeout Truth Degraded By Route Usability: no/);
});

test('buildSupportSnapshot flags impossible provider/model combinations and timeout provider drift without override reason', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRequestedProviderForRequest: 'ollama',
      lastSelectedProvider: 'ollama',
      lastActualProviderUsed: 'ollama',
      lastActualModelUsed: 'gemini-2.5-flash',
      lastTimeoutEffectiveProvider: 'gemini',
      lastProviderOverrideReason: 'n/a',
      lastOllamaLoadMode: 'n/a',
      lastOllamaModelBeforeLoadPolicy: 'n/a',
      lastOllamaModelAfterLoadPolicy: 'n/a',
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:05.000Z' },
  });

  assert.match(snapshot, /Last Actual Model Used: gemini-2.5-flash/);
  assert.match(snapshot, /invariantWarnings:\n[\s\S]*actual_provider_used=ollama with model containing "gemini"/m);
  assert.match(snapshot, /invariantWarnings:\n[\s\S]*timeout effective provider differs from actual provider without explicit override reason/m);
  assert.match(snapshot, /invariantWarnings:\n[\s\S]*Ollama selected\/actual but load governor fields are n\/a/m);
});

test('buildSupportSnapshot warns on unexplained router-to-actual provider drift and cancellation truth on success', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRouterSelectedProvider: 'gemini',
      lastSelectedProvider: 'gemini',
      lastRequestedProviderForRequest: 'gemini',
      lastActualProviderUsed: 'ollama',
      lastExecutionCancelled: 'true',
      lastProviderCancelled: 'true',
      lastOllamaAbortSent: 'true',
      lastExecutionStatus: 'ok:ollama',
      lastProviderOverrideReason: 'n/a',
      lastFallbackProviderUsed: 'n/a',
      lastOllamaLoadMode: 'cool',
      lastOllamaModelBeforeLoadPolicy: 'qwen:32b',
      lastOllamaModelAfterLoadPolicy: 'llama3.2:3b',
    },
    routeTruthView: {
      selectedProvider: 'gemini',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:05.000Z' },
  });

  assert.match(snapshot, /invariantWarnings:\n[\s\S]*router selected provider differs from actual provider without fallback\/override reason/m);
  assert.match(snapshot, /invariantWarnings:\n[\s\S]*cancellation truth is true while execution outcome reports success/m);
});

test('buildSupportSnapshot does not warn on legitimate ollama load-governor model downgrade', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRouterSelectedProvider: 'ollama',
      lastSelectedProvider: 'ollama',
      lastRequestedProviderForRequest: 'ollama',
      lastActualProviderUsed: 'ollama',
      lastActualModelUsed: 'llama3.2:3b',
      lastExecutionCancelled: 'false',
      lastProviderCancelled: 'false',
      lastExecutionStatus: 'ok:ollama',
      lastProviderOverrideReason: 'n/a',
      lastFallbackProviderUsed: 'n/a',
      lastOllamaLoadMode: 'cool',
      lastOllamaModelBeforeLoadPolicy: 'qwen:32b',
      lastOllamaModelAfterLoadPolicy: 'llama3.2:3b',
      lastOllamaHeavyModelRequested: 'true',
      lastOllamaHeavyModelAllowed: 'false',
      lastOllamaLoadPolicyApplied: 'true',
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:05.000Z' },
  });

  assert.doesNotMatch(snapshot, /router selected provider differs from actual provider/);
  assert.doesNotMatch(snapshot, /cancellation truth is true while execution outcome reports success/);
});

test('buildSupportSnapshot clears stale router and cancellation contradiction warnings after successful cool-mode ollama normalization', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRequestedProvider: 'ollama',
      lastRequestSideSelectedProvider: 'ollama',
      lastRouterSelectedProvider: 'ollama',
      lastSelectedProvider: 'ollama',
      lastExecutableProvider: 'ollama',
      lastActualProviderUsed: 'ollama',
      lastActualModelUsed: 'llama3.2:3b',
      lastExecutionTruth: 'ollama answered',
      lastExecutionStatus: 'ok:ollama',
      lastSelectedProviderFinalExecutionOutcome: 'success',
      lastExecutionCancelled: 'false',
      lastProviderCancelled: 'false',
      lastProviderCancelReason: 'n/a',
      lastOllamaAbortSent: 'false',
      lastCancellationSource: 'n/a',
      lastOllamaLoadMode: 'cool',
      lastOllamaModelBeforeLoadPolicy: 'qwen:32b',
      lastOllamaModelAfterLoadPolicy: 'llama3.2:3b',
      lastOllamaHeavyModelRequested: 'true',
      lastOllamaHeavyModelAllowed: 'false',
      lastOllamaLoadPolicyApplied: 'true',
      lastProviderOverrideReason: 'n/a',
      lastFallbackProviderUsed: 'n/a',
      lastFreshnessCandidateProvider: 'gemini',
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:05.000Z' },
  });

  assert.match(snapshot, /Last Router Selected Provider: ollama/);
  assert.match(snapshot, /Last Actual Provider Used: ollama/);
  assert.match(snapshot, /Last Actual Model Used: llama3.2:3b/);
  assert.match(snapshot, /Last Execution Cancelled: false/);
  assert.match(snapshot, /Provider Cancelled: false/);
  assert.match(snapshot, /Ollama Abort Sent: false/);
  assert.match(snapshot, /Last Ollama Load Mode: cool/);
  assert.match(snapshot, /Last Ollama Heavy Model Requested: true/);
  assert.match(snapshot, /Last Ollama Heavy Model Allowed: false/);
  assert.match(snapshot, /Last Ollama Model After Load Policy: llama3.2:3b/);
  assert.match(snapshot, /Last Freshness Candidate Provider: gemini/);
  assert.doesNotMatch(snapshot, /router selected provider differs from actual provider/);
  assert.doesNotMatch(snapshot, /cancellation truth is true while execution outcome reports success/);
});

test('buildSupportSnapshot allows router/actual provider mismatch when explicit fallback reason is present', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRequestedProvider: 'ollama',
      lastRequestSideSelectedProvider: 'ollama',
      lastRouterSelectedProvider: 'ollama',
      lastSelectedProvider: 'ollama',
      lastExecutableProvider: 'ollama',
      lastActualProviderUsed: 'gemini',
      lastActualModelUsed: 'gemini-2.5-flash',
      lastExecutionTruth: 'gemini answered after ollama timeout fallback',
      lastExecutionStatus: 'ok:gemini',
      lastProviderOverrideReason: 'fallback: ollama timed out',
      lastFallbackProviderUsed: 'gemini',
      lastFallbackReason: 'ollama timeout fallback to gemini',
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'gemini',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-08T00:00:06.000Z' },
  });

  assert.match(snapshot, /Last Router Selected Provider: ollama/);
  assert.match(snapshot, /Last Actual Provider Used: gemini/);
  assert.match(snapshot, /Last Fallback Provider Used: gemini/);
  assert.match(snapshot, /Last Provider Override Reason: fallback: ollama timed out/);
  assert.doesNotMatch(snapshot, /router selected provider differs from actual provider without fallback\/override reason/);
});

test('buildSupportSnapshot separates provider health readiness from execution viability during fallback', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastSelectedProvider: 'ollama',
      lastActualProviderUsed: 'groq',
      lastFallbackUsed: 'yes',
      lastFallbackReason: 'ollama: Cannot connect to Ollama: it took too long to respond. [connect_timeout,provider,connect-timeout,model-warmup-likely; timeoutMs=105000]',
      lastSelectedProviderHealthOk: 'true',
      lastSelectedProviderHealthState: 'CONNECTED',
      lastSelectedProviderExecutionViability: 'failed',
      lastSelectedProviderExecutionFailureLayer: 'provider',
      lastSelectedProviderExecutionFailureLabel: 'connect_timeout',
      lastSelectedProviderExecutionFailurePhase: 'awaiting-response-headers',
      lastSelectedProviderTimeoutCategory: 'connect-timeout',
      lastSelectedProviderModelWarmupLikely: 'true',
      lastSelectedProviderWarmupRetryEligible: 'true',
      lastSelectedProviderWarmupRetryApplied: 'true',
      lastSelectedProviderWarmupRetryReason: 'ollama-cold-start-timeout',
      lastSelectedProviderWarmupRetryTimeoutMs: '105000',
      lastSelectedProviderWarmupRetryAttemptCount: '1',
      lastSelectedProviderFirstAttemptElapsedMs: '75001',
      lastSelectedProviderFinalAttemptElapsedMs: '105001',
      lastSelectedProviderInitialFailureLayer: 'provider',
      lastSelectedProviderInitialFailureLabel: 'connect_timeout',
      lastSelectedProviderInitialFailurePhase: 'awaiting-response-headers',
      lastSelectedProviderInitialTimeoutCategory: 'connect-timeout',
      lastSelectedProviderFinalExecutionOutcome: 'error',
      lastSelectedProviderFallbackAfterWarmupRetry: 'true',
      lastSelectedProviderElapsedMs: '105001',
      lastExplicitProviderFallbackPolicyTriggered: 'true',
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'groq',
      providerState: 'CONNECTED',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {
      healthBadge: 'Ready',
      healthState: 'CONNECTED',
    },
    now: { toISOString: () => '2026-04-09T00:00:04.000Z' },
  });

  assert.match(snapshot, /Selected Provider Health: Ready/);
  assert.match(snapshot, /Selected Provider State: CONNECTED/);
  assert.match(snapshot, /Last Selected Provider Execution Viability: failed/);
  assert.match(snapshot, /Last Selected Provider Failure Label: connect_timeout/);
  assert.match(snapshot, /Last Selected Provider Model Warmup Likely: true/);
  assert.match(snapshot, /Last Selected Provider Warmup Retry Eligible: true/);
  assert.match(snapshot, /Last Selected Provider Warmup Retry Reason: ollama-cold-start-timeout/);
  assert.match(snapshot, /Last Selected Provider Fallback After Warmup Retry: true/);
  assert.match(snapshot, /Explicit Provider Fallback Policy Triggered: true/);
  assert.match(snapshot, /Last Actual Provider Used: groq/);
});


test('buildSupportSnapshot emits hosted backend-target diagnostics and operator guidance when unresolved', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'unavailable',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      canonicalRouteRuntimeTruth: {
        sessionKind: 'hosted-web',
      },
    },
    routeTruthView: {
      routeKind: 'unavailable',
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      backendReachableState: 'no',
      operatorReason: 'n/a',
    },
    runtimeSessionTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
    },
    runtimeRouteTruth: {
      winningReason: '',
    },
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {
      blockingIssues: [],
      invariantWarnings: [],
    },
    runtimeContext: {
      backendTargetResolutionSource: 'session-restore',
      backendTargetResolvedUrl: '',
      backendTargetFallbackUsed: false,
      backendTargetInvalidReason: 'Saved backend target was loopback and rejected for hosted session.',
      routeDiagnostics: {},
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-03T00:00:02.000Z' },
  });

  assert.match(snapshot, /Backend Target Resolution Source: session-restore/);
  assert.match(snapshot, /Backend Target Resolved URL: n\/a/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- backend-target: blocked \(Saved backend target was loopback and rejected for hosted session\.\)/);
  assert.match(snapshot, /blockingIssues:\n- Backend target unresolved: Saved backend target was loopback and rejected for hosted session\./);
  assert.match(snapshot, /operatorGuidance:\n- Resolve a reachable non-loopback backend target for hosted-web/);
  assert.doesNotMatch(snapshot, /No operator action required\./);
  assert.doesNotMatch(snapshot, /operatorGuidance:\n- n\/a/);
});

test('buildSupportSnapshot keeps unresolved hosted backend-target metadata informational when cloud route is usable', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'ready',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      cloudAvailable: true,
      canonicalRouteRuntimeTruth: {
        sessionKind: 'hosted-web',
        executedProvider: 'groq',
      },
    },
    routeTruthView: {
      routeKind: 'cloud',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      backendReachableState: 'yes',
      executedProvider: 'groq',
      operatorReason: 'No operator action required.',
    },
    runtimeSessionTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
    },
    runtimeRouteTruth: {
      winningReason: 'cloud route ready',
    },
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {
      blockingIssues: [],
      invariantWarnings: [{ message: 'Runtime reports ready while tile execution readiness is false.' }],
    },
    runtimeContext: {
      backendTargetResolutionSource: 'unresolved',
      backendTargetResolvedUrl: '',
      backendTargetFallbackUsed: false,
      backendTargetInvalidReason: 'No non-loopback backend target resolved for hosted session.',
      restoreDecision: 'Ignored loopback backend target for non-local session; using current home-node/network context instead.',
      routeDiagnostics: {},
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-03T00:00:02.500Z' },
  });

  assert.match(snapshot, /Selected Route Kind: cloud/);
  assert.match(snapshot, /Launch State: ready/);
  assert.match(snapshot, /Selected Route Reachable: yes/);
  assert.match(snapshot, /Selected Route Usable: yes/);
  assert.match(snapshot, /Fallback Active: no/);
  assert.match(snapshot, /Execution Truth: n\/a/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- backend-target: informational \(No non-loopback backend target resolved for hosted session\.\)/);
  assert.match(snapshot, /- cloud-execution: operational \(groq\)/);
  assert.match(snapshot, /blockingIssues:\n- n\/a/);
  assert.match(snapshot, /invariantWarnings:\n- n\/a/);
  assert.doesNotMatch(snapshot, /Backend target unresolved:/);
  assert.doesNotMatch(snapshot, /Resolve a reachable non-loopback backend target for hosted-web/);
  assert.doesNotMatch(snapshot, /Runtime reports ready while tile execution readiness is false\./);
  assert.doesNotMatch(snapshot, /Ignored loopback backend target for non-local session/);
});

test('buildSupportSnapshot reports non-degraded launch state for healthy idle local-desktop runtime truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'ready',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'local-first',
      canonicalRouteRuntimeTruth: {
        sessionKind: 'local-desktop',
      },
      executionStatus: 'idle',
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      backendReachableState: 'yes',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
      operatorReason: 'No operator action required.',
    },
    runtimeSessionTruth: {
      sessionKind: 'local-desktop',
      deviceContext: 'pc-local-browser',
    },
    runtimeRouteTruth: {
      winningReason: 'Backend online locally; local-desktop route is live through the active backend session',
    },
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {
      executableProvider: 'ollama',
    },
    runtimeDiagnosticsTruth: {
      blockingIssues: [],
      invariantWarnings: [],
    },
    runtimeContext: {
      routeDiagnostics: {},
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-10T00:00:00.000Z' },
  });

  assert.match(snapshot, /Launch State: ready/);
  assert.doesNotMatch(snapshot, /Launch State: degraded/);
  assert.match(snapshot, /Selected Route Kind: local-desktop/);
  assert.match(snapshot, /Selected Route Reachable: yes/);
  assert.match(snapshot, /Selected Route Usable: yes/);
  assert.match(snapshot, /Backend Reachable: yes/);
  assert.match(snapshot, /Execution Status: idle/);
});

test('buildSupportSnapshot reconciles stale local-desktop diagnostics against structured candidate truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'unavailable',
      canonicalRouteRuntimeTruth: {
        sessionKind: 'local-desktop',
      },
      executionTruth: 'blocked-before-provider / no-provider-executed',
      lastExecutionMetadata: {
        provider_execution_gate_status: 'blocked-by-route',
        command_pipeline_last_input_restore_available: 'yes',
      },
    },
    routeTruthView: {
      routeKind: 'unavailable',
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      backendReachableState: 'no',
    },
    runtimeSessionTruth: { sessionKind: 'local-desktop' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {
      routeCandidates: [
        {
          routeKind: 'local-desktop',
          state: 'configured-unreachable',
          reason: 'backend is offline',
        },
      ],
      routeDiagnostics: {
        'local-desktop': {
          available: true,
          reason: 'Backend online locally; provider/router is using the live local-desktop backend session',
        },
      },
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-05-21T00:00:00.000Z' },
  });

  assert.match(snapshot, /routeDiagnosticsSummary:\n- local-desktop \[candidate\]: unavailable \(local-desktop-candidate-summary-mismatch: structured candidate state=configured-unreachable\)/);
  assert.doesNotMatch(snapshot, /routeDiagnosticsSummary:\n- local-desktop \[candidate\]: available \(Backend online locally; provider\/router is using the live local-desktop backend session\)/);
  assert.match(snapshot, /Active Provider: none/);
  assert.match(snapshot, /Fallback Active: no/);
  assert.match(snapshot, /Execution Truth: blocked-before-provider \/ no-provider-executed/);
});

test('buildSupportSnapshot reconciles local-desktop diagnostics when candidate identity is keyed by candidateKey', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      canonicalRouteRuntimeTruth: { sessionKind: 'local-desktop' },
    },
    routeTruthView: {
      routeKind: 'unavailable',
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      backendReachableState: 'no',
    },
    runtimeSessionTruth: { sessionKind: 'local-desktop' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {
      routeCandidates: [
        {
          candidateKey: 'local-desktop',
          transportKind: 'direct',
          configured: true,
          reason: 'backend is offline',
        },
      ],
      routeDiagnostics: {
        'local-desktop': {
          available: true,
          reason: 'Backend online locally; provider/router is using the live local-desktop backend session',
        },
      },
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-05-21T00:00:00.000Z' },
  });

  assert.match(snapshot, /Route Candidates:\n- local-desktop \[n\/a\/direct\] rank=n\/a score=n\/a state=configured-unreachable \(backend is offline\)/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- local-desktop \[candidate\]: unavailable \(local-desktop-candidate-summary-mismatch: structured candidate state=configured-unreachable\)/);
  assert.match(snapshot, /Local Desktop Candidate State Used For Summary: configured-unreachable/);
  assert.match(snapshot, /Route Diagnostics Candidate Reconciled: yes/);
});

test('buildSupportSnapshot applies fresh health probe truth to local-desktop candidate', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      canonicalRouteRuntimeTruth: { sessionKind: 'local-desktop' },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      backendReachableState: 'yes',
      networkReachabilityState: 'reachable',
    },
    runtimeSessionTruth: { sessionKind: 'local-desktop' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {
      routeCandidates: [{ routeKind: 'local-desktop', configured: true, reason: 'backend is offline' }],
      healthProbeTruth: {
        lastBackendHealthProbeAt: '2026-05-21T00:00:20.000Z',
        lastBackendHealthProbeResult: 'ok:true',
      },
    },
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-05-21T00:00:30.000Z'),
  });

  assert.match(snapshot, /Local Desktop Candidate Source: health-probe-fresh/);
  assert.match(snapshot, /Local Desktop Candidate Health Probe Applied: yes/);
  assert.match(snapshot, /Route Candidates:\n- local-desktop \[local-desktop\/direct\] rank=n\/a score=n\/a state=usable/);
  assert.match(snapshot, /Backend Reachable: yes/);
  assert.match(snapshot, /Network Reachability Truth: reachable/);
});

test('buildSupportSnapshot does not promote stale health probe truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      canonicalRouteRuntimeTruth: { sessionKind: 'local-desktop' },
    },
    routeTruthView: {
      routeKind: 'unavailable',
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      backendReachableState: 'no',
      networkReachabilityState: 'unreachable',
    },
    runtimeSessionTruth: { sessionKind: 'local-desktop' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {
      routeCandidates: [{ routeKind: 'local-desktop', configured: true, reason: 'backend is offline' }],
      healthProbeTruth: {
        lastBackendHealthProbeAt: '2026-05-21T00:00:00.000Z',
        lastBackendHealthProbeResult: 'ok:true',
      },
    },
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-05-21T00:01:00.000Z'),
  });

  assert.match(snapshot, /Local Desktop Candidate Source: stale-route-candidate/);
  assert.match(snapshot, /Local Desktop Candidate Health Probe Applied: no/);
  assert.match(snapshot, /Backend Reachable: no/);
});

test('buildSupportSnapshot reports parity state from runtime truth markers', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeTruth: {
        sourceDistParityOk: false,
      },
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-03T00:00:04.000Z' },
  });

  assert.match(snapshot, /Source\/Dist Parity: stale/);
});

test('buildSupportSnapshot suppresses "No operator action required." guidance when blocking issues exist', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'unavailable',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      canonicalRouteRuntimeTruth: {
        sessionKind: 'hosted-web',
      },
    },
    routeTruthView: {
      routeKind: 'unavailable',
      operatorReason: 'No operator action required.',
    },
    runtimeSessionTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
    },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {
      blockingIssues: [{ message: 'Backend route is unresolved.' }],
      invariantWarnings: [],
    },
    runtimeContext: {
      routeDiagnostics: {},
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-03T00:00:03.000Z' },
  });

  assert.match(snapshot, /blockingIssues:\n- Backend route is unresolved\./);
  assert.doesNotMatch(snapshot, /operatorGuidance:\n- No operator action required\./);
});

test('buildSupportSnapshot keeps unresolved hosted backend-target blocking when no hosted cloud path is usable', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'degraded',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      cloudAvailable: false,
      canonicalRouteRuntimeTruth: {
        sessionKind: 'hosted-web',
        executedProvider: 'n/a',
      },
    },
    routeTruthView: {
      routeKind: 'unavailable',
      fallbackActive: false,
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      backendReachableState: 'no',
      executedProvider: 'n/a',
      operatorReason: 'No operator action required.',
    },
    runtimeSessionTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
    },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {
      blockingIssues: [],
      invariantWarnings: [],
    },
    runtimeContext: {
      backendTargetResolutionSource: 'unresolved',
      backendTargetResolvedUrl: '',
      backendTargetFallbackUsed: false,
      backendTargetInvalidReason: 'No non-loopback backend target resolved for hosted session.',
      routeDiagnostics: {},
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-03T00:00:03.500Z' },
  });

  assert.match(snapshot, /routeDiagnosticsSummary:\n- backend-target: blocked \(No non-loopback backend target resolved for hosted session\.\)/);
  assert.match(snapshot, /- cloud-execution: not confirmed/);
  assert.match(snapshot, /blockingIssues:\n- Backend target unresolved: No non-loopback backend target resolved for hosted session\./);
  assert.match(snapshot, /operatorGuidance:\n- Resolve a reachable non-loopback backend target for hosted-web/);
});

test('buildSupportSnapshot keeps canonical hosted route truth internally consistent for accepted LAN target', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'degraded',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'local-first',
      canonicalRouteRuntimeTruth: {
        sessionKind: 'hosted-web',
        hostedRouteTruth: {
          backendTargetResolvedUrl: 'http://192.168.0.198:8787',
          backendTargetValidity: 'valid',
          backendTargetReachable: true,
          selectedRouteKind: 'home-node',
          selectedRouteReachable: true,
          selectedRouteUsable: false,
          blockingIssues: [{ code: 'hosted-home-node-publication-failed', message: 'home-node UI target is unreachable (http://192.168.0.198:5173/)' }],
          winningReason: 'Home PC backend is reachable, but the published home-node UI target is unreachable from this launcher session',
          reconciliationReason: 'home-node UI target is unreachable (http://192.168.0.198:5173/)',
        },
      },
    },
    routeTruthView: {
      routeKind: 'home-node',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'no',
      backendReachableState: 'yes',
      routeUsabilityVetoReason: 'ui-reachability-unreachable',
      operatorReason: 'home-node UI target is unreachable (http://192.168.0.198:5173/)',
    },
    runtimeSessionTruth: { sessionKind: 'hosted-web', deviceContext: 'lan-companion' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { blockingIssues: [], invariantWarnings: [] },
    runtimeContext: {
      backendTargetResolutionSource: 'runtimeContext.backendTargetResolvedUrl',
      backendTargetResolvedUrl: 'http://192.168.0.198:8787',
      canonicalHostedRouteTruth: {
        backendTargetResolvedUrl: 'http://192.168.0.198:8787',
        backendTargetValidity: 'valid',
        backendTargetReachable: true,
        selectedRouteKind: 'home-node',
        selectedRouteReachable: true,
        selectedRouteUsable: false,
        blockingIssues: [{ code: 'hosted-home-node-publication-failed', message: 'home-node UI target is unreachable (http://192.168.0.198:5173/)' }],
      },
      routeDiagnostics: {
        'backend-target': { usable: true, reason: 'Resolved backend target from runtimeContext.backendTargetResolvedUrl.' },
      },
    },
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-07T00:00:00.000Z' },
  });

  assert.match(snapshot, /Selected Route Kind: home-node/);
  assert.match(snapshot, /Selected Route Reachable: yes/);
  assert.match(snapshot, /Selected Route Usability Veto Reason: ui-reachability-unreachable/);
  assert.match(snapshot, /blockingIssues:\n- home-node UI target is unreachable \(http:\/\/192.168.0.198:5173\/\)/);
  assert.doesNotMatch(snapshot, /Hosted backend target is unresolved/);
});

test('buildSupportSnapshot prefers last request provider metadata over stale adjudicated provider truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastRequestedProvider: 'groq',
    },
    routeTruthView: {
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-04-04T00:00:00.000Z' },
  });

  assert.match(snapshot, /Last Requested Provider: groq/);
  assert.doesNotMatch(snapshot, /Last Requested Provider: ollama/);
});

test('buildSupportSnapshot projects freshness integrity truth modes explicitly', () => {
  const shared = {
    routeTruthView: {
      requestedProvider: 'gemini',
      selectedProvider: 'gemini',
      executedProvider: 'gemini',
      backendReachableState: 'yes',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  };

  const freshVerified = buildSupportSnapshot({
    ...shared,
    runtimeStatus: {
      lastAnswerTruthMode: 'fresh-verified',
      lastFreshnessIntegrityPreserved: 'true',
      lastStaleFallbackUsed: 'no',
    },
    now: { toISOString: () => '2026-04-09T00:00:00.000Z' },
  });
  assert.match(freshVerified, /Last Answer Truth Mode: fresh-verified/);

  const freshnessUnavailable = buildSupportSnapshot({
    ...shared,
    runtimeStatus: {
      lastAnswerTruthMode: 'degraded-freshness-unavailable',
      lastFreshnessIntegrityPreserved: 'true',
      lastStaleFallbackUsed: 'no',
      lastFreshnessTruthReason: 'Fresh-capable provider failed.',
    },
    now: { toISOString: () => '2026-04-09T00:00:01.000Z' },
  });
  assert.match(freshnessUnavailable, /Last Answer Truth Mode: degraded-freshness-unavailable/);

  const staleAllowed = buildSupportSnapshot({
    ...shared,
    runtimeStatus: {
      lastAnswerTruthMode: 'degraded-stale-allowed',
      lastFreshnessIntegrityPreserved: 'true',
      lastStaleFallbackPermitted: 'true',
      lastStaleFallbackUsed: 'yes',
      lastStaleAnswerWarning: 'Freshness-critical request answered by non-fresh provider.',
    },
    now: { toISOString: () => '2026-04-09T00:00:02.000Z' },
  });
  assert.match(staleAllowed, /Last Answer Truth Mode: degraded-stale-allowed/);
  assert.match(staleAllowed, /Last Stale Answer Warning: Freshness-critical request answered by non-fresh provider\./);
});

test('buildSupportSnapshot includes home bridge transport and tailscale truth fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: { appLaunchState: 'ready', requestedRouteMode: 'auto', effectiveRouteMode: 'cloud-first' },
    routeTruthView: { routeKind: 'home-node', backendReachableState: 'yes', selectedProvider: 'groq', executedProvider: 'groq', selectedRouteReachableState: 'yes', routeUsableState: 'yes' },
    runtimeContext: {
      bridgeTransportTruth: {
        selectedTransport: 'tailscale',
        configuredTransport: 'tailscale',
        activeTransport: 'tailscale',
        state: 'active',
        detail: 'Tailscale bridge active.',
        reason: 'Tailscale bridge active.',
        reachability: 'reachable',
        usability: 'yes',
        source: 'bridgeTransport:tailscale',
        bridgeMemoryPresent: true,
        bridgeMemoryTransport: 'tailscale',
        bridgeMemoryUrl: 'https://100.64.0.10',
        bridgeMemoryRememberedAt: '2026-04-11T10:00:00.000Z',
        bridgeMemoryRehydrated: true,
        bridgeMemoryNeedsValidation: true,
        bridgeMemoryValidationState: 'awaiting-validation',
        bridgeMemoryReason: 'Remembered Home Bridge loaded from shared memory and awaiting validation on this surface.',
        bridgeMemoryReconciliationState: 'remembered-unreachable',
        bridgeMemoryReconciliationReason: 'Remembered bridge exists but this surface cannot currently reach it.',
        bridgeMemoryReconciliationProvenance: 'remembered-tailscale-unreachable',
        bridgeMemoryPersistenceState: 'save-persisted',
        bridgeMemoryPersistenceReason: 'Remembered tailscale Home Bridge config persisted to shared durable memory.',
        bridgeMemoryPersistenceAt: '2026-04-11T10:00:03.000Z',
        bridgeMemoryWriteAttempted: true,
        bridgeMemoryWriteSucceeded: true,
        bridgeMemoryReadAttempted: true,
        bridgeMemoryReadSource: 'shared-runtime-memory',
        bridgeMemoryReadResult: 'remembered-bridge',
        bridgeMemoryClearedBy: '',
        bridgeMemoryClobberDetected: false,
        bridgeMemoryStorageKey: 'stephanos.durable.memory.v2',
        bridgeMemoryStorageScope: 'shared-runtime-memory',
        bridgeMemoryLastRawValueSummary: 'record-payload:transport,backendUrl',
        bridgeAutoRevalidationState: 'unreachable',
        bridgeAutoRevalidationReason: 'Remembered Home Bridge is unreachable from this surface.',
        tailscale: {
          deviceName: 'home-node',
          tailnetIp: '100.64.0.10',
          backendUrl: 'https://100.64.0.10',
          accepted: true,
          reachable: true,
          usable: true,
          reason: 'reachable',
        },
      },
      backendTargetResolutionSource: 'bridgeTransport:tailscale',
      backendTargetResolvedUrl: 'https://100.64.0.10',
      backendTargetCandidates: [],
    },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-04-10T00:00:00.000Z'),
    origin: 'https://cheekyfellastef.github.io',
    href: 'https://cheekyfellastef.github.io/stephanos',
  });

  assert.match(snapshot, /Home Bridge Transport Selected: tailscale/);
  assert.match(snapshot, /Tailscale Bridge Usable: true/);
  assert.match(snapshot, /Bridge Memory Present: yes/);
  assert.match(snapshot, /Bridge Memory Validation State: awaiting-validation/);
  assert.match(snapshot, /Bridge Memory Reconciliation State: remembered-unreachable/);
  assert.match(snapshot, /Bridge Memory Reconciliation Provenance: remembered-tailscale-unreachable/);
  assert.match(snapshot, /Bridge Memory Persistence State: save-persisted/);
  assert.match(snapshot, /Bridge Memory Persistence Reason: Remembered tailscale Home Bridge config persisted to shared durable memory\./);
  assert.match(snapshot, /Bridge Memory Write Attempted: yes/);
  assert.match(snapshot, /Bridge Memory Write Succeeded: yes/);
  assert.match(snapshot, /Bridge Memory Read Attempted: yes/);
  assert.match(snapshot, /Bridge Memory Read Source: shared-runtime-memory/);
  assert.match(snapshot, /Bridge Memory Read Result: remembered-bridge/);
  assert.match(snapshot, /Bridge Memory Clobber Detected: no/);
  assert.match(snapshot, /Bridge Memory Storage Scope: shared-runtime-memory/);
  assert.match(snapshot, /Bridge Auto Revalidation State: unreachable/);
  assert.match(snapshot, /Remembered Home Bridge exists but is unreachable from this surface\./);
});

test('buildSupportSnapshot reports immediate hosted save persistence truth without waiting for validation loops', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: { appLaunchState: 'ready' },
    routeTruthView: { routeKind: 'home-node', backendReachableState: 'unknown', selectedRouteReachableState: 'unknown', routeUsableState: 'no' },
    runtimeContext: {
      bridgeTransportTruth: {
        selectedTransport: 'tailscale',
        configuredTransport: 'tailscale',
        source: 'bridgeTransport:tailscale',
        bridgeMemoryPresent: true,
        bridgeMemoryTransport: 'tailscale',
        bridgeMemoryUrl: 'https://desktop-9flonkj.taild6f215.ts.net',
        bridgeMemoryPersistenceState: 'save-persisted',
        bridgeMemoryPersistenceReason: 'Remembered tailscale Home Bridge config persisted to shared durable memory.',
        bridgeMemoryWriteAttempted: true,
        bridgeMemoryWriteSucceeded: true,
        bridgeMemoryReadAttempted: false,
        bridgeMemoryReadResult: 'none',
        bridgeMemoryStorageKey: 'stephanos.durable.memory.v2',
        bridgeMemoryStorageScope: 'shared-runtime-memory',
        bridgeMemoryLastRawValueSummary: 'normalized-memory:tailscale:https://desktop-9flonkj.taild6f215.ts.net',
      },
    },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-04-12T00:00:00.000Z'),
    origin: 'https://cheekyfellastef.github.io',
    href: 'https://cheekyfellastef.github.io/stephanos',
  });

  assert.match(snapshot, /Home Bridge Transport Selected: tailscale/);
  assert.match(snapshot, /Home Bridge Transport Configured: tailscale/);
  assert.match(snapshot, /Bridge Memory Transport: tailscale/);
  assert.match(snapshot, /Bridge Memory URL: https:\/\/desktop-9flonkj\.taild6f215\.ts\.net/);
  assert.match(snapshot, /Bridge Memory Write Attempted: yes/);
  assert.match(snapshot, /Bridge Memory Write Succeeded: yes/);
  assert.match(snapshot, /Bridge Memory Storage Key: stephanos\.durable\.memory\.v2/);
  assert.match(snapshot, /Bridge Memory Storage Scope: shared-runtime-memory/);
  assert.match(snapshot, /Bridge Memory Last Raw Value Summary: normalized-memory:tailscale:https:\/\/desktop-9flonkj\.taild6f215\.ts\.net/);
});

test('buildSupportSnapshot reports hosted save failures as attempted writes with explicit failure reason', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: { appLaunchState: 'ready' },
    routeTruthView: { routeKind: 'home-node', backendReachableState: 'unknown', selectedRouteReachableState: 'unknown', routeUsableState: 'no' },
    runtimeContext: {
      bridgeTransportTruth: {
        selectedTransport: 'tailscale',
        configuredTransport: 'none',
        source: 'bridgeTransport:unresolved',
        bridgeMemoryPresent: false,
        bridgeMemoryTransport: 'none',
        bridgeMemoryUrl: '',
        bridgeMemoryPersistenceState: 'save-clobbered',
        bridgeMemoryPersistenceReason: 'Shared durable memory write failed while persisting Home Bridge memory: simulated durable-memory failure',
        bridgeMemoryWriteAttempted: true,
        bridgeMemoryWriteSucceeded: false,
        bridgeMemoryReadAttempted: false,
        bridgeMemoryReadResult: 'none',
        bridgeMemoryStorageKey: 'stephanos.durable.memory.v2',
        bridgeMemoryStorageScope: 'shared-runtime-memory',
        bridgeMemoryLastRawValueSummary: 'normalized-memory:tailscale:https://desktop-9flonkj.taild6f215.ts.net',
      },
    },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-04-12T00:00:00.000Z'),
    origin: 'https://cheekyfellastef.github.io',
    href: 'https://cheekyfellastef.github.io/stephanos',
  });

  assert.match(snapshot, /Bridge Memory Persistence State: save-clobbered/);
  assert.match(snapshot, /Bridge Memory Persistence Reason: Shared durable memory write failed while persisting Home Bridge memory: simulated durable-memory failure/);
  assert.match(snapshot, /Bridge Memory Write Attempted: yes/);
  assert.match(snapshot, /Bridge Memory Write Succeeded: no/);
});

test('buildSupportSnapshot operator guidance calls out remembered tailscale revalidated promotion', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: { appLaunchState: 'ready' },
    routeTruthView: { routeKind: 'home-node', backendReachableState: 'yes', selectedRouteReachableState: 'yes', routeUsableState: 'yes' },
    runtimeContext: {
      bridgeTransportTruth: {
        bridgeMemoryReconciliationState: 'remembered-revalidated',
        bridgeMemoryReconciliationProvenance: 'remembered-tailscale-revalidated-as-tailscale',
      },
    },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-04-10T00:00:00.000Z'),
    origin: 'https://cheekyfellastef.github.io',
    href: 'https://cheekyfellastef.github.io/stephanos',
  });

  assert.match(snapshot, /Remembered Tailscale bridge revalidated successfully; hosted route is using the remembered Tailscale home-node bridge\./);
});

test('buildSupportSnapshot includes shared operator guidance summaries', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: { backendReachable: false },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    orchestrationTruth: {
      selectors: {
        currentMissionState: {
          missionPhase: 'awaiting-approval',
          intentSource: 'inferred',
          codexHandoffStatus: 'generated',
          validationStatus: 'not-run',
          lastHandoffAction: 'prepare-codex-handoff',
        },
        continuityLoopState: { strength: 'sparse', sparse: true },
        missionBlocked: true,
        blockageExplanation: 'Intent inferred with sparse continuity.',
        nextRecommendedAction: 'Confirm explicit mission objective.',
        buildAssistanceReadiness: { state: 'blocked', explanation: 'Mission is blocked by explicit truth constraints.' },
        approvalReadiness: 'awaiting-approval',
        codexHandoffReadiness: 'awaiting-approval',
        commandReadiness: {
          'accept-mission': { allowed: true, message: 'Mission can be accepted.' },
          'start-mission': { allowed: false, reason: 'mission-blocked', message: 'Start blocked.' },
        },
      },
      latestResponseEnvelope: {
        actionRequested: 'start-mission',
        actionAllowed: false,
        actionApplied: false,
        resultingLifecycleState: 'awaiting-approval',
        resultingBuildAssistanceState: 'blocked',
        nextRecommendedAction: 'Accept mission packet first.',
      },
    },
    now: { toISOString: () => '2026-03-25T00:00:09.000Z' },
  });

  assert.match(snapshot, /Orchestration Available Now: accept-mission/);
  assert.match(snapshot, /Orchestration Blocked Because: start-mission: mission-blocked/);
  assert.match(snapshot, /Orchestration Next Action: Confirm explicit mission objective\./);
  assert.match(snapshot, /Codex Pipeline Status: generated/);
  assert.match(snapshot, /Codex Validation Status: not-run/);
  assert.match(snapshot, /Latest Envelope Action Requested: start-mission/);
  assert.match(snapshot, /Latest Envelope Allowed: no/);
});

test('buildSupportSnapshot projects canonical source/dist alignment truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    orchestrationTruth: {
      canonicalSourceDistAlignment: {
        buildAlignmentState: 'stale',
        blockingSeverity: 'warning',
        alignmentReason: 'Hosted/runtime dist appears stale relative to expected build truth.',
        operatorActionRequired: true,
        operatorActionText: 'Run npm run stephanos:build, verify with npm run stephanos:verify, then push updated dist before trusting hosted runtime behavior.',
        distFingerprint: 'marker-old',
      },
    },
    now: { toISOString: () => '2026-03-25T00:00:10.000Z' },
  });

  assert.match(snapshot, /Build Alignment State: stale/);
  assert.match(snapshot, /Build Alignment Severity: warning/);
  assert.match(snapshot, /Build Alignment Action Required: yes/);
  assert.match(snapshot, /Dist Fingerprint \(served\): marker-old/);
});

test('buildSupportSnapshot reports remembered tailscale pending probe guidance', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { blockingIssues: [], invariantWarnings: [] },
    runtimeContext: {
      bridgeTransportTruth: {
        bridgeMemoryReconciliationState: 'remembered-awaiting-validation',
        bridgeMemoryTransport: 'tailscale',
        bridgeAutoRevalidationState: 'probing',
      },
    },
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /Remembered Tailscale bridge pending probe on this hosted surface/);
});

test('buildSupportSnapshot reports remembered tailscale pending transport configuration blocker', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { blockingIssues: [], invariantWarnings: [] },
    runtimeContext: {
      bridgeTransportTruth: {
        bridgeMemoryReconciliationState: 'remembered-awaiting-validation',
        bridgeMemoryReconciliationProvenance: 'remembered-tailscale-pending-transport-config',
        bridgeMemoryTransport: 'tailscale',
        bridgeAutoRevalidationState: 'probing',
      },
    },
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /transport configuration is not yet canonical\/accepted/);
});

test('buildSupportSnapshot reports remembered tailscale backend candidate rejection blocker', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { blockingIssues: [], invariantWarnings: [] },
    runtimeContext: {
      bridgeTransportTruth: {
        bridgeMemoryReconciliationState: 'remembered-awaiting-validation',
        bridgeMemoryReconciliationProvenance: 'remembered-candidate-not-yet-accepted',
        bridgeMemoryTransport: 'tailscale',
        bridgeAutoRevalidationState: 'probing',
      },
    },
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /backend target candidate is not yet accepted/);
});

test('buildSupportSnapshot reports bounded revalidation backoff with explicit operator action', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { blockingIssues: [], invariantWarnings: [] },
    runtimeContext: {
      bridgeTransportTruth: {
        bridgeMemoryReconciliationState: 'remembered-awaiting-validation',
        bridgeMemoryTransport: 'tailscale',
        bridgeAutoRevalidationState: 'backoff',
      },
    },
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /bounded backoff after retry exhaustion/i);
  assert.match(snapshot, /operator retries revalidation or updates bridge transport target/i);
});

test('buildSupportSnapshot reports hosted mixed-scheme execution incompatibility truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {
      selectedRouteKind: 'home-node',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'no',
      backendReachableState: 'yes',
    },
    runtimeSessionTruth: { sessionKind: 'hosted-web' },
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: { blockingIssues: [], invariantWarnings: [] },
    runtimeContext: {
      canonicalHostedRouteTruth: {
        backendTargetValidity: 'valid',
        selectedRouteKind: 'home-node',
        selectedRouteUsable: false,
        blockingIssues: [{
          code: 'hosted-backend-execution-incompatible',
          message: 'Hosted HTTPS frontend cannot execute HTTP Home Bridge fetches due browser mixed-content policy.',
        }],
      },
      bridgeTransportTruth: {
        bridgeMemoryReconciliationState: 'remembered-execution-incompatible',
        bridgeMemoryUrl: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        bridgeInputRaw: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        bridgeInputNormalized: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        bridgePersistedValue: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        bridgeRehydratedValue: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        bridgeProbeTarget: 'http://desktop-9flonkj.taild6f215.ts.net:8787',
        bridgeDirectReachability: 'reachable',
        bridgeHostedExecutionCompatibility: 'mixed-scheme-blocked',
        bridgeHostedExecutionRequirement: 'Publish the Home Bridge on HTTPS (or provide an HTTPS reverse proxy).',
        tailscale: {
          reason: 'Remembered Tailscale bridge preserved, but hosted execution is blocked by mixed-scheme browser policy.',
        },
      },
    },
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /hosted execution is blocked by browser security policy/);
  assert.match(snapshot, /Bridge Direct Reachability: reachable/);
  assert.match(snapshot, /Bridge Hosted Execution Compatibility: mixed-scheme-blocked/);
  assert.match(snapshot, /Bridge Input Raw: http:\/\/desktop-9flonkj\.taild6f215\.ts\.net:8787/);
  assert.match(snapshot, /Bridge Input Normalized: http:\/\/desktop-9flonkj\.taild6f215\.ts\.net:8787/);
  assert.match(snapshot, /Bridge Persisted Value: http:\/\/desktop-9flonkj\.taild6f215\.ts\.net:8787/);
  assert.match(snapshot, /Bridge Rehydrated Value: http:\/\/desktop-9flonkj\.taild6f215\.ts\.net:8787/);
  assert.match(snapshot, /Bridge Probe Target: http:\/\/desktop-9flonkj\.taild6f215\.ts\.net:8787/);
  assert.match(snapshot, /Tailscale Bridge Reason: Remembered Tailscale bridge preserved, but hosted execution is blocked by mixed-scheme browser policy\./);
});

test('buildSupportSnapshot reports mission bridge diagnostics fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    missionBridgeTruth: {
      state: 'awaiting-approval',
      lastAiRouterRequestSource: 'mission-bridge',
      latestSubmissionConsole: 'agent-mission-console',
      latestSubmissionRoute: 'mission-bridge',
      lastAiResponseRoutedToMissionConsole: true,
      localDesktopAgentGatePassed: true,
      missionPacketGeneratedFromOperatorIntent: true,
      events: [{ type: 'mission-created' }, { type: 'ai-response-received' }],
    },
  });

  assert.match(snapshot, /Mission Bridge State: awaiting-approval/);
  assert.match(snapshot, /Mission Bridge Last Event: ai-response-received/);
  assert.match(snapshot, /Mission Bridge Last AI Router Request Source: mission-bridge/);
  assert.match(snapshot, /Mission Bridge Latest Submission Console: agent-mission-console/);
  assert.match(snapshot, /Mission Bridge Latest Submission Route: mission-bridge/);
  assert.match(snapshot, /Latest Command Submission Console: stephanos-mission-console/);
  assert.match(snapshot, /Latest Command Submission Route: assistant-router/);
  assert.match(snapshot, /Mission Bridge Last AI Response Routed To Mission Console: yes/);
  assert.match(snapshot, /Mission Bridge Local Desktop Agent Gate Passed: yes/);
  assert.match(snapshot, /Mission Bridge Mission Packet From Operator Intent: yes/);
});

test('support snapshot reflects mission packet generation from submitted operator intent', () => {
  const missionBridgeTruth = processMissionBridgeIntent({
    operatorIntent: 'Repair mission bridge activation and runtime truth gating.',
    finalRouteTruth: {
      routeLayerStatus: 'healthy',
      backendExecutionContractStatus: 'validated',
      providerExecutionGateStatus: 'open',
      routeUsableState: 'yes',
    },
  });
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    missionBridgeTruth,
  });

  assert.match(snapshot, /Mission Bridge State: /);
  assert.match(snapshot, /Mission Bridge Last Event: /);
  assert.match(snapshot, /Mission Bridge Mission Packet From Operator Intent: yes/);
});

test('buildSupportSnapshot snapshot: streaming preference on reports requested true via operator-on source', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastStreamingModePreference: 'on',
      lastStreamingRequested: true,
      lastStreamingRequestSource: 'operator-on',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /Streaming Mode Preference: on/);
  assert.match(snapshot, /Streaming Requested: true/);
  assert.match(snapshot, /Streaming Request Source: operator-on/);
});

test('buildSupportSnapshot snapshot: heavy ollama auto-stream truth surfaces canonical fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastStreamingModePreference: 'auto',
      lastStreamingRequested: true,
      lastStreamingRequestSource: 'auto-heavy-ollama',
      lastStreamingPolicyDecision: 'stream-enabled',
      lastStreamingPolicyReason: 'Auto mode enabled streaming for heavy Ollama model to prevent UI request timeout false failures.',
      lastStreamingSupported: true,
      lastStreamingUsed: true,
      lastStreamingProvider: 'ollama',
      lastStreamingModel: 'gpt-oss:20b',
      lastStreamingFinalized: true,
      lastStreamingFallbackReason: 'n/a',
      lastTimeoutFailureLayer: 'n/a',
      lastTimeoutFailureLabel: 'n/a',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /Streaming Mode Preference: auto/);
  assert.match(snapshot, /Streaming Requested: true/);
  assert.match(snapshot, /Streaming Request Source: auto-heavy-ollama/);
  assert.match(snapshot, /Streaming Policy Decision: stream-enabled/);
  assert.match(snapshot, /Streaming Supported: true/);
  assert.match(snapshot, /Streaming Used: true/);
  assert.match(snapshot, /Streaming Provider: ollama/);
  assert.match(snapshot, /Streaming Model: gpt-oss:20b/);
  assert.match(snapshot, /Streaming Finalized: true/);
  assert.match(snapshot, /Streaming Fallback Reason: n\/a/);
  assert.match(snapshot, /Last Timeout Failure Layer: n\/a/);
});

test('buildSupportSnapshot snapshot: partial-success SSE metadata keeps requested and provider/model truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      executionTruth: 'ok:ollama',
      executionStatus: 'ok:ollama',
      lastActualProviderUsed: 'ollama',
      lastModelUsed: 'gpt-oss:20b',
      lastStreamingRequested: true,
      lastStreamingRequestSource: 'auto-heavy-ollama',
      lastStreamingPolicyDecision: 'stream-enabled',
      lastStreamingSupported: true,
      lastStreamingUsed: true,
      lastStreamingProvider: 'ollama',
      lastStreamingModel: 'gpt-oss:20b',
      lastStreamingFinalized: false,
      lastStreamingCompletionQuality: 'partial-success',
      lastFinalMetadataMissing: true,
      lastStreamingFallbackReason: 'stream-ended-before-final-metadata',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });

  assert.match(snapshot, /Execution Truth: ok:ollama/);
  assert.match(snapshot, /Execution Status: ok:ollama/);
  assert.match(snapshot, /Streaming Requested: true/);
  assert.match(snapshot, /Streaming Request Source: auto-heavy-ollama/);
  assert.match(snapshot, /Streaming Policy Decision: stream-enabled/);
  assert.match(snapshot, /Streaming Supported: true/);
  assert.match(snapshot, /Streaming Used: true/);
  assert.match(snapshot, /Streaming Provider: ollama/);
  assert.match(snapshot, /Streaming Model: gpt-oss:20b/);
  assert.match(snapshot, /Streaming Finalized: false/);
  assert.match(snapshot, /Streaming Completion Quality: partial-success/);
  assert.match(snapshot, /Final Metadata Missing: true/);
  assert.match(snapshot, /Streaming Completion State: partial-success/);
  assert.match(snapshot, /Streaming Fallback Reason: stream-ended-before-final-metadata/);
  assert.match(snapshot, /Last Actual Provider Used: ollama/);
  assert.match(snapshot, /Last Model Used: gpt-oss:20b/);
});

test('buildSupportSnapshot snapshot: streaming completion state distinguishes failed and fully-finalized paths', () => {
  const failedSnapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastStreamingUsed: true,
      lastStreamingFinalized: false,
      lastStreamingFallbackReason: 'sse-opened-no-valid-events',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });
  assert.match(failedSnapshot, /Streaming Completion State: failed/);

  const finalizedSnapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastStreamingUsed: true,
      lastStreamingFinalized: true,
      lastStreamingCompletionQuality: 'fully-finalized',
      lastStreamingFallbackReason: 'n/a',
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });
  assert.match(finalizedSnapshot, /Streaming Completion State: fully-finalized/);
});

test('buildSupportSnapshot includes UI reality diagnostics fields when available', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: { appLaunchState: 'ready' },
    uiReality: {
      panesMissingCollapseControls: ['mission-console'],
      moveControlGroups: [{}, {}],
      totalFirstClassPanes: 1,
      panesMissingMoveControls: [],
      totalMoveControlsVisible: 2,
      metadata: { sourceDistAlignment: 'mismatch' },
      copyButtons: [{ id: 'copy-support-snapshot' }],
      renderedPaneOrder: ['aiConsole', 'missionConsolePanel'],
      domPaneOrder: ['commandDeck', 'missionConsolePanel'],
      layout: { mode: 'default' },
      agentMissionConsoleOuter: { bodyVisible: true },
      paneShells: [{ panelId: 'commandDeck', bodyVisible: true }, {}],
      aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
      dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
    },
  });
  assert.match(snapshot, /UI Reality Status: FAIL/);
  assert.match(snapshot, /UI Reality Reason: source-dist-mismatch/);
  assert.match(snapshot, /UI Reality Missing Collapse Controls: 1/);
  assert.match(snapshot, /UI Reality Missing Collapse Control IDs: mission-console/);
  assert.match(snapshot, /UI Reality Missing Collapse Control Titles: mission-console/);
  assert.match(snapshot, /UI Reality Move Control Detail State: visible/);
  assert.match(snapshot, /UI Reality Orphan Move Control Count: 0/);
  assert.match(snapshot, /UI Reality Duplicate Move Control Count: 1/);
  assert.match(snapshot, /UI Reality Source\/Dist Alignment: mismatch/);
  assert.match(snapshot, /UI Reality Diagnostics Available: yes/);
  assert.match(snapshot, /UI Reality AI Core Mission Console Configured: yes/);
  assert.match(snapshot, /UI Reality AI Core Mission Console Panel ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /UI Reality AI Core Mission Console Rendered: yes/);
  assert.match(snapshot, /UI Reality AI Core Mission Console Visible: yes/);
  assert.match(snapshot, /UI Reality Dedicated Mission Console Rendered: yes/);
  assert.match(snapshot, /UI Reality Dedicated Mission Console Visible: yes/);
  assert.match(snapshot, /UI Reality Rendered Pane Order: commandDeck, missionConsolePanel/);
  assert.match(snapshot, /UI Reality Canonical Pane Order Source: dom-pane-shell-order/);
  assert.match(snapshot, /UI Reality Command Deck Order Detection Source: dom-pane-shell-order/);
  assert.match(snapshot, /UI Reality AI Chat Command Deck Found In DOM Order: yes/);
  assert.match(snapshot, /UI Reality AI Chat Command Deck Found In State Order: no/);
  assert.match(snapshot, /UI Reality Mission Console Multi-Surface Status: OK/);
});

test('buildSupportSnapshot includes WARN\/UNKNOWN UI reality section when diagnostics missing', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: {} });
  assert.match(snapshot, /UI Reality Status: WARN/);
  assert.match(snapshot, /UI Reality Reason: ui-reality-unavailable/);
  assert.match(snapshot, /UI Reality Browser Proof State: needs operator proof/);
  assert.match(snapshot, /UI Reality Diagnostics Available: no/);
});


test('support snapshot projects compact repo architecture context fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { repoArchitectureAffectedSubsystemCount: '3', repoArchitectureAffectedSubsystems: 'mission-console|intent-to-build|support-snapshot', repoArchitectureLikelyTestCount: '2', repoArchitectureGeneratedOutputTouched: 'yes', repoArchitectureSourceTruthWarning: 'apps/stephanos/dist is generated output, not source truth.', repoArchitectureRiskLevel: 'mission-console:high' } });
  assert.match(snapshot, /repoarchitectureaffectedsubsystemcount|Mission/i);
});


test('support snapshot projects mission verification judgment fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { missionVerificationJudgment: 'proof_pending' } });
  assert.match(snapshot, /Mission Verification Judgment: proof_pending/);
});


test('support snapshot projects memory librarian counts', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { memoryLibrarianPendingCount: '3', memoryLibrarianApprovalRequiredCount: '2', memoryLibrarianConflictCount: '1' } });
  assert.match(snapshot, /Memory Librarian Pending Count: 3/);
  assert.match(snapshot, /Memory Librarian Approval Required Count: 2/);
  assert.match(snapshot, /Memory Librarian Conflict Count: 1/);
});


test('support snapshot projects mission evidence ledger fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { missionEvidenceLedgerEntryCount: '9', missionEvidenceLedgerWarningCount: '2', missionEvidenceLedgerBlockerCount: '1', missionEvidenceLedgerPendingReviewCount: '3', missionEvidenceCompleteness: 'partial', missionEvidenceLatestEvent: 'verification_judged', missionEvidenceNextRequired: 'operator_decision_required' } });
  assert.match(snapshot, /Mission Evidence Ledger Entry Count: 9/);
  assert.match(snapshot, /Mission Evidence Completeness: partial/);
  assert.match(snapshot, /Mission Evidence Next Required: operator_decision_required/);
});

test('support snapshot projects mission command packet fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { missionCommandPacketVersion: 'v1', missionCommandPacketCreated: '2026-05-05T00:00:00.000Z', missionCommandPacketIncludedSystems: 'memory|architecture|verification', missionCommandPacketWarningCount: '2', missionCommandPacketNextAction: 'Resolve operator decisions.', missionCommandPacketReady: 'yes' } });
  assert.match(snapshot, /Mission Command Packet Version: v1/);
  assert.match(snapshot, /Mission Command Packet Included Systems: memory\|architecture\|verification/);
  assert.match(snapshot, /Mission Command Packet Ready: yes/);
});

test('support snapshot projects agent assignment matrix fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { agentAssignmentCount: '8', agentAssignmentActiveRoles: '8', agentAssignmentLeadRole: 'codex_builder', agentAssignmentOpenClawAssigned: 'no', agentAssignmentCodexAssigned: 'yes', agentAssignmentOperatorApprovalRequired: 'yes', agentAssignmentHighRiskCount: '1', agentAssignmentBlockedCount: '2' } });
  assert.match(snapshot, /Agent Assignment Count: 8/);
  assert.match(snapshot, /Agent Assignment Lead Role: codex_builder/);
  assert.match(snapshot, /Agent Assignment Operator Approval Required: yes/);
});


test('support snapshot projects mission routing readiness fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { missionRoutingStatus: 'ready_for_codex', missionRoutingRecommendedRoute: 'codex_handoff', missionRoutingReadinessLevel: 'ready', missionRoutingLeadRole: 'codex_builder', missionRoutingCodexReady: 'yes', missionRoutingOpenClawResearchReady: 'no', missionRoutingOperatorDecisionRequired: 'no', missionRoutingBlockerCount: '0', missionRoutingWarningCount: '1', missionRoutingNextAction: 'Send bounded handoff.' } });
  assert.match(snapshot, /Mission Routing Status: ready_for_codex/);
  assert.match(snapshot, /Mission Routing Recommended Route: codex_handoff/);
});


test('buildSupportSnapshot marks mission console multi-surface FAIL when AI Core console missing', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: { appLaunchState: 'ready' },
    uiReality: {
      paneShells: [{}],
      panesMissingCollapseControls: [],
      moveControlGroups: [{}],
      totalFirstClassPanes: 1,
      panesMissingMoveControls: [],
      totalMoveControlsVisible: 1,
      metadata: { sourceDistAlignment: 'aligned' },
      copyButtons: [],
      layout: { mode: 'default' },
      agentMissionConsoleOuter: { bodyVisible: true },
      aiCoreMissionConsole: { configured: false, rendered: false, visible: false, panelId: 'aiCoreMissionConsolePanel', forceOpen: true },
      dedicatedMissionConsole: { rendered: true, visible: true, panelId: 'missionConsolePanel' },
    },
  });
  assert.match(snapshot, /UI Reality Mission Console Multi-Surface Status: FAIL/);
  assert.match(snapshot, /UI Reality Mission Console Next Action: Restore missing Mission Console surface via canonical MissionConsoleTile mount path\./);
});

test('support snapshot reads chat_context_* fields from latest execution metadata', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        request_execution_id: 'req_123',
        chat_context_pack_status: 'active',
        chat_context_version: 'v1',
        chat_context_response_mode: 'merge-decision',
        chat_context_relevant_canon_count: 5,
        chat_context_affected_subsystems: 'codex|pr|merge',
        chat_context_sources_used: 'uiRealityStatus|missionState',
        chat_context_ui_reality_status: 'OK',
        chat_context_mission_state: 'draft',
        chat_context_next_action: 'Collect merge proof before deciding',
        chat_context_warning_count: 0,
        chat_context_warnings: 'none',
        chat_context_attachment_probe: 'attached-at-final-execution-metadata',
        chat_context_attachment_probe_response_mode: 'merge-decision',
        chat_context_raw_operator_message_seen: 'do I merge this PR?',
        chat_context_normalized_operator_message: 'do i merge this pr',
        chat_context_intent_classifier_matched_rule: 'merge-decision',
        chat_context_match_input: 'do i merge this pr',
        chat_context_merge_rule_pattern: 'contains: merge + any(pr|pull request|this|this one|this pr|should i|do i|can i)',
        chat_context_merge_rule_test_result: 'yes',
        chat_context_first_matching_rule: 'merge-decision',
        chat_context_evaluated_rule_results: 'merge-decision:1,direct-answer:0',
        chat_context_build_source: 'stephanos-mission-console',
        chat_context_default_pack_used: 'no',
        chat_context_was_overwritten: 'no',
      },
    },
  });
  assert.match(snapshot, /Chat Context Pack Status: active/);
  assert.match(snapshot, /Chat Context Response Mode: merge-decision/);
  assert.match(snapshot, /Chat Context Relevant Canon Count: 5/);
  assert.match(snapshot, /Chat Context Metadata Source: final-execution-metadata/);
  assert.match(snapshot, /Chat Context Final Execution Metadata Present: yes/);
  assert.match(snapshot, /Chat Context Attachment Probe Present: yes/);
  assert.match(snapshot, /Chat Context Attachment Probe Response Mode: merge-decision/);

  assert.match(snapshot, /Chat Context Raw Operator Message Seen: do I merge this PR\?/);
  assert.match(snapshot, /Chat Context Normalized Operator Message: do i merge this pr/);
  assert.match(snapshot, /Chat Context Intent Classifier Matched Rule: merge-decision/);
  assert.match(snapshot, /Chat Context Match Input: do i merge this pr/);
  assert.match(snapshot, /Chat Context Merge Rule Test Result: yes/);
  assert.match(snapshot, /Chat Context First Matching Rule: merge-decision/);
  assert.match(snapshot, /Chat Context Build Source: stephanos-mission-console/);
  assert.match(snapshot, /Chat Context Default Pack Used: no/);
  assert.match(snapshot, /Chat Context Was Overwritten: no/);
});

test('support snapshot prints project awareness fields from final execution metadata for mission-planning prompts', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        request_execution_id: 'req_mission_awareness',
        chat_context_response_mode: 'mission-planning',
        chat_context_sources_used: 'missionIntelligence|projectAwareness',
        chat_context_mission_state: 'known',
        project_awareness_pack_status: 'available',
        project_awareness_sources_used: 'missionIntelligence|projectIntentPack',
        project_awareness_current_mission: 'Preserve main-first/main-only operator workflow while hardening truth-preserving mission execution.',
        project_awareness_next_best_action: 'Preserve project awareness through final execution metadata attachment.',
        project_awareness_operator_workflow_preference: 'Operator prefers main-first/main-only simplicity.',
        project_awareness_codex_role: 'Codex executes bounded source-only changes with proof.',
        project_awareness_openclaw_role: 'OpenClaw orchestrates approval-gated execution through shared truth contracts.',
        project_awareness_warning_count: 0,
      },
    },
  });
  assert.match(snapshot, /Chat Context Response Mode: mission-planning/);
  assert.match(snapshot, /Chat Context Sources Used: missionIntelligence\|projectAwareness/);
  assert.match(snapshot, /Project Awareness Pack Status: available/);
  assert.match(snapshot, /Project Awareness Sources Used: missionIntelligence\|projectIntentPack/);
  assert.match(snapshot, /Project Awareness Current Mission: Preserve main-first\/main-only operator workflow while hardening truth-preserving mission execution\./);
  assert.match(snapshot, /Project Awareness Next Best Action: Preserve project awareness through final execution metadata attachment\./);
  assert.match(snapshot, /Project Awareness Operator Workflow Preference: Operator prefers main-first\/main-only simplicity\./);
  assert.match(snapshot, /Project Awareness Codex Role: Codex executes bounded source-only changes with proof\./);
  assert.match(snapshot, /Project Awareness OpenClaw Role: OpenClaw orchestrates approval-gated execution through shared truth contracts\./);
});

test('support snapshot reads chat context for stephanos-mission-console latest execution path', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastCommandSubmissionConsole: 'stephanos-mission-console',
      lastExecutionMetadata: {
        request_execution_id: 'req_live_console',
        execution_status: 'ok:ollama',
        submission_console: 'stephanos-mission-console',
        submission_route: 'assistant-router',
        chat_context_pack_status: 'active',
        chat_context_version: 'v1',
        chat_context_response_mode: 'merge-decision',
        chat_context_relevant_canon_count: 4,
        chat_context_affected_subsystems: 'support-snapshot|mission-console',
        chat_context_sources_used: 'uiRealityStatus|routeTruth|missionState',
        chat_context_ui_reality_status: 'OK',
        chat_context_mission_state: 'draft',
        chat_context_next_action: 'Collect build/verify/ui proof before merge decision.',
      },
    },
  });
  assert.match(snapshot, /Latest Command Submission Console: stephanos-mission-console/);
  assert.match(snapshot, /Chat Context Pack Status: active/);
  assert.match(snapshot, /Chat Context Version: v1/);
  assert.match(snapshot, /Chat Context Response Mode: merge-decision/);
  assert.match(snapshot, /Chat Context Sources Used: uiRealityStatus\|routeTruth\|missionState/);
});


test('support snapshot prefers final execution chat context over stale runtime chat context defaults', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      chatContextPackStatus: 'unavailable',
      chatContextResponseMode: 'direct-answer',
      lastExecutionMetadata: {
        request_execution_id: 'req_prefer_final',
        execution_status: 'ok:ollama',
        chat_context_pack_status: 'active',
        chat_context_version: 'v1',
        chat_context_response_mode: 'merge-decision',
        chat_context_relevant_canon_count: 3,
      },
    },
  });
  assert.match(snapshot, /Chat Context Pack Status: active/);
  assert.match(snapshot, /Chat Context Response Mode: merge-decision/);
  assert.match(snapshot, /Chat Context Metadata Source: final-execution-metadata/);
});


test('support snapshot projects merge proof fields over stale top-level direct-answer defaults', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      uiRealityStatus: 'OK',
      lastExecutionMetadata: {
        request_execution_id: 'req_merge_projection',
        chat_context_pack_status: 'unavailable',
        chat_context_response_mode: 'direct-answer',
        chat_context_relevant_canon_count: 0,
        chat_context_affected_subsystems: 'none',
        chat_context_sources_used: 'none',
        chat_context_ui_reality_status: 'UNKNOWN',
        chat_context_next_action: 'Answer directly with bounded confidence.',
        chat_context_intent_classifier_matched_rule: 'merge-decision',
        chat_context_merge_rule_test_result: 'yes',
        chat_context_default_pack_used: 'no',
        chat_context_classifier_proof_source: 'rebuilt-from-final-message',
        chat_context_evaluated_rule_results: 'merge-decision:1,direct-answer:0',
      },
    },
  });

  assert.match(snapshot, /Chat Context Pack Status: active/);
  assert.match(snapshot, /Chat Context Response Mode: merge-decision/);
  assert.match(snapshot, /Chat Context Relevant Canon Count: 1/);
  assert.match(snapshot, /Chat Context Affected Subsystems: merge\|pr\|codex\|proof\|source-truth/);
  assert.match(snapshot, /Chat Context Sources Used: rebuilt-from-final-message/);
  assert.match(snapshot, /Chat Context UI Reality Status: OK/);
  assert.match(snapshot, /Chat Context Next Action: Collect merge\/proof evidence and decide merge readiness\./);
});

test('support snapshot keeps direct-answer fallback for generic prompts without merge proof', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        chat_context_pack_status: 'unavailable',
        chat_context_response_mode: 'direct-answer',
        chat_context_default_pack_used: 'yes',
        chat_context_intent_classifier_matched_rule: 'direct-answer',
        chat_context_merge_rule_test_result: 'no',
      },
    },
  });
  assert.match(snapshot, /Chat Context Pack Status: unavailable/);
  assert.match(snapshot, /Chat Context Response Mode: direct-answer/);
});

test('support snapshot projects provider registry fields for active merge-decision context', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        chat_context_pack_status: 'active',
        chat_context_response_mode: 'merge-decision',
        chat_context_provider_registry_status: 'active',
        chat_context_provider_ids_registered: 'uiReality|runtimeTruth|providerTruth|missionState|proofState|canonRules|memoryContinuity|agentState',
        chat_context_provider_ids_used: 'uiReality|proofState|canonRules|runtimeTruth|providerTruth|missionState',
        chat_context_provider_warning_count: 0,
        chat_context_provider_proof_state: '{"uiReality":"OK"}',
        chat_context_provider_next_actions: 'Collect build/verify/UI proof and amend the open PR before deciding merge.',
        chat_context_provider_canon_links_count: 3,
      },
    },
  });
  assert.match(snapshot, /Context Provider Registry Status: active/);
  assert.match(snapshot, /Context Providers Registered: uiReality\|runtimeTruth\|providerTruth\|missionState\|proofState\|canonRules\|memoryContinuity\|agentState/);
  assert.match(snapshot, /Context Providers Used: uiReality\|proofState\|canonRules\|runtimeTruth\|providerTruth\|missionState/);
  assert.match(snapshot, /Context Provider Canon Links Count: 3/);
});

test('support snapshot reports warning when command executed without chat context metadata', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        request_execution_id: 'req_124',
        execution_status: 'ok:ollama',
        retrieval_query: 'do I merge this PR?',
      },
    },
  });
  assert.match(snapshot, /Chat Context Pack Status: warning/);
  assert.match(snapshot, /Chat Context Warning Count: 1/);
  assert.match(snapshot, /Chat Context Warnings: command executed without chat context metadata/);
  assert.doesNotMatch(snapshot, /Chat Context Pack Status: unavailable/);
  assert.match(snapshot, /Chat Context Metadata Source: none/);
  assert.match(snapshot, /Chat Context Dropped Before Snapshot: yes/);
  assert.match(snapshot, /Chat Context Attachment Probe Present: no/);
  assert.match(snapshot, /Chat Context Metadata Found In: none/);
});

test('support snapshot unavailable next action does not require commandDeck route identity', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: {} });
  assert.match(snapshot, /Chat Context Next Action: Submit an operator command to generate context pack\./);
  assert.doesNotMatch(snapshot, /Submit a Command Deck message/);
});


test('execution metadata fixture with retrieval_query also includes chat_context_pack_status', () => {
  const fixture = {
    retrieval_query: 'do I merge this PR?',
    chat_context_pack_status: 'active',
  };
  assert.equal(fixture.chat_context_pack_status, 'active');
});

test('execution metadata fixture with execution_status also includes chat_context_pack_status', () => {
  const fixture = {
    execution_status: 'ok:ollama',
    chat_context_pack_status: 'active',
  };
  assert.equal(fixture.chat_context_pack_status, 'active');
});

test('support snapshot projects rebuilt-from-final-message classifier proof fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        chat_context_pack_status: 'active',
        chat_context_classifier_proof_source: 'rebuilt-from-final-message',
        chat_context_rebuilt_at_final_attachment: 'yes',
        chat_context_rebuild_source_field: 'retrieval_query',
      },
    },
  });
  assert.match(snapshot, /Chat Context Classifier Proof Source: rebuilt-from-final-message/);
  assert.match(snapshot, /Chat Context Rebuilt At Final Attachment: yes/);
  assert.match(snapshot, /Chat Context Rebuild Source Field: retrieval_query/);
});

test('support snapshot reports context provider registry fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { chatContextPackStatus: 'active' } });
  assert.match(snapshot, /Context Provider Registry Status:/);
  assert.match(snapshot, /Context Providers Registered:/);
  assert.match(snapshot, /Context Providers Used:/);
  assert.match(snapshot, /Context Provider Warning Count:/);
  assert.match(snapshot, /Context Provider Next Actions:/);
});

test('support snapshot projects context provider registry fields from execution metadata', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      chatContextPackStatus: 'active',
      chatContextResponseMode: 'merge-decision',
      lastExecutionMetadata: {
        chat_context_provider_registry_status: 'active',
        chat_context_provider_ids_registered: 'uiReality|runtimeTruth|providerTruth|missionState|proofState|canonRules|memoryContinuity|agentState',
        chat_context_provider_ids_used: 'uiReality|proofState|canonRules|runtimeTruth|providerTruth|missionState',
        chat_context_provider_warning_count: 1,
        chat_context_provider_proof_state: '{"proofState":"OK"}',
        chat_context_provider_next_actions: 'Collect build proof',
        chat_context_provider_canon_links_count: 2,
      },
    },
    routeTruthView: { routeKind: 'cloud', routeUsableState: 'yes', backendReachableState: 'yes', selectedRouteReachableState: 'yes' },
  });
  assert.match(snapshot, /Context Provider Registry Status: active/);
  assert.match(snapshot, /Context Providers Registered: uiReality\|runtimeTruth\|providerTruth\|missionState\|proofState\|canonRules\|memoryContinuity\|agentState/);
  assert.match(snapshot, /Context Providers Used: uiReality\|proofState\|canonRules\|runtimeTruth\|providerTruth\|missionState/);
  assert.match(snapshot, /Context Provider Canon Links Count: 2/);
});

test('Support Snapshot reports active command envelope when command_envelope_* fields are present', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      chatContextPackStatus: 'active',
      chatContextResponseMode: 'merge-decision',
      chatContextProviderIdsUsed: 'uiReality|proofState|canonRules',
      chatContextUiRealityStatus: 'OK',
      lastExecutionMetadata: {
        command_envelope_status: 'active',
        command_envelope_version: 'command-envelope.v1',
        command_envelope_id: 'env_123',
        command_envelope_submission_source: 'stephanos-mission-console',
        command_envelope_submission_route: 'assistant-router',
        command_envelope_response_mode: 'merge-decision',
        command_envelope_context_providers_used: 'uiReality|proofState|canonRules',
        command_envelope_execution_status: 'ok',
        command_envelope_actual_provider: 'ollama',
        command_envelope_actual_model: 'llama3.2:3b',
        command_envelope_proof_status: 'pending',
        command_envelope_ui_reality_status: 'OK',
        command_envelope_warnings: 'none',
      },
    },
  });
  assert.match(snapshot, /Command Envelope Status: active/);
  assert.match(snapshot, /Command Envelope Version: command-envelope.v1/);
  assert.match(snapshot, /Command Envelope UI Reality Status: OK/);
});

test('Support Snapshot reports command-envelope-missing when envelope metadata is absent', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { chatContextPackStatus: 'active' } });
  assert.match(snapshot, /Command Envelope Warnings: command-envelope-missing/);
});

test('buildSupportSnapshot normalizes route-blocked execution truth and envelope/provider model fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      executionTruth: 'gemini answered',
      lastExecutableProvider: 'gemini',
      lastActualProviderUsed: 'gemini',
      lastActualModelUsed: 'gemini-2.5-flash',
      lastModelUsed: 'gemini-2.5-flash',
      lastTimeoutEffectiveProvider: 'gemini',
      lastTimeoutEffectiveModel: 'gemini-2.5-flash',
      actualTargetUsed: 'http://192.168.0.198:8787',
      lastExecutionMetadata: {
        provider_execution_gate_status: 'blocked-by-route',
        command_pipeline_last_failure_reason: 'ROUTE_UNAVAILABLE',
        command_envelope_actual_provider: 'gemini',
        command_envelope_actual_model: 'gemini-2.5-flash',
      },
    },
    routeTruthView: {
      actualTarget: 'http://192.168.0.198:8787',
      executedProvider: 'gemini',
      fallbackActive: true,
    },
    runtimeContext: {
      backendTargetResolvedUrl: 'http://192.168.0.198:8787',
    },
  });
  assert.match(snapshot, /Active Provider: none/);
  assert.match(snapshot, /Fallback Active: no/);
  assert.match(snapshot, /Last Executable Provider: none/);
  assert.match(snapshot, /Last Actual Provider Used: none/);
  assert.match(snapshot, /Command Envelope Actual Provider: none/);
  assert.match(snapshot, /Command Envelope Actual Model: n\/a/);
  assert.match(snapshot, /Execution Truth: blocked-before-provider \/ no-provider-executed/);
  assert.match(snapshot, /Last Actual Model Used: n\/a/);
  assert.match(snapshot, /Last Model Used: n\/a/);
  assert.match(snapshot, /Last Timeout Effective Provider: none/);
  assert.match(snapshot, /Last Timeout Effective Model: n\/a/);
  assert.match(snapshot, /Actual Target Used: n\/a/);
  assert.match(snapshot, /Backend Target Resolved URL: n\/a/);
});

test('buildSupportSnapshot treats stale ROUTE_UNAVAILABLE metadata as historical when route is currently healthy', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      executionTruth: 'ok:ollama',
      chatContextPackStatus: 'active',
      lastExecutionMetadata: {
        provider_execution_gate_status: 'blocked-by-route',
        command_pipeline_last_failure_reason: 'ROUTE_UNAVAILABLE',
        response_planner_status: 'active',
      },
    },
    routeTruthView: {
      routeLayerStatus: 'healthy',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      backendReachableState: 'yes',
      executedProvider: 'ollama',
      fallbackActive: false,
    },
    safeApiStatus: {
      backendReachable: false,
    },
  });

  assert.match(snapshot, /Backend Reachable: yes/);
  assert.match(snapshot, /Last Route Failure Is Historical: yes/);
  assert.match(snapshot, /Command Pipeline Last Failure Reason: none/);
  assert.match(snapshot, /Historical Command Failure Reason: ROUTE_UNAVAILABLE/);
  assert.match(snapshot, /Current Command Pipeline State: idle \/ no-current-failure/);
  assert.match(snapshot, /Current Provider Execution Truth: none \/ idle \/ not-executed/);
  assert.match(snapshot, /Active Provider: none/);
  assert.match(snapshot, /Fallback Active: no/);
  assert.match(snapshot, /Last Executable Provider: none/);
  assert.match(snapshot, /Last Actual Provider Used: none/);
  assert.match(snapshot, /Last Actual Model Used: n\/a/);
  assert.match(snapshot, /Last Timeout Effective Provider: none/);
  assert.match(snapshot, /Last Timeout Effective Model: n\/a/);
  assert.match(snapshot, /Execution Truth: none \/ idle \/ not-executed/);
  assert.match(snapshot, /Provider Mismatch: historical-stale-provider-suppressed/);
  assert.match(snapshot, /Executable Provider: none/);
  assert.doesNotMatch(snapshot, /Execution Truth: blocked-before-provider \/ no-provider-executed/);
  assert.match(snapshot, /Response Planner Status: active/);
  assert.match(snapshot, /Chat Context Pack Status: active/);
});



test('support snapshot projects identity recall and operator name usage from identity-recall planner mode', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      chatContextResponseMode: 'identity-recall',
      uiDiagnostics: {
        aiConsoleAnswerScroll: {
          requested: 'yes',
          requestReason: 'latest-assistant-answer-finalized',
          targetKind: 'latest-assistant-answer-pane',
          targetId: 'assistant-1',
          targetFound: 'yes',
          containerKind: 'answer-history-container',
          containerFound: 'yes',
          containerScrollable: 'yes',
          method: 'container.scrollTo(computed,auto)',
          previousScrollTop: '12',
          nextScrollTop: '280',
          completed: 'yes',
          topVisible: 'yes',
          bottomVisible: 'yes',
          fullyVisible: 'yes',
          occlusionReason: 'none',
          lastRequestedAt: '2026-05-22T00:00:00.000Z',
          lastCompletedAt: '2026-05-22T00:00:00.100Z',
        },
      },
      lastExecutionMetadata: {
        response_planner_status: 'active',
        response_planner_response_mode: 'identity-recall',
        response_planner_answer_shape: 'identity-recall',
        response_planner_identity_prompt_injected: 'yes',
        operator_profile_prompt_line_present: 'yes',
        final_answer_used_operator_profile: 'yes',
        identity_recall_deterministic_answer_used: 'yes',
        command_pipeline_last_submit_accepted: 'yes',
        command_pipeline_last_user_message_recorded: 'yes',
        command_pipeline_last_assistant_answer_generated: 'yes',
        command_pipeline_last_answer_pane_rendered: 'yes',
        command_pipeline_last_failure_reason: 'none',
        command_pipeline_last_finalization_path: 'deterministic-identity',
        command_pipeline_last_input_cleared: 'yes',
        command_pipeline_last_input_restore_available: 'no',
        chat_context_operator_name_known: 'yes',
        command_envelope_operator_name: 'Stephan',
        command_envelope_operator_profile_used: 'yes',
      },
    },
  });

  assert.match(snapshot, /Response Planner Response Mode: identity-recall/);
  assert.match(snapshot, /Response Planner Answer Shape: identity-recall/);
  assert.match(snapshot, /Response Planner Identity Recall: yes/);
  assert.match(snapshot, /Response Planner Operator Name Used: yes/);
  assert.match(snapshot, /Response Planner Identity Prompt Injected: yes/);
  assert.match(snapshot, /Operator Profile Prompt Line Present: yes/);
  assert.match(snapshot, /Final Answer Used Operator Profile: yes/);
  assert.match(snapshot, /Identity Recall Deterministic Answer Used: yes/);
  assert.match(snapshot, /Command Pipeline Last Submit Accepted: yes/);
  assert.match(snapshot, /Command Pipeline Last Assistant Answer Generated: yes/);
  assert.match(snapshot, /Command Pipeline Last Answer Pane Rendered: yes/);
  assert.match(snapshot, /Command Pipeline Last Finalization Path: deterministic-identity/);
  assert.match(snapshot, /Answer Scroll Requested: yes/);
  assert.match(snapshot, /Answer Scroll Target Kind: latest-assistant-answer-pane/);
  assert.match(snapshot, /Answer Scroll Method: container\.scrollTo\(computed,auto\)/);
  assert.match(snapshot, /Answer Scroll Completed: yes/);
});

test('support snapshot keeps operator name used as no when name is unknown', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        response_planner_status: 'active',
        response_planner_response_mode: 'identity-recall',
        response_planner_answer_shape: 'identity-recall',
        chat_context_operator_name_known: 'no',
      },
    },
  });

  assert.match(snapshot, /Response Planner Identity Recall: yes/);
  assert.match(snapshot, /Response Planner Operator Name Used: no/);
});

test('support snapshot contains response planner fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { lastExecutionMetadata: { response_planner_status: 'active', response_planner_answer_shape: 'merge-decision', response_planner_identity_recall: 'yes', response_planner_operator_name_used: 'yes', chat_context_provider_ids_used: 'operatorProfile', command_envelope_operator_name: 'Stephan', command_envelope_operator_profile_used: 'yes', chat_context_operator_name_known: 'yes' } } });
  assert.match(snapshot, /Response Planner Status: active/);
  assert.match(snapshot, /Response Planner Answer Shape: merge-decision/);
  assert.match(snapshot, /Response Planner Identity Recall: yes/);
  assert.match(snapshot, /Command Envelope Operator Name: Stephan/);
  assert.match(snapshot, /Chat Context Operator Profile Used: yes/);
});

test('support snapshot projects mission repair loop fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      latestMissionId: 'mission-1',
      missionVerificationRequiredTestsRun: 'yes',
      missionVerificationProofStatus: 'passed',
      missionVerificationBlockerCount: 0,
    },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
  });
  assert.match(snapshot, /Mission Repair Loop Status:/);
  assert.match(snapshot, /Mission Repair Loop Current Attempt:/);
  assert.match(snapshot, /Mission Repair Loop Merge Recommendation:/);
  assert.match(snapshot, /Mission Repair Loop Codex Prompt Available:/);
  assert.match(snapshot, /Mission Repair Loop Codex Prompt Summary:/);
  assert.match(snapshot, /Mission Repair Loop Repair Boundary:/);
  assert.match(snapshot, /Mission Repair Loop Required Tests:/);
  assert.match(snapshot, /Mission Repair Loop Forbidden Actions:/);
  assert.match(snapshot, /Mission Repair Loop Proof Fields Required:/);
  assert.match(snapshot, /Mission Repair Loop Operator Approval Required:/);
  assert.match(snapshot, /Mission Repair Loop Source Truths Used:/);
  assert.match(snapshot, /Mission Repair Loop Duplicate Authority Detected: no/);
});

test('Support Snapshot reports rehydrated operator profile storage diagnostics', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { lastExecutionMetadata: {
    chat_context_operator_name_known: 'yes',
    chat_context_operator_name: 'Stephan',
    chat_context_operator_profile_rehydrated: 'yes',
    chat_context_operator_profile_storage_key: 'stephanos.operator.profile.v1',
    chat_context_operator_profile_storage_read_status: 'success',
    chat_context_operator_profile_last_read_at: '2026-05-15T00:00:00.000Z',
    chat_context_operator_profile_last_write_at: '2026-05-14T23:59:59.000Z',
  } } });
  assert.match(snapshot, /Operator Profile Rehydrated: yes/);
  assert.match(snapshot, /Operator Profile Storage Key: stephanos.operator.profile.v1/);
  assert.match(snapshot, /Operator Profile Storage Read Status: success/);
});


test('support snapshot projects codex dispatch fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { codexDispatchPacketStatus: 'ready-for-approval', codexDispatchPacketId: 'cdp_2', codexDispatchMissionTitle: 'Fix pane', codexDispatchApprovalRequired: 'yes', codexDispatchPromptAvailable: 'yes', missionRepairCodexBridgeStatus: 'ready', missionRepairCodexBridgePacketCreated: 'yes', missionRepairCodexBridgePacketId: 'cdp_2', missionRepairCodexBridgeReason: 'repair needed', missionRepairCodexBridgeFailingFields: 'UI Reality copy feedback', missionRepairCodexBridgeNextAction: 'Await operator approval before Codex handoff' } });
  assert.match(snapshot, /Codex Dispatch Packet Status: ready-for-approval/);
  assert.match(snapshot, /Codex Dispatch Packet ID: cdp_2/);
  assert.match(snapshot, /Mission Repair Codex Bridge Status: ready/);
  assert.match(snapshot, /Mission Repair Codex Bridge Packet Created: yes/);
});


test('support snapshot projects parsed PR number + github PR number from command envelope aliases', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceParsedPrNumber: '123',
      githubPrEvidenceNumber: '123',
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        retrieval_query: 'do i merge PR 123',
        chat_context_pack_status: 'active',
        chat_context_response_mode: 'merge-decision',
        chat_context_provider_ids_used: 'uiReality|proofState|prEvidence|canonRules|runtimeTruth|providerTruth|missionState',
        command_envelope_pr_evidence_parsed_pr_number: '123',
        command_envelope_pr_number: '123',
        github_pr_evidence_number: '123',
        github_pr_evidence_provider_status: 'unavailable',
        response_planner_merge_decision: 'wait',
      },
    },
  });
  assert.match(snapshot, /PR Evidence Parsed PR Number: 123/);
  assert.equal((snapshot.match(/PR Evidence Parsed PR Number: 123/g) || []).length, 2);
  assert.match(snapshot, /PR Evidence Number: 123/);
  assert.match(snapshot, /GitHub PR Evidence Number: 123/);
  assert.match(snapshot, /GitHub PR Evidence Provider Status: unavailable/);
  assert.match(snapshot, /Context Providers Used: .*prEvidence/);
  assert.match(snapshot, /Response Planner Merge Decision: wait/);
});

test('support snapshot derives PR number fallback from retrieval query when provider number fields are missing', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      githubPrEvidenceProviderStatus: 'needs-connector',
      githubPrEvidenceNextAction: 'connect GitHub evidence or paste PR summary',
      lastExecutionMetadata: {
        retrieval_query: 'do i merge PR 123',
        chat_context_provider_ids_used: 'uiReality|proofState|prEvidence',
        response_planner_merge_decision: 'wait',
      },
    },
  });
  assert.match(snapshot, /PR Evidence Parse Input: do i merge PR 123/);
  assert.match(snapshot, /PR Evidence Parsed Number Source: retrieval_query/);
  assert.match(snapshot, /PR Evidence Resolved Number Source: retrieval_query/);
  assert.match(snapshot, /PR Evidence Provider Output Number: n\/a/);
  assert.match(snapshot, /PR Evidence Final Metadata Number: 123/);
  assert.match(snapshot, /PR Evidence Parsed PR Number: 123/);
  assert.match(snapshot, /GitHub PR Evidence Number: 123/);
  assert.match(snapshot, /GitHub PR Evidence Provider Status: needs-connector/);
  assert.match(snapshot, /GitHub PR Evidence Next Action: connect GitHub evidence or paste PR summary/);
  assert.match(snapshot, /Response Planner Merge Decision: wait/);
});

test('support snapshot derives PR number fallback from chat_context_match_input before retrieval_query', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        retrieval_query: 'do i merge PR 999',
        chat_context_match_input: 'do i merge pr 123',
      },
    },
  });
  assert.match(snapshot, /PR Evidence Parse Input: do i merge pr 123/);
  assert.match(snapshot, /PR Evidence Parsed Number Source: chat_context_match_input/);
  assert.match(snapshot, /GitHub PR Evidence Number: 123/);
});

test('support snapshot ignores placeholder PR number values and falls back to final metadata number', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      githubPrEvidenceNumber: 'unknown',
      prEvidenceParsedPrNumber: 'n/a',
      prEvidenceNumber: 'none',
      githubPrEvidenceProviderStatus: 'needs-connector',
      lastExecutionMetadata: {
        chat_context_match_input: 'do i merge pr 123',
        pr_evidence_parsed_pr_number: '123',
        command_envelope_pr_number: '123',
        github_pr_evidence_number: '123',
        pr_evidence_provider_output_number: 'unknown',
        response_planner_merge_decision: 'wait',
      },
    },
  });
  assert.match(snapshot, /PR Evidence Final Metadata Number: 123/);
  assert.match(snapshot, /PR Evidence Parsed PR Number: 123/);
  assert.match(snapshot, /GitHub PR Evidence Number: 123/);
  assert.match(snapshot, /GitHub PR Evidence Provider Status: needs-connector/);
  assert.match(snapshot, /Response Planner Merge Decision: wait/);
});

test('support snapshot derives PR number from runtimeStatus text fallback when execution metadata text is missing', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      githubPrEvidenceProviderStatus: 'unavailable',
      chatContextMatchInput: 'do i merge pr 321',
    },
  });
  assert.match(snapshot, /PR Evidence Parse Input: do i merge pr 321/);
  assert.match(snapshot, /PR Evidence Parsed Number Source: runtimeStatus.chatContextMatchInput/);
  assert.match(snapshot, /PR Evidence Final Metadata Number: 321/);
  assert.match(snapshot, /GitHub PR Evidence Number: 321/);
});

test('support snapshot keeps explicit provider number priority over fallback parsing and does not fabricate proof fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      githubPrEvidenceProviderStatus: 'unavailable',
      lastExecutionMetadata: {
        pr_evidence_provider_output_number: '456',
        pr_evidence_parsed_pr_number: '456',
        retrieval_query: 'do i merge PR 123',
      },
    },
  });
  assert.match(snapshot, /PR Evidence Provider Output Number: 456/);
  assert.match(snapshot, /PR Evidence Resolved Number Source: explicit-parsed-pr-number/);
  assert.match(snapshot, /PR Evidence Final Metadata Number: 456/);
  assert.match(snapshot, /PR Evidence Parsed PR Number: 456/);
  assert.match(snapshot, /GitHub PR Evidence Number: 456/);
  assert.match(snapshot, /GitHub PR Evidence Title: n\/a/);
  assert.match(snapshot, /PR Evidence Build Status: unknown/);
  assert.match(snapshot, /PR Evidence Verify Status: unknown/);
  assert.match(snapshot, /PR Evidence Browser Proof Status: unknown/);
});

test('support snapshot flags incomplete fetched payload integrity', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        github_pr_evidence_provider_status: 'fetched',
        github_pr_evidence_projection_integrity: 'incomplete',
      },
    },
  });
  assert.match(snapshot, /GitHub PR Evidence Projection Integrity: incomplete-fetched-payload/);
  assert.match(snapshot, /GitHub PR Evidence Next Action: repair fetched evidence projection/);
});

test('support snapshot promotes fetched github evidence into canonical PR evidence lines', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      prEvidenceStatus: 'no_pr_evidence',
      prEvidenceChecksStatus: 'unknown',
      prEvidenceBuildStatus: 'unknown',
      prEvidenceVerifyStatus: 'unknown',
      githubPrEvidenceProviderStatus: 'fetched',
      githubPrEvidenceSource: 'github-api',
      githubPrEvidenceRepo: 'Cheekyfellastef/stephan-os',
      githubPrEvidenceNumber: '970',
      githubPrEvidenceState: 'closed',
      githubPrEvidenceMerged: 'yes',
      githubPrEvidenceChangedFileCount: '4',
      githubPrEvidenceChecksStatus: 'passed',
      githubPrEvidenceBuildStatus: 'passed',
      githubPrEvidenceVerifyStatus: 'passed',
      githubPrEvidenceMergeReadiness: 'already-merged',
    },
  });
  assert.match(snapshot, /PR Evidence Status: merged/);
  assert.match(snapshot, /PR Evidence Checks Status: passed/);
  assert.match(snapshot, /PR Evidence Build Status: passed/);
  assert.match(snapshot, /PR Evidence Verify Status: passed/);
  assert.match(snapshot, /PR Evidence Changed File Count: 4/);
  assert.match(snapshot, /PR Evidence Merged: yes/);
  assert.match(snapshot, /PR Evidence Merge Readiness: already-merged/);
  assert.match(snapshot, /Mission Repair Loop PR Evidence Linked: yes/);
});


test('buildSupportSnapshot includes compact ignition cleanliness fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      ignitionCleanlinessVerdict: 'READY',
      ignitionAutoCleaned: '4',
      ignitionRuntimeCheckpointCount: '1',
      ignitionSourceDirtCount: '0',
      ignitionDependencyWarningCount: '2',
      ignitionHardBlockCount: '0',
      ignitionPrRangeGuardStatus: 'enforced',
      ignitionNextOperatorAction: 'Continue ignition.',
    },
  });
  assert.match(snapshot, /Ignition Cleanliness Status: READY/);
  assert.match(snapshot, /Ignition Auto-Cleaned Generated Count: 4/);
  assert.match(snapshot, /Ignition Runtime Checkpoint Count: 1/);
  assert.match(snapshot, /Ignition Source Dirt Count: 0/);
  assert.match(snapshot, /Ignition Dependency Warning Count: 2/);
  assert.match(snapshot, /Ignition Hard Block Count: 0/);
  assert.match(snapshot, /Ignition PR Range Guard Status: enforced/);
  assert.match(snapshot, /Ignition Next Operator Action: Continue ignition\./);
});
