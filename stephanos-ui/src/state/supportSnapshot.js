function asText(value, fallback = 'n/a') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function asList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return ['- n/a'];
  }
  return value.map((item) => `- ${asText(item, 'n/a')}`);
}

function summarizeRouteDiagnostics(routeDiagnostics, { selectedRouteKind = '' } = {}) {
  if (!routeDiagnostics || typeof routeDiagnostics !== 'object') {
    return ['- n/a'];
  }

  const selectedKey = String(selectedRouteKind || '').trim();
  const orderedEntries = Object.entries(routeDiagnostics).sort(([left], [right]) => {
    if (left === selectedKey) return -1;
    if (right === selectedKey) return 1;
    return 0;
  });
  const entries = orderedEntries.slice(0, 4).map(([key, details]) => {
    if (!details || typeof details !== 'object') {
      return `- ${key}: n/a`;
    }
    const state = details.usable === true
      ? 'usable'
      : details.usable === false
        ? 'blocked'
        : details.available === true
          ? 'available'
          : details.available === false
            ? 'unavailable'
            : 'unknown';
    const reason = asText(details.reason || details.blockedReason || details.operatorReason, 'n/a');
    const routeLabel = key === selectedKey
      ? `${key} [selected]`
      : selectedKey
        ? `${key} [candidate]`
        : key;
    return `- ${routeLabel}: ${state} (${reason})`;
  });

  return entries.length > 0 ? entries : ['- n/a'];
}


function hasMeaningfulDiagnostics(lines = []) {
  return Array.isArray(lines) && lines.some((line) => line !== '- n/a');
}

function isNoOperatorActionGuidance(value = '') {
  return String(value || '').trim().toLowerCase() === 'no operator action required.';
}

function isLiveCloudProvider(providerKey = '') {
  const provider = String(providerKey || '').trim().toLowerCase();
  if (!provider) return false;
  return !['none', 'n/a', 'unknown', 'mock', 'ollama'].includes(provider);
}

function isHostedCloudCanonicalReady({
  sessionKind,
  selectedRouteKind,
  selectedRouteReachableState,
  routeUsableState,
  backendReachableState,
  cloudAvailable,
  fallbackActive,
  executableProvider,
  launchState,
} = {}) {
  return sessionKind === 'hosted-web'
    && selectedRouteKind === 'cloud'
    && String(selectedRouteReachableState || '').trim().toLowerCase() === 'yes'
    && String(routeUsableState || '').trim().toLowerCase() === 'yes'
    && String(backendReachableState || '').trim().toLowerCase() === 'yes'
    && cloudAvailable === true
    && fallbackActive !== true
    && String(launchState || '').trim().toLowerCase() === 'ready'
    && isLiveCloudProvider(executableProvider);
}

function isTileReadinessContradictionWarning(message = '') {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized.includes('runtime reports ready while tile execution readiness is false');
}

function formatParityState(value) {
  if (value === true) return 'in-sync';
  if (value === false) return 'stale';
  return 'unknown';
}

function summarizeBackendTargetCandidates(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return ['- n/a'];
  }

  return candidates.slice(0, 5).map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return '- unknown candidate';
    }

    const source = asText(candidate.source, 'unknown-source');
    const url = asText(candidate.url, 'n/a');
    const verdict = candidate.accepted === true
      ? 'accepted'
      : `rejected (${asText(candidate.reason, 'unknown reason')})`;
    return `- ${source}: ${url} -> ${verdict}`;
  });
}

