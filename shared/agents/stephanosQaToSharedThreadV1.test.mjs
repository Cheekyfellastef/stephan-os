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
import {
  projectPersistedStephanosQaIntoSharedThreadV1,
} from './stephanosQaToSharedThreadV1.mjs';

const createdAtUtc = '2026-09-25T17:00:00.000Z';
const answeredAtUtc = '2026-09-25T17:01:00.000Z';
const nowMs = Date.parse(answeredAtUtc);

function question(overrides = {}) {
  const questionClass = STEPHANOS_INITIAL_QUESTION_CLASSES[0];
  return {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'round-live-001',
    questionId: 'question-live-001',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What is the current safe next move for the shared conversation goal?',
    questionClass,
    intentFingerprint: 'intent-live-current-programme-truth',
    noveltyRefs: [],
    contextRefs: ['goal-1290'],
    expectedEvidenceClass: 'CANONICAL_EVIDENCE',
    createdAtUtc,
    ...overrides,
  };
}

function answer(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: 'answer-live-001',
    questionId: 'question-live-001',
    roundId: 'round-live-001',
    responderParticipantId: 'stephanos',
    answerText: 'Continue through the existing Shared Workspace and preserve operator authority.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['proof/shared-thread'],
    freshness: 'FRESH',
    sourcesConsulted: ['shared-workspace'],
    cannotAnswerReason: null,
    answerVerdict: 'ANSWERED_GROUNDED',
    gapRefs: [],
    answeredAtUtc,
    ...overrides,
  };
}

function records() {
  const q = createStephanosWorkspaceQuestionRecord(question(), {
    relatedIssue: '#1290',
    proofRefs: ['proof/question-message'],
    workspaceValidationOptions: { nowMs: Date.parse(createdAtUtc) },
  });
  const a = createStephanosWorkspaceAnswerRecord(answer(), {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue: '#1290',
    proofRefs: ['proof/answer-message'],
    workspaceValidationOptions: { nowMs },
  });
  assert.equal(q.valid, true, q.errors.join(', '));
  assert.equal(a.valid, true, a.errors.join(', '));
  return { questionRecord: q.record, answerRecord: a.record };
}

test('persisted ChatGPT question and Stephanos answer become one shared thread', () => {
  const pair = records();
  const result = projectPersistedStephanosQaIntoSharedThreadV1({
    threadId: 'shared-operator-thread-001',
    ...pair,
  }, { nowMs });

  assert.equal(result.ok, true, result.errors.join(', '));
  assert.equal(result.classification, 'PERSISTED_QA_PROJECTED_INTO_SHARED_THREAD');
  assert.equal(result.threadProjection.threadId, 'shared-operator-thread-001');
  assert.equal(result.threadProjection.turnCount, 2);
  assert.deepEqual(
    result.threadProjection.transcript.map((turn) => turn.senderParticipantId),
    ['chatgpt-bridge', 'stephanos'],
  );
  assert.equal(
    result.threadProjection.transcript[1].replyToTurnId,
    result.threadProjection.transcript[0].turnId,
  );
  assert.equal(result.authority.commandExecutionAllowed, false);
});

test('caller must supply one canonical shared thread id', () => {
  const result = projectPersistedStephanosQaIntoSharedThreadV1({
    threadId: '',
    ...records(),
  }, { nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'SHARED_THREAD_ID_REQUIRED');
});

test('question/answer lineage mismatch fails closed', () => {
  const pair = records();
  const mismatchedAnswer = createStephanosWorkspaceAnswerRecord(answer({
    questionId: 'question-live-other',
  }), {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue: '#1290',
    proofRefs: ['proof/answer-message'],
    workspaceValidationOptions: { nowMs },
  });
  assert.equal(mismatchedAnswer.valid, true);

  const result = projectPersistedStephanosQaIntoSharedThreadV1({
    threadId: 'shared-operator-thread-001',
    questionRecord: pair.questionRecord,
    answerRecord: mismatchedAnswer.record,
  }, { nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'PERSISTED_QA_LINEAGE_REJECTED');
  assert.match(result.errors.join('\n'), /question-lineage-mismatch/);
});

test('non-ChatGPT asker cannot masquerade as the shared ChatGPT participant', () => {
  const q = createStephanosWorkspaceQuestionRecord(question({
    askerParticipantId: 'operator',
  }), {
    relatedIssue: '#1290',
    proofRefs: ['proof/question-message'],
    workspaceValidationOptions: { nowMs: Date.parse(createdAtUtc) },
  });
  assert.equal(q.valid, true);
  const pair = records();
  const result = projectPersistedStephanosQaIntoSharedThreadV1({
    threadId: 'shared-operator-thread-001',
    questionRecord: q.record,
    answerRecord: pair.answerRecord,
  }, { nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'PERSISTED_QA_ASKER_NOT_CHATGPT');
});

test('stale persisted QA cannot be laundered into a current shared conversation', () => {
  const pair = records();
  const result = projectPersistedStephanosQaIntoSharedThreadV1({
    threadId: 'shared-operator-thread-001',
    ...pair,
  }, { nowMs: nowMs + 2 * 60 * 60 * 1000 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /stale-record/);
});
