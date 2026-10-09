import { buildAgentUpliftScorecardV1 } from '../agents/flywheelAgentUpliftV1.mjs';
import { projectSeedGrowthWorkV1 } from './seedGrowthWorkV1.mjs';
import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipContractV1,
} from './starfieldVrOutcomeOwnershipContractV1.mjs';
import {
  AUTONOMOUS_PROJECT_STEWARDSHIP_ISSUE,
  AUTONOMOUS_PROJECT_STEWARDSHIP_MISSION_ID,
  buildAutonomousProjectStewardshipSeedV1,
} from './autonomousProjectStewardshipSeedV1.mjs';
import {
  CONVERSATIONAL_INTELLIGENCE_ISSUE,
  CONVERSATIONAL_INTELLIGENCE_MISSION_ID,
  buildConversationalIntelligenceSeedV1,
} from './conversationalIntelligenceSeedV1.mjs';
import {
  SOVEREIGN_COMMANDER_PARITY_ISSUE,
  SOVEREIGN_COMMANDER_PARITY_MISSION_ID,
  buildSovereignCommanderParitySeedV1,
} from './sovereignCommanderParitySeedV1.mjs';
import {
  WORKSPACE_INTEGRITY_ISSUE,
  WORKSPACE_INTEGRITY_MISSION_ID,
  buildWorkspaceIntegritySeedV1,
} from './workspaceIntegritySeedV1.mjs';
import {
  SOVEREIGN_METER_INDEPENDENCE_ISSUE,
  SOVEREIGN_METER_INDEPENDENCE_MISSION_ID,
  buildSovereignMeterIndependenceSeedV1,
} from './sovereignMeterIndependenceSeedV1.mjs';

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
  return [...new Set([
    ...list(record.proofRefs),
    ...list(record.evidenceRefs),
    ...list(record.testAndProofRefs),
    ...list(record?.closedLoopLearning?.evidenceRefs),
    ...list(record?.closedLoopLearning?.verification?.proofRefs),
    ...list(record?.learningCandidate?.evidenceRefs),
    ...list(record?.learningCandidate?.testAndProofRefs),
    ...list(record?.flywheelImprovementCandidate?.evidenceRefs),
    ...list(record?.flywheelImprovementCandidate?.testAndProofRefs),
  ].map((value) => text(value, '')).filter(Boolean))];
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
      || record?.flywheelImprovementCandidate?.gapId
      || record?.flywheelImprovementCandidate?.capabilityId
      || record?.flywheelImprovementCandidate?.candidateId
      || record?.learningCandidate?.rootGapId
      || record?.learningCandidate?.gapId
      || record?.learningCandidate?.capabilityId
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
  if (
    record?.closedLoopLearning?.learningEligibleCapabilityFailure === true
    && record?.closedLoopLearning?.telemetry?.retryReady !== true
  ) return true;
  if (record?.flywheelImprovementCandidate?.requiresExistingGoalSearch === true) return true;
  if (record?.learningCandidate?.requiresExistingGoalSearch === true) return true;
  // Machine-readable failure fields override prose. A passing monitor pulse may
  // contain a goal title such as "Capability Gap Intake" without reporting a gap.
  const gapPattern = /capability[- ]gap|missing capability|unsupported|blocked|needs[_ -]?uplift/i;
  if (gapPattern.test(`${record.eventKind || ''} ${record.reason || ''} ${record.state || ''}`)) return true;
  const outcome = text(record.status).toUpperCase().replace(/[\\s-]+/g, '_');
  if (['PASS', 'PASSED', 'READY', 'CURRENT', 'SUCCESS', 'SUCCEEDED', 'PROVED', 'VERIFIED', 'COMPLETE', 'COMPLETED'].includes(outcome)) return false;
  return gapPattern.test(`${record.status || ''} ${record.summary || ''}`);
}

const POSITIVE_RECOVERY_STATES = Object.freeze(new Set([
  'RECOVERED',
  'RESOLVED',
  'REPAIRED',
  'VERIFIED',
  'PROVED',
  'PASSED',
  'PASS',
  'COMPLETE',
  'COMPLETED',
  'RETRY-READY',
  'CLOSED',
  'SUCCESS',
  'SUCCEEDED',
  'DONE',
]));

const NEGATIVE_RECOVERY_STATES = Object.freeze(new Set([
  'FAILED',
  'FAILURE',
  'ERROR',
  'BLOCKED',
  'STALLED',
  'INCOMPLETE',
  'REJECTED',
  'UNSAFE',
  'CANCELLED',
  'CANCELED',
  'ABORTED',
  'HOLD',
  'DEGRADED',
]));

function normalizedRecoveryStates(record = {}) {
  return [
    record.state,
    record.status,
    record.verdict,
    record.finalVerdict,
    record.phase,
  ]
    .map((value) => text(value, '').toUpperCase().replace(/[\s_]+/g, '-'))
    .filter(Boolean);
}

