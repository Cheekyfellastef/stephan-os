import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTIVE_PHASE,
  buildMissionExecutiveContract,
  captureIdea,
  createClarifyingQuestions,
  createExecutiveSourcePacket,
  createIdeaToSystemPlan,
  createMissionExecutiveSnapshot,
  validateMissionExecutiveSnapshot,
} from './missionExecutiveV1.mjs';

test('contract exposes idea-to-system lifecycle', () => {
  const contract = buildMissionExecutiveContract();
  assert.equal(contract.finalVerdict, 'MISSION_EXECUTIVE_CONTRACT_READY');
  assert.equal(contract.phases.includes('IDEA_CAPTURED'), true);
  assert.equal(contract.phases.includes('SOURCE_SLICE_READY'), true);
});

test('captures operator idea and separates facts from hypotheses', () => {
  const capture = captureIdea({
    idea: 'I am thinking about a mission executive that turns ideas into source systems.',
    knownFacts: ['Project Intelligence V1 is merged.'],
    hypotheses: ['This can reduce manual coordination.'],
  });
  assert.equal(capture.finalVerdict, 'MISSION_EXECUTIVE_IDEA_CAPTURED');
  assert.equal(capture.knownFacts.length, 1);
  assert.equal(capture.hypotheses.length, 1);
});

test('creates clarifying questions for thin ideas', () => {
  const questions = createClarifyingQuestions({ idea: 'new dashboard' });
  assert.equal(questions.phase, EXECUTIVE_PHASE.QUESTIONING);
  assert.equal(questions.questions.length, 3);
});

test('idea-to-system plan creates mission room turn, intelligence answer, and route', () => {
  const plan = createIdeaToSystemPlan({
    idea: 'I am thinking about a system where Stephanos turns an idea into a Codex source slice.',
    knownFacts: ['Shared Workspace Mission Room V2 is merged.'],
    relatedFacts: ['Chat-to-Publish Bridge V1 can create publish packets.'],
    sourceSummary: 'Build a source slice for the idea-to-system pipeline.',
  });
  assert.equal(plan.finalVerdict, 'MISSION_EXECUTIVE_PLAN_READY');
  assert.equal(plan.missionRoomTurn.finalVerdict, 'WORKSPACE_FLYWHEEL_TURN_READY');
  assert.equal(plan.projectIntelligence.finalVerdict, 'PROJECT_INTELLIGENCE_ANSWER_READY');
  assert.equal(plan.route.assignedRole, 'CODEX');
});

test('source packet blocks until source files are provided', () => {
  const sourcePacket = createExecutiveSourcePacket({ idea: 'I am thinking about a mission executive.' });
  assert.equal(sourcePacket.phase, EXECUTIVE_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(sourcePacket.finalVerdict, 'MISSION_EXECUTIVE_SOURCE_PACKET_BLOCKED');
});

test('source packet creates chat-to-publish packet for source work', () => {
  const sourcePacket = createExecutiveSourcePacket({
    goalId: '#1321',
    idea: 'I am thinking about a mission executive.',
    sourceFiles: [
      { path: 'shared/agents/missionExecutiveV1.mjs', content: 'module source' },
      { path: 'shared/agents/missionExecutiveV1.test.mjs', content: 'test source' },
    ],
  });
  assert.equal(sourcePacket.phase, EXECUTIVE_PHASE.SOURCE_SLICE_READY);
  assert.equal(sourcePacket.packet.kind, 'stephanos.chat_to_publish_bridge.packet');
  assert.equal(sourcePacket.packet.exactHeadMergeRequired, true);
  assert.equal(sourcePacket.packet.approvalGated, true);
});

test('snapshot exposes visible executive state and validates', () => {
  const snapshot = createMissionExecutiveSnapshot({
    idea: 'I am thinking about a mission executive that routes ideas into source work.',
    sourceFiles: [{ path: 'shared/agents/missionExecutiveV1.mjs', content: 'module source' }],
    lastActivity: 'executive-slice-created',
  });
  assert.equal(snapshot.finalVerdict, 'MISSION_EXECUTIVE_ACTIVE');
  assert.equal(snapshot.currentWorker, 'CODEX');
  assert.equal(snapshot.currentPhase, EXECUTIVE_PHASE.SOURCE_SLICE_READY);
  assert.equal(validateMissionExecutiveSnapshot(snapshot).valid, true);
});

test('validator blocks incomplete snapshots', () => {
  const result = validateMissionExecutiveSnapshot({
    schemaVersion: 'mission-executive.v1',
    kind: 'stephanos.mission_executive.snapshot',
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-idea-id'), true);
  assert.equal(result.errors.includes('missing-plan'), true);
});
