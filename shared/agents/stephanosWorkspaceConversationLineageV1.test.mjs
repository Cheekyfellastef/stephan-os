import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveStephanosWorkspaceConversationLineage,
} from './stephanosWorkspaceConversationLineageV1.mjs';

function workspaceRecord(correlationId = 'ambient-gap-owner-routing-1721-002') {
  return { correlationId };
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
