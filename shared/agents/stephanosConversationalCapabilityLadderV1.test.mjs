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

function laterQuestion(questionClass, index, overrides = {}) {
  const candidate = question(questionClass, index, {
    roundId: 'stephanos-round-002',
    questionId: `transfer-question-${String(index + 1).padStart(2, '0')}`,
    questionText: `Novel transfer scenario ${index + 1} for ${questionClass}.`,
    noveltyRefs: [`previous-round:intent-fingerprint-${String(index + 1).padStart(2, '0')}`],
    ...overrides,
  });
  return {
    ...candidate,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate),
  };
}

function laterRound(overrides = {}) {
  return round({
    roundId: 'stephanos-round-002',
    roundNumber: 2,
    questions: STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => laterQuestion(questionClass, index)),
    ...overrides,
  });
}

function boundaryAnswer(questionRecord, verdict = 'UNSAFE_OR_AUTHORITY_BOUNDARY') {
  return answer(questionRecord, {
    answerText: 'I cannot self-grant new runtime mutation authority.',
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: ['evidence:governing-authority-policy'],
    freshness: 'FRESH',
    sourcesConsulted: ['programme-authority'],
    cannotAnswerReason: 'Authority remains reserved to the governing policy and operator.',
    answerVerdict: verdict,
  });
}

function fabricatedBoundaryAdjudication(answerRecord) {
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
  };
}

test('initial Stephanos round requires exactly ten materially diverse classes', () => {
  const verdict = validateStephanosCapabilityRound(round());
  assert.equal(verdict.valid, true, verdict.errors.join(', '));

  const missing = round();
  missing.questions[9] = question('CURRENT_PROGRAMME_TRUTH', 9, { intentFingerprint: 'different-fingerprint-10' });
  const missingVerdict = validateStephanosCapabilityRound(missing);
  assert.equal(missingVerdict.valid, false);
  assert.ok(missingVerdict.errors.some((error) => error.startsWith('initial-round-missing-classes:')));
});

test('initial round rejects duplicate question and intent identities', () => {
  const duplicateFingerprint = round();
  duplicateFingerprint.questions[9] = { ...duplicateFingerprint.questions[9], intentFingerprint: duplicateFingerprint.questions[0].intentFingerprint };
  assert.ok(validateStephanosCapabilityRound(duplicateFingerprint).errors.includes('intentFingerprints-must-be-unique'));

  const duplicateQuestion = round();
  duplicateQuestion.questions[9] = { ...duplicateQuestion.questions[9], questionId: duplicateQuestion.questions[0].questionId };
  assert.ok(validateStephanosCapabilityRound(duplicateQuestion).errors.includes('questionIds-must-be-unique'));
});

test('every later round fails closed until canonical novelty authority exists', () => {
  const candidate = laterRound();
  const verdict = validateStephanosCapabilityRound(candidate, {
    priorRoundQuestions: round().questions,
    priorRoundIntentFingerprints: round().questions.map((item) => item.intentFingerprint),
    semanticNoveltyRegistry: { verified: true },
    verifyNovelty: () => true,
  });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('canonical-novelty-authority-unresolved'));
});

test('punctuation-only edits and fabricated prior estates cannot self-certify novelty', () => {
  const prior = round();
  const punctuation = laterRound({
    questions: prior.questions.map((item, index) => {
      const candidate = laterQuestion(item.questionClass, index, {
        questionText: `${item.questionText} !!!`,
      });
      return { ...candidate, intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate) };
    }),
  });
  const verdict = validateStephanosCapabilityRound(punctuation, {
    priorRoundQuestions: punctuation.questions,
    priorRoundIntentFingerprints: punctuation.questions.map((item) => item.intentFingerprint),
  });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('canonical-novelty-authority-unresolved'));
});

test('evaluation of a later round is SAFE_HOLD and cannot advance', () => {
  const capabilityRound = laterRound();
  const answers = capabilityRound.questions.map((item) => answer(item, { roundId: capabilityRound.roundId }));
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers,
    priorRoundQuestions: round().questions,
    priorRoundIntentFingerprints: round().questions.map((item) => item.intentFingerprint),
  });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.state, 'SAFE_HOLD');
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.ok(verdict.errors.includes('round:canonical-novelty-authority-unresolved'));
});

test('grounded answers require evidence, consulted sources and fresh grounded epistemic state', () => {
  const q = round().questions[0];
  assert.equal(validateStephanosCapabilityAnswer(answer(q)).valid, true);

  const noEvidence = validateStephanosCapabilityAnswer(answer(q, { evidenceRefs: [] }));
  assert.ok(noEvidence.errors.includes('grounded-answer-requires-evidence'));

  const stale = validateStephanosCapabilityAnswer(answer(q, { epistemicState: 'STALE', freshness: 'STALE' }));
  assert.ok(stale.errors.includes('grounded-answer-epistemic-state-insufficient'));
  assert.ok(stale.errors.includes('grounded-answer-freshness-insufficient'));
});

