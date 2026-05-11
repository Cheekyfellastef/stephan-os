export function buildBridgeRevalidationAttemptedConfigKey(plan = {}, bridgeMemory = {}) {
  const normalizedPlan = plan && typeof plan === 'object' ? plan : {};
  const rememberedAt = bridgeMemory && typeof bridgeMemory === 'object'
    ? String(bridgeMemory.rememberedAt || '').trim()
    : '';
  return [
    String(normalizedPlan.transport || 'none').trim() || 'none',
    String(normalizedPlan.candidateUrl || '').trim(),
    String(normalizedPlan.hostedExecutionCandidate || '').trim(),
    normalizedPlan.requireHttps === false ? 'http-allowed' : 'https-required',
    rememberedAt,
  ].join('::');
}

export function shouldTreatBridgeHealthProbeAsReachable(probe = {}) {
  if (!probe || probe.ok !== true || !probe.data || typeof probe.data !== 'object') {
    return false;
  }
  const service = String(probe.data.service || '').trim().toLowerCase();
  const healthState = String(probe.data.state || probe.data.status || '').trim().toLowerCase();
  const explicitOk = probe.data.ok === true;
  const hasEndpointShape = Boolean(
    probe.data.backend_target_endpoint
    || probe.data.backend_base_url
    || probe.data.published_backend_base_url
    || probe.data.default_provider,
  );
  if (service === 'stephanos-server') {
    return true;
  }
  if (explicitOk) {
    return true;
  }
  if (['ok', 'healthy', 'online', 'ready'].includes(healthState)) {
    return true;
  }
  return hasEndpointShape;
}

export function shouldSkipBridgeAutoRevalidationWhileInFlight({
  bridgeRevalidationNonce = 0,
  attemptedConfigKey = '',
  currentAttemptedConfigKey = '',
  currentState = '',
} = {}) {
  if (Number(bridgeRevalidationNonce || 0) > 0) {
    return false;
  }
  const normalizedAttemptedConfigKey = String(attemptedConfigKey || '').trim();
  if (!normalizedAttemptedConfigKey) {
    return false;
  }
  if (String(currentAttemptedConfigKey || '').trim() !== normalizedAttemptedConfigKey) {
    return false;
  }
  const normalizedState = String(currentState || '').trim().toLowerCase();
  return normalizedState === 'validating' || normalizedState === 'probing';
}
