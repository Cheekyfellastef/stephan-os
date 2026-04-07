import { extractHostname, isLoopbackHost } from './stephanosHomeNode.mjs';
import { buildRuntimeTruthSnapshot } from './truthContract.mjs';

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

function isLiveCloudProvider(providerKey = '') {
  const provider = String(providerKey || '').trim().toLowerCase();
  if (!provider) return false;
  return !['none', 'n/a', 'unknown', 'mock', 'ollama'].includes(provider);
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
    uiReachabilityState: runtimeTruth.reachabilityTruth.uiReachableState,
    routeUsable: runtimeTruth.reachabilityTruth.selectedRouteUsable,
    cloudRouteReachable: runtimeTruth.reachabilityTruth.cloudAvailable,
    fallbackActive: runtimeTruth.route.fallbackActive,
    requestedProvider: runtimeTruth.provider.requestedProvider,
    selectedProvider: runtimeTruth.provider.selectedProvider,
    executedProvider: runtimeTruth.provider.executableProvider,
    validationState: runtimeTruth.diagnostics.validationState,
    appLaunchState: runtimeTruth.diagnostics.appLaunchState,
    operatorAction: runtimeTruth.diagnostics.operatorGuidance[0] || '',
    memory: runtimeTruth.memory,
    tile: runtimeTruth.tile,
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
  const routeUsable = reachabilityTruth.selectedRouteUsable === true
    && (reachabilityTruth.uiReachableState === 'reachable' || hostedCloudExecutionOperational);
  const blockingCodes = issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const fallbackReason = provider.fallbackReason
    || (route.fallbackActive ? 'Fallback route active.' : '');
  const hostedRouteTruth = asObject(runtimeTruth.hostedRouteTruth);
  const hostedBlockingCodes = Array.isArray(hostedRouteTruth.blockingIssues)
    ? hostedRouteTruth.blockingIssues.map((issue) => issue?.code).filter(Boolean)
    : [];

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
    uiReachabilityState: reachabilityTruth.uiReachableState || 'unknown',
    uiReachable: reachabilityTruth.uiReachable === true,
    routeReachable: reachabilityTruth.selectedRouteReachable === true,
    routeUsable,
    localAvailable: reachabilityTruth.localAvailable === true,
    homeNodeAvailable: reachabilityTruth.homeNodeAvailable === true,
    cloudAvailable: reachabilityTruth.cloudAvailable === true,
    distAvailable: reachabilityTruth.distAvailable === true,
    requestedProvider: provider.requestedProvider || 'unknown',
    selectedProvider: provider.selectedProvider || 'unknown',
    executedProvider: provider.executableProvider || '',
    providerHealthState: provider.providerHealthState || 'unknown',
    fallbackActive: route.fallbackActive === true || provider.fallbackProviderUsed === true,
    fallbackReason,
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
  const selectedProviderTruth = truth.selectedProvider || routeSelectedProvider || routePlan.selectedProvider || requestedProvider;
  const activeProviderTruth = truth.executedProvider || activeProvider || '';
  const selectedProviderHealth = asObject(providerHealth)[selectedProviderTruth];
  const executableProviderCandidate = activeProviderTruth || selectedProviderTruth;
  const executableProviderValidated = isSelectedProviderHealthy(executableProviderCandidate, providerHealth);
  const executableProvider = executableProviderValidated ? executableProviderCandidate : '';
  const fallbackProviderUsed = Boolean(
    executableProvider
    && selectedProviderTruth
    && executableProvider !== selectedProviderTruth,
  );
  const memoryTruth = normalizeMemoryTruth(context.memoryTruth);
  const tileTruth = normalizeTileTruth(context.tileTruth);
  const fallbackReason = fallbackProviderUsed
    ? `Selected ${selectedProviderTruth}, executed ${executableProvider}.`
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
      providerHealthState: providerHealthStateFor(selectedProviderTruth, providerHealth),
      providerReason: String(
        selectedProviderHealth?.reason
        || selectedProviderHealth?.detail
        || selectedProviderHealth?.message
        || '',
      ),
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
    && executableProviderValidated !== true) {
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

  return {
    runtimeTruth: projectLegacyRuntimeTruth(runtimeTruth),
    canonicalRouteRuntimeTruth,
    runtimeTruthSnapshot: canonicalRouteRuntimeTruth,
    compatibilityRuntimeTruthSnapshot: buildRuntimeTruthSnapshot({
      runtimeContext,
      finalRoute,
      finalRouteTruth,
      routePlan,
      routeEvaluations,
      routePreferenceOrder,
    }),
    issues,
  };
}
