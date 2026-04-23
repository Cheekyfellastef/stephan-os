function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function resolveAgentSurfaceMode(surfaceParam = '') {
  const normalized = String(surfaceParam || '').trim().toLowerCase();
  if (normalized === 'cockpit') return 'cockpit';
  if (normalized === 'agents') return 'agents';
  if (normalized === 'mission-console') return 'mission-console';
  if (normalized === 'openclaw') return 'openclaw';
  return 'mission-control';
}

export function buildAgentSurfaceProjection({ finalAgentView = {}, surfaceMode = 'mission-control' } = {}) {
  const view = finalAgentView && typeof finalAgentView === 'object' ? finalAgentView : {};
  const visibleAgents = asArray(view.visibleAgents);
  const blockedCount = visibleAgents.filter((entry) => entry?.state === 'blocked').length;
  const actingAgentId = String(view.actingAgentId || '').trim();
  const activeCount = asArray(view.activeAgentIds).length;

  const orchestration = view.finalMissionOrchestrationView || {};
  const approvals = view.finalApprovalQueueView || {};
  const resume = view.finalResumeView || {};

  const status = actingAgentId
    ? 'acting'
    : blockedCount > 0
      ? 'blocked'
      : activeCount > 0
        ? 'idle-ready'
        : 'idle';

  return {
    surfaceMode,
    launcherSummary: {
      status,
      summaryLabel: actingAgentId
        ? `acting · ${actingAgentId}`
        : blockedCount > 0
          ? `blocked · ${blockedCount}`
          : activeCount > 0
            ? `idle-ready · ${activeCount}`
            : 'idle',
      activeCount,
      blockedCount,
      actingAgentId,
      handoffCount: asArray(view.visibleHandoffChain).length,
      eventCount: asArray(view.recentTransitions).length,
      activeGoalCount: asArray(orchestration.activeGoals).length,
      pendingApprovalCount: Number(approvals.pendingCount || 0),
      resumableCount: asArray(resume.resumableQueue).length,
      blockedResumeCount: asArray(resume.blockedQueue).length,
    },
  };
}
