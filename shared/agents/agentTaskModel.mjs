const TASK_LIFECYCLE_STATES = new Set([
  'draft',
  'ready_for_review',
  'approved',
  'handoff_ready',
  'sent_to_agent',
  'in_progress',
  'waiting_for_operator',
  'verification_required',
  'verified',
  'blocked',
  'failed',
  'complete',
  'cancelled',
]);

const AGENT_IDS = new Set(['stephanos', 'codex', 'openclaw', 'manual']);
const AGENT_READINESS_STATES = new Set([
  'available',
  'unavailable',
  'manual_handoff_only',
  'needs_adapter',
  'needs_policy',
  'needs_approval',
  'blocked',
  'ready',
]);
const APPROVAL_GATES = new Set([
  'approve_scope',
  'approve_file_access',
  'approve_command_execution',
  'approve_external_access',
  'approve_memory_write',
  'approve_handoff',
  'approve_merge_or_push',
]);
const HANDOFF_MODES = new Set(['manual_prompt', 'github_issue', 'local_adapter', 'unavailable']);

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueTextList(value) {
  return Array.from(new Set(asArray(value).map((entry) => asText(entry)).filter(Boolean)));
}

function normalizeRisk(value = '') {
  const normalized = asText(value, 'moderate').toLowerCase();
  if (['low', 'moderate', 'high', 'critical'].includes(normalized)) {
    return normalized;
  }
  return 'moderate';
}

function normalizeTaskLifecycle(value = '') {
  const normalized = asText(value, 'draft').toLowerCase();
  return TASK_LIFECYCLE_STATES.has(normalized) ? normalized : 'draft';
}

function normalizeAgentId(value = '', fallback = 'manual') {
  const normalized = asText(value, fallback).toLowerCase();
  return AGENT_IDS.has(normalized) ? normalized : fallback;
}

function normalizeAgentReadiness(value = '', fallback = 'unavailable') {
  const normalized = asText(value, fallback).toLowerCase();
  return AGENT_READINESS_STATES.has(normalized) ? normalized : fallback;
}

function normalizeApprovalGates(value) {
  const listed = uniqueTextList(value).map((gate) => gate.toLowerCase());
  return listed.filter((gate) => APPROVAL_GATES.has(gate));
}

function normalizeHandoffMode(value = '') {
  const normalized = asText(value, 'manual_prompt').toLowerCase();
  return HANDOFF_MODES.has(normalized) ? normalized : 'manual_prompt';
}

export function createDefaultAgentTaskModel() {
  const now = new Date().toISOString();
  return {
    taskIdentity: {
      taskId: 'agent-task-layer-v1',
      title: 'Agent Task Layer v1',
      operatorIntent: 'Upgrade agent surfaces with canonical task/adjudication truth.',
      taskType: 'system-upgrade',
      targetArea: 'agent-layer',
      createdAt: now,
      updatedAt: now,
    },
    taskLifecycle: {
      state: 'draft',
      startedAt: '',
      completedAt: '',
    },
    agentAssignment: {
      recommendedAgent: 'stephanos',
      assignedAgent: 'manual',
      availableAgents: ['stephanos', 'codex', 'manual'],
      agentReason: 'Stephanos should adjudicate planning and policy truth before execution handoff.',
    },
    agentReadiness: {
      stephanos: 'ready',
      codex: 'manual_handoff_only',
      openclaw: 'needs_policy',
      manual: 'available',
    },
    approvalGates: {
      required: ['approve_scope', 'approve_file_access', 'approve_command_execution', 'approve_handoff'],
      approved: [],
      blocked: [],
    },
    taskConstraints: {
      allowedFiles: [],
      blockedFiles: [],
      allowedCommands: [],
      blockedCommands: [],
      requiredChecks: ['npm run stephanos:build', 'npm run stephanos:verify'],
      riskLevel: 'moderate',
    },
    handoff: {
      handoffTarget: 'codex',
      handoffMode: 'manual_prompt',
      handoffReady: false,
      handoffBlockers: ['Approval gate approve_handoff is pending.'],
      handoffPacketSummary: 'Mission packet not prepared.',
    },
    verification: {
      verificationRequired: true,
      verificationChecks: ['npm run stephanos:build', 'npm run stephanos:verify'],
      verificationStatus: 'not_started',
      lastVerificationResult: 'Not run for active task.',
    },
    evidence: {
      reasons: [],
      blockers: [],
      warnings: [],
      dependencies: [],
      sourceSignals: [],
    },
  };
}

