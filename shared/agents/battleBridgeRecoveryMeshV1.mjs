export const BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA = 'stephanos.battle-bridge-recovery-mesh.v1';
export const BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA = 'stephanos.battle-bridge-recovery-ingress.v1';

export const BATTLE_BRIDGE_RECOVERY_ROUTE = Object.freeze({
  LOCAL_WINDOWS_SUPERVISOR: 'LOCAL_WINDOWS_SUPERVISOR',
  GITHUB_MAILBOX: 'GITHUB_MAILBOX',
  TAILSCALE_CONTROL: 'TAILSCALE_CONTROL',
  OPENCLAW_WHATSAPP: 'OPENCLAW_WHATSAPP',
  AUTHENTICATED_BREAK_GLASS: 'AUTHENTICATED_BREAK_GLASS',
});

export const BATTLE_BRIDGE_RECOVERY_ROUTES = Object.freeze(Object.values(BATTLE_BRIDGE_RECOVERY_ROUTE));
export const BATTLE_BRIDGE_RECOVERY_ACTION = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER';
export const BATTLE_BRIDGE_RECOVERY_EXECUTOR = 'Stephanos Battle Bridge Recovery Mesh';
export const BATTLE_BRIDGE_RECOVERY_LEASE_MS = 2 * 60 * 1000;
export const BATTLE_BRIDGE_RECOVERY_MAX_REQUEST_AGE_MS = 10 * 60 * 1000;

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RECEIPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,180}$/;
const ROUTE_REQUIREMENTS = Object.freeze({
  [BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR]: Object.freeze({ evidence: 'scheduledTaskVerified', failureDomain: 'windows-task-scheduler' }),
  [BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX]: Object.freeze({ evidence: 'ownerAuthenticated', failureDomain: 'github-command-transport' }),
  [BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL]: Object.freeze({ evidence: 'tailnetIdentityVerified', failureDomain: 'tailscale-control-plane' }),
  [BATTLE_BRIDGE_RECOVERY_ROUTE.OPENCLAW_WHATSAPP]: Object.freeze({ evidence: 'operatorIdentityVerified', failureDomain: 'openclaw-whatsapp-transport' }),
  [BATTLE_BRIDGE_RECOVERY_ROUTE.AUTHENTICATED_BREAK_GLASS]: Object.freeze({ evidence: 'nonceConfirmed', failureDomain: 'local-break-glass' }),
});

function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function blocked(blocker, details = {}) {
  return Object.freeze({ ok: false, accepted: false, blocker, ...details });
}

export function validateBattleBridgeRecoveryIngress(input = {}, {
  nowMs = Date.now(),
  maxRequestAgeMs = BATTLE_BRIDGE_RECOVERY_MAX_REQUEST_AGE_MS,
} = {}) {
  if (input.schemaVersion !== BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA) return blocked('RECOVERY_INGRESS_SCHEMA_INVALID');
  const requestId = text(input.requestId);
  if (!REQUEST_ID.test(requestId)) return blocked('RECOVERY_INGRESS_REQUEST_ID_INVALID');
  const route = text(input.route);
  if (!BATTLE_BRIDGE_RECOVERY_ROUTES.includes(route)) return blocked('RECOVERY_INGRESS_ROUTE_INVALID');
  if (input.action !== BATTLE_BRIDGE_RECOVERY_ACTION) return blocked('RECOVERY_INGRESS_ACTION_INVALID');
  const issuedAtMs = validTimestamp(input.issuedAtUtc);
  const expiresAtMs = validTimestamp(input.expiresAtUtc);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return blocked('RECOVERY_INGRESS_TIME_INVALID');
  if (issuedAtMs > nowMs + 30_000) return blocked('RECOVERY_INGRESS_ISSUED_IN_FUTURE');
  if (nowMs - issuedAtMs > maxRequestAgeMs) return blocked('RECOVERY_INGRESS_STALE');
  if (expiresAtMs <= nowMs || expiresAtMs <= issuedAtMs) return blocked('RECOVERY_INGRESS_EXPIRED');
  if (expiresAtMs - issuedAtMs > maxRequestAgeMs) return blocked('RECOVERY_INGRESS_EXPIRY_TOO_LONG');

  const requirement = ROUTE_REQUIREMENTS[route];
  if (input[requirement.evidence] !== true) {
    return blocked('RECOVERY_INGRESS_AUTHENTICATION_EVIDENCE_REQUIRED', { route, requiredEvidence: requirement.evidence });
  }
  const sourceReceipt = text(input.sourceReceipt);
  if (!RECEIPT_ID.test(sourceReceipt)) return blocked('RECOVERY_INGRESS_SOURCE_RECEIPT_INVALID', { route });
  if (input.arbitraryCommand || input.command || input.executable || input.args || input.taskName || input.url || input.path) {
    return blocked('RECOVERY_INGRESS_UNSAFE_FIELD_PRESENT', { route });
  }

  return Object.freeze({
    ok: true,
    accepted: true,
    request: Object.freeze({
      schemaVersion: BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA,
      requestId,
      idempotencyKey: `${route}:${requestId}`,
      route,
      failureDomain: requirement.failureDomain,
      action: BATTLE_BRIDGE_RECOVERY_ACTION,
      issuedAtUtc: new Date(issuedAtMs).toISOString(),
      expiresAtUtc: new Date(expiresAtMs).toISOString(),
      sourceReceipt,
      authenticationEvidence: requirement.evidence,
    }),
  });
}

