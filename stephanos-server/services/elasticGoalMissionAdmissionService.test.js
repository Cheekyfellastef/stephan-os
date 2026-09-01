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
