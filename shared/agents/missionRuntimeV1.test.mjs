import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_PHASE,
  buildMissionRuntimeContract,
  createMissionRuntimeSnapshot,
  deriveRuntimePhase,
  validateMissionRuntimeSnapshot,
} from './missionRuntimeV1.mjs';

test('contract exposes composed stack and Command Deck fields', () => {
  const contract = buildMissionRuntimeContract();
  assert.equal(contract.finalVerdict, 'MISSION_RUNTIME_CONTRACT_READY');
  assert.equal(contract.composedContracts.includes('missionExecutiveV1'), true);
  assert.equal(contract.composedContracts.includes('sharedWorkspaceMissionRoomV2'), true);
  assert.equal(contract.commandDeckFields.includes('currentNextAction'), true);
});

test('runtime blocks requested BUILDING without concrete evidence', () => {
  const snapshot = createMissionRuntimeSnapshot({
    currentGoal: '#1323',
    currentIdea: 'Wire the merged stack together.',
    requestedPhase: RUNTIME_PHASE.BUILDING,
  });
  assert.equal(snapshot.currentPhase, RUNTIME_PHASE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(snapshot.finalVerdict, 'MISSION_RUNTIME_BLOCKED');
  assert.equal(validateMissionRuntimeSnapshot(snapshot).valid, true);
});

test('runtime reports BUILDING with branch and proof evidence', () => {
  const snapshot = createMissionRuntimeSnapshot({
    currentGoal: '#1323',
    currentIdea: 'Wire the merged stack together.',
    branch: 'feature/mission-runtime-v1',
    proofCommand: 'node --test shared/agents/missionRuntimeV1.test.mjs',
    requestedPhase: RUNTIME_PHASE.BUILDING,
  });
  assert.equal(snapshot.currentPhase, RUNTIME_PHASE.BUILDING);
  assert.equal(snapshot.currentWorker, 'CODEX');
  assert.equal(snapshot.commandDeck.currentProof, 'node --test shared/agents/missionRuntimeV1.test.mjs');
  assert.equal(validateMissionRuntimeSnapshot(snapshot).valid, true);
});

test('runtime waits for proof when PR exists but proof is missing', () => {
  const phase = deriveRuntimePhase({ prNumber: '1325' });
  assert.equal(phase, RUNTIME_PHASE.WAITING_FOR_PROOF);
});

test('runtime waits for operator approval when proof passed but merge is missing', () => {
  const phase = deriveRuntimePhase({ prNumber: '1325', focusedProofRecorded: true });
  assert.equal(phase, RUNTIME_PHASE.WAITING_FOR_OPERATOR_APPROVAL);
});

test('runtime DONE requires merge, proof, and mission update', () => {
  const notDone = createMissionRuntimeSnapshot({
    currentGoal: '#1323',
    currentIdea: 'Runtime almost complete.',
    sourceMerged: true,
    focusedProofRecorded: true,
  });
  const done = createMissionRuntimeSnapshot({
    currentGoal: '#1323',
    currentIdea: 'Runtime complete.',
    sourceMerged: true,
    focusedProofRecorded: true,
    missionStateUpdated: true,
  });
  assert.notEqual(notDone.currentPhase, RUNTIME_PHASE.DONE);
  assert.equal(done.currentPhase, RUNTIME_PHASE.DONE);
  assert.equal(validateMissionRuntimeSnapshot(done).valid, true);
});

test('snapshot includes project intelligence and mission room projections', () => {
  const snapshot = createMissionRuntimeSnapshot({
    currentGoal: '#1323',
    currentIdea: 'Expose one live mission state.',
    branch: 'feature/mission-runtime-v1',
    proofCommand: 'node --test shared/agents/missionRuntimeV1.test.mjs',
  });
  assert.equal(snapshot.projectIntelligence.finalVerdict, 'PROJECT_INTELLIGENCE_ANSWER_READY');
  assert.equal(snapshot.missionRoom.finalVerdict, 'SHARED_WORKSPACE_MISSION_ROOM_READY');
  assert.equal(snapshot.commandDeck.currentGoal, '#1323');
});

test('validator catches malformed snapshots', () => {
  const result = validateMissionRuntimeSnapshot({
    schemaVersion: 'mission-runtime.v1',
    kind: 'stephanos.mission_runtime.snapshot',
    currentPhase: RUNTIME_PHASE.BUILDING,
    evidence: {},
    commandDeck: {},
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-current-goal'), true);
  assert.equal(result.errors.includes('building-without-evidence'), true);
});
