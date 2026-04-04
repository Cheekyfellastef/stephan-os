export function evaluateRequestDispatchGate({
  routeDecision = {},
  routeTruthView = {},
  runtimeStatus = {},
} = {}) {
  const backendReachableState = String(routeTruthView?.backendReachableState || '').trim().toLowerCase();
  const backendReachable = backendReachableState
    ? backendReachableState === 'yes'
    : runtimeStatus?.backendReachable === true;
  const freshRouteViable = backendReachable && routeDecision?.freshRouteAvailable === true;
  const cloudRouteViable = backendReachable && (routeDecision?.cloudRouteAvailable ?? routeDecision?.freshRouteAvailable) === true;
  const localRouteViable = backendReachable && routeDecision?.localRouteAvailable === true;
  const selectedAnswerMode = routeDecision?.selectedAnswerMode || 'local-private';

  const modeRequiresFreshRoute = selectedAnswerMode === 'fresh-web' || selectedAnswerMode === 'fresh-cloud';
  const modeRequiresCloudRoute = selectedAnswerMode === 'cloud-basic';
  const modePrefersLocalExecution = selectedAnswerMode === 'local-private' || selectedAnswerMode === 'fallback-stale-risk';
  const modeRouteUnavailable = selectedAnswerMode === 'route-unavailable';

  if (modeRouteUnavailable) {
    return {
      dispatchAllowed: false,
      reasonCode: routeDecision?.fallbackReasonCode || 'fresh-route-unavailable',
      selectedAnswerMode,
      freshRouteViable,
      cloudRouteViable,
      localRouteViable,
      backendReachable,
    };
  }

  const dispatchAllowed = modeRequiresFreshRoute
    ? freshRouteViable || localRouteViable
    : modeRequiresCloudRoute
      ? cloudRouteViable
    : modePrefersLocalExecution
      ? localRouteViable || freshRouteViable
      : freshRouteViable || localRouteViable || cloudRouteViable;

  if (dispatchAllowed) {
    return {
      dispatchAllowed: true,
      reasonCode: null,
      selectedAnswerMode,
      freshRouteViable,
      cloudRouteViable,
      localRouteViable,
      backendReachable,
    };
  }

  const reasonCode = !backendReachable
    ? 'backend-unreachable'
    : modeRequiresFreshRoute
      ? routeDecision?.fallbackReasonCode || 'fresh-route-unavailable'
      : modeRequiresCloudRoute
        ? routeDecision?.fallbackReasonCode || 'no-viable-execution-path'
      : 'no-viable-execution-path';

  return {
    dispatchAllowed: false,
    reasonCode,
    selectedAnswerMode,
    freshRouteViable,
    cloudRouteViable,
    localRouteViable,
    backendReachable,
  };
}
