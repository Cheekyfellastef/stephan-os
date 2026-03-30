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
  const canonicalTruth = runtimeStatus.canonicalRouteRuntimeTruth ?? {};
  const routeKind = pickTruth(canonicalTruth.winningRoute) || 'unavailable';
  const preferredTarget = pickTruth(canonicalTruth.preferredTarget) || 'unavailable';
  const actualTarget = pickTruth(canonicalTruth.actualTarget) || 'unavailable';
  const source = pickTruth(canonicalTruth.routeSource) || 'unknown';

  const uiReachableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : normalizeUiReachabilityState(canonicalTruth.uiReachabilityState, canonicalTruth.uiReachable);
  const routeUsableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : asBooleanState(canonicalTruth.routeUsable);

  return {
    routeKind,
    fallbackActive: canonicalTruth.fallbackActive === true,
    backendReachableState: asBooleanState(canonicalTruth.backendReachable),
    uiReachableState,
    routeUsableState,
    homeNodeUsableState: asBooleanState(canonicalTruth.homeNodeAvailable),
    requestedProvider: pickTruth(canonicalTruth.requestedProvider) || 'unknown',
    selectedProvider: pickTruth(canonicalTruth.selectedProvider) || 'unknown',
    executedProvider: pickTruth(canonicalTruth.executedProvider, canonicalTruth.selectedProvider) || 'unknown',
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
