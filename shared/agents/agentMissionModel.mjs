const GOAL_STATUSES = new Set(['planned', 'active', 'waiting', 'blocked', 'completed', 'canceled']);
const TASK_STATUSES = new Set(['planned', 'ready', 'active', 'waiting', 'blocked', 'completed', 'failed', 'canceled']);
const APPROVAL_STATES = new Set(['not-required', 'pending', 'approved', 'denied', 'expired', 'blocked-by-policy']);

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value, allowed, fallback) {
  const normalized = asText(value, fallback).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeGoal(goal = {}, nowIso = '') {
  const goalId = asText(goal.goalId || goal.id);
  return {
    goalId,
    title: asText(goal.title, 'Untitled goal'),
    description: asText(goal.description, ''),
    origin: asText(goal.origin, 'operator'),
    createdAt: asText(goal.createdAt, nowIso),
    updatedAt: asText(goal.updatedAt, asText(goal.createdAt, nowIso)),
    status: normalizeStatus(goal.status, GOAL_STATUSES, 'planned'),
    priority: asText(goal.priority, 'normal'),
    initiatingAgentId: asText(goal.initiatingAgentId),
    linkedMemoryRefs: asArray(goal.linkedMemoryRefs).map((entry) => asText(entry)).filter(Boolean),
    linkedTaskIds: asArray(goal.linkedTaskIds).map((entry) => asText(entry)).filter(Boolean),
    resumable: goal.resumable !== false,
    blockedReason: asText(goal.blockedReason),
  };
}

function normalizeTask(task = {}, nowIso = '') {
  const taskId = asText(task.taskId || task.id);
  const requiresApproval = task.requiresApproval === true;
  const approvalState = normalizeStatus(
    task.approvalState || (requiresApproval ? 'pending' : 'not-required'),
    APPROVAL_STATES,
    requiresApproval ? 'pending' : 'not-required',
  );

  return {
    taskId,
    parentGoalId: asText(task.parentGoalId),
    parentTaskId: asText(task.parentTaskId),
    title: asText(task.title, 'Untitled task'),
    description: asText(task.description, ''),
    assignedAgentId: asText(task.assignedAgentId),
    requestedByAgentId: asText(task.requestedByAgentId),
    status: normalizeStatus(task.status, TASK_STATUSES, 'planned'),
    requiresApproval,
    approvalState,
    blockers: asArray(task.blockers).map((entry) => asText(entry)).filter(Boolean),
    createdAt: asText(task.createdAt, nowIso),
    updatedAt: asText(task.updatedAt, asText(task.createdAt, nowIso)),
    startedAt: asText(task.startedAt),
    completedAt: asText(task.completedAt),
    continuityRefs: asArray(task.continuityRefs).map((entry) => asText(entry)).filter(Boolean),
    linkedArtifacts: asArray(task.linkedArtifacts).map((entry) => asText(entry)).filter(Boolean),
    resultSummary: asText(task.resultSummary),
    executionSurfaceKinds: asArray(task.executionSurfaceKinds).map((entry) => asText(entry)).filter(Boolean),
    executionSessionKinds: asArray(task.executionSessionKinds).map((entry) => asText(entry)).filter(Boolean),
  };
}

function normalizeHandoff(handoff = {}, nowIso = '') {
  return {
    handoffId: asText(handoff.handoffId || handoff.id || `${asText(handoff.fromAgentId)}-${asText(handoff.toAgentId)}-${asText(handoff.taskId)}`),
    taskId: asText(handoff.taskId),
    goalId: asText(handoff.goalId),
    fromAgentId: asText(handoff.fromAgentId),
    toAgentId: asText(handoff.toAgentId),
    delegatedByAgentId: asText(handoff.delegatedByAgentId || handoff.fromAgentId),
    ownerAgentId: asText(handoff.ownerAgentId || handoff.toAgentId),
    state: asText(handoff.state, 'open'),
    reason: asText(handoff.reason),
    createdAt: asText(handoff.createdAt, nowIso),
    updatedAt: asText(handoff.updatedAt, asText(handoff.createdAt, nowIso)),
  };
}

function normalizeApprovalRequest(request = {}, nowIso = '') {
  return {
    approvalRequestId: asText(request.approvalRequestId || request.id),
    taskId: asText(request.taskId),
    goalId: asText(request.goalId),
    requestedByAgentId: asText(request.requestedByAgentId),
    classification: asText(request.classification, 'approval-required-action'),
    state: normalizeStatus(request.state, APPROVAL_STATES, 'pending'),
    reason: asText(request.reason, 'Operator approval required for meaningful action.'),
    requestedAt: asText(request.requestedAt, nowIso),
    expiresAt: asText(request.expiresAt),
  };
}

function normalizeApprovalDecision(decision = {}, nowIso = '') {
  return {
    approvalDecisionId: asText(decision.approvalDecisionId || decision.id),
    approvalRequestId: asText(decision.approvalRequestId),
    taskId: asText(decision.taskId),
    decidedBy: asText(decision.decidedBy, 'operator'),
    decision: normalizeStatus(decision.decision, APPROVAL_STATES, 'pending'),
    decidedAt: asText(decision.decidedAt, nowIso),
    reason: asText(decision.reason),
  };
}

function normalizeResumeToken(token = {}, nowIso = '') {
  return {
    resumeTokenId: asText(token.resumeTokenId || token.id),
    goalId: asText(token.goalId),
    taskId: asText(token.taskId),
    ownerAgentId: asText(token.ownerAgentId),
    bestSurface: asText(token.bestSurface, 'mission-control'),
    status: asText(token.status, 'resumable'),
    reason: asText(token.reason, 'Work is incomplete and can be resumed.'),
    createdAt: asText(token.createdAt, nowIso),
    updatedAt: asText(token.updatedAt, asText(token.createdAt, nowIso)),
  };
}

function normalizeMissionPacket(packet = {}, nowIso = '') {
  return {
    missionPacketId: asText(packet.missionPacketId || packet.id),
    goalId: asText(packet.goalId),
    ownerAgentId: asText(packet.ownerAgentId),
    title: asText(packet.title, 'Mission packet'),
    summary: asText(packet.summary),
    status: asText(packet.status, 'open'),
    createdAt: asText(packet.createdAt, nowIso),
    updatedAt: asText(packet.updatedAt, asText(packet.createdAt, nowIso)),
  };
}

export function buildAgentMissionModel({
  orchestrationState = {},
  now = new Date(),
} = {}) {
  const nowIso = typeof now?.toISOString === 'function' ? now.toISOString() : new Date().toISOString();
  const goals = asArray(orchestrationState.goals).map((goal) => normalizeGoal(goal, nowIso)).filter((goal) => goal.goalId);
  const tasks = asArray(orchestrationState.tasks).map((task) => normalizeTask(task, nowIso)).filter((task) => task.taskId);
  const handoffs = asArray(orchestrationState.handoffs).map((handoff) => normalizeHandoff(handoff, nowIso)).filter((handoff) => handoff.handoffId);
  const approvalRequests = asArray(orchestrationState.approvalRequests)
    .map((request) => normalizeApprovalRequest(request, nowIso))
    .filter((request) => request.approvalRequestId);
  const approvalDecisions = asArray(orchestrationState.approvalDecisions)
    .map((decision) => normalizeApprovalDecision(decision, nowIso))
    .filter((decision) => decision.approvalDecisionId);
  const resumeTokens = asArray(orchestrationState.resumeTokens).map((token) => normalizeResumeToken(token, nowIso)).filter((token) => token.resumeTokenId);
  const missionPackets = asArray(orchestrationState.missionPackets).map((packet) => normalizeMissionPacket(packet, nowIso)).filter((packet) => packet.missionPacketId);

  return {
    schemaVersion: 'agent-layer.v3.persistent-orchestration',
    layerSemantics: {
      v1: 'pane-level and visible fleet foundation',
      v2: 'launcher and surface elevation',
      v3: 'persistent supervised orchestration',
    },
    goals,
    tasks,
    handoffs,
    approvalRequests,
    approvalDecisions,
    resumeTokens,
    missionPackets,
    summary: {
      activeGoals: goals.filter((goal) => ['active', 'waiting', 'blocked'].includes(goal.status)).length,
      openTasks: tasks.filter((task) => !['completed', 'failed', 'canceled'].includes(task.status)).length,
      blockedTasks: tasks.filter((task) => task.status === 'blocked' || task.blockers.length > 0).length,
      pendingApprovals: approvalRequests.filter((request) => request.state === 'pending').length,
      resumableItems: resumeTokens.filter((token) => token.status === 'resumable').length,
    },
    lastUpdatedAt: nowIso,
  };
}
