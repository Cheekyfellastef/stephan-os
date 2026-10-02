import { buildAgentUpliftScorecardV1 } from '../agents/flywheelAgentUpliftV1.mjs';

export const UPLIFT_WORKSPACE_SCHEMA_V1 = 'stephanos.uplift-workspace.v1';

function text(value, fallback = 'UNKNOWN') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function safeTime(record = {}) {
  return text(record.timestampUtc || record.observedAtUtc || record.checkedAtUtc || record.updatedAtUtc || record.createdAt, '');
}

function actorId(record = {}) {
  return text(
    record.participantId
      || record.agentId
      || record.workerId
      || record.worker
      || record.ownerId
      || record.controllerId
      || record.actor,
    '',
  ).toLowerCase();
}

function missionId(record = {}) {
  return text(record.missionId || record.taskId || record.goalId || record.relatedIssue || record.task, '');
}

function summary(record = {}) {
  return text(
    record.summary
      || record.reason
      || record.message
      || record.eventKind
      || record.status
      || record.state,
    'Evidence record published.',
  );
}

function proofRefs(record = {}) {
  return list(record.proofRefs || record.evidenceRefs || record.testAndProofRefs).map((value) => text(value, '')).filter(Boolean);
}

function truthFromRecord(record = {}) {
  const raw = text(record.truth || record.freshness || record.status || record.state, 'UNKNOWN').toUpperCase();
  if (/CURRENT|ACTIVE|READY|PASS|HEALTHY|ONLINE|RUNNING|PROVED|COMPLETE/.test(raw)) return 'CURRENT';
  if (/STALE|DEGRADED|WAIT|PARTIAL|CONNECTING|PENDING/.test(raw)) return 'STALE';
  if (/BLOCK|FAIL|ERROR|CONFLICT|RED|OFFLINE|STALLED/.test(raw)) return 'CONFLICTING';
  return 'UNKNOWN';
}

function allRecords(payload = {}) {
  const records = payload.records || {};
  return [
    ...list(records.statusRecords),
    ...list(records.capabilityRecords),
    ...list(records.receiptRecords),
    ...list(records.eventRecords),
    ...list(records.lessonRecords),
    ...list(records.proofRecords),
  ];
}

function participantIds(payload = {}) {
  return [...new Set(allRecords(payload).map(actorId).filter(Boolean))];
}

function recordsForParticipant(payload = {}, participantId = '') {
  const id = text(participantId, '').toLowerCase();
  return allRecords(payload).filter((record) => actorId(record) === id);
}

function isGapRecord(record = {}) {
  return /capability[- ]?gap|missing(?: guarded)? capability|missing route|unsupported capability|unsupported route|capability blocked/i.test(
    `${record.eventKind || ''} ${record.kind || ''} ${record.reason || ''} ${record.summary || ''} ${record.status || ''} ${record.state || ''}`,
  );
}

function capabilityGapsFor(records = []) {
  return records
    .filter(isGapRecord)
    .map((record) => ({
      participantId: actorId(record) || 'UNKNOWN',
      missionId: missionId(record),
      kind: text(record.eventKind || record.kind || record.status, 'capability-gap'),
      summary: summary(record),
      truth: truthFromRecord(record),
      at: safeTime(record),
      proofRefs: Object.freeze(proofRefs(record)),
    }));
}

function executionReceiptsFor(records = []) {
  return records
    .filter((record) => /receipt/i.test(text(record.kind || record.schemaVersion || record.receiptType, '')))
    .map((record) => ({
      state: text(record.state || record.status, 'UNKNOWN'),
      phase: text(record.phase || record.currentPhase, ''),
      proofRefs: proofRefs(record),
    }));
}

function calibrationFor(records = []) {
  const calibration = records.find((record) => /calibrat|exam|question/i.test(
    `${record.kind || ''} ${record.statusId || ''} ${record.summary || ''}`,
  ));
  if (!calibration) return {};
  return {
    verdict: text(calibration.finalVerdict || calibration.verdict || calibration.status, 'UNKNOWN'),
    proofRefs: proofRefs(calibration),
    gaps: list(calibration.gaps || calibration.buildableGaps),
  };
}

