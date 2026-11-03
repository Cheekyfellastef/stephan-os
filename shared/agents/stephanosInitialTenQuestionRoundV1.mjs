import { createHash } from 'node:crypto';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  buildStephanosWorkspaceQuestionRound,
  decodeStephanosWorkspaceAnswerRecord,
  evaluateStephanosWorkspaceConversation,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';

export const STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION = 'stephanos.initial-ten-question-round.v1';
export const STEPHANOS_INITIAL_TEN_QUESTION_ROUND_ID = 'stephanos-round-001';
export const STEPHANOS_INITIAL_TEN_QUESTION_ASKER_ID = 'chatgpt-bridge';
export const STEPHANOS_INITIAL_TEN_QUESTION_TARGET_ID = 'stephanos';

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
    questionText:'What connections, if any, can you prove among Stephanos conversational intelligence, VR Research, Spatial World Foundry and future creative or spatial experiences, and which claimed connections remain unknown or speculative?',
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

function topLevelData(input = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be a data-only object');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('input must be a data-only object');
    if (Object.getOwnPropertySymbols(input).length > 0) throw new TypeError('input must be a data-only object');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const output = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('input must use enumerable own data properties');
      }
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('input must be a data-only object');
  }
}

function canonicalIdentity(input, key, expected) {
  if (!Object.hasOwn(input, key)) return expected;
  const candidate = String(input[key] || '').trim();
  if (candidate !== expected) throw new TypeError(`${key} must remain ${expected}`);
  return expected;
}

function denseProofRefs(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > 64) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
      const ref = typeof descriptor.value === 'string' ? descriptor.value.trim() : '';
      if (!ref) return null;
      output.push(ref);
    }
    return Object.freeze([...new Set(output)]);
  } catch {
    return null;
  }
}

function issuedPacketRef(round) {
  const digest = createHash('sha256').update(JSON.stringify(round)).digest('hex').slice(0, 32);
  return `evidence/receipts/${STEPHANOS_INITIAL_TEN_QUESTION_ROUND_ID}-${digest}`;
}

function safeRecordProofRefs(record) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(record, 'proofRefs');
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
    return denseProofRefs(descriptor.value);
  } catch {
    return null;
  }
}

function answerEvidenceBindingErrors(answerRecords, round, expectedIssuedPacketRef, workspaceValidationOptions) {
  const errors = [];
  const createdMs = Date.parse(round.createdAtUtc);
  if (!Array.isArray(answerRecords) || answerRecords.length !== 10) return errors;
  for (let index = 0; index < answerRecords.length; index += 1) {
    const record = answerRecords[index];
    const decoded = decodeStephanosWorkspaceAnswerRecord(record, {
      expectedRecipientParticipantId: STEPHANOS_INITIAL_TEN_QUESTION_ASKER_ID,
      workspaceValidationOptions,
    });
    if (!decoded.valid || !decoded.answer) continue;
    const proofRefs = safeRecordProofRefs(record);
    if (!proofRefs) {
      errors.push(`answer-record-${index + 1}:proofRefs-invalid`);
      continue;
    }
    if (!proofRefs.includes(expectedIssuedPacketRef)) errors.push(`answer-record-${index + 1}:issued-packet-proof-mismatch`);
    for (const evidenceRef of decoded.answer.evidenceRefs || []) {
      if (!proofRefs.includes(evidenceRef)) errors.push(`answer-record-${index + 1}:evidence-ref-not-bound-to-record:${evidenceRef}`);
    }
    const answeredMs = Date.parse(decoded.answer.answeredAtUtc);
    if (!Number.isFinite(answeredMs) || answeredMs < createdMs) errors.push(`answer-record-${index + 1}:answer-predates-issued-round`);
  }
  return errors;
}

