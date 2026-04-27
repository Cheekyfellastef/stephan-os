import { extractHostname, isLoopbackHost } from './stephanosHomeNode.mjs';
import { buildRuntimeTruthSnapshot } from './truthContract.mjs';
import { buildSystemWatcherModel } from './systemWatcherModel.mjs';
import { deriveCanonicalCaravanMode } from './caravanMode.mjs';

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asTriStateBoolean(value) {
  if (value === 'reachable') return true;
  if (value === 'unreachable') return false;
  return null;
}

function providerHealthStateFor(providerKey, providerHealth = {}) {
  const health = asObject(providerHealth)[providerKey];
  if (!providerKey) return 'unknown';
  if (!health) return 'unknown';
  if (health.ok === true) return 'healthy';
  if (health.ok === false) return 'unhealthy';
  if (typeof health.state === 'string' && health.state) return health.state.toLowerCase();
  return 'unknown';
}

function isSelectedProviderHealthy(selectedProvider, providerHealth = {}) {
  if (!selectedProvider) return false;
  if (selectedProvider === 'mock') return true;
  const selectedHealth = asObject(providerHealth)[selectedProvider];
  if (!selectedHealth || selectedHealth.ok !== true) return false;
  if (selectedHealth.provider && selectedHealth.provider !== selectedProvider) return false;
  return true;
}

function resolveHostedWorkerExecution(runtimeContext = {}, providerHealth = {}, selectedProvider = '') {
  const hostedCloudConfig = asObject(runtimeContext.hostedCloudConfig);
  const configuredSelected = String(hostedCloudConfig.selectedProvider || selectedProvider || '').trim().toLowerCase() || 'groq';
  const providerOrder = [
    configuredSelected,
    ...['groq', 'gemini'].filter((providerKey) => providerKey !== configuredSelected),
  ];
  const providerCandidates = providerOrder.map((providerKey) => {
    const providerConfig = asObject(hostedCloudConfig.providers)?.[providerKey] || {};
    const workerUrl = String(
      providerConfig.baseURL
      || asObject(hostedCloudConfig.providerProxyUrls)?.[providerKey]
      || hostedCloudConfig.proxyUrl
      || '',
    ).trim();
    const enabled = hostedCloudConfig.enabled === true && providerConfig.enabled !== false;
    const lastHealth = asObject(asObject(hostedCloudConfig.lastHealth)[providerKey]);
    const healthState = asObject(providerHealth)[providerKey];
    const reachable = enabled
      && Boolean(workerUrl)
      && (
        lastHealth.reachable === true
        || lastHealth.ok === true
        || lastHealth.status === 'healthy'
        || healthState?.ok === true
        || healthState?.reachable === true
        || healthState?.executableNow === true
      );
    return {
      provider: providerKey,
      workerUrl,
      enabled,
      reachable,
      lastProbe: Object.keys(lastHealth).length ? lastHealth : (healthState || {}),
      providerConfig,
    };
  });
  const selectedCandidate = providerCandidates.find((candidate) => candidate.provider === configuredSelected) || providerCandidates[0];
  const activeCandidate = selectedCandidate?.reachable
    ? selectedCandidate
    : providerCandidates.find((candidate) => candidate.reachable)
    || selectedCandidate
    || {
      provider: configuredSelected,
      workerUrl: '',
      enabled: false,
      reachable: false,
      lastProbe: {},
      providerConfig: {},
    };
  const reachable = activeCandidate.reachable === true;
  const providerSwitchApplied = activeCandidate.provider !== configuredSelected && reachable;
  const providerSelectionReason = providerSwitchApplied
    ? 'backend-stale-selected-provider-unusable-switched-to-hosted-alternative'
    : (reachable ? 'selected-hosted-provider-usable' : 'no-hosted-provider-usable');
  return {
    selected: configuredSelected,
    activeProvider: activeCandidate.provider,
    workerUrl: activeCandidate.workerUrl,
    enabled: activeCandidate.enabled === true,
    reachable,
    usable: reachable,
    providerSwitchApplied,
    providerSelectionReason,
    providerKind: reachable ? 'hosted-cloud-worker' : 'backend-provider',
    lastProbe: activeCandidate.lastProbe || {},
    providerCandidates: providerCandidates.map((candidate) => ({
      provider: candidate.provider,
      enabled: candidate.enabled === true,
      reachable: candidate.reachable === true,
      usable: candidate.reachable === true,
      workerUrl: candidate.workerUrl,
    })),
  };
}

function resolveHostedConfiguredProvider(runtimeContext = {}, fallbackProvider = '') {
  const hostedCloudConfig = asObject(runtimeContext.hostedCloudConfig);
  const configured = String(hostedCloudConfig.selectedProvider || '').trim().toLowerCase();
  if (['groq', 'gemini'].includes(configured)) {
    return configured;
  }
  const fallback = String(fallbackProvider || '').trim().toLowerCase();
  return ['groq', 'gemini'].includes(fallback) ? fallback : '';
}

