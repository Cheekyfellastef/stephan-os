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
      lastTimeoutPolicySource: 'provider:ollama:default-timeout:ui-grace',
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
  assert.match(snapshot, /Last Timeout Policy Source: provider:ollama:default-timeout:ui-grace/);
  assert.match(snapshot, /Last Timeout Effective Provider: ollama/);
  assert.doesNotMatch(snapshot, /Last Timeout Policy Source: frontend:api-runtime/);
  assert.match(snapshot, /Timeout Truth Degraded By Route Usability: no/);
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