function buildHostedBackendTargetGuidance({
  canonicalHostedRouteTruth,
  sessionKind,
  selectedRouteKind,
  selectedRouteReachableState,
  routeUsableState,
  backendReachableState,
  cloudAvailable,
  executableProvider,
  backendTargetInvalidReason,
  backendTargetResolvedUrl,
  backendTargetResolutionSource,
  backendTargetFallbackUsed,
} = {}) {
  const hostedTruth = canonicalHostedRouteTruth && typeof canonicalHostedRouteTruth === 'object'
    ? canonicalHostedRouteTruth
    : null;
  const hostedSession = sessionKind === 'hosted-web';
  const routeUnavailable = selectedRouteKind === 'unavailable';
  const unresolved = hostedTruth
    ? hostedTruth.backendTargetValidity === 'unresolved'
    : (!backendTargetResolvedUrl || backendTargetResolvedUrl === 'n/a');
  const routeReachable = String(selectedRouteReachableState || '').trim().toLowerCase() === 'yes';
  const routeUsable = String(routeUsableState || '').trim().toLowerCase() === 'yes';
  const backendReachable = String(backendReachableState || '').trim().toLowerCase() === 'yes';
  const cloudRouteAvailable = cloudAvailable === true;
  const cloudProviderOperational = isLiveCloudProvider(executableProvider);
  const cloudExecutionOperational = selectedRouteKind === 'cloud'
    && routeReachable
    && routeUsable
    && backendReachable
    && cloudRouteAvailable
    && cloudProviderOperational;
  if (!hostedSession || (!routeUnavailable && !backendTargetInvalidReason && !unresolved && !hostedTruth?.blockingIssues?.length)) {
    return null;
  }

  const reason = asText(
    backendTargetInvalidReason,
    unresolved
      ? 'Hosted runtime could not resolve a non-loopback backend target.'
      : 'Hosted backend target is unresolved.',
  );
  const blocked = hostedTruth
    ? hostedTruth.selectedRouteKind === 'unavailable'
      || hostedTruth.selectedRouteUsable === false
      || (Array.isArray(hostedTruth.blockingIssues) && hostedTruth.blockingIssues.length > 0)
    : (routeUnavailable || !routeUsable || !routeReachable);
  const statusLabel = blocked ? 'blocked' : 'informational';
  const executionLabel = cloudExecutionOperational
    ? asText(executableProvider, 'cloud provider')
    : 'none';

  return {
    reason,
    summary: [
      `- backend-target: ${statusLabel} (${reason})`,
      `- resolution-source: ${asText(backendTargetResolutionSource, 'unresolved')}`,
      `- fallback-used: ${backendTargetFallbackUsed ? 'yes' : 'no'}`,
      `- cloud-execution: ${cloudExecutionOperational ? `operational (${executionLabel})` : 'not confirmed'}`,
    ],
    blockingIssue: blocked
      ? (hostedTruth?.blockingIssues?.[0]?.message
        || `Backend target unresolved: ${reason}`)
      : '',
    operatorGuidance: blocked
      ? 'Resolve a reachable non-loopback backend target for hosted-web (cloud or home-node) and republish route diagnostics before relaunch.'
      : '',
  };
}


