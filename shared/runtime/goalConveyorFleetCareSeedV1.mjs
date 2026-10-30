export const GOAL_CONVEYOR_FLEET_CARE_SEED_SCHEMA_V1 = 'stephanos.goal-conveyor-fleet-care-seed.v1';
export const GOAL_CONVEYOR_FLEET_CARE_MISSION_ID = 'goal-conveyor-fleet-care';
export const GOAL_CONVEYOR_FLEET_CARE_ISSUE = '#2972';
export const GOAL_CONVEYOR_FLEET_CARE_TITLE = 'Continuous Goal Conveyor and Fleet Care';

export const GOAL_CONVEYOR_FLEET_CARE_OWNER_GOALS_V1 = Object.freeze([
  Object.freeze({ issue: '#2670', role: 'Whole-system gap detection and learning' }),
  Object.freeze({ issue: '#2002', role: 'Goal Building Agent and conveyor stewardship' }),
  Object.freeze({ issue: '#1622', role: 'Guarded SELECT, CLAIM and physical worker pickup' }),
  Object.freeze({ issue: '#2697', role: 'Flywheel canonical goal admission' }),
  Object.freeze({ issue: '#2593', role: 'Durable Core Daemon and sovereign inspection' }),
  Object.freeze({ issue: '#2961', role: 'Blocked-goal repair and proof-gated re-admission' }),
  Object.freeze({ issue: '#1858', role: 'Closed-chat unattended endurance' }),
  Object.freeze({ issue: '#2519', role: 'Meter-free Commander safe parity' }),
  Object.freeze({ issue: '#2954', role: 'GitHub 403/cooldown and anti-hammer discipline' }),
]);

export const GOAL_CONVEYOR_FLEET_CARE_RUNGS_V1 = Object.freeze([
  'SEED_PLANTED',
  'FLEET_OBSERVED',
  'HEALTH_VERIFIED',
  'SELECT_CLAIM_PROVEN',
  'WORKER_PICKUP_PROVEN',
  'RESULT_LIVE_PROVEN',
  'BLOCKERS_RECOVERED',
  'LESSONS_RETAINED',
  'CONTINUOUS_AUDIT',
]);

export const GOAL_CONVEYOR_FLEET_CARE_LOOP_V1 = Object.freeze([
  'OBSERVE_FLEET_AND_CONVEYOR', 'VERIFY_HEALTH_AND_CAPACITY',
  'TRACE_ADMISSION_SELECT_CLAIM', 'PROVE_PHYSICAL_PICKUP',
  'PROVE_RESULT_AND_LIVE_DEPLOY', 'DETECT_DEDUPE_AND_ASSIGN_FAULTS',
  'RECOVER_AND_READMIT_SAFELY', 'RETAIN_LESSONS', 'REPEAT',
]);

export function buildGoalConveyorFleetCareSeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: GOAL_CONVEYOR_FLEET_CARE_SEED_SCHEMA_V1,
    missionId: GOAL_CONVEYOR_FLEET_CARE_MISSION_ID,
    issueRef: GOAL_CONVEYOR_FLEET_CARE_ISSUE,
    title: GOAL_CONVEYOR_FLEET_CARE_TITLE,
    seedKind: 'persistent-goal-conveyor-fleet-care',
    persistent: true,
    northStar: 'Continuously maintain and improve the real goal-to-build-to-live conveyor and the entire Stephanos fleet. Detect stalls, broken daemons, empty meters, 403 cooldowns, missed pickups and proof gaps; recover through existing owners and prove the system keeps building unattended.',
    operatingLoop: GOAL_CONVEYOR_FLEET_CARE_LOOP_V1,
    growthRungs: GOAL_CONVEYOR_FLEET_CARE_RUNGS_V1,
    qualityDimensions: Object.freeze([
      'goal-selection', 'canonical-admission', 'select-and-claim', 'worker-pickup',
      'fleet-availability', 'daemon-persistence', 'leases-and-heartbeats',
      'provider-independent-execution', 'proof-and-merge', 'live-deployment',
      'stall-and-blocker-recovery', 'rate-limit-discipline', 're-admission',
      'continuous-learning-and-regression-audit',
    ]),
    canonicalOwnerGoals: GOAL_CONVEYOR_FLEET_CARE_OWNER_GOALS_V1,
    operatorRole: 'intent-judgment-protected-approval',
    growthContract: Object.freeze({
      dispatchWithoutPickupIsNotBuilding: true,
      noGreenFromHeartbeatAlone: true,
      missingOrStaleTelemetryStaysUnknown: true,
      preserveOriginalGoalIdentity: true,
      useExistingCanonicalOwnersAndConveyor: true,
      dedupeFailuresAndGrowthPressure: true,
      enforceRateLimitCooldown: true,
      requireExactHeadIndependentProof: true,
      requireLiveReceiptForCompletion: true,
      learnAndRecheckAfterRepair: true,
    }),
    authority: Object.freeze({
      protectedApprovalsPreserved: true,
      arbitraryShellAllowedBySeed: false,
      sourceMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      duplicateControllerAllowed: false,
      duplicateDaemonAllowed: false,
      duplicateQueueAllowed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
