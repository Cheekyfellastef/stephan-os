function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function contradiction({ id, family, severity = 'warning', title, evidence = {}, interpretation, unknowns = [] }) {
  return {
    id,
    family,
    severity,
    title,
    evidence,
    interpretation,
    unknowns: asArray(unknowns),
  };
}

const TEMPORAL_WINDOW = 8;

const KNOWN_PATTERNS = Object.freeze([
  {
    id: 'protocol-boundary-mismatch',
    family: 'protocol-boundary-mismatch',
    name: 'HTTPS ⇄ HTTP protocol boundary mismatch',
    description: 'Hosted HTTPS surface is targeting HTTP backend/home bridge without a translation boundary.',
    likelyRootCause: 'Missing HTTPS bridge/proxy translation layer between hosted client and HTTP backend.',
    downstreamSymptoms: [
      'Backend appears unreachable from hosted client.',
      'Route appears degraded while transport may still be healthy.',
      'Fallback/provider behavior can look misleading.',
    ],
    recommendedFixDirection: 'Publish HTTPS-capable bridge endpoint (or reverse proxy) and keep hosted/local truth separated.',
    confidenceGuidance: 'high when hosted-web + https frontend + http actual target + unusable route',
    likelyRepairBoundary: {
      subsystem: 'route-target-resolution',
      files: ['shared/runtime/runtimeStatusModel.mjs', 'shared/runtime/runtimeAdjudicator.mjs'],
      moduleZone: 'Hosted bridge target normalization and canonical route projection',
      verificationStep: 'On hosted HTTPS origin, confirm selected actualTarget is HTTPS bridge and routeUsable transitions to true.',
      regressionCheck: 'Hosted bridge reuse/validation tests with non-local session targets.',
    },
  },
  {
    id: 'provider-intent-vs-execution-drift',
    family: 'provider-intent-vs-execution-drift',
    name: 'Provider intent/execution drift',
    description: 'Requested/selected provider diverges from executable provider truth.',
    likelyRootCause: 'Provider-stage collapse or fallback transparency drift.',
    downstreamSymptoms: ['Operator chases wrong provider config.', 'Fallback reason appears inconsistent with execution truth.'],
    recommendedFixDirection: 'Inspect provider health gating and fallback provenance in runtime adjudication.',
    confidenceGuidance: 'high when selected provider differs from executable provider with healthy selected provider expectation',
    likelyRepairBoundary: {
      subsystem: 'provider-stage-projection',
      files: ['shared/runtime/runtimeAdjudicator.mjs', 'stephanos-ui/src/state/supportSnapshot.js'],
      moduleZone: 'Provider intent/selected/executable stage projection and support wording',
      verificationStep: 'Trigger fallback provider scenario and verify selected/executable provider labels remain distinct in watcher output.',
      regressionCheck: 'Runtime adjudication provider fallback drift tests and support snapshot provider stage assertions.',
    },
  },
  {
    id: 'timeout-derivation-drift',
    family: 'timeout-derivation-drift',
    name: 'Timeout derivation drift',
    description: 'Timeout attribution points to provider while route truth indicates usability drift.',
    likelyRootCause: 'Timeout policy source is stale relative to route usability evidence.',
    downstreamSymptoms: ['Provider blamed for route-state timeout issue.', 'Retry policies target the wrong layer.'],
    recommendedFixDirection: 'Reconcile timeout source with current route usability and selected-route reachability.',
    confidenceGuidance: 'medium when timeout source says provider but route unusable contradictions exist',
    likelyRepairBoundary: {
      subsystem: 'timeout-attribution',
      files: ['shared/runtime/systemWatcherModel.mjs', 'stephanos-ui/src/state/supportSnapshot.js'],
      moduleZone: 'Timeout source attribution and operator-facing timeout labels',
      verificationStep: 'Compare UI/backend/provider timeout fields and validate failing layer assignment follows effective timeout provider/model.',
      regressionCheck: 'Watcher timeout derivation drift unit coverage and support snapshot timeout truth lines.',
    },
  },
  {
    id: 'hosted-local-truth-contamination',
    family: 'hosted-local-truth-contamination',
    name: 'Hosted/local truth contamination',
    description: 'Hosted/non-local route uses loopback or local-desktop assumptions.',
    likelyRootCause: 'Persisted local assumptions leaked into hosted session route selection.',
    downstreamSymptoms: ['Hosted route resolves to localhost.', 'Route mode looks valid but cannot execute remotely.'],
    recommendedFixDirection: 'Drop loopback/local-desktop candidates in non-local sessions and rerun route adjudication.',
    confidenceGuidance: 'high when non-local session + loopback target or local-desktop winning route',
    likelyRepairBoundary: {
      subsystem: 'session-route-sanitization',
      files: ['shared/runtime/runtimeStatusModel.mjs', 'shared/runtime/stephanosSessionMemory.mjs'],
      moduleZone: 'Hosted session route candidate filtering and remembered target hygiene',
      verificationStep: 'In hosted-web session, verify localhost candidates are dropped before route winner selection.',
      regressionCheck: 'Hosted route contamination and memory sanitization loopback tests.',
    },
  },
  {
    id: 'usable-vs-available-adjudication-mismatch',
    family: 'usable-vs-available-adjudication-mismatch',
    name: 'Usable vs available adjudication mismatch',
    description: 'Selected route reported reachable/available while not usable.',
    likelyRootCause: 'Reachability and usability signals are conflated or incomplete.',
    downstreamSymptoms: ['Operator sees contradictory route state.', 'Launch may degrade without clear root cause.'],
    recommendedFixDirection: 'Inspect route usability gating, UI reachability probe truth, and selected route blockers.',
    confidenceGuidance: 'high when selectedRouteReachable=true and selectedRouteUsable=false',
    likelyRepairBoundary: {
      subsystem: 'route-usability-adjudication',
      files: ['shared/runtime/runtimeAdjudicator.mjs', 'shared/runtime/runtimeStatusModel.mjs'],
      moduleZone: 'Reachability vs usability guardrails and canonical route computation',
      verificationStep: 'Reproduce selectedRouteReachable=true with selectedRouteUsable=false and inspect route blocker reason chain.',
      regressionCheck: 'Runtime adjudicator contradiction tests for reachable/not-usable route cases.',
    },
  },
  {
    id: 'backend-target-precedence-drift',
    family: 'backend-target-precedence-drift',
    name: 'Backend target precedence drift',
    description: 'Resolved backend target and actual selected target diverge.',
    likelyRootCause: 'Candidate precedence or stale remembered target is outranking canonical target.',
    downstreamSymptoms: ['Support projection disagrees with runtime route target.', 'Debugging chases wrong endpoint.'],
    recommendedFixDirection: 'Inspect backend candidate ordering and chosen target projection boundaries.',
    confidenceGuidance: 'medium when resolved target and actual target differ materially',
    likelyRepairBoundary: {
      subsystem: 'target-precedence',
      files: ['shared/runtime/runtimeStatusModel.mjs', 'stephanos-ui/src/state/supportSnapshot.js'],
      moduleZone: 'Backend target winner selection and route projection summaries',
      verificationStep: 'Capture route candidate list and confirm winner target equals canonical actualTarget for same transition.',
      regressionCheck: 'Route candidate precedence tests and support snapshot route winner projection assertions.',
    },
  },
  {
    id: 'ui-truth-projection-mismatch',
    family: 'ui-truth-projection-mismatch',
    name: 'UI truth projection mismatch',
    description: 'Operator-facing wording emphasizes a downstream symptom while runtime truth points to another primary boundary.',
    likelyRootCause: 'UI/support projection is stale, over-broad, or stage-collapsed against runtime adjudication truth.',
    downstreamSymptoms: ['Operators chase provider health while transport truth is primary.', 'Fallback wording implies substitution that did not execute.'],
    recommendedFixDirection: 'Align status/support projection fields to canonical runtime truth and preserve stage distinctions.',
    confidenceGuidance: 'medium-high when surface labels diverge from canonical runtime adjudication.',
    likelyRepairBoundary: {
      subsystem: 'operator-truth-projection',
      files: ['stephanos-ui/src/components/StatusPanel.jsx', 'stephanos-ui/src/state/supportSnapshot.js'],
      moduleZone: 'Status panel and support snapshot watcher projection section',
      verificationStep: 'Compare watcher contradiction interpretation with rendered/support text; ensure primary failure boundary wording matches runtime truth.',
      regressionCheck: 'Status panel render tests and support snapshot watcher lines for projection mismatch markers.',
    },
  },
]);

