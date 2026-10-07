import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureElasticGoalMissions,
  planElasticGoalMissionAdmissions,
} from './elasticGoalMissionAdmissionService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';

function goal(issue, resourceIds, overrides = {}) {
  return {
    issue,
    title: `Goal ${issue}`,
    lifecycle: 'READY',
    route: 'CHATGPT_GITHUB',
    resourceIds,
    ...overrides,
  };
}

function scheduler(goals, overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-scheduler.v1',
    readOnly: true,
    failClosed: false,
    activeGoals: [],
    elasticCapacity: {
      status: 'RUNNING',
      desiredWidth: 5,
      remainingAdmissionSlots: 5,
    },
    parallelCandidateDetails: goals.map((item) => ({
      candidateId: `#${item.issue}`,
      issue: item.issue,
      route: item.route,
      resourceIds: item.resourceIds,
    })),
    portfolio: goals,
    ...overrides,
  };
}

test('plans five scheduler-selected resource-disjoint goal missions without widening authority', () => {
  const goals = Array.from({ length: 5 }, (_, index) => goal(index + 1, [
    `repo:cheekyfellastef/stephan-os:path:shared/agents/goal-${index + 1}.mjs`,
  ]));
  const result = planElasticGoalMissionAdmissions(scheduler(goals), [], {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
  });
  assert.equal(result.ok, true);
  assert.equal(result.admitted.length, 5);
  assert.equal(result.held.length, 0);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.deepEqual(
    result.admitted.map(({ missionId }) => missionId),
    ['critical-1-elastic-goal', 'critical-2-elastic-goal', 'critical-3-elastic-goal', 'critical-4-elastic-goal', 'critical-5-elastic-goal'],
  );
  assert.deepEqual(result.admitted[0].missionInput.allowedFiles, [
    'shared/agents/goal-1.mjs',
    'shared/agents/goal-1.mjs/**',
  ]);
  assert.equal(result.admitted[0].missionInput.branch, 'openclaw/elastic-goal-1');
  assert.match(result.admitted[0].missionInput.worktreePath.replace(/\\/g, '/'), /stephan-os-worktrees\/critical-1-elastic-goal$/);
});

test('holds unscoped scheduler work rather than inventing a broad mutation scope', () => {
  const result = planElasticGoalMissionAdmissions(scheduler([goal(7, [])]), []);
  assert.equal(result.ok, true);
  assert.equal(result.admitted.length, 0);
  assert.deepEqual(result.held.map(({ reason }) => reason), ['RESOURCE_SCOPE_REQUIRED']);
});

test('admits scheduler-proven repository-wide scope as one conservative mission scope', () => {
  const goals = [goal(8, ['repo:cheekyfellastef/stephan-os'], { repository: REPOSITORY })];
  const result = planElasticGoalMissionAdmissions(scheduler(goals), [], {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
  });
  assert.equal(result.ok, true);
  assert.equal(result.admitted.length, 1);
  assert.equal(result.admitted[0].missionInput.repository, REPOSITORY);
  assert.deepEqual(result.admitted[0].missionInput.allowedFiles, ['**']);
  assert.deepEqual(result.admitted[0].resourceIds, ['repo:cheekyfellastef/stephan-os']);
});

test('reuses an existing goal mission instead of creating a duplicate', () => {
  const goals = [goal(11, ['repo:cheekyfellastef/stephan-os:path:shared/agents/eleven.mjs'])];
  const existing = {
    missionId: 'critical-11-elastic-goal',
    currentPhase: 'CREATE_WORKTREE',
    dispatch: { status: 'pending' },
  };
  const result = planElasticGoalMissionAdmissions(scheduler(goals), [existing]);
  assert.equal(result.admitted.length, 1);
  assert.equal(result.admitted[0].existing, true);
  assert.equal(result.admitted[0].mission, existing);
});

