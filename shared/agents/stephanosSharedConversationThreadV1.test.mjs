import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS,
  buildStephanosSharedConversationThread,
  createStephanosSharedConversationTurnRecord,
  decodeStephanosSharedConversationTurnRecord,
} from './stephanosSharedConversationThreadV1.mjs';

const baseMs = Date.parse('2026-09-25T17:40:00.000Z');

function turn(turnId, senderParticipantId, text, offsetMs, replyToTurnId = '') {
  return {
    threadId: 'shared-chat-001',
    turnId,
    senderParticipantId,
    text,
    replyToTurnId,
    timestampUtc: new Date(baseMs + offsetMs).toISOString(),
  };
}

function build(input, nowMs = baseMs + 10_000) {
  return createStephanosSharedConversationTurnRecord(input, {
    relatedIssue: '#1290',
    proofRefs: ['proof/shared-chat-thread'],
    workspaceValidationOptions: { nowMs },
  });
}

test('operator, ChatGPT and Stephanos share one durable thread projection', () => {
  const operator = build(turn('turn-001', 'operator', 'Can both of you help me shape this goal?', 0));
  const chatgpt = build(turn('turn-002', 'chatgpt-bridge', 'Yes. I will reason with the same shared thread.', 1000, 'turn-001'));
  const stephanos = build(turn('turn-003', 'stephanos', 'I will preserve the project context and durable mission state.', 2000, 'turn-001'));

  for (const result of [operator, chatgpt, stephanos]) {
    assert.equal(result.valid, true, result.errors.join(', '));
  }

  const projection = buildStephanosSharedConversationThread(
    [stephanos.record, operator.record, chatgpt.record],
    {
      threadId: 'shared-chat-001',
      workspaceValidationOptions: { nowMs: baseMs + 10_000 },
    },
  );

  assert.equal(projection.valid, true, projection.errors.join(', '));
  assert.equal(projection.classification, 'SHARED_CONVERSATION_THREAD_READY');
  assert.deepEqual(projection.thread.participantIds, STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS);
  assert.equal(projection.thread.turnCount, 3);
  assert.deepEqual(
    projection.thread.transcript.map((item) => item.senderParticipantId),
    ['operator', 'chatgpt-bridge', 'stephanos'],
  );
  assert.equal(projection.thread.participantState.operator.turnCount, 1);
  assert.equal(projection.thread.participantState['chatgpt-bridge'].turnCount, 1);
  assert.equal(projection.thread.participantState.stephanos.turnCount, 1);
  assert.equal(projection.authority.commandExecutionAllowed, false);
});

test('turns round-trip with exact sender, thread and turn lineage', () => {
  const built = build(turn('turn-010', 'operator', 'Teach both of you this project decision.', 0));
  assert.equal(built.valid, true, built.errors.join(', '));
  const decoded = decodeStephanosSharedConversationTurnRecord(built.record, {
    workspaceValidationOptions: { nowMs: baseMs + 10_000 },
  });
  assert.equal(decoded.valid, true, decoded.errors.join(', '));
  assert.equal(decoded.turn.threadId, 'shared-chat-001');
  assert.equal(decoded.turn.turnId, 'turn-010');
  assert.equal(decoded.turn.senderParticipantId, 'operator');
  assert.deepEqual(decoded.turn.visibleToParticipantIds, STEPHANOS_SHARED_CONVERSATION_PARTICIPANTS);
});

test('unknown participants cannot enter the three-party V1 thread', () => {
  const result = build(turn('turn-020', 'random-agent', 'I should not silently join.', 0));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /senderParticipantId-not-allowed/);
});

test('caller proof is required for every durable turn', () => {
  const result = createStephanosSharedConversationTurnRecord(
    turn('turn-021', 'operator', 'This lacks durable provenance.', 0),
    {
      relatedIssue: '#1290',
      workspaceValidationOptions: { nowMs: baseMs + 10_000 },
    },
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /proofRefs-required-from-caller/);
});

