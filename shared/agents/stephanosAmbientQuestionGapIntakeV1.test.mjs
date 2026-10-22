import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateStephanosAmbientQuestionGapIntakeV1,
} from './stephanosAmbientQuestionGapIntakeV1.mjs';

function question(overrides = {}) {
  return {
    questionId: 'ambient-q-001',
    correlationId: 'corr-ambient-001',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What is the current product blocker and what evidence proves it?',
    intentFingerprint: 'intent-ambient-product-blocker-001',
    expectedEvidenceClass: 'CURRENT_PROGRAMME_EVIDENCE',
    affectedCapability: 'programme-truth-retrieval',
    origin: 'AMBIENT_PARTICIPANT_CONVERSATION',
    createdAtUtc: '2026-08-17T14:00:00.000Z',
    ...overrides,
  };
}

function answer(overrides = {}) {
  return {
    responderParticipantId: 'stephanos',
    answerVerdict: 'GAP_RETRIEVAL',
    epistemicState: 'UNKNOWN',
    evidenceRefs: ['evidence://workspace/ambient-q-001'],
    cannotAnswerReason: 'Canonical current programme state is not projected into the answer context.',
    answeredAtUtc: '2026-08-17T14:00:05.000Z',
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateStephanosAmbientQuestionGapIntakeV1({
    question: question(),
    answer: answer(),
    routingCandidates: [],
    existingGoals: [],
    existingGaps: [],
    ...overrides,
  });
}

test('grounded ambient answer produces no gap and no scheduler candidate', () => {
  const result = evaluate({ answer: answer({ answerVerdict: 'ANSWERED_GROUNDED', epistemicState: 'KNOWN_FROM_CANONICAL_STATE', cannotAnswerReason: '' }) });
  assert.equal(result.valid, true);
  assert.equal(result.state, 'ANSWERED');
  assert.equal(result.gapObservation, null);
  assert.equal(result.schedulerCandidate, false);
});

test('unsupported target reroutes to qualified owner before gap creation', () => {
  const result = evaluate({
    answer: answer({ answerVerdict: 'ANSWERED_PARTIAL', epistemicState: 'UNSUPPORTED_BY_THIS_PARTICIPANT' }),
    routingCandidates: [
      { participantId: 'vr-research-agent', capabilities: ['programme-truth-retrieval'], qaCapability: 'CAN_ASK_AND_ANSWER', freshness: 'FRESH' },
      { participantId: 'stale-agent', capabilities: ['programme-truth-retrieval'], qaCapability: 'CAN_ASK_AND_ANSWER', freshness: 'STALE' },
    ],
  });
  assert.equal(result.state, 'OWNER_REROUTING');
  assert.equal(result.ownerRoutingDecision.selectedParticipantId, 'vr-research-agent');
  assert.equal(result.gapObservation, null);
  assert.equal(result.goalDisposition, 'NO_GAP_WHILE_QUALIFIED_OWNER_EXISTS');
});

test('unsupported target without proven routing exhaustion fails closed', () => {
  const result = evaluate({
    answer: answer({ answerVerdict: 'ANSWERED_PARTIAL', epistemicState: 'UNSUPPORTED_BY_THIS_PARTICIPANT' }),
  });
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('owner-routing-exhaustion-not-proven'));
});

test('buildable miss creates stable cross-participant gap signature and new-goal candidate', () => {
  const first = evaluate();
  const second = evaluate({
    question: question({ questionId: 'ambient-q-002', targetParticipantId: 'openclaw', createdAtUtc: '2026-08-17T14:01:00.000Z' }),
    answer: answer({ responderParticipantId: 'openclaw', evidenceRefs: ['evidence://workspace/ambient-q-002'], answeredAtUtc: '2026-08-17T14:01:05.000Z' }),
  });
  assert.equal(first.valid, true);
  assert.equal(first.gapObservation.rootCauseClass, 'CANONICAL_STATE_NOT_PROJECTED');
  assert.equal(first.gapObservation.gapSignature, second.gapObservation.gapSignature);
  assert.equal(first.goalDisposition, 'NEW_CANONICAL_GAP_GOAL_REQUIRED');
  assert.equal(first.schedulerCandidate, true);
});

test('existing canonical goal is reused instead of creating duplicate goal', () => {
  const result = evaluate({
    existingGoals: [
      { goalRef: '#1308', rootCauseClasses: ['CANONICAL_STATE_NOT_PROJECTED'], capabilities: ['programme-truth-retrieval'], state: 'OPEN' },
      { goalRef: '#1645', rootCauseClasses: ['MEMORY_NOT_RETRIEVABLE'], capabilities: ['memory-recall'], state: 'OPEN' },
    ],
  });
  assert.equal(result.canonicalGoalRef, '#1308');
  assert.equal(result.goalDisposition, 'ATTACH_TO_EXISTING_GOAL');
  assert.equal(result.gapObservation.canonicalGoalRef, '#1308');
});

