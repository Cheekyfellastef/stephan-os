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
      selectedAnswerMode: effectiveAnswerMode,
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
    selectedAnswerMode: effectiveAnswerMode,
    freshRouteViable,
    cloudRouteViable,
    localRouteViable,
    backendReachable,
  };
}
