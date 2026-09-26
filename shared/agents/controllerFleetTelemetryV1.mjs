import { createSharedWorkspaceProofRecord, createSharedWorkspaceStatusRecord } from './sharedAgentWorkspaceStore.mjs';

export const CONTROLLER_ACTIVITY_SCHEMA_VERSION = 'stephanos.controller-activity.v1';
export const CONTROLLER_ACTIVITY_PROOF_SCHEMA_VERSION = 'stephanos.controller-activity-proof.v1';
export const CONTROLLER_FLEET_TELEMETRY_SCHEMA_VERSION = 'stephanos.controller-fleet-telemetry.v1';

export const CANONICAL_CONTROLLER_FLEET = Object.freeze([
  Object.freeze({ controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01', title: 'Stephanos Autonomous Goal Builder' }),
  Object.freeze({ controllerId: '6aa425918c8881918c1763ee6acf3cb6', title: 'Stephanos Hourly Build Controller' }),
  Object.freeze({ controllerId: '6a9bb24c04748191ada675a686f3b3fa', title: 'Stephanos Elastic Product Build' }),
  Object.freeze({ controllerId: '6a859e0d499c8191aeeee31838d64118', title: 'OpenClaw Autonomy Controller' }),
  Object.freeze({ controllerId: '6a6f32b20d8c8191bcb991d043d967f6', title: 'VR Research & Battle Bridge Build' }),
]);

const DEFAULT_STALE_AFTER_MS = 90 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const TARGET_MATERIAL_LANES = 15;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function safeFragment(value, fallback = 'unknown') {
  const normalized = text(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80) || fallback;
}

function latestControllerRecord(statusRecords, controllerId) {
  return (Array.isArray(statusRecords) ? statusRecords : [])
    .filter((record) => text(record?.kind) === 'stephanos.shared_workspace.status')
    .filter((record) => record?.controllerActivity?.schemaVersion === CONTROLLER_ACTIVITY_SCHEMA_VERSION)
    .filter((record) => text(record?.controllerActivity?.controllerId) === controllerId)
    .sort((a, b) => (timestampMs(b?.timestampUtc) || 0) - (timestampMs(a?.timestampUtc) || 0))[0] || null;
}

function controllerRecords(statusRecords, controllerId) {
  return (Array.isArray(statusRecords) ? statusRecords : [])
    .filter((record) => text(record?.kind) === 'stephanos.shared_workspace.status')
    .filter((record) => record?.controllerActivity?.schemaVersion === CONTROLLER_ACTIVITY_SCHEMA_VERSION)
    .filter((record) => text(record?.controllerActivity?.controllerId) === controllerId)
    .sort((a, b) => (timestampMs(a?.timestampUtc) || 0) - (timestampMs(b?.timestampUtc) || 0));
}

function laneFacts(value) {
  return (Array.isArray(value) ? value : []).slice(0, TARGET_MATERIAL_LANES).map((lane) => Object.freeze({
    laneId: text(lane?.laneId),
    goalId: text(lane?.goalId),
    prNumber: count(lane?.prNumber) || null,
    resourceId: text(lane?.resourceId),
    workerId: text(lane?.workerId),
    provider: text(lane?.provider),
    lastMaterialAction: text(lane?.lastMaterialAction),
    lastMaterialActionAtUtc: text(lane?.lastMaterialActionAtUtc),
    proofRef: text(lane?.proofRef),
    blocker: text(lane?.blocker),
    retryState: text(lane?.retryState),
    failoverState: text(lane?.failoverState),
    nextAutomaticAction: text(lane?.nextAutomaticAction),
  }));
}

function proofReferenceSet(record = {}) {
  const refs = new Set([...list(record.refs), ...list(record.proofRefs)]);
  const proofId = text(record.proofId);
  if (proofId) {
    refs.add(proofId);
    refs.add(`proof/${proofId}`);
  }
  return refs;
}

function verifiedProofRefs(activity, claimedProofRefs, proofRecords, nowMs, staleAfterMs) {
  const controllerId = text(activity?.controllerId);
  const runId = text(activity?.runId);
  if (!controllerId || !runId || runId === 'UNKNOWN') return [];
  const runStartedMs = timestampMs(activity?.runStartedAtUtc);
  const claimed = new Set(claimedProofRefs);

  const verified = new Set();
  for (const record of Array.isArray(proofRecords) ? proofRecords : []) {
    if (text(record.kind) !== 'stephanos.shared_workspace.proof') continue;
    const binding = record?.controllerActivityProof;
    if (binding?.schemaVersion !== CONTROLLER_ACTIVITY_PROOF_SCHEMA_VERSION) continue;
    if (text(binding.controllerId) !== controllerId || text(binding.runId) !== runId) continue;
    if (text(record.correlationId) !== runId) continue;
    if (text(record.status).toUpperCase() !== 'PASS') continue;
    const proofMaterialActions = Number(binding.materialActionsSucceeded);
    const claimedMaterialActions = count(activity?.materialActionsSucceeded);
    if (!Number.isSafeInteger(proofMaterialActions) || proofMaterialActions < 0
      || proofMaterialActions !== claimedMaterialActions) continue;

    const proofMs = timestampMs(record.timestampUtc);
    if (!Number.isFinite(proofMs)) continue;
    const ageMs = nowMs - proofMs;
    if (ageMs > staleAfterMs || ageMs < -MAX_CLOCK_SKEW_MS) continue;
    if (Number.isFinite(runStartedMs) && proofMs + MAX_CLOCK_SKEW_MS < runStartedMs) continue;

    const refs = proofReferenceSet(record);
    for (const ref of claimed) if (refs.has(ref)) verified.add(ref);
  }
  return [...verified];
}

const HEALTHY_EXECUTION_STATES = new Set(['RUNNING', 'ACTIVE', 'READY', 'IDLE']);

function blockingExecutionState(value) {
  return /BLOCK|FAIL|FAULT|SAFE[_ -]?HOLD|PAUS|STOP|WAIT/.test(text(value).toUpperCase());
}

function recognizedHealthyExecutionState(value) {
  return HEALTHY_EXECUTION_STATES.has(text(value).toUpperCase());
}

export function createControllerActivityProofRecord(input = {}) {
  const controllerId = text(input.controllerId);
  const runId = text(input.runId);
  const proofId = text(input.proofId, `controller-${safeFragment(controllerId.slice(0, 12))}-run-${safeFragment(runId)}`);
  const proofRef = text(input.proofRef, `proof/${proofId}`);
  return Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId,
      participantId: input.participantId || 'controller-activity-verifier',
      timestampUtc: input.timestampUtc || 'pending',
      correlationId: runId,
      relatedIssue: input.relatedIssue || '#1557',
      relatedPr: input.relatedPr || '',
      status: input.status || 'PASS',
      summary: input.summary || `Verified material controller activity for ${controllerId || 'unknown controller'} run ${runId || 'unknown run'}.`,
      refs: list(input.refs),
      proofRefs: [proofRef, ...list(input.proofRefs).filter((ref) => ref !== proofRef)],
    }),
    controllerActivityProof: Object.freeze({
      schemaVersion: CONTROLLER_ACTIVITY_PROOF_SCHEMA_VERSION,
      controllerId,
      runId,
      materialActionsSucceeded: count(input.materialActionsSucceeded),
    }),
  });
}

