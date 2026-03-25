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
  const selectedProviderValidated = selectedProviderHealth?.ok === true;
  const executableProvider = selectedProviderValidated
    ? selectedProviderTruth
    : (asObject(providerHealth)[activeProviderTruth]?.ok === true ? activeProviderTruth : '');

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
      selectedRouteUsable: selectedEvaluation.usable === true,
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
      fallbackProviderUsed: Boolean((truth.fallbackActive === true || fallbackActive === true) && executableProvider && executableProvider !== selectedProviderTruth),
    },
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
    && selectedProviderValidated !== true) {
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

  return {
    runtimeTruth: projectLegacyRuntimeTruth(runtimeTruth),
    runtimeTruthSnapshot: buildRuntimeTruthSnapshot({
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
