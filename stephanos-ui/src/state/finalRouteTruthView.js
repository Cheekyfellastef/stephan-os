import { ensureRuntimeStatusModel } from './runtimeStatusDefaults.js';

function asBooleanState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

function normalizeUiReachabilityState(value, legacyBoolean) {
  if (value === 'reachable') return 'yes';
  if (value === 'unreachable') return 'no';
  if (value === 'unknown') return 'unknown';
  return asBooleanState(legacyBoolean);
}

function pickTruth(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (!value) continue;
    if (['unknown', 'pending', 'unavailable', 'n/a'].includes(value.toLowerCase())) {
      continue;
    }
    return value;
  }
  return '';
}

// UI truth projection contract:
// - runtimeStatus.finalRouteTruth is canonical runtime truth.
// - this helper is the only approved projection layer for route/provider/operator UI labels.
// - top-level runtimeStatus route/provider fields are compatibility diagnostics, not authoritative display truth.
export function buildFinalRouteTruthView(runtimeStatusModel) {
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const finalRouteTruth = runtimeStatus.finalRouteTruth ?? {};
  const runtimeTruth = runtimeStatus.runtimeTruth ?? {};
  const finalRoute = runtimeStatus.finalRoute ?? {};
  const runtimeProviderTruth = runtimeTruth.provider ?? {};
  const reachability = runtimeTruth.reachability ?? finalRoute.reachability ?? {};

  const routeKind = pickTruth(runtimeTruth.selectedRoute, finalRouteTruth.routeKind, finalRoute.routeKind) || 'unavailable';
  const preferredTarget = pickTruth(runtimeTruth.preferredTarget, finalRouteTruth.preferredTarget, finalRoute.preferredTarget) || 'unavailable';
  const actualTarget = pickTruth(runtimeTruth.actualTarget, finalRouteTruth.actualTarget, finalRoute.actualTarget) || 'unavailable';
  const source = pickTruth(runtimeTruth.source, finalRouteTruth.source, finalRoute.source) || 'unknown';

  const uiReachableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : normalizeUiReachabilityState(finalRouteTruth.uiReachabilityState, finalRouteTruth.uiReachable);
  const routeUsableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : asBooleanState(runtimeTruth.routeUsable ?? finalRouteTruth.routeUsable);

  return {
    routeKind,
    fallbackActive: finalRouteTruth.fallbackActive === true,
    backendReachableState: asBooleanState(finalRouteTruth.backendReachable),
    uiReachableState,
    routeUsableState,
    homeNodeUsableState: asBooleanState(finalRouteTruth.homeNodeUsable),
    requestedProvider: pickTruth(runtimeProviderTruth.requestedProvider, runtimeTruth.requestedProvider, finalRouteTruth.requestedProvider) || 'unknown',
    selectedProvider: pickTruth(runtimeProviderTruth.selectedProvider, runtimeTruth.selectedProvider, finalRouteTruth.selectedProvider) || 'unknown',
    executedProvider: pickTruth(runtimeProviderTruth.executableProvider, runtimeTruth.executedProvider, finalRouteTruth.executedProvider) || 'unknown',
    preferredTarget,
    actualTarget,
    source,
    preferredRoute: pickTruth(runtimeTruth.preferredRoute, finalRouteTruth.preferredRoute) || routeKind,
    winnerReason: pickTruth(runtimeTruth.winnerReason, finalRouteTruth.winnerReason, finalRoute.winnerReason) || 'n/a',
    operatorReason: pickTruth(runtimeTruth.operatorAction, finalRouteTruth.operatorAction) || 'n/a',
    selectedRouteReachableState: reachability.selectedRouteReachable === true
      ? 'yes'
      : reachability.selectedRouteReachable === false
        ? 'no'
        : 'pending',
  };
}
