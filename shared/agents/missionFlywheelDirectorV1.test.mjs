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

  assert.equal(partial.state, GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
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
      { goalId: '#1316', title: 'Mission Flywheel Director', priority: 100, allowedFiles: ['shared/agents/missionFlywheelDirectorV1.mjs', 'shared/agents/missionFlywheelDirectorV1.test.mjs'] },
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
      { goalId: '#1316', title: 'Mission Flywheel Director', priority: 100, allowedFiles: ['shared/agents/missionFlywheelDirectorV1.mjs', 'shared/agents/missionFlywheelDirectorV1.test.mjs'] },
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
  const status = createDirectorStatusPacket({ goals: [{ goalId: '#1316', title: 'Director', allowedFiles: ['safe.mjs'] }] });
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
    { requested: ['.env'], expected: null },
    { requested: ['safe.test.mjs'], expected: ['safe.test.mjs'] },
    { requested: ['safe.test.mjs', '.env'], expected: null },
  ];

  for (const { requested, expected } of cases) {
    const status = createDirectorStatusPacket({
      goals,
      nextGoal: { goalId: '#safe' },
      slice: { allowedFiles: requested, goal: { goalId: '#forged', allowedFiles: ['.env'] } },
    });
    if (expected === null) {
      assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
      assert.equal(status.nextSourceSlice, null);
    } else {
      assert.equal(status.nextSourceSlice.goalId, '#safe');
      assert.deepEqual(status.nextSourceSlice.allowedFiles, expected);
    }
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
});

test('stage-owned goal remains held, with no fresh duplicate source branch', () => {
  for (const custody of [
    { activeBranch: 'feature/already-owned' },
    { prNumber: '1234' },
    { prNumber: '1234', focusedProofRecorded: true },
    { state: GOAL_STATE.WAITING_FOR_PROOF },
  ]) {
    const status = createDirectorStatusPacket({
      goals: [{ goalId: '#owned', allowedFiles: ['safe.mjs'], priority: 100, ...custody }],
    });
    assert.equal(status.nextSourceSlice, null);
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
  }
});

test('duplicate canonical prerequisite identities cannot green-light a dependent source slice', () => {
  const complete = { goalId: '#root', sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true };
  const blocked = { goalId: '#root', blocker: 'Owner proof outstanding' };
  for (const pair of [[complete, blocked], [blocked, complete]]) {
    const goals = [...pair, { goalId: '#child', dependsOn: ['#root'], allowedFiles: ['safe.mjs'] }];
    assert.equal(selectNextGoal({ goals }), null);
    const status = createDirectorStatusPacket({ goals, nextGoal: { goalId: '#child' } });
    assert.equal(status.nextSourceSlice, null);
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(validateDirectorStatusPacket(status).valid, false);
    assert.ok(validateDirectorStatusPacket(status).errors.includes('ambiguous-canonical-goal-identity'));
  }
});

test('caller slice cannot replace executor, branch, command, goal, title or mandatory forbidden paths', () => {
  const status = createDirectorStatusPacket({
    goals: [{ goalId: '#safe', allowedFiles: ['safe.mjs'], proofCommand: 'node --test safe.test.mjs' }],
    slice: { goal: { goalId: '#rogue' }, worker: 'OPERATOR', branch: 'foreign',
      proofCommand: 'echo foreign', title: 'forged', prTitle: 'forged',
      prBody: 'forged', nextAction: 'foreign', forbiddenFiles: ['extra/**'] },
  });
  const slice = status.nextSourceSlice;
  assert.equal(slice.goalId, '#safe');
  assert.equal(slice.worker, 'STEPHANOS');
  assert.equal(slice.branch, 'feature/safe-slice-v1');
  assert.equal(slice.proofCommand, 'node --test safe.test.mjs');
  assert.equal(slice.forbiddenFiles.includes('.env*'), true);
  assert.equal(slice.forbiddenFiles.includes('extra/**'), true);
  assert.equal(validateDirectorStatusPacket(status).valid, true);
});

