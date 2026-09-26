import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
  evaluateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import { buildStephanosQuestionNoveltyLedgerV1 } from './stephanosQuestionNoveltyAuthorityV1.mjs';
import {
  RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY,
  RECURRING_MULTI_AGENT_CALIBRATION_DEFAULT_INTERVAL_MS,
  buildRecurringCapabilityCalibrationReadinessV1,
  buildRecurringCapabilityCalibrationRoundV1,
  evaluateRecurringCapabilityCalibrationDueV1,
  evaluateRecurringMultiAgentCalibrationCycleV1,
} from './recurringMultiAgentCapabilityCalibrationV1.mjs';

const NOW = '2026-09-26T20:30:00.000Z';

const QUESTION_TEXT = Object.freeze({
  CURRENT_PROGRAMME_TRUTH: 'What is the current programme truth, and which current evidence proves it?',
  ARCHITECTURE_AND_RELATIONSHIPS: 'How do your current architecture, peers and Shared Workspace relationships fit together?',
  MEMORY_AND_CONTINUITY: 'What should survive a restart, and what memory evidence proves that continuity?',
  AGENT_AND_TOOL_CAPABILITIES: 'Which tools and bounded authorities can you actually use right now?',
  BLOCKERS_AND_PROOF: 'What is blocked now, and what exact evidence would close the blocker?',
  WHY_A_DECISION_WAS_MADE: 'Why was the current design decision made, and where is the rationale recorded?',
  WHAT_CHANGED_RECENTLY: 'What changed recently, and which current evidence distinguishes it from stale history?',
  NEXT_BEST_ACTION: 'What is the next best safe action, and why does current evidence support it?',
  CROSS_DOMAIN_CONNECTION: 'Which cross-system connection is proven, and which part remains speculative?',
  SELF_KNOWLEDGE_AND_UNKNOWNS: 'What can you not prove, and how should each buildable unknown be represented?',
});

function seeds(roundNumber = 1, previousRound = null) {
  return STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => ({
    questionClass,
    questionText: QUESTION_TEXT[questionClass],
    expectedEvidenceClass: 'EVIDENCE_CLASS_' + String(index + 1).padStart(2, '0'),
    noveltyRefs: roundNumber > 1 ? [previousRound.questions[index].questionId] : [],
    contextRefs: ['workspace://shared-calibration'],
  }));
}

function buildRound(targetParticipantId, roundNumber = 1, options = {}) {
  return buildRecurringCapabilityCalibrationRoundV1({
    roundId: targetParticipantId + '-calibration-' + String(roundNumber).padStart(3, '0'),
    roundNumber,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId,
    createdAtUtc: NOW,
    questionSeeds: options.questionSeeds || seeds(roundNumber, options.previousRound),
    priorNoveltyLedger: options.priorNoveltyLedger,
  });
}
function answer(question, participantId, overrides = {}) {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: 'answer-' + question.questionId,
    questionId: question.questionId,
    roundId: question.roundId,
    responderParticipantId: participantId,
    answerText: 'Grounded answer for ' + question.questionClass + '.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['evidence:' + question.questionId],
    freshness: 'FRESH',
    sourcesConsulted: ['shared-workspace', 'runtime-proof'],
    cannotAnswerReason: null,
    answerVerdict: 'ANSWERED_GROUNDED',
    gapRefs: [],
    answeredAtUtc: NOW,
    ...overrides,
  };
}

function answersFor(round, participantId) {
  return round.questions.map((question) => answer(question, participantId));
}

test('scheduled calibration becomes due after the recurring interval and urgent events are immediately due', () => {
  const recent = new Date(Date.parse(NOW) - RECURRING_MULTI_AGENT_CALIBRATION_DEFAULT_INTERVAL_MS + 60_000).toISOString();
  const scheduled = evaluateRecurringCapabilityCalibrationDueV1({
    nowUtc: NOW,
    lastSettledAtUtc: recent,
    trigger: 'SCHEDULED',
  });
  assert.equal(scheduled.valid, true);
  assert.equal(scheduled.due, false);
  const correction = evaluateRecurringCapabilityCalibrationDueV1({
    nowUtc: NOW,
    lastSettledAtUtc: recent,
    trigger: 'OPERATOR_CORRECTION',
  });
  assert.equal(correction.due, true);
  assert.equal(correction.eventDue, true);
});
test('round builder requires all ten canonical classes and remains zero-authority', () => {
  const built = buildRound('stephanos');
  assert.equal(built.valid, true, built.errors.join(', '));
  assert.equal(built.round.questions.length, 10);
  assert.deepEqual(
    [...new Set(built.round.questions.map((question) => question.questionClass))].sort(),
    [...STEPHANOS_INITIAL_QUESTION_CLASSES].sort(),
  );
  assert.equal(built.authority.mutatesSource, false);
  assert.equal(built.authority.dispatchesWork, false);

  const broken = buildRecurringCapabilityCalibrationRoundV1({
    roundId: 'broken-round',
    roundNumber: 1,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    createdAtUtc: NOW,
    questionSeeds: seeds().slice(0, 9),
  });
  assert.equal(broken.valid, false);
  assert.ok(broken.errors.includes('questionSeeds-must-contain-exactly-10'));
});

