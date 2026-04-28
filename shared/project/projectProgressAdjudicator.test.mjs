import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateProjectProgress } from './projectProgressAdjudicator.mjs';
import { createSeedProjectProgressModel } from './projectProgressModel.mjs';

test('adjudicateProjectProgress returns seeded lanes and ranked next actions', () => {
  const projection = adjudicateProjectProgress({ model: createSeedProjectProgressModel() });

  assert.equal(Array.isArray(projection.lanes), true);
  assert.equal(projection.lanes.length >= 10, true);
  assert.equal(projection.nextBestActions[0].id, 'build-agent-task-layer-v1');
  assert.equal(projection.readiness.agent, 'not-started');
  assert.equal(projection.readiness.openClaw, 'blocked');
  assert.equal(projection.verificationStatus.status, 'started');
});

test('adjudicateProjectProgress advances next best action when Agent Task summary indicates canonical model exists', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'needs_adapter',
      openClawReadiness: 'needs_policy',
      nextAgentTaskAction: 'Wire existing Agent Tile to Agent Task projection',
      readinessScore: 52,
      agentTaskLayerBlockers: ['Agent tile is not consuming projection yet.'],
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'upgrade-agents-tile-status-surface');
  assert.equal(projection.readiness.agent, 'in_progress');
  assert.equal(projection.agentTaskEvidence?.nextAgentTaskAction, 'Wire existing Agent Tile to Agent Task projection');
});

test('adjudicateProjectProgress emits doctrine warnings for localhost assumption drift', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    runtimeStatus: { healthy: true },
    finalRouteTruth: { launchable: false, routeKind: 'localhost' },
    orchestrationSelectors: {
      capabilityPosture: {
        localAuthorityAvailable: false,
      },
    },
  });

  assert.equal(projection.doctrineWarnings.length >= 2, true);
  assert.match(projection.doctrineWarnings.join('\n'), /route launchability/i);
});

test('adjudicateProjectProgress advances next action to verification when codex manual handoff is ready', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'started',
      phase: 'in_progress',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_policy',
      verificationStatus: 'not_started',
      nextAgentTaskAction: 'Add verification return state',
      nextActions: [
        { title: 'Add verification return state', reason: 'Need verification loop.' },
      ],
      readinessScore: 68,
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'add-verification-return-loop');
});

test('adjudicateProjectProgress keeps verification return loop as next action when return is not ready', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'started',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_policy',
      verificationStatus: 'not_started',
      verificationReturnReady: false,
      nextAgentTaskAction: 'Paste Codex result for verification',
      nextActions: [{ title: 'Paste Codex result for verification', reason: 'Awaiting return.' }],
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'add-verification-return-loop');
});

test('adjudicateProjectProgress recommends kill-switch wiring after policy harness exists in policy_only mode', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'partial',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_policy',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      mergeReadiness: 'ready_for_operator_approval',
      openClawIntegrationMode: 'policy_only',
      openClawKillSwitchState: 'required',
      nextAgentTaskAction: 'Wire OpenClaw kill switch',
      nextActions: [{ title: 'Wire OpenClaw kill switch', reason: 'Policy harness exists and kill switch is still required.' }],
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'wire-openclaw-kill-switch');
  assert.equal(
    projection.nextBestActions.some((action) => /policy harness/i.test(action.title)),
    false,
  );
});

test('adjudicateProjectProgress recommends adapter design when kill switch exists but adapter is missing', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'partial',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_adapter',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      openClawIntegrationMode: 'local_adapter',
      openClawKillSwitchState: 'available',
      openClawAdapterPresent: false,
      openClawAdapterMode: 'design_only',
      nextAgentTaskAction: 'Design OpenClaw local adapter contract',
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'design-openclaw-local-adapter');
});

test('adjudicateProjectProgress recommends approval gates when adapter exists but approvals are missing', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'partial',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_approval',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      openClawIntegrationMode: 'local_adapter',
      openClawKillSwitchState: 'available',
      openClawAdapterPresent: true,
      openClawAdapterMode: 'connected',
      openClawAdapterConnectionState: 'connected',
      openClawApprovalsComplete: false,
      nextAgentTaskAction: 'Complete OpenClaw approval gates',
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'complete-openclaw-approval-gates');
});


test('adjudicateProjectProgress recommends stub creation after adapter contract is defined', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'partial',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_adapter',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      openClawIntegrationMode: 'local_adapter',
      openClawKillSwitchState: 'available',
      openClawAdapterMode: 'contract_defined',
      nextAgentTaskAction: 'Create OpenClaw local adapter stub',
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'create-openclaw-local-adapter-stub');
});

test('adjudicateProjectProgress recommends adapter connection after stub exists but no connection', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'partial',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_adapter',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      openClawIntegrationMode: 'local_adapter',
      openClawKillSwitchState: 'available',
      openClawAdapterMode: 'local_stub',
      openClawAdapterConnectionState: 'not_connected',
      nextAgentTaskAction: 'Connect OpenClaw local adapter',
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'connect-openclaw-local-adapter');
});
