import { createHash } from 'node:crypto';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
  STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION,
  evaluateStephanosCapabilityRound,
} from './stephanosConversationalCapabilityLadderV1.mjs';

export const STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA = 'stephanos.question-novelty-ledger.v1';
export const STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA = 'stephanos.question-novelty-authority.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_REF = /^(?:#[1-9][0-9]{0,9}|[a-z0-9][a-z0-9._:/#-]{0,191})$/i;
const SAFE_FINGERPRINT = /^[a-z0-9][a-z0-9._:-]{7,191}$/i;
const SAFE_DIGEST = /^[0-9a-f]{64}$/;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INVALID = Symbol('invalid-data-only-question-novelty-record');
const LIMITS = Object.freeze({ array: 512, keys: 64, depth: 12, nodes: 8192, string: 24_000 });

const PRIOR_ENTRY_KEYS = Object.freeze(['round', 'answers', 'settlementProofRefs']);
const ROUND_KEYS = Object.freeze([
  'schemaVersion',
  'roundId',
  'roundNumber',
  'askerParticipantId',
  'targetParticipantId',
  'questions',
  'createdAtUtc',
]);
const QUESTION_KEYS = Object.freeze([
  'schemaVersion',
  'roundId',
  'questionId',
  'askerParticipantId',
  'targetParticipantId',
  'questionText',
  'questionClass',
  'intentFingerprint',
  'noveltyRefs',
  'contextRefs',
  'expectedEvidenceClass',
  'createdAtUtc',
]);
const LEDGER_KEYS = Object.freeze([
  'schemaVersion',
  'ledgerId',
  'priorRoundRefs',
  'highestSettledRoundNumber',
  'settlementProofRefsByRound',
  'questions',
  'questionCount',
  'fingerprintDigest',
  'contentDigest',
]);
const LEDGER_QUESTION_KEYS = Object.freeze([
  'roundId',
  'roundNumber',
  'questionId',
  'questionClass',
  'questionText',
  'normalizedText',
  'intentFingerprint',
  'expectedEvidenceClass',
  'noveltyRefs',
]);
const ROUND_PROOF_KEYS = Object.freeze(['roundId', 'roundNumber', 'settlementProofRefs']);

const THRESHOLDS = Object.freeze({
  globalLexicalReplay: 0.9,
  sameClassEvidenceReplay: 0.72,
  candidatePairReplay: 0.88,
  minimumCandidateClasses: 8,
});

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function dataOnly(value, state = null, depth = 0) {
  const traversal = state || { seen: new Set(), nodes: 0 };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length <= LIMITS.string ? value : INVALID;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
  if (!value || typeof value !== 'object' || depth > LIMITS.depth) return INVALID;
  traversal.nodes += 1;
  if (traversal.nodes > LIMITS.nodes || traversal.seen.has(value)) return INVALID;

  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return INVALID;
    traversal.seen.add(value);
    try {
      if (isArray) {
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor?.value;
        if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set || !Number.isSafeInteger(length) || length < 0 || length > LIMITS.array) return INVALID;
        const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
        if (keys.some((key) => !expected.has(key))) return INVALID;
        const output = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
          const normalized = dataOnly(descriptor.value, traversal, depth + 1);
          if (normalized === INVALID) return INVALID;
          output.push(normalized);
        }
        return Object.freeze(output);
      }
      if (keys.length > LIMITS.keys) return INVALID;
      const output = Object.create(null);
      for (const key of keys.sort(compareCodePoints)) {
        if (RESERVED_KEYS.has(key)) return INVALID;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
        const normalized = dataOnly(descriptor.value, traversal, depth + 1);
        if (normalized === INVALID) return INVALID;
        Object.defineProperty(output, key, { value: normalized, enumerable: true, configurable: false, writable: false });
      }
      return Object.freeze(output);
    } finally {
      traversal.seen.delete(value);
    }
  } catch {
    return INVALID;
  }
}

