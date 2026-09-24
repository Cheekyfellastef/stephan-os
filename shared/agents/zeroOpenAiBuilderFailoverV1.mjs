import {
  planContinuousCapacityRefillV1,
  validateProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';

export const ZERO_OPENAI_BUILDER_FAILOVER_V1_SCHEMA = 'stephanos.zero-openai-builder-failover.v1';
export const ZERO_OPENAI_PROVIDER_ROUTE_V1_SCHEMA = 'stephanos.provider-family-route.v1';

export const PROVIDER_FAMILIES_V1 = Object.freeze([
  'OPENAI',
  'GITHUB',
  'OPENCLAW',
  'FORGE',
  'STEPHANOS_NATIVE',
  'OTHER',
]);

export const PROVIDER_CAPABILITY_STATES_V1 = Object.freeze([
  'HEALTHY',
  'PARTIAL',
  'WRITE_BLOCKED',
  'CAPACITY_UNAVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
]);

export const PROVIDER_FAILOVER_CAPABILITIES_V1 = Object.freeze([
  'builderIgnition',
  'sourceImplementation',
  'publication',
  'review',
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,180}$/;
const SAFE_OPERATION = /^[a-z][a-z0-9._:-]{0,80}$/;
const CAPABILITY_KEYS = new Set(PROVIDER_FAILOVER_CAPABILITIES_V1);
const ROUTE_KEYS = new Set([
  'schemaVersion',
  'routeId',
  'adapterId',
  'providerFamily',
  'capabilityHealth',
  'qualifiedTaskClasses',
  'allowedOperations',
  'priority',
  'proofRef',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.size && keys.every((key) => expectedKeys.has(key));
}

function boundedPriority(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : 1_000;
}

function capabilityHealth(input = {}) {
  const output = {};
  for (const capability of PROVIDER_FAILOVER_CAPABILITIES_V1) {
    const state = text(input?.[capability], 'UNKNOWN').toUpperCase();
    output[capability] = PROVIDER_CAPABILITY_STATES_V1.includes(state) ? state : 'UNKNOWN';
  }
  return Object.freeze(output);
}

function taskScopeKey(task) {
  return JSON.stringify([
    task.repository,
    task.branch,
    task.expectedStartingHeadIfMutable || task.exactHeadIfReadOnly,
    [...task.allowedPaths].sort(),
  ]);
}

function zeroAuthority() {
  return Object.freeze({
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    publicationAllowed: false,
    reviewAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    credentialAccessAllowed: false,
    spendingAllowed: false,
  });
}

export function createProviderFamilyRouteV1(input = {}) {
  return Object.freeze({
    schemaVersion: ZERO_OPENAI_PROVIDER_ROUTE_V1_SCHEMA,
    routeId: text(input.routeId),
    adapterId: text(input.adapterId).toLowerCase(),
    providerFamily: text(input.providerFamily).toUpperCase(),
    capabilityHealth: capabilityHealth(input.capabilityHealth),
    qualifiedTaskClasses: Object.freeze(uniqueStrings(input.qualifiedTaskClasses).map((item) => item.toLowerCase())),
    allowedOperations: Object.freeze(uniqueStrings(input.allowedOperations).map((item) => item.toLowerCase())),
    priority: boundedPriority(input.priority),
    proofRef: text(input.proofRef),
  });
}

export function validateProviderFamilyRouteV1(route) {
  const errors = [];
  if (!isPlainObject(route)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['route-not-object']) });
  }
  if (!hasExactKeys(route, ROUTE_KEYS)) errors.push('route-fields-invalid');
  if (route.schemaVersion !== ZERO_OPENAI_PROVIDER_ROUTE_V1_SCHEMA) errors.push('route-schema-invalid');
  if (!SAFE_ID.test(text(route.routeId))) errors.push('route-id-invalid');
  if (!SAFE_ID.test(text(route.adapterId))) errors.push('adapter-id-invalid');
  if (!PROVIDER_FAMILIES_V1.includes(route.providerFamily)) errors.push('provider-family-invalid');
  if (!isPlainObject(route.capabilityHealth)
    || Object.keys(route.capabilityHealth).length !== CAPABILITY_KEYS.size
    || Object.keys(route.capabilityHealth).some((key) => !CAPABILITY_KEYS.has(key))
    || Object.values(route.capabilityHealth).some((state) => !PROVIDER_CAPABILITY_STATES_V1.includes(state))) {
    errors.push('capability-health-invalid');
  }
  if (!Array.isArray(route.qualifiedTaskClasses)
    || route.qualifiedTaskClasses.length === 0
    || route.qualifiedTaskClasses.some((item) => !SAFE_ID.test(text(item)))) {
    errors.push('qualified-task-classes-invalid');
  }
  if (!Array.isArray(route.allowedOperations)
    || route.allowedOperations.some((item) => !SAFE_OPERATION.test(text(item)))) {
    errors.push('allowed-operations-invalid');
  }
  if (!Number.isSafeInteger(route.priority) || route.priority < 0 || route.priority > 10_000) errors.push('priority-invalid');
  if (!SAFE_ID.test(text(route.proofRef))) errors.push('proof-ref-invalid');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function normalizedRoutes(input = {}) {
  const routes = Array.isArray(input.providerRoutes) ? input.providerRoutes : [];
  return routes.map((route) => {
    const normalized = route?.schemaVersion === ZERO_OPENAI_PROVIDER_ROUTE_V1_SCHEMA
      ? route
      : createProviderFamilyRouteV1(route);
    return { route: normalized, validation: validateProviderFamilyRouteV1(normalized) };
  });
}

function routeCanCarryTask(route, task, capability) {
  if (route.capabilityHealth?.[capability] !== 'HEALTHY') return false;
  if (!route.qualifiedTaskClasses.includes(task.taskClass)) return false;
  if (task.allowedOperations.some((operation) => !route.allowedOperations.includes(operation))) return false;
  return true;
}

function chooseRouteForTask(task, routeRecords, capability, { forceNonOpenAi = false } = {}) {
  const validRoutes = routeRecords
    .filter(({ validation }) => validation.valid)
    .map(({ route }) => route);
  const originalRoutes = validRoutes.filter((route) => route.adapterId === task.sourceAdapter);
  const originalHealthy = originalRoutes
    .filter((route) => routeCanCarryTask(route, task, capability))
    .sort((a, b) => a.priority - b.priority || a.routeId.localeCompare(b.routeId));
  const allowedOriginalHealthy = originalHealthy
    .filter((route) => !forceNonOpenAi || route.providerFamily !== 'OPENAI');

  if (allowedOriginalHealthy.length > 0) {
    return Object.freeze({
      selectedRoute: allowedOriginalHealthy[0],
      failover: false,
      originalProviderBlocked: false,
      blocker: '',
    });
  }

  const originalProviderBlocked = originalRoutes.some((route) => route.providerFamily === 'OPENAI'
    && (forceNonOpenAi || route.capabilityHealth?.[capability] !== 'HEALTHY'));
  const requireNonOpenAi = forceNonOpenAi || originalProviderBlocked;
  const alternatives = validRoutes
    .filter((route) => route.adapterId !== task.sourceAdapter || allowedOriginalHealthy.length === 0)
    .filter((route) => !requireNonOpenAi || route.providerFamily !== 'OPENAI')
    .filter((route) => routeCanCarryTask(route, task, capability))
    .sort((a, b) => a.priority - b.priority || a.routeId.localeCompare(b.routeId));

  if (alternatives.length > 0) {
    return Object.freeze({
      selectedRoute: alternatives[0],
      failover: alternatives[0].adapterId !== task.sourceAdapter || alternatives[0].providerFamily !== originalRoutes[0]?.providerFamily,
      originalProviderBlocked,
      blocker: '',
    });
  }

  return Object.freeze({
    selectedRoute: null,
    failover: false,
    originalProviderBlocked,
    blocker: originalRoutes.length === 0
      ? 'ORIGINAL_PROVIDER_ROUTE_UNPROVEN'
      : requireNonOpenAi
        ? 'NON_OPENAI_PARITY_GAP'
        : 'NO_HEALTHY_QUALIFIED_PROVIDER_ROUTE',
  });
}

function buildRouteEvaluation(input = {}, capability = 'sourceImplementation') {
  const routeRecords = normalizedRoutes(input);
  const candidates = Array.isArray(input.schedulerDecision?.selectedTasks)
    ? input.schedulerDecision.selectedTasks
    : [];
  const forceNonOpenAi = input.openAiBlackout === true;
  const routedTasks = [];
  const heldTasks = [];
  const routeByTaskId = new Map();

  for (const task of candidates) {
    const taskValidation = validateProviderNeutralTaskEnvelope(task);
    if (!taskValidation.valid) {
      heldTasks.push(Object.freeze({ taskId: text(task?.taskId), reason: 'TASK_ENVELOPE_INVALID' }));
      continue;
    }
    const choice = chooseRouteForTask(task, routeRecords, capability, { forceNonOpenAi });
    if (!choice.selectedRoute) {
      heldTasks.push(Object.freeze({ taskId: task.taskId, reason: choice.blocker }));
      continue;
    }
    routedTasks.push(task);
    routeByTaskId.set(task.taskId, Object.freeze({
      routeId: choice.selectedRoute.routeId,
      adapterId: choice.selectedRoute.adapterId,
      providerFamily: choice.selectedRoute.providerFamily,
      proofRef: choice.selectedRoute.proofRef,
      failover: choice.failover,
      originalProviderBlocked: choice.originalProviderBlocked,
    }));
  }

  return Object.freeze({
    routedTasks: Object.freeze(routedTasks),
    heldTasks: Object.freeze(heldTasks),
    routeByTaskId,
    invalidRoutes: Object.freeze(routeRecords
      .filter(({ validation }) => !validation.valid)
      .map(({ route, validation }) => Object.freeze({ routeId: route.routeId, errors: validation.errors }))),
  });
}

export function planProviderIndependentCapacityRefillV1(input = {}) {
  const capability = text(input.requiredCapability, 'sourceImplementation');
  if (!CAPABILITY_KEYS.has(capability)) {
    return Object.freeze({
      schemaVersion: ZERO_OPENAI_BUILDER_FAILOVER_V1_SCHEMA,
      finalVerdict: 'PROVIDER_INDEPENDENT_REFILL_BLOCKED',
      blocker: 'REQUIRED_CAPABILITY_INVALID',
      refillRequests: Object.freeze([]),
      heldTasks: Object.freeze([]),
      invalidRoutes: Object.freeze([]),
      authority: zeroAuthority(),
    });
  }
  const routeEvaluation = buildRouteEvaluation(input, capability);
  const refill = planContinuousCapacityRefillV1({
    releaseEvent: input.releaseEvent,
    seenEventKeys: input.seenEventKeys,
    activeLeaseIds: input.activeLeaseIds,
    schedulerDecision: { selectedTasks: routeEvaluation.routedTasks },
  });
  const refillRequests = refill.refillRequests.map((request) => Object.freeze({
    ...request,
    selectedRoute: routeEvaluation.routeByTaskId.get(request.taskId),
  }));
  const heldTasks = Object.freeze([
    ...routeEvaluation.heldTasks,
    ...refill.heldTasks,
  ]);
  let finalVerdict = 'PROVIDER_INDEPENDENT_REFILL_HELD';
  if (refill.finalVerdict === 'CONTINUOUS_CAPACITY_REFILL_READY') finalVerdict = 'PROVIDER_INDEPENDENT_REFILL_READY';
  else if (refill.finalVerdict === 'CONTINUOUS_CAPACITY_REFILL_ALREADY_EVALUATED') finalVerdict = 'PROVIDER_INDEPENDENT_REFILL_ALREADY_EVALUATED';
  else if (refill.finalVerdict === 'CONTINUOUS_CAPACITY_REFILL_IDLE_NO_ELIGIBLE_WORK' && routeEvaluation.heldTasks.length === 0) finalVerdict = 'PROVIDER_INDEPENDENT_REFILL_IDLE_NO_ELIGIBLE_WORK';
  else if (refill.finalVerdict === 'CONTINUOUS_CAPACITY_REFILL_BLOCKED') finalVerdict = 'PROVIDER_INDEPENDENT_REFILL_BLOCKED';

  return Object.freeze({
    schemaVersion: ZERO_OPENAI_BUILDER_FAILOVER_V1_SCHEMA,
    capability,
    openAiBlackout: input.openAiBlackout === true,
    eventKey: refill.eventKey,
    refillRequests: Object.freeze(refillRequests),
    heldTasks,
    invalidRoutes: routeEvaluation.invalidRoutes,
    blocker: refill.blocker || '',
    authority: zeroAuthority(),
    finalVerdict,
  });
}

export function planProviderIndependentBuilderIgnitionV1(input = {}) {
  const ignitionId = text(input.ignitionId);
  const correlationId = text(input.correlationId);
  const ignitionKey = `BUILDER_IGNITION:${ignitionId}:${correlationId}`;
  const seenIgnitionKeys = new Set(uniqueStrings(input.seenIgnitionKeys));
  const requestedSlots = Number.parseInt(input.requestedSlots, 10);
  const boundedSlots = Number.isSafeInteger(requestedSlots) && requestedSlots >= 1 && requestedSlots <= 5
    ? requestedSlots
    : 1;
  const base = {
    schemaVersion: ZERO_OPENAI_BUILDER_FAILOVER_V1_SCHEMA,
    ignitionKey,
    ignitionRequests: Object.freeze([]),
    heldTasks: Object.freeze([]),
    invalidRoutes: Object.freeze([]),
    authority: zeroAuthority(),
  };
  if (!SAFE_ID.test(ignitionId) || !SAFE_ID.test(correlationId)) {
    return Object.freeze({ ...base, blocker: 'BUILDER_IGNITION_IDENTITY_INVALID', finalVerdict: 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_BLOCKED' });
  }
  if (seenIgnitionKeys.has(ignitionKey)) {
    return Object.freeze({ ...base, blocker: '', finalVerdict: 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_ALREADY_EVALUATED' });
  }

  const capability = text(input.requiredCapability, 'sourceImplementation');
  if (!CAPABILITY_KEYS.has(capability)) {
    return Object.freeze({ ...base, blocker: 'REQUIRED_CAPABILITY_INVALID', finalVerdict: 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_BLOCKED' });
  }
  const routeEvaluation = buildRouteEvaluation(input, capability);
  const activeLeaseIds = new Set(uniqueStrings(input.activeLeaseIds));
  const selectedLeaseIds = new Set();
  const selectedScopes = new Set();
  const selectedTaskIds = new Set();
  const selected = [];
  const held = [...routeEvaluation.heldTasks];

  for (const task of routeEvaluation.routedTasks) {
    if (selectedTaskIds.has(task.taskId)) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'TASK_ID_DUPLICATE' }));
      continue;
    }
    if (task.resourceLeaseIds.some((leaseId) => activeLeaseIds.has(leaseId))) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'RESOURCE_LEASE_ACTIVE' }));
      continue;
    }
    if (task.resourceLeaseIds.some((leaseId) => selectedLeaseIds.has(leaseId))) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'RESOURCE_LEASE_DUPLICATE' }));
      continue;
    }
    const scope = taskScopeKey(task);
    if (selectedScopes.has(scope)) {
      held.push(Object.freeze({ taskId: task.taskId, reason: 'RESOURCE_SCOPE_DUPLICATE' }));
      continue;
    }
    selectedTaskIds.add(task.taskId);
    selectedScopes.add(scope);
    for (const leaseId of task.resourceLeaseIds) selectedLeaseIds.add(leaseId);
    selected.push(Object.freeze({
      missionId: task.missionId,
      goalId: task.goalId,
      taskId: task.taskId,
      correlationId: task.correlationId,
      taskClass: task.taskClass,
      exactSourceIdentity: task.expectedStartingHeadIfMutable || task.exactHeadIfReadOnly,
      resourceLeaseIds: task.resourceLeaseIds,
      selectedRoute: routeEvaluation.routeByTaskId.get(task.taskId),
      taskEnvelope: task,
    }));
    if (selected.length >= boundedSlots) break;
  }

  return Object.freeze({
    ...base,
    blocker: '',
    capability,
    openAiBlackout: input.openAiBlackout === true,
    ignitionRequests: Object.freeze(selected),
    heldTasks: Object.freeze(held),
    invalidRoutes: routeEvaluation.invalidRoutes,
    finalVerdict: selected.length > 0
      ? 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY'
      : routeEvaluation.routedTasks.length === 0 && held.length === 0
        ? 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_IDLE_NO_ELIGIBLE_WORK'
        : 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_HELD',
  });
}
