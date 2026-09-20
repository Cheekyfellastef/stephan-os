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

test('buildable Q&A gap attaches to an existing goal and produces a governed repair proposal', () => {
  const result = buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord(),
    existingGoalRecord: goalRecord(),
    nowMs: NOW_MS,
  });

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
  const handoffBody = JSON.parse(result.handoffRecord.body);
  assert.equal(handoffBody.improvementContinuation.proposalReady, true);
  assert.equal(result.authority.schedulerDispatchAllowed, false);
  assert.equal(result.authority.goalCreationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
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
  assert.equal(
    result.goalRecordUpdate.flywheelImprovementContinuation.nextAction,
    'REFRESH_EXACT_SOURCE_IDENTITY',
  );
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
  assert.equal(result.evaluation.goalDisposition, 'NEW_CANONICAL_GAP_GOAL_REQUIRED');
  assert.equal(result.improvementContinuation, null);
  assert.equal(result.goalRecordUpdate, null);
  assert.ok(result.handoffRecord);
  assert.equal(result.authority.goalCreationAllowed, false);
});

test('grounded answer does not manufacture a gap or scheduler work', () => {
  const result = buildStephanosQaFlywheelContinuationV1({
    questionRecord: questionRecord(),
    answerRecord: answerRecord('ANSWERED_GROUNDED'),
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'NO_BUILDABLE_GAP');
  assert.equal(result.gapObservation, null);
  assert.equal(result.improvementContinuation, null);
  assert.equal(result.handoffRecord, null);
  assert.equal(result.goalRecordUpdate, null);
});
