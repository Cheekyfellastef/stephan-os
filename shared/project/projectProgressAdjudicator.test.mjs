import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateProjectProgress } from './projectProgressAdjudicator.mjs';
import { createSeedProjectProgressModel } from './projectProgressModel.mjs';

test('adjudicateProjectProgress returns seeded lanes and ranked next actions', () => {
  const projection = adjudicateProjectProgress({ model: createSeedProjectProgressModel() });

  assert.equal(Array.isArray(projection.lanes), true);
  assert.equal(projection.lanes.length >= 11, true);
  assert.equal(projection.nextBestActions[0].id, 'add-telemetry-summary-export');
  assert.equal(projection.readiness.agent, 'partial');
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

  assert.equal(projection.nextBestActions[0].id, 'add-telemetry-summary-export');
  assert.equal(projection.readiness.agent, 'in_progress');
  assert.equal(projection.agentTaskEvidence?.nextAgentTaskAction, 'Wire existing Agent Tile to Agent Task projection');
});

test('adjudicateProjectProgress overlays seed fallback lane with live agent-task summary status', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      systemId: 'agent-task-layer',
      status: 'started',
      agentTaskLayerStatus: 'preparing',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_policy',
      verificationStatus: 'not_started',
      nextAgentTaskAction: 'Add verification return state',
    },
  });

  const lane = projection.lanes.find((entry) => entry.id === 'agent-task-layer');
  assert.equal(lane?.status, 'started');
  assert.notEqual(lane?.status, 'not-started');
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
    telemetrySummary: { status: 'flowing' },
    promptBuilderSummary: { status: 'ready', supportsAgentTaskContext: true, supportsTelemetryContext: true, supportsRuntimeTruthContext: true },
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
    telemetrySummary: { status: 'flowing' },
    promptBuilderSummary: { status: 'ready', supportsAgentTaskContext: true, supportsTelemetryContext: true, supportsRuntimeTruthContext: true },
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
    telemetrySummary: { status: 'flowing' },
    promptBuilderSummary: { status: 'ready', supportsAgentTaskContext: true, supportsTelemetryContext: true, supportsRuntimeTruthContext: true },
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

test('adjudicateProjectProgress prioritizes telemetry summary exporter when telemetry summary is missing', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'started',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_policy',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      openClawIntegrationMode: 'policy_only',
      openClawKillSwitchState: 'required',
      nextAgentTaskAction: 'Wire OpenClaw kill switch',
    },
    telemetrySummary: {},
  });

  assert.equal(projection.nextBestActions.some((action) => action.id === 'add-telemetry-summary-export'), true);
});

test('adjudicateProjectProgress consumes telemetry and prompt builder summaries and advances to context binding', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'started',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      openClawReadiness: 'needs_policy',
      verificationStatus: 'ready',
      verificationReturnReady: true,
      verificationDecision: 'safe_to_accept',
      openClawIntegrationMode: 'policy_only',
      openClawKillSwitchState: 'required',
      nextAgentTaskAction: 'Wire OpenClaw kill switch',
    },
    telemetrySummary: {
      status: 'flowing',
      nextActions: ['Bind telemetry summary to agent/task lifecycle'],
      evidence: ['2 lifecycle events observed'],
    },
    promptBuilderSummary: {
      status: 'partial',
      supportsAgentTaskContext: false,
      supportsTelemetryContext: false,
      supportsRuntimeTruthContext: true,
      nextActions: ['Bind Prompt Builder summary to Agent Task context.'],
    },
  });

  const telemetryLane = projection.lanes.find((lane) => lane.id === 'telemetry');
  const promptLane = projection.lanes.find((lane) => lane.id === 'prompt-builder');
  assert.equal(telemetryLane?.status, 'ready');
  assert.equal(promptLane?.status, 'partial');
  assert.equal(projection.nextBestActions.some((action) => action.id === 'bind-prompt-builder-contexts'), true);
});

test('adjudicateProjectProgress advances beyond bind-prompt-builder-contexts when contexts are bound', () => {
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
      openClawIntegrationMode: 'policy_only',
      openClawKillSwitchState: 'required',
      nextAgentTaskAction: 'Wire OpenClaw kill switch',
    },
    telemetrySummary: {
      status: 'flowing',
      nextActions: ['Telemetry flowing.'],
    },
    promptBuilderSummary: {
      status: 'ready',
      supportsAgentTaskContext: true,
      supportsTelemetryContext: true,
      supportsRuntimeTruthContext: true,
      nextActions: ['Prompt contexts bound.'],
    },
  });

  assert.notEqual(projection.nextBestActions[0].id, 'bind-prompt-builder-contexts');
  assert.equal(projection.nextBestActions[0].id, 'wire-openclaw-kill-switch');
});