export function createControllerActivityStatusRecord(input = {}) {
  const controllerId = text(input.controllerId);
  const canonical = CANONICAL_CONTROLLER_FLEET.find((item) => item.controllerId === controllerId);
  const title = text(input.title, canonical?.title || 'Unknown controller');
  const proofRefs = list(input.proofRefs);
  const activity = Object.freeze({
    schemaVersion: CONTROLLER_ACTIVITY_SCHEMA_VERSION,
    controllerId,
    title,
    runId: text(input.runId, 'UNKNOWN'),
    runStartedAtUtc: text(input.runStartedAtUtc, input.timestampUtc || 'pending'),
    runCompletedAtUtc: text(input.runCompletedAtUtc, input.timestampUtc || 'pending'),
    observedEnabled: typeof input.observedEnabled === 'boolean' ? input.observedEnabled : null,
    executionState: text(input.executionState, 'UNKNOWN').toUpperCase(),
    materialActionsSucceeded: count(input.materialActionsSucceeded),
    goalsAdvanced: count(input.goalsAdvanced),
    sourceChanges: count(input.sourceChanges),
    reviewsAdvanced: count(input.reviewsAdvanced),
    mergesCompleted: count(input.mergesCompleted),
    activeLanes: list(input.activeLanes),
    parkedLanes: list(input.parkedLanes),
    materialLanes: laneFacts(input.materialLanes),
    targetMaterialLanes: count(input.targetMaterialLanes) || TARGET_MATERIAL_LANES,
    safeEligibleWorkRemaining: count(input.safeEligibleWorkRemaining),
    blocker: text(input.blocker),
    lastMaterialActionAtUtc: text(input.lastMaterialActionAtUtc),
    nextAutomaticAction: text(input.nextAutomaticAction, 'Reconcile current goal and lane truth.'),
    proofRefs,
  });
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: input.statusId || `controller-${controllerId || 'unknown'}-activity`,
      participantId: input.participantId || 'chatgpt-controller',
      timestampUtc: input.timestampUtc || input.runCompletedAtUtc || 'pending',
      relatedIssue: input.relatedIssue || '#1557',
      status: activity.executionState,
      summary: input.summary || `${title}: ${activity.executionState}; material=${activity.materialActionsSucceeded}; activeLanes=${activity.activeLanes.length}.`,
      proofRefs,
    }),
    controllerActivity: activity,
  });
}

