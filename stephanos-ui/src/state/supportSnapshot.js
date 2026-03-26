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
  const resolvedOrigin = asText(origin || runtimeContext?.frontendOrigin || safeApiStatus?.frontendOrigin || '', 'n/a');
  const resolvedUrl = asText(href || runtimeContext?.frontendUrl || '', 'n/a');
  const blockingIssues = (runtimeDiagnosticsTruth?.blockingIssues || []).map((issue) => issue?.detail || issue?.message || issue?.code || issue?.id || 'unknown');
  const invariantWarnings = (runtimeDiagnosticsTruth?.invariantWarnings || []).map((warning) => warning?.detail || warning?.message || warning?.code || warning?.id || 'unknown');

  const guidanceItems = [];
  if (routeTruthView?.operatorReason && routeTruthView.operatorReason !== 'n/a') {
    guidanceItems.push(routeTruthView.operatorReason);
  }
  if (runtimeContext?.restoreDecision) {
    guidanceItems.push(runtimeContext.restoreDecision);
  }
  if (blockingIssues.length === 0 && invariantWarnings.length === 0) {
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
    `Session Kind: ${asText(runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind)}`,
    `Device Context: ${asText(runtimeSessionTruth?.deviceContext || runtimeStatus?.deviceContext)}`,
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
    `Selected Route Kind: ${asText(routeTruthView?.routeKind, 'n/a')}`,
    `Preferred Target: ${asText(routeTruthView?.preferredTarget, 'n/a')}`,
    `Actual Target Used: ${asText(routeTruthView?.actualTarget, 'n/a')}`,
    `Winning Reason: ${asText(runtimeRouteTruth?.winningReason || routeTruthView?.winnerReason, 'n/a')}`,
    `UI Reachable: ${asText(runtimeReachabilityTruth?.uiReachableState || routeTruthView?.uiReachableState)}`,
    `Selected Route Reachable: ${asText(routeTruthView?.selectedRouteReachableState)}`,
    `Selected Route Usable: ${asText(routeTruthView?.routeUsableState)}`,
    `Home Available: ${asYesNoUnknown(runtimeStatus?.homeNodeReachable)}`,
    `Executable Provider: ${asText(runtimeProviderTruth?.executableProvider, 'none')}`,
    '',
    'routeDiagnosticsSummary:',
    ...summarizeRouteDiagnostics(runtimeContext?.routeDiagnostics),
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
