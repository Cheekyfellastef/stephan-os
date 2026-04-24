import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentRegistry } from './agentRegistry.mjs';
import { adjudicateAgents } from './agentAdjudicator.mjs';
import { buildFinalAgentView } from './finalAgentView.mjs';
import { buildAgentSurfaceProjection, resolveAgentSurfaceMode } from './agentSurfaceProjection.mjs';

function buildBaseContext() {
  return {
    sessionKind: 'local-dev',
    surface: 'mission-control',
    dependencyReadyMap: {
      'runtime-truth': true,
      'provider-routing': true,
      'shared-memory': true,
      'operator-policy': true,
      'intent-engine': true,
      'memory-agent': true,
    },
  };
}

function buildV3OrchestrationState() {
  const now = new Date().toISOString();
  return {
    goals: [
      {
        goalId: 'goal-bridge-stability',
        title: 'Stabilize bridge runtime truth',
        status: 'active',
        initiatingAgentId: 'intent-engine',
        linkedMemoryRefs: ['mem:bridge-incident'],
        linkedTaskIds: ['task-diagnose', 'task-execute'],
      },
    ],
    tasks: [
      {
        taskId: 'task-diagnose',
        parentGoalId: 'goal-bridge-stability',
        title: 'Collect diagnostics',
        assignedAgentId: 'research-agent',
        requestedByAgentId: 'intent-engine',
        status: 'ready',
        continuityRefs: ['continuity:bridge'],
        executionSessionKinds: ['hosted-web', 'local-dev'],
        executionSurfaceKinds: ['mission-control', 'agents'],
      },
      {
        taskId: 'task-execute',
        parentGoalId: 'goal-bridge-stability',
        title: 'Apply runtime patch',
        assignedAgentId: 'execution-agent',
        requestedByAgentId: 'intent-engine',
        status: 'blocked',
        requiresApproval: true,
        approvalState: 'pending',
        blockers: ['Awaiting operator approval'],
        continuityRefs: ['continuity:bridge'],
        executionSessionKinds: ['local-dev'],
        executionSurfaceKinds: ['mission-control'],
      },
    ],
    handoffs: [
      {
        handoffId: 'handoff-1',
        taskId: 'task-execute',
        goalId: 'goal-bridge-stability',
        fromAgentId: 'intent-engine',
        toAgentId: 'execution-agent',
        reason: 'intent-engine delegated execution task',
        createdAt: now,
      },
    ],
    approvalRequests: [
      {
        approvalRequestId: 'approval-1',
        taskId: 'task-execute',
        goalId: 'goal-bridge-stability',
        requestedByAgentId: 'execution-agent',
        classification: 'approval-required-action',
        state: 'pending',
        reason: 'Applying runtime patch changes meaningful execution behavior.',
      },
    ],
    resumeTokens: [
      {
        resumeTokenId: 'resume-1',
        goalId: 'goal-bridge-stability',
        taskId: 'task-execute',
        ownerAgentId: 'execution-agent',
        bestSurface: 'mission-control',
        status: 'resumable',
      },
    ],
  };
}

test('adjudicator separates enabled, eligible, active, and acting', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    context: buildBaseContext(),
    operatorControls: {
      autonomyMasterToggle: true,
      safeMode: false,
      globalAutonomy: 'assisted',
      agentEnabledMap: { 'research-agent': false },
    },
    eventLog: [{ agentId: 'intent-engine', type: 'state', state: 'acting', reason: 'active test', at: new Date().toISOString() }],
  });
  const intent = adjudicated.agents.find((entry) => entry.agentId === 'intent-engine');
  const research = adjudicated.agents.find((entry) => entry.agentId === 'research-agent');
  assert.equal(intent.eligible, true);
  assert.equal(intent.active, true);
  assert.equal(intent.acting, true);
  assert.equal(research.enabled, false);
  assert.equal(research.active, false);
  assert.equal(research.state, 'blocked');
});

