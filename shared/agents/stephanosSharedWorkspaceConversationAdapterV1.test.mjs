import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  STEPHANOS_BOUNDARY_ADJUDICATION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
  canonicalStephanosQuestionIntentFingerprint,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL,
  STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE,
  buildStephanosWorkspaceQuestionRound,
  createStephanosWorkspaceAnswerRecord,
  createStephanosWorkspaceQuestionRecord,
  decodeStephanosWorkspaceAnswerRecord,
  decodeStephanosWorkspaceQuestionRecord,
  evaluateStephanosWorkspaceConversation,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';

const createdAtUtc = '2026-08-14T10:30:00.000Z';
const answeredAtUtc = '2026-08-14T10:31:00.000Z';

function question(index, questionClass = STEPHANOS_INITIAL_QUESTION_CLASSES[index], overrides = {}) {
  const number = index + 1;
  return {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'round-001',
    questionId: `question-${String(number).padStart(2, '0')}`,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: `Capability question ${number}: provide the grounded answer for ${questionClass}.`,
    questionClass,
    intentFingerprint: `intent-${String(number).padStart(2, '0')}-${questionClass.toLowerCase()}`,
    noveltyRefs: [],
    contextRefs: ['goal-1308'],
    expectedEvidenceClass: 'CANONICAL_EVIDENCE',
    createdAtUtc,
    ...overrides,
  };
}

function round() {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId: 'round-001',
    roundNumber: 1,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questions: STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => question(index, questionClass)),
    createdAtUtc,
  };
}

function laterRound() {
  const priorQuestions = round().questions;
  const prior = priorQuestions.map((item) => item.intentFingerprint);
  const questions = STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => {
    const candidate = question(index, questionClass, {
      roundId: 'round-002',
      questionId: `transfer-question-${String(index + 1).padStart(2, '0')}`,
      questionText: `Transfer capability question ${index + 1} for ${questionClass}.`,
      noveltyRefs: [`previous-round:${prior[index]}`],
    });
    return { ...candidate, intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate) };
  });
  return {
    prior,
    priorQuestions,
    capabilityRound: {
      schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
      roundId: 'round-002',
      roundNumber: 2,
      askerParticipantId: 'chatgpt-bridge',
      targetParticipantId: 'stephanos',
      questions,
      createdAtUtc,
    },
  };
}

function answer(index, overrides = {}) {
  const q = question(index);
  const number = index + 1;
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: `answer-${String(number).padStart(2, '0')}`,
    questionId: q.questionId,
    roundId: q.roundId,
    responderParticipantId: 'stephanos',
    answerText: `Grounded capability answer ${number}.`,
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: [`proof/answer-${number}`],
    freshness: 'FRESH',
    sourcesConsulted: ['github-goal-1308'],
    cannotAnswerReason: null,
    answerVerdict: 'ANSWERED_GROUNDED',
    gapRefs: [],
    answeredAtUtc,
    ...overrides,
  };
}

function answerRecord(index, overrides = {}) {
  const built = createStephanosWorkspaceAnswerRecord(answer(index, overrides), {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue: '#1308',
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

test('a valid capability question becomes an existing Shared Workspace message without mutation authority', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(0), { relatedIssue: '#1308' });
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.equal(built.record.kind, SHARED_WORKSPACE_RECORD_KINDS.MESSAGE);
  assert.equal(built.record.channel, STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL);
  assert.equal(built.record.recordSubtype, STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.QUESTION);
  assert.equal(built.record.participantId, 'chatgpt-bridge');
  assert.equal(built.record.recipientParticipantId, 'stephanos');
  assert.equal(built.record.correlationId, 'round-001');
  assert.equal(built.record.sourceMutationAllowed, false);
  assert.equal(built.record.commandExecutionAllowed, false);
  assert.equal(built.record.approvalAllowed, false);
  assert.equal(built.record.mergeAllowed, false);
  assert.equal(built.record.deploymentAllowed, false);
  assert.equal(validateSharedWorkspaceRecord(built.record).valid, true);
});

test('question workspace records round-trip through the deterministic adapter', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(2), { relatedIssue: '#1308' });
  const decoded = decodeStephanosWorkspaceQuestionRecord(built.record);
  assert.equal(decoded.valid, true, decoded.errors.join(', '));
  assert.deepEqual(decoded.question, question(2));
});

