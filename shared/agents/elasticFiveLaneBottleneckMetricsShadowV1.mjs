export const ELASTIC_FIVE_LANE_BOTTLENECK_METRICS_SHADOW_SCHEMA_VERSION =
  'stephanos.elastic-five-lane-bottleneck-metrics-shadow.v1';

export const ELASTIC_FIVE_LANE_BASELINE_ROLES_V1 = Object.freeze([
  'SOURCE',
  'REVIEW',
  'PROOF',
  'RUNTIME',
  'EXPERIENCE',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INPUT_KEYS = Object.freeze([
  'sourceHead',
  'sourceTree',
  'observedAtUtc',
  'policy',
  'lanes',
  'leases',
  'demand',
  'capacity',
]);
const POLICY_KEYS = Object.freeze([
  'minWidth',
  'maxWidth',
  'staleAfterMs',
  'queueAgePressureMs',
  'waitPressureMs',
  'cooldownMs',
  'lastWidthChangeAtUtc',
]);
const LANE_KEYS = Object.freeze([
  'laneId',
  'role',
  'state',
  'sourceHead',
  'correlationId',
  'queueDepth',
  'oldestQueueAgeMs',
  'waitTimeMs',
  'criticalPath',
  'capacityHealthy',
  'provider',
  'resourceIds',
]);
const LEASE_KEYS = Object.freeze([
  'leaseId',
  'laneId',
  'resourceId',
  'mode',
  'heartbeatAtUtc',
  'expiresAtUtc',
  'sourceHead',
  'signatureVerified',
]);
const DEMAND_KEYS = Object.freeze([
  'readyNonConflictingWork',
  'blockedWork',
  'criticalPathWork',
]);
const CAPACITY_KEYS = Object.freeze([
  'githubHealthy',
  'providerHealthy',
  'battleBridgeHealthy',
  'cpuPressure',
  'memoryPressure',
  'rateLimitPressure',
  'costPressure',
]);
const LANE_STATES = Object.freeze(['RUNNING', 'IDLE', 'BLOCKED', 'PAUSED', 'SAFE_HOLD']);
const LEASE_MODES = Object.freeze(['READ_ONLY', 'MUTATION']);
const OPTIONAL_ROLES = Object.freeze([
  'SECURITY_REPAIR',
  'INDEPENDENT_REVIEW',
  'PROOF_RETRY',
  'DOCUMENTATION',
  'DEPENDENCY_RECONCILIATION',
  'RUNTIME_RECOVERY',
  'EVENT_INTAKE',
  'PROVIDER_OR_LOCAL_EXECUTOR',
]);
const ZERO_AUTHORITY = Object.freeze({
  laneCreateAllowed: false,
  laneRetireAllowed: false,
  widthMutationAllowed: false,
  leaseAcquireAllowed: false,
  leaseReleaseAllowed: false,
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  deploymentAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  controllerAuthorityTransferAllowed: false,
  fiveLaneCutoverAllowed: false,
});

function text(value, limit = 240) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function canonicalPlainData(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string'
    || ['__proto__', 'prototype', 'constructor'].includes(key))) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return false;
    }
  }
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
}

function canonicalArray(value, maximum = 128) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length > maximum) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return false;
    }
  }
  return true;
}

function validUtc(value) {
  const normalized = text(value, 32);
  return ISO_UTC.test(normalized) && Number.isFinite(Date.parse(normalized));
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function canonicalTextArray(value, maximum = 32) {
  if (!canonicalArray(value, maximum)) return false;
  const seen = new Set();
  for (const item of value) {
    const normalized = text(item, 200);
    if (!normalized || normalized !== item || seen.has(normalized)) return false;
    seen.add(normalized);
  }
  return true;
}

function safeHold(reasonCodes = ['BOTTLENECK_METRICS_INPUT_INVALID']) {
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_BOTTLENECK_METRICS_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'SAFE_HOLD',
    currentWidth: 0,
    healthyWidth: 0,
    blockedWidth: 0,
    recommendedWidth: null,
    nextAction: 'SAFE_HOLD_SHADOW',
    activeLanes: Object.freeze([]),
    activeLeases: Object.freeze([]),
    bottlenecks: Object.freeze([]),
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    finalVerdict: 'ELASTIC_FIVE_LANE_BOTTLENECK_METRICS_SHADOW_SAFE_HOLD',
  });
}

