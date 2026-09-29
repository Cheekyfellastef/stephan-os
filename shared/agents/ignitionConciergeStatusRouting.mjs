import {
  createSharedWorkspaceMessage,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';
import {
  createVerifierResult,
  validateVerifierResult,
  VERIFICATION_STATUS,
} from './verificationHarness.mjs';

export const IGNITION_CONCIERGE_SCHEMA_VERSION = 'ignition-concierge-status-routing.v1';

export const IGNITION_SERVICE_IDS = Object.freeze([
  'backend',
  'openclaw-gateway',
  'stephanos-ui',
  'mission-orchestrator-worker',
  'shared-agent-workspace',
]);

export const IGNITION_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  STARTING: 'STARTING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const IGNITION_SURFACES = Object.freeze([
  'splash',
  'dashboard',
  'shared-workspace',
  'phone',
  'tablet',
]);

export const IGNITION_ROUTING_GUARDRAILS = Object.freeze({
  visiblePowerShellWallsAllowed: false,
  statusMustRouteToSharedWorkspace: true,
  splashMayShowSummaryOnly: true,
  arbitraryShellAllowed: false,
  secretOutputAllowed: false,
  operatorApprovalRequiredForMutation: true,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/#() -]{0,240}$/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  if (!text || FORBIDDEN_TEXT_PATTERN.test(text)) return fallback;
  return SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function safeId(value, fallback) {
  const text = asText(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(text) ? text : fallback;
}

function normalizeStatus(value) {
  const status = asText(value, IGNITION_STATUS.QUEUED).toUpperCase();
  return Object.values(IGNITION_STATUS).includes(status) ? status : IGNITION_STATUS.QUEUED;
}

function normalizeService(value) {
  const service = safeId(value, 'backend');
  return IGNITION_SERVICE_IDS.includes(service) ? service : 'backend';
}

function normalizeSurface(value) {
  const surface = safeId(value, 'shared-workspace');
  return IGNITION_SURFACES.includes(surface) ? surface : 'shared-workspace';
}

export function buildIgnitionConciergeStatusRoutingContract() {
  return {
    schemaVersion: IGNITION_CONCIERGE_SCHEMA_VERSION,
    contractKind: 'stephanos.ignition_concierge.status_routing.contract',
    services: [...IGNITION_SERVICE_IDS],
    statuses: Object.values(IGNITION_STATUS),
    surfaces: [...IGNITION_SURFACES],
    guardrails: { ...IGNITION_ROUTING_GUARDRAILS },
    requiredStatusFields: [
      'schemaVersion',
      'kind',
      'routeId',
      'serviceId',
      'status',
      'primarySurface',
      'sharedWorkspacePath',
      'summary',
      'operatorVisible',
      'sharedWorkspaceMessage',
    ],
    finalVerdict: 'IGNITION_CONCIERGE_STATUS_ROUTING_CONTRACT_READY',
  };
}

export function createIgnitionStatusRoute(input = {}) {
  const serviceId = normalizeService(input.serviceId);
  const status = normalizeStatus(input.status);
  const routeId = safeId(input.routeId, `ignition-${serviceId}-${status.toLowerCase()}`);
  const primarySurface = normalizeSurface(input.primarySurface || 'splash');
  const blocked = status === IGNITION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  const summary = safeText(input.summary, `${serviceId} ${status.toLowerCase()}`);
  const sharedWorkspacePath = safeText(input.sharedWorkspacePath, `status/ignition/${serviceId}.json`);

  return {
    schemaVersion: IGNITION_CONCIERGE_SCHEMA_VERSION,
    kind: 'stephanos.ignition_concierge.status_route',
    routeId,
    serviceId,
    status,
    primarySurface,
    sharedWorkspacePath,
    dashboardPath: safeText(input.dashboardPath, 'dashboard/ignition/status.json'),
    splashSummary: safeText(input.splashSummary, summary),
    summary,
    detail: safeText(input.detail, ''),
    operatorVisible: input.operatorVisible !== false,
    visiblePowerShellWall: false,
    exactUnblockAction: blocked
      ? safeText(input.exactUnblockAction, 'Resolve the ignition blocker, then rerun Battle Bridge ignition proof.')
      : '',
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: routeId,
      sender: 'stephanos',
      recipient: 'operator',
      channel: 'ignition-concierge',
      kind: blocked ? 'operator-action-required' : 'status',
      severity: blocked ? 'warning' : 'info',
      correlationId: input.correlationId || routeId,
      relatedGoal: input.relatedGoal || '#1281',
      summary,
      status,
      proofRefs: ['proof/ignition-concierge/status-routing.json'],
      requiresOperator: blocked,
    }),
  };
}

export function validateIgnitionStatusRoute(route = {}) {
  const errors = [];
  if (route.schemaVersion !== IGNITION_CONCIERGE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (route.kind !== 'stephanos.ignition_concierge.status_route') errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(asText(route.routeId, ''))) errors.push('invalid-route-id');
  if (!IGNITION_SERVICE_IDS.includes(route.serviceId)) errors.push('invalid-service-id');
  if (!Object.values(IGNITION_STATUS).includes(route.status)) errors.push('invalid-status');
  if (!IGNITION_SURFACES.includes(route.primarySurface)) errors.push('invalid-primary-surface');
  if (route.visiblePowerShellWall === true) errors.push('visible-powershell-wall');
  if (!asText(route.sharedWorkspacePath, '')) errors.push('missing-shared-workspace-path');
  if (FORBIDDEN_TEXT_PATTERN.test(asText(route.summary, ''))) errors.push('unsafe-summary');
  const messageValidation = validateSharedWorkspaceMessage(route.sharedWorkspaceMessage);
  if (!messageValidation.valid) errors.push('invalid-shared-workspace-message');
  if (route.status === IGNITION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !asText(route.exactUnblockAction, '')) errors.push('missing-exact-unblock-action');

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'IGNITION_STATUS_ROUTE_PASS' : 'IGNITION_STATUS_ROUTE_BLOCKED',
  };
}