test('surface and session eligibility suppresses agents with reason strings', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    context: { ...buildBaseContext(), surface: 'cockpit', sessionKind: 'hosted-web' },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });
  const execution = adjudicated.agents.find((entry) => entry.agentId === 'execution-agent');
  assert.equal(execution.eligible, false);
  assert.equal(execution.state, 'blocked');
  assert.match(execution.stateReason, /Surface cockpit is not allowed|Session kind hosted-web is not allowed/);
});

test('dependency, safe mode, and autonomy master toggles produce explicit suppression', () => {
  const registry = buildAgentRegistry([{ agentId: 'ideas-agent', autonomyLevel: 'guarded-auto' }]);
  const adjudicated = adjudicateAgents({
    registry,
    context: {
      ...buildBaseContext(),
      dependencyReadyMap: { ...buildBaseContext().dependencyReadyMap, 'shared-memory': false },
    },
    operatorControls: {
      autonomyMasterToggle: false,
      safeMode: true,
      globalAutonomy: 'full-auto',
      agentEnabledMap: {},
    },
    eventLog: [],
  });
  const ideas = adjudicated.agents.find((entry) => entry.agentId === 'ideas-agent');
  assert.equal(ideas.active, false);
  assert.ok(ideas.blockers.some((entry) => entry.includes('safe mode') || entry.includes('Global autonomy is manual')));
  assert.ok(ideas.blockers.some((entry) => entry.includes('Autonomy master toggle is off')));
});

test('final projection yields handoff chain and suppression visibility', () => {
  const registry = buildAgentRegistry();
  const now = new Date().toISOString();
  const adjudicated = adjudicateAgents({
    registry,
    context: buildBaseContext(),
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: { 'research-agent': false } },
    eventLog: [
      { agentId: 'intent-engine', type: 'state', state: 'acting', reason: 'routing', at: now },
      { agentId: 'intent-engine', type: 'handoff', fromAgentId: 'intent-engine', toAgentId: 'research-agent', reason: 'intent-engine → research-agent', at: now },
    ],
  });
  const view = buildFinalAgentView({ adjudicated });
  assert.equal(view.actingAgentId, 'intent-engine');
  assert.ok(view.visibleHandoffChain[0].includes('intent-engine'));
  assert.ok(view.suppressionReasons.some((entry) => entry.includes('Research Agent')));
});

test('agents surface mode remains runtime projection consumer with launcher-safe summary', () => {
  const registry = buildAgentRegistry();
  const now = new Date().toISOString();
  const adjudicated = adjudicateAgents({
    registry,
    context: { ...buildBaseContext(), surface: 'agents' },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [
      { agentId: 'intent-engine', type: 'state', state: 'acting', reason: 'routing', at: now },
      { agentId: 'intent-engine', type: 'handoff', fromAgentId: 'intent-engine', toAgentId: 'execution-agent', reason: 'intent-engine → execution-agent', at: now },
    ],
  });
  const finalAgentView = buildFinalAgentView({ adjudicated });
  const projection = buildAgentSurfaceProjection({ finalAgentView, surfaceMode: resolveAgentSurfaceMode('agents') });
  assert.equal(resolveAgentSurfaceMode('agents'), 'agents');
  assert.equal(resolveAgentSurfaceMode('cockpit'), 'cockpit');
  assert.equal(resolveAgentSurfaceMode('mission-console'), 'mission-console');
  assert.equal(resolveAgentSurfaceMode('unknown'), 'mission-control');
  assert.equal(projection.surfaceMode, 'agents');
  assert.equal(projection.launcherSummary.status, 'acting');
  assert.ok(projection.launcherSummary.handoffCount >= 1);
});

