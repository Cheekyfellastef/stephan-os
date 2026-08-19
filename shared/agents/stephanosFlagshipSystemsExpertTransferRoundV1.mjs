import { createHash } from 'node:crypto';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';

export const STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_SCHEMA_VERSION = 'stephanos.flagship-systems-expert-transfer-round.v1';
export const STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID = 'stephanos-flagship-systems-transfer-001';

const CASES = Object.freeze([
  Object.freeze({ caseId: 'provider-outage', questionClass: 'AGENT_AND_TOOL_CAPABILITIES', expectedEvidenceClass: 'PROVIDER_RUNTIME_AND_ROUTE_EVIDENCE', questionText: 'A preferred cloud provider becomes unavailable during unattended product work. Explain which durable provider and route truth Stephanos should inspect, which qualified alternatives can continue the mission, what must fail closed, and what evidence distinguishes a routing event from a project-wide stall.' }),
  Object.freeze({ caseId: 'zero-codex-routing', questionClass: 'ARCHITECTURE_AND_RELATIONSHIPS', expectedEvidenceClass: 'ZERO_CODEX_CONTINUITY_EVIDENCE', questionText: 'Explain the #1898-#1901 zero-Codex continuity programme, how Mission Scheduler #1556 should route critical-path work when Codex or Work capacity is unavailable, and which parts of the answer must come from live durable truth rather than remembered chat context.' }),
  Object.freeze({ caseId: 'openclaw-qualification', questionClass: 'AGENT_AND_TOOL_CAPABILITIES', expectedEvidenceClass: 'OPENCLAW_TASK_CLASS_QUALIFICATION_EVIDENCE', questionText: 'For a proposed OpenClaw task, explain how #1657 task-class qualification determines whether OpenClaw may execute, what authority remains approval-gated, and how receipts prove the selected route did not silently widen permissions.' }),
  Object.freeze({ caseId: 'forge-capacity', questionClass: 'CROSS_DOMAIN_CONNECTION', expectedEvidenceClass: 'FORGE_FOUNDRY_CAPACITY_EVIDENCE', questionText: 'Explain how Forge and Foundry capacity can accelerate Stephanos construction without becoming the product controller, how work is isolated and promoted, and how provider or sidecar capacity changes should alter routing without changing product truth.' }),
  Object.freeze({ caseId: 'provider-neutral-review', questionClass: 'BLOCKERS_AND_PROOF', expectedEvidenceClass: 'PROVIDER_NEUTRAL_REVIEW_EVIDENCE', questionText: 'A product PR is source-complete while one review provider is unavailable. Explain the provider-neutral review contract, what exact-head assurance can substitute, what cannot be waived, and why a review outage must not be painted as product completion.' }),
  Object.freeze({ caseId: 'battle-bridge-recovery', questionClass: 'NEXT_BEST_ACTION', expectedEvidenceClass: 'BATTLE_BRIDGE_RECOVERY_EVIDENCE', questionText: 'The Battle Bridge loses one control-plane service while source remains healthy. Explain the recovery and lifeboat hierarchy, which self-healing actions are reversible and qualified, when Stephanos must escalate, and what terminal proof is required before declaring recovery.' }),
  Object.freeze({ caseId: 'ignition-self-healing', questionClass: 'WHAT_CHANGED_RECENTLY', expectedEvidenceClass: 'IGNITION_SELF_HEALING_EVIDENCE', questionText: 'Explain current Ignition #1281 and self-healing status, including the runtime-versus-source dirt boundary, exact listener proof, stale UI convergence and the difference between source admission and physical Windows acceptance.' }),
  Object.freeze({ caseId: 'long-thread-continuity', questionClass: 'MEMORY_AND_CONTINUITY', expectedEvidenceClass: 'CONVERSATION_CONTINUITY_EVIDENCE', questionText: 'This Stephanos conversation has become very long and spans several product fronts. Explain how canonical goals, receipts, durable memory and Shared Workspace continuity preserve the thread without relying on model chat memory, and identify any continuity state that is still unproven.' }),
  Object.freeze({ caseId: 'evidence-expansion', questionClass: 'SELF_KNOWLEDGE_AND_UNKNOWNS', expectedEvidenceClass: 'EPISTEMIC_AND_EVIDENCE_DISCLOSURE_EVIDENCE', questionText: 'Give a compact answer about current Stephanos system state, then identify which claims are observed, inferred or unknown, which evidence should be progressively disclosed on request, and which missing evidence should feed the existing question-gap machinery.' }),
  Object.freeze({ caseId: 'action-approval-presentation', questionClass: 'NEXT_BEST_ACTION', expectedEvidenceClass: 'ACTION_APPROVAL_PRESENTATION_EVIDENCE', questionText: 'Recommend the next safe action for a consequential Stephanos change and clearly separate recommendation, options, approval requirement, authority boundary, evidence refs and what the operator would actually be approving. Include the visual presentation candidates that reduce cognitive load without hiding truth.' }),
]);