test('later round cannot game novelty authority by repeating the old ten questions', () => {
  const first = buildRound('stephanos');
  assert.equal(first.valid, true);
  const firstAnswers = answersFor(first.round, 'stephanos');
  const ledger = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [{
      round: first.round,
      answers: firstAnswers,
      settlementProofRefs: ['proof://stephanos-calibration-round-1'],
    }],
  });
  assert.equal(ledger.valid, true, ledger.errors.join(', '));
  const copied = buildRound('stephanos', 2, {
    previousRound: first.round,
    priorNoveltyLedger: ledger.ledger,
  });
  assert.equal(copied.valid, false);
  assert.ok(copied.errors.includes('canonical-novelty-authority-rejected-round'));
});
test('settled multi-agent cycle publishes shared status and creates flywheel plus reflective candidates', () => {
  const stephanos = buildRound('stephanos');
  const openclaw = buildRound('openclaw-standalone');
  assert.equal(stephanos.valid, true);
  assert.equal(openclaw.valid, true);
  const result = evaluateRecurringMultiAgentCalibrationCycleV1({
    cycleId: 'calibration-cycle-20260926',
    observedAtUtc: NOW,
    trigger: 'SCHEDULED',
    participants: [
      {
        participantId: 'stephanos',
        round: stephanos.round,
        answers: answersFor(stephanos.round, 'stephanos'),
        proofRefs: ['proof/stephanos-round'],
      },
      {
        participantId: 'openclaw-standalone',
        round: openclaw.round,
        answers: answersFor(openclaw.round, 'openclaw-standalone'),
        proofRefs: ['proof/openclaw-round'],
      },
    ],
    learningEvents: [{
      eventId: 'openclaw-tool-recovery',
      participantId: 'openclaw-standalone',
      eventKind: 'FAILURE_RECOVERY',
      summary: 'A rejected bounded write was diagnosed, corrected and independently reverified.',
      evidenceRefs: ['proof/openclaw-recovery'],
    }],
  });
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.verdict, 'CALIBRATION_CYCLE_SETTLED');
  assert.equal(result.cycle.allSettled, true);
  assert.equal(result.cycle.nextNovelRoundAllowed, true);
  assert.equal(result.cycle.sharedWorkspaceRecords.length, 3);
  assert.ok(result.cycle.flywheelImprovementCandidates.some((candidate) => candidate.kind === 'FAILURE_RECOVERY'));
  assert.ok(result.cycle.flywheelImprovementCandidates.some((candidate) => candidate.kind === 'CALIBRATION_SYSTEM_REVIEW'));
  assert.ok(result.cycle.reflectiveMemoryCandidates.some((candidate) => candidate.reflectionKind === 'RECOVERY_PATTERN'));
  assert.equal(result.cycle.authority.writesSharedWorkspace, false);
});
test('a buildable gap is routed to repair replay and existing goal candidates before novel-round advancement', () => {
  const built = buildRound('openclaw-standalone');
  const answers = answersFor(built.round, 'openclaw-standalone');
  answers[2] = answer(built.round.questions[2], 'openclaw-standalone', {
    answerText: 'The required durable episode could not be recovered.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: ['evidence:memory-retrieval-miss'],
    sourcesConsulted: ['memory-search'],
    cannotAnswerReason: 'Durable memory retrieval did not return the required episode.',
    answerVerdict: 'GAP_MEMORY',
  });
  const result = evaluateRecurringMultiAgentCalibrationCycleV1({
    cycleId: 'calibration-cycle-gap',
    observedAtUtc: NOW,
    trigger: 'FAILURE_RECOVERY',
    participants: [{
      participantId: 'openclaw-standalone',
      round: built.round,
      answers,
      proofRefs: ['proof/openclaw-gap-round'],
    }],
  });
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.cycle.allSettled, false);
  assert.equal(result.cycle.repairReplayRequired, true);
  assert.equal(result.cycle.nextNovelRoundAllowed, false);
  const gap = result.cycle.flywheelImprovementCandidates.find((candidate) => candidate.kind === 'CAPABILITY_GAP');
  assert.ok(gap);
  assert.equal(gap.requiresExistingGoalSearch, true);
  assert.equal(gap.repairReplayRequired, true);
  assert.ok(gap.existingGoalCandidates.length > 0);
});
test('operator correction becomes shared learning but cannot self-promote memory or authority', () => {
  const built = buildRound('stephanos');
  const result = evaluateRecurringMultiAgentCalibrationCycleV1({
    cycleId: 'calibration-cycle-correction',
    observedAtUtc: NOW,
    trigger: 'OPERATOR_CORRECTION',
    participants: [{
      participantId: 'stephanos',
      round: built.round,
      answers: answersFor(built.round, 'stephanos'),
      proofRefs: ['proof/stephanos-settled'],
    }],
    learningEvents: [{
      eventId: 'restart-not-install',
      participantId: 'stephanos',
      eventKind: 'OPERATOR_CORRECTION',
      summary: 'Do not recommend restart as the repair when current evidence shows the component is not installed.',
      evidenceRefs: ['proof/plugin-not-installed'],
    }],
  });
  assert.equal(result.valid, true, result.errors.join(', '));
  const correction = result.cycle.flywheelImprovementCandidates.find((candidate) => candidate.kind === 'OPERATOR_CORRECTION');
  assert.ok(correction);
  assert.equal(correction.repairReplayRequired, true);
  const reflection = result.cycle.reflectiveMemoryCandidates.find((candidate) => candidate.reflectionKind === 'CORRECTION_PATTERN');
  assert.ok(reflection);
  assert.equal(reflection.promotionState, 'CANDIDATE');
  assert.equal(reflection.durablePromotionAllowed, false);
  assert.deepEqual(result.authority, RECURRING_MULTI_AGENT_CALIBRATION_AUTHORITY);
});
test('participant registry is extensible and duplicate identities fail closed', () => {
  const uiAgent = buildRound('ui-agent');
  const accepted = evaluateRecurringMultiAgentCalibrationCycleV1({
    cycleId: 'calibration-cycle-ui-agent',
    observedAtUtc: NOW,
    trigger: 'MANUAL',
    participants: [{
      participantId: 'ui-agent',
      round: uiAgent.round,
      answers: answersFor(uiAgent.round, 'ui-agent'),
      proofRefs: ['proof/ui-agent-round'],
    }],
  });
  assert.equal(accepted.valid, true);
  assert.equal(accepted.cycle.participantResults[0].participantId, 'ui-agent');

  const duplicate = evaluateRecurringMultiAgentCalibrationCycleV1({
    cycleId: 'calibration-cycle-duplicate',
    observedAtUtc: NOW,
    trigger: 'MANUAL',
    participants: [
      {
        participantId: 'ui-agent',
        round: uiAgent.round,
        answers: answersFor(uiAgent.round, 'ui-agent'),
        proofRefs: ['proof/ui-agent-round'],
      },
      {
        participantId: 'ui-agent',
        round: uiAgent.round,
        answers: answersFor(uiAgent.round, 'ui-agent'),
        proofRefs: ['proof/ui-agent-round'],
      },
    ],
  });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.includes('duplicate-participant:ui-agent'));
});

