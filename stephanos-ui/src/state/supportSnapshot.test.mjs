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

test('support snapshot prefers runtime stamped publisher diagnostics for canonical mission console counts', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: {
        uiReality: {
          aiCoreMissionConsole: {
            componentTrace: {
              selectedMarkerPanelId: 'aiCoreMissionConsolePanel',
            },
          },
        },
        operatorReliefBridgeDiagnostics: {
          runtimeDiagnosticsPresent: 'yes',
          registrationDiagnosticsStamp: 7,
          appBridgeHandlerOwnerId: 'app-bridge-registry:live-vite-shell',
          missionConsoleBridgeInstancesRefOwnerId: 'app-bridge-registry:live-vite-shell',
          publishOperatorReliefProjectionBridgeOwnerId: 'app-bridge-registry:live-vite-shell',
          operatorReliefBridgeDiagnosticsStoreOwnerId: 'app-bridge-registry:live-vite-shell',
          operatorReliefBridgeDiagnosticsStoreSourceId: 'app.setOperatorReliefProjectionBridge',
          publisherRegistryOwnerId: 'app-bridge-registry:live-vite-shell',
          publisherRegistryInstanceCount: 1,
          publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel'],
          publisherSource: 'app-bridge-registration',
          missionConsoleInstanceCount: 1,
          missionConsoleInstanceIds: ['aiCoreMissionConsolePanel'],
          visibleInstancePublished: 'yes',
          bridgeParityBlocker: 'projection-not-published',
          runtimeContextSeen: 'yes',
          published: 'no',
          projectionKeysSeen: [],
        },
        uiReality: {
          aiCoreMissionConsole: {
            componentTrace: {
              source: 'live-marker',
              registrationCallbackReturnRegisteredInstanceCount: '9',
            },
          },
        },
      },
      lastExecutionMetadata: {
        mission_console_instance_count: '0',
        mission_console_publisher_registry_instance_count: '0',
      },
    },
  });

  assert.match(snapshot, /Mission Console Store Bridge Diagnostics Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Context Bridge Alias Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Status Bridge Alias Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Publisher Registry Count: 1/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Stamp: 7/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Source ID: runtimeContext\.operatorReliefBridgeDiagnostics/);
  assert.match(snapshot, /Mission Console Publisher Registry Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Mission Console Publisher Registry Instance Count: 1/);
  assert.match(snapshot, /Mission Console Publisher Registry Instance IDs: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Publisher Source: app-bridge-registration/);
  assert.match(snapshot, /Mission Console Instance Count: 1/);
  assert.match(snapshot, /Mission Console Instance IDs: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Visible Instance Published: yes/);
  assert.match(snapshot, /Mission Console Registration RuntimeContext Seen: yes/);
  assert.match(snapshot, /Operator Relief Bridge Published: no/);
  assert.match(snapshot, /Operator Relief Bridge Projection Keys Seen: none/);
  assert.doesNotMatch(snapshot, /Mission Console Instance Count: 9/);
});

test('support snapshot reports missing runtime bridge diagnostics without receipt-faking canonical counts', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: {
        uiReality: {
          aiCoreMissionConsole: {
            componentTrace: {
              source: 'live-marker',
              registrationCallbackReturnRegisteredInstanceCount: '9',
            },
          },
        },
      },
      lastExecutionMetadata: {
        mission_console_instance_count: '0',
        operator_relief_bridge_published: 'no',
      },
    },
  });

  assert.match(snapshot, /Mission Console Store Bridge Diagnostics Present: no/);
  assert.match(snapshot, /Mission Console Runtime Context Bridge Alias Present: no/);
  assert.match(snapshot, /Mission Console Runtime Status Bridge Alias Present: no/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Drop Boundary: runtime-context-missing-bridge-diagnostics/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Present: no/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Keys: none/);
  assert.match(snapshot, /Mission Console Runtime Publisher Registry Count: 0/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Source ID: missing/);
  assert.match(snapshot, /Operator Relief Bridge Drop Boundary: runtime-context-missing-bridge-diagnostics/);
  assert.match(snapshot, /Mission Console Instance Count: 0/);
  assert.doesNotMatch(snapshot, /Mission Console Instance Count: 9/);
  assert.match(snapshot, /Operator Relief Bridge Published: no/);
  assert.match(snapshot, /Operator Relief Bridge Projection Keys Seen: none/);
});

test('support snapshot proves store diagnostics and runtime alias hydration boundaries', () => {
  const diagnostics = {
    registrationDiagnosticsStamp: 8,
    publisherRegistryOwnerId: 'app-bridge-registry:live-vite-shell',
    publisherRegistryInstanceCount: 1,
    publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel'],
    publisherSource: 'app-bridge-registration',
    missionConsoleInstanceCount: 1,
    visibleInstancePublished: 'yes',
    runtimeContextSeen: 'yes',
    published: 'no',
    projectionKeysSeen: [],
  };
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjectionBridge: { diagnostics },
      runtimeContext: { operatorReliefBridgeDiagnostics: diagnostics },
      lastExecutionMetadata: { mission_console_instance_count: '9' },
    },
  });

  assert.match(snapshot, /Mission Console Store Bridge Diagnostics Present: yes/);
  assert.match(snapshot, /Mission Console Store Bridge Diagnostics Stamp: 8/);
  assert.match(snapshot, /Mission Console Runtime Context Bridge Alias Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Status Bridge Alias Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Drop Boundary: none/);
  assert.match(snapshot, /Mission Console Instance Count: 1/);
  assert.doesNotMatch(snapshot, /Mission Console Instance Count: 9/);
  assert.match(snapshot, /Operator Relief Bridge Published: no/);
  assert.match(snapshot, /Operator Relief Bridge Projection Keys Seen: none/);
});

test('support snapshot reports runtime context alias missing when store has bridge diagnostics', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjectionBridge: {
        diagnostics: {
          registrationDiagnosticsStamp: 8,
          publisherRegistryOwnerId: 'app-bridge-registry:live-vite-shell',
          publisherRegistryInstanceCount: 1,
        },
      },
      runtimeContext: {},
    },
  });

  assert.match(snapshot, /Mission Console Store Bridge Diagnostics Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Context Bridge Alias Present: no/);
  assert.match(snapshot, /Mission Console Runtime Status Bridge Alias Present: no/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Drop Boundary: runtime-context-alias-missing/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Present: no/);
  assert.match(snapshot, /Mission Console Instance Count: 0/);
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
  assert.match(snapshot, /Mission Evidence Ledger Completeness: partial/);
  assert.match(snapshot, /Mission Evidence Ledger Next Required: operator_decision_required/);
  assert.match(snapshot, /Mission Evidence Ledger Durable Write Allowed: no/);
  assert.match(snapshot, /Mission Evidence Ledger Operator Approval Required For Write: yes/);
  assert.match(snapshot, /Mission Evidence Ledger Mutation Allowed: no/);
  assert.match(snapshot, /Mission Evidence Ledger OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Mission Evidence Ledger Codex Auto Dispatch Allowed: no/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Merge: no/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Canon: no/);
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

test('support snapshot reports mission console bridge parity blocker as projection-not-published when instances exist but bridge has not published', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        mission_console_instance_count: '2',
        mission_console_instance_ids: 'aiCoreMissionConsolePanel|missionConsolePanel',
        mission_console_visible_instance_id: 'aiCoreMissionConsolePanel',
        mission_console_visible_instance_published: 'no',
        operator_relief_bridge_published: 'no',
      },
    },
  });
  assert.match(snapshot, /Mission Console Instance Count: 2/);
  assert.match(snapshot, /Mission Console Bridge Parity Blocker: visible-instance-not-published/);
});

test('support snapshot reports mission console bridge parity blocker as instance-not-registered when no instances are registered yet', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        mission_console_instance_count: '0',
        operator_relief_bridge_published: 'no',
      },
    },
  });
  assert.match(snapshot, /Mission Console Instance Count: 0/);
  assert.match(snapshot, /Mission Console Bridge Parity Blocker: instance-not-registered/);
});

test('support snapshot prefers live operator relief bridge diagnostics when final execution metadata is stale', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        mission_console_instance_count: '0',
        mission_console_visible_instance_id: 'unknown',
        operator_relief_bridge_published: 'no',
      },
      runtimeContext: {
        uiReality: {
          aiCoreMissionConsole: {
            componentTrace: {
              selectedMarkerPanelId: 'aiCoreMissionConsolePanel',
            },
          },
        },
        operatorReliefBridgeDiagnostics: {
          published: 'yes',
          storeUpdated: 'yes',
          runtimeContextSeen: 'yes',
          registrationEffectSeen: 'yes',
          registrationEffectPanelId: 'aiCoreMissionConsolePanel',
          registrationCallbackPropPresent: 'yes',
          registrationCallbackInvoked: 'yes',
          registrationAppHandlerSeen: 'yes',
          registrationStoreWriteAttempted: 'yes',
          registrationStoreWriteAccepted: 'yes',
          registrationReceivedPanelId: 'aiCoreMissionConsolePanel',
          registrationReceivedSourceSurface: 'aiCoreMissionConsolePanel',
          registrationReceivedInstanceId: 'aiCoreMissionConsolePanel',
          registrationCallbackSource: 'app-bridge',
          registrationCallbackPanelId: 'aiCoreMissionConsolePanel',
          registrationCallbackIdentity: 'app-bridge:aiCoreMissionConsolePanel:aiCoreMissionConsolePanel',
          registrationDropBoundary: 'none',
          missionConsoleInstanceCount: 2,
          missionConsoleInstanceIds: ['aiCoreMissionConsolePanel', 'missionConsolePanel'],
          missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel',
          missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel', 'missionConsolePanel'],
          missionConsoleVisibleInstancePublished: 'yes',
          missionConsoleLastPublishingInstanceId: 'missionConsolePanel',
          missionConsoleBridgeParityStatus: 'OK',
          missionConsoleBridgeParityBlocker: 'none',
          bridgeParityBlocker: 'none',
          projectionKeysSeen: ['agentRealityLoopProjection', 'builderMeshProjection'],
          agentRealityLoopSeen: true,
          appBridgeHandlerOwnerId: 'app-bridge-registry:live-vite-shell',
          missionConsoleBridgeInstancesRefOwnerId: 'app-bridge-registry:live-vite-shell',
          publishOperatorReliefProjectionBridgeOwnerId: 'app-bridge-registry:live-vite-shell',
          operatorReliefBridgeDiagnosticsStoreOwnerId: 'app-bridge-registry:live-vite-shell',
          operatorReliefBridgeDiagnosticsStoreSourceId: 'app.setOperatorReliefProjectionBridge',
          publisherRegistryOwnerId: 'app-bridge-registry:live-vite-shell',
          publisherRegistryInstanceCount: 2,
          publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel', 'missionConsolePanel'],
          publisherSource: 'app-bridge-registration',
          registrationDiagnosticsStamp: 3,
        },
      },
    },
  });
  assert.match(snapshot, /Mission Console Diagnostics Source: live-operator-relief-bridge/);
  assert.match(snapshot, /Mission Console Registration Diagnostics Source: runtimeContext.operatorReliefBridgeDiagnostics/);
  assert.match(snapshot, /Mission Console Registration Diagnostics Stamp: 3/);
  assert.match(snapshot, /Mission Console Registration Diagnostics Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Support Snapshot Diagnostics Source ID: runtimeContext.operatorReliefBridgeDiagnostics/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Present: yes/);
  assert.match(snapshot, /Mission Console Runtime Publisher Registry Count: 2/);
  assert.match(snapshot, /Mission Console Runtime Diagnostics Drop Boundary: none/);
  assert.match(snapshot, /App Bridge Handler Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Mission Console Bridge Instances Ref Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Publish Operator Relief Projection Bridge Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Operator Relief Bridge Diagnostics Store Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Operator Relief Bridge Diagnostics Store Source ID: app.setOperatorReliefProjectionBridge/);
  assert.match(snapshot, /Mission Console Publisher Registry Owner ID: app-bridge-registry:live-vite-shell/);
  assert.match(snapshot, /Mission Console Publisher Registry Instance Count: 2/);
  assert.match(snapshot, /Mission Console Publisher Registry Instance IDs: aiCoreMissionConsolePanel\|missionConsolePanel/);
  assert.match(snapshot, /Mission Console Publisher Source: app-bridge-registration/);
  assert.match(snapshot, /Mission Console Registration Callback Seen: yes/);
  assert.match(snapshot, /Mission Console Registration Effect Seen: yes/);
  assert.match(snapshot, /Mission Console Registration Callback Prop Present: yes/);
  assert.match(snapshot, /Mission Console Registration Callback Invoked: yes/);
  assert.match(snapshot, /Mission Console Registration App Handler Seen: yes/);
  assert.match(snapshot, /Mission Console Registration Store Write Attempted: yes/);
  assert.match(snapshot, /Mission Console Registration Store Write Accepted: yes/);
  assert.match(snapshot, /Mission Console Registration Received Panel ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Registration Received Source Surface: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Registration Callback Source: app-bridge/);
  assert.match(snapshot, /Mission Console Registration Callback Panel ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Registration Callback Identity: app-bridge:aiCoreMissionConsolePanel:aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Registration Store Updated: yes/);
  assert.match(snapshot, /Mission Console Registration RuntimeContext Seen: yes/);
  assert.match(snapshot, /Mission Console Instance Count: 2/);
  assert.match(snapshot, /Mission Console Instance IDs: aiCoreMissionConsolePanel\|missionConsolePanel/);
  assert.match(snapshot, /Mission Console Selected Marker Panel ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Visible Instance ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Visible Instance Published: yes/);
  assert.match(snapshot, /Mission Console Last Publishing Instance ID: missionConsolePanel/);
  assert.match(snapshot, /Mission Console Bridge Parity Status: OK/);
  assert.match(snapshot, /Mission Console Bridge Parity Blocker: none/);
  assert.match(snapshot, /Operator Relief Bridge Published: yes/);
  assert.match(snapshot, /Operator Relief Bridge Projection Keys Seen: agentRealityLoopProjection\|builderMeshProjection/);
  assert.match(snapshot, /Operator Relief Bridge Agent Reality Loop Seen: yes/);
});