test('authority widening and unknown record fields fail closed', () => {
  const built = build(turn('turn-030', 'chatgpt-bridge', 'Bounded advice only.', 0));
  assert.equal(built.valid, true);

  const widened = { ...built.record, commandExecutionAllowed: true };
  const widenedDecoded = decodeStephanosSharedConversationTurnRecord(widened, {
    workspaceValidationOptions: { nowMs: baseMs + 10_000 },
  });
  assert.equal(widenedDecoded.valid, false);
  assert.match(widenedDecoded.errors.join('\n'), /commandExecutionAllowed-must-remain-false/);

  const extraField = { ...built.record, arbitraryCommand: false };
  const extraDecoded = decodeStephanosSharedConversationTurnRecord(extraField, {
    workspaceValidationOptions: { nowMs: baseMs + 10_000 },
  });
  assert.equal(extraDecoded.valid, false);
  assert.match(extraDecoded.errors.join('\n'), /record-shape-mismatch/);
});

test('secret-shaped and oversized text is rejected before publication', () => {
  const secret = build(turn('turn-040', 'operator', 'api_key=super-secret-value', 0));
  assert.equal(secret.valid, false);
  assert.match(secret.errors.join('\n'), /turn-text-secret-shaped/);

  const oversized = build(turn('turn-041', 'operator', 'x'.repeat(6001), 0));
  assert.equal(oversized.valid, false);
  assert.match(oversized.errors.join('\n'), /turn-text-too-large/);
});

test('reply lineage must point to an earlier turn in the same thread', () => {
  const first = build(turn('turn-050', 'operator', 'First turn.', 0));
  const badReply = build(turn('turn-051', 'stephanos', 'Replying to a missing turn.', 1000, 'turn-999'));
  const projection = buildStephanosSharedConversationThread(
    [first.record, badReply.record],
    {
      threadId: 'shared-chat-001',
      workspaceValidationOptions: { nowMs: baseMs + 10_000 },
    },
  );
  assert.equal(projection.valid, false);
  assert.match(projection.errors.join('\n'), /reply-target-not-earlier:turn-051:turn-999/);
});

test('mixed threads and duplicate turn identities fail closed', () => {
  const first = build(turn('turn-060', 'operator', 'Thread one.', 0));
  const other = build({
    ...turn('turn-061', 'chatgpt-bridge', 'Thread two.', 1000),
    threadId: 'shared-chat-002',
  });
  const mixed = buildStephanosSharedConversationThread(
    [first.record, other.record],
    { workspaceValidationOptions: { nowMs: baseMs + 10_000 } },
  );
  assert.equal(mixed.valid, false);
  assert.match(mixed.errors.join('\n'), /mixed-thread-lineage/);

  const duplicate = buildStephanosSharedConversationThread(
    [first.record, first.record],
    {
      threadId: 'shared-chat-001',
      workspaceValidationOptions: { nowMs: baseMs + 10_000 },
    },
  );
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join('\n'), /duplicate-turnId/);
});

test('stale and future turns cannot masquerade as current conversation', () => {
  const current = build(turn('turn-070', 'operator', 'Current turn.', 0));
  assert.equal(current.valid, true);

  const stale = decodeStephanosSharedConversationTurnRecord(current.record, {
    workspaceValidationOptions: { nowMs: baseMs + 2 * 60 * 60 * 1000 },
  });
  assert.equal(stale.valid, false);
  assert.match(stale.errors.join('\n'), /workspace:stale-record/);

  const future = decodeStephanosSharedConversationTurnRecord(current.record, {
    workspaceValidationOptions: { nowMs: baseMs - 1 },
  });
  assert.equal(future.valid, false);
  assert.match(future.errors.join('\n'), /workspace:future-record/);
});

test('accessor-bearing records fail without executing getters', () => {
  const built = build(turn('turn-080', 'stephanos', 'Safe turn.', 0));
  let calls = 0;
  const hostile = { ...built.record };
  Object.defineProperty(hostile, 'body', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('must not execute');
    },
  });

  let decoded;
  assert.doesNotThrow(() => {
    decoded = decodeStephanosSharedConversationTurnRecord(hostile, {
      workspaceValidationOptions: { nowMs: baseMs + 10_000 },
    });
  });
  assert.equal(decoded.valid, false);
  assert.equal(calls, 0);
});
