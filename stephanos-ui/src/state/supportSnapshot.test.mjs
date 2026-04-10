import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportSnapshot } from './supportSnapshot.js';

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
  });

  assert.match(snapshot, /Stephanos Support Snapshot/);
  assert.match(snapshot, /Requested Route Mode: auto/);
  assert.match(snapshot, /Surface Device Class: tablet/);
  assert.match(snapshot, /Surface Embodiment Profile: field-tablet/);
  assert.match(snapshot, /Surface Active Protocols: touch-first-input, stacked-panels/);
  assert.match(snapshot, /Surface Friction Latest: panel-dragging \(mission-console\) confidence=0.66/);
  assert.match(snapshot, /Surface Friction Pattern Count: 1/);
  assert.match(snapshot, /Surface Friction Pattern Latest: panel-dragging strength=emerging recurrence=3/);
  assert.match(snapshot, /Surface Active Recommendations: 1/);
  assert.match(snapshot, /Surface Accepted Rules: 1/);
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
  assert.match(snapshot, /Last Zero Cost Policy: true/);
  assert.match(snapshot, /Last Paid Fresh Routes Enabled: false/);
  assert.match(snapshot, /Last Fresh Capability Mode: zero-cost-only/);
  assert.match(snapshot, /Last Stale Fallback Attempted: no/);
  assert.match(snapshot, /Context Assembly Used: true/);
  assert.match(snapshot, /Context Assembly Mode: self-build-elevated/);
  assert.match(snapshot, /Self-Build Prompt Detected: true/);
  assert.match(snapshot, /System Awareness Level: elevated-self-build/);
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
  assert.match(snapshot, /Memory Elevation Active: true/);
  assert.match(snapshot, /Elevated Memory Count: 5/);
  assert.match(snapshot, /Graph Linked Memory Count: 2/);
  assert.match(snapshot, /Memory Informed Recommendation: Prioritize mission-critical continuity memory first\./);
  assert.match(snapshot, /Route Winner Kind: home-node/);
  assert.match(snapshot, /Route Winner Transport Kind: tailscale/);
  assert.match(snapshot, /Route Auto Selection Source: runtime-truth-adjudication/);
  assert.match(snapshot, /Route Auto Switch Active: yes/);
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

test('buildSupportSnapshot separates provider health readiness from execution viability during fallback', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      lastSelectedProvider: 'ollama',
      lastActualProviderUsed: 'groq',
      lastFallbackUsed: 'yes',
      lastFallbackReason: 'ollama: Cannot connect to Ollama: it took too long to respond. [connect_timeout,provider,connect-timeout,model-warmup-likely; timeoutMs=120000]',
      lastSelectedProviderHealthOk: 'true',
      lastSelectedProviderHealthState: 'CONNECTED',
      lastSelectedProviderExecutionViability: 'failed',
      lastSelectedProviderExecutionFailureLayer: 'provider',
      lastSelectedProviderExecutionFailureLabel: 'connect_timeout',
      lastSelectedProviderExecutionFailurePhase: 'awaiting-response-headers',
      lastSelectedProviderTimeoutCategory: 'connect-timeout',
      lastSelectedProviderModelWarmupLikely: 'true',
      lastSelectedProviderWarmupRetryApplied: 'true',
      lastSelectedProviderWarmupRetryTimeoutMs: '120000',
      lastSelectedProviderElapsedMs: '120001',
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
});
