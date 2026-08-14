import { createHash } from 'node:crypto';

export const STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION = 'stephanos.conversational-capability-ladder.v1';
export const STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION = 'stephanos.conversational-capability-round.v1';
export const STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION = 'stephanos.conversational-capability-question.v1';
export const STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION = 'stephanos.conversational-capability-answer.v1';
export const STEPHANOS_CAPABILITY_GAP_SCHEMA_VERSION = 'stephanos.conversational-capability-gap.v1';

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
const SETTLED_BOUNDARY_VERDICTS = new Set([
  'INTENTIONALLY_UNSUPPORTED',
  'EXTERNAL_UNBUILDABLE',
  'UNSAFE_OR_AUTHORITY_BOUNDARY',
]);
const BUILDABLE_GAPS = new Set(STEPHANOS_BUILDABLE_GAP_VERDICTS);

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

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function plainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function exactRecordShape(record, keys, errors, prefix = '') {
  if (!plainRecord(record)) {
    errors.push(`${prefix}record-must-be-plain-object`);
    return false;
  }
  const actual = Reflect.ownKeys(record);
  if (actual.some((key) => typeof key !== 'string')) {
    errors.push(`${prefix}symbol-keys-forbidden`);
    return false;
  }
  const expected = new Set(keys);
  for (const key of actual) {
    if (!expected.has(key)) errors.push(`${prefix}unknown-field:${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) errors.push(`${prefix}missing-field:${key}`);
  }
  return errors.length === 0;
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function timestamp(value) {
  const candidate = text(value);
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function stringList(value, field, errors, minimum = 0) {
  if (!denseArray(value)) {
    errors.push(`${field}-must-be-dense-array`);
    return [];
  }
  const normalized = value.map(text);
  if (normalized.some((entry) => !entry)) errors.push(`${field}-contains-empty-value`);
  if (new Set(normalized).size !== normalized.length) errors.push(`${field}-contains-duplicate`);
  if (normalized.length < minimum) errors.push(`${field}-requires-${minimum}`);
  return normalized;
}

function priorRoundFingerprints(value, errors) {
  const normalized = stringList(value, 'priorRoundIntentFingerprints', errors, 10);
  if (normalized.length !== 10) errors.push('priorRoundIntentFingerprints-must-contain-exactly-10');
  if (normalized.some((entry) => !SAFE_FINGERPRINT.test(entry))) errors.push('priorRoundIntentFingerprints-contains-invalid-fingerprint');
  return normalized;
}

function noveltyFingerprint(value) {
  const prefix = 'previous-round:';
  const normalized = text(value);
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : '';
}

function boundedText(value, field, errors, maximum = 16_384) {
  const normalized = text(value);
  if (!normalized) errors.push(`${field}-required`);
  if (normalized.length > maximum) errors.push(`${field}-too-long`);
  return normalized;
}

function result(errors) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    refusalReason: errors[0] || '',
  });
}

function normalizedVerdict(value) {
  return text(value).toUpperCase();
}

function normalizedEpistemicState(value) {
  return text(value).toUpperCase();
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

export function validateStephanosCapabilityQuestion(question, options = {}) {
  const errors = [];
  if (!exactRecordShape(question, QUESTION_KEYS, errors)) return result(errors);
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

export function validateStephanosCapabilityRound(round, options = {}) {
  const errors = [];
  if (!exactRecordShape(round, ROUND_KEYS, errors)) return result(errors);
  if (round.schemaVersion !== STEPHANOS_CAPABILITY_ROUND_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['roundId', 'askerParticipantId', 'targetParticipantId']) {
    if (!safeId(round[field])) errors.push(`${field}-invalid`);
  }
  if (!Number.isSafeInteger(round.roundNumber) || round.roundNumber < 1) errors.push('roundNumber-invalid');
  if (!timestamp(round.createdAtUtc)) errors.push('createdAtUtc-invalid');
  if (!denseArray(round.questions) || round.questions.length !== 10) {
    errors.push('questions-must-contain-exactly-10-dense-records');
    return result(errors);
  }
  const priorFingerprints = round.roundNumber > 1
    ? priorRoundFingerprints(options.priorRoundIntentFingerprints, errors)
    : [];
  const priorFingerprintSet = new Set(priorFingerprints);
  const questionIds = [];
  const fingerprints = [];
  const classes = [];
  for (let index = 0; index < round.questions.length; index += 1) {
    const question = round.questions[index];
    const validation = validateStephanosCapabilityQuestion(question, {
      requireNoveltyRef: round.roundNumber > 1,
    });
    for (const error of validation.errors) errors.push(`question-${index + 1}:${error}`);
    if (question?.roundId !== round.roundId) errors.push(`question-${index + 1}:roundId-mismatch`);
    if (question?.askerParticipantId !== round.askerParticipantId) errors.push(`question-${index + 1}:askerParticipantId-mismatch`);
    if (question?.targetParticipantId !== round.targetParticipantId) errors.push(`question-${index + 1}:targetParticipantId-mismatch`);
    const fingerprint = text(question?.intentFingerprint);
    if (round.roundNumber > 1) {
      if (priorFingerprintSet.has(fingerprint)) errors.push(`question-${index + 1}:intentFingerprint-replays-prior-round`);
      const noveltyRefs = denseArray(question?.noveltyRefs) ? question.noveltyRefs.map(noveltyFingerprint) : [];
      if (noveltyRefs.some((reference) => !reference || !priorFingerprintSet.has(reference))) {
        errors.push(`question-${index + 1}:noveltyRefs-must-bind-prior-round-fingerprints`);
      }
    }
    questionIds.push(text(question?.questionId));
    fingerprints.push(fingerprint);
    classes.push(text(question?.questionClass).toUpperCase());
  }
  if (new Set(questionIds).size !== 10) errors.push('questionIds-must-be-unique');
  if (new Set(fingerprints).size !== 10) errors.push('intentFingerprints-must-be-unique');
  if (new Set(classes).size < 8) errors.push('questionClass-diversity-below-8');
  if (round.roundNumber === 1 && text(round.targetParticipantId).toLowerCase() === 'stephanos') {
    const missing = STEPHANOS_INITIAL_QUESTION_CLASSES.filter((questionClass) => !classes.includes(questionClass));
    if (missing.length > 0) errors.push(`initial-round-missing-classes:${missing.join(',')}`);
  }
  return result(errors);
}

export function validateStephanosCapabilityAnswer(answer) {
  const errors = [];
  if (!exactRecordShape(answer, ANSWER_KEYS, errors)) return result(errors);
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
  if (SETTLED_BOUNDARY_VERDICTS.has(verdict)) {
    if (!GROUNDED_EPISTEMIC_STATES.has(epistemicState)) errors.push('boundary-answer-epistemic-state-insufficient');
    if (!['FRESH', 'RECENT'].includes(freshness)) errors.push('boundary-answer-freshness-insufficient');
    if (evidenceRefs.length === 0) errors.push('boundary-answer-requires-evidence');
    if (sourcesConsulted.length === 0) errors.push('boundary-answer-requires-sources');
  }
  if (BUILDABLE_GAPS.has(verdict) || SETTLED_BOUNDARY_VERDICTS.has(verdict)) {
    if (!cannotAnswerReason) errors.push('non-grounded-terminal-answer-requires-reason');
  }
  return result(errors);
}

export function createStephanosCapabilityGapObservation(question, answer) {
  const questionValidation = validateStephanosCapabilityQuestion(question);
  const answerValidation = validateStephanosCapabilityAnswer(answer);
  if (!questionValidation.valid || !answerValidation.valid) {
    return Object.freeze({
      valid:false,
      gap:null,
      errors:Object.freeze([
        ...questionValidation.errors.map((error) => `question:${error}`),
        ...answerValidation.errors.map((error) => `answer:${error}`),
      ]),
    });
  }
  const verdict = normalizedVerdict(answer.answerVerdict);
  if (!BUILDABLE_GAPS.has(verdict)) {
    return Object.freeze({ valid:false, gap:null, errors:Object.freeze(['answer-is-not-buildable-gap']) });
  }
  if (question.questionId !== answer.questionId || question.roundId !== answer.roundId) {
    return Object.freeze({ valid:false, gap:null, errors:Object.freeze(['question-answer-lineage-mismatch']) });
  }
  if (question.targetParticipantId !== answer.responderParticipantId) {
    return Object.freeze({ valid:false, gap:null, errors:Object.freeze(['question-answer-participant-mismatch']) });
  }
  const participantId = answer.responderParticipantId;
  const existingGoalCandidates = existingGoalCandidatesForGap(verdict);
  const gapSignature = canonicalHash({
    participantId,
    gapClass:verdict,
    intentFingerprint:question.intentFingerprint,
    expectedEvidenceClass:question.expectedEvidenceClass,
  });
  const gap = Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_GAP_SCHEMA_VERSION,
    gapId: `qgap-${gapSignature.slice(0, 24)}`,
    gapSignature,
    questionId: question.questionId,
    roundId: question.roundId,
    participantId,
    gapClass: verdict,
    summary: answer.cannotAnswerReason,
    rootCauseCandidate: verdict.replace(/^GAP_/, ''),
    evidenceRefs: Object.freeze([...answer.evidenceRefs]),
    existingGoalCandidates,
    repairGoalRef: null,
    status: 'OBSERVED_NEEDS_DEDUPLICATION',
  });
  return Object.freeze({ valid:true, gap, errors:Object.freeze([]) });
}

function classifyAnswerForEvaluation(answer) {
  const verdict = normalizedVerdict(answer.answerVerdict);
  if (verdict === 'ANSWERED_GROUNDED') return 'GROUNDED_PASS';
  if (verdict === 'ANSWERED_PARTIAL') return 'PARTIAL';
  if (BUILDABLE_GAPS.has(verdict)) return 'BUILDABLE_GAP';
  if (SETTLED_BOUNDARY_VERDICTS.has(verdict)) return 'RETAINED_BOUNDARY';
  return 'INVALID';
}

export function evaluateStephanosCapabilityRound(input = {}) {
  const round = input.round;
  const answers = input.answers;
  const roundValidation = validateStephanosCapabilityRound(round, {
    priorRoundIntentFingerprints: input.priorRoundIntentFingerprints,
  });
  const errors = [...roundValidation.errors.map((error) => `round:${error}`)];
  if (!denseArray(answers)) errors.push('answers-must-be-dense-array');
  if (errors.length > 0) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION,
      valid:false,
      roundId:text(round?.roundId),
      state:'SAFE_HOLD',
      errors:Object.freeze(errors),
      counts:Object.freeze({ total:0, grounded:0, partial:0, buildableGaps:0, retainedBoundaries:0 }),
      gapObservations:Object.freeze([]),
      mayAdvanceToNovelRound:false,
      requiresRepairReplay:false,
    });
  }

  if (answers.length !== 10) errors.push('answers-must-contain-exactly-10-records');
  const questionById = new Map(round.questions.map((question) => [question.questionId, question]));
  const seenAnswers = new Set();
  const classifications = [];
  const gapObservations = [];

  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    const validation = validateStephanosCapabilityAnswer(answer);
    for (const error of validation.errors) errors.push(`answer-${index + 1}:${error}`);
    if (answer?.roundId !== round.roundId) errors.push(`answer-${index + 1}:roundId-mismatch`);
    if (answer?.responderParticipantId !== round.targetParticipantId) errors.push(`answer-${index + 1}:responderParticipantId-mismatch`);
    if (!questionById.has(answer?.questionId)) errors.push(`answer-${index + 1}:unknown-questionId`);
    if (seenAnswers.has(answer?.questionId)) errors.push(`answer-${index + 1}:duplicate-questionId`);
    seenAnswers.add(answer?.questionId);
    if (validation.valid && questionById.has(answer.questionId)) {
      const classification = classifyAnswerForEvaluation(answer);
      classifications.push(classification);
      if (classification === 'BUILDABLE_GAP') {
        const gap = createStephanosCapabilityGapObservation(questionById.get(answer.questionId), answer);
        if (gap.valid) gapObservations.push(gap.gap);
        else errors.push(...gap.errors.map((error) => `gap:${error}`));
      }
    }
  }
  for (const questionId of questionById.keys()) {
    if (!seenAnswers.has(questionId)) errors.push(`missing-answer:${questionId}`);
  }

  if (errors.length > 0) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION,
      valid:false,
      roundId:round.roundId,
      state:'SAFE_HOLD',
      errors:Object.freeze(errors),
      counts:Object.freeze({ total:answers.length, grounded:0, partial:0, buildableGaps:0, retainedBoundaries:0 }),
      gapObservations:Object.freeze([]),
      mayAdvanceToNovelRound:false,
      requiresRepairReplay:false,
    });
  }

  const counts = Object.freeze({
    total:10,
    grounded:classifications.filter((value) => value === 'GROUNDED_PASS').length,
    partial:classifications.filter((value) => value === 'PARTIAL').length,
    buildableGaps:classifications.filter((value) => value === 'BUILDABLE_GAP').length,
    retainedBoundaries:classifications.filter((value) => value === 'RETAINED_BOUNDARY').length,
  });
  const hasRepairWork = counts.buildableGaps > 0 || counts.partial > 0;
  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION,
    valid:true,
    roundId:round.roundId,
    state:counts.buildableGaps > 0 ? 'GAPS_IDENTIFIED' : hasRepairWork ? 'REGRESSION_PROVING' : 'SETTLED',
    errors:Object.freeze([]),
    counts,
    gapObservations:Object.freeze(gapObservations),
    mayAdvanceToNovelRound:!hasRepairWork,
    requiresRepairReplay:hasRepairWork,
  });
}
