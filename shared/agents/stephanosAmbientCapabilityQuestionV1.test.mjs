import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION,
  canonicalStephanosAmbientQuestionIntentFingerprint,
  validateStephanosAmbientCapabilityQuestion,
} from './stephanosAmbientCapabilityQuestionV1.mjs';

function question(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION,
    questionId: 'ambient-q-001',
    askerParticipantId: 'chatgpt',
    targetParticipantId: 'stephanos',
    questionText: 'What is the current protected-main product goal status?',
    questionClass: 'CURRENT_PROGRAMME_TRUTH',
    intentFingerprint: 'intent-12345678',
    noveltyRefs: [],
    contextRefs: ['issue:#1721'],
    expectedEvidenceClass: 'CANONICAL_STATE',
    createdAtUtc: '2026-09-14T20:00:00.000Z',
    ...overrides,
  };
}

test('accepts a first-class ambient question without roundId', () => {
  const candidate = question();
  assert.equal(Object.hasOwn(candidate, 'roundId'), false);
  const validation = validateStephanosAmbientCapabilityQuestion(candidate);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(validation.question.questionId, 'ambient-q-001');
});

test('rejects formal-round identity mixed into an ambient question', () => {
  const validation = validateStephanosAmbientCapabilityQuestion({
    ...question(),
    roundId: 'round-001',
  });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors, ['ambient-question-must-be-exact-data-only-object']);
});

test('fails closed without executing accessor-bearing input', () => {
  let executed = false;
  const candidate = question();
  Object.defineProperty(candidate, 'questionId', {
    enumerable: true,
    get() {
      executed = true;
      return 'ambient-q-accessor';
    },
  });
  const validation = validateStephanosAmbientCapabilityQuestion(candidate);
  assert.equal(validation.valid, false);
  assert.equal(executed, false);
});

test('preserves durable ambient identity and evidence requirements', () => {
  const validation = validateStephanosAmbientCapabilityQuestion(question({
    noveltyRefs: ['question:#1721:original'],
    contextRefs: ['goal:#1290', 'issue:#1721'],
  }), { requireNoveltyRef: true });
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.deepEqual(validation.question.noveltyRefs, ['question:#1721:original']);
  assert.deepEqual(validation.question.contextRefs, ['goal:#1290', 'issue:#1721']);
});

test('computes stable intent fingerprint without round identity', () => {
  const first = canonicalStephanosAmbientQuestionIntentFingerprint(question());
  const second = canonicalStephanosAmbientQuestionIntentFingerprint(question({
    questionId: 'ambient-q-002',
    createdAtUtc: '2026-09-14T20:01:00.000Z',
  }));
  assert.match(first, /^intent-[a-f0-9]{40}$/);
  assert.equal(first, second);
});