const NOVEL_QUESTION_TEXT = Object.freeze({
  CURRENT_PROGRAMME_TRUTH: 'A dashboard and a runtime receipt disagree after a controller restart. Which evidence governs the present state and how is the disagreement resolved?',
  ARCHITECTURE_AND_RELATIONSHIPS: 'A new specialist proposes a private queue. Which existing owners must it reuse and what evidence prevents a second control plane?',
  MEMORY_AND_CONTINUITY: 'After a machine reboot, reconstruct the active mission from durable evidence and identify what must remain unknown without a fresh receipt.',
  AGENT_AND_TOOL_CAPABILITIES: 'A repair needs inspection, bounded editing, deterministic tests and independent verification. Allocate those steps without widening any authority.',
  BLOCKERS_AND_PROOF: 'Local tests are green but the feature is not live. Name the separate proof boundaries that still prevent a production claim.',
  WHY_A_DECISION_WAS_MADE: 'A historical safety restriction now slows delivery. Reconstruct its original hazard and the evidence required before retiring or replacing it.',
  WHAT_CHANGED_RECENTLY: 'Two sources disagree about recent changes. Resolve freshness from timestamps and exact-head evidence while preserving any unresolved conflict.',
  NEXT_BEST_ACTION: 'Three safe tasks compete for one capacity slot. Select the next action from dependencies, impact and reversibility evidence without inventing urgency.',
  CROSS_DOMAIN_CONNECTION: 'A VR lesson could improve agent tooling. Define the evidence path through Shared Workspace and Flywheel without assuming the domains are already integrated.',
  SELF_KNOWLEDGE_AND_UNKNOWNS: 'Identify one evidence-access limitation and one reasoning uncertainty, then state the proof or owner required before either becomes known.',
});

