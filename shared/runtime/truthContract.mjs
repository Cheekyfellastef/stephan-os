const RUNTIME_ONLY_ROOT_KEYS = Object.freeze([
  'runtime',
  'runtimeTruth',
  'finalRoute',
  'finalRouteTruth',
  'routeEvaluations',
  'routeDiagnostics',
  'preferredTarget',
  'actualTargetUsed',
  'nodeAddressSource',
  'backendReachable',
  'localAvailable',
  'cloudAvailable',
  'homeNodeReachable',
  'localNodeReachable',
  'routeKind',
  'preferredRoute',
  'selectedRoute',
  'selectedLiveRoute',
  'winnerReason',
  'fallbackActive',
  'sessionKind',
  'deviceContext',
  'runtimeModeLabel',
]);

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function listRuntimeFieldsLeakingIntoCoreTruth(candidate = {}) {
  const source = asObject(candidate);
  return RUNTIME_ONLY_ROOT_KEYS.filter((key) => hasOwn(source, key));
}

// Core Truth contract (portable/shared):
// - session preferences, workspace + UI preferences, working/project memory, and manual home-node preference.
// - never route/runtime adjudication output.
export function sanitizeCoreTruthInput(candidate = {}) {
  const source = asObject(candidate);
  const leakedRuntimeFields = listRuntimeFieldsLeakingIntoCoreTruth(source);

  const sanitized = { ...source };
  for (const key of leakedRuntimeFields) {
    delete sanitized[key];
  }

  if (hasOwn(sanitized, 'session')) {
    sanitized.session = asObject(sanitized.session);
  }

  return {
    sanitized,
    diagnostics: {
      leakedRuntimeFields,
      hadRuntimeLeakage: leakedRuntimeFields.length > 0,
    },
  };
}

// Runtime Truth contract (device-local/ephemeral):
// - computed at runtime and never persisted as Core Truth.
export function buildRuntimeTruthSnapshot({
  runtimeContext = {},
  finalRoute = {},
  finalRouteTruth = {},
  routePlan = {},
  routeEvaluations = {},
  routePreferenceOrder = [],
} = {}) {
  const memoryTruth = runtimeContext.memoryTruth && typeof runtimeContext.memoryTruth === 'object'
    ? runtimeContext.memoryTruth
    : {};
  const tileTruth = runtimeContext.tileTruth && typeof runtimeContext.tileTruth === 'object'
    ? runtimeContext.tileTruth
    : {};

  return {
    sessionKind: finalRouteTruth.sessionKind || runtimeContext.sessionKind || 'unknown',
    deviceContext: finalRouteTruth.deviceContext || runtimeContext.deviceContext || 'unknown',
    requestedRouteMode: finalRouteTruth.requestedRouteMode || routePlan.requestedRouteMode || 'auto',
    effectiveRouteMode: finalRouteTruth.effectiveRouteMode || routePlan.effectiveRouteMode || 'auto',
    preferredRoute: finalRouteTruth.preferredRoute || 'unavailable',
    selectedRoute: finalRouteTruth.routeKind || finalRoute.routeKind || 'unavailable',
    winnerReason: finalRouteTruth.winnerReason || finalRoute.winnerReason || '',
    preferredTarget: finalRouteTruth.preferredTarget || finalRoute.preferredTarget || '',
    actualTarget: finalRouteTruth.actualTarget || finalRoute.actualTarget || '',
    source: finalRouteTruth.source || finalRoute.source || runtimeContext.nodeAddressSource || 'route-diagnostics',
    backendReachable: Boolean(finalRouteTruth.backendReachable),
    uiReachabilityState: finalRouteTruth.uiReachabilityState || 'unknown',
    routeUsable: finalRouteTruth.routeUsable === true,
    cloudRouteReachable: finalRouteTruth.cloudRouteReachable === true,
    fallbackActive: finalRouteTruth.fallbackActive === true,
    fallbackRouteActive: finalRouteTruth.fallbackRouteActive === true,
    savedPreferredProvider: finalRouteTruth.savedPreferredProvider || finalRouteTruth.requestedProvider || routePlan.requestedProvider || '',
    requestedProvider: finalRouteTruth.requestedProvider || routePlan.requestedProvider || '',
    selectedProvider: finalRouteTruth.selectedProvider || routePlan.selectedProvider || '',
    validatedProvider: finalRouteTruth.validatedProvider || '',
    executableProvider: finalRouteTruth.executableProvider || finalRouteTruth.executedProvider || '',
    actualProviderUsed: finalRouteTruth.actualProviderUsed || '',
    executedProvider: finalRouteTruth.executedProvider || '',
    validationState: finalRouteTruth.validationState || 'healthy',
    appLaunchState: finalRouteTruth.appLaunchState || 'ready',
    operatorAction: finalRouteTruth.operatorAction || '',
    memoryHydrationCompleted: memoryTruth.hydrationCompleted === true,
    memoryHydrationSource: memoryTruth.sourceUsedOnLoad || memoryTruth.hydrationSource || 'unknown',
    memoryWriteTarget: memoryTruth.writeTarget || memoryTruth.lastSaveSource || 'unknown',
    memoryFallbackReason: memoryTruth.fallbackReason || '',
    tileExecutionReady: tileTruth.ready === true || tileTruth.executionReady === true,
    tileReadinessReason: tileTruth.reason || tileTruth.blockedReason || '',
    tileLaunchSurface: tileTruth.launchSurface || tileTruth.surface || 'unknown',
    reachability: finalRoute.reachability || {},
    providerEligibility: finalRoute.providerEligibility || {},
    routeEvaluations,
    routePreferenceOrder,
  };
}