function projectOneController(canonical, statusRecords, proofRecords, nowMs, staleAfterMs) {
  const record = latestControllerRecord(statusRecords, canonical.controllerId);
  if (!record) {
    return Object.freeze({
      ...canonical,
      freshness: 'UNKNOWN',
      activityState: 'UNKNOWN',
      trafficLight: 'UNKNOWN',
      observedEnabled: null,
      materialActionsSucceeded: 0,
      activeLanes: [],
      parkedLanes: [],
      materialLanes: [],
      targetMaterialLanes: TARGET_MATERIAL_LANES,
      safeEligibleWorkRemaining: 0,
      blocker: 'CONTROLLER_ACTIVITY_RECORD_MISSING',
      proofRefs: [],
      claimedProofRefs: [],
      enablementTransitions: [],
      livenessState: 'UNKNOWN',
      exactNextAction: 'Publish a fresh controller activity receipt into Shared Workspace.',
    });
  }

  const activity = record.controllerActivity || {};
  const history = controllerRecords(statusRecords, canonical.controllerId);
  const recordMs = timestampMs(record.timestampUtc);
  const futureDated = Number.isFinite(recordMs) && recordMs - nowMs > MAX_CLOCK_SKEW_MS;
  const ageMs = Number.isFinite(recordMs) && !futureDated ? Math.max(0, nowMs - recordMs) : null;
  const stale = ageMs === null || ageMs > staleAfterMs;
  const materialActionsSucceeded = count(activity.materialActionsSucceeded);
  const claimedProofRefs = list(activity.proofRefs?.length ? activity.proofRefs : record.proofRefs);
  const proofRefs = verifiedProofRefs(activity, claimedProofRefs, proofRecords, nowMs, staleAfterMs);
  const activeLanes = list(activity.activeLanes);
  const parkedLanes = list(activity.parkedLanes);
  const materialLanes = laneFacts(activity.materialLanes);
  const safeEligibleWorkRemaining = count(activity.safeEligibleWorkRemaining);
  const observedEnabled = typeof activity.observedEnabled === 'boolean' ? activity.observedEnabled : null;
  const executionState = text(activity.executionState, 'UNKNOWN').toUpperCase();
  const workspaceStatus = text(record.status, 'UNKNOWN').toUpperCase();
  const executionStateAgrees = workspaceStatus === executionState;
  const enablementTransitions = history.flatMap((item, index) => {
    const enabled = item?.controllerActivity?.observedEnabled;
    if (typeof enabled !== 'boolean') return [];
    const previous = history.slice(0, index).reverse()
      .find((candidate) => typeof candidate?.controllerActivity?.observedEnabled === 'boolean');
    if (previous?.controllerActivity?.observedEnabled === enabled) return [];
    return [Object.freeze({ observedEnabled: enabled, timestampUtc: text(item.timestampUtc), statusId: text(item.statusId) })];
  });
  const recoveredAfterDisabled = observedEnabled === true
    && enablementTransitions.some((transition) => transition.observedEnabled === false);

  let activityState = 'IDLE_NO_ELIGIBLE_WORK';
  let trafficLight = 'GREEN';
  let blocker = text(activity.blocker);
  let exactNextAction = text(activity.nextAutomaticAction, 'Continue the next bounded controller cycle.');

  if (futureDated) {
    activityState = 'FUTURE_HEARTBEAT';
    trafficLight = 'RED';
    blocker = blocker || 'CONTROLLER_ACTIVITY_TIMESTAMP_IN_FUTURE';
    exactNextAction = 'Reject the future-dated controller receipt and publish fresh current-time evidence.';
  } else if (stale) {
    activityState = 'STALE_HEARTBEAT';
    trafficLight = 'RED';
    blocker = blocker || 'CONTROLLER_ACTIVITY_HEARTBEAT_STALE';
    exactNextAction = 'Refresh this controller activity receipt before treating its state as live.';
  } else if (observedEnabled === false) {
    activityState = 'DISABLED';
    trafficLight = 'RED';
    blocker = blocker || 'CONTROLLER_DISABLED';
    exactNextAction = 'Re-enable the same canonical controller unless an explicit operator pause or terminal completion is proven.';
  } else if (observedEnabled !== true) {
    activityState = 'ENABLEMENT_UNKNOWN';
    trafficLight = 'UNKNOWN';
    blocker = blocker || 'CONTROLLER_ENABLEMENT_EVIDENCE_MISSING';
    exactNextAction = 'Publish an explicit current enabled/disabled observation before classifying controller activity.';
  } else if (!executionStateAgrees) {
    activityState = 'EXECUTION_STATE_CONFLICT';
    trafficLight = 'RED';
    blocker = blocker || 'CONTROLLER_EXECUTION_STATE_CONFLICT';
    exactNextAction = 'Reconcile the top-level Shared Workspace status with the nested controller execution state.';
  } else if (blocker || blockingExecutionState(executionState)) {
    activityState = 'WAITING_OR_BLOCKED';
    trafficLight = 'AMBER';
    blocker = blocker || `CONTROLLER_EXECUTION_STATE_${safeFragment(executionState).toUpperCase()}`;
    exactNextAction = text(activity.nextAutomaticAction, 'Resolve or re-evaluate the current controller blocker before claiming BUILDING.');
  } else if (!recognizedHealthyExecutionState(executionState)) {
    activityState = 'EXECUTION_STATE_UNKNOWN';
    trafficLight = 'UNKNOWN';
    blocker = blocker || 'CONTROLLER_EXECUTION_STATE_UNRECOGNIZED';
    exactNextAction = 'Publish a recognized current execution state before classifying controller activity.';
  } else if (materialActionsSucceeded > 0 && proofRefs.length === 0) {
    activityState = 'UNPROVEN_ACTIVITY';
    trafficLight = 'AMBER';
    blocker = 'MATERIAL_ACTIONS_LACK_VERIFIED_PROOF';
    exactNextAction = 'Publish a current PASS proof record bound to this controller and run before classifying this controller as BUILDING.';
  } else if (materialActionsSucceeded > 0) {
    activityState = 'BUILDING';
    trafficLight = 'GREEN';
  } else if (safeEligibleWorkRemaining > 0) {
    activityState = 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK';
    trafficLight = 'AMBER';
    blocker = 'SAFE_ELIGIBLE_WORK_WITHOUT_MATERIAL_ACTION';
    exactNextAction = 'Execute safe eligible work instead of returning a narration-only cycle.';
  } else if (parkedLanes.length > 0) {
    activityState = 'WAITING_OR_BLOCKED';
    trafficLight = 'AMBER';
    blocker = 'CONTROLLER_LANES_PARKED';
  }

  return Object.freeze({
    ...canonical,
    freshness: futureDated ? 'FUTURE' : stale ? 'STALE' : 'CURRENT',
    ageMs,
    activityState,
    trafficLight,
    observedEnabled,
    executionState,
    materialActionsSucceeded,
    goalsAdvanced: count(activity.goalsAdvanced),
    sourceChanges: count(activity.sourceChanges),
    reviewsAdvanced: count(activity.reviewsAdvanced),
    mergesCompleted: count(activity.mergesCompleted),
    activeLanes,
    parkedLanes,
    materialLanes,
    targetMaterialLanes: count(activity.targetMaterialLanes) || TARGET_MATERIAL_LANES,
    safeEligibleWorkRemaining,
    blocker,
    lastMaterialActionAtUtc: text(activity.lastMaterialActionAtUtc),
    proofRefs,
    claimedProofRefs,
    exactNextAction,
    timestampUtc: text(record.timestampUtc),
    runId: text(activity.runId, 'UNKNOWN'),
    runStartedAtUtc: text(activity.runStartedAtUtc),
    runCompletedAtUtc: text(activity.runCompletedAtUtc),
    sourceStatusId: text(record.statusId),
    sourceParticipantId: text(record.participantId),
    enablementTransitions,
    livenessState: recoveredAfterDisabled ? 'RECOVERED_AFTER_DISABLED' : observedEnabled === false ? 'DISABLED' : 'CURRENT_OBSERVATION',
  });
}