test('support snapshot reports registered mission console instance while projection is missing', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: {
        operatorReliefBridgeDiagnostics: {
          published: 'no',
          storeUpdated: 'yes',
          runtimeContextSeen: 'yes',
          registrationEffectSeen: 'yes',
          registrationEffectPanelId: 'aiCoreMissionConsolePanel',
          registrationCallbackPropPresent: 'yes',
          registrationCallbackInvoked: 'yes',
          registrationAppHandlerSeen: 'yes',
          registrationStoreWriteAttempted: 'yes',
          registrationStoreWriteAccepted: 'yes',
          registrationDropBoundary: 'none',
          missionConsoleInstanceCount: 1,
          missionConsoleInstanceIds: ['aiCoreMissionConsolePanel'],
          missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel',
          missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel'],
          missionConsoleVisibleInstancePublished: 'yes',
          missionConsoleBridgeParityStatus: 'WARN',
          missionConsoleBridgeParityBlocker: 'projection-not-published',
          projectionKeysSeen: [],
        },
      },
    },
  });
  assert.match(snapshot, /Mission Console Registration App Handler Seen: yes/);
  assert.match(snapshot, /Mission Console Registration Store Write Attempted: yes/);
  assert.match(snapshot, /Mission Console Registration Store Write Accepted: yes/);
  assert.match(snapshot, /Mission Console Registration Store Updated: yes/);
  assert.match(snapshot, /Mission Console Registration RuntimeContext Seen: yes/);
  assert.match(snapshot, /Mission Console Instance Count: 1/);
  assert.match(snapshot, /Mission Console Visible Instance ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Visible Instance Published: yes/);
  assert.match(snapshot, /Operator Relief Bridge Published: no/);
  assert.match(snapshot, /Operator Relief Bridge Projection Keys Seen: none/);
  assert.match(snapshot, /Mission Console Bridge Parity Status: WARN/);
  assert.match(snapshot, /Mission Console Bridge Parity Blocker: projection-not-published/);
});

test('support snapshot prefers stamped live registration diagnostics over stale final execution metadata', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        mission_console_registration_app_handler_seen: 'no',
        mission_console_registration_received_callback_identity: 'unknown',
        mission_console_instance_count: '0',
        operator_relief_bridge_published: 'no',
      },
      runtimeContext: {
        operatorReliefBridgeDiagnostics: {
          published: 'no',
          storeUpdated: 'yes',
          runtimeContextSeen: 'yes',
          appHandlerEntered: 'yes',
          registrationAppHandlerSeen: 'yes',
          registrationStoreWriteAttempted: 'yes',
          registrationStoreWriteAccepted: 'yes',
          receivedCallbackIdentity: 'app-bridge:aiCoreMissionConsolePanel:aiCoreMissionConsolePanel',
          registrationReceivedPanelId: 'aiCoreMissionConsolePanel',
          registrationReceivedSourceSurface: 'aiCoreMissionConsolePanel',
          registrationReceivedInstanceId: 'aiCoreMissionConsolePanel',
          missionConsoleInstanceCount: 0,
          projectionKeysSeen: [],
          registrationDiagnosticsStamp: 2,
        },
      },
    },
  });
  assert.match(snapshot, /Mission Console Diagnostics Source: live-operator-relief-bridge/);
  assert.match(snapshot, /Mission Console Registration App Handler Entered: yes/);
  assert.match(snapshot, /Mission Console Registration Received Callback Identity: app-bridge:aiCoreMissionConsolePanel:aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Registration Store Write Attempted: yes/);
  assert.match(snapshot, /Mission Console Instance Count: 0/);
  assert.match(snapshot, /Operator Relief Bridge Published: no/);
});

test('support snapshot does not allow final execution metadata zero defaults to overwrite live mission console diagnostics', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        mission_console_instance_count: '0',
        mission_console_instance_ids: 'none',
        mission_console_visible_instance_id: 'unknown',
        mission_console_bridge_capable_instance_ids: 'none',
        mission_console_visible_instance_published: 'no',
        operator_relief_bridge_published: 'no',
      },
      runtimeContext: {
        uiReality: {
          aiCoreMissionConsole: {
            componentTrace: {
              selectedMarkerPanelId: 'aiCoreMissionConsolePanel',
            },
          },
        },
        operatorReliefBridgeDiagnostics: {
          published: 'yes',
          storeUpdated: 'yes',
          runtimeContextSeen: 'yes',
          missionConsoleInstanceCount: 1,
          missionConsoleInstanceIds: ['aiCoreMissionConsolePanel'],
          missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel',
          missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel'],
          missionConsoleVisibleInstancePublished: 'yes',
          missionConsoleBridgeParityStatus: 'OK',
        },
      },
    },
  });
  assert.match(snapshot, /Mission Console Diagnostics Source: live-operator-relief-bridge/);
  assert.match(snapshot, /Mission Console Instance Count: 1/);
  assert.match(snapshot, /Mission Console Instance IDs: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Visible Instance ID: aiCoreMissionConsolePanel/);
  assert.match(snapshot, /Mission Console Bridge-Capable Instance IDs: aiCoreMissionConsolePanel/);
});

test('support snapshot reports truthful drop boundary when callback prop is missing', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: {
        operatorReliefBridgeDiagnostics: {
          missionConsoleInstanceCount: 1,
          registrationDropBoundary: 'missing-prop',
          registrationCallbackInvoked: 'no',
        },
      },
    },
  });
  assert.match(snapshot, /Operator Relief Bridge Drop Boundary: missing-prop/);
  assert.match(snapshot, /Mission Console Registration Callback Seen: no/);
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
        project_awareness_prompt_injected: 'yes',
        project_awareness_prompt_block_length: 640,
        project_awareness_prompt_sources: 'missionState|proofState|canonRules',
        mission_planning_prompt_context_used: 'yes',
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
  assert.match(snapshot, /Project Awareness Prompt Injected: yes/);
  assert.match(snapshot, /Mission Planning Prompt Context Used: yes/);
});

test('support snapshot normalizes live mission-planning contradiction when project awareness fields are populated', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        project_awareness_pack_status: 'unavailable',
        project_awareness_sources_used: 'proofState|canonRules',
        project_awareness_next_best_action: 'preserved-next-action',
        project_awareness_operator_workflow_preference: 'preserved-workflow',
        project_awareness_codex_role: 'preserved-codex-role',
        project_awareness_openclaw_role: 'preserved-openclaw-role',
        chat_context_intent_classifier_matched_rule: 'mission-planning',
        command_envelope_response_mode: 'mission-planning',
        response_planner_response_mode: 'mission-planning',
        chat_context_response_mode: 'mission-planning',
        chat_context_pack_status: 'unavailable',
        chat_context_sources_used: 'proofState|canonRules',
        chat_context_provider_ids_used: 'proofState|canonRules|missionState',
        chat_context_mission_state: 'unknown',
      },
    },
  });
  assert.match(snapshot, /Project Awareness Pack Status: degraded/);
  assert.match(snapshot, /Project Awareness Sources Used: proofState\|canonRules/);
  assert.match(snapshot, /Project Awareness Next Best Action: preserved-next-action/);
  assert.match(snapshot, /Project Awareness Operator Workflow Preference: preserved-workflow/);
  assert.match(snapshot, /Project Awareness Codex Role: preserved-codex-role/);
  assert.match(snapshot, /Project Awareness OpenClaw Role: preserved-openclaw-role/);
  assert.doesNotMatch(snapshot, /Chat Context Pack Status: unavailable/);
  assert.match(snapshot, /Chat Context Sources Used: proofState\|canonRules\|projectAwareness|Chat Context Sources Used: proofState\|projectAwareness\|canonRules|Chat Context Sources Used: canonRules\|proofState\|projectAwareness|Chat Context Sources Used: canonRules\|projectAwareness\|proofState|Chat Context Sources Used: projectAwareness\|proofState\|canonRules|Chat Context Sources Used: projectAwareness\|canonRules\|proofState/);
  assert.doesNotMatch(snapshot, /Chat Context Mission State: unknown/);
});

test('support snapshot exposes agent reality loop proof lines from execution metadata', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        agent_reality_loop_context_recognized: 'yes',
        agent_reality_loop_context_source: 'chatContext.intent+projectAwareness',
        agent_reality_loop_projection_available: 'yes',
        agent_reality_loop_context_injected: 'yes',
        agent_reality_loop_projection_source_seen: 'operator-relief-bridge',
        agent_reality_loop_recommended_lead: 'codex',
        agent_reality_loop_merge_recommendation: 'hold',
        agent_reality_loop_copy_packets_available: 'yes',
        agent_reality_loop_availability_blocker: 'none',
      },
    },
  });
  assert.match(snapshot, /Agent Reality Loop Context Recognized: yes/);
  assert.match(snapshot, /Agent Reality Loop Context Source: chatContext\.intent\+projectAwareness/);
  assert.match(snapshot, /Agent Reality Loop Context Injected: yes/);
  assert.match(snapshot, /ARL Projection Source: operator-relief-bridge/);
  assert.match(snapshot, /Agent Reality Loop Projection Available: yes/);
  assert.match(snapshot, /Agent Reality Loop Recommended Lead: codex/);
  assert.match(snapshot, /Agent Reality Loop Merge Recommendation: hold/);
  assert.match(snapshot, /Agent Reality Loop Copy Packets Available: yes/);
  assert.match(snapshot, /Agent Reality Loop Availability Blocker: none/);
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

test('support snapshot reports operator-approved repair loop lines', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    executionMetadata: {
      operator_approved_repair_loop_status: 'proof-failed',
      operator_approved_repair_loop_mission: 'Repair ARL bridge',
      operator_approved_repair_loop_approval_still_valid: 'yes',
      operator_approved_repair_loop_failure_class: 'projection-bridge-loss',
      operator_approved_repair_loop_recommended_lead: 'openclaw',
      operator_approved_repair_loop_openclaw_packet_available: 'yes',
    },
  });
  assert.match(snapshot, /Operator Approved Repair Loop Status:/);
  assert.match(snapshot, /Operator Approved Repair Loop Mission:/);
  assert.match(snapshot, /Operator Approved Repair Loop Failure Class:/);
  assert.match(snapshot, /Operator Approved Repair Loop Recommended Lead:/);
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

test('support snapshot normalizes mission-planning prompt proof and chat-context truth when prompt block is present', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        retrieval_query: 'What is the current main mission and what is the next best action?\n[Project Awareness Context: bounded truth for mission-planning only]\n- next best action: Integrate Mission Brain, Harness, proof, and canon context into existing path.',
        command_envelope_response_mode: 'mission-planning',
        response_planner_response_mode: 'mission-planning',
        chat_context_response_mode: 'direct-answer',
        chat_context_pack_status: 'unavailable',
        chat_context_sources_used: 'none',
        chat_context_mission_state: 'unknown',
        project_awareness_pack_status: 'degraded',
        project_awareness_sources_used: 'missionState|missionIntelligence|canonRules',
        project_awareness_next_best_action: 'Integrate Mission Brain, Harness, proof, and canon context into existing path.',
        project_awareness_operator_workflow_preference: 'Operator prefers main-first/main-only simplicity.',
        project_awareness_codex_role: 'Codex executes bounded proof work under approval gates.',
        project_awareness_openclaw_role: 'OpenClaw supports orchestration under approval gates.',
      },
    },
  });
  assert.match(snapshot, /Project Awareness Prompt Injected: yes/);
  assert.match(snapshot, /Project Awareness Prompt Block Length: [1-9]\d*/);
  assert.match(snapshot, /Project Awareness Prompt Sources: missionState\|missionIntelligence\|canonRules/);
  assert.match(snapshot, /Mission Planning Prompt Context Used: yes/);
  assert.match(snapshot, /Chat Context Response Mode: mission-planning/);
  assert.doesNotMatch(snapshot, /Chat Context Pack Status: unavailable/);
  assert.match(snapshot, /Chat Context Sources Used: .*projectAwareness/);
  assert.doesNotMatch(snapshot, /Chat Context Mission State: unknown/);
});

test('support snapshot prints co-builder and agent-work-routing inclusion markers', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        chat_context_response_mode: 'work-routing',
        chat_context_sources_used: 'projectAwareness|missionIntelligence|agentWorkRouting|coBuilderLoop',
      },
    },
  });
  assert.match(snapshot, /Chat Context Response Mode: work-routing/);
  assert.match(snapshot, /Chat Context Co-Builder Context Included: yes/);
  assert.match(snapshot, /Chat Context Agent Work Routing Context Included: yes/);
});

test('support snapshot promotes work-routing response mode from planner metadata fallback', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        command_envelope_response_mode: 'work-routing',
        response_planner_response_mode: 'work-routing',
        chat_context_response_mode: 'direct-answer',
        chat_context_pack_status: 'degraded',
        chat_context_sources_used: 'projectAwareness|missionIntelligence|agentWorkRouting|coBuilderLoop',
      },
    },
  });
  assert.match(snapshot, /Chat Context Response Mode: work-routing/);
  assert.match(snapshot, /Chat Context Co-Builder Context Included: yes/);
  assert.match(snapshot, /Chat Context Agent Work Routing Context Included: yes/);
  assert.doesNotMatch(snapshot, /Chat Context Pack Status: unavailable/);
});

test('support snapshot never reports availability blocker none when projection is unavailable', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        agent_reality_loop_projection_available: 'no',
      },
    },
  });
  assert.match(snapshot, /Agent Reality Loop Projection Available: no/);
  assert.match(snapshot, /Agent Reality Loop Availability Blocker: projection-missing-from-command-deck-path/);
  assert.doesNotMatch(snapshot, /Agent Reality Loop Availability Blocker: none/);
});

