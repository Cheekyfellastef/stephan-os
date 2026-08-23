import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
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
const createdAtMs = Date.parse(createdAtUtc);
const answeredAtMs = Date.parse(answeredAtUtc);

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
  const questions = STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => {
    const candidate = question(index, questionClass, {
      roundId: 'round-002',
      questionId: `transfer-question-${String(index + 1).padStart(2, '0')}`,
      questionText: `Transfer capability question ${index + 1} for ${questionClass}.`,
      noveltyRefs: [`previous-round:intent-${index + 1}`],
    });
    return { ...candidate, intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate) };
  });
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId: 'round-002',
    roundNumber: 2,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questions,
    createdAtUtc,
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

function questionOptions(overrides = {}) {
  return {
    relatedIssue: '#1308',
    proofRefs: ['proof/question-message'],
    workspaceValidationOptions: { nowMs: createdAtMs },
    ...overrides,
  };
}

function answerOptions(overrides = {}) {
  return {
    recipientParticipantId: 'chatgpt-bridge',
    relatedIssue: '#1308',
    proofRefs: ['proof/answer-message'],
    workspaceValidationOptions: { nowMs: answeredAtMs },
    ...overrides,
  };
}

function answerRecord(index, overrides = {}) {
  const built = createStephanosWorkspaceAnswerRecord(answer(index, overrides), answerOptions());
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

function evaluateOptions(overrides = {}) {
  return {
    round: round(),
    answerRecords: STEPHANOS_INITIAL_QUESTION_CLASSES.map((_, index) => answerRecord(index)),
    workspaceValidationOptions: { nowMs: answeredAtMs },
    ...overrides,
  };
}

test('question message requires real caller-supplied proof and never fabricates a receipt', () => {
  const missing = createStephanosWorkspaceQuestionRecord(question(0), {
    relatedIssue: '#1308',
    workspaceValidationOptions: { nowMs: createdAtMs },
  });
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.errors, ['proofRefs-required-from-caller']);

  const built = createStephanosWorkspaceQuestionRecord(question(0), questionOptions());
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.deepEqual(built.record.proofRefs, ['proof/question-message']);
  assert.equal(built.record.proofRefs.some((ref) => ref.startsWith('receipts/')), false);
  assert.equal(built.record.kind, SHARED_WORKSPACE_RECORD_KINDS.MESSAGE);
  assert.equal(built.record.channel, STEPHANOS_SHARED_WORKSPACE_CONVERSATION_CHANNEL);
  assert.equal(built.record.sourceMutationAllowed, false);
  assert.equal(validateSharedWorkspaceRecord(built.record, { nowMs: createdAtMs }).valid, true);
});

test('question records round-trip through exact record and body shapes', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(2), questionOptions());
  const decoded = decodeStephanosWorkspaceQuestionRecord(built.record, {
    workspaceValidationOptions: { nowMs: createdAtMs },
  });
  assert.equal(decoded.valid, true, decoded.errors.join(', '));
  assert.deepEqual(decoded.question, question(2));
});

test('one initial round fans out to exactly ten correlated messages', () => {
  const built = buildStephanosWorkspaceQuestionRound(round(), questionOptions());
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.equal(built.records.length, 10);
  assert.equal(new Set(built.records.map((record) => record.messageId)).size, 10);
  assert.equal(built.records.every((record) => record.correlationId === 'round-001'), true);
  assert.equal(built.records.every((record) => record.recipientParticipantId === 'stephanos'), true);
  assert.equal(built.authority.commandExecutionAllowed, false);
});

test('later-round fan-out remains safe-held until canonical novelty authority exists', () => {
  const built = buildStephanosWorkspaceQuestionRound(laterRound(), questionOptions());
  assert.equal(built.valid, false);
  assert.match(built.errors.join('\n'), /canonical-novelty-authority-unresolved/);
  assert.equal(built.records.length, 0);
});

test('answer records require expected recipient binding for standalone decode', () => {
  const record = answerRecord(0);
  const missing = decodeStephanosWorkspaceAnswerRecord(record, {
    workspaceValidationOptions: { nowMs: answeredAtMs },
  });
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join('\n'), /expectedRecipientParticipantId-required/);

  const decoded = decodeStephanosWorkspaceAnswerRecord(record, {
    expectedRecipientParticipantId: 'chatgpt-bridge',
    workspaceValidationOptions: { nowMs: answeredAtMs },
  });
  assert.equal(decoded.valid, true, decoded.errors.join(', '));
  assert.deepEqual(decoded.answer, answer(0));

  const wrongRecipient = decodeStephanosWorkspaceAnswerRecord(record, {
    expectedRecipientParticipantId: 'operator',
    workspaceValidationOptions: { nowMs: answeredAtMs },
  });
  assert.equal(wrongRecipient.valid, false);
  assert.match(wrongRecipient.errors.join('\n'), /recipient-participant-lineage-mismatch/);
});

test('ten current grounded answer records settle the initial capability round', () => {
  const result = evaluateStephanosWorkspaceConversation(evaluateOptions());
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.state, 'SETTLED');
  assert.equal(result.evaluation.counts.grounded, 10);
  assert.equal(result.evaluation.mayAdvanceToNovelRound, true);
});

test('stale workspace answers cannot settle even when payload claims FRESH', () => {
  const result = evaluateStephanosWorkspaceConversation(evaluateOptions({
    workspaceValidationOptions: { nowMs: answeredAtMs + 2 * 60 * 60 * 1000 },
  }));
  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.match(result.errors.join('\n'), /workspace:stale-record/);
});

