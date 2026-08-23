import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  canonicalStephanosQuestionIntentFingerprint,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';

export const STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_SCHEMA_VERSION = 'stephanos.flagship-systems-expert-transfer-round.v1';
export const STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID = 'stephanos-flagship-systems-transfer-001';
export const STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID = 'canonical-novelty-authority-unresolved';

const CASES = Object.freeze([
  Object.freeze({ caseId: 'current-system-map', questionClass: 'CURRENT_PROGRAMME_TRUTH', expectedEvidenceClass: 'CURRENT_SYSTEM_ARCHITECTURE_EVIDENCE', questionText: 'Using live durable truth rather than chat memory, explain the current Stephanos architecture and provider mesh: Mission Scheduler #1556, zero-Codex continuity #1898-#1901, OpenClaw qualification #1657, Forge and Foundry capacity, GitHub construction, optional Codex or Work capacity, Battle Bridge recovery and lifeboat, Ignition #1281 and the integrated provider-neutral Windows Ignition specialist, provider-neutral review including #1945 draft-safe independent-review handoff and retry continuity, receipts, leases, unattended delivery, sovereignty, Native Research #1902 and Governed Improvement #1903. Separate source admission, runtime truth and consequential operator gates.' }),
  Object.freeze({ caseId: 'provider-outage', questionClass: 'AGENT_AND_TOOL_CAPABILITIES', expectedEvidenceClass: 'PROVIDER_RUNTIME_AND_ROUTE_EVIDENCE', questionText: 'A preferred cloud provider becomes unavailable during unattended product work. Explain which durable provider and route truth Stephanos should inspect, which qualified alternatives can continue the mission, what must fail closed, and what evidence distinguishes a routing event from a project-wide stall.' }),
  Object.freeze({ caseId: 'zero-codex-routing', questionClass: 'MEMORY_AND_CONTINUITY', expectedEvidenceClass: 'ZERO_CODEX_CONTINUITY_EVIDENCE', questionText: 'Explain the #1898-#1901 zero-Codex continuity programme, how Mission Scheduler #1556 should route critical-path work when Codex or Work capacity is unavailable, and which parts of the answer must come from live durable truth rather than remembered chat context.' }),
  Object.freeze({ caseId: 'openclaw-qualification', questionClass: 'AGENT_AND_TOOL_CAPABILITIES', expectedEvidenceClass: 'OPENCLAW_TASK_CLASS_QUALIFICATION_EVIDENCE', questionText: 'For a proposed OpenClaw task, explain how #1657 task-class qualification determines whether OpenClaw may execute, what authority remains approval-gated, and how receipts prove the selected route did not silently widen permissions.' }),
  Object.freeze({ caseId: 'forge-foundry-review', questionClass: 'CROSS_DOMAIN_CONNECTION', expectedEvidenceClass: 'FORGE_FOUNDRY_REVIEW_EVIDENCE', questionText: 'Explain how Forge and Foundry capacity can accelerate Stephanos construction without becoming the product controller, how GitHub promotion and exact-head provider-neutral review preserve product truth, and how provider or sidecar capacity changes should alter routing without weakening review, leases, receipts or unattended-delivery gates.' }),
  Object.freeze({ caseId: 'battle-bridge-ignition-recovery', questionClass: 'NEXT_BEST_ACTION', expectedEvidenceClass: 'BATTLE_BRIDGE_IGNITION_RECOVERY_EVIDENCE', questionText: 'The Battle Bridge loses one control-plane service while source remains healthy. Explain the recovery and lifeboat hierarchy, Ignition #1281 and self-healing boundaries, which reversible qualified actions may proceed, when Stephanos must escalate, and what runtime proof is required before declaring recovery or physical Windows acceptance.' }),
  Object.freeze({ caseId: 'research-route-evidence-reconciliation', questionClass: 'SELF_KNOWLEDGE_AND_UNKNOWNS', expectedEvidenceClass: 'RESEARCH_ROUTE_AND_RECONCILIATION_EVIDENCE', questionText: 'A current technical question is not fully answered by canonical knowledge. Show how #1902 first checks canonical truth, then chooses the smallest appropriate route among direct bounded research, one specialist researcher or a research council. Reconcile primary-source freshness, conflicting evidence and provenance, keep research agents as scouts, and explain what may become a governed knowledge candidate without auto-promoting it to truth.' }),
  Object.freeze({ caseId: 'research-agent-disagreement', questionClass: 'WHY_A_DECISION_WAS_MADE', expectedEvidenceClass: 'RESEARCH_AGENT_DISAGREEMENT_EVIDENCE', questionText: 'Two research scouts disagree about a current technical fact while one provider is unavailable. Explain how Stephanos preserves disagreement and counterevidence, substitutes providers without changing the research contract, decides whether more evidence is justified, and remains the final synthesizer instead of treating agent consensus as private truth.' }),
  Object.freeze({ caseId: 'improvement-proposal-quality', questionClass: 'NEXT_BEST_ACTION', expectedEvidenceClass: 'GOVERNED_IMPROVEMENT_PROPOSAL_EVIDENCE', questionText: 'The operator says "this keeps breaking; improve this and make it easier". Use #1903 to map the complaint to canonical state and present a concise IMPROVE_STEPHANOS flow containing the gap, evidence, current owner, proposal, alternatives, risk and rollback, authority needed, progress and proof. Explain when research is needed and why the Goal Flywheel, not the product presenter, owns construction.' }),
  Object.freeze({ caseId: 'authorization-experience-classification', questionClass: 'BLOCKERS_AND_PROOF', expectedEvidenceClass: 'AUTHORIZATION_AND_EXPERIENCE_CLASSIFICATION_EVIDENCE', questionText: 'For a proposed Stephanos change, classify whether it needs no operator action, exact-head source approval, consequential runtime or install approval, external access, spending, physical-headset acceptance or a safety gate. If the cognition is correct but the interaction is hard to use, route that to #1722 experience debt; if the cognition is wrong or unsupported, route it to the canonical question-gap machinery. Preserve evidence and progressive disclosure without hiding uncertainty.' }),
]);