function normalizeTemporalEvidenceEvent(event = {}) {
  const source = asObject(event);
  const families = asArray(source.failureFamilies).map((family) => asText(family)).filter(Boolean);
  const contradictions = asArray(source.contradictionIds).map((id) => asText(id)).filter(Boolean);
  const routeKind = asText(source.routeKind || source.selectedRouteKind || source.winningRoute);
  const selectedProvider = asText(source.selectedProvider || source.provider);
  const executableProvider = asText(source.executableProvider || source.executedProvider);
  const timeoutLayer = asText(source.timeoutLayer || source.timeoutFailureLayer || source.timeoutSource);
  const usableState = source.selectedRouteUsable;
  const reachableState = source.selectedRouteReachable;
  if (families.length === 0
    && contradictions.length === 0
    && !routeKind
    && !selectedProvider
    && !executableProvider
    && !timeoutLayer
    && typeof usableState !== 'boolean'
    && typeof reachableState !== 'boolean') {
    return null;
  }

  return {
    timestamp: asText(source.timestamp || source.at || source.when, ''),
    failureFamilies: families,
    contradictionIds: contradictions,
    routeKind,
    selectedProvider,
    executableProvider,
    timeoutLayer,
    selectedRouteUsable: usableState,
    selectedRouteReachable: reachableState,
  };
}

