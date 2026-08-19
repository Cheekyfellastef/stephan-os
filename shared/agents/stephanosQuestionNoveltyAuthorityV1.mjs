import { createHash } from 'node:crypto';

export const STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA = 'stephanos.question-novelty-ledger.v1';
export const STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA = 'stephanos.question-novelty-authority.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_FINGERPRINT = /^[a-z0-9][a-z0-9._:-]{7,191}$/i;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INVALID = Symbol('invalid-data-only-question-novelty-record');
const LIMITS = Object.freeze({ array: 512, keys: 64, depth: 12, nodes: 8192, string: 24_000 });

const PRIOR_ROUND_KEYS = Object.freeze(['roundId', 'roundNumber', 'roundState', 'questions']);
const QUESTION_KEYS = Object.freeze([
  'questionId',
  'questionClass',
  'questionText',
  'intentFingerprint',
  'expectedEvidenceClass',
  'noveltyRefs',
]);
const CANDIDATE_ROUND_KEYS = Object.freeze(['roundId', 'roundNumber', 'questions']);
const LEDGER_KEYS = Object.freeze([
  'schemaVersion',
  'ledgerId',
  'priorRoundRefs',
  'highestSettledRoundNumber',
  'questions',
  'questionCount',
  'fingerprintDigest',
]);

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
  return true;
}

function safeId(value) {
  return SAFE_ID.test(text(value));
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

function normalizeQuestion(question, errors, label, requireNoveltyRefs) {
  if (!exactShape(question, QUESTION_KEYS, errors, label)) return null;
  if (!safeId(question.questionId)) errors.push(`${label}-questionId-invalid`);
  if (!safeId(question.questionClass)) errors.push(`${label}-questionClass-invalid`);
  if (!text(question.questionText)) errors.push(`${label}-questionText-required`);
  if (text(question.questionText).length > 4096) errors.push(`${label}-questionText-too-long`);
  if (!SAFE_FINGERPRINT.test(text(question.intentFingerprint))) errors.push(`${label}-intentFingerprint-invalid`);
  if (!safeId(question.expectedEvidenceClass)) errors.push(`${label}-expectedEvidenceClass-invalid`);
  if (!Array.isArray(question.noveltyRefs)) errors.push(`${label}-noveltyRefs-must-be-dense-array`);
  const noveltyRefs = Array.isArray(question.noveltyRefs) ? question.noveltyRefs.map(text) : [];
  if (noveltyRefs.some((value) => !safeId(value))) errors.push(`${label}-noveltyRefs-invalid`);
  if (new Set(noveltyRefs).size !== noveltyRefs.length) errors.push(`${label}-noveltyRefs-duplicate`);
  if (requireNoveltyRefs && noveltyRefs.length === 0) errors.push(`${label}-noveltyRefs-required`);
  return Object.freeze({
    questionId: text(question.questionId),
    questionClass: text(question.questionClass).toUpperCase(),
    questionText: text(question.questionText),
    normalizedText: normalizedQuestionText(question.questionText),
    intentFingerprint: text(question.intentFingerprint),
    expectedEvidenceClass: text(question.expectedEvidenceClass).toUpperCase(),
    noveltyRefs: Object.freeze(noveltyRefs),
  });
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
  const rounds = safeInput.priorRounds;
  if (!Array.isArray(rounds) || rounds.length === 0) return Object.freeze({ valid: false, ledger: null, errors: Object.freeze(['priorRounds-requires-non-empty-dense-array']) });

  const normalizedRounds = [];
  const allQuestions = [];
  const seenRoundIds = new Set();
  const seenQuestionIds = new Set();
  const seenFingerprints = new Set();

  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex];
    const label = `round-${roundIndex + 1}`;
    if (!exactShape(round, PRIOR_ROUND_KEYS, errors, label)) continue;
    if (!safeId(round.roundId)) errors.push(`${label}-roundId-invalid`);
    if (!Number.isSafeInteger(round.roundNumber) || round.roundNumber < 1) errors.push(`${label}-roundNumber-invalid`);
    if (text(round.roundState).toUpperCase() !== 'SETTLED') errors.push(`${label}-must-be-settled`);
    if (!Array.isArray(round.questions) || round.questions.length !== 10) errors.push(`${label}-questions-must-contain-exactly-10`);
    if (seenRoundIds.has(text(round.roundId))) errors.push(`${label}-duplicate-roundId`);
    seenRoundIds.add(text(round.roundId));

    const normalizedQuestions = [];
    if (Array.isArray(round.questions)) {
      for (let questionIndex = 0; questionIndex < round.questions.length; questionIndex += 1) {
        const question = normalizeQuestion(round.questions[questionIndex], errors, `${label}-question-${questionIndex + 1}`, false);
        if (!question) continue;
        if (seenQuestionIds.has(question.questionId)) errors.push(`${label}-duplicate-questionId:${question.questionId}`);
        if (seenFingerprints.has(question.intentFingerprint)) errors.push(`${label}-duplicate-intentFingerprint:${question.intentFingerprint}`);
        seenQuestionIds.add(question.questionId);
        seenFingerprints.add(question.intentFingerprint);
        normalizedQuestions.push(question);
        allQuestions.push(Object.freeze({ roundId: text(round.roundId), roundNumber: round.roundNumber, ...question }));
      }
    }
    normalizedRounds.push(Object.freeze({ roundId: text(round.roundId), roundNumber: round.roundNumber, questions: Object.freeze(normalizedQuestions) }));
  }

  const sortedRoundNumbers = normalizedRounds.map((round) => round.roundNumber).sort((a, b) => a - b);
  for (let index = 0; index < sortedRoundNumbers.length; index += 1) {
    if (sortedRoundNumbers[index] !== index + 1) errors.push('priorRounds-must-form-contiguous-sequence-from-1');
  }
  if (errors.length > 0) return Object.freeze({ valid: false, ledger: null, errors: Object.freeze([...new Set(errors)]) });

  const priorRoundRefs = normalizedRounds
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => round.roundId);
  const fingerprintDigest = canonicalHash(allQuestions.map((question) => question.intentFingerprint).sort(compareCodePoints));
  const ledgerId = `novelty-ledger-${canonicalHash({ priorRoundRefs, fingerprintDigest }).slice(0, 24)}`;
  const ledger = Object.freeze({
    schemaVersion: STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA,
    ledgerId,
    priorRoundRefs: Object.freeze(priorRoundRefs),
    highestSettledRoundNumber: Math.max(...normalizedRounds.map((round) => round.roundNumber)),
    questions: Object.freeze(allQuestions),
    questionCount: allQuestions.length,
    fingerprintDigest,
  });
  return Object.freeze({ valid: true, ledger, errors: Object.freeze([]) });
}