function isRouteQualifiedHostedLocalOllamaExecution({
  executableProviderCandidate = '',
  selectedProvider = '',
  requestedProvider = '',
  runtimeContext = {},
  finalRouteTruth = {},
  selectedEvaluation = {},
} = {}) {
  if (String(executableProviderCandidate || '').trim().toLowerCase() !== 'ollama') return false;
  if (String(selectedProvider || '').trim().toLowerCase() !== 'ollama') return false;
  if (String(requestedProvider || '').trim().toLowerCase() !== 'ollama') return false;

  const context = asObject(runtimeContext);
  const providerIntent = asObject(context.providerExecutionIntent);
  const routeTruth = asObject(finalRouteTruth);
  const routeEval = asObject(selectedEvaluation);
  const tailscaleTruth = asObject(asObject(context.bridgeTransportTruth).tailscale);
  const freshnessNeed = String(
    providerIntent.freshnessNeed
    || context.freshnessNeed
    || '',
  ).trim().toLowerCase();
  const answerMode = String(
    providerIntent.answerMode
    || context.selectedAnswerMode
    || '',
  ).trim().toLowerCase();
  const requestedProviderForRequest = String(
    providerIntent.requestedProviderForRequest
    || requestedProvider
    || '',
  ).trim().toLowerCase();
  const intentSelectedProvider = String(
    providerIntent.selectedProvider
    || selectedProvider
    || '',
  ).trim().toLowerCase();
  const routeReachable = routeTruth.selectedRouteReachable === true || routeEval.available === true;
  const routeUsable = routeTruth.routeUsable === true || routeEval.usable === true;
  const routeBlocked = Boolean(routeEval.blockedReason || routeTruth.selectedRouteBlocked);

  return context.sessionKind === 'hosted-web'
    && String(routeTruth.routeKind || '').trim() === 'home-node'
    && routeReachable
    && routeUsable
    && !routeBlocked
    && tailscaleTruth.accepted === true
    && tailscaleTruth.reachable === true
    && tailscaleTruth.usable === true
    && freshnessNeed === 'low'
    && answerMode === 'local-private'
    && requestedProviderForRequest === 'ollama'
    && intentSelectedProvider === 'ollama';
}

function isLiveCloudProvider(providerKey = '') {
  const provider = String(providerKey || '').trim().toLowerCase();
  if (!provider) return false;
  return !['none', 'n/a', 'unknown', 'mock', 'ollama'].includes(provider);
}

function isHostedExecutionContractMismatch({
  runtimeTruth = {},
  selectedProvider = '',
  activeProviderTruth = '',
  executableProviderValidated = false,
  providerHealth = {},
} = {}) {
  if (executableProviderValidated) return false;
  if (!selectedProvider || !activeProviderTruth || activeProviderTruth !== selectedProvider) return false;
  if (runtimeTruth.session?.sessionKind !== 'hosted-web') return false;
  if (runtimeTruth.reachabilityTruth?.backendReachable !== true) return false;
  if (runtimeTruth.reachabilityTruth?.selectedRouteUsable !== true) return false;
  if (providerHealthStateFor(selectedProvider, providerHealth) !== 'unknown') return false;
  return true;
}

function createIssue(code, severity, category, message, details = {}) {
  return {
    code,
    severity,
    category,
    message,
    likelyCause: details.likelyCause || '',
    suggestedAction: details.suggestedAction || '',
    details,
  };
}

function normalizeMemoryTruth(memoryTruth = {}) {
  const source = asObject(memoryTruth);
  const hydrationCompleted = source.hydrationCompleted === true;
  const sourceUsedOnLoad = String(source.sourceUsedOnLoad || source.hydrationSource || 'unknown');
  const writeTarget = String(source.writeTarget || source.lastSaveSource || 'unknown');
  const fallbackReason = String(source.fallbackReason || (hydrationCompleted ? '' : 'not-hydrated'));
  const degraded = source.degraded === true || (!hydrationCompleted && sourceUsedOnLoad !== 'shared-backend');

  return {
    hydrationCompleted,
    hydrationState: String(source.hydrationState || (hydrationCompleted ? 'ready' : 'hydrating')),
    sourceUsedOnLoad,
    writeTarget,
    durabilityClass: String(source.stateClass || 'runtime-session'),
    fallbackReason,
    degraded,
    recordCount: Number.isFinite(Number(source.recordCount)) ? Number(source.recordCount) : -1,
  };
}

function normalizeTileTruth(tileTruth = {}) {
  const source = asObject(tileTruth);
  const ready = source.ready === true || source.executionReady === true;
  return {
    ready,
    reason: String(source.reason || source.blockedReason || ''),
    degraded: source.degraded === true || !ready,
    launchSurface: String(source.launchSurface || source.surface || 'unknown'),
  };
}

function projectLegacyRuntimeTruth(runtimeTruth) {
  return {
    ...runtimeTruth,
    sessionKind: runtimeTruth.session.sessionKind,
    deviceContext: runtimeTruth.session.deviceContext,
    requestedRouteMode: runtimeTruth.route.requestedMode,
    effectiveRouteMode: runtimeTruth.route.effectiveMode,
    preferredRoute: runtimeTruth.route.selectedRouteKind,
    selectedRoute: runtimeTruth.route.selectedRouteKind,
    winnerReason: runtimeTruth.route.winningReason,
    preferredTarget: runtimeTruth.route.preferredTarget,
    actualTarget: runtimeTruth.route.actualTarget,
    source: runtimeTruth.route.source,
    backendReachable: runtimeTruth.reachabilityTruth.backendReachable,
    networkReachabilityState: runtimeTruth.reachabilityTruth.networkReachabilityState,
    browserDirectAccessState: runtimeTruth.reachabilityTruth.browserDirectAccessState,
    transportCompatibilityLayer: runtimeTruth.reachabilityTruth.transportCompatibilityLayer,
    uiReachabilityState: runtimeTruth.reachabilityTruth.uiReachableState,
    routeUsable: runtimeTruth.reachabilityTruth.selectedRouteUsable,
    cloudRouteReachable: runtimeTruth.reachabilityTruth.cloudAvailable,
    fallbackActive: runtimeTruth.route.fallbackActive,
    requestedProvider: runtimeTruth.provider.requestedProvider,
    selectedProvider: runtimeTruth.provider.selectedProvider,
    executedProvider: runtimeTruth.provider.executableProvider,
    fastResponseLaneEligible: runtimeTruth.provider.fastResponseLaneEligible === true,
    fastResponseLaneActive: runtimeTruth.provider.fastResponseLaneActive === true,
    fastResponseLaneReason: runtimeTruth.provider.fastResponseLaneReason || '',
    fastResponseModel: runtimeTruth.provider.fastResponseModel || '',
    escalationModel: runtimeTruth.provider.escalationModel || '',
    escalationReason: runtimeTruth.provider.escalationReason || '',
    validationState: runtimeTruth.diagnostics.validationState,
    appLaunchState: runtimeTruth.diagnostics.appLaunchState,
    operatorAction: runtimeTruth.diagnostics.operatorGuidance[0] || '',
    memory: runtimeTruth.memory,
    tile: runtimeTruth.tile,
  };
}

