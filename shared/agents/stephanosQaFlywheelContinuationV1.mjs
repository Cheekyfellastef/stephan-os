import { createHash } from 'node:crypto';

import {
  createSharedWorkspaceHandoffRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  decodeStephanosWorkspaceAnswerRecord,
  decodeStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import { evaluateStephanosAmbientQuestionGapIntakeV1 } from './stephanosAmbientQuestionGapIntakeV1.mjs';
import { buildStephanosImprovementFlywheelContinuationV1 } from './stephanosImprovementFlywheelContinuationV1.mjs';

export const STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION =
  'stephanos.qa-flywheel-continuation.v1';

const ROOT_CAUSE_CLASSES = Object.freeze([
  'KNOWLEDGE_NOT_INGESTED',
  'CANONICAL_STATE_NOT_PROJECTED',
  'MEMORY_NOT_RETAINED',
  'MEMORY_NOT_RETRIEVABLE',
  'CONTEXT_NOT_ROUTED',
  'PARTICIPANT_NOT_CONNECTED',
  'QUESTION_ANSWER_TRANSPORT_MISSING',
  'TOOL_OR_DATA_SOURCE_MISSING',
  'TOOL_PRESENT_BUT_NOT_DISCOVERABLE',
  'REASONING_OR_SYNTHESIS_WEAKNESS',
  'FRESHNESS_OR_OBSERVABILITY_GAP',
  'PROOF_OR_CITATION_GAP',
  'AGENT_CAPABILITY_CONTRACT_GAP',
  'CROSS_PARTICIPANT_COHERENCE_GAP',
]);

const GOAL_STATES = new Set(['OPEN', 'READY', 'BUILDING', 'REVIEWING', 'PROVING', 'BLOCKED', 'COMPLETE']);
const TERMINAL_GOAL_STATES = new Set(['COMPLETE', 'CLOSED', 'CANCELLED', 'SUPERSEDED']);
const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  goalCreationAllowed: false,
  schedulerDispatchAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  authorityWideningAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCapability(value) {
  const normalized = text(value).replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return normalized || 'conversation-capability';
}

function stableId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
}

function normalizeGoalState(record = {}) {
  const value = text(record.state ?? record.status).toUpperCase();
  if (GOAL_STATES.has(value)) return value;
  if (value === 'ACTIVE') return 'BUILDING';
  if (value === 'QUEUED' || value === 'WAITING_FOR_EXTERNAL_CONDITION') return 'READY';
  return 'OPEN';
}