function exactIso(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const parsed = Date.parse(candidate);
  if (!candidate || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) throw new TypeError('createdAtUtc must be exact ISO');
  return candidate;
}

function buildQuestion(seed, index, roundId, createdAtUtc) {
  const candidate = {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId,
    questionId: `${roundId}-q${String(index + 1).padStart(2, '0')}`,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: seed.questionText,
    questionClass: seed.questionClass,
    intentFingerprint: 'intent-placeholder',
    noveltyRefs: [`transfer:${seed.caseId}`],
    contextRefs: ['#1776', '#1308', '#1722', '#1556', '#1290', '#1657', '#1694', '#1281', '#1596', '#1597', '#1898', '#1899', '#1900', '#1901', '#1902', '#1903', '#1934', '#1935', '#1945'],
    expectedEvidenceClass: seed.expectedEvidenceClass,
    createdAtUtc,
  };
  return Object.freeze({
    ...candidate,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate),
  });
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    providerSelectionAuthorityAdded: false,
  });
}

export function createStephanosFlagshipSystemsExpertTransferRoundV1(input = {}) {
  try {
    const createdAtUtc = exactIso(input.createdAtUtc);
    const roundId = STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID;
    const questions = CASES.map((seed, index) => buildQuestion(seed, index, roundId, createdAtUtc));
    const round = Object.freeze({
      schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
      roundId,
      roundNumber: 2,
      askerParticipantId: 'chatgpt-bridge',
      targetParticipantId: 'stephanos',
      questions: Object.freeze(questions),
      createdAtUtc,
    });
    const canonicalRoundValidation = validateStephanosCapabilityRound(round);
    const expectedSafeHold = canonicalRoundValidation.valid === false
      && canonicalRoundValidation.errors.length === 1
      && canonicalRoundValidation.errors[0] === STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID;

    return Object.freeze({
      schemaVersion: STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_SCHEMA_VERSION,
      valid: expectedSafeHold,
      state: expectedSafeHold ? 'TRANSFER_FIXTURES_READY_CANONICAL_NOVELTY_AUTHORITY_REQUIRED' : 'SAFE_HOLD',
      candidateRound: expectedSafeHold ? round : null,
      cases: Object.freeze(CASES.map((seed) => seed.caseId)),
      canonicalRoundValidation,
      roundAdmissionReady: false,
      blockerId: STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID,
      errors: expectedSafeHold ? Object.freeze([]) : canonicalRoundValidation.errors,
      originalRoundReplayRequired: true,
      transferRoundReplayRequired: true,
      uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns: true,
      questionGapMachineryOnCognitiveFailure: true,
      liveExecutionClaimAllowed: false,
      authority: authorityBoundary(),
    });
  } catch {
    return Object.freeze({
      schemaVersion: STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_SCHEMA_VERSION,
      valid: false,
      state: 'SAFE_HOLD',
      candidateRound: null,
      cases: Object.freeze([]),
      canonicalRoundValidation: Object.freeze({ valid: false, errors: Object.freeze(['transfer-round-build-failed-closed']), refusalReason: 'transfer-round-build-failed-closed' }),
      roundAdmissionReady: false,
      blockerId: STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID,
      errors: Object.freeze(['transfer-round-build-failed-closed']),
      originalRoundReplayRequired: true,
      transferRoundReplayRequired: true,
      uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns: true,
      questionGapMachineryOnCognitiveFailure: true,
      liveExecutionClaimAllowed: false,
      authority: authorityBoundary(),
    });
  }
}

export function stephanosFlagshipSystemsExpertCaseIdsV1() {
  return Object.freeze(CASES.map((seed) => seed.caseId));
}
