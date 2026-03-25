// Stephanos Routing Guardrails validate already-computed runtime truth without changing
// route precedence, provider selection semantics, or live adoption behavior. The checks here
// only assert agreed invariants so regressions surface early in tests, CI, and dev diagnostics.

import { isLoopbackHost, extractHostname } from './stephanosHomeNode.mjs';

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value) {
  return value === true;
}

function createInvariant(id, severity, message, details = {}) {
  return {
    id,
    severity,
    message,
    details,
  };
}

export function deriveExpectedProviderEligibility({
  routeKind = 'unavailable',
  routeEvaluations = {},
  backendAvailable = false,
  localAvailable = false,
  cloudAvailable = false,
} = {}) {
  const selectedRoute = routeKind ? asObject(routeEvaluations)[routeKind] : null;
  const truthfulBackendRoute = routeKind === 'local-desktop' || routeKind === 'home-node';
  const fallbackOnlyRoute = routeKind === 'dist' || routeKind === 'unavailable';

  return {
    truthfulBackendRoute,
    backendMediatedProviders: truthfulBackendRoute && Boolean(backendAvailable),
    localProviders: truthfulBackendRoute && Boolean(backendAvailable) && Boolean(localAvailable),
    cloudProviders: (truthfulBackendRoute || routeKind === 'cloud') && (Boolean(backendAvailable) || routeKind === 'cloud') && Boolean(cloudAvailable),
    distFallbackOnly: routeKind === 'dist',
    mockFallbackOnly: fallbackOnlyRoute,
    selectedRouteAvailable: Boolean(selectedRoute?.available),
  };
}