function exactShape(value, keys, errors, label) {
  if (!record(value)) {
    errors.push(`${label}-must-be-data-only-object`);
    return false;
  }
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  for (const key of actual) if (!expected.includes(key)) errors.push(`${label}-unknown-field:${key}`);
  for (const key of expected) if (!actual.includes(key)) errors.push(`${label}-missing-field:${key}`);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function exactIso(value) {
  const candidate = text(value);
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function safeRefs(value, errors, label, minimum = 0) {
  if (!Array.isArray(value)) {
    errors.push(`${label}-must-be-dense-array`);
    return [];
  }
  const entries = value.map(text);
  if (entries.some((entry) => !SAFE_REF.test(entry))) errors.push(`${label}-contains-invalid-ref`);
  if (new Set(entries).size !== entries.length) errors.push(`${label}-contains-duplicate-ref`);
  if (entries.length < minimum) errors.push(`${label}-requires-${minimum}`);
  return entries;
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedQuestionText(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalizedQuestionText(value).split(' ').filter(Boolean));
}

function lexicalSimilarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = leftTokens.size + rightTokens.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function validateCanonicalQuestion(question, errors, label, options = {}) {
  if (!exactShape(question, QUESTION_KEYS, errors, label)) return null;
  if (question.schemaVersion !== STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION) errors.push(`${label}-schema-version-mismatch`);
  for (const field of ['roundId', 'questionId', 'askerParticipantId', 'targetParticipantId', 'questionClass', 'expectedEvidenceClass']) {
    if (!safeId(question[field])) errors.push(`${label}-${field}-invalid`);
  }
  if (!text(question.questionText)) errors.push(`${label}-questionText-required`);
  if (text(question.questionText).length > 4096) errors.push(`${label}-questionText-too-long`);
  if (!SAFE_FINGERPRINT.test(text(question.intentFingerprint))) errors.push(`${label}-intentFingerprint-invalid`);
  const noveltyRefs = safeRefs(question.noveltyRefs, errors, `${label}-noveltyRefs`, options.requireNoveltyRefs ? 1 : 0);
  safeRefs(question.contextRefs, errors, `${label}-contextRefs`, 0);
  if (!exactIso(question.createdAtUtc)) errors.push(`${label}-createdAtUtc-invalid`);
  return Object.freeze({
    roundId: text(question.roundId),
    questionId: text(question.questionId),
    questionClass: text(question.questionClass).toUpperCase(),
    questionText: text(question.questionText),
    normalizedText: normalizedQuestionText(question.questionText),
    intentFingerprint: text(question.intentFingerprint),
    expectedEvidenceClass: text(question.expectedEvidenceClass).toUpperCase(),
    noveltyRefs: Object.freeze(noveltyRefs),
  });
}

function validateCanonicalRoundStructure(round, errors, label, options = {}) {
  if (!exactShape(round, ROUND_KEYS, errors, label)) return [];
  if (round.schemaVersion !== STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION) errors.push(`${label}-schema-version-mismatch`);
  for (const field of ['roundId', 'askerParticipantId', 'targetParticipantId']) if (!safeId(round[field])) errors.push(`${label}-${field}-invalid`);
  if (!Number.isSafeInteger(round.roundNumber) || round.roundNumber < 1) errors.push(`${label}-roundNumber-invalid`);
  if (!exactIso(round.createdAtUtc)) errors.push(`${label}-createdAtUtc-invalid`);
  if (!Array.isArray(round.questions) || round.questions.length !== 10) {
    errors.push(`${label}-questions-must-contain-exactly-10`);
    return [];
  }
  const questions = [];
  for (let index = 0; index < round.questions.length; index += 1) {
    const question = validateCanonicalQuestion(round.questions[index], errors, `${label}-question-${index + 1}`, options);
    if (!question) continue;
    if (question.roundId !== round.roundId) errors.push(`${label}-question-${index + 1}-roundId-mismatch`);
    if (round.questions[index].askerParticipantId !== round.askerParticipantId) errors.push(`${label}-question-${index + 1}-askerParticipantId-mismatch`);
    if (round.questions[index].targetParticipantId !== round.targetParticipantId) errors.push(`${label}-question-${index + 1}-targetParticipantId-mismatch`);
    questions.push(question);
  }
  if (new Set(questions.map((question) => question.questionId)).size !== 10) errors.push(`${label}-questionIds-must-be-unique`);
  if (new Set(questions.map((question) => question.intentFingerprint)).size !== 10) errors.push(`${label}-intentFingerprints-must-be-unique`);
  if (new Set(questions.map((question) => question.questionClass)).size < THRESHOLDS.minimumCandidateClasses) errors.push(`${label}-questionClass-diversity-below-${THRESHOLDS.minimumCandidateClasses}`);
  return questions;
}

function canonicalLedgerQuestion(question, roundNumber) {
  return Object.freeze({
    roundId: text(question.roundId),
    roundNumber,
    questionId: text(question.questionId),
    questionClass: text(question.questionClass).toUpperCase(),
    questionText: text(question.questionText),
    normalizedText: normalizedQuestionText(question.questionText),
    intentFingerprint: text(question.intentFingerprint),
    expectedEvidenceClass: text(question.expectedEvidenceClass).toUpperCase(),
    noveltyRefs: Object.freeze(Array.isArray(question.noveltyRefs) ? question.noveltyRefs.map(text) : []),
  });
}

function sortedLedgerQuestions(questions) {
  return [...questions]
    .map((question) => canonicalLedgerQuestion(question, question.roundNumber))
    .sort((left, right) => left.roundNumber - right.roundNumber || compareCodePoints(left.questionId, right.questionId));
}

function ledgerDigests(priorRoundRefs, settlementProofRefsByRound, questions) {
  const sortedQuestions = sortedLedgerQuestions(questions);
  const fingerprintDigest = canonicalHash(sortedQuestions.map((question) => question.intentFingerprint).sort(compareCodePoints));
  const contentDigest = canonicalHash({
    priorRoundRefs: [...priorRoundRefs],
    settlementProofRefsByRound,
    questions: sortedQuestions,
  });
  const ledgerId = `novelty-ledger-${canonicalHash({ priorRoundRefs: [...priorRoundRefs], contentDigest }).slice(0, 24)}`;
  return Object.freeze({ fingerprintDigest, contentDigest, ledgerId });
}

function safeHold(errors, details = {}) {
  return Object.freeze({
    schemaVersion: STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA,
    valid: false,
    verdict: 'SAFE_HOLD',
    mayAdmitNextRound: false,
    errors: Object.freeze([...new Set(errors)]),
    ...details,
    authority: Object.freeze({
      createsGoals: false,
      dispatchesWork: false,
      mutatesSource: false,
      approvesOrMerges: false,
      deploysOrMutatesRuntime: false,
      selectsProvider: false,
      spendsOrAccessesAccounts: false,
    }),
  });
}

export function buildStephanosQuestionNoveltyLedgerV1(input = {}) {
  const safeInput = dataOnly(input);
  const errors = [];
  if (safeInput === INVALID || !record(safeInput)) return Object.freeze({ valid: false, ledger: null, errors: Object.freeze(['input-must-be-data-only']) });
  const entries = safeInput.priorRounds;
  if (!Array.isArray(entries) || entries.length === 0) return Object.freeze({ valid: false, ledger: null, errors: Object.freeze(['priorRounds-requires-non-empty-dense-array']) });

  const normalizedRounds = [];
  const allQuestions = [];
  const seenRoundIds = new Set();
  const seenQuestionIds = new Set();
  const seenFingerprints = new Set();

  for (let roundIndex = 0; roundIndex < entries.length; roundIndex += 1) {
    const entry = entries[roundIndex];
    const label = `round-${roundIndex + 1}`;
    if (!exactShape(entry, PRIOR_ENTRY_KEYS, errors, label)) continue;
    const round = entry.round;
    const questions = validateCanonicalRoundStructure(round, errors, `${label}-snapshot`, { requireNoveltyRefs: round?.roundNumber > 1 });
    const proofRefs = safeRefs(entry.settlementProofRefs, errors, `${label}-settlementProofRefs`, 1);
    if (!Array.isArray(entry.answers) || entry.answers.length !== 10) errors.push(`${label}-answers-must-contain-exactly-10`);
    if (!round || questions.length !== 10 || !Array.isArray(entry.answers)) continue;

    const evaluation = evaluateStephanosCapabilityRound({ round, answers: entry.answers });
    if (evaluation.valid !== true || evaluation.roundId !== round.roundId || evaluation.state !== 'SETTLED') {
      errors.push(`${label}-canonical-evaluation-not-settled`);
    }
    if (evaluation.requiresRepairReplay === true || evaluation.requiresBoundaryAdjudication === true || evaluation.mayAdvanceToNovelRound !== true) {
      errors.push(`${label}-canonical-evaluation-not-eligible-for-next-round`);
    }
    if (seenRoundIds.has(round.roundId)) errors.push(`${label}-duplicate-roundId`);
    seenRoundIds.add(round.roundId);

    for (const question of questions) {
      if (seenQuestionIds.has(question.questionId)) errors.push(`${label}-duplicate-questionId:${question.questionId}`);
      if (seenFingerprints.has(question.intentFingerprint)) errors.push(`${label}-duplicate-intentFingerprint:${question.intentFingerprint}`);
      seenQuestionIds.add(question.questionId);
      seenFingerprints.add(question.intentFingerprint);
      allQuestions.push(Object.freeze({ ...question, roundNumber: round.roundNumber }));
    }
    normalizedRounds.push(Object.freeze({
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      settlementProofRefs: Object.freeze(proofRefs),
      evaluationDigest: canonicalHash(evaluation),
    }));
  }

  const sortedRoundNumbers = normalizedRounds.map((round) => round.roundNumber).sort((a, b) => a - b);
  for (let index = 0; index < sortedRoundNumbers.length; index += 1) {
    if (sortedRoundNumbers[index] !== index + 1) errors.push('priorRounds-must-form-contiguous-sequence-from-1');
  }
  if (errors.length > 0) return Object.freeze({ valid: false, ledger: null, errors: Object.freeze([...new Set(errors)]) });

  const sortedRounds = [...normalizedRounds].sort((left, right) => left.roundNumber - right.roundNumber);
  const priorRoundRefs = sortedRounds.map((round) => round.roundId);
  const settlementProofRefsByRound = Object.freeze(sortedRounds.map((round) => Object.freeze({
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    settlementProofRefs: round.settlementProofRefs,
  })));
  const digests = ledgerDigests(priorRoundRefs, settlementProofRefsByRound, allQuestions);
  const ledger = Object.freeze({
    schemaVersion: STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA,
    ledgerId: digests.ledgerId,
    priorRoundRefs: Object.freeze(priorRoundRefs),
    highestSettledRoundNumber: Math.max(...sortedRounds.map((round) => round.roundNumber)),
    settlementProofRefsByRound,
    questions: Object.freeze(sortedLedgerQuestions(allQuestions)),
    questionCount: allQuestions.length,
    fingerprintDigest: digests.fingerprintDigest,
    contentDigest: digests.contentDigest,
  });
  return Object.freeze({ valid: true, ledger, errors: Object.freeze([]) });
}

function validateLedgerSnapshot(ledger, errors) {
  if (!exactShape(ledger, LEDGER_KEYS, errors, 'ledger')) return;
  if (ledger.schemaVersion !== STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA) errors.push('ledger-schema-version-mismatch');
  if (!safeId(ledger.ledgerId)) errors.push('ledgerId-invalid');
  if (!Array.isArray(ledger.priorRoundRefs) || ledger.priorRoundRefs.length === 0 || ledger.priorRoundRefs.some((ref) => !safeId(ref))) errors.push('ledger-priorRoundRefs-invalid');
  if (Array.isArray(ledger.priorRoundRefs) && new Set(ledger.priorRoundRefs).size !== ledger.priorRoundRefs.length) errors.push('ledger-priorRoundRefs-duplicate');
  if (!Number.isSafeInteger(ledger.highestSettledRoundNumber) || ledger.highestSettledRoundNumber < 1) errors.push('ledger-highestSettledRoundNumber-invalid');
  if (Array.isArray(ledger.priorRoundRefs) && ledger.highestSettledRoundNumber !== ledger.priorRoundRefs.length) errors.push('ledger-round-sequence-not-contiguous');
  if (!Array.isArray(ledger.questions) || ledger.questions.length !== ledger.questionCount || ledger.questions.length < 10) errors.push('ledger-questionCount-invalid');
  if (!SAFE_DIGEST.test(text(ledger.fingerprintDigest))) errors.push('ledger-fingerprintDigest-invalid');
  if (!SAFE_DIGEST.test(text(ledger.contentDigest))) errors.push('ledger-contentDigest-invalid');

  if (!Array.isArray(ledger.settlementProofRefsByRound) || ledger.settlementProofRefsByRound.length !== ledger.priorRoundRefs.length) {
    errors.push('ledger-settlementProofRefsByRound-invalid');
  } else {
    for (let index = 0; index < ledger.settlementProofRefsByRound.length; index += 1) {
      const proof = ledger.settlementProofRefsByRound[index];
      if (!exactShape(proof, ROUND_PROOF_KEYS, errors, `ledger-round-proof-${index + 1}`)) continue;
      if (proof.roundId !== ledger.priorRoundRefs[index] || proof.roundNumber !== index + 1) errors.push(`ledger-round-proof-${index + 1}-sequence-mismatch`);
      safeRefs(proof.settlementProofRefs, errors, `ledger-round-proof-${index + 1}-settlementProofRefs`, 1);
    }
  }

  const roundQuestionCounts = new Map();
  const questionIds = new Set();
  const fingerprints = new Set();
  if (Array.isArray(ledger.questions)) {
    for (let index = 0; index < ledger.questions.length; index += 1) {
      const question = ledger.questions[index];
      const label = `ledger-question-${index + 1}`;
      if (!exactShape(question, LEDGER_QUESTION_KEYS, errors, label)) continue;
      if (!safeId(question.roundId) || !ledger.priorRoundRefs.includes(question.roundId)) errors.push(`${label}-roundId-invalid`);
      if (!Number.isSafeInteger(question.roundNumber) || question.roundNumber < 1 || question.roundNumber > ledger.highestSettledRoundNumber) errors.push(`${label}-roundNumber-invalid`);
      if (ledger.priorRoundRefs[question.roundNumber - 1] !== question.roundId) errors.push(`${label}-round-sequence-mismatch`);
      if (!safeId(question.questionId)) errors.push(`${label}-questionId-invalid`);
      if (!safeId(question.questionClass)) errors.push(`${label}-questionClass-invalid`);
      if (!text(question.questionText) || text(question.questionText).length > 4096) errors.push(`${label}-questionText-invalid`);
      if (text(question.normalizedText) !== normalizedQuestionText(question.questionText)) errors.push(`${label}-normalizedText-mismatch`);
      if (!SAFE_FINGERPRINT.test(text(question.intentFingerprint))) errors.push(`${label}-intentFingerprint-invalid`);
      if (!safeId(question.expectedEvidenceClass)) errors.push(`${label}-expectedEvidenceClass-invalid`);
      if (!Array.isArray(question.noveltyRefs) || question.noveltyRefs.some((ref) => !SAFE_REF.test(text(ref)))) errors.push(`${label}-noveltyRefs-invalid`);
      if (questionIds.has(question.questionId)) errors.push(`${label}-duplicate-questionId`);
      if (fingerprints.has(question.intentFingerprint)) errors.push(`${label}-duplicate-intentFingerprint`);
      questionIds.add(question.questionId);
      fingerprints.add(question.intentFingerprint);
      roundQuestionCounts.set(question.roundId, (roundQuestionCounts.get(question.roundId) || 0) + 1);
    }
  }
  for (const roundRef of ledger.priorRoundRefs || []) {
    if (roundQuestionCounts.get(roundRef) !== 10) errors.push(`ledger-round:${roundRef}:must-contain-exactly-10-questions`);
  }

  if (errors.length === 0) {
    const digests = ledgerDigests(ledger.priorRoundRefs, ledger.settlementProofRefsByRound, ledger.questions);
    if (ledger.fingerprintDigest !== digests.fingerprintDigest) errors.push('ledger-fingerprintDigest-mismatch');
    if (ledger.contentDigest !== digests.contentDigest) errors.push('ledger-contentDigest-mismatch');
    if (ledger.ledgerId !== digests.ledgerId) errors.push('ledgerId-content-mismatch');
  }
}

export function evaluateStephanosQuestionNoveltyAuthorityV1(input = {}) {
  const safeInput = dataOnly(input);
  if (safeInput === INVALID || !record(safeInput)) return safeHold(['input-must-be-data-only']);
  const ledger = safeInput.ledger;
  const candidateRound = safeInput.candidateRound;
  const errors = [];
  validateLedgerSnapshot(ledger, errors);
  const candidateQuestions = validateCanonicalRoundStructure(candidateRound, errors, 'candidateRound', { requireNoveltyRefs: true });
  if (candidateRound?.roundNumber !== ledger?.highestSettledRoundNumber + 1) errors.push('candidateRound-must-follow-highest-settled-round');
  if (errors.length > 0) return safeHold(errors, { ledgerId: text(ledger?.ledgerId), candidateRoundId: text(candidateRound?.roundId) });

  const priorQuestions = ledger.questions;
  const priorQuestionIds = new Set(priorQuestions.map((question) => text(question.questionId)));
  const priorFingerprints = new Set(priorQuestions.map((question) => text(question.intentFingerprint)));
  const questionVerdicts = [];

  for (const question of candidateQuestions) {
    const unknownRefs = question.noveltyRefs.filter((ref) => !priorQuestionIds.has(ref));
    if (unknownRefs.length > 0) errors.push(`candidate-question:${question.questionId}:noveltyRef-not-in-ledger:${unknownRefs.join(',')}`);
    const exactFingerprintSeen = priorFingerprints.has(question.intentFingerprint);
    let closestPriorQuestionId = priorQuestions[0]?.questionId || '';
    let closestSimilarity = closestPriorQuestionId ? lexicalSimilarity(question.questionText, priorQuestions[0].questionText) : 0;
    let closestSameClassEvidenceQuestionId = '';
    let closestSameClassEvidenceSimilarity = 0;
    for (const prior of priorQuestions) {
      const similarity = lexicalSimilarity(question.questionText, prior.questionText);
      if (!closestPriorQuestionId || similarity > closestSimilarity) {
        closestSimilarity = similarity;
        closestPriorQuestionId = prior.questionId;
      }
      if (question.questionClass === text(prior.questionClass).toUpperCase()
        && question.expectedEvidenceClass === text(prior.expectedEvidenceClass).toUpperCase()
        && (!closestSameClassEvidenceQuestionId || similarity > closestSameClassEvidenceSimilarity)) {
        closestSameClassEvidenceSimilarity = similarity;
        closestSameClassEvidenceQuestionId = prior.questionId;
      }
    }
    const closestReferenceAcknowledged = question.noveltyRefs.includes(closestPriorQuestionId);
    const materiallyNovel = !exactFingerprintSeen
      && closestSimilarity < THRESHOLDS.globalLexicalReplay
      && closestSameClassEvidenceSimilarity < THRESHOLDS.sameClassEvidenceReplay
      && closestReferenceAcknowledged
      && unknownRefs.length === 0;
    if (exactFingerprintSeen) errors.push(`candidate-question:${question.questionId}:intentFingerprint-already-seen`);
    if (closestSimilarity >= THRESHOLDS.globalLexicalReplay) errors.push(`candidate-question:${question.questionId}:global-lexical-replay`);
    if (closestSameClassEvidenceSimilarity >= THRESHOLDS.sameClassEvidenceReplay) errors.push(`candidate-question:${question.questionId}:same-class-evidence-replay`);
    if (!closestReferenceAcknowledged) errors.push(`candidate-question:${question.questionId}:closest-prior-question-must-be-in-noveltyRefs`);
    questionVerdicts.push(Object.freeze({
      questionId: question.questionId,
      exactFingerprintSeen,
      closestPriorQuestionId,
      closestSimilarity: Number(closestSimilarity.toFixed(6)),
      closestSameClassEvidenceQuestionId,
      closestSameClassEvidenceSimilarity: Number(closestSameClassEvidenceSimilarity.toFixed(6)),
      noveltyRefsVerified: unknownRefs.length === 0,
      closestReferenceAcknowledged,
      materiallyNovel,
    }));
  }

  let candidatePairMaxSimilarity = 0;
  let candidatePair = Object.freeze([]);
  for (let leftIndex = 0; leftIndex < candidateQuestions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidateQuestions.length; rightIndex += 1) {
      const similarity = lexicalSimilarity(candidateQuestions[leftIndex].questionText, candidateQuestions[rightIndex].questionText);
      if (similarity > candidatePairMaxSimilarity) {
        candidatePairMaxSimilarity = similarity;
        candidatePair = Object.freeze([candidateQuestions[leftIndex].questionId, candidateQuestions[rightIndex].questionId]);
      }
      if (similarity >= THRESHOLDS.candidatePairReplay) {
        errors.push(`candidate-pair-replay:${candidateQuestions[leftIndex].questionId}:${candidateQuestions[rightIndex].questionId}`);
      }
    }
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) return safeHold(uniqueErrors, {
    ledgerId: ledger.ledgerId,
    candidateRoundId: candidateRound.roundId,
    candidateRoundNumber: candidateRound.roundNumber,
    questionVerdicts: Object.freeze(questionVerdicts),
    setDiversity: Object.freeze({ uniqueClasses: new Set(candidateQuestions.map((question) => question.questionClass)).size, candidatePairMaxSimilarity: Number(candidatePairMaxSimilarity.toFixed(6)), candidatePair }),
  });

  return Object.freeze({
    schemaVersion: STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA,
    valid: true,
    verdict: 'NOVELTY_PROVEN',
    mayAdmitNextRound: true,
    errors: Object.freeze([]),
    ledgerId: ledger.ledgerId,
    ledgerFingerprintDigest: ledger.fingerprintDigest,
    ledgerContentDigest: ledger.contentDigest,
    candidateRoundId: candidateRound.roundId,
    candidateRoundNumber: candidateRound.roundNumber,
    priorRoundRefs: Object.freeze([...ledger.priorRoundRefs]),
    priorQuestionCount: ledger.questionCount,
    questionVerdicts: Object.freeze(questionVerdicts),
    setDiversity: Object.freeze({ uniqueClasses: new Set(candidateQuestions.map((question) => question.questionClass)).size, candidatePairMaxSimilarity: Number(candidatePairMaxSimilarity.toFixed(6)), candidatePair }),
    thresholds: THRESHOLDS,
    authority: Object.freeze({
      createsGoals: false,
      dispatchesWork: false,
      mutatesSource: false,
      approvesOrMerges: false,
      deploysOrMutatesRuntime: false,
      selectsProvider: false,
      spendsOrAccessesAccounts: false,
    }),
  });
}