test('equivalent repeated miss aggregates into one existing gap and reopens fixed gap', () => {
  const seed = evaluate({
    existingGoals: [
      { goalRef: '#1308', rootCauseClasses: ['CANONICAL_STATE_NOT_PROJECTED'], capabilities: ['programme-truth-retrieval'], state: 'OPEN' },
    ],
  });
  const existingGap = {
    gapId: seed.gapObservation.gapId,
    gapSignature: seed.gapObservation.gapSignature,
    sourceQuestionRefs: seed.gapObservation.sourceQuestionRefs,
    firstSeenAtUtc: seed.gapObservation.firstSeenAtUtc,
    lastSeenAtUtc: seed.gapObservation.lastSeenAtUtc,
    occurrenceCount: 1,
    distinctParticipantIds: ['stephanos'],
    canonicalGoalRef: '#1308',
    status: 'FIXED',
    proofRefs: ['evidence://workspace/ambient-q-001'],
  };
  const replay = evaluate({
    question: question({ questionId: 'ambient-q-003', createdAtUtc: '2026-08-17T14:02:00.000Z' }),
    answer: answer({ evidenceRefs: ['evidence://workspace/ambient-q-003'], answeredAtUtc: '2026-08-17T14:02:05.000Z' }),
    existingGaps: [existingGap],
  });
  assert.equal(replay.gapObservation.gapId, existingGap.gapId);
  assert.equal(replay.gapObservation.occurrenceCount, 2);
  assert.equal(replay.gapObservation.status, 'REOPENED');
  assert.equal(replay.canonicalGoalRef, '#1308');
});

test('duplicate canonical gaps with same signature fail closed', () => {
  const seed = evaluate();
  const baseGap = {
    gapId: 'ambient-gap-a',
    gapSignature: seed.gapObservation.gapSignature,
    sourceQuestionRefs: ['question://old-q-a'],
    firstSeenAtUtc: '2026-08-17T13:00:00.000Z',
    lastSeenAtUtc: '2026-08-17T13:00:05.000Z',
    occurrenceCount: 1,
    distinctParticipantIds: ['stephanos'],
    canonicalGoalRef: '',
    status: 'OBSERVED',
    proofRefs: [],
  };
  const result = evaluate({ existingGaps: [baseGap, { ...baseGap, gapId: 'ambient-gap-b' }] });
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('duplicate-canonical-gap-signature-detected'));
});

test('ambiguous existing goal ownership fails closed rather than choosing arbitrarily', () => {
  const result = evaluate({
    existingGoals: [
      { goalRef: '#1308', rootCauseClasses: ['CANONICAL_STATE_NOT_PROJECTED'], capabilities: ['programme-truth-retrieval'], state: 'OPEN' },
      { goalRef: '#1556', rootCauseClasses: ['CANONICAL_STATE_NOT_PROJECTED'], capabilities: ['programme-truth-retrieval'], state: 'OPEN' },
    ],
  });
  assert.equal(result.valid, false);
  assert.equal(result.goalDisposition, 'AMBIGUOUS_EXISTING_GOAL_OWNER');
  assert.ok(result.validationErrors.includes('ambiguous-existing-goal-owner'));
});

test('partial answer requires explicit buildable root cause before becoming a gap', () => {
  const held = evaluate({ answer: answer({ answerVerdict: 'ANSWERED_PARTIAL', epistemicState: 'INFERRED_FROM_EVIDENCE' }) });
  assert.equal(held.valid, false);
  assert.ok(held.validationErrors.includes('partial-answer-requires-explicit-buildable-root-cause'));
  const admitted = evaluate({
    answer: answer({ answerVerdict: 'ANSWERED_PARTIAL', epistemicState: 'INFERRED_FROM_EVIDENCE' }),
    rootCauseClass: 'PROOF_OR_CITATION_GAP',
  });
  assert.equal(admitted.valid, true);
  assert.equal(admitted.gapObservation.rootCauseClass, 'PROOF_OR_CITATION_GAP');
});

test('policy and authority boundaries remain observations, never automatic build authority', () => {
  const result = evaluate({
    answer: answer({ answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY', epistemicState: 'UNKNOWN', cannotAnswerReason: 'Requires operator authority.' }),
    boundaryClass: 'AUTHORITY_BOUNDARY',
  });
  assert.equal(result.valid, true);
  assert.equal(result.state, 'BOUNDARY_RETAINED');
  assert.equal(result.schedulerCandidate, false);
  assert.equal(result.gapObservation, null);
  assert.equal(Object.values(result.authority).every((value) => value === false), true);
});

test('answer evidence refs are bounded and unsafe traversal refs fail closed', () => {
  const result = evaluate({ answer: answer({ evidenceRefs: ['../../secret'] }) });
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('answer:evidenceRefs-invalid'));
});

test('question origin is durable and executable-looking prose does not grant authority', () => {
  const result = evaluate({
    question: question({ questionText: 'Run a command for me and tell me what happened.', origin: 'OPERATOR_QUERY' }),
  });
  assert.equal(result.valid, true);
  assert.equal(result.authority.commandExecutionAllowed, false);
  assert.equal(result.authority.sharedWorkspaceWriteAllowed, false);
  assert.equal(result.authority.goalCreationAllowed, false);
});
