import { createHash } from 'node:crypto';

import { UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION } from './uiAgentCanonicalExperienceContractV1.mjs';

export const UI_AGENT_CONVERSATION_CANVAS_CONTRACT_SCHEMA_VERSION = 'stephanos.ui-agent.conversation-canvas-contract.v1';
export const UI_AGENT_CONVERSATION_CANVAS_SEMANTIC_SCHEMA = 'stephanos.rich-conversational-response.v1';

export const UI_AGENT_CONVERSATION_CANVAS_PRIMITIVES = Object.freeze([
  'DIRECT_ANSWER',
  'EPISTEMIC_CLAIM',
  'EVIDENCE_DISCLOSURE',
  'GOAL_MISSION',
  'PROVIDER_AGENT_CONTRIBUTION',
  'UNKNOWN',
  'OPTION',
  'RECOMMENDED_ACTION',
  'APPROVAL_STATE',
  'TIMELINE',
  'SYSTEM_MAP',
  'SPATIAL_RESEARCH_VIEW',
]);

export const UI_AGENT_CONVERSATION_CANVAS_STATES = Object.freeze([
  'LOADING',
  'PARTIAL',
  'READY',
  'ERROR',
  'OFFLINE',
]);

export const UI_AGENT_CONVERSATION_CANVAS_ACCEPTANCE_SURFACES = Object.freeze([
  'desktop-browser',
  'ipad',
  'iphone',
]);

export const UI_AGENT_CONVERSATION_CANVAS_BENCHMARK_METRICS = Object.freeze([
  'TIME_TO_UNDERSTAND',
  'NAVIGATION_HOPS',
  'NEED_TO_LEAVE_CONVERSATION',
  'EVIDENCE_INTELLIGIBILITY',
  'NEXT_ACTION_CLARITY',
  'CONTINUITY',
  'OPERATOR_PREFERENCE',
  'FIRST_ANSWER_SECTION_LATENCY',
]);

export const UI_AGENT_CONVERSATION_CANVAS_SCENARIOS = Object.freeze([
  'provider-outage',
  'zero-codex-routing',
  'openclaw-qualification',
  'forge-capacity',
  'provider-neutral-review',
  'battle-bridge-recovery',
  'ignition-self-healing',
  'long-thread-continuity',
  'evidence-expansion',
  'action-approval-presentation',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const REQUIRED_SURFACES = new Set(['ai-console', ...UI_AGENT_CONVERSATION_CANVAS_ACCEPTANCE_SURFACES]);

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function dataObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    return value;
  } catch {
    return null;
  }
}

