export const WORKSPACE_INTEGRITY_SEED_SCHEMA_V1 = 'stephanos.workspace-integrity-provenance-seed.v1';
export const WORKSPACE_INTEGRITY_MISSION_ID = 'workspace-integrity-provenance';
export const WORKSPACE_INTEGRITY_ISSUE = '#2898';
export const WORKSPACE_INTEGRITY_TITLE = 'Every Workspace, Card and Visualiser Has Verified End-to-End Provenance';

export const WORKSPACE_INTEGRITY_NORTH_STAR_V1 =
  'Every workspace, card and data visualiser is continuously traceable from one canonical source through transport and transformation to the consuming component and rendered value, with freshness, schema, reconciliation, synthetic proof, orphan detection and guarded repair pressure so unknown or stale wiring can never masquerade as healthy.';

export const WORKSPACE_INTEGRITY_LOOP_V1 = Object.freeze([
  'INVENTORY',
  'IDENTIFY',
  'BIND_CANONICAL_SOURCE',
  'VALIDATE_CONTRACT',
  'PROVE_HYDRATION',
  'RECONCILE_SOURCE_TO_RENDER',
  'RUN_SYNTHETIC_PROOF',
  'DETECT_ORPHANS',
  'REPAIR_OR_ESCALATE',
  'AUDIT',
  'REPEAT',
]);

export const WORKSPACE_INTEGRITY_GROWTH_RUNGS_V1 = Object.freeze([
  'INVENTORY_VISIBLE_COMPONENTS',
  'STABLE_IDENTITIES',
  'CANONICAL_SOURCE_BINDINGS',
  'CONTRACTS_PROVEN',
  'HYDRATION_PROVEN',
  'SOURCE_RENDER_RECONCILED',
  'SYNTHETIC_PROOF_CURRENT',
  'ORPHAN_FREE',
  'CONTINUOUSLY_VERIFIED',
]);

export const WORKSPACE_INTEGRITY_DIMENSIONS_V1 = Object.freeze([
  'workspace-identity',
  'component-identity',
  'canonical-source-binding',
  'transport-provenance',
  'transformation-provenance',
  'consumer-binding',
  'rendered-value-proof',
  'schema-and-unit-contract',
  'freshness',
  'source-render-reconciliation',
  'synthetic-end-to-end-proof',
  'orphan-detection',
  'guarded-self-repair',
  'shared-workspace-visibility',
]);

export function buildWorkspaceIntegritySeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: WORKSPACE_INTEGRITY_SEED_SCHEMA_V1,
    missionId: WORKSPACE_INTEGRITY_MISSION_ID,
    issueRef: WORKSPACE_INTEGRITY_ISSUE,
    title: WORKSPACE_INTEGRITY_TITLE,
    seedKind: 'persistent-workspace-integrity-provenance',
    persistent: true,
    northStar: WORKSPACE_INTEGRITY_NORTH_STAR_V1,
    operatingLoop: WORKSPACE_INTEGRITY_LOOP_V1,
    growthRungs: WORKSPACE_INTEGRITY_GROWTH_RUNGS_V1,
    qualityDimensions: WORKSPACE_INTEGRITY_DIMENSIONS_V1,
    operatorRole: 'intent-judgment-protected-approval',
    growthContract: Object.freeze({
      everyVisibleComponentNeedsStableIdentity: true,
      everyVisibleComponentNeedsCanonicalSource: true,
      everyBindingNeedsSchemaAndUnitContract: true,
      hydrationMustBeProvenEndToEnd: true,
      provenanceMustIncludeSourceAndObservationTimes: true,
      renderedValueMustReconcileWithCanonicalValue: true,
      syntheticProofRequiredForGreen: true,
      orphanConsumersBecomeGaps: true,
      unconsumedImportantSourcesBecomeGaps: true,
      staleOrUnknownNeverCountsAsGreen: true,
      simpleRepairMayUseExistingGuardedRepairMachinery: true,
      structuralMutationStillRequiresExistingApprovalBoundaries: true,
      evidenceBackedOnly: true,
      missingEvidenceStaysUnknown: true,
      noDuplicateRegistryOrController: true,
    }),
    authority: Object.freeze({
      protectedApprovalsPreserved: true,
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      arbitraryShellAllowedBySeed: false,
      duplicateRegistryAllowed: false,
      duplicateControllerAllowed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}