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
  'crash-and-restart-recovery',
  'cross-device-conversation-parity',
  'ios-scroll-and-composer-accessibility',
  'long-conversation-memory-pressure',
  'workspace-asset-and-hydration-parity',
]);

// Reuse the already planted #2798 canopy seed. These are canonical owners,
 // not additional seeds, queues or unattended mutation authorities.
export const CONVERSATIONAL_INTELLIGENCE_CHAT_EXPERIENCE_WORK_V1 = Object.freeze([
  Object.freeze({
    ref: '#2434', kind: 'issues',
    title: 'Durable conversation memory',
    outcome: 'Resume the same verified conversation after iPad reload, crash, backend restart and device switch.',
  }),
  Object.freeze({
    ref: '#2966', kind: 'issues',
    title: 'iPad / Battle Bridge parity',
    outcome: 'Prove equivalent canonical workspace assets, hydrated data and responsive interaction on every device.',
  }),
  Object.freeze({
    ref: '#1722', kind: 'issues',
    title: 'Cross-surface experience',
    outcome: 'Continuously test touch scrolling, memory pressure, keyboard handling, accessibility and crash resilience.',
  }),
  Object.freeze({
    ref: '#2965', kind: 'pull',
    title: 'Stephanos AI recovery repair',
    outcome: 'Review and prove the existing iPad scrolling, bounded transcript and shared-memory recovery implementation.',
  }),
]);

export const CONVERSATIONAL_INTELLIGENCE_CHAT_QUALITY_CHECKS_V1 = Object.freeze([
  'canonical-shared-thread-recovery',
  'message-persisted-before-completion',
  'uncertain-send-no-silent-duplicate',
  'cross-device-history-equivalence',
  'ios-touch-scroll-and-composer',
  'long-chat-bounded-memory',
  'hosted-workspace-asset-hydration-parity',
  'wrong-brain-context-and-answer-quality',
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
    linkedImprovementWork: CONVERSATIONAL_INTELLIGENCE_CHAT_EXPERIENCE_WORK_V1,
    continuousExperienceChecks: CONVERSATIONAL_INTELLIGENCE_CHAT_QUALITY_CHECKS_V1,
    operatorRole: 'conversation-intent-judgment-protected-approval',
    growthContract: Object.freeze({
      evidenceBackedOnly: true,
      missingEvidenceStaysUnknown: true,
      conversationFailuresBecomeLearningSignals: true,
      wrongBrainRoutingBecomesLearningSignal: true,
      contextLossBecomesLearningSignal: true,
      successfulEvaluationsRequireProof: true,
      retainedLessonsFeedNextConversation: true,
      verifiedChatExperienceFailuresBecomeCanonicalGaps: true,
      existingGoalOwnersReusedBeforeAnyNewAdmission: true,
      restartAndDeviceSwitchRequireLiveProof: true,
      seededImprovementDoesNotProveDeployment: true,
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