test('disjoint and empty caller file scopes deny source publication without widening', () => {
  for (const requested of [[], ['  '], ['.env'], ['secrets.txt']]) {
    const status = createDirectorStatusPacket({
      goals: [{ goalId: '#safe', allowedFiles: ['safe.mjs'] }],
      slice: { allowedFiles: requested },
    });
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextSourceSlice, null);
  }
});

test('validator rejects tampered canonical identity, file authority and source executor fields', () => {
  const fresh = () => createDirectorStatusPacket({ goals: [
    { goalId: '#safe', allowedFiles: ['safe.mjs'], forbiddenFiles: ['protected/**'] }
  ] });
  for (const mutate of [
    (p) => { p.nextSourceSlice.allowedFiles.push('.env'); },
    (p) => { p.nextSourceSlice.forbiddenFiles = []; },
    (p) => { p.nextSourceSlice.goalId = '#foreign'; },
    (p) => { p.nextSourceSlice.branch = 'feature/foreign'; },
    (p) => { p.nextSourceSlice.proofCommand = 'echo foreign'; },
    (p) => { p.nextSourceSlice.worker = 'OPERATOR'; },
    (p) => { p.nextGoal.title = 'forged'; },
    (p) => { p.nextGoal.state = GOAL_STATE.BUILDING; },
  ]) {
    const status = fresh();
    mutate(status);
    assert.equal(validateDirectorStatusPacket(status).valid, false);
  }
});

test('partial DONE or merged custody never dispatches a second source slice', () => {
  for (const goal of [
    { goalId: '#done-no-proof', state: GOAL_STATE.DONE, allowedFiles: ['safe.mjs'] },
    { goalId: '#merged-no-proof', sourceMerged: true, allowedFiles: ['safe.mjs'] },
    { goalId: '#merged-one-proof', sourceMerged: true, focusedProofRecorded: true, allowedFiles: ['safe.mjs'] },
  ]) {
    const status = createDirectorStatusPacket({ goals: [goal] });
    assert.equal(classifyGoal(goal).finalVerdict, 'GOAL_COMPLETION_CUSTODY_UNPROVEN');
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextSourceSlice, null);
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
});