function projectFinalRouteTruthFromCanonical(canonicalRouteRuntimeTruth, baseFinalRouteTruth = {}, runtimeTruth = {}) {
  const canonical = asObject(canonicalRouteRuntimeTruth);
  const base = asObject(baseFinalRouteTruth);
  const route = asObject(runtimeTruth.route);
  const reachabilityTruth = asObject(runtimeTruth.reachabilityTruth);
  const provider = asObject(runtimeTruth.provider);
  const diagnostics = asObject(runtimeTruth.diagnostics);

  // Derived-only compatibility projection:
  // finalRouteTruth output shape is preserved, but values are sourced from canonicalRouteRuntimeTruth.
  return {
    ...base,
    sessionKind: canonical.sessionKind || base.sessionKind || 'unknown',
    deviceContext: canonical.deviceContext || base.deviceContext || 'unknown',
    requestedRouteMode: canonical.requestedRouteMode || base.requestedRouteMode || 'auto',
    effectiveRouteMode: canonical.effectiveRouteMode || base.effectiveRouteMode || 'auto',
    routeKind: canonical.winningRoute || base.routeKind || 'unavailable',
    preferredRoute: canonical.winningRoute || base.preferredRoute || 'unavailable',
    winningRoute: canonical.winningRoute || base.winningRoute || 'unavailable',
    winnerReason: canonical.winningReason || base.winnerReason || '',
    selectedRouteReason: canonical.winningReason || base.selectedRouteReason || '',
    preferredTarget: canonical.preferredTarget || base.preferredTarget || '',
    preferredTargetUsed: canonical.preferredTarget || base.preferredTargetUsed || '',
    actualTarget: canonical.actualTarget || base.actualTarget || '',
    actualTargetUsed: canonical.actualTarget || base.actualTargetUsed || '',
    source: canonical.routeSource || base.source || 'route-diagnostics',
    backendReachable: canonical.backendReachable === true,
    networkReachabilityState: canonical.networkReachabilityState || base.networkReachabilityState || 'unknown',
    browserDirectAccessState: canonical.browserDirectAccessState || base.browserDirectAccessState || 'unknown',
    transportCompatibilityLayer: canonical.transportCompatibilityLayer || base.transportCompatibilityLayer || 'not-required',
    uiReachabilityState: canonical.uiReachabilityState || base.uiReachabilityState || 'unknown',
    uiReachable: canonical.uiReachable === true,
    selectedRouteReachable: canonical.routeReachable === true,
    routeUsable: canonical.routeUsable === true,
    selectedRouteUsable: canonical.routeUsable === true,
    homeNodeUsable: canonical.homeNodeAvailable === true,
    localRouteUsable: canonical.localAvailable === true,
    cloudRouteReachable: canonical.cloudAvailable === true,
    fallbackActive: canonical.fallbackActive === true,
    fallbackRouteActive: (canonical.winningRoute || base.routeKind) === 'dist',
    requestedProvider: canonical.requestedProvider || base.requestedProvider || 'unknown',
    selectedProvider: canonical.selectedProvider || base.selectedProvider || 'unknown',
    executedProvider: canonical.executedProvider || base.executedProvider || '',
    providerConfigured: canonical.providerConfigured === true,
    executableViaBackend: canonical.executableViaBackend === true,
    executableViaHostedCloud: canonical.executableViaHostedCloud === true,
    actualProviderPath: canonical.actualProviderPath || 'none',
    providerAuthorityLevel: canonical.providerAuthorityLevel || 'none',
    battleBridgeAuthorityAvailable: canonical.battleBridgeAuthorityAvailable === true,
    cloudCognitionAvailable: canonical.cloudCognitionAvailable === true,
    hostedCloudPathAvailable: canonical.hostedCloudPathAvailable === true,
    hostedCloudSecretPathKind: canonical.hostedCloudSecretPathKind || 'none',
    caravanMode: canonical.caravanMode || null,
    caravanModeActive: canonical.caravanModeActive === true,
    canonCommitAllowed: canonical.canonCommitAllowed === true,
    promotionDeferred: canonical.promotionDeferred === true,
    providerHealthState: canonical.providerHealthState || base.providerHealthState || 'unknown',
    fallbackReason: canonical.fallbackReason || provider.fallbackReason || base.fallbackReason || '',
    fastResponseLaneEligible: canonical.fastResponseLaneEligible === true,
    fastResponseLaneActive: canonical.fastResponseLaneActive === true,
    fastResponseLaneReason: canonical.fastResponseLaneReason || '',
    fastResponseModel: canonical.fastResponseModel || '',
    escalationModel: canonical.escalationModel || '',
    escalationReason: canonical.escalationReason || '',
    validationState: canonical.validationState || diagnostics.validationState || base.validationState || 'unknown',
    appLaunchState: canonical.appLaunchState || diagnostics.appLaunchState || base.appLaunchState || 'unknown',
    operatorAction: canonical.operatorSummary || base.operatorAction || route.winningReason || '',
    operatorGuidance: diagnostics.operatorGuidance || base.operatorGuidance || [],
    providerExecution: {
      requestedProvider: canonical.requestedProvider || provider.requestedProvider || '',
      selectedProvider: canonical.selectedProvider || provider.selectedProvider || '',
      executableProvider: canonical.executedProvider || provider.executableProvider || '',
      providerHealthState: canonical.providerHealthState || provider.providerHealthState || 'unknown',
      fallbackProviderUsed: provider.fallbackProviderUsed === true || canonical.fallbackActive === true,
      fallbackReason: canonical.fallbackReason || provider.fallbackReason || '',
      fastResponseLaneEligible: canonical.fastResponseLaneEligible === true,
      fastResponseLaneActive: canonical.fastResponseLaneActive === true,
      fastResponseLaneReason: canonical.fastResponseLaneReason || '',
      fastResponseModel: canonical.fastResponseModel || '',
      escalationModel: canonical.escalationModel || '',
      escalationReason: canonical.escalationReason || '',
    },
    blockingIssueCodes: Array.isArray(canonical.blockingIssueCodes) ? canonical.blockingIssueCodes : [],
  };
}

