import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { STEPHANOS_AMBIENT_CAPABILITY_QUESTION_SCHEMA_VERSION } from './stephanosAmbientCapabilityQuestionV1.mjs';
import { STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION } from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosAmbientWorkspaceQuestionRecord,
  decodeStephanosAmbientWorkspaceQuestionRecord,
  persistStephanosWorkspaceQuestionRecord,
  readPersistedStephanosWorkspaceQuestionRecord,
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

function formalQuestion(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'round-001',
    questionId: 'formal-q-001',
    askerParticipantId: 'chatgpt',
    targetParticipantId: 'stephanos',
    questionText: 'What product goal should advance next?',
    questionClass: 'CURRENT_PROGRAMME_TRUTH',
    intentFingerprint: 'intent-12345678',
    noveltyRefs: [],
    contextRefs: ['goal:#1290'],
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

function formalRecord() {
  const built = createStephanosAmbientWorkspaceQuestionRecord(question(), options());
  assert.equal(built.valid, true, built.errors.join(', '));
  const payload = formalQuestion();
  return {
    ...built.record,
    messageId: 'qa-formal-001',
    correlationId: payload.roundId,
    subjectId: payload.questionId,
    summary: `Formal question ${payload.questionId} for ${payload.targetParticipantId}`,
    body: JSON.stringify({
      schemaVersion: 'stephanos.shared-workspace-conversation-adapter.v1',
      subtype: 'conversation-question',
      payload,
    }),
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

test('fails closed on accessor-bearing workspace records without executing getters', () => {
  let getterCalls = 0;
  const record = {};
  Object.defineProperty(record, 'channel', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'shared-participant-qa';
    },
  });

  const decoded = decodeStephanosAmbientWorkspaceQuestionRecord(record, options());
  assert.equal(decoded.valid, false);
  assert.deepEqual(decoded.errors, ['record-invalid']);
  assert.equal(getterCalls, 0);
});

test('persists ambient lineage through the canonical Shared Workspace inbox and reads it back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-ambient-workspace-'));
  try {
    const built = createStephanosAmbientWorkspaceQuestionRecord(question(), options());
    assert.equal(built.valid, true, built.errors.join(', '));

    const persisted = await persistStephanosWorkspaceQuestionRecord(root, built.record, options());
    assert.equal(persisted.ok, true, persisted.reason);
    assert.equal(persisted.lineage.ambient, true);
    assert.equal(persisted.lineage.formalRound, false);

    const readback = await readPersistedStephanosWorkspaceQuestionRecord(root, built.record.messageId, options());
    assert.equal(readback.ok, true, readback.reason);
    assert.equal(readback.lineage.ambient, true);
    assert.equal(readback.question.questionId, 'ambient-q-1721-original');
    assert.equal(Object.hasOwn(readback.question, 'roundId'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persists formal round lineage without collapsing it into ambient semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-formal-workspace-'));
  try {
    const record = formalRecord();
    const persisted = await persistStephanosWorkspaceQuestionRecord(root, record, options());
    assert.equal(persisted.ok, true, persisted.reason);
    assert.equal(persisted.lineage.formalRound, true);
    assert.equal(persisted.lineage.ambient, false);
    assert.equal(persisted.lineage.roundId, 'round-001');

    const readback = await readPersistedStephanosWorkspaceQuestionRecord(root, record.messageId, options());
    assert.equal(readback.ok, true, readback.reason);
    assert.equal(readback.lineage.formalRound, true);
    assert.equal(readback.question.roundId, 'round-001');
    assert.equal(readback.record.correlationId, 'round-001');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects mixed formal lineage before persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-mixed-workspace-'));
  try {
    const record = formalRecord();
    const mixed = { ...record, correlationId: 'different-round' };
    const persisted = await persistStephanosWorkspaceQuestionRecord(root, mixed, options());
    assert.equal(persisted.ok, false);
    assert.match(persisted.errors.join(','), /formal-round-correlation-mismatch|roundId/i);
    const readback = await readPersistedStephanosWorkspaceQuestionRecord(root, mixed.messageId, options());
    assert.equal(readback.ok, false);
    assert.equal(readback.reason, 'workspace-question-not-found');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects accessor-bearing records before persistence without executing getters', async () => {
  let getterCalls = 0;
  const record = formalRecord();
  Object.defineProperty(record, 'channel', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return 'shared-participant-qa';
    },
  });
  const root = await mkdtemp(join(tmpdir(), 'stephanos-accessor-workspace-'));
  try {
    const persisted = await persistStephanosWorkspaceQuestionRecord(root, record, options());
    assert.equal(persisted.ok, false);
    assert.equal(persisted.reason, 'record-invalid');
    assert.equal(getterCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
