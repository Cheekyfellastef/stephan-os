// Read-only experience evidence owned by the existing user-interface-agent.
// This module has no network, dispatch, repair, or approval authority.
export function projectCockpitServices({ apiStatus = {}, mission = {}, telemetryEntries = [], nowMs = Date.now() } = {}) {
  const at = Date.parse(apiStatus.lastCheckedAt || '');
  const age = nowMs - at;
  const fresh = Number.isFinite(at) && age >= 0 && age <= 120000;
  const meta = apiStatus.meta || {};
  const verified = meta.service === 'stephanos-server'
    && meta.schemaVersion === 'stephanos.backend-health.v1'
    && meta.backendIdentity?.runtimeId === 'stephanos-battle-bridge-backend';
  const reachable = fresh && typeof apiStatus.backendReachable === 'boolean' ? (apiStatus.backendReachable ? 'reachable' : 'unreachable') : 'unknown';
  const backendHealth = fresh && apiStatus.backendReachable === true && verified ? (meta.ok === true ? 'healthy' : 'unhealthy') : 'unknown';
  const times = telemetryEntries.map(entry => Date.parse(entry.timestamp || entry.timestampUtc || '')).filter(t => Number.isFinite(t) && t <= nowMs);
  return {
    frontend: 'serving', reachable, backendHealth,
    healthEndpoint: apiStatus.healthEndpoint || (apiStatus.baseUrl ? `${apiStatus.baseUrl}/api/health` : 'not resolved'),
    checkedAt: Number.isFinite(at) ? new Date(at).toISOString() : 'not checked',
    freshness: fresh ? 'current' : Number.isFinite(at) ? 'stale' : 'not checked',
    missionProof: Number(mission.missingProofCount) > 0 ? 'missing' : Array.isArray(mission.missingProof) ? 'complete' : 'unknown',
    missingProofCount: Number(mission.missingProofCount) || 0,
    lastTelemetry: times.length ? new Date(Math.max(...times)).toISOString() : 'not received',
  };
}

export function inspectCockpitRegression({ documentRef, windowRef, expectedBackendState, services, standalone = false, nowMs = Date.now() }) {
  const failures = [];
  const panels = documentRef.querySelectorAll('[data-panel-id="cockpitPanel"]');
  const dashboards = documentRef.querySelectorAll('[data-cockpit-block="primary-dashboard"]');
  if (panels.length !== 1) failures.push('COCKPIT_PANEL_CARDINALITY');
  if (dashboards.length !== 1) failures.push('COCKPIT_DASHBOARD_CARDINALITY');
  if (standalone && windowRef.top !== windowRef.self) failures.push('COCKPIT_NESTED_DOCUMENT');
  if (standalone && documentRef.querySelectorAll('iframe').length) failures.push('COCKPIT_NESTED_FRAME');
  const rect = dashboards[0]?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) failures.push('COCKPIT_DASHBOARD_HIDDEN');
  if (documentRef.documentElement.scrollWidth > windowRef.innerWidth + 2) failures.push('COCKPIT_HORIZONTAL_OVERFLOW');
  const node = documentRef.querySelector('[data-cockpit-node="backend"]');
  if (node?.getAttribute('data-service-state') !== expectedBackendState || !node?.classList.contains(`truth-${expectedBackendState}`)) failures.push('COCKPIT_BACKEND_RENDER_DRIFT');
  const health = documentRef.querySelector('[data-testid="cockpit-backend-health"]');
  if (health?.textContent?.trim() !== services.backendHealth) failures.push('COCKPIT_HEALTH_RENDER_DRIFT');
  return {
    schemaVersion: 'stephanos.ui-agent.cockpit-regression.v1', participantId: 'user-interface-agent',
    observedAtUtc: new Date(nowMs).toISOString(), verdict: failures.length ? 'FAIL' : 'PASS', failures,
    services, sourceMutationAllowed: false, repairAuthority: false,
    nextAction: failures.length ? 'Route the observed experience defect through the existing governed UI repair owner.' : 'Continue read-only DOM and health monitoring.',
  };
}

export function installCockpitRegressionMonitor({ documentRef, windowRef, readExpected, publish }) {
  let timeoutId;
  let stopped = false;
  const check = () => {
    timeoutId = undefined;
    if (stopped || documentRef.visibilityState === 'hidden') return;
    publish(inspectCockpitRegression({ documentRef, windowRef, ...readExpected() }));
  };
  const schedule = () => {
    if (timeoutId === undefined) timeoutId = windowRef.setTimeout(check, 100);
  };
  const observer = new windowRef.MutationObserver(schedule);
  observer.observe(documentRef.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-service-state'] });
  windowRef.addEventListener('resize', schedule);
  documentRef.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    stopped = true;
    observer.disconnect();
    windowRef.removeEventListener('resize', schedule);
    documentRef.removeEventListener('visibilitychange', schedule);
    if (timeoutId !== undefined) windowRef.clearTimeout(timeoutId);
  };
}