function buildCanonicalRouteRuntimeTruth(runtimeTruth, issues = []) {
  const session = asObject(runtimeTruth.session);
  const route = asObject(runtimeTruth.route);
  const reachabilityTruth = asObject(runtimeTruth.reachabilityTruth);
  const provider = asObject(runtimeTruth.provider);
  const diagnostics = asObject(runtimeTruth.diagnostics);
  const hostedCloudExecutionOperational = session.sessionKind === 'hosted-web'
    && route.selectedRouteKind === 'cloud'
    && reachabilityTruth.selectedRouteReachable === true
    && reachabilityTruth.backendReachable === true
    && reachabilityTruth.cloudAvailable === true
    && isLiveCloudProvider(provider.executableProvider);
  const uiReachabilityUnreachable = reachabilityTruth.uiReachableState === 'unreachable';
  const routeUsable = reachabilityTruth.selectedRouteUsable === true
    && (!uiReachabilityUnreachable || hostedCloudExecutionOperational);
  const blockingCodes = issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const fallbackReason = provider.fallbackReason
    || (route.fallbackActive ? 'Fallback route active.' : '');
  const hostedRouteTruth = asObject(runtimeTruth.hostedRouteTruth);
  const hostedBlockingCodes = Array.isArray(hostedRouteTruth.blockingIssues)
    ? hostedRouteTruth.blockingIssues.map((issue) => issue?.code).filter(Boolean)
    : [];
  const hostedCloudConfig = asObject(runtimeTruth?.session?.hostedCloudConfig || runtimeTruth?.hostedCloudConfig);
  const hostedWorker = asObject(runtimeTruth?.provider?.hostedWorker);
  const hostedSession = session.sessionKind === 'hosted-web';
  const selectedProviderNormalized = String(provider.selectedProvider || '').trim().toLowerCase();
  const activeHostedProvider = String(
    hostedWorker.activeProvider
    || hostedWorker.selected
    || selectedProviderNormalized
    || '',
  ).trim().toLowerCase();
  const cloudCognitionProvider = ['groq', 'gemini'].includes(selectedProviderNormalized);
  const activeHostedCloudProvider = ['groq', 'gemini'].includes(activeHostedProvider);
  const hostedCloudProxyConfigured = Boolean(
    hostedCloudConfig.proxyUrl
    || hostedCloudConfig?.providerProxyUrls?.[selectedProviderNormalized]
    || hostedCloudConfig?.providerProxyUrls?.[activeHostedProvider]
    || hostedWorker.workerUrl,
  );
  const hostedCloudPathAvailable = hostedSession && (cloudCognitionProvider || activeHostedCloudProvider) && hostedCloudProxyConfigured;
  const hostedWorkerExecuting = String(provider.executableProvider || '').trim().toLowerCase() === 'hosted-cloud-worker';
  const battleBridgeAuthorityAvailable = hostedWorkerExecuting
    ? false
    : reachabilityTruth.backendReachable === true;
  const executableViaHostedCloud = hostedCloudPathAvailable && (hostedWorker.usable === true || hostedWorkerExecuting);
  const executableViaBackend = !hostedWorkerExecuting && battleBridgeAuthorityAvailable && Boolean(provider.executableProvider);
  const actualProviderPath = hostedWorkerExecuting
    ? `${activeHostedProvider || selectedProviderNormalized || 'unknown'}-hosted-cloud`
    : executableViaHostedCloud && !battleBridgeAuthorityAvailable
      ? `${activeHostedProvider || selectedProviderNormalized || 'unknown'}-hosted-cloud`
      : (provider.executableProvider || '');
  const providerAuthorityLevel = hostedWorkerExecuting || (executableViaHostedCloud && !battleBridgeAuthorityAvailable)
    ? 'cloud-cognition-only'
    : executableViaBackend
      ? 'battle-bridge-authority'
      : 'none';
  const hostedCloudSecretPathKind = hostedCloudPathAvailable
    ? 'hosted-proxy'
    : hostedCloudConfig.backendOnlySecrets === true
      ? 'backend-only'
      : 'none';
  const hostedWorkerHealth = hostedWorker.reachable === true
    ? 'healthy'
    : hostedWorker.enabled === true
      ? 'unhealthy'
      : 'disabled';
  const caravanMode = deriveCanonicalCaravanMode({
    sessionKind: session.sessionKind || 'unknown',
    localAuthorityAvailable: battleBridgeAuthorityAvailable,
    hostedCognitionConfigured: hostedWorker.enabled === true && Boolean(hostedWorker.workerUrl),
    hostedCognitionAvailable: hostedCloudPathAvailable || hostedWorker.enabled === true,
    hostedCognitionExecutable: executableViaHostedCloud || hostedWorker.usable === true,
    hostedWorkerProvider: hostedWorker.activeProvider || activeHostedProvider || selectedProviderNormalized || 'none',
    hostedWorkerBaseUrl: hostedWorker.workerUrl || '',
    hostedWorkerHealth,
    routeUsable,
    executableProvider: provider.executableProvider || '',
  });

  return {
    sessionKind: session.sessionKind || 'unknown',
    sessionReality: session.nonLocalSession ? 'non-local' : 'local-desktop',
    deviceContext: session.deviceContext || 'unknown',
    requestedRouteMode: route.requestedMode || 'auto',
    effectiveRouteMode: route.effectiveMode || 'auto',
    winningRoute: route.selectedRouteKind || 'unavailable',
    winningReason: route.winningReason || '',
    routeSource: route.source || 'route-diagnostics',
    preferredTarget: route.preferredTarget || '',
    actualTarget: route.actualTarget || '',
    backendReachable: reachabilityTruth.backendReachable === true,
    networkReachabilityState: reachabilityTruth.networkReachabilityState || (reachabilityTruth.backendReachable === true ? 'reachable' : 'unreachable'),
    browserDirectAccessState: reachabilityTruth.browserDirectAccessState || (session.sessionKind === 'hosted-web' ? 'unknown' : 'compatible'),
    transportCompatibilityLayer: reachabilityTruth.transportCompatibilityLayer || 'not-required',
    uiReachabilityState: reachabilityTruth.uiReachableState || 'unknown',
    uiReachable: reachabilityTruth.uiReachable === true,
    routeReachable: reachabilityTruth.selectedRouteReachable === true,
    routeUsable,
    localAvailable: reachabilityTruth.localAvailable === true,
    homeNodeAvailable: reachabilityTruth.homeNodeAvailable === true,
    cloudAvailable: reachabilityTruth.cloudAvailable === true || executableViaHostedCloud || hostedWorker.usable === true,
    distAvailable: reachabilityTruth.distAvailable === true,
    requestedProvider: provider.requestedProvider || 'unknown',
    selectedProvider: provider.selectedProvider || 'unknown',
    executedProvider: provider.executableProvider || '',
    actualProviderUsed: provider.actualProviderUsed || provider.executableProvider || '',
    providerKind: provider.providerKind || 'backend-provider',
    providerConfigured: provider.selectedProvider && provider.selectedProvider !== 'unknown',
    executableViaBackend,
    executableViaHostedCloud,
    actualProviderPath: actualProviderPath || 'none',
    providerAuthorityLevel,
    battleBridgeAuthorityAvailable,
    cloudCognitionAvailable: reachabilityTruth.cloudAvailable === true || executableViaHostedCloud || hostedWorker.usable === true,
    hostedCloudPathAvailable,
    hostedCloudSecretPathKind,
    hostedWorkerUrl: hostedWorker.workerUrl || '',
    hostedWorkerEnabled: hostedWorker.enabled === true,
    hostedWorkerReachable: hostedWorker.reachable === true,
    hostedWorkerUsable: hostedWorker.usable === true,
    hostedWorkerLastProbeResult: hostedWorker.lastProbe || {},
    caravanMode,
    caravanModeActive: caravanMode.isActive === true,
    canonCommitAllowed: caravanMode.canonCommitAllowed === true,
    promotionDeferred: caravanMode.promotionDeferred === true,
    providerHealthState: provider.providerHealthState || 'unknown',
    fallbackActive: route.fallbackActive === true || provider.fallbackProviderUsed === true,
    fallbackReason,
    fastResponseLaneEligible: provider.fastResponseLaneEligible === true,
    fastResponseLaneActive: provider.fastResponseLaneActive === true,
    fastResponseLaneReason: provider.fastResponseLaneReason || '',
    fastResponseModel: provider.fastResponseModel || '',
    escalationModel: provider.escalationModel || '',
    escalationReason: provider.escalationReason || '',
    validationState: diagnostics.validationState || 'unknown',
    appLaunchState: diagnostics.appLaunchState || 'unknown',
    blockingIssueCodes: [...new Set([...blockingCodes, ...hostedBlockingCodes])],
    operatorSummary: diagnostics.operatorGuidance?.[0] || route.winningReason || 'No operator action required.',
    hostedRouteTruth,
  };
}