function isRecoverySignal(record = {}) {
  const states = normalizedRecoveryStates(record);
  const explicitNegativeState = states.some((value) => NEGATIVE_RECOVERY_STATES.has(value));
  if (explicitNegativeState) return false;
  const retryReady = record?.closedLoopLearning?.telemetry?.retryReady === true;
  const exactPositiveState = states.some((value) => POSITIVE_RECOVERY_STATES.has(value));
  if (!retryReady && !exactPositiveState) return false;
  return proofRefs(record).length > 0;
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
      capabilityId: text(
        record.capabilityId
          || record?.closedLoopLearning?.capabilityId
          || record?.flywheelImprovementCandidate?.gapId
          || record?.flywheelImprovementCandidate?.capabilityId
          || record?.learningCandidate?.gapId
          || record?.learningCandidate?.capabilityId
          || record.eventKind
          || record.kind,
        'capability-gap',
      ),
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

function buildParticipantTimeline(payload = {}, participantId = '', limit = 8) {
  const id = text(participantId).toLowerCase();
  if (!id) return Object.freeze([]);
  const records = payload.records || {};
  return Object.freeze([
    ...list(records.eventRecords).map((record) => ({ type: 'EVENT', record })),
    ...list(records.receiptRecords).map((record) => ({ type: 'RECEIPT', record })),
    ...list(records.lessonRecords).map((record) => ({ type: 'LESSON', record })),
  ]
    .filter(({ record }) => actorId(record).toLowerCase() === id)
    .sort((a, b) => Date.parse(safeTime(b.record)) - Date.parse(safeTime(a.record)))
    .slice(0, Math.max(1, limit))
    .map(({ type, record }) => Object.freeze({
      type,
      at: safeTime(record),
      participantId: actorId(record) || 'UNKNOWN',
      missionId: missionId(record),
      summary: summary(record),
      proofCount: proofRefs(record).length,
      truth: truthFromRecord(record),
    })));
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
    evidenceTimeline: buildParticipantTimeline(payload, participantId, 8),
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
  const canonicalBrain = payload?.brainState;
  const canonicalState = text(canonicalBrain?.state, '').toUpperCase();
  const canonicalModel = text(canonicalBrain?.activeBrain, '');
  if (
    ['CURRENT', 'STALE'].includes(canonicalState)
    && canonicalModel
    && canonicalModel !== 'UNKNOWN'
  ) {
    const record = canonicalBrain?.record || {};
    const provider = text(canonicalBrain?.provider || record?.provider, 'UNKNOWN');
    const reasoningMode = text(canonicalBrain?.reasoningMode || record?.reasoningMode, 'UNKNOWN');
    const routeNotes = [
      canonicalBrain?.escalationActive === true ? 'escalation active' : '',
      canonicalBrain?.fallbackUsed === true ? 'fallback used' : '',
      text(canonicalBrain?.loadMode, '') ? `load=${text(canonicalBrain.loadMode)}` : '',
    ].filter(Boolean);
    return Object.freeze({
      state: canonicalState,
      mode: reasoningMode,
      model: canonicalModel,
      provider,
      reason: text(
        record?.summary,
        `Canonical Brain State: ${canonicalModel} via ${provider}; reasoning=${reasoningMode}${routeNotes.length ? `; ${routeNotes.join(', ')}` : ''}.`,
      ),
      proofRefs: Object.freeze(proofRefs(record)),
      source: 'canonical-brain-state',
    });
  }

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
      provider: 'UNKNOWN',
      reason: 'No current brain-use receipt is present in Shared Workspace history.',
      proofRefs: Object.freeze([]),
      source: 'none',
    });
  }
  return Object.freeze({
    state: truthFromRecord(latest),
    mode: text(latest.mode || latest.reasoningMode || latest.status, 'UNKNOWN'),
    model: text(latest.model || latest.modelId || latest.providerModel, 'UNKNOWN'),
    provider: text(latest.provider || latest.actualProviderUsed, 'UNKNOWN'),
    reason: summary(latest),
    proofRefs: Object.freeze(proofRefs(latest)),
    source: 'shared-workspace-history-fallback',
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
  const statuses = list(records.statusRecords);
  const events = list(records.eventRecords);
  const lessons = list(records.lessonRecords);
  const proofs = list(records.proofRecords);
  const seedStatus = statuses.find((record) => (
    record?.statusId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID
    && record?.outcomeOwnershipSeed?.schemaVersion === STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1
  ));
  const seedGoal = goals.find((record) => (
    record?.goalId === STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID
    && record?.outcomeOwnershipSeed?.schemaVersion === STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1
  ));
  const seedRecord = seedStatus || seedGoal;
  const declaredContract = buildStarfieldVrOutcomeOwnershipContractV1();
  if (!seedRecord) {
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
  const relevantEvidence = [seedRecord, ...starfieldEvents, ...starfieldLessons, ...starfieldProofs]
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
  const latest = relevantEvidence[0] || seedRecord;
  const nextBestAction = currentGaps[0]?.summary
    ? `Close the next evidenced capability gap: ${currentGaps[0].summary}`
    : retryReady.length > 0
      ? 'Replay the original Starfield VR task using the newly retained capability and capture runtime proof.'
      : playtests.length > 0
        ? 'Use the latest Starfield VR playtest evidence to choose the next bounded, reversible improvement experiment.'
        : text(plantingEvent?.outcomeOwnershipSeed?.nextBestAction, 'Capture the next real Starfield VR playtest so the seed can begin learning.');

  const liveContract = seedRecord?.outcomeOwnershipSeed || declaredContract;
  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted: true,
    missionId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
    stage,
    sourceTruth: truthFromRecord(seedRecord),
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


function autonomousProjectText(record = {}) {
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
    record.kind,
    record.status,
    record.state,
    record.participantId,
    record.ownerId,
    record.controllerId,
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function isAutonomousProjectRelevant(record = {}) {
  const haystack = autonomousProjectText(record);
  if (
    haystack.includes(AUTONOMOUS_PROJECT_STEWARDSHIP_MISSION_ID)
    || haystack.includes(AUTONOMOUS_PROJECT_STEWARDSHIP_ISSUE.toLowerCase())
    || haystack.includes('stephanos runs the project')
    || haystack.includes('autonomous project stewardship')
  ) return true;
  return haystack.includes('stephanos')
    && /foreman|autonom|next rung|pickup pressure|refill pressure|build truth|goal selection|mission planning/.test(haystack);
}

function autonomyProvenanceV1(record = {}) {
  const provenance = record?.autonomyProvenance || record?.provenance?.autonomy || {};
  const requestedBy = [
    record.requestedBy,
    record.requestedByAgentId,
    record.sourceSurface,
    record?.runtimeContext?.source,
    provenance.requestedBy,
    provenance.sourceSurface,
    provenance.rootInitiatorId,
  ].map((value) => text(value, '')).join(' ').toLowerCase();
  const missionId = text(
    provenance.missionId
      || record.missionId
      || record.goalId
      || record.parentMission,
    '',
  ).toLowerCase();
  const initiatorId = text(provenance.initiatorId, '').toLowerCase();
  const triggerClass = text(provenance.triggerClass, '').toLowerCase();
  const explicitSchema = text(provenance.schemaVersion, '').toLowerCase() === 'stephanos.autonomy-provenance.v1';
  const operatorInitiated = provenance.operatorInitiated === true
    || record?.runtimeContext?.operatorInitiated === true
    || /(^|[^a-z])(operator|operator-import|stephan)([^a-z]|$)/.test(requestedBy);
  const chatgptInitiated = provenance.chatgptInitiated === true
    || /chatgpt|openai/.test(requestedBy);
  const manualPoke = provenance.manualPoke === true
    || triggerClass === 'manual'
    || triggerClass === 'operator-prompt'
    || triggerClass === 'chatgpt-prompt';
  const explicitlyIndependent = provenance.operatorInitiated === false
    && provenance.chatgptInitiated === false
    && provenance.manualPoke === false;
  const eligible = explicitSchema
    && missionId === AUTONOMOUS_PROJECT_STEWARDSHIP_MISSION_ID
    && ['stephanos', 'stephanos-foreman'].includes(initiatorId)
    && ['self-initiated', 'autonomous-loop'].includes(triggerClass)
    && explicitlyIndependent
    && !operatorInitiated
    && !chatgptInitiated
    && !manualPoke;
  return Object.freeze({
    eligible,
    explicitSchema,
    missionId,
    initiatorId,
    triggerClass,
    operatorInitiated,
    chatgptInitiated,
    manualPoke,
  });
}

function deriveAutonomousProjectSeedGrowth(payload = {}) {
  const contract = buildAutonomousProjectStewardshipSeedV1();
  const records = payload.records || {};
  const relevant = [
    ...list(records.goalRecords),
    ...allRecords(payload),
  ].filter(isAutonomousProjectRelevant);
  const latest = latestByTime(relevant);
  const planted = relevant.length > 0;
  const gapHistory = deriveGapHistory(relevant);
  const currentGaps = gapHistory.current.slice(0, 8).map((gap) => Object.freeze({
    capabilityId: gap.capabilityId,
    owner: gap.owner,
    state: gap.state,
    summary: gap.summary,
  }));

  const projectProofRecords = relevant.filter((record) => proofRefs(record).length > 0 && truthFromRecord(record) === 'CURRENT');
  const autonomousProofRecords = projectProofRecords.filter((record) => autonomyProvenanceV1(record).eligible);
  const autonomyExcludedProofRecords = projectProofRecords.filter((record) => !autonomyProvenanceV1(record).eligible);
  const explicitlyAssistedRecords = projectProofRecords.filter((record) => {
    const provenance = autonomyProvenanceV1(record);
    return provenance.operatorInitiated || provenance.chatgptInitiated || provenance.manualPoke;
  });
  const unattributedProofRecords = autonomyExcludedProofRecords.filter((record) => {
    const provenance = autonomyProvenanceV1(record);
    return !provenance.operatorInitiated && !provenance.chatgptInitiated && !provenance.manualPoke;
  });

  const decisions = autonomousProofRecords.filter((record) => /foreman|prioriti|choose|next action|next move|goal selection|mission planning/.test(autonomousProjectText(record)));
  const delegations = autonomousProofRecords.filter((record) => /delegate|dispatch|assign|handoff|controller refill/.test(autonomousProjectText(record)));
  const pickupProofs = autonomousProofRecords.filter((record) => /pickup|worker claim|claimed|claim proof/.test(autonomousProjectText(record)));
  const completionProofs = autonomousProofRecords.filter((record) => /complete|completed|verified|proved|merged|build truth/.test(autonomousProjectText(record)));
  const replans = autonomousProofRecords.filter((record) => /replan|next rung|next move|refill|repeat|continuation/.test(autonomousProjectText(record)));
  const pressureSignals = autonomousProofRecords.filter((record) => /uplift pressure|pickup pressure|refill pressure|keep.*pressure|pressure.*pickup/.test(autonomousProjectText(record)));
  const autonomousCycles = autonomousProofRecords.filter((record) => {
    const cycleIdentity = [
      record.eventKind,
      record.kind,
      record.schemaVersion,
      record.title,
      record.summary,
    ].map((value) => text(value, '')).join(' ').toLowerCase();
    return /autonomous[- ]cycle|foreman[- ]autonomous[- ]cycle|foreman[- ]cycle/.test(cycleIdentity);
  });
  const interventionCount = planted ? operatorInterventionCount(relevant) : null;
  const provedAutonomousCycles = autonomousCycles;
  const explicitAutonomyBlockers = relevant.filter((record) => {
    const state = text(record.state || record.status, '').toUpperCase();
    return /BLOCKED|FAILED|STALLED|OFFLINE|ERROR/.test(state)
      && /autonom|foreman|build|worker|pickup|dispatch|controller|replan/.test(autonomousProjectText(record));
  });
  const operatorAutonomyObservations = relevant.filter((record) => {
    const observation = record?.operatorAutonomyObservation || {};
    const eventKind = text(record.eventKind || record.kind, '').toLowerCase();
    const boundMission = text(
      observation.missionId
        || record.missionId
        || record.goalId
        || record.parentMission,
      '',
    ).toLowerCase();
    const explicitType = eventKind === 'operator-autonomy-observation'
      || text(observation.schemaVersion, '').toLowerCase() === 'stephanos.operator-autonomy-observation.v1';
    const explicitOperator = text(observation.observerRole || record.participantRole, '').toLowerCase() === 'operator';
    const verdict = text(observation.verdict || record.autonomyVerdict, '').toUpperCase();
    return explicitType
      && explicitOperator
      && boundMission === AUTONOMOUS_PROJECT_STEWARDSHIP_MISSION_ID
      && ['NO', 'NOT_BUILDING_AUTONOMOUSLY', 'MANUAL_POKE_REQUIRED'].includes(verdict);
  });
  const latestProvedCycle = latestByTime(provedAutonomousCycles);
  const latestAutonomyBlocker = latestByTime(explicitAutonomyBlockers);
  const latestOperatorAutonomyObservation = latestByTime(operatorAutonomyObservations);
  const negativeAutonomyEvidence = latestByTime([
    ...explicitAutonomyBlockers,
    ...operatorAutonomyObservations,
  ]);
  const feedReady = String(payload?.state || '').toLowerCase() === 'ready';

  let autonomyVerdict = 'NOT_PROVED_YET';
  let autonomyVerdictBasis = 'Repeated proof-bearing unprompted Foreman cycles have not yet been evidenced on a current Shared Workspace feed.';
  if (feedReady && negativeAutonomyEvidence && (!latestProvedCycle || recordTimeMs(negativeAutonomyEvidence) > recordTimeMs(latestProvedCycle))) {
    autonomyVerdict = 'NO';
    autonomyVerdictBasis = operatorAutonomyObservations.includes(negativeAutonomyEvidence)
      ? `Operator observes Stephanos is not building autonomously: ${summary(negativeAutonomyEvidence)}`
      : `Current autonomy blocker: ${summary(negativeAutonomyEvidence)}`;
  } else if (feedReady && provedAutonomousCycles.length >= 2) {
    autonomyVerdict = 'YES';
    autonomyVerdictBasis = `${provedAutonomousCycles.length} proof-bearing unprompted Foreman cycles are evidenced; latest ${safeTime(latestProvedCycle) || 'time unknown'}.`;
  } else if (!feedReady && planted) {
    autonomyVerdictBasis = 'Autonomy evidence exists, but the Shared Workspace feed is not CURRENT enough to certify a live YES or NO.';
  }

  let currentRungIndex = planted ? 0 : null;
  if (planted && decisions.length) currentRungIndex = 1;
  if (planted && delegations.length) currentRungIndex = 2;
  if (planted && pickupProofs.length) currentRungIndex = 3;
  if (planted && completionProofs.length) currentRungIndex = 4;
  if (planted && completionProofs.length && replans.length) currentRungIndex = 5;
  if (planted && completionProofs.length && replans.length && provedAutonomousCycles.length >= 2) currentRungIndex = 6;

  const currentRung = currentRungIndex === null
    ? 'AWAITING_LIVE_PROOF'
    : contract.growthRungs[currentRungIndex] || 'UNKNOWN';
  const pressureLatest = latestByTime(pressureSignals);
  const pressureState = pressureLatest
    ? (truthFromRecord(pressureLatest) === 'CONFLICTING' ? 'BLOCKED' : 'ACTIVE')
    : 'UNKNOWN';

  let nextBestAction = 'Publish the autonomous project stewardship heartbeat into Shared Workspace so the seed can begin evidence-backed growth.';
  if (autonomyVerdict === 'NO' && latestOperatorAutonomyObservation) {
    nextBestAction = 'Treat the operator-visible autonomy failure as a current gap: find why work is not progressing without pokes, route repair through the canonical owner, then require newer repeated autonomous-cycle proof before clearing NO.';
  } else if (planted && currentGaps.length) {
    nextBestAction = `Close the next evidenced autonomy gap through its canonical owner: ${currentGaps[0].summary}`;
  } else if (planted && currentRungIndex < 1) {
    nextBestAction = 'Prove Stephanos chooses the next valuable goal from live project truth without an operator poke.';
  } else if (planted && currentRungIndex < 2) {
    nextBestAction = 'Prove the Foreman delegates the chosen goal into a real execution lane.';
  } else if (planted && currentRungIndex < 3) {
    nextBestAction = 'Keep pressure applied until a real worker pickup is canonically proved.';
  } else if (planted && currentRungIndex < 4) {
    nextBestAction = 'Carry the owned work through build and capture completion proof rather than stopping at handoff.';
  } else if (planted && currentRungIndex < 5) {
    nextBestAction = 'After proof, automatically choose and dispatch the next valuable rung.';
  } else if (planted && currentRungIndex < 6) {
    nextBestAction = 'Repeat the full Foreman cycle again without routine operator or ChatGPT prompting.';
  } else if (planted) {
    nextBestAction = 'Keep the autonomous ratchet running; treat any return to routine manual pokes as a regression signal.';
  }

  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted,
    persistent: true,
    missionId: contract.missionId,
    issueRef: contract.issueRef,
    title: contract.title,
    stage: planted ? currentRung : 'AWAITING_LIVE_PROOF',
    healthState: planted ? (currentGaps.length ? 'AUTONOMY_GAPS_PRESENT' : 'RATCHETING') : 'AWAITING_LIVE_PROOF',
    sourceTruth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    northStar: contract.northStar,
    operatingLoop: contract.operatingLoop,
    growthRungs: contract.growthRungs,
    qualityDimensions: contract.qualityDimensions,
    operatorRole: contract.operatorRole,
    currentRungIndex,
    currentRung,
    pressureState,
    nextGrowthRung: planted ? (contract.growthRungs[currentRungIndex + 1] || '') : '',
    decisionCount: planted ? decisions.length : null,
    delegationCount: planted ? delegations.length : null,
    pickupProofCount: planted ? pickupProofs.length : null,
    completionProofCount: planted ? completionProofs.length : null,
    replanCount: planted ? replans.length : null,
    projectActivityProofCount: planted ? projectProofRecords.length : null,
    autonomyEligibleProofCount: planted ? autonomousProofRecords.length : null,
    autonomyExcludedProofCount: planted ? autonomyExcludedProofRecords.length : null,
    explicitlyAssistedProofCount: planted ? explicitlyAssistedRecords.length : null,
    unattributedProofCount: planted ? unattributedProofRecords.length : null,
    autonomousCycleCount: planted ? autonomousCycles.length : null,
    provedAutonomousCycleCount: planted ? provedAutonomousCycles.length : null,
    autonomyVerdict,
    autonomyVerdictBasis,
    latestAutonomousCycleAt: latestProvedCycle ? safeTime(latestProvedCycle) : '',
    latestAutonomyBlockerAt: latestAutonomyBlocker ? safeTime(latestAutonomyBlocker) : '',
    operatorAutonomyObservationCount: planted ? operatorAutonomyObservations.length : null,
    latestOperatorAutonomyObservationAt: latestOperatorAutonomyObservation ? safeTime(latestOperatorAutonomyObservation) : '',
    operatorInterventionCount: interventionCount,
    proofCount: planted ? relevant.flatMap(proofRefs).length : null,
    currentGaps: Object.freeze(currentGaps),
    latestEvidenceAt: latest ? safeTime(latest) : '',
    nextBestAction,
  });
}


function conversationalIntelligenceText(record = {}) {
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
    record.kind,
    record.schemaVersion,
    record.status,
    record.state,
    record.participantId,
    record.agentId,
    record.model,
    record.modelId,
    record.reasoningMode,
    record.provider,
    record?.engineeringRecord?.category,
    ...list(record?.engineeringRecord?.applicableDomains),
    ...list(record?.targetRefs),
    ...list(record?.domainRefs),
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function conversationalBindingText(record = {}) {
  return [
    record.goalId,
    record.missionId,
    record.relatedIssue,
    record.parentMission,
    record.parentGoal,
    record.eventKind,
    record.kind,
    record.schemaVersion,
    record?.engineeringRecord?.category,
    ...list(record?.engineeringRecord?.applicableDomains),
    ...list(record?.targetRefs),
    ...list(record?.domainRefs),
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function isConversationalIntelligenceRelevant(record = {}) {
  const binding = conversationalBindingText(record);
  if (
    binding.includes(CONVERSATIONAL_INTELLIGENCE_MISSION_ID)
    || binding.includes(CONVERSATIONAL_INTELLIGENCE_ISSUE.toLowerCase())
  ) return true;

  const recognizedConversationType = /(^|[^a-z])(conversation|conversational|shared-thread|conversation-thread|conversation-turn|q&a|qa-response|project-intelligence|memory-retrieval|context-continuity)([^a-z]|$)/;
  return recognizedConversationType.test(binding);
}

function isPositiveProofRecord(record = {}) {
  return proofRefs(record).length > 0 && truthFromRecord(record) === 'CURRENT';
}

function deriveConversationalIntelligenceSeedGrowth(payload = {}) {
  const contract = buildConversationalIntelligenceSeedV1();
  const records = payload.records || {};
  const relevant = [
    ...list(records.goalRecords),
    ...allRecords(payload),
  ].filter(isConversationalIntelligenceRelevant);
  const latest = latestByTime(relevant);
  const planted = relevant.length > 0;
  const proved = relevant.filter(isPositiveProofRecord);
  const gapHistory = deriveGapHistory(relevant);
  const currentGaps = gapHistory.current.slice(0, 8).map((gap) => Object.freeze({
    capabilityId: gap.capabilityId,
    owner: gap.owner,
    state: gap.state,
    summary: gap.summary,
  }));

  const signal = (pattern) => proved.filter((record) => pattern.test(conversationalIntelligenceText(record)));
  const intentSignals = signal(/intent|question|conversation turn|operator turn|q&a|qa-response/);
  const contextSignals = signal(/context|continuity|history|memory|thread|conversation canvas/);
  const groundingSignals = signal(/project intelligence|shared workspace|goal truth|ground|canonical truth/);
  const brainSignals = signal(/brain|model|reasoning mode|router|qwen|gpt-oss|provider/);
  const deepReasoningSignals = signal(/deep reasoning|uplift pressure|escalat|reasoning quality|ten-question|evaluation/);
  const coherenceSignals = signal(/coheren|synthes|answer relevance|conversation quality|response admission|shared intelligence/);
  const learningSignals = signal(/learn|lesson|retain|evaluation|exam|calibrat|uplift/);
  const pressureSignals = signal(/uplift pressure|flywheel|needs uplift|next rung|improve next conversation/);

  const rungProof = [
    intentSignals.length > 0,
    contextSignals.length > 0,
    groundingSignals.length > 0,
    brainSignals.length > 0,
    deepReasoningSignals.length > 0,
    coherenceSignals.length > 0,
    learningSignals.length > 0,
    learningSignals.length > 0 && pressureSignals.length > 0 && coherenceSignals.length > 0,
  ];

  let currentRungIndex = null;
  if (planted) {
    currentRungIndex = 0;
    for (let index = 0; index < rungProof.length; index += 1) {
      if (!rungProof[index]) break;
      currentRungIndex = index;
    }
  }

  const currentRung = currentRungIndex === null
    ? 'AWAITING_LIVE_PROOF'
    : contract.growthRungs[currentRungIndex] || 'UNKNOWN';

  const pressureLatest = latestByTime(pressureSignals);
  const pressureState = pressureLatest ? 'ACTIVE' : 'UNKNOWN';

  let nextBestAction = 'Publish the conversational-intelligence seed heartbeat into Shared Workspace so live growth can begin.';
  if (planted && currentGaps.length) {
    nextBestAction = `Close the next evidenced conversation-intelligence gap through its canonical owner: ${currentGaps[0].summary}`;
  } else if (planted && !rungProof[0]) {
    nextBestAction = 'Prove Stephanos correctly hears and binds the operator intent before advancing conversation intelligence.';
  } else if (planted && !rungProof[1]) {
    nextBestAction = 'Prove the conversation holds relevant context across turns without the operator re-explaining it.';
  } else if (planted && !rungProof[2]) {
    nextBestAction = 'Ground the conversation in canonical project truth before answering.';
  } else if (planted && !rungProof[3]) {
    nextBestAction = 'Prove the router chooses the right brain for the conversational task.';
  } else if (planted && !rungProof[4]) {
    nextBestAction = 'Prove deeper reasoning is invoked when the conversation requires it.';
  } else if (planted && !rungProof[5]) {
    nextBestAction = 'Prove Stephanos synthesizes memory, project truth and reasoning into one coherent response.';
  } else if (planted && !rungProof[6]) {
    nextBestAction = 'Turn conversation evaluation and failures into retained Flywheel learning.';
  } else if (planted && !rungProof[7]) {
    nextBestAction = 'Use retained lessons to measurably improve the next conversation.';
  } else if (planted) {
    nextBestAction = 'Keep ratcheting conversational intelligence upward; treat context loss, incoherence, wrong-brain routing and unsupported certainty as regression signals.';
  }

  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted,
    persistent: true,
    missionId: contract.missionId,
    issueRef: contract.issueRef,
    title: contract.title,
    stage: planted ? currentRung : 'AWAITING_LIVE_PROOF',
    healthState: planted ? (currentGaps.length ? 'INTELLIGENCE_GAPS_PRESENT' : 'LEARNING') : 'AWAITING_LIVE_PROOF',
    sourceTruth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    northStar: contract.northStar,
    operatingLoop: contract.operatingLoop,
    growthRungs: contract.growthRungs,
    qualityDimensions: contract.qualityDimensions,
    operatorRole: contract.operatorRole,
    currentRungIndex,
    currentRung,
    pressureState,
    nextGrowthRung: planted ? (contract.growthRungs[rungProof.findIndex((proven) => !proven)] || '') : '',
    intentSignalCount: planted ? intentSignals.length : null,
    contextSignalCount: planted ? contextSignals.length : null,
    groundingSignalCount: planted ? groundingSignals.length : null,
    brainSignalCount: planted ? brainSignals.length : null,
    reasoningSignalCount: planted ? deepReasoningSignals.length : null,
    coherenceSignalCount: planted ? coherenceSignals.length : null,
    learningSignalCount: planted ? learningSignals.length : null,
    proofCount: planted ? proved.flatMap(proofRefs).length : null,
    currentGaps: Object.freeze(currentGaps),
    latestEvidenceAt: latest ? safeTime(latest) : '',
    nextBestAction,
  });
}


function sovereignCommanderParityText(record = {}) {
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
    record.kind,
    record.schemaVersion,
    record.status,
    record.state,
    record.participantId,
    record.agentId,
    record.capabilityId,
    record.operationId,
    record.operation,
    record.toolName,
    record.requestedCapability,
    ...list(record?.targetRefs),
    ...list(record?.domainRefs),
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function isSovereignCommanderParityRelevant(record = {}) {
  const haystack = sovereignCommanderParityText(record);
  if (
    haystack.includes(SOVEREIGN_COMMANDER_PARITY_MISSION_ID)
    || haystack.includes(SOVEREIGN_COMMANDER_PARITY_ISSUE.toLowerCase())
  ) return true;
  const mentionsSovereign = haystack.includes('sovereign commander') || haystack.includes('sovereign-commander');
  const mentionsTeachingSurface = /remote desktop commander|desktop commander|remote commander|commander parity|capability debt|best click is no click/.test(haystack);
  return mentionsSovereign && mentionsTeachingSurface;
}

function deriveSovereignCommanderParitySeedGrowth(payload = {}) {
  const contract = buildSovereignCommanderParitySeedV1();
  const records = payload.records || {};
  const relevant = [
    ...list(records.goalRecords),
    ...allRecords(payload),
  ].filter(isSovereignCommanderParityRelevant);
  const latest = latestByTime(relevant);
  const planted = relevant.length > 0;
  const proved = relevant.filter(isPositiveProofRecord);
  const gapHistory = deriveGapHistory(relevant);
  const currentGaps = gapHistory.current.slice(0, 8).map((gap) => Object.freeze({
    capabilityId: gap.capabilityId,
    owner: gap.owner,
    state: gap.state,
    summary: gap.summary,
  }));

  const evidenceRecords = proved.filter((record) => (
    record?.seedHeartbeat?.schemaVersion !== 'stephanos.high-level-flywheel-seed-heartbeat.v1'
  ));
  const signal = (source, pattern) => source.filter((record) => pattern.test(sovereignCommanderParityText(record)));
  const remoteObservations = signal(evidenceRecords, /remote desktop commander|desktop commander|remote commander/);
  const gapSignals = signal(evidenceRecords, /capability[- ]gap|missing parity|unsupported|capability debt|operator handback|meter exhausted|meter exhaustion|rate limit/);
  const safetySignals = signal(evidenceRecords, /safety|safe|approval|bounded|guardrail|classified|classification|deny|protected/);
  const implementationSignals = signal(evidenceRecords, /native capability|implemented|implementation|adapted|built capability|sovereign commander capability/);
  const parityProofSignals = signal(evidenceRecords, /parity[- ]proof|proved.*parity|equivalent|representative task|replay|repeated through sovereign|repeat.*sovereign|qualified capability/);
  const routingSignals = signal(evidenceRecords, /prefer.*sovereign|route.*sovereign|sovereign.*preferred|routed through sovereign/);
  const auditSignals = signal(evidenceRecords, /parity audit|continuous audit|coverage audit|recent remote commander capabilities|qualified sovereign commander capabilities/);

  const rungProof = [
    remoteObservations.length > 0,
    gapSignals.length > 0 || currentGaps.length > 0,
    safetySignals.length > 0,
    implementationSignals.length > 0,
    parityProofSignals.length > 0,
    routingSignals.length > 0,
    auditSignals.length > 0,
  ];

  let currentRungIndex = null;
  if (planted) {
    currentRungIndex = 0;
    for (let index = 0; index < rungProof.length; index += 1) {
      if (!rungProof[index]) break;
      currentRungIndex = index;
    }
  }

  const currentRung = currentRungIndex === null
    ? 'AWAITING_LIVE_PROOF'
    : contract.growthRungs[currentRungIndex] || 'UNKNOWN';
  const pressureState = !planted
    ? 'UNKNOWN'
    : currentGaps.length > 0 || rungProof.some((proven) => !proven)
      ? 'ACTIVE'
      : 'CURRENT';

  let nextBestAction = 'Publish the #2519 Sovereign Commander parity heartbeat into Shared Workspace so safe capability teaching can be measured.';
  if (planted && currentGaps.length) {
    nextBestAction = 'Close the next evidenced Sovereign Commander parity gap through its canonical owner: ' + currentGaps[0].summary;
  } else if (planted && !rungProof[0]) {
    nextBestAction = 'Capture the next useful Remote Desktop Commander operation as a bounded teaching event.';
  } else if (planted && !rungProof[1]) {
    nextBestAction = 'Record the missing Sovereign Commander capability as one canonical parity gap and dedupe it against the existing capability registry.';
  } else if (planted && !rungProof[2]) {
    nextBestAction = 'Classify the parity gap for safety, mutation scope and protected operator approvals before implementation.';
  } else if (planted && !rungProof[3]) {
    nextBestAction = 'Implement or adapt the smallest guarded Sovereign Commander capability through the existing capability fabric.';
  } else if (planted && !rungProof[4]) {
    nextBestAction = 'Replay a representative task and prove safe parity with deterministic receipts.';
  } else if (planted && !rungProof[5]) {
    nextBestAction = 'Qualify the proved native capability and make ordinary routing prefer Sovereign Commander next time.';
  } else if (planted && !rungProof[6]) {
    nextBestAction = 'Run the continuous parity audit and turn any remaining Remote Commander-only capability into evidence-backed capability debt.';
  } else if (planted) {
    nextBestAction = 'Keep auditing Remote Commander capability use; teach Sovereign Commander each safe repeatable capability without copying unsafe authority.';
  }

  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted,
    persistent: true,
    missionId: contract.missionId,
    issueRef: contract.issueRef,
    title: contract.title,
    stage: planted ? currentRung : 'AWAITING_LIVE_PROOF',
    healthState: planted ? (currentGaps.length ? 'PARITY_GAPS_PRESENT' : 'LEARNING') : 'AWAITING_LIVE_PROOF',
    sourceTruth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    northStar: contract.northStar,
    operatingLoop: contract.operatingLoop,
    growthRungs: contract.growthRungs,
    qualityDimensions: contract.qualityDimensions,
    operatorRole: contract.operatorRole,
    currentRungIndex,
    currentRung,
    pressureState,
    nextGrowthRung: planted ? (contract.growthRungs[rungProof.findIndex((proven) => !proven)] || '') : '',
    remoteObservationCount: planted ? remoteObservations.length : null,
    parityGapSignalCount: planted ? gapSignals.length : null,
    safetyClassificationProofCount: planted ? safetySignals.length : null,
    nativeImplementationProofCount: planted ? implementationSignals.length : null,
    parityProofCount: planted ? parityProofSignals.length : null,
    sovereignRoutingProofCount: planted ? routingSignals.length : null,
    auditProofCount: planted ? auditSignals.length : null,
    proofCount: planted ? proved.flatMap(proofRefs).length : null,
    currentGaps: Object.freeze(currentGaps),
    latestEvidenceAt: latest ? safeTime(latest) : '',
    nextBestAction,
  });
}


function workspaceIntegrityText(record = {}) {
  return [
    record?.missionId,
    record?.goalId,
    record?.taskId,
    record?.relatedIssue,
    record?.statusId,
    record?.eventKind,
    record?.kind,
    record?.title,
    record?.summary,
    record?.description,
    record?.state,
    record?.status,
    ...(Array.isArray(record?.proofRefs) ? record.proofRefs : []),
  ].map((value) => text(value, '')).join(' ').toLowerCase();
}

function isWorkspaceIntegrityRelevant(record = {}) {
  const haystack = workspaceIntegrityText(record);
  if (
    haystack.includes(WORKSPACE_INTEGRITY_MISSION_ID)
    || haystack.includes(WORKSPACE_INTEGRITY_ISSUE.toLowerCase())
  ) return true;
  return /workspace integrity|binding provenance|source[- ]render|synthetic proof|orphan consumer|unconsumed source/.test(haystack);
}

function deriveWorkspaceIntegritySeedGrowth(payload = {}) {
  const contract = buildWorkspaceIntegritySeedV1();
  const records = payload.records || {};
  const relevant = [
    ...list(records.goalRecords),
    ...allRecords(payload),
  ].filter(isWorkspaceIntegrityRelevant);
  const latest = latestByTime(relevant);
  const planted = relevant.length > 0;
  const proved = relevant.filter(isPositiveProofRecord);
  const evidenceRecords = proved.filter((record) => (
    record?.seedHeartbeat?.schemaVersion !== 'stephanos.high-level-flywheel-seed-heartbeat.v1'
  ));
  const signal = (pattern) => evidenceRecords.filter((record) => pattern.test(workspaceIntegrityText(record)));
  const inventorySignals = signal(/inventory|workspace discovery|component discovery|visualiser inventory|binding registry/);
  const identitySignals = signal(/stable identit|workspace id|component id|unique identit/);
  const bindingSignals = signal(/canonical source|source binding|binding provenance|bound.*source/);
  const contractSignals = signal(/schema.*contract|unit.*contract|contract.*proven|schema version/);
  const hydrationSignals = signal(/hydration.*proven|transport provenance|source.*transport.*consumer|end-to-end hydration/);
  const reconciliationSignals = signal(/source[- ]render|rendered value|reconcil/);
  const syntheticSignals = signal(/synthetic.*proof|synthetic.*probe|end-to-end probe/);
  const orphanSignals = signal(/orphan[- ]free|no orphan|orphan audit|unconsumed source.*none|zero orphan/);
  const continuousSignals = signal(/continuous.*verif|integrity audit|regression monitoring/);

  const rungProof = [
    inventorySignals.length > 0,
    identitySignals.length > 0,
    bindingSignals.length > 0,
    contractSignals.length > 0,
    hydrationSignals.length > 0,
    reconciliationSignals.length > 0,
    syntheticSignals.length > 0,
    orphanSignals.length > 0,
    continuousSignals.length > 0,
  ];
  let currentRungIndex = null;
  if (planted) {
    currentRungIndex = 0;
    for (let index = 0; index < rungProof.length; index += 1) {
      if (!rungProof[index]) break;
      currentRungIndex = index;
    }
  }
  const currentRung = currentRungIndex === null
    ? 'AWAITING_LIVE_PROOF'
    : contract.growthRungs[currentRungIndex] || 'UNKNOWN';

  const redSignals = relevant.filter((record) => /workspace_integrity_broken|traffic.?light.?red|orphan consumer detected|schema mismatch|source[- ]render mismatch|unconsumed important source/.test(workspaceIntegrityText(record)));
  const amberSignals = relevant.filter((record) => /workspace_integrity_proof_incomplete|traffic.?light.?amber|freshness unknown|synthetic proof missing|rendered value unobserved/.test(workspaceIntegrityText(record)));
  const pressureState = !planted ? 'UNKNOWN' : (redSignals.length || amberSignals.length || rungProof.some((item) => !item)) ? 'ACTIVE' : 'CURRENT';

  const actions = [
    'Inventory every visible workspace, card and visualiser and publish stable component identities.',
    'Assign a stable workspaceId and componentId to every inventoried visual component.',
    'Bind every component to one canonical source, transport, transformation and consumer path.',
    'Publish and verify schema/version/unit contracts for every binding.',
    'Prove hydration from canonical source through transport to each consuming workspace.',
    'Reconcile canonical source values with rendered values and surface any mismatch as red.',
    'Run harmless synthetic end-to-end probes so green means the full path was exercised.',
    'Close orphan consumers and important sources with no declared consumer.',
    'Keep the full integrity mesh continuously verified and turn regressions into canonical repair pressure.',
  ];
  const nextMissing = rungProof.findIndex((item) => !item);
  const nextBestAction = !planted
    ? 'Publish the #2898 workspace-integrity seed heartbeat into Shared Workspace so end-to-end wiring can be measured.'
    : redSignals.length
      ? 'Repair the first red workspace-integrity fault through its existing canonical owner, then republish proof.'
      : nextMissing >= 0
        ? actions[nextMissing]
        : 'Continue the integrity audit and keep every binding green with fresh synthetic and source-render proof.';

  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted,
    persistent: true,
    missionId: contract.missionId,
    issueRef: contract.issueRef,
    title: contract.title,
    stage: planted ? currentRung : 'AWAITING_LIVE_PROOF',
    healthState: !planted ? 'AWAITING_LIVE_PROOF' : redSignals.length ? 'BROKEN_BINDINGS_PRESENT' : amberSignals.length ? 'PROOF_INCOMPLETE' : 'LEARNING',
    sourceTruth: latest ? truthFromRecord(latest) : 'UNKNOWN',
    northStar: contract.northStar,
    operatingLoop: contract.operatingLoop,
    growthRungs: contract.growthRungs,
    qualityDimensions: contract.qualityDimensions,
    operatorRole: contract.operatorRole,
    currentRungIndex,
    currentRung,
    pressureState,
    inventoryProofCount: planted ? inventorySignals.length : null,
    identityProofCount: planted ? identitySignals.length : null,
    canonicalBindingProofCount: planted ? bindingSignals.length : null,
    contractProofCount: planted ? contractSignals.length : null,
    hydrationProofCount: planted ? hydrationSignals.length : null,
    reconciliationProofCount: planted ? reconciliationSignals.length : null,
    syntheticProofCount: planted ? syntheticSignals.length : null,
    orphanAuditProofCount: planted ? orphanSignals.length : null,
    continuousAuditProofCount: planted ? continuousSignals.length : null,
    redFaultSignalCount: planted ? redSignals.length : null,
    amberGapSignalCount: planted ? amberSignals.length : null,
    proofCount: planted ? proved.flatMap(proofRefs).length : null,
    latestEvidenceAt: latest ? safeTime(latest) : '',
    nextBestAction,
  });
}


