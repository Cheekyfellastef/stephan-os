import { buildAgentUpliftScorecardV1 } from '../agents/flywheelAgentUpliftV1.mjs';
import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipContractV1,
} from './starfieldVrOutcomeOwnershipContractV1.mjs';

export const UPLIFT_WORKSPACE_SCHEMA_V1 = 'stephanos.uplift-workspace.v1';

export const WHOLE_SYSTEM_CAPABILITY_CLOSURE_MISSION_ID = 'stephanos-whole-system-capability-closure';
export const WHOLE_SYSTEM_CAPABILITY_CLOSURE_ISSUE = '#2670';
export const WHOLE_SYSTEM_CAPABILITY_CLOSURE_TITLE = 'Stephanos Whole-System Capability Closure';
const WHOLE_SYSTEM_CAPABILITY_CLOSURE_NORTH_STAR = 'Continuously discover, diagnose, own and close material gaps across Stephanos while preserving canonical ownership, evidence-backed truth and operator approval boundaries.';
const WHOLE_SYSTEM_CAPABILITY_CLOSURE_LOOP = Object.freeze(['OBSERVE', 'DETECT', 'DEDUP', 'OWN', 'REPAIR', 'PROVE', 'LEARN', 'REPLAN', 'REPEAT']);
const WHOLE_SYSTEM_CAPABILITY_CLOSURE_DIMENSIONS = Object.freeze([
  'outcome-ownership',
  'gap-discovery',
  'gap-ownership',
  'diagnosis',
  'construction-reach',
  'proof-discipline',
  'learning-retention',
  'retry-and-replanning',
  'regression-detection',
  'product-visibility',
  'sovereignty',
  'architecture-integrity',
  'capability-frontier',
  'operator-role',
  'continuity',
]);

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

function recordTimeMs(record = {}) {
  const parsed = Date.parse(safeTime(record));
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalGapId(record = {}) {
  return text(
    record.rootGapId
      || record.gapId
      || record.capabilityId
      || record?.closedLoopLearning?.capabilityId
      || record?.flywheelImprovementCandidate?.rootGapId
      || record?.flywheelImprovementCandidate?.candidateId
      || record?.learningCandidate?.rootGapId
      || record?.learningCandidate?.candidateId,
    '',
  ).toLowerCase();
}

function resolvedGapIds(record = {}) {
  return [
    record.resolvedGapId,
    record.supersedesGapId,
    record.closureOf,
    ...list(record.rootGapRefs),
    ...list(record.resolvedGapRefs),
    ...list(record.supersedes),
  ].map((value) => text(value, '').toLowerCase()).filter(Boolean);
}

function gapIdentity(record = {}, index = 0) {
  const explicit = canonicalGapId(record);
  if (explicit) return explicit;
  const stableRecordId = text(record.eventId || record.receiptId || record.recordId || record.id, '').toLowerCase();
  if (stableRecordId) return `record:${stableRecordId}`;
  const normalized = summary(record).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96);
  return `historical:${normalized || 'gap'}:${index}`;
}

function isGapSignal(record = {}) {
  if (record?.closedLoopLearning?.learningEligibleCapabilityFailure === true) return true;
  if (record?.flywheelImprovementCandidate?.requiresExistingGoalSearch === true) return true;
  if (record?.learningCandidate?.requiresExistingGoalSearch === true) return true;
  return /capability[- ]gap|missing capability|unsupported|blocked|needs[_ -]?uplift/i.test(
    `${record.eventKind || ''} ${record.kind || ''} ${record.reason || ''} ${record.summary || ''} ${record.status || ''} ${record.state || ''}`,
  );
}

function isRecoverySignal(record = {}) {
  if (record?.closedLoopLearning?.telemetry?.retryReady === true) return true;
  return /resolved|recovered|repaired|verified|proved|passed|complete|completed|retry[-_ ]?ready|closed/i.test(
    `${record.state || ''} ${record.status || ''} ${record.verdict || ''} ${record.finalVerdict || ''} ${record.phase || ''} ${record.eventKind || ''}`,
  );
}

