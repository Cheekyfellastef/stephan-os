export const OPENCLAW_EXCELLENCE_SEED_SCHEMA_V1 = 'stephanos.openclaw-excellence-seed.v1';
export const OPENCLAW_EXCELLENCE_MISSION_ID = 'openclaw-local-standalone-continuous-excellence';
export const OPENCLAW_EXCELLENCE_ISSUE = '#3094';
export const OPENCLAW_EXCELLENCE_TITLE =
  'OpenClaw Local & Standalone Continuous Excellence and Codex Task Parity';

export const OPENCLAW_EXCELLENCE_NORTH_STAR_V1 =
  'Continually improve OpenClaw Local and OpenClaw Standalone with verified stable updates, trusted relevant skills, exams, bounded execution and agent-specific runtime proof until each matches or exceeds Codex on suitable Stephanos task classes, without weakening approvals, scope or sovereignty.';

export const OPENCLAW_EXCELLENCE_OPERATING_LOOP_V1 = Object.freeze([
  'INVENTORY_SEPARATE_AGENT_RUNTIMES',
  'CHECK_RELEASES_AND_SKILL_PROVENANCE',
  'REUSE_EXISTING_LESSONS_AND_SKILL_FORGE',
  'DEDUP_TO_CANONICAL_GOAL_OWNERS',
  'REHEARSE_UPDATE_OR_SKILL',
  'EXAM_TEST_AND_REVIEW_EACH_AGENT',
  'BENCHMARK_AGAINST_CODEX_BY_TASK_CLASS',
  'RETAIN_PROOF_AND_REPEAT',
]);

export const OPENCLAW_EXCELLENCE_GROWTH_RUNGS_V1 = Object.freeze([
  'INVENTORY_BOTH_AGENTS',
  'VERIFY_UPSTREAM_RELEASE_AND_SKILL_SAFETY',
  'MAP_CODEX_TASK_CLASS_GAPS',
  'REHEARSE_SAFE_UPDATES_AND_SKILLS',
  'QUALIFY_AGENT_SPECIFIC_SKILLS',
  'PROVE_END_TO_END_TASK_PARITY',
  'PROVE_SOVEREIGN_ENDURANCE',
  'CONTINUOUS_UPLIFT_AND_RETEST',
]);

export const OPENCLAW_EXCELLENCE_AGENTS_V1 = Object.freeze([
  Object.freeze({
    participantId: 'openclaw-local',
    runtimeAgentId: 'stephanos-scout-coder',
    authorityScope: 'stephanos-repository-and-approved-product-runtime',
    permissionsSharedWithOtherAgent: false,
  }),
  Object.freeze({
    participantId: 'openclaw-standalone',
    runtimeAgentId: 'openclaw-standalone',
    authorityScope: 'whole-pc-with-separate-explicit-approval',
    permissionsSharedWithOtherAgent: false,
  }),
]);

// Proposed task classes are benchmarks, never claims of installed skills or capabilities.
export const OPENCLAW_EXCELLENCE_TASK_CLASSES_V1 = Object.freeze([
  'repository-read-and-source-inspection',
  'bounded-coding-and-deterministic-testing',
  'goal-conveyor-worker-pickup-and-receipts',
  'runtime-diagnosis-and-bounded-recovery',
  'independent-review-with-qualified-exact-head-proof',
  'safe-skill-craft-and-recipient-specific-transfer',
  'git-api-rate-limit-aware-operation',
  'sovereign-model-route-and-vr-resource-governance',
]);

export const OPENCLAW_EXCELLENCE_EXISTING_OWNERS_V1 = Object.freeze([
  '#1657', // OpenClaw autonomy umbrella.
  '#1415', // Safe OpenClaw updates without overwriting local state.
  '#1728', // Optional qualified independent reviewer.
  '#1898', // Zero-Codex task-class parity programme.
  '#2670', // Whole-System Capability Closure.
  '#3026', // Full sovereignty seed.
]);

export const OPENCLAW_EXCELLENCE_GROWTH_ACTIONS_V1 = Object.freeze([
  'Collect source-backed version, gateway health, installed skill inventory, scoped tool allowlist, model reachability and receipts separately for Local and Standalone; leave unavailable fields UNKNOWN.',
  'Compare against published upstream stable and security updates, review skill origins and pin candidate revisions; make no global or unreviewed installation.',
  'Use representative Codex tasks to map correctness, execution proof, review, recovery, operator interventions and resource gaps to existing owners.',
  'Back up each agent\'s private state, rehearse safe updates and reviewable skill candidates, and verify rollback without overwriting local changes.',
  'Run the existing ten-question gate and skill tests per recipient, verify security and prompt-injection boundaries, and obtain independent review and operator approval.',
  'Prove real SELECT/CLAIM/pickup/build/test/review/receipt chains per eligible task class and compare repeatable results fairly with Codex.',
  'Replay reboot, provider-outage, empty external meter, recovery and VR/gaming-resource tests for both separately scoped agents.',
  'Retest releases, skills and performance, retain per-agent runtime evidence and lessons, and repair any measured regressions through canonical goals.',
]);

export function buildOpenClawExcellenceSeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: OPENCLAW_EXCELLENCE_SEED_SCHEMA_V1,
    missionId: OPENCLAW_EXCELLENCE_MISSION_ID,
    issueRef: OPENCLAW_EXCELLENCE_ISSUE,
    title: OPENCLAW_EXCELLENCE_TITLE,
    seedKind: 'persistent-openclaw-agent-excellence',
    persistent: true,
    northStar: OPENCLAW_EXCELLENCE_NORTH_STAR_V1,
    operatingLoop: OPENCLAW_EXCELLENCE_OPERATING_LOOP_V1,
    growthRungs: OPENCLAW_EXCELLENCE_GROWTH_RUNGS_V1,
    growthActions: OPENCLAW_EXCELLENCE_GROWTH_ACTIONS_V1,
    agentIdentities: OPENCLAW_EXCELLENCE_AGENTS_V1,
    taskClasses: OPENCLAW_EXCELLENCE_TASK_CLASSES_V1,
    existingOwnerIssueRefs: OPENCLAW_EXCELLENCE_EXISTING_OWNERS_V1,
    operatorRole: 'intent-judgment-agent-specific-skill-and-protected-approval',
    growthContract: Object.freeze({
      useCanonicalSeedHeartbeatAndGrowthPressure: true,
      requireBothAgentInventoriesForParityClaim: true,
      installedSkillRequiresRecipientRuntimeProof: true,
      stableUpdateNeedsBackupRehearsalAndRollback: true,
      requireTenQuestionExamAndAdversarialTests: true,
      requireIndependentQualifiedReview: true,
      noUnverifiedExternalSkillInstallation: true,
      noCrossAgentScopeWidening: true,
      noParallelQueueOrScheduler: true,
      exactSourceMissionIssueEvidenceOnly: true,
      noUnprovenCodexParityClaims: true,
      preserveVrGamingResourceGovernor: true,
      respectProviderQuotasAndLicences: true,
    }),
    authority: Object.freeze({
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      spendingAllowedBySeed: false,
      credentialsExportAllowedBySeed: false,
      arbitraryShellAllowedBySeed: false,
      crossAgentSkillActivationAllowedBySeed: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
