import { adjudicateAgentTaskLayer } from './agentTaskAdjudicator.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toChip(value = '', fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
}

export function buildAgentTaskProjection({ model = {}, context = {} } = {}) {
  const adjudicated = adjudicateAgentTaskLayer({ model, context });
  const pendingApprovals = asArray(adjudicated.approval.pending);
  const blockers = asArray(adjudicated.blockers);
  const warnings = asArray(adjudicated.warnings);

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
      agentTaskLayerStatus: adjudicated.layerStatus,
      codexReadiness: adjudicated.codexReadiness,
      openClawReadiness: adjudicated.openClawReadiness,
      nextAgentTaskAction: adjudicated.nextAction.title,
      agentTaskLayerBlockers: blockers,
      readinessScore: adjudicated.readinessScore,
    },
  };
}
