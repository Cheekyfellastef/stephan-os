export const SOVEREIGN_METER_INDEPENDENCE_SEED_SCHEMA_V1 = 'stephanos.sovereign-meter-independence-seed.v1';
export const SOVEREIGN_METER_INDEPENDENCE_MISSION_ID = 'stephanos-sovereign-meter-independence';
export const SOVEREIGN_METER_INDEPENDENCE_ISSUE = '#2968';
export const SOVEREIGN_METER_INDEPENDENCE_TITLE = 'Stephanos Sovereign Meter Independence';

export const SOVEREIGN_METER_INDEPENDENCE_NORTH_STAR_V1 =
  'No buildable Stephanos mission or repair may depend exclusively on a third-party metered tool or credit balance when a lawful, safety-qualified sovereign route is practical. Reuse existing provider-neutral, Commander, Forge and OpenClaw machinery; prove a complete zero-meter build loop before declaring autonomy.';

export const SOVEREIGN_METER_INDEPENDENCE_LOOP_V1 = Object.freeze([
  'INVENTORY_METERED_TOUCHPOINTS',
  'FIND_EXISTING_SOVEREIGN_ROUTES',
  'DEDUPE_AND_CLASSIFY_GAPS',
  'BUILD_OR_ADAPT_BOUNDED_CAPABILITY',
  'PROVE_EQUIVALENT_TASK',
  'QUALIFY_AND_PREFER_SOVEREIGN',
  'TEST_METER_BLACKOUT',
  'AUDIT_AND_REPEAT',
]);

export const SOVEREIGN_METER_INDEPENDENCE_GROWTH_RUNGS_V1 = Object.freeze([
  'INVENTORY_METERS',
  'MAP_EXISTING_SOVEREIGN_ROUTES',
  'IDENTIFY_CRITICAL_PATH_GAPS',
  'BUILD_OR_ADAPT_NATIVE_CAPABILITIES',
  'PROVE_TASK_PARITY',
  'QUALIFY_AND_PREFER_SOVEREIGN',
  'TEST_ZERO_EXTERNAL_METER',
  'CONTINUOUS_REASSESSMENT',
]);

export const SOVEREIGN_METER_INDEPENDENCE_DIMENSIONS_V1 = Object.freeze([
  'codex-work-continuity',
  'remote-commander-parity',
  'relay-and-tunnel-independence',
  'model-provider-neutrality',
  'github-api-rate-limit-resilience',
  'non-metered-worker-pickup',
  'bounded-native-execution',
  'exact-head-independent-review',
  'canonical-receipt-proof',
  'blackout-test',
  'operator-protected-approval',
  'external-boundary-classification',
]);

export const SOVEREIGN_METER_INDEPENDENCE_EXISTING_OWNERS_V1 = Object.freeze([
  '#1898', // Zero-Codex Continuity and Provider Parity.
  '#2519', // Sovereign Commander Safe Parity.
]);

export function buildSovereignMeterIndependenceSeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: SOVEREIGN_METER_INDEPENDENCE_SEED_SCHEMA_V1,
    missionId: SOVEREIGN_METER_INDEPENDENCE_MISSION_ID,
    issueRef: SOVEREIGN_METER_INDEPENDENCE_ISSUE,
    title: SOVEREIGN_METER_INDEPENDENCE_TITLE,
    seedKind: 'persistent-provider-neutral-meter-independence',
    persistent: true,
    northStar: SOVEREIGN_METER_INDEPENDENCE_NORTH_STAR_V1,
    operatingLoop: SOVEREIGN_METER_INDEPENDENCE_LOOP_V1,
    growthRungs: SOVEREIGN_METER_INDEPENDENCE_GROWTH_RUNGS_V1,
    qualityDimensions: SOVEREIGN_METER_INDEPENDENCE_DIMENSIONS_V1,
    existingOwnerIssueRefs: SOVEREIGN_METER_INDEPENDENCE_EXISTING_OWNERS_V1,
    operatorRole: 'intent-judgment-protected-approval',
    growthContract: Object.freeze({
      mapEveryMeteredCriticalPath: true,
      dedupeWithExistingCapabilityAndGoalOwnership: true,
      sovereignRoutesRequireRepresentativeTaskQualification: true,
      meterBlackoutRequiresWorkerPickupAndCompletionProof: true,
      preserveTaskIdentityOnProviderFailover: true,
      neverEvadeProviderQuotasOrPaymentBoundaries: true,
      legitimateHostedDependenciesRemainExplicit: true,
      preferGuardedMeterFreeRoutingOnlyAfterQualification: true,
      currentHeartbeatRequiredBeforeGoalPressure: true,
      missingEvidenceStaysUnknown: true,
      noDuplicateQueueSchedulerOrCommander: true,
    }),
    authority: Object.freeze({
      protectedApprovalsPreserved: true,
      arbitraryShellAllowedBySeed: false,
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      credentialExportAllowedBySeed: false,
      spendingAllowedBySeed: false,
      duplicateControllerAllowed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
