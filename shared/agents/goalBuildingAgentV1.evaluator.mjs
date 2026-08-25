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
  if (!SHA_40.test(protectedMainHead)) evidenceProblems.push('protected-main-head-invalid');
  if (!SHA_40.test(installedMainHead)) evidenceProblems.push('installed-main-head-invalid');
  if (SHA_40.test(expectedHead) && SHA_40.test(protectedMainHead) && protectedMainHead !== expectedHead) evidenceProblems.push('expected-protected-main-contradiction');
  if (SHA_40.test(expectedHead) && SHA_40.test(installedMainHead) && installedMainHead !== expectedHead) blockingReasons.push('installed-main-head-mismatch');

  const surfaceResult = validateSurfaceSet(input, expectedHead, timing);
  const programmeResult = validateProgramme(input, expectedHead, timing);
  const blockerResult = validateBlockers(input, timing);
  const operatorAction = validateOperatorAction(input);
  evidenceProblems.push(...surfaceResult.evidenceProblems, ...programmeResult.evidenceProblems, ...blockerResult.evidenceProblems, ...operatorAction.evidenceProblems);
  blockingReasons.push(...surfaceResult.blockingReasons, ...programmeResult.blockingReasons, ...blockerResult.blockingReasons);
  degradedReasons.push(...surfaceResult.degradedReasons, ...programmeResult.degradedReasons, ...blockerResult.degradedReasons);

  const derivedIndependentWorkContinues = programmeResult.productiveMissions.length > 0
    || (programmeResult.eligibleQueuedGoalCount === 0
      && programmeResult.activeMissions.length > 0
      && programmeResult.waitingMissions.length === programmeResult.activeMissions.length);
  for (const blocker of blockerResult.blockers) {
    if (blocker.independentWorkContinues && !derivedIndependentWorkContinues) {
      evidenceProblems.push(`independent-work-claim-unproven:${blocker.blockerId || 'missing'}`);
    }
  }

  const accountedMissionIds = new Set(blockerResult.blockers.filter((blocker) => blocker.ownerId && blocker.route && blocker.nextAction).map((blocker) => blocker.missionId).filter(Boolean));
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
  const isCapableOfBuilding = uniqueEvidenceProblems.length === 0
    && SHA_40.test(expectedHead)
    && protectedMainHead === expectedHead
    && installedMainHead === expectedHead
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
  const nextAction = chooseNextAction(programmeResult, blockerResult.blockers, operatorAction, reasons);
  const summary = buildSummary({
    state,
    isCapableOfBuilding,
    isActuallyBuilding,
    programme: programmeResult,
    blockingReasons: uniqueBlockingReasons,
    degradedReasons: uniqueDegradedReasons,
  });

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
    programmeMode: isActuallyBuilding
      ? 'ACTIVE_PROGRESS_PROVEN'
      : (programmeResult.activeMissions.length === 0 && programmeResult.eligibleQueuedGoalCount === 0 ? 'IDLE_NO_ELIGIBLE_WORK' : 'ACTIVE_PROGRESS_NOT_PROVEN'),
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
