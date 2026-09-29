import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTICIPANT_ROLE,
  THREAD_KIND,
  WORKSPACE_OBJECT_KIND,
  buildSharedWorkspaceMissionRoomContract,
  createFlywheelTurn,
  createMissionRoom,
  createMissionThread,
  createParticipant,
  createRoomMessage,
  createWorkspaceObject,
  routeWorkspaceWork,
  validateMissionRoom,
} from './sharedWorkspaceMissionRoomV2.mjs';

test('contract exposes roles, objects, and thread kinds', () => {
  const contract = buildSharedWorkspaceMissionRoomContract();

  assert.equal(contract.finalVerdict, 'SHARED_WORKSPACE_MISSION_ROOM_CONTRACT_READY');
  assert.equal(contract.participantRoles.includes('OPERATOR'), true);
  assert.equal(contract.workspaceObjectKinds.includes('PROOF'), true);
  assert.equal(contract.threadKinds.includes('MERGE_DECISION'), true);
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