test('refills from the ready portfolio when the scheduler-selected mission is terminal', () => {
  const repoScope = ['repo:cheekyfellastef/stephan-os'];
  const selected = goal(1290, repoScope, { repository: REPOSITORY });
  const next = goal(1291, repoScope, { repository: REPOSITORY });
  const input = scheduler([selected, next], {
    elasticCapacity: {
      status: 'RUNNING',
      desiredWidth: 2,
      remainingAdmissionSlots: 2,
    },
    parallelCandidateDetails: [{
      candidateId: '#1290',
      issue: 1290,
      route: selected.route,
      resourceIds: selected.resourceIds,
    }],
  });
  const terminal = {
    missionId: 'critical-1290-elastic-goal',
    currentPhase: 'CANCELLED',
    dispatch: { status: 'running' },
  };
  const result = planElasticGoalMissionAdmissions(input, [terminal]);

  assert.equal(result.ok, true);
  assert.equal(result.compatibilityEnrichmentUsed, true);
  assert.deepEqual(result.admitted.map(({ issueNumber }) => issueNumber), [1291]);
  assert.equal(result.held.some(({ issueNumber, reason }) => (
    issueNumber === 1290
    && reason === 'EXISTING_GOAL_MISSION_TERMINAL_AWAITING_GOAL_RECONCILIATION'
  )), true);
});

test('refills every admission slot left by terminal projected candidates', () => {
  const first = goal(1290, ['repo:cheekyfellastef/stephan-os:path:shared/agents/one.mjs'], { repository: REPOSITORY });
  const second = goal(1291, ['repo:cheekyfellastef/stephan-os:path:shared/agents/two.mjs'], { repository: REPOSITORY });
  const third = goal(1371, ['repo:cheekyfellastef/stephan-os:path:apps/three/index.html'], { repository: REPOSITORY });
  const input = scheduler([first, second, third], {
    elasticCapacity: {
      status: 'RUNNING',
      desiredWidth: 2,
      remainingAdmissionSlots: 2,
    },
    parallelCandidateDetails: [
      {
        candidateId: '#1290',
        issue: 1290,
        route: first.route,
        resourceIds: first.resourceIds,
      },
      {
        candidateId: '#1291',
        issue: 1291,
        route: second.route,
        resourceIds: second.resourceIds,
      },
    ],
  });
  const terminal = {
    missionId: 'critical-1290-elastic-goal',
    currentPhase: 'CANCELLED',
    dispatch: { status: 'running' },
  };
  const result = planElasticGoalMissionAdmissions(input, [terminal]);

  assert.equal(result.ok, true);
  assert.equal(result.compatibilityEnrichmentUsed, true);
  assert.deepEqual(result.admitted.map(({ issueNumber }) => issueNumber), [1291, 1371]);
});

test('refills scheduler capacity when a projected elastic mission is blocked and sidelined', () => {
  const blockedGoal = goal(1290, ['repo:cheekyfellastef/stephan-os:path:shared/agents/blocked.mjs'], { repository: REPOSITORY });
  const nextGoal = goal(1291, ['repo:cheekyfellastef/stephan-os:path:shared/agents/next.mjs'], { repository: REPOSITORY });
  const input = scheduler([blockedGoal, nextGoal], {
    elasticCapacity: {
      status: 'RUNNING',
      desiredWidth: 1,
      remainingAdmissionSlots: 1,
    },
    parallelCandidateDetails: [{
      candidateId: '#1290',
      issue: 1290,
      route: blockedGoal.route,
      resourceIds: blockedGoal.resourceIds,
    }],
  });
  const blocked = {
    missionId: 'critical-1290-elastic-goal',
    currentPhase: 'BLOCKED',
    dispatch: { status: 'failed' },
  };
  const result = planElasticGoalMissionAdmissions(input, [blocked]);

  assert.equal(result.ok, true);
  assert.equal(result.compatibilityEnrichmentUsed, true);
  assert.deepEqual(result.admitted.map(({ issueNumber }) => issueNumber), [1291]);
  assert.equal(result.held.some(({ issueNumber, reason }) => (
    issueNumber === 1290
    && reason === 'EXISTING_GOAL_MISSION_BLOCKED_SIDELINED'
  )), true);
});

