import {
  BLOCKED_MISSION_PHASES,
  GOAL_BUILDING_BLOCKER_ROUTES,
  GOAL_BUILDING_MISSION_PHASES,
  GOAL_BUILDING_OPERATING_STATES,
  MAX_ACTIVE_MISSIONS,
  MAX_BLOCKERS,
  PRODUCTIVE_MISSION_PHASES,
  SHA_40,
  SURFACE_POLICIES,
  TERMINAL_MISSION_PHASES,
  WAITING_MISSION_PHASES,
  boundedText,
  isNonNegativeInteger,
  list,
  normalizeBlocker,
  normalizeMission,
  normalizeSurface,
  requiredSurfaceIds,
  timestampVerdict,
} from './goalBuildingAgentV1.contract.mjs';

const BLOCKER_SEVERITY_PRIORITY = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  INFO: 4,
});

const BLOCKER_ROUTE_PRIORITY = new Map([
  ['SELF_RECOVERABLE_BY_EXISTING_BOUNDED_CONTRACT', 0],
  ['DELEGATE_BOUNDED_REPAIR', 1],
  ['REQUEST_QUALIFIED_REVIEW_OR_PROOF', 2],
  ['REQUEST_EXACT_OPERATOR_APPROVAL', 3],
  ['EXTERNAL_OR_UNQUALIFIED_SAFE_HOLD', 4],
]);

export function validateSurfaceSet(input, expectedHead, timing) {
  const evidenceProblems = [];
  const blockingReasons = [];
  const degradedReasons = [];
  const surfaces = list(input.surfaces).map(normalizeSurface);
  const physicalExecutionRequired = input.physicalExecutionRequired === true;
  const requiredIds = requiredSurfaceIds(physicalExecutionRequired);
  const seen = new Set();
  const byId = new Map();

  for (const surface of surfaces) {
    if (!surface.id || !SURFACE_POLICIES[surface.id]) {
      evidenceProblems.push(`unknown-surface:${surface.id || 'missing'}`);
      continue;
    }
    if (seen.has(surface.id)) {
      evidenceProblems.push(`duplicate-surface:${surface.id}`);
      continue;
    }
    seen.add(surface.id);
    byId.set(surface.id, surface);
  }

  for (const id of requiredIds) {
    if (byId.has(id)) continue;
    const policy = SURFACE_POLICIES[id];
    (policy.critical ? blockingReasons : degradedReasons).push(`surface-missing:${id}`);
  }

  for (const [id, surface] of byId.entries()) {
    const policy = SURFACE_POLICIES[id];
    const timestamp = timestampVerdict(surface.observedAtUtc, { ...timing, maxAgeMs: policy.maxAgeMs });
    if (timestamp === 'INVALID' || timestamp === 'FUTURE') {
      evidenceProblems.push(`surface-${timestamp.toLowerCase()}:${id}`);
      continue;
    }
    if (timestamp === 'STALE') {
      (policy.critical ? blockingReasons : degradedReasons).push(`surface-stale:${id}`);
    }
    if (policy.headBound) {
      if (!SHA_40.test(surface.head)) blockingReasons.push(`surface-head-unbound:${id}`);
      else if (surface.head !== expectedHead) blockingReasons.push(`surface-head-mismatch:${id}`);
    } else if (surface.head && (!SHA_40.test(surface.head) || surface.head !== expectedHead)) {
      blockingReasons.push(`surface-head-mismatch:${id}`);
    }
    if (!policy.states.includes(surface.state)) {
      (policy.critical ? blockingReasons : degradedReasons).push(`surface-not-ready:${id}:${surface.state}`);
    } else if (surface.blocker) {
      evidenceProblems.push(`healthy-surface-has-blocker:${id}`);
    }
  }

  return {
    surfaces: Object.freeze(surfaces),
    byId,
    evidenceProblems,
    blockingReasons,
    degradedReasons,
    physicalExecutionRequired,
  };
}