function deriveGapHistory(records = []) {
  const ordered = [...records].sort((a, b) => recordTimeMs(a) - recordTimeMs(b));
  const gaps = ordered
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isGapSignal(record))
    .map(({ record, index }) => ({
      gapId: gapIdentity(record, index),
      record,
      atMs: recordTimeMs(record),
    }));

  const history = gaps.map((gap) => {
    const matchingRecovery = ordered.find((record) => {
      if (recordTimeMs(record) <= gap.atMs || !isRecoverySignal(record)) return false;
      const direct = canonicalGapId(record);
      const explicitResolved = resolvedGapIds(record);
      return (direct && direct === gap.gapId) || explicitResolved.includes(gap.gapId);
    });
    const record = gap.record;
    return Object.freeze({
      gapId: gap.gapId,
      capabilityId: text(record.capabilityId || record?.closedLoopLearning?.capabilityId || record.eventKind || record.kind, 'capability-gap'),
      kind: text(record.eventKind || record.kind || record.status, 'capability-gap'),
      summary: summary(record),
      owner: text(
        record.canonicalOwner
          || record.repairOwner
          || record.ownerId
          || record?.flywheelImprovementCandidate?.owner
          || record?.learningCandidate?.owner
          || record?.closedLoopLearning?.teacherId,
        'UNKNOWN',
      ),
      state: matchingRecovery ? 'RESOLVED' : text(record.state || record.status, 'OPEN'),
      observedAtUtc: safeTime(record),
      resolvedAtUtc: matchingRecovery ? safeTime(matchingRecovery) : '',
      proofRefs: Object.freeze(proofRefs(record)),
      resolvedByProofRefs: Object.freeze(matchingRecovery ? proofRefs(matchingRecovery) : []),
      current: !matchingRecovery,
    });
  });

  const latestByGap = new Map();
  history.forEach((entry) => latestByGap.set(entry.gapId, entry));
  const deduped = [...latestByGap.values()];
  return Object.freeze({
    current: Object.freeze(deduped.filter((entry) => entry.current)),
    resolved: Object.freeze(deduped.filter((entry) => !entry.current)),
    history: Object.freeze(deduped),
  });
}

function receiptIdentity(record = {}, index = 0) {
  return text(
    record.operationId
      || record.correlationId
      || record.requestId
      || record.taskId
      || record.goalId
      || record.missionId
      || record.receiptId,
    `receipt:${index}`,
  ).toLowerCase();
}

function executionReceiptsFor(records = []) {
  const receipts = records.filter((record) => /receipt/i.test(text(record.kind || record.schemaVersion || record.receiptType, '')));
  const latestByIdentity = new Map();
  receipts
    .map((record, index) => ({ record, index }))
    .sort((a, b) => recordTimeMs(a.record) - recordTimeMs(b.record))
    .forEach(({ record, index }) => latestByIdentity.set(receiptIdentity(record, index), record));
  return [...latestByIdentity.values()].map((record) => ({
    state: text(record.state || record.status, 'UNKNOWN'),
    phase: text(record.phase || record.currentPhase, ''),
    proofRefs: proofRefs(record),
  }));
}

function calibrationFor(records = []) {
  const calibration = latestByTime(records.filter((record) => /calibrat|exam|question/i.test(
    `${record.kind || ''} ${record.statusId || ''} ${record.summary || ''}`,
  )));
  if (!calibration) return {};
  return {
    verdict: text(calibration.finalVerdict || calibration.verdict || calibration.status, 'UNKNOWN'),
    proofRefs: proofRefs(calibration),
    gaps: list(calibration.gaps || calibration.buildableGaps),
  };
}

function operatorInterventionCount(records = []) {
  const interventionRecords = records.filter((record) => /operator.*(required|intervention|rescue|approval)/i.test(
    `${record.reason || ''} ${record.summary || ''} ${record.nextAction || ''}`,
  ));
  return interventionRecords.filter((intervention, index) => {
    const key = text(
      intervention.operationId
        || intervention.correlationId
        || intervention.requestId
        || intervention.taskId
        || intervention.goalId
        || intervention.missionId
        || intervention.eventId,
      `operator-intervention:${index}`,
    ).toLowerCase();
    const at = recordTimeMs(intervention);
    return !records.some((record, recordIndex) => {
      if (recordTimeMs(record) <= at || !isRecoverySignal(record)) return false;
      const recoveryKey = text(
        record.operationId
          || record.correlationId
          || record.requestId
          || record.taskId
          || record.goalId
          || record.missionId
          || record.eventId,
        `record:${recordIndex}`,
      ).toLowerCase();
      return recoveryKey === key;
    });
  }).length;
}

