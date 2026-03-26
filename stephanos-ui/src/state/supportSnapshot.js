function asText(value, fallback = 'unknown') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function asList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return ['- none'];
  }
  return value.map((item) => `- ${asText(item, 'unknown')}`);
}

function summarizeRouteDiagnostics(routeDiagnostics) {
  if (!routeDiagnostics || typeof routeDiagnostics !== 'object') {
    return ['- unavailable'];
  }

  const entries = Object.entries(routeDiagnostics).slice(0, 4).map(([key, details]) => {
    if (!details || typeof details !== 'object') {
      return `- ${key}: unavailable`;
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

  return entries.length > 0 ? entries : ['- unavailable'];
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
  const resolvedOrigin = asText(origin || runtimeContext?.frontendOrigin || safeApiStatus?.frontendOrigin || '', 'unknown');
  const resolvedUrl = asText(href || runtimeContext?.frontendUrl || '', 'unknown');
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

  const lines = [
    'Stephanos Support Snapshot',
    `timestamp: ${asText(now?.toISOString?.(), 'unknown')}`,
    `origin: ${resolvedOrigin}`,
    `url: ${resolvedUrl}`,
    `uiVersion: ${asText(runtimeStatus?.uiVersion, 'unknown')}`,
    `uiBuild: ${asText(runtimeStatus?.uiBuildTimestamp, 'unknown')}`,
    `sessionKind: ${asText(runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind)}`,
    `deviceContext: ${asText(runtimeSessionTruth?.deviceContext || runtimeStatus?.deviceContext)}`,
    `requestedRouteMode: ${asText(runtimeStatus?.requestedRouteMode)}`,
    `effectiveRouteMode: ${asText(runtimeStatus?.effectiveRouteMode)}`,
    `selectedRouteKind: ${asText(routeTruthView?.routeKind, 'unavailable')}`,
    `preferredTarget: ${asText(routeTruthView?.preferredTarget, 'unavailable')}`,
    `actualTarget: ${asText(routeTruthView?.actualTarget, 'unavailable')}`,
    `winningReason: ${asText(runtimeRouteTruth?.winningReason || routeTruthView?.winnerReason, 'n/a')}`,
    `fallbackActive: ${routeTruthView?.fallbackActive ? 'yes' : 'no'}`,
    `backendReachable: ${asText(routeTruthView?.backendReachableState)}`,
    `uiReachable: ${asText(runtimeReachabilityTruth?.uiReachableState || routeTruthView?.uiReachableState)}`,
    `selectedRouteReachable: ${asText(routeTruthView?.selectedRouteReachableState)}`,
    `selectedRouteUsable: ${asText(routeTruthView?.routeUsableState)}`,
    `localAvailable: ${runtimeStatus?.localAvailable === true ? 'yes' : runtimeStatus?.localAvailable === false ? 'no' : 'unknown'}`,
    `homeAvailable: ${runtimeStatus?.homeNodeReachable === true ? 'yes' : runtimeStatus?.homeNodeReachable === false ? 'no' : 'unknown'}`,
    `cloudAvailable: ${runtimeStatus?.cloudAvailable === true ? 'yes' : runtimeStatus?.cloudAvailable === false ? 'no' : 'unknown'}`,
    `requestedProvider: ${asText(routeTruthView?.requestedProvider)}`,
    `selectedProvider: ${asText(routeTruthView?.selectedProvider)}`,
    `executableProvider: ${asText(runtimeProviderTruth?.executableProvider, 'n/a')}`,
    `providerHealthState: ${asText(runtimeProviderTruth?.providerHealthState || statusSummary?.healthState)}`,
    `providerReason: ${asText(runtimeProviderTruth?.providerReason || statusSummary?.healthReason || statusSummary?.healthDetail, 'n/a')}`,
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