function validatePolicy(policy) {
  if (!canonicalPlainData(policy, POLICY_KEYS)) return 'WIDTH_POLICY_NOT_CANONICAL_PLAIN_DATA';
  if (policy.minWidth !== 5) return 'MINIMUM_WIDTH_MUST_EQUAL_FIVE';
  if (!boundedInteger(policy.maxWidth, 5, 32)) return 'MAXIMUM_WIDTH_INVALID';
  for (const key of ['staleAfterMs', 'queueAgePressureMs', 'waitPressureMs', 'cooldownMs']) {
    if (!boundedInteger(policy[key], 1, 86_400_000)) return `WIDTH_POLICY_${key.toUpperCase()}_INVALID`;
  }
  if (!validUtc(policy.lastWidthChangeAtUtc)) return 'LAST_WIDTH_CHANGE_TIME_INVALID';
  return '';
}

function validateDemand(demand) {
  if (!canonicalPlainData(demand, DEMAND_KEYS)) return 'DEMAND_NOT_CANONICAL_PLAIN_DATA';
  for (const key of DEMAND_KEYS) {
    if (!boundedInteger(demand[key], 0, 10_000)) return `DEMAND_${key.toUpperCase()}_INVALID`;
  }
  return '';
}

function validateCapacity(capacity) {
  if (!canonicalPlainData(capacity, CAPACITY_KEYS)) return 'CAPACITY_NOT_CANONICAL_PLAIN_DATA';
  for (const key of CAPACITY_KEYS) {
    if (typeof capacity[key] !== 'boolean') return `CAPACITY_${key.toUpperCase()}_INVALID`;
  }
  return '';
}

function severityRank(severity) {
  return { HIGH: 0, MEDIUM: 1, LOW: 2 }[severity] ?? 3;
}

