import { createRuntimeStatusModel } from '../../../shared/runtime/runtimeStatusModel.mjs';

let defaultRuntimeStatusModelCache = null;
let pendingRuntimeStatusModelCache = null;

function getDefaultRuntimeStatusModel() {
  if (defaultRuntimeStatusModelCache) {
    return defaultRuntimeStatusModelCache;
  }
  defaultRuntimeStatusModelCache = Object.freeze(createRuntimeStatusModel({
    appId: 'stephanos',
    appName: 'Stephanos Mission Console',
    validationState: 'launching',
    backendAvailable: false,
    runtimeContext: {},
  }));
  return defaultRuntimeStatusModelCache;
}

function getPendingRuntimeStatusModel() {
  if (pendingRuntimeStatusModelCache) {
    return pendingRuntimeStatusModelCache;
  }
  const defaultRuntimeStatusModel = getDefaultRuntimeStatusModel();
  pendingRuntimeStatusModelCache = Object.freeze({
    ...defaultRuntimeStatusModel,
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
    ...defaultRuntimeStatusModel.runtimeContext,
    nodeAddressSource: 'unknown',
  },
  finalRoute: {
    ...defaultRuntimeStatusModel.finalRoute,
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
  cognitiveAdjudication: {
    watcherVersion: 'system-watcher.v2',
    mode: 'observer-only',
    diagnosisSummary: {
      status: 'stable',
      contradictionCount: 0,
      matchedPatternCount: 0,
      likelyFailingLayer: 'none-detected',
      persistenceClassification: 'insufficient-evidence',
      temporalConfidence: 'limited',
      headline: 'No high-confidence contradiction pattern detected.',
    },
    contradictions: [],
    failureFamilies: [],
    patternMatches: [],
    rootCauseCandidates: [],
    temporalSignal: {
      windowSize: 8,
      persistenceClassification: 'insufficient-evidence',
      temporalConfidence: 'limited',
      transitionBackedEvidence: {
        historyWindowSize: 0,
        recurringFamilies: [],
        oscillationSignals: [],
        routeKinds: [],
        providerStagePairs: [],
        timeoutLayers: [],
      },
    },
    recommendations: {
      nextInspectionBoundary: 'Continue normal monitoring; no contradiction cluster requires action.',
      verificationChecks: [],
      regressionChecks: [],
    },
    patternMemory: {
      memoryVersion: 'runtime-operational-pattern-memory.v2',
      knownPatternCatalog: [],
      recentMatchedPatterns: [],
      candidatePatterns: [],
      promotionPolicy: 'observer-only-no-auto-durable-promotion',
    },
    reasoningBoundaries: {
      evidenceSources: [],
      interpretationRule: 'Evidence and interpretations are separated; unknowns remain explicit.',
      speculationPolicy: 'No speculative conclusions are promoted to durable memory automatically.',
    },
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
  return pendingRuntimeStatusModelCache;
}

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

const PLACEHOLDER_TRUTH_VALUES = new Set(['', 'unknown', 'pending', 'unavailable', 'n/a']);

function isPlaceholderTruthValue(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_TRUTH_VALUES.has(value.trim().toLowerCase());
}

function preferNonPlaceholderTruth(...candidates) {
  for (const candidate of candidates) {
    if (!isPlaceholderTruthValue(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

export function ensureRuntimeStatusModel(runtimeStatusModel) {
  const hasCandidate = runtimeStatusModel && typeof runtimeStatusModel === 'object';
  const candidate = hasCandidate ? runtimeStatusModel : {};
  const baseModel = hasCandidate ? getDefaultRuntimeStatusModel() : getPendingRuntimeStatusModel();
  const pendingRuntimeStatusModel = getPendingRuntimeStatusModel();

  const finalRouteCandidate = candidate.finalRoute && typeof candidate.finalRoute === 'object' ? candidate.finalRoute : {};
  const runtimeContextCandidate = candidate.runtimeContext && typeof candidate.runtimeContext === 'object' ? candidate.runtimeContext : {};
  const runtimeContextFinalRouteCandidate = runtimeContextCandidate.finalRoute && typeof runtimeContextCandidate.finalRoute === 'object'
    ? runtimeContextCandidate.finalRoute
    : {};

  const hasFinalRouteCandidate = Object.keys(finalRouteCandidate).length > 0 || Object.keys(runtimeContextFinalRouteCandidate).length > 0;
  const finalRouteBase = hasFinalRouteCandidate ? baseModel.finalRoute : pendingRuntimeStatusModel.finalRoute;

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
  const nodeAddressSource = finalRoute.source ?? candidate.nodeAddressSource ?? (hasFinalRouteCandidate ? baseModel.nodeAddressSource : pendingRuntimeStatusModel.nodeAddressSource);
  const requestedProviderProjection = candidate.requestedProvider || pendingRuntimeStatusModel.finalRouteTruth.requestedProvider;
  const selectedProviderProjection = candidate.routeSelectedProvider || pendingRuntimeStatusModel.finalRouteTruth.selectedProvider;
  const executedProviderProjection = '';

  const finalRouteTruth = candidate.finalRouteTruth && typeof candidate.finalRouteTruth === 'object'
    ? {
      ...pendingRuntimeStatusModel.finalRouteTruth,
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
      ...pendingRuntimeStatusModel.finalRouteTruth,
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
      ...pendingRuntimeStatusModel.runtimeTruth,
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
        ? { ...pendingRuntimeStatusModel.runtimeTruth.session, ...candidate.runtimeTruth.session }
        : { ...pendingRuntimeStatusModel.runtimeTruth.session },
      route: candidate.runtimeTruth.route && typeof candidate.runtimeTruth.route === 'object'
        ? { ...pendingRuntimeStatusModel.runtimeTruth.route, ...candidate.runtimeTruth.route }
        : { ...pendingRuntimeStatusModel.runtimeTruth.route },
      reachabilityTruth: candidate.runtimeTruth.reachabilityTruth && typeof candidate.runtimeTruth.reachabilityTruth === 'object'
        ? { ...pendingRuntimeStatusModel.runtimeTruth.reachabilityTruth, ...candidate.runtimeTruth.reachabilityTruth }
        : { ...pendingRuntimeStatusModel.runtimeTruth.reachabilityTruth },
      provider: candidate.runtimeTruth.provider && typeof candidate.runtimeTruth.provider === 'object'
        ? { ...pendingRuntimeStatusModel.runtimeTruth.provider, ...candidate.runtimeTruth.provider }
        : { ...pendingRuntimeStatusModel.runtimeTruth.provider },
      diagnostics: candidate.runtimeTruth.diagnostics && typeof candidate.runtimeTruth.diagnostics === 'object'
        ? {
          ...pendingRuntimeStatusModel.runtimeTruth.diagnostics,
          ...candidate.runtimeTruth.diagnostics,
          invariantWarnings: normalizeArray(candidate.runtimeTruth.diagnostics.invariantWarnings),
          blockingIssues: normalizeArray(candidate.runtimeTruth.diagnostics.blockingIssues),
          operatorGuidance: normalizeArray(candidate.runtimeTruth.diagnostics.operatorGuidance),
        }
        : { ...pendingRuntimeStatusModel.runtimeTruth.diagnostics },
    }
    : {
      ...pendingRuntimeStatusModel.runtimeTruth,
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
      route: {
        ...pendingRuntimeStatusModel.runtimeTruth.route,
        requestedMode: finalRouteTruth.requestedRouteMode || 'pending',
        effectiveMode: finalRouteTruth.effectiveRouteMode || 'pending',
        selectedRouteKind: finalRouteTruth.routeKind || routeKind || 'unavailable',
        preferredTarget: finalRouteTruth.preferredTarget || preferredTarget || 'unavailable',
        actualTarget: finalRouteTruth.actualTarget || actualTargetUsed || 'unavailable',
        source: finalRouteTruth.source || nodeAddressSource || 'unknown',
        winningReason: finalRouteTruth.winnerReason || '',
        fallbackActive: finalRouteTruth.fallbackActive === true,
      },
      reachabilityTruth: {
        ...pendingRuntimeStatusModel.runtimeTruth.reachabilityTruth,
        backendReachable: finalRouteTruth.backendReachable === true,
        uiReachableState: finalRouteTruth.uiReachabilityState || 'unknown',
        uiReachable: typeof finalRouteTruth.uiReachable === 'boolean'
          ? finalRouteTruth.uiReachable
          : null,
        selectedRouteReachable: finalRouteTruth.finalRouteReachable === true,
        selectedRouteUsable: finalRouteTruth.routeUsable === true,
      },
      provider: {
        ...pendingRuntimeStatusModel.runtimeTruth.provider,
        requestedProvider: finalRouteTruth.requestedProvider || requestedProviderProjection,
        selectedProvider: finalRouteTruth.selectedProvider || selectedProviderProjection,
        executableProvider: finalRouteTruth.executedProvider || executedProviderProjection,
      },
    };

  const runtimeAdjudication = candidate.runtimeAdjudication && typeof candidate.runtimeAdjudication === 'object'
    ? {
      issues: normalizeArray(candidate.runtimeAdjudication.issues),
      computedFromPersistence: candidate.runtimeAdjudication.computedFromPersistence === true,
    }
    : { ...pendingRuntimeStatusModel.runtimeAdjudication };

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

  const derivedCanonicalRouteRuntimeTruth = {
    ...pendingRuntimeStatusModel.canonicalRouteRuntimeTruth,
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

  const canonicalInput = candidate.canonicalRouteRuntimeTruth && typeof candidate.canonicalRouteRuntimeTruth === 'object'
    ? candidate.canonicalRouteRuntimeTruth
    : candidate.runtimeTruthSnapshot && typeof candidate.runtimeTruthSnapshot === 'object'
      ? candidate.runtimeTruthSnapshot
      : null;

  const canonicalRouteRuntimeTruth = canonicalInput
    ? {
      ...derivedCanonicalRouteRuntimeTruth,
      ...canonicalInput,
      sessionKind: preferNonPlaceholderTruth(canonicalInput.sessionKind, derivedCanonicalRouteRuntimeTruth.sessionKind),
      sessionReality: preferNonPlaceholderTruth(canonicalInput.sessionReality, derivedCanonicalRouteRuntimeTruth.sessionReality),
      deviceContext: preferNonPlaceholderTruth(canonicalInput.deviceContext, derivedCanonicalRouteRuntimeTruth.deviceContext),
      requestedRouteMode: preferNonPlaceholderTruth(canonicalInput.requestedRouteMode, derivedCanonicalRouteRuntimeTruth.requestedRouteMode),
      effectiveRouteMode: preferNonPlaceholderTruth(canonicalInput.effectiveRouteMode, derivedCanonicalRouteRuntimeTruth.effectiveRouteMode),
      winningRoute: preferNonPlaceholderTruth(canonicalInput.winningRoute, derivedCanonicalRouteRuntimeTruth.winningRoute),
      winningReason: preferNonPlaceholderTruth(canonicalInput.winningReason, derivedCanonicalRouteRuntimeTruth.winningReason),
      routeSource: preferNonPlaceholderTruth(canonicalInput.routeSource, derivedCanonicalRouteRuntimeTruth.routeSource),
      preferredTarget: preferNonPlaceholderTruth(canonicalInput.preferredTarget, derivedCanonicalRouteRuntimeTruth.preferredTarget),
      actualTarget: preferNonPlaceholderTruth(canonicalInput.actualTarget, derivedCanonicalRouteRuntimeTruth.actualTarget),
      uiReachabilityState: preferNonPlaceholderTruth(canonicalInput.uiReachabilityState, derivedCanonicalRouteRuntimeTruth.uiReachabilityState),
      requestedProvider: preferNonPlaceholderTruth(canonicalInput.requestedProvider, derivedCanonicalRouteRuntimeTruth.requestedProvider),
      selectedProvider: preferNonPlaceholderTruth(canonicalInput.selectedProvider, derivedCanonicalRouteRuntimeTruth.selectedProvider),
      executedProvider: preferNonPlaceholderTruth(canonicalInput.executedProvider, derivedCanonicalRouteRuntimeTruth.executedProvider),
      providerHealthState: preferNonPlaceholderTruth(canonicalInput.providerHealthState, derivedCanonicalRouteRuntimeTruth.providerHealthState),
      fallbackReason: preferNonPlaceholderTruth(canonicalInput.fallbackReason, derivedCanonicalRouteRuntimeTruth.fallbackReason),
      validationState: preferNonPlaceholderTruth(canonicalInput.validationState, derivedCanonicalRouteRuntimeTruth.validationState),
      appLaunchState: preferNonPlaceholderTruth(canonicalInput.appLaunchState, derivedCanonicalRouteRuntimeTruth.appLaunchState),
      operatorSummary: preferNonPlaceholderTruth(canonicalInput.operatorSummary, derivedCanonicalRouteRuntimeTruth.operatorSummary),
      blockingIssueCodes: normalizeArray(canonicalInput.blockingIssueCodes, []),
    }
    : derivedCanonicalRouteRuntimeTruth;

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

export { getDefaultRuntimeStatusModel, getPendingRuntimeStatusModel };
