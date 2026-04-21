const MISSION_PACKET_WORKFLOW_SCHEMA_VERSION = 2;
const MAX_DECISIONS = 24;
const MAX_ACTIVITY = 40;
const MAX_QUEUE_ITEMS = 20;
const MAX_CODEX_HANDOFFS = 20;
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
const CODEX_HANDOFF_STATUSES = Object.freeze([
  'not-generated',
  'generated',
  'handed-off',
  'applied',
  'validated',
  'failed',
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

function normalizeCodexHandoffStatus(value, fallback = 'not-generated') {
  const normalized = safeText(value, fallback).toLowerCase();
  return CODEX_HANDOFF_STATUSES.includes(normalized) ? normalized : fallback;
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

function parsePatchMetadata(payload) {
  const raw = safeText(payload);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const patchMetadata = parsed.patchMetadata && typeof parsed.patchMetadata === 'object'
        ? parsed.patchMetadata
        : parsed.patch && typeof parsed.patch === 'object'
          ? parsed.patch
          : null;
      if (!patchMetadata) return null;
      return {
        files: safeList(patchMetadata.files, 12),
        estimatedChanges: safeText(patchMetadata.estimatedChanges),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeCodexHandoffEntry(entry = {}) {
  const patchMetadata = entry.patchMetadata && typeof entry.patchMetadata === 'object'
    ? {
      files: safeList(entry.patchMetadata.files, 12),
      estimatedChanges: safeText(entry.patchMetadata.estimatedChanges),
    }
    : null;
  return {
    handoffId: safeText(entry.handoffId),
    missionPacketId: safeText(entry.missionPacketId),
    packetKey: safeText(entry.packetKey),
    status: normalizeCodexHandoffStatus(entry.status, 'not-generated'),
    validationStatus: safeText(entry.validationStatus, 'not-run'),
    lastOperatorAction: safeText(entry.lastOperatorAction),
    summary: safeText(entry.summary),
    payload: safeText(entry.payload),
    patchMetadata,
    createdAt: safeText(entry.createdAt),
    updatedAt: safeText(entry.updatedAt),
  };
}

export function createDefaultMissionPacketWorkflow() {
  return {
    schemaVersion: MISSION_PACKET_WORKFLOW_SCHEMA_VERSION,
    operatorIntentCapture: {
      status: 'idle',
      approved: false,
      intentLabel: '',
      missionType: '',
      missionTitle: '',
      missionClass: '',
      executionMode: '',
      packetSummary: '',
      capturedAt: '',
      approvedAt: '',
    },
    decisions: [],
    proposalQueue: [],
    roadmapQueue: [],
    activity: [],
    codexHandoffs: [],
  };
}

export function normalizeMissionPacketWorkflow(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const operatorIntentCapture = source.operatorIntentCapture && typeof source.operatorIntentCapture === 'object'
    ? source.operatorIntentCapture
    : {};
  return {
    schemaVersion: MISSION_PACKET_WORKFLOW_SCHEMA_VERSION,
    operatorIntentCapture: {
      status: safeText(operatorIntentCapture.status, 'idle'),
      approved: operatorIntentCapture.approved === true,
      intentLabel: safeText(operatorIntentCapture.intentLabel),
      missionType: safeText(operatorIntentCapture.missionType),
      missionTitle: safeText(operatorIntentCapture.missionTitle),
      missionClass: safeText(operatorIntentCapture.missionClass),
      executionMode: safeText(operatorIntentCapture.executionMode),
      packetSummary: safeText(operatorIntentCapture.packetSummary),
      capturedAt: safeText(operatorIntentCapture.capturedAt),
      approvedAt: safeText(operatorIntentCapture.approvedAt),
    },
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
    codexHandoffs: Array.isArray(source.codexHandoffs)
      ? source.codexHandoffs.map(normalizeCodexHandoffEntry).filter((entry) => entry.handoffId).slice(0, MAX_CODEX_HANDOFFS)
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

function getLatestHandoff(workflow, packetKey) {
  return (Array.isArray(workflow?.codexHandoffs) ? workflow.codexHandoffs : []).find((entry) => entry.packetKey === packetKey) || null;
}

export function deriveMissionPacketActionState(workflowInput, packetTruthInput) {
  const workflow = normalizeMissionPacketWorkflow(workflowInput);
  const packetTruth = normalizeMissionPacketTruth(packetTruthInput);
  const packetKey = buildMissionPacketKey(packetTruth);
  const latestDecision = workflow.decisions.find((entry) => entry.packetKey === packetKey) || null;
  const latestHandoff = getLatestHandoff(workflow, packetKey);
  const packetReady = packetTruth.active && packetTruth.approvalRequired && packetTruth.executionEligible === false;
  const decision = latestDecision?.decision || 'pending-review';
  const handoffStatus = normalizeCodexHandoffStatus(latestHandoff?.status, 'not-generated');
  const lifecycleStatus = normalizeLifecycleStatus(
    handoffStatus === 'validated'
      ? 'completed'
      : handoffStatus === 'applied'
        ? 'in-progress'
        : handoffStatus === 'failed'
          ? 'rollback-recommended'
          : handoffStatus === 'rolled-back'
            ? 'rolled-back'
            : latestDecision?.lifecycleStatus,
    packetReady ? 'awaiting-approval' : 'proposed',
  );

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
    canMarkHandoffApplied: handoffStatus === 'generated' || handoffStatus === 'handed-off',
    canMarkHandoffFailed: handoffStatus === 'generated' || handoffStatus === 'handed-off' || handoffStatus === 'applied',
    canMarkHandoffRolledBack: handoffStatus === 'failed' || lifecycleStatus === 'rollback-recommended' || lifecycleStatus === 'failed',
    canConfirmValidationPassed: handoffStatus === 'applied',
    canConfirmValidationFailed: handoffStatus === 'applied',
    executionEligible: false,
    approvalRequired: packetTruth.approvalRequired,
    lifecycleStatus,
    codexHandoffStatus: handoffStatus,
    validationStatus: safeText(latestHandoff?.validationStatus, 'not-run'),
    lastHandoffAction: safeText(latestHandoff?.lastOperatorAction),
  };
}

function upsertCodexHandoff(workflow, packet, packetKey, now, updates = {}) {
  const existing = getLatestHandoff(workflow, packetKey);
  const handoffId = safeText(existing?.handoffId, `codex_handoff_${Date.parse(now)}_${packet.moveId || 'move'}`);
  const next = normalizeCodexHandoffEntry({
    handoffId,
    missionPacketId: safeText(packet.moveId || packetKey),
    packetKey,
    status: updates.status ?? existing?.status ?? 'not-generated',
    validationStatus: updates.validationStatus ?? existing?.validationStatus ?? 'not-run',
    lastOperatorAction: updates.lastOperatorAction ?? existing?.lastOperatorAction ?? '',
    summary: updates.summary ?? existing?.summary ?? safeText(packet.codexPromptSummary || packet.rationale || packet.moveTitle, 'Codex handoff packet generated by operator action.'),
    payload: updates.payload ?? existing?.payload ?? safeText(packet.codexHandoffPayload),
    patchMetadata: updates.patchMetadata ?? existing?.patchMetadata ?? parsePatchMetadata(packet.codexHandoffPayload),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  const remaining = workflow.codexHandoffs.filter((entry) => entry.handoffId !== handoffId);
  return [next, ...remaining].slice(0, MAX_CODEX_HANDOFFS);
}

export function applyMissionPacketAction(workflowInput, { action = '', packetTruth = {}, now = new Date().toISOString() } = {}) {
  const workflow = normalizeMissionPacketWorkflow(workflowInput);
  const packet = normalizeMissionPacketTruth(packetTruth);
  const gate = deriveMissionPacketActionState(workflow, packet);

  if (!gate.packetReady && !['copy-codex-handoff', 'prepare-codex-handoff', 'start', 'complete', 'fail', 'rollback', 'mark-handoff-applied', 'mark-handoff-failed', 'mark-handoff-rolled-back', 'confirm-validation-passed', 'confirm-validation-failed'].includes(action)) {
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
    const packetKey = buildMissionPacketKey(packet);
    const status = action === 'prepare-codex-handoff' ? 'generated' : 'handed-off';
    return normalizeMissionPacketWorkflow({
      ...workflow,
      codexHandoffs: upsertCodexHandoff(workflow, packet, packetKey, now, {
        status,
        validationStatus: 'not-run',
        lastOperatorAction: action,
      }),
      activity: appendActivity(workflow, action === 'prepare-codex-handoff'
        ? `Operator prepared Codex handoff for ${packet.moveId || packet.mode}.`
        : `Operator copied Codex handoff for ${packet.moveId || packet.mode}.`, now),
    });
  }

  if (action === 'mark-handoff-applied' || action === 'mark-handoff-failed' || action === 'mark-handoff-rolled-back' || action === 'confirm-validation-passed' || action === 'confirm-validation-failed') {
    const packetKey = buildMissionPacketKey(packet);
    const status = action === 'mark-handoff-applied'
      ? 'applied'
      : action === 'mark-handoff-failed' || action === 'confirm-validation-failed'
        ? 'failed'
        : action === 'mark-handoff-rolled-back'
          ? 'rolled-back'
          : 'validated';
    const lifecycleAction = action === 'mark-handoff-applied'
      ? 'start'
      : action === 'mark-handoff-failed'
        ? 'fail'
        : action === 'mark-handoff-rolled-back'
          ? 'rollback'
          : action === 'confirm-validation-passed'
            ? 'complete'
            : 'fail';
    const nextDecisions = upsertDecision(workflow, packet, lifecycleAction, now);
    return normalizeMissionPacketWorkflow({
      ...workflow,
      decisions: nextDecisions,
      codexHandoffs: upsertCodexHandoff(workflow, packet, packetKey, now, {
        status,
        validationStatus: action === 'confirm-validation-passed'
          ? 'passed'
          : action === 'confirm-validation-failed'
            ? 'failed'
            : 'not-run',
        lastOperatorAction: action,
      }),
      activity: appendActivity(workflow, `Operator ${action.replaceAll('-', ' ')} for ${packet.moveId || packet.mode}.`, now),
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
