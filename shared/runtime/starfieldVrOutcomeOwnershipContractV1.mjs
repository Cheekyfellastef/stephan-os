export const STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1 = 'stephanos.starfield-vr-outcome-ownership-seed.v1';
export const STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID = 'starfield-vr-outcome-ownership';
export const STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID = 'starfield-vr-outcome-seed-planted';

export const STARFIELD_VR_OUTCOME_OWNERSHIP_QUALITY_DIMENSIONS_V1 = Object.freeze([
  'visual-quality',
  'frame-time-stability',
  'head-motion-clarity',
  'latency',
  'alternate-eye-stability',
  'comfort',
  'crash-resistance',
  'controller-reliability',
  'audio-routing',
  'launcher-reliability',
  'telemetry-quality',
  'recovery-quality',
]);

export const STARFIELD_VR_OUTCOME_OWNERSHIP_OPERATING_LOOP_V1 = Object.freeze([
  'OBSERVE',
  'DIAGNOSE',
  'PLAN',
  'EXPERIMENT',
  'MEASURE',
  'VERIFY',
  'LEARN',
  'RETAIN',
  'IMPROVE',
  'REPEAT',
]);

export const STARFIELD_VR_OUTCOME_OWNERSHIP_PRESERVED_ROUTES_V1 = Object.freeze([
  'mutar-openxr',
  'vorpx',
]);

export function buildStarfieldVrOutcomeOwnershipContractV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    missionKind: 'persistent-outcome-ownership-bootstrap',
    northStar: 'Continuously improve Starfield into the best VR experience achievable on the Battle Bridge while preserving safe operator control.',
    qualityDimensions: STARFIELD_VR_OUTCOME_OWNERSHIP_QUALITY_DIMENSIONS_V1,
    preservedRoutes: STARFIELD_VR_OUTCOME_OWNERSHIP_PRESERVED_ROUTES_V1,
    operatingLoop: STARFIELD_VR_OUTCOME_OWNERSHIP_OPERATING_LOOP_V1,
    humanJudgmentGates: Object.freeze([
      'perceived-image-quality',
      'motion-artifacts',
      'comfort-and-nausea',
      'subjective-responsiveness',
      'experience-preference',
    ]),
    learningContract: Object.freeze({
      realWorkFeedsSharedWorkspace: true,
      capabilityGapsFeedClosedLoopLearning: true,
      failedExperimentsRemainEvidence: true,
      retainedLessonsFeedFlywheel: true,
      genericLessonsPromoteFromStarfieldToVrToStephanos: true,
    }),
    growthTelemetryContract: Object.freeze({
      sourceOfTruth: 'shared-workspace',
      countPlaytestEvidence: true,
      countCapabilityGaps: true,
      countTeachingLoops: true,
      countProofReadyCapabilities: true,
      countRetainedLessons: true,
      exposeNextBestAction: true,
      missingEvidenceStaysUnknown: true,
    }),
    authority: Object.freeze({
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      duplicateControllerAllowed: false,
      duplicateSchedulerAllowed: false,
      existingApprovalGatesPreserved: true,
    }),
    operatorRole: 'intent-judgment-protected-approval',
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