function project(input) {
  if (!canonicalPlainData(input, INPUT_KEYS)) {
    return safeHold(['BOTTLENECK_METRICS_INPUT_NOT_CANONICAL_PLAIN_DATA']);
  }
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  const sourceTree = text(input.sourceTree, 40).toLowerCase();
  if (!SHA40.test(sourceHead)) return safeHold(['SOURCE_HEAD_INVALID']);
  if (!SHA40.test(sourceTree)) return safeHold(['SOURCE_TREE_INVALID']);
  if (!validUtc(input.observedAtUtc)) return safeHold(['OBSERVATION_TIME_INVALID']);
  const observedAt = Date.parse(input.observedAtUtc);

  const policyBlocker = validatePolicy(input.policy);
  if (policyBlocker) return safeHold([policyBlocker]);
  if (Date.parse(input.policy.lastWidthChangeAtUtc) > observedAt) {
    return safeHold(['LAST_WIDTH_CHANGE_IS_IN_FUTURE']);
  }
  const demandBlocker = validateDemand(input.demand);
  if (demandBlocker) return safeHold([demandBlocker]);
  const capacityBlocker = validateCapacity(input.capacity);
  if (capacityBlocker) return safeHold([capacityBlocker]);
  if (!canonicalArray(input.lanes, 32) || input.lanes.length < 5) {
    return safeHold(['FIVE_BASELINE_LANES_NOT_PRESENT']);
  }
  if (!canonicalArray(input.leases, 128)) return safeHold(['LEASES_NOT_CANONICAL_ARRAY']);

  const laneIds = new Set();
  const correlationIds = new Set();
  const roles = new Set();
  const lanes = [];
  for (const lane of input.lanes) {
    if (!canonicalPlainData(lane, LANE_KEYS)) return safeHold(['LANE_NOT_CANONICAL_PLAIN_DATA']);
    const laneId = text(lane.laneId, 120);
    const correlationId = text(lane.correlationId, 160);
    const role = text(lane.role, 80);
    const state = text(lane.state, 40);
    if (!laneId || laneIds.has(laneId)) return safeHold(['DUPLICATE_OR_MISSING_LANE_ID']);
    if (!correlationId || correlationIds.has(correlationId)) {
      return safeHold(['DUPLICATE_OR_MISSING_LANE_CORRELATION_ID']);
    }
    if (![...ELASTIC_FIVE_LANE_BASELINE_ROLES_V1, ...OPTIONAL_ROLES].includes(role)) {
      return safeHold(['LANE_ROLE_INVALID']);
    }
    if (!LANE_STATES.includes(state)) return safeHold(['LANE_STATE_INVALID']);
    if (text(lane.sourceHead, 40).toLowerCase() !== sourceHead) {
      return safeHold(['LANE_SOURCE_HEAD_MISMATCH']);
    }
    if (!boundedInteger(lane.queueDepth, 0, 10_000)
      || !boundedInteger(lane.oldestQueueAgeMs, 0, 604_800_000)
      || !boundedInteger(lane.waitTimeMs, 0, 604_800_000)) {
      return safeHold(['LANE_METRIC_INVALID']);
    }
    if (typeof lane.criticalPath !== 'boolean' || typeof lane.capacityHealthy !== 'boolean') {
      return safeHold(['LANE_BOOLEAN_METRIC_INVALID']);
    }
    if (!text(lane.provider, 120)) return safeHold(['LANE_PROVIDER_MISSING']);
    if (!canonicalTextArray(lane.resourceIds)) return safeHold(['LANE_RESOURCE_IDS_INVALID']);
    laneIds.add(laneId);
    correlationIds.add(correlationId);
    roles.add(role);
    lanes.push({ ...lane, laneId, correlationId, role, state });
  }
  for (const role of ELASTIC_FIVE_LANE_BASELINE_ROLES_V1) {
    if (!roles.has(role)) return safeHold(['BASELINE_LANE_ROLE_MISSING']);
  }
  if (lanes.some((lane) => lane.state === 'SAFE_HOLD')) {
    return safeHold(['LANE_REPORTED_SAFE_HOLD']);
  }

  const leaseIds = new Set();
  const activeLeases = [];
  const expiredLeases = [];
  const mutationWriters = new Map();
  for (const lease of input.leases) {
    if (!canonicalPlainData(lease, LEASE_KEYS)) return safeHold(['LEASE_NOT_CANONICAL_PLAIN_DATA']);
    const leaseId = text(lease.leaseId, 160);
    const laneId = text(lease.laneId, 120);
    const resourceId = text(lease.resourceId, 200);
    const mode = text(lease.mode, 40);
    if (!leaseId || leaseIds.has(leaseId)) return safeHold(['DUPLICATE_OR_MISSING_LEASE_ID']);
    if (!laneIds.has(laneId)) return safeHold(['LEASE_LANE_UNKNOWN']);
    if (!resourceId || !LEASE_MODES.includes(mode)) return safeHold(['LEASE_RESOURCE_OR_MODE_INVALID']);
    if (text(lease.sourceHead, 40).toLowerCase() !== sourceHead) {
      return safeHold(['LEASE_SOURCE_HEAD_MISMATCH']);
    }
    if (!validUtc(lease.heartbeatAtUtc) || !validUtc(lease.expiresAtUtc)) {
      return safeHold(['LEASE_TIME_INVALID']);
    }
    const heartbeatAt = Date.parse(lease.heartbeatAtUtc);
    const expiresAt = Date.parse(lease.expiresAtUtc);
    if (heartbeatAt > observedAt || heartbeatAt >= expiresAt) return safeHold(['LEASE_TIME_ORDER_INVALID']);
    if (lease.signatureVerified !== true) return safeHold(['LEASE_SIGNATURE_UNPROVEN']);
    const lane = lanes.find((candidate) => candidate.laneId === laneId);
    if (!lane.resourceIds.includes(resourceId)) return safeHold(['LEASE_RESOURCE_NOT_DECLARED_BY_LANE']);
    leaseIds.add(leaseId);
    const projection = { leaseId, laneId, resourceId, mode, expiresAtUtc: lease.expiresAtUtc };
    if (expiresAt <= observedAt || observedAt - heartbeatAt > input.policy.staleAfterMs) {
      expiredLeases.push(projection);
      continue;
    }
    activeLeases.push(projection);
    if (mode === 'MUTATION') {
      if (mutationWriters.has(resourceId)) return safeHold(['MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE']);
      mutationWriters.set(resourceId, laneId);
    }
  }

  const blocked = lanes.filter((lane) => lane.state === 'BLOCKED' || lane.state === 'PAUSED');
  if (blocked.length >= 2) return safeHold(['MULTIPLE_BLOCKED_LANES_REQUIRE_SAFE_HOLD']);
  const healthy = lanes.filter((lane) => lane.state === 'RUNNING' || lane.state === 'IDLE');
  const idle = lanes.filter((lane) => lane.state === 'IDLE');
  const currentWidth = lanes.length;
  if (currentWidth < input.policy.minWidth) return safeHold(['WIDTH_BELOW_FIVE']);

  const bottlenecks = [];
  for (const lane of blocked) {
    bottlenecks.push({
      code: 'LANE_BLOCKED',
      severity: lane.criticalPath ? 'HIGH' : 'MEDIUM',
      laneId: lane.laneId,
      role: lane.role,
      queueAgeMs: lane.oldestQueueAgeMs,
      waitTimeMs: lane.waitTimeMs,
    });
  }
  for (const lane of lanes) {
    if (lane.oldestQueueAgeMs >= input.policy.queueAgePressureMs) {
      bottlenecks.push({
        code: 'QUEUE_AGE_PRESSURE', severity: lane.criticalPath ? 'HIGH' : 'MEDIUM',
        laneId: lane.laneId, role: lane.role,
        queueAgeMs: lane.oldestQueueAgeMs, waitTimeMs: lane.waitTimeMs,
      });
    }
    if (lane.waitTimeMs >= input.policy.waitPressureMs) {
      bottlenecks.push({
        code: 'WAIT_TIME_PRESSURE', severity: lane.criticalPath ? 'HIGH' : 'MEDIUM',
        laneId: lane.laneId, role: lane.role,
        queueAgeMs: lane.oldestQueueAgeMs, waitTimeMs: lane.waitTimeMs,
      });
    }
    if (!lane.capacityHealthy) {
      bottlenecks.push({
        code: 'LANE_CAPACITY_PRESSURE', severity: 'MEDIUM', laneId: lane.laneId,
        role: lane.role, queueAgeMs: lane.oldestQueueAgeMs, waitTimeMs: lane.waitTimeMs,
      });
    }
  }
  for (const lease of expiredLeases) {
    const lane = lanes.find((candidate) => candidate.laneId === lease.laneId);
    bottlenecks.push({
      code: 'LEASE_EXPIRED_OR_STALE', severity: 'MEDIUM', laneId: lease.laneId,
      role: lane.role, queueAgeMs: lane.oldestQueueAgeMs, waitTimeMs: lane.waitTimeMs,
    });
  }
  const capacityPressure = !input.capacity.githubHealthy
    || !input.capacity.providerHealthy
    || input.capacity.cpuPressure
    || input.capacity.memoryPressure
    || input.capacity.rateLimitPressure
    || input.capacity.costPressure;
  if (capacityPressure) {
    bottlenecks.push({
      code: 'FLEET_CAPACITY_PRESSURE', severity: 'HIGH', laneId: null, role: null,
      queueAgeMs: 0, waitTimeMs: 0,
    });
  }
  bottlenecks.sort((left, right) => severityRank(left.severity) - severityRank(right.severity)
    || right.queueAgeMs - left.queueAgeMs
    || right.waitTimeMs - left.waitTimeMs
    || left.code.localeCompare(right.code)
    || String(left.laneId).localeCompare(String(right.laneId)));

  const cooldownElapsed = observedAt - Date.parse(input.policy.lastWidthChangeAtUtc)
    >= input.policy.cooldownMs;
  const spareIdle = idle.length;
  const scaleOutDemand = Math.max(0, input.demand.readyNonConflictingWork - spareIdle);
  let nextAction = 'HOLD_WIDTH_SHADOW';
  let recommendedWidth = currentWidth;
  const reasonCodes = [];
  if (blocked.length === 1) {
    nextAction = 'CONTINUE_RESOURCE_DISJOINT_SHADOW';
    reasonCodes.push('ONE_BLOCKED_LANE_ISOLATED');
  } else if (capacityPressure || !input.capacity.battleBridgeHealthy) {
    nextAction = 'HOLD_WIDTH_SHADOW';
    reasonCodes.push('CAPACITY_PRESSURE_PREVENTS_SCALE_OUT');
  } else if (scaleOutDemand > 0 && currentWidth < input.policy.maxWidth && cooldownElapsed) {
    recommendedWidth = Math.min(input.policy.maxWidth, currentWidth + scaleOutDemand);
    nextAction = 'SCALE_OUT_CANDIDATE_SHADOW';
    reasonCodes.push('ELIGIBLE_NON_CONFLICTING_WORK_EXCEEDS_IDLE_WIDTH');
  } else if (currentWidth > input.policy.minWidth
    && input.demand.readyNonConflictingWork === 0
    && idle.length >= currentWidth - input.policy.minWidth
    && cooldownElapsed) {
    recommendedWidth = input.policy.minWidth;
    nextAction = 'SCALE_IN_CANDIDATE_SHADOW';
    reasonCodes.push('EXCESS_IDLE_WIDTH_CAN_RETIRE_TO_FIVE');
  } else if (!cooldownElapsed) {
    reasonCodes.push('WIDTH_COOLDOWN_ACTIVE');
  } else {
    reasonCodes.push('CURRENT_WIDTH_MATCHES_DEMAND');
  }

  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_BOTTLENECK_METRICS_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'METRICS_READY_SHADOW',
    sourceHead,
    sourceTree,
    observedAtUtc: input.observedAtUtc,
    currentWidth,
    healthyWidth: healthy.length,
    blockedWidth: blocked.length,
    readyQueueDepth: input.demand.readyNonConflictingWork,
    blockedQueueDepth: input.demand.blockedWork,
    criticalPathDepth: input.demand.criticalPathWork,
    oldestQueueAgeMs: Math.max(0, ...lanes.map((lane) => lane.oldestQueueAgeMs)),
    maximumWaitTimeMs: Math.max(0, ...lanes.map((lane) => lane.waitTimeMs)),
    recommendedWidth,
    nextAction,
    cooldownElapsed,
    activeLanes: Object.freeze(lanes
      .map((lane) => Object.freeze({
        laneId: lane.laneId,
        role: lane.role,
        state: lane.state,
        provider: text(lane.provider, 120),
        correlationId: lane.correlationId,
        resourceIds: Object.freeze([...lane.resourceIds].sort()),
      }))
      .sort((left, right) => left.laneId.localeCompare(right.laneId))),
    activeLeases: Object.freeze(activeLeases
      .map((lease) => Object.freeze(lease))
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId)
        || left.leaseId.localeCompare(right.leaseId))),
    bottlenecks: Object.freeze(bottlenecks.map((bottleneck) => Object.freeze(bottleneck))),
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze(reasonCodes),
    finalVerdict: 'ELASTIC_FIVE_LANE_BOTTLENECK_METRICS_SHADOW_READY_NO_AUTHORITY',
  });
}

export function projectElasticFiveLaneBottleneckMetricsShadowV1(input = {}) {
  try {
    return project(input);
  } catch {
    return safeHold(['BOTTLENECK_METRICS_INPUT_INSPECTION_FAILED']);
  }
}