test('support snapshot copy-time sampler overrides stale cached missing MissionConsoleTile trace with live DOM trace', () => {
  const previousDocument = globalThis.document;
  const marker = {
    getAttribute(name) {
      return {
        'data-mission-console-component': 'MissionConsoleTile',
        'data-mission-console-panel-id': 'aiCoreMissionConsolePanel',
        'data-mission-console-registration-effect-seen': 'yes',
        'data-mission-console-registration-callback-prop-present': 'yes',
        'data-mission-console-registration-callback-invoked': 'yes',
        'data-mission-console-registration-drop-boundary': 'none',
      }[name] || '';
    },
  };
  const aiCoreNode = {
    querySelector(selector) {
      return selector === '[data-mission-console-component="MissionConsoleTile"]' ? marker : null;
    },
    contains(node) { return node === marker; },
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector === '[data-testid="ai-core-mission-console"]') return aiCoreNode;
      if (selector === '[data-pane-id="aiCoreMissionConsolePanel"]') return null;
      return null;
    },
  };
  try {
    const snapshot = buildSupportSnapshot({
      runtimeStatus: {
        lastExecutionMetadata: {
          mission_console_component_trace_source: 'missing',
          mission_console_visible_component_is_missionconsoletile: 'no',
          mission_console_visible_component_panel_id: 'unknown',
        },
        runtimeContext: {
          uiReality: { aiCoreMissionConsole: { componentTrace: { source: 'missing' } } },
        },
      },
    });
    assert.match(snapshot, /Mission Console Component Trace Source: live-dom/);
    assert.match(snapshot, /Mission Console Visible Component Is MissionConsoleTile: yes/);
    assert.match(snapshot, /Mission Console Visible Component Panel ID: aiCoreMissionConsolePanel/);
    assert.match(snapshot, /Mission Console Component Effect Seen: yes/);
    assert.match(snapshot, /Mission Console Component Callback Prop Present: yes/);
    assert.match(snapshot, /Mission Console Component Callback Invoked: yes/);
    assert.match(snapshot, /Mission Console Registration Drop Boundary: none/);
    assert.match(snapshot, /Mission Console Instance Count: 0/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});


test('support snapshot live MissionConsoleTile sampler selects visible aiCore panel wrapper over collapsed wrapper', () => {
  const previousDocument = globalThis.document;
  const markerFor = (panelId, callback = 'yes') => ({
    getAttribute(name) {
      return {
        'data-mission-console-component': 'MissionConsoleTile',
        'data-mission-console-panel-id': panelId,
        'data-mission-console-registration-callback-prop-present': callback,
      }[name] || '';
    },
  });
  const collapsedMarker = markerFor('missionConsolePanel', 'no');
  const visibleMarker = markerFor('aiCoreMissionConsolePanel', 'yes');
  const makeWrapper = ({ panelId, visible, marker }) => ({
    style: visible ? {} : { display: 'none' },
    getClientRects: () => (visible ? [{ width: 100, height: 100 }] : []),
    getAttribute(name) {
      return {
        'data-panel-id': panelId,
        'data-testid': 'ai-core-mission-console',
      }[name] || '';
    },
    querySelector(selector) {
      return selector === '[data-mission-console-component="MissionConsoleTile"]' ? marker : null;
    },
    querySelectorAll(selector) {
      return selector === '[data-mission-console-component="MissionConsoleTile"]' ? [marker] : [];
    },
    contains(node) { return node === marker; },
  });
  const collapsedWrapper = makeWrapper({ panelId: 'missionConsolePanel', visible: false, marker: collapsedMarker });
  const visibleWrapper = makeWrapper({ panelId: 'aiCoreMissionConsolePanel', visible: true, marker: visibleMarker });
  globalThis.document = {
    querySelector(selector) {
      if (selector === '[data-testid="ai-core-mission-console"]') return collapsedWrapper;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-testid="ai-core-mission-console"]') return [collapsedWrapper, visibleWrapper];
      return [];
    },
  };
  try {
    const snapshot = buildSupportSnapshot({
      runtimeStatus: {
        lastExecutionMetadata: {
          mission_console_component_trace_source: 'final-execution-metadata',
          mission_console_visible_component_is_missionconsoletile: 'no',
          operator_relief_bridge_published: 'no',
        },
      },
    });
    assert.match(snapshot, /Mission Console Component Trace Source: live-dom/);
    assert.match(snapshot, /Mission Console Visible Component Is MissionConsoleTile: yes/);
    assert.match(snapshot, /Mission Console Visible Component Panel ID: aiCoreMissionConsolePanel/);
    assert.match(snapshot, /Mission Console Component Callback Prop Present: yes/);
    assert.match(snapshot, /Mission Console Registration Callback Seen: no/);
    assert.match(snapshot, /Operator Relief Bridge Published: no/);
    assert.match(snapshot, /Mission Console AI Core Wrapper Count: 2/);
    assert.match(snapshot, /Mission Console AI Core Visible Wrapper Count: 1/);
    assert.match(snapshot, /Mission Console Marker Count By Wrapper: 0:missionConsolePanel:hidden:1\|1:aiCoreMissionConsolePanel:visible:1/);
    assert.match(snapshot, /Mission Console Selected Wrapper Index: 1/);
    assert.match(snapshot, /Mission Console Selected Wrapper Reason: visible-ai-core-panel/);
    assert.match(snapshot, /Mission Console Selected Marker Panel ID: aiCoreMissionConsolePanel/);
    assert.match(snapshot, /Mission Console Selected Marker Callback Present: yes/);
    assert.match(snapshot, /Mission Console Selector Miss Reason: none/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('support snapshot live sampler finds current AIConsole Command Deck DOM and latest final assistant card', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const latest = {
    textContent: 'Final assistant answer from live DOM.',
    getAttribute(name) {
      return {
        'data-assistant-answer-id': 'assistant-live-1',
        'data-answer-final': 'true',
      }[name] || '';
    },
  };
  const history = {
    querySelectorAll(selector) {
      return selector.includes('data-answer-role') ? [latest] : [];
    },
  };
  const root = {
    getAttribute(name) {
      return {
        'data-surface-owner-key': 'commandDeck-pane',
        'data-submission-source': 'stephanos-command-deck',
      }[name] || '';
    },
    querySelector(selector) {
      if (selector.includes('command-deck-answer-history')) return history;
      if (selector === '[data-testid="command-deck-composer"]') return {};
      if (selector === '[data-testid="command-deck-input"]') return {};
      if (selector === '[data-testid="command-deck-execute"]') return {};
      return null;
    },
    querySelectorAll(selector) {
      return selector.includes('data-answer-role') ? [latest] : [];
    },
  };
  globalThis.document = {
    querySelector(selector) {
      return selector.includes('command-deck-root') || selector.includes('data-ai-chat-command-deck') || selector.includes('data-panel-id') ? root : null;
    },
  };
  globalThis.window = { document: globalThis.document };
  try {
    const snapshot = buildSupportSnapshot({
      runtimeStatus: {
        lastExecutionMetadata: {
          answer_delivery_status: 'delivered',
          answer_delivery_rendered: 'yes',
          command_pipeline_last_answer_pane_rendered: 'yes',
          final_assistant_message_id: 'assistant-live-1',
        },
      },
    });
    assert.match(snapshot, /Visible Deck Root Found: yes/);
    assert.match(snapshot, /History Container Found: yes/);
    assert.match(snapshot, /Composer Found: yes/);
    assert.match(snapshot, /Input Found: yes/);
    assert.match(snapshot, /Execute Found: yes/);
    assert.match(snapshot, /Answer Pane Count: 1/);
    assert.match(snapshot, /Latest Assistant Answer ID: assistant-live-1/);
    assert.match(snapshot, /Latest Assistant Answer Final: true/);
    assert.match(snapshot, /Latest Assistant Answer DOM Found: yes/);
    assert.match(snapshot, /Command Deck Render Proof Source: live-dom/);
    assert.match(snapshot, /Latest Assistant DOM Proof Source: live-dom/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('support snapshot explains delivered rendered answer with zero live pane count when local ref proof owns render', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { querySelector() { return null; } };
  globalThis.window = {
    document: globalThis.document,
    __STEPHANOS_COMMAND_DECK_LOCAL_REVEAL__: {
      rootRefPresent: 'yes',
      historyRefPresent: 'yes',
      latestAnswerRefPresent: 'yes',
    },
  };
  try {
    const snapshot = buildSupportSnapshot({
      runtimeStatus: {
        lastExecutionMetadata: {
          answer_delivery_status: 'delivered',
          answer_delivery_rendered: 'yes',
          command_pipeline_last_answer_pane_rendered: 'yes',
        },
        uiDiagnostics: { aiConsoleAnswerScroll: { answerPaneCount: '0' } },
      },
    });
    assert.match(snapshot, /Answer Delivery Rendered: yes/);
    assert.match(snapshot, /Answer Pane Count: 0/);
    assert.match(snapshot, /Command Deck Render Proof Source: local-ref/);
    assert.match(snapshot, /Latest Assistant DOM Proof Source: local-ref/);
    assert.match(snapshot, /Answer Delivery Rendered Zero Pane Explanation: render-proof-from-local-ref/);
    assert.match(snapshot, /Visible Deck Root Found: no/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('support snapshot normalizes ARL projection available proof to non-none source and injected context', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        agent_reality_loop_context_recognized: 'yes',
        agent_reality_loop_projection_available: 'yes',
        agent_reality_loop_projection_source_seen: 'none',
        agent_reality_loop_context_injected: 'no',
        agent_reality_loop_availability_blocker: 'none',
      },
    },
  });
  assert.match(snapshot, /Agent Reality Loop Projection Available: yes/);
  assert.match(snapshot, /ARL Projection Source: command-deck-projection-bridge/);
  assert.doesNotMatch(snapshot, /ARL Projection Source: none/);
  assert.match(snapshot, /Agent Reality Loop Context Injected: yes/);
  assert.match(snapshot, /Agent Reality Loop Context Injection Blocker: none/);
});

test('support snapshot live MissionConsoleTile sampler falls back to pane selector and reports checked selector when missing', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const marker = {
    getAttribute(name) {
      return {
        'data-mission-console-component': 'MissionConsoleTile',
        'data-mission-console-panel-id': 'aiCoreMissionConsolePanel',
      }[name] || '';
    },
  };
  const pane = {
    querySelector(selector) {
      return selector === '[data-mission-console-component="MissionConsoleTile"]' ? marker : null;
    },
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector === '[data-testid="ai-core-mission-console"]') return null;
      if (selector === '[data-pane-id="aiCoreMissionConsolePanel"]') return pane;
      return null;
    },
  };
  globalThis.window = { document: globalThis.document };
  try {
    const paneSnapshot = buildSupportSnapshot({ runtimeStatus: { lastExecutionMetadata: {} } });
    assert.match(paneSnapshot, /Mission Console Component Trace Source: pane-fallback/);
    assert.match(paneSnapshot, /Mission Console Visible Component Is MissionConsoleTile: yes/);
    globalThis.document = { querySelector() { return null; } };
    globalThis.window.document = globalThis.document;
    const missingSnapshot = buildSupportSnapshot({ runtimeStatus: { lastExecutionMetadata: {} } });
    assert.match(missingSnapshot, /Mission Console Component Trace Source: missing/);
    assert.match(missingSnapshot, /Mission Console Component Trace Selector Checked: \[data-testid="ai-core-mission-console"\]/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

function createCommandDeckNode({
  answerId = 'assistant-final-1',
  answerText = '4',
  containerText = '',
  answerHeight = 32,
  historyHeight = 240,
  rootHeight = 480,
  hidden = false,
} = {}) {
  const attrs = {
    'data-assistant-answer-id': answerId,
    'data-answer-final': 'true',
    'data-answer-role': 'assistant',
  };
  const latest = {
    textContent: answerText,
    clientHeight: answerHeight,
    scrollHeight: answerHeight,
    parentElement: null,
    hidden: false,
    getBoundingClientRect() { return { top: 24, bottom: 24 + answerHeight, left: 0, right: 300, width: 300, height: answerHeight }; },
    getAttribute(name) { return attrs[name] || ''; },
    closest() { return latest; },
    querySelector() { return null; },
  };
  const history = {
    textContent: containerText || answerText,
    clientHeight: historyHeight,
    scrollHeight: Math.max(historyHeight, answerHeight),
    parentElement: null,
    hidden: false,
    getBoundingClientRect() { return { top: 0, bottom: historyHeight, left: 0, right: 320, width: 320, height: historyHeight }; },
    querySelectorAll(selector) { return selector.includes('data-answer-role') ? [latest] : []; },
    querySelector() { return null; },
    getAttribute() { return ''; },
  };
  const root = {
    clientHeight: rootHeight,
    scrollHeight: rootHeight,
    parentElement: null,
    hidden,
    getBoundingClientRect() { return { top: 0, bottom: rootHeight, left: 0, right: 360, width: 360, height: rootHeight }; },
    getAttribute(name) {
      return {
        'data-surface-owner-key': 'commandDeck-pane',
        'data-submission-source': 'stephanos-command-deck',
        'data-panel-id': 'commandDeck',
      }[name] || '';
    },
    closest() { return null; },
    querySelector(selector) {
      if (selector.includes('command-deck-answer-history')) return history;
      if (selector === '[data-testid="command-deck-composer"]') return { clientHeight: 44, getBoundingClientRect: () => ({ top: 260, bottom: 304, width: 320, height: 44 }) };
      if (selector === '[data-testid="command-deck-input"]') return { value: 'large paste fixture '.repeat(80), dataset: { autoResize: 'true', largeInputFixture: 'true' }, clientHeight: 144, scrollHeight: 280, parentElement: root, hidden: false, getBoundingClientRect: () => ({ top: 264, bottom: 408, left: 0, right: 220, width: 220, height: 144 }), getAttribute() { return ''; }, closest() { return root; } };
      if (selector === '[data-testid="command-deck-execute"]') return { clientHeight: 32, scrollHeight: 32, parentElement: root, hidden: false, getBoundingClientRect: () => ({ top: 412, bottom: 444, left: 0, right: 80, width: 80, height: 32 }), getAttribute() { return ''; }, closest() { return root; } };
      return null;
    },
    querySelectorAll(selector) { return selector.includes('data-answer-role') ? [latest] : []; },
  };
  history.parentElement = root;
  latest.parentElement = history;
  return { root, history, latest };
}

function withCommandDeckDocument(nodeSet, fn) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (node) => ({
    display: node?.hidden ? 'none' : 'block',
    visibility: 'visible',
    opacity: '1',
    overflowY: 'auto',
  });
  globalThis.document = {
    querySelector(selector) {
      return selector.includes('command-deck-root') || selector.includes('data-ai-chat-command-deck') || selector.includes('data-panel-id') ? nodeSet.root : null;
    },
    querySelectorAll(selector) {
      return selector.includes('command-deck-root') || selector.includes('data-ai-chat-command-deck') || selector.includes('data-panel-id') ? [nodeSet.root] : [];
    },
  };
  globalThis.window = { document: globalThis.document, innerHeight: 800 };
  try {
    return fn();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previousGetComputedStyle;
  }
}

test('support snapshot live sampler anchors latest final assistant card by final assistant id instead of container text', () => {
  const hugeContainerText = 'support snapshot noise '.repeat(8000);
  const nodes = createCommandDeckNode({ answerId: 'final-answer-2-plus-2', answerText: '4', containerText: hugeContainerText });
  const snapshot = withCommandDeckDocument(nodes, () => buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        answer_delivery_status: 'delivered',
        answer_delivery_rendered: 'yes',
        command_pipeline_last_answer_pane_rendered: 'yes',
        final_assistant_message_id: 'final-answer-2-plus-2',
        final_assistant_text_length: 1,
      },
    },
  }));
  assert.match(snapshot, /Latest Final Assistant Card Found: yes/);
  assert.match(snapshot, /Latest Assistant Answer ID: final-answer-2-plus-2/);
  assert.match(snapshot, /Latest Assistant Answer Text Length: 1/);
  assert.match(snapshot, /Latest Assistant Text Length Drift: no/);
  assert.doesNotMatch(snapshot, /Latest Assistant Answer Text Length: 153763/);
});

