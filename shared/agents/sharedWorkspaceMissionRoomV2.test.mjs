import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSATION_DELIVERY_STATE,
  PARTICIPANT_CONNECTION_STATE,
  PARTICIPANT_ROLE,
  THREAD_KIND,
  WORKSPACE_OBJECT_KIND,
  buildConversationConnectionProjection,
  buildSharedWorkspaceMissionRoomContract,
  createParticipantConnectionReceipt,
  createFlywheelTurn,
  createMissionRoom,
  createMissionThread,
  createParticipant,
  createRoomMessage,
  createWorkspaceObject,
  routeWorkspaceWork,
  validateRoomMessage,
  validateMissionRoom,
} from './sharedWorkspaceMissionRoomV2.mjs';

const HEAD = 'a'.repeat(40);

test('contract exposes roles, objects, and thread kinds', () => {
  const contract = buildSharedWorkspaceMissionRoomContract();

  assert.equal(contract.finalVerdict, 'SHARED_WORKSPACE_MISSION_ROOM_CONTRACT_READY');
  assert.equal(contract.participantRoles.includes('OPERATOR'), true);
  assert.equal(contract.workspaceObjectKinds.includes('PROOF'), true);
  assert.equal(contract.threadKinds.includes('MERGE_DECISION'), true);
  assert.equal(contract.conversationRules.canonicalRecipient, 'stephanos');
  assert.equal(contract.conversationRules.exactReplyCorrelationRequired, true);
  assert.equal(contract.conversationRules.arbitraryExecutionAuthorityAdded, false);
});

test('participants preserve role capabilities and merge approval boundary', () => {
  const operator = createParticipant({ role: PARTICIPANT_ROLE.OPERATOR, canApproveMerge: true });
  const codex = createParticipant({ role: PARTICIPANT_ROLE.CODEX, canApproveMerge: true, canMutateSource: true });

  assert.equal(operator.canApproveMerge, true);
  assert.equal(codex.canApproveMerge, false);
  assert.equal(codex.canMutateSource, true);
});

test('mission room validates participants, objects, threads, messages, and memory hooks', () => {
  const goal = createWorkspaceObject({ objectId: 'goal-1313', kind: WORKSPACE_OBJECT_KIND.GOAL, title: '#1313 Shared Workspace V2', refs: ['#1313'] });
  const thread = createMissionThread({ threadId: 'discussion-1313', kind: THREAD_KIND.DISCUSSION, objectIds: [goal.objectId] });
  const message = createRoomMessage({ messageId: 'msg-1', role: PARTICIPANT_ROLE.STEPHANOS, threadId: thread.threadId, objectIds: [goal.objectId], body: 'Room created.', proven: true });
  const room = createMissionRoom({
    roomId: 'room-1313',
    participants: [createParticipant({ role: PARTICIPANT_ROLE.OPERATOR }), createParticipant({ role: PARTICIPANT_ROLE.STEPHANOS })],
    objects: [goal],
    threads: [thread],
    messages: [message],
    memoryHooks: ['projectIntelligenceV1'],
  });

  assert.equal(room.finalVerdict, 'SHARED_WORKSPACE_MISSION_ROOM_READY');
  assert.equal(room.memoryHooks.includes('projectIntelligenceV1'), true);
  assert.equal(validateMissionRoom(room).valid, true);
});

test('messages distinguish proven facts from hypotheses', () => {
  const proven = createRoomMessage({ body: 'Proof passed.', proven: true });
  const idea = createRoomMessage({ body: 'Maybe use OpenClaw as scout.', proven: false });

  assert.equal(proven.claimType, 'PROVEN_FACT');
  assert.equal(idea.claimType, 'HYPOTHESIS_OR_PROPOSAL');
});

