import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosWorkspaceAnswerRecord,
  createStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import { buildStephanosQaFlywheelContinuationV1 } from './stephanosQaFlywheelContinuationV1.mjs';
import { buildStephanosRepairLearningCompletionV1 } from './stephanosRepairLearningContinuationV1.mjs';

const CREATED_AT = '2026-09-19T18:00:00.000Z';
const ANSWERED_AT = '2026-09-19T18:01:00.000Z';
const NOW_MS = Date.parse(ANSWERED_AT);
const SOURCE_HEAD = '0123456789abcdef0123456789abcdef01234567';

function questionRecord() {
  const question = {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'round-flywheel-001',
    questionId: 'question-flywheel-001',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What current project truth is unavailable and why?',
    questionClass: STEPHANOS_INITIAL_QUESTION_CLASSES[0],
    intentFingerprint: 'intent-flywheel-current-truth-001',
    noveltyRefs: [],
    contextRefs: ['goal-1308'],
    expectedEvidenceClass: 'CANONICAL_EVIDENCE',
    createdAtUtc: CREATED_AT,
  };
  const built = createStephanosWorkspaceQuestionRecord(question, {
    relatedIssue: '#1308',
    proofRefs: ['proof/question-flywheel-001'],
    workspaceValidationOptions: { nowMs: Date.parse(CREATED_AT) },
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

function answerRecord(answerVerdict = 'GAP_TOOL_OR_DATA_ACCESS') {
  const grounded = answerVerdict === 'ANSWERED_GROUNDED';
  const answer = {
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: 'answer-flywheel-001',
    questionId: 'question-flywheel-001',
    roundId: 'round-flywheel-001',
    responderParticipantId: 'stephanos',
    answerText: grounded
      ? 'Canonical evidence answers the question.'
      : 'The required project truth is not available through the current capability path.',
    epistemicState: grounded ? 'KNOWN_FROM_CANONICAL_STATE' : 'UNKNOWN',
    evidenceRefs: grounded ? ['proof/project-truth-current'] : [],
    freshness: grounded ? 'FRESH' : 'UNKNOWN',
    sourcesConsulted: grounded ? ['canonical-project-state'] : [],
    cannotAnswerReason: grounded ? null : 'Required data source is not connected.',
    answerVerdict,
    gapRefs: [],
    answeredAtUtc: ANSWERED_AT,
  };
  const built = createStephanosWorkspaceAnswerRecord(answer, {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue: '#1308',
    proofRefs: ['proof/answer-flywheel-001'],
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

function goalRecord(sourceHead = SOURCE_HEAD) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-1308',
    participantId: 'chatgpt-bridge',
    timestampUtc: CREATED_AT,
    title: 'Goal: Project Intelligence and Conversational Understanding V1',
    status: 'READY',
    issueNumber: 1308,
    repository: 'Cheekyfellastef/stephan-os',
    route: 'CHATGPT_GITHUB',
    ...(sourceHead ? { sourceHead } : {}),
  };
}

function detectedGap() {
  return buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord(),
    existingGoalRecord: goalRecord(),
    nowMs: NOW_MS,
  });
}

test('buildable Q&A gap attaches to an existing goal, produces a governed repair proposal, and writes an incident lesson candidate', () => {
  const result = detectedGap();

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GAP_ATTACHED_TO_EXISTING_SCHEDULER_GOAL');
  assert.equal(result.evaluation.canonicalGoalRef, '#1308');
  assert.equal(result.evaluation.schedulerCandidate, true);
  assert.equal(result.goalRecordUpdate.issueNumber, 1308);
  assert.equal(result.goalRecordUpdate.flywheelGapRefs.length, 1);
  assert.equal(result.handoffRecord.toParticipantId, 'mission-scheduler');
  assert.equal(result.improvementContinuation.status, 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER');
  assert.equal(result.improvementContinuation.proposalReady, true);
  assert.equal(result.improvementContinuation.planner.currentOwnerGoal, '#1308');
  assert.equal(result.improvementContinuation.planner.sourceHead, SOURCE_HEAD);
  assert.equal(
    result.goalRecordUpdate.flywheelImprovementContinuation.planner.proposal.changeClass,
    'BOUNDED_SOURCE_CHANGE',
  );
  assert.equal(result.learningContinuation.status, 'INCIDENT_LEARNING_READY');
  assert.equal(result.learningContinuation.incidentRecord.recordClass, 'ENGINEERING_INCIDENT');
  assert.equal(result.learningContinuation.incidentRecord.status, 'CURRENT');
  assert.equal(result.learningContinuation.recurrenceWatch.canonicalOwner, '#1308');
  assert.equal(result.learningContinuation.recurrenceWatch.nextAction, 'REOPEN_EXISTING_OWNER_AND_ROUTE_GOVERNED_REPAIR');
  assert.equal(result.goalRecordUpdate.flywheelRepairLearning.incidentRecord.recordId, result.learningContinuation.incidentRecord.recordId);
  const handoffBody = JSON.parse(result.handoffRecord.body);
  assert.equal(handoffBody.improvementContinuation.proposalReady, true);
  assert.equal(handoffBody.learningContinuation.incidentRecord.recordClass, 'ENGINEERING_INCIDENT');
  assert.equal(result.authority.schedulerDispatchAllowed, false);
  assert.equal(result.authority.goalCreationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
});

test('Q&A replay evidence can be projected through the repair learning stack directly', () => {
  const first = detectedGap();
  const completion = buildStephanosRepairLearningCompletionV1({
    gapObservation: first.gapObservation,
    existingGoalRecord: first.goalRecordUpdate,
    evidenceRefs: [
      'proof/answer-flywheel-001',
      'proof/question-flywheel-001',
      'proof/project-truth-current',
    ],
    verifiedAtUtc: ANSWERED_AT,
  });
  assert.equal(
    completion.status,
    'REPAIR_VERIFIED_AND_LEARNING_READY',
    JSON.stringify({
      status: completion.status,
      blocker: completion.blocker,
      proceduralErrors: completion.proceduralMemoryProjection?.validationErrors,
      reflectiveErrors: completion.reflectiveMemoryProjection?.validationErrors,
    }),
  );
});

test('successful replay of a known gap writes proven repair and reusable method assets before scheduler closure', () => {
  const first = detectedGap();
  const replay = buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord('ANSWERED_GROUNDED'),
    existingGapObservation: first.gapObservation,
    existingGoalRecord: first.goalRecordUpdate,
    nowMs: NOW_MS,
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.classification, 'REPAIR_VERIFIED_AND_LEARNING_READY');
  assert.equal(replay.learningContinuation.status, 'REPAIR_VERIFIED_AND_LEARNING_READY');
  assert.equal(replay.learningContinuation.successfulRepairRecord.recordClass, 'SUCCESSFUL_REPAIR');
  assert.equal(replay.learningContinuation.successfulRepairRecord.status, 'CURRENT');
  assert.equal(replay.learningContinuation.reusableMethodRecord.recordClass, 'REUSABLE_METHOD');
  assert.equal(replay.learningContinuation.reusableMethodRecord.status, 'CURRENT');
  assert.equal(replay.learningContinuation.proceduralMemoryProjection.valid, true);
  assert.equal(replay.learningContinuation.reflectiveMemoryProjection.valid, true);
  assert.equal(replay.learningContinuation.recurrenceWatch.state, 'ARMED_AFTER_PROVEN_REPAIR');
  assert.equal(replay.goalRecordUpdate.sharedLessonId, replay.learningContinuation.sharedLessonId);
  assert.equal(replay.goalRecordUpdate.reusableCapabilityId, replay.learningContinuation.reusableCapabilityId);
  assert.ok(replay.goalRecordUpdate.resultProofRefs.includes('proof/project-truth-current'));
  assert.equal(replay.handoffRecord.toParticipantId, 'mission-scheduler');
  const handoffBody = JSON.parse(replay.handoffRecord.body);
  assert.equal(handoffBody.completionDisposition, 'WRITE_PROOF_LESSON_METHOD_AND_REARM_RECURRENCE_WATCH');
});

test('replaying the same proven repair is idempotent for lesson and reusable method identity', () => {
  const first = detectedGap();
  const input = {
    questionRecord: questionRecord(),
    answerRecord: answerRecord('ANSWERED_GROUNDED'),
    existingGapObservation: first.gapObservation,
    existingGoalRecord: first.goalRecordUpdate,
    nowMs: NOW_MS,
  };
  const left = buildStephanosQaFlywheelContinuationV1(input);
  const right = buildStephanosQaFlywheelContinuationV1(input);

  assert.equal(left.learningContinuation.sharedLessonId, right.learningContinuation.sharedLessonId);
  assert.equal(left.learningContinuation.reusableCapabilityId, right.learningContinuation.reusableCapabilityId);
  assert.equal(left.handoffRef, right.handoffRef);
});

test('missing exact source identity is persisted as a repair hold instead of dropping the gap', () => {
  const result = buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord(),
    existingGoalRecord: goalRecord(''),
    nowMs: NOW_MS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GAP_ATTACHED_TO_EXISTING_SCHEDULER_GOAL');
  assert.equal(result.improvementContinuation.status, 'EXACT_SOURCE_HEAD_REQUIRED');
  assert.equal(result.improvementContinuation.proposalReady, false);
  assert.equal(result.goalRecordUpdate.flywheelImprovementContinuation.nextAction, 'REFRESH_EXACT_SOURCE_IDENTITY');
  assert.equal(result.learningContinuation.status, 'INCIDENT_LEARNING_READY');
});

test('unowned buildable gap remains durable but cannot fabricate a canonical goal', () => {
  const result = buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord(),
    existingGoalRecord: null,
    nowMs: NOW_MS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GAP_REQUIRES_CANONICAL_OWNER');
  assert.equal(result.goalRecordUpdate, null);
  assert.equal(result.improvementContinuation, null);
  assert.equal(result.learningContinuation, null);
  assert.equal(result.authority.goalCreationAllowed, false);
});

test('grounded answer with no prior gap does not manufacture scheduler or learning work', () => {
  const result = buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord('ANSWERED_GROUNDED'),
    existingGoalRecord: goalRecord(),
    nowMs: NOW_MS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'NO_BUILDABLE_GAP');
  assert.equal(result.gapObservation, null);
  assert.equal(result.handoffRecord, null);
  assert.equal(result.goalRecordUpdate, null);
  assert.equal(result.improvementContinuation, null);
  assert.equal(result.learningContinuation, null);
});
