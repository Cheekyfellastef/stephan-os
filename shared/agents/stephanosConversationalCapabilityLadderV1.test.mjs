import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  STEPHANOS_INITIAL_QUESTION_CLASSES,
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

function laterRound() {
  const questions = STEPHANOS_INITIAL_QUESTION_CLASSES.map((questionClass, index) => question(questionClass, index, {
    roundId: 'stephanos-round-002',
    questionId: `transfer-question-${String(index + 1).padStart(2, '0')}`,
    intentFingerprint: `transfer-fingerprint-${String(index + 1).padStart(2, '0')}`,
    questionText: `Novel transfer scenario ${index + 1} for ${questionClass}.`,
  }));
  return round({
    roundId: 'stephanos-round-002',
    roundNumber: 2,
    questions,
  });
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

test('round rejects duplicate intent fingerprints so ten paraphrases cannot game the ladder', () => {
  const candidate = round();
  candidate.questions[9] = { ...candidate.questions[9], intentFingerprint: candidate.questions[0].intentFingerprint };
  const verdict = validateStephanosCapabilityRound(candidate);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('intentFingerprints-must-be-unique'));
});

test('later rounds require novelty lineage bound to exact prior-round fingerprints', () => {
  const candidate = laterRound();
  assert.equal(validateStephanosCapabilityRound(candidate, { priorRoundIntentFingerprints: PRIOR_FINGERPRINTS }).valid, false);

  candidate.questions = candidate.questions.map((item, index) => ({
    ...item,
    noveltyRefs: [`previous-round:${PRIOR_FINGERPRINTS[index]}`],
  }));
  assert.equal(validateStephanosCapabilityRound(candidate, { priorRoundIntentFingerprints: PRIOR_FINGERPRINTS }).valid, true);

  const arbitraryRefs = laterRound();
  arbitraryRefs.questions = arbitraryRefs.questions.map((item) => ({ ...item, noveltyRefs: ['anything'] }));
  const arbitraryVerdict = validateStephanosCapabilityRound(arbitraryRefs, { priorRoundIntentFingerprints: PRIOR_FINGERPRINTS });
  assert.equal(arbitraryVerdict.valid, false);
  assert.ok(arbitraryVerdict.errors.some((error) => error.includes('noveltyRefs-must-bind-prior-round-fingerprints')));

  const replay = laterRound();
  replay.questions = replay.questions.map((item, index) => ({
    ...item,
    intentFingerprint: PRIOR_FINGERPRINTS[index],
    noveltyRefs: [`previous-round:${PRIOR_FINGERPRINTS[index]}`],
  }));
  const replayVerdict = validateStephanosCapabilityRound(replay, { priorRoundIntentFingerprints: PRIOR_FINGERPRINTS });
  assert.equal(replayVerdict.valid, false);
  assert.ok(replayVerdict.errors.some((error) => error.includes('intentFingerprint-replays-prior-round')));
});

test('later rounds fail closed when the prior fingerprint estate is absent or malformed', () => {
  const candidate = laterRound();
  candidate.questions = candidate.questions.map((item, index) => ({
    ...item,
    noveltyRefs: [`previous-round:${PRIOR_FINGERPRINTS[index]}`],
  }));
  assert.equal(validateStephanosCapabilityRound(candidate).valid, false);
  assert.equal(validateStephanosCapabilityRound(candidate, { priorRoundIntentFingerprints: ['too-few'] }).valid, false);
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

test('boundary verdicts require adjudicated evidence, sources and fresh grounded epistemic state', () => {
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
});

test('an evidence-backed authority boundary is retained rather than misclassified as build debt', () => {
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
  assert.equal(verdict.counts.retainedBoundaries, 1);
  assert.equal(verdict.counts.buildableGaps, 0);
  assert.equal(verdict.state, 'SETTLED');
  assert.equal(verdict.mayAdvanceToNovelRound, true);
});