function buildTemporalSignal({ contradictions = [], runtimeTruth = {}, runtimeContext = {} } = {}) {
  const context = asObject(runtimeContext);
  const historySources = [
    ...asArray(context.watcherRecentHistory),
    ...asArray(context.transitionHistory),
    ...asArray(context.recentRuntimeEvents),
  ];

  const recentHistory = historySources
    .map((entry) => normalizeTemporalEvidenceEvent(entry))
    .filter(Boolean)
    .slice(-TEMPORAL_WINDOW);

  const contradictionFamilies = contradictions.map((entry) => entry.family);
  const familyCounts = new Map();
  for (const entry of recentHistory) {
    for (const family of entry.failureFamilies) {
      familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
    }
  }

  const recurringFamilies = [];
  for (const family of new Set(contradictionFamilies)) {
    const seenInHistory = familyCounts.get(family) || 0;
    if (seenInHistory > 0) {
      recurringFamilies.push({
        family,
        recurrences: seenInHistory,
      });
    }
  }

  const routeKinds = recentHistory.map((entry) => entry.routeKind).filter(Boolean);
  const providerPairs = recentHistory
    .map((entry) => `${entry.selectedProvider || 'unknown'}→${entry.executableProvider || 'unknown'}`)
    .filter((pair) => pair !== 'unknown→unknown');
  const timeoutLayers = recentHistory.map((entry) => entry.timeoutLayer).filter(Boolean);

  const oscillationSignals = [];
  if (new Set(routeKinds).size > 1) {
    oscillationSignals.push('route-flip');
  }
  if (new Set(providerPairs).size > 1) {
    oscillationSignals.push('provider-stage-drift');
  }
  if (new Set(timeoutLayers).size > 1) {
    oscillationSignals.push('timeout-attribution-drift');
  }

  const transitionBackedEvidence = {
    historyWindowSize: recentHistory.length,
    recurringFamilies,
    oscillationSignals,
    routeKinds: routeKinds.slice(-4),
    providerStagePairs: providerPairs.slice(-4),
    timeoutLayers: timeoutLayers.slice(-4),
  };

  const recurrenceScore = recurringFamilies.reduce((sum, item) => sum + item.recurrences, 0);
  const currentErrorCount = contradictions.filter((entry) => entry.severity === 'error').length;
  const evidenceStrength = recurrenceScore + currentErrorCount + oscillationSignals.length;

  const persistenceClassification = evidenceStrength >= 4
    ? 'persistent-recurring'
    : evidenceStrength >= 2
      ? 'mixed-recurrence'
      : contradictions.length > 0
        ? 'likely-transient'
        : recentHistory.length > 0
          ? 'stable-recent-window'
          : 'insufficient-evidence';

  return {
    recentHistory,
    transitionBackedEvidence,
    persistenceClassification,
    temporalConfidence: evidenceStrength >= 4 ? 'reinforced' : evidenceStrength >= 2 ? 'moderate' : 'limited',
  };
}

