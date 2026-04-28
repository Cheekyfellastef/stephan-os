import { adjudicateAgentTaskLayer } from './agentTaskAdjudicator.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toChip(value = '', fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
}

function mapLayerStatusToDashboardStatus(layerStatus = '', lifecycleState = '') {
  const normalizedLayer = String(layerStatus || '').trim().toLowerCase();
  const normalizedLifecycle = String(lifecycleState || '').trim().toLowerCase();
  if (['blocked', 'failed', 'cancelled'].includes(normalizedLifecycle) || normalizedLayer === 'blocked') return 'blocked';
  if (['complete', 'verified'].includes(normalizedLifecycle)) return 'ready';
  if (normalizedLifecycle === 'draft') return 'not_started';
  if (['in_progress', 'sent_to_agent'].includes(normalizedLifecycle) || normalizedLayer === 'in_progress') return 'started';
  if (normalizedLayer === 'ready') return 'ready';
  if (normalizedLifecycle) return 'partial';
  return 'unknown';
}

function mapCodexReadiness(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'manual_handoff_only') return 'manual_handoff_only';
  if (normalized === 'needs_adapter') return 'manual_handoff_only';
  if (['blocked', 'needs_approval'].includes(normalized)) return 'blocked';
  if (normalized === 'unavailable') return 'unavailable';
  return 'unknown';
}

function mapVerificationStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'passed') return 'ready';
  if (normalized === 'not_started') return 'not_started';
  if (['running', 'started'].includes(normalized)) return 'started';
  if (normalized === 'partial') return 'partial';
  if (['blocked', 'failed', 'cancelled'].includes(normalized)) return 'blocked';
  return 'unknown';
}

export function buildAgentTaskProjection({ model = {}, context = {} } = {}) {
  const adjudicated = adjudicateAgentTaskLayer({ model, context });
  const pendingApprovals = asArray(adjudicated.approval.pending);
  const blockers = asArray(adjudicated.blockers);
  const warnings = asArray(adjudicated.warnings);
  const lifecycleState = adjudicated.model.taskLifecycle.state;
  const dashboardStatus = mapLayerStatusToDashboardStatus(adjudicated.layerStatus, lifecycleState);
  const dashboardCodexReadiness = mapCodexReadiness(adjudicated.codexReadiness);
  const dashboardVerificationStatus = mapVerificationStatus(adjudicated.verification.status);
  const nextAction = {
    title: adjudicated.nextAction.title,
    priority: 1,
    reason: adjudicated.nextAction.reason,
    blocks: asArray(adjudicated.nextAction.blocks),
  };
  const evidence = [
    ...asArray(adjudicated.reasons),
    ...asArray(adjudicated.dependencies),
    ...asArray(adjudicated.sourceSignals),
  ].filter(Boolean);

  return {
    generatedAt: adjudicated.generatedAt,
    task: adjudicated.model,
    operatorSurface: {
      layerStatus: adjudicated.layerStatus,
      activeTaskTitle: adjudicated.model.taskIdentity.title,
      lifecycleState: adjudicated.model.taskLifecycle.state,
      recommendedAgent: adjudicated.model.agentAssignment.recommendedAgent,
      assignedAgent: adjudicated.model.agentAssignment.assignedAgent,
      codexReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      handoffReady: adjudicated.handoff.handoffReady,
      handoffMode: adjudicated.handoff.handoffMode,
      handoffPacketSummary: adjudicated.handoff.handoffPacketSummary,
      approvalPending: pendingApprovals,
      verificationStatus: adjudicated.verification.status,
      nextAction: adjudicated.nextAction,
      blockers,
      warnings,
    },
    compactSurface: {
      agentTaskLayerStatus: adjudicated.layerStatus,
      nextAgentTaskAction: adjudicated.nextAction.title,
      codexReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      highestPriorityApprovalGate: toChip(adjudicated.approval.highestPriorityGate, 'none'),
    },
    readinessSummary: {
      systemId: 'agent-task-layer',
      label: 'Agent Task Layer',
      status: dashboardStatus,
      phase: lifecycleState || 'unknown',
      blockers,
      warnings,
      nextActions: [nextAction],
      evidence,
      codexReadiness: dashboardCodexReadiness,
      verificationStatus: dashboardVerificationStatus,
      highestPriorityGate: toChip(adjudicated.approval.highestPriorityGate, 'none'),
      agentTaskLayerStatus: adjudicated.layerStatus,
      codexRuntimeReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      nextAgentTaskAction: adjudicated.nextAction.title,
      agentTaskLayerBlockers: blockers,
      readinessScore: adjudicated.readinessScore,
    },
  };
}
