import {
  CODEX_CAPACITY_DECISION,
  CODEX_ROUTE,
  CODEX_TASK_CLASS,
  buildCodexCapacityProjection,
} from './codexCapacityGovernorV1.mjs';

export const METER_AWARE_CODEX_DISPATCHER_SCHEMA_VERSION = 'stephanos.meter-aware-codex-dispatcher.v1';

export const METER_AWARE_DISPATCH_STATE = Object.freeze({
  READY_FOR_CODEX: 'READY_FOR_CODEX',
  ROUTED_ZERO_COST: 'ROUTED_ZERO_COST',
  WAITING_FOR_CAPACITY: 'WAITING_FOR_CAPACITY',
  RESET_ACTION_READY: 'RESET_ACTION_READY',
  CAPACITY_UNKNOWN: 'CAPACITY_UNKNOWN',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function buildCapacityTaskFromQueueRecord(record = {}, input = {}) {
  return Object.freeze({
    taskId: text(record.jobId, `issue-${record.issueNumber || 'unknown'}`),
    title: text(input.title, record.prompt || `Issue #${record.issueNumber || 'unknown'}`),
    taskClass: input.taskClass || CODEX_TASK_CLASS.FOCUSED_REPAIR,
    capabilityValue: input.capabilityValue === undefined ? 70 : input.capabilityValue,
    complexityMultiplier: input.complexityMultiplier === undefined ? 1 : input.complexityMultiplier,
    zeroCostCapable: input.zeroCostCapable,
    battleBridgeCapable: input.battleBridgeCapable,
    preferredRoute: input.preferredRoute,
  });
}

function stateFor(capacity) {
  if (capacity.decision === CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED) return METER_AWARE_DISPATCH_STATE.READY_FOR_CODEX;
  if (capacity.decision === CODEX_CAPACITY_DECISION.CODEX_ROUTE_ZERO_COST) return METER_AWARE_DISPATCH_STATE.ROUTED_ZERO_COST;
  if (capacity.decision === CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW) return METER_AWARE_DISPATCH_STATE.RESET_ACTION_READY;
  if (capacity.decision === CODEX_CAPACITY_DECISION.CODEX_CAPACITY_UNKNOWN) return METER_AWARE_DISPATCH_STATE.CAPACITY_UNKNOWN;
  return METER_AWARE_DISPATCH_STATE.WAITING_FOR_CAPACITY;
}

export function createMeterAwareDispatchDecision(input = {}) {
  const record = input.queueRecord || input.queueRecords?.[0] || {};
  const task = input.capacityTask || buildCapacityTaskFromQueueRecord(record, input.taskProfile || {});
  const capacity = input.capacityProjection || buildCodexCapacityProjection({
    ...(input.capacity || {}),
    tasks: input.capacity?.tasks || [task],
  });
  const state = stateFor(capacity);

  if (!capacity.dispatchAllowed) {
    return Object.freeze({
      schemaVersion: METER_AWARE_CODEX_DISPATCHER_SCHEMA_VERSION,
      kind: 'stephanos.meter_aware_codex_dispatcher.decision',
      dispatcherInvoked: false,
      state,
      decision: capacity.decision,
      selectedRoute: capacity.selectedRoute,
      record,
      capacity,
      resetAction: capacity.resetPlan?.action || null,
      exactNextAction: capacity.exactNextAction,
      finalVerdict: state === METER_AWARE_DISPATCH_STATE.ROUTED_ZERO_COST
        ? 'CODEX_DISPATCH_SUPPRESSED_ZERO_COST_ROUTE'
        : (state === METER_AWARE_DISPATCH_STATE.RESET_ACTION_READY
          ? 'CODEX_DISPATCH_WAITING_FOR_BANKED_RESET'
          : 'CODEX_DISPATCH_WAITING_FOR_CAPACITY'),
    });
  }

  if (typeof input.dispatcher !== 'function') {
    return Object.freeze({
      schemaVersion: METER_AWARE_CODEX_DISPATCHER_SCHEMA_VERSION,
      kind: 'stephanos.meter_aware_codex_dispatcher.decision',
      dispatcherInvoked: false,
      state,
      decision: capacity.decision,
      selectedRoute: CODEX_ROUTE.CODEX,
      record,
      capacity,
      resetAction: null,
      exactNextAction: 'Invoke the approved automated Codex dispatcher with this capacity projection and record a consumption receipt.',
      finalVerdict: 'CODEX_DISPATCH_ALLOWED_AWAITING_DISPATCHER',
    });
  }

  const dispatchResult = input.dispatcher({ ...input, capacityProjection: capacity });
  return Object.freeze({
    schemaVersion: METER_AWARE_CODEX_DISPATCHER_SCHEMA_VERSION,
    kind: 'stephanos.meter_aware_codex_dispatcher.decision',
    dispatcherInvoked: true,
    state,
    decision: dispatchResult?.decision || capacity.decision,
    selectedRoute: CODEX_ROUTE.CODEX,
    capacity,
    dispatchResult,
    record: dispatchResult?.record || record,
    exactNextAction: capacity.exactNextAction,
    finalVerdict: dispatchResult?.finalVerdict || 'CODEX_DISPATCHER_RESULT_RECORDED',
  });
}

export const dispatchMeterAwareCodexJob = createMeterAwareDispatchDecision;
