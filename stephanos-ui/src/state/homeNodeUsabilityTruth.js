export function resolveUiReachabilityFromHealth(health = {}) {
  const state = String(health.data?.client_route_state || '').trim().toLowerCase();
  if (state === 'ready' || state === 'reachable' || state === 'ok') {
    return true;
  }
  if (state === 'blocked' || state === 'misconfigured' || state === 'unreachable' || state === 'error') {
    return false;
  }
  return null;
}

export function summarizeHomeNodeUsabilityTruth({ backendReachable = false, uiReachable = null, source = '' } = {}) {
  const usable = backendReachable && uiReachable === true;
  const routeReason = usable
    ? 'Home PC node is reachable from backend and UI path is confirmed usable.'
    : !backendReachable
      ? 'Home PC node backend is unreachable.'
      : uiReachable === false
        ? 'Home PC node backend is reachable, but the UI/client route is not reachable.'
        : 'Home PC node backend is reachable, but UI/client reachability is still unknown.';
  const operatorReason = usable
    ? ''
    : uiReachable === null
      ? 'Treat home-node as degraded until client/UI route reachability is confirmed.'
      : 'Fix published client route reachability before treating the home-node route as available.';

  return {
    backendReachable,
    uiReachable,
    usable,
    fallbackActive: !usable,
    routeReason,
    operatorReason,
    source,
  };
}
