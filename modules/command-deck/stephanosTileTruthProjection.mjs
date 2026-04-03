function normalizeLaunchState(value) {
  const state = String(value || '').trim().toLowerCase();
  if (state === 'ready' || state === 'degraded' || state === 'unavailable') {
    return state;
  }
  return 'unknown';
}

function normalizeRouteKind(value) {
  const routeKind = String(value || '').trim().toLowerCase();
  return routeKind || 'unknown';
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return provider || 'unknown';
}

function normalizeBlockingIssues(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function toYesNoUnknown(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

function buildCanonicalSnapshot(runtimeStatusModel = {}) {
  const canonical = runtimeStatusModel?.canonicalRouteRuntimeTruth;
  const compatibility = runtimeStatusModel?.runtimeTruthSnapshot;
  if (canonical && typeof canonical === 'object') {
    return { snapshot: canonical, source: 'canonicalRouteRuntimeTruth' };
  }

  if (compatibility && typeof compatibility === 'object') {
    return { snapshot: compatibility, source: 'runtimeTruthSnapshot' };
  }

  return { snapshot: null, source: 'unavailable' };
}

export function buildStephanosTileTruthProjection(project = {}) {
  const runtimeStatusModel = project?.runtimeStatusModel && typeof project.runtimeStatusModel === 'object'
    ? project.runtimeStatusModel
    : {};
  const { snapshot, source } = buildCanonicalSnapshot(runtimeStatusModel);

  const canonicalLaunchState = normalizeLaunchState(snapshot?.appLaunchState);
  const canonicalRouteKind = normalizeRouteKind(snapshot?.winningRoute);
  const canonicalProvider = normalizeProvider(snapshot?.executedProvider);
  const canonicalFallbackState = toYesNoUnknown(snapshot?.fallbackActive);
  const canonicalBlockingIssues = normalizeBlockingIssues(snapshot?.blockingIssueCodes);
  const selectedRouteReachable = toYesNoUnknown(snapshot?.routeReachable);
  const selectedRouteUsable = toYesNoUnknown(snapshot?.routeUsable);

  const compatibilityLaunchState = normalizeLaunchState(runtimeStatusModel?.appLaunchState || project?.dependencyState);
  const hasCanonical = source !== 'unavailable' && canonicalLaunchState !== 'unknown';
  const launchState = hasCanonical ? canonicalLaunchState : compatibilityLaunchState;
  const tone = launchState === 'ready' || launchState === 'degraded' || launchState === 'unavailable'
    ? launchState
    : 'unavailable';

  const drift = hasCanonical
    && compatibilityLaunchState !== 'unknown'
    && canonicalLaunchState !== compatibilityLaunchState;

  const routeOperational = canonicalRouteKind === 'cloud'
    && selectedRouteReachable === 'yes'
    && selectedRouteUsable === 'yes';

  const summary = [
    `launch ${launchState === 'unknown' ? 'unavailable' : launchState}`,
    `route ${canonicalRouteKind === 'unknown' ? 'unavailable' : canonicalRouteKind}`,
    `selected route reachable ${selectedRouteReachable}`,
    `selected route usable ${selectedRouteUsable}`,
    `executable provider ${canonicalProvider}`,
    `fallback ${canonicalFallbackState}`,
    `blockingIssues ${canonicalBlockingIssues.length ? canonicalBlockingIssues.join(', ') : 'n/a'}`,
  ].join(' · ');

  return {
    source,
    launchState,
    tone,
    routeKind: canonicalRouteKind,
    routeOperational,
    executableProvider: canonicalProvider,
    fallbackActive: canonicalFallbackState,
    blockingIssues: canonicalBlockingIssues,
    selectedRouteReachable,
    selectedRouteUsable,
    drift,
    summary,
    diagnosticLabel: drift
      ? 'Truth drift detected: canonical runtime launch state disagrees with compatibility projection.'
      : '',
  };
}
