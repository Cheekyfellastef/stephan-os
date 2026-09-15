import assert from 'node:assert/strict';
import test from 'node:test';

import { STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION } from './stephanosAmbientCapabilityQuestionV1.mjs';
import {
  createStephanosAmbientWorkspaceQuestionRecord,
  decodeStephanosAmbientWorkspaceQuestionRecord,
} from './stephanosAmbientWorkspaceQuestionAdapterV1.mjs';

const createdAtUtc = '2026-09-15T00:30:00.000Z';
const nowMs = Date.parse('2026-09-15T00:31:00.000Z');

function question(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION,
    questionId: 'ambient-q-1721-original',
    askerParticipantId: 'chatgpt',
    targetParticipantId: 'stephanos',
    questionText: 'What product goal should advance next?',
    questionClass: 'CURRENT_PROGRAMME_TRUTH',
    intentFingerprint: 'intent-12345678',
    noveltyRefs: ['question:#1721:original'],
    contextRefs: ['goal:#1290', 'issue:#1721'],
    expectedEvidenceClass: 'CANONICAL_STATE',
    createdAtUtc,
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    correlationId: 'ambient-1721-original',
    relatedIssue: '#1721',
    proofRefs: ['proof/issue-1721', 'proof/goal-1290'],
    workspaceValidationOptions: { nowMs },
    ...overrides,
  };
}

test('creates and decodes first-class ambient workspace question without roundId', () => {
  const built = createStephanosAmbientWorkspaceQuestionRecord(question(), options());
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.equal(built.record.correlationId, 'ambient-1721-original');
  const payload = JSON.parse(built.record.body).payload;
  assert.equal(Object.hasOwn(payload, 'roundId'), false);

  const decoded = decodeStephanosAmbientWorkspaceQuestionRecord(built.record, options());
  assert.equal(decoded.valid, true, decoded.errors.join(', '));
  assert.equal(decoded.question.questionId, 'ambient-q-1721-original');
});

test('rejects ambient payload that attempts to impersonate a formal round', () => {
  const built = createStephanosAmbientWorkspaceQuestionRecord(question({ roundId: 'round-001' }), options());
  assert.equal(built.valid, false);
  assert.ok(built.errors.some((error) => error.startsWith('question:')));
});

test('requires durable ambient correlation from caller', () => {
  const built = createStephanosAmbientWorkspaceQuestionRecord(question(), options({ correlationId: '' }));
  assert.equal(built.valid, false);
  assert.deepEqual(built.errors, ['correlationId-required']);
});

test('preserves zero authority on ambient workspace traffic', () => {
  const built = createStephanosAmbientWorkspaceQuestionRecord(question(), options());
  assert.equal(built.valid, true, built.errors.join(', '));
  for (const field of ['sourceMutationAllowed', 'commandExecutionAllowed', 'approvalAllowed', 'mergeAllowed', 'deploymentAllowed']) {
    assert.equal(built.record[field], false);
  }
});
