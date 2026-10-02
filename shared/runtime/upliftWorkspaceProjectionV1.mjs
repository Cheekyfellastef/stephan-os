import { buildAgentUpliftScorecardV1 } from '../agents/flywheelAgentUpliftV1.mjs';
import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipContractV1,
} from './starfieldVrOutcomeOwnershipContractV1.mjs';

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
  if (/CURRENT|ACTIVE|READY|PASS|HEALTHY|ONLINE|RUNNING/.test(raw)) return 'CURRENT';
  if (/STALE|DEGRADED|WAIT|PARTIAL/.test(raw)) return 'STALE';
  if (/BLOCK|FAIL|ERROR|CONFLICT|RED|OFFLINE/.test(raw)) return 'CONFLICTING';
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

function capabilityGapsFor(records = []) {
  return records
    .filter((record) => /gap|missing|blocked|unsupported|capability/i.test(
      `${record.eventKind || ''} ${record.kind || ''} ${record.reason || ''} ${record.summary || ''} ${record.status || ''}`,
    ))
    .map((record) => ({
      kind: text(record.eventKind || record.kind || record.status, 'capability-gap'),
      summary: summary(record),
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

function operatorInterventionCount(records = []) {
  return records.filter((record) => /operator.*(required|intervention|rescue|approval)/i.test(
    `${record.reason || ''} ${record.summary || ''} ${record.nextAction || ''}`,
  )).length;
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
    operatorInterventionCount: operatorInterventionCount(records),
    upliftNeedCount: needCount,
    dimensions: scorecard.dimensions,
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
    .slice(0, 18)
    .map(({ type, record }) => Object.freeze({
      type,
      at: safeTime(record),
      participantId: actorId(record) || 'UNKNOWN',
      missionId: missionId(record),
      summary: summary(record),
      proofCount: proofRefs(record).length,
      truth: truthFromRecord(record),
    }));
  return Object.freeze(timeline);
}

function deriveBrainBay(payload = {}) {
  const candidates = allRecords(payload)
    .filter((record) => /brain|model|reasoning|qwen|gpt-oss|ollama/i.test(
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
    || record?.goalId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID
    || record?.outcomeOwnershipSeed?.missionId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID;
}

function deriveOutcomeSeedGrowth(payload = {}) {
  const records = payload.records || {};
  const goals = list(records.goalRecords);
  const events = list(records.eventRecords);
  const lessons = list(records.lessonRecords);
  const proofs = list(records.proofRecords);
  const seedGoal = goals.find((record) => (
    record?.goalId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID
    && record?.outcomeOwnershipSeed?.schemaVersion === STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1
  ));
  const declaredContract = buildStarfieldVrOutcomeOwnershipContractV1();
  if (!seedGoal) {
    return Object.freeze({
      declared: true,
      contractTruth: 'SOURCE_PROVEN',
      planted: false,
      missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      stage: 'AWAITING_LIVE_PROOF',
      sourceTruth: 'UNKNOWN',
      northStar: declaredContract.northStar,
      preservedRoutes: declaredContract.preservedRoutes,
      operatingLoop: declaredContract.operatingLoop,
      qualityDimensions: declaredContract.qualityDimensions,
      operatorRole: declaredContract.operatorRole,
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
      nextBestAction: 'Establish the live Shared Workspace feed and publish the seed heartbeat; until then the mission contract is source-proven and growth remains UNKNOWN.',
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

  const liveContract = seedGoal?.outcomeOwnershipSeed || declaredContract;
  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted: true,
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    stage,
    sourceTruth: truthFromRecord(latest),
    northStar: text(liveContract?.northStar, declaredContract.northStar),
    preservedRoutes: Object.freeze(list(liveContract?.preservedRoutes).length ? list(liveContract.preservedRoutes) : [...declaredContract.preservedRoutes]),
    operatingLoop: Object.freeze(list(liveContract?.operatingLoop).length ? list(liveContract.operatingLoop) : [...declaredContract.operatingLoop]),
    qualityDimensions: Object.freeze(list(liveContract?.qualityDimensions).length ? list(liveContract.qualityDimensions) : [...declaredContract.qualityDimensions]),
    operatorRole: text(liveContract?.operatorRole, declaredContract.operatorRole),
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

export function deriveFlywheelWorkspaceView(payload = {}) {
  const valid = payload?.schemaVersion === 'stephanos.shared-workspace-dashboard-feed.v1'
    && ['ready', 'stale'].includes(String(payload?.state || '').toLowerCase())
    && payload?.records && typeof payload.records === 'object';
  if (!valid) {
    return Object.freeze({
      schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
      valid: false,
      sourceTruth: 'UNKNOWN',
      participants: Object.freeze([]),
      timeline: Object.freeze([]),
      brainBay: deriveBrainBay({}),
      outcomeSeedGrowth: deriveOutcomeSeedGrowth({}),
      stats: Object.freeze({ observedAgents: 0, agentsNeedingUplift: 0, lessons: 0, timelineEvents: 0 }),
      exactNextAction: text(payload?.exactNextAction, 'Restore the canonical Shared Workspace feed.'),
    });
  }
  const participants = participantIds(payload).map((id) => buildParticipantUplift(payload, id));
  const timeline = buildTimeline(payload);
  return Object.freeze({
    schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
    valid: true,
    sourceTruth: String(payload.state).toLowerCase() === 'ready' ? 'CURRENT' : 'STALE',
    participants: Object.freeze(participants),
    timeline,
    brainBay: deriveBrainBay(payload),
    outcomeSeedGrowth: deriveOutcomeSeedGrowth(payload),
    stats: Object.freeze({
      observedAgents: participants.length,
      agentsNeedingUplift: participants.filter((entry) => entry.upliftNeedCount > 0 || entry.capabilityGapCount > 0).length,
      lessons: list(payload.records?.lessonRecords).length,
      timelineEvents: timeline.length,
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
