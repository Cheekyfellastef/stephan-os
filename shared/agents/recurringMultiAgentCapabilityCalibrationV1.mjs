import { createHash } from 'node:crypto';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
  STEPHANOS_NOVEL_ROUND_HOST_AUTHORITY_SCHEMA_VERSION,
  evaluateStephanosCapabilityRound,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import { evaluateStephanosQuestionNoveltyAuthorityV1 } from './stephanosQuestionNoveltyAuthorityV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceParticipantStatusRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const RECURRING_MULTI_AGENT_CALIBRATION_SCHEMA = 'stephanos.recurring-multi-agent-capability-calibration.v1';
export const RECURRING_MULTI_AGENT_CALIBRATION_CYCLE_SCHEMA = 'stephanos.recurring-multi-agent-capability-calibration-cycle.v1';
export const RECURRING_MULTI_AGENT_CALIBRATION_DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECURRING_MULTI_AGENT_CALIBRATION_FAST_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RECURRING_MULTI_AGENT_CALIBRATION_RECOVERY_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
export const RECURRING_MULTI_AGENT_CALIBRATION_STABLE_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
export const RECURRING_MULTI_AGENT_CALIBRATION_REGISTERED_PARTICIPANTS = Object.freeze(['stephanos','openclaw-local','openclaw-standalone','stephanos-vr-research']);
export const RECURRING_MULTI_AGENT_CALIBRATION_TRIGGERS = Object.freeze([
  'SCHEDULED',
  'CAPABILITY_CHANGE',
  'FAILURE_RECOVERY',
  'OPERATOR_CORRECTION',
  'MODEL_PROVIDER_CHANGE',
  'AUTHORITY_CHANGE',
  'MANUAL',
]);

