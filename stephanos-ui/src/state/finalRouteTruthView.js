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
  const canonicalTruth = runtimeStatus.canonicalRouteRuntimeTruth ?? {};
  const groupedRuntimeTruth = runtimeStatus['runtimeTruth'] ?? {};
  const runtimeDiagnosticsTruth = groupedRuntimeTruth.diagnostics ?? {};

  const routeKind = pickTruth(canonicalTruth.winningRoute) || 'unavailable';
  const preferredTarget = pickTruth(canonicalTruth.preferredTarget) || 'unavailable';
  const actualTarget = pickTruth(canonicalTruth.actualTarget) || 'unavailable';
  const source = pickTruth(canonicalTruth.routeSource) || 'unknown';

  const uiReachableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : normalizeUiReachabilityState(
      pickTruth(canonicalTruth.uiReachabilityState),
      canonicalTruth.uiReachable,
    );
  const reconciledRouteUsable = canonicalTruth.routeUsable === false
    && canonicalTruth.routeReachable === true
    && canonicalTruth.backendReachable === true
    && uiReachableState === 'yes'
      ? true
      : canonicalTruth.routeUsable;
  const preReconciliationRouteUsableState = runtimeStatus.appLaunchState === 'pending' || routeKind === 'unavailable'
    ? 'unknown'
    : asBooleanState(reconciledRouteUsable);
  const selectedProvider = pickTruth(canonicalTruth.selectedProvider) || 'unknown';
  const executedProvider = pickTruth(canonicalTruth.executedProvider) || 'unknown';
  const providerState = normalizeProviderState(
    pickTruth(canonicalTruth.providerHealthState),
  );
  const executableProviderValid = isKnownProvider(executedProvider);
  const backendReachable = canonicalTruth.backendReachable === true;
  const selectedRouteReachable = canonicalTruth.routeReachable === true;
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
    fallbackActive: canonicalTruth.fallbackActive === true,
    backendReachableState: asBooleanState(canonicalTruth.backendReachable),
    uiReachableState,
    routeUsableState,
    homeNodeUsableState: asBooleanState(canonicalTruth.homeNodeAvailable),
    requestedProvider: pickTruth(canonicalTruth.requestedProvider) || 'unknown',
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
