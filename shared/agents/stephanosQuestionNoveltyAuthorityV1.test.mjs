import assert from 'node:assert/strict';
import test from 'node:test';

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
  'Which product goals are now operator visible but still waiting for physical acceptance?',
  'Where does the native research council hand results back into canonical synthesis?',
  'How is a corrected preference prevented from resurfacing through an older memory candidate?',
  'When OpenClaw is unavailable which qualified research route may substitute without changing mission identity?',
  'Which receipts prove that a research answer used fresh primary evidence rather than stale canonical state?',
  'Why must a self improvement proposal preserve separate merge and deployment authorization classes?',
  'Which system truth changed after the Ignition self healing repair entered protected main?',
  'What should Stephanos do next when a cognitively correct answer is awkward to use on iPad?',
  'How can a Starfield VR research finding become a lawful reusable Spatial Foundry method without copying proprietary assets?',
  'Which parts of the peer intelligence acceptance remain deliberately unproven after source completion?',
]);

function question(roundNumber, index, textValue, noveltyRefs = []) {
  return {
    questionId: `round-${roundNumber}-question-${String(index + 1).padStart(2, '0')}`,
    questionClass: CLASSES[index],
    questionText: textValue,
    intentFingerprint: `intent-r${roundNumber}-q${String(index + 1).padStart(2, '0')}-abcdefghijk`,
    expectedEvidenceClass: `EVIDENCE_CLASS_${String(index + 1).padStart(2, '0')}`,
    noveltyRefs,
  };
}

function priorRound(overrides = {}) {
  return {
    roundId: 'round-001',
    roundNumber: 1,
    roundState: 'SETTLED',
    questions: PRIOR_TEXTS.map((value, index) => question(1, index, value)),
    ...overrides,
  };
}

function candidateRound(ledger, overrides = {}) {
  const priorQuestionIds = ledger.questions.map((entry) => entry.questionId);
  return {
    roundId: 'round-002',
    roundNumber: 2,
    questions: CANDIDATE_TEXTS.map((value, index) => question(2, index, value, priorQuestionIds)),
    ...overrides,
  };
}

function buildLedger(round = priorRound()) {
  const built = buildStephanosQuestionNoveltyLedgerV1({ priorRounds: [round] });
  assert.equal(built.valid, true, built.errors?.join(', '));
  return built.ledger;
}

test('builds a content-bound canonical novelty ledger from settled round truth', () => {
  const ledger = buildLedger();
  assert.equal(ledger.schemaVersion, STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA);
  assert.equal(ledger.highestSettledRoundNumber, 1);
  assert.equal(ledger.questionCount, 10);
  assert.equal(ledger.priorRoundRefs[0], 'round-001');
  assert.match(ledger.fingerprintDigest, /^[0-9a-f]{64}$/);
  assert.match(ledger.contentDigest, /^[0-9a-f]{64}$/);
  assert.match(ledger.ledgerId, /^novelty-ledger-[0-9a-f]{24}$/);
});

test('admits one materially different next round only from canonical prior-question references', () => {
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
  candidate.questions[0] = {
    ...candidate.questions[0],
    questionText: PRIOR_TEXTS[0],
    intentFingerprint: 'intent-fresh-fingerprint-abcdefgh',
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /global-lexical-replay|same-class-evidence-replay/);
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

test('rejects a candidate set that contains near-duplicate questions', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger);
  candidate.questions[1] = {
    ...candidate.questions[1],
    questionText: candidate.questions[0].questionText,
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /candidate-pair-replay/);
});

test('requires prior rounds to be settled and contiguous before they enter the ledger', () => {
  const unsettled = buildStephanosQuestionNoveltyLedgerV1({ priorRounds: [priorRound({ roundState: 'REGRESSION_PROVING' })] });
  assert.equal(unsettled.valid, false);
  assert.match(unsettled.errors.join('\n'), /must-be-settled/);

  const roundOne = priorRound();
  const roundThree = {
    roundId: 'round-003',
    roundNumber: 3,
    roundState: 'SETTLED',
    questions: PRIOR_TEXTS.map((value, index) => question(3, index, `${value} later`, roundOne.questions.map((entry) => entry.questionId))),
  };
  const nonContiguous = buildStephanosQuestionNoveltyLedgerV1({ priorRounds: [roundOne, roundThree] });
  assert.equal(nonContiguous.valid, false);
  assert.match(nonContiguous.errors.join('\n'), /contiguous-sequence-from-1/);
});

test('requires the candidate to follow the highest settled round exactly', () => {
  const ledger = buildLedger();
  const candidate = candidateRound(ledger, { roundNumber: 3, roundId: 'round-003' });
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger, candidateRound: candidate });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /must-follow-highest-settled-round/);
});

test('rejects caller tampering with canonical ledger content or digests', () => {
  const ledger = buildLedger();
  const tamperedLedger = {
    ...ledger,
    questions: ledger.questions.map((entry, index) => index === 0 ? { ...entry, questionText: 'tampered prior question content' } : entry),
  };
  const verdict = evaluateStephanosQuestionNoveltyAuthorityV1({ ledger: tamperedLedger, candidateRound: candidateRound(ledger) });
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join('\n'), /normalizedText-mismatch|contentDigest-mismatch/);
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
