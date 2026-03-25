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

// UI truth projection contract:
// - runtimeStatus.finalRouteTruth is canonical runtime truth.
// - this helper is the only approved projection layer for route/provider/operator UI labels.
// - top-level runtimeStatus route/provider fields are compatibility diagnostics, not authoritative display truth.
export function buildFinalRouteTruthView(runtimeStatusModel) {
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const finalRouteTruth = runtimeStatus.finalRouteTruth ?? {};
  const finalRoute = runtimeStatus.finalRoute ?? {};
  const reachability = finalRoute.reachability ?? {};

  const routeKind = finalRouteTruth.routeKind || finalRoute.routeKind || runtimeStatus.routeKind || 'unavailable';
  const preferredTarget = finalRouteTruth.preferredTarget || finalRoute.preferredTarget || runtimeStatus.preferredTarget || 'unavailable';
  const actualTarget = finalRouteTruth.actualTarget || finalRoute.actualTarget || runtimeStatus.actualTargetUsed || 'unavailable';
  const source = finalRouteTruth.source || finalRoute.source || runtimeStatus.nodeAddressSource || 'unknown';

  const uiReachableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : normalizeUiReachabilityState(finalRouteTruth.uiReachabilityState, finalRouteTruth.uiReachable);
  const routeUsableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : asBooleanState(finalRouteTruth.routeUsable);

  return {
    routeKind,
    fallbackActive: finalRouteTruth.fallbackActive === true,
    backendReachableState: asBooleanState(finalRouteTruth.backendReachable),
    uiReachableState,
    routeUsableState,
    homeNodeUsableState: asBooleanState(finalRouteTruth.homeNodeUsable),
    requestedProvider: finalRouteTruth.requestedProvider || runtimeStatus.selectedProvider || 'unknown',
    selectedProvider: finalRouteTruth.selectedProvider || runtimeStatus.routeSelectedProvider || runtimeStatus.selectedProvider || 'unknown',
    executedProvider: finalRouteTruth.executedProvider || runtimeStatus.activeProvider || 'unknown',
    preferredTarget,
    actualTarget,
    source,
    preferredRoute: finalRouteTruth.preferredRoute || runtimeStatus.preferredRoute || routeKind,
    winnerReason: finalRouteTruth.winnerReason || finalRoute.winnerReason || runtimeStatus.routeSummary || 'n/a',
    operatorReason: finalRouteTruth.operatorAction || runtimeStatus.dependencySummary || 'n/a',
    selectedRouteReachableState: reachability.selectedRouteReachable === true
      ? 'yes'
      : reachability.selectedRouteReachable === false
        ? 'no'
        : 'pending',
  };
}
