export const AUTONOMOUS_PROJECT_STEWARDSHIP_SEED_SCHEMA_V1 = 'stephanos.autonomous-project-stewardship-seed.v1';
export const AUTONOMOUS_PROJECT_STEWARDSHIP_MISSION_ID = 'stephanos-runs-the-project';
export const AUTONOMOUS_PROJECT_STEWARDSHIP_ISSUE = '#2796';
export const AUTONOMOUS_PROJECT_STEWARDSHIP_TITLE = 'Stephanos Runs the Project';

export const AUTONOMOUS_PROJECT_STEWARDSHIP_NORTH_STAR_V1 =
  'Stephanos continuously chooses the next valuable rung, converts evidence-backed gaps into owned work, proves downstream pickup and completion, learns from the result, replans, and keeps the project moving upward without routine operator or ChatGPT pokes while preserving protected approval boundaries.';

export const AUTONOMOUS_PROJECT_STEWARDSHIP_LOOP_V1 = Object.freeze([
  'OBSERVE',
  'PRIORITISE',
  'PLAN',
  'DELEGATE',
  'PROVE_PICKUP',
  'BUILD',
  'VERIFY',
  'LEARN',
  'NEXT_RUNG',
  'REPEAT',
]);

export const AUTONOMOUS_PROJECT_STEWARDSHIP_GROWTH_RUNGS_V1 = Object.freeze([
  'SEE_REALITY',
  'CHOOSE_NEXT_RUNG',
  'DELEGATE',
  'PROVE_PICKUP',
  'PROVE_COMPLETION',
  'REPLAN',
  'REPEAT_UNPROMPTED',
]);

export const AUTONOMOUS_PROJECT_STEWARDSHIP_DIMENSIONS_V1 = Object.freeze([
  'goal-selection',
  'foreman-planning',
  'delegation',
  'pickup-proof',
  'builder-liveness',
  'completion-proof',
  'automatic-replanning',
  'flywheel-pressure',
  'repair-coordination',
  'operator-independence',
  'sovereign-continuity',
]);

export function buildAutonomousProjectStewardshipSeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: AUTONOMOUS_PROJECT_STEWARDSHIP_SEED_SCHEMA_V1,
    missionId: AUTONOMOUS_PROJECT_STEWARDSHIP_MISSION_ID,
    issueRef: AUTONOMOUS_PROJECT_STEWARDSHIP_ISSUE,
    title: AUTONOMOUS_PROJECT_STEWARDSHIP_TITLE,
    seedKind: 'persistent-project-stewardship',
    persistent: true,
    northStar: AUTONOMOUS_PROJECT_STEWARDSHIP_NORTH_STAR_V1,
    operatingLoop: AUTONOMOUS_PROJECT_STEWARDSHIP_LOOP_V1,
    growthRungs: AUTONOMOUS_PROJECT_STEWARDSHIP_GROWTH_RUNGS_V1,
    qualityDimensions: AUTONOMOUS_PROJECT_STEWARDSHIP_DIMENSIONS_V1,
    operatorRole: 'intent-judgment-protected-approval',
    growthContract: Object.freeze({
      evidenceBackedOnly: true,
      pressurePersistsUntilPickupProof: true,
      handoffIsNotCompletion: true,
      completionRequiresProof: true,
      completionTriggersNextRung: true,
      missingEvidenceStaysUnknown: true,
      routineOperatorPokesAreARegressionSignal: true,
      autonomyCreditRequiresExplicitProvenance: true,
      assistedWorkEarnsZeroAutonomyCredit: true,
      missingProvenanceNeverImpliesAutonomy: true,
    }),
    authority: Object.freeze({
      protectedApprovalsPreserved: true,
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      duplicateControllerAllowed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
