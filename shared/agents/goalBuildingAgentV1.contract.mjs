export const GOAL_BUILDING_AGENT_SCHEMA_VERSION = 'stephanos.goal-building-agent.v1';
export const GOAL_BUILDING_AGENT_ID = 'goal-building-agent';
export const GOAL_BUILDING_AGENT_CLASS = 'GOAL_BUILDING_AND_PROGRAMME_CONTINUITY_GOVERNOR';
export const GOAL_BUILDING_AGENT_QA_CAPABILITY = 'CAN_ASK_AND_ANSWER';
export const GOAL_BUILDING_AGENT_RELATED_ISSUE = '#2002';

export const GOAL_BUILDING_OPERATING_STATES = Object.freeze({
  FULLY_OPERATIONAL: 'GOAL_BUILDING_100_PERCENT_PROVEN',
  DEGRADED: 'GOAL_BUILDING_DEGRADED',
  BLOCKED: 'GOAL_BUILDING_BLOCKED',
  SAFE_HOLD: 'SAFE_HOLD',
});

export const GOAL_BUILDING_BLOCKER_ROUTES = Object.freeze([
  'SELF_RECOVERABLE_BY_EXISTING_BOUNDED_CONTRACT',
  'DELEGATE_BOUNDED_REPAIR',
  'REQUEST_QUALIFIED_REVIEW_OR_PROOF',
  'REQUEST_EXACT_OPERATOR_APPROVAL',
  'EXTERNAL_OR_UNQUALIFIED_SAFE_HOLD',
]);

export const GOAL_BUILDING_AGENT_KNOWLEDGE_DOMAINS = Object.freeze([
  'goal-estate',
  'programme-health',
  'mission-scheduling',
  'throughput',
  'stall-recovery',
  'provider-continuity',
  'shared-status',
]);

export const GOAL_BUILDING_AGENT_TASK_TYPES = Object.freeze([
  'PROGRAMME_STATUS',
  'GOAL_PROGRESS_ASSURANCE',
  'BLOCKER_CLASSIFICATION',
  'REPAIR_DELEGATION',
  'CAPACITY_REFILL_REQUEST',
  'OPERATOR_APPROVAL_PREPARATION',
]);

export const GOAL_BUILDING_MISSION_PHASES = Object.freeze([
  'SELECT_GOAL',
  'CREATE_MISSION',
  'CREATE_WORKTREE',
  'IMPLEMENT',
  'TEST',
  'PUBLISH_BRANCH',
  'OPEN_PR',
  'WAIT_HOSTED_PROOF',
  'WAIT_INDEPENDENT_REVIEW',
  'REPAIR_FINDINGS',
  'READY_FOR_OPERATOR_APPROVAL',
  'EXECUTE_PROTECTED_MERGE',
  'VERIFY_MERGE',
  'VERIFY_RUNTIME',
  'WAITING_FOR_OPERATOR',
  'WAITING_FOR_DEPENDENCY',
  'BLOCKED',
  'FAILED',
  'DONE',
]);

export const PRODUCTIVE_MISSION_PHASES = new Set([
  'SELECT_GOAL',
  'CREATE_MISSION',
  'CREATE_WORKTREE',
  'IMPLEMENT',
  'TEST',
  'PUBLISH_BRANCH',
  'OPEN_PR',
  'REPAIR_FINDINGS',
  'EXECUTE_PROTECTED_MERGE',
  'VERIFY_MERGE',
  'VERIFY_RUNTIME',
]);
export const WAITING_MISSION_PHASES = new Set([
  'WAIT_HOSTED_PROOF',
  'WAIT_INDEPENDENT_REVIEW',
  'READY_FOR_OPERATOR_APPROVAL',
  'WAITING_FOR_OPERATOR',
  'WAITING_FOR_DEPENDENCY',
]);
export const TERMINAL_MISSION_PHASES = new Set(['DONE', 'FAILED']);
export const BLOCKED_MISSION_PHASES = new Set(['BLOCKED', 'FAILED']);
export const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
export const SHA_40 = /^[0-9a-f]{40}$/;
export const DEFAULT_MAX_FUTURE_SKEW_MS = 30 * 1000;
export const DEFAULT_MAX_PROGRESS_AGE_MS = 30 * 60 * 1000;
export const MAX_ACTIVE_MISSIONS = 10;
export const MAX_BLOCKERS = 30;
export const MAX_STATUS_ITEMS = 10;
export const CAPABILITY_PATH = 'shared-workspace/programme/goal-building-agent';
export const CAPABILITY_KEYS = new Set([
  'schemaVersion',
  'kind',
  'agentId',
  'timestampUtc',
  'mode',
  'boundedWritePath',
  'trustedBuilder',
  'mergeAuthority',
  'arbitraryShellAllowed',
  'proofRefs',
  'participantSchemaVersion',
  'agentClass',
  'qaCapability',
  'knowledgeDomains',
  'acceptedTaskTypes',
  'lifecycleState',
  'mutationAuthority',
  'implementationAuthority',
  'deploymentAuthority',
  'leaseSeizureAllowed',
  'selfPromotionAllowed',
]);

