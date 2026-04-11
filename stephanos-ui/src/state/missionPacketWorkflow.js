const MISSION_PACKET_WORKFLOW_SCHEMA_VERSION = 1;
const MAX_DECISIONS = 24;
const MAX_ACTIVITY = 40;
const MAX_QUEUE_ITEMS = 20;
const LIFECYCLE_STATES = Object.freeze([
  'proposed',
  'awaiting-approval',
  'accepted',
  'execution-ready',
  'in-progress',
  'completed',
  'failed',
  'rollback-recommended',
  'rolled-back',
]);

function safeText(value, fallback = '') {
  const nextValue = String(value ?? '').trim();
  return nextValue || fallback;
}

function safeList(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => safeText(entry)).filter(Boolean))].slice(0, limit);
}

function safeBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function normalizeLifecycleStatus(value, fallback = 'proposed') {
  const normalized = safeText(value, fallback).toLowerCase();
  return LIFECYCLE_STATES.includes(normalized) ? normalized : fallback;
}

export function normalizeMissionPacketTruth(lastExecutionMetadata = {}) {
  const metadata = lastExecutionMetadata && typeof lastExecutionMetadata === 'object' ? lastExecutionMetadata : {};
  if (
    Object.prototype.hasOwnProperty.call(metadata, 'active')
    || Object.prototype.hasOwnProperty.call(metadata, 'moveId')
    || Object.prototype.hasOwnProperty.call(metadata, 'approvalRequired')
  ) {
    return {
      active: safeBoolean(metadata.active, false),
      mode: safeText(metadata.mode, 'inactive'),
      confidence: safeText(metadata.confidence, 'low'),
      moveId: safeText(metadata.moveId),
      moveTitle: safeText(metadata.moveTitle),
      rationale: safeText(metadata.rationale),
      warnings: safeList(metadata.warnings),
      evidence: safeList(metadata.evidence),
      blockers: safeList(metadata.blockers),
      dependencies: safeList(metadata.dependencies),
      codexHandoffAvailable: safeBoolean(metadata.codexHandoffAvailable, false),
      codexHandoffPayload: safeText(metadata.codexHandoffPayload),
      codexPromptSummary: safeText(metadata.codexPromptSummary),
      approvalRequired: metadata.approvalRequired !== false,
      executionEligible: safeBoolean(metadata.executionEligible, false),
    };
  }
  const proposalPacket = metadata.proposal_packet && typeof metadata.proposal_packet === 'object'
    ? metadata.proposal_packet
    : {};
  const executionFraming = proposalPacket.execution_framing && typeof proposalPacket.execution_framing === 'object'
    ? proposalPacket.execution_framing
    : {};

  const planningBlockers = Array.isArray(metadata.planning_blockers) ? metadata.planning_blockers : [];
  const planningDependencies = Array.isArray(metadata.planning_dependencies) ? metadata.planning_dependencies : [];
  const planningEvidence = Array.isArray(metadata.planning_evidence_sources) ? metadata.planning_evidence_sources : [];

  return {
    active: safeBoolean(metadata.proposal_packet_active, false),
    mode: safeText(metadata.proposal_packet_mode, 'inactive'),
    confidence: safeText(metadata.proposal_packet_confidence, 'low'),
    moveId: safeText(metadata.proposed_move_id),
    moveTitle: safeText(metadata.proposed_move_title),
    rationale: safeText(metadata.proposed_move_rationale),
    warnings: safeList(metadata.proposal_packet_warnings),
    evidence: safeList(planningEvidence),
    blockers: safeList(planningBlockers.length > 0 ? planningBlockers : executionFraming.blockers),
    dependencies: safeList(planningDependencies),
    codexHandoffAvailable: safeBoolean(metadata.codex_handoff_available, false),
    codexHandoffPayload: safeText(metadata.codex_handoff_payload),
    codexPromptSummary: safeText(metadata.codex_prompt_summary),
    approvalRequired: metadata.operator_approval_required !== false,
    executionEligible: safeBoolean(metadata.execution_eligible, false),
  };
}

