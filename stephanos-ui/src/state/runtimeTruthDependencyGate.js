function asText(value = '') {
  return String(value ?? '').trim().toLowerCase();
}

export function evaluateRuntimeTruthDependencyGate({
  routeTruthView = {},
  runtimeStatus = {},
} = {}) {
  const routeLayerHealthy = asText(routeTruthView.routeLayerStatus) === 'healthy';
  const backendContractValidated = asText(routeTruthView.backendExecutionContractStatus) === 'validated';
  const providerExecutionGateOpen = asText(routeTruthView.providerExecutionGateStatus) === 'open';
  const routeUsable = asText(routeTruthView.routeUsableState) === 'yes';

  const launchReady = asText(routeTruthView.effectiveLaunchState || runtimeStatus.appLaunchState) === 'ready';
  const gatePassed = routeLayerHealthy
    && backendContractValidated
    && providerExecutionGateOpen
    && routeUsable;

  return {
    passed: gatePassed,
    launchReady,
    rationale: gatePassed
      ? 'Runtime truth dependency satisfied from route/backend/provider execution gates.'
      : 'Runtime truth dependency waiting for route/backend/provider execution gates.',
  };
}
