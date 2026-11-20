import {
  PRODUCTIVE_MISSION_PHASES,
  boundedText,
  list,
  text,
} from './goalBuildingAgentV1.contract.mjs';
import { projectMissionWorkerBeaconState } from './missionWorkerBeaconStateV1.mjs';

export const GOAL_BUILDING_RUNTIME_TRUTH_SCHEMA_VERSION = 'stephanos.goal-building-runtime-truth.v1';
export const GOAL_BUILDING_RUNTIME_STATES = Object.freeze({
  BUILDING: 'BUILDING',
  ALIVE_BUT_STALLED: 'ALIVE_BUT_STALLED',
  BLOCKED: 'BLOCKED',
  IDLE: 'IDLE',
  UNKNOWN: 'UNKNOWN',
});

const DEFAULT_STALL_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_WORKER_STALE_AFTER_MS = 3 * 60 * 1000;

function timestamp(value) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? Object.freeze({ iso: new Date(parsed).toISOString(), ms: parsed }) : null;
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function latestMission(missions = []) {
  return [...missions].sort((left, right) => {
    const leftMs = Date.parse(text(left?.lastProgressAtUtc));
    const rightMs = Date.parse(text(right?.lastProgressAtUtc));
    return (Number.isFinite(rightMs) ? rightMs : -1) - (Number.isFinite(leftMs) ? leftMs : -1);
  })[0] || null;
}

function movementFromMission(mission) {
  if (!mission) return null;
  const observed = timestamp(mission.lastProgressAtUtc);
  if (!observed) return null;
  return Object.freeze({
    observedAtUtc: observed.iso,
    observedAtMs: observed.ms,
    missionId: text(mission.missionId),
    goalId: text(mission.goalId),
    description: boundedText(`${mission.goalId || mission.missionId || 'mission'} progressed at ${mission.phase || 'UNKNOWN'}`, 'Mission progress observed.', 240),
    source: 'programme-mission-progress',
  });
}

function explicitMovement(input, worker, activeMissions) {
  const candidate = input?.executionMovement;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return Object.freeze({ movement: null, blocker: '' });
  const observed = timestamp(candidate.observedAtUtc || candidate.timestampUtc);
  if (!observed) return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_TIMESTAMP_INVALID' });
  const missionId = text(candidate.missionId);
  const goalId = text(candidate.goalId);
  const taskId = text(candidate.taskId);
  const receiptId = text(candidate.receiptId);

  // A fresh timestamp is not material progress. Require the exact productive
  // mission/goal and the active worker task/receipt before accepting movement.
  if (!missionId) return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_MISSION_UNPROVEN' });
  if (!goalId) return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_GOAL_UNPROVEN' });
  if (!taskId) return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_TASK_UNPROVEN' });
  if (!receiptId) return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_RECEIPT_UNPROVEN' });

  const matches = activeMissions.filter((mission) => text(mission?.missionId) === missionId);
  if (matches.length !== 1) return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_MISSION_MISMATCH' });
  const mission = matches[0];
  if (text(mission.goalId) !== goalId) {
    return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_GOAL_MISMATCH' });
  }
  if (!PRODUCTIVE_MISSION_PHASES.has(text(mission.phase).toUpperCase())) {
    return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_MISSION_NOT_PRODUCTIVE' });
  }
  if (!worker.activeReceiptId || receiptId !== worker.activeReceiptId) {
    return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_RECEIPT_MISMATCH' });
  }
  if (!worker.activeTaskId || taskId !== worker.activeTaskId) {
    return Object.freeze({ movement: null, blocker: 'MEANINGFUL_MOVEMENT_TASK_MISMATCH' });
  }
  return Object.freeze({
    movement: Object.freeze({
      observedAtUtc: observed.iso,
      observedAtMs: observed.ms,
      missionId,
      goalId,
      description: boundedText(candidate.description || candidate.stateMovement, 'Execution state advanced.', 240),
      source: 'execution-movement',
    }),
    blocker: '',
  });
}