test('support snapshot live sampler cannot report missing final card when matching live DOM card exists', () => {
  const nodes = createCommandDeckNode({ answerId: 'matching-final-card', answerText: 'ARL proof' });
  const snapshot = withCommandDeckDocument(nodes, () => buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        answer_delivery_status: 'delivered',
        answer_delivery_rendered: 'yes',
        command_pipeline_last_answer_pane_rendered: 'yes',
        final_assistant_message_id: 'matching-final-card',
        final_assistant_text_length: 9,
      },
    },
  }));
  assert.match(snapshot, /Command Deck Render Proof Source: live-dom/);
  assert.match(snapshot, /Latest Assistant DOM Proof Source: live-dom/);
  assert.match(snapshot, /Latest Final Assistant Card Found: yes/);
  assert.match(snapshot, /Latest Assistant Answer DOM Found: yes/);
});


test('support snapshot proves visible mounted Command Deck while Universal Intake stays idle and merge readiness stays hold', () => {
  const nodes = createCommandDeckNode({ answerId: 'universal-intake-visible', answerText: 'ready' });
  const snapshot = withCommandDeckDocument(nodes, () => buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        command_deck_universal_intake_status: 'idle',
        agent_reality_loop_merge_recommendation: 'hold',
      },
    },
    uiReality: {
      paneShells: [
        { panelId: 'commandDeck', title: 'Command Deck', bodyVisible: true },
        { panelId: 'aiCoreMissionConsolePanel', title: 'AI Core Mission Console', bodyVisible: true },
      ],
      renderedPaneOrder: ['commandDeck', 'aiCoreMissionConsolePanel'],
      domPaneOrder: ['commandDeck', 'aiCoreMissionConsolePanel'],
      panesMissingCollapseControls: [],
      panesMissingMoveControls: [],
      moveControlGroups: [],
      totalFirstClassPanes: 2,
      orphanMoveControlCount: 0,
      arrangeMode: false,
      aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', domParentPaneId: 'aiCoreMissionConsolePanel' },
      dedicatedMissionConsole: { rendered: true, visible: true },
      agentMissionConsoleNestedOperationalPanes: [],
      agentMissionConsoleCollapse: { bodyVisibleWhenCollapsed: false },
      copyButtons: [],
      canonicalCopyControls: [],
    },
  }));
  assert.match(snapshot, /UI Reality AI Chat Command Deck Visible: yes/);
  assert.match(snapshot, /UI Reality AI Chat Command Deck Placement Status: OK/);
  assert.match(snapshot, /Command Deck Render Proof Source: live-dom/);
  assert.match(snapshot, /History Container Found: yes/);
  assert.match(snapshot, /Composer Found: yes/);
  assert.match(snapshot, /Input Found: yes/);
  assert.match(snapshot, /Execute Found: yes/);
  assert.match(snapshot, /Command Deck Universal Intake Status: idle/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Merge: no/);
  assert.match(snapshot, /Agent Reality Loop Merge Recommendation: hold/);
});

test('support snapshot live sampler reports explicit zero-height visibility blocker', () => {
  const nodes = createCommandDeckNode({ answerId: 'zero-height-final-card', answerText: '4', answerHeight: 0 });
  const snapshot = withCommandDeckDocument(nodes, () => buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        answer_delivery_status: 'delivered',
        answer_delivery_rendered: 'yes',
        command_pipeline_last_answer_pane_rendered: 'yes',
        final_assistant_message_id: 'zero-height-final-card',
        final_assistant_text_length: 1,
      },
    },
  }));
  assert.match(snapshot, /Latest Final Assistant Card Found: yes/);
  assert.match(snapshot, /Latest Assistant Visual Proof: present-not-visible/);
  assert.match(snapshot, /Latest Assistant Visibility Blocker: zero-height/);
});

test('support snapshot ARL answer path keeps visible-card proof diagnostics', () => {
  const nodes = createCommandDeckNode({ answerId: 'arl-final-card', answerText: 'ARL works.' });
  const snapshot = withCommandDeckDocument(nodes, () => buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        answer_delivery_status: 'delivered',
        answer_delivery_rendered: 'yes',
        command_pipeline_last_answer_pane_rendered: 'yes',
        final_assistant_message_id: 'arl-final-card',
        final_assistant_text_length: 10,
        agent_reality_loop_context_recognized: 'yes',
        agent_reality_loop_context_injected: 'yes',
        agent_reality_loop_projection_source_seen: 'operator-relief-bridge',
        agent_reality_loop_projection_available: 'yes',
        agent_reality_loop_availability_blocker: 'none',
      },
    },
  }));
  assert.match(snapshot, /Latest Final Assistant Card Found: yes/);
  assert.match(snapshot, /Latest Assistant Visual Proof: visible/);
  assert.match(snapshot, /Agent Reality Loop Context Recognized: yes/);
  assert.match(snapshot, /Agent Reality Loop Context Injected: yes/);
  assert.match(snapshot, /ARL Projection Source: operator-relief-bridge/);
  assert.match(snapshot, /Agent Reality Loop Projection Available: yes/);
  assert.match(snapshot, /Agent Reality Loop Availability Blocker: none/);
});

test('buildSupportSnapshot reports ARL low-freshness provider intent separation without drift', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastUiDefaultProvider: 'gemini',
      lastUiRequestedProvider: 'gemini',
      lastRequestedProviderIntent: 'ollama',
      lastExplicitProviderOverrideForRequest: 'no',
      lastFreshnessCandidateProvider: 'gemini',
      lastExecutionRequestedProvider: 'ollama',
      lastRequestedProviderForRequest: 'ollama',
      lastRequestSelectedProvider: 'ollama',
      lastRouterSelectedProvider: 'ollama',
      lastSelectedProvider: 'ollama',
      lastExecutableProvider: 'ollama',
      lastActualProviderUsed: 'ollama',
      lastTimeoutEffectiveProvider: 'ollama',
      lastFreshnessNeed: 'low',
      lastFreshnessRequiredForTruth: 'false',
      lastFreshAnswerRequired: 'false',
      freshAnswerRequired: false,
      freshnessRequiredForTruth: false,
      lastExecutionMetadata: {
        agent_reality_loop_context_recognized: 'yes',
        agent_reality_loop_context_injected: 'yes',
        agent_reality_loop_projection_available: 'yes',
        agent_reality_loop_availability_blocker: 'none',
      },
      agentRealityLoopContextRecognized: 'yes',
      agentRealityLoopContextInjected: 'yes',
      agentRealityLoopProjectionAvailable: 'yes',
      agentRealityLoopAvailabilityBlocker: 'none',
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
      fallbackActive: false,
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: { executableProvider: 'ollama' },
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-05-28T00:00:00.000Z' },
  });

  assert.match(snapshot, /Selected Provider: ollama/);
  assert.match(snapshot, /Active Provider: ollama/);
  assert.match(snapshot, /Fallback Active: no/);
  assert.match(snapshot, /Last UI Default Provider: gemini/);
  assert.match(snapshot, /Explicit Provider Override For Request: no/);
  assert.match(snapshot, /Last Execution Requested Provider: ollama/);
  assert.match(snapshot, /Last Requested Provider For Request: ollama/);
  assert.match(snapshot, /Last Request-Side Selected Provider: ollama/);
  assert.match(snapshot, /Last Router Selected Provider: ollama/);
  assert.match(snapshot, /Last Executable Provider: ollama/);
  assert.match(snapshot, /Last Actual Provider Used: ollama/);
  assert.match(snapshot, /Last Timeout Effective Provider: ollama/);
  assert.match(snapshot, /Provider Mismatch: no/);
  assert.match(snapshot, /Freshness Required For Truth: false/);
  assert.match(snapshot, /Fresh Answer Required: false/);
  assert.match(snapshot, /Last Freshness Need: low/);
  assert.match(snapshot, /Agent Reality Loop Context Recognized: yes/);
  assert.match(snapshot, /Agent Reality Loop Context Injected: yes/);
  assert.match(snapshot, /Agent Reality Loop Projection Available: yes/);
  assert.match(snapshot, /Agent Reality Loop Availability Blocker: none/);
  assert.match(snapshot, /Provider Drift Boundary: none/);
  assert.match(snapshot, /Provider Drift Allowed: n\/a/);
});

test('buildSupportSnapshot identifies provider drift boundary and policy source', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastUiDefaultProvider: 'ollama',
      lastUiRequestedProvider: 'ollama',
      lastRequestedProviderIntent: 'ollama',
      lastFreshnessCandidateProvider: 'gemini',
      lastExecutionRequestedProvider: 'gemini',
      lastRequestedProviderForRequest: 'gemini',
      lastRequestSelectedProvider: 'gemini',
      lastRouterSelectedProvider: 'gemini',
      lastSelectedProvider: 'gemini',
      lastExecutableProvider: 'gemini',
      lastActualProviderUsed: 'gemini',
      lastFreshnessNeed: 'low',
      freshAnswerRequired: false,
      freshnessRequiredForTruth: false,
    },
    routeTruthView: {
      selectedProvider: 'ollama',
      executedProvider: 'gemini',
      fallbackActive: true,
      providerMismatch: true,
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: { executableProvider: 'gemini' },
    runtimeDiagnosticsTruth: { invariantWarnings: [], blockingIssues: [] },
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-05-28T00:00:01.000Z' },
  });

  assert.match(snapshot, /Provider Mismatch: yes/);
  assert.match(snapshot, /Provider Drift Boundary: execution-requested-provider/);
  assert.match(snapshot, /Provider Drift Reason: freshness-candidate-crossed-into-execution-provider-without-freshness-requirement/);
  assert.match(snapshot, /Provider Drift Allowed: no/);
  assert.match(snapshot, /Provider Drift Policy Source: local-first-freshness-guard/);
});

test('Support Snapshot reports Builder Mesh routing evidence from final execution metadata', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        chat_context_pack_status: 'active',
        chat_context_response_mode: 'work-routing',
        chat_context_sources_used: 'missionState|builderMesh|agentWorkRouting',
        builder_mesh_context_recognized: 'yes',
        builder_mesh_projection_available: 'yes',
        builder_mesh_status: 'ready-read-only',
        builder_mesh_recommended_builder: 'local-ai',
        builder_mesh_zero_cost_route_available: 'yes',
        builder_mesh_codex_required: 'no',
        builder_mesh_codex_reason: 'Codex is fallback only.',
        builder_mesh_local_ai_can_help: 'yes-read-only-review',
        builder_mesh_openclaw_can_help: 'yes-read-only-research-and-patch-planning',
        builder_mesh_github_can_help: 'yes-read-only-pr-diff-status-evidence',
        builder_mesh_next_best_action: 'Copy the Local AI Review Packet.',
        builder_mesh_projection_source: 'operator-relief-bridge',
        builder_mesh_metadata_source: 'lastExecutionMetadata',
        builder_mesh_deterministic_answer_used: 'yes',
        builder_mesh_projection_drop_boundary: 'none',
      },
    },
  });
  assert.match(snapshot, /Builder Mesh Context Included: yes/);
  assert.match(snapshot, /Builder Mesh Projection Available: yes/);
  assert.match(snapshot, /Builder Mesh Recommended Builder: local-ai/);
  assert.match(snapshot, /Builder Mesh Zero-Cost Route Available: yes/);
  assert.match(snapshot, /Builder Mesh Codex Required: no/);
  assert.match(snapshot, /Builder Mesh Next Best Action: Copy the Local AI Review Packet\./);
  assert.match(snapshot, /Builder Mesh Projection Source: operator-relief-bridge/);
  assert.match(snapshot, /Builder Mesh Metadata Source: lastExecutionMetadata/);
  assert.match(snapshot, /Builder Mesh Deterministic Answer Used: yes/);
  assert.match(snapshot, /Builder Mesh Projection Drop Boundary: none/);
});

