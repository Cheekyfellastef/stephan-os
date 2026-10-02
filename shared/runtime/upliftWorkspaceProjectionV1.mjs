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
  const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  const hasToken = (value) => tokens.includes(value);
  const negatedPositive = hasToken('NOT') && ['CURRENT', 'ACTIVE', 'READY', 'PASS', 'HEALTHY', 'ONLINE', 'RUNNING', 'PROVED', 'COMPLETE']
    .some((value) => hasToken(value));

  if (negatedPositive || ['INCOMPLETE', 'UNPROVED', 'UNPROVEN', 'FAILED', 'FAILURE', 'BLOCKED', 'ERROR', 'CONFLICT', 'OFFLINE', 'STALLED']
    .some((value) => hasToken(value))) return 'CONFLICTING';
  if (['CURRENT', 'ACTIVE', 'READY', 'PASS', 'PASSED', 'HEALTHY', 'ONLINE', 'RUNNING', 'PROVED', 'COMPLETE', 'COMPLETED']
    .some((value) => hasToken(value))) return 'CURRENT';
  if (['STALE', 'DEGRADED', 'WAIT', 'WAITING', 'PARTIAL', 'CONNECTING', 'PENDING']
    .some((value) => hasToken(value))) return 'STALE';
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


function starfieldText(record = {}) {
  return [
    record.goalId,
    record.missionId,
    record.eventKind,
    record.summary,
    record.reason,
    record.title,
    record?.vrEvidence?.game,
    record?.vrEvidence?.route,
    record?.closedLoopLearning?.capabilityId,
    ...list(record?.closedLoopLearning?.targetRefs),
    ...list(record?.engineeringRecord?.applicableDomains),
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function isStarfieldRelevant(record = {}) {
  const haystack = starfieldText(record);
  return haystack.includes('starfield')
    || haystack.includes('starfield/vr')
    || record?.goalId === 'starfield-vr-outcome-ownership'
    || record?.outcomeOwnershipSeed?.missionId === 'starfield-vr-outcome-ownership';
}

function deriveOutcomeSeedGrowth(payload = {}) {
  const records = payload.records || {};
  const goals = list(records.goalRecords);
  const events = list(records.eventRecords);
  const lessons = list(records.lessonRecords);
  const proofs = list(records.proofRecords);
  const seedGoal = goals.find((record) => (
    record?.goalId === 'starfield-vr-outcome-ownership'
    && record?.outcomeOwnershipSeed?.schemaVersion === 'stephanos.starfield-vr-outcome-ownership-seed.v1'
  ));

  if (!seedGoal) {
    return Object.freeze({
      planted: false,
      missionId: 'starfield-vr-outcome-ownership',
      stage: 'UNKNOWN',
      sourceTruth: 'UNKNOWN',
      northStar: 'Continuously improve Starfield into the best VR experience achievable on the Battle Bridge while preserving safe operator control.',
      playtestEvidenceCount: 0,
      hypothesisCount: 0,
      experimentCount: 0,
      operatorObservationCount: 0,
      capabilityGapCount: 0,
      teachingLoopCount: 0,
      retryReadyCount: 0,
      retainedLessonCount: 0,
      promotedVrLessonCount: 0,
      proofCount: 0,
      currentGaps: Object.freeze([]),
      latestEvidenceAt: '',
      nextBestAction: 'Publish the Starfield VR Outcome Ownership seed into Shared Workspace.',
    });
  }

  const starfieldEvents = events.filter(isStarfieldRelevant);
  const playtests = starfieldEvents.filter((record) => record?.eventKind === 'vr-playtest-evidence' || record?.vrEvidence?.game === 'Starfield');
  const hypotheses = starfieldEvents.filter((record) => /hypothesis/i.test(`${record?.eventKind || ''} ${record?.summary || ''}`));
  const experiments = starfieldEvents.filter((record) => /experiment|playtest/i.test(`${record?.eventKind || ''} ${record?.summary || ''}`));
  const operatorObservations = starfieldEvents.filter((record) => /operator|human-observation|playtest-observation/i.test(
    `${record?.eventKind || ''} ${record?.participantId || ''} ${record?.summary || ''}`,
  ));
  const learningEvents = starfieldEvents.filter((record) => record?.closedLoopLearning);
  const gapEvents = starfieldEvents.filter((record) => (
    record?.closedLoopLearning?.learningEligibleCapabilityFailure === true
    || /capability[- ]gap|missing capability|unsupported/i.test(
      `${record?.eventKind || ''} ${record?.summary || ''} ${record?.reason || ''}`,
    )
  ));
  const retryReady = learningEvents.filter((record) => record?.closedLoopLearning?.telemetry?.retryReady === true);
  const starfieldLessons = lessons.filter(isStarfieldRelevant);
  const starfieldEventIds = new Set(starfieldEvents.map((record) => text(record?.eventId, '')).filter(Boolean));
  const promotedVrLessons = lessons.filter((record) => {
    const domains = list(record?.engineeringRecord?.applicableDomains).map((value) => text(value, '').toLowerCase());
    const sourceEventIds = list(record?.sourceEventIds).map((value) => text(value, ''));
    const vrGeneric = domains.some((domain) => domain === 'vr' || domain.startsWith('vr/'))
      && !domains.includes('starfield/vr');
    return vrGeneric && sourceEventIds.some((eventId) => starfieldEventIds.has(eventId));
  });
  const starfieldProofs = proofs.filter(isStarfieldRelevant);
  const relevantEvidence = [...starfieldEvents, ...starfieldLessons, ...starfieldProofs]
    .sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)));
  const currentGaps = gapEvents
    .filter((record) => record?.closedLoopLearning?.telemetry?.retryReady !== true)
    .slice(0, 6)
    .map((record) => Object.freeze({
      capabilityId: text(record?.closedLoopLearning?.capabilityId, text(record?.eventKind, 'capability-gap')),
      teacherId: text(record?.closedLoopLearning?.teacherId, 'UNKNOWN'),
      state: text(record?.closedLoopLearning?.state, 'OPEN'),
      summary: summary(record),
    }));

  let stage = 'GERMINATING';
  if (playtests.length > 0) stage = 'OBSERVING';
  if (gapEvents.length > 0 || learningEvents.length > 0) stage = 'LEARNING';
  if (retryReady.length > 0 || starfieldLessons.length > 0) stage = 'CAPABILITY_FORMING';
  if (playtests.length >= 3 && starfieldLessons.length >= 2) stage = 'ITERATING';

  const plantingEvent = starfieldEvents.find((record) => record?.eventKind === 'outcome-ownership-seed');
  const latest = relevantEvidence[0] || seedGoal;
  const nextBestAction = currentGaps[0]?.summary
    ? `Close the next evidenced capability gap: ${currentGaps[0].summary}`
    : retryReady.length > 0
      ? 'Replay the original Starfield VR task using the newly retained capability and capture runtime proof.'
      : playtests.length > 0
        ? 'Use the latest Starfield VR playtest evidence to choose the next bounded, reversible improvement experiment.'
        : text(plantingEvent?.outcomeOwnershipSeed?.nextBestAction, 'Capture the next real Starfield VR playtest so the seed can begin learning.');

  return Object.freeze({
    planted: true,
    missionId: 'starfield-vr-outcome-ownership',
    stage,
    sourceTruth: truthFromRecord(latest),
    northStar: text(seedGoal?.outcomeOwnershipSeed?.northStar, 'Make Starfield VR better through evidence-backed iteration.'),
    playtestEvidenceCount: playtests.length,
    hypothesisCount: hypotheses.length,
    experimentCount: experiments.length,
    operatorObservationCount: operatorObservations.length,
    capabilityGapCount: gapEvents.length,
    teachingLoopCount: learningEvents.length,
    retryReadyCount: retryReady.length,
    retainedLessonCount: starfieldLessons.length,
    promotedVrLessonCount: promotedVrLessons.length,
    proofCount: starfieldProofs.length + relevantEvidence.flatMap(proofRefs).length,
    currentGaps: Object.freeze(currentGaps),
    latestEvidenceAt: safeTime(latest),
    nextBestAction,
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
    totals: Object.freeze({
      gaps: capabilityGapsFor(allRecords(payload)).length,
      lessons: list(records.lessonRecords).length,
      receipts: list(records.receiptRecords).length,
      experiments: [
        ...list(records.eventRecords),
        ...list(records.statusRecords),
        ...list(records.capabilityRecords),
      ].filter((record) => /experiment|uplift|improv|proposal|promotion|candidate|replay|calibrat|exam|lesson/i.test(
        `${record.kind || ''} ${record.eventKind || ''} ${record.summary || ''} ${record.reason || ''} ${record.status || ''}`,
      )).length,
      interventions: operatorInterventionRecords(allRecords(payload)).length,
      proofs: list(records.proofRecords).length,
    }),
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
    outcomeSeedGrowth: deriveOutcomeSeedGrowth({}),
    capabilityGaps: Object.freeze([]),
    lessons: Object.freeze([]),
    receipts: Object.freeze([]),
    experiments: Object.freeze([]),
    operatorInterventions: Object.freeze([]),
    proofs: Object.freeze([]),
    sourceMesh: Object.freeze({
      recordCount: 0,
      goalRecords: 0,
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
    recordCount: allRecords(payload).length + list(records.goalRecords).length,
    goalRecords: list(records.goalRecords).length,
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
    outcomeSeedGrowth: deriveOutcomeSeedGrowth(payload),
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
      lessons: collections.totals.lessons,
      timelineEvents: list(records.eventRecords).length + list(records.receiptRecords).length + list(records.lessonRecords).length,
      capabilityGaps: collections.totals.gaps,
      receipts: collections.totals.receipts,
      experiments: collections.totals.experiments,
      operatorInterventions: collections.totals.interventions,
      proofs: collections.totals.proofs,
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
