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
// - runtimeStatus.canonicalRouteRuntimeTruth is canonical runtime route/provider/session truth.
// - this helper is the only approved projection layer for route/provider/operator UI labels.
// - top-level runtimeStatus route/provider fields are compatibility diagnostics, not authoritative display truth.
export function buildFinalRouteTruthView(runtimeStatusModel) {
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const {
    canonicalRouteRuntimeTruth: canonicalTruthInput,
    finalRouteTruth: finalRouteTruthInput,
    runtimeTruth: runtimeTruthInput,
    finalRoute: finalRouteInput,
  } = runtimeStatus;
  const canonicalTruth = canonicalTruthInput ?? {};
  const finalRouteTruth = finalRouteTruthInput ?? {};
  const runtimeTruth = runtimeTruthInput ?? {};
  const finalRoute = finalRouteInput ?? {};
  const runtimeRouteTruth = runtimeTruth.route ?? {};
  const runtimeReachabilityTruth = runtimeTruth.reachabilityTruth ?? {};
  const runtimeProviderTruth = runtimeTruth.provider ?? {};

  const routeKind = pickTruth(canonicalTruth.winningRoute, finalRouteTruth.routeKind, runtimeRouteTruth.selectedRouteKind, finalRoute.routeKind) || 'unavailable';
  const preferredTarget = pickTruth(canonicalTruth.preferredTarget, finalRouteTruth.preferredTarget, runtimeRouteTruth.preferredTarget, finalRoute.preferredTarget) || 'unavailable';
  const actualTarget = pickTruth(canonicalTruth.actualTarget, finalRouteTruth.actualTarget, runtimeRouteTruth.actualTarget, finalRoute.actualTarget) || 'unavailable';
  const source = pickTruth(canonicalTruth.routeSource, finalRouteTruth.source, runtimeRouteTruth.source, finalRoute.source) || 'unknown';

  const uiReachableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : normalizeUiReachabilityState(
      pickTruth(canonicalTruth.uiReachabilityState, finalRouteTruth.uiReachabilityState, runtimeReachabilityTruth.uiReachableState),
      canonicalTruth.uiReachable ?? finalRouteTruth.uiReachable ?? runtimeReachabilityTruth.uiReachable,
    );
  const routeUsableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : asBooleanState(canonicalTruth.routeUsable ?? finalRouteTruth.routeUsable ?? runtimeReachabilityTruth.selectedRouteUsable);

  return {
    routeKind,
    fallbackActive: canonicalTruth.fallbackActive === true || finalRouteTruth.fallbackActive === true || runtimeRouteTruth.fallbackActive === true,
    backendReachableState: asBooleanState(canonicalTruth.backendReachable ?? finalRouteTruth.backendReachable ?? runtimeReachabilityTruth.backendReachable),
    uiReachableState,
    routeUsableState,
    homeNodeUsableState: asBooleanState(canonicalTruth.homeNodeAvailable ?? finalRouteTruth.homeNodeUsable ?? runtimeReachabilityTruth.homeNodeAvailable),
    requestedProvider: pickTruth(canonicalTruth.requestedProvider, finalRouteTruth.requestedProvider, runtimeProviderTruth.requestedProvider, runtimeTruth.requestedProvider) || 'unknown',
    selectedProvider: pickTruth(canonicalTruth.selectedProvider, finalRouteTruth.selectedProvider, runtimeProviderTruth.selectedProvider, runtimeTruth.selectedProvider) || 'unknown',
    executedProvider: pickTruth(canonicalTruth.executedProvider, finalRouteTruth.executedProvider, runtimeProviderTruth.executableProvider, runtimeTruth.executedProvider) || 'unknown',
    preferredTarget,
    actualTarget,
    source,
    preferredRoute: pickTruth(canonicalTruth.winningRoute) || routeKind,
    winnerReason: pickTruth(canonicalTruth.winningReason) || 'n/a',
    operatorReason: pickTruth(canonicalTruth.operatorSummary) || 'n/a',
    selectedRouteReachableState: canonicalTruth.routeReachable === true
      ? 'yes'
      : canonicalTruth.routeReachable === false
        ? 'no'
        : 'pending',
  };
}