test('support snapshot aligns Builder Workbench truth from live projection when final metadata defaults are stale', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        builder_mesh_projection_available: 'yes',
        builder_mesh_status: 'ready-read-only',
        builder_mesh_codex_required: 'no',
        builder_mesh_projection_source: 'deterministic-answer-live-projection',
        builder_mesh_metadata_source: 'deterministic-result-execution-metadata',
        builder_mesh_deterministic_answer_used: 'yes',
        builder_mesh_projection_drop_boundary: 'none',
        builder_workbench_status: 'unavailable',
        builder_workbench_codex_fallback_still_needed: 'no',
        builder_workbench_codex_fallback_reason: 'none',
        builder_workbench_deterministic_answer_used: 'yes',
      },
      operatorReliefProjection: {
        builderMeshProjection: {
          builderWorkbenchProjection: {
            workbenchStatus: 'ready',
            localAiReviewResultPresent: false,
            localAiRunnerStatus: 'succeeded',
            localAiRunnerSelectedModel: 'llama3.2:3b',
            localAiRunnerLastRunResult: 'succeeded',
            localAiRunnerLastRunBlockedReason: 'none',
            localAiRunnerErrorMessage: 'none',
            localAiRunnerDispatchAttempted: 'yes',
            localAiRunnerRequestSent: 'yes',
            localAiRunnerParsedResultPresent: true,
            workbenchAnswerContextUsed: 'no',
            workbenchAnswerSource: 'builder-workbench-projection',
            workbenchParsedResultSource: 'local-ai-review',
            localAiRunnerResponseRetained: 'yes',
            localAiRunnerParseAttempted: 'yes',
            localAiRunnerParseInputLength: 64,
            localAiRunnerParseResultStatus: 'parsed',
            workbenchOutputViewportStatus: 'usable-css-hooks-present',
            openClawResearchResultPresent: false,
            patchPlanPresent: false,
            patchPlanRisk: 'unknown',
            approvalRequiredBeforePatch: true,
            codexFallbackStillNeeded: true,
            codexFallbackReason: 'implementation requested but no approved local/OpenClaw mutation path is proven',
            nextBestAction: 'Copy Local AI/OpenClaw packets and paste bounded read-only results',
            openClawWorkspaceHygiene: {
              workspaceHygieneStatus: 'blocked-openclaw-workspace-dirt',
              workspaceDirtDetected: 'yes',
              workspaceDirtPaths: ['.openclaw', 'HEARTBEAT.md'],
              workspaceDirtCount: 2,
              workspaceBlocksIgnition: 'yes',
              workspaceRecommendedCleanup: 'git stash push -u -m \"stash-openclaw-workspace-dirt-before-ignition\" -- .openclaw HEARTBEAT.md IDENTITY.md SOUL.md TOOLS.md USER.md',
              workspaceSafeRuntimeDirectory: '~/.local/share/stephanos/openclaw-workspace',
              workspaceMutationAuthority: 'locked',
              workspaceNextOperatorAction: 'Run the named stash command.',
            },
          },
        },
      },
    },
    uiReality: {
      paneShells: [
        { panelId: 'commandDeck', title: 'Command Deck', bodyVisible: true },
        { panelId: 'aiCoreMissionConsolePanel', title: 'AI Core Mission Console', bodyVisible: true },
        { panelId: 'missionConsolePanel', title: 'Agent Mission Console', bodyVisible: true },
      ],
      renderedPaneOrder: ['commandDeck', 'aiCoreMissionConsolePanel', 'missionConsolePanel'],
      domPaneOrder: ['commandDeck', 'aiCoreMissionConsolePanel', 'missionConsolePanel'],
      panesMissingCollapseControls: [],
      panesMissingMoveControls: [],
      moveControlGroups: [],
      totalFirstClassPanes: 3,
      orphanMoveControlCount: 0,
      arrangeMode: false,
      aiCoreMissionConsole: { configured: true, rendered: true, visible: true, panelId: 'aiCoreMissionConsolePanel', domParentPaneId: 'aiCoreMissionConsolePanel' },
      dedicatedMissionConsole: { rendered: true, visible: true },
      agentMissionConsoleNestedOperationalPanes: [],
      agentMissionConsoleCollapse: { bodyVisibleWhenCollapsed: false },
      copyButtons: [],
      canonicalCopyControls: [],
    },
  });

  assert.match(snapshot, /UI Reality Status: OK/);
  assert.match(snapshot, /Builder Mesh Projection Available: yes/);
  assert.match(snapshot, /Builder Mesh Codex Required: no/);
  assert.match(snapshot, /Builder Workbench Status: ready/);
  assert.match(snapshot, /Local AI Runner Status: succeeded/);
  assert.match(snapshot, /Local AI Runner Selected Model: llama3\.2:3b/);
  assert.match(snapshot, /Local AI Runner Last Run Result: succeeded/);
  assert.match(snapshot, /Local AI Runner Last Run Blocked Reason: none/);
  assert.match(snapshot, /Local AI Runner Dispatch Attempted: yes/);
  assert.match(snapshot, /Local AI Runner Request Sent: yes/);
  assert.match(snapshot, /Local AI Runner Parsed Result Present: yes/);
  assert.match(snapshot, /Workbench Answer Context Used: no/);
  assert.match(snapshot, /Workbench Answer Source: builder-workbench-projection/);
  assert.match(snapshot, /Workbench Parsed Result Source: local-ai-review/);
  assert.match(snapshot, /Local AI Runner Response Retained: yes/);
  assert.match(snapshot, /Local AI Runner Parse Attempted: yes/);
  assert.match(snapshot, /Local AI Runner Parse Input Length: 64/);
  assert.match(snapshot, /Local AI Runner Parse Result Status: parsed/);
  assert.match(snapshot, /Workbench Output Viewport Status: usable-css-hooks-present/);
  assert.match(snapshot, /Local AI Review Result Present: no/);
  assert.match(snapshot, /OpenClaw Research Result Present: no/);
  assert.match(snapshot, /Patch Plan Present: no/);
  assert.match(snapshot, /Approval Required Before Patch: yes/);
  assert.match(snapshot, /Codex Fallback Still Needed: yes/);
  assert.match(snapshot, /Codex Fallback Reason: implementation requested but no approved local\/OpenClaw mutation path is proven/);
  assert.match(snapshot, /Builder Workbench Next Best Action: Copy Local AI\/OpenClaw packets and paste bounded read-only results/);
  assert.match(snapshot, /Builder Workbench Projection Source: runtimeStatus\.operatorReliefProjection\.builderMeshProjection\.builderWorkbenchProjection/);
  assert.match(snapshot, /Builder Workbench Metadata Source: support-snapshot-live-operator-relief-projection/);
  assert.match(snapshot, /Builder Workbench Deterministic Answer Used: yes/);
  assert.match(snapshot, /Builder Workbench Projection Drop Boundary: none/);
  assert.match(snapshot, /OpenClaw Workspace Hygiene Status: blocked-openclaw-workspace-dirt/);
  assert.match(snapshot, /OpenClaw Workspace Dirt Detected: yes/);
  assert.match(snapshot, /OpenClaw Workspace Dirt Paths: \.openclaw \| HEARTBEAT\.md/);
  assert.match(snapshot, /OpenClaw Workspace Dirt Count: 2/);
  assert.match(snapshot, /OpenClaw Workspace Blocks Ignition: yes/);
  assert.match(snapshot, /OpenClaw Workspace Recommended Cleanup: git stash push -u -m/);
  assert.match(snapshot, /OpenClaw Workspace Safe Runtime Directory: ~\/.local\/share\/stephanos\/openclaw-workspace/);
  assert.match(snapshot, /OpenClaw Workspace Mutation Authority: locked/);
  assert.match(snapshot, /OpenClaw Workspace Next Operator Action: Run the named stash command\./);
  assert.match(snapshot, /Provider Mismatch: no/);
});

test('support snapshot includes OpenClaw Control Bridge fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      openClawControlBridge: { localScoutProofStatus: 'pending' },
      lastExecutionMetadata: {},
    },
    routeTruthView: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: new Date('2026-05-30T00:00:00Z'),
  });

  assert.match(snapshot, /OpenClaw Control Bridge Status: manual-control-readonly/);
  assert.match(snapshot, /OpenClaw Gateway Target: ws:\/\/127\.0\.0\.1:18789/);
  assert.match(snapshot, /OpenClaw Dashboard URL: http:\/\/127\.0\.0\.1:18789\//);
  assert.match(snapshot, /OpenClaw Local Scout Expected Model: ollama\/llama3\.2:3b/);
  assert.match(snapshot, /OpenClaw Local Scout Proof Status: pending/);
  assert.match(snapshot, /OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /OpenClaw Auto-Start Forbidden: yes/);
  assert.match(snapshot, /OpenClaw Operator Approval Required: yes/);
  assert.match(snapshot, /OpenClaw Last Proof Command Present: yes/);
  assert.match(snapshot, /OpenClaw Dashboard Temporary Cockpit: yes/);
});

test('buildSupportSnapshot includes OpenClaw Web Research Intake fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjection: {
        builderMeshProjection: {
          builderWorkbenchProjection: {
            workbenchStatus: 'ready',
            openClawWebResearchIntake: {
              status: 'failed',
              webAccessStatus: 'unavailable',
              sourceCount: 0,
              validUrlCount: 0,
              placeholderLeakageDetected: 'yes',
              forbiddenLeakageDetected: 'no',
              taskFrameAdherence: 'fail',
              resultTrustedForCanon: 'no',
              nextOperatorAction: 'Reject pasted result.',
            },
          },
        },
      },
    },
  });
  assert.match(snapshot, /OpenClaw Web Research Intake Status: failed/);
  assert.match(snapshot, /OpenClaw Web Access Status: unavailable/);
  assert.match(snapshot, /OpenClaw Research Source Count: 0/);
  assert.match(snapshot, /OpenClaw Research Valid URL Count: 0/);
  assert.match(snapshot, /OpenClaw Research Placeholder Leakage Detected: yes/);
  assert.match(snapshot, /OpenClaw Research Forbidden Leakage Detected: no/);
  assert.match(snapshot, /OpenClaw Research Task Frame Adherence: fail/);
  assert.match(snapshot, /OpenClaw Research Trusted For Canon: no/);
  assert.match(snapshot, /OpenClaw Research Next Operator Action: Reject pasted result\./);
});

test('buildSupportSnapshot exposes Builder Mesh V1 proof-aware routing fields from live Operator Relief projection', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjection: {
        builderMeshProjection: {
          builderMeshStatus: 'ready-read-only',
          recommendedBuilder: 'openclaw',
          recommendedBuilderReason: 'Clean bounded Source Pack proof allows read-only research/intake only.',
          taskKind: 'research',
          openClawEligible: true,
          localAiEligible: false,
          codexEligible: false,
          requiredProof: ['source-pack-runner-judged', 'workspace-hygiene-clean'],
          missingProof: ['browser proof before merge'],
          nextBestAction: 'Copy the OpenClaw Source Pack Runner Packet and keep the route read-only.',
          builderMeshProjectionSource: 'operator-relief-existing-truth-v1',
          builderWorkbenchProjection: {},
        },
      },
    },
  });

  assert.match(snapshot, /Builder Mesh Status: ready-read-only/);
  assert.match(snapshot, /Builder Mesh Recommended Builder: openclaw/);
  assert.match(snapshot, /Builder Mesh Reason: Clean bounded Source Pack proof allows read-only research\/intake only\./);
  assert.match(snapshot, /Builder Mesh Task Kind: research/);
  assert.match(snapshot, /Builder Mesh OpenClaw Eligible: yes/);
  assert.match(snapshot, /Builder Mesh Local AI Eligible: no/);
  assert.match(snapshot, /Builder Mesh Codex Eligible: no/);
  assert.match(snapshot, /Builder Mesh Required Proof: source-pack-runner-judged \| workspace-hygiene-clean/);
  assert.match(snapshot, /Builder Mesh Missing Proof: browser proof before merge/);
  assert.match(snapshot, /Builder Mesh Next Best Action: Copy the OpenClaw Source Pack Runner Packet and keep the route read-only\./);
  assert.match(snapshot, /Builder Mesh Projection Source: operator-relief-existing-truth-v1/);
});

test('buildSupportSnapshot exposes Packet Bay fields from live projection', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjection: {
        packetBayProjection: {
          supportSnapshotFields: {
            packet_bay_status: 'active',
            packet_inbox_count: '1',
            packet_outbox_count: '2',
            packet_ready_to_copy_count: '1',
            packet_awaiting_result_count: '0',
            packet_blocked_count: '1',
            packet_recommended_next_action: 'Copy the local-ai packet.',
            packet_projection_source: 'operator-relief-builder-mesh-source-truth-v1',
            packet_mutation_allowed: 'no',
            packet_openclaw_mutation_locked: 'yes',
            packet_codex_auto_dispatch_allowed: 'no',
            packet_latest_ready_target: 'local-ai',
            packet_latest_ready_kind: 'proof',
            packet_latest_ready_id: 'packet-outbox-local-ai-proof-builder-mesh-local-ai-recommendation-same-truth',
            packet_missing_proof_summary: 'browser proof',
          },
        },
      },
    },
  });
  assert.match(snapshot, /Packet Bay Status: active/);
  assert.match(snapshot, /Packet Inbox Count: 1/);
  assert.match(snapshot, /Packet Outbox Count: 2/);
  assert.match(snapshot, /Packet Ready To Copy Count: 1/);
  assert.match(snapshot, /Packet Awaiting Result Count: 0/);
  assert.match(snapshot, /Packet Blocked Count: 1/);
  assert.match(snapshot, /Packet Recommended Next Action: Copy the local-ai packet\./);
  assert.match(snapshot, /Packet Projection Source: operator-relief-builder-mesh-source-truth-v1/);
  assert.match(snapshot, /Packet Mutation Allowed: no/);
  assert.match(snapshot, /Packet OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Packet Codex Auto Dispatch Allowed: no/);
  assert.match(snapshot, /Packet Latest Ready Target: local-ai/);
  assert.match(snapshot, /Packet Latest Ready Kind: proof/);
  assert.match(snapshot, /Packet Latest Ready ID: packet-outbox-local-ai-proof-builder-mesh-local-ai-recommendation-same-truth/);
  assert.match(snapshot, /Packet Missing Proof Summary: browser proof/);
});