function operatorInterventionRecords(records = []) {
  return records
    .filter((record) => /operator.*(required|intervention|rescue|approval)|approval.*operator|manual.*operator/i.test(
      `${record.reason || ''} ${record.summary || ''} ${record.nextAction || ''} ${record.eventKind || ''}`,
    ))
    .map((record) => ({
      participantId: actorId(record) || 'UNKNOWN',
      missionId: missionId(record),
      summary: summary(record),
      at: safeTime(record),
      truth: truthFromRecord(record),
    }));
}

function operatorInterventionCount(records = []) {
  return operatorInterventionRecords(records).length;
}

function latestByTime(records = []) {
  return [...records].sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)))[0] || null;
}

function buildParticipantUplift(payload = {}, participantId = '') {
  const records = recordsForParticipant(payload, participantId);
  const latest = latestByTime(records);
  const gaps = capabilityGapsFor(records);
  const receipts = executionReceiptsFor(records);
  const calibration = calibrationFor(records);
  const scorecard = buildAgentUpliftScorecardV1({
    participantId,
    missionId: missionId(latest || {}),
    executionReceipts: receipts,
    calibration,
    capabilityGaps: gaps,
    operatorInterventionCount: operatorInterventionCount(records),
    evidenceRefs: records.flatMap(proofRefs),
    rootCauseState: gaps.length ? 'UNKNOWN' : 'KNOWN',
  });
  const needCount = scorecard.dimensions.filter((entry) => entry.status === 'NEEDS_UPLIFT').length;
  return Object.freeze({
    participantId,
    truth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    latestMissionId: missionId(latest || {}),
    latestSummary: latest ? summary(latest) : 'No Shared Workspace evidence published for this participant.',
    proofCount: records.flatMap(proofRefs).length,
    evidenceCount: records.length,
    capabilityGapCount: gaps.length,
    capabilityGaps: Object.freeze(gaps),
    operatorInterventionCount: operatorInterventionCount(records),
    upliftNeedCount: needCount,
    dimensions: scorecard.dimensions,
  });
}

function recordCard(record = {}, type = 'RECORD') {
  return Object.freeze({
    type,
    at: safeTime(record),
    participantId: actorId(record) || 'UNKNOWN',
    missionId: missionId(record),
    summary: summary(record),
    proofCount: proofRefs(record).length,
    proofRefs: Object.freeze(proofRefs(record)),
    truth: truthFromRecord(record),
    state: text(record.state || record.status || record.finalVerdict, 'UNKNOWN'),
    kind: text(record.kind || record.eventKind || record.receiptType, type),
  });
}

function buildTimeline(payload = {}) {
  const records = payload.records || {};
  const timeline = [
    ...list(records.eventRecords).map((record) => ({ type: 'EVENT', record })),
    ...list(records.receiptRecords).map((record) => ({ type: 'RECEIPT', record })),
    ...list(records.lessonRecords).map((record) => ({ type: 'LESSON', record })),
  ]
    .sort((a, b) => Date.parse(safeTime(b.record)) - Date.parse(safeTime(a.record)))
    .slice(0, 24)
    .map(({ type, record }) => recordCard(record, type));
  return Object.freeze(timeline);
}

function deriveBrainBay(payload = {}) {
  const candidates = allRecords(payload)
    .filter((record) => /brain|model|reasoning|qwen|gpt-oss|ollama|cognition/i.test(
      `${record.kind || ''} ${record.summary || ''} ${record.model || ''} ${record.reason || ''}`,
    ))
    .sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)));
  const latest = candidates[0];
  if (!latest) {
    return Object.freeze({
      state: 'UNKNOWN',
      mode: 'UNKNOWN',
      model: 'UNKNOWN',
      reason: 'No current brain-use receipt is present in Shared Workspace history.',
      proofRefs: Object.freeze([]),
    });
  }
  return Object.freeze({
    state: truthFromRecord(latest),
    mode: text(latest.mode || latest.reasoningMode || latest.status, 'UNKNOWN'),
    model: text(latest.model || latest.modelId || latest.providerModel, 'UNKNOWN'),
    reason: summary(latest),
    proofRefs: Object.freeze(proofRefs(latest)),
  });
}