test('blocked elastic missions remain visible but do not occupy active or selected build capacity', async () => {
  const blockedGoal = goal(61, ['repo:cheekyfellastef/stephan-os:path:shared/agents/blocked-61.mjs']);
  const nextGoal = goal(62, ['repo:cheekyfellastef/stephan-os:path:shared/agents/next-62.mjs']);
  const records = [{
    missionId: 'critical-61-elastic-goal',
    currentPhase: 'BLOCKED',
    dispatch: { status: 'failed' },
  }];
  const result = await ensureElasticGoalMissions({
    scheduler: scheduler([blockedGoal, nextGoal], {
      elasticCapacity: {
        status: 'RUNNING',
        desiredWidth: 1,
        remainingAdmissionSlots: 1,
      },
      parallelCandidateDetails: [{
        candidateId: '#61',
        issue: 61,
        route: blockedGoal.route,
        resourceIds: blockedGoal.resourceIds,
      }],
    }),
  }, {
    testOnly: true,
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    orchestratorRoot: 'C:\\orchestrator',
    snapshotRoot: 'C:\\snapshots',
    dependencies: {
      listMissionRecords: async () => [...records],
      createMissionRecord: async (input) => {
        const state = {
          ...input,
          revision: 0,
          currentPhase: 'CREATE_WORKTREE',
          dispatch: { status: 'pending' },
          git: { branch: input.branch, worktreePath: input.worktreePath },
        };
        records.push(state);
        return { state };
      },
    },
  });

  assert.equal(result.createdMissionCount, 1);
  assert.deepEqual(result.activeMissions.map(({ missionId }) => missionId), ['critical-62-elastic-goal']);
  assert.equal(result.selectedMission.missionId, 'critical-62-elastic-goal');
  assert.equal(result.elasticMissions.some(({ missionId }) => missionId === 'critical-61-elastic-goal'), true);
  assert.equal(result.held.some(({ issueNumber, reason }) => (
    issueNumber === 61
    && reason === 'EXISTING_GOAL_MISSION_BLOCKED_SIDELINED'
  )), true);
});

test('preserves declared repository casing when resource scope names the same repository case-insensitively', () => {
  const goals = [goal(19, ['repo:cheekyfellastef/stephan-os:path:shared/agents/nineteen.mjs'], {
    repository: REPOSITORY,
  })];
  const result = planElasticGoalMissionAdmissions(scheduler(goals), [], {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
  });
  assert.equal(result.ok, true);
  assert.equal(result.admitted.length, 1);
  assert.equal(result.admitted[0].missionInput.repository, REPOSITORY);
});

