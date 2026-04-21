import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentMissionModel } from './agentMissionModel.mjs';
import { buildAgentTaskGraph } from './agentTaskGraph.mjs';
import { buildApprovalQueue } from './agentApprovalPolicy.mjs';
import { buildAgentContinuityProjection } from './agentContinuityProjection.mjs';

test('canonical goal and task model normalizes required fields', () => {
  const model = buildAgentMissionModel({
    orchestrationState: {
      goals: [{ id: 'g1', title: 'Goal 1', status: 'ACTIVE' }],
      tasks: [{ id: 't1', parentGoalId: 'g1', title: 'Task 1', requiresApproval: true }],
    },
  });
  assert.equal(model.goals[0].goalId, 'g1');
  assert.equal(model.goals[0].status, 'active');
  assert.equal(model.tasks[0].taskId, 't1');
  assert.equal(model.tasks[0].approvalState, 'pending');
});

test('delegation handoff chain is durable in task graph', () => {
  const model = buildAgentMissionModel({
    orchestrationState: {
      tasks: [{ taskId: 't1', parentGoalId: 'g1', title: 'Task 1' }],
      handoffs: [{ handoffId: 'h1', taskId: 't1', fromAgentId: 'intent-engine', toAgentId: 'execution-agent', state: 'open' }],
    },
  });
  const graph = buildAgentTaskGraph({ missionModel: model });
  assert.equal(graph.handoffChains.length, 1);
  assert.equal(graph.handoffChains[0].fromAgentId, 'intent-engine');
});

test('approval queue preserves denied and expired blockers', () => {
  const model = buildAgentMissionModel({
    orchestrationState: {
      tasks: [
        { taskId: 't1', title: 'Denied', requiresApproval: true, approvalState: 'denied' },
        { taskId: 't2', title: 'Expired', requiresApproval: true, approvalState: 'expired' },
      ],
    },
  });
  const queue = buildApprovalQueue({ missionModel: model, context: { sessionKind: 'local-dev' } });
  assert.equal(queue.some((entry) => entry.taskId === 't1' && entry.approvalState === 'denied'), true);
  assert.equal(queue.some((entry) => entry.taskId === 't2' && entry.approvalState === 'expired'), true);
});

test('continuity projection marks resumable and surface-blocked tasks', () => {
  const model = buildAgentMissionModel({
    orchestrationState: {
      goals: [{ goalId: 'g1', title: 'Goal', status: 'active' }],
      tasks: [
        { taskId: 't1', parentGoalId: 'g1', title: 'Resume task', status: 'ready', executionSessionKinds: ['local-dev'] },
        { taskId: 't2', parentGoalId: 'g1', title: 'Hosted blocked', status: 'ready', executionSessionKinds: ['local-dev'] },
      ],
    },
  });
  const projection = buildAgentContinuityProjection({ missionModel: model, context: { sessionKind: 'hosted-web', surface: 'agents' } });
  assert.equal(projection.blockedQueue.some((entry) => entry.taskId === 't1'), true);
  assert.equal(projection.resumableQueue.length, 0);
});
