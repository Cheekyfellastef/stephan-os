import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_BOUNDARY_ADJUDICATION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
  canonicalStephanosQuestionIntentFingerprint,
  createStephanosCapabilityGapObservation,
  evaluateStephanosCapabilityRound,
  validateStephanosCapabilityAnswer,
  validateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';

const CREATED_AT = '2026-08-14T10:45:00.000Z';
const PRIOR_FINGERPRINTS = Object.freeze(Array.from({ length: 10 }, (_, index) => `intent-fingerprint-${String(index + 1).padStart(2, '0')}`));

const QUESTION_TEXT = Object.freeze({
  CURRENT_PROGRAMME_TRUTH: 'What is the current Stephanos programme state and what evidence makes that current?',
  ARCHITECTURE_AND_RELATIONSHIPS: 'How do Stephanos, OpenClaw, ChatGPT and the Shared Workspace relate without becoming competing identities?',
  MEMORY_AND_CONTINUITY: 'What should Stephanos remember across a restart, and which memory system owns that continuity?',
  AGENT_AND_TOOL_CAPABILITIES: 'Which executor should handle a normal repository repair and why?',
  BLOCKERS_AND_PROOF: 'What is blocked right now and what proof would close the blocker?',
  WHY_A_DECISION_WAS_MADE: 'Why is provider-neutral routing preferred over making one provider the permanent authority?',
  WHAT_CHANGED_RECENTLY: 'What materially changed in the programme recently, and how fresh is that evidence?',
  NEXT_BEST_ACTION: 'What is the next safest action and what outcome would it unlock?',
  CROSS_DOMAIN_CONNECTION: 'How should the VR Research Agent feed the Spatial World Foundry without creating a private VR reality?',
  SELF_KNOWLEDGE_AND_UNKNOWNS: 'What important thing do you not know yet, and how should that unknown become durable work?',
});

function question(questionClass, index, overrides = {}) {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'stephanos-round-001',
    questionId: `question-${String(index + 1).padStart(2, '0')}`,
    askerParticipantId: 'chatgpt',
    targetParticipantId: 'stephanos',
    questionText: QUESTION_TEXT[questionClass] || `Transfer question ${index + 1}`,
    questionClass,
    intentFingerprint: `intent-fingerprint-${String(index + 1).padStart(2, '0')}`,
    noveltyRefs: [],
    contextRefs: ['shared-workspace:programme-truth'],
    expectedEvidenceClass: 'CANONICAL_PROGRAMME_STATE',
    createdAtUtc: CREATED_AT,
    ...overrides,
  };
}

function round(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId: 'stephanos-round-001',
    roundNumber: 1,
    askerParticipantId: 'chatgpt',
    targetParticipantId: 'stephanos',
    questions: STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => question(questionClass, index)),
    createdAtUtc: CREATED_AT,
    ...overrides,
  };
}

function answer(questionRecord, overrides = {}) {
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: `answer-${questionRecord.questionId}`,
    questionId: questionRecord.questionId,
    roundId: questionRecord.roundId,
    responderParticipantId: 'stephanos',
    answerText: `Evidence-backed answer for ${questionRecord.questionClass}.`,
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: [`evidence:${questionRecord.questionId}`],
    freshness: 'FRESH',
    sourcesConsulted: ['shared-workspace', 'goal-graph'],
    cannotAnswerReason: null,
    answerVerdict: 'ANSWERED_GROUNDED',
    gapRefs: [],
    answeredAtUtc: CREATED_AT,
    ...overrides,
  };
}

function canonicalLaterQuestion(questionClass, index, overrides = {}) {
  const candidate = question(questionClass, index, {
    roundId: 'stephanos-round-002',
    questionId: `transfer-question-${String(index + 1).padStart(2, '0')}`,
    questionText: `Novel transfer scenario ${index + 1} for ${questionClass}.`,
    noveltyRefs: [`previous-round:${PRIOR_FINGERPRINTS[index]}`],
    ...overrides,
  });
  return {
    ...candidate,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate),
  };
}