function detectContradictions({ runtimeTruth = {}, canonicalRouteRuntimeTruth = {}, runtimeContext = {} } = {}) {
  const contradictions = [];
  const route = asObject(runtimeTruth.route);
  const reachability = asObject(runtimeTruth.reachabilityTruth);
  const provider = asObject(runtimeTruth.provider);
  const session = asObject(runtimeTruth.session);
  const canonical = asObject(canonicalRouteRuntimeTruth);
  const context = asObject(runtimeContext);

  if (reachability.selectedRouteReachable === true && reachability.selectedRouteUsable !== true) {
    contradictions.push(contradiction({
      id: 'selected-route-reachable-not-usable',
      family: 'usable-vs-available-adjudication-mismatch',
      title: 'Selected route is reachable but not usable.',
      evidence: {
        selectedRouteKind: route.selectedRouteKind,
        selectedRouteReachable: reachability.selectedRouteReachable,
        selectedRouteUsable: reachability.selectedRouteUsable,
        uiReachableState: reachability.uiReachableState,
      },
      interpretation: 'Route transport may be available while runtime execution path is blocked.',
      unknowns: ['Exact blocking boundary for selected route usability.'],
    }));
  }

  if (provider.selectedProvider && provider.executableProvider && provider.selectedProvider !== provider.executableProvider) {
    contradictions.push(contradiction({
      id: 'provider-selection-execution-drift',
      family: 'provider-intent-vs-execution-drift',
      title: 'Selected provider differs from executable provider.',
      evidence: {
        selectedProvider: provider.selectedProvider,
        executableProvider: provider.executableProvider,
        fallbackProviderUsed: provider.fallbackProviderUsed === true,
      },
      interpretation: 'Provider intent and execution stages diverged; fallback or health gating likely intervened.',
      unknowns: ['Whether divergence is expected fallback or stale provider stage projection.'],
    }));
  }

  if (session.nonLocalSession === true && asText(route.actualTarget).includes('localhost')) {
    contradictions.push(contradiction({
      id: 'hosted-loopback-target',
      family: 'hosted-local-truth-contamination',
      severity: 'error',
      title: 'Non-local session resolved to loopback target.',
      evidence: {
        sessionKind: session.sessionKind,
        actualTarget: route.actualTarget,
      },
      interpretation: 'Localhost assumptions leaked into hosted/non-local route adjudication.',
      unknowns: [],
    }));
  }

  const frontendOrigin = asText(context.frontendOrigin);
  const isHostedHttps = frontendOrigin.startsWith('https://') || asText(context.sessionKind) === 'hosted-web';
  const isHttpActualTarget = asText(route.actualTarget).startsWith('http://');
  const bridgeTruth = asObject(context.bridgeTransportTruth);
  const bridgeHostedExecutionTarget = asText(bridgeTruth.bridgeHostedExecutionTarget);
  const bridgeExecutionCompatible = asText(bridgeTruth.bridgeHostedExecutionCompatibility) === 'compatible';
  const bridgeExecutionCompatibleHttpsTarget = bridgeExecutionCompatible
    && bridgeHostedExecutionTarget.startsWith('https://');
  const bridgeExecutionReachable = bridgeExecutionCompatible
    && bridgeExecutionCompatibleHttpsTarget
    && (
      asText(bridgeTruth.bridgeAutoRevalidationState) === 'revalidated'
      || asText(bridgeTruth.bridgeMemoryReconciliationState) === 'remembered-revalidated'
      || bridgeTruth.bridgeMemoryReachableOnThisSurface === true
    );
  if (isHostedHttps && isHttpActualTarget && reachability.selectedRouteUsable !== true) {
    if (bridgeExecutionReachable) {
      contradictions.push(contradiction({
        id: 'https-bridge-promotion-drift',
        family: 'backend-target-precedence-drift',
        severity: 'error',
        title: 'Reachable HTTPS bridge exists, but selected route still uses HTTP backend target.',
        evidence: {
          frontendOrigin,
          actualTarget: route.actualTarget,
          bridgeHostedExecutionTarget,
          bridgeHostedExecutionCompatibility: bridgeTruth.bridgeHostedExecutionCompatibility,
          selectedRouteKind: route.selectedRouteKind,
          selectedRouteUsable: reachability.selectedRouteUsable,
        },
        interpretation: 'Bridge promotion/detection drift is likely preventing canonical HTTPS bridge route adoption.',
        unknowns: ['Whether candidate precedence or promotion gating blocked bridge route adoption.'],
      }));
    } else if (bridgeExecutionCompatibleHttpsTarget) {
      contradictions.push(contradiction({
        id: 'https-bridge-validation-pending',
        family: 'backend-target-precedence-drift',
        severity: 'warning',
        title: 'Hosted HTTPS bridge target exists, but validation/promotion truth is still pending.',
        evidence: {
          frontendOrigin,
          actualTarget: route.actualTarget,
          bridgeHostedExecutionTarget,
          bridgeHostedExecutionCompatibility: bridgeTruth.bridgeHostedExecutionCompatibility,
          bridgeAutoRevalidationState: bridgeTruth.bridgeAutoRevalidationState,
          selectedRouteKind: route.selectedRouteKind,
          selectedRouteUsable: reachability.selectedRouteUsable,
        },
        interpretation: 'HTTPS bridge/proxy is present; validation or candidate-promotion gating is lagging behind route adoption.',
        unknowns: ['Whether bounded retry state, stale probe evidence, or candidate precedence is blocking promotion.'],
      }));
    } else {
      contradictions.push(contradiction({
        id: 'https-http-boundary-mismatch',
        family: 'protocol-boundary-mismatch',
        severity: 'error',
        title: 'Hosted HTTPS surface is executing against HTTP backend target.',
        evidence: {
          frontendOrigin,
          actualTarget: route.actualTarget,
          selectedRouteKind: route.selectedRouteKind,
          selectedRouteUsable: reachability.selectedRouteUsable,
        },
        interpretation: 'Protocol translation boundary is likely missing (HTTPS browser to HTTP backend).',
        unknowns: ['Whether HTTPS bridge exists but is stale/unreachable.'],
      }));
    }
  }

  const resolvedUrl = asText(context.backendTargetResolvedUrl);
  const actualTarget = asText(route.actualTarget);
  if (resolvedUrl && actualTarget && resolvedUrl !== actualTarget) {
    contradictions.push(contradiction({
      id: 'backend-target-resolution-drift',
      family: 'backend-target-precedence-drift',
      title: 'Resolved backend target differs from selected route actual target.',
      evidence: {
        backendTargetResolvedUrl: resolvedUrl,
        actualTarget,
        backendTargetResolutionSource: asText(context.backendTargetResolutionSource, 'unknown'),
      },
      interpretation: 'Target precedence or projection drift may be surfacing conflicting backend truth.',
      unknowns: ['Which target is canonical for current session boundary.'],
    }));
  }

  const timeoutPolicySource = asText(context.lastTimeoutPolicySource || runtimeTruth.lastTimeoutPolicySource);
  const timeoutFailureLayer = asText(context.lastTimeoutFailureLayer || runtimeTruth.lastTimeoutFailureLayer);
  const timeoutEffectiveProvider = asText(context.lastTimeoutEffectiveProvider || runtimeTruth.lastTimeoutEffectiveProvider);
  const selectedProvider = asText(provider.selectedProvider);
  const hasRouteUsabilityDrift = reachability.selectedRouteReachable === true
    && reachability.backendReachable === true
    && reachability.selectedRouteUsable !== true;
  if ((timeoutFailureLayer === 'provider' || timeoutPolicySource.startsWith('provider:'))
    && hasRouteUsabilityDrift) {
    contradictions.push(contradiction({
      id: 'timeout-attribution-provider-vs-route-drift',
      family: 'timeout-derivation-drift',
      title: 'Timeout is attributed to provider while route usability evidence indicates route boundary drift.',
      evidence: {
        timeoutPolicySource: timeoutPolicySource || 'unknown',
        timeoutFailureLayer: timeoutFailureLayer || 'unknown',
        timeoutEffectiveProvider: timeoutEffectiveProvider || 'unknown',
        selectedProvider: selectedProvider || 'unknown',
        selectedRouteReachable: reachability.selectedRouteReachable,
        selectedRouteUsable: reachability.selectedRouteUsable,
        backendReachable: reachability.backendReachable,
      },
      interpretation: 'Provider timeout attribution likely masks a route or transport usability blocker.',
      unknowns: ['Whether timeout labeling came from stale policy source projection.'],
    }));
  }

  if (timeoutEffectiveProvider && selectedProvider && timeoutEffectiveProvider !== selectedProvider) {
    contradictions.push(contradiction({
      id: 'timeout-effective-provider-selection-drift',
      family: 'timeout-derivation-drift',
      title: 'Effective timeout provider differs from selected provider stage.',
      evidence: {
        timeoutEffectiveProvider,
        selectedProvider,
        executableProvider: provider.executableProvider || 'unknown',
        timeoutPolicySource: timeoutPolicySource || 'unknown',
      },
      interpretation: 'Timeout policy may be using intent/provider stage that differs from execution truth.',
      unknowns: ['Whether timeout provider derives from fallback stage or stale intent projection.'],
    }));
  }

  const uiSummary = asText(context.uiStatusSummary || context.statusSummaryHeadline || context.surfaceFailureLabel);
  const uiProviderFocus = uiSummary.toLowerCase().includes('provider') || uiSummary.toLowerCase().includes('model');
  const transportPrimary = contradictions.some((entry) => ['protocol-boundary-mismatch', 'backend-target-precedence-drift'].includes(entry.family));
  if (uiProviderFocus && transportPrimary) {
    contradictions.push(contradiction({
      id: 'ui-provider-emphasis-vs-transport-primary',
      family: 'ui-truth-projection-mismatch',
      title: 'UI surface emphasizes provider state while transport/route boundary appears primary.',
      evidence: {
        uiStatusSummary: uiSummary,
        transportContradictions: contradictions
          .filter((entry) => ['protocol-boundary-mismatch', 'backend-target-precedence-drift'].includes(entry.family))
          .map((entry) => entry.id),
      },
      interpretation: 'Operator-facing wording may over-attribute failure to provider health instead of transport truth.',
      unknowns: ['Whether projection mismatch is stale UI text or missing canonical truth feed.'],
    }));
  }

  if (canonical.winningRoute === 'cloud' && canonical.routeUsable === true && canonical.backendReachable !== true) {
    contradictions.push(contradiction({
      id: 'cloud-usable-without-backend',
      family: 'transport-canonicalization-drift',
      title: 'Canonical route is usable while backend is reported unreachable.',
      evidence: {
        winningRoute: canonical.winningRoute,
        routeUsable: canonical.routeUsable,
        backendReachable: canonical.backendReachable,
      },
      interpretation: 'Reachability truth may be lagging selected route adjudication.',
      unknowns: ['Whether backend reachability probe is stale or route usability is overpromoted.'],
    }));
  }

  return contradictions;
}