export function adjudicateRuntimeTruth({
  runtimeContext = {},
  finalRoute = {},
  finalRouteTruth = {},
  routePlan = {},
  routeEvaluations = {},
  routePreferenceOrder = [],
  selectedProvider = '',
  routeSelectedProvider = '',
  activeProvider = '',
  providerHealth = {},
  fallbackActive = false,
  validationState = 'healthy',
  appLaunchState = 'ready',
  guardrails = {},
} = {}) {
  const context = asObject(runtimeContext);
  const final = asObject(finalRoute);
  const truth = asObject(finalRouteTruth);
  const evaluations = asObject(routeEvaluations);
  const selectedRouteKind = truth.routeKind || final.routeKind || 'unavailable';
  const selectedEvaluation = asObject(evaluations[selectedRouteKind]);
  const requestedProvider = truth.requestedProvider || routePlan.requestedProvider || selectedProvider || 'unknown';
  const selectedProviderTruthFromRoute = truth.selectedProvider || routeSelectedProvider || routePlan.selectedProvider || requestedProvider;
  const hostedConfiguredProvider = resolveHostedConfiguredProvider(context, selectedProviderTruthFromRoute);
  const selectedProviderTruth = context.sessionKind === 'hosted-web' && hostedConfiguredProvider
    ? hostedConfiguredProvider
    : selectedProviderTruthFromRoute;
  const activeProviderTruthFromRoute = truth.executedProvider || activeProvider || '';
  const selectedProviderHealth = asObject(providerHealth)[selectedProviderTruth];
  const hostedWorkerExecution = resolveHostedWorkerExecution(context, providerHealth, selectedProviderTruth);
  const activeProviderTruth = hostedWorkerExecution.providerSwitchApplied === true
    ? `${hostedWorkerExecution.activeProvider || hostedWorkerExecution.selected || selectedProviderTruth}-hosted-cloud`
    : activeProviderTruthFromRoute;
  const executableProviderCandidate = activeProviderTruth || selectedProviderTruth;
  const routeQualifiedHostedLocalOllama = isRouteQualifiedHostedLocalOllamaExecution({
    executableProviderCandidate,
    selectedProvider: selectedProviderTruth,
    requestedProvider,
    runtimeContext: context,
    finalRouteTruth: truth,
    selectedEvaluation,
  });
  const executableProviderValidated = isSelectedProviderHealthy(executableProviderCandidate, providerHealth)
    || routeQualifiedHostedLocalOllama;
  const hostedWorkerPromoted = hostedWorkerExecution.usable
    && (
      context.sessionKind === 'hosted-web'
      || String(truth.routeKind || '').trim() === 'cloud'
    )
    && (
      truth.backendReachable !== true
      || !executableProviderValidated
    );
  const executableProvider = hostedWorkerPromoted
    ? 'hosted-cloud-worker'
    : (executableProviderValidated ? executableProviderCandidate : '');
  const fallbackProviderUsed = Boolean(
    executableProvider
    && selectedProviderTruth
    && executableProvider !== selectedProviderTruth,
  );
  const memoryTruth = normalizeMemoryTruth(context.memoryTruth);
  const tileTruth = normalizeTileTruth(context.tileTruth);
  const hostedExecutionContractMismatch = isHostedExecutionContractMismatch({
    runtimeTruth: {
      session: { sessionKind: truth.sessionKind || context.sessionKind || 'unknown' },
      reachabilityTruth: {
        backendReachable: truth.backendReachable === true,
        selectedRouteUsable: truth.routeUsable === true || selectedEvaluation.usable === true,
      },
    },
    selectedProvider: selectedProviderTruth,
    activeProviderTruth,
    executableProviderValidated,
    providerHealth,
  });
  const fallbackReason = fallbackProviderUsed
    ? `Selected ${selectedProviderTruth}, executed ${executableProvider}.`
    : hostedExecutionContractMismatch
      ? 'Hosted route is usable, but backend execution contract metadata is stale or missing for provider adjudication.'
    : (truth.fallbackActive === true || fallbackActive === true)
      ? 'Fallback route active.'
      : '';

  const runtimeTruth = {
    session: {
      sessionKind: truth.sessionKind || context.sessionKind || 'unknown',
      deviceContext: truth.deviceContext || context.deviceContext || 'unknown',
      localEligible: (truth.sessionKind || context.sessionKind) === 'local-desktop',
      hostedSession: (truth.sessionKind || context.sessionKind) === 'hosted-web',
      nonLocalSession: (truth.sessionKind || context.sessionKind) !== 'local-desktop',
      hostedCloudConfig: asObject(context.hostedCloudConfig),
    },
    route: {
      requestedMode: truth.requestedRouteMode || routePlan.requestedRouteMode || 'auto',
      effectiveMode: truth.effectiveRouteMode || routePlan.effectiveRouteMode || 'auto',
      candidates: Object.keys(evaluations),
      selectedRouteKind,
      preferredTarget: truth.preferredTarget || final.preferredTarget || '',
      actualTarget: truth.actualTarget || final.actualTarget || '',
      source: truth.source || final.source || context.nodeAddressSource || 'route-diagnostics',
      winningReason: truth.winnerReason || final.winnerReason || selectedEvaluation.reason || '',
      fallbackActive: truth.fallbackActive === true || fallbackActive === true,
    },
    reachabilityTruth: {
      backendReachable: truth.backendReachable === true,
      networkReachabilityState: String(truth.networkReachabilityState || (truth.backendReachable === true ? 'reachable' : 'unreachable')),
      browserDirectAccessState: String(truth.browserDirectAccessState || ((truth.sessionKind || context.sessionKind) === 'hosted-web' ? 'unknown' : 'compatible')),
      transportCompatibilityLayer: String(truth.transportCompatibilityLayer || 'not-required'),
      uiReachableState: truth.uiReachabilityState || 'unknown',
      uiReachable: asTriStateBoolean(truth.uiReachabilityState || 'unknown'),
      selectedRouteReachable: selectedEvaluation.available === true,
      selectedRouteUsable: truth.routeUsable === true || selectedEvaluation.usable === true,
      localAvailable: Boolean(routePlan.localAvailable),
      homeNodeAvailable: asObject(evaluations['home-node']).available === true,
      cloudAvailable: Boolean(routePlan.cloudAvailable),
      distAvailable: asObject(evaluations.dist).available === true,
    },
    provider: {
      requestedProvider,
      selectedProvider: selectedProviderTruth,
      executableProvider,
      validatedProvider: executableProviderValidated ? executableProviderCandidate : '',
      actualProviderUsed: hostedWorkerPromoted
        ? `${hostedWorkerExecution.activeProvider || hostedWorkerExecution.selected || 'unknown'}-hosted-cloud`
        : (activeProviderTruth || executableProvider || ''),
      providerKind: hostedWorkerExecution.providerKind,
      hostedWorker: hostedWorkerExecution,
      providerSelectionReason: hostedWorkerPromoted
        ? hostedWorkerExecution.providerSelectionReason
        : '',
      providerHealthState: providerHealthStateFor(selectedProviderTruth, providerHealth),
      providerReason: String(
        selectedProviderHealth?.reason
        || selectedProviderHealth?.detail
        || selectedProviderHealth?.message
        || '',
      ),
      fastResponseLaneEligible: context.providerExecutionIntent?.fastResponseLaneEligible === true,
      fastResponseLaneActive: context.providerExecutionIntent?.fastResponseLaneActive === true,
      fastResponseLaneReason: String(context.providerExecutionIntent?.fastResponseLaneReason || ''),
      fastResponseModel: String(context.providerExecutionIntent?.fastResponseModel || ''),
      escalationModel: String(context.providerExecutionIntent?.escalationModel || ''),
      escalationReason: String(context.providerExecutionIntent?.escalationReason || ''),
      fallbackProviderUsed,
      fallbackReason,
    },
    memory: memoryTruth,
    tile: tileTruth,
    diagnostics: {
      invariantWarnings: [],
      blockingIssues: [],
      operatorGuidance: [],
      validationState,
      appLaunchState,
    },
    reachabilityRaw: final.reachability || {},
    providerEligibility: final.providerEligibility || {},
    routeEvaluations: evaluations,
    routePreferenceOrder: Array.isArray(routePreferenceOrder) ? routePreferenceOrder : [],
    computedFromPersistence: false,
    hostedRouteTruth: asObject(context.canonicalHostedRouteTruth),
    hostedCloudConfig: asObject(context.hostedCloudConfig),
  };

  const issues = [];
  const actualTargetHost = extractHostname(runtimeTruth.route.actualTarget);
  const isNonLocal = runtimeTruth.session.nonLocalSession;
  if (isNonLocal && isLoopbackHost(actualTargetHost)) {
    issues.push(createIssue(
      'non-local-loopback-target',
      'error',
      'session-route',
      'Hosted/non-local session resolved to a loopback actual target.',
      {
        likelyCause: 'Persisted local localhost route leaked into non-local session classification.',
        suggestedAction: 'Recompute runtime truth and drop loopback candidates for non-local sessions.',
        sessionKind: runtimeTruth.session.sessionKind,
        actualTarget: runtimeTruth.route.actualTarget,
      },
    ));
  }

  if (isNonLocal && runtimeTruth.route.selectedRouteKind === 'local-desktop') {
    issues.push(createIssue(
      'non-local-local-desktop-route',
      'error',
      'session-route',
      'Non-local session selected local-desktop route.',
      {
        likelyCause: 'Session classification drift or candidate poisoning from persisted local state.',
        suggestedAction: 'Block local-desktop candidate when sessionKind is non-local.',
      },
    ));
  }

  if (runtimeTruth.reachabilityTruth.backendReachable === runtimeTruth.reachabilityTruth.uiReachable
    && runtimeTruth.reachabilityTruth.uiReachable !== null
    && selectedEvaluation.uiReachable == null) {
    issues.push(createIssue(
      'backend-ui-reachability-coupled',
      'warning',
      'reachability',
      'Backend and UI reachability appear implicitly coupled without explicit UI probe data.',
      {
        likelyCause: 'UI reachability truth may be inferred instead of measured.',
        suggestedAction: 'Keep backendReachable and uiReachable as independent adjudicated signals.',
      },
    ));
  }

  if (runtimeTruth.provider.selectedProvider
    && activeProviderTruth === runtimeTruth.provider.selectedProvider
    && executableProviderCandidate === runtimeTruth.provider.selectedProvider
    && executableProviderValidated !== true
    && !routeQualifiedHostedLocalOllama) {
    issues.push(createIssue(
      'provider-execution-unvalidated',
      'error',
      'provider',
      'Selected provider is presented as executable before validation passed.',
      {
        likelyCause: 'Provider stage collapse between selection and executable validation.',
        suggestedAction: 'Only promote selectedProvider to executableProvider when providerHealth.ok is true.',
      },
    ));
  }

  if (hostedExecutionContractMismatch) {
    issues.push(createIssue(
      'backend-execution-contract-mismatch',
      'error',
      'provider',
      'Hosted route truth is usable, but backend/provider execution contract is stale or incomplete.',
      {
        likelyCause: 'Frontend/runtime expects provider health/execution metadata that older Battle Bridge builds do not emit.',
        suggestedAction: 'Rebuild/restart Battle Bridge so provider execution metadata and dispatch contract match hosted runtime expectations.',
      },
    ));
  }

  if (runtimeTruth.reachabilityTruth.distAvailable
    && runtimeTruth.route.selectedRouteKind === 'dist'
    && (runtimeTruth.reachabilityTruth.backendReachable || runtimeTruth.reachabilityTruth.cloudAvailable)
    && !runtimeTruth.route.fallbackActive) {
    issues.push(createIssue(
      'dist-without-fallback-flag',
      'warning',
      'route-fallback',
      'Dist route is active without explicit fallbackActive flag.',
      {
        likelyCause: 'Dist availability may have been treated as primary route readiness.',
        suggestedAction: 'Flag dist runtime as fallback and keep backend/cloud readiness distinct.',
      },
    ));
  }

  if (!memoryTruth.hydrationCompleted && memoryTruth.writeTarget === 'shared-backend') {
    issues.push(createIssue(
      'memory-write-before-hydration',
      'error',
      'memory',
      'Shared memory write target was selected before hydration completed.',
      {
        likelyCause: 'Memory writes were enabled during pre-hydration runtime startup.',
        suggestedAction: 'Block durable writes until hydrationCompleted is true.',
        hydrationCompleted: memoryTruth.hydrationCompleted,
        writeTarget: memoryTruth.writeTarget,
      },
    ));
  }

  for (const hostedIssue of runtimeTruth.hostedRouteTruth.blockingIssues || []) {
    issues.push(createIssue(
      hostedIssue.code || 'hosted-route-blocked',
      'error',
      'session-route',
      hostedIssue.message || 'Hosted route is blocked.',
      {
        suggestedAction: 'Resolve hosted backend/home-node route truth before relaunch.',
      },
    ));
  }

  const hostedCloudCanonicalReady = runtimeTruth.session.sessionKind === 'hosted-web'
    && runtimeTruth.route.selectedRouteKind === 'cloud'
    && runtimeTruth.diagnostics.appLaunchState === 'ready'
    && runtimeTruth.route.fallbackActive !== true
    && runtimeTruth.reachabilityTruth.selectedRouteReachable === true
    && runtimeTruth.reachabilityTruth.selectedRouteUsable === true
    && runtimeTruth.reachabilityTruth.backendReachable === true
    && runtimeTruth.reachabilityTruth.cloudAvailable === true
    && isLiveCloudProvider(runtimeTruth.provider.executableProvider);

  if (!tileTruth.ready && runtimeTruth.diagnostics.appLaunchState === 'ready' && !hostedCloudCanonicalReady) {
    const tileBlocker = tileTruth.reason
      ? `Tile execution blocker: ${tileTruth.reason}.`
      : 'Tile execution blocker: readiness signal is false.';
    const tileSurface = tileTruth.launchSurface && tileTruth.launchSurface !== 'unknown'
      ? ` Launch surface: ${tileTruth.launchSurface}.`
      : '';
    issues.push(createIssue(
      'tile-not-ready-while-runtime-ready',
      'warning',
      'tile-runtime',
      'Runtime reports ready while tile execution readiness is false.',
      {
        likelyCause: 'Tile substrate did not hydrate or interactive surface wiring is incomplete.',
        suggestedAction: `${tileBlocker}${tileSurface} Gate launch state until these blockers are resolved.`,
        tileReason: tileTruth.reason,
        tileLaunchSurface: tileTruth.launchSurface,
      },
    ));
  }

  const guardrailIssues = [
    ...(asObject(guardrails).errors || []),
    ...(asObject(guardrails).warnings || []),
  ].map((invariant) => createIssue(
    invariant.id || 'guardrail-invariant',
    invariant.severity === 'error' ? 'error' : 'warning',
    'guardrail',
    invariant.message || 'Runtime guardrail invariant triggered.',
    invariant.details || {},
  ));
  issues.push(...guardrailIssues);

  for (const issue of issues) {
    if (issue.severity === 'error') {
      runtimeTruth.diagnostics.blockingIssues.push(issue);
    } else {
      runtimeTruth.diagnostics.invariantWarnings.push(issue);
    }
    if (issue.suggestedAction) {
      runtimeTruth.diagnostics.operatorGuidance.push(issue.suggestedAction);
    }
  }

  const canonicalRouteRuntimeTruth = buildCanonicalRouteRuntimeTruth(runtimeTruth, issues);
  const cognitiveAdjudication = buildSystemWatcherModel({
    runtimeTruth,
    canonicalRouteRuntimeTruth,
    runtimeContext,
  });

  const derivedFinalRouteTruth = projectFinalRouteTruthFromCanonical(
    canonicalRouteRuntimeTruth,
    finalRouteTruth,
    runtimeTruth,
  );

  return {
    // Canonical source of runtime route/provider/session truth.
    canonicalRouteRuntimeTruth,
    // Derived-only compatibility projection (legacy grouped + flat fields).
    runtimeTruth: projectLegacyRuntimeTruth(runtimeTruth),
    // Derived-only compatibility projection preserving finalRouteTruth shape.
    finalRouteTruth: derivedFinalRouteTruth,
    runtimeTruthSnapshot: canonicalRouteRuntimeTruth,
    compatibilityRuntimeTruthSnapshot: buildRuntimeTruthSnapshot({
      runtimeContext,
      finalRoute,
      finalRouteTruth: derivedFinalRouteTruth,
      routePlan,
      routeEvaluations,
      routePreferenceOrder,
    }),
    cognitiveAdjudication,
    issues,
  };
}