export const SURFACE_POLICIES = Object.freeze({
  sourceSync: Object.freeze({ states: Object.freeze(['SYNC_NO_CHANGE', 'SYNC_COMPLETE']), headBound: true, maxAgeMs: 5 * 60 * 1000, critical: true }),
  scheduler: Object.freeze({ states: Object.freeze(['READY', 'ACTIVE']), headBound: true, maxAgeMs: 10 * 60 * 1000, critical: true }),
  continuityController: Object.freeze({ states: Object.freeze(['READY', 'ACTIVE']), headBound: true, maxAgeMs: 10 * 60 * 1000, critical: true }),
  missionWorker: Object.freeze({ states: Object.freeze(['READY', 'RUNNING', 'ACTIVE']), headBound: true, maxAgeMs: 5 * 60 * 1000, critical: true }),
  providerRouter: Object.freeze({ states: Object.freeze(['READY', 'ROUTING']), headBound: false, maxAgeMs: 15 * 60 * 1000, critical: true }),
  proofRoute: Object.freeze({ states: Object.freeze(['READY']), headBound: false, maxAgeMs: 60 * 60 * 1000, critical: false }),
  reviewRoute: Object.freeze({ states: Object.freeze(['READY']), headBound: false, maxAgeMs: 60 * 60 * 1000, critical: false }),
  statusFabric: Object.freeze({ states: Object.freeze(['READY']), headBound: true, maxAgeMs: 10 * 60 * 1000, critical: false }),
  battleBridge: Object.freeze({ states: Object.freeze(['READY']), headBound: true, maxAgeMs: 5 * 60 * 1000, critical: true, physical: true }),
  ignition: Object.freeze({ states: Object.freeze(['READY']), headBound: true, maxAgeMs: 5 * 60 * 1000, critical: true, physical: true }),
  recoveryMesh: Object.freeze({ states: Object.freeze(['READY']), headBound: false, maxAgeMs: 5 * 60 * 1000, critical: false, physical: true }),
  mailbox: Object.freeze({ states: Object.freeze(['READY']), headBound: false, maxAgeMs: 5 * 60 * 1000, critical: false, physical: true }),
});

export const BASE_REQUIRED_SURFACES = Object.freeze([
  'sourceSync',
  'scheduler',
  'continuityController',
  'missionWorker',
  'providerRouter',
  'proofRoute',
  'reviewRoute',
  'statusFabric',
]);
export const PHYSICAL_REQUIRED_SURFACES = Object.freeze([
  'battleBridge',
  'ignition',
  'recoveryMesh',
  'mailbox',
]);

export function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

export function boundedText(value, fallback = '', maxLength = 240) {
  return text(value, fallback).replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

export function list(value) {
  return Array.isArray(value) ? value : [];
}

export function unique(values) {
  return [...new Set(values)];
}

export function sameStringSet(value, expected) {
  const actual = list(value).map(String);
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((item) => actual.includes(item));
}

export function capabilityShapeBlockers(capability) {
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) return ['capability-record-not-object'];
  const blockers = [];
  for (const key of Reflect.ownKeys(capability)) {
    if (typeof key !== 'string') blockers.push('capability-symbol-field-forbidden');
    else if (!CAPABILITY_KEYS.has(key)) blockers.push(`capability-unknown-field:${key}`);
  }
  return blockers;
}

export function safeId(value, fallback = '') {
  const output = text(value);
  return SAFE_ID.test(output) ? output : fallback;
}

export function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function clock(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const maxFutureSkewMs = Number.isFinite(input.maxFutureSkewMs) && input.maxFutureSkewMs >= 0
    ? input.maxFutureSkewMs
    : DEFAULT_MAX_FUTURE_SKEW_MS;
  const maxProgressAgeMs = Number.isFinite(input.maxProgressAgeMs) && input.maxProgressAgeMs >= 0
    ? input.maxProgressAgeMs
    : DEFAULT_MAX_PROGRESS_AGE_MS;
  return { nowMs, maxFutureSkewMs, maxProgressAgeMs };
}

export function timestampVerdict(value, { nowMs, maxFutureSkewMs, maxAgeMs }) {
  const observedMs = timestampMs(value);
  if (!Number.isFinite(observedMs)) return 'INVALID';
  if (observedMs > nowMs + maxFutureSkewMs) return 'FUTURE';
  if (nowMs - observedMs > maxAgeMs) return 'STALE';
  return 'CURRENT';
}

export function requiredSurfaceIds(physicalExecutionRequired) {
  return physicalExecutionRequired
    ? [...BASE_REQUIRED_SURFACES, ...PHYSICAL_REQUIRED_SURFACES]
    : [...BASE_REQUIRED_SURFACES];
}

export function normalizeSurface(surface = {}) {
  return Object.freeze({
    id: safeId(surface.id),
    state: boundedText(surface.state, 'UNKNOWN', 80).toUpperCase(),
    observedAtUtc: text(surface.observedAtUtc),
    head: text(surface.head).toLowerCase(),
    blocker: boundedText(surface.blocker, '', 180),
  });
}

export function normalizeMission(mission = {}) {
  return Object.freeze({
    missionId: safeId(mission.missionId),
    goalId: safeId(mission.goalId),
    laneId: safeId(mission.laneId),
    ownerId: safeId(mission.ownerId),
    phase: boundedText(mission.phase, 'UNKNOWN', 80).toUpperCase(),
    authorityHead: text(mission.authorityHead).toLowerCase(),
    observedAtUtc: text(mission.observedAtUtc),
    lastProgressAtUtc: text(mission.lastProgressAtUtc),
    nextAction: boundedText(mission.nextAction, '', 240),
  });
}

export function normalizeBlocker(blocker = {}) {
  return Object.freeze({
    blockerId: safeId(blocker.blockerId),
    severity: boundedText(blocker.severity, 'P2', 16).toUpperCase(),
    ownerId: safeId(blocker.ownerId),
    route: boundedText(blocker.route, '', 80).toUpperCase(),
    missionId: safeId(blocker.missionId),
    goalId: safeId(blocker.goalId),
    firstObservedAtUtc: text(blocker.firstObservedAtUtc),
    nextAction: boundedText(blocker.nextAction, '', 240),
    independentWorkContinues: blocker.independentWorkContinues === true,
  });
}
