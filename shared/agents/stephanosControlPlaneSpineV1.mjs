export const STEPHANOS_CONTROL_PLANE_SPINE_SCHEMA = 'stephanos.control-plane-spine.v1';

const SHA40 = /^[0-9a-f]{40}$/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function projectStephanosControlPlaneSpine(input = {}) {
  const core = input.coreState || {};
  const flywheel = input.flywheelStatus || {};
  const sourceHead = text(core.sourceHead).toLowerCase();
  const dependencyHealthy = core.readiness === 'READY'
    && core.sovereignCommanderHealthy === true
    && core.backendHealthy === true
    && core.missionWorkerHealthy === true;
  const flywheelCycleRunning = flywheel.flywheelCycleRunning === true;
  const completedCycle = Boolean(text(flywheel.flywheelLastCycleFinishedAtUtc));
  const refillStatus = text(flywheel.refillStatus, 'NOT_RUN').toUpperCase();
  const octopusBuildVerdict = text(flywheel.octopusBuildVerdict, 'WAITING').toUpperCase();
  const safeEligibleWorkRemaining = count(flywheel.refillSafeEligibleWorkRemaining);
  const provenSafeFreeLanes = count(flywheel.refillProvenSafeFreeLanes);
  const materialActions = count(flywheel.refillMaterialActionsSucceeded);
  const strandedCapacity = safeEligibleWorkRemaining > 0
    && provenSafeFreeLanes > 0
    && materialActions === 0;
  const repairRequired = !dependencyHealthy
    || refillStatus === 'DEGRADED'
    || flywheel.octopusNeedsRepair === true
    || strandedCapacity;

  let repairReason = '';
  if (core.sovereignCommanderHealthy !== true) repairReason = 'SOVEREIGN_COMMANDER_UNHEALTHY';
  else if (core.backendHealthy !== true) repairReason = 'BACKEND_8787_UNHEALTHY';
  else if (core.missionWorkerHealthy !== true) repairReason = 'MISSION_WORKER_UNHEALTHY';
  else if (refillStatus === 'DEGRADED') repairReason = 'CANONICAL_REFILL_DEGRADED';
  else if (flywheel.octopusNeedsRepair === true) repairReason = 'OCTOPUS_SELF_REPAIR_REQUIRED';
  else if (strandedCapacity) repairReason = 'SAFE_WORK_STRANDED_WITH_FREE_CAPACITY';

  const wakeState = !completedCycle
    ? 'BOOTSTRAPPING'
    : repairRequired
      ? 'DEGRADED'
      : 'AWAKE';

  return Object.freeze({
    schemaVersion: STEPHANOS_CONTROL_PLANE_SPINE_SCHEMA,
    sourceHead: SHA40.test(sourceHead) ? sourceHead : '',
    wakeState,
    awake: wakeState === 'AWAKE',
    dependencyHealthy,
    firstAutonomousCycleComplete: completedCycle,
    flywheelCycleRunning,
    refillStatus,
    octopusBuildVerdict,
    safeEligibleWorkRemaining,
    provenSafeFreeLanes,
    materialActionsLastCycle: materialActions,
    strandedCapacity,
    repairRequired,
    repairReason,
    controlPlaneFinalVerdict: wakeState === 'AWAKE'
      ? 'STEPHANOS_CONTROL_PLANE_AWAKE'
      : wakeState === 'BOOTSTRAPPING'
        ? 'STEPHANOS_CONTROL_PLANE_BOOTSTRAPPING'
        : 'STEPHANOS_CONTROL_PLANE_REPAIR_REQUIRED',
    sourceMutationAllowed: false,
    mergeAuthority: false,
    duplicateSchedulerAllowed: false,
    duplicateControllerFabricAllowed: false,
  });
}