test('buildSupportSnapshot exposes Agent Reality Loop V1 fields from live projection', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjection: {
        agentRealityLoopProjection: {
          status: 'ready',
          phase: 'packet-ready',
          recommendedLead: 'local-ai',
          recommendedLeadReason: 'Packet Bay has a ready local-ai packet.',
          nextAction: 'Copy the Local AI Review Packet.',
          nextPacketId: 'packet-local-ai-proof',
          nextPacketTarget: 'local-ai',
          nextPacketKind: 'proof',
          copyPacketsAvailable: true,
          awaitingResultFrom: 'none',
          expectedResultKind: 'proof',
          missingProof: ['browser proof'],
          blockers: [],
          warnings: ['copy-only'],
          operatorDecisionRequired: true,
          mutationAllowed: false,
          openClawMutationLocked: true,
          codexAutoDispatchAllowed: false,
          projectionSource: 'agent-reality-loop-v1-runtime-truth-projection',
          confidence: 'high',
        },
      },
    },
  });
  assert.match(snapshot, /Agent Reality Loop Status: ready/);
  assert.match(snapshot, /Agent Reality Loop Phase: packet-ready/);
  assert.match(snapshot, /Agent Reality Loop Projection Available: yes/);
  assert.match(snapshot, /Agent Reality Loop Recommended Lead: local-ai/);
  assert.match(snapshot, /Agent Reality Loop Recommended Lead Reason: Packet Bay has a ready local-ai packet\./);
  assert.match(snapshot, /Agent Reality Loop Next Action: Copy the Local AI Review Packet\./);
  assert.match(snapshot, /Agent Reality Loop Next Packet ID: packet-local-ai-proof/);
  assert.match(snapshot, /Agent Reality Loop Next Packet Target: local-ai/);
  assert.match(snapshot, /Agent Reality Loop Next Packet Kind: proof/);
  assert.match(snapshot, /Agent Reality Loop Copy Packets Available: yes/);
  assert.match(snapshot, /Agent Reality Loop Awaiting Result From: none/);
  assert.match(snapshot, /Agent Reality Loop Expected Result Kind: proof/);
  assert.match(snapshot, /Agent Reality Loop Missing Proof Summary: browser proof/);
  assert.match(snapshot, /Agent Reality Loop Blocker Count: 0/);
  assert.match(snapshot, /Agent Reality Loop Warning Count: 1/);
  assert.match(snapshot, /Agent Reality Loop Operator Decision Required: yes/);
  assert.match(snapshot, /Agent Reality Loop Mutation Allowed: no/);
  assert.match(snapshot, /Agent Reality Loop OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Agent Reality Loop Codex Auto Dispatch Allowed: no/);
  assert.match(snapshot, /Agent Reality Loop Projection Source: agent-reality-loop-v1-runtime-truth-projection/);
  assert.match(snapshot, /Agent Reality Loop Confidence: high/);
});

test('Support Snapshot exposes Project Awareness Active Mission Rehydration fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'ready',
      operatorReliefProjection: {
        builderMeshProjection: { builderMeshStatus: 'ready-read-only', recommendedBuilder: 'local-ai', recommendedBuilderReason: 'local proof review', nextBestAction: 'Copy local-ai proof packet.' },
        packetBayProjection: { packetBayStatus: 'active', counts: { inbox: 1, outbox: 1, readyToCopy: 1 }, packets: [{ id: 'p1', target: 'local-ai', kind: 'proof', status: 'ready-to-copy', copyText: 'proof', requiredProof: ['browser proof'], missingProof: ['browser proof'] }] },
        agentRealityLoopProjection: { status: 'blocked', phase: 'blocked', recommendedLead: 'hold', missingProof: ['browser proof'], projectionSource: 'agent-reality-loop-v1-runtime-truth-projection' },
        projectAwarenessProjection: { status: 'degraded', missionId: 'derived-runtime-mission', title: 'Stephanos Mission Stack Verification', phase: 'verification', currentFocus: 'Verify proof packet.', nextBestAction: 'Resolve proof blockers: browser proof', recommendedRoute: 'local-ai', recommendedRouteReason: 'Builder Mesh recommends local-ai read-only verification/review.', sourceSummary: ['Packet Bay projection','Agent Reality Loop projection','Builder Mesh projection'], provedSystems: ['Builder Mesh','Packet Bay'], affectedSubsystems: ['builder-mesh','packet-bay'], missingProof: ['browser proof'], blockers: [], warnings: [], confidence: 'medium', rehydrated: true, rehydrationSource: 'derived-runtime-packet-truth', promptInjectable: true, promptBlock: 'bounded' },
      },
      lastExecutionMetadata: {},
    },
    routeTruthView: {}, runtimeSessionTruth: {}, runtimeRouteTruth: {}, runtimeReachabilityTruth: {}, runtimeProviderTruth: {}, runtimeDiagnosticsTruth: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {}, uiReality: { severity: 'OK' },
  });
  assert.match(snapshot, /Project Awareness Pack Status: degraded/);
  assert.match(snapshot, /Project Awareness Projection Source:/);
  assert.match(snapshot, /Project Awareness Mission ID: derived-runtime-mission/);
  assert.match(snapshot, /Project Awareness Mission Phase: verification/);
  assert.match(snapshot, /Project Awareness Current Focus: Verify proof packet\./);
  assert.match(snapshot, /Project Awareness Recommended Route: local-ai/);
  assert.match(snapshot, /Project Awareness Missing Proof Summary: browser proof/);
  assert.match(snapshot, /Agent Reality Loop Context Source:/);
});

test('Support Snapshot derives Mission Evidence Ledger from live Operator Relief bridge truth', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      appLaunchState: 'ready',
      uiRealityStatus: 'OK',
      operatorReliefProjection: {
        builderMeshProjection: {
          builderMeshStatus: 'ready-read-only',
          recommendedBuilder: 'local-ai',
          recommendedBuilderReason: 'local proof review',
          nextBestAction: 'Copy local-ai proof packet.',
          builderWorkbenchProjection: {
            openClawWorkspaceHygiene: { status: 'clean', workspaceMutationAuthority: 'locked' },
            openClawSourcePackRunner: { sourcePackStatus: 'needs-output' },
          },
        },
        packetBayProjection: {
          packetBayStatus: 'active',
          projectionSource: 'operator-relief-builder-mesh-source-truth-v1',
          counts: { inbox: 1, outbox: 1, readyToCopy: 1 },
          packets: [{ id: 'packet-outbox-local-ai-proof-builder-mesh-local-ai-recommendation-same-truth', target: 'local-ai', kind: 'proof', status: 'ready', readyToCopy: true, missingProof: ['browser proof'] }],
          supportSnapshotFields: {
            packet_bay_status: 'active',
            packet_inbox_count: '1',
            packet_outbox_count: '1',
            packet_ready_to_copy_count: '1',
            packet_projection_source: 'operator-relief-builder-mesh-source-truth-v1',
          },
        },
        agentRealityLoopProjection: {
          status: 'blocked',
          phase: 'blocked',
          blockers: ['browser proof missing'],
          missingProof: ['browser proof'],
          mutationAllowed: false,
          openClawMutationLocked: true,
          codexAutoDispatchAllowed: false,
          projectionSource: 'agent-reality-loop-v1-runtime-truth-projection',
          supportSnapshotFields: {
            agent_reality_loop_status: 'blocked',
            agent_reality_loop_projection_available: 'yes',
            agent_reality_loop_context_injected: 'yes',
            agent_reality_loop_context_source: 'derived-runtime-truth',
          },
        },
        projectAwarenessProjection: {
          status: 'blocked',
          missionId: 'derived-runtime-mission',
          title: 'Stephanos Mission Stack Verification',
          phase: 'verification',
          currentFocus: 'Verify proof packet.',
          nextBestAction: 'Resolve proof blockers.',
          recommendedRoute: 'local-ai',
          recommendedRouteReason: 'Builder Mesh recommends local-ai read-only verification/review.',
          missingProof: ['build proof', 'verify proof', 'browser proof'],
          blockers: ['proof missing'],
          projectionSource: 'derived-runtime-truth',
          confidence: 'medium',
          rehydrated: true,
          rehydrationSource: 'derived-runtime-truth',
        },
      },
      lastExecutionMetadata: {},
    },
    routeTruthView: {}, runtimeSessionTruth: {}, runtimeRouteTruth: {}, runtimeReachabilityTruth: {}, runtimeProviderTruth: {}, runtimeDiagnosticsTruth: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {},
  });
  assert.match(snapshot, /Packet Bay Status: active/);
  assert.match(snapshot, /Project Awareness Pack Status: blocked/);
  assert.match(snapshot, /Agent Reality Loop Projection Available: yes/);
  assert.doesNotMatch(snapshot, /Mission Evidence Ledger Status: unavailable/);
  assert.match(snapshot, /Mission Evidence Ledger Status: blocked/);
  assert.match(snapshot, /Mission Evidence Ledger Mission ID: derived-runtime-mission/);
  assert.match(snapshot, /Mission Evidence Ledger Mission Phase: verification/);
  assert.match(snapshot, /Mission Evidence Ledger Entry Count: (?:[1-9]|\d{2,})/);
  assert.match(snapshot, /Mission Evidence Ledger Latest Event: pr-evidence-missing/);
  assert.match(snapshot, /Mission Evidence Ledger Next Required: local-ai-route-proof-needed/);
  assert.match(snapshot, /Mission Evidence Ledger Projection Source: mission-evidence-ledger-v1a-runtime-truth-projection/);
  assert.match(snapshot, /Mission Evidence Ledger Durable Write Allowed: no/);
  assert.match(snapshot, /Mission Evidence Ledger Mutation Allowed: no/);
  assert.match(snapshot, /Mission Evidence Ledger OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Mission Evidence Ledger Codex Auto Dispatch Allowed: no/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Merge: no/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Canon: no/);
});

test('buildSupportSnapshot exposes Mission Evidence Context V1B fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: {
    appLaunchState: 'ready',
    operatorReliefProjection: {
      packetBayProjection: {
        packets: [], counts: {}, supportSnapshotFields: {
          packet_bay_status: 'active', packet_bay_evidence_packet_count: '3', packet_bay_evidence_review_packet_ready: 'yes', packet_bay_browser_proof_packet_ready: 'yes', packet_bay_pr_evidence_packet_ready: 'yes', packet_mutation_allowed: 'no', packet_openclaw_mutation_locked: 'yes', packet_codex_auto_dispatch_allowed: 'no',
        },
      },
      projectAwarenessProjection: { status: 'blocked', title: 'Mission', missionId: 'derived-runtime-mission', phase: 'verification', evidenceCompleteness: 'blocked', evidenceNextRequired: 'local-ai-route-proof-needed', evidenceMissingProofSummary: 'missing-browser-proof', evidenceContextSource: 'mission-evidence-ledger-v1a-runtime-truth-projection' },
      agentRealityLoopProjection: { supportSnapshotFields: { agent_reality_loop_projection_available: 'yes', agent_reality_loop_mutation_allowed: 'no', agent_reality_loop_openclaw_mutation_locked: 'yes', agent_reality_loop_codex_auto_dispatch_allowed: 'no', agent_reality_loop_evidence_context_source: 'mission-evidence-ledger-v1a-runtime-truth-projection', agent_reality_loop_evidence_next_required: 'local-ai-route-proof-needed', agent_reality_loop_evidence_missing_proof_summary: 'missing-browser-proof', agent_reality_loop_evidence_trusted_for_merge: 'no', agent_reality_loop_evidence_trusted_for_canon: 'no' } },
      missionEvidenceLedgerProjection: { status: 'blocked', missionId: 'derived-runtime-mission', missionPhase: 'verification', completeness: 'blocked', entryCount: 8, blockerCount: 2, warningCount: 6, pendingReviewCount: 8, latestEvent: 'pr-evidence-missing', nextRequiredEvidence: 'local-ai-route-proof-needed', nextAction: 'Collect local-ai-route-proof-needed.', missingProofSummary: 'missing-browser-proof', projectionSource: 'mission-evidence-ledger-v1a-runtime-truth-projection', trustedForMerge: false, trustedForCanon: false, durableWriteAllowed: false, mutationAllowed: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false },
    },
  } });
  assert.match(snapshot, /Mission Evidence Context Available: yes/);
  assert.match(snapshot, /Mission Evidence Context Next Required: local-ai-route-proof-needed/);
  assert.match(snapshot, /Project Awareness Evidence Next Required: local-ai-route-proof-needed/);
  assert.match(snapshot, /Agent Reality Loop Evidence Trusted For Merge: no/);
  assert.match(snapshot, /Packet Bay Evidence Packet Count: 3/);
});

test('support snapshot derives Packet Bay evidence fields from live packetBayProjection rebuilt with Mission Evidence Context', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjection: {
        packetBayProjection: { packets: [], evidencePacketCount: 0, supportSnapshotFields: { packet_bay_status: 'empty-clean', packet_bay_evidence_packet_count: '0' } },
        missionEvidenceLedgerProjection: {
          status: 'blocked',
          missionId: 'derived-runtime-mission',
          missionPhase: 'verification',
          completeness: 'blocked',
          entryCount: 8,
          blockerCount: 2,
          warningCount: 6,
          pendingReviewCount: 8,
          latestEvent: 'pr-evidence-missing',
          nextRequiredEvidence: 'local-ai-route-proof-needed',
          nextAction: 'Collect local AI route proof.',
          missingProofSummary: 'local-ai-route-proof-needed | missing-browser-proof | pr-evidence-missing',
          projectionSource: 'mission-evidence-ledger-v1a-runtime-truth-projection',
          trustedForMerge: false,
          trustedForCanon: false,
          durableWriteAllowed: false,
          mutationAllowed: false,
          openClawMutationLocked: true,
          codexAutoDispatchAllowed: false,
        },
      },
    },
  });
  assert.match(snapshot, /Packet Bay Evidence Packet Count: 3/);
  assert.match(snapshot, /Packet Bay Evidence Review Packet Ready: yes/);
  assert.match(snapshot, /Packet Bay Browser Proof Packet Ready: yes/);
  assert.match(snapshot, /Packet Bay PR Evidence Packet Ready: yes/);
  assert.match(snapshot, /Packet Mutation Allowed: no/);
  assert.match(snapshot, /Packet OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Packet Codex Auto Dispatch Allowed: no/);
});