function laterRound() {
  return round({
    roundId: 'stephanos-round-002',
    roundNumber: 2,
    questions: STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => canonicalLaterQuestion(questionClass, index)),
  });
}

function boundaryAdjudication(answerRecord, overrides = {}) {
  return {
    schemaVersion: STEPHANOS_BOUNDARY_ADJUDICATION_SCHEMA_VERSION,
    answerId: answerRecord.answerId,
    answerVerdict: answerRecord.answerVerdict,
    status: 'CURRENT',
    freshness: 'FRESH',
    evidenceRefs: [...answerRecord.evidenceRefs],
    sourcesConsulted: [...answerRecord.sourcesConsulted],
    proofRefs: ['evidence:boundary-adjudication'],
    adjudicatedAtUtc: CREATED_AT,
    ...overrides,
  };
}

test('initial Stephanos round requires exactly ten materially diverse question classes', () => {
  const verdict = validateStephanosCapabilityRound(round());
  assert.equal(verdict.valid, true);
  assert.deepEqual(verdict.errors, []);

  const missingClassRound = round();
  missingClassRound.questions[9] = question('CURRENT_PROGRAMME_TRUTH', 9, {
    intentFingerprint: 'different-fingerprint-10',
  });
  const missingVerdict = validateStephanosCapabilityRound(missingClassRound);
  assert.equal(missingVerdict.valid, false);
  assert.ok(missingVerdict.errors.some((error) => error.startsWith('initial-round-missing-classes:')));
});

test('round rejects duplicate intent fingerprints so ten labels cannot game the ladder', () => {
  const candidate = round();
  candidate.questions[9] = { ...candidate.questions[9], intentFingerprint: candidate.questions[0].intentFingerprint };
  const verdict = validateStephanosCapabilityRound(candidate);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('intentFingerprints-must-be-unique'));
});

test('later rounds bind novelty to canonical prior question intent and exact prior fingerprints', () => {
  const prior = round();
  const candidate = laterRound();
  const verdict = validateStephanosCapabilityRound(candidate, {
    priorRoundQuestions: prior.questions,
    priorRoundIntentFingerprints: PRIOR_FINGERPRINTS,
  });
  assert.equal(verdict.valid, true, verdict.errors.join(', '));

  const arbitraryRefs = laterRound();
  arbitraryRefs.questions = arbitraryRefs.questions.map((item) => ({ ...item, noveltyRefs: ['anything'] }));
  const arbitraryVerdict = validateStephanosCapabilityRound(arbitraryRefs, {
    priorRoundQuestions: prior.questions,
    priorRoundIntentFingerprints: PRIOR_FINGERPRINTS,
  });
  assert.equal(arbitraryVerdict.valid, false);
  assert.ok(arbitraryVerdict.errors.some((error) => error.includes('noveltyRefs-must-bind-prior-round-fingerprints')));
});

test('later rounds reject verbatim prior intent even when caller invents new fingerprint labels', () => {
  const prior = round();
  const replay = laterRound();
  replay.questions = replay.questions.map((item, index) => {
    const repeated = {
      ...item,
      questionText: prior.questions[index].questionText,
      intentFingerprint: `invented-transfer-${String(index + 1).padStart(2, '0')}`,
    };
    return repeated;
  });
  const verdict = validateStephanosCapabilityRound(replay, {
    priorRoundQuestions: prior.questions,
    priorRoundIntentFingerprints: PRIOR_FINGERPRINTS,
  });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.some((error) => error.includes('intentFingerprint-must-match-canonical-question-intent')));

  replay.questions = replay.questions.map((item) => ({
    ...item,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(item),
  }));
  const canonicalReplay = validateStephanosCapabilityRound(replay, {
    priorRoundQuestions: prior.questions,
    priorRoundIntentFingerprints: PRIOR_FINGERPRINTS,
  });
  assert.equal(canonicalReplay.valid, false);
  assert.ok(canonicalReplay.errors.some((error) => error.includes('canonical-intent-replays-prior-round')));
});