// A fresh worker cannot turn any unresolved blocker on productive work green.
// Every structured blocker, including review/proof holds, needs exact independent
// mission AND goal lineage before disjoint work can proceed. The approval summary
// must agree with structured approval blockers; unstructured titles are never grants.
function programmeBlockerScopeProblem(certificate, activeMissions, productiveMissions) {
  const blockers = list(certificate.blockers);
  const approvals = blockers.filter(
    (item) => item && typeof item === 'object' && text(item.route).toUpperCase() === 'REQUEST_EXACT_OPERATOR_APPROVAL',
  );
  const approvalRequired = certificate.operatorActionRequired === true;
  if (approvalRequired !== (approvals.length > 0)) return 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN';

  for (const item of blockers) {
    const isApproval = text(item?.route).toUpperCase() === 'REQUEST_EXACT_OPERATOR_APPROVAL';
    const problem = isApproval ? 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN' : 'PROGRAMME_BLOCKER_SCOPE_UNPROVEN';
    if (!item || typeof item !== 'object' || Array.isArray(item)) return problem;
    const missionId = text(item.missionId);
    const goalId = text(item.goalId);
    // A partial identity is insufficient to assert that a blocker is disjoint.
    if (!missionId || !goalId) return problem;
    const matches = activeMissions.filter((mission) => mission.missionId === missionId && mission.goalId === goalId);
    if (matches.length !== 1) return problem;
    if (productiveMissions.some((mission) => mission.missionId === missionId || mission.goalId === goalId)) {
      return problem;
    }
  }

  if (approvalRequired) {
    // Negative consistency check only: a title mentioning a productive identity
    // disproves disjointness; it can NEVER establish operator scope or authority.
    const target = text(certificate.operatorActionTarget);
    const productiveIds = productiveMissions.flatMap((mission) => [text(mission.missionId), text(mission.goalId)]);
    const targetMentionsProductiveWork = productiveIds.some((id) => {
      if (!id) return false;
      const escaped = id.replace(/[^a-z0-9_-]/gi, '\\$&');
      return new RegExp('(^|[^a-z0-9._-])' + escaped + '($|[^a-z0-9._-])', 'i').test(target);
    });
    if (targetMentionsProductiveWork) return 'PROGRAMME_OPERATOR_GATE_SCOPE_UNPROVEN';
  }
  return '';
}

function firstProblem(certificate, worker, movementBlocker) {
  if (movementBlocker) return movementBlocker;
  if (worker.blocker) return worker.blocker;
  const reasons = [
    ...list(certificate?.evidenceProblems),
    ...list(certificate?.blockingReasons),
    ...list(certificate?.degradedReasons),
  ];
  return boundedText(reasons[0], '', 180);
}

