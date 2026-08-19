import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  canonicalStephanosQuestionIntentFingerprint,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA,
  STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA,
  buildStephanosQuestionNoveltyLedgerV1,
  evaluateStephanosQuestionNoveltyAuthorityV1,
} from './stephanosQuestionNoveltyAuthorityV1.mjs';

const CLASSES = Object.freeze([
  'CURRENT_PROGRAMME_TRUTH',
  'ARCHITECTURE_AND_RELATIONSHIPS',
  'MEMORY_AND_CONTINUITY',
  'AGENT_AND_TOOL_CAPABILITIES',
  'BLOCKERS_AND_PROOF',
  'WHY_A_DECISION_WAS_MADE',
  'WHAT_CHANGED_RECENTLY',
  'NEXT_BEST_ACTION',
  'CROSS_DOMAIN_CONNECTION',
  'SELF_KNOWLEDGE_AND_UNKNOWNS',
]);

const PRIOR_TEXTS = Object.freeze([
  'What is the current completion state of the Stephanos product programme?',
  'How do the Shared Workspace and Executive Agent Governor relate?',
  'Which memory layer preserves an unresolved operator idea across restart?',
  'Which qualified agent can inspect current provider capability without gaining authority?',
  'What evidence currently blocks a protected product merge?',
  'Why was provider neutral review separated from product implementation ownership?',
  'What changed recently in the Battle Bridge recovery architecture?',
  'What is the safest next action for a source green but unreviewed product PR?',
  'How does VR Research feed reusable methods into Spatial World Foundry?',
  'What does Stephanos know it cannot currently prove about its own live runtime?',
]);

const CANDIDATE_TEXTS = Object.freeze([
  'Which operator-facing products are source complete but still waiting for physical or served-head acceptance?',
  'Where does the native research council hand evidence back into canonical Stephanos synthesis?',
  'How is a corrected preference prevented from resurfacing through an older memory candidate?',
  'When one provider is unavailable which qualified research route may substitute without changing mission identity?',
  'Which receipts prove a research answer used fresh primary evidence instead of stale canonical state?',
  'Why must a self improvement proposal preserve separate merge and deployment authorization classes?',
  'Which system truth changed after the Ignition self healing repair entered protected main?',
  'What should Stephanos do when a cognitively correct answer is awkward to use on iPad?',
  'How can a Starfield VR finding become a lawful Spatial Foundry method without copying proprietary assets?',
  'Which parts of peer intelligence acceptance remain deliberately unproven after source completion?',
]);

const ROUND_ONE_CREATED = '2026-08-19T10:00:00.000Z';
const ROUND_TWO_CREATED = '2026-08-19T11:00:00.000Z';

function question({ roundId, roundNumber, index, questionText, noveltyRefs = [] }) {
  const candidate = {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId,
    questionId: `${roundId}-q${String(index + 1).padStart(2, '0')}`,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText,
    questionClass: CLASSES[index],
    intentFingerprint: 'intent-placeholder',
    noveltyRefs,
    contextRefs: ['#1776', '#1308', '#1607'],
    expectedEvidenceClass: `ROUND_${roundNumber}_EVIDENCE_${String(index + 1).padStart(2, '0')}`,
    createdAtUtc: roundNumber === 1 ? ROUND_ONE_CREATED : ROUND_TWO_CREATED,
  };
  return {
    ...candidate,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(candidate),
  };
}

function roundOne() {
  const roundId = 'round-001';
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId,
    roundNumber: 1,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questions: PRIOR_TEXTS.map((questionText, index) => question({ roundId, roundNumber: 1, index, questionText })),
    createdAtUtc: ROUND_ONE_CREATED,
  };
}