export function evaluateRuntimeGuardrails(runtimeStatusModel = {}) {
  const model = asObject(runtimeStatusModel);
  const runtimeContext = asObject(model.runtimeContext);
  const finalRoute = asObject(model.finalRoute);
  const finalRouteTruth = asObject(model.finalRouteTruth);
  const runtimeContextFinalRoute = asObject(runtimeContext.finalRoute);
  const routeEvaluations = asObject(model.routeEvaluations);
  const selectedRoute = finalRoute.routeKind ? asObject(routeEvaluations)[finalRoute.routeKind] : null;
  const providerEligibility = asObject(finalRoute.providerEligibility);
  const reachability = asObject(finalRoute.reachability);
  const startupStateExplicit = model.appLaunchState === 'pending' || model.validationState === 'launching';
  const finalRoutePresent = Object.keys(finalRoute).length > 0;
  const invariants = [];

  if (!finalRoutePresent && !startupStateExplicit) {
    invariants.push(createInvariant(
      'final-route-required',
      'error',
      'finalRoute must exist unless startup/loading state is still explicit.',
      { appLaunchState: model.appLaunchState || 'unknown' },
    ));
  }

  if (finalRoutePresent) {
    if (typeof finalRoute.routeKind !== 'string' || typeof finalRoute.source !== 'string' || typeof finalRoute.preferredTarget !== 'string' || typeof finalRoute.actualTarget !== 'string') {
      invariants.push(createInvariant(
        'final-route-shape',
        'error',
        'finalRoute must keep a normalized string shape for routeKind, source, preferredTarget, and actualTarget.',
      ));
    }

    if (!finalRoute.providerEligibility || typeof finalRoute.providerEligibility !== 'object' || !finalRoute.reachability || typeof finalRoute.reachability !== 'object') {
      invariants.push(createInvariant(
        'final-route-shape-nested',
        'error',
        'finalRoute must include normalized reachability and providerEligibility objects.',
      ));
    }
  }

  if (runtimeContext.finalRoute && runtimeContext.finalRoute !== finalRoute) {
    const keysToCompare = ['routeKind', 'source', 'preferredTarget', 'actualTarget'];
    const mismatchKey = keysToCompare.find((key) => asString(runtimeContextFinalRoute[key]) !== asString(finalRoute[key]));
    if (mismatchKey) {
      invariants.push(createInvariant(
        'single-route-truth-authority',
        'error',
        'Consumers must read route truth from finalRoute instead of keeping a divergent recomputed copy.',
        { mismatchKey, runtimeContextValue: runtimeContextFinalRoute[mismatchKey], finalRouteValue: finalRoute[mismatchKey] },
      ));
    }
  }

  const topLevelRouteMismatches = [
    ['routeKind', model.routeKind, finalRoute.routeKind],
    ['preferredTarget', model.preferredTarget, finalRoute.preferredTarget],
    ['actualTargetUsed', model.actualTargetUsed, finalRoute.actualTarget],
    ['nodeAddressSource', model.nodeAddressSource, finalRoute.source],
  ].filter(([, outerValue, finalValue]) => finalRoutePresent && asString(outerValue) !== asString(finalValue));

  if (topLevelRouteMismatches.length > 0) {
    invariants.push(createInvariant(
      'single-route-truth-projection',
      'error',
      'Top-level route fields must remain a projection of finalRoute so route truth stays singular.',
      { mismatches: topLevelRouteMismatches.map(([field, outerValue, finalValue]) => ({ field, outerValue, finalValue })) },
    ));
  }

  if (Object.keys(finalRouteTruth).length > 0) {
    const truthProjectionMismatches = [
      ['routeKind', finalRouteTruth.routeKind, finalRoute.routeKind],
      ['preferredTarget', finalRouteTruth.preferredTarget, finalRoute.preferredTarget],
      ['actualTarget', finalRouteTruth.actualTarget, finalRoute.actualTarget],
      ['source', finalRouteTruth.source, finalRoute.source],
      ['requestedProvider', finalRouteTruth.requestedProvider, model.selectedProvider],
      ['selectedProvider', finalRouteTruth.selectedProvider, model.routeSelectedProvider || model.selectedProvider],
      ['executedProvider', finalRouteTruth.executedProvider, model.activeProvider],
    ].filter(([, truthValue, projectedValue]) => {
      if (truthValue === undefined || truthValue === null || truthValue === '') return false;
      return asString(truthValue) !== asString(projectedValue);
    });

    if (truthProjectionMismatches.length > 0) {
      invariants.push(createInvariant(
        'final-route-truth-projection',
        'error',
        'finalRouteTruth must stay aligned with finalRoute and provider projection fields.',
        { mismatches: truthProjectionMismatches.map(([field, truthValue, projectedValue]) => ({ field, truthValue, projectedValue })) },
      ));
    }

    if (finalRoute.routeKind === 'dist' && finalRouteTruth.fallbackRouteActive !== true) {
      invariants.push(createInvariant(
        'dist-route-must-be-fallback-active',
        'error',
        'dist route truth must always stay flagged as fallbackRouteActive.',
        { routeKind: finalRoute.routeKind, fallbackRouteActive: finalRouteTruth.fallbackRouteActive },
      ));
    }

    if (finalRouteTruth.fallbackRouteActive === true && finalRoute.routeKind !== 'dist') {
      invariants.push(createInvariant(
        'fallback-route-active-mismatch',
        'error',
        'fallbackRouteActive may only be true when finalRoute.routeKind is dist.',
        { routeKind: finalRoute.routeKind, fallbackRouteActive: finalRouteTruth.fallbackRouteActive },
      ));
    }

    if (finalRoute.routeKind === 'home-node' && finalRouteTruth.uiReachabilityState === 'unreachable' && finalRouteTruth.routeUsable === true) {
      invariants.push(createInvariant(
        'backend-only-home-node-not-usable',
        'error',
        'A backend-reachable but UI-unreachable home-node must never be marked routeUsable.',
        {
          routeKind: finalRoute.routeKind,
          uiReachabilityState: finalRouteTruth.uiReachabilityState,
          routeUsable: finalRouteTruth.routeUsable,
        },
      ));
    }
  }

  if (finalRoutePresent && finalRoute.providerEligibility) {
    const expectedEligibility = deriveExpectedProviderEligibility({
      routeKind: finalRoute.routeKind || 'unavailable',
      routeEvaluations,
      backendAvailable: model.backendAvailable,
      localAvailable: model.localAvailable,
      cloudAvailable: model.cloudAvailable,
    });
    const mismatchKeys = Object.keys(expectedEligibility).filter((key) => asBoolean(providerEligibility[key]) !== expectedEligibility[key]);
    if (mismatchKeys.length > 0) {
      invariants.push(createInvariant(
        'provider-eligibility-derived-from-final-route',
        'error',
        'providerEligibility must be derived from finalRoute and must not contradict the selected route truth.',
        {
          mismatchKeys,
          expectedEligibility,
          actualEligibility: providerEligibility,
        },
      ));
    }
  }

  const nonLocalSession = runtimeContext.sessionKind && runtimeContext.sessionKind !== 'local-desktop';
  const preferredTargetHost = extractHostname(finalRoute.preferredTarget || '');
  const actualTargetHost = extractHostname(finalRoute.actualTarget || '');
  if (nonLocalSession && (isLoopbackHost(preferredTargetHost) || isLoopbackHost(actualTargetHost))) {
    invariants.push(createInvariant(
      'loopback-contamination',
      'error',
      'Non-local sessions must never expose loopback or localhost as the client-facing route target.',
      {
        sessionKind: runtimeContext.sessionKind,
        preferredTarget: finalRoute.preferredTarget || '',
        actualTarget: finalRoute.actualTarget || '',
      },
    ));
  }

  if (finalRoute.routeKind === 'home-node' && isLoopbackHost(actualTargetHost)) {
    invariants.push(createInvariant(
      'home-node-loopback-target',
      'error',
      'home-node routes must not resolve to loopback targets.',
      { actualTarget: finalRoute.actualTarget || '' },
    ));
  }

  if (finalRoute.routeKind === 'local-desktop' && finalRoute.actualTarget && !isLoopbackHost(actualTargetHost)) {
    invariants.push(createInvariant(
      'local-desktop-non-loopback-suspicious',
      'warning',
      'local-desktop routes normally resolve to loopback targets; a non-loopback target is suspicious and should be verified.',
      { actualTarget: finalRoute.actualTarget },
    ));
  }

  const homeNodeEvaluation = asObject(routeEvaluations['home-node']);
  if (finalRoute.routeKind === 'home-node' && homeNodeEvaluation.available) {
    const evaluationTarget = asString(homeNodeEvaluation.actualTarget || homeNodeEvaluation.target || runtimeContext.homeNode?.backendUrl || '');
    const evaluationHost = extractHostname(evaluationTarget);
    if (evaluationHost && actualTargetHost && evaluationHost !== actualTargetHost) {
      invariants.push(createInvariant(
        'request-host-promotion',
        'error',
        'A successful home-node/LAN adoption must promote the successful request host into finalRoute.',
        {
          expectedTarget: evaluationTarget,
          actualTarget: finalRoute.actualTarget || '',
        },
      ));
    }
  }

  if (finalRoute.routeKind && finalRoute.routeKind !== 'unavailable' && !reachability.selectedRouteReachable) {
    invariants.push(createInvariant(
      'reachability-over-config',
      'error',
      'A route must not be reported as active unless the selected route is actually reachable.',
      {
        routeKind: finalRoute.routeKind,
        reachability,
      },
    ));
  }

  const reachableLiveRouteKinds = ['local-desktop', 'home-node', 'cloud']
    .filter((routeKind) => asObject(routeEvaluations[routeKind]).available === true);
  if ((finalRoute.routeKind === 'dist' || finalRoute.routeKind === 'unavailable') && reachableLiveRouteKinds.length > 0) {
    invariants.push(createInvariant(
      'fallback-only-discipline',
      'error',
      'Fallback-only routes must not mask a valid live backend route.',
      {
        routeKind: finalRoute.routeKind,
        reachableLiveRouteKinds,
      },
    ));
  }

  if (finalRoute.routeKind === 'dist' && providerEligibility.distFallbackOnly !== true) {
    invariants.push(createInvariant(
      'dist-fallback-only-flag',
      'error',
      'dist routes must stay marked fallback-only.',
      { providerEligibility },
    ));
  }

  return {
    ok: invariants.every((invariant) => invariant.severity !== 'error'),
    hasErrors: invariants.some((invariant) => invariant.severity === 'error'),
    hasWarnings: invariants.some((invariant) => invariant.severity === 'warning'),
    errors: invariants.filter((invariant) => invariant.severity === 'error'),
    warnings: invariants.filter((invariant) => invariant.severity === 'warning'),
    invariants,
    summary: {
      total: invariants.length,
      errors: invariants.filter((invariant) => invariant.severity === 'error').length,
      warnings: invariants.filter((invariant) => invariant.severity === 'warning').length,
    },
  };
}