export function aggregateIgnitionStatusRoutes(input = {}) {
  const routes = Array.isArray(input.routes) ? input.routes.map(createIgnitionStatusRoute) : [];
  const invalid = routes.filter((route) => !validateIgnitionStatusRoute(route).valid);
  const blocked = routes.filter((route) => route.status === IGNITION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  const degraded = routes.filter((route) => route.status === IGNITION_STATUS.DEGRADED);
  const missing = IGNITION_SERVICE_IDS.filter((serviceId) => !routes.some((route) => route.serviceId === serviceId));
  const ready = routes.length > 0 && invalid.length === 0 && blocked.length === 0 && degraded.length === 0 && missing.length === 0;

  return {
    schemaVersion: IGNITION_CONCIERGE_SCHEMA_VERSION,
    kind: 'stephanos.ignition_concierge.status_aggregate',
    status: ready ? IGNITION_STATUS.READY : blocked.length ? IGNITION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION : IGNITION_STATUS.DEGRADED,
    routes,
    invalidRouteIds: invalid.map((route) => route.routeId),
    blockedServiceIds: blocked.map((route) => route.serviceId),
    degradedServiceIds: degraded.map((route) => route.serviceId),
    missingServiceIds: missing,
    sharedWorkspacePath: safeText(input.sharedWorkspacePath, 'status/ignition/aggregate.json'),
    summary: ready ? 'Ignition Concierge status routing is ready.' : 'Ignition Concierge has blocked, degraded, invalid, or missing service routes.',
    finalVerdict: ready ? 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS' : 'IGNITION_CONCIERGE_STATUS_ROUTING_BLOCKED',
  };
}

export function createIgnitionVerificationResult(input = {}) {
  const aggregate = aggregateIgnitionStatusRoutes(input);
  const passed = aggregate.finalVerdict === 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS';
  const verifierResult = createVerifierResult({
    checkId: safeId(input.checkId, 'ignition-concierge-status-routing'),
    verifierType: 'SharedWorkspaceVerifier',
    status: passed ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.FAIL,
    target: aggregate.sharedWorkspacePath,
    evidence: [
      `routes=${aggregate.routes.length}`,
      `missing=${aggregate.missingServiceIds.length}`,
      `blocked=${aggregate.blockedServiceIds.length}`,
    ],
    reason: passed ? '' : 'Ignition Concierge status routing is incomplete or blocked.',
    proofRefs: ['proof/ignition-concierge/status-routing.json'],
  });

  return {
    schemaVersion: IGNITION_CONCIERGE_SCHEMA_VERSION,
    kind: 'stephanos.ignition_concierge.verification_result',
    aggregate,
    verifierResult,
    valid: validateVerifierResult(verifierResult).valid,
    finalVerdict: passed ? 'IGNITION_CONCIERGE_VERIFICATION_PASS' : 'IGNITION_CONCIERGE_VERIFICATION_BLOCKED',
  };
}