test('v3 orchestration persists goals tasks approvals and resumable continuity', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    orchestrationState: buildV3OrchestrationState(),
    context: buildBaseContext(),
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });

  assert.equal(adjudicated.missionModel.schemaVersion, 'agent-layer.v3.persistent-orchestration');
  assert.equal(adjudicated.missionModel.goals.length, 1);
  assert.equal(adjudicated.missionModel.tasks.length, 2);
  assert.equal(adjudicated.approvalQueue.some((entry) => entry.taskId === 'task-execute' && entry.approvalState === 'pending'), true);
  assert.equal(adjudicated.continuityProjection.resumableQueue.length >= 1, true);

  const view = buildFinalAgentView({ adjudicated });
  assert.equal(view.finalMissionOrchestrationView.activeGoals.length, 1);
  assert.equal(view.finalApprovalQueueView.pendingCount, 1);
  assert.equal(view.finalResumeView.resumableQueue.length >= 1, true);
});

test('surface-aware blocking marks local-only execution tasks as blocked on hosted-web', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    orchestrationState: buildV3OrchestrationState(),
    context: { ...buildBaseContext(), sessionKind: 'hosted-web', surface: 'agents' },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });

  const blockedResume = adjudicated.continuityProjection.blockedQueue.find((entry) => entry.taskId === 'task-execute');
  assert.ok(blockedResume);
  assert.match(blockedResume.blockedReason, /Session hosted-web cannot execute this task/);
});

test('memory agent is active when shared backend memory capability is canonical', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    context: {
      ...buildBaseContext(),
      memoryCapability: {
        state: 'backend',
        ready: true,
        canonical: true,
        reason: 'Shared backend durable memory is hydrated and ready.',
      },
    },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });
  const memoryAgent = adjudicated.agents.find((entry) => entry.agentId === 'memory-agent');
  assert.equal(memoryAgent.active, true);
  assert.equal(memoryAgent.ready, true);
  assert.equal(memoryAgent.state, 'watching');
});

test('memory agent remains degraded and watching with local mirror fallback instead of hard block', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    context: {
      ...buildBaseContext(),
      memoryCapability: {
        state: 'degraded-local',
        ready: true,
        canonical: false,
        reason: 'Shared backend memory is unavailable; degraded local mirror remains available.',
      },
    },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });
  const memoryAgent = adjudicated.agents.find((entry) => entry.agentId === 'memory-agent');
  assert.equal(memoryAgent.active, true);
  assert.equal(memoryAgent.state, 'degraded');
  assert.equal(memoryAgent.stateReason.includes('degraded local mirror'), true);
});

test('memory agent is preparing while memory capability is hydrating', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    context: {
      ...buildBaseContext(),
      dependencyReadyMap: { ...buildBaseContext().dependencyReadyMap, 'shared-memory': false },
      memoryCapability: {
        state: 'hydrating',
        ready: false,
        canonical: false,
        reason: 'Shared memory hydration is still in progress; capability is preparing.',
      },
    },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });
  const memoryAgent = adjudicated.agents.find((entry) => entry.agentId === 'memory-agent');
  assert.equal(memoryAgent.active, false);
  assert.equal(memoryAgent.state, 'preparing');
  assert.match(memoryAgent.stateReason, /hydration/i);
});

test('memory agent is blocked with explicit reason when memory capability is unavailable', () => {
  const registry = buildAgentRegistry();
  const adjudicated = adjudicateAgents({
    registry,
    context: {
      ...buildBaseContext(),
      dependencyReadyMap: { ...buildBaseContext().dependencyReadyMap, 'shared-memory': false },
      memoryCapability: {
        state: 'unavailable',
        ready: false,
        canonical: false,
        reason: 'Shared durable memory is unavailable on this runtime surface.',
      },
    },
    operatorControls: { autonomyMasterToggle: true, safeMode: false, globalAutonomy: 'assisted', agentEnabledMap: {} },
    eventLog: [],
  });
  const memoryAgent = adjudicated.agents.find((entry) => entry.agentId === 'memory-agent');
  assert.equal(memoryAgent.active, false);
  assert.equal(memoryAgent.state, 'blocked');
  assert.match(memoryAgent.stateReason, /unavailable/i);
});