function novelSeeds(previousRound) {
  const allPriorQuestionIds = previousRound.questions.map((question) => question.questionId);
  return STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => ({
    questionClass,
    questionText: NOVEL_QUESTION_TEXT[questionClass],
    expectedEvidenceClass: 'EVIDENCE_CLASS_' + String(index + 1).padStart(2, '0'),
    noveltyRefs: allPriorQuestionIds,
    contextRefs: ['workspace://shared-calibration', 'proof://prior-round'],
  }));
}
test('genuinely novel later round passes trusted novelty admission and can extend the canonical ledger', () => {
  const first = buildRound('stephanos');
  const firstAnswers = answersFor(first.round, 'stephanos');
  const firstLedger = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [{
      round: first.round,
      answers: firstAnswers,
      settlementProofRefs: ['proof://stephanos-round-1'],
    }],
  });
  assert.equal(firstLedger.valid, true, firstLedger.errors.join(', '));

  const second = buildRecurringCapabilityCalibrationRoundV1({
    roundId: 'stephanos-calibration-002',
    roundNumber: 2,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    createdAtUtc: NOW,
    questionSeeds: novelSeeds(first.round),
    priorNoveltyLedger: firstLedger.ledger,
    noveltyProofRefs: ['proof/stephanos-round-2-novelty'],
  });
  assert.equal(second.valid, true, second.errors.join(', '));
  assert.equal(second.noveltyAuthority.verdict, 'NOVELTY_PROVEN');
  assert.equal(second.novelRoundHostAuthority.roundId, second.round.roundId);
  const secondAnswers = answersFor(second.round, 'stephanos');
  const withoutTrustedHost = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [
      {
        round: first.round,
        answers: firstAnswers,
        settlementProofRefs: ['proof://stephanos-round-1'],
      },
      {
        round: second.round,
        answers: secondAnswers,
        settlementProofRefs: ['proof://stephanos-round-2'],
      },
    ],
  });
  assert.equal(withoutTrustedHost.valid, false);

  const extendedLedger = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [
      {
        round: first.round,
        answers: firstAnswers,
        settlementProofRefs: ['proof://stephanos-round-1'],
      },
      {
        round: second.round,
        answers: secondAnswers,
        settlementProofRefs: ['proof://stephanos-round-2'],
      },
    ],
  }, {
    novelRoundAuthorities: [second.novelRoundHostAuthority],
  });
  assert.equal(extendedLedger.valid, true, extendedLedger.errors.join(', '));
  assert.equal(extendedLedger.ledger.highestSettledRoundNumber, 2);
  assert.equal(extendedLedger.ledger.questionCount, 20);
});

