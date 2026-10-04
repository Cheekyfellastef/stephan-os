import { buildMissionEngineV1 } from './missionEngineV1.mjs';

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

export const STARFIELD_VR_OUTCOME_OWNERSHIP_ACCEPTANCE_CRITERIA_V1 = Object.freeze([
  Object.freeze({
    id: 'visual-quality',
    title: 'Visual quality remains usable across representative play',
    severity: 'HIGH',
    weight: 4,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-rendering']),
  }),
  Object.freeze({
    id: 'frame-time-stability',
    title: 'Frame time remains stable enough for the selected VR route',
    severity: 'CRITICAL',
    weight: 5,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-performance']),
  }),
  Object.freeze({
    id: 'head-motion-clarity',
    title: 'Head movement preserves image clarity without destructive breakup',
    severity: 'CRITICAL',
    weight: 5,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-rendering']),
  }),
  Object.freeze({
    id: 'latency',
    title: 'Motion-to-photon response remains within a comfortable verified envelope',
    severity: 'HIGH',
    weight: 4,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-performance']),
  }),
  Object.freeze({
    id: 'alternate-eye-stability',
    title: 'Alternate-eye presentation remains stable during movement',
    severity: 'CRITICAL',
    weight: 5,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-rendering']),
  }),
  Object.freeze({
    id: 'comfort',
    title: 'Representative play remains comfortable by operator judgment',
    severity: 'CRITICAL',
    weight: 5,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-playtest']),
  }),
  Object.freeze({
    id: 'crash-resistance',
    title: 'Representative sessions start, run, and exit without unacceptable crashes',
    severity: 'HIGH',
    weight: 4,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-runtime']),
  }),
  Object.freeze({
    id: 'controller-reliability',
    title: 'Controller input remains reliable across launch, play, and exit',
    severity: 'HIGH',
    weight: 4,
    proofRequired: true,
    routeHint: 'BATTLE_BRIDGE_FIXED_TEST',
    resourceIds: Object.freeze(['starfield-vr-input']),
  }),
  Object.freeze({
    id: 'audio-routing',
    title: 'Audio switches to the headset for VR and restores the previous device on exit',
    severity: 'MEDIUM',
    weight: 3,
    proofRequired: true,
    routeHint: 'OPENCLAW_LOCAL',
    resourceIds: Object.freeze(['windows-audio']),
  }),
  Object.freeze({
    id: 'launcher-reliability',
    title: 'The Starfield VR launcher starts the chosen verified route repeatably',
    severity: 'HIGH',
    weight: 4,
    proofRequired: true,
    routeHint: 'OPENCLAW_LOCAL',
    resourceIds: Object.freeze(['starfield-vr-launcher']),
  }),
  Object.freeze({
    id: 'telemetry-quality',
    title: 'Every representative playtest produces enough trusted telemetry to drive the next decision',
    severity: 'HIGH',
    weight: 4,
    proofRequired: true,
    routeHint: 'CHATGPT_GITHUB',
    resourceIds: Object.freeze(['starfield-vr-telemetry']),
  }),
  Object.freeze({
    id: 'recovery-quality',
    title: 'Failed launches and recoverable runtime faults leave the Battle Bridge in a known safe state',
    severity: 'MEDIUM',
    weight: 3,
    proofRequired: true,
    routeHint: 'OPENCLAW_LOCAL',
    resourceIds: Object.freeze(['starfield-vr-recovery']),
  }),
]);

export function buildStarfieldVrOutcomeOwnershipContractV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    missionKind: 'persistent-outcome-ownership-bootstrap',
    title: 'Starfield VR Excellence',
    northStar: 'Continuously improve Starfield into the best VR experience achievable on the Battle Bridge while preserving safe operator control.',
    desiredOutcome: 'Continuously improve Starfield into the best VR experience achievable on the Battle Bridge while preserving safe operator control.',
    qualityDimensions: STARFIELD_VR_OUTCOME_OWNERSHIP_QUALITY_DIMENSIONS_V1,
    outcomeContract: STARFIELD_VR_OUTCOME_OWNERSHIP_ACCEPTANCE_CRITERIA_V1,
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

export function buildStarfieldVrMissionEngineV1(input = {}) {
  const contract = buildStarfieldVrOutcomeOwnershipContractV1(input);
  return buildMissionEngineV1({
    mission: {
      missionId: contract.missionId,
      title: contract.title,
      desiredOutcome: contract.desiredOutcome,
      outcomeContract: contract.outcomeContract,
    },
    currentState: input.currentState,
    existingGoals: input.existingGoals,
    schedulerInput: input.schedulerInput,
    lessons: input.lessons,
    trigger: input.trigger,
    previousProjection: input.previousProjection,
  });
}
