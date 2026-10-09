export const CONVERSATIONAL_INTELLIGENCE_SEED_SCHEMA_V1 = 'stephanos.conversational-intelligence-seed.v1';
export const CONVERSATIONAL_INTELLIGENCE_MISSION_ID = 'stephanos-flywheel-conversational-intelligence';
export const CONVERSATIONAL_INTELLIGENCE_ISSUE = '#2798';
export const CONVERSATIONAL_INTELLIGENCE_TITLE = 'Stephanos + Flywheel Conversational Intelligence';

export const CONVERSATIONAL_INTELLIGENCE_NORTH_STAR_V1 =
  'Stephanos AI and the Flywheel become as intelligently useful as possible so conversations with the operator are coherent, context-rich, grounded, insightful and genuinely collaborative, while preserving truthful uncertainty, sovereign continuity and protected approval boundaries.';

export const CONVERSATIONAL_INTELLIGENCE_LOOP_V1 = Object.freeze([
  'LISTEN',
  'GROUND',
  'REMEMBER',
  'REASON',
  'SYNTHESIZE',
  'RESPOND',
  'EVALUATE',
  'LEARN',
  'UPLIFT',
  'REPEAT',
]);

// Reuse canonical outcome owners. These are ownership links, not proof that
// the goals have been picked up, completed, merged or deployed.
export const CONVERSATIONAL_INTELLIGENCE_EXPERIENCE_GOALS_V1 = Object.freeze([
  Object.freeze({ issueRef: '#2434', title: 'Shared conversation and durable memory', area: 'canonical-thread-continuity' }),
  Object.freeze({ issueRef: '#1722', title: 'Cross-surface Stephanos AI experience', area: 'touch-accessibility-and-performance' }),
  Object.freeze({ issueRef: '#2966', title: 'iPad and Battle Bridge workspace parity', area: 'hosted-workspace-bridge-parity' }),
]);

export const CONVERSATIONAL_INTELLIGENCE_EXPERIENCE_PROOF_DIMENSIONS_V1 = Object.freeze([
  'crash-recovery-after-reload',
  'shared-thread-id-on-ipad-and-desktop',
  'backend-and-hydration-reachability',
  'frontend-asset-version-parity',
  'touch-scroll-and-composer-access',
  'bounded-chat-render-memory',
  'no-duplicate-replay-after-uncertain-send',
]);

export const CONVERSATIONAL_INTELLIGENCE_GROWTH_RUNGS_V1 = Object.freeze([
  'HEAR_INTENT',
  'HOLD_CONTEXT',
  'GROUND_IN_TRUTH',
  'CHOOSE_RIGHT_BRAIN',
  'REASON_DEEPLY',
  'SYNTHESIZE_COHERENTLY',
  'LEARN_FROM_CONVERSATION',
  'IMPROVE_NEXT_CONVERSATION',
]);

export const CONVERSATIONAL_INTELLIGENCE_DIMENSIONS_V1 = Object.freeze([
  'intent-understanding',
  'conversation-coherence',
  'context-continuity',
  'memory-retrieval-quality',
  'project-grounding',
  'brain-selection-quality',
  'reasoning-depth',
  'uncertainty-calibration',
  'cross-agent-synthesis',
  'answer-relevance',
  'conversational-naturalness',
  'learning-retention',
  'chat-crash-recovery',
  'touch-scroll-accessibility',
  'cross-device-conversation-continuity',
  'hosted-frontend-version-parity',
  'mobile-render-memory-pressure',
]);

export function buildConversationalIntelligenceSeedV1(input = {}) {
  const refreshedAtUtc = String(input.refreshedAtUtc || input.timestampUtc || '').trim();
  return Object.freeze({
    schemaVersion: CONVERSATIONAL_INTELLIGENCE_SEED_SCHEMA_V1,
    missionId: CONVERSATIONAL_INTELLIGENCE_MISSION_ID,
    issueRef: CONVERSATIONAL_INTELLIGENCE_ISSUE,
    title: CONVERSATIONAL_INTELLIGENCE_TITLE,
    seedKind: 'persistent-conversational-intelligence',
    persistent: true,
    northStar: CONVERSATIONAL_INTELLIGENCE_NORTH_STAR_V1,
    operatingLoop: CONVERSATIONAL_INTELLIGENCE_LOOP_V1,
    growthRungs: CONVERSATIONAL_INTELLIGENCE_GROWTH_RUNGS_V1,
    qualityDimensions: CONVERSATIONAL_INTELLIGENCE_DIMENSIONS_V1,
    linkedOutcomeGoals: CONVERSATIONAL_INTELLIGENCE_EXPERIENCE_GOALS_V1,
    experienceProofDimensions: CONVERSATIONAL_INTELLIGENCE_EXPERIENCE_PROOF_DIMENSIONS_V1,
    operatorRole: 'conversation-intent-judgment-protected-approval',
    growthContract: Object.freeze({
      evidenceBackedOnly: true,
      missingEvidenceStaysUnknown: true,
      conversationFailuresBecomeLearningSignals: true,
      wrongBrainRoutingBecomesLearningSignal: true,
      contextLossBecomesLearningSignal: true,
      ipadScrollAndCrashFailuresBecomeLearningSignals: true,
      sharedThreadRecoveryFailuresBecomeLearningSignals: true,
      crossDeviceParityFailuresBecomeLearningSignals: true,
      genuineDeviceAndReloadProofRequired: true,
      failureGapOwnerMustBeExistingGoal: true,
      noDuplicateConveyorOrController: true,
      successfulEvaluationsRequireProof: true,
      retainedLessonsFeedNextConversation: true,
      sovereigntyIsNonNegotiable: true,
      providerNeutralRoutingPreserved: true,
    }),
    authority: Object.freeze({
      protectedApprovalsPreserved: true,
      sourceMutationAllowedBySeed: false,
      runtimeMutationAllowedBySeed: false,
      mergeAllowedBySeed: false,
      deploymentAllowedBySeed: false,
      destructiveActionAllowedBySeed: false,
      externalProviderRequired: false,
    }),
    bootstrapStage: 'SEEDED',
    ...(refreshedAtUtc ? { refreshedAtUtc } : {}),
  });
}