export function validateProgramme(input, expectedHead, timing) {
  const programme = input.programme && typeof input.programme === 'object' && !Array.isArray(input.programme)
    ? input.programme
    : {};
  const evidenceProblems = [];
  const blockingReasons = [];
  const degradedReasons = [];
  const activeMissions = list(programme.activeMissions).map(normalizeMission);
  const eligibleQueuedGoalCount = programme.eligibleQueuedGoalCount;
  const qualifiedCapacity = programme.qualifiedCapacity;
  const idleQualifiedCapacity = programme.idleQualifiedCapacity;

  if (activeMissions.length > MAX_ACTIVE_MISSIONS) evidenceProblems.push('active-mission-limit-exceeded');
  if (!isNonNegativeInteger(eligibleQueuedGoalCount)) evidenceProblems.push('eligible-queued-goal-count-invalid');
  if (!isNonNegativeInteger(qualifiedCapacity)) evidenceProblems.push('qualified-capacity-invalid');
  if (!isNonNegativeInteger(idleQualifiedCapacity)) evidenceProblems.push('idle-qualified-capacity-invalid');
  if (isNonNegativeInteger(qualifiedCapacity) && activeMissions.length > qualifiedCapacity) evidenceProblems.push('active-missions-exceed-qualified-capacity');
  if (isNonNegativeInteger(qualifiedCapacity) && isNonNegativeInteger(idleQualifiedCapacity) && idleQualifiedCapacity > qualifiedCapacity) evidenceProblems.push('idle-capacity-exceeds-qualified-capacity');

  const missionIds = new Set();
  const goalIds = new Set();
  const laneIds = new Set();
  const productiveMissions = [];
  const waitingMissions = [];
  const stalledMissions = [];

  for (const mission of activeMissions) {
    if (!mission.missionId || !mission.goalId || !mission.laneId || !mission.ownerId) evidenceProblems.push(`mission-identity-incomplete:${mission.missionId || 'missing'}`);
    if (missionIds.has(mission.missionId)) evidenceProblems.push(`duplicate-mission:${mission.missionId}`);
    if (goalIds.has(mission.goalId)) evidenceProblems.push(`duplicate-active-goal:${mission.goalId}`);
    if (laneIds.has(mission.laneId)) evidenceProblems.push(`duplicate-active-lane:${mission.laneId}`);
    missionIds.add(mission.missionId);
    goalIds.add(mission.goalId);
    laneIds.add(mission.laneId);
    if (!GOAL_BUILDING_MISSION_PHASES.includes(mission.phase)) evidenceProblems.push(`mission-phase-unknown:${mission.missionId || 'missing'}`);
    if (!SHA_40.test(mission.authorityHead)) blockingReasons.push(`mission-authority-head-unbound:${mission.missionId || 'missing'}`);
    else if (mission.authorityHead !== expectedHead) blockingReasons.push(`mission-authority-head-mismatch:${mission.missionId || 'missing'}`);

    const observation = timestampVerdict(mission.observedAtUtc, { ...timing, maxAgeMs: timing.maxProgressAgeMs });
    const progress = timestampVerdict(mission.lastProgressAtUtc, { ...timing, maxAgeMs: timing.maxProgressAgeMs });
    if (observation === 'INVALID' || observation === 'FUTURE') evidenceProblems.push(`mission-observation-${observation.toLowerCase()}:${mission.missionId || 'missing'}`);
    if (progress === 'INVALID' || progress === 'FUTURE') evidenceProblems.push(`mission-progress-${progress.toLowerCase()}:${mission.missionId || 'missing'}`);
    if (TERMINAL_MISSION_PHASES.has(mission.phase)) evidenceProblems.push(`terminal-mission-listed-active:${mission.missionId || 'missing'}`);

    if (PRODUCTIVE_MISSION_PHASES.has(mission.phase)) {
      if (progress === 'CURRENT' && observation === 'CURRENT') productiveMissions.push(mission);
      else stalledMissions.push(mission);
    } else if (WAITING_MISSION_PHASES.has(mission.phase)) {
      waitingMissions.push(mission);
    } else if (BLOCKED_MISSION_PHASES.has(mission.phase)) {
      stalledMissions.push(mission);
    }
    if (!mission.nextAction) degradedReasons.push(`mission-next-action-missing:${mission.missionId || 'missing'}`);
  }

  if (isNonNegativeInteger(eligibleQueuedGoalCount) && eligibleQueuedGoalCount > 0 && activeMissions.length === 0) {
    blockingReasons.push('eligible-goals-without-active-mission');
  }
  if (isNonNegativeInteger(eligibleQueuedGoalCount) && eligibleQueuedGoalCount > 0
    && isNonNegativeInteger(idleQualifiedCapacity) && idleQualifiedCapacity > 0) {
    degradedReasons.push('eligible-work-left-idle');
  }
  if (stalledMissions.length > 0) {
    if (productiveMissions.length === 0) blockingReasons.push('all-active-missions-not-progressing');
    else degradedReasons.push('one-or-more-missions-not-progressing');
  }

  return {
    activeMissions: Object.freeze(activeMissions),
    productiveMissions: Object.freeze(productiveMissions),
    waitingMissions: Object.freeze(waitingMissions),
    stalledMissions: Object.freeze(stalledMissions),
    eligibleQueuedGoalCount: isNonNegativeInteger(eligibleQueuedGoalCount) ? eligibleQueuedGoalCount : 0,
    qualifiedCapacity: isNonNegativeInteger(qualifiedCapacity) ? qualifiedCapacity : 0,
    idleQualifiedCapacity: isNonNegativeInteger(idleQualifiedCapacity) ? idleQualifiedCapacity : 0,
    evidenceProblems,
    blockingReasons,
    degradedReasons,
  };
}