function activeLeaseValid(activeLease, nowMs) {
  return activeLease?.executor === BATTLE_BRIDGE_RECOVERY_EXECUTOR
    && REQUEST_ID.test(text(activeLease?.requestId))
    && validTimestamp(activeLease?.expiresAtUtc) > nowMs;
}

export function adjudicateBattleBridgeRecoveryMesh({
  ingressRequests = [],
  consumedIdempotencyKeys = [],
  activeLease = null,
  nowMs = Date.now(),
} = {}) {
  const consumed = new Set(Array.isArray(consumedIdempotencyKeys) ? consumedIdempotencyKeys.map(text) : []);
  const rejected = [];
  const accepted = [];
  const seen = new Set();
  for (const ingress of Array.isArray(ingressRequests) ? ingressRequests : []) {
    const validation = validateBattleBridgeRecoveryIngress(ingress, { nowMs });
    if (!validation.ok) {
      rejected.push(Object.freeze({ requestId: text(ingress?.requestId), route: text(ingress?.route), blocker: validation.blocker }));
      continue;
    }
    const request = validation.request;
    if (consumed.has(request.idempotencyKey) || seen.has(request.idempotencyKey)) {
      rejected.push(Object.freeze({ requestId: request.requestId, route: request.route, blocker: 'RECOVERY_INGRESS_DUPLICATE' }));
      continue;
    }
    seen.add(request.idempotencyKey);
    accepted.push(request);
  }

  accepted.sort((left, right) => {
    const timeDifference = Date.parse(left.issuedAtUtc) - Date.parse(right.issuedAtUtc);
    if (timeDifference !== 0) return timeDifference;
    const routeDifference = BATTLE_BRIDGE_RECOVERY_ROUTES.indexOf(left.route) - BATTLE_BRIDGE_RECOVERY_ROUTES.indexOf(right.route);
    return routeDifference || left.requestId.localeCompare(right.requestId);
  });

  if (activeLeaseValid(activeLease, nowMs)) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA,
      ok: true,
      decision: 'COALESCE_WITH_ACTIVE_RECOVERY_LEASE',
      dispatchAllowed: false,
      activeLease,
      accepted,
      rejected,
      coalescedRoutes: Object.freeze([...new Set(accepted.map((request) => request.route))]),
      oneExecutorEnforced: true,
      duplicateWorkerAllowed: false,
      finalVerdict: 'BATTLE_BRIDGE_RECOVERY_MESH_COALESCED',
    });
  }

  if (accepted.length === 0) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA,
      ok: false,
      decision: 'NO_VALID_RECOVERY_INGRESS',
      dispatchAllowed: false,
      accepted,
      rejected,
      oneExecutorEnforced: true,
      duplicateWorkerAllowed: false,
      finalVerdict: 'BATTLE_BRIDGE_RECOVERY_MESH_IDLE',
    });
  }

  const selected = accepted[0];
  const acquiredAtUtc = new Date(nowMs).toISOString();
  const lease = Object.freeze({
    schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA,
    leaseId: `recovery-mesh:${selected.requestId}`,
    requestId: selected.requestId,
    route: selected.route,
    executor: BATTLE_BRIDGE_RECOVERY_EXECUTOR,
    acquiredAtUtc,
    expiresAtUtc: new Date(nowMs + BATTLE_BRIDGE_RECOVERY_LEASE_MS).toISOString(),
    maximumConcurrentExecutors: 1,
  });
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA,
    ok: true,
    decision: 'ACQUIRE_CANONICAL_RECOVERY_LEASE',
    dispatchAllowed: true,
    selected,
    lease,
    accepted,
    rejected,
    coalescedRoutes: Object.freeze([...new Set(accepted.slice(1).map((request) => request.route))]),
    oneExecutorEnforced: true,
    duplicateWorkerAllowed: false,
    finalVerdict: 'BATTLE_BRIDGE_RECOVERY_MESH_DISPATCH_READY',
  });
}