test('one initial ten-question round fans out to exactly ten correlated Shared Workspace messages', () => {
  const built = buildStephanosWorkspaceQuestionRound(round(), { relatedIssue: '#1308' });
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.equal(built.records.length, 10);
  assert.equal(new Set(built.records.map((record) => record.messageId)).size, 10);
  assert.equal(built.records.every((record) => record.correlationId === 'round-001'), true);
  assert.equal(built.records.every((record) => record.recipientParticipantId === 'stephanos'), true);
  assert.equal(built.authority.commandExecutionAllowed, false);
});

test('later-round fan-out requires canonical prior questions as well as their exact fingerprint lineage', () => {
  const { capabilityRound, prior, priorQuestions } = laterRound();
  const missing = buildStephanosWorkspaceQuestionRound(capabilityRound, {
    relatedIssue: '#1308',
    priorRoundIntentFingerprints: prior,
  });
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join('\n'), /priorRoundQuestions/);

  const built = buildStephanosWorkspaceQuestionRound(capabilityRound, {
    relatedIssue: '#1308',
    priorRoundQuestions: priorQuestions,
    priorRoundIntentFingerprints: prior,
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.equal(built.records.length, 10);
  assert.equal(built.records.every((record) => record.correlationId === 'round-002'), true);
});

test('a valid Stephanos answer becomes a correlated Shared Workspace response and round-trips', () => {
  const record = answerRecord(0);
  assert.equal(record.recordSubtype, STEPHANOS_SHARED_WORKSPACE_CONVERSATION_SUBTYPE.ANSWER);
  assert.equal(record.participantId, 'stephanos');
  assert.equal(record.recipientParticipantId, 'chatgpt-bridge');
  const decoded = decodeStephanosWorkspaceAnswerRecord(record);
  assert.equal(decoded.valid, true, decoded.errors.join(', '));
  assert.deepEqual(decoded.answer, answer(0));
});

test('ten grounded answer records settle the capability round through the existing evaluator', () => {
  const result = evaluateStephanosWorkspaceConversation({
    round: round(),
    answerRecords: STEPHANOS_INITIAL_QUESTION_CLASSES.map((_, index) => answerRecord(index)),
  });
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.state, 'SETTLED');
  assert.equal(result.evaluation.counts.grounded, 10);
  assert.equal(result.evaluation.counts.buildableGaps, 0);
  assert.equal(result.evaluation.mayAdvanceToNovelRound, true);
});

test('a buildable unanswered capability remains a durable gap rather than being painted green', () => {
  const records = STEPHANOS_INITIAL_QUESTION_CLASSES.map((_, index) => answerRecord(index));
  records[3] = answerRecord(3, {
    answerText: 'Current evidence cannot answer this capability question.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: [],
    freshness: 'UNKNOWN',
    sourcesConsulted: [],
    cannotAnswerReason: 'Required agent capability evidence is unavailable.',
    answerVerdict: 'GAP_TOOL_OR_DATA_ACCESS',
  });
  const result = evaluateStephanosWorkspaceConversation({ round: round(), answerRecords: records });
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.state, 'GAPS_IDENTIFIED');
  assert.equal(result.evaluation.counts.buildableGaps, 1);
  assert.equal(result.evaluation.requiresRepairReplay, true);
  assert.equal(result.evaluation.gapObservations.length, 1);
  assert.deepEqual(result.evaluation.gapObservations[0].existingGoalCandidates, ['#1556', '#1308']);
});