function invalid(errors) {
  return Object.freeze({
    schemaVersion: UI_AGENT_CONVERSATION_CANVAS_CONTRACT_SCHEMA_VERSION,
    valid: false,
    state: 'SAFE_HOLD',
    contractId: null,
    semanticResponseSchema: UI_AGENT_CONVERSATION_CANVAS_SEMANTIC_SCHEMA,
    truthOwner: 'stephanos',
    uiAgentRole: 'governed-specialist',
    primitives: UI_AGENT_CONVERSATION_CANVAS_PRIMITIVES,
    states: UI_AGENT_CONVERSATION_CANVAS_STATES,
    acceptanceSurfaces: UI_AGENT_CONVERSATION_CANVAS_ACCEPTANCE_SURFACES,
    benchmarkMetrics: UI_AGENT_CONVERSATION_CANVAS_BENCHMARK_METRICS,
    scenarios: UI_AGENT_CONVERSATION_CANVAS_SCENARIOS,
    proofPlan: Object.freeze([]),
    authority: authorityBoundary(),
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function authorityBoundary() {
  return Object.freeze({
    stephanosOwnsMission: true,
    stephanosOwnsConversationSemantics: true,
    stephanosOwnsSystemTruth: true,
    stephanosOwnsFinalOperatorExplanation: true,
    uiAgentMayResearchAuditProposeImplementBounded: true,
    uiAgentMaySelfPromote: false,
    uiAgentMaySelfApprove: false,
    uiAgentMayRedefineStephanosIdentity: false,
    uiAgentMayHideEvidence: false,
    uiAgentMayChangeAuthority: false,
    uiAgentMayCreatePrivateUiTruth: false,
    sourceMutationAllowedByContract: false,
    runtimeMutationAllowedByContract: false,
    mergeAllowedByContract: false,
    deploymentAllowedByContract: false,
  });
}

function surfaceIds(experienceContract) {
  if (!Array.isArray(experienceContract.surfaces)) return [];
  return experienceContract.surfaces.map((entry) => dataObject(entry)?.surfaceId).filter((value) => typeof value === 'string');
}

function proofPlan() {
  return Object.freeze([
    Object.freeze({ proofClass: 'REAL_SERVED_HEAD', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'DESKTOP_INTERACTION', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'IPAD_TOUCH_FIRST', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'PHONE_WIDTH', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'REDUCED_MOTION', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'LONG_CONVERSATION_NAVIGATION', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'LOADING_PARTIAL_ERROR_STATES', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'EVIDENCE_PROGRESSIVE_DISCLOSURE', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'SAFE_ACTION_APPROVAL_CARDS', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'REAL_UI_AGENT_TO_STEPHANOS_QA_AND_EVIDENCE_RETURN', required: true, satisfied: false, evidenceRef: null }),
    Object.freeze({ proofClass: 'GENERIC_TEXT_BASELINE_COMPARISON', required: true, satisfied: false, evidenceRef: null }),
  ]);
}

export function buildUiAgentConversationCanvasContractV1(input = {}) {
  try {
    const packet = dataObject(input);
    const experienceContract = dataObject(packet?.experienceContract);
    if (!packet || !experienceContract) return invalid(['experience-contract-required']);
    if (experienceContract.schemaVersion !== UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION) return invalid(['experience-contract-schema-mismatch']);
    if (experienceContract.valid !== true || experienceContract.state !== 'CANONICAL_DESIGN_MAP_READY_FOR_IMPLEMENTATION_PLANNING') return invalid(['experience-contract-not-ready']);
    if (typeof experienceContract.contractId !== 'string' || !SAFE_ID.test(experienceContract.contractId)) return invalid(['experience-contract-id-invalid']);
    const surfaces = surfaceIds(experienceContract);
    for (const required of REQUIRED_SURFACES) if (!surfaces.includes(required)) return invalid([`required-surface-missing:${required}`]);

    const proof = proofPlan();
    const core = Object.freeze({
      schemaVersion: UI_AGENT_CONVERSATION_CANVAS_CONTRACT_SCHEMA_VERSION,
      parentExperienceContractId: experienceContract.contractId,
      semanticResponseSchema: UI_AGENT_CONVERSATION_CANVAS_SEMANTIC_SCHEMA,
      truthOwner: 'stephanos',
      uiAgentRole: 'governed-specialist',
      experienceGoal: 'STEPHANOS_NATIVE_SUPERIORITY_FOR_REPRESENTATIVE_STEPHANOS_TASKS',
      universalSuperiorityClaimAllowed: false,
      presentationRules: Object.freeze({
        summaryFirst: true,
        compactCinematicProfessional: true,
        progressiveDisclosure: true,
        touchFirstOnIpad: true,
        desktopExcellent: true,
        phoneWidthSupported: true,
        reducedMotionRequired: true,
        genericScrollingMessageLogIsSufficient: false,
        decorationMaySubstituteForReasoning: false,
        difficultReasoningMayRemainGenericTextOnly: false,
      }),
      primitives: UI_AGENT_CONVERSATION_CANVAS_PRIMITIVES,
      states: UI_AGENT_CONVERSATION_CANVAS_STATES,
      acceptanceSurfaces: UI_AGENT_CONVERSATION_CANVAS_ACCEPTANCE_SURFACES,
      scenarios: UI_AGENT_CONVERSATION_CANVAS_SCENARIOS,
      benchmarkMetrics: UI_AGENT_CONVERSATION_CANVAS_BENCHMARK_METRICS,
      proofPlan: proof,
      authority: authorityBoundary(),
    });
    return Object.freeze({
      ...core,
      valid: true,
      state: 'CONVERSATION_CANVAS_CONTRACT_READY_FOR_BOUNDED_IMPLEMENTATION',
      contractId: `conversation-canvas-${hash(core).slice(0, 24)}`,
      validationErrors: Object.freeze([]),
    });
  } catch {
    return invalid(['conversation-canvas-contract-build-failed-closed']);
  }
}
