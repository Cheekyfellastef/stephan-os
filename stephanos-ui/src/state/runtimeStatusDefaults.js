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
});

function normalizeArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

export function ensureRuntimeStatusModel(runtimeStatusModel) {
  const hasCandidate = runtimeStatusModel && typeof runtimeStatusModel === 'object';
  const candidate = hasCandidate
    ? runtimeStatusModel
    : {};
  const baseModel = hasCandidate ? DEFAULT_RUNTIME_STATUS_MODEL : PENDING_RUNTIME_STATUS_MODEL;
  const finalRouteCandidate = candidate.finalRoute && typeof candidate.finalRoute === 'object'
    ? candidate.finalRoute
    : {};
  const runtimeContextCandidate = candidate.runtimeContext && typeof candidate.runtimeContext === 'object'
    ? candidate.runtimeContext
    : {};
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

  const routeKind = candidate.routeKind ?? finalRoute.routeKind ?? baseModel.routeKind;
  const preferredTarget = candidate.preferredTarget ?? finalRoute.preferredTarget ?? baseModel.preferredTarget;
  const actualTargetUsed = candidate.actualTargetUsed ?? finalRoute.actualTarget ?? baseModel.actualTargetUsed;
  const nodeAddressSource = candidate.nodeAddressSource ?? finalRoute.source ?? (hasFinalRouteCandidate ? baseModel.nodeAddressSource : PENDING_RUNTIME_STATUS_MODEL.nodeAddressSource);
  const finalRouteTruth = candidate.finalRouteTruth && typeof candidate.finalRouteTruth === 'object'
    ? {
      ...PENDING_RUNTIME_STATUS_MODEL.finalRouteTruth,
      ...candidate.finalRouteTruth,
      routeKind: candidate.finalRouteTruth.routeKind || routeKind,
      preferredTarget: candidate.finalRouteTruth.preferredTarget || preferredTarget,
      actualTarget: candidate.finalRouteTruth.actualTarget || actualTargetUsed,
      source: candidate.finalRouteTruth.source || nodeAddressSource,
    }
    : {
      ...PENDING_RUNTIME_STATUS_MODEL.finalRouteTruth,
      routeKind,
      preferredRoute: candidate.preferredRoute || routeKind,
      preferredTarget,
      actualTarget: actualTargetUsed,
      source: nodeAddressSource,
    };

  return {
    ...baseModel,
    ...candidate,
    runtimeContext,
    finalRoute,
    finalRouteTruth,
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