function patternMatchesFromContradictions(contradictions = [], temporalSignal = {}) {
  const byFamily = new Set(contradictions.map((entry) => entry.family));
  const recurringFamilies = asArray(temporalSignal.transitionBackedEvidence?.recurringFamilies);
  return KNOWN_PATTERNS
    .filter((pattern) => byFamily.has(pattern.family))
    .map((pattern) => {
      const familyContradictions = contradictions.filter((entry) => entry.family === pattern.family);
      const recurring = recurringFamilies.find((entry) => entry.family === pattern.family);
      const confidence = familyContradictions.some((entry) => entry.severity === 'error') || (recurring?.recurrences || 0) >= 2
        ? 'high'
        : 'medium';
      return {
        patternId: pattern.id,
        name: pattern.name,
        family: pattern.family,
        knownPattern: true,
        confidence,
        temporalRecurrenceCount: recurring?.recurrences || 0,
        description: pattern.description,
        likelyRootCause: pattern.likelyRootCause,
        downstreamSymptoms: pattern.downstreamSymptoms,
        recommendedFixDirection: pattern.recommendedFixDirection,
        confidenceGuidance: pattern.confidenceGuidance,
        likelyRepairBoundary: pattern.likelyRepairBoundary,
        evidence: familyContradictions.map((entry) => entry.evidence),
      };
    });
}

