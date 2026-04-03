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

function summarizeRouteDiagnostics(routeDiagnostics) {
  if (!routeDiagnostics || typeof routeDiagnostics !== 'object') {
    return ['- n/a'];
  }

  const entries = Object.entries(routeDiagnostics).slice(0, 4).map(([key, details]) => {
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
    return `- ${key}: ${state} (${reason})`;
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

function buildHostedBackendTargetGuidance({
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
  const hostedSession = sessionKind === 'hosted-web';
  const routeUnavailable = selectedRouteKind === 'unavailable';
  const unresolved = !backendTargetResolvedUrl || backendTargetResolvedUrl === 'n/a';
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
  if (!hostedSession || (!routeUnavailable && !backendTargetInvalidReason && !unresolved)) {
    return null;
  }

  const reason = asText(
    backendTargetInvalidReason,
    unresolved
      ? 'Hosted runtime could not resolve a non-loopback backend target.'
      : 'Hosted backend target is unresolved.',
  );
  const blocked = routeUnavailable || !routeUsable || !routeReachable;
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
    blockingIssue: blocked ? `Backend target unresolved: ${reason}` : '',
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
  const resolvedOrigin = asText(origin || runtimeContext?.frontendOrigin || safeApiStatus?.frontendOrigin || '', 'n/a');
  const resolvedUrl = asText(href || runtimeContext?.frontendUrl || '', 'n/a');
  const backendTargetResolutionSource = asText(runtimeContext?.backendTargetResolutionSource, 'n/a');
  const backendTargetResolvedUrl = asText(runtimeContext?.backendTargetResolvedUrl, 'n/a');
  const backendTargetFallbackUsed = runtimeContext?.backendTargetFallbackUsed === true;
  const backendTargetInvalidReason = asText(runtimeContext?.backendTargetInvalidReason, 'n/a');
  const selectedRouteKind = asText(routeTruthView?.routeKind, 'n/a');
  const hostedBackendTargetGuidance = buildHostedBackendTargetGuidance({
    sessionKind: canonicalTruth.sessionKind || runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind,
    selectedRouteKind,
    selectedRouteReachableState: routeTruthView?.selectedRouteReachableState,
    routeUsableState: routeTruthView?.routeUsableState,
    backendReachableState: routeTruthView?.backendReachableState,
    cloudAvailable: runtimeStatus?.cloudAvailable,
    executableProvider: canonicalTruth.executedProvider || runtimeProviderTruth?.executableProvider || routeTruthView?.executedProvider,
    backendTargetInvalidReason: runtimeContext?.backendTargetInvalidReason,
    backendTargetResolvedUrl: runtimeContext?.backendTargetResolvedUrl,
    backendTargetResolutionSource: runtimeContext?.backendTargetResolutionSource,
    backendTargetFallbackUsed,
  });
  const routeDiagnosticsSummary = summarizeRouteDiagnostics(runtimeContext?.routeDiagnostics);
  const effectiveRouteDiagnosticsSummary = hasMeaningfulDiagnostics(routeDiagnosticsSummary)
    ? routeDiagnosticsSummary
    : (hostedBackendTargetGuidance?.summary || routeDiagnosticsSummary);

  const blockingIssues = (runtimeDiagnosticsTruth?.blockingIssues || []).map((issue) => issue?.detail || issue?.message || issue?.code || issue?.id || 'unknown');
  if (hostedBackendTargetGuidance?.blockingIssue) {
    blockingIssues.push(hostedBackendTargetGuidance.blockingIssue);
  }
  const invariantWarnings = (runtimeDiagnosticsTruth?.invariantWarnings || []).map((warning) => warning?.detail || warning?.message || warning?.code || warning?.id || 'unknown');

  const guidanceItems = [];
  if (routeTruthView?.operatorReason && routeTruthView.operatorReason !== 'n/a') {
    guidanceItems.push(routeTruthView.operatorReason);
  }
  if (runtimeContext?.restoreDecision) {
    guidanceItems.push(runtimeContext.restoreDecision);
  }
  if (hostedBackendTargetGuidance?.operatorGuidance) {
    guidanceItems.push(hostedBackendTargetGuidance.operatorGuidance);
  }
  const hasBlockingIssues = blockingIssues.length > 0;
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
    `Provider Selection Source: ${asText(runtimeStatus?.providerSelectionSource || runtimeContext?.providerSelectionSource)}`,
    `Active Provider Config Source: ${asText(runtimeStatus?.activeProviderConfigSource || runtimeContext?.activeProviderConfigSource)}`,
    `Dev Mode: ${runtimeStatus?.devMode ? 'on' : 'off'}`,
    `Fallback Enabled: ${runtimeStatus?.fallbackEnabled ? 'yes' : 'no'}`,
    `Provider Endpoint: ${asText(runtimeStatus?.providerEndpoint)}`,
    `Provider Model: ${asText(runtimeStatus?.providerModel || statusSummary?.model)}`,
    `Last UI Requested Provider: ${asText(runtimeStatus?.lastUiRequestedProvider)}`,
    `Last Backend Default Provider: ${asText(runtimeStatus?.lastBackendDefaultProvider || safeApiStatus?.backendDefaultProvider)}`,
    `Last Requested Provider: ${asText(runtimeStatus?.lastRequestedProvider || routeTruthView?.requestedProvider)}`,
    `Last Selected Provider: ${asText(runtimeStatus?.lastSelectedProvider || routeTruthView?.selectedProvider)}`,
    `Last Actual Provider Used: ${asText(runtimeStatus?.lastActualProviderUsed || routeTruthView?.executedProvider)}`,
    `Last Model Used: ${asText(runtimeStatus?.lastModelUsed)}`,
    `Last Response Truth: ${asText(runtimeStatus?.lastResponseTruth)}`,
    `Last Fallback Used: ${asText(runtimeStatus?.lastFallbackUsed)}`,
    `Last Fallback Reason: ${asText(runtimeStatus?.lastFallbackReason)}`,
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
    `UI Build Target: ${asText(runtimeStatus?.uiBuildTarget)}`,
    `UI Build Target Identifier: ${asText(runtimeStatus?.uiBuildTargetIdentifier)}`,
    `UI Source: ${asText(runtimeStatus?.uiSource)}`,
    `UI Source Fingerprint: ${asText(runtimeStatus?.uiSourceFingerprint)}`,
    `Debug Console: ${asText(runtimeStatus?.debugConsole)}`,
    `Backend Target Resolution Source: ${backendTargetResolutionSource}`,
    `Backend Target Resolved URL: ${backendTargetResolvedUrl}`,
    `Backend Target Fallback Used: ${backendTargetFallbackUsed ? 'yes' : 'no'}`,
    `Backend Target Invalid Reason: ${backendTargetInvalidReason}`,
    `Selected Route Kind: ${selectedRouteKind}`,
    `Preferred Target: ${asText(routeTruthView?.preferredTarget, 'n/a')}`,
    `Actual Target Used: ${asText(routeTruthView?.actualTarget, 'n/a')}`,
    `Winning Reason: ${asText(runtimeRouteTruth?.winningReason || routeTruthView?.winnerReason, 'n/a')}`,
    `UI Reachable: ${asText(runtimeReachabilityTruth?.uiReachableState || routeTruthView?.uiReachableState)}`,
    `Selected Route Reachable: ${asText(routeTruthView?.selectedRouteReachableState)}`,
    `Selected Route Usable: ${asText(routeTruthView?.routeUsableState)}`,
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
