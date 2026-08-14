import { createHash } from 'node:crypto';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  buildStephanosWorkspaceQuestionRound,
  evaluateStephanosWorkspaceConversation,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';

export const STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION = 'stephanos.initial-ten-question-round.v1';
export const STEPHANOS_INITIAL_TEN_QUESTION_ROUND_ID = 'stephanos-round-001';

const INITIAL_QUESTIONS = Object.freeze([
  Object.freeze({
    questionClass:'CURRENT_PROGRAMME_TRUTH',
    questionText:'What Stephanos product capability is being built right now, and what current durable evidence proves that this is the active product work rather than a remembered plan?',
    expectedEvidenceClass:'CURRENT_PROGRAMME_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'ARCHITECTURE_AND_RELATIONSHIPS',
    questionText:'How do the Stephanos product programme, conversational intelligence, Shared Workspace and Mission Scheduler relate to each other, and which system owns product outcome versus coordination machinery?',
    expectedEvidenceClass:'ARCHITECTURE_RELATIONSHIP_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'MEMORY_AND_CONTINUITY',
    questionText:'If this conversation or the Stephanos process restarts, what current mission and relationship context should survive, where is that continuity governed, and what must not be silently invented?',
    expectedEvidenceClass:'MEMORY_CONTINUITY_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'AGENT_AND_TOOL_CAPABILITIES',
    questionText:'What can ChatGPT, OpenClaw, the VR Research Agent and Stephanos itself currently do for this programme, and which important capabilities or authorities do they explicitly not have?',
    expectedEvidenceClass:'CAPABILITY_AUTHORITY_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'BLOCKERS_AND_PROOF',
    questionText:'What currently prevents the newest Stephanos product slices from being called merged, installed or live, and what exact proof would close those gaps?',
    expectedEvidenceClass:'BLOCKER_PROOF_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'WHY_A_DECISION_WAS_MADE',
    questionText:'Why was the Stephanos product programme separated from the machinery-building programme instead of allowing infrastructure work to own all product progress?',
    expectedEvidenceClass:'DECISION_RATIONALE_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'WHAT_CHANGED_RECENTLY',
    questionText:'What materially changed in the Stephanos product estate during the latest build cycle, and which claims are source-prepared versus actually proven?',
    expectedEvidenceClass:'RECENT_CHANGE_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'NEXT_BEST_ACTION',
    questionText:'Given the current product estate and proof state, what is the next highest-value safe Stephanos product action, why does it outrank alternatives, and does it require the operator?',
    expectedEvidenceClass:'NEXT_ACTION_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'CROSS_DOMAIN_CONNECTION',
    questionText:'How do better Stephanos conversational intelligence, VR Research and the Spatial World Foundry compound each other toward the future Idea Planets experience?',
    expectedEvidenceClass:'CROSS_DOMAIN_EVIDENCE',
  }),
  Object.freeze({
    questionClass:'SELF_KNOWLEDGE_AND_UNKNOWNS',
    questionText:'What important facts about Stephanos or the current product programme can you not prove right now, how should those unknowns be labelled, and which existing goal should own each buildable gap?',
    expectedEvidenceClass:'UNKNOWN_GAP_EVIDENCE',
  }),
]);

function fingerprint(questionClass, questionText) {
  return `intent-${createHash('sha256').update(`${questionClass}\n${questionText}`).digest('hex').slice(0, 24)}`;
}

function exactIso(value) {
  const input = String(value || '').trim();
  const ms = Date.parse(input);
  if (!input || !Number.isFinite(ms) || new Date(ms).toISOString() !== input) {
    throw new TypeError('createdAtUtc must be an exact ISO timestamp');
  }
  return input;
}

export function createInitialStephanosTenQuestionRoundV1(input = {}) {
  const createdAtUtc = exactIso(input.createdAtUtc);
  const roundId = String(input.roundId || STEPHANOS_INITIAL_TEN_QUESTION_ROUND_ID).trim();
  const askerParticipantId = String(input.askerParticipantId || 'chatgpt-bridge').trim();
  const targetParticipantId = String(input.targetParticipantId || 'stephanos').trim();
  const questions = INITIAL_QUESTIONS.map((seed, index) => Object.freeze({
    schemaVersion:STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId,
    questionId:`${roundId}-q${String(index + 1).padStart(2, '0')}`,
    askerParticipantId,
    targetParticipantId,
    questionText:seed.questionText,
    questionClass:seed.questionClass,
    intentFingerprint:fingerprint(seed.questionClass, seed.questionText),
    noveltyRefs:Object.freeze([]),
    contextRefs:Object.freeze([
      '#1776',
      '#1308',
      '#1290',
      '#1556',
    ]),
    expectedEvidenceClass:seed.expectedEvidenceClass,
    createdAtUtc,
  }));
  const round = Object.freeze({
    schemaVersion:STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId,
    roundNumber:1,
    askerParticipantId,
    targetParticipantId,
    questions:Object.freeze(questions),
    createdAtUtc,
  });
  const validation = validateStephanosCapabilityRound(round);
  if (!validation.valid) {
    return Object.freeze({ valid:false, round:null, validation });
  }
  return Object.freeze({ valid:true, round, validation });
}

export function buildInitialStephanosTenQuestionPacketV1(input = {}) {
  const built = createInitialStephanosTenQuestionRoundV1(input);
  if (!built.valid) return Object.freeze({ valid:false, round:null, records:Object.freeze([]), errors:built.validation.errors });
  const packet = buildStephanosWorkspaceQuestionRound(built.round, {
    relatedIssue:'#1308',
    relatedPr:input.relatedPr || '#1777',
    proofRefs:Array.isArray(input.proofRefs) ? input.proofRefs : [],
    workspaceValidationOptions:input.workspaceValidationOptions,
  });
  return Object.freeze({
    schemaVersion:STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION,
    valid:packet.valid,
    round:built.round,
    records:packet.records,
    errors:packet.errors,
    authority:packet.authority,
    completionClaimAllowed:false,
    liveConversationClaimAllowed:false,
  });
}

export function evaluateInitialStephanosTenQuestionRoundV1(input = {}) {
  const built = createInitialStephanosTenQuestionRoundV1(input);
  if (!built.valid) {
    return Object.freeze({
      schemaVersion:STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION,
      valid:false,
      state:'SAFE_HOLD',
      errors:built.validation.errors,
      evaluation:null,
    });
  }
  return evaluateStephanosWorkspaceConversation({
    round:built.round,
    answerRecords:input.answerRecords,
    workspaceValidationOptions:input.workspaceValidationOptions,
  });
}

export function initialStephanosQuestionClassesV1() {
  return Object.freeze([...STEPHANOS_INITIAL_QUESTION_CLASSES]);
}
