import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStephanosSharedConversationTurnRecord,
} from './stephanosSharedConversationThreadV1.mjs';
import {
  STEPHANOS_SHARED_THREAD_CANVAS_PROJECTION_SCHEMA_VERSION,
  buildStephanosSharedThreadConversationCanvasV1,
} from './stephanosSharedThreadConversationCanvasV1.mjs';

const baseMs = Date.parse('2026-09-25T22:20:00.000Z');
const nowMs = baseMs + 10_000;

function turn(turnId, senderParticipantId, body, offsetMs, replyToTurnId = '') {
  const built = createStephanosSharedConversationTurnRecord({
    threadId: 'shared-intelligence-thread-001',
    turnId,
    senderParticipantId,
    replyToTurnId,
    text: body,
    timestampUtc: new Date(baseMs + offsetMs).toISOString(),
  }, {
    relatedIssue: '#2434',
    proofRefs: [`proof/shared-thread/${turnId}`],
    workspaceValidationOptions: { nowMs },
  });
  assert.equal(built.valid, true, built.errors.join(', '));
  return built.record;
}

test('operator, ChatGPT and Stephanos project into one existing Conversation Canvas view', () => {
  const result = buildStephanosSharedThreadConversationCanvasV1({
    threadId: 'shared-intelligence-thread-001',
    surface: 'desktop-browser',
    turnRecords: [
      turn('turn-001', 'operator', 'Can both of you see this shared thread?', 0),
      turn('turn-002', 'chatgpt-bridge', 'Yes. I am using the canonical shared thread.', 1000, 'turn-001'),
      turn('turn-003', 'stephanos', 'I can consume the same durable lineage.', 2000, 'turn-001'),
    ],
  }, { nowMs });

  assert.equal(result.schemaVersion, STEPHANOS_SHARED_THREAD_CANVAS_PROJECTION_SCHEMA_VERSION);
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.classification, 'SHARED_THREAD_CANVAS_PROJECTION_READY');
  assert.equal(result.thread.turnCount, 3);

  const view = result.conversationCanvasView;
  assert.equal(view.schemaVersion, 'stephanos.ui-agent.conversation-canvas-presenter.v1');
  assert.equal(view.valid, true);
  assert.equal(view.state, 'READY');
  assert.equal(view.surface, 'desktop-browser');
  assert.equal(view.layoutProfile.layout, 'TWO_COLUMN_WITH_DETAIL_RAIL');
  assert.equal(view.sections[0].kind, 'PROVIDER_AGENT_CONTRIBUTION');
  assert.deepEqual(
    view.sections[0].items.map((item) => item.contributorId),
    ['operator', 'chatgpt-bridge', 'stephanos'],
  );
  assert.equal(view.summary.text, 'I can consume the same durable lineage.');
  assert.equal(view.authority.presenterMayExecuteActions, false);
});

test('iPad and iPhone reuse the existing responsive Canvas surface profiles', () => {
  const records = [
    turn('turn-010', 'operator', 'Phone continuity test.', 0),
    turn('turn-011', 'stephanos', 'Continuity preserved.', 1000, 'turn-010'),
  ];

  const ipad = buildStephanosSharedThreadConversationCanvasV1({
    threadId: 'shared-intelligence-thread-001',
    surface: 'ipad',
    prefersReducedMotion: true,
    turnRecords: records,
  }, { nowMs });
  assert.equal(ipad.valid, true);
  assert.equal(ipad.conversationCanvasView.layoutProfile.layout, 'TOUCH_STACK_WITH_DETAIL_DRAWER');
  assert.equal(ipad.conversationCanvasView.accessibility.touchTargetsLarge, true);
  assert.equal(ipad.conversationCanvasView.accessibility.animationAllowed, false);

  const iphone = buildStephanosSharedThreadConversationCanvasV1({
    threadId: 'shared-intelligence-thread-001',
    surface: 'iphone',
    turnRecords: records,
  }, { nowMs });
  assert.equal(iphone.valid, true);
  assert.equal(iphone.conversationCanvasView.layoutProfile.layout, 'SINGLE_COLUMN_PROGRESSIVE');
  assert.equal(iphone.conversationCanvasView.progressiveDisclosure.phoneUsesSingleColumn, true);
});

test('broken reply lineage remains blocked instead of being prettified by the Canvas', () => {
  const first = turn('turn-020', 'operator', 'First.', 0);
  const bad = turn('turn-021', 'stephanos', 'Bad lineage.', 1000, 'turn-999');

  const result = buildStephanosSharedThreadConversationCanvasV1({
    threadId: 'shared-intelligence-thread-001',
    surface: 'desktop-browser',
    turnRecords: [first, bad],
  }, { nowMs });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /reply-target-not-earlier/);
  assert.equal(result.conversationCanvasView, null);
});

test('mixed thread identities remain blocked', () => {
  const first = turn('turn-030', 'operator', 'Thread one.', 0);
  const other = createStephanosSharedConversationTurnRecord({
    threadId: 'other-thread-002',
    turnId: 'turn-031',
    senderParticipantId: 'chatgpt-bridge',
    replyToTurnId: '',
    text: 'Other thread.',
    timestampUtc: new Date(baseMs + 1000).toISOString(),
  }, {
    relatedIssue: '#2434',
    proofRefs: ['proof/shared-thread/turn-031'],
    workspaceValidationOptions: { nowMs },
  });
  assert.equal(other.valid, true);

  const result = buildStephanosSharedThreadConversationCanvasV1({
    surface: 'desktop-browser',
    turnRecords: [first, other.record],
  }, { nowMs });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /mixed-thread-lineage/);
});


test('secret-shaped Canvas status text fails closed', () => {
  const result = buildStephanosSharedThreadConversationCanvasV1({
    threadId: 'shared-intelligence-thread-001',
    surface: 'desktop-browser',
    statusMessage: 'api_key=leaked-value',
    turnRecords: [
      turn('turn-040', 'operator', 'Safe conversation content.', 0),
      turn('turn-041', 'stephanos', 'Safe reply.', 1000, 'turn-040'),
    ],
  }, { nowMs });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /status-message-unsafe/);
  assert.equal(result.conversationCanvasView, null);
});

test('long shared threads are explicitly windowed to the renderer 64-item contract', () => {
  const records = [];
  for (let index = 0; index < 70; index += 1) {
    const id = `turn-long-${String(index).padStart(3, '0')}`;
    const previous = index === 0 ? '' : `turn-long-${String(index - 1).padStart(3, '0')}`;
    records.push(turn(id, index % 3 === 0 ? 'operator' : index % 3 === 1 ? 'chatgpt-bridge' : 'stephanos', `Turn ${index}`, index * 100, previous));
  }

  const result = buildStephanosSharedThreadConversationCanvasV1({
    threadId: 'shared-intelligence-thread-001',
    surface: 'desktop-browser',
    turnRecords: records,
  }, { nowMs: baseMs + 20_000 });

  assert.equal(result.valid, true, result.errors.join(', '));
  const section = result.conversationCanvasView.sections[0];
  assert.equal(section.itemCount, 64);
  assert.equal(section.items.length, 64);
  assert.match(section.summary, /Showing latest 64 of 70/);
  assert.equal(section.items[0].turnId, 'turn-long-006');
  assert.equal(section.items.at(-1).turnId, 'turn-long-069');
});