test('later rounds fail closed without the canonical prior question estate', () => {
  const candidate = laterRound();
  assert.equal(validateStephanosCapabilityRound(candidate).valid, false);
  const mismatch = validateStephanosCapabilityRound(candidate, {
    priorRoundQuestions: round().questions,
    priorRoundIntentFingerprints: ['wrong-fingerprint-01', ...PRIOR_FINGERPRINTS.slice(1)],
  });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.includes('priorRoundIntentFingerprints-do-not-match-priorRoundQuestions'));
});

test('grounded answers require evidence, consulted sources and fresh-enough epistemic state', () => {
  const q = round().questions[0];
  assert.equal(validateStephanosCapabilityAnswer(answer(q)).valid, true);

  const noEvidence = validateStephanosCapabilityAnswer(answer(q, { evidenceRefs: [] }));
  assert.equal(noEvidence.valid, false);
  assert.ok(noEvidence.errors.includes('grounded-answer-requires-evidence'));

  const stale = validateStephanosCapabilityAnswer(answer(q, {
    epistemicState: 'STALE',
    freshness: 'STALE',
  }));
  assert.equal(stale.valid, false);
  assert.ok(stale.errors.includes('grounded-answer-epistemic-state-insufficient'));
  assert.ok(stale.errors.includes('grounded-answer-freshness-insufficient'));
});

test('boundary verdicts require evidence, sources and fresh grounded epistemic state before adjudication', () => {
  const q = round().questions[0];
  const selfDeclared = validateStephanosCapabilityAnswer(answer(q, {
    answerText: 'I declare this outside my authority.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: [],
    freshness: 'UNKNOWN',
    sourcesConsulted: [],
    cannotAnswerReason: 'Self-declared boundary.',
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
  }));
  assert.equal(selfDeclared.valid, false);
  assert.ok(selfDeclared.errors.includes('boundary-answer-epistemic-state-insufficient'));
  assert.ok(selfDeclared.errors.includes('boundary-answer-freshness-insufficient'));
  assert.ok(selfDeclared.errors.includes('boundary-answer-requires-evidence'));
  assert.ok(selfDeclared.errors.includes('boundary-answer-requires-sources'));
});

test('a buildable miss becomes one deterministic gap observation linked to existing owners first', () => {
  const q = round().questions[2];
  const gapAnswer = answer(q, {
    answerText: 'I cannot currently retrieve the durable memory required to answer this correctly.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: [],
    freshness: 'UNKNOWN',
    sourcesConsulted: ['shared-workspace'],
    cannotAnswerReason: 'Durable memory recall did not return the required episode.',
    answerVerdict: 'GAP_MEMORY',
  });
  const first = createStephanosCapabilityGapObservation(q, gapAnswer);
  const second = createStephanosCapabilityGapObservation(q, gapAnswer);
  assert.equal(first.valid, true);
  assert.equal(first.gap.gapSignature, second.gap.gapSignature);
  assert.ok(first.gap.existingGoalCandidates.includes('#1645'));
  assert.equal(first.gap.repairGoalRef, null);
  assert.equal(first.gap.status, 'OBSERVED_NEEDS_DEDUPLICATION');
});

test('gap observation rejects responder identity that does not match the targeted participant', () => {
  const q = round().questions[2];
  const gapAnswer = answer(q, {
    responderParticipantId: 'openclaw',
    answerText: 'I cannot retrieve memory.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: [],
    freshness: 'UNKNOWN',
    sourcesConsulted: ['shared-workspace'],
    cannotAnswerReason: 'No durable memory retrieval.',
    answerVerdict: 'GAP_MEMORY',
  });
  const gap = createStephanosCapabilityGapObservation(q, gapAnswer);
  assert.equal(gap.valid, false);
  assert.deepEqual(gap.errors, ['question-answer-participant-mismatch']);
});