export function createInitialStephanosTenQuestionRoundV1(input = {}) {
  const data = topLevelData(input);
  const createdAtUtc = exactIso(data.createdAtUtc);
  const roundId = canonicalIdentity(data, 'roundId', STEPHANOS_INITIAL_TEN_QUESTION_ROUND_ID);
  const askerParticipantId = canonicalIdentity(data, 'askerParticipantId', STEPHANOS_INITIAL_TEN_QUESTION_ASKER_ID);
  const targetParticipantId = canonicalIdentity(data, 'targetParticipantId', STEPHANOS_INITIAL_TEN_QUESTION_TARGET_ID);
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
  const data = topLevelData(input);
  const built = createInitialStephanosTenQuestionRoundV1(data);
  if (!built.valid) return Object.freeze({ valid:false, round:null, records:Object.freeze([]), errors:built.validation.errors });
  const callerProofRefs = denseProofRefs(data.proofRefs);
  if (!callerProofRefs) {
    return Object.freeze({
      schemaVersion:STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION,
      valid:false,
      round:built.round,
      records:Object.freeze([]),
      errors:Object.freeze(['proofRefs-required-from-caller']),
      authority:null,
      issuedPacketRef:'',
      completionClaimAllowed:false,
      liveConversationClaimAllowed:false,
    });
  }
  const issuanceRef = issuedPacketRef(built.round);
  const packet = buildStephanosWorkspaceQuestionRound(built.round, {
    relatedIssue:'#1308',
    relatedPr:data.relatedPr || '#1777',
    proofRefs:[...callerProofRefs, issuanceRef],
    workspaceValidationOptions:data.workspaceValidationOptions,
  });
  return Object.freeze({
    schemaVersion:STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION,
    valid:packet.valid,
    round:built.round,
    records:packet.records,
    errors:packet.errors,
    authority:packet.authority,
    issuedPacketRef:issuanceRef,
    completionClaimAllowed:false,
    liveConversationClaimAllowed:false,
  });
}

export function evaluateInitialStephanosTenQuestionRoundV1(input = {}) {
  const data = topLevelData(input);
  const built = createInitialStephanosTenQuestionRoundV1(data);
  if (!built.valid) {
    return Object.freeze({
      schemaVersion:STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION,
      valid:false,
      state:'SAFE_HOLD',
      errors:built.validation.errors,
      evaluation:null,
    });
  }
  const expectedIssuedPacketRef = issuedPacketRef(built.round);
  const evidenceErrors = answerEvidenceBindingErrors(
    data.answerRecords,
    built.round,
    expectedIssuedPacketRef,
    data.workspaceValidationOptions,
  );
  if (evidenceErrors.length > 0) {
    return Object.freeze({
      schemaVersion:STEPHANOS_INITIAL_TEN_QUESTION_ROUND_VERSION,
      valid:false,
      roundId:built.round.roundId,
      state:'SAFE_HOLD',
      errors:Object.freeze([...new Set(evidenceErrors)]),
      evaluation:null,
      issuedPacketRef:expectedIssuedPacketRef,
      independentEvidenceResolutionRequired:true,
    });
  }
  const evaluation = evaluateStephanosWorkspaceConversation({
    round:built.round,
    answerRecords:data.answerRecords,
    workspaceValidationOptions:data.workspaceValidationOptions,
  });
  if (evaluation.valid && evaluation.state === 'SETTLED') {
    return Object.freeze({
      ...evaluation,
      state:'SAFE_HOLD',
      refusalReason:'independent-evidence-resolution-required',
      issuedPacketRef:expectedIssuedPacketRef,
      independentEvidenceResolutionRequired:true,
      evaluation:evaluation.evaluation ? Object.freeze({
        ...evaluation.evaluation,
        mayAdvanceToNovelRound:false,
        requiresRepairReplay:true,
      }) : null,
    });
  }
  return Object.freeze({
    ...evaluation,
    issuedPacketRef:expectedIssuedPacketRef,
    independentEvidenceResolutionRequired:false,
  });
}

export function initialStephanosQuestionClassesV1() {
  return Object.freeze([...STEPHANOS_INITIAL_QUESTION_CLASSES]);
}