function fingerprint(questionClass, questionText) {
  return `intent-${createHash('sha256').update(`${questionClass}\n${questionText}`).digest('hex').slice(0, 24)}`;
}

function exactIso(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const parsed = Date.parse(candidate);
  if (!candidate || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) throw new TypeError('createdAtUtc must be exact ISO');
  return candidate;
}

export function createStephanosFlagshipSystemsExpertTransferRoundV1(input = {}) {
  try {
    const createdAtUtc = exactIso(input.createdAtUtc);
    const roundId = STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID;
    const questions = CASES.map((seed, index) => Object.freeze({
      schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
      roundId,
      questionId: `${roundId}-q${String(index + 1).padStart(2, '0')}`,
      askerParticipantId: 'chatgpt-bridge',
      targetParticipantId: 'stephanos',
      questionText: seed.questionText,
      questionClass: seed.questionClass,
      intentFingerprint: fingerprint(seed.questionClass, seed.questionText),
      noveltyRefs: Object.freeze([`transfer:${seed.caseId}`]),
      contextRefs: Object.freeze(['#1776', '#1308', '#1722', '#1556', '#1290', '#1657', '#1694', '#1281', '#1898', '#1899', '#1900', '#1901']),
      expectedEvidenceClass: seed.expectedEvidenceClass,
      createdAtUtc,
    }));
    const round = Object.freeze({
      schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
      roundId,
      roundNumber: 2,
      askerParticipantId: 'chatgpt-bridge',
      targetParticipantId: 'stephanos',
      questions: Object.freeze(questions),
      createdAtUtc,
    });
    const validation = validateStephanosCapabilityRound(round);
    return Object.freeze({
      schemaVersion: STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_SCHEMA_VERSION,
      valid: validation.valid,
      round: validation.valid ? round : null,
      cases: Object.freeze(CASES.map((seed) => seed.caseId)),
      errors: validation.errors,
      originalRoundReplayRequired: true,
      transferRoundReplayRequired: true,
      uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns: true,
      questionGapMachineryOnCognitiveFailure: true,
      liveExecutionClaimAllowed: false,
      authority: Object.freeze({ sourceMutationAllowed: false, commandExecutionAllowed: false, approvalAllowed: false, providerSelectionAuthorityAdded: false }),
    });
  } catch {
    return Object.freeze({
      schemaVersion: STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_SCHEMA_VERSION,
      valid: false,
      round: null,
      cases: Object.freeze([]),
      errors: Object.freeze(['transfer-round-build-failed-closed']),
      originalRoundReplayRequired: true,
      transferRoundReplayRequired: true,
      uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns: true,
      questionGapMachineryOnCognitiveFailure: true,
      liveExecutionClaimAllowed: false,
      authority: Object.freeze({ sourceMutationAllowed: false, commandExecutionAllowed: false, approvalAllowed: false, providerSelectionAuthorityAdded: false }),
    });
  }
}

export function stephanosFlagshipSystemsExpertCaseIdsV1() {
  return Object.freeze(CASES.map((seed) => seed.caseId));
}