function failingLayerForFamily(family = '') {
  if (family.includes('provider')) return 'provider-execution';
  if (family.includes('timeout')) return 'timeout-policy';
  if (family.includes('protocol')) return 'transport-protocol-boundary';
  if (family.includes('projection')) return 'operator-surface-projection';
  return 'route-adjudication';
}

function buildRootCauseCandidates({ patternMatches = [], contradictions = [], temporalSignal = {} } = {}) {
  const recurringFamilies = asArray(temporalSignal.transitionBackedEvidence?.recurringFamilies);

  return patternMatches
    .map((match, index) => {
      const explains = contradictions.filter((entry) => entry.family === match.family).map((entry) => entry.id);
      const recurring = recurringFamilies.find((entry) => entry.family === match.family);
      return {
        rank: index + 1,
        candidateId: `${match.patternId}-candidate`,
        failingLayer: failingLayerForFamily(match.family),
        suspectedRootCause: match.likelyRootCause,
        explainsContradictions: explains,
        downstreamSymptoms: match.downstreamSymptoms,
        nextInspectionBoundary: match.recommendedFixDirection,
        confidence: match.confidence,
        recurrenceCount: recurring?.recurrences || 0,
        likelyRepairBoundary: match.likelyRepairBoundary || null,
        likelyVerificationStep: match.likelyRepairBoundary?.verificationStep || match.recommendedFixDirection,
        likelyRegressionCheck: match.likelyRepairBoundary?.regressionCheck || 'Confirm contradiction closure without regressions in runtime adjudication.',
      };
    })
    .sort((left, right) => {
      if (left.confidence !== right.confidence) {
        if (left.confidence === 'high') return -1;
        if (right.confidence === 'high') return 1;
      }
      if (left.recurrenceCount !== right.recurrenceCount) {
        return right.recurrenceCount - left.recurrenceCount;
      }
      return left.rank - right.rank;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function buildSystemWatcherModel({
  runtimeTruth = {},
  canonicalRouteRuntimeTruth = {},
  runtimeContext = {},
} = {}) {
  const contradictions = detectContradictions({ runtimeTruth, canonicalRouteRuntimeTruth, runtimeContext });
  const temporalSignal = buildTemporalSignal({ contradictions, runtimeTruth, runtimeContext });
  const patternMatches = patternMatchesFromContradictions(contradictions, temporalSignal);
  const rootCauseCandidates = buildRootCauseCandidates({ patternMatches, contradictions, temporalSignal });
  const topCandidate = rootCauseCandidates[0] || null;

  return {
    watcherVersion: 'system-watcher.v2',
    mode: 'observer-only',
    diagnosisSummary: {
      status: contradictions.some((entry) => entry.severity === 'error') ? 'attention-required' : contradictions.length > 0 ? 'monitoring' : 'stable',
      contradictionCount: contradictions.length,
      matchedPatternCount: patternMatches.length,
      likelyFailingLayer: topCandidate?.failingLayer || 'none-detected',
      persistenceClassification: temporalSignal.persistenceClassification,
      temporalConfidence: temporalSignal.temporalConfidence,
      headline: topCandidate
        ? `Likely ${topCandidate.failingLayer} issue: ${topCandidate.suspectedRootCause}`
        : 'No high-confidence contradiction pattern detected.',
    },
    contradictions,
    failureFamilies: [...new Set(contradictions.map((entry) => entry.family))],
    patternMatches,
    rootCauseCandidates,
    temporalSignal: {
      windowSize: TEMPORAL_WINDOW,
      persistenceClassification: temporalSignal.persistenceClassification,
      temporalConfidence: temporalSignal.temporalConfidence,
      transitionBackedEvidence: temporalSignal.transitionBackedEvidence,
    },
    recommendations: {
      nextInspectionBoundary: topCandidate?.nextInspectionBoundary || 'Continue normal monitoring; no contradiction cluster requires action.',
      verificationChecks: topCandidate
        ? [
          `Verify contradiction closure for: ${topCandidate.explainsContradictions.join(', ') || 'n/a'}`,
          topCandidate.likelyVerificationStep,
          'Confirm canonicalRouteRuntimeTruth and finalRouteTruth remain aligned after changes.',
        ]
        : ['Validate route/provider truth alignment remains stable across one additional execution cycle.'],
      regressionChecks: topCandidate
        ? [topCandidate.likelyRegressionCheck]
        : ['Re-run existing runtime adjudication watcher tests to confirm stable baseline.'],
    },
    patternMemory: {
      memoryVersion: 'runtime-operational-pattern-memory.v2',
      knownPatternCatalog: KNOWN_PATTERNS.map((pattern) => ({
        patternId: pattern.id,
        family: pattern.family,
        description: pattern.description,
      })),
      recentMatchedPatterns: patternMatches.slice(0, 6).map((match) => ({
        patternId: match.patternId,
        family: match.family,
        confidence: match.confidence,
        temporalRecurrenceCount: match.temporalRecurrenceCount || 0,
      })),
      candidatePatterns: [],
      promotionPolicy: 'observer-only-no-auto-durable-promotion',
    },
    reasoningBoundaries: {
      evidenceSources: ['runtimeTruth', 'canonicalRouteRuntimeTruth', 'runtimeContext', 'runtimeContext.watcherRecentHistory?'],
      interpretationRule: 'Evidence, temporal reinforcement, and recommendations remain separate and inspectable.',
      speculationPolicy: 'No speculative conclusions are promoted to durable memory automatically.',
    },
  };
}
