function resolveBackendReachabilityState(routeTruthView = {}, runtimeStatus = {}, canonicalRouteTruth = {}) {
  const backendReachableState = String(routeTruthView?.backendReachableState || '').trim().toLowerCase();
  if (backendReachableState === 'yes' || backendReachableState === 'no') {
    return backendReachableState;
  }
  if (typeof canonicalRouteTruth?.backendReachable === 'boolean') {
    return canonicalRouteTruth.backendReachable ? 'yes' : 'no';
  }
  if (runtimeStatus?.backendReachable === true) return 'yes';
  if (runtimeStatus?.backendReachable === false) return 'no';
  return 'unknown';
}

function resolveRouteUsableState(routeTruthView = {}, canonicalRouteTruth = {}) {
  const routeUsableState = String(routeTruthView?.routeUsableState || '').trim().toLowerCase();
  if (routeUsableState === 'yes' || routeUsableState === 'no') {
    return routeUsableState;
  }
  if (typeof canonicalRouteTruth?.routeUsable === 'boolean') {
    return canonicalRouteTruth.routeUsable ? 'yes' : 'no';
  }
  return 'unknown';
}

function resolveFallbackVetoReason({
  routeUsableState,
  canonicalRouteTruth,
  routeTruthView,
  backendReachabilityState,
  selectedRouteKind,
  hostedCloudPathAvailable,
  selectedAnswerMode,
}) {
  const hostedCloudCognitionMode = selectedAnswerMode === 'cloud-basic'
    || selectedAnswerMode === 'fresh-cloud'
    || selectedAnswerMode === 'fresh-web';
  if (hostedCloudPathAvailable && hostedCloudCognitionMode && backendReachabilityState === 'no') {
    return null;
  }
  if (routeUsableState !== 'no') {
    return null;
  }

  return String(
    routeTruthView?.routeUsabilityVetoReason
    || canonicalRouteTruth?.fallbackReason
    || canonicalRouteTruth?.winningReason
    || (backendReachabilityState === 'no' ? 'backend-route-unavailable' : '')
    || (selectedRouteKind === 'unavailable' ? 'no-canonical-winning-route' : '')
    || 'canonical-route-unusable'
    || '',
  ).trim() || null;
}

export function evaluateRequestDispatchGate({
  routeDecision = {},
  routeTruthView = {},
  runtimeStatus = {},
} = {}) {
  const canonicalRouteTruth = runtimeStatus?.canonicalRouteRuntimeTruth || {};
  const runtimeContext = runtimeStatus?.runtimeContext || {};
  const sessionKind = String(runtimeStatus?.sessionKind || runtimeContext?.sessionKind || canonicalRouteTruth?.sessionKind || '').trim().toLowerCase();
  const deviceContext = String(runtimeContext?.deviceContext || canonicalRouteTruth?.deviceContext || '').trim().toLowerCase();
  const localDesktopExecuteLocked = sessionKind === 'local-desktop' || deviceContext === 'pc-local-browser';
  const selectedRouteKind = String(
    routeTruthView?.routeKind
    || routeDecision?.requestRouteTruth?.routeKind
    || canonicalRouteTruth?.winningRoute
    || 'unavailable',
  ).trim() || 'unavailable';
  const routeUsableState = resolveRouteUsableState(routeTruthView, canonicalRouteTruth);
  const backendReachabilityState = resolveBackendReachabilityState(routeTruthView, runtimeStatus, canonicalRouteTruth);
  const hostedCloudPathAvailable = routeDecision?.hostedCloudPathAvailable === true;
  const backendReachable = backendReachabilityState !== 'no';
  const explicitBackendUnreachable = backendReachabilityState === 'no';

  const freshRouteViable = localDesktopExecuteLocked
    ? false
    : (routeDecision?.freshRouteAvailable === true && backendReachable);
  const cloudRouteViable = localDesktopExecuteLocked
    ? false
    : ((routeDecision?.cloudRouteAvailable ?? routeDecision?.freshRouteAvailable) === true && backendReachable);
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
  const fallbackVetoReason = resolveFallbackVetoReason({
    routeUsableState,
    canonicalRouteTruth,
    routeTruthView,
    backendReachabilityState,
    selectedRouteKind,
    hostedCloudPathAvailable,
    selectedAnswerMode: effectiveAnswerMode,
  });

  if (modeRouteUnavailable) {
    return {
      dispatchAllowed: false,
      reasonCode: fallbackVetoReason || routeDecision?.fallbackReasonCode || 'fresh-route-unavailable',
      selectedAnswerMode: effectiveAnswerMode,
      freshRouteViable,
      cloudRouteViable,
      localRouteViable,
      backendReachable,
      backendReachabilityState,
      selectedRouteKind,
      selectedRouteUsable: routeUsableState === 'yes',
      routeUsableState,
      fallbackVetoReason,
    };
  }

  if (explicitBackendUnreachable) {
    return {
      dispatchAllowed: false,
      reasonCode: 'backend-route-unavailable',
      selectedAnswerMode: effectiveAnswerMode,
      freshRouteViable,
      cloudRouteViable,
      localRouteViable,
      backendReachable,
      backendReachabilityState,
      hostedCloudPathAvailable,
      selectedRouteKind,
      selectedRouteUsable: routeUsableState === 'yes',
      routeUsableState,
      fallbackVetoReason: 'backend-route-unavailable',
      localDesktopExecuteLocked,
    };
  }

  const dispatchAllowedByMode = modeRequiresFreshRoute
    ? freshRouteViable || localRouteViable
    : modeRequiresCloudRoute
      ? cloudRouteViable
      : modePrefersLocalExecution
        ? localRouteViable || freshRouteViable || cloudRouteViable
        : freshRouteViable || localRouteViable || cloudRouteViable;
  const bypassRouteUsabilityVeto = hostedCloudPathAvailable
    && (effectiveAnswerMode === 'cloud-basic' || effectiveAnswerMode === 'fresh-cloud' || effectiveAnswerMode === 'fresh-web')
    && (routeUsableState === 'no' || explicitBackendUnreachable);
  const dispatchAllowed = dispatchAllowedByMode && (routeUsableState !== 'no' || bypassRouteUsabilityVeto);

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
      hostedCloudPathAvailable,
      selectedRouteKind,
      selectedRouteUsable: true,
      routeUsableState,
      fallbackVetoReason: null,
      localDesktopExecuteLocked,
    };
  }

  const reasonCode = fallbackVetoReason
    || (modeRequiresFreshRoute
        ? routeDecision?.fallbackReasonCode || 'fresh-route-unavailable'
        : modeRequiresCloudRoute
          ? routeDecision?.fallbackReasonCode || 'no-viable-execution-path'
          : routeDecision?.fallbackReasonCode || 'no-viable-execution-path');

  return {
    dispatchAllowed: false,
    reasonCode,
    selectedAnswerMode: effectiveAnswerMode,
    freshRouteViable,
    cloudRouteViable,
    localRouteViable,
    backendReachable,
    backendReachabilityState,
    hostedCloudPathAvailable,
    selectedRouteKind,
    selectedRouteUsable: routeUsableState === 'yes',
    routeUsableState,
    fallbackVetoReason,
    localDesktopExecuteLocked,
  };
}