test('adjudicateProjectProgress suppresses stale foundational actions when live agent/codex/verification evidence exists', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    agentTaskReadinessSummary: {
      status: 'started',
      agentTaskLayerStatus: 'in_progress',
      codexReadiness: 'manual_handoff_only',
      codexManualHandoffReady: true,
      verificationStatus: 'started',
      verificationReturnStatus: 'verification_required',
      verificationReturnNextAction: 'Run and report all required verification checks.',
      openClawReadiness: 'needs_adapter',
      openClawIntegrationMode: 'local_adapter',
      openClawKillSwitchState: 'available',
      openClawAdapterMode: 'local_stub',
      openClawAdapterStubStatus: 'present_disabled',
      openClawAdapterConnectionState: 'not_connected',
      nextActions: [{ title: 'Connect OpenClaw local adapter', reason: 'Stub exists but not connected.' }],
      evidence: ['Agent Task model + projection exported'],
    },
    telemetrySummary: { status: 'flowing', nextActions: ['Telemetry flowing.'] },
    promptBuilderSummary: {
      status: 'ready',
      supportsAgentTaskContext: true,
      supportsTelemetryContext: true,
      supportsRuntimeTruthContext: true,
    },
    launcherEntrySummary: {
      systemId: 'launcher-entry',
      label: 'Launcher Entry',
      available: true,
      status: 'ready',
      shortcutSurfaces: [],
      diagnosticOverloadRisk: false,
    },
  });

  const ids = projection.nextBestActions.map((action) => action.id);
  assert.equal(ids.includes('build-agent-task-layer-v1'), false);
  assert.equal(ids.includes('add-codex-handoff-mode'), false);
  assert.equal(ids.includes('add-verification-return-loop'), false);
  assert.equal(ids.includes('add-telemetry-summary-export'), false);
  assert.equal(ids.includes('bind-prompt-builder-contexts'), false);
  assert.equal(ids.includes('create-openclaw-local-adapter-stub'), false);
  assert.equal(projection.nextBestActions.some((action) => action.id === 'connect-openclaw-local-adapter'), true);
});

test('adjudicateProjectProgress keeps seeded fallback recommendations when live summaries are absent', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    telemetrySummary: {},
    promptBuilderSummary: {},
  });

  const ids = projection.nextBestActions.map((action) => action.id);
  assert.equal(ids.includes('build-agent-task-layer-v1'), true);
  assert.equal(ids.includes('add-telemetry-summary-export'), true);
});


test('adjudicateProjectProgress consumes launcherEntrySummary into launcher-entry lane without UI-local logic', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    launcherEntrySummary: {
      systemId: 'launcher-entry',
      label: 'Launcher Entry',
      available: true,
      status: 'ready',
      dashboardSummaryText: 'Launcher entry ready · shortcut status coverage present.',
      compactSummaryText: 'Mission systems: Active · Next: Keep launcher compact.',
      blockers: [],
      warnings: [],
      evidence: ['Landing compact summary: Mission systems: Active'],
      shortcutSurfaces: [
        { id: 'stephanos-tile-entry', label: 'Stephanos Tile', present: true, statusSummaryAvailable: true },
        { id: 'agent-tile-entry', label: 'Agent Tile', present: true, statusSummaryAvailable: true },
      ],
    },
  });

  const launcherLane = projection.lanes.find((lane) => lane.id === 'launcher-entry');
  assert.equal(launcherLane?.status, 'ready');
  assert.equal(projection.nextBestActions[0].id === 'add-launcher-entry-summary-export', false);
  assert.equal(projection.nextBestActions[0].id === 'declutter-landing-tile-summary', false);
});

test('adjudicateProjectProgress targets missing launcher shortcut status with specific next action', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    telemetrySummary: { status: 'flowing', nextActions: ['Telemetry flowing.'] },
    promptBuilderSummary: {
      status: 'ready',
      supportsAgentTaskContext: true,
      supportsTelemetryContext: true,
      supportsRuntimeTruthContext: true,
      nextActions: ['Prompt contexts bound.'],
    },
    launcherEntrySummary: {
      systemId: 'launcher-entry',
      label: 'Launcher Entry',
      available: true,
      status: 'partial',
      dashboardSummaryText: 'Launcher entry partial · shortcut status gap.',
      compactSummaryText: 'Mission systems: Active',
      blockers: [],
      warnings: ['Shortcut status missing: Agent Tile.'],
      evidence: ['Landing compact summary present.'],
      shortcutSurfaces: [
        { id: 'stephanos-tile-entry', label: 'Stephanos Tile', present: true, statusSummaryAvailable: true },
        { id: 'agent-tile-entry', label: 'Agent Tile', present: true, statusSummaryAvailable: false },
      ],
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'populate-launcher-shortcut-status');
});


