import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CONVERSATION_LINEAGE_KIND,
  isStephanosAmbientLineage,
  isStephanosFormalRoundLineage,
  resolveStephanosConversationLineage,
} from './stephanosConversationLineageV1.mjs';

test('formal round lineage preserves exact round/correlation identity', () => {
  const lineage = resolveStephanosConversationLineage({
    roundId: 'live-chatgpt-to-stephanos-round-001',
    correlationId: 'live-chatgpt-to-stephanos-round-001',
  });

  assert.equal(lineage.valid, true);
  assert.equal(lineage.kind, STEPHANOS_CONVERSATION_LINEAGE_KIND.FORMAL_ROUND);
  assert.equal(isStephanosFormalRoundLineage(lineage), true);
  assert.equal(isStephanosAmbientLineage(lineage), false);
});

test('ambient lineage uses correlation without inventing a formal round', () => {
  const lineage = resolveStephanosConversationLineage({
    correlationId: 'ambient-gap-owner-routing-1721-002',
  });

  assert.equal(lineage.valid, true);
  assert.equal(lineage.kind, STEPHANOS_CONVERSATION_LINEAGE_KIND.AMBIENT);
  assert.equal(lineage.roundId, '');
  assert.equal(lineage.correlationId, 'ambient-gap-owner-routing-1721-002');
  assert.equal(isStephanosAmbientLineage(lineage), true);
  assert.equal(isStephanosFormalRoundLineage(lineage), false);
});

test('mixed formal and ambient identity fails closed', () => {
  const lineage = resolveStephanosConversationLineage({
    roundId: 'formal-round-001',
    correlationId: 'ambient-correlation-001',
  });

  assert.equal(lineage.valid, false);
  assert.deepEqual(lineage.errors, ['mixed-formal-ambient-lineage']);
});

test('ambient lineage requires a durable correlation id', () => {
  const lineage = resolveStephanosConversationLineage({});

  assert.equal(lineage.valid, false);
  assert.deepEqual(lineage.errors, ['correlationId-invalid']);
});

test('unsafe identifiers fail closed', () => {
  const lineage = resolveStephanosConversationLineage({
    correlationId: '../ambient-gap',
  });

  assert.equal(lineage.valid, false);
  assert.deepEqual(lineage.errors, ['correlationId-invalid']);
});