export function normalizeAgentTaskModel(input = {}) {
  const defaults = createDefaultAgentTaskModel();
  const model = input && typeof input === 'object' ? input : {};

  const taskIdentity = model.taskIdentity && typeof model.taskIdentity === 'object' ? model.taskIdentity : {};
  const taskLifecycle = model.taskLifecycle && typeof model.taskLifecycle === 'object' ? model.taskLifecycle : {};
  const agentAssignment = model.agentAssignment && typeof model.agentAssignment === 'object' ? model.agentAssignment : {};
  const agentReadiness = model.agentReadiness && typeof model.agentReadiness === 'object' ? model.agentReadiness : {};
  const approvalGates = model.approvalGates && typeof model.approvalGates === 'object' ? model.approvalGates : {};
  const taskConstraints = model.taskConstraints && typeof model.taskConstraints === 'object' ? model.taskConstraints : {};
  const handoff = model.handoff && typeof model.handoff === 'object' ? model.handoff : {};
  const verification = model.verification && typeof model.verification === 'object' ? model.verification : {};
  const evidence = model.evidence && typeof model.evidence === 'object' ? model.evidence : {};

  const availableAgents = uniqueTextList(agentAssignment.availableAgents)
    .map((entry) => normalizeAgentId(entry, 'manual'));

  return {
    taskIdentity: {
      taskId: asText(taskIdentity.taskId, defaults.taskIdentity.taskId),
      title: asText(taskIdentity.title, defaults.taskIdentity.title),
      operatorIntent: asText(taskIdentity.operatorIntent, defaults.taskIdentity.operatorIntent),
      taskType: asText(taskIdentity.taskType, defaults.taskIdentity.taskType),
      targetArea: asText(taskIdentity.targetArea, defaults.taskIdentity.targetArea),
      createdAt: asText(taskIdentity.createdAt, defaults.taskIdentity.createdAt),
      updatedAt: asText(taskIdentity.updatedAt, defaults.taskIdentity.updatedAt),
    },
    taskLifecycle: {
      state: normalizeTaskLifecycle(taskLifecycle.state || defaults.taskLifecycle.state),
      startedAt: asText(taskLifecycle.startedAt, defaults.taskLifecycle.startedAt),
      completedAt: asText(taskLifecycle.completedAt, defaults.taskLifecycle.completedAt),
    },
    agentAssignment: {
      recommendedAgent: normalizeAgentId(agentAssignment.recommendedAgent || defaults.agentAssignment.recommendedAgent, 'stephanos'),
      assignedAgent: normalizeAgentId(agentAssignment.assignedAgent || defaults.agentAssignment.assignedAgent, 'manual'),
      availableAgents: availableAgents.length > 0 ? availableAgents : defaults.agentAssignment.availableAgents,
      agentReason: asText(agentAssignment.agentReason, defaults.agentAssignment.agentReason),
    },
    agentReadiness: {
      stephanos: normalizeAgentReadiness(agentReadiness.stephanos || defaults.agentReadiness.stephanos, defaults.agentReadiness.stephanos),
      codex: normalizeAgentReadiness(agentReadiness.codex || defaults.agentReadiness.codex, defaults.agentReadiness.codex),
      openclaw: normalizeAgentReadiness(agentReadiness.openclaw || defaults.agentReadiness.openclaw, defaults.agentReadiness.openclaw),
      manual: normalizeAgentReadiness(agentReadiness.manual || defaults.agentReadiness.manual, defaults.agentReadiness.manual),
    },
    approvalGates: {
      required: normalizeApprovalGates(Array.isArray(approvalGates.required) && approvalGates.required.length > 0 ? approvalGates.required : defaults.approvalGates.required),
      approved: normalizeApprovalGates(approvalGates.approved),
      blocked: normalizeApprovalGates(approvalGates.blocked),
    },
    taskConstraints: {
      allowedFiles: uniqueTextList(taskConstraints.allowedFiles),
      blockedFiles: uniqueTextList(taskConstraints.blockedFiles),
      allowedCommands: uniqueTextList(taskConstraints.allowedCommands),
      blockedCommands: uniqueTextList(taskConstraints.blockedCommands),
      requiredChecks: uniqueTextList(Array.isArray(taskConstraints.requiredChecks) && taskConstraints.requiredChecks.length > 0 ? taskConstraints.requiredChecks : defaults.taskConstraints.requiredChecks),
      riskLevel: normalizeRisk(taskConstraints.riskLevel || defaults.taskConstraints.riskLevel),
    },
    handoff: {
      handoffTarget: normalizeAgentId(handoff.handoffTarget || defaults.handoff.handoffTarget, 'manual'),
      handoffMode: normalizeHandoffMode(handoff.handoffMode || defaults.handoff.handoffMode),
      handoffReady: handoff.handoffReady === true,
      handoffBlockers: uniqueTextList(handoff.handoffBlockers),
      handoffPacketSummary: asText(handoff.handoffPacketSummary, defaults.handoff.handoffPacketSummary),
    },
    verification: {
      verificationRequired: verification.verificationRequired !== false,
      verificationChecks: uniqueTextList(Array.isArray(verification.verificationChecks) && verification.verificationChecks.length > 0 ? verification.verificationChecks : defaults.verification.verificationChecks),
      verificationStatus: asText(verification.verificationStatus, defaults.verification.verificationStatus),
      lastVerificationResult: asText(verification.lastVerificationResult, defaults.verification.lastVerificationResult),
    },
    evidence: {
      reasons: uniqueTextList(evidence.reasons),
      blockers: uniqueTextList(evidence.blockers),
      warnings: uniqueTextList(evidence.warnings),
      dependencies: uniqueTextList(evidence.dependencies),
      sourceSignals: uniqueTextList(evidence.sourceSignals),
    },
  };
}
