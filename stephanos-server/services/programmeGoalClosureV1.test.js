import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceReceiptRecord,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from '../../shared/agents/programmeAuthorityV1.mjs';
import {
  CANONICAL_GOAL_REPOSITORY,
  planCanonicalGoalClosure,
} from '../../shared/agents/goalClosureConsumerV1.mjs';
import { buildMissionScheduler } from '../../shared/runtime/missionScheduler.mjs';
import {
  applyGoalClosureReceipts,
  closeCanonicalGoalFromProgrammeProjection,
} from './programmeAuthorityService.js';

const NOW = '2026-09-24T16:10:00.000Z';

function completedGoal(overrides = {}) {
  return {
    issue: 4242,
    title: 'Goal: canonical completion retirement test',
    state: 'COMPLETE',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: NOW,
    resultProofRefs: ['proof/result-4242.json'],
    reusableCapabilityId: 'CAPABILITY_GOAL_RETIREMENT_V1',
    sharedLessonId: 'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF',
    ...overrides,
  };
}

function closureProjection() {
  const schedulerInput = {
    now: NOW,
    goals: [completedGoal()],
    correlationId: 'goal-closure-service-test',
  };
  const scheduler = buildMissionScheduler(schedulerInput);
  const goalClosurePlan = planCanonicalGoalClosure({
    repository: CANONICAL_GOAL_REPOSITORY,
    schedulerInput,
  });
  assert.equal(scheduler.failClosed, false);
  assert.equal(goalClosurePlan.state, 'READY');
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    sourceConstructionMode: 'production-contracts',
    chatMemoryAuthoritative: false,
    scheduler,
    goalClosurePlan,
  };
}

function dependencies(overrides = {}) {
  return {
    resolveGithubTokenConfig: async () => ({
      configured: true,
      token: 'test-token-not-a-secret',
      authority: 'test',
    }),
    readGithubGoalIssue: async ({ issueNumber }) => ({
      number: issueNumber,
      state: 'open',
      state_reason: '',
      labels: [{ name: 'goal' }],
      pull_request: null,
      repository: CANONICAL_GOAL_REPOSITORY,
    }),
    closeGithubGoalIssue: async ({ issueNumber }) => ({
      number: issueNumber,
      state: 'closed',
      state_reason: 'completed',
      labels: [{ name: 'goal' }],
      repository: CANONICAL_GOAL_REPOSITORY,
    }),
    ...overrides,
  };
}

test('authoritative programme projection closes one exact canonical CLOSE_READY goal', async () => {
  const calls = [];
  const result = await closeCanonicalGoalFromProgrammeProjection(closureProjection(), {
    testOnly: true,
    dependencies: dependencies({
      closeGithubGoalIssue: async ({ issueNumber }) => {
        calls.push(issueNumber);
        return {
          number: issueNumber,
          state: 'closed',
          state_reason: 'completed',
          labels: [{ name: 'goal' }],
          repository: CANONICAL_GOAL_REPOSITORY,
        };
      },
    }),
  });

  assert.deepEqual(calls, [4242]);
  assert.equal(result.state, 'CLOSED_COMPLETED');
  assert.equal(result.issueNumber, 4242);
  assert.equal(result.repository, CANONICAL_GOAL_REPOSITORY);
  assert.equal(result.stateReason, 'completed');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('forged closure packet that disagrees with canonical scheduler is rejected before GitHub mutation', async () => {
  const projection = closureProjection();
  let reads = 0;
  let closes = 0;
  const forged = {
    ...projection,
    goalClosurePlan: {
      ...projection.goalClosurePlan,
      request: {
        ...projection.goalClosurePlan.request,
        sharedLessonId: 'FORGED_LESSON',
      },
    },
  };
  const result = await closeCanonicalGoalFromProgrammeProjection(forged, {
    testOnly: true,
    dependencies: dependencies({
      readGithubGoalIssue: async () => { reads += 1; return {}; },
      closeGithubGoalIssue: async () => { closes += 1; return {}; },
    }),
  });

  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.reason, 'CANONICAL_GOAL_CLOSURE_PLAN_SCHEDULER_MISMATCH');
  assert.equal(reads, 0);
  assert.equal(closes, 0);
});

function closureReceipt(overrides = {}) {
  return {
    ...createSharedWorkspaceReceiptRecord({
      receiptId: 'durable-flywheel-closure-test',
      participantId: 'durable-flywheel-controller',
      timestampUtc: NOW,
      correlationId: 'goal-4242-closure',
      relatedIssue: '#4242',
      receivedRecordId: 'programme-projection-test',
      disposition: 'active',
      summary: 'CLOSE_CANONICAL_GOAL: canonical goal retired.',
      proofRefs: ['receipts/durable-flywheel-closure-test.json'],
    }),
    schema: 'stephanos.durable-flywheel-cycle-receipt.vnext',
    controllerId: 'durable-flywheel-controller',
    goalClosureState: 'CLOSED_COMPLETED',
    goalClosureRepository: CANONICAL_GOAL_REPOSITORY,
    goalClosureIssueNumber: 4242,
    mergeAuthority: false,
    ...overrides,
  };
}

test('verified durable closure receipt overlays matching workspace goal as CLOSED without erasing history', () => {
  const original = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: SHARED_WORKSPACE_RECORD_KINDS.GOAL,
    goalId: 'goal-4242',
    participantId: 'programme-authority',
    timestampUtc: '2026-09-24T16:00:00.000Z',
    issueNumber: 4242,
    title: 'Goal: preserve this title',
    state: 'COMPLETE',
    status: 'COMPLETE',
    resultProofRefs: ['proof/result-4242.json'],
    reusableCapabilityId: 'CAPABILITY_GOAL_RETIREMENT_V1',
    sharedLessonId: 'LESSON_CLOSE_ONLY_AFTER_CANONICAL_PROOF',
  };
  const unrelated = { ...original, goalId: 'goal-4243', issueNumber: 4243, title: 'Goal: unrelated' };

  const result = applyGoalClosureReceipts([original, unrelated], [closureReceipt()]);

  assert.equal(result[0].state, 'CLOSED');
  assert.equal(result[0].status, 'CLOSED');
  assert.equal(result[0].title, original.title);
  assert.deepEqual(result[0].resultProofRefs, original.resultProofRefs);
  assert.equal(result[0].goalClosureReceiptId, 'durable-flywheel-closure-test');
  assert.equal(result[0].goalClosureState, 'CLOSED_COMPLETED');
  assert.equal(result[1].state, 'COMPLETE');
});

test('forged, wrong-repository, or non-controller closure receipts cannot retire a goal', () => {
  const goal = {
    goalId: 'goal-4242',
    issueNumber: 4242,
    state: 'COMPLETE',
    status: 'COMPLETE',
  };
  const candidates = [
    closureReceipt({ goalClosureRepository: 'other/repo' }),
    closureReceipt({ participantId: 'other-controller' }),
    closureReceipt({ controllerId: 'other-controller' }),
    closureReceipt({ mergeAuthority: true }),
  ];

  for (const receipt of candidates) {
    const [result] = applyGoalClosureReceipts([goal], [receipt]);
    assert.equal(result.state, 'COMPLETE');
    assert.equal(result.status, 'COMPLETE');
  }
});