export function buildMissionPacketKey(packetTruth = {}) {
  const mode = safeText(packetTruth.mode, 'inactive');
  const moveId = safeText(packetTruth.moveId, 'unknown-move');
  return `${mode}::${moveId}`;
}

function normalizeDecisionEntry(entry = {}) {
  return {
    packetKey: safeText(entry.packetKey),
    moveId: safeText(entry.moveId),
    moveTitle: safeText(entry.moveTitle),
    decision: safeText(entry.decision),
    decidedAt: safeText(entry.decidedAt),
    approvalRequired: entry.approvalRequired !== false,
    executionEligible: false,
    lifecycleStatus: normalizeLifecycleStatus(entry.lifecycleStatus, 'awaiting-approval'),
  };
}

function normalizeQueueEntry(entry = {}) {
  return {
    id: safeText(entry.id),
    packetKey: safeText(entry.packetKey),
    moveId: safeText(entry.moveId),
    moveTitle: safeText(entry.moveTitle),
    status: safeText(entry.status, 'queued'),
    queuedAt: safeText(entry.queuedAt),
    source: safeText(entry.source, 'mission-packet-operator'),
  };
}

function normalizeActivityEntry(entry = {}) {
  return {
    id: safeText(entry.id),
    type: safeText(entry.type, 'mission-packet'),
    summary: safeText(entry.summary),
    timestamp: safeText(entry.timestamp),
  };
}

export function createDefaultMissionPacketWorkflow() {
  return {
    schemaVersion: MISSION_PACKET_WORKFLOW_SCHEMA_VERSION,
    decisions: [],
    proposalQueue: [],
    roadmapQueue: [],
    activity: [],
  };
}

export function normalizeMissionPacketWorkflow(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: MISSION_PACKET_WORKFLOW_SCHEMA_VERSION,
    decisions: Array.isArray(source.decisions)
      ? source.decisions.map(normalizeDecisionEntry).filter((entry) => entry.packetKey).slice(0, MAX_DECISIONS)
      : [],
    proposalQueue: Array.isArray(source.proposalQueue)
      ? source.proposalQueue.map(normalizeQueueEntry).filter((entry) => entry.id).slice(0, MAX_QUEUE_ITEMS)
      : [],
    roadmapQueue: Array.isArray(source.roadmapQueue)
      ? source.roadmapQueue.map(normalizeQueueEntry).filter((entry) => entry.id).slice(0, MAX_QUEUE_ITEMS)
      : [],
    activity: Array.isArray(source.activity)
      ? source.activity.map(normalizeActivityEntry).filter((entry) => entry.id).slice(0, MAX_ACTIVITY)
      : [],
  };
}

function appendActivity(state, summary, now) {
  const nextIndex = (state.activity?.length || 0) + 1;
  const entry = {
    id: `mission_packet_activity_${Date.parse(now)}_${nextIndex}`,
    type: 'mission-packet',
    summary,
    timestamp: now,
  };
  return [entry, ...state.activity].slice(0, MAX_ACTIVITY);
}

function upsertDecision(state, packetTruth, decision, now) {
  const packetKey = buildMissionPacketKey(packetTruth);
  const lifecycleStatus = decision === 'accept'
    ? 'execution-ready'
    : decision === 'reject'
      ? 'failed'
      : decision === 'defer'
        ? 'awaiting-approval'
        : decision === 'start'
          ? 'in-progress'
          : decision === 'complete'
            ? 'completed'
            : decision === 'fail'
              ? 'failed'
            : decision === 'rollback'
              ? 'rolled-back'
              : 'proposed';
  const nextDecision = {
    packetKey,
    moveId: packetTruth.moveId,
    moveTitle: packetTruth.moveTitle,
    decision,
    decidedAt: now,
    approvalRequired: packetTruth.approvalRequired,
    executionEligible: false,
    lifecycleStatus,
  };
  const remaining = state.decisions.filter((entry) => entry.packetKey !== packetKey);
  return [nextDecision, ...remaining].slice(0, MAX_DECISIONS);
}

