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
  },
]);

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
  if (isHostedHttps && isHttpActualTarget && reachability.selectedRouteUsable !== true) {
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

function patternMatchesFromContradictions(contradictions = []) {
  const byFamily = new Set(contradictions.map((entry) => entry.family));
  return KNOWN_PATTERNS
    .filter((pattern) => byFamily.has(pattern.family))
    .map((pattern) => {
      const familyContradictions = contradictions.filter((entry) => entry.family === pattern.family);
      const confidence = familyContradictions.some((entry) => entry.severity === 'error') ? 'high' : 'medium';
      return {
        patternId: pattern.id,
        name: pattern.name,
        family: pattern.family,
        knownPattern: true,
        confidence,
        description: pattern.description,
        likelyRootCause: pattern.likelyRootCause,
        downstreamSymptoms: pattern.downstreamSymptoms,
        recommendedFixDirection: pattern.recommendedFixDirection,
        confidenceGuidance: pattern.confidenceGuidance,
        evidence: familyContradictions.map((entry) => entry.evidence),
      };
    });
}

function buildRootCauseCandidates({ patternMatches = [], contradictions = [] } = {}) {
  return patternMatches
    .map((match, index) => {
      const explains = contradictions.filter((entry) => entry.family === match.family).map((entry) => entry.id);
      return {
        rank: index + 1,
        candidateId: `${match.patternId}-candidate`,
        failingLayer: match.family.includes('provider')
          ? 'provider-execution'
          : match.family.includes('timeout')
            ? 'timeout-policy'
            : match.family.includes('protocol')
              ? 'transport-protocol-boundary'
              : 'route-adjudication',
        suspectedRootCause: match.likelyRootCause,
        explainsContradictions: explains,
        downstreamSymptoms: match.downstreamSymptoms,
        nextInspectionBoundary: match.recommendedFixDirection,
        confidence: match.confidence,
      };
    })
    .sort((left, right) => {
      if (left.confidence === right.confidence) return left.rank - right.rank;
      if (left.confidence === 'high') return -1;
      if (right.confidence === 'high') return 1;
      return 0;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function buildSystemWatcherModel({
  runtimeTruth = {},
  canonicalRouteRuntimeTruth = {},
  runtimeContext = {},
} = {}) {
  const contradictions = detectContradictions({ runtimeTruth, canonicalRouteRuntimeTruth, runtimeContext });
  const patternMatches = patternMatchesFromContradictions(contradictions);
  const rootCauseCandidates = buildRootCauseCandidates({ patternMatches, contradictions });
  const topCandidate = rootCauseCandidates[0] || null;

  return {
    watcherVersion: 'system-watcher.v1',
    mode: 'observer-only',
    diagnosisSummary: {
      status: contradictions.some((entry) => entry.severity === 'error') ? 'attention-required' : contradictions.length > 0 ? 'monitoring' : 'stable',
      contradictionCount: contradictions.length,
      matchedPatternCount: patternMatches.length,
      likelyFailingLayer: topCandidate?.failingLayer || 'none-detected',
      headline: topCandidate
        ? `Likely ${topCandidate.failingLayer} issue: ${topCandidate.suspectedRootCause}`
        : 'No high-confidence contradiction pattern detected.',
    },
    contradictions,
    failureFamilies: [...new Set(contradictions.map((entry) => entry.family))],
    patternMatches,
    rootCauseCandidates,
    recommendations: {
      nextInspectionBoundary: topCandidate?.nextInspectionBoundary || 'Continue normal monitoring; no contradiction cluster requires action.',
      verificationChecks: topCandidate
        ? [
          `Verify contradiction closure for: ${topCandidate.explainsContradictions.join(', ') || 'n/a'}`,
          'Confirm canonicalRouteRuntimeTruth and finalRouteTruth remain aligned after changes.',
        ]
        : ['Validate route/provider truth alignment remains stable across one additional execution cycle.'],
    },
    patternMemory: {
      memoryVersion: 'runtime-operational-pattern-memory.v1',
      knownPatternCatalog: KNOWN_PATTERNS.map((pattern) => ({
        patternId: pattern.id,
        family: pattern.family,
        description: pattern.description,
      })),
      recentMatchedPatterns: patternMatches.slice(0, 6).map((match) => ({
        patternId: match.patternId,
        family: match.family,
        confidence: match.confidence,
      })),
      candidatePatterns: [],
      promotionPolicy: 'observer-only-no-auto-durable-promotion',
    },
    reasoningBoundaries: {
      evidenceSources: ['runtimeTruth', 'canonicalRouteRuntimeTruth', 'runtimeContext'],
      interpretationRule: 'Evidence and interpretations are separated; unknowns remain explicit.',
      speculationPolicy: 'No speculative conclusions are promoted to durable memory automatically.',
    },
  };
}