function deriveWorkspaceCollections(payload = {}) {
  const records = payload.records || {};
  const gaps = capabilityGapsFor(allRecords(payload))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 20);
  const lessons = list(records.lessonRecords)
    .sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)))
    .slice(0, 12)
    .map((record) => recordCard(record, 'LESSON'));
  const receipts = list(records.receiptRecords)
    .sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)))
    .slice(0, 12)
    .map((record) => recordCard(record, 'RECEIPT'));
  const experiments = [
    ...list(records.eventRecords),
    ...list(records.statusRecords),
    ...list(records.capabilityRecords),
  ]
    .filter((record) => /experiment|uplift|improv|proposal|promotion|candidate|replay|calibrat|exam|lesson/i.test(
      `${record.kind || ''} ${record.eventKind || ''} ${record.summary || ''} ${record.reason || ''} ${record.status || ''}`,
    ))
    .sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)))
    .slice(0, 12)
    .map((record) => recordCard(record, 'UPLIFT'));
  const interventions = operatorInterventionRecords(allRecords(payload))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 12);
  const proofs = list(records.proofRecords)
    .sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)))
    .slice(0, 12)
    .map((record) => recordCard(record, 'PROOF'));

  return {
    gaps: Object.freeze(gaps),
    lessons: Object.freeze(lessons),
    receipts: Object.freeze(receipts),
    experiments: Object.freeze(experiments),
    interventions: Object.freeze(interventions),
    proofs: Object.freeze(proofs),
  };
}

function emptyWorkspaceView(payload = {}) {
  return Object.freeze({
    schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
    valid: false,
    sourceTruth: 'UNKNOWN',
    participants: Object.freeze([]),
    timeline: Object.freeze([]),
    brainBay: deriveBrainBay({}),
    capabilityGaps: Object.freeze([]),
    lessons: Object.freeze([]),
    receipts: Object.freeze([]),
    experiments: Object.freeze([]),
    operatorInterventions: Object.freeze([]),
    proofs: Object.freeze([]),
    sourceMesh: Object.freeze({
      recordCount: 0,
      statusRecords: 0,
      capabilityRecords: 0,
      receiptRecords: 0,
      eventRecords: 0,
      lessonRecords: 0,
      proofRecords: 0,
    }),
    stats: Object.freeze({
      observedAgents: 0,
      agentsNeedingUplift: 0,
      lessons: 0,
      timelineEvents: 0,
      capabilityGaps: 0,
      receipts: 0,
      experiments: 0,
      operatorInterventions: 0,
      proofs: 0,
    }),
    exactNextAction: text(payload?.exactNextAction, 'Restore the canonical Shared Workspace feed.'),
  });
}

export function deriveFlywheelWorkspaceView(payload = {}) {
  const valid = payload?.schemaVersion === 'stephanos.shared-workspace-dashboard-feed.v1'
    && ['ready', 'stale'].includes(String(payload?.state || '').toLowerCase())
    && payload?.records && typeof payload.records === 'object';
  if (!valid) return emptyWorkspaceView(payload);

  const participants = participantIds(payload).map((id) => buildParticipantUplift(payload, id));
  const timeline = buildTimeline(payload);
  const collections = deriveWorkspaceCollections(payload);
  const records = payload.records || {};
  const sourceMesh = Object.freeze({
    recordCount: allRecords(payload).length,
    statusRecords: list(records.statusRecords).length,
    capabilityRecords: list(records.capabilityRecords).length,
    receiptRecords: list(records.receiptRecords).length,
    eventRecords: list(records.eventRecords).length,
    lessonRecords: list(records.lessonRecords).length,
    proofRecords: list(records.proofRecords).length,
  });

  return Object.freeze({
    schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
    valid: true,
    sourceTruth: String(payload.state).toLowerCase() === 'ready' ? 'CURRENT' : 'STALE',
    participants: Object.freeze(participants),
    timeline,
    brainBay: deriveBrainBay(payload),
    capabilityGaps: collections.gaps,
    lessons: collections.lessons,
    receipts: collections.receipts,
    experiments: collections.experiments,
    operatorInterventions: collections.interventions,
    proofs: collections.proofs,
    sourceMesh,
    stats: Object.freeze({
      observedAgents: participants.length,
      agentsNeedingUplift: participants.filter((entry) => entry.upliftNeedCount > 0 || entry.capabilityGapCount > 0).length,
      lessons: collections.lessons.length,
      timelineEvents: timeline.length,
      capabilityGaps: collections.gaps.length,
      receipts: collections.receipts.length,
      experiments: collections.experiments.length,
      operatorInterventions: collections.interventions.length,
      proofs: collections.proofs.length,
    }),
    exactNextAction: text(payload.exactNextAction, 'No operator action is currently published.'),
  });
}