export const RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY = Object.freeze({
  createsGoals: false,
  dispatchesWork: false,
  mutatesSource: false,
  writesSharedWorkspace: false,
  promotesMemory: false,
  changesAuthority: false,
  approvesOrMerges: false,
  deploysOrMutatesRuntime: false,
  selectsProvider: false,
  spendsOrAccessesAccounts: false,
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const TRIGGERS = new Set(RECURRING_MULTI_AGENT_CALIBRATION_TRIGGERS);
const URGENT_TRIGGERS = new Set([
  'CAPABILITY_CHANGE', 'FAILURE_RECOVERY', 'OPERATOR_CORRECTION',
  'MODEL_PROVIDER_CHANGE', 'AUTHORITY_CHANGE',
]);
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function exactIso(value) {
  const candidate = text(value);
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function questionFingerprint(questionClass, questionText) {
  return `intent-${createHash('sha256').update(`${questionClass}\n${questionText}`).digest('hex').slice(0, 24)}`;
}

function uniqueStrings(value) {
  return [...new Set(list(value).map(text).filter(Boolean))];
}

function safeHold(errors, details = {}) {
  return freeze({
    schemaVersion: RECURRING_MULTI_AGENT_CALIBRATION_SCHEMA,
    valid: false,
    verdict: 'SAFE_HOLD',
    errors: uniqueStrings(errors),
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
    ...details,
  });
}

function normalizedQuestionSeed(seed = {}, index = 0) {
  const questionClass = text(seed.questionClass).toUpperCase();
  const questionText = text(seed.questionText);
  const expectedEvidenceClass = text(seed.expectedEvidenceClass).toUpperCase();
  const noveltyRefs = uniqueStrings(seed.noveltyRefs);
  const contextRefs = uniqueStrings(seed.contextRefs);
  return { questionClass, questionText, expectedEvidenceClass, noveltyRefs, contextRefs, index };
}
export function evaluateRecurringCapabilityCalibrationDueV1(input = {}) {
  const nowUtc = text(input.nowUtc);
  const lastSettledAtUtc = text(input.lastSettledAtUtc);
  const trigger = text(input.trigger).toUpperCase() || 'SCHEDULED';
  const intervalMs = Number.isFinite(input.intervalMs) && input.intervalMs > 0
    ? input.intervalMs
    : RECURRING_MULTI_AGENT_CALIBRATION_DEFAULT_INTERVAL_MS;
  if (!exactIso(nowUtc)) return safeHold(['nowUtc-invalid']);
  if (!TRIGGERS.has(trigger)) return safeHold(['trigger-invalid']);
  if (lastSettledAtUtc && !exactIso(lastSettledAtUtc)) return safeHold(['lastSettledAtUtc-invalid']);

  const nowMs = Date.parse(nowUtc);
  const lastMs = lastSettledAtUtc ? Date.parse(lastSettledAtUtc) : null;
  const scheduledDue = lastMs === null || nowMs - lastMs >= intervalMs;
  const eventDue = URGENT_TRIGGERS.has(trigger);
  const due = scheduledDue || eventDue || trigger === 'MANUAL';
  const nextDueAtUtc = lastMs === null
    ? nowUtc
    : new Date(lastMs + intervalMs).toISOString();
  return freeze({
    schemaVersion: RECURRING_MULTI_AGENT_CALIBRATION_SCHEMA,
    valid: true,
    verdict: due ? 'CALIBRATION_DUE' : 'CALIBRATION_NOT_DUE',
    due,
    trigger,
    scheduledDue,
    eventDue,
    nextDueAtUtc,
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
    errors: [],
  });
}
export function buildRecurringCapabilityCalibrationReadinessV1(input = {}) {
  const nowUtc = text(input.nowUtc);
  const trigger = text(input.trigger).toUpperCase() || 'SCHEDULED';
  const records = list(input.participantStatusRecords);
  if (!exactIso(nowUtc)) return safeHold(['nowUtc-invalid'], { participants: [] });
  if (!TRIGGERS.has(trigger)) return safeHold(['trigger-invalid'], { participants: [] });
  if (records.length > 512) return safeHold(['participantStatusRecords-too-many'], { participants: [] });

  const participants = new Map(RECURRING_MULTI_AGENT_CALIBRATION_REGISTERED_PARTICIPANTS.map(participantId=>[participantId,{participantId,lastSettledAtUtc:'',lastGapCount:null,settledStreak:0}]));
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (record.kind !== SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS) continue;
    const participantId = text(record.participantId);
    if (!safeId(participantId)) continue;
    const current = participants.get(participantId) || { participantId, lastSettledAtUtc: '' };
    if (text(record.participantStatusId) === `calibration-${participantId}` && exactIso(record.timestampUtc)) {
      if (!current.lastSettledAtUtc || Date.parse(record.timestampUtc) > Date.parse(current.lastSettledAtUtc)) {
        current.lastSettledAtUtc = record.timestampUtc;
        const status=text(record.status).toLowerCase();
        const summary=text(record.summary);
        const match=/buildableGaps=(\d+)/i.exec(summary);
        current.lastGapCount=status==='repair-replay-required' ? Math.max(1,Number(match?.[1]||1)) : (status==='calibrated'?0:null);
      }
    }
    participants.set(participantId, current);
  }

  const readiness = [...participants.values()]
    .sort((left, right) => left.participantId.localeCompare(right.participantId))
    .map((participant) => {
      const explicitInterval=Number.isFinite(input.intervalMs)&&input.intervalMs>0?input.intervalMs:null;
      const intervalMs=explicitInterval || (participant.lastGapCount>0
        ? RECURRING_MULTI_AGENT_CALIBRATION_FAST_INTERVAL_MS
        : RECURRING_MULTI_AGENT_CALIBRATION_DEFAULT_INTERVAL_MS);
      const due = evaluateRecurringCapabilityCalibrationDueV1({
        nowUtc,
        lastSettledAtUtc: participant.lastSettledAtUtc,
        trigger,
        intervalMs,
      });
      return freeze({
        participantId: participant.participantId,
        lastSettledAtUtc: participant.lastSettledAtUtc || null,
        due: due.valid === true && due.due === true,
        verdict: due.verdict,
        nextDueAtUtc: due.nextDueAtUtc || null,
        intervalMs,
      });
    });
  return freeze({
    schemaVersion: RECURRING_MULTI_AGENT_CALIBRATION_SCHEMA,
    valid: true,
    verdict: readiness.some((participant) => participant.due) ? 'CALIBRATION_PARTICIPANTS_DUE' : 'CALIBRATION_PARTICIPANTS_CURRENT',
    trigger,
    participants: readiness,
    dueParticipantIds: readiness.filter((participant) => participant.due).map((participant) => participant.participantId),
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
    errors: [],
  });
}

export function buildRecurringCapabilityCalibrationRoundV1(input = {}) {
  const errors = [];
  const roundId = text(input.roundId);
  const roundNumber = Number(input.roundNumber);
  const askerParticipantId = text(input.askerParticipantId);
  const targetParticipantId = text(input.targetParticipantId);
  const createdAtUtc = text(input.createdAtUtc);
  const seeds = list(input.questionSeeds).map(normalizedQuestionSeed);

  if (!safeId(roundId)) errors.push('roundId-invalid');
  if (!Number.isSafeInteger(roundNumber) || roundNumber < 1) errors.push('roundNumber-invalid');
  if (!safeId(askerParticipantId)) errors.push('askerParticipantId-invalid');
  if (!safeId(targetParticipantId)) errors.push('targetParticipantId-invalid');
  if (!exactIso(createdAtUtc)) errors.push('createdAtUtc-invalid');
  if (seeds.length !== 10) errors.push('questionSeeds-must-contain-exactly-10');

  const classes = seeds.map((seed) => seed.questionClass).sort();
  const expectedClasses = [...STEPHANOS_INITIAL_QUESTION_CLASSES].sort();
  if (JSON.stringify(classes) !== JSON.stringify(expectedClasses)) {
    errors.push('questionSeeds-must-cover-each-canonical-class-exactly-once');
  }
  for (const seed of seeds) {
    if (!seed.questionText) errors.push(`question-${seed.index + 1}-text-required`);
    if (!seed.expectedEvidenceClass || !safeId(seed.expectedEvidenceClass)) {
      errors.push(`question-${seed.index + 1}-expectedEvidenceClass-invalid`);
    }
    if (roundNumber > 1 && seed.noveltyRefs.length === 0) {
      errors.push(`question-${seed.index + 1}-noveltyRefs-required-after-round-one`);
    }
  }
  if (errors.length) return safeHold(errors, { round: null });

  const questions = seeds.map((seed, index) => freeze({
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId,
    questionId: `${roundId}-q${String(index + 1).padStart(2, '0')}`,
    askerParticipantId,
    targetParticipantId,
    questionText: seed.questionText,
    questionClass: seed.questionClass,
    intentFingerprint: questionFingerprint(seed.questionClass, seed.questionText),
    noveltyRefs: seed.noveltyRefs,
    contextRefs: seed.contextRefs,
    expectedEvidenceClass: seed.expectedEvidenceClass,
    createdAtUtc,
  }));
  const round = freeze({
    schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId,
    roundNumber,
    askerParticipantId,
    targetParticipantId,
    questions,
    createdAtUtc,
  });
  let noveltyAuthority = null;
  let novelRoundHostAuthority = null;
  if (roundNumber > 1) {
    if (!input.priorNoveltyLedger) return safeHold(['priorNoveltyLedger-required-after-round-one'], { round: null });
    noveltyAuthority = evaluateStephanosQuestionNoveltyAuthorityV1({
      ledger: input.priorNoveltyLedger,
      candidateRound: round,
    });
    if (noveltyAuthority.valid !== true || noveltyAuthority.mayAdmitNextRound !== true) {
      return safeHold(
        ['canonical-novelty-authority-rejected-round', ...list(noveltyAuthority.errors)],
        { round: null, noveltyAuthority },
      );
    }
    novelRoundHostAuthority = freeze({
      schemaVersion: STEPHANOS_NOVEL_ROUND_HOST_AUTHORITY_SCHEMA_VERSION,
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      noveltyAuthoritySchema: noveltyAuthority.schemaVersion,
      noveltyVerdict: noveltyAuthority.verdict,
      ledgerId: noveltyAuthority.ledgerId,
      proofRefs: uniqueStrings(input.noveltyProofRefs),
    });
    if (novelRoundHostAuthority.proofRefs.length === 0) {
      return safeHold(['noveltyProofRefs-required-after-round-one'], { round: null, noveltyAuthority });
    }
  }

  const validation = validateStephanosCapabilityRound(round, novelRoundHostAuthority || {});
  if (!validation.valid) return safeHold(validation.errors.map((error) => `round:${error}`), { round: null });

  return freeze({
    schemaVersion: RECURRING_MULTI_AGENT_CALIBRATION_SCHEMA,
    valid: true,
    verdict: 'ROUND_READY',
    errors: [],
    round,
    noveltyAuthority,
    novelRoundHostAuthority,
    noveltyProofRefs: novelRoundHostAuthority?.proofRefs || [],
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
  });
}
function improvementCandidate(input = {}) {
  const evidenceRefs = uniqueStrings(input.evidenceRefs);
  const candidateId = `calibration-improvement-${digest({
    participantId: input.participantId,
    kind: input.kind,
    summary: input.summary,
    evidenceRefs,
  }).slice(0, 24)}`;
  return freeze({
    candidateId,
    participantId: text(input.participantId),
    kind: text(input.kind),
    summary: text(input.summary),
    evidenceRefs,
    existingGoalCandidates: uniqueStrings(input.existingGoalCandidates),
    requiresExistingGoalSearch: true,
    repairReplayRequired: input.repairReplayRequired === true,
    sharedWorkspaceFirst: true,
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
  });
}

function reflectiveCandidate(input = {}) {
  return freeze({
    candidateId: `reflection-candidate-${digest(input).slice(0, 24)}`,
    participantId: text(input.participantId),
    reflectionKind: text(input.reflectionKind),
    patternSummary: text(input.patternSummary),
    evidenceRefs: uniqueStrings(input.evidenceRefs),
    promotionState: 'CANDIDATE',
    requiresIndependentValidation: true,
    durablePromotionAllowed: false,
  });
}
function participantStatusRecord(participantId, cycleId, observedAtUtc, evaluation, proofRefs) {
  const status = evaluation.state === 'SETTLED'
    ? 'calibrated'
    : evaluation.requiresRepairReplay
      ? 'repair-replay-required'
      : 'safe-hold';
  return createSharedWorkspaceParticipantStatusRecord({
    participantStatusId: `calibration-${participantId}`,
    participantId,
    timestampUtc: observedAtUtc,
    correlationId: cycleId,
    status,
    summary: `Capability calibration ${evaluation.state}; grounded=${evaluation.counts?.grounded ?? 0}; partial=${evaluation.counts?.partial ?? 0}; buildableGaps=${evaluation.counts?.buildableGaps ?? 0}.`,
    proofRefs,
    relatedIssue: '#1308',
  });
}

function cycleEventRecord(cycleId, observedAtUtc, trigger, participantCount, improvementCount) {
  return createSharedWorkspaceEventRecord({
    eventId: `calibration-${cycleId}`,
    participantId: 'durable-flywheel-controller',
    timestampUtc: observedAtUtc,
    eventKind: 'capability-calibration',
    summary: `Recurring capability calibration trigger=${trigger}; participants=${participantCount}; improvementCandidates=${improvementCount}.`,
  });
}
function learningEventCandidates(event, participantIds) {
  const errors = [];
  const eventId = text(event?.eventId);
  const participantId = text(event?.participantId);
  const eventKind = text(event?.eventKind).toUpperCase();
  const summary = text(event?.summary);
  const evidenceRefs = uniqueStrings(event?.evidenceRefs);
  if (!safeId(eventId)) errors.push('eventId-invalid');
  if (!participantIds.has(participantId)) errors.push('participantId-not-in-cycle');
  if (!['FAILURE_RECOVERY', 'OPERATOR_CORRECTION', 'SUCCESS_PATTERN', 'METHOD_IMPROVEMENT'].includes(eventKind)) {
    errors.push('eventKind-invalid');
  }
  if (!summary) errors.push('summary-required');
  if (evidenceRefs.length === 0) errors.push('evidenceRefs-required');
  if (errors.length) return { errors, improvements: [], reflections: [] };

  const kind = eventKind === 'OPERATOR_CORRECTION' ? 'OPERATOR_CORRECTION'
    : eventKind === 'FAILURE_RECOVERY' ? 'FAILURE_RECOVERY'
      : 'METHOD_IMPROVEMENT';
  const reflectionKind = eventKind === 'OPERATOR_CORRECTION' ? 'CORRECTION_PATTERN'
    : eventKind === 'FAILURE_RECOVERY' ? 'RECOVERY_PATTERN'
      : eventKind === 'SUCCESS_PATTERN' ? 'SUCCESS_PATTERN'
        : 'METHOD_CANDIDATE';
  return {
    errors: [],
    improvements: [improvementCandidate({
      participantId, kind, summary, evidenceRefs,
      repairReplayRequired: eventKind === 'OPERATOR_CORRECTION',
    })],
    reflections: [reflectiveCandidate({
      participantId, reflectionKind, patternSummary: summary, evidenceRefs,
    })],
  };
}
export function evaluateRecurringMultiAgentCalibrationCycleV1(input = {}) {
  const errors = [];
  const cycleId = text(input.cycleId);
  const observedAtUtc = text(input.observedAtUtc);
  const trigger = text(input.trigger).toUpperCase();
  const participants = list(input.participants);
  if (!safeId(cycleId)) errors.push('cycleId-invalid');
  if (!exactIso(observedAtUtc)) errors.push('observedAtUtc-invalid');
  if (!TRIGGERS.has(trigger)) errors.push('trigger-invalid');
  if (participants.length < 1 || participants.length > 32) errors.push('participants-count-invalid');
  const participantIds = new Set();
  for (const participant of participants) {
    const participantId = text(participant?.participantId);
    if (!safeId(participantId)) errors.push('participantId-invalid');
    if (participantIds.has(participantId)) errors.push(`duplicate-participant:${participantId}`);
    participantIds.add(participantId);
  }
  if (errors.length) return safeHold(errors, { cycle: null });

  const results = [];
  const improvements = [];
  const reflections = [];
  const workspaceRecords = [];
  for (const participant of participants) {
    const participantId = text(participant.participantId);
    const round = participant.round;
    const answers = participant.answers;
    if (round?.targetParticipantId !== participantId) {
      errors.push(`participant:${participantId}:round-target-mismatch`);
      continue;
    }
    let novelRoundHostAuthority = null;
    if (round?.roundNumber > 1) {
      if (!participant.priorNoveltyLedger) {
        errors.push(`participant:${participantId}:priorNoveltyLedger-required`);
        continue;
      }
      const novelty = evaluateStephanosQuestionNoveltyAuthorityV1({
        ledger: participant.priorNoveltyLedger,
        candidateRound: round,
      });
      if (novelty.valid !== true || novelty.mayAdmitNextRound !== true) {
        errors.push(`participant:${participantId}:novelty-authority-rejected`);
        continue;
      }
      const proofRefs = uniqueStrings(participant.noveltyProofRefs);
      if (proofRefs.length === 0) {
        errors.push(`participant:${participantId}:noveltyProofRefs-required`);
        continue;
      }
      novelRoundHostAuthority = freeze({
        schemaVersion: STEPHANOS_NOVEL_ROUND_HOST_AUTHORITY_SCHEMA_VERSION,
        roundId: round.roundId,
        roundNumber: round.roundNumber,
        noveltyAuthoritySchema: novelty.schemaVersion,
        noveltyVerdict: novelty.verdict,
        ledgerId: novelty.ledgerId,
        proofRefs,
      });
    }
    const evaluation = evaluateStephanosCapabilityRound({ round, answers }, novelRoundHostAuthority || {});
    const proofRefs = uniqueStrings(participant.proofRefs);
    results.push(freeze({ participantId, evaluation, proofRefs }));
    workspaceRecords.push(participantStatusRecord(participantId, cycleId, observedAtUtc, evaluation, proofRefs));
    for (const gap of list(evaluation.gapObservations)) {
      improvements.push(improvementCandidate({
        participantId,
        kind: 'CAPABILITY_GAP',
        summary: gap.summary || `${gap.gapClass} observed during recurring calibration.`,
        evidenceRefs: gap.evidenceRefs,
        existingGoalCandidates: gap.existingGoalCandidates,
        repairReplayRequired: true,
      }));
    }
    if (evaluation.requiresRepairReplay === true && list(evaluation.gapObservations).length === 0) {
      improvements.push(improvementCandidate({
        participantId,
        kind: 'REPAIR_REPLAY_REQUIRED',
        summary: 'Calibration produced a partial answer and must be repaired and replayed before a novel round.',
        evidenceRefs: proofRefs,
        repairReplayRequired: true,
      }));
    }
    if (evaluation.state === 'SETTLED') {
      reflections.push(reflectiveCandidate({
        participantId,
        reflectionKind: 'SUCCESS_PATTERN',
        patternSummary: 'Participant completed a settled ten-class calibration round with no repair replay required.',
        evidenceRefs: proofRefs,
      }));
    }
  }
  for (const event of list(input.learningEvents)) {
    const built = learningEventCandidates(event, participantIds);
    errors.push(...built.errors.map((error) => `learning-event:${text(event?.eventId) || 'unknown'}:${error}`));
    improvements.push(...built.improvements);
    reflections.push(...built.reflections);
  }
  if (errors.length) return safeHold(errors, { cycle: null });

  const allSettled = results.length === participants.length
    && results.every((result) => result.evaluation.valid === true && result.evaluation.state === 'SETTLED');
  improvements.push(improvementCandidate({
    participantId: 'durable-flywheel-controller',
    kind: 'CALIBRATION_SYSTEM_REVIEW',
    summary: 'Review recurring calibration evidence for improvements to question quality, evidence quality, routing, memory consolidation and repair/replay effectiveness.',
    evidenceRefs: uniqueStrings(results.flatMap((result) => result.proofRefs)),
    repairReplayRequired: false,
  }));
  const repairReplayRequired = results.some((result) => result.evaluation.requiresRepairReplay === true)
    || improvements.some((candidate) => candidate.repairReplayRequired === true);
  const boundaryHold = results.some((result) => result.evaluation.requiresBoundaryAdjudication === true);
  workspaceRecords.push(cycleEventRecord(cycleId, observedAtUtc, trigger, participants.length, improvements.length));

  for (const record of workspaceRecords) {
    const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(observedAtUtc) });
    if (!validation.valid) errors.push(`shared-workspace-record-invalid:${validation.refusalReason}`);
  }
  if (errors.length) return safeHold(errors, { cycle: null });

  const cycle = freeze({
    schemaVersion: RECURRING_MULTI_AGENT_CALIBRATION_CYCLE_SCHEMA,
    cycleId,
    observedAtUtc,
    trigger,
    participantResults: results,
    sharedWorkspaceRecords: workspaceRecords,
    flywheelImprovementCandidates: improvements,
    reflectiveMemoryCandidates: reflections,
    allSettled,
    repairReplayRequired,
    boundaryHold,
    nextNovelRoundAllowed: allSettled && !repairReplayRequired && !boundaryHold,
    sharedWorkspaceFirst: true,
    flywheelReviewRequired: true,
    dreamingReviewEligible: reflections.length > 0,
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
  });
  return freeze({
    schemaVersion: RECURRING_MULTI_AGENT_CALIBRATION_SCHEMA,
    valid: true,
    verdict: allSettled && !repairReplayRequired && !boundaryHold
      ? 'CALIBRATION_CYCLE_SETTLED'
      : 'CALIBRATION_CYCLE_REPAIR_OR_HOLD',
    errors: [],
    cycle,
    authority: RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
  });
}