test('Support Snapshot exposes Evidence Return Intake fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { operatorReliefProjection: { evidenceReturnIntakeProjection: { status: 'parsed', intakeAvailable: true, intakeSource: 'operator-paste', relatedPacketId: 'packet-browser-proof-checklist-operator-v1b', relatedMissionId: 'derived-runtime-mission', relatedEvidenceType: 'browser-proof', parsedResultPresent: true, parsedResultStatus: 'observed', proofObservedCount: 1, proofFailedCount: 0, proofPendingReviewCount: 0, proofBlockedCount: 0, missingProofResolved: true, trustedForMerge: false, trustedForCanon: false, recommendedNextAction: 'Review observed proof candidate.', mutationAllowed: false, durableWriteAllowed: false, operatorApprovalRequiredForWrite: true, openClawMutationLocked: true, codexAutoDispatchAllowed: false, confidence: 'high', warnings: [], summary: 'Evidence return classified as observed.' } } }, routeTruthView: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {} });
  assert.match(snapshot, /Evidence Return Intake Status: parsed/);
  assert.match(snapshot, /Evidence Return Intake Available: yes/);
  assert.match(snapshot, /Evidence Return Intake Source: operator-paste/);
  assert.match(snapshot, /Evidence Return Intake Related Packet ID: packet-browser-proof-checklist-operator-v1b/);
  assert.match(snapshot, /Evidence Return Intake Parsed Result Present: yes/);
  assert.match(snapshot, /Evidence Return Intake Parsed Result Status: observed/);
  assert.match(snapshot, /Evidence Return Intake Proof Observed Count: 1/);
  assert.match(snapshot, /Evidence Return Intake Proof Failed Count: 0/);
  assert.match(snapshot, /Evidence Return Intake Proof Pending Review Count: 0/);
  assert.match(snapshot, /Evidence Return Intake Remaining Missing Proof Summary: none/);
  assert.match(snapshot, /Evidence Return Intake Trusted For Merge: no/);
  assert.match(snapshot, /Evidence Return Intake Trusted For Canon: no/);
  assert.match(snapshot, /Evidence Return Intake Mutation Allowed: no/);
  assert.match(snapshot, /Evidence Return Intake Durable Write Allowed: no/);
  assert.match(snapshot, /Evidence Return Intake OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Evidence Return Intake Codex Auto Dispatch Allowed: no/);
  assert.match(snapshot, /Evidence Return Intake Summary: Evidence return classified as observed\./);
});

test('Support Snapshot accepts Mission Console bridge proof without completing unrelated proof gaps', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: {
        operatorReliefBridgeDiagnostics: {
          published: 'yes',
          storeUpdated: 'yes',
          runtimeContextSeen: 'yes',
          registrationDiagnosticsStamp: 8,
          runtimeDiagnosticsPresent: 'yes',
          runtimeDiagnosticsDropBoundary: 'none',
          runtimeContextBridgeAliasPresent: 'yes',
          runtimeStatusBridgeAliasPresent: 'yes',
          storeBridgeDiagnosticsPresent: 'yes',
          publisherRegistryInstanceCount: 2,
          publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel', 'missionConsolePanel'],
          missionConsoleInstanceCount: 2,
          missionConsoleInstanceIds: ['aiCoreMissionConsolePanel', 'missionConsolePanel'],
          missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel',
          missionConsoleVisibleInstancePublished: 'yes',
          projectionKeysSeen: ['agentRealityLoopProjection', 'builderMeshProjection'],
          agentRealityLoopSeen: true,
          missionConsoleBridgeParityStatus: 'OK',
          missionConsoleBridgeParityBlocker: 'none',
          bridgeParityBlocker: 'none',
        },
      },
      missionVerification: {},
      prEvidence: { status: 'unknown' },
      lastExecutionMetadata: { agent_reality_loop_merge_recommendation: 'hold' },
      uiRealityStatus: 'UNKNOWN',
      operatorReliefProjection: {
        agentRealityLoopProjection: {
          status: 'blocked',
          phase: 'judge-result',
          projectionSource: 'agent-reality-loop-v1-runtime-truth-projection',
          missingProof: ['Mission Console opens from landing tile', 'Operator Relief panel visible', 'build-proof'],
          supportSnapshotFields: {
            agent_reality_loop_status: 'blocked',
            agent_reality_loop_recommended_lead: 'hold',
            agent_reality_loop_missing_proof_summary: 'build evidence missing | verify evidence missing | browser proof missing for UI mission | Mission Console opens from landing tile | Operator Relief panel visible | idle state renders | active/fixture state renders | merge safety verdict visible | browser proof gaps visible | repair prompt visible/copyable | no red console errors | no broken chevron/collapse | OpenClaw source-pack output | local-ai-route-proof-needed | missing-build-proof | missing-verify-proof | missing-browser-proof | source-pack-output-missing',
            agent_reality_loop_mutation_allowed: 'no',
            agent_reality_loop_openclaw_mutation_locked: 'yes',
          },
        },
        projectAwarenessProjection: {
          status: 'degraded',
          projectionSource: 'derived-runtime-truth',
          title: 'Stephanos Mission Stack Verification',
          missionId: 'derived-runtime-mission',
          phase: 'verification',
          missingProof: ['idle state renders', 'active/fixture state renders', 'verify-proof'],
          nextBestAction: 'Resolve legacy browser proof blockers.',
        },
        missionEvidenceLedgerProjection: {
          status: 'active',
          missionId: 'derived-runtime-mission',
          missionTitle: 'Stephanos Mission Stack Verification',
          missionPhase: 'verification',
          missingProofSummary: 'mission-console-bridge | browser proof gaps visible | pr-evidence',
          nextRequiredEvidence: 'mission-console-bridge',
          nextAction: 'Collect mission-console-bridge.',
        },
        packetBayProjection: {
          packetBayStatus: 'active',
          missingProofSummary: 'repair prompt visible/copyable | source-pack-output',
          supportSnapshotFields: { packet_bay_status: 'active', packet_missing_proof_summary: 'repair prompt visible/copyable | source-pack-output' },
        },
      },
    },
  });
  assert.match(snapshot, /Mission Console Bridge Parity Status: OK/);
  assert.match(snapshot, /Mission Console Bridge Proof Accepted: yes/);
  assert.match(snapshot, /Mission Console Bridge Proof Source: support-snapshot-runtime-diagnostics/);
  assert.match(snapshot, /Mission Proof Reconciliation Status: active/);
  assert.match(snapshot, /Mission Proof Accepted Items: mission-console-bridge/);
  assert.doesNotMatch(snapshot, /Mission Proof Remaining Missing Items: .*mission-console-bridge/);
  assert.match(snapshot, /Mission Proof Remaining Missing Items: build-proof\|verify-proof\|browser-proof-checklist\|pr-evidence/);
  assert.match(snapshot, /Mission Proof Next Best Action: Collect build-proof\./);
  assert.match(snapshot, /Agent Reality Loop Status: blocked/);
  assert.match(snapshot, /Agent Reality Loop Recommended Lead: hold/);
  assert.match(snapshot, /Agent Reality Loop Merge Recommendation: hold/);
  assert.match(snapshot, /Agent Reality Loop Mutation Allowed: no/);
  assert.match(snapshot, /Agent Reality Loop Missing Proof Summary: build-proof \| verify-proof \| browser-proof-checklist \| pr-evidence/);
  assert.doesNotMatch(snapshot, /Agent Reality Loop Missing Proof Summary: .*Mission Console opens from landing tile/);
  assert.match(snapshot, /Agent Reality Loop Raw Legacy Missing Proof Summary: .*Mission Console opens from landing tile/);
  assert.match(snapshot, /Agent Reality Loop Raw Legacy Missing Proof Summary: .*idle state renders/);
  assert.match(snapshot, /Project Awareness Missing Proof Summary: build-proof \| verify-proof \| browser-proof-checklist \| pr-evidence/);
  assert.doesNotMatch(snapshot, /Project Awareness Missing Proof Summary: .*idle state renders/);
  assert.match(snapshot, /Mission Evidence Ledger Missing Proof Summary: build-proof \| verify-proof \| browser-proof-checklist \| pr-evidence/);
  assert.doesNotMatch(snapshot, /Mission Evidence Ledger Missing Proof Summary: .*mission-console-bridge/);
  assert.match(snapshot, /Packet Missing Proof Summary: build-proof \| verify-proof \| browser-proof-checklist \| pr-evidence/);
  assert.doesNotMatch(snapshot, /Packet Missing Proof Summary: .*repair prompt visible\/copyable/);
  assert.match(snapshot, /Project Awareness Next Best Action: Collect build-proof\./);
  assert.match(snapshot, /Mission Evidence Ledger Next Required: build-proof/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Merge: no/);
});

test('buildSupportSnapshot exposes Command Deck Universal Intake echoes and canonical remaining proof labels', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: {
    lastExecutionMetadata: {
      command_deck_universal_intake_status: 'classified',
      command_deck_universal_intake_last_kind: 'build-proof',
      command_deck_universal_intake_last_kinds: 'build-proof',
      command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
      command_deck_universal_intake_echo_present: 'yes',
      command_deck_universal_intake_echo_length: '68',
      command_deck_universal_intake_confidence: 'high',
      command_deck_universal_intake_accepted_proof_items: 'build-proof',
      command_deck_universal_intake_echo: 'npm run stephanos:build completed successfully with exit code 0.',
    },

    runtimeContext: { operatorReliefBridgeDiagnostics: {
      projectionKeysSeen: ['missionProofReconciliation'],
      publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel'],
      publisherRegistryInstanceCount: 1,
      registrationDiagnosticsStamp: 1,
      publisherRegistryOwnerId: 'owner',
      publisherSource: 'MissionConsoleTile',
      missionConsoleBridgeParityStatus: 'OK',
      missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel',
      missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel'],
      published: 'yes',
    } },
    operatorReliefProjection: {
      missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] },
      missionEvidenceContextSummary: { missingProofSummary: 'missing-build-proof|missing-verify-proof|missing-browser-proof|pr-evidence-missing|source-pack-output-missing' },
      missionEvidenceLedgerProjection: { status: 'blocked', blockerCount: 1, missingProofSummary: 'missing-build-proof' },
      packetBayProjection: { packets: [] },
    },
  }, routeTruthView: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {} });
  assert.match(snapshot, /Command Deck Universal Intake Status: classified/);
  assert.match(snapshot, /Command Deck Universal Intake Last Kinds: build-proof/);
  assert.match(snapshot, /Command Deck Universal Intake Routed To: evidence-return-intake\|evidence-intake-automation/);
  assert.match(snapshot, /Command Deck Universal Intake Accepted Proof Items: build-proof/);
  assert.match(snapshot, /Evidence Intake Echo Present: yes/);
  assert.match(snapshot, /Evidence Intake Accepted Proof Items: build-proof/);
  assert.match(snapshot, /Mission Proof Remaining Missing Items: verify-proof\|browser-proof-checklist\|pr-evidence\|source-pack-output/);
  assert.match(snapshot, /Mission Proof Next Best Action: Collect verify-proof\./);
  assert.doesNotMatch(snapshot, /Mission Evidence Ledger Missing Proof Summary: .*build-proof/);
  assert.doesNotMatch(snapshot, /Packet Missing Proof Summary: .*build-proof/);
  assert.doesNotMatch(snapshot, /Project Awareness Missing Proof Summary: .*build-proof/);
  assert.doesNotMatch(snapshot, /Agent Reality Loop Missing Proof Summary: .*build-proof/);
  assert.match(snapshot, /Evidence Return Intake Trusted For Merge: no/);
});


test('support snapshot live Command Deck path propagates accepted build proof and large paste diagnostics', () => {
  const nodes = createCommandDeckNode({ answerText: 'Build passed with proof.', answerHeight: 64, historyHeight: 320, rootHeight: 560 });
  const snapshot = withCommandDeckDocument(nodes, () => buildSupportSnapshot({ runtimeStatus: {
    lastExecutionMetadata: {
      command_deck_universal_intake_status: 'classified',
      command_deck_universal_intake_last_kinds: 'codex-result|build-proof',
      command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
      command_deck_universal_intake_accepted_proof_items: 'build-proof',
      command_deck_universal_intake_confidence: 'high',
      command_deck_universal_intake_echo_present: 'yes',
      command_deck_universal_intake_echo: 'npm run stephanos:build completed successfully with exit code 0.',
    },
    uiDiagnostics: { aiConsoleAnswerScroll: { commandDeckInputAutoResizeEnabled: 'unknown', commandDeckInputScrollHeight: 0, commandDeckInputClientHeight: 0, commandDeckExecuteVisibleWithLargeInput: 'unknown' } },
    runtimeContext: { operatorReliefBridgeDiagnostics: {
      projectionKeysSeen: ['missionProofReconciliation'],
      publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel'],
      publisherRegistryInstanceCount: 1,
      registrationDiagnosticsStamp: 1,
      publisherRegistryOwnerId: 'owner',
      publisherSource: 'MissionConsoleTile',
      missionConsoleBridgeParityStatus: 'OK',
      missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel',
      missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel'],
      published: 'yes',
    } },
    operatorReliefProjection: {
      missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] },
      missionEvidenceLedgerProjection: { status: 'blocked', blockerCount: 1, missingProofSummary: 'build-proof | verify-proof | browser-proof-checklist | pr-evidence | source-pack-output' },
      packetBayProjection: { missingProofSummary: 'build-proof | verify-proof | browser-proof-checklist | pr-evidence | source-pack-output', packets: [] },
      projectAwarenessProjection: { missingProof: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], nextBestAction: 'Collect build-proof.' },
      agentRealityLoopProjection: { missingProof: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], supportSnapshotFields: { agent_reality_loop_missing_proof_summary: 'build-proof | verify-proof | browser-proof-checklist | pr-evidence | source-pack-output' } },
    },
  }, routeTruthView: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {} }));
  assert.match(snapshot, /Command Deck Render Proof Source: live-dom/);
  assert.match(snapshot, /Evidence Intake Accepted Proof Items: build-proof/);
  assert.match(snapshot, /Mission Proof Remaining Missing Items: verify-proof\|browser-proof-checklist\|pr-evidence\|source-pack-output/);
  assert.match(snapshot, /Mission Proof Next Best Action: Collect verify-proof\./);
  assert.doesNotMatch(snapshot, /Mission Evidence Ledger Missing Proof Summary: .*build-proof/);
  assert.doesNotMatch(snapshot, /Packet Missing Proof Summary: .*build-proof/);
  assert.doesNotMatch(snapshot, /Project Awareness Missing Proof Summary: .*build-proof/);
  assert.doesNotMatch(snapshot, /Agent Reality Loop Missing Proof Summary: .*build-proof/);
  assert.match(snapshot, /Mission Evidence Ledger Trusted For Merge: no/);
  assert.match(snapshot, /Agent Reality Loop Merge Recommendation: hold/);
  assert.match(snapshot, /Command Deck Input Auto Resize Enabled: yes/);
  assert.match(snapshot, /Command Deck Input Scroll Height: 280/);
  assert.match(snapshot, /Command Deck Input Client Height: 144/);
  assert.match(snapshot, /Command Deck Execute Button Visible: yes/);
  assert.match(snapshot, /Command Deck Execute Visible With Large Input: yes/);
  assert.match(snapshot, /Command Deck Large Paste Usability Status: OK/);
});