function normalizeLiveAgent(agent = {}) {
  return Object.freeze({
    agentId: text(agent.agentId, 'unknown-agent'),
    displayName: text(agent.displayName || agent.agentId, 'Unknown agent'),
    role: text(agent.kind || agent.role, 'UNKNOWN'),
    state: text(agent.state, 'UNKNOWN'),
    stateReason: text(agent.stateReason, 'No runtime state reason published.'),
    enabled: agent.enabled === true,
    eligible: agent.eligible === true,
    acting: agent.acting === true,
    capabilities: Object.freeze(list(agent.capabilities).map((value) => text(value, '')).filter(Boolean)),
  });
}

export function deriveAgentsWorkspaceView({ payload = {}, finalAgentView = {} } = {}) {
  const flywheel = deriveFlywheelWorkspaceView(payload);
  const visibleAgents = list(finalAgentView.visibleAgents).map(normalizeLiveAgent);
  const evidenceById = new Map(flywheel.participants.map((entry) => [entry.participantId.toLowerCase(), entry]));
  const agents = visibleAgents.map((agent) => {
    const evidence = evidenceById.get(agent.agentId.toLowerCase()) || null;
    return Object.freeze({
      ...agent,
      sharedWorkspaceTruth: evidence?.truth || 'UNKNOWN',
      latestMissionId: evidence?.latestMissionId || 'UNKNOWN',
      latestSummary: evidence?.latestSummary || 'No matching Shared Workspace participant evidence.',
      proofCount: evidence?.proofCount || 0,
      capabilityGapCount: evidence?.capabilityGapCount || 0,
      operatorInterventionCount: evidence?.operatorInterventionCount || 0,
      upliftNeedCount: evidence?.upliftNeedCount || 0,
      dimensions: evidence?.dimensions || Object.freeze([]),
    });
  });
  const unregisteredEvidence = flywheel.participants
    .filter((entry) => !visibleAgents.some((agent) => agent.agentId.toLowerCase() === entry.participantId.toLowerCase()))
    .map((entry) => Object.freeze({
      agentId: entry.participantId,
      displayName: entry.participantId,
      role: 'SHARED_WORKSPACE_PARTICIPANT',
      state: 'UNKNOWN',
      stateReason: 'Participant has Shared Workspace evidence but is not present in the current runtime visible-agent projection.',
      enabled: false,
      eligible: false,
      acting: false,
      capabilities: Object.freeze([]),
      sharedWorkspaceTruth: entry.truth,
      latestMissionId: entry.latestMissionId || 'UNKNOWN',
      latestSummary: entry.latestSummary,
      proofCount: entry.proofCount,
      capabilityGapCount: entry.capabilityGapCount,
      operatorInterventionCount: entry.operatorInterventionCount,
      upliftNeedCount: entry.upliftNeedCount,
      dimensions: entry.dimensions,
    }));
  return Object.freeze({
    schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
    valid: flywheel.valid || visibleAgents.length > 0,
    sourceTruth: flywheel.sourceTruth,
    actingAgentId: text(finalAgentView.actingAgentId, 'UNKNOWN'),
    agents: Object.freeze([...agents, ...unregisteredEvidence]),
    timeline: flywheel.timeline,
    stats: Object.freeze({
      runtimeVisibleAgents: visibleAgents.length,
      sharedWorkspaceParticipants: flywheel.participants.length,
      agentsNeedingUplift: [...agents, ...unregisteredEvidence].filter((entry) => entry.upliftNeedCount > 0 || entry.capabilityGapCount > 0).length,
      actingAgents: visibleAgents.filter((entry) => entry.acting).length,
    }),
    exactNextAction: flywheel.exactNextAction,
  });
}
