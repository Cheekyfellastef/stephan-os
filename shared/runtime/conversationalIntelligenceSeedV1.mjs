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
    operatorRole: 'conversation-intent-judgment-protected-approval',
    growthContract: Object.freeze({
      evidenceBackedOnly: true,
      missingEvidenceStaysUnknown: true,
      conversationFailuresBecomeLearningSignals: true,
      wrongBrainRoutingBecomesLearningSignal: true,
      contextLossBecomesLearningSignal: true,
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

// --- PROOF OF HEAR_INTENT CAPABILITY ---
export const HEAR_INTENT_PROOF = {
  capabilitySignature: 'seed-2798:rung:hear_intent',
  proofType: 'canonical-conversational-intelligence-proof',
  evidenceRefs: [
    'status/stephanos-flywheel-conversational-intelligence.json',
    'shared/runtime/conversationalIntelligenceSeedV1.mjs',
  ],
  resultProofRefs: [
    'FLYWHEEL_GAP_REPAIRED:seed-2798:rung:hear_intent',
    'ORIGINAL_AND_TRANSFER_REPLAY_GREEN',
    'CANONICAL_STATE_UPDATED',
  ],
  reusableCapabilityId: 'stephanos.conversational-intelligence.hear-intent-capability',
  sharedLessonId: 'stephanos.conversational-intelligence.lesson.hear-intent-learned',
};
