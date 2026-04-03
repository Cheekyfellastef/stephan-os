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

function asBooleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
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

function pickRouteKind(snapshot = {}) {
  return normalizeRouteKind(snapshot?.winningRoute || snapshot?.selectedRouteKind || snapshot?.routeKind);
}

function pickLaunchState(snapshot = {}, runtimeStatusModel = {}, project = {}) {
  const canonicalLaunchState = normalizeLaunchState(snapshot?.appLaunchState || snapshot?.launchState);
  if (snapshot && typeof snapshot === 'object') {
    return canonicalLaunchState;
  }
  return normalizeLaunchState(runtimeStatusModel?.appLaunchState || project?.dependencyState);
}

function buildCompatibilityProjection(runtimeStatusModel = {}, project = {}) {
  const finalRoute = runtimeStatusModel?.finalRoute;
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth;

  return {
    launchState: normalizeLaunchState(runtimeStatusModel?.appLaunchState || project?.dependencyState),
    routeKind: normalizeRouteKind(
      runtimeStatusModel?.preferredRoute
      || runtimeStatusModel?.selectedRoute
      || finalRouteTruth?.routeKind
      || finalRoute?.routeKind,
    ),
    selectedRouteReachable: toYesNoUnknown(
      runtimeStatusModel?.cloudRouteReachable === true
        ? true
        : asBooleanOrNull(runtimeStatusModel?.backendReachable),
    ),
    selectedRouteUsable: toYesNoUnknown(asBooleanOrNull(runtimeStatusModel?.routeUsable)),
    executableProvider: normalizeProvider(runtimeStatusModel?.executedProvider),
    fallbackActive: toYesNoUnknown(asBooleanOrNull(runtimeStatusModel?.fallbackActive)),
    blockingIssues: normalizeBlockingIssues(runtimeStatusModel?.blockingIssueCodes),
  };
}

export function buildStephanosTileTruthProjection(project = {}) {
  const runtimeStatusModel = project?.runtimeStatusModel && typeof project.runtimeStatusModel === 'object'
    ? project.runtimeStatusModel
    : {};
  const { snapshot, source } = buildCanonicalSnapshot(runtimeStatusModel);

  const launchState = pickLaunchState(snapshot, runtimeStatusModel, project);
  const canonicalRouteKind = pickRouteKind(snapshot || {});
  const canonicalProvider = normalizeProvider(snapshot?.executedProvider);
  const canonicalFallbackState = toYesNoUnknown(snapshot?.fallbackActive);
  const canonicalBlockingIssues = normalizeBlockingIssues(snapshot?.blockingIssueCodes);
  const selectedRouteReachable = toYesNoUnknown(snapshot?.routeReachable);
  const selectedRouteUsable = toYesNoUnknown(snapshot?.routeUsable);

  const tone = launchState === 'ready' || launchState === 'degraded' || launchState === 'unavailable'
    ? launchState
    : 'unavailable';

  const hasCanonical = source !== 'unavailable';
  const compatibility = buildCompatibilityProjection(runtimeStatusModel, project);
  const driftFields = [];

  if (hasCanonical) {
    if (compatibility.launchState !== 'unknown' && launchState !== 'unknown' && compatibility.launchState !== launchState) {
      driftFields.push(`launch:${compatibility.launchState}->${launchState}`);
    }
    if (compatibility.routeKind !== 'unknown' && canonicalRouteKind !== 'unknown' && compatibility.routeKind !== canonicalRouteKind) {
      driftFields.push(`route:${compatibility.routeKind}->${canonicalRouteKind}`);
    }
    if (compatibility.executableProvider !== 'unknown' && canonicalProvider !== 'unknown' && compatibility.executableProvider !== canonicalProvider) {
      driftFields.push(`provider:${compatibility.executableProvider}->${canonicalProvider}`);
    }
    if (compatibility.fallbackActive !== 'unknown' && canonicalFallbackState !== 'unknown' && compatibility.fallbackActive !== canonicalFallbackState) {
      driftFields.push(`fallback:${compatibility.fallbackActive}->${canonicalFallbackState}`);
    }
  }

  const drift = driftFields.length > 0;

  const routeOperational = canonicalRouteKind === 'cloud'
    && selectedRouteReachable === 'yes'
    && selectedRouteUsable === 'yes';

  const summary = [
    `launch ${launchState === 'unknown' ? 'unknown' : launchState}`,
    `route ${canonicalRouteKind === 'unknown' ? 'unknown' : canonicalRouteKind}`,
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
    driftFields,
    summary,
    diagnosticLabel: drift
      ? `Truth drift detected: compatibility projection disagrees with canonical truth (${driftFields.join(', ')}).`
      : '',
  };
}