export function projectControllerFleetTelemetry(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const controllers = CANONICAL_CONTROLLER_FLEET.map((controller) => projectOneController(
    controller,
    input.statusRecords,
    input.proofRecords,
    nowMs,
    staleAfterMs,
  ));

  const counts = Object.freeze({
    building: controllers.filter((item) => item.activityState === 'BUILDING').length,
    amber: controllers.filter((item) => item.trafficLight === 'AMBER').length,
    red: controllers.filter((item) => item.trafficLight === 'RED').length,
    unknown: controllers.filter((item) => item.trafficLight === 'UNKNOWN').length,
  });

  const expectedControllerCount = CANONICAL_CONTROLLER_FLEET.length;
  const metrics = Object.freeze({
    MATERIAL_ACTIONS_SUCCEEDED: controllers.reduce((sum, item) => sum + item.materialActionsSucceeded, 0),
    ACTIVE_MATERIAL_LANES: controllers.reduce((sum, item) => sum + item.materialLanes.length, 0),
    TARGET_MATERIAL_LANES: TARGET_MATERIAL_LANES,
    SAFE_ELIGIBLE_WORK_WAITING_WHILE_CAPACITY_FREE: controllers.reduce(
      (sum, item) => sum + (item.materialLanes.length < item.targetMaterialLanes ? item.safeEligibleWorkRemaining : 0), 0,
    ),
  });
  const finalVerdict = counts.red
    ? 'CONTROLLER_FLEET_ATTENTION_REQUIRED'
    : counts.unknown
      ? 'CONTROLLER_FLEET_TELEMETRY_INCOMPLETE'
      : counts.amber
        ? 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING'
        : counts.building === expectedControllerCount
          ? 'CONTROLLER_FLEET_BUILDING_PROVEN'
          : counts.building === 0
            ? 'CONTROLLER_FLEET_HEALTHY_IDLE'
            : 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING';

  return Object.freeze({
    schemaVersion: CONTROLLER_FLEET_TELEMETRY_SCHEMA_VERSION,
    kind: 'stephanos.controller_fleet.telemetry_projection',
    expectedControllerCount,
    controllers,
    counts,
    metrics,
    allCurrent: controllers.every((item) => item.freshness === 'CURRENT'),
    allObservedEnabled: controllers.every((item) => item.observedEnabled === true && item.freshness === 'CURRENT'),
    finalVerdict,
  });
}
