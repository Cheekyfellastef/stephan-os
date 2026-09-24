export const ELASTIC_FIVE_LANE_FLEET_CONTROL_SHADOW_SCHEMA_VERSION =
  'stephanos.elastic-five-lane-fleet-control-shadow.v1';

export const ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1 = Object.freeze({
  RUN: 'RUN',
  STOP: 'STOP',
  PAUSE: 'PAUSE',
  SAFE_HOLD: 'SAFE_HOLD',
});

const SHA40 = /^[0-9a-f]{40}$/;
const GLOBAL_SIGNALS = new Set([
  ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.STOP,
  ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.PAUSE,
  ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.SAFE_HOLD,
]);

const ZERO_AUTHORITY = Object.freeze({
  canonicalControllerAuthorityTransferred: false,
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  providerQualificationAllowed: false,
  fiveLaneCutoverAllowed: false,
});

function text(value, limit = 160) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function frozenLane(lane, action, reasonCode) {
  return Object.freeze({
    laneId: text(lane?.laneId, 80),
    role: text(lane?.role, 80),
    resourceId: text(lane?.resourceId, 160),
    writerLeaseOwner: text(lane?.writerLeaseOwner, 120),
    inputState: text(lane?.state || 'UNKNOWN', 40).toUpperCase(),
    action,
    reasonCode,
    mutationAllowed: false,
  });
}

function safeHold(lanes, reasonCode, signal = 'SAFE_HOLD') {
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_FLEET_CONTROL_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    signal,
    state: 'SAFE_HOLD',
    laneCount: lanes.length,
    lanes: Object.freeze(lanes.map((lane) => frozenLane(lane, 'SAFE_HOLD', reasonCode))),
    blockedLaneIsolationProven: false,
    fleetPropagationProven: true,
    oneWriterPerResourceProven: false,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([reasonCode]),
    finalVerdict: 'ELASTIC_FIVE_LANE_FLEET_CONTROL_SHADOW_SAFE_HOLD',
  });
}

function validateLaneInventory(lanes) {
  if (!Array.isArray(lanes) || lanes.length < 5) return 'FIVE_LANE_MINIMUM_NOT_PROVEN';
  const laneIds = new Set();
  const writerByResource = new Map();
  for (const lane of lanes) {
    const laneId = text(lane?.laneId, 80);
    const resourceId = text(lane?.resourceId, 160);
    const writer = text(lane?.writerLeaseOwner, 120);
    if (!laneId || !resourceId) return 'LANE_IDENTITY_INCOMPLETE';
    if (laneIds.has(laneId)) return 'DUPLICATE_LANE_ID';
    laneIds.add(laneId);
    if (!writer) continue;
    const existing = writerByResource.get(resourceId);
    if (existing && existing !== writer) return 'MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE';
    writerByResource.set(resourceId, writer);
  }
  return '';
}

export function projectElasticFiveLaneFleetControlShadowV1(input = {}) {
  const lanes = Array.isArray(input.lanes) ? input.lanes : [];
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  const requestedSignal = text(input.signal || 'SAFE_HOLD', 40).toUpperCase();
  const signal = Object.values(ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1).includes(requestedSignal)
    ? requestedSignal
    : ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.SAFE_HOLD;

  if (!SHA40.test(sourceHead)) return safeHold(lanes, 'EXACT_SOURCE_HEAD_UNPROVEN', signal);
  const inventoryBlocker = validateLaneInventory(lanes);
  if (inventoryBlocker) return safeHold(lanes, inventoryBlocker, signal);
  if (requestedSignal !== signal) return safeHold(lanes, 'UNKNOWN_FLEET_SIGNAL', signal);

  if (GLOBAL_SIGNALS.has(signal)) {
    return Object.freeze({
      schemaVersion: ELASTIC_FIVE_LANE_FLEET_CONTROL_SHADOW_SCHEMA_VERSION,
      shadowOnly: true,
      sourceHead,
      signal,
      state: signal === 'STOP' ? 'STOPPED' : signal,
      laneCount: lanes.length,
      lanes: Object.freeze(lanes.map((lane) => frozenLane(
        lane,
        signal === 'STOP' ? 'STOPPED' : signal,
        `FLEET_${signal}_PROPAGATED`,
      ))),
      blockedLaneIsolationProven: false,
      fleetPropagationProven: true,
      oneWriterPerResourceProven: true,
      authority: ZERO_AUTHORITY,
      reasonCodes: Object.freeze([`FLEET_${signal}_PROPAGATED`]),
      finalVerdict: `ELASTIC_FIVE_LANE_FLEET_${signal}_SHADOW_PROVEN`,
    });
  }

  const projected = lanes.map((lane) => {
    const state = text(lane?.state || 'UNKNOWN', 40).toUpperCase();
    if (state === 'BLOCKED') return frozenLane(lane, 'BLOCKED', 'LANE_LOCAL_BLOCKER_ISOLATED');
    if (state === 'ELIGIBLE' || state === 'RUNNING' || state === 'IDLE') {
      return frozenLane(lane, 'CONTINUE_SHADOW', 'RESOURCE_DISJOINT_CONTINUATION');
    }
    return frozenLane(lane, 'SAFE_HOLD', 'LANE_STATE_UNKNOWN');
  });
  const blockedCount = projected.filter((lane) => lane.action === 'BLOCKED').length;
  const continuingCount = projected.filter((lane) => lane.action === 'CONTINUE_SHADOW').length;
  const unknownCount = projected.filter((lane) => lane.action === 'SAFE_HOLD').length;

  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_FLEET_CONTROL_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    sourceHead,
    signal,
    state: unknownCount > 0 ? 'SAFE_HOLD' : 'RUNNING_SHADOW',
    laneCount: lanes.length,
    lanes: Object.freeze(projected),
    blockedLaneIsolationProven: blockedCount > 0 && continuingCount > 0 && unknownCount === 0,
    fleetPropagationProven: false,
    oneWriterPerResourceProven: true,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze(unknownCount > 0 ? ['LANE_STATE_UNKNOWN'] : []),
    finalVerdict: unknownCount > 0
      ? 'ELASTIC_FIVE_LANE_FLEET_CONTROL_SHADOW_SAFE_HOLD'
      : 'ELASTIC_FIVE_LANE_BLOCKED_LANE_ISOLATION_SHADOW_PROVEN',
  });
}