test('future workspace answers fail closed', () => {
  const result = evaluateStephanosWorkspaceConversation(evaluateOptions({
    workspaceValidationOptions: { nowMs: answeredAtMs - 1 },
  }));
  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.match(result.errors.join('\n'), /workspace:future-record/);
});

test('buildable unanswered capability remains a durable gap', () => {
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
  const result = evaluateStephanosWorkspaceConversation({
    round: round(),
    answerRecords: records,
    workspaceValidationOptions: { nowMs: answeredAtMs },
  });
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.state, 'GAPS_IDENTIFIED');
  assert.equal(result.evaluation.counts.buildableGaps, 1);
  assert.equal(result.evaluation.requiresRepairReplay, true);
});

test('boundary answers remain SAFE_HOLD even with caller-supplied adjudication-looking data', () => {
  const records = STEPHANOS_INITIAL_QUESTION_CLASSES.map((_, index) => answerRecord(index));
  records[9] = createStephanosWorkspaceAnswerRecord(answer(9, {
    answerText: 'Runtime mutation authority remains outside this participant.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['proof/governing-authority-policy'],
    freshness: 'FRESH',
    sourcesConsulted: ['programme-authority'],
    cannotAnswerReason: 'Authority remains reserved to governing policy.',
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
  }), answerOptions()).record;

  const result = evaluateStephanosWorkspaceConversation({
    round: round(),
    answerRecords: records,
    workspaceValidationOptions: { nowMs: answeredAtMs },
    boundaryAdjudications: [{ answerId: 'answer-10', status: 'CURRENT' }],
    authoritativeEvidenceRefs: ['proof/governing-authority-policy'],
    authoritativeSourceRefs: ['programme-authority'],
  });
  assert.equal(result.valid, true);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.equal(result.evaluation.requiresBoundaryAdjudication, true);
  assert.equal(result.evaluation.mayAdvanceToNovelRound, false);
});

test('unknown record fields and authority aliases fail closed', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(4), questionOptions());
  const tampered = { ...built.record, executeAllowed: false };
  const decoded = decodeStephanosWorkspaceQuestionRecord(tampered, {
    workspaceValidationOptions: { nowMs: createdAtMs },
  });
  assert.equal(decoded.valid, false);
  assert.match(decoded.errors.join('\n'), /record-shape-mismatch/);
});

test('unknown body fields including command aliases fail closed', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(5), questionOptions());
  const parsed = JSON.parse(built.record.body);
  parsed.commandExecutionAllowed = false;
  const decoded = decodeStephanosWorkspaceQuestionRecord({ ...built.record, body: JSON.stringify(parsed) }, {
    workspaceValidationOptions: { nowMs: createdAtMs },
  });
  assert.equal(decoded.valid, false);
  assert.match(decoded.errors.join('\n'), /conversation-body-shape-mismatch/);
});

test('source, command, approval, merge and deployment authority cannot be widened', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(6), questionOptions());
  for (const field of ['sourceMutationAllowed', 'commandExecutionAllowed', 'approvalAllowed', 'mergeAllowed', 'deploymentAllowed']) {
    const tampered = { ...built.record, [field]: true };
    const decoded = decodeStephanosWorkspaceQuestionRecord(tampered, {
      workspaceValidationOptions: { nowMs: createdAtMs },
    });
    assert.equal(decoded.valid, false, `${field} must fail closed`);
    assert.match(decoded.errors.join('\n'), new RegExp(`${field}-must-remain-false`));
  }
});

test('record accessors and accessor-bearing proof arrays fail closed without executing getters', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(7), questionOptions());
  let bodyCalls = 0;
  const hostileRecord = { ...built.record };
  Object.defineProperty(hostileRecord, 'body', {
    enumerable: true,
    get() {
      bodyCalls += 1;
      throw new Error('must not execute');
    },
  });
  let decoded;
  assert.doesNotThrow(() => {
    decoded = decodeStephanosWorkspaceQuestionRecord(hostileRecord, {
      workspaceValidationOptions: { nowMs: createdAtMs },
    });
  });
  assert.equal(decoded.valid, false);
  assert.equal(bodyCalls, 0);

  let proofCalls = 0;
  const proofRefs = ['proof/question-message'];
  Object.defineProperty(proofRefs, '0', {
    enumerable: true,
    get() {
      proofCalls += 1;
      throw new Error('must not execute');
    },
  });
  const hostileProof = { ...built.record, proofRefs };
  assert.doesNotThrow(() => decodeStephanosWorkspaceQuestionRecord(hostileProof, {
    workspaceValidationOptions: { nowMs: createdAtMs },
  }));
  assert.equal(proofCalls, 0);
});

test('corrupt conversation bodies and malformed questions fail closed', () => {
  const built = createStephanosWorkspaceQuestionRecord(question(8), questionOptions());
  const corrupt = { ...built.record, body: '{not-json' };
  const decoded = decodeStephanosWorkspaceQuestionRecord(corrupt, {
    workspaceValidationOptions: { nowMs: createdAtMs },
  });
  assert.equal(decoded.valid, false);
  assert.match(decoded.errors.join('\n'), /conversation-body-invalid-json/);

  const malformed = { ...question(8), unexpectedAuthority: 'EXECUTE' };
  const rejected = createStephanosWorkspaceQuestionRecord(malformed, questionOptions());
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join('\n'), /unknown-field:unexpectedAuthority/);
});