test('boundary evidence stays safe-held through the adapter until canonical adjudication context is forwarded', () => {
  const records = STEPHANOS_INITIAL_QUESTION_CLASSES.map((_, index) => answerRecord(index));
  const boundaryAnswer = answer(9, {
    answerText: 'Runtime mutation authority remains outside this participant.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['proof/governing-authority-policy'],
    freshness: 'FRESH',
    sourcesConsulted: ['programme-authority'],
    cannotAnswerReason: 'Authority remains reserved to governing policy.',
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
  });
  const boundaryRecord = createStephanosWorkspaceAnswerRecord(boundaryAnswer, {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue: '#1308',
  });
  assert.equal(boundaryRecord.valid, true, boundaryRecord.errors.join(', '));
  records[9] = boundaryRecord.record;

  const held = evaluateStephanosWorkspaceConversation({ round: round(), answerRecords: records });
  assert.equal(held.state, 'SAFE_HOLD');
  assert.equal(held.evaluation.requiresBoundaryAdjudication, true);

  const adjudication = {
    schemaVersion: STEPHANOS_BOUNDARY_ADJUDICATION_SCHEMA_VERSION,
    answerId: boundaryAnswer.answerId,
    answerVerdict: boundaryAnswer.answerVerdict,
    status: 'CURRENT',
    freshness: 'FRESH',
    evidenceRefs: [...boundaryAnswer.evidenceRefs],
    sourcesConsulted: [...boundaryAnswer.sourcesConsulted],
    proofRefs: ['proof/boundary-adjudication'],
    adjudicatedAtUtc: answeredAtUtc,
  };
  const settled = evaluateStephanosWorkspaceConversation({
    round: round(),
    answerRecords: records,
    boundaryAdjudications: [adjudication],
    authoritativeEvidenceRefs: ['proof/governing-authority-policy'],
    authoritativeSourceRefs: ['programme-authority'],
    authoritativeAdjudicationProofRefs: ['proof/boundary-adjudication'],
    evaluationNowMs: Date.parse(answeredAtUtc),
  });
  assert.equal(settled.state, 'SETTLED');
  assert.equal(settled.evaluation.counts.retainedBoundaries, 1);
  assert.equal(settled.evaluation.requiresBoundaryAdjudication, false);
});

test('recipient or participant lineage tampering fails closed', () => {
  const good = answerRecord(1);
  const tampered = { ...good, recipientParticipantId: 'operator' };
  const result = evaluateStephanosWorkspaceConversation({
    round: round(),
    answerRecords: [answerRecord(0), tampered, ...STEPHANOS_INITIAL_QUESTION_CLASSES.slice(2).map((_, index) => answerRecord(index + 2))],
  });
  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.match(result.errors.join('\n'), /recipient-mismatch/);
});

test('conversation messages cannot smuggle source, command, approval, merge or deployment authority', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(4), { relatedIssue: '#1308' });
  const authorityFields = ['sourceMutationAllowed', 'commandExecutionAllowed', 'approvalAllowed', 'mergeAllowed', 'deploymentAllowed'];
  for (const field of authorityFields) {
    const tampered = { ...built.record, [field]: true };
    const decoded = decodeStephanosWorkspaceQuestionRecord(tampered);
    assert.equal(decoded.valid, false, `${field} must fail closed`);
    assert.match(decoded.errors.join('\n'), new RegExp(`${field}-must-remain-false`));
  }
});

test('corrupt conversation bodies and malformed questions fail closed', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(5), { relatedIssue: '#1308' });
  const corrupt = { ...built.record, body: '{not-json' };
  const decoded = decodeStephanosWorkspaceQuestionRecord(corrupt);
  assert.equal(decoded.valid, false);
  assert.match(decoded.errors.join('\n'), /conversation-body-invalid-json/);

  const malformed = { ...question(5), unexpectedAuthority: 'EXECUTE' };
  const rejected = createStephanosWorkspaceQuestionRecord(malformed, { relatedIssue: '#1308' });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join('\n'), /unknown-field:unexpectedAuthority/);
});