test('conversation messages preserve exact sender, recipient, thread, correlation, reply and source identity', () => {
  const message = createRoomMessage({
    messageId: 'message-1506-1',
    participantId: 'chatgpt',
    role: PARTICIPANT_ROLE.PLANNER,
    recipientParticipantId: 'stephanos',
    requestedEntityId: 'openclaw',
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    correlationId: 'turn-1506-1',
    replyToMessageId: 'message-1506-0',
    createdAtUtc: '2026-08-09T02:00:00.000Z',
    expiresAtUtc: '2026-08-09T02:10:00.000Z',
    deliveryState: CONVERSATION_DELIVERY_STATE.ACCEPTED,
    sourceHead: HEAD,
    proofRefs: ['receipts/message-1506-1'],
    body: 'Ask OpenClaw for its current grounded view.',
  });
  assert.equal(message.senderParticipantId, 'chatgpt');
  assert.equal(message.recipientParticipantId, 'stephanos');
  assert.equal(message.requestedEntityId, 'openclaw');
  assert.equal(message.replyToMessageId, 'message-1506-0');
  assert.equal(message.sourceHead, HEAD);
  assert.equal(validateRoomMessage(message).valid, true);
});

test('conversation validation rejects invalid identity, time, delivery and source fields', () => {
  const message = createRoomMessage({
    messageId: 'message-1506-2',
    participantId: 'chatgpt',
    recipientParticipantId: 'stephanos',
    conversationId: 'conversation-1506',
    threadId: 'thread-1506',
    correlationId: 'turn-1506-2',
  });
  const validation = validateRoomMessage({
    ...message,
    recipientParticipantId: '../openclaw',
    deliveryState: 'MAYBE',
    sourceHead: 'not-a-sha',
    createdAtUtc: '2026-08-09T02:10:00.000Z',
    expiresAtUtc: '2026-08-09T02:00:00.000Z',
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('invalid-recipient-participant-id'));
  assert.ok(validation.errors.includes('invalid-delivery-state'));
  assert.ok(validation.errors.includes('invalid-source-head'));
  assert.ok(validation.errors.includes('expiry-not-after-creation'));
});

test('participant connection is CONNECTED only after a fresh authenticated exact-correlated round trip', () => {
  const receipt = createParticipantConnectionReceipt({
    participantId: 'openclaw',
    conversationAdapterId: 'openclaw-readonly-agent',
    observedAtUtc: '2026-08-09T02:00:00.000Z',
    sourceHead: HEAD,
    receiveProven: true,
    replyProven: true,
    exactCorrelationProven: true,
    authenticatedIdentityProven: true,
    proofRefs: ['receipts/openclaw-conversation-roundtrip'],
  });
  const projection = buildConversationConnectionProjection({
    participants: [{ participantId: 'openclaw', role: PARTICIPANT_ROLE.OPENCLAW, conversationAdapterId: 'openclaw-readonly-agent', canReceiveConversation: true, canReplyConversation: true }],
    receipts: [receipt],
    nowMs: Date.parse('2026-08-09T02:04:00.000Z'),
  });
  assert.equal(projection.allConnected, true);
  assert.equal(projection.connections[0].connection.state, PARTICIPANT_CONNECTION_STATE.CONNECTED);
  assert.equal(projection.connections[0].connection.sourceHead, HEAD);
  assert.equal(projection.connections[0].connection.ageSeconds, 240);
});

test('endpoint presence without an exact reply is DEGRADED and stale evidence is OFFLINE', () => {
  const partial = createParticipantConnectionReceipt({
    participantId: 'codex',
    conversationAdapterId: 'codex-dispatch',
    observedAtUtc: '2026-08-09T02:00:00.000Z',
    sourceHead: HEAD,
    receiveProven: true,
    replyProven: false,
    exactCorrelationProven: false,
    authenticatedIdentityProven: true,
  });
  const degraded = buildConversationConnectionProjection({
    participants: [{ participantId: 'codex', role: PARTICIPANT_ROLE.CODEX }],
    receipts: [partial],
    nowMs: Date.parse('2026-08-09T02:01:00.000Z'),
  });
  assert.equal(degraded.connections[0].connection.state, PARTICIPANT_CONNECTION_STATE.DEGRADED);
  assert.equal(degraded.connections[0].connection.blocker, 'CONVERSATION_ROUND_TRIP_UNPROVEN');

  const stale = buildConversationConnectionProjection({
    participants: [{ participantId: 'codex', role: PARTICIPANT_ROLE.CODEX }],
    receipts: [{ ...partial, replyProven: true, exactCorrelationProven: true }],
    nowMs: Date.parse('2026-08-09T02:06:00.001Z'),
  });
  assert.equal(stale.connections[0].connection.state, PARTICIPANT_CONNECTION_STATE.OFFLINE);
  assert.equal(stale.connections[0].connection.blocker, 'CONVERSATION_CONNECTION_RECEIPT_STALE');
});

test('missing future entity receipts remain explicitly UNPROVEN', () => {
  const projection = buildConversationConnectionProjection({
    participants: [{ participantId: 'future-agent-42', role: PARTICIPANT_ROLE.FUTURE_AGENT, conversationAdapterId: 'future-adapter' }],
    receipts: [],
    nowMs: Date.parse('2026-08-09T02:00:00.000Z'),
  });
  assert.equal(projection.allConnected, false);
  assert.equal(projection.connections[0].connection.state, PARTICIPANT_CONNECTION_STATE.UNPROVEN);
  assert.match(projection.blockers[0], /CONVERSATION_CONNECTION_RECEIPT_MISSING/);
});

test('role routing sends implementation, proof, scout, and decisions to the right role', () => {
  assert.equal(routeWorkspaceWork({ kind: WORKSPACE_OBJECT_KIND.TASK, summary: 'Implement patch' }).assignedRole, PARTICIPANT_ROLE.CODEX);
  assert.equal(routeWorkspaceWork({ kind: WORKSPACE_OBJECT_KIND.PROOF, summary: 'Run proof' }).assignedRole, PARTICIPANT_ROLE.VERIFIER);
  assert.equal(routeWorkspaceWork({ kind: WORKSPACE_OBJECT_KIND.EXPERIMENT, summary: 'Browser proof' }).assignedRole, PARTICIPANT_ROLE.VERIFIER);
  assert.equal(routeWorkspaceWork({ kind: WORKSPACE_OBJECT_KIND.TASK, summary: 'Scout repo state' }).assignedRole, PARTICIPANT_ROLE.OPENCLAW);
  assert.equal(routeWorkspaceWork({ kind: WORKSPACE_OBJECT_KIND.DECISION, summary: 'Approve merge' }).assignedRole, PARTICIPANT_ROLE.OPERATOR);
});

test('flywheel turn creates idea, question, next task, and route', () => {
  const turn = createFlywheelTurn({
    title: 'Bridge crew room',
    idea: 'Let all agents work in one mission room.',
    question: 'What is the smallest useful room contract?',
    nextAction: 'Build the source contract and focused proof.',
  });

  assert.equal(turn.finalVerdict, 'WORKSPACE_FLYWHEEL_TURN_READY');
  assert.equal(turn.objects.length, 3);
  assert.equal(turn.objects[0].kind, WORKSPACE_OBJECT_KIND.IDEA);
  assert.equal(turn.objects[1].relatedObjectIds.includes(turn.objects[0].objectId), true);
  assert.equal(turn.route.assignedRole, PARTICIPANT_ROLE.CODEX);
});

test('validator blocks incomplete rooms', () => {
  const result = validateMissionRoom({
    schemaVersion: 'shared-workspace-mission-room.v2',
    kind: 'stephanos.shared_workspace.mission_room',
    roomId: 'room-empty',
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-participants'), true);
  assert.equal(result.errors.includes('missing-objects'), true);
});
