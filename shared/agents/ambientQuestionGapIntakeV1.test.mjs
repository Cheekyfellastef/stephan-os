import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateAmbientQuestionGapOccurrencesV1, buildAmbientQuestionGapObservationV1 } from './ambientQuestionGapIntakeV1.mjs';

function input(overrides = {}) {
  return {
    questionId: 'q-1',
    roundId: null,
    correlationId: 'corr-1',
    origin: 'AMBIENT_PARTICIPANT_CONVERSATION',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    intentFingerprint: 'intent-12345678',
    expectedEvidenceClass: 'CURRENT_PROGRAMME_EVIDENCE',
    answerVerdict: 'GAP_RETRIEVAL',
    epistemicState: 'UNKNOWN',
    boundaryClass: null,
    rootCauseClass: 'MEMORY_NOT_RETRIEVABLE',
    affectedCapability: 'project memory retrieval',
    affectedParticipants: ['stephanos'],
    evidenceRefs: ['evidence://question/q-1'],
    proofRefs: ['receipt://question/q-1'],
    qualifiedOwnerCandidates: [],
    existingGoalCandidates: ['#1645'],
    observedAtUtc: '2026-08-17T12:00:00.000Z',
    ...overrides,
  };
}

test('maps one buildable ambient miss to one existing canonical goal', () => {
  const result = buildAmbientQuestionGapObservationV1(input());
  assert.equal(result.valid, true);
  assert.equal(result.buildable, true);
  assert.equal(result.canonicalGoalRef, '#1645');
  assert.equal(result.status, 'GAP_DEDUPLICATED');
});

test('stable root-cause signature ignores question wording identity', () => {
  const a = buildAmbientQuestionGapObservationV1(input({ questionId: 'q-a', correlationId: 'corr-a' }));
  const b = buildAmbientQuestionGapObservationV1(input({ questionId: 'q-b', correlationId: 'corr-b' }));
  assert.equal(a.gapSignature, b.gapSignature);
});

test('routes unsupported participant to qualified owner before declaring a gap', () => {
  const result = buildAmbientQuestionGapObservationV1(input({
    answerVerdict: 'ANSWERED_PARTIAL',
    epistemicState: 'UNSUPPORTED_BY_THIS_PARTICIPANT',
    rootCauseClass: null,
    qualifiedOwnerCandidates: ['vr-research-agent'],
    existingGoalCandidates: [],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.routingRequired, true);
  assert.equal(result.buildable, false);
  assert.equal(result.status, 'OWNER_ROUTING_REQUIRED');
});

test('retains authority and safety boundaries without creating repair goals', () => {
  const result = buildAmbientQuestionGapObservationV1(input({
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
    boundaryClass: 'AUTHORITY_BOUNDARY',
    rootCauseClass: null,
    existingGoalCandidates: [],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.status, 'BOUNDARY_RETAINED');
  assert.equal(result.requiresNewCanonicalGoal, false);
  assert.equal(result.buildable, false);
});

test('requires a new canonical goal only when no owner exists', () => {
  const result = buildAmbientQuestionGapObservationV1(input({ existingGoalCandidates: [] }));
  assert.equal(result.valid, true);
  assert.equal(result.status, 'NEW_CANONICAL_GOAL_REQUIRED');
  assert.equal(result.requiresNewCanonicalGoal, true);
});

test('fails closed instead of selecting among multiple goal owners', () => {
  const result = buildAmbientQuestionGapObservationV1(input({ existingGoalCandidates: ['#1645', '#1308'] }));
  assert.equal(result.valid, true);
  assert.equal(result.status, 'SAFE_HOLD_AMBIGUOUS_GOAL_OWNERSHIP');
  assert.equal(result.canonicalGoalRef, '');
});

test('aggregates repeated equivalent misses under one signature', () => {
  const a = buildAmbientQuestionGapObservationV1(input({ questionId: 'q-a', correlationId: 'corr-a', observedAtUtc: '2026-08-17T12:00:00.000Z' }));
  const b = buildAmbientQuestionGapObservationV1(input({ questionId: 'q-b', correlationId: 'corr-b', affectedParticipants: ['stephanos', 'openclaw'], observedAtUtc: '2026-08-17T13:00:00.000Z' }));
  const b2 = buildAmbientQuestionGapObservationV1(input({ questionId: 'q-b', correlationId: 'corr-b', observedAtUtc: '2026-08-17T13:00:00.000Z' }));
  const result = aggregateAmbientQuestionGapOccurrencesV1([a, b2]);
  assert.equal(result.valid, true);
  assert.equal(result.occurrenceCount, 2);
  assert.deepEqual(result.sourceQuestionRefs, ['question://q-a', 'question://q-b']);
  assert.notEqual(a.gapSignature, b.gapSignature);
});

test('rejects unsafe evidence references', () => {
  const result = buildAmbientQuestionGapObservationV1(input({ evidenceRefs: ['evidence://../blocked'] }));
  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /evidenceRefs-contains-invalid-value/);
});

test('grants no goal, scheduler, runtime or authority widening power', () => {
  const result = buildAmbientQuestionGapObservationV1(input());
  assert.equal(result.valid, true);
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('rejects accessor-bearing top-level input without invoking getter', () => {
  let called = 0;
  const malicious = {};
  const baseline = input();
  for (const key of Object.keys(baseline)) Object.defineProperty(malicious, key, { enumerable: true, configurable: true, value: baseline[key] });
  Object.defineProperty(malicious, 'questionId', { enumerable: true, configurable: true, get() { called += 1; return 'q-evil'; } });
  const result = buildAmbientQuestionGapObservationV1(malicious);
  assert.equal(called, 0);
  assert.equal(result.valid, false);
});
