import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';

const DEFAULT_RUNTIME_STATUS_MODEL = Object.freeze(createRuntimeStatusModel({
  appId: 'stephanos',
  appName: 'Stephanos Mission Console',
  validationState: 'launching',
  backendAvailable: false,
  runtimeContext: {},
}));

const PENDING_RUNTIME_STATUS_MODEL = Object.freeze({
  ...DEFAULT_RUNTIME_STATUS_MODEL,
  appLaunchState: 'pending',
  requestedRouteMode: 'pending',
  effectiveRouteMode: 'pending',
  providerMode: 'pending',
  selectedProvider: 'unknown',
  routeSelectedProvider: 'unknown',
  activeProvider: 'unknown',
  activeRouteKind: 'unknown',
  runtimeModeLabel: 'pending',
  dependencySummary: 'pending',
  headline: 'Diagnostics pending',
  nodeAddressSource: 'unknown',
  preferredTarget: 'unavailable',
  actualTargetUsed: 'unavailable',
  readyCloudProviders: [],
  readyLocalProviders: [],
  attemptOrder: [],
  runtimeContext: {
    ...DEFAULT_RUNTIME_STATUS_MODEL.runtimeContext,
    nodeAddressSource: 'unknown',
  },
  finalRoute: {
    ...DEFAULT_RUNTIME_STATUS_MODEL.finalRoute,
    source: 'unknown',
    preferredTarget: 'unavailable',
    actualTarget: 'unavailable',
  },
  finalRouteTruth: {
    sessionKind: 'unknown',
    deviceContext: 'unknown',
    runtimeModeLabel: 'pending',
    requestedRouteMode: 'pending',
    effectiveRouteMode: 'pending',
    preferredRoute: 'unavailable',
    routeKind: 'unavailable',
    winnerReason: '',
    preferredTarget: 'unavailable',
    actualTarget: 'unavailable',
    source: 'unknown',
    backendReachable: false,
    uiReachabilityState: 'unknown',
    uiReachable: false,
    routeUsable: false,
    homeNodeUsable: false,
    localRouteUsable: false,
    cloudRouteReachable: false,
    fallbackActive: false,
    fallbackRouteActive: false,
    requestedProvider: 'unknown',
    selectedProvider: 'unknown',
    executedProvider: '',
    validationState: 'launching',
    appLaunchState: 'pending',
    operatorAction: '',
  },
  runtimeTruth: {
    session: {
      sessionKind: 'unknown',
      deviceContext: 'unknown',
      localEligible: false,
      hostedSession: false,
      nonLocalSession: false,
    },
    route: {
      requestedMode: 'pending',
      effectiveMode: 'pending',
      candidates: [],
      selectedRouteKind: 'unavailable',
      preferredTarget: 'unavailable',
      actualTarget: 'unavailable',
      source: 'unknown',
      winningReason: '',
      fallbackActive: false,
    },
    reachabilityTruth: {
      backendReachable: false,
      uiReachableState: 'unknown',
      uiReachable: null,
      selectedRouteReachable: false,
      selectedRouteUsable: false,
      localAvailable: false,
      homeNodeAvailable: false,
      cloudAvailable: false,
      distAvailable: false,
    },
    provider: {
      requestedProvider: 'unknown',
      selectedProvider: 'unknown',
      executableProvider: '',
      providerHealthState: 'unknown',
      providerReason: '',
      fallbackProviderUsed: false,
    },
    diagnostics: {
      invariantWarnings: [],
      blockingIssues: [],
      operatorGuidance: [],
      validationState: 'launching',
      appLaunchState: 'pending',
    },
    sessionKind: 'unknown',
    deviceContext: 'unknown',
    requestedRouteMode: 'pending',
    effectiveRouteMode: 'pending',
    preferredRoute: 'unavailable',
    selectedRoute: 'unavailable',
    winnerReason: '',
    preferredTarget: 'unavailable',
    actualTarget: 'unavailable',
    source: 'unknown',
    backendReachable: false,
    uiReachabilityState: 'unknown',
    routeUsable: false,
    cloudRouteReachable: false,
    fallbackActive: false,
    fallbackRouteActive: false,
    requestedProvider: 'unknown',
    selectedProvider: 'unknown',
    executedProvider: '',
    validationState: 'launching',
    appLaunchState: 'pending',
    operatorAction: '',
    reachability: {},
    providerEligibility: {},
    routeEvaluations: {},
    routePreferenceOrder: [],
    computedFromPersistence: false,
  },
  runtimeAdjudication: {
    issues: [],
    computedFromPersistence: false,
  },
  canonicalRouteRuntimeTruth: {
    sessionKind: 'unknown',
    sessionReality: 'unknown',
    deviceContext: 'unknown',
    requestedRouteMode: 'pending',
    effectiveRouteMode: 'pending',
    winningRoute: 'unavailable',
    winningReason: '',
    routeSource: 'unknown',
    preferredTarget: 'unavailable',
    actualTarget: 'unavailable',
    backendReachable: false,
    uiReachabilityState: 'unknown',
    uiReachable: false,
    routeReachable: false,
    routeUsable: false,
    localAvailable: false,
    homeNodeAvailable: false,
    cloudAvailable: false,
    distAvailable: false,
    requestedProvider: 'unknown',
    selectedProvider: 'unknown',
    executedProvider: '',
    providerHealthState: 'unknown',
    fallbackActive: false,
    fallbackReason: '',
    validationState: 'launching',
    appLaunchState: 'pending',
    blockingIssueCodes: [],
    operatorSummary: '',
  },
});

function normalizeArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeUiReachabilityState(value, legacyBoolean) {
  if (value === 'reachable' || value === 'unreachable' || value === 'unknown') {
    return value;
  }
  if (legacyBoolean === true) return 'reachable';
  if (legacyBoolean === false) return 'unreachable';
  return 'unknown';
}

export function ensureRuntimeStatusModel(runtimeStatusModel) {
  const hasCandidate = runtimeStatusModel && typeof runtimeStatusModel === 'object';
  const candidate = hasCandidate ? runtimeStatusModel : {};
  const baseModel = hasCandidate ? DEFAULT_RUNTIME_STATUS_MODEL : PENDING_RUNTIME_STATUS_MODEL;

  const finalRouteCandidate = candidate.finalRoute && typeof candidate.finalRoute === 'object' ? candidate.finalRoute : {};
  const runtimeContextCandidate = candidate.runtimeContext && typeof candidate.runtimeContext === 'object' ? candidate.runtimeContext : {};
  const runtimeContextFinalRouteCandidate = runtimeContextCandidate.finalRoute && typeof runtimeContextCandidate.finalRoute === 'object'
    ? runtimeContextCandidate.finalRoute
    : {};

  const hasFinalRouteCandidate = Object.keys(finalRouteCandidate).length > 0 || Object.keys(runtimeContextFinalRouteCandidate).length > 0;
  const finalRouteBase = hasFinalRouteCandidate ? baseModel.finalRoute : PENDING_RUNTIME_STATUS_MODEL.finalRoute;

  const finalRoute = {
    ...finalRouteBase,
    ...runtimeContextFinalRouteCandidate,
    ...finalRouteCandidate,
    reachability: {
      ...finalRouteBase.reachability,
      ...(runtimeContextFinalRouteCandidate.reachability || {}),
      ...(finalRouteCandidate.reachability || {}),
    },
    providerEligibility: {
      ...finalRouteBase.providerEligibility,
      ...(runtimeContextFinalRouteCandidate.providerEligibility || {}),
      ...(finalRouteCandidate.providerEligibility || {}),
    },
    source: finalRouteCandidate.source || runtimeContextFinalRouteCandidate.source || finalRouteBase.source,
    preferredTarget: finalRouteCandidate.preferredTarget || runtimeContextFinalRouteCandidate.preferredTarget || finalRouteBase.preferredTarget,
    actualTarget: finalRouteCandidate.actualTarget || runtimeContextFinalRouteCandidate.actualTarget || finalRouteBase.actualTarget,
  };

  const runtimeContext = {
    ...baseModel.runtimeContext,
    ...runtimeContextCandidate,
    finalRoute,
  };

  const routeKind = finalRoute.routeKind ?? candidate.routeKind ?? baseModel.routeKind;
  const preferredTarget = finalRoute.preferredTarget ?? candidate.preferredTarget ?? baseModel.preferredTarget;
  const actualTargetUsed = finalRoute.actualTarget ?? candidate.actualTargetUsed ?? baseModel.actualTargetUsed;
  const nodeAddressSource = finalRoute.source ?? candidate.nodeAddressSource ?? (hasFinalRouteCandidate ? baseModel.nodeAddressSource : PENDING_RUNTIME_STATUS_MODEL.nodeAddressSource);
  const requestedProviderProjection = candidate.requestedProvider || PENDING_RUNTIME_STATUS_MODEL.finalRouteTruth.requestedProvider;
  const selectedProviderProjection = candidate.routeSelectedProvider || PENDING_RUNTIME_STATUS_MODEL.finalRouteTruth.selectedProvider;
  const executedProviderProjection = candidate.activeProvider || '';

  const finalRouteTruth = candidate.finalRouteTruth && typeof candidate.finalRouteTruth === 'object'
    ? {
      ...PENDING_RUNTIME_STATUS_MODEL.finalRouteTruth,
      ...candidate.finalRouteTruth,
      routeKind: candidate.finalRouteTruth.routeKind || routeKind,
      preferredTarget: candidate.finalRouteTruth.preferredTarget || preferredTarget,
      actualTarget: candidate.finalRouteTruth.actualTarget || actualTargetUsed,
      source: candidate.finalRouteTruth.source || nodeAddressSource,
      requestedProvider: candidate.finalRouteTruth.requestedProvider || requestedProviderProjection,
      selectedProvider: candidate.finalRouteTruth.selectedProvider || selectedProviderProjection,
      executedProvider: candidate.finalRouteTruth.executedProvider || executedProviderProjection,
      fallbackActive: candidate.finalRouteTruth.fallbackActive ?? candidate.fallbackActive ?? false,
      uiReachabilityState: normalizeUiReachabilityState(candidate.finalRouteTruth.uiReachabilityState, candidate.finalRouteTruth.uiReachable),
    }
    : {
      ...PENDING_RUNTIME_STATUS_MODEL.finalRouteTruth,
      routeKind,
      preferredRoute: candidate.preferredRoute || routeKind,
      preferredTarget,
      actualTarget: actualTargetUsed,
      source: nodeAddressSource,
      requestedProvider: requestedProviderProjection,
      selectedProvider: selectedProviderProjection,
      executedProvider: executedProviderProjection,
      fallbackActive: candidate.fallbackActive === true,
      uiReachabilityState: 'unknown',
    };

  const runtimeTruth = candidate.runtimeTruth && typeof candidate.runtimeTruth === 'object'
    ? {
      ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth,
      ...candidate.runtimeTruth,
      selectedRoute: candidate.runtimeTruth.selectedRoute || finalRouteTruth.routeKind || routeKind,
      preferredTarget: candidate.runtimeTruth.preferredTarget || finalRouteTruth.preferredTarget || preferredTarget,
      actualTarget: candidate.runtimeTruth.actualTarget || finalRouteTruth.actualTarget || actualTargetUsed,
      source: candidate.runtimeTruth.source || finalRouteTruth.source || nodeAddressSource,
      requestedProvider: candidate.runtimeTruth.requestedProvider || finalRouteTruth.requestedProvider || requestedProviderProjection,
      selectedProvider: candidate.runtimeTruth.selectedProvider || finalRouteTruth.selectedProvider || selectedProviderProjection,
      executedProvider: candidate.runtimeTruth.executedProvider || finalRouteTruth.executedProvider || executedProviderProjection,
      routePreferenceOrder: normalizeArray(candidate.runtimeTruth.routePreferenceOrder, []),
      session: candidate.runtimeTruth.session && typeof candidate.runtimeTruth.session === 'object'
        ? { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.session, ...candidate.runtimeTruth.session }
        : { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.session },
      route: candidate.runtimeTruth.route && typeof candidate.runtimeTruth.route === 'object'
        ? { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.route, ...candidate.runtimeTruth.route }
        : { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.route },
      reachabilityTruth: candidate.runtimeTruth.reachabilityTruth && typeof candidate.runtimeTruth.reachabilityTruth === 'object'
        ? { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.reachabilityTruth, ...candidate.runtimeTruth.reachabilityTruth }
        : { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.reachabilityTruth },
      provider: candidate.runtimeTruth.provider && typeof candidate.runtimeTruth.provider === 'object'
        ? { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.provider, ...candidate.runtimeTruth.provider }
        : { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.provider },
      diagnostics: candidate.runtimeTruth.diagnostics && typeof candidate.runtimeTruth.diagnostics === 'object'
        ? {
          ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.diagnostics,
          ...candidate.runtimeTruth.diagnostics,
          invariantWarnings: normalizeArray(candidate.runtimeTruth.diagnostics.invariantWarnings),
          blockingIssues: normalizeArray(candidate.runtimeTruth.diagnostics.blockingIssues),
          operatorGuidance: normalizeArray(candidate.runtimeTruth.diagnostics.operatorGuidance),
        }
        : { ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth.diagnostics },
    }
    : {
      ...PENDING_RUNTIME_STATUS_MODEL.runtimeTruth,
      sessionKind: finalRouteTruth.sessionKind,
      deviceContext: finalRouteTruth.deviceContext,
      requestedRouteMode: finalRouteTruth.requestedRouteMode,
      effectiveRouteMode: finalRouteTruth.effectiveRouteMode,
      preferredRoute: finalRouteTruth.preferredRoute,
      selectedRoute: finalRouteTruth.routeKind || routeKind,
      winnerReason: finalRouteTruth.winnerReason,
      preferredTarget: finalRouteTruth.preferredTarget || preferredTarget,
      actualTarget: finalRouteTruth.actualTarget || actualTargetUsed,
      source: finalRouteTruth.source || nodeAddressSource,
      backendReachable: finalRouteTruth.backendReachable === true,
      uiReachabilityState: finalRouteTruth.uiReachabilityState || 'unknown',
      routeUsable: finalRouteTruth.routeUsable === true,
      cloudRouteReachable: finalRouteTruth.cloudRouteReachable === true,
      fallbackActive: finalRouteTruth.fallbackActive === true,
      fallbackRouteActive: finalRouteTruth.fallbackRouteActive === true,
      requestedProvider: finalRouteTruth.requestedProvider || requestedProviderProjection,
      selectedProvider: finalRouteTruth.selectedProvider || selectedProviderProjection,
      executedProvider: finalRouteTruth.executedProvider || executedProviderProjection,
      validationState: finalRouteTruth.validationState || 'launching',
      appLaunchState: finalRouteTruth.appLaunchState || 'pending',
      operatorAction: finalRouteTruth.operatorAction || '',
      reachability: finalRoute.reachability || {},
      providerEligibility: finalRoute.providerEligibility || {},
      routeEvaluations: candidate.routeEvaluations && typeof candidate.routeEvaluations === 'object' ? candidate.routeEvaluations : {},
      routePreferenceOrder: normalizeArray(candidate.routePreferenceOrder, []),
      computedFromPersistence: false,
    };

  const runtimeAdjudication = candidate.runtimeAdjudication && typeof candidate.runtimeAdjudication === 'object'
    ? {
      issues: normalizeArray(candidate.runtimeAdjudication.issues),
      computedFromPersistence: candidate.runtimeAdjudication.computedFromPersistence === true,
    }
    : { ...PENDING_RUNTIME_STATUS_MODEL.runtimeAdjudication };

  const guardrails = candidate.guardrails && typeof candidate.guardrails === 'object'
    ? {
      ok: candidate.guardrails.ok !== false,
      hasErrors: candidate.guardrails.hasErrors === true,
      hasWarnings: candidate.guardrails.hasWarnings === true,
      errors: normalizeArray(candidate.guardrails.errors),
      warnings: normalizeArray(candidate.guardrails.warnings),
      invariants: normalizeArray(candidate.guardrails.invariants),
      summary: candidate.guardrails.summary && typeof candidate.guardrails.summary === 'object'
        ? {
          total: Number(candidate.guardrails.summary.total) || 0,
          errors: Number(candidate.guardrails.summary.errors) || 0,
          warnings: Number(candidate.guardrails.summary.warnings) || 0,
        }
        : { total: 0, errors: 0, warnings: 0 },
    }
    : { ok: true, hasErrors: false, hasWarnings: false, errors: [], warnings: [], invariants: [], summary: { total: 0, errors: 0, warnings: 0 } };

  const canonicalRouteRuntimeTruth = candidate.canonicalRouteRuntimeTruth && typeof candidate.canonicalRouteRuntimeTruth === 'object'
    ? {
      ...PENDING_RUNTIME_STATUS_MODEL.canonicalRouteRuntimeTruth,
      ...candidate.canonicalRouteRuntimeTruth,
      blockingIssueCodes: normalizeArray(candidate.canonicalRouteRuntimeTruth.blockingIssueCodes, []),
    }
    : candidate.runtimeTruthSnapshot && typeof candidate.runtimeTruthSnapshot === 'object'
      ? {
        ...PENDING_RUNTIME_STATUS_MODEL.canonicalRouteRuntimeTruth,
        ...candidate.runtimeTruthSnapshot,
        blockingIssueCodes: normalizeArray(candidate.runtimeTruthSnapshot.blockingIssueCodes, []),
      }
      : {
        ...PENDING_RUNTIME_STATUS_MODEL.canonicalRouteRuntimeTruth,
        sessionKind: runtimeTruth.session?.sessionKind || finalRouteTruth.sessionKind || 'unknown',
        sessionReality: runtimeTruth.session?.nonLocalSession ? 'non-local' : 'local-desktop',
        deviceContext: runtimeTruth.session?.deviceContext || finalRouteTruth.deviceContext || 'unknown',
        requestedRouteMode: runtimeTruth.route?.requestedMode || finalRouteTruth.requestedRouteMode || 'pending',
        effectiveRouteMode: runtimeTruth.route?.effectiveMode || finalRouteTruth.effectiveRouteMode || 'pending',
        winningRoute: runtimeTruth.route?.selectedRouteKind || finalRouteTruth.routeKind || 'unavailable',
        winningReason: runtimeTruth.route?.winningReason || finalRouteTruth.winnerReason || '',
        routeSource: runtimeTruth.route?.source || finalRouteTruth.source || 'unknown',
        preferredTarget: runtimeTruth.route?.preferredTarget || finalRouteTruth.preferredTarget || 'unavailable',
        actualTarget: runtimeTruth.route?.actualTarget || finalRouteTruth.actualTarget || 'unavailable',
        backendReachable: runtimeTruth.reachabilityTruth?.backendReachable === true || finalRouteTruth.backendReachable === true,
        uiReachabilityState: runtimeTruth.reachabilityTruth?.uiReachableState || finalRouteTruth.uiReachabilityState || 'unknown',
        uiReachable: runtimeTruth.reachabilityTruth?.uiReachable === true || finalRouteTruth.uiReachable === true,
        routeReachable: runtimeTruth.reachabilityTruth?.selectedRouteReachable === true,
        routeUsable: runtimeTruth.reachabilityTruth?.selectedRouteUsable === true || finalRouteTruth.routeUsable === true,
        localAvailable: runtimeTruth.reachabilityTruth?.localAvailable === true,
        homeNodeAvailable: runtimeTruth.reachabilityTruth?.homeNodeAvailable === true,
        cloudAvailable: runtimeTruth.reachabilityTruth?.cloudAvailable === true,
        distAvailable: runtimeTruth.reachabilityTruth?.distAvailable === true,
        requestedProvider: runtimeTruth.provider?.requestedProvider || finalRouteTruth.requestedProvider || 'unknown',
        selectedProvider: runtimeTruth.provider?.selectedProvider || finalRouteTruth.selectedProvider || 'unknown',
        executedProvider: runtimeTruth.provider?.executableProvider || finalRouteTruth.executedProvider || '',
        providerHealthState: runtimeTruth.provider?.providerHealthState || 'unknown',
        fallbackActive: runtimeTruth.route?.fallbackActive === true || finalRouteTruth.fallbackActive === true,
        fallbackReason: runtimeTruth.provider?.fallbackReason || '',
        validationState: runtimeTruth.diagnostics?.validationState || finalRouteTruth.validationState || 'launching',
        appLaunchState: runtimeTruth.diagnostics?.appLaunchState || finalRouteTruth.appLaunchState || 'pending',
        operatorSummary: runtimeTruth.diagnostics?.operatorGuidance?.[0] || finalRouteTruth.operatorAction || '',
      };

  return {
    ...baseModel,
    ...candidate,
    runtimeContext,
    finalRoute,
    finalRouteTruth,
    runtimeTruth,
    runtimeAdjudication,
    canonicalRouteRuntimeTruth,
    guardrails,
    routeKind,
    preferredTarget,
    actualTargetUsed,
    nodeAddressSource,
    headline: candidate.headline || baseModel.headline || 'Diagnostics pending',
    dependencySummary: candidate.dependencySummary || baseModel.dependencySummary || 'pending',
    statusTone: candidate.statusTone || baseModel.statusTone || 'degraded',
    readyCloudProviders: normalizeArray(candidate.readyCloudProviders, baseModel.readyCloudProviders),
    readyLocalProviders: normalizeArray(candidate.readyLocalProviders, baseModel.readyLocalProviders),
    attemptOrder: normalizeArray(candidate.attemptOrder, baseModel.attemptOrder),
  };
}

export { DEFAULT_RUNTIME_STATUS_MODEL, PENDING_RUNTIME_STATUS_MODEL };