export function buildSupportSnapshot({
  runtimeStatus,
  routeTruthView,
  runtimeSessionTruth,
  runtimeRouteTruth,
  runtimeReachabilityTruth,
  runtimeProviderTruth,
  runtimeDiagnosticsTruth,
  runtimeContext,
  safeApiStatus,
  statusSummary,
  now = new Date(),
  origin,
  href,
}) {
  const canonicalTruth = runtimeStatus?.canonicalRouteRuntimeTruth || {};
  const canonicalHostedRouteTruth = runtimeContext?.canonicalHostedRouteTruth || canonicalTruth?.hostedRouteTruth || null;
  const resolvedOrigin = asText(origin || runtimeContext?.frontendOrigin || safeApiStatus?.frontendOrigin || '', 'n/a');
  const resolvedUrl = asText(href || runtimeContext?.frontendUrl || '', 'n/a');
  const backendTargetResolutionSource = asText(runtimeContext?.backendTargetResolutionSource, 'n/a');
  const backendTargetResolvedUrl = asText(runtimeContext?.backendTargetResolvedUrl, 'n/a');
  const backendTargetFallbackUsed = runtimeContext?.backendTargetFallbackUsed === true;
  const backendTargetInvalidReason = asText(runtimeContext?.backendTargetInvalidReason, 'n/a');
  const backendTargetCandidatesSummary = summarizeBackendTargetCandidates(runtimeContext?.backendTargetCandidates);
  const selectedRouteKind = asText(routeTruthView?.routeKind, 'n/a');
  const sessionKind = canonicalTruth.sessionKind || runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind;
  const executableProvider = canonicalTruth.executedProvider || runtimeProviderTruth?.executableProvider || routeTruthView?.executedProvider;
  const hostedCloudCanonicalReady = isHostedCloudCanonicalReady({
    sessionKind,
    selectedRouteKind,
    selectedRouteReachableState: routeTruthView?.selectedRouteReachableState,
    routeUsableState: routeTruthView?.routeUsableState,
    backendReachableState: routeTruthView?.backendReachableState,
    cloudAvailable: runtimeStatus?.cloudAvailable,
    fallbackActive: routeTruthView?.fallbackActive,
    executableProvider,
    launchState: runtimeStatus?.appLaunchState,
  });
  const hostedBackendTargetGuidance = buildHostedBackendTargetGuidance({
    canonicalHostedRouteTruth,
    sessionKind,
    selectedRouteKind,
    selectedRouteReachableState: routeTruthView?.selectedRouteReachableState,
    routeUsableState: routeTruthView?.routeUsableState,
    backendReachableState: routeTruthView?.backendReachableState,
    cloudAvailable: runtimeStatus?.cloudAvailable,
    executableProvider,
    backendTargetInvalidReason: runtimeContext?.backendTargetInvalidReason,
    backendTargetResolvedUrl: runtimeContext?.backendTargetResolvedUrl,
    backendTargetResolutionSource: runtimeContext?.backendTargetResolutionSource,
    backendTargetFallbackUsed,
  });
  const routeDiagnosticsSummary = summarizeRouteDiagnostics(runtimeContext?.routeDiagnostics, {
    selectedRouteKind,
  });
  const effectiveRouteDiagnosticsSummary = hasMeaningfulDiagnostics(routeDiagnosticsSummary)
    ? routeDiagnosticsSummary
    : (hostedBackendTargetGuidance?.summary || routeDiagnosticsSummary);

  const blockingIssues = (runtimeDiagnosticsTruth?.blockingIssues || []).map((issue) => issue?.detail || issue?.message || issue?.code || issue?.id || 'unknown');
  if (hostedBackendTargetGuidance?.blockingIssue) {
    const canonicalHostedMessages = Array.isArray(canonicalHostedRouteTruth?.blockingIssues)
      ? canonicalHostedRouteTruth.blockingIssues.map((issue) => issue?.message).filter(Boolean)
      : [];
    if (canonicalHostedMessages.length > 0) {
      blockingIssues.push(...canonicalHostedMessages);
    } else {
      blockingIssues.push(hostedBackendTargetGuidance.blockingIssue);
    }
  }
  const invariantWarnings = (runtimeDiagnosticsTruth?.invariantWarnings || [])
    .map((warning) => warning?.detail || warning?.message || warning?.code || warning?.id || 'unknown')
    .filter((warning) => !(hostedCloudCanonicalReady && isTileReadinessContradictionWarning(warning)));

  const guidanceItems = [];
  if (routeTruthView?.operatorReason && routeTruthView.operatorReason !== 'n/a') {
    guidanceItems.push(routeTruthView.operatorReason);
  }
  if (runtimeContext?.restoreDecision && !hostedCloudCanonicalReady) {
    guidanceItems.push(runtimeContext.restoreDecision);
  }
  if (hostedBackendTargetGuidance?.operatorGuidance) {
    guidanceItems.push(hostedBackendTargetGuidance.operatorGuidance);
  }
  const hasBlockingIssues = blockingIssues.length > 0;
  const selectedRouteReachable = String(routeTruthView?.selectedRouteReachableState || '').trim().toLowerCase() === 'yes';
  const routeUsable = String(routeTruthView?.routeUsableState || '').trim().toLowerCase() === 'yes';
  const backendReachable = String(routeTruthView?.backendReachableState || '').trim().toLowerCase() === 'yes';
  const providerHealthy = ['READY', 'CONNECTED'].includes(String(routeTruthView?.providerState || '').trim().toUpperCase());
  const timeoutSource = String(runtimeStatus?.lastTimeoutPolicySource || '').trim();
  const timeoutTruthDegradedByRouteUsability = timeoutSource === 'frontend:api-runtime'
    && selectedRouteReachable
    && !routeUsable
    && backendReachable
    && providerHealthy;
  const timeoutTruthDegradationReason = timeoutTruthDegradedByRouteUsability
    ? 'frontend-timeout-fallback-persisted-while-route-usability-false'
    : 'n/a';
  if (hasBlockingIssues) {
    for (let i = guidanceItems.length - 1; i >= 0; i -= 1) {
      if (isNoOperatorActionGuidance(guidanceItems[i])) {
        guidanceItems.splice(i, 1);
      }
    }
  }
  if (blockingIssues.length === 0 && invariantWarnings.length === 0 && !hostedBackendTargetGuidance) {
    guidanceItems.push('No blocking route invariants detected.');
  }

  const asYesNoUnknown = (value) => {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return 'unknown';
  };

  const lines = [
    'Stephanos Support Snapshot',
    `Timestamp: ${asText(now?.toISOString?.(), 'n/a')}`,
    `Origin: ${resolvedOrigin}`,
    `URL: ${resolvedUrl}`,
    `Launch State: ${asText(runtimeStatus?.appLaunchState)}`,
    `Route Mode: ${asText(runtimeStatus?.effectiveRouteMode)}`,
    `Requested Route Mode: ${asText(runtimeStatus?.requestedRouteMode)}`,
    `Session Kind: ${asText(canonicalTruth.sessionKind || runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind)}`,
    `Device Context: ${asText(canonicalTruth.deviceContext || runtimeSessionTruth?.deviceContext || runtimeStatus?.deviceContext)}`,
    `Selected Provider: ${asText(routeTruthView?.selectedProvider)}`,
    `Active Provider: ${asText(routeTruthView?.executedProvider)}`,
    `Fallback Active: ${routeTruthView?.fallbackActive ? 'yes' : 'no'}`,
    `Backend Reachable: ${asText(routeTruthView?.backendReachableState)}`,
    `Local Available: ${asYesNoUnknown(runtimeStatus?.localAvailable)}`,
    `Cloud Available: ${asYesNoUnknown(runtimeStatus?.cloudAvailable)}`,
    `Dependency Summary: ${asText(runtimeStatus?.dependencySummary)}`,
    `Backend Default Provider: ${asText(safeApiStatus?.backendDefaultProvider)}`,
    `Selected Provider Health: ${asText(statusSummary?.healthBadge || statusSummary?.healthState)}`,
    `Selected Provider State: ${asText(statusSummary?.healthState)}`,
    `Selected Provider Detail: ${asText(statusSummary?.healthDetail)}`,
    `Selected Provider Reason: ${asText(statusSummary?.healthReason || statusSummary?.healthDetail, 'n/a')}`,
    `Selected Provider Supports Fresh Web: ${asText(statusSummary?.providerCapability?.supportsFreshWeb)}`,
    `Selected Provider Supports Current Answers: ${asText(statusSummary?.providerCapability?.supportsCurrentAnswers)}`,
    `Selected Provider Configured Model: ${asText(statusSummary?.providerCapability?.configuredModel || statusSummary?.model)}`,
    `Selected Provider Configured Model Supports Fresh Web: ${asText(statusSummary?.providerCapability?.configuredModelSupportsFreshWeb)}`,
    `Selected Provider Fresh Candidate Available: ${asText(statusSummary?.providerCapability?.candidateFreshRouteAvailable)}`,
    `Selected Provider Fresh Candidate Model: ${asText(statusSummary?.providerCapability?.candidateFreshWebModel, 'n/a')}`,
    `Selected Provider Fresh Web Path: ${asText(statusSummary?.providerCapability?.freshWebPath, 'n/a')}`,
    `Selected Provider Capability Reason: ${asText(statusSummary?.providerCapability?.capabilityReason, 'n/a')}`,
    `Zero Cost Policy: ${asText(statusSummary?.providerCapability?.zeroCostPolicy)}`,
    `Paid Fresh Routes Enabled: ${asText(statusSummary?.providerCapability?.paidFreshRoutesEnabled)}`,
    `Fresh Capability Mode: ${asText(statusSummary?.providerCapability?.freshCapabilityMode, 'zero-cost-only')}`,
    `Provider Selection Source: ${asText(runtimeStatus?.providerSelectionSource || runtimeContext?.providerSelectionSource)}`,
    `Active Provider Config Source: ${asText(runtimeStatus?.activeProviderConfigSource || runtimeContext?.activeProviderConfigSource)}`,
    `Dev Mode: ${runtimeStatus?.devMode ? 'on' : 'off'}`,
    `Fallback Enabled: ${runtimeStatus?.fallbackEnabled ? 'yes' : 'no'}`,
    `Provider Endpoint: ${asText(runtimeStatus?.providerEndpoint)}`,
    `Provider Model: ${asText(runtimeStatus?.providerModel || statusSummary?.model)}`,
    `Last UI Requested Provider: ${asText(runtimeStatus?.lastUiRequestedProvider)}`,
    `Last UI Default Provider: ${asText(runtimeStatus?.lastUiDefaultProvider)}`,
    `Last Requested Provider Intent: ${asText(runtimeStatus?.lastRequestedProviderIntent)}`,
    `Last Freshness Candidate Provider: ${asText(runtimeStatus?.lastFreshnessCandidateProvider)}`,
    `Last Requested Provider For Request: ${asText(runtimeStatus?.lastRequestedProviderForRequest)}`,
    `Last Fallback Provider Used: ${asText(runtimeStatus?.lastFallbackProviderUsed)}`,
    `Last Backend Default Provider: ${asText(runtimeStatus?.lastBackendDefaultProvider || safeApiStatus?.backendDefaultProvider)}`,
    `Last Requested Provider: ${asText(runtimeStatus?.lastRequestedProvider || routeTruthView?.requestedProvider)}`,
    `Last Request-Side Selected Provider: ${asText(runtimeStatus?.lastRequestSelectedProvider)}`,
    `Last Selected Provider: ${asText(runtimeStatus?.lastSelectedProvider || routeTruthView?.executedProvider || routeTruthView?.selectedProvider)}`,
    `Last Actual Provider Used: ${asText(runtimeStatus?.lastActualProviderUsed || routeTruthView?.executedProvider)}`,
    `Last Model Used: ${asText(runtimeStatus?.lastModelUsed)}`,
    `Last Ollama Default Model: ${asText(runtimeStatus?.lastOllamaModelDefault)}`,
    `Last Ollama Preferred Model: ${asText(runtimeStatus?.lastOllamaModelPreferred)}`,
    `Last Ollama Requested Model: ${asText(runtimeStatus?.lastOllamaModelRequested)}`,
    `Last Ollama Selected Model: ${asText(runtimeStatus?.lastOllamaModelSelected)}`,
    `Last Ollama Reasoning Mode: ${asText(runtimeStatus?.lastOllamaReasoningMode)}`,
    `Last Ollama Escalation Active: ${asText(runtimeStatus?.lastOllamaEscalationActive)}`,
    `Last Ollama Escalation Reason: ${asText(runtimeStatus?.lastOllamaEscalationReason)}`,
    `Last Ollama Fallback Model: ${asText(runtimeStatus?.lastOllamaFallbackModel)}`,
    `Last Ollama Fallback Model Used: ${asText(runtimeStatus?.lastOllamaFallbackModelUsed)}`,
    `Last Ollama Fallback Reason: ${asText(runtimeStatus?.lastOllamaFallbackReason)}`,
    `Last Ollama Timeout (ms): ${asText(runtimeStatus?.lastOllamaTimeoutMs)}`,
    `Last Ollama Timeout Source: ${asText(runtimeStatus?.lastOllamaTimeoutSource)}`,
    `Last Ollama Timeout Model: ${asText(runtimeStatus?.lastOllamaTimeoutModel)}`,
    `Last UI Request Timeout (ms): ${asText(runtimeStatus?.lastUiRequestTimeoutMs)}`,
    `Last Backend Route Timeout (ms): ${asText(runtimeStatus?.lastBackendRouteTimeoutMs)}`,
    `Last Provider Timeout (ms): ${asText(runtimeStatus?.lastProviderTimeoutMs)}`,
    `Last Model Timeout (ms): ${asText(runtimeStatus?.lastModelTimeoutMs)}`,
    `Last Timeout Policy Source: ${asText(runtimeStatus?.lastTimeoutPolicySource)}`,
    `Last Timeout Effective Provider: ${asText(runtimeStatus?.lastTimeoutEffectiveProvider)}`,
    `Last Timeout Effective Model: ${asText(runtimeStatus?.lastTimeoutEffectiveModel)}`,
    `Timeout Truth Degraded By Route Usability: ${timeoutTruthDegradedByRouteUsability ? 'yes' : 'no'}`,
    `Timeout Truth Degradation Reason: ${timeoutTruthDegradationReason}`,
    `Last Timeout Override Applied: ${asText(runtimeStatus?.lastTimeoutOverrideApplied)}`,
    `Last Timeout Failure Layer: ${asText(runtimeStatus?.lastTimeoutFailureLayer)}`,
    `Last Timeout Failure Label: ${asText(runtimeStatus?.lastTimeoutFailureLabel)}`,
    `Last Groq Endpoint Used: ${asText(runtimeStatus?.lastGroqEndpointUsed)}`,
    `Last Groq Model Used: ${asText(runtimeStatus?.lastGroqModelUsed)}`,
    `Last Groq Fresh Web Active: ${asText(runtimeStatus?.lastGroqFreshWebActive)}`,
    `Last Groq Fresh Candidate Available: ${asText(runtimeStatus?.lastGroqFreshCandidateAvailable)}`,
    `Last Groq Fresh Candidate Model: ${asText(runtimeStatus?.lastGroqFreshCandidateModel)}`,
    `Last Groq Fresh Web Path: ${asText(runtimeStatus?.lastGroqFreshWebPath)}`,
    `Last Groq Capability Reason: ${asText(runtimeStatus?.lastGroqCapabilityReason, 'n/a')}`,
    `Last Zero Cost Policy: ${asText(runtimeStatus?.lastZeroCostPolicy)}`,
    `Last Paid Fresh Routes Enabled: ${asText(runtimeStatus?.lastPaidFreshRoutesEnabled)}`,
    `Last Fresh Capability Mode: ${asText(runtimeStatus?.lastFreshCapabilityMode, 'zero-cost-only')}`,
    `Last Response Truth: ${asText(runtimeStatus?.lastResponseTruth)}`,
    `Last Fallback Used: ${asText(runtimeStatus?.lastFallbackUsed)}`,
    `Last Fallback Reason: ${asText(runtimeStatus?.lastFallbackReason)}`,
    `Last Selected Provider Health OK: ${asText(runtimeStatus?.lastSelectedProviderHealthOk)}`,
    `Last Selected Provider Health State: ${asText(runtimeStatus?.lastSelectedProviderHealthState)}`,
    `Last Selected Provider Execution Viability: ${asText(runtimeStatus?.lastSelectedProviderExecutionViability)}`,
    `Last Selected Provider Failure Layer: ${asText(runtimeStatus?.lastSelectedProviderExecutionFailureLayer)}`,
    `Last Selected Provider Failure Label: ${asText(runtimeStatus?.lastSelectedProviderExecutionFailureLabel)}`,
    `Last Selected Provider Failure Phase: ${asText(runtimeStatus?.lastSelectedProviderExecutionFailurePhase)}`,
    `Last Selected Provider Timeout Category: ${asText(runtimeStatus?.lastSelectedProviderTimeoutCategory)}`,
    `Last Selected Provider Model Warmup Likely: ${asText(runtimeStatus?.lastSelectedProviderModelWarmupLikely)}`,
    `Last Selected Provider Warmup Retry Applied: ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryApplied)}`,
    `Last Selected Provider Warmup Retry Timeout (ms): ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryTimeoutMs)}`,
    `Last Selected Provider Attempt Elapsed (ms): ${asText(runtimeStatus?.lastSelectedProviderElapsedMs)}`,
    `Explicit Provider Fallback Policy Triggered: ${asText(runtimeStatus?.lastExplicitProviderFallbackPolicyTriggered)}`,
    `Last Effective Answer Mode: ${asText(runtimeStatus?.lastEffectiveAnswerMode)}`,
    `Freshness Required For Truth: ${asText(runtimeStatus?.lastFreshnessRequiredForTruth)}`,
    `Fresh Answer Required: ${asText(runtimeStatus?.lastFreshAnswerRequired)}`,
    `Fresh Provider Available For Request: ${asText(runtimeStatus?.lastFreshProviderAvailableForRequest)}`,
    `Last Fresh Provider Attempted: ${asText(runtimeStatus?.lastFreshProviderAttempted)}`,
    `Last Fresh Provider Succeeded: ${asText(runtimeStatus?.lastFreshProviderSucceeded)}`,
    `Last Fresh Provider Failure Reason: ${asText(runtimeStatus?.lastFreshProviderFailureReason)}`,
    `Last Grounding Enabled: ${asText(runtimeStatus?.lastGroundingEnabled)}`,
    `Last Grounding Active For Request: ${asText(runtimeStatus?.lastGroundingActiveForRequest)}`,
    `Last Stale Fallback Permitted: ${asText(runtimeStatus?.lastStaleFallbackPermitted)}`,
    `Last Stale Fallback Attempted: ${asText(runtimeStatus?.lastStaleFallbackAttempted)}`,
    `Last Stale Fallback Used: ${asText(runtimeStatus?.lastStaleFallbackUsed)}`,
    `Last Stale Answer Warning: ${asText(runtimeStatus?.lastStaleAnswerWarning)}`,
    `Last Freshness Need: ${asText(runtimeStatus?.lastFreshnessNeed)}`,
    `Last Answer Truth Mode: ${asText(runtimeStatus?.lastAnswerTruthMode)}`,
    `Freshness Integrity Preserved: ${asText(runtimeStatus?.lastFreshnessIntegrityPreserved)}`,
    `Freshness Integrity Failure Reason: ${asText(runtimeStatus?.lastFreshnessIntegrityFailureReason)}`,
    `Freshness Truth Reason: ${asText(runtimeStatus?.lastFreshnessTruthReason)}`,
    `Freshness Next Actions: ${asText(runtimeStatus?.lastFreshnessNextActions)}`,
    `Last Answer Mode: ${asText(runtimeStatus?.lastAnswerMode)}`,
    `Last Stale Risk: ${asText(runtimeStatus?.lastStaleRisk)}`,
    `Last Freshness Reason: ${asText(runtimeStatus?.lastFreshnessReason)}`,
    `Last Override Denial Reason: ${asText(runtimeStatus?.lastOverrideDenialReason)}`,
    `Last Freshness Warning: ${asText(runtimeStatus?.lastFreshnessWarning)}`,
    `Retrieval Mode: ${asText(runtimeStatus?.lastRetrievalMode, 'none')}`,
    `Retrieval Eligible: ${asText(runtimeStatus?.lastRetrievalEligible)}`,
    `Retrieval Used: ${asText(runtimeStatus?.lastRetrievalUsed)}`,
    `Retrieval Reason: ${asText(runtimeStatus?.lastRetrievalReason)}`,
    `Retrieved Chunk Count: ${asText(runtimeStatus?.lastRetrievedChunkCount, '0')}`,
    `Retrieved Sources: ${asText(Array.isArray(runtimeStatus?.lastRetrievedSources) ? runtimeStatus.lastRetrievedSources.join(' | ') : 'n/a')}`,
    `Retrieval Query: ${asText(runtimeStatus?.lastRetrievalQuery)}`,
    `Retrieval Index Status: ${asText(runtimeStatus?.lastRetrievalIndexStatus, 'missing')}`,
    `Memory Eligible: ${asText(runtimeStatus?.lastMemoryEligible)}`,
    `Memory Promoted: ${asText(runtimeStatus?.lastMemoryPromoted)}`,
    `Memory Reason: ${asText(runtimeStatus?.lastMemoryReason)}`,
    `Memory Source Type: ${asText(runtimeStatus?.lastMemorySourceType)}`,
    `Memory Source Ref: ${asText(runtimeStatus?.lastMemorySourceRef)}`,
    `Memory Confidence: ${asText(runtimeStatus?.lastMemoryConfidence)}`,
    `Memory Class: ${asText(runtimeStatus?.lastMemoryClass, 'durable')}`,
    `Context Assembly Used: ${asText(runtimeStatus?.lastContextAssemblyUsed)}`,
    `Context Assembly Mode: ${asText(runtimeStatus?.lastContextAssemblyMode)}`,
    `Context Sources Used: ${asText(runtimeStatus?.lastContextSourcesUsed)}`,
    `Self-Build Prompt Detected: ${asText(runtimeStatus?.lastSelfBuildPromptDetected)}`,
    `Self-Build Reason: ${asText(runtimeStatus?.lastSelfBuildReason)}`,
    `System Awareness Level: ${asText(runtimeStatus?.lastSystemAwarenessLevel, 'baseline')}`,
    `Augmented Prompt Used: ${asText(runtimeStatus?.lastAugmentedPromptUsed)}`,
    `Augmented Prompt Length: ${asText(runtimeStatus?.lastAugmentedPromptLength, '0')}`,
    `Context Integrity Preserved: ${asText(runtimeStatus?.lastContextIntegrityPreserved)}`,
    `Context Assembly Warnings: ${asText(runtimeStatus?.lastContextAssemblyWarnings)}`,
    `Planning Active: ${asText(runtimeStatus?.lastPlanningActive, 'false')}`,
    `Planning Mode: ${asText(runtimeStatus?.lastPlanningMode, 'inactive')}`,
    `Planning Confidence: ${asText(runtimeStatus?.lastPlanningConfidence, 'low')}`,
    `Current System Maturity Estimate: ${asText(runtimeStatus?.lastPlanningMaturityEstimate, 'unknown')}`,
    `Recommended Next Move: ${asText(runtimeStatus?.lastRecommendedNextMove)}`,
    `Recommendation Reason: ${asText(runtimeStatus?.lastRecommendationReason)}`,
    `Candidate Move Count: ${asText(runtimeStatus?.lastPlanningCandidateMoveCount, '0')}`,
    `Planning Evidence Sources: ${asText(runtimeStatus?.lastPlanningEvidenceSources)}`,
    `Planning Truth Warnings: ${asText(runtimeStatus?.lastPlanningTruthWarnings)}`,
    `Proposal Eligible: ${asText(runtimeStatus?.lastProposalEligible, 'false')}`,
    `Codex Handoff Eligible: ${asText(runtimeStatus?.lastCodexHandoffEligible, 'false')}`,
    `Proposal Packet Active: ${asText(runtimeStatus?.lastProposalPacketActive, 'false')}`,
    `Proposal Packet Mode: ${asText(runtimeStatus?.lastProposalPacketMode, 'inactive')}`,
    `Proposal Packet Confidence: ${asText(runtimeStatus?.lastProposalPacketConfidence, 'low')}`,
    `Proposal Packet Truth Preserved: ${asText(runtimeStatus?.lastProposalPacketTruthPreserved, 'true')}`,
    `Proposed Move ID: ${asText(runtimeStatus?.lastProposedMoveId)}`,
    `Proposed Move Title: ${asText(runtimeStatus?.lastProposedMoveTitle)}`,
    `Proposed Move Rationale: ${asText(runtimeStatus?.lastProposedMoveRationale)}`,
    `Proposal Packet Warnings: ${asText(runtimeStatus?.lastProposalPacketWarnings)}`,
    `Codex Handoff Available: ${asText(runtimeStatus?.lastCodexHandoffAvailable, 'false')}`,
    `Codex Prompt Summary: ${asText(runtimeStatus?.lastCodexPromptSummary)}`,
    `Codex Constraints: ${asText(runtimeStatus?.lastCodexConstraints)}`,
    `Codex Success Criteria: ${asText(runtimeStatus?.lastCodexSuccessCriteria)}`,
    `Operator Actions: ${asText(runtimeStatus?.lastProposalOperatorActions)}`,
    `Approval Required: ${asText(runtimeStatus?.lastOperatorApprovalRequired, 'true')}`,
    `Execution Eligible: ${asText(runtimeStatus?.lastExecutionEligible, 'false')}`,
    `Mission Packet Decision: ${asText(runtimeStatus?.missionPacketDecision, 'pending-review')}`,
    `Mission Packet Decision Timestamp: ${asText(runtimeStatus?.missionPacketDecisionAt, 'n/a')}`,
    `Mission Packet Proposal Queue Depth: ${asText(runtimeStatus?.missionPacketProposalQueueLength, '0')}`,
    `Mission Packet Roadmap Queue Depth: ${asText(runtimeStatus?.missionPacketRoadmapQueueLength, '0')}`,
    `Tile Action Type: ${asText(runtimeStatus?.lastTileActionType)}`,
    `Tile Source: ${asText(runtimeStatus?.lastTileSource)}`,
    `Memory Candidate Submitted: ${asText(runtimeStatus?.lastMemoryCandidateSubmitted)}`,
    `Tile Memory Promoted: ${asText(runtimeStatus?.lastTileMemoryPromoted)}`,
    `Tile Memory Reason: ${asText(runtimeStatus?.lastTileMemoryReason)}`,
    `Retrieval Contribution Submitted: ${asText(runtimeStatus?.lastRetrievalContributionSubmitted)}`,
    `Retrieval Ingested: ${asText(runtimeStatus?.lastRetrievalIngested)}`,
    `Retrieval Source Ref: ${asText(runtimeStatus?.lastRetrievalSourceRef)}`,
    `AI Policy Mode: ${asText(runtimeStatus?.lastAiPolicyMode, 'local-first-cloud-when-needed')}`,
    `AI Policy Reason: ${asText(runtimeStatus?.lastAiPolicyReason, 'Local-first policy applied.')}`,
    `Execution Truth: ${asText(runtimeStatus?.executionTruth)}`,
    `Execution Status: ${asText(runtimeStatus?.executionStatus)}`,
    `Route: ${asText(runtimeStatus?.route)}`,
    `Commands: ${asText(runtimeStatus?.commands)}`,
    `Latest Tool: ${asText(runtimeStatus?.latestTool, 'none')}`,
    `UI Marker: ${asText(runtimeStatus?.uiMarker)}`,
    `UI Version: ${asText(runtimeStatus?.uiVersion, 'unknown')}`,
    `UI Git Commit: ${asText(runtimeStatus?.uiGitCommit)}`,
    `UI Build Timestamp: ${asText(runtimeStatus?.uiBuildTimestamp, 'unknown')}`,
    `UI Runtime ID: ${asText(runtimeStatus?.uiRuntimeId)}`,
    `UI Runtime Marker: ${asText(runtimeStatus?.uiRuntimeMarker)}`,
    `Source/Dist Parity: ${formatParityState(runtimeStatus?.runtimeTruth?.sourceDistParityOk ?? runtimeStatus?.sourceDistParityOk ?? null)}`,
    `UI Build Target: ${asText(runtimeStatus?.uiBuildTarget)}`,
    `UI Build Target Identifier: ${asText(runtimeStatus?.uiBuildTargetIdentifier)}`,
    `UI Source: ${asText(runtimeStatus?.uiSource)}`,
    `UI Source Fingerprint: ${asText(runtimeStatus?.uiSourceFingerprint)}`,
    `Debug Console: ${asText(runtimeStatus?.debugConsole)}`,
    `Backend Target Resolution Source: ${backendTargetResolutionSource}`,
    `Backend Target Resolved URL: ${backendTargetResolvedUrl}`,
    `Backend Target Fallback Used: ${backendTargetFallbackUsed ? 'yes' : 'no'}`,
    `Backend Target Invalid Reason: ${backendTargetInvalidReason}`,
    'Backend Target Candidates:',
    ...backendTargetCandidatesSummary,
    `Selected Route Kind: ${selectedRouteKind}`,
    `Preferred Target: ${asText(routeTruthView?.preferredTarget, 'n/a')}`,
    `Actual Target Used: ${asText(routeTruthView?.actualTarget, 'n/a')}`,
    `Winning Reason: ${asText(runtimeRouteTruth?.winningReason || routeTruthView?.winnerReason, 'n/a')}`,
    `UI Reachable: ${asText(runtimeReachabilityTruth?.uiReachableState || routeTruthView?.uiReachableState)}`,
    `Selected Route Reachable: ${asText(routeTruthView?.selectedRouteReachableState)}`,
    `Selected Route Usable: ${asText(routeTruthView?.routeUsableState)}`,
    `Selected Route Usability Veto Reason: ${asText(routeTruthView?.routeUsabilityVetoReason, 'n/a')}`,
    `Route Reconciled: ${routeTruthView?.routeReconciled ? 'yes' : 'no'}`,
    `Route Reconciliation Reason: ${asText(routeTruthView?.routeReconciliationReason, 'n/a')}`,
    `Truth Inconsistent: ${routeTruthView?.truthInconsistent ? 'yes' : 'no'}`,
    `Route Usability Conflict: ${routeTruthView?.routeUsabilityConflict ? 'yes' : 'no'}`,
    `Provider Mismatch: ${routeTruthView?.providerMismatch ? 'yes' : 'no'}`,
    `Home Available: ${asYesNoUnknown(runtimeStatus?.homeNodeReachable)}`,
    `Executable Provider: ${asText(canonicalTruth.executedProvider || runtimeProviderTruth?.executableProvider, 'none')}`,
    '',
    'routeDiagnosticsSummary:',
    ...effectiveRouteDiagnosticsSummary,
    '',
    'blockingIssues:',
    ...asList(blockingIssues),
    '',
    'invariantWarnings:',
    ...asList(invariantWarnings),
    '',
    'operatorGuidance:',
    ...asList(guidanceItems),
  ];

  return lines.join('\n');
}