export function validateBlockers(input, timing) {
  const evidenceProblems = [];
  const blockingReasons = [];
  const degradedReasons = [];
  const blockers = list(input.blockers).map(normalizeBlocker);
  if (blockers.length > MAX_BLOCKERS) evidenceProblems.push('blocker-limit-exceeded');
  const blockerIds = new Set();

  for (const blocker of blockers) {
    if (!blocker.blockerId) evidenceProblems.push('blocker-id-missing');
    if (blockerIds.has(blocker.blockerId)) evidenceProblems.push(`duplicate-blocker:${blocker.blockerId}`);
    blockerIds.add(blocker.blockerId);
    if (!['P0', 'P1', 'P2', 'P3', 'INFO'].includes(blocker.severity)) evidenceProblems.push(`blocker-severity-unknown:${blocker.blockerId || 'missing'}`);
    if (!blocker.ownerId) blockingReasons.push(`blocker-owner-missing:${blocker.blockerId || 'missing'}`);
    if (!GOAL_BUILDING_BLOCKER_ROUTES.includes(blocker.route)) evidenceProblems.push(`blocker-route-unknown:${blocker.blockerId || 'missing'}`);
    if (!blocker.missionId && !blocker.goalId) evidenceProblems.push(`blocker-lineage-missing:${blocker.blockerId || 'missing'}`);
    if (!blocker.nextAction) blockingReasons.push(`blocker-next-action-missing:${blocker.blockerId || 'missing'}`);
    const timestamp = timestampVerdict(blocker.firstObservedAtUtc, { ...timing, maxAgeMs: Number.POSITIVE_INFINITY });
    if (timestamp === 'INVALID' || timestamp === 'FUTURE') evidenceProblems.push(`blocker-time-${timestamp.toLowerCase()}:${blocker.blockerId || 'missing'}`);
    const exactOperatorBoundary = blocker.route === 'REQUEST_EXACT_OPERATOR_APPROVAL';
    if (!blocker.independentWorkContinues && ['P0', 'P1'].includes(blocker.severity) && !exactOperatorBoundary) {
      blockingReasons.push(`programme-blocker:${blocker.blockerId || 'missing'}`);
    } else if (!blocker.independentWorkContinues && !exactOperatorBoundary) {
      degradedReasons.push(`owned-blocker:${blocker.blockerId || 'missing'}`);
    }
  }

  return { blockers: Object.freeze(blockers), evidenceProblems, blockingReasons, degradedReasons };
}

