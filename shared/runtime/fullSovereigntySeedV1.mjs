export const FULL_SOVEREIGNTY_SEED_SCHEMA_V1 = 'stephanos.full-sovereignty-seed.v1';
export const FULL_SOVEREIGNTY_MISSION_ID = 'stephanos-full-sovereignty-every-function';
export const FULL_SOVEREIGNTY_ISSUE = '#3026';
export const FULL_SOVEREIGNTY_TITLE = 'Stephanos Full Sovereignty: Every Function, Zero External Critical Dependencies';

export const FULL_SOVEREIGNTY_NORTH_STAR_V1 =
  'Allow Stephanos to operate every core function independently of external meters, paid services, cloud control planes and internet availability. Prefer operator-controlled AI, memory, orchestration, building, review, recovery and interfaces; treat inherently external interactions as optional, explicitly degraded and safely resumable.';

export const FULL_SOVEREIGNTY_OPERATING_LOOP_V1 = Object.freeze([
  'INVENTORY_ALL_FUNCTIONS',
  'MAP_CRITICAL_EXTERNAL_EDGES',
  'REUSE_EXISTING_SOVEREIGN_MACHINERY',
  'REPAIR_HIGHEST_IMPACT_GAP',
  'PROVE_PARITY_AND_GUARDRAILS',
  'PREFER_LOCAL_OPERATION',
  'REPLAY_EXTERNAL_BLACKOUT',
  'AUDIT_AND_SELF_REPAIR',
]);

export const FULL_SOVEREIGNTY_GROWTH_RUNGS_V1 = Object.freeze([
  'INVENTORY_ALL_FUNCTIONS_AND_EXTERNAL_EDGES',
  'MAP_LOCAL_SOVEREIGN_CAPABILITIES',
  'IDENTIFY_CRITICAL_DEPENDENCY_GAPS',
  'BUILD_OR_REUSE_LOCAL_REPLACEMENTS',
  'VERIFY_PARITY_AND_SAFETY_PER_FUNCTION',
  'SWITCH_DEFAULT_TO_SOVEREIGN_ROUTES',
  'PROVE_FULL_EXTERNAL_BLACKOUT_CONTINUITY',
  'CONTINUOUSLY_AUDIT_AND_SELF_REPAIR',
]);

export const FULL_SOVEREIGNTY_DIMENSIONS_V1 = Object.freeze([
  'local-ai-inference-and-router',
  'memory-and-workspace-state',
  'goals-and-approvals',
  'local-observation-and-search',
  'local-coding-building-and-testing',
  'independent-local-review',
  'worker-and-controller-endurance',
  'core-daemon-self-repair',
  'sovereign-commander-remote-operation',
  'storage-backup-and-restore',
  'local-security-and-telemetry',
  'network-disconnect-tolerance',
  'graceful-external-integration-queue',
  'provider-and-meter-independence',
  'offline-restart-and-recovery',
  'proof-and-continuous-audit',
]);

export const FULL_SOVEREIGNTY_EXISTING_OWNERS_V1 = Object.freeze([
  '#2968', // Sovereign Meter Independence.
  '#1898', // Zero-Codex provider parity.
  '#2519', // Sovereign Commander Safe Parity.
  '#2670', // Whole-System Capability Closure.
  '#2972', // Continuous Goal Conveyor & Fleet Care.
  '#2593', // Core Daemon.
]);

export function buildFullSovereigntySeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: FULL_SOVEREIGNTY_SEED_SCHEMA_V1,
    missionId: FULL_SOVEREIGNTY_MISSION_ID,
    issueRef: FULL_SOVEREIGNTY_ISSUE,
    title: FULL_SOVEREIGNTY_TITLE,
    seedKind: 'persistent-every-function-sovereignty',
    persistent: true,
    northStar: FULL_SOVEREIGNTY_NORTH_STAR_V1,
    operatingLoop: FULL_SOVEREIGNTY_OPERATING_LOOP_V1,
    growthRungs: FULL_SOVEREIGNTY_GROWTH_RUNGS_V1,
    qualityDimensions: FULL_SOVEREIGNTY_DIMENSIONS_V1,
    existingOwnerIssueRefs: FULL_SOVEREIGNTY_EXISTING_OWNERS_V1,
    operatorRole: 'intent-judgment-protected-approval',
    growthContract: Object.freeze({
      coversEveryCoreFunction: true,
      allExternalCriticalDependenciesVisible: true,
      localCapabilityPreferredAfterQualification: true,
      externalSpecificInteractionsClearlyDegradedWhenOffline: true,
      preserveQueuedWorkAndIdentityAcrossDisconnect: true,
      requireBlackoutEnduranceAndResumeProof: true,
      dedupeWithExistingSeedAndGoalOwners: true,
      noProviderQuotaOrPaymentBoundaryEvasion: true,
      keepProtectedReviewAndOperatorApproval: true,
      currentSourceBoundHeartbeatRequired: true,
      typedEvidenceForEveryGrowthRung: true,
      missingOrStaleEvidenceIsUnknown: true,
      noParallelSchedulersOrAuthorityPlanes: true,
    }),
    authority: Object.freeze({
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      spendingAllowedBySeed: false,
      credentialExportAllowedBySeed: false,
      arbitraryShellAllowedBySeed: false,
      duplicateControllerAllowed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
