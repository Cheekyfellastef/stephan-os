import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveStephanosWorkspaceConversationLineage,
  validateStephanosWorkspaceQuestionByLineage,
} from './stephanosWorkspaceConversationLineageV1.mjs';
import { STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION } from './stephanosAmbientCapabilityQuestionV1.mjs';

function workspaceRecord(correlationId = 'ambient-gap-owner-routing-1721-002') {
  return { correlationId };
}

function ambientQuestion() {
  return {
    schemaVersion: STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION,
    questionId: 'ambient-question-001',
    askerParticipantId: 'chatgpt',
    targetParticipantId: 'stephanos',
    questionText: 'Which durable owner should receive this capability gap?',
    questionClass: 'goal-routing',
    intentFingerprint: 'intent-ambient-gap-owner-routing-1721-002',
    noveltyRefs: ['issue:#1721'],
    contextRefs: ['goal:#1290'],
    expectedEvidenceClass: 'durable-owner',
    createdAtUtc: '2026-09-14T22:00:00.000Z',
  };
}

test('formal workspace conversation preserves exact round lineage', () => {
  const result = resolveStephanosWorkspaceConversationLineage(
    workspaceRecord('round-001'),
    { roundId: 'round-001' },
  );
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.kind, 'FORMAL_ROUND');
  assert.equal(result.formalRound, true);
  assert.equal(result.ambient, false);
  assert.equal(result.roundId, 'round-001');
  assert.equal(result.correlationId, 'round-001');
});

test('ambient workspace conversation needs durable correlation but no roundId', () => {
  const result = resolveStephanosWorkspaceConversationLineage(
    workspaceRecord(),
    { questionId: 'ambient-question-001' },
  );
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.kind, 'AMBIENT');
  assert.equal(result.ambient, true);
  assert.equal(result.formalRound, false);
  assert.equal(result.roundId, '');
  assert.equal(result.correlationId, 'ambient-gap-owner-routing-1721-002');
});

test('workspace question validation routes ambient lineage through ambient contract', () => {
  const question = ambientQuestion();
  const result = validateStephanosWorkspaceQuestionByLineage(workspaceRecord(), question);
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.lineage.ambient, true);
  assert.equal(result.lineage.roundId, '');
  assert.equal(result.question.questionId, question.questionId);
});

test('workspace question validation rejects mixed lineage before contract selection', () => {
  const question = { ...ambientQuestion(), roundId: 'round-001' };
  const result = validateStephanosWorkspaceQuestionByLineage(workspaceRecord(), question);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /mixed-formal-ambient-lineage/);
});

test('mixed formal and ambient lineage fails closed', () => {
  const result = resolveStephanosWorkspaceConversationLineage(
    workspaceRecord('ambient-correlation-001'),
    { roundId: 'round-001' },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /mixed-formal-ambient-lineage/);
});

test('unsafe workspace correlation fails closed', () => {
  const result = resolveStephanosWorkspaceConversationLineage(
    workspaceRecord('ambient:unsafe'),
    {},
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /correlationId-invalid/);
});

test('accessor-bearing lineage inputs fail closed without executing getters', () => {
  let recordGetterCalls = 0;
  const record = {};
  Object.defineProperty(record, 'correlationId', {
    enumerable: true,
    get() {
      recordGetterCalls += 1;
      throw new Error('must not execute');
    },
  });

  let payloadGetterCalls = 0;
  const payload = {};
  Object.defineProperty(payload, 'roundId', {
    enumerable: true,
    get() {
      payloadGetterCalls += 1;
      throw new Error('must not execute');
    },
  });

  const result = resolveStephanosWorkspaceConversationLineage(record, payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /workspace-conversation-lineage-input-invalid/);
  assert.equal(recordGetterCalls, 0);
  assert.equal(payloadGetterCalls, 0);
});