test('preserves case-sensitive mutation paths from the canonical goal record while conflict identity stays normalized', () => {
  const issue = 20;
  const schedulerScope = ['repo:cheekyfellastef/stephan-os:path:shared/agents/platformstatusproofflow.mjs'];
  const result = planElasticGoalMissionAdmissions(scheduler([
    goal(issue, schedulerScope, { repository: REPOSITORY }),
  ]), [], {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    goalRecords: [{
      goalId: `goal-${issue}`,
      issueNumber: issue,
      repository: REPOSITORY,
      resourceIds: ['repo:cheekyfellastef/stephan-os:path:shared/agents/platformStatusProofFlow.mjs'],
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.admitted.length, 1);
  assert.deepEqual(result.admitted[0].resourceIds, schedulerScope);
  assert.deepEqual(result.admitted[0].missionInput.allowedFiles, [
    'shared/agents/platformStatusProofFlow.mjs',
    'shared/agents/platformStatusProofFlow.mjs/**',
  ]);
});

test('rehydrates scheduler resource scope from the same durable goal record when the compatibility projection omitted it', () => {
  const issue = 17;
  const projected = goal(issue, []);
  const compatibilityScheduler = scheduler([projected], {
    parallelCandidateDetails: [],
  });
  const result = planElasticGoalMissionAdmissions(compatibilityScheduler, [], {
    goalRecords: [{
      schemaVersion: 'shared-agent-workspace-record.v1',
      kind: 'stephanos.shared_workspace.goal',
      goalId: `goal-${issue}`,
      issueNumber: issue,
      repository: REPOSITORY,
      resourceIds: ['repo:cheekyfellastef/stephan-os:path:shared/agents/seventeen.mjs'],
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.compatibilityEnrichmentUsed, true);
  assert.equal(result.admitted.length, 1);
  assert.deepEqual(result.admitted[0].resourceIds, [
    'repo:cheekyfellastef/stephan-os:path:shared/agents/seventeen.mjs',
  ]);
});

test('creates all five admitted missions in one controller admission pass', async () => {
  const goals = Array.from({ length: 5 }, (_, index) => goal(index + 21, [
    `repo:cheekyfellastef/stephan-os:path:shared/agents/elastic-${index + 21}.mjs`,
  ]));
  const records = [];
  const result = await ensureElasticGoalMissions({ scheduler: scheduler(goals) }, {
    testOnly: true,
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    orchestratorRoot: 'C:\\orchestrator',
    snapshotRoot: 'C:\\snapshots',
    dependencies: {
      listMissionRecords: async () => [...records],
      createMissionRecord: async (input) => {
        const state = {
          ...input,
          revision: 0,
          currentPhase: 'CREATE_WORKTREE',
          dispatch: { status: 'pending' },
          git: { branch: input.branch, worktreePath: input.worktreePath },
        };
        records.push(state);
        return { state };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.createdMissionCount, 5);
  assert.equal(result.runnableMissions.length, 5);
  assert.equal(result.activeMissions.length, 5);
  assert.equal(records.length, 5);
  assert.ok(records.every(({ branch }) => branch.startsWith('openclaw/elastic-goal-')));
  assert.ok(records.every(({ worktreePath }) => /stephan-os-worktrees/i.test(worktreePath)));
});

test('already-running elastic handoffs occupy capacity without creating a duplicate legacy slot', async () => {
  const goals = [goal(31, ['repo:cheekyfellastef/stephan-os:path:shared/agents/thirty-one.mjs'])];
  const records = [{
    missionId: 'critical-31-elastic-goal',
    currentPhase: 'AGENT_IMPLEMENTATION',
    dispatch: { status: 'running' },
  }];
  const result = await ensureElasticGoalMissions({ scheduler: scheduler(goals) }, {
    testOnly: true,
    dependencies: {
      listMissionRecords: async () => [...records],
      createMissionRecord: async () => { throw new Error('duplicate create'); },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.createdMissionCount, 0);
  assert.equal(result.runnableMissions.length, 0);
  assert.equal(result.activeMissions.length, 1);
  assert.equal(result.selectedMission.missionId, 'critical-31-elastic-goal');
  assert.equal(result.classification, 'ELASTIC_GOAL_MISSIONS_OCCUPIED');
});


test('operator-contained goal is held before mission creation while unrelated candidates remain admissible', () => {
  const goals = [
    goal(41, ['repo:cheekyfellastef/stephan-os:path:docs/contained.md']),
    goal(42, ['repo:cheekyfellastef/stephan-os:path:docs/unrelated.md']),
  ];
  const result = planElasticGoalMissionAdmissions(scheduler(goals), [], {
    goalRecords: [
      {
        goalId: 'goal-41',
        issueNumber: 41,
        resourceIds: goals[0].resourceIds,
        operatorLaneContainment: { active: true, action: 'STOP' },
      },
      {
        goalId: 'goal-42',
        issueNumber: 42,
        resourceIds: goals[1].resourceIds,
      },
    ],
  });

  assert.deepEqual(result.admitted.map(({ issueNumber }) => issueNumber), [42]);
  assert.deepEqual(result.held.map(({ issueNumber, reason }) => ({ issueNumber, reason })), [
    { issueNumber: 41, reason: 'OPERATOR_LANE_CONTAINED' },
  ]);
});

test('operator containment removes an already-created mission from runnable and selected capacity', async () => {
  const goals = [goal(51, ['repo:cheekyfellastef/stephan-os:path:docs/fifty-one.md'])];
  const records = [{
    missionId: 'critical-51-elastic-goal',
    currentPhase: 'AGENT_IMPLEMENTATION',
    dispatch: { status: 'pending' },
  }];
  const result = await ensureElasticGoalMissions({
    scheduler: scheduler(goals),
    goalRecords: [{
      goalId: 'goal-51',
      issueNumber: 51,
      resourceIds: goals[0].resourceIds,
      operatorLaneContainment: { active: true, action: 'STOP' },
    }],
  }, {
    testOnly: true,
    dependencies: {
      listMissionRecords: async () => [...records],
      createMissionRecord: async () => { throw new Error('contained mission must not create'); },
    },
  });

  assert.equal(result.createdMissionCount, 0);
  assert.equal(result.runnableMissions.length, 0);
  assert.equal(result.activeMissions.length, 0);
  assert.equal(result.selectedMission, null);
  assert.ok(result.held.some(({ issueNumber, reason }) => issueNumber === 51 && reason === 'OPERATOR_LANE_CONTAINED'));
});
