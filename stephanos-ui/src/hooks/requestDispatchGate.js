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
  const localRouteViable = backendReachable && routeDecision?.localRouteAvailable === true;
  const selectedAnswerMode = routeDecision?.selectedAnswerMode || 'local-private';

  const modeRequiresFreshRoute = selectedAnswerMode === 'fresh-web';
  const modePrefersLocalExecution = selectedAnswerMode === 'local-private' || selectedAnswerMode === 'fallback-stale-risk';

  const dispatchAllowed = modeRequiresFreshRoute
    ? freshRouteViable || localRouteViable
    : modePrefersLocalExecution
      ? localRouteViable || freshRouteViable
      : freshRouteViable || localRouteViable;

  if (dispatchAllowed) {
    return {
      dispatchAllowed: true,
      reasonCode: null,
      selectedAnswerMode,
      freshRouteViable,
      localRouteViable,
      backendReachable,
    };
  }

  const reasonCode = !backendReachable
    ? 'backend-unreachable'
    : selectedAnswerMode === 'fresh-web'
      ? routeDecision?.fallbackReasonCode || 'fresh-route-unavailable'
      : 'no-viable-execution-path';

  return {
    dispatchAllowed: false,
    reasonCode,
    selectedAnswerMode,
    freshRouteViable,
    localRouteViable,
    backendReachable,
  };
}
