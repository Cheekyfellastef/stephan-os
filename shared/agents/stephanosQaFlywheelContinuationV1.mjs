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
import {
  buildStephanosRepairLearningCompletionV1,
  buildStephanosRepairLearningIntakeV1,
} from './stephanosRepairLearningContinuationV1.mjs';

export const STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION =
  'stephanos.qa-flywheel-continuation.v1';

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

function attachGapToGoal(goalRecord, gapObservation, handoffRef, improvementContinuation, learningContinuation) {
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
    ...(improvementContinuation ? { flywheelImprovementContinuation: improvementContinuation } : {}),
    ...(learningContinuation ? { flywheelRepairLearning: learningContinuation } : {}),
  };
  return Object.freeze(next);
}

function attachRepairCompletionToGoal(goalRecord, learningContinuation, resolvedAtUtc) {
  if (!goalRecord || learningContinuation?.status !== 'REPAIR_VERIFIED_AND_LEARNING_READY') return null;
  const priorProofRefs = Array.isArray(goalRecord.resultProofRefs) ? goalRecord.resultProofRefs : [];
  return Object.freeze({
    ...goalRecord,
    resultProofRefs: Object.freeze([
      ...new Set([...priorProofRefs, ...(learningContinuation.resultProofRefs || [])]),
    ]),
    reusableCapabilityId: learningContinuation.reusableCapabilityId,
    sharedLessonId: learningContinuation.sharedLessonId,
    flywheelGapResolvedAtUtc: resolvedAtUtc,
    flywheelRepairLearning: learningContinuation,
    flywheelContinuitySchema: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
  });
}

function evidenceRefs(input, answer = null) {
  return Object.freeze([
    ...new Set([
      ...(Array.isArray(input.answerRecord?.proofRefs) ? input.answerRecord.proofRefs : []),
      ...(Array.isArray(input.questionRecord?.proofRefs) ? input.questionRecord.proofRefs : []),
      ...(Array.isArray(answer?.evidenceRefs) ? answer.evidenceRefs : []),
    ].map(text).filter(Boolean)),
  ].slice(0, 32));
}

function invalid(classification, errors = []) {
  return Object.freeze({
    schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    ok: false,
    classification,
    evaluation: null,
    gapObservation: null,
    improvementContinuation: null,
    learningContinuation: null,
    handoffRecord: null,
    handoffRef: null,
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
    const canCloseKnownGap = first.state === 'ANSWERED'
      && input.existingGapObservation
      && input.existingGoalRecord;
    if (canCloseKnownGap) {
      const learningContinuation = buildStephanosRepairLearningCompletionV1({
        gapObservation: input.existingGapObservation,
        existingGoalRecord: input.existingGoalRecord,
        evidenceRefs: evidenceRefs(input, answer),
        verifiedAtUtc: answer.answeredAtUtc,
      });
      if (learningContinuation.status === 'REPAIR_VERIFIED_AND_LEARNING_READY') {
        const handoffId = stableId('qa-repair-learning', [
          input.existingGapObservation.gapSignature || input.existingGapObservation.gapId,
          learningContinuation.successfulRepairRecord.recordId,
        ]);
        const handoffRef = `workspace://${handoffId}`;
        const relatedIssue = goalIssueRef(
          input.existingGoalRecord,
          SAFE_GOAL_REF.test(text(input.questionRecord?.relatedIssue)) ? text(input.questionRecord.relatedIssue) : '#1607',
        );
        const handoffRecord = createSharedWorkspaceHandoffRecord({
          handoffId,
          participantId: 'stephanos',
          fromParticipantId: 'stephanos',
          toParticipantId: 'mission-scheduler',
          timestampUtc: answer.answeredAtUtc,
          correlationId: text(input.questionRecord?.correlationId) || input.existingGapObservation.gapId,
          relatedIssue,
          relatedPr: text(input.questionRecord?.relatedPr),
          proofRefs: [...learningContinuation.resultProofRefs],
          summary: `Repair for ${input.existingGapObservation.gapId} replayed successfully and produced flywheel learning assets.`,
          body: JSON.stringify({
            schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
            gapObservation: input.existingGapObservation,
            learningContinuation,
            completionDisposition: 'WRITE_PROOF_LESSON_METHOD_AND_REARM_RECURRENCE_WATCH',
            authority: AUTHORITY,
          }),
        });
        const workspaceValidation = validateSharedWorkspaceRecord(handoffRecord, { nowMs });
        if (!workspaceValidation.valid) return invalid('REPAIR_LEARNING_HANDOFF_INVALID', workspaceValidation.errors);
        const goalRecordUpdate = attachRepairCompletionToGoal(
          input.existingGoalRecord,
          learningContinuation,
          answer.answeredAtUtc,
        );
        return Object.freeze({
          schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
          ok: true,
          classification: 'REPAIR_VERIFIED_AND_LEARNING_READY',
          evaluation: first,
          gapObservation: null,
          resolvedGapObservation: input.existingGapObservation,
          improvementContinuation: null,
          learningContinuation,
          handoffRecord: Object.freeze(handoffRecord),
          handoffRef,
          goalRecordUpdate,
          authority: AUTHORITY,
          errors: Object.freeze([]),
        });
      }
    }

    return Object.freeze({
      schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
      ok: true,
      classification: first.state === 'ANSWERED' ? 'NO_BUILDABLE_GAP' : first.state,
      evaluation: first,
      gapObservation: null,
      improvementContinuation: null,
      learningContinuation: null,
      handoffRecord: null,
      handoffRef: null,
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
  const improvementEvidenceRefs = evidenceRefs(input, answer);
  const improvementContinuation = canonicalGoalRef && goalCandidate
    ? buildStephanosImprovementFlywheelContinuationV1({
      gapObservation: gap,
      existingGoalRecord: input.existingGoalRecord,
      evidenceRefs: improvementEvidenceRefs,
    })
    : null;
  const learningContinuation = canonicalGoalRef && goalCandidate
    ? buildStephanosRepairLearningIntakeV1({
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
      learningContinuation,
      authority: AUTHORITY,
    }),
  });
  const workspaceValidation = validateSharedWorkspaceRecord(handoffRecord, { nowMs });
  if (!workspaceValidation.valid) return invalid('GAP_HANDOFF_INVALID', workspaceValidation.errors);

  const goalRecordUpdate = canonicalGoalRef && goalCandidate
    ? attachGapToGoal(
      input.existingGoalRecord,
      gap,
      handoffRef,
      improvementContinuation,
      learningContinuation,
    )
    : null;

  return Object.freeze({
    schemaVersion: STEPHANOS_QA_FLYWHEEL_CONTINUATION_SCHEMA_VERSION,
    ok: true,
    classification: goalRecordUpdate ? 'GAP_ATTACHED_TO_EXISTING_SCHEDULER_GOAL' : 'GAP_REQUIRES_CANONICAL_OWNER',
    evaluation: evaluated,
    gapObservation: gap,
    improvementContinuation,
    learningContinuation,
    handoffRecord: Object.freeze(handoffRecord),
    handoffRef,
    goalRecordUpdate,
    authority: AUTHORITY,
    errors: Object.freeze([]),
  });
}