export function classifyBattleBridgeRecoveryMeshHealth({
  routes = {},
  dispatcherHealthy = false,
  workerHealthy = false,
} = {}) {
  const routeResults = BATTLE_BRIDGE_RECOVERY_ROUTES.map((route) => {
    const expectedDomain = ROUTE_REQUIREMENTS[route].failureDomain;
    const observed = routes?.[route] || {};
    const healthy = observed.healthy === true
      && observed.independentlyProven === true
      && text(observed.failureDomain) === expectedDomain
      && RECEIPT_ID.test(text(observed.proofRef));
    return Object.freeze({ route, failureDomain: expectedDomain, healthy, proofRef: healthy ? text(observed.proofRef) : '' });
  });
  const healthyRouteCount = routeResults.filter((route) => route.healthy).length;
  const independentFailureDomains = new Set(routeResults.filter((route) => route.healthy).map((route) => route.failureDomain)).size;
  const fullyProven = healthyRouteCount === BATTLE_BRIDGE_RECOVERY_ROUTES.length
    && independentFailureDomains === BATTLE_BRIDGE_RECOVERY_ROUTES.length
    && dispatcherHealthy === true
    && workerHealthy === true;
  const usable = healthyRouteCount > 0 && dispatcherHealthy === true;
  const classification = fullyProven
    ? 'BATTLE_BRIDGE_RECOVERY_MESH_BULLETPROOF'
    : usable
      ? 'BATTLE_BRIDGE_RECOVERY_MESH_DEGRADED'
      : 'BATTLE_BRIDGE_RECOVERY_MESH_UNAVAILABLE';
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA,
    classification,
    healthyRouteCount,
    requiredRouteCount: BATTLE_BRIDGE_RECOVERY_ROUTES.length,
    independentFailureDomains,
    dispatcherHealthy: dispatcherHealthy === true,
    workerHealthy: workerHealthy === true,
    acceptsRuntimeWork: fullyProven || (usable && workerHealthy === true),
    bulletproofAcceptancePassed: fullyProven,
    routes: Object.freeze(routeResults),
    oneExecutorEnforced: true,
    duplicateWorkerAllowed: false,
    finalVerdict: classification,
  });
}

export function buildBattleBridgeRecoveryMeshContract() {
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_RECOVERY_MESH_SCHEMA,
    routes: BATTLE_BRIDGE_RECOVERY_ROUTES,
    action: BATTLE_BRIDGE_RECOVERY_ACTION,
    executor: BATTLE_BRIDGE_RECOVERY_EXECUTOR,
    maximumConcurrentExecutors: 1,
    guardrails: Object.freeze({
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      arbitraryTaskNameAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      pcRestartAllowed: false,
      credentialsMayBeReadOrExported: false,
      duplicateMailboxAllowed: false,
      duplicateWorkerAllowed: false,
    }),
    finalVerdict: 'BATTLE_BRIDGE_RECOVERY_MESH_CONTRACT_READY',
  });
}