function deriveSovereignMeterIndependenceSeedGrowth(payload = {}) {
  const contract = buildSovereignMeterIndependenceSeedV1();
  const records = payload.records || {};
  const expectedSource = 'shared/runtime/sovereignMeterIndependenceSeedV1.mjs';
  // One canonical source-bound heartbeat plants the seed. A GitHub issue or
  // incidental mention alone is not a live signal or autonomous pickup.
  const heartbeat = list(records.statusRecords).find((record) =>
    record.statusId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID
      && record.seedHeartbeat?.schemaVersion === 'stephanos.high-level-flywheel-seed-heartbeat.v1'
      && record.seedHeartbeat.missionId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID
      && record.seedHeartbeat.issueRef === SOVEREIGN_METER_INDEPENDENCE_ISSUE
      && record.seedHeartbeat.contractSource === expectedSource);
  const planted = Boolean(heartbeat);
  const bound = (record) => record?.missionId === SOVEREIGN_METER_INDEPENDENCE_MISSION_ID
    || record?.relatedIssue === SOVEREIGN_METER_INDEPENDENCE_ISSUE;
  const relevant = planted ? [
    ...list(records.goalRecords),
    ...allRecords(payload),
  ].filter(bound) : [];
  const latest = latestByTime(relevant);
  const proved = relevant.filter((record) =>
    record !== heartbeat && isPositiveProofRecord(record) && proofRefs(record).length > 0);
  // Phase completion is typed, exact-mission evidence, not a prose keyword.
  const rungProof = contract.growthRungs.map((rung) => proved.some((record) =>
    record.meterIndependenceEvidence?.schemaVersion === 'stephanos.meter-independence-rung-proof.v1'
      && record.meterIndependenceEvidence?.rung === rung));
  const firstMissing = rungProof.findIndex((hasProof) => !hasProof);
  const currentRungIndex = planted ? (firstMissing < 0 ? rungProof.length - 1 : Math.max(0, firstMissing)) : null;
  const currentRung = currentRungIndex === null
    ? 'AWAITING_LIVE_PROOF'
    : contract.growthRungs[currentRungIndex];
  const gapHistory = deriveGapHistory(relevant);
  const currentGaps = gapHistory.current.slice(0, 8).map((gap) => Object.freeze({
    capabilityId: gap.capabilityId,
    owner: gap.owner,
    state: gap.state,
    summary: gap.summary,
  }));
  const actions = [
    'Inventory Codex, Remote Commander, paid relay, GitHub and model meters against existing owners and task classes.',
    'Map each metered critical task to an already-qualified local, Sovereign Commander, Forge or OpenClaw route.',
    'Deduplicate and classify the first remaining critical-path gap with canonical ownership and evidence.',
    'Build or adapt one safe native capability through the existing provider-neutral execution machinery.',
    'Prove equivalent representative tasks with bounded execution and exact-head evidence.',
    'Qualify the native route and make the canonical router prefer it without weakening review.',
    'Run a zero-meter build-and-repair blackout with worker pickup, result proof and protected gates.',
    'Continually recheck provider meters and regressions; preserve legitimate external service boundaries.',
  ];
  return Object.freeze({
    declared: true,
    contractTruth: 'SOURCE_PROVEN',
    planted,
    persistent: true,
    missionId: contract.missionId,
    issueRef: contract.issueRef,
    title: contract.title,
    stage: planted ? currentRung : 'AWAITING_LIVE_PROOF',
    healthState: !planted ? 'AWAITING_LIVE_PROOF' : currentGaps.length ? 'CRITICAL_PATH_GAPS_PRESENT' : firstMissing < 0 ? 'EVIDENCE_COMPLETE_AUDIT_REQUIRED' : 'LEARNING',
    sourceTruth: planted ? truthFromRecord(latest || heartbeat) : 'UNKNOWN',
    northStar: contract.northStar,
    operatingLoop: contract.operatingLoop,
    growthRungs: contract.growthRungs,
    qualityDimensions: contract.qualityDimensions,
    operatorRole: contract.operatorRole,
    currentRungIndex,
    currentRung,
    nextGrowthRung: planted && firstMissing >= 0 ? contract.growthRungs[firstMissing] : '',
    pressureState: !planted ? 'UNKNOWN' : currentGaps.length || firstMissing >= 0 ? 'ACTIVE' : 'CURRENT',
    proofCount: planted ? proved.flatMap(proofRefs).length : null,
    rungProofCount: planted ? rungProof.filter(Boolean).length : null,
    currentGaps: Object.freeze(currentGaps),
    latestEvidenceAt: planted ? safeTime(latest || heartbeat) : '',
    nextBestAction: !planted
      ? 'Publish the #2968 source-bound seed heartbeat into Shared Workspace.'
      : currentGaps.length
        ? 'Resolve the first evidenced meter-independence gap through its existing canonical owner: ' + currentGaps[0].summary
        : firstMissing >= 0
          ? actions[firstMissing]
          : 'Continue metered-dependency audits and replay zero-meter acceptance when routes change.',
  });
}