function goalIssueRef(record = {}, fallback = '') {
  const issue = Number(record.issueNumber ?? record.issue ?? String(record.relatedIssue ?? '').replace(/^#/, ''));
  return Number.isSafeInteger(issue) && issue > 0 ? `#${issue}` : fallback;
}

function buildAmbientQuestion(question = {}) {
  return Object.freeze({
    questionId: text(question.questionId),
    correlationId: text(question.roundId),
    askerParticipantId: text(question.askerParticipantId),
    targetParticipantId: text(question.targetParticipantId),
    questionText: text(question.questionText),
    intentFingerprint: text(question.intentFingerprint),
    expectedEvidenceClass: text(question.expectedEvidenceClass),
    affectedCapability: normalizeCapability(question.questionClass),
    origin: 'FORMAL_TEN_QUESTION_ROUND',
    createdAtUtc: text(question.createdAtUtc),
  });
}

function buildAmbientAnswer(answer = {}) {
  return Object.freeze({
    responderParticipantId: text(answer.responderParticipantId),
    answerVerdict: text(answer.answerVerdict).toUpperCase(),
    epistemicState: text(answer.epistemicState).toUpperCase(),
    evidenceRefs: Object.freeze(Array.isArray(answer.evidenceRefs) ? [...answer.evidenceRefs] : []),
    cannotAnswerReason: text(answer.cannotAnswerReason),
    answeredAtUtc: text(answer.answeredAtUtc),
  });
}

function existingGoalCandidate(goalRecord, gap, affectedCapability) {
  if (!goalRecord || !gap?.rootCauseClass) return null;
  const goalRef = goalIssueRef(goalRecord);
  if (!SAFE_GOAL_REF.test(goalRef)) return null;
  const rawState = text(goalRecord.state ?? goalRecord.status).toUpperCase();
  if (TERMINAL_GOAL_STATES.has(rawState)) return null;
  return Object.freeze({
    goalRef,
    rootCauseClasses: Object.freeze([gap.rootCauseClass]),
    capabilities: Object.freeze([affectedCapability]),
    state: normalizeGoalState(goalRecord),
  });
}

function priorGapList(existingGapObservation) {
  if (!existingGapObservation) return Object.freeze([]);
  return Object.freeze([existingGapObservation]);
}

function attachGapToGoal(goalRecord, gapObservation, handoffRef, improvementContinuation) {
  if (!goalRecord || !gapObservation) return null;
  const priorGapRefs = Array.isArray(goalRecord.flywheelGapRefs) ? goalRecord.flywheelGapRefs : [];
  const priorQuestionRefs = Array.isArray(goalRecord.flywheelQuestionRefs) ? goalRecord.flywheelQuestionRefs : [];
  const next = {
    ...goalRecord,
    flywheelGapRefs: Object.freeze([...new Set([...priorGapRefs, handoffRef])]),
    flywheelQuestionRefs: Object.freeze([
      ...new Set([...priorQuestionRefs, ...(gapObservation.sourceQuestionRefs || [])]),
    ]),
    flywheelGapOccurrenceCount: Math.max(
      Number(goalRecord.flywheelGapOccurrenceCount || 0),
      Number(gapObservation.occurrenceCount || 1),
    ),
    flywheelLastGapAtUtc: gapObservation.lastSeenAtUtc,
    flywheelContinuitySchema: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    ...(improvementContinuation
      ? { flywheelImprovementContinuation: improvementContinuation }
      : {}),
  };
  return Object.freeze(next);
}

function invalid(classification, errors = []) {
  return Object.freeze({
    schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    ok: false,
    classification,
    evaluation: null,
    gapObservation: null,
    improvementContinuation: null,
    handoffRecord: null,
    goalRecordUpdate: null,
    authority: AUTHORITY,
    errors: Object.freeze(errors),
  });
}

export function buildStephanosQaFlywheelContinuationV1(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const questionDecoded = decodeStephanosWorkspaceQuestionRecord(input.questionRecord, {
    workspaceValidationOptions: { nowMs },
  });
  if (!questionDecoded.valid) return invalid('QUESTION_REJECTED', [...questionDecoded.errors]);

  const answerDecoded = decodeStephanosWorkspaceAnswerRecord(input.answerRecord, {
    expectedRecipientParticipantId: text(input.questionRecord?.participantId),
    workspaceValidationOptions: { nowMs },
  });
  if (!answerDecoded.valid) return invalid('ANSWER_REJECTED', [...answerDecoded.errors]);

  const question = buildAmbientQuestion(questionDecoded.question);
  const answer = buildAmbientAnswer(answerDecoded.answer);
  const first = evaluateStephanosAmbientQuestionGapIntakeV1({
    question,
    answer,
    routingCandidates: [],
    existingGoals: [],
    existingGaps: priorGapList(input.existingGapObservation),
  });
  if (!first?.valid) return invalid('GAP_EVALUATION_REJECTED', [...(first?.validationErrors || [])]);
  if (!first.gapObservation) {
    return Object.freeze({
      schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
      ok: true,
      classification: first.state === 'ANSWERED' ? 'NO_BUILDABLE_GAP' : first.state,
      evaluation: first,
      gapObservation: null,
      improvementContinuation: null,
      handoffRecord: null,
      goalRecordUpdate: null,
      authority: AUTHORITY,
      errors: Object.freeze([]),
    });
  }

  const goalCandidate = existingGoalCandidate(input.existingGoalRecord, first.gapObservation, question.affectedCapability);
  const evaluated = goalCandidate
    ? evaluateStephanosAmbientQuestionGapIntakeV1({
      question,
      answer,
      routingCandidates: [],
      existingGoals: [goalCandidate],
      existingGaps: priorGapList(input.existingGapObservation),
    })
    : first;
  if (!evaluated?.valid || !evaluated.gapObservation) {
    return invalid('GAP_OWNER_RECONCILIATION_REJECTED', [...(evaluated?.validationErrors || [])]);
  }

  const gap = evaluated.gapObservation;
  const canonicalGoalRef = text(evaluated.canonicalGoalRef);
  const relatedIssue = SAFE_GOAL_REF.test(canonicalGoalRef)
    ? canonicalGoalRef
    : (SAFE_GOAL_REF.test(text(input.questionRecord?.relatedIssue)) ? text(input.questionRecord.relatedIssue) : '#1721');
  const handoffId = stableId('qa-gap', gap.gapSignature);
  const handoffRef = `workspace://${handoffId}`;
  const proofRefs = Array.isArray(input.answerRecord?.proofRefs) && input.answerRecord.proofRefs.length
    ? [...input.answerRecord.proofRefs]
    : ['proof/qa-gap-evidence'];
  const improvementEvidenceRefs = Object.freeze([
    ...new Set([
      ...proofRefs,
      ...(Array.isArray(input.questionRecord?.proofRefs) ? input.questionRecord.proofRefs : []),
    ]),
  ].slice(0, 16));
  const improvementContinuation = canonicalGoalRef && goalCandidate
    ? buildStephanosImprovementFlywheelContinuationV1({
      gapObservation: gap,
      existingGoalRecord: input.existingGoalRecord,
      evidenceRefs: improvementEvidenceRefs,
    })
    : null;
  const handoffRecord = createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'stephanos',
    fromParticipantId: 'stephanos',
    toParticipantId: 'mission-scheduler',
    timestampUtc: gap.lastSeenAtUtc,
    correlationId: text(input.questionRecord?.correlationId) || gap.gapId,
    relatedIssue,
    relatedPr: text(input.questionRecord?.relatedPr),
    proofRefs,
    summary: `Capability gap ${gap.gapId} requires flywheel continuation.`,
    body: JSON.stringify({
      schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
      gapObservation: gap,
      canonicalGoalRef,
      goalDisposition: evaluated.goalDisposition,
      schedulerCandidate: evaluated.schedulerCandidate === true,
      questionRef: `question://${question.questionId}`,
      improvementContinuation,
      authority: AUTHORITY,
    }),
  });
  const workspaceValidation = validateSharedWorkspaceRecord(handoffRecord, { nowMs });
  if (!workspaceValidation.valid) return invalid('GAP_HANDOFF_INVALID', workspaceValidation.errors);

  const goalRecordUpdate = canonicalGoalRef && goalCandidate
    ? attachGapToGoal(input.existingGoalRecord, gap, handoffRef, improvementContinuation)
    : null;

  return Object.freeze({
    schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    ok: true,
    classification: goalRecordUpdate ? 'GAP_ATTACHED_TO_EXISTING_SCHEDULER_GOAL' : 'GAP_REQUIRES_CANONICAL_OWNER',
    evaluation: evaluated,
    gapObservation: gap,
    improvementContinuation,
    handoffRecord: Object.freeze(handoffRecord),
    handoffRef,
    goalRecordUpdate,
    authority: AUTHORITY,
    errors: Object.freeze([]),
  });
}