test('adjudicateProjectProgress advances beyond create-stub recommendation when explicit stub status evidence exists', () => {
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
      openClawAdapterStubStatus: 'health_check_only',
      openClawAdapterStubConnectionState: 'local_only',
      openClawAdapterConnectionState: 'not_connected',
      nextAgentTaskAction: 'Connect OpenClaw local adapter',
    },
  });

  assert.equal(projection.nextBestActions[0].id, 'connect-openclaw-local-adapter');
});

test('adjudicateProjectProgress does not report prompt-builder unavailable when summary exists', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    promptBuilderSummary: {
      status: 'partial',
      supportsAgentTaskContext: true,
      supportsTelemetryContext: false,
      supportsRuntimeTruthContext: true,
    },
  });

  const evidenceLines = projection.nextBestActions[0]?.evidence || [];
  assert.equal(evidenceLines.some((entry) => entry === 'prompt-builder:unavailable'), false);
  assert.equal(evidenceLines.some((entry) => entry.includes('prompt-builder:partial:missing-telemetry-context')), true);
});

test('adjudicateProjectProgress suppresses declutter action when landing tile is compact', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    launcherEntrySummary: {
      systemId: 'launcher-entry',
      available: true,
      status: 'ready',
      diagnosticOverloadRisk: false,
      shortcutSurfaces: [
        { id: 'stephanos-tile-entry', present: true, statusSummaryAvailable: true },
        { id: 'agent-tile-entry', present: true, statusSummaryAvailable: true },
      ],
    },
  });

  const ids = projection.nextBestActions.map((action) => action.id);
  assert.equal(ids.includes('declutter-landing-tile-summary'), false);
});

test('adjudicateProjectProgress suppresses kill-switch and adapter design actions when represented in shared truth', () => {
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
      openClawKillSwitchState: 'available',
      openClawAdapterMode: 'local_stub',
      openClawAdapterReadiness: 'needs_connection',
      openClawAdapterStubStatus: 'health_check_only',
      openClawAdapterStubConnectionState: 'local_only',
      openClawAdapterConnectionState: 'not_connected',
    },
  });

  const ids = projection.nextBestActions.map((action) => action.id);
  assert.equal(ids.includes('wire-openclaw-kill-switch'), false);
  assert.equal(ids.includes('design-openclaw-local-adapter'), false);
  assert.equal(ids.includes('create-openclaw-local-adapter-stub'), false);
  assert.equal(ids.includes('connect-openclaw-local-adapter'), true);
});

test('adjudicateProjectProgress suppresses telemetry lifecycle binding action when lifecycle is bound', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    telemetrySummary: { status: 'flowing', lifecycleBindingStatus: 'bound' },
  });
  assert.equal(projection.nextBestActions.some((action) => action.id === 'bind-telemetry-lifecycle-context'), false);
});

test('adjudicateProjectProgress keeps telemetry lifecycle binding action when binding missing', () => {
  const projection = adjudicateProjectProgress({
    model: createSeedProjectProgressModel(),
    telemetrySummary: { status: 'started', lifecycleBindingStatus: 'missing' },
  });
  assert.equal(projection.nextBestActions[0].id, 'bind-telemetry-lifecycle-context');
});

test('adjudicateProjectProgress suppresses stale openclaw setup actions when kill switch, contract, and stub truths exist', () => {
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
      openClawAdapterReadiness: 'local_stub',
      openClawAdapterConnectionState: 'not_connected',
      openClawAdapterStubStatus: 'present_disabled',
      openClawAdapterStubConnectionState: 'local_only',
      nextAgentTaskAction: 'Connect OpenClaw local adapter',
    },
  });
  const ids = projection.nextBestActions.map((a) => a.id);
  assert.equal(ids.includes('wire-openclaw-kill-switch'), false);
  assert.equal(ids.includes('design-openclaw-local-adapter'), false);
  assert.equal(ids.includes('create-openclaw-local-adapter-stub'), false);
  assert.equal(projection.nextBestActions[0].id, 'connect-openclaw-local-adapter');
});
