export const BACKEND_FRESHNESS_SUPERVISOR_SCHEMA_VERSION = 'stephanos.backend-freshness-supervisor.v1';

export const BACKEND_FRESHNESS_VERDICTS = Object.freeze({
  CURRENT: 'BACKEND_CURRENT',
  STALE_ROUTE_MISSING: 'BACKEND_STALE_ROUTE_MISSING',
  STALE_RESTART_REQUIRED: 'BACKEND_STALE_RESTART_REQUIRED',
  UNREACHABLE: 'BACKEND_UNREACHABLE',
});

export const REQUIRED_BACKEND_ROUTES = Object.freeze([
  '/api/health',
  '/api/mission-operations',
]);

function normalizeBaseUrl(value = 'http://127.0.0.1:8787') {
  const text = String(value || '').trim() || 'http://127.0.0.1:8787';
  return text.replace(/\/+$/, '');
}

function routeUrl(baseUrl, route) {
  return `${normalizeBaseUrl(baseUrl)}${route.startsWith('/') ? route : `/${route}`}`;
}

function isOk(status) {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

function isMissing(status) {
  return status === 404 || status === 405;
}

export function buildBackendFreshnessOperatorAction({ baseUrl = 'http://127.0.0.1:8787', safeRestartAvailable = false } = {}) {
  if (safeRestartAvailable) {
    return 'Restart only the allowlisted Stephanos backend process, then re-run backend freshness proof for /api/health and /api/mission-operations.';
  }

  return `Stop the Stephanos backend that owns ${normalizeBaseUrl(baseUrl)} only if its command line is the allowlisted stephanos-server dev process, then start it with: npm --prefix stephanos-server run dev`;
}

export function adjudicateBackendFreshnessProof({ baseUrl = 'http://127.0.0.1:8787', routeProofs = [], safeRestartAvailable = false } = {}) {
  const proofs = REQUIRED_BACKEND_ROUTES.map((route) => {
    const proof = routeProofs.find((entry) => entry && entry.route === route) || {};
    return {
      route,
      url: proof.url || routeUrl(baseUrl, route),
      status: Number.isInteger(proof.status) ? proof.status : null,
      ok: proof.ok === true || isOk(proof.status),
      missing: proof.missing === true || isMissing(proof.status),
      error: proof.error || '',
    };
  });
  const health = proofs.find((proof) => proof.route === '/api/health');
  const missionOperations = proofs.find((proof) => proof.route === '/api/mission-operations');
  const allPass = proofs.every((proof) => proof.ok === true);
  const missionMissing = health?.ok === true && missionOperations?.missing === true;
  const verdict = allPass
    ? BACKEND_FRESHNESS_VERDICTS.CURRENT
    : missionMissing
      ? BACKEND_FRESHNESS_VERDICTS.STALE_ROUTE_MISSING
      : health?.ok === true
        ? BACKEND_FRESHNESS_VERDICTS.STALE_RESTART_REQUIRED
        : BACKEND_FRESHNESS_VERDICTS.UNREACHABLE;

  return {
    schemaVersion: BACKEND_FRESHNESS_SUPERVISOR_SCHEMA_VERSION,
    kind: 'stephanos.backend_freshness.proof',
    baseUrl: normalizeBaseUrl(baseUrl),
    requiredRoutes: [...REQUIRED_BACKEND_ROUTES],
    routeProofs: proofs,
    backendCurrent: verdict === BACKEND_FRESHNESS_VERDICTS.CURRENT,
    safeRestartAvailable: safeRestartAvailable === true,
    arbitraryShellAllowed: false,
    pcRestartAllowed: false,
    unrelatedProcessKillAllowed: false,
    exactOperatorAction: verdict === BACKEND_FRESHNESS_VERDICTS.CURRENT ? '' : buildBackendFreshnessOperatorAction({ baseUrl, safeRestartAvailable }),
    finalVerdict: verdict,
  };
}

export async function probeBackendFreshness({ baseUrl = 'http://127.0.0.1:8787', fetchImpl = globalThis.fetch, timeoutMs = 2500, safeRestartAvailable = false } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('probeBackendFreshness requires a fetch implementation');
  const routeProofs = [];
  for (const route of REQUIRED_BACKEND_ROUTES) {
    const url = routeUrl(baseUrl, route);
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const response = await fetchImpl(url, { method: 'GET', signal: controller?.signal });
      if (timer) clearTimeout(timer);
      routeProofs.push({ route, url, status: response.status, ok: isOk(response.status), missing: isMissing(response.status) });
    }
    catch (error) {
      routeProofs.push({ route, url, status: null, ok: false, missing: false, error: error?.message || String(error) });
    }
  }
  return adjudicateBackendFreshnessProof({ baseUrl, routeProofs, safeRestartAvailable });
}
