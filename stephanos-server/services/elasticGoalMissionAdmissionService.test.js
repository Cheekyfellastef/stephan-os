import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureElasticGoalMissions,
  planElasticGoalMissionAdmissions,
} from './elasticGoalMissionAdmissionService.js';

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

function scheduler(goals) {
  return {
    schemaVersion: 'stephanos.mission-scheduler.v1',
    readOnly: true,
    failClosed: false,
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
  };
}

test('plans five scheduler-selected resource-disjoint goal missions without widening authority', () => {
  const goals = Array.from({ length: 5 }, (_, index) => goal(index + 1, [
    `repo:cheekyfellastef/stephan-os:path:shared/agents/goal-${index + 1}.mjs`,
  ]));
  const result = planElasticGoalMissionAdmissions(scheduler(goals), []);
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
});

test('holds unscoped scheduler work rather than inventing a broad mutation scope', () => {
  const result = planElasticGoalMissionAdmissions(scheduler([goal(7, [])]), []);
  assert.equal(result.ok, true);
  assert.equal(result.admitted.length, 0);
  assert.deepEqual(result.held.map(({ reason }) => reason), ['RESOURCE_SCOPE_REQUIRED']);
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

test('creates all five admitted missions in one controller admission pass', async () => {
  const goals = Array.from({ length: 5 }, (_, index) => goal(index + 21, [
    `repo:cheekyfellastef/stephan-os:path:shared/agents/elastic-${index + 21}.mjs`,
  ]));
  const records = [];
  const result = await ensureElasticGoalMissions({ scheduler: scheduler(goals) }, {
    testOnly: true,
    dependencies: {
      listMissionRecords: async () => [...records],
      createMissionRecord: async (input) => {
        const state = {
          ...input,
          revision: 0,
          currentPhase: 'CREATE_WORKTREE',
          dispatch: { status: 'pending' },
          git: { branch: input.branch },
        };
        records.push(state);
        return { state };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.createdMissionCount, 5);
  assert.equal(result.runnableMissions.length, 5);
  assert.equal(records.length, 5);
  assert.ok(records.every(({ branch }) => branch.startsWith('orchestrator/critical-')));
});

test('does not select already-running agent handoffs for another worker tick', async () => {
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
});
