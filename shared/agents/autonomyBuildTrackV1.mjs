export const AUTONOMY_BUILD_TRACK_SCHEMA = 'stephanos.autonomy-build-track.v1';
export const AUTONOMY_BUILD_TRACK_STATUS_ID = 'autonomy-build-track-current';

export const AUTONOMY_BUILD_TRACK_STATES = Object.freeze({
  PASS: 'PASS',
  BLOCKED: 'BLOCKED',
  WAITING: 'WAITING',
  NOT_REACHED: 'NOT_REACHED',
  UNKNOWN: 'UNKNOWN',
});

export const AUTONOMY_BUILD_TRACK_GATES = Object.freeze([
  'SYNC',
  'CONTROL_PLANE',
  'HEARTBEAT',
  'ELIGIBLE_GOAL',
  'SELECT',
  'CLAIM',
  'SOURCE_CHANGED',
  'TESTED',
  'TERMINAL_RECEIPT',
  'REVIEW_HANDOFF',
  'RELEASE',
  'SELECT_NEXT',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function freezeGate(id, state, reason = '') {
  return Object.freeze({ id, state, reason: text(reason) });
}

function issueFromMission(mission = {}) {
  const direct = Number(mission.issueNumber || mission.issue || 0);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const match = text(mission.missionId).match(/^critical-([1-9]\d*)-elastic-goal/i);
  const parsed = Number(match?.[1] || 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function selectedMission(conveyor = {}) {
  return conveyor?.elasticAdmission?.selectedMission
    || conveyor?.projection?.activeMission
    || conveyor?.missionRecord
    || null;
}

function dispatchFacts(conveyor = {}) {
  const elastic = conveyor?.elasticIgnition || {};
  const active = conveyor?.activeMissionIgnition || {};
  const dispatched = Number(elastic.dispatchCount || 0) > 0
    || active.published === true
    || active.classification === 'CRITICAL_ACTIVE_MISSION_ALREADY_RUNNING';
  const blocked = elastic.ok === false || active.ok === false;
  const reason = (Array.isArray(elastic.held) && elastic.held.length
    ? elastic.held.map((item) => text(item?.reason)).filter(Boolean).join(',')
    : '')
    || (Array.isArray(active.blockers) ? active.blockers.map(text).filter(Boolean).join(',') : '')
    || text(elastic.classification || active.classification);
  return Object.freeze({ dispatched, blocked, reason });
}

function firstActionableGate(gates = []) {
  return gates.find((gate) => gate.state === AUTONOMY_BUILD_TRACK_STATES.BLOCKED)
    || gates.find((gate) => gate.state === AUTONOMY_BUILD_TRACK_STATES.WAITING)
    || gates.find((gate) => gate.state === AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED)
    || null;
}

function buildTrack({ timestampUtc, sourceHead = '', missionId = '', issueNumber = null, actionId = '', gates = [] } = {}) {
  const actionable = firstActionableGate(gates);
  return Object.freeze({
    schemaVersion: AUTONOMY_BUILD_TRACK_SCHEMA,
    timestampUtc: text(timestampUtc),
    sourceHead: text(sourceHead).toLowerCase(),
    missionId: text(missionId),
    issueNumber: Number.isSafeInteger(issueNumber) && issueNumber > 0 ? issueNumber : null,
    actionId: text(actionId),
    gates: Object.freeze(gates),
    currentGate: actionable?.id || 'COMPLETE',
    currentState: actionable?.state || AUTONOMY_BUILD_TRACK_STATES.PASS,
    blocker: actionable?.state === AUTONOMY_BUILD_TRACK_STATES.BLOCKED ? actionable.reason : '',
    autonomousLoopProven: gates.length > 0 && gates.every((gate) => gate.state === AUTONOMY_BUILD_TRACK_STATES.PASS),
  });
}

export function projectHeartbeatAutonomyBuildTrack({
  conveyorResult = null,
  sourceBuild = null,
  timestampUtc = new Date().toISOString(),
} = {}) {
  const conveyorOk = conveyorResult?.ok === true;
  const mission = selectedMission(conveyorResult || {});
  const missionId = text(mission?.missionId || conveyorResult?.missionRecord?.missionId);
  const issueNumber = issueFromMission(mission || conveyorResult?.missionRecord || {});
  const selected = Boolean(
    missionId
    || text(conveyorResult?.projection?.selectedItem?.itemId)
    || conveyorResult?.classification === 'ELASTIC_GOAL_MISSION_SELECTED'
    || conveyorResult?.classification === 'WAIT_ACTIVE_MISSION'
  );
  const dispatch = dispatchFacts(conveyorResult || {});
  const processed = sourceBuild?.processed === true;
  const success = processed && sourceBuild?.success === true;
  const buildBlocked = processed && sourceBuild?.success === false;
  const claimPass = processed || dispatch.dispatched;
  const sourceHead = text(
    conveyorResult?.elasticIgnition?.sourceRevision
    || conveyorResult?.activeMissionIgnition?.sourceRevision
    || sourceBuild?.sourceHead,
  );
  const actionId = text(sourceBuild?.actionId);
  const conveyorBlocker = text(
    conveyorResult?.blocker
    || conveyorResult?.classification
    || conveyorResult?.finalVerdict,
  );
  const buildReason = text(sourceBuild?.error || sourceBuild?.reason || sourceBuild?.finalVerdict);

  const gates = [
    freezeGate('HEARTBEAT', conveyorOk ? AUTONOMY_BUILD_TRACK_STATES.PASS : AUTONOMY_BUILD_TRACK_STATES.BLOCKED, conveyorOk ? '' : conveyorBlocker),
    freezeGate('ELIGIBLE_GOAL', selected ? AUTONOMY_BUILD_TRACK_STATES.PASS : (conveyorOk ? AUTONOMY_BUILD_TRACK_STATES.WAITING : AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED), selected ? '' : 'NO_ELIGIBLE_GOAL_SELECTED'),
    freezeGate('SELECT', selected ? AUTONOMY_BUILD_TRACK_STATES.PASS : AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
    freezeGate('CLAIM', claimPass
      ? AUTONOMY_BUILD_TRACK_STATES.PASS
      : selected && dispatch.blocked
        ? AUTONOMY_BUILD_TRACK_STATES.BLOCKED
        : selected
          ? AUTONOMY_BUILD_TRACK_STATES.WAITING
          : AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED,
    claimPass ? '' : dispatch.reason || buildReason || 'CLAIM_NOT_YET_OBSERVED'),
    freezeGate('SOURCE_CHANGED', success
      ? AUTONOMY_BUILD_TRACK_STATES.PASS
      : buildBlocked
        ? AUTONOMY_BUILD_TRACK_STATES.BLOCKED
        : AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED,
    buildBlocked ? buildReason : ''),
    freezeGate('TESTED', success ? AUTONOMY_BUILD_TRACK_STATES.PASS : AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
    freezeGate('TERMINAL_RECEIPT', success ? AUTONOMY_BUILD_TRACK_STATES.PASS : AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
    freezeGate('REVIEW_HANDOFF', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
    freezeGate('RELEASE', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
    freezeGate('SELECT_NEXT', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
  ];

  return buildTrack({ timestampUtc, sourceHead, missionId, issueNumber, actionId, gates });
}

function recordMs(record = {}) {
  const parsed = Date.parse(text(record.timestampUtc || record.checkedAtUtc || record.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestStatus(records = [], statusId) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => text(record?.statusId) === statusId)
    .sort((left, right) => recordMs(right) - recordMs(left))[0] || null;
}

function isFresh(record, nowMs, staleAfterMs) {
  const ms = recordMs(record);
  return Boolean(ms && nowMs - ms <= staleAfterMs);
}

function syncGate(sync, fresh) {
  if (!sync) return freezeGate('SYNC', AUTONOMY_BUILD_TRACK_STATES.UNKNOWN, 'SYNC_STATUS_MISSING');
  const value = text(sync.status || sync.classification || sync.evaluation?.classification).toUpperCase();
  if (!fresh) return freezeGate('SYNC', AUTONOMY_BUILD_TRACK_STATES.UNKNOWN, 'SYNC_STATUS_STALE');
  if (value.includes('BLOCK')) return freezeGate('SYNC', AUTONOMY_BUILD_TRACK_STATES.BLOCKED, value);
  if (value.includes('SYNC_NO_CHANGE') || value.includes('SYNC') || value.includes('PASS')) return freezeGate('SYNC', AUTONOMY_BUILD_TRACK_STATES.PASS);
  return freezeGate('SYNC', AUTONOMY_BUILD_TRACK_STATES.UNKNOWN, value || 'SYNC_STATUS_UNKNOWN');
}

function controlPlaneGate({ refresh, refreshFresh, heartbeat, heartbeatFresh }) {
  if (heartbeatFresh && heartbeat?.autonomyTrack?.gates?.some((gate) => gate?.id === 'HEARTBEAT' && gate?.state === 'PASS')) {
    return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.PASS);
  }
  const blocker = text(refresh?.blocker);
  if (blocker.startsWith('CONTROL_PLANE_')) return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.BLOCKED, blocker);
  if (!refresh) return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.UNKNOWN, 'CONTROL_PLANE_STATUS_MISSING');
  if (!refreshFresh) return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.UNKNOWN, blocker || 'CONTROL_PLANE_STATUS_STALE');
  const status = text(refresh.status || refresh.classification).toUpperCase();
  if (status.includes('BLOCK') && blocker) return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.BLOCKED, blocker);
  if (!blocker && (status.includes('COMPLETE') || status.includes('PASS') || refresh.exactHeadProofOk === true)) {
    return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.PASS);
  }
  return freezeGate('CONTROL_PLANE', AUTONOMY_BUILD_TRACK_STATES.UNKNOWN, blocker || status || 'CONTROL_PLANE_STATUS_UNKNOWN');
}

export function projectWorkspaceAutonomyBuildTrack({
  statusRecords = [],
  nowMs = Date.now(),
  staleAfterMs = 60 * 60 * 1000,
} = {}) {
  const sync = latestStatus(statusRecords, 'battle-bridge-github-sync-current');
  const refresh = latestStatus(statusRecords, 'post-sync-runtime-refresh-current');
  const heartbeat = latestStatus(statusRecords, AUTONOMY_BUILD_TRACK_STATUS_ID);
  const syncFresh = isFresh(sync, nowMs, staleAfterMs);
  const refreshFresh = isFresh(refresh, nowMs, staleAfterMs);
  const heartbeatFresh = isFresh(heartbeat, nowMs, staleAfterMs);
  const heartbeatTrack = heartbeatFresh && heartbeat?.autonomyTrack?.schemaVersion === AUTONOMY_BUILD_TRACK_SCHEMA
    ? heartbeat.autonomyTrack
    : null;

  const gates = [
    syncGate(sync, syncFresh),
    controlPlaneGate({ refresh, refreshFresh, heartbeat, heartbeatFresh }),
    ...(heartbeatTrack?.gates || [
      freezeGate('HEARTBEAT', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('ELIGIBLE_GOAL', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('SELECT', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('CLAIM', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('SOURCE_CHANGED', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('TESTED', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('TERMINAL_RECEIPT', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('REVIEW_HANDOFF', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('RELEASE', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
      freezeGate('SELECT_NEXT', AUTONOMY_BUILD_TRACK_STATES.NOT_REACHED),
    ]),
  ];

  return buildTrack({
    timestampUtc: new Date(nowMs).toISOString(),
    sourceHead: heartbeatTrack?.sourceHead || text(sync?.sourceHead || sync?.localHeadAfter || sync?.remoteHeadObserved),
    missionId: heartbeatTrack?.missionId || '',
    issueNumber: heartbeatTrack?.issueNumber || null,
    actionId: heartbeatTrack?.actionId || '',
    gates,
  });
}
