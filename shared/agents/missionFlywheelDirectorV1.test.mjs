import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOAL_STATE,
  WORKER_KIND,
  buildMissionFlywheelDirectorContract,
  classifyGoal,
  createDirectorStatusPacket,
  createGoalRecord,
  createSourceSlicePacket,
  selectNextGoal,
  validateDirectorStatusPacket,
} from './missionFlywheelDirectorV1.mjs';

test('contract exposes lifecycle, worker kinds, and completion rule', () => {
  const contract = buildMissionFlywheelDirectorContract();

  assert.equal(contract.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_CONTRACT_READY');
  assert.equal(contract.goalStates.includes('PLANNED'), true);
  assert.equal(contract.goalStates.includes('DONE'), true);
  assert.equal(contract.workerKinds.includes('CODEX'), true);
  assert.equal(contract.completionRule.includes('merged-to-main'), true);
});

test('goal classification never marks done without all completion evidence', () => {
  const partial = classifyGoal({ goalId: '#1316', sourceMerged: true, focusedProofRecorded: true });
  const complete = classifyGoal({ goalId: '#1316', sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true });

  assert.equal(partial.state, GOAL_STATE.PLANNED);
  assert.equal(complete.state, GOAL_STATE.DONE);
  assert.equal(complete.finalVerdict, 'GOAL_DONE');
});

test('goal classification exposes building, proof, approval, and blocked states', () => {
  assert.equal(classifyGoal({ goalId: '#1', activeBranch: 'feature/one' }).state, GOAL_STATE.BUILDING);
  assert.equal(classifyGoal({ goalId: '#2', prNumber: '2' }).state, GOAL_STATE.WAITING_FOR_PROOF);
  assert.equal(classifyGoal({ goalId: '#3', prNumber: '3', focusedProofRecorded: true }).state, GOAL_STATE.WAITING_FOR_OPERATOR_APPROVAL);
  assert.equal(classifyGoal({ goalId: '#4', blocker: 'Run Battle Bridge proof.' }).state, GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
});

test('director selects highest priority unblocked goal after dependencies are done', () => {
  const selected = selectNextGoal({
    goals: [
      { goalId: '#1313', title: 'Shared Workspace V2', priority: 50, dependsOn: ['#1315'] },
      { goalId: '#1315', title: 'Chat to Publish', priority: 60, dependsOn: ['#1316'] },
      { goalId: '#1316', title: 'Mission Flywheel Director', priority: 100 },
      { goalId: '#1314', title: 'Publish Lane', priority: 10, sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true },
    ],
  });

  assert.equal(selected.goalId, '#1316');
});

test('director returns no candidate when every unfinished goal is blocked or dependency-held', () => {
  const selected = selectNextGoal({
    goals: [
      { goalId: '#blocked', priority: 100, blocker: 'Existing owner repair required.' },
      { goalId: '#waiting', priority: 90, dependsOn: ['#missing'] },
    ],
  });

  assert.equal(selected, null);
});

test('status packet reports held unfinished work instead of false done or false build', () => {
  const status = createDirectorStatusPacket({
    goals: [
      { goalId: '#blocked', priority: 100, blocker: 'Existing owner repair required.' },
      { goalId: '#waiting', priority: 90, dependsOn: ['#missing'] },
    ],
  });

  assert.equal(status.directorState, GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
  assert.equal(status.nextGoal, null);
  assert.equal(status.nextSourceSlice, null);
});

test('status packet is idle only after every goal is complete', () => {
  const status = createDirectorStatusPacket({
    goals: [
      { goalId: '#done', sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true },
    ],
  });

  assert.equal(status.directorState, GOAL_STATE.DONE);
  assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_IDLE');
  assert.equal(status.nextGoal, null);
});

test('source slice packet preserves approval and exact-head merge rules', () => {
  const packet = createSourceSlicePacket({
    goal: createGoalRecord({ goalId: '#1316', title: 'Mission Flywheel Director', allowedFiles: ['shared/agents/missionFlywheelDirectorV1.mjs'] }),
    proofCommand: 'node --test shared/agents/missionFlywheelDirectorV1.test.mjs',
    worker: WORKER_KIND.CODEX,
  });

  assert.equal(packet.finalVerdict, 'SOURCE_SLICE_PACKET_READY');
  assert.equal(packet.worker, WORKER_KIND.CODEX);
  assert.equal(packet.exactHeadMergeRequired, true);
  assert.equal(packet.approvalGated, true);
  assert.equal(packet.proofCommand, 'node --test shared/agents/missionFlywheelDirectorV1.test.mjs');
  assert.equal(packet.allowedFiles.includes('shared/agents/missionFlywheelDirectorV1.mjs'), true);
});

test('status packet exposes next goal and visible build state', () => {
  const status = createDirectorStatusPacket({
    goals: [
      { goalId: '#1316', title: 'Mission Flywheel Director', priority: 100 },
      { goalId: '#1315', title: 'Chat to Publish', priority: 60, dependsOn: ['#1316'] },
    ],
    slice: {
      proofCommand: 'node --test shared/agents/missionFlywheelDirectorV1.test.mjs',
      allowedFiles: ['shared/agents/missionFlywheelDirectorV1.mjs', 'shared/agents/missionFlywheelDirectorV1.test.mjs'],
    },
  });

  assert.equal(status.directorState, GOAL_STATE.BUILDING);
  assert.equal(status.nextGoal.goalId, '#1316');
  assert.equal(status.nextSourceSlice.exactHeadMergeRequired, true);
  assert.equal(validateDirectorStatusPacket(status).valid, true);
});

test('validator blocks unsafe director packets missing exact merge or proof', () => {
  const status = createDirectorStatusPacket({ goals: [{ goalId: '#1316', title: 'Director' }] });
  status.nextSourceSlice.exactHeadMergeRequired = false;
  status.nextSourceSlice.proofCommand = '';

  const result = validateDirectorStatusPacket(status);

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('exact-head-merge-required'), true);
  assert.equal(result.errors.includes('missing-proof-command'), true);
});

test('explicit nextGoal cannot bypass dependencies, identity, blocked state or completion', () => {
  const cases = [
    {
      label: 'dependency-held child',
      goals: [{ goalId: '#waiting', dependsOn: ['#missing'] }],
      nextGoal: { goalId: '#waiting' },
      expectedVerdict: 'MISSION_FLYWHEEL_DIRECTOR_HELD',
    },
    {
      label: 'unknown canonical identity',
      goals: [{ goalId: '#held', blocker: 'Owner proof missing.' }],
      nextGoal: { goalId: '#absent' },
      expectedVerdict: 'MISSION_FLYWHEEL_DIRECTOR_HELD',
    },
    {
      label: 'completed goal',
      goals: [{ goalId: '#done', sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true }],
      nextGoal: { goalId: '#done' },
      expectedVerdict: 'MISSION_FLYWHEEL_DIRECTOR_IDLE',
    },
    {
      label: 'spoofed unblocked override',
      goals: [{ goalId: '#blocked', blocker: 'Owner proof missing.' }],
      nextGoal: { goalId: '#blocked', title: 'Forged ready status', blocker: '' },
      expectedVerdict: 'MISSION_FLYWHEEL_DIRECTOR_HELD',
    },
  ];

  for (const { label, goals, nextGoal, expectedVerdict } of cases) {
    const status = createDirectorStatusPacket({ goals, nextGoal });
    assert.equal(status.finalVerdict, expectedVerdict, label);
    assert.equal(status.nextGoal, null, label);
    assert.equal(status.nextSourceSlice, null, label);
    assert.equal(validateDirectorStatusPacket(status).valid, true, label);
  }
});

test('explicit eligible nextGoal is resolved from the canonical dependency graph', () => {
  const status = createDirectorStatusPacket({
    goals: [
      { goalId: '#root', sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true },
      { goalId: '#child', title: 'Canonical child', dependsOn: ['#root'], allowedFiles: ['shared/agents/missionFlywheelDirectorV1.mjs'] },
    ],
    nextGoal: { goalId: '#child', title: 'Untrusted override', allowedFiles: ['.env'] },
  });

  assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
  assert.equal(status.nextGoal.goalId, '#child');
  assert.equal(status.nextGoal.title, 'Canonical child');
  assert.deepEqual(status.nextSourceSlice.allowedFiles, ['shared/agents/missionFlywheelDirectorV1.mjs']);
  assert.equal(validateDirectorStatusPacket(status).valid, true);
});

test('caller-supplied slice.goal cannot replace the selected canonical goal', () => {
  const status = createDirectorStatusPacket({
    goals: [{ goalId: '#safe', title: 'Canonical', allowedFiles: ['safe.mjs', 'safe.test.mjs'] }],
    nextGoal: { goalId: '#safe' },
    slice: { goal: { goalId: '#forged', allowedFiles: ['.env'] } },
  });

  assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
  assert.equal(status.nextGoal.goalId, '#safe');
  assert.equal(status.nextSourceSlice.goalId, '#safe');
  assert.deepEqual(status.nextSourceSlice.allowedFiles, ['safe.mjs', 'safe.test.mjs']);
  assert.equal(validateDirectorStatusPacket(status).valid, true);
});

test('slice allowedFiles can narrow but cannot widen the canonical goal estate', () => {
  const goals = [{ goalId: '#safe', allowedFiles: ['safe.mjs', 'safe.test.mjs'] }];
  const cases = [
    { requested: ['.env'], expected: ['safe.mjs', 'safe.test.mjs'] },
    { requested: ['safe.test.mjs'], expected: ['safe.test.mjs'] },
    { requested: ['safe.test.mjs', '.env'], expected: ['safe.test.mjs'] },
  ];

  for (const { requested, expected } of cases) {
    const status = createDirectorStatusPacket({
      goals,
      nextGoal: { goalId: '#safe' },
      slice: { allowedFiles: requested, goal: { goalId: '#forged', allowedFiles: ['.env'] } },
    });
    assert.equal(status.nextSourceSlice.goalId, '#safe');
    assert.deepEqual(status.nextSourceSlice.allowedFiles, expected);
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
});
