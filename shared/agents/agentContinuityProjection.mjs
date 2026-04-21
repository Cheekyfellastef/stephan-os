function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function buildAgentContinuityProjection({ missionModel = {}, context = {} } = {}) {
  const sessionKind = asText(context.sessionKind || context.runtimeSessionKind, 'local-dev');
  const surface = asText(context.surface, 'mission-control');
  const activeGoals = asArray(missionModel.goals).filter((goal) => ['active', 'waiting', 'blocked'].includes(goal.status));
  const incompleteTasks = asArray(missionModel.tasks).filter((task) => !['completed', 'failed', 'canceled'].includes(task.status));

  const resumeEntries = incompleteTasks.map((task) => {
    const allowedSessions = asArray(task.executionSessionKinds);
    const allowedSurfaces = asArray(task.executionSurfaceKinds);
    const sessionBlocked = allowedSessions.length > 0 && !allowedSessions.includes(sessionKind);
    const surfaceBlocked = allowedSurfaces.length > 0 && !allowedSurfaces.includes(surface);
    const blockedReason = sessionBlocked
      ? `Session ${sessionKind} cannot execute this task.`
      : surfaceBlocked
        ? `Surface ${surface} cannot execute this task.`
        : '';

    return {
      taskId: task.taskId,
      goalId: task.parentGoalId,
      title: task.title,
      status: task.status,
      resumable: task.status !== 'blocked' || task.blockers.length === 0,
      blockedReason,
      bestSurface: allowedSurfaces[0] || 'mission-control',
      bestSessionKind: allowedSessions[0] || 'local-dev',
      continuityRefs: task.continuityRefs || [],
    };
  });

  return {
    sessionKind,
    surface,
    activeGoals: activeGoals.map((goal) => ({ goalId: goal.goalId, title: goal.title, status: goal.status })),
    resumableQueue: resumeEntries.filter((entry) => !entry.blockedReason),
    blockedQueue: resumeEntries.filter((entry) => Boolean(entry.blockedReason)),
    operatorResumeSummary: resumeEntries.length === 0
      ? 'No incomplete work to resume.'
      : `${resumeEntries.filter((entry) => !entry.blockedReason).length} resumable items and ${resumeEntries.filter((entry) => entry.blockedReason).length} surface/session-blocked items.`,
  };
}