test('Support Snapshot exposes canonical cockpit projection, drift, and visual proof fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: {
    lastExecutionMetadata: {
      command_deck_universal_intake_status: 'classified',
      command_deck_universal_intake_last_kinds: 'codex-result|build-proof',
      command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
      command_deck_universal_intake_accepted_proof_items: 'build-proof',
    },
    runtimeContext: { operatorReliefBridgeDiagnostics: { projectionKeysSeen: ['missionProofReconciliation'], publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel'], publisherRegistryInstanceCount: 1, publisherRegistryOwnerId: 'owner', publisherSource: 'MissionConsoleTile', missionConsoleBridgeParityStatus: 'OK', missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel', missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel'], published: 'yes' } },
    operatorReliefProjection: {
      missionProofReconciliation: { acceptedItems: ['mission-console-bridge', 'build-proof'], remainingMissingItems: ['verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], nextBestAction: 'Collect verify-proof.' },
      projectAwarenessProjection: { title: 'Operator Cockpit View V1', status: 'active' },
      missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false },
      packetBayProjection: { recommendedPacketId: 'proof-collection-packet', recommendedSurface: 'Command Deck' },
      agentRealityLoopProjection: { mergeRecommendation: 'hold', openClawMutationLocked: true, codexAutoDispatchAllowed: false },
    },
  }, routeTruthView: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {} });
  assert.match(snapshot, /Operator Cockpit Projection Status: available/);
  assert.match(snapshot, /Operator Cockpit Projection Source: canonical cockpit projection/);
  assert.match(snapshot, /Operator Cockpit Missing Proof Count: 4/);
  assert.match(snapshot, /Operator Cockpit Missing Proof: verify-proof\|browser-proof-checklist\|pr-evidence\|source-pack-output/);
  assert.match(snapshot, /Operator Cockpit Next Best Action: Collect verify-proof\./);
  assert.match(snapshot, /Operator Cockpit Merge Safety: no \/ hold/);
  assert.match(snapshot, /Operator Cockpit OpenClaw Mutation Locked: yes/);
  assert.match(snapshot, /Landing Cockpit Tile Projection Source: canonical cockpit projection/);
  assert.match(snapshot, /Expanded Cockpit Pane Projection Source: canonical cockpit projection/);
  assert.match(snapshot, /Cockpit Surface Drift Detected: no/);
  assert.match(snapshot, /Operator Cockpit Visual Present: yes/);
  assert.match(snapshot, /Landing Cockpit Visual Position: before-text/);
  assert.match(snapshot, /Expanded Cockpit Visual Position: before-text/);
  assert.match(snapshot, /Cockpit Visual\/Text Drift Detected: no/);
});

test('support snapshot exposes browser proof accepted-with-caveat intake status and cumulative propagation after rejection', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: { lastExecutionMetadata: {
    command_deck_universal_intake_status: 'classified',
    command_deck_universal_intake_last_kinds: 'browser-proof-checklist',
    command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
    command_deck_universal_intake_accepted_proof_items: 'browser-proof-checklist',
    command_deck_cumulative_accepted_proof_items: 'build-proof|verify-proof|browser-proof-checklist',
    command_deck_cumulative_rejected_proof_items: 'none',
    browser_proof_intake_status: 'accepted',
    browser_proof_known_caveat_present: 'yes',
    browser_proof_caveat_blocking: 'no',
    browser_proof_rejection_reason: 'none',
    browser_proof_accepted_with_caveat: 'yes',
  }, runtimeContext: { operatorReliefBridgeDiagnostics: { projectionKeysSeen: ['missionProofReconciliation'], publisherRegistryInstanceIds: ['aiCoreMissionConsolePanel'], publisherRegistryInstanceCount: 1, publisherRegistryOwnerId: 'owner', publisherSource: 'MissionConsoleTile', missionConsoleBridgeParityStatus: 'OK', missionConsoleVisibleInstanceId: 'aiCoreMissionConsolePanel', missionConsoleBridgeCapableInstanceIds: ['aiCoreMissionConsolePanel'], published: 'yes' } }, operatorReliefProjection: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] }, missionEvidenceLedgerProjection: { status: 'blocked', blockerCount: 1, missingProofSummary: 'build-proof | verify-proof | browser-proof-checklist | pr-evidence | source-pack-output', trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, packetBayProjection: { packets: [] } } }, routeTruthView: {}, runtimeContext: {}, safeApiStatus: {}, statusSummary: {} });
  assert.match(snapshot, /Browser Proof Intake Status: accepted/);
  assert.match(snapshot, /Browser Proof Known Caveat Present: yes/);
  assert.match(snapshot, /Browser Proof Caveat Blocking: no/);
  assert.match(snapshot, /Browser Proof Accepted With Caveat: yes/);
  assert.match(snapshot, /Browser Proof Rejection Reason: none/);
  assert.match(snapshot, /Mission Proof Accepted Items: mission-console-bridge\|build-proof\|verify-proof\|browser-proof-checklist/);
  assert.match(snapshot, /Mission Proof Remaining Missing Items: pr-evidence\|source-pack-output/);
  assert.match(snapshot, /Mission Proof Next Best Action: Collect pr-evidence\./);
});

test('Support Snapshot exposes Operator Proof Concierge contradiction diagnostic fields', () => {
  const snapshot = buildSupportSnapshot({ runtimeStatus: {} });
  assert.match(snapshot, /Operator Proof Concierge Proof State Contradiction Detected:/);
  assert.match(snapshot, /Operator Proof Concierge Contradiction Reason:/);
  assert.match(snapshot, /Operator Proof Concierge Visible Primary Button Label:/);
  assert.match(snapshot, /Operator Proof Concierge Visible Primary Button Source:/);
  assert.match(snapshot, /Proof Concierge Render Owner:/);
  assert.match(snapshot, /Proof Concierge Render Source File:/);
  assert.match(snapshot, /Proof Concierge Render Branch:/);
  assert.match(snapshot, /Proof Concierge Rendered Next Proof:/);
  assert.match(snapshot, /Proof Concierge Rendered Copy Label:/);
  assert.match(snapshot, /Proof Concierge Canonical Next Proof:/);
  assert.match(snapshot, /Proof Concierge Canonical Copy Label:/);
  assert.match(snapshot, /Proof Concierge Render\/Canonical Drift Detected:/);
  assert.match(snapshot, /Mission Proof Accepted Items:/);
  assert.match(snapshot, /Mission Proof Remaining Missing Items:/);
  assert.match(snapshot, /Mission Proof Next Best Action:/);
  assert.match(snapshot, /Operator Cockpit Missing Proof:/);
  assert.match(snapshot, /Operator Cockpit Next Best Action:/);
});

test('support snapshot exposes Command Deck diagnostic proof-state review fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastExecutionMetadata: {
        command_deck_last_diagnostic_packet_detected: 'yes',
        command_deck_last_diagnostic_packet_kind: 'proof-state-diagnostic/operator-proof-concierge',
        command_deck_last_diagnostic_routed_to: 'proof-state-review',
        command_deck_last_diagnostic_response_generated: 'yes',
        command_deck_last_diagnostic_active_contradiction: 'no',
        command_deck_last_diagnostic_next_action: 'Copy build-proof packet from Operator Proof Concierge.',
        command_deck_last_diagnostic_mutated_proof_state: 'no',
        command_deck_executive_voice_status: 'available',
        command_deck_executive_voice_response_generated: 'yes',
        command_deck_executive_voice_response_kind: 'diagnostic-stale',
        command_deck_executive_voice_next_move: 'Use Operator Proof Concierge to copy the build-proof packet, paste it here, and Execute.',
        command_deck_executive_voice_safety_summary_present: 'yes',
        command_deck_executive_voice_uses_canonical_state: 'yes',
        command_deck_executive_voice_mutation_allowed: 'no',
      },
    },
  });
  assert.match(snapshot, /Command Deck Last Diagnostic Packet Detected: yes/);
  assert.match(snapshot, /Command Deck Last Diagnostic Packet Kind: proof-state-diagnostic\/operator-proof-concierge/);
  assert.match(snapshot, /Command Deck Last Diagnostic Routed To: proof-state-review/);
  assert.match(snapshot, /Command Deck Last Diagnostic Response Generated: yes/);
  assert.match(snapshot, /Command Deck Last Diagnostic Active Contradiction: no/);
  assert.match(snapshot, /Command Deck Last Diagnostic Next Action: Copy build-proof packet from Operator Proof Concierge\./);
  assert.match(snapshot, /Command Deck Last Diagnostic Mutated Proof State: no/);
  assert.match(snapshot, /Command Deck Executive Voice Status: available/);
  assert.match(snapshot, /Command Deck Executive Voice Response Generated: yes/);
  assert.match(snapshot, /Command Deck Executive Voice Response Kind: diagnostic-stale/);
  assert.match(snapshot, /Command Deck Executive Voice Next Move: Use Operator Proof Concierge to copy the build-proof packet, paste it here, and Execute\./);
  assert.match(snapshot, /Command Deck Executive Voice Safety Summary Present: yes/);
  assert.match(snapshot, /Command Deck Executive Voice Uses Canonical State: yes/);
  assert.match(snapshot, /Command Deck Executive Voice Mutation Allowed: no/);
});

test('Support Snapshot reads Operator Proof Concierge visible DOM text and confirms projection match', () => {
  const previousDocument = globalThis.document;
  const button = {
    textContent: 'Copy build-proof packet',
    getAttribute(name) {
      if (name === 'data-testid') return 'operator-proof-concierge-primary-copy';
      if (name === 'data-concierge-visible-primary-button-source') return 'OperatorProofConcierge.copyPacket';
      return null;
    },
    querySelector() { return null; },
  };
  const nextProofStrong = { textContent: 'build-proof', getAttribute() { return null; }, querySelector() { return null; } };
  const nextProof = {
    textContent: 'Next proof build-proof',
    getAttribute(name) { return name === 'data-testid' ? 'operator-proof-concierge-next-proof' : null; },
    querySelector(selector) { return selector === 'strong' ? nextProofStrong : null; },
  };
  const card = {
    textContent: 'Operator Proof Concierge Next proof build-proof Copy build-proof packet',
    getAttribute(name) { return name === 'data-testid' ? 'operator-proof-concierge' : null; },
    querySelector(selector) {
      if (selector.includes('operator-proof-concierge-primary-copy') || selector.includes('primary-proof-copy')) return button;
      if (selector.includes('operator-proof-concierge-next-proof') || selector.includes('next-proof')) return nextProof;
      return null;
    },
  };
  globalThis.document = { querySelector(selector) { return selector === '[data-testid="operator-proof-concierge"]' ? card : null; } };
  try {
    const snapshot = buildSupportSnapshot({ runtimeStatus: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof'] } } });
    assert.match(snapshot, /Proof Concierge DOM Text Present: yes/);
    assert.match(snapshot, /Proof Concierge DOM Next Proof Text: build-proof/);
    assert.match(snapshot, /Proof Concierge DOM Primary Button Text: Copy build-proof packet/);
    assert.match(snapshot, /Proof Concierge DOM Primary Button Test ID: operator-proof-concierge-primary-copy/);
    assert.match(snapshot, /Proof Concierge DOM Primary Button Source Attr: OperatorProofConcierge\.copyPacket/);
    assert.match(snapshot, /Proof Concierge DOM Diagnostic Button Present: no/);
    assert.match(snapshot, /Proof Concierge DOM\/Projection Drift Detected: no/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('Support Snapshot detects Operator Proof Concierge DOM projection drift and names failing fields', () => {
  const previousDocument = globalThis.document;
  const button = { textContent: 'Copy proof-state diagnostic packet', getAttribute(name) { return name === 'data-testid' ? 'operator-proof-concierge-primary-copy' : name === 'data-concierge-visible-primary-button-source' ? 'OperatorProofConcierge.copyDiagnosticPacket' : null; }, querySelector() { return null; } };
  const nextProofStrong = { textContent: 'proof-state-reconciliation', getAttribute() { return null; }, querySelector() { return null; } };
  const nextProof = { textContent: 'Next proof proof-state-reconciliation', getAttribute() { return null; }, querySelector(selector) { return selector === 'strong' ? nextProofStrong : null; } };
  const card = { textContent: 'Operator Proof Concierge Next proof proof-state-reconciliation Copy proof-state diagnostic packet', getAttribute() { return null; }, querySelector(selector) { if (selector.includes('primary-copy') || selector.includes('primary-proof-copy')) return button; if (selector.includes('next-proof')) return nextProof; return null; } };
  globalThis.document = { querySelector(selector) { return selector === '[data-testid="operator-proof-concierge"]' ? card : null; } };
  try {
    const snapshot = buildSupportSnapshot({ runtimeStatus: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof'] } } });
    assert.match(snapshot, /Proof Concierge DOM\/Projection Drift Detected: yes/);
    assert.match(snapshot, /Proof Concierge DOM\/Projection Drift Reason: .*next-proof-text:dom=proof-state-reconciliation;projection=build-proof/);
    assert.match(snapshot, /Proof Concierge DOM\/Projection Drift Reason: .*primary-button-text:dom=Copy proof-state diagnostic packet;projection=Copy build-proof packet/);
  } finally {
    globalThis.document = previousDocument;
  }
});