function latestByTime(records = []) {
  return [...records].sort((a, b) => Date.parse(safeTime(b)) - Date.parse(safeTime(a)))[0] || null;
}

function upliftPriorityFor({ needCount = 0, currentGapCount = 0, interventionCount = 0, unknownCount = 0 } = {}) {
  if (currentGapCount >= 2 || needCount >= 4 || interventionCount >= 2) return 'CRITICAL';
  if (currentGapCount > 0 || needCount >= 2) return 'HIGH';
  if (needCount > 0 || interventionCount > 0) return 'MEDIUM';
  if (unknownCount >= 3) return 'WATCH';
  return unknownCount > 0 ? 'UNKNOWN' : 'CURRENT';
}

function buildParticipantUplift(payload = {}, participantId = '') {
  const records = recordsForParticipant(payload, participantId);
  const latest = latestByTime(records);
  const gapHistory = deriveGapHistory(records);
  const gaps = gapHistory.current;
  const receipts = executionReceiptsFor(records);
  const calibration = calibrationFor(records);
  const interventionCount = operatorInterventionCount(records);
  const scorecard = buildAgentUpliftScorecardV1({
    participantId,
    missionId: missionId(latest || {}),
    executionReceipts: receipts,
    calibration,
    capabilityGaps: gaps,
    operatorInterventionCount: interventionCount,
    evidenceRefs: records.flatMap(proofRefs),
    rootCauseState: gaps.length ? 'UNKNOWN' : 'KNOWN',
  });
  const dimensionsNeedingUplift = scorecard.dimensions.filter((entry) => entry.status === 'NEEDS_UPLIFT').map((entry) => entry.id);
  const evidencedDimensions = scorecard.dimensions.filter((entry) => entry.status === 'EVIDENCED').map((entry) => entry.id);
  const unknownDimensions = scorecard.dimensions.filter((entry) => entry.status === 'UNKNOWN').map((entry) => entry.id);
  const needCount = dimensionsNeedingUplift.length;
  const upliftPriority = upliftPriorityFor({
    needCount,
    currentGapCount: gaps.length,
    interventionCount,
    unknownCount: unknownDimensions.length,
  });
  const upliftState = needCount > 0 || gaps.length > 0
    ? 'NEEDS_UPLIFT'
    : unknownDimensions.length === scorecard.dimensions.length
      ? 'UNKNOWN'
      : 'EVIDENCED';
  const firstGap = gaps[0];
  const nextUpliftAction = firstGap
    ? `Close ${firstGap.capabilityId} through canonical owner ${firstGap.owner}; prove recovery on matching evidence before clearing uplift.`
    : dimensionsNeedingUplift.length
      ? `Improve ${dimensionsNeedingUplift.join(', ')} through the existing owner, then replay calibration/proof.`
      : unknownDimensions.length
        ? `Collect canonical evidence for unmeasured dimensions: ${unknownDimensions.join(', ')}.`
        : 'Keep calibration and execution proof current; no unresolved uplift signal is evidenced.';

  return Object.freeze({
    participantId,
    truth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    latestMissionId: missionId(latest || {}),
    latestSummary: latest ? summary(latest) : 'No Shared Workspace evidence published for this participant.',
    latestEvidenceAt: latest ? safeTime(latest) : '',
    proofCount: records.flatMap(proofRefs).length,
    evidenceCount: records.length,
    capabilityGapCount: gaps.length,
    historicalGapCount: gapHistory.history.length,
    resolvedGapCount: gapHistory.resolved.length,
    currentGaps: gapHistory.current,
    resolvedGaps: gapHistory.resolved,
    operatorInterventionCount: interventionCount,
    calibrationVerdict: text(calibration.verdict, 'UNKNOWN'),
    upliftNeedCount: needCount,
    upliftState,
    upliftPriority,
    dimensionsNeedingUplift: Object.freeze(dimensionsNeedingUplift),
    evidencedDimensions: Object.freeze(evidencedDimensions),
    unknownDimensions: Object.freeze(unknownDimensions),
    nextUpliftAction,
    dimensions: scorecard.dimensions,
  });
}

