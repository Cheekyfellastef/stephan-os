import {
  GOAL_BUILDING_AGENT_ID,
  GOAL_BUILDING_AGENT_SCHEMA_VERSION,
  GOAL_BUILDING_OPERATING_STATES,
  SHA_40,
  SURFACE_POLICIES,
  clock,
  requiredSurfaceIds,
  text,
  timestampVerdict,
  unique,
} from './goalBuildingAgentV1.contract.mjs';
import {
  buildSummary,
  chooseNextAction,
  validateBlockers,
  validateOperatorAction,
  validateProgramme,
  validateSurfaceSet,
} from './goalBuildingAgentV1.health.mjs';

export function evaluateGoalBuildingProgramme(input = {}) {
  const timing = clock(input.validationOptions || {});
  const expectedHead = text(input.expectedHead).toLowerCase();
  const evidenceProblems = [];
  const blockingReasons = [];
  const degradedReasons = [];

  if (!SHA_40.test(expectedHead)) evidenceProblems.push('expected-head-invalid');
  const protectedMainHead = text(input.protectedMainHead).toLowerCase();
  const installedMainHead = text(input.installedMainHead).toLowerCase();
  const physicalExecutionRequired = input.physicalExecutionRequired === true;
  if (!SHA_40.test(protectedMainHead)) evidenceProblems.push('protected-main-head-invalid');
  if (physicalExecutionRequired && !SHA_40.test(installedMainHead)) evidenceProblems.push('installed-main-head-invalid');
  if (!physicalExecutionRequired && installedMainHead && !SHA_40.test(installedMainHead)) evidenceProblems.push('installed-main-head-invalid');
  if (SHA_40.test(expectedHead) && SHA_40.test(protectedMainHead) && protectedMainHead !== expectedHead) evidenceProblems.push('expected-protected-main-contradiction');
  if (SHA_40.test(expectedHead) && SHA_40.test(installedMainHead) && installedMainHead !== expectedHead) blockingReasons.push('installed-main-head-mismatch');

  const surfaceResult = validateSurfaceSet(input, expectedHead, timing);
  const programmeResult = validateProgramme(input, expectedHead, timing);
  const blockerResult = validateBlockers(input, timing);
  const operatorAction = validateOperatorAction(input);
  evidenceProblems.push(...surfaceResult.evidenceProblems, ...programmeResult.evidenceProblems, ...blockerResult.evidenceProblems, ...operatorAction.evidenceProblems);
  blockingReasons.push(...surfaceResult.blockingReasons, ...programmeResult.blockingReasons, ...blockerResult.blockingReasons);
  degradedReasons.push(...surfaceResult.degradedReasons, ...programmeResult.degradedReasons, ...blockerResult.degradedReasons);

  const activeMissionById = new Map(programmeResult.activeMissions.map((mission) => [mission.missionId, mission]));
  const accountedMissionIds = new Set();
  for (const blocker of blockerResult.blockers) {
    const correlatedMission = blocker.missionId ? activeMissionById.get(blocker.missionId) : null;
    if (blocker.missionId && !correlatedMission) {
      evidenceProblems.push(`blocker-mission-unknown:${blocker.blockerId || 'missing'}`);
    }
    if (correlatedMission && blocker.goalId && blocker.goalId !== correlatedMission.goalId) {
      evidenceProblems.push(`blocker-goal-mismatch:${blocker.blockerId || 'missing'}`);
    }
    if (correlatedMission && blocker.ownerId && blocker.route && blocker.nextAction
      && (!blocker.goalId || blocker.goalId === correlatedMission.goalId)) {
      accountedMissionIds.add(correlatedMission.missionId);
    }

    const distinctProductiveMission = programmeResult.productiveMissions.some((mission) => {
      if (blocker.missionId && mission.missionId === blocker.missionId) return false;
      if (blocker.goalId && mission.goalId === blocker.goalId) return false;
      return true;
    });
    const exactOperatorWait = blocker.route === 'REQUEST_EXACT_OPERATOR_APPROVAL'
      && operatorAction.required
      && correlatedMission
      && ['WAITING_FOR_OPERATOR', 'READY_FOR_OPERATOR_APPROVAL'].includes(correlatedMission.phase);
    if (blocker.independentWorkContinues && !distinctProductiveMission && !exactOperatorWait) {
      evidenceProblems.push(`independent-work-claim-unproven:${blocker.blockerId || 'missing'}`);
    }
  }

  for (const mission of [...programmeResult.waitingMissions, ...programmeResult.stalledMissions]) {
    if (!accountedMissionIds.has(mission.missionId)) blockingReasons.push(`mission-blocker-unowned:${mission.missionId || 'missing'}`);
  }
  const allActiveMissionsManagedWait = programmeResult.activeMissions.length > 0
    && programmeResult.waitingMissions.length === programmeResult.activeMissions.length
    && programmeResult.waitingMissions.every((mission) => accountedMissionIds.has(mission.missionId));

  const uniqueEvidenceProblems = unique(evidenceProblems);
  const uniqueBlockingReasons = unique(blockingReasons);
  const uniqueDegradedReasons = unique(degradedReasons);
  const capabilitySurfaceIds = requiredSurfaceIds(surfaceResult.physicalExecutionRequired);
  const coreSurfacesHealthy = capabilitySurfaceIds.every((id) => {
    const surface = surfaceResult.byId.get(id);
    const policy = SURFACE_POLICIES[id];
    if (!surface || !policy.states.includes(surface.state)) return false;
    if (timestampVerdict(surface.observedAtUtc, { ...timing, maxAgeMs: policy.maxAgeMs }) !== 'CURRENT') return false;
    return !policy.headBound || surface.head === expectedHead;
  });
  const installedHeadSatisfied = !surfaceResult.physicalExecutionRequired || installedMainHead === expectedHead;
  const isCapableOfBuilding = uniqueEvidenceProblems.length === 0
    && SHA_40.test(expectedHead)
    && protectedMainHead === expectedHead
    && installedHeadSatisfied
    && coreSurfacesHealthy
    && !uniqueBlockingReasons.some((reason) => reason.startsWith('surface-') || reason.includes('head-mismatch') || reason.includes('head-unbound'));
  const missionWorker = surfaceResult.byId.get('missionWorker');
  const workerCurrent = missionWorker
    && SURFACE_POLICIES.missionWorker.states.includes(missionWorker.state)
    && missionWorker.head === expectedHead
    && timestampVerdict(missionWorker.observedAtUtc, { ...timing, maxAgeMs: SURFACE_POLICIES.missionWorker.maxAgeMs }) === 'CURRENT';
  const isActuallyBuilding = isCapableOfBuilding
    && workerCurrent
    && programmeResult.productiveMissions.length > 0;

  let state = GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL;
  if (uniqueEvidenceProblems.length > 0) state = GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD;
  else if (uniqueBlockingReasons.length > 0) state = GOAL_BUILDING_OPERATING_STATES.BLOCKED;
  else if (uniqueDegradedReasons.length > 0) state = GOAL_BUILDING_OPERATING_STATES.DEGRADED;
  else if (!isCapableOfBuilding) state = GOAL_BUILDING_OPERATING_STATES.DEGRADED;
  else if (!isActuallyBuilding
    && (programmeResult.activeMissions.length > 0 || programmeResult.eligibleQueuedGoalCount > 0)
    && !allActiveMissionsManagedWait) state = GOAL_BUILDING_OPERATING_STATES.BLOCKED;

  const reasons = [...uniqueEvidenceProblems, ...uniqueBlockingReasons, ...uniqueDegradedReasons];
  const nextAction = chooseNextAction(programmeResult, blockerResult.blockers, operatorAction, reasons, state);
  const summary = buildSummary({
    state,
    isCapableOfBuilding,
    isActuallyBuilding,
    programme: programmeResult,
    blockingReasons: uniqueBlockingReasons,
    degradedReasons: uniqueDegradedReasons,
  });

  let programmeMode = 'ACTIVE_PROGRESS_NOT_PROVEN';
  if (state === GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD) programmeMode = 'SAFE_HOLD';
  else if (state === GOAL_BUILDING_OPERATING_STATES.BLOCKED) programmeMode = 'BLOCKED';
  else if (isActuallyBuilding) programmeMode = 'ACTIVE_PROGRESS_PROVEN';
  else if (programmeResult.activeMissions.length === 0 && programmeResult.eligibleQueuedGoalCount === 0) programmeMode = 'IDLE_NO_ELIGIBLE_WORK';
  else if (allActiveMissionsManagedWait) programmeMode = 'GOVERNED_WAIT';

  return Object.freeze({
    schemaVersion: GOAL_BUILDING_AGENT_SCHEMA_VERSION,
    participantId: GOAL_BUILDING_AGENT_ID,
    evaluatedAtUtc: new Date(timing.nowMs).toISOString(),
    expectedHead,
    protectedMainHead,
    installedMainHead,
    state,
    isCapableOfBuilding,
    isActuallyBuilding,
    programmeMode,
    physicalExecutionRequired: surfaceResult.physicalExecutionRequired,
    activeMissionCount: programmeResult.activeMissions.length,
    productiveMissionCount: programmeResult.productiveMissions.length,
    waitingMissionCount: programmeResult.waitingMissions.length,
    stalledMissionCount: programmeResult.stalledMissions.length,
    eligibleQueuedGoalCount: programmeResult.eligibleQueuedGoalCount,
    qualifiedCapacity: programmeResult.qualifiedCapacity,
    idleQualifiedCapacity: programmeResult.idleQualifiedCapacity,
    activeMissions: programmeResult.activeMissions,
    blockers: blockerResult.blockers,
    evidenceProblems: Object.freeze(uniqueEvidenceProblems),
    blockingReasons: Object.freeze(uniqueBlockingReasons),
    degradedReasons: Object.freeze(uniqueDegradedReasons),
    operatorActionRequired: operatorAction.required,
    operatorActionTarget: operatorAction.target,
    nextAction,
    summary,
    finalVerdict: state,
    safetyLocks: Object.freeze({
      mutationAuthority: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      arbitraryShellAllowed: false,
      leaseSeizureAllowed: false,
      selfPromotionAllowed: false,
    }),
  });
}