function hasQueueEntry(queue = [], packetKey = '') {
  return queue.some((entry) => entry.packetKey === packetKey);
}

export function deriveMissionPacketActionState(workflowInput, packetTruthInput) {
  const workflow = normalizeMissionPacketWorkflow(workflowInput);
  const packetTruth = normalizeMissionPacketTruth(packetTruthInput);
  const packetKey = buildMissionPacketKey(packetTruth);
  const latestDecision = workflow.decisions.find((entry) => entry.packetKey === packetKey) || null;
  const packetReady = packetTruth.active && packetTruth.approvalRequired && packetTruth.executionEligible === false;
  const decision = latestDecision?.decision || 'pending-review';
  const lifecycleStatus = normalizeLifecycleStatus(latestDecision?.lifecycleStatus, packetReady ? 'awaiting-approval' : 'proposed');

  return {
    packetKey,
    decision,
    packetReady,
    canAccept: packetReady,
    canReject: packetReady,
    canDefer: packetReady,
    canCopyCodexHandoff: packetTruth.codexHandoffAvailable && packetTruth.codexHandoffPayload.length > 0,
    canPromote: decision === 'accept' && !hasQueueEntry(workflow.proposalQueue, packetKey),
    canStart: lifecycleStatus === 'execution-ready' || lifecycleStatus === 'accepted',
    canComplete: lifecycleStatus === 'in-progress',
    canFail: lifecycleStatus === 'in-progress',
    canRollback: lifecycleStatus === 'completed' || lifecycleStatus === 'failed' || lifecycleStatus === 'rollback-recommended',
    executionEligible: false,
    approvalRequired: packetTruth.approvalRequired,
    lifecycleStatus,
  };
}

export function applyMissionPacketAction(workflowInput, { action = '', packetTruth = {}, now = new Date().toISOString() } = {}) {
  const workflow = normalizeMissionPacketWorkflow(workflowInput);
  const packet = normalizeMissionPacketTruth(packetTruth);
  const gate = deriveMissionPacketActionState(workflow, packet);

  if (!gate.packetReady && !['copy-codex-handoff', 'prepare-codex-handoff', 'start', 'complete', 'fail', 'rollback'].includes(action)) {
    return workflow;
  }

  if (action === 'accept' || action === 'reject' || action === 'defer' || action === 'start' || action === 'complete' || action === 'fail' || action === 'rollback') {
    const nextDecisions = upsertDecision(workflow, packet, action, now);
    return normalizeMissionPacketWorkflow({
      ...workflow,
      decisions: nextDecisions,
      activity: appendActivity(workflow, `Operator ${action} mission packet ${packet.moveId || packet.mode}.`, now),
    });
  }

  if (action === 'copy-codex-handoff' || action === 'prepare-codex-handoff') {
    return normalizeMissionPacketWorkflow({
      ...workflow,
      activity: appendActivity(workflow, action === 'prepare-codex-handoff'
        ? `Operator prepared Codex handoff for ${packet.moveId || packet.mode}.`
        : `Operator copied Codex handoff for ${packet.moveId || packet.mode}.`, now),
    });
  }

  if (action === 'promote') {
    if (!gate.canPromote) {
      return workflow;
    }

    const queueId = `mission_packet_queue_${Date.parse(now)}_${packet.moveId || 'move'}`;
    const queueEntry = {
      id: queueId,
      packetKey: gate.packetKey,
      moveId: packet.moveId,
      moveTitle: packet.moveTitle || packet.moveId || 'mission-packet-move',
      status: 'queued',
      queuedAt: now,
      source: 'mission-packet-operator',
    };

    return normalizeMissionPacketWorkflow({
      ...workflow,
      proposalQueue: [queueEntry, ...workflow.proposalQueue].slice(0, MAX_QUEUE_ITEMS),
      roadmapQueue: [queueEntry, ...workflow.roadmapQueue].slice(0, MAX_QUEUE_ITEMS),
      activity: appendActivity(workflow, `Operator promoted mission packet ${packet.moveId || packet.mode} to proposal/roadmap queues.`, now),
    });
  }

  return workflow;
}