function isActionableLearningGap(record = {}) {
  const learning = record?.closedLoopLearning;
  if (
    learning?.learningEligibleCapabilityFailure === true
    && learning?.telemetry?.retryReady !== true
  ) return true;
  const candidate = record?.flywheelImprovementCandidate || record?.learningCandidate;
  return candidate?.requiresExistingGoalSearch === true
    || candidate?.repairReplayRequired === true;
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

function wholeSystemText(record = {}) {
  return [
    record.goalId,
    record.missionId,
    record.relatedIssue,
    record.parentMission,
    record.parentGoal,
    record.title,
    record.summary,
    record.reason,
    record.eventKind,
    record.status,
    record.state,
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function isWholeSystemRelevant(record = {}) {
  const haystack = wholeSystemText(record);
  return haystack.includes(WHOLE_SYSTEM_CAPABILITY_CLOSURE_MISSION_ID)
    || haystack.includes(WHOLE_SYSTEM_CAPABILITY_CLOSURE_ISSUE.toLowerCase())
    || haystack.includes('whole-system capability closure');
}

function deriveWholeSystemSeedGrowth(payload = {}) {
  const records = payload.records || {};
  const relevant = [
    ...list(records.goalRecords),
    ...allRecords(payload),
  ].filter(isWholeSystemRelevant);
  const goalRecords = list(records.goalRecords).filter(isWholeSystemRelevant);
  const eventRecords = list(records.eventRecords).filter(isWholeSystemRelevant);
  const lessonRecords = list(records.lessonRecords).filter(isWholeSystemRelevant);
  const proofRecords = list(records.proofRecords).filter(isWholeSystemRelevant);
  const gapEvents = relevant.filter((record) => /capability[- ]gap|material[- ]gap|missing capability|unsupported|blocked/i.test(
    `${record.eventKind || ''} ${record.kind || ''} ${record.summary || ''} ${record.reason || ''} ${record.status || ''}`,
  ));
  const regressionEvents = relevant.filter((record) => /regress|reopen|contradict/i.test(
    `${record.eventKind || ''} ${record.kind || ''} ${record.summary || ''} ${record.reason || ''} ${record.status || ''}`,
  ));
  const unknownRecords = relevant.filter((record) => truthFromRecord(record) === 'UNKNOWN');
  const latest = latestByTime(relevant);
  const planted = relevant.length > 0;
  const explicitHealth = relevant
    .map((record) => text(record.healthState || record.missionHealth || '', '').toUpperCase())
    .find((value) => [
      'BOOTSTRAPPING', 'OBSERVING', 'MATERIAL_GAPS_PRESENT', 'REPAIRING', 'LEARNING', 'VERIFYING',
      'REPLANNING', 'BLOCKED', 'NO_KNOWN_MATERIAL_GAPS', 'DEGRADED_EVIDENCE',
    ].includes(value));
  const healthState = explicitHealth
    || (!planted ? 'AWAITING_LIVE_PROOF' : gapEvents.length ? 'MATERIAL_GAPS_PRESENT' : 'OBSERVING');
  const currentGaps = gapEvents.slice(0, 8).map((record) => Object.freeze({
    capabilityId: text(record.capabilityId || record?.closedLoopLearning?.capabilityId || record.eventKind || record.kind, 'material-gap'),
    owner: text(record.ownerId || record.participantId || record.actor, 'UNKNOWN'),
    state: text(record.state || record.status, 'OPEN'),
    summary: summary(record),
  }));
  const proofCount = proofRecords.length + relevant.flatMap(proofRefs).length;
  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted,
    persistent: true,
    missionId: WHOLE_SYSTEM_CAPABILITY_CLOSURE_MISSION_ID,
    issueRef: WHOLE_SYSTEM_CAPABILITY_CLOSURE_ISSUE,
    title: WHOLE_SYSTEM_CAPABILITY_CLOSURE_TITLE,
    stage: healthState,
    healthState,
    sourceTruth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    northStar: WHOLE_SYSTEM_CAPABILITY_CLOSURE_NORTH_STAR,
    operatingLoop: WHOLE_SYSTEM_CAPABILITY_CLOSURE_LOOP,
    qualityDimensions: WHOLE_SYSTEM_CAPABILITY_CLOSURE_DIMENSIONS,
    operatorRole: 'intent-judgment-protected-approval',
    knownMaterialGapCount: planted ? gapEvents.length : null,
    unknownCount: planted ? unknownRecords.length : null,
    regressionCount: planted ? regressionEvents.length : null,
    activeGoalCount: planted ? goalRecords.filter((record) => !/closed|complete|done/i.test(text(record.state || record.status, ''))).length : null,
    learningEventCount: planted ? eventRecords.filter((record) => /learn|teach|exam|capability/i.test(`${record.eventKind || ''} ${record.kind || ''} ${record.summary || ''}`)).length : null,
    retainedLessonCount: planted ? lessonRecords.length : null,
    proofCount: planted ? proofCount : null,
    currentGaps: Object.freeze(currentGaps),
    latestEvidenceAt: latest ? safeTime(latest) : '',
    nextBestAction: currentGaps[0]?.summary
      ? `Close the next evidenced whole-system gap through its canonical owner: ${currentGaps[0].summary}`
      : planted
        ? 'Continue whole-system observation; keep NO_KNOWN_MATERIAL_GAPS non-terminal and reopen on fresh evidence.'
        : 'Publish the #2670 mission heartbeat into Shared Workspace so live whole-system growth can begin without fabricating progress.',
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
      wholeSystemSeedGrowth: deriveWholeSystemSeedGrowth({}),
      outcomeSeeds: Object.freeze([deriveOutcomeSeedGrowth({}), deriveWholeSystemSeedGrowth({})]),
      stats: Object.freeze({
        observedAgents: 0,
        agentsNeedingUplift: 0,
        lessons: 0,
        timelineEvents: 0,
        learningRecordsTotal: 0,
        actionableLearningEvents: 0,
      }),
      sourceFreshness: Object.freeze({
        truth: 'UNKNOWN',
        ageMs: null,
        observedAtUtc: '',
        staleAfterMs: null,
        exactNextAction: 'Restore the canonical Shared Workspace feed.',
      }),
      exactNextAction: text(payload?.exactNextAction, 'Restore the canonical Shared Workspace feed.'),
    });
  }
  const participants = participantIds(payload).map((id) => buildParticipantUplift(payload, id));
  const timeline = buildTimeline(payload);
  const eventRecords = list(payload.records?.eventRecords);
  const learningRecordsTotal = eventRecords.length
    + list(payload.records?.receiptRecords).length
    + list(payload.records?.lessonRecords).length;
  const actionableLearningEvents = eventRecords.filter(isActionableLearningGap).length;
  const sourceFreshness = payload?.projection?.sourceFreshness || {};
  return Object.freeze({
    schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
    valid: true,
    sourceTruth: String(payload.state).toLowerCase() === 'ready' ? 'CURRENT' : 'STALE',
    participants: Object.freeze(participants),
    timeline,
    brainBay: deriveBrainBay(payload),
    outcomeSeedGrowth: deriveOutcomeSeedGrowth(payload),
    wholeSystemSeedGrowth: deriveWholeSystemSeedGrowth(payload),
    outcomeSeeds: Object.freeze([deriveOutcomeSeedGrowth(payload), deriveWholeSystemSeedGrowth(payload)]),
    stats: Object.freeze({
      observedAgents: participants.length,
      agentsNeedingUplift: participants.filter((entry) => entry.upliftNeedCount > 0 || entry.capabilityGapCount > 0).length,
      lessons: list(payload.records?.lessonRecords).length,
      timelineEvents: timeline.length,
      learningRecordsTotal,
      actionableLearningEvents,
    }),
    sourceFreshness: Object.freeze({
      truth: text(sourceFreshness.truth, String(payload.state).toLowerCase() === 'ready' ? 'CURRENT' : 'STALE'),
      ageMs: sourceFreshness.ageMs !== null
        && sourceFreshness.ageMs !== undefined
        && Number.isFinite(Number(sourceFreshness.ageMs))
        ? Math.max(0, Number(sourceFreshness.ageMs))
        : null,
      observedAtUtc: text(sourceFreshness.observedAtUtc, ''),
      staleAfterMs: sourceFreshness.staleAfterMs !== null
        && sourceFreshness.staleAfterMs !== undefined
        && Number.isFinite(Number(sourceFreshness.staleAfterMs))
        ? Math.max(0, Number(sourceFreshness.staleAfterMs))
        : null,
      exactNextAction: text(sourceFreshness.exactNextAction, text(payload.exactNextAction, 'No operator action is currently published.')),
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
      latestEvidenceAt: evidence?.latestEvidenceAt || '',
      proofCount: evidence?.proofCount || 0,
      evidenceCount: evidence?.evidenceCount || 0,
      capabilityGapCount: evidence?.capabilityGapCount || 0,
      historicalGapCount: evidence?.historicalGapCount || 0,
      resolvedGapCount: evidence?.resolvedGapCount || 0,
      currentGaps: evidence?.currentGaps || Object.freeze([]),
      resolvedGaps: evidence?.resolvedGaps || Object.freeze([]),
      operatorInterventionCount: evidence?.operatorInterventionCount || 0,
      calibrationVerdict: evidence?.calibrationVerdict || 'UNKNOWN',
      upliftNeedCount: evidence?.upliftNeedCount || 0,
      upliftState: evidence?.upliftState || 'UNKNOWN',
      upliftPriority: evidence?.upliftPriority || 'UNKNOWN',
      dimensionsNeedingUplift: evidence?.dimensionsNeedingUplift || Object.freeze([]),
      evidencedDimensions: evidence?.evidencedDimensions || Object.freeze([]),
      unknownDimensions: evidence?.unknownDimensions || Object.freeze([]),
      nextUpliftAction: evidence?.nextUpliftAction || 'Collect Shared Workspace evidence before making an uplift claim.',
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
      latestEvidenceAt: entry.latestEvidenceAt || '',
      proofCount: entry.proofCount,
      evidenceCount: entry.evidenceCount,
      capabilityGapCount: entry.capabilityGapCount,
      historicalGapCount: entry.historicalGapCount,
      resolvedGapCount: entry.resolvedGapCount,
      currentGaps: entry.currentGaps,
      resolvedGaps: entry.resolvedGaps,
      operatorInterventionCount: entry.operatorInterventionCount,
      calibrationVerdict: entry.calibrationVerdict,
      upliftNeedCount: entry.upliftNeedCount,
      upliftState: entry.upliftState,
      upliftPriority: entry.upliftPriority,
      dimensionsNeedingUplift: entry.dimensionsNeedingUplift,
      evidencedDimensions: entry.evidencedDimensions,
      unknownDimensions: entry.unknownDimensions,
      nextUpliftAction: entry.nextUpliftAction,
      dimensions: entry.dimensions,
    }));
  const combinedAgents = [...agents, ...unregisteredEvidence];
  const priorityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, WATCH: 3, UNKNOWN: 4, CURRENT: 5 };
  const upliftQueue = combinedAgents
    .filter((entry) => entry.upliftState === 'NEEDS_UPLIFT' || entry.capabilityGapCount > 0)
    .sort((a, b) => (priorityRank[a.upliftPriority] ?? 9) - (priorityRank[b.upliftPriority] ?? 9)
      || b.upliftNeedCount - a.upliftNeedCount
      || b.capabilityGapCount - a.capabilityGapCount);

  return Object.freeze({
    schemaVersion: UPLIFT_WORKSPACE_SCHEMA_V1,
    valid: flywheel.valid || visibleAgents.length > 0,
    sourceTruth: flywheel.sourceTruth,
    actingAgentId: text(finalAgentView.actingAgentId, 'UNKNOWN'),
    agents: Object.freeze(combinedAgents),
    upliftQueue: Object.freeze(upliftQueue),
    timeline: flywheel.timeline,
    stats: Object.freeze({
      runtimeVisibleAgents: visibleAgents.length,
      sharedWorkspaceParticipants: flywheel.participants.length,
      agentsNeedingUplift: upliftQueue.length,
      currentGapSignals: combinedAgents.reduce((sum, entry) => sum + entry.capabilityGapCount, 0),
      resolvedHistoricalGaps: combinedAgents.reduce((sum, entry) => sum + entry.resolvedGapCount, 0),
      evidencedAgents: combinedAgents.filter((entry) => entry.upliftState === 'EVIDENCED').length,
      unknownAgents: combinedAgents.filter((entry) => entry.upliftState === 'UNKNOWN').length,
      actingAgents: visibleAgents.filter((entry) => entry.acting).length,
    }),
    exactNextAction: flywheel.exactNextAction,
  });
}
