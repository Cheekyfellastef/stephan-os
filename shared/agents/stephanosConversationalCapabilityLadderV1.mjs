import { createHash } from 'node:crypto';

export const STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION = 'stephanos.conversational-capability-ladder.v1';
export const STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION = 'stephanos.conversational-capability-round.v1';
export const STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION = 'stephanos.conversational-capability-question.v1';
export const STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION = 'stephanos.conversational-capability-answer.v1';
export const STEPHANOS_CAPABILITY_GAP_SCHEMA_VERSION = 'stephanos.conversational-capability-gap.v1';
export const STEPHANOS_BOUNDARY_ADJUDICATION_SCHEMA_VERSION = 'stephanos.boundary-evidence-adjudication.v1';

export const STEPHANOS_INITIAL_QUESTION_CLASSES = Object.freeze([
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

export const STEPHANOS_ANSWER_EPISTEMIC_STATES = Object.freeze([
  'KNOWN_FROM_CANONICAL_STATE',
  'OBSERVED_FROM_RUNTIME_OR_PROOF',
  'INFERRED_FROM_EVIDENCE',
  'PROPOSED',
  'STALE',
  'CONFLICTING',
  'UNKNOWN',
  'UNSUPPORTED_BY_THIS_PARTICIPANT',
]);

export const STEPHANOS_ANSWER_VERDICTS = Object.freeze([
  'ANSWERED_GROUNDED',
  'ANSWERED_PARTIAL',
  'GAP_KNOWLEDGE',
  'GAP_CONTEXT',
  'GAP_MEMORY',
  'GAP_RETRIEVAL',
  'GAP_TOOL_OR_DATA_ACCESS',
  'GAP_CONVERSATION_FABRIC',
  'GAP_REASONING_OR_SYNTHESIS',
  'GAP_FRESHNESS',
  'INTENTIONALLY_UNSUPPORTED',
  'EXTERNAL_UNBUILDABLE',
  'UNSAFE_OR_AUTHORITY_BOUNDARY',
]);

export const STEPHANOS_BUILDABLE_GAP_VERDICTS = Object.freeze([
  'GAP_KNOWLEDGE',
  'GAP_CONTEXT',
  'GAP_MEMORY',
  'GAP_RETRIEVAL',
  'GAP_TOOL_OR_DATA_ACCESS',
  'GAP_CONVERSATION_FABRIC',
  'GAP_REASONING_OR_SYNTHESIS',
  'GAP_FRESHNESS',
]);

export const STEPHANOS_CAPABILITY_ROUND_STATES = Object.freeze([
  'PREPARING',
  'QUESTIONING',
  'EVALUATING',
  'GAPS_IDENTIFIED',
  'REPAIRS_QUEUED',
  'REPAIRS_IN_PROGRESS',
  'REGRESSION_PROVING',
  'SETTLED',
  'SAFE_HOLD',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_FINGERPRINT = /^[a-z0-9][a-z0-9._:-]{7,191}$/i;
const FRESHNESS_STATES = new Set(['FRESH', 'RECENT', 'STALE', 'UNKNOWN', 'CONFLICTING']);
const GROUNDED_EPISTEMIC_STATES = new Set([
  'KNOWN_FROM_CANONICAL_STATE',
  'OBSERVED_FROM_RUNTIME_OR_PROOF',
  'INFERRED_FROM_EVIDENCE',
]);
const BOUNDARY_VERDICTS = new Set([
  'INTENTIONALLY_UNSUPPORTED',
  'EXTERNAL_UNBUILDABLE',
  'UNSAFE_OR_AUTHORITY_BOUNDARY',
]);
const BUILDABLE_GAPS = new Set(STEPHANOS_BUILDABLE_GAP_VERDICTS);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INVALID = Symbol('invalid-data-only-capability-record');
const LIMITS = Object.freeze({ array: 256, keys: 64, depth: 12, nodes: 4096, string: 24_000 });

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
const ANSWER_KEYS = Object.freeze([
  'schemaVersion',
  'answerId',
  'questionId',
  'roundId',
  'responderParticipantId',
  'answerText',
  'epistemicState',
  'evidenceRefs',
  'freshness',
  'sourcesConsulted',
  'cannotAnswerReason',
  'answerVerdict',
  'gapRefs',
  'answeredAtUtc',
]);

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
        if (!lengthDescriptor
          || lengthDescriptor.get
          || lengthDescriptor.set
          || !Number.isSafeInteger(length)
          || length < 0
          || length > LIMITS.array) return INVALID;
        const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
        if (keys.some((key) => !expected.has(key))) return INVALID;
        const output = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor
            || !descriptor.enumerable
            || !Object.hasOwn(descriptor, 'value')
            || descriptor.get
            || descriptor.set) return INVALID;
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
        if (!descriptor.enumerable
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.get
          || descriptor.set) return INVALID;
        const normalized = dataOnly(descriptor.value, traversal, depth + 1);
        if (normalized === INVALID) return INVALID;
        Object.defineProperty(output, key, {
          value: normalized,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      return Object.freeze(output);
    } finally {
      traversal.seen.delete(value);
    }
  } catch {
    return INVALID;
  }
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedIntentText(value) {
  return text(value).replace(/\s+/g, ' ').toLowerCase();
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function timestamp(value) {
  const candidate = text(value);
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function exactShape(value, keys, errors, prefix = '') {
  if (!record(value)) {
    errors.push(`${prefix}record-must-be-data-only-object`);
    return false;
  }
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  for (const key of actual) if (!expected.includes(key)) errors.push(`${prefix}unknown-field:${key}`);
  for (const key of expected) if (!actual.includes(key)) errors.push(`${prefix}missing-field:${key}`);
  return errors.length === 0;
}

function stringList(value, field, errors, minimum = 0) {
  if (!Array.isArray(value)) {
    errors.push(`${field}-must-be-dense-array`);
    return [];
  }
  const entries = [];
  for (const item of value) {
    const normalized = text(item);
    if (!normalized) errors.push(`${field}-contains-empty-value`);
    entries.push(normalized);
  }
  if (new Set(entries).size !== entries.length) errors.push(`${field}-contains-duplicate`);
  if (entries.length < minimum) errors.push(`${field}-requires-${minimum}`);
  return entries;
}

function boundedText(value, field, errors, maximum = 16_384) {
  const normalized = text(value);
  if (!normalized) errors.push(`${field}-required`);
  if (normalized.length > maximum) errors.push(`${field}-too-long`);
  return normalized;
}

function result(errors) {
  const unique = [...new Set(errors)];
  return Object.freeze({
    valid: unique.length === 0,
    errors: Object.freeze(unique),
    refusalReason: unique[0] || '',
  });
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedVerdict(value) {
  return text(value).toUpperCase();
}

function normalizedEpistemicState(value) {
  return text(value).toUpperCase();
}

function observeRecord(input, label) {
  const snapshot = dataOnly(input);
  if (snapshot === INVALID || !record(snapshot)) {
    return Object.freeze({ snapshot: null, verdict: result([`${label}-must-be-data-only`]) });
  }
  return Object.freeze({ snapshot, verdict: null });
}

export function canonicalStephanosQuestionIntentFingerprint(question = {}) {
  const observed = observeRecord(question, 'question');
  if (observed.verdict) return '';
  const questionClass = text(observed.snapshot.questionClass).toUpperCase();
  const questionText = normalizedIntentText(observed.snapshot.questionText);
  const expectedEvidenceClass = text(observed.snapshot.expectedEvidenceClass).toUpperCase();
  if (!questionClass || !questionText || !expectedEvidenceClass) return '';
  return `intent-${canonicalHash({ questionClass, questionText, expectedEvidenceClass }).slice(0, 40)}`;
}

function existingGoalCandidatesForGap(verdict) {
  return Object.freeze(({
    GAP_KNOWLEDGE: ['#1308', '#1556'],
    GAP_CONTEXT: ['#1308', '#1645', '#1556'],
    GAP_MEMORY: ['#1645', '#1308'],
    GAP_RETRIEVAL: ['#1308', '#1645'],
    GAP_TOOL_OR_DATA_ACCESS: ['#1556', '#1308'],
    GAP_CONVERSATION_FABRIC: ['#1290', '#1506', '#1308'],
    GAP_REASONING_OR_SYNTHESIS: ['#1308', '#1556'],
    GAP_FRESHNESS: ['#1556', '#1308'],
  })[verdict] || ['#1308']);
}

function validateQuestionSnapshot(question, options = {}) {
  const errors = [];
  if (!exactShape(question, QUESTION_KEYS, errors)) return result(errors);
  if (question.schemaVersion !== STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['roundId', 'questionId', 'askerParticipantId', 'targetParticipantId']) {
    if (!safeId(question[field])) errors.push(`${field}-invalid`);
  }
  boundedText(question.questionText, 'questionText', errors, 4096);
  if (!safeId(question.questionClass)) errors.push('questionClass-invalid');
  if (!SAFE_FINGERPRINT.test(text(question.intentFingerprint))) errors.push('intentFingerprint-invalid');
  stringList(question.noveltyRefs, 'noveltyRefs', errors, options.requireNoveltyRef ? 1 : 0);
  stringList(question.contextRefs, 'contextRefs', errors);
  if (!safeId(question.expectedEvidenceClass)) errors.push('expectedEvidenceClass-invalid');
  if (!timestamp(question.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return result(errors);
}

export function validateStephanosCapabilityQuestion(question, options = {}) {
  const observed = observeRecord(question, 'question');
  return observed.verdict || validateQuestionSnapshot(observed.snapshot, options);
}

function validateRoundSnapshot(round) {
  const errors = [];
  if (!exactShape(round, ROUND_KEYS, errors)) return result(errors);
  if (round.schemaVersion !== STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['roundId', 'askerParticipantId', 'targetParticipantId']) {
    if (!safeId(round[field])) errors.push(`${field}-invalid`);
  }
  if (!Number.isSafeInteger(round.roundNumber) || round.roundNumber < 1) errors.push('roundNumber-invalid');
  if (!timestamp(round.createdAtUtc)) errors.push('createdAtUtc-invalid');
  if (!Array.isArray(round.questions) || round.questions.length !== 10) {
    errors.push('questions-must-contain-exactly-10-dense-records');
    return result(errors);
  }

  const questionIds = [];
  const fingerprints = [];
  const classes = [];
  for (let index = 0; index < round.questions.length; index += 1) {
    const question = round.questions[index];
    const validation = validateQuestionSnapshot(question, { requireNoveltyRef: round.roundNumber > 1 });
    for (const error of validation.errors) errors.push(`question-${index + 1}:${error}`);
    if (question?.roundId !== round.roundId) errors.push(`question-${index + 1}:roundId-mismatch`);
    if (question?.askerParticipantId !== round.askerParticipantId) errors.push(`question-${index + 1}:askerParticipantId-mismatch`);
    if (question?.targetParticipantId !== round.targetParticipantId) errors.push(`question-${index + 1}:targetParticipantId-mismatch`);
    questionIds.push(text(question?.questionId));
    fingerprints.push(text(question?.intentFingerprint));
    classes.push(text(question?.questionClass).toUpperCase());
  }
  if (new Set(questionIds).size !== 10) errors.push('questionIds-must-be-unique');
  if (new Set(fingerprints).size !== 10) errors.push('intentFingerprints-must-be-unique');
  if (new Set(classes).size < 8) errors.push('questionClass-diversity-below-8');
  if (round.roundNumber === 1 && text(round.targetParticipantId).toLowerCase() === 'stephanos') {
    const missing = STEPHANOS_INITIAL_QUESTION_CLASSES.filter((questionClass) => !classes.includes(questionClass));
    if (missing.length > 0) errors.push(`initial-round-missing-classes:${missing.join(',')}`);
  }
  if (round.roundNumber > 1) errors.push('canonical-novelty-authority-unresolved');
  return result(errors);
}

export function validateStephanosCapabilityRound(round, _options = {}) {
  const observed = observeRecord(round, 'round');
  return observed.verdict || validateRoundSnapshot(observed.snapshot);
}

function validateAnswerSnapshot(answer) {
  const errors = [];
  if (!exactShape(answer, ANSWER_KEYS, errors)) return result(errors);
  if (answer.schemaVersion !== STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['answerId', 'questionId', 'roundId', 'responderParticipantId']) {
    if (!safeId(answer[field])) errors.push(`${field}-invalid`);
  }
  boundedText(answer.answerText, 'answerText', errors, 24_000);
  const epistemicState = normalizedEpistemicState(answer.epistemicState);
  if (!STEPHANOS_ANSWER_EPISTEMIC_STATES.includes(epistemicState)) errors.push('epistemicState-invalid');
  const evidenceRefs = stringList(answer.evidenceRefs, 'evidenceRefs', errors);
  const freshness = text(answer.freshness).toUpperCase();
  if (!FRESHNESS_STATES.has(freshness)) errors.push('freshness-invalid');
  const sourcesConsulted = stringList(answer.sourcesConsulted, 'sourcesConsulted', errors);
  const cannotAnswerReason = answer.cannotAnswerReason === null ? '' : text(answer.cannotAnswerReason);
  const verdict = normalizedVerdict(answer.answerVerdict);
  if (!STEPHANOS_ANSWER_VERDICTS.includes(verdict)) errors.push('answerVerdict-invalid');
  stringList(answer.gapRefs, 'gapRefs', errors);
  if (!timestamp(answer.answeredAtUtc)) errors.push('answeredAtUtc-invalid');

  if (verdict === 'ANSWERED_GROUNDED') {
    if (!GROUNDED_EPISTEMIC_STATES.has(epistemicState)) errors.push('grounded-answer-epistemic-state-insufficient');
    if (!['FRESH', 'RECENT'].includes(freshness)) errors.push('grounded-answer-freshness-insufficient');
    if (evidenceRefs.length === 0) errors.push('grounded-answer-requires-evidence');
    if (sourcesConsulted.length === 0) errors.push('grounded-answer-requires-sources');
    if (cannotAnswerReason) errors.push('grounded-answer-cannot-have-cannotAnswerReason');
  }
  if (BOUNDARY_VERDICTS.has(verdict)) {
    if (!GROUNDED_EPISTEMIC_STATES.has(epistemicState)) errors.push('boundary-answer-epistemic-state-insufficient');
    if (!['FRESH', 'RECENT'].includes(freshness)) errors.push('boundary-answer-freshness-insufficient');
    if (evidenceRefs.length === 0) errors.push('boundary-answer-requires-evidence');
    if (sourcesConsulted.length === 0) errors.push('boundary-answer-requires-sources');
  }
  if ((BUILDABLE_GAPS.has(verdict) || BOUNDARY_VERDICTS.has(verdict)) && !cannotAnswerReason) {
    errors.push('non-grounded-terminal-answer-requires-reason');
  }
  return result(errors);
}

export function validateStephanosCapabilityAnswer(answer) {
  const observed = observeRecord(answer, 'answer');
  return observed.verdict || validateAnswerSnapshot(observed.snapshot);
}

export function createStephanosCapabilityGapObservation(question, answer) {
  const observedQuestion = observeRecord(question, 'question');
  const observedAnswer = observeRecord(answer, 'answer');
  const questionValidation = observedQuestion.verdict || validateQuestionSnapshot(observedQuestion.snapshot);
  const answerValidation = observedAnswer.verdict || validateAnswerSnapshot(observedAnswer.snapshot);
  if (!questionValidation.valid || !answerValidation.valid) {
    return Object.freeze({
      valid: false,
      gap: null,
      errors: Object.freeze([
        ...questionValidation.errors.map((error) => `question:${error}`),
        ...answerValidation.errors.map((error) => `answer:${error}`),
      ]),
    });
  }
  const safeQuestion = observedQuestion.snapshot;
  const safeAnswer = observedAnswer.snapshot;
  const verdict = normalizedVerdict(safeAnswer.answerVerdict);
  if (!BUILDABLE_GAPS.has(verdict)) {
    return Object.freeze({ valid: false, gap: null, errors: Object.freeze(['answer-is-not-buildable-gap']) });
  }
  if (safeQuestion.questionId !== safeAnswer.questionId || safeQuestion.roundId !== safeAnswer.roundId) {
    return Object.freeze({ valid: false, gap: null, errors: Object.freeze(['question-answer-lineage-mismatch']) });
  }
  if (safeQuestion.targetParticipantId !== safeAnswer.responderParticipantId) {
    return Object.freeze({ valid: false, gap: null, errors: Object.freeze(['question-answer-participant-mismatch']) });
  }
  const participantId = safeAnswer.responderParticipantId;
  const existingGoalCandidates = existingGoalCandidatesForGap(verdict);
  const gapSignature = canonicalHash({
    participantId,
    gapClass: verdict,
    intentFingerprint: safeQuestion.intentFingerprint,
    expectedEvidenceClass: safeQuestion.expectedEvidenceClass,
  });
  const gap = Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_GAP_SCHEMA_VERSION,
    gapId: `qgap-${gapSignature.slice(0, 24)}`,
    gapSignature,
    questionId: safeQuestion.questionId,
    roundId: safeQuestion.roundId,
    participantId,
    gapClass: verdict,
    summary: safeAnswer.cannotAnswerReason,
    rootCauseCandidate: verdict.replace(/^GAP_/, ''),
    evidenceRefs: Object.freeze([...safeAnswer.evidenceRefs]),
    existingGoalCandidates,
    repairGoalRef: null,
    status: 'OBSERVED_NEEDS_DEDUPLICATION',
  });
  return Object.freeze({ valid: true, gap, errors: Object.freeze([]) });
}

function classifyAnswer(answer) {
  const verdict = normalizedVerdict(answer.answerVerdict);
  if (verdict === 'ANSWERED_GROUNDED') return 'GROUNDED_PASS';
  if (verdict === 'ANSWERED_PARTIAL') return 'PARTIAL';
  if (BUILDABLE_GAPS.has(verdict)) return 'BUILDABLE_GAP';
  if (BOUNDARY_VERDICTS.has(verdict)) return 'UNADJUDICATED_BOUNDARY';
  return 'INVALID';
}

function safeHold(roundId, errors, options = {}) {
  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION,
    valid: options.valid === true,
    roundId: text(roundId),
    state: 'SAFE_HOLD',
    errors: Object.freeze([...new Set(errors)]),
    counts: Object.freeze(options.counts || { total: 0, grounded: 0, partial: 0, buildableGaps: 0, retainedBoundaries: 0 }),
    gapObservations: Object.freeze(options.gapObservations || []),
    boundaryAdjudicationBlockers: Object.freeze(options.boundaryAdjudicationBlockers || []),
    mayAdvanceToNovelRound: false,
    requiresRepairReplay: options.requiresRepairReplay === true,
    requiresBoundaryAdjudication: options.requiresBoundaryAdjudication === true,
  });
}

export function evaluateStephanosCapabilityRound(input = {}) {
  const safeInput = dataOnly(input);
  if (safeInput === INVALID || !record(safeInput)) {
    return safeHold('', ['input-must-be-data-only']);
  }
  const round = safeInput.round;
  const answers = safeInput.answers;
  const roundValidation = validateRoundSnapshot(round);
  const errors = [...roundValidation.errors.map((error) => `round:${error}`)];
  if (!Array.isArray(answers)) errors.push('answers-must-be-dense-array');
  if (errors.length > 0) return safeHold(round?.roundId, errors);
  if (answers.length !== 10) errors.push('answers-must-contain-exactly-10-records');

  const questionById = new Map(round.questions.map((question) => [question.questionId, question]));
  const seenQuestionAnswers = new Set();
  const seenAnswerIds = new Set();
  const classifications = [];
  const gapObservations = [];
  const boundaryAdjudicationBlockers = [];

  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    const validation = validateAnswerSnapshot(answer);
    for (const error of validation.errors) errors.push(`answer-${index + 1}:${error}`);
    if (answer?.roundId !== round.roundId) errors.push(`answer-${index + 1}:roundId-mismatch`);
    if (answer?.responderParticipantId !== round.targetParticipantId) errors.push(`answer-${index + 1}:responderParticipantId-mismatch`);
    if (!questionById.has(answer?.questionId)) errors.push(`answer-${index + 1}:unknown-questionId`);
    if (seenQuestionAnswers.has(answer?.questionId)) errors.push(`answer-${index + 1}:duplicate-questionId`);
    if (seenAnswerIds.has(answer?.answerId)) errors.push(`answer-${index + 1}:duplicate-answerId`);
    seenQuestionAnswers.add(answer?.questionId);
    seenAnswerIds.add(answer?.answerId);

    if (validation.valid && questionById.has(answer.questionId)) {
      const classification = classifyAnswer(answer);
      classifications.push(classification);
      if (classification === 'BUILDABLE_GAP') {
        const gap = createStephanosCapabilityGapObservation(questionById.get(answer.questionId), answer);
        if (gap.valid) gapObservations.push(gap.gap);
        else errors.push(...gap.errors.map((error) => `gap:${error}`));
      }
      if (classification === 'UNADJUDICATED_BOUNDARY') {
        boundaryAdjudicationBlockers.push(Object.freeze({
          answerId: answer.answerId,
          answerVerdict: normalizedVerdict(answer.answerVerdict),
          errors: Object.freeze(['canonical-boundary-proof-authority-unresolved']),
        }));
      }
    }
  }
  for (const questionId of questionById.keys()) {
    if (!seenQuestionAnswers.has(questionId)) errors.push(`missing-answer:${questionId}`);
  }

  if (errors.length > 0) return safeHold(round.roundId, errors, {
    counts: { total: answers.length, grounded: 0, partial: 0, buildableGaps: 0, retainedBoundaries: 0 },
    boundaryAdjudicationBlockers,
    requiresBoundaryAdjudication: boundaryAdjudicationBlockers.length > 0,
  });

  const counts = Object.freeze({
    total: 10,
    grounded: classifications.filter((value) => value === 'GROUNDED_PASS').length,
    partial: classifications.filter((value) => value === 'PARTIAL').length,
    buildableGaps: classifications.filter((value) => value === 'BUILDABLE_GAP').length,
    retainedBoundaries: 0,
  });
  const hasRepairWork = counts.buildableGaps > 0 || counts.partial > 0;
  const requiresBoundaryAdjudication = boundaryAdjudicationBlockers.length > 0;
  if (requiresBoundaryAdjudication) return safeHold(round.roundId, [], {
    valid: true,
    counts,
    gapObservations,
    boundaryAdjudicationBlockers,
    requiresRepairReplay: hasRepairWork,
    requiresBoundaryAdjudication: true,
  });

  const state = counts.buildableGaps > 0
    ? 'GAPS_IDENTIFIED'
    : hasRepairWork
      ? 'REGRESSION_PROVING'
      : 'SETTLED';
  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION,
    valid: true,
    roundId: round.roundId,
    state,
    errors: Object.freeze([]),
    counts,
    gapObservations: Object.freeze(gapObservations),
    boundaryAdjudicationBlockers: Object.freeze([]),
    mayAdvanceToNovelRound: !hasRepairWork,
    requiresRepairReplay: hasRepairWork,
    requiresBoundaryAdjudication: false,
  });
}