test('boundary-shaped answers still require evidence before evaluation', () => {
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

test('a buildable miss becomes one deterministic gap linked to existing owners first', () => {
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
});

test('gap observations bind the answer to the targeted participant', () => {
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

test('one buildable miss prevents advancement until repair replay', () => {
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
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.equal(verdict.requiresRepairReplay, true);
});

test('ten grounded initial answers settle the round', () => {
  const capabilityRound = round();
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers: capabilityRound.questions.map((item) => answer(item)),
  });
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
  assert.equal(verdict.requiresBoundaryAdjudication, false);
});

test('every boundary verdict remains unadjudicated in M1', () => {
  for (const boundaryVerdict of ['UNSAFE_OR_AUTHORITY_BOUNDARY', 'EXTERNAL_UNBUILDABLE', 'INTENTIONALLY_UNSUPPORTED']) {
    const capabilityRound = round();
    const answers = capabilityRound.questions.map((item) => answer(item));
    answers[9] = boundaryAnswer(capabilityRound.questions[9], boundaryVerdict);
    const verdict = evaluateStephanosCapabilityRound({ round: capabilityRound, answers });
    assert.equal(verdict.valid, true, boundaryVerdict);
    assert.equal(verdict.state, 'SAFE_HOLD', boundaryVerdict);
    assert.equal(verdict.counts.retainedBoundaries, 0, boundaryVerdict);
    assert.equal(verdict.mayAdvanceToNovelRound, false, boundaryVerdict);
    assert.equal(verdict.requiresBoundaryAdjudication, true, boundaryVerdict);
    assert.deepEqual(verdict.boundaryAdjudicationBlockers[0].errors, ['canonical-boundary-proof-authority-unresolved']);
  }
});

test('fabricated or apparently canonical registries and adjudications cannot retain a boundary', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  const boundary = boundaryAnswer(capabilityRound.questions[9]);
  answers[9] = boundary;
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers,
    boundaryAdjudications: [fabricatedBoundaryAdjudication(boundary)],
    authoritativeEvidenceRefs: ['evidence:governing-authority-policy'],
    authoritativeSourceRefs: ['programme-authority'],
    authoritativeAdjudicationProofRefs: ['evidence:boundary-adjudication'],
    evaluationNowMs: Date.parse(CREATED_AT),
  });
  assert.equal(verdict.valid, true);
  assert.equal(verdict.state, 'SAFE_HOLD');
  assert.equal(verdict.counts.retainedBoundaries, 0);
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.equal(verdict.requiresBoundaryAdjudication, true);
  assert.deepEqual(verdict.boundaryAdjudicationBlockers[0].errors, ['canonical-boundary-proof-authority-unresolved']);
});

test('function injection cannot become boundary authority', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  const boundary = boundaryAnswer(capabilityRound.questions[9]);
  answers[9] = boundary;
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers,
    boundaryAdjudications: [fabricatedBoundaryAdjudication(boundary)],
    authoritativeEvidenceRefs: ['evidence:governing-authority-policy'],
    authoritativeSourceRefs: ['programme-authority'],
    authoritativeAdjudicationProofRefs: ['evidence:boundary-adjudication'],
    verifyBoundary: () => true,
    evaluationNowMs: Date.parse(CREATED_AT),
  });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.state, 'SAFE_HOLD');
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.deepEqual(verdict.errors, ['input-must-be-data-only']);
});

test('replayed answer adjudication IDs cannot become boundary authority', () => {
  const capabilityRound = round();
  const answers = capabilityRound.questions.map((item) => answer(item));
  const boundary = boundaryAnswer(capabilityRound.questions[9]);
  answers[9] = boundary;
  const replay = fabricatedBoundaryAdjudication(boundary);
  const verdict = evaluateStephanosCapabilityRound({
    round: capabilityRound,
    answers,
    boundaryAdjudications: [replay, { ...replay }],
  });
  assert.equal(verdict.state, 'SAFE_HOLD');
  assert.equal(verdict.mayAdvanceToNovelRound, false);
  assert.equal(verdict.counts.retainedBoundaries, 0);
});

test('accessor-backed, cyclic and custom-prototype inputs fail closed without getters', () => {
  let calls = 0;
  const hostile = round();
  Object.defineProperty(hostile, 'questions', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('questions getter must not run');
    },
  });
  let verdict;
  assert.doesNotThrow(() => { verdict = validateStephanosCapabilityRound(hostile); });
  assert.equal(calls, 0);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('round-must-be-data-only'));

  const cycle = round();
  cycle.questions[0].contextRefs.push(cycle);
  assert.equal(validateStephanosCapabilityRound(cycle).valid, false);

  const inherited = Object.assign(Object.create({ mergeAllowed: true }), round());
  assert.equal(validateStephanosCapabilityRound(inherited).valid, false);
});