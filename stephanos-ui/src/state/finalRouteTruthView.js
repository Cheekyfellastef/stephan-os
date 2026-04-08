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

function isKnownProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return provider.length > 0 && !['unknown', 'n/a', 'none', 'pending', 'unavailable'].includes(provider);
}

function normalizeProviderState(value) {
  return String(value || '').trim().toUpperCase();
}

function hasBlockingIssues(runtimeDiagnosticsTruth = {}, canonicalTruth = {}) {
  if (Array.isArray(runtimeDiagnosticsTruth?.blockingIssues) && runtimeDiagnosticsTruth.blockingIssues.length > 0) {
    return true;
  }
  if (Array.isArray(canonicalTruth?.blockingIssueCodes) && canonicalTruth.blockingIssueCodes.length > 0) {
    return true;
  }
  return false;
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
  const runtimeDiagnosticsTruth = runtimeTruth.diagnostics ?? {};

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
  const canonicalRouteUsable = canonicalTruth.routeUsable;
  const fallbackRouteUsable = finalRouteTruth.routeUsable === true || runtimeReachabilityTruth.selectedRouteUsable === true
    ? true
    : (finalRouteTruth.routeUsable ?? runtimeReachabilityTruth.selectedRouteUsable);
  const reconciledRouteUsable = canonicalRouteUsable === false
    && fallbackRouteUsable === true
    && canonicalTruth.routeReachable === true
    && (canonicalTruth.backendReachable ?? finalRouteTruth.backendReachable ?? runtimeReachabilityTruth.backendReachable) === true
    && uiReachableState === 'yes'
      ? true
      : (canonicalRouteUsable ?? fallbackRouteUsable);
  const preReconciliationRouteUsableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : asBooleanState(reconciledRouteUsable);
  const selectedProvider = pickTruth(canonicalTruth.selectedProvider, finalRouteTruth.selectedProvider, runtimeProviderTruth.selectedProvider, runtimeTruth.selectedProvider) || 'unknown';
  const executedProvider = pickTruth(canonicalTruth.executedProvider, finalRouteTruth.executedProvider, runtimeProviderTruth.executableProvider, runtimeTruth.executedProvider) || 'unknown';
  const providerState = normalizeProviderState(
    pickTruth(canonicalTruth.providerHealthState, finalRouteTruth.providerHealthState, runtimeProviderTruth.providerHealthState),
  );
  const executableProviderValid = isKnownProvider(executedProvider);
  const backendReachable = (canonicalTruth.backendReachable ?? finalRouteTruth.backendReachable ?? runtimeReachabilityTruth.backendReachable) === true;
  const selectedRouteReachable = canonicalTruth.routeReachable === true || runtimeReachabilityTruth.selectedRouteReachable === true;
  const liveProviderConnected = ['READY', 'CONNECTED'].includes(providerState);
  const liveUsabilitySignalsMet = backendReachable
    && selectedRouteReachable
    && uiReachableState === 'yes'
    && liveProviderConnected
    && executableProviderValid;
  const routeUsabilityConflict = preReconciliationRouteUsableState === 'no' && liveUsabilitySignalsMet;
  const routeReconciled = routeUsabilityConflict;
  const routeReconciliationReason = routeReconciled ? 'live-backend+provider-confirmed' : '';
  const routeUsableState = routeReconciled ? 'yes' : preReconciliationRouteUsableState;
  const providerMismatch = isKnownProvider(selectedProvider) && isKnownProvider(executedProvider) && selectedProvider !== executedProvider;
  const truthInconsistent = routeUsabilityConflict;
  const blockingIssuesPresent = hasBlockingIssues(runtimeDiagnosticsTruth, canonicalTruth);
  const routeUsabilityVetoReason = routeUsableState === 'no'
    ? (!selectedRouteReachable
      ? 'selected-route-unreachable'
      : !backendReachable
        ? 'backend-unreachable'
        : uiReachableState === 'no'
          ? 'ui-reachability-unreachable'
          : !liveProviderConnected
            ? 'provider-not-ready'
            : !executableProviderValid
              ? 'executable-provider-missing'
              : blockingIssuesPresent
                ? 'blocking-issues-present'
                : 'canonical-route-usability-drift')
    : '';
  const effectiveLaunchState = runtimeStatus.appLaunchState === 'degraded'
    && routeReconciled
    && !blockingIssuesPresent
    ? 'ready'
    : runtimeStatus.appLaunchState;

  return {
    routeKind,
    fallbackActive: canonicalTruth.fallbackActive === true || finalRouteTruth.fallbackActive === true || runtimeRouteTruth.fallbackActive === true,
    backendReachableState: asBooleanState(canonicalTruth.backendReachable ?? finalRouteTruth.backendReachable ?? runtimeReachabilityTruth.backendReachable),
    uiReachableState,
    routeUsableState,
    homeNodeUsableState: asBooleanState(canonicalTruth.homeNodeAvailable ?? finalRouteTruth.homeNodeUsable ?? runtimeReachabilityTruth.homeNodeAvailable),
    requestedProvider: pickTruth(canonicalTruth.requestedProvider, finalRouteTruth.requestedProvider, runtimeProviderTruth.requestedProvider, runtimeTruth.requestedProvider) || 'unknown',
    selectedProvider,
    executedProvider,
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
    providerMismatch,
    routeUsabilityConflict,
    truthInconsistent,
    routeReconciled,
    routeReconciliationReason,
    routeUsabilityVetoReason,
    providerState,
    effectiveLaunchState,
  };
}