test('a ten-question round with one buildable miss cannot advance until repair replay', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  answers[5] = answer(capabilityRound.questions[5], {
    answerText: 'I cannot reconstruct the decision rationale from current evidence.',
    epistemicState: 'UNKNOWN',
    evidenceRefs: [],
    freshness: 'UNKNOWN',
    sourcesConsulted: ['goal-graph'],
    cannotAnswerReason: 'Decision rationale is not retrievable from the current canonical projection.',
    answerVerdict: 'GAP_RETRIEVAL',
  });

  const verdict = evaluateStephanosCapabilityRound({ round: capabilityRound, answers });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.state, 'GAPS_IDENTIFIED');
  assert.equal(verdict.counts.grounded, 9);
  assert.equal(verdict.counts.buildableGaps, 1);
  assert.equal(verdict.gapObservations.length, 1);
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.equal(verdict.requiresRepairReplay, true);
});

test('ten grounded answers settle the round and unlock a materially different round', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  const verdict = evaluateStephanosCapabilityRound({ round: capabilityRound, answers });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.state, 'SETTLED');
  assert.deepEqual(verdict.counts, {
    total: 10,
    grounded: 10,
    partial: 0,
    buildableGaps: 0,
    retainedBoundaries: 0,
  });
  assert.equal(verdict.mayAdvanceToNovelRound, true);
  assert.equal(verdict.requiresRepairReplay, false);
  assert.equal(verdict.requiresBoundaryAdjudication, false);
});

test('evidence-backed boundary remains safe-held until canonical evidence adjudication is proven', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  answers[9] = answer(capabilityRound.questions[9], {
    answerText: 'I cannot self-grant new runtime mutation authority.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['evidence:governing-authority-policy'],
    freshness: 'FRESH',
    sourcesConsulted: ['programme-authority'],
    cannotAnswerReason: 'Authority remains reserved to the governing policy and operator.',
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
  });
  const verdict = evaluateStephanosCapabilityRound({ round: capabilityRound, answers });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.state, 'SAFE_HOLD');
  assert.equal(verdict.counts.retainedBoundaries, 0);
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.equal(verdict.requiresBoundaryAdjudication, true);
  assert.equal(verdict.boundaryAdjudicationBlockers.length, 1);
});

test('fabricated boundary references cannot settle even with a self-authored adjudication object', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  const boundary = answer(capabilityRound.questions[9], {
    answerText: 'I cannot self-grant new runtime mutation authority.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['fabricated-evidence'],
    freshness: 'FRESH',
    sourcesConsulted: ['fabricated-source'],
    cannotAnswerReason: 'Claimed authority boundary.',
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
  });
  answers[9] = boundary;
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers,
    boundaryAdjudications: [boundaryAdjudication(boundary)],
    authoritativeEvidenceRefs: [],
    authoritativeSourceRefs: [],
    authoritativeAdjudicationProofRefs: [],
    evaluationNowMs: Date.parse(CREATED_AT),
  });
  assert.equal(verdict.state, 'SAFE_HOLD');
  assert.equal(verdict.requiresBoundaryAdjudication, true);
  assert.match(verdict.boundaryAdjudicationBlockers[0].errors.join('\n'), /authoritative-registry/);
});

test('canonical boundary adjudication may retain a genuine boundary and settle the round', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  const boundary = answer(capabilityRound.questions[9], {
    answerText: 'I cannot self-grant new runtime mutation authority.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['evidence:governing-authority-policy'],
    freshness: 'FRESH',
    sourcesConsulted: ['programme-authority'],
    cannotAnswerReason: 'Authority remains reserved to the governing policy and operator.',
    answerVerdict: 'UNSAFE_OR_AUTHORITY_BOUNDARY',
  });
  answers[9] = boundary;
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers,
    boundaryAdjudications: [boundaryAdjudication(boundary)],
    authoritativeEvidenceRefs: ['evidence:governing-authority-policy'],
    authoritativeSourceRefs: ['programme-authority'],
    authoritativeAdjudicationProofRefs: ['evidence:boundary-adjudication'],
    evaluationNowMs: Date.parse(CREATED_AT),
  });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.counts.retainedBoundaries, 1);
  assert.equal(verdict.counts.buildableGaps, 0);
  assert.equal(verdict.state, 'SETTLED');
  assert.equal(verdict.mayAdvanceToNovelRound, true);
  assert.equal(verdict.requiresBoundaryAdjudication, false);
});