export function validateOperatorAction(input = {}) {
  const operatorAction = input.operatorAction && typeof input.operatorAction === 'object' && !Array.isArray(input.operatorAction)
    ? input.operatorAction
    : {};
  const required = operatorAction.required === true;
  const target = boundedText(operatorAction.target, '', 280);
  const evidenceProblems = [];
  if (required && !target) evidenceProblems.push('operator-action-target-missing');
  if (!required && target) evidenceProblems.push('operator-action-target-without-requirement');
  return Object.freeze({ required, target, evidenceProblems });
}

export function prioritizeBlockers(blockers = []) {
  return [...blockers].sort((left, right) => {
    const severityDelta = (BLOCKER_SEVERITY_PRIORITY[left.severity] ?? 99) - (BLOCKER_SEVERITY_PRIORITY[right.severity] ?? 99);
    if (severityDelta !== 0) return severityDelta;
    const leftObserved = Date.parse(left.firstObservedAtUtc);
    const rightObserved = Date.parse(right.firstObservedAtUtc);
    const ageDelta = (Number.isFinite(leftObserved) ? leftObserved : Number.POSITIVE_INFINITY)
      - (Number.isFinite(rightObserved) ? rightObserved : Number.POSITIVE_INFINITY);
    if (ageDelta !== 0) return ageDelta;
    const routeDelta = (BLOCKER_ROUTE_PRIORITY.get(left.route) ?? 99) - (BLOCKER_ROUTE_PRIORITY.get(right.route) ?? 99);
    if (routeDelta !== 0) return routeDelta;
    return String(left.blockerId).localeCompare(String(right.blockerId));
  });
}

export function chooseNextAction(programme, blockers, operatorAction, reasons, state = '') {
  if (state === GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD) {
    return 'Repair contradictory or invalid programme evidence before any consequential action.';
  }
  if (operatorAction.required) return operatorAction.target;
  const routed = prioritizeBlockers(blockers).find((blocker) => blocker.nextAction);
  if (routed) return routed.nextAction;
  const mission = programme.productiveMissions.find((item) => item.nextAction)
    || programme.waitingMissions.find((item) => item.nextAction)
    || programme.stalledMissions.find((item) => item.nextAction);
  if (mission) return mission.nextAction;
  if (reasons.length > 0) return 'Repair the first evidence-backed programme-health blocker through its existing governed route.';
  if (programme.activeMissions.length === 0 && programme.eligibleQueuedGoalCount === 0) return 'Remain ready and select the next eligible goal when canonical programme authority publishes one.';
  return 'Continue the current scheduler-authorized goal and publish the next durable progress receipt.';
}

export function buildSummary({ state, isCapableOfBuilding, isActuallyBuilding, programme, blockingReasons, degradedReasons }) {
  if (state === GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD) return 'Stephanos programme evidence is contradictory or invalid, so the Goal Building Agent is holding safely instead of guessing.';
  if (isActuallyBuilding) {
    const suffix = state === GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL
      ? 'All eligible capacity is accounted for and the programme is operating at 100 percent.'
      : 'Useful work is progressing, but one or more owned health or throughput defects remain.';
    return `Stephanos is actively building ${programme.productiveMissions.length} mission(s). ${suffix}`;
  }
  if (state === GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL && programme.waitingMissions.length > 0) {
    return 'Stephanos programme operations are fully accounted for; the current mission is waiting at an owned governed boundary and no eligible capacity is stranded.';
  }
  if (isCapableOfBuilding && programme.activeMissions.length === 0 && programme.eligibleQueuedGoalCount === 0) {
    return 'Stephanos is capable of building and is correctly idle because no eligible goal is currently published.';
  }
  if (blockingReasons.length > 0) return 'Stephanos is not currently proven to be building; trusted evidence identifies a programme blocker.';
  if (degradedReasons.length > 0) return 'Stephanos build capability is degraded or incompletely proven, so active progress cannot be claimed.';
  return 'Stephanos build status is not yet proven.';
}
