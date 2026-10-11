export const SOVEREIGN_COMMANDER_PARITY_SEED_SCHEMA_V1 = 'stephanos.sovereign-commander-safe-parity-seed.v1';
export const SOVEREIGN_COMMANDER_PARITY_MISSION_ID = 'sovereign-commander-safe-parity';
export const SOVEREIGN_COMMANDER_PARITY_ISSUE = '#2519';
export const SOVEREIGN_COMMANDER_PARITY_TITLE = 'Teach Sovereign Commander Everything Remote Desktop Commander Can Do Safely';

export const SOVEREIGN_COMMANDER_PARITY_NORTH_STAR_V1 =
  'Teach Sovereign Commander everything that Remote Desktop Commander can do safely, so every useful external Commander capability becomes an evidence-backed teaching event that is deduped, safety-classified, implemented or adapted through the existing sovereign capability fabric when practical, proved, qualified and preferred next time without weakening protected approval boundaries.';

export const SOVEREIGN_COMMANDER_PARITY_LOOP_V1 = Object.freeze([
  'OBSERVE_REMOTE_CAPABILITY',
  'CAPTURE_GAP',
  'DEDUPE',
  'CLASSIFY_SAFETY',
  'IMPLEMENT_OR_ADAPT',
  'TEST_PARITY',
  'QUALIFY',
  'ROUTE_SOVEREIGNLY',
  'RETAIN_LESSON',
  'AUDIT',
  'REPEAT',
]);

export const SOVEREIGN_COMMANDER_PARITY_GROWTH_RUNGS_V1 = Object.freeze([
  'SEE_REMOTE_CAPABILITY',
  'CAPTURE_PARITY_GAP',
  'SAFETY_CLASSIFIED',
  'NATIVE_CAPABILITY_BUILT',
  'PARITY_PROVEN',
  'SOVEREIGN_PREFERRED',
  'CONTINUOUS_AUDIT',
]);

export const SOVEREIGN_COMMANDER_PARITY_DIMENSIONS_V1 = Object.freeze([
  'remote-capability-observation',
  'parity-gap-capture',
  'capability-deduplication',
  'safety-classification',
  'bounded-native-implementation',
  'parity-proof',
  'qualification',
  'sovereign-routing-preference',
  'meter-independence',
  'operator-handback-debt',
  'restart-persistence',
  'continuous-parity-audit',
]);

export function buildSovereignCommanderParitySeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_PARITY_SEED_SCHEMA_V1,
    missionId: SOVEREIGN_COMMANDER_PARITY_MISSION_ID,
    issueRef: SOVEREIGN_COMMANDER_PARITY_ISSUE,
    title: SOVEREIGN_COMMANDER_PARITY_TITLE,
    seedKind: 'persistent-sovereign-capability-parity',
    persistent: true,
    northStar: SOVEREIGN_COMMANDER_PARITY_NORTH_STAR_V1,
    operatingLoop: SOVEREIGN_COMMANDER_PARITY_LOOP_V1,
    growthRungs: SOVEREIGN_COMMANDER_PARITY_GROWTH_RUNGS_V1,
    qualityDimensions: SOVEREIGN_COMMANDER_PARITY_DIMENSIONS_V1,
    operatorRole: 'intent-judgment-protected-approval',
    growthContract: Object.freeze({
      everyUsefulRemoteCommanderUseIsATeachingEvent: true,
      dedupeBeforeBuilding: true,
      copyCapabilityNotUnsafeAuthority: true,
      boundedNativeCapabilityRequired: true,
      parityRequiresRepresentativeTaskProof: true,
      qualificationRequiredBeforePreferredRouting: true,
      remoteCommanderRemainsBreakGlassTeacher: true,
      meterExhaustionMustNotCreateSafeOperatorHandback: true,
      unavoidableOperatorHandbackBecomesCapabilityDebt: true,
      learnedCapabilitySurvivesRestart: true,
      evidenceBackedOnly: true,
      missingEvidenceStaysUnknown: true,
    }),
    authority: Object.freeze({
      protectedApprovalsPreserved: true,
      arbitraryShellAuthorityGrantedBySeed: false,
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      credentialExportAllowedBySeed: false,
      pcRestartAllowedBySeed: false,
      duplicateCapabilityRegistryAllowed: false,
      duplicateControllerAllowed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