function groundedAnswers(round, overrides = {}) {
  return round.questions.map((item, index) => ({
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: `${round.roundId}-a${String(index + 1).padStart(2, '0')}`,
    questionId: item.questionId,
    roundId: round.roundId,
    responderParticipantId: 'stephanos',
    answerText: `Grounded canonical answer ${index + 1}.`,
    epistemicState: 'KNOWN_FROM_CANONICAL_STATE',
    evidenceRefs: [`proof:${round.roundId}:q${index + 1}`],
    freshness: 'FRESH',
    sourcesConsulted: [`canonical:${round.roundId}:q${index + 1}`],
    cannotAnswerReason: null,
    answerVerdict: 'ANSWERED_GROUNDED',
    gapRefs: [],
    answeredAtUtc: '2026-08-19T10:30:00.000Z',
    ...(overrides[index] || {}),
  }));
}

function settledEntry(overrides = {}) {
  const round = roundOne();
  return {
    round,
    answers: groundedAnswers(round),
    settlementProofRefs: ['proof:shared-workspace:round-001', 'proof:evaluator:round-001'],
    ...overrides,
  };
}

function buildLedger(entry = settledEntry()) {
  const built = buildStephanosQuestionNoveltyLedgerV1({ priorRounds: [entry] });
  assert.equal(built.valid, true, built.errors?.join(', '));
  return built.ledger;
}

function candidateRound(ledger, overrides = {}) {
  const roundId = 'round-002';
  const priorQuestionIds = ledger.questions.map((entry) => entry.questionId);
  return {
    schemaVersion: STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
    roundId,
    roundNumber: 2,
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questions: CANDIDATE_TEXTS.map((questionText, index) => question({
      roundId,
      roundNumber: 2,
      index,
      questionText,
      noveltyRefs: priorQuestionIds,
    })),
    createdAtUtc: ROUND_TWO_CREATED,
    ...overrides,
  };
}

test('builds a content-bound novelty ledger only from a canonically evaluated settled round', () => {
  const ledger = buildLedger();
  assert.equal(ledger.schemaVersion, STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA);
  assert.equal(ledger.highestSettledRoundNumber, 1);
  assert.equal(ledger.questionCount, 10);
  assert.equal(ledger.priorRoundRefs[0], 'round-001');
  assert.deepEqual(ledger.settlementProofRefsByRound[0].settlementProofRefs, [
    'proof:shared-workspace:round-001',
    'proof:evaluator:round-001',
  ]);
  assert.match(ledger.fingerprintDigest, /^[0-9a-f]{64}$/);
  assert.match(ledger.contentDigest, /^[0-9a-f]{64}$/);
  assert.match(ledger.ledgerId, /^novelty-ledger-[0-9a-f]{24}$/);
});

test('a caller cannot mark an unsettled round settled with a status string', () => {
  const round = roundOne();
  const answers = groundedAnswers(round, {
    0: {
      answerText: 'I cannot establish this from current evidence.',
      epistemicState: 'UNKNOWN',
      evidenceRefs: [],
      freshness: 'UNKNOWN',
      sourcesConsulted: [],
      cannotAnswerReason: 'canonical programme truth is not available',
      answerVerdict: 'GAP_KNOWLEDGE',
      gapRefs: ['gap:round-001:q1'],
    },
  });
  const built = buildStephanosQuestionNoveltyLedgerV1({
    priorRounds: [{ round, answers, settlementProofRefs: ['proof:claimed-settled'] }],
  });
  assert.equal(built.valid, false);
  assert.match(built.errors.join('\n'), /canonical-evaluation-not-settled|canonical-evaluation-not-eligible-for-next-round/);
});

test('missing durable settlement proof references cannot enter the novelty ledger', () => {
  const entry = settledEntry({ settlementProofRefs: [] });
  const built = buildStephanosQuestionNoveltyLedgerV1({ priorRounds: [entry] });
  assert.equal(built.valid, false);
  assert.match(built.errors.join('\n'), /settlementProofRefs-requires-1/);
});