test('existing PR and fully-proven completion retain their dedicated stages', () => {
  const pr = { goalId: '#merged-pr', sourceMerged: true, prNumber: '3258', allowedFiles: ['safe.mjs'] };
  const waiting = createDirectorStatusPacket({ goals: [pr] });
  assert.equal(classifyGoal(pr).state, GOAL_STATE.WAITING_FOR_PROOF);
  assert.equal(waiting.nextSourceSlice, null);
  assert.equal(waiting.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
  const done = { goalId: '#proven-done', state: GOAL_STATE.DONE, sourceMerged: true,
    focusedProofRecorded: true, missionStateUpdated: true, allowedFiles: ['safe.mjs'] };
  const finished = createDirectorStatusPacket({ goals: [done] });
  assert.equal(classifyGoal(done).state, GOAL_STATE.DONE);
  assert.equal(finished.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_IDLE');
  assert.equal(finished.nextSourceSlice, null);
  assert.equal(validateDirectorStatusPacket(finished).valid, true);
});

test('validator refuses caller-forged director state or final verdict on genuine active status', () => {
  const packet = createDirectorStatusPacket({ goals: [
    { goalId: '#501', state: GOAL_STATE.PLANNED, allowedFiles: ['shared/a.mjs'] },
  ] });
  assert.equal(validateDirectorStatusPacket(packet).valid, true);
  for (const [field, value, code] of [
    ['directorState', GOAL_STATE.DONE, 'director-state-not-derived'],
    ['directorState', GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION, 'director-state-not-derived'],
    ['finalVerdict', 'MISSION_FLYWHEEL_DIRECTOR_IDLE', 'final-verdict-not-derived'],
    ['finalVerdict', 'MISSION_FLYWHEEL_DIRECTOR_HELD', 'final-verdict-not-derived'],
  ]) {
    const tampered = { ...packet, [field]: value };
    const result = validateDirectorStatusPacket(tampered);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes(code));
  }
});

test('validator refuses forged active verdict on genuine held and idle packets', () => {
  const held = createDirectorStatusPacket({ goals: [
    { goalId: '#held', blocker: 'Original owner required.', allowedFiles: ['shared/a.mjs'] },
  ] });
  const idle = createDirectorStatusPacket({ goals: [
    { goalId: '#done', state: GOAL_STATE.DONE, sourceMerged: true,
      focusedProofRecorded: true, missionStateUpdated: true },
  ] });
  assert.equal(validateDirectorStatusPacket(held).valid, true);
  assert.equal(validateDirectorStatusPacket(idle).valid, true);
  for (const packet of [held, idle]) {
    for (const [field, value, code] of [
      ['directorState', GOAL_STATE.BUILDING, 'director-state-not-derived'],
      ['finalVerdict', 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE', 'final-verdict-not-derived'],
    ]) {
      const result = validateDirectorStatusPacket({ ...packet, [field]: value });
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes(code));
    }
  }
});

test('validator checks prerequisites remain complete for a published source slice', () => {
  const goal = { goalId: '#child', state: GOAL_STATE.PLANNED, dependsOn: ['#parent'],
    allowedFiles: ['shared/a.mjs'] };
  const completed = { goalId: '#parent', state: GOAL_STATE.DONE,
    sourceMerged: true, focusedProofRecorded: true, missionStateUpdated: true };
  const status = createDirectorStatusPacket({ goals: [completed, goal] });
  assert.equal(validateDirectorStatusPacket(status).valid, true);
  const regressed = { ...status, goals: status.goals.map((g) => g.goalId === '#parent'
    ? { ...g, state: GOAL_STATE.PLANNED, sourceMerged: false,
      focusedProofRecorded: false, missionStateUpdated: false }
    : g) };
  const result = validateDirectorStatusPacket(regressed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('source-slice-dependency-unproven'));
});


test('explicitly invalid lifecycle states never become fresh source authority', () => {
  for (const state of ['CLAIMED', 'WAITING_FOR_REVIEW', 'SOURCE_MUTATION_LEASED', 'UNKNOWN', 14, '', null, true]) {
    const status = createDirectorStatusPacket({ goals: [
      { goalId: '#invalid', state, allowedFiles: ['src/safe.mjs'] },
    ] });
    assert.equal(status.nextSourceSlice, null);
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
  for (const state of [undefined, ' PLANNED ', 'planned']) {
    const status = createDirectorStatusPacket({ goals: [
      { goalId: '#fresh', state, allowedFiles: ['src/safe.mjs'] },
    ] });
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
});

test('mandatory and canonical forbidden scopes deny any overlapping source path', () => {
  for (const allowed of [
    ['runtime/private.mjs'], ['.env.production'], ['node_modules/inject.js'],
    ['shared/mysecret.mjs'], ['src/.env.dev'], ['src/runtime/data.txt'],
    ['Runtime/Foo.cs'], ['src/**'], ['src/../safe.mjs'],
    ['src/safe.mjs', 'runtime/private.mjs'],
  ]) {
    const status = createDirectorStatusPacket({ goals: [{ goalId: '#guard', allowedFiles: allowed }] });
    assert.equal(status.nextSourceSlice, null);
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
  for (const allowed of [['src/safe.mjs'], ['shared/agents/test.mjs']]) {
    const status = createDirectorStatusPacket({ goals: [{ goalId: '#safe', allowedFiles: allowed }] });
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
  const custom = createDirectorStatusPacket({ goals: [{
    goalId: '#custom', allowedFiles: ['src/private/file.mjs'],
    forbiddenFiles: ['src/private/**'],
  }] });
  assert.equal(custom.nextSourceSlice, null);
  assert.equal(validateDirectorStatusPacket(custom).valid, true);
});

test('source packet producer and status validator fail closed on forbidden paths', () => {
  const direct = createSourceSlicePacket({ goal: {
    goalId: '#unsafe', allowedFiles: ['runtime/private.mjs'],
  } });
  assert.deepEqual(direct.allowedFiles, []);
  assert.equal(direct.finalVerdict, 'SOURCE_SLICE_PACKET_HELD');
  const status = createDirectorStatusPacket({ goals: [
    { goalId: '#safe', allowedFiles: ['src/safe.mjs', 'runtime/private.mjs'] },
  ], slice: { allowedFiles: ['src/safe.mjs'] } });
  assert.equal(validateDirectorStatusPacket(status).valid, true);
  const forged = { ...status, nextSourceSlice: {
    ...status.nextSourceSlice, allowedFiles: ['runtime/private.mjs'],
  } };
  const proof = validateDirectorStatusPacket(forged);
  assert.equal(proof.valid, false);
  assert.ok(proof.errors.includes('source-slice-forbidden-path-collision'));
});

test('invalid explicit lifecycle cannot become DONE through three completion flags or a second classification', () => {
  for (const state of ['CLAIMED', 'UNKNOWN', null, 14, 'WAITING_FOR_REVIEW']) {
    const goal = {goalId:'#bad',state,sourceMerged:true,focusedProofRecorded:true,missionStateUpdated:true,allowedFiles:['src/safe.mjs']};
    const first = classifyGoal(goal);
    assert.equal(first.state, GOAL_STATE.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
    assert.equal(first.finalVerdict, 'GOAL_STATE_UNRECOGNIZED');
    assert.deepEqual(classifyGoal(first), first);
    const status = createDirectorStatusPacket({goals:[goal]});
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextSourceSlice,null);
    assert.equal(validateDirectorStatusPacket(status).valid,true);
  }
});

test('direct source packet creation rejects empty, disjoint, wider and stage-owned scopes', () => {
  const goal={goalId:'#s',state:'PLANNED',allowedFiles:['src/safe.mjs','src/test.mjs']};
  for (const allowedFiles of [[],['src/outside.mjs'],['src/safe.mjs','src/outside.mjs']]) {
    const p=createSourceSlicePacket({goal,allowedFiles});
    assert.equal(p.finalVerdict,'SOURCE_SLICE_PACKET_HELD');
    assert.deepEqual(p.allowedFiles,[]);
  }
  const valid=createSourceSlicePacket({goal,allowedFiles:['src/safe.mjs']});
  assert.equal(valid.finalVerdict,'SOURCE_SLICE_PACKET_READY');
  assert.deepEqual(valid.allowedFiles,['src/safe.mjs']);
  for (const owned of [{...goal,state:'DONE'},{...goal,activeBranch:'feature/owned'},{...goal,prNumber:'42'}]) {
    assert.equal(createSourceSlicePacket({goal:owned}).finalVerdict,'SOURCE_SLICE_PACKET_HELD');
  }
});

test('Windows path aliases, devices and invalid components deny director source authority', () => {
  for (const path of [
    'runtime./config.json','runtime /config.json','src/runtime./file.mjs',
    'src/COM1.txt','src/NUL',
    'src/CONIN$','src/CONOUT$','src/conin$.txt','src/conout$.json','src/ConIn$.MJS','src/prn.json','src/lpt9.out',
    'src/COM¹.log','src/aux.MJS','src/RUNTIM~1/config.json',
    'src/safe.mjs.','src/foo<bar>.mjs','src/foo|bar.mjs',
  ]) {
    const status=createDirectorStatusPacket({goals:[{goalId:'#win',allowedFiles:[path]}]});
    assert.equal(status.finalVerdict,'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextSourceSlice,null);
    assert.equal(validateDirectorStatusPacket(status).valid,true);
  }
  for (const path of ['src/safe.mjs','shared/agents/test.mjs','src/feature-v1.2.mjs','src/foo .mjs','src/conin$-log.mjs']) {
    const status=createDirectorStatusPacket({goals:[{goalId:'#normal',allowedFiles:[path]}]});
    assert.equal(status.finalVerdict,'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
    assert.equal(validateDirectorStatusPacket(status).valid,true);
  }
});


test('canonical allowedFiles must preserve exact original path bytes', () => {
  for (const path of [' src/safe.mjs', 'src/safe.mjs ', 'src/safe.mjs\n', 'src/safe.mjs\t', '\tsrc/safe.mjs']) {
    const goal = createGoalRecord({ goalId: '#exact', allowedFiles: [path] });
    assert.deepEqual(goal.allowedFiles, []);
    const status = createDirectorStatusPacket({ goals: [{ goalId: '#exact', allowedFiles: [path] }] });
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextSourceSlice, null);
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
  const mixed = createDirectorStatusPacket({ goals: [
    { goalId: '#mixed', allowedFiles: ['src/safe.mjs',' src/forged.mjs'] },
  ] });
  assert.equal(mixed.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
  assert.equal(validateDirectorStatusPacket(mixed).valid, true);
});
test('direct source slice rejects silently normalized and invalid override paths', () => {
  const goal = { goalId: '#direct', state: 'PLANNED', allowedFiles: ['src/safe.mjs'] };
  for (const allowedFiles of [[' src/safe.mjs'], ['src/safe.mjs '], ['src/safe.mjs', '\nsrc/safe.mjs'], ['src/safe.mjs', null], ['src/safe.mjs', 42]]) {
    const packet = createSourceSlicePacket({ goal, allowedFiles });
    assert.equal(packet.finalVerdict, 'SOURCE_SLICE_PACKET_HELD');
    assert.deepEqual(packet.allowedFiles, []);
  }
  const invalidGoal = createSourceSlicePacket({ goal: {
    goalId: '#bad', allowedFiles: ['src/safe.mjs', 'src/safe.mjs '],
  }, allowedFiles: ['src/safe.mjs'] });
  assert.equal(invalidGoal.finalVerdict, 'SOURCE_SLICE_PACKET_HELD');
  assert.equal(createSourceSlicePacket({ goal, allowedFiles:['src/safe.mjs'] }).finalVerdict, 'SOURCE_SLICE_PACKET_READY');
});
test('director slice hint refuses path normalization but allows internal spaces', () => {
  const goal = { goalId: '#scoped', allowedFiles: ['src/safe.mjs', 'src/with space.mjs'] };
  for (const allowedFiles of [['src/safe.mjs '], ['src/safe.mjs', '\tsrc/with space.mjs'], ['src/safe.mjs', null]]) {
    const status = createDirectorStatusPacket({ goals: [goal], slice: { allowedFiles } });
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextSourceSlice, null);
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
  const allowed = createDirectorStatusPacket({ goals: [goal], slice: { allowedFiles: ['src/with space.mjs'] } });
  assert.equal(allowed.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
  assert.equal(validateDirectorStatusPacket(allowed).valid, true);
});


test('director refuses mixed out-of-scope hints instead of silently narrowing source-build custody', () => {
  const goal = { goalId: '#custody', allowedFiles: ['src/safe.mjs', 'src/test.mjs'] };
  for (const allowedFiles of [
    ['src/safe.mjs', 'src/ungranted.mjs'],
    ['src/ungranted.mjs', 'src/safe.mjs'],
    ['src/safe.mjs', 'src/test.mjs', 'src/ungranted.mjs'],
  ]) {
    const status = createDirectorStatusPacket({ goals: [goal], slice: { allowedFiles } });
    assert.equal(status.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_HELD');
    assert.equal(status.nextGoal, null);
    assert.equal(status.nextSourceSlice, null);
    assert.equal(validateDirectorStatusPacket(status).valid, true);
  }
  const allowed = createDirectorStatusPacket({ goals: [goal], slice: { allowedFiles: ['src/test.mjs'] } });
  assert.equal(allowed.finalVerdict, 'MISSION_FLYWHEEL_DIRECTOR_ACTIVE');
  assert.deepEqual(allowed.nextSourceSlice.allowedFiles, ['src/test.mjs']);
  assert.equal(validateDirectorStatusPacket(allowed).valid, true);
});
