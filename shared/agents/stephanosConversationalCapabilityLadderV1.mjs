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
const SETTLED_BOUNDARY_VERDICTS = new Set([
  'INTENTIONALLY_UNSUPPORTED',
  'EXTERNAL_UNBUILDABLE',
  'UNSAFE_OR_AUTHORITY_BOUNDARY',
]);
const BUILDABLE_GAPS = new Set(STEPHANOS_BUILDABLE_GAP_VERDICTS);
const DEFAULT_BOUNDARY_ADJUDICATION_STALE_AFTER_MS = 60 * 60 * 1000;

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
const BOUNDARY_ADJUDICATION_KEYS = Object.freeze([
  'schemaVersion',
  'answerId',
  'answerVerdict',
  'status',
  'freshness',
  'evidenceRefs',
  'sourcesConsulted',
  'proofRefs',
  'adjudicatedAtUtc',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedIntentText(value) {
  return text(value).replace(/\s+/g, ' ').toLowerCase();
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

function sameStringSet(left = [], right = []) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
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

export function canonicalStephanosQuestionIntentFingerprint(question = {}) {
  const questionClass = text(question.questionClass).toUpperCase();
  const questionText = normalizedIntentText(question.questionText);
  const expectedEvidenceClass = text(question.expectedEvidenceClass).toUpperCase();
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

function priorRoundQuestionEstate(value, round, errors) {
  if (!denseArray(value) || value.length !== 10) {
    errors.push('priorRoundQuestions-must-contain-exactly-10-dense-records');
    return [];
  }
  const fingerprints = [];
  for (let index = 0; index < value.length; index += 1) {
    const question = value[index];
    const validation = validateStephanosCapabilityQuestion(question);
    for (const error of validation.errors) errors.push(`prior-question-${index + 1}:${error}`);
    if (question?.askerParticipantId !== round.askerParticipantId) errors.push(`prior-question-${index + 1}:askerParticipantId-mismatch`);
    if (question?.targetParticipantId !== round.targetParticipantId) errors.push(`prior-question-${index + 1}:targetParticipantId-mismatch`);
    fingerprints.push(text(question?.intentFingerprint));
  }
  if (new Set(fingerprints).size !== 10) errors.push('priorRoundQuestions-intentFingerprints-must-be-unique');
  return value;
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

  const priorQuestions = round.roundNumber > 1 ? priorRoundQuestionEstate(options.priorRoundQuestions, round, errors) : [];
  const priorFingerprints = priorQuestions.map((question) => text(question.intentFingerprint));
  const priorFingerprintSet = new Set(priorFingerprints);
  const priorCanonicalIntentSet = new Set(priorQuestions.map(canonicalStephanosQuestionIntentFingerprint).filter(Boolean));
  if (round.roundNumber > 1 && options.priorRoundIntentFingerprints !== undefined) {
    const suppliedPriorFingerprints = stringList(options.priorRoundIntentFingerprints, 'priorRoundIntentFingerprints', errors, 10);
    if (suppliedPriorFingerprints.length !== 10) errors.push('priorRoundIntentFingerprints-must-contain-exactly-10');
    if (!sameStringSet(suppliedPriorFingerprints, priorFingerprints)) errors.push('priorRoundIntentFingerprints-do-not-match-priorRoundQuestions');
  }

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
      const canonicalFingerprint = canonicalStephanosQuestionIntentFingerprint(question);
      if (!canonicalFingerprint || fingerprint !== canonicalFingerprint) errors.push(`question-${index + 1}:intentFingerprint-must-match-canonical-question-intent`);
      if (priorFingerprintSet.has(fingerprint)) errors.push(`question-${index + 1}:intentFingerprint-replays-prior-round`);
      if (priorCanonicalIntentSet.has(canonicalFingerprint)) errors.push(`question-${index + 1}:canonical-intent-replays-prior-round`);
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
  if (SETTLED_BOUNDARY_VERDICTS.has(verdict)) return 'BOUNDARY_REQUIRES_ADJUDICATION';
  return 'INVALID';
}

function boundaryAdjudicationFor(answer, input = {}) {
  return denseArray(input.boundaryAdjudications)
    ? input.boundaryAdjudications.find((item) => item?.answerId === answer.answerId)
    : null;
}

function validateBoundaryAdjudication(answer, adjudication, input = {}) {
  const errors = [];
  if (!exactRecordShape(adjudication, BOUNDARY_ADJUDICATION_KEYS, errors)) return result(errors);
  if (adjudication.schemaVersion !== STEPHANOS_BOUNDARY_ADJUDICATION_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (adjudication.answerId !== answer.answerId) errors.push('answerId-mismatch');
  if (normalizedVerdict(adjudication.answerVerdict) !== normalizedVerdict(answer.answerVerdict)) errors.push('answerVerdict-mismatch');
  if (text(adjudication.status).toUpperCase() !== 'CURRENT') errors.push('status-not-current');
  if (!['FRESH', 'RECENT'].includes(text(adjudication.freshness).toUpperCase())) errors.push('freshness-insufficient');
  const adjudicatedEvidenceRefs = stringList(adjudication.evidenceRefs, 'evidenceRefs', errors, 1);
  const adjudicatedSources = stringList(adjudication.sourcesConsulted, 'sourcesConsulted', errors, 1);
  const adjudicationProofRefs = stringList(adjudication.proofRefs, 'proofRefs', errors, 1);
  if (!timestamp(adjudication.adjudicatedAtUtc)) errors.push('adjudicatedAtUtc-invalid');
  if (!sameStringSet(adjudicatedEvidenceRefs, answer.evidenceRefs)) errors.push('evidenceRefs-do-not-match-answer');
  if (!sameStringSet(adjudicatedSources, answer.sourcesConsulted)) errors.push('sourcesConsulted-do-not-match-answer');

  const authoritativeEvidenceRefs = new Set(denseArray(input.authoritativeEvidenceRefs) ? input.authoritativeEvidenceRefs.map(text) : []);
  const authoritativeSourceRefs = new Set(denseArray(input.authoritativeSourceRefs) ? input.authoritativeSourceRefs.map(text) : []);
  const authoritativeAdjudicationProofRefs = new Set(denseArray(input.authoritativeAdjudicationProofRefs) ? input.authoritativeAdjudicationProofRefs.map(text) : []);
  if (answer.evidenceRefs.some((reference) => !authoritativeEvidenceRefs.has(reference))) errors.push('answer-evidence-not-in-authoritative-registry');
  if (answer.sourcesConsulted.some((reference) => !authoritativeSourceRefs.has(reference))) errors.push('answer-source-not-in-authoritative-registry');
  if (adjudicationProofRefs.some((reference) => !authoritativeAdjudicationProofRefs.has(reference))) errors.push('adjudication-proof-not-in-authoritative-registry');

  const nowMs = Number.isFinite(input.evaluationNowMs) ? input.evaluationNowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.boundaryAdjudicationStaleAfterMs) && input.boundaryAdjudicationStaleAfterMs >= 0
    ? input.boundaryAdjudicationStaleAfterMs
    : DEFAULT_BOUNDARY_ADJUDICATION_STALE_AFTER_MS;
  const adjudicatedMs = Date.parse(text(adjudication.adjudicatedAtUtc));
  if (Number.isFinite(adjudicatedMs) && (adjudicatedMs > nowMs || nowMs - adjudicatedMs > staleAfterMs)) errors.push('adjudication-timestamp-not-current');
  return result(errors);
}

export function evaluateStephanosCapabilityRound(input = {}) {
  const round = input.round;
  const answers = input.answers;
  const roundValidation = validateStephanosCapabilityRound(round, {
    priorRoundQuestions: input.priorRoundQuestions,
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
      boundaryAdjudicationBlockers:Object.freeze([]),
      mayAdvanceToNovelRound:false,
      requiresRepairReplay:false,
      requiresBoundaryAdjudication:false,
    });
  }

  if (answers.length !== 10) errors.push('answers-must-contain-exactly-10-records');
  const questionById = new Map(round.questions.map((question) => [question.questionId, question]));
  const seenAnswers = new Set();
  const classifications = [];
  const gapObservations = [];
  const boundaryAdjudicationBlockers = [];

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
      if (classification === 'BOUNDARY_REQUIRES_ADJUDICATION') {
        const adjudication = boundaryAdjudicationFor(answer, input);
        const adjudicationValidation = validateBoundaryAdjudication(answer, adjudication, input);
        if (adjudicationValidation.valid) classifications.push('RETAINED_BOUNDARY');
        else {
          classifications.push('UNADJUDICATED_BOUNDARY');
          boundaryAdjudicationBlockers.push(Object.freeze({
            answerId: answer.answerId,
            answerVerdict: normalizedVerdict(answer.answerVerdict),
            errors: Object.freeze([...adjudicationValidation.errors]),
          }));
        }
      } else {
        classifications.push(classification);
      }
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
      boundaryAdjudicationBlockers:Object.freeze(boundaryAdjudicationBlockers),
      mayAdvanceToNovelRound:false,
      requiresRepairReplay:false,
      requiresBoundaryAdjudication:boundaryAdjudicationBlockers.length > 0,
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
  const requiresBoundaryAdjudication = classifications.includes('UNADJUDICATED_BOUNDARY');
  const state = counts.buildableGaps > 0
    ? 'GAPS_IDENTIFIED'
    : hasRepairWork
      ? 'REGRESSION_PROVING'
      : requiresBoundaryAdjudication
        ? 'SAFE_HOLD'
        : 'SETTLED';
  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_LADDER_SCHEMA_VERSION,
    valid:true,
    roundId:round.roundId,
    state,
    errors:Object.freeze([]),
    counts,
    gapObservations:Object.freeze(gapObservations),
    boundaryAdjudicationBlockers:Object.freeze(boundaryAdjudicationBlockers),
    mayAdvanceToNovelRound:!hasRepairWork && !requiresBoundaryAdjudication,
    requiresRepairReplay:hasRepairWork,
    requiresBoundaryAdjudication,
  });
}