export function projectGoalBuildingRuntimeTruth(input = {}) {
  const certificate = input.certificate && typeof input.certificate === 'object' ? input.certificate : {};
  const nowMs = Number.isFinite(input.nowMs)
    ? input.nowMs
    : Number.isFinite(input.validationOptions?.nowMs)
      ? input.validationOptions.nowMs
      : Date.now();
  const stallAfterMs = Number.isFinite(input.stallAfterMs) && input.stallAfterMs >= 0
    ? input.stallAfterMs
    : DEFAULT_STALL_AFTER_MS;
  const workerStaleAfterMs = Number.isFinite(input.workerStaleAfterMs) && input.workerStaleAfterMs >= 0
    ? input.workerStaleAfterMs
    : DEFAULT_WORKER_STALE_AFTER_MS;
  const expectedHead = text(certificate.expectedHead || input.expectedHead).toLowerCase();
  const workerRecord = input.workerBeacon || input.missionWorkerBeacon || {};
  const worker = projectMissionWorkerBeaconState(workerRecord, {
    nowMs,
    staleAfterMs: workerStaleAfterMs,
    expectedHead,
  });
  const activeMissions = list(certificate.activeMissions);
  const productiveMissions = activeMissions.filter((mission) => PRODUCTIVE_MISSION_PHASES.has(text(mission.phase).toUpperCase()));
  const mostRecentProductiveMission = latestMission(productiveMissions);
  const explicit = explicitMovement(input, worker, activeMissions);
  const movement = input.executionMovement
    ? explicit.movement
    : movementFromMission(mostRecentProductiveMission);
  const movementAgeMs = movement ? Math.max(0, nowMs - movement.observedAtMs) : null;
  const secondsSinceMeaningfulMovement = movementAgeMs === null ? null : Math.floor(movementAgeMs / 1000);
  const movementFutureDated = movement ? movement.observedAtMs > nowMs + 5_000 : false;
  const meaningfulMovementFresh = movementAgeMs !== null && !movementFutureDated && movementAgeMs <= stallAfterMs;
  const hasActiveProgrammeWork = activeMissions.length > 0 || nonNegativeInteger(certificate.activeMissionCount) > 0;
  const queuedWork = nonNegativeInteger(certificate.eligibleQueuedGoalCount);
  const certificateProblem = firstProblem(certificate, worker, explicit.blocker);
  const structuredBlockerProblem = programmeBlockerScopeProblem(certificate, activeMissions, productiveMissions);

  let state = GOAL_BUILDING_RUNTIME_STATES.UNKNOWN;
  let stallReason = '';
  let blocker = certificateProblem;

  if (worker.state === 'BLOCKED' || (worker.observedAtUtc && !worker.exactHeadMatch)) {
    state = GOAL_BUILDING_RUNTIME_STATES.BLOCKED;
    blocker ||= 'MISSION_WORKER_BLOCKED';
  } else if (worker.state === 'RUNNING' && !worker.buildingProven) {
    state = GOAL_BUILDING_RUNTIME_STATES.BLOCKED;
    blocker ||= 'MISSION_WORKER_ACTIVE_RECEIPT_UNPROVEN';
  } else if (worker.state === 'RUNNING' && worker.buildingProven && hasActiveProgrammeWork) {
    if (!movement || !meaningfulMovementFresh) {
      state = GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED;
      stallReason = explicit.blocker
        || (movementFutureDated ? 'MEANINGFUL_MOVEMENT_FUTURE_DATED' : movement ? 'NO_RECENT_MEANINGFUL_MOVEMENT' : 'MEANINGFUL_MOVEMENT_UNPROVEN');
      blocker ||= stallReason;
    } else if (list(certificate.blockingReasons).length > 0 || list(certificate.evidenceProblems).length > 0) {
      // A fresh worker heartbeat and movement cannot erase contradictory programme
      // or authority evidence. Never project BUILDING while hard proof is invalid.
      state = GOAL_BUILDING_RUNTIME_STATES.BLOCKED;
      blocker ||= 'PROGRAMME_BUILDING_CONTRADICTION';
    } else if (structuredBlockerProblem) {
      state = GOAL_BUILDING_RUNTIME_STATES.BLOCKED;
      // A structured gate is hard proof; soft degradation cannot mask it.
      blocker = structuredBlockerProblem;
    } else if (certificate.isActuallyBuilding === true && productiveMissions.length > 0) {
      state = GOAL_BUILDING_RUNTIME_STATES.BUILDING;
      blocker = '';
    } else {
      state = GOAL_BUILDING_RUNTIME_STATES.UNKNOWN;
      blocker ||= 'PRODUCTIVE_PROGRAMME_EXECUTION_UNPROVEN';
    }
  } else if (worker.state === 'IDLE' && !hasActiveProgrammeWork && queuedWork === 0) {
    state = GOAL_BUILDING_RUNTIME_STATES.IDLE;
    blocker = '';
  } else if (worker.state === 'STALE') {
    state = GOAL_BUILDING_RUNTIME_STATES.UNKNOWN;
    blocker ||= 'MISSION_WORKER_HEARTBEAT_STALE';
  } else if (certificate.operatorActionRequired === true || list(certificate.blockingReasons).length > 0) {
    state = GOAL_BUILDING_RUNTIME_STATES.BLOCKED;
    blocker ||= 'PROGRAMME_BLOCKED';
  }

  const currentMission = (explicit.movement && productiveMissions.find((mission) => mission.missionId === explicit.movement.missionId))
    || mostRecentProductiveMission || latestMission(activeMissions);
  const protectedMainHead = text(input.protectedMainHead || certificate.protectedMainHead).toLowerCase();
  const installedMainHead = text(input.installedMainHead || certificate.installedMainHead).toLowerCase();
  const servedHead = text(input.servedHead).toLowerCase();
  const protectedHeadMatches = Boolean(expectedHead && protectedMainHead === expectedHead);
  const installedHeadMatches = Boolean(expectedHead && installedMainHead && installedMainHead === expectedHead);
  const servedHeadMatches = Boolean(expectedHead && servedHead && servedHead === expectedHead);

  return Object.freeze({
    schemaVersion: GOAL_BUILDING_RUNTIME_TRUTH_SCHEMA_VERSION,
    observedAtUtc: new Date(nowMs).toISOString(),
    state,
    buildingProven: state === GOAL_BUILDING_RUNTIME_STATES.BUILDING,
    stalled: state === GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED,
    stallReason,
    blocker,
    expectedHead,
    protectedMainHead,
    installedMainHead,
    servedHead,
    protectedHeadMatches,
    installedHeadMatches,
    servedHeadMatches,
    exactWorkerHeadMatches: worker.exactHeadMatch,
    workerState: worker.state,
    workerHeartbeatAtUtc: worker.observedAtUtc,
    workerHeartbeatAgeSeconds: worker.ageMs === null ? null : Math.floor(worker.ageMs / 1000),
    workerTaskId: worker.activeTaskId,
    workerReceiptId: worker.activeReceiptId,
    currentRequestId: boundedText(workerRecord.requestId || worker.activeReceiptId, '', 128),
    currentPhase: worker.executionPhase,
    currentMissionId: text(currentMission?.missionId),
    currentGoalId: text(currentMission?.goalId),
    currentOwnerId: text(currentMission?.ownerId),
    lastMeaningfulStateMovementAt: movement?.observedAtUtc || '',
    lastMeaningfulStateMovement: movement?.description || '',
    secondsSinceMeaningfulMovement,
    meaningfulMovementFresh,
    retryCount: nonNegativeInteger(workerRecord.retryCount ?? input.retryCount),
    nextRetryAt: timestamp(workerRecord.nextRetryAt || input.nextRetryAt)?.iso || '',
    nextAutomaticAction: boundedText(workerRecord.nextAutomaticAction || certificate.nextAction, '', 280),
    operatorActionRequired: certificate.operatorActionRequired === true,
    operatorActionTarget: boundedText(certificate.operatorActionTarget, '', 280),
    falseBuildingRejected: state !== GOAL_BUILDING_RUNTIME_STATES.BUILDING,
    proofBasis: Object.freeze({
      workerBeaconProven: worker.buildingProven,
      productiveMissionCount: productiveMissions.length,
      activeMissionCount: activeMissions.length,
      meaningfulMovementSource: movement?.source || '',
      explicitMovementIdentityAccepted: Boolean(input.executionMovement && explicit.movement),
    }),
  });
}
