function resolveBackendReachabilityState(routeTruthView = {}, runtimeStatus = {}) {
  const backendReachableState = String(routeTruthView?.backendReachableState || '').trim().toLowerCase();
  if (backendReachableState === 'yes' || backendReachableState === 'no') {
    return backendReachableState;
  }
  if (runtimeStatus?.backendReachable === true) return 'yes';
  if (runtimeStatus?.backendReachable === false) return 'no';
  return 'unknown';
}

export function evaluateRequestDispatchGate({
  routeDecision = {},
  routeTruthView = {},
  runtimeStatus = {},
} = {}) {
  const backendReachabilityState = resolveBackendReachabilityState(routeTruthView, runtimeStatus);
  const backendReachable = backendReachabilityState !== 'no';
  const explicitBackendUnreachable = backendReachabilityState === 'no';
  const freshRouteViable = routeDecision?.freshRouteAvailable === true && backendReachable;
  const cloudRouteViable = (routeDecision?.cloudRouteAvailable ?? routeDecision?.freshRouteAvailable) === true && backendReachable;
  const localRouteViable = routeDecision?.localRouteAvailable === true && backendReachable;
  const selectedAnswerMode = routeDecision?.selectedAnswerMode || 'local-private';
  const selectedProvider = String(routeDecision?.selectedProvider || '').trim().toLowerCase();
  const shouldPromoteToCloudBasic = (
    (selectedAnswerMode === 'local-private' || selectedAnswerMode === 'fallback-stale-risk')
    && selectedProvider === 'groq'
    && !localRouteViable
    && cloudRouteViable
  );
  const effectiveAnswerMode = shouldPromoteToCloudBasic ? 'cloud-basic' : selectedAnswerMode;

  const modeRequiresFreshRoute = effectiveAnswerMode === 'fresh-web' || effectiveAnswerMode === 'fresh-cloud';
  const modeRequiresCloudRoute = effectiveAnswerMode === 'cloud-basic';
  const modePrefersLocalExecution = effectiveAnswerMode === 'local-private' || effectiveAnswerMode === 'fallback-stale-risk';
  const modeRouteUnavailable = effectiveAnswerMode === 'route-unavailable';

  if (modeRouteUnavailable) {
    return {
      dispatchAllowed: false,
      reasonCode: routeDecision?.fallbackReasonCode || 'fresh-route-unavailable',
      selectedAnswerMode: effectiveAnswerMode,
      freshRouteViable,
      cloudRouteViable,
      localRouteViable,
      backendReachable,
      backendReachabilityState,
    };
  }

  const dispatchAllowed = modeRequiresFreshRoute
    ? freshRouteViable || localRouteViable
    : modeRequiresCloudRoute
      ? cloudRouteViable
      : modePrefersLocalExecution
        ? localRouteViable || freshRouteViable || cloudRouteViable
        : freshRouteViable || localRouteViable || cloudRouteViable;

  if (dispatchAllowed) {
    return {
      dispatchAllowed: true,
      reasonCode: null,
      selectedAnswerMode: effectiveAnswerMode,
      freshRouteViable,
      cloudRouteViable,
      localRouteViable,
      backendReachable,
      backendReachabilityState,
    };
  }

  const reasonCode = explicitBackendUnreachable
    ? 'backend-unreachable'
    : modeRequiresFreshRoute
      ? routeDecision?.fallbackReasonCode || 'fresh-route-unavailable'
      : modeRequiresCloudRoute
        ? routeDecision?.fallbackReasonCode || 'no-viable-execution-path'
      : routeDecision?.fallbackReasonCode || 'no-viable-execution-path';

  return {
    dispatchAllowed: false,
    reasonCode,
    selectedAnswerMode: effectiveAnswerMode,
    freshRouteViable,
    cloudRouteViable,
    localRouteViable,
    backendReachable,
    backendReachabilityState,
  };
}
