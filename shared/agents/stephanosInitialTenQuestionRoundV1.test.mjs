import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import { createStephanosWorkspaceAnswerRecord } from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  buildInitialStephanosTenQuestionPacketV1,
  createInitialStephanosTenQuestionRoundV1,
  evaluateInitialStephanosTenQuestionRoundV1,
  initialStephanosQuestionClassesV1,
} from './stephanosInitialTenQuestionRoundV1.mjs';

const CREATED = '2026-08-14T11:30:00.000Z';
const ANSWERED = '2026-08-14T11:31:00.000Z';

function groundedAnswer(question, overrides = {}) {
  return {
    schemaVersion:STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId:`answer-${question.questionId}`,
    questionId:question.questionId,
    roundId:question.roundId,
    responderParticipantId:'stephanos',
    answerText:`Grounded answer for ${question.questionClass}.`,
    epistemicState:'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs:[`evidence/${question.questionId}`],
    freshness:'FRESH',
    sourcesConsulted:['github-canonical-state','shared-workspace'],
    cannotAnswerReason:null,
    answerVerdict:'ANSWERED_GROUNDED',
    gapRefs:[],
    answeredAtUtc:ANSWERED,
    ...overrides,
  };
}

function answerRecords(round, overrideAt = -1, override = {}) {
  return round.questions.map((question, index) => {
    const answer = groundedAnswer(question, index === overrideAt ? override : {});
    const built = createStephanosWorkspaceAnswerRecord(answer, {
      recipientParticipantId:'chatgpt-bridge',
      relatedIssue:'#1308',
      relatedPr:'#1777',
    });
    assert.equal(built.valid, true, built.errors.join(','));
    return built.record;
  });
}

test('initial proving round contains exactly the ten canonical capability classes', () => {
  const built = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  assert.equal(built.valid, true);
  assert.equal(built.round.questions.length, 10);
  assert.deepEqual(built.round.questions.map((question) => question.questionClass), STEPHANOS_INITIAL_QUESTION_CLASSES);
  assert.deepEqual(initialStephanosQuestionClassesV1(), STEPHANOS_INITIAL_QUESTION_CLASSES);
  assert.equal(new Set(built.round.questions.map((question) => question.intentFingerprint)).size, 10);
});

test('questions are materially different product/programme probes rather than one status question paraphrased ten times', () => {
  const { round } = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  const texts = round.questions.map((question) => question.questionText.toLowerCase());
  assert.equal(new Set(texts).size, 10);
  assert.ok(texts.some((text) => text.includes('memory') || text.includes('restarts')));
  assert.ok(texts.some((text) => text.includes('openclaw')));
  assert.ok(texts.some((text) => text.includes('spatial world foundry')));
  assert.ok(texts.some((text) => text.includes('do not know') || text.includes('not prove')));
});

test('first proving packet fans out exactly ten existing Shared Workspace question records with no authority', () => {
  const packet = buildInitialStephanosTenQuestionPacketV1({ createdAtUtc:CREATED });
  assert.equal(packet.valid, true, packet.errors.join(','));
  assert.equal(packet.records.length, 10);
  for (const record of packet.records) {
    assert.equal(record.participantId, 'chatgpt-bridge');
    assert.equal(record.recipientParticipantId, 'stephanos');
    assert.equal(record.channel, 'shared-participant-qa');
    assert.equal(record.sourceMutationAllowed, false);
    assert.equal(record.commandExecutionAllowed, false);
    assert.equal(record.approvalAllowed, false);
    assert.equal(record.mergeAllowed, false);
    assert.equal(record.deploymentAllowed, false);
    const body = JSON.parse(record.body);
    assert.equal(body.subtype, 'conversation-question');
    assert.equal(Object.hasOwn(body.payload, 'answerText'), false);
  }
  assert.equal(packet.completionClaimAllowed, false);
  assert.equal(packet.liveConversationClaimAllowed, false);
});

test('ten independently grounded answer records settle the first round without hard-coded answer matching', () => {
  const { round } = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:answerRecords(round),
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.state, 'SETTLED');
  assert.equal(evaluation.evaluation.counts.grounded, 10);
  assert.equal(evaluation.evaluation.mayAdvanceToNovelRound, true);
});

test('one truthful retrieval miss becomes a buildable gap instead of being hidden by fluent text', () => {
  const { round } = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:answerRecords(round, 6, {
      answerText:'I cannot prove the latest material changes from current retrievable evidence.',
      epistemicState:'UNKNOWN',
      evidenceRefs:[],
      freshness:'UNKNOWN',
      sourcesConsulted:['shared-workspace'],
      cannotAnswerReason:'Current recent-change evidence is not retrievable through this response path.',
      answerVerdict:'GAP_RETRIEVAL',
      gapRefs:[],
    }),
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.state, 'GAPS_IDENTIFIED');
  assert.equal(evaluation.evaluation.counts.buildableGaps, 1);
  assert.equal(evaluation.evaluation.requiresRepairReplay, true);
  assert.equal(evaluation.evaluation.mayAdvanceToNovelRound, false);
  assert.ok(evaluation.evaluation.gapObservations[0].existingGoalCandidates.includes('#1308'));
});

test('a partial answer holds the ladder for repair/replay even when no explicit gap verdict is returned', () => {
  const { round } = createInitialStephanosTenQuestionRoundV1({ createdAtUtc:CREATED });
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:answerRecords(round, 7, {
      answerText:'I can identify candidate next work but cannot yet prove the priority ordering.',
      epistemicState:'INFERRED_FROM_EVIDENCE',
      evidenceRefs:['evidence/partial-next-action'],
      freshness:'RECENT',
      sourcesConsulted:['github-canonical-state'],
      cannotAnswerReason:null,
      answerVerdict:'ANSWERED_PARTIAL',
      gapRefs:[],
    }),
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.state, 'REGRESSION_PROVING');
  assert.equal(evaluation.evaluation.counts.partial, 1);
  assert.equal(evaluation.evaluation.requiresRepairReplay, true);
});

test('wrong or missing answer record count fails closed', () => {
  const evaluation = evaluateInitialStephanosTenQuestionRoundV1({
    createdAtUtc:CREATED,
    answerRecords:[],
  });
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.state, 'SAFE_HOLD');
  assert.ok(evaluation.errors.includes('answer-records-must-contain-exactly-10'));
});

test('non-exact time input cannot create a proving round', () => {
  assert.throws(() => createInitialStephanosTenQuestionRoundV1({ createdAtUtc:'now' }), /exact ISO timestamp/);
});