test('admits one materially different full canonical next-round snapshot', () => {
  const ledger = buildLedger();
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidateRound(ledger) });
  assert.equal(verdict.schemaVersion, STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA);
  assert.equal(verdict.valid, true, verdict.errors.join(', '));
  assert.equal(verdict.verdict, 'NOVELTY_PROVEN');
  assert.equal(verdict.mayAdmitNextRound, true);
  assert.equal(verdict.questionVerdicts.length, 10);
  assert.equal(verdict.questionVerdicts.every((entry) => entry.materiallyNovel), true);
  assert.equal(verdict.setDiversity.uniqueClasses, 10);
  assert.deepEqual(verdict.authority, {
    createsGoals: false,
    dispatchesWork: false,
    mutatesSource: false,
    approvesOrMerges: false,
    deploysOrMutatesRuntime: false,
    selectsProvider: false,
    spendsOrAccessesAccounts: false,
  });
});

test('rejects an exact prior intent fingerprint even when wording changes', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger);
  candidate.questions[0] = {
    ...candidate.questions[0],
    intentFingerprint: ledger.questions[0].intentFingerprint,
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.mayAdmitNextRound, false);
  assert.match(verdict.errors.join('\n'), /intentFingerprint-already-seen/);
});

test('rejects a superficial lexical replay under a fresh fingerprint', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger);
  const replacement = {
    ...candidate.questions[0],
    questionText: PRIOR_TEXTS[0],
    expectedEvidenceClass: 'ROUND_2_EVIDENCE_01',
  };
  candidate.questions[0] = {
    ...replacement,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(replacement),
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /global-lexical-replay/);
});

test('rejects novelty references that are not present in the canonical ledger', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger);
  candidate.questions[0] = {
    ...candidate.questions[0],
    noveltyRefs: [...candidate.questions[0].noveltyRefs, 'invented-prior-question'],
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /noveltyRef-not-in-ledger/);
});

test('rejects a candidate that cites real history but omits its closest prior comparison', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger);
  candidate.questions[0] = {
    ...candidate.questions[0],
    noveltyRefs: [ledger.questions[9].questionId],
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /closest-prior-question-must-be-in-noveltyRefs/);
});

test('rejects a candidate set that contains near-duplicate questions', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger);
  const duplicateText = candidate.questions[0].questionText;
  const replacement = { ...candidate.questions[1], questionText: duplicateText };
  candidate.questions[1] = {
    ...replacement,
    intentFingerprint: canonicalStephanosQuestionIntentFingerprint(replacement),
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /candidate-pair-replay/);
});

test('requires the candidate to follow the highest settled round exactly', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger, { roundNumber: 3, roundId: 'round-003' });
  candidate.questions = candidate.questions.map((item, index) => ({
    ...item,
    roundId: 'round-003',
    questionId: `round-003-q${String(index + 1).padStart(2, '0')}`,
  }));
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /must-follow-highest-settled-round/);
});

test('rejects caller tampering with canonical ledger content or settlement proof', () => {
  const ledger = buildLedger();
  const tamperedQuestions = ledger.questions.map((entry, index) => index === 0 ? { ...entry, questionText: 'tampered prior question content' } : entry);
  const tamperedLedger = { ...ledger, questions: tamperedQuestions };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger: tamperedLedger, candidateRound: candidateRound(ledger) });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /normalizedText-mismatch|contentDigest-mismatch/);

  const alteredProofLedger = {
    ...ledger,
    settlementProofRefsByRound: [{
      ...ledger.settlementProofRefsByRound[0],
      settlementProofRefs: ['proof:substituted'],
    }],
  };
  const proofVerdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger: alteredProofLedger, candidateRound: candidateRound(ledger) });
  assert.equal(proofVerdict.valid, false);
  assert.match(proofVerdict.errors.join('\n'), /contentDigest-mismatch/);
});

test('rejects accessor-bearing or prototype-shaped caller data before novelty evaluation', () => {
  const ledger = buildLedger();
  const hostile = {};
  Object.defineProperty(hostile, 'ledger', { enumerable: true, get() { return ledger; } });
  hostile.candidateRound = candidateRound(ledger);
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1(hostile);
  assert.equal(verdict.valid, false);
  assert.deepEqual(verdict.errors, ['input-must-be-data-only']);
});
