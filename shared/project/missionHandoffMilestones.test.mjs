import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionHandoffMilestones } from './missionHandoffMilestones.mjs';
import { createDefaultMissionDashboardState, buildMissionHandoffText, buildMissionSummaryMetrics } from '../../stephanos-ui/src/state/missionDashboardModel.js';

function createProjectionFixture() {
  return {
    generatedAt: '2026-04-28T00:00:00.000Z',
    lanes: [
      { id: 'agent-task-layer', status: 'partial', evidence: ['agent task model'], blockers: [] },
      { id: 'codex-handoff', status: 'ready', evidence: ['handoff packet'], blockers: [] },
      { id: 'verification-loop', status: 'ready', evidence: ['verify script'], blockers: [] },
      { id: 'openclaw-control', status: 'partial', evidence: ['policy harness'], blockers: ['adapter not connected'] },
      { id: 'mission-console-ui', status: 'ready', evidence: ['dashboard wired'], blockers: [] },
      { id: 'route-backend-health', status: 'started', evidence: ['route truth'], blockers: [] },
      { id: 'hosted-bridge-tailscale-serve', status: 'partial', evidence: ['hosted bridge'], blockers: [] },
      { id: 'intent-proposal-engine', status: 'started', evidence: ['intent view'], blockers: [] },
    ],
    verificationStatus: {
      buildVerifyScriptsPresent: true,
      taskCompletionBound: true,
      status: 'started',
      summary: 'Build and verify completed with bound closure loop.',
    },
    nextBestActions: [
      { id: 'wire-openclaw-kill-switch', title: 'Wire OpenClaw Kill Switch', reason: 'Safety before adapter', blocks: ['OpenClaw control'] },
    ],
    doctrineWarnings: [],
  };
}

test('live Agent Task summary maps Agent Layer v1 to in-progress/review with evidence', () => {
  const projection = buildMissionHandoffMilestones({
    dashboardState: createDefaultMissionDashboardState(),
    projectProgressProjection: createProjectionFixture(),
    agentTaskSummary: {
      status: 'started',
      nextAgentTaskAction: 'Build canonical Agent Task Model',
      evidence: ['Lifecycle state visible'],
      codexReadiness: 'ready',
      verificationReturnStatus: 'verified',
    },
    telemetrySummary: { status: 'flowing', evidence: [] },
    promptBuilderSummary: { status: 'ready', evidence: [] },
  });

  const v1 = projection.milestones.find((entry) => entry.id === 'agent-layer-v1-foundation');
  assert.ok(v1);
  assert.notEqual(v1.status, 'not-started');
  assert.ok(v1.evidence.length > 0);
  assert.match(v1.notes, /Bound to shared Agent Task/);
});

test('OpenClaw policy/kill-switch/adapter summary maps Agent Layer v3 with blocker and next action', () => {
  const projection = buildMissionHandoffMilestones({
    dashboardState: createDefaultMissionDashboardState(),
    projectProgressProjection: createProjectionFixture(),
    agentTaskSummary: {
      openClawReadiness: 'needs_adapter',
      openClawKillSwitchState: 'engaged',
      openClawAdapterMode: 'design_only',
      openClawAdapterReadiness: 'needs_contract',
      openClawNextAction: 'Design OpenClaw local adapter contract',
      openClawHighestPriorityBlocker: 'Adapter contract missing',
    },
  });

  const v3 = projection.milestones.find((entry) => entry.id === 'agent-layer-v3-persistent-orchestration');
  assert.ok(v3);
  assert.ok(['planned', 'in-progress', 'blocked'].includes(v3.status));
  assert.match(v3.blockerReason, /Adapter/);
  assert.match(v3.nextAction, /OpenClaw/);
});

test('build/verify truth gate milestone maps to review or complete when verification is bound', () => {
  const projection = buildMissionHandoffMilestones({
    dashboardState: createDefaultMissionDashboardState(),
    projectProgressProjection: createProjectionFixture(),
    agentTaskSummary: { verificationReturnNextAction: 'Run verification return gate checks' },
  });

  const gate = projection.milestones.find((entry) => entry.id === 'build-verify-truth-gates');
  assert.ok(gate);
  assert.ok(['review', 'complete'].includes(gate.status));
  assert.ok(gate.evidence.some((entry) => entry.includes('Build/verify')));
});


test('launcher-agents-entry milestone consumes launcherEntrySummary and clears wiring gap', () => {
  const projection = buildMissionHandoffMilestones({
    dashboardState: createDefaultMissionDashboardState(),
    projectProgressProjection: createProjectionFixture(),
    launcherEntrySummary: {
      systemId: 'launcher-entry',
      label: 'Launcher Entry',
      available: true,
      status: 'ready',
      nextAction: 'Keep launcher entry shortcuts status-bound to shared summaries.',
      blockers: [],
      warnings: [],
      evidence: ['Landing compact summary: Mission systems: Active'],
      shortcutSurfaces: [
        { id: 'stephanos-tile-entry', label: 'Stephanos Tile', present: true, statusSummaryAvailable: true },
        { id: 'agent-tile-entry', label: 'Agent Tile', present: true, statusSummaryAvailable: true },
      ],
    },
  });

  const launcher = projection.milestones.find((entry) => entry.id === 'launcher-agents-entry');
  assert.ok(launcher);
  assert.equal(launcher.truthSource, 'live_projection');
  assert.match(launcher.notes, /shared compact landing summary/i);
  assert.equal(projection.wiringGaps.some((entry) => /Launcher Agents Entry/i.test(entry)), false);
});

test('manual baseline stays fallback and operator override is explicit', () => {
  const state = createDefaultMissionDashboardState();
  const launcher = state.milestones.find((entry) => entry.id === 'launcher-agents-entry');
  launcher.operatorOverride = true;
  launcher.status = 'blocked';
  launcher.percentComplete = 12;
  launcher.notes = 'Operator forcing hold.';

  const projection = buildMissionHandoffMilestones({ dashboardState: state, projectProgressProjection: { lanes: [], nextBestActions: [] } });
  const mappedLauncher = projection.milestones.find((entry) => entry.id === 'launcher-agents-entry');
  const hosted = projection.milestones.find((entry) => entry.id === 'mission-console-hosted-repair');

  assert.equal(mappedLauncher.truthSource, 'operator_override');
  assert.equal(mappedLauncher.status, 'blocked');
  assert.equal(hosted.truthSource, 'manual_baseline');
});

test('handoff metrics and text no longer force complete zero when live milestones are review/complete', () => {
  const projection = buildMissionHandoffMilestones({
    dashboardState: createDefaultMissionDashboardState(),
    projectProgressProjection: createProjectionFixture(),
    agentTaskSummary: {
      status: 'ready',
      codexReadiness: 'ready',
      verificationReturnStatus: 'verified',
    },
  });

  const metrics = buildMissionSummaryMetrics(createDefaultMissionDashboardState(), { projectedMilestones: projection.milestones });
  const handoffText = buildMissionHandoffText(createDefaultMissionDashboardState(), {
    projectedMilestones: projection.milestones,
    nextBestActions: projection.nextBestActions,
    wiringGaps: projection.wiringGaps,
  });

  assert.ok(metrics.completeCount > 0 || metrics.countsByStatus.review > 0);
  assert.match(handoffText, /Next Best Actions/);
  assert.doesNotMatch(handoffText, /Manual baseline; update with concrete progress evidence\./);
});