test('caller payload cannot self-certify later-round novelty authority', () => {
  const first = buildRound('stephanos');
  const firstAnswers = answersFor(first.round, 'stephanos');
  const firstLedger = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [{
      round: first.round,
      answers: firstAnswers,
      settlementProofRefs: ['proof://stephanos-round-1'],
    }],
  });
  const second = buildRecurringCapabilityCalibrationRoundV1({
    roundId: 'stephanos-calibration-forgery-002',
    roundNumber: 2,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    createdAtUtc: NOW,
    questionSeeds: novelSeeds(first.round),
    priorNoveltyLedger: firstLedger.ledger,
    noveltyProofRefs: ['proof/forgery-round-2-novelty'],
  });
  assert.equal(second.valid, true, second.errors.join(', '));
  const secondAnswers = answersFor(second.round, 'stephanos');

  const forgedInsidePayload = evaluateStephanosCapabilityRound({
    round: second.round,
    answers: secondAnswers,
    trustedHostContext: second.novelRoundHostAuthority,
  });
  assert.equal(forgedInsidePayload.state, 'SAFE_HOLD');
  assert.equal(forgedInsidePayload.mayAdvanceToNovelRound, false);
  assert.ok(forgedInsidePayload.errors.includes('round:canonical-novelty-authority-unresolved'));

  const genuinelyTrusted = evaluateStephanosCapabilityRound(
    { round: second.round, answers: secondAnswers },
    second.novelRoundHostAuthority,
  );
  assert.equal(genuinelyTrusted.state, 'SETTLED');
  assert.equal(genuinelyTrusted.mayAdvanceToNovelRound, true);
});
test('trusted-host getters are rejected without executing them', () => {
  const first = buildRound('stephanos');
  const firstAnswers = answersFor(first.round, 'stephanos');
  const firstLedger = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [{
      round: first.round,
      answers: firstAnswers,
      settlementProofRefs: ['proof://stephanos-round-1'],
    }],
  });
  const second = buildRecurringCapabilityCalibrationRoundV1({
    roundId: 'stephanos-calibration-accessor-002',
    roundNumber: 2,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    createdAtUtc: NOW,
    questionSeeds: novelSeeds(first.round),
    priorNoveltyLedger: firstLedger.ledger,
    noveltyProofRefs: ['proof/accessor-round-2-novelty'],
  });
  assert.equal(second.valid, true, second.errors.join(', '));
  const secondAnswers = answersFor(second.round, 'stephanos');

  let touched = 0;
  const hostile = {
    roundId: second.round.roundId,
    roundNumber: second.round.roundNumber,
    noveltyAuthoritySchema: 'stephanos.question-novelty-authority.v1',
    noveltyVerdict: 'NOVELTY_PROVEN',
    ledgerId: second.noveltyAuthority.ledgerId,
    proofRefs: ['proof/accessor-round-2-novelty'],
  };
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() {
      touched += 1;
      throw new Error('getter must not run');
    },
  });

  const evaluated = evaluateStephanosCapabilityRound(
    { round: second.round, answers: secondAnswers },
    hostile,
  );
  assert.equal(touched, 0);
  assert.equal(evaluated.state, 'SAFE_HOLD');
  assert.ok(evaluated.errors.includes('round:canonical-novelty-authority-unresolved'));
  const hostileLedgerHost = {};
  Object.defineProperty(hostileLedgerHost, 'novelRoundAuthorities', {
    enumerable: true,
    get() {
      touched += 1;
      throw new Error('ledger getter must not run');
    },
  });
  const ledger = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [
      {
        round: first.round,
        answers: firstAnswers,
        settlementProofRefs: ['proof://stephanos-round-1'],
      },
      {
        round: second.round,
        answers: secondAnswers,
        settlementProofRefs: ['proof://stephanos-round-2'],
      },
    ],
  }, hostileLedgerHost);
  assert.equal(touched, 0);
  assert.equal(ledger.valid, false);
});

test('readiness derives due participants from existing Shared Workspace participant-status records', () => {
  const participantStatusRecords = [
    {
      kind: 'stephanos.shared_workspace.record.participant_status',
      participantStatusId: 'calibration-stephanos',
      participantId: 'stephanos',
      timestampUtc: '2026-09-25T20:30:00.000Z',
      status: 'calibrated',
    },
    {
      kind: 'stephanos.shared_workspace.record.participant_status',
      participantStatusId: 'openclaw-runtime',
      participantId: 'openclaw-standalone',
      timestampUtc: '2026-09-26T19:30:00.000Z',
      status: 'available',
    },
  ];
  const readiness = buildRecurringCapabilityCalibrationReadinessV1({
    nowUtc: NOW,
    trigger: 'SCHEDULED',
    participantStatusRecords,
  });
  assert.equal(readiness.valid, true);
  assert.deepEqual(readiness.dueParticipantIds, ['openclaw-standalone']);
  const stephanos = readiness.participants.find((participant) => participant.participantId === 'stephanos');
  const openclaw = readiness.participants.find((participant) => participant.participantId === 'openclaw-standalone');
  assert.equal(stephanos.due, false);
  assert.equal(openclaw.due, true);
  assert.equal(openclaw.lastSettledAtUtc, null);
  assert.equal(readiness.authority.dispatchesWork, false);
});
