export const BACKEND_FRESHNESS_SCHEMA_VERSION = 'backend-freshness-supervisor.v1';

export const BACKEND_FRESHNESS_STATUS = Object.freeze({
  CURRENT: 'BACKEND_CURRENT',
  STALE_ROUTE_MISSING: 'BACKEND_STALE_ROUTE_MISSING',
  STALE_RESTART_REQUIRED: 'BACKEND_STALE_RESTART_REQUIRED',
  REFRESH_PROOF_PASS: 'BACKEND_REFRESH_PROOF_PASS',
  REFRESH_PROOF_FAILED: 'BACKEND_REFRESH_PROOF_FAILED',
  UNKNOWN: 'UNKNOWN',
});

const DEFAULT_REQUIRED_ROUTES = Object.freeze([
  '/api/health',
  '/api/mission-operations',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeRouteProbe(route, index = 0) {
  const statusCode = Number(route.statusCode);
  const ok = route.ok === true || (Number.isFinite(statusCode) && statusCode >= 200 && statusCode < 300);
  return {
    route: text(route.route || route.path, DEFAULT_REQUIRED_ROUTES[index] || 'unknown-route'),
    ok,
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    required: route.required !== false,
    detail: text(route.detail, ''),
  };
}

export function buildBackendFreshnessProbe(input = {}) {
  const requiredRoutes = Array.isArray(input.requiredRoutes) && input.requiredRoutes.length
    ? input.requiredRoutes.map((route) => text(route)).filter(Boolean)
    : [...DEFAULT_REQUIRED_ROUTES];

  const routeProbes = Array.isArray(input.routeProbes)
    ? input.routeProbes.map(normalizeRouteProbe)
    : requiredRoutes.map((route) => normalizeRouteProbe({
      route,
      ok: input.routes?.[route] === true,
      statusCode: input.routes?.[route] === true ? 200 : input.routes?.[route] || null,
    }));

  const requiredRouteProbes = requiredRoutes.map((route) => {
    const found = routeProbes.find((probe) => probe.route === route);
    return found || normalizeRouteProbe({ route, ok: false, statusCode: null, detail: 'required route was not probed' });
  });

  const missingRoutes = requiredRouteProbes.filter((probe) => !probe.ok).map((probe) => probe.route);
  const allRequiredRoutesPass = missingRoutes.length === 0;
  const healthProbe = requiredRouteProbes.find((probe) => probe.route === '/api/health');
  const healthPass = healthProbe?.ok === true;

  const status = allRequiredRoutesPass
    ? BACKEND_FRESHNESS_STATUS.CURRENT
    : healthPass
      ? BACKEND_FRESHNESS_STATUS.STALE_ROUTE_MISSING
      : BACKEND_FRESHNESS_STATUS.REFRESH_PROOF_FAILED;

  const finalVerdict = allRequiredRoutesPass
    ? BACKEND_FRESHNESS_STATUS.REFRESH_PROOF_PASS
    : healthPass
      ? BACKEND_FRESHNESS_STATUS.STALE_RESTART_REQUIRED
      : BACKEND_FRESHNESS_STATUS.REFRESH_PROOF_FAILED;

  return Object.freeze({
    schemaVersion: BACKEND_FRESHNESS_SCHEMA_VERSION,
    kind: 'stephanos.backend_freshness.probe',
    backendUrl: text(input.backendUrl, 'http://127.0.0.1:8787'),
    requiredRoutes,
    routeProbes: requiredRouteProbes,
    missingRoutes,
    backendCurrent: allRequiredRoutesPass,
    reuseAllowed: allRequiredRoutesPass,
    staleBackendDetected: !allRequiredRoutesPass,
    status,
    exactOperatorAction: allRequiredRoutesPass
      ? ''
      : 'Restart the Stephanos backend from the current repository, then re-run backend freshness route proof for /api/health and /api/mission-operations.',
    noFakeBackendCurrentClaim: !allRequiredRoutesPass,
    finalVerdict,
  });
}

export function assertBackendReuseAllowed(input = {}) {
  const probe = buildBackendFreshnessProbe(input);
  return {
    ...probe,
    actionStatus: probe.reuseAllowed ? 'REUSE_ALLOWED' : 'REUSE_BLOCKED',
  };
}