export function evaluateStephanosQuestionNoveltyAuthorityV1(input = {}) {
  const safeInput = dataOnly(input);
  if (safeInput === INVALID || !record(safeInput)) return safeHold(['input-must-be-data-only']);
  const ledger = safeInput.ledger;
  const candidateRound = safeInput.candidateRound;
  const errors = [];
  if (!exactShape(ledger, LEDGER_KEYS, errors, 'ledger')) return safeHold(errors);
  if (ledger.schemaVersion !== STEPHANOS_QUESTION_NOVELTY_LEDGER_SCHEMA) errors.push('ledger-schema-version-mismatch');
  if (!safeId(ledger.ledgerId)) errors.push('ledgerId-invalid');
  if (!Array.isArray(ledger.priorRoundRefs) || ledger.priorRoundRefs.some((ref) => !safeId(ref))) errors.push('ledger-priorRoundRefs-invalid');
  if (!Number.isSafeInteger(ledger.highestSettledRoundNumber) || ledger.highestSettledRoundNumber < 1) errors.push('ledger-highestSettledRoundNumber-invalid');
  if (!Array.isArray(ledger.questions) || ledger.questions.length !== ledger.questionCount || ledger.questions.length < 10) errors.push('ledger-questionCount-invalid');
  if (!SAFE_FINGERPRINT.test(text(ledger.fingerprintDigest))) errors.push('ledger-fingerprintDigest-invalid');
  if (!exactShape(candidateRound, CANDIDATE_ROUND_KEYS, errors, 'candidateRound')) return safeHold(errors);
  if (!safeId(candidateRound.roundId)) errors.push('candidateRound-roundId-invalid');
  if (!Number.isSafeInteger(candidateRound.roundNumber) || candidateRound.roundNumber !== ledger.highestSettledRoundNumber + 1) errors.push('candidateRound-must-follow-highest-settled-round');
  if (!Array.isArray(candidateRound.questions) || candidateRound.questions.length !== 10) errors.push('candidateRound-questions-must-contain-exactly-10');
  if (errors.length > 0) return safeHold(errors, { ledgerId: text(ledger?.ledgerId), candidateRoundId: text(candidateRound?.roundId) });

  const priorQuestions = ledger.questions;
  const priorQuestionIds = new Set(priorQuestions.map((question) => text(question.questionId)));
  const priorFingerprints = new Set(priorQuestions.map((question) => text(question.intentFingerprint)));
  const candidateQuestions = [];
  for (let index = 0; index < candidateRound.questions.length; index += 1) {
    const question = normalizeQuestion(candidateRound.questions[index], errors, `candidate-question-${index + 1}`, true);
    if (question) candidateQuestions.push(question);
  }
  if (new Set(candidateQuestions.map((question) => question.questionId)).size !== 10) errors.push('candidate-questionIds-must-be-unique');
  if (new Set(candidateQuestions.map((question) => question.intentFingerprint)).size !== 10) errors.push('candidate-intentFingerprints-must-be-unique');
  const uniqueClasses = new Set(candidateQuestions.map((question) => question.questionClass)).size;
  if (uniqueClasses < THRESHOLDS.minimumCandidateClasses) errors.push(`candidate-questionClass-diversity-below-${THRESHOLDS.minimumCandidateClasses}`);

  const questionVerdicts = [];
  for (const question of candidateQuestions) {
    const unknownRefs = question.noveltyRefs.filter((ref) => !priorQuestionIds.has(ref));
    if (unknownRefs.length > 0) errors.push(`candidate-question:${question.questionId}:noveltyRef-not-in-ledger:${unknownRefs.join(',')}`);
    const exactFingerprintSeen = priorFingerprints.has(question.intentFingerprint);
    let closestPriorQuestionId = '';
    let closestSimilarity = 0;
    let closestSameClassEvidenceQuestionId = '';
    let closestSameClassEvidenceSimilarity = 0;
    for (const prior of priorQuestions) {
      const similarity = lexicalSimilarity(question.questionText, prior.questionText);
      if (similarity > closestSimilarity) {
        closestSimilarity = similarity;
        closestPriorQuestionId = prior.questionId;
      }
      if (question.questionClass === text(prior.questionClass).toUpperCase()
        && question.expectedEvidenceClass === text(prior.expectedEvidenceClass).toUpperCase()
        && similarity > closestSameClassEvidenceSimilarity) {
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
    setDiversity: Object.freeze({ uniqueClasses, candidatePairMaxSimilarity: Number(candidatePairMaxSimilarity.toFixed(6)), candidatePair }),
  });

  return Object.freeze({
    schemaVersion: STEPHANOS_QUESTION_NOVELTY_AUTHORITY_SCHEMA,
    valid: true,
    verdict: 'NOVELTY_PROVEN',
    mayAdmitNextRound: true,
    errors: Object.freeze([]),
    ledgerId: ledger.ledgerId,
    ledgerFingerprintDigest: ledger.fingerprintDigest,
    candidateRoundId: candidateRound.roundId,
    candidateRoundNumber: candidateRound.roundNumber,
    priorRoundRefs: Object.freeze([...ledger.priorRoundRefs]),
    priorQuestionCount: ledger.questionCount,
    questionVerdicts: Object.freeze(questionVerdicts),
    setDiversity: Object.freeze({ uniqueClasses, candidatePairMaxSimilarity: Number(candidatePairMaxSimilarity.toFixed(6)), candidatePair }),
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