export function deriveFlywheelWorkspaceView(payload = {}, options = {}) {
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
      autonomousProjectSeedGrowth: deriveAutonomousProjectSeedGrowth({}),
      conversationalIntelligenceSeedGrowth: deriveConversationalIntelligenceSeedGrowth({}),
      sovereignCommanderParitySeedGrowth: deriveSovereignCommanderParitySeedGrowth({}),
      workspaceIntegritySeedGrowth: deriveWorkspaceIntegritySeedGrowth({}),
      sovereignMeterIndependenceSeedGrowth: deriveSovereignMeterIndependenceSeedGrowth({}),
      outcomeSeeds: Object.freeze([
        deriveOutcomeSeedGrowth({}),
        deriveWholeSystemSeedGrowth({}),
        deriveAutonomousProjectSeedGrowth({}),
        deriveConversationalIntelligenceSeedGrowth({}),
        deriveSovereignCommanderParitySeedGrowth({}),
        deriveWorkspaceIntegritySeedGrowth({}),
        deriveSovereignMeterIndependenceSeedGrowth({}),
      ]),
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
    autonomousProjectSeedGrowth: deriveAutonomousProjectSeedGrowth(payload),
    conversationalIntelligenceSeedGrowth: deriveConversationalIntelligenceSeedGrowth(payload),
    sovereignCommanderParitySeedGrowth: deriveSovereignCommanderParitySeedGrowth(payload),
    workspaceIntegritySeedGrowth: deriveWorkspaceIntegritySeedGrowth(payload),
    sovereignMeterIndependenceSeedGrowth: deriveSovereignMeterIndependenceSeedGrowth(payload),
    outcomeSeeds: Object.freeze([
      deriveOutcomeSeedGrowth(payload),
      deriveWholeSystemSeedGrowth(payload),
      deriveAutonomousProjectSeedGrowth(payload),
      deriveConversationalIntelligenceSeedGrowth(payload),
      deriveSovereignCommanderParitySeedGrowth(payload),
      deriveWorkspaceIntegritySeedGrowth(payload),
      deriveSovereignMeterIndependenceSeedGrowth(payload),
    ].map((seed) => Object.freeze({ ...seed,
      growthWork: projectSeedGrowthWorkV1(seed.missionId, payload.records.goalRecords,
        Number.isFinite(options.nowMs) ? options.nowMs : Date.now()),
    }))),
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
      evidenceTimeline: evidence?.evidenceTimeline || Object.freeze([]),
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
      evidenceTimeline: entry.evidenceTimeline,
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
