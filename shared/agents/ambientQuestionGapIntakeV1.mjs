import { createHash } from 'node:crypto';
import {
  STEPHANOS_ANSWER_VERDICTS,
  STEPHANOS_BUILDABLE_GAP_VERDICTS,
} from './stephanosConversationalCapabilityLadderV1.mjs';

export const AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION = 'stephanos.ambient-question-gap-intake.v1';
export const AMBIENT_QUESTION_GAP_OBSERVATION_SCHEMA_VERSION = 'stephanos.ambient-question-gap-observation.v1';

export const AMBIENT_QUESTION_ORIGINS = Object.freeze([
  'FORMAL_TEN_QUESTION_ROUND',
  'AMBIENT_PARTICIPANT_CONVERSATION',
  'OPERATOR_QUERY',
  'SYSTEM_PROBE',
  'REGRESSION_REPLAY',
]);

export const AMBIENT_GAP_ROOT_CAUSE_CLASSES = Object.freeze([
  'KNOWLEDGE_NOT_INGESTED',
  'CANONICAL_STATE_NOT_PROJECTED',
  'MEMORY_NOT_RETAINED',
  'MEMORY_NOT_RETRIEVABLE',
  'CONTEXT_NOT_ROUTED',
  'PARTICIPANT_NOT_CONNECTED',
  'QUESTION_ANSWER_TRANSPORT_MISSING',
  'TOOL_OR_DATA_SOURCE_MISSING',
  'TOOL_PRESENT_BUT_NOT_DISCOVERABLE',
  'REASONING_OR_SYNTHESIS_WEAKNESS',
  'FRESHNESS_OR_OBSERVABILITY_GAP',
  'PROOF_OR_CITATION_GAP',
  'AGENT_CAPABILITY_CONTRACT_GAP',
  'CROSS_PARTICIPANT_COHERENCE_GAP',
]);

export const AMBIENT_NON_BUILDABLE_BOUNDARIES = Object.freeze([
  'EXTERNAL_UNBUILDABLE',
  'INTENTIONALLY_UNSUPPORTED',
  'PRIVACY_BOUNDARY',
  'AUTHORITY_BOUNDARY',
  'SAFETY_BOUNDARY',
  'INSUFFICIENT_EVIDENCE_BY_DESIGN',
]);

const ORIGINS = new Set(AMBIENT_QUESTION_ORIGINS);
const ROOT_CAUSES = new Set(AMBIENT_GAP_ROOT_CAUSE_CLASSES);
const BOUNDARIES = new Set(AMBIENT_NON_BUILDABLE_BOUNDARIES);
const VERDICTS = new Set(STEPHANOS_ANSWER_VERDICTS);
const BUILDABLE_VERDICTS = new Set(STEPHANOS_BUILDABLE_GAP_VERDICTS);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_GOAL = /^#[1-9][0-9]{0,9}$/;
const SAFE_REF = /^(?:question|answer|round|issue|pr|goal|receipt|evidence|workspace|memory|runtime|project):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/i;
const MAX_REFS = 32;
const MAX_GOALS = 16;
const INPUT_KEYS = Object.freeze([
  'questionId', 'roundId', 'correlationId', 'origin', 'askerParticipantId', 'targetParticipantId',
  'intentFingerprint', 'expectedEvidenceClass', 'answerVerdict', 'epistemicState', 'boundaryClass',
  'rootCauseClass', 'affectedCapability', 'affectedParticipants', 'evidenceRefs', 'proofRefs',
  'qualifiedOwnerCandidates', 'existingGoalCandidates', 'observedAtUtc',
]);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sharedWorkspaceWriteAllowed: false,
  goalCreationAllowed: false,
  schedulerAdmissionAllowed: false,
  sourceMutationAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  spendingAllowed: false,
  authorityWideningAllowed: false,
});

const DEFAULT_ROOT_CAUSE_BY_VERDICT = Object.freeze({
  GAP_KNOWLEDGE: 'KNOWLEDGE_NOT_INGESTED',
  GAP_CONTEXT: 'CONTEXT_NOT_ROUTED',
  GAP_MEMORY: 'MEMORY_NOT_RETRIEVABLE',
  GAP_RETRIEVAL: 'MEMORY_NOT_RETRIEVABLE',
  GAP_TOOL_OR_DATA_ACCESS: 'TOOL_OR_DATA_SOURCE_MISSING',
  GAP_CONVERSATION_FABRIC: 'QUESTION_ANSWER_TRANSPORT_MISSING',
  GAP_REASONING_OR_SYNTHESIS: 'REASONING_OR_SYNTHESIS_WEAKNESS',
  GAP_FRESHNESS: 'FRESHNESS_OR_OBSERVABILITY_GAP',
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    if (Object.getOwnPropertySymbols(value).length) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return INVALID;
    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function denseStrings(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Object.keys(descriptors).length !== length + 1) return INVALID;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || typeof descriptor.value !== 'string') return INVALID;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

function normalizedToken(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function safeRef(value) {
  return typeof value === 'string' && SAFE_REF.test(value) && !value.includes('..');
}

function normalizeList(value, field, maximum, predicate, errors) {
  const values = denseStrings(value, maximum);
  if (values === INVALID) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const normalized = [];
  for (const item of values) {
    const entry = item.trim();
    if (!predicate(entry)) errors.push(`${field}-contains-invalid-value`);
    else normalized.push(entry);
  }
  if (new Set(normalized).size !== normalized.length) errors.push(`${field}-contains-duplicate`);
  return normalized;
}

function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function invalidResult(errors) {
  return Object.freeze({
    schemaVersion: AMBIENT_QUESTION_GAP_OBSERVATION_SCHEMA_VERSION,
    status: 'SAFE_HOLD',
    buildable: false,
    gapId: '',
    gapSignature: '',
    rootCauseClass: '',
    canonicalGoalRef: '',
    requiresNewCanonicalGoal: false,
    routingRequired: false,
    boundaryClass: '',
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function boundaryFromVerdict(verdict, explicitBoundary) {
  if (explicitBoundary) return explicitBoundary;
  if (verdict === 'EXTERNAL_UNBUILDABLE') return 'EXTERNAL_UNBUILDABLE';
  if (verdict === 'INTENTIONALLY_UNSUPPORTED') return 'INTENTIONALLY_UNSUPPORTED';
  if (verdict === 'UNSAFE_OR_AUTHORITY_BOUNDARY') return 'AUTHORITY_BOUNDARY';
  return '';
}

function stableGapSignature({ rootCauseClass, affectedCapability, affectedParticipants, expectedEvidenceClass }) {
  const canonical = {
    rootCauseClass,
    affectedCapability: normalizedText(affectedCapability),
    affectedParticipants: [...affectedParticipants].map((value) => value.toLowerCase()).sort(compareText),
    expectedEvidenceClass: expectedEvidenceClass.toUpperCase(),
  };
  return `gap-${canonicalHash(canonical).slice(0, 40)}`;
}

export function buildAmbientQuestionGapObservationV1(input = {}) {
  const errors = [];
  const record = exactObject(input, INPUT_KEYS);
  if (record === INVALID) return invalidResult(['input-invalid-exact-data-shape']);

  for (const field of ['questionId', 'correlationId', 'askerParticipantId', 'targetParticipantId', 'intentFingerprint']) {
    if (typeof record[field] !== 'string' || !SAFE_ID.test(record[field])) errors.push(`${field}-invalid`);
  }
  if (record.roundId !== null && (typeof record.roundId !== 'string' || !SAFE_ID.test(record.roundId))) errors.push('roundId-invalid');
  const origin = normalizedToken(record.origin);
  if (!ORIGINS.has(origin)) errors.push('origin-invalid');
  const answerVerdict = normalizedToken(record.answerVerdict);
  if (!VERDICTS.has(answerVerdict)) errors.push('answerVerdict-invalid');
  const epistemicState = normalizedToken(record.epistemicState);
  if (!SAFE_ID.test(epistemicState)) errors.push('epistemicState-invalid');
  const expectedEvidenceClass = normalizedToken(record.expectedEvidenceClass);
  if (!SAFE_ID.test(expectedEvidenceClass)) errors.push('expectedEvidenceClass-invalid');
  if (!exactTimestamp(record.observedAtUtc)) errors.push('observedAtUtc-invalid');
  if (typeof record.affectedCapability !== 'string' || !record.affectedCapability.trim() || record.affectedCapability.length > 240) errors.push('affectedCapability-invalid');

  const affectedParticipants = normalizeList(record.affectedParticipants, 'affectedParticipants', MAX_REFS, (value) => SAFE_ID.test(value), errors);
  const evidenceRefs = normalizeList(record.evidenceRefs, 'evidenceRefs', MAX_REFS, safeRef, errors);
  const proofRefs = normalizeList(record.proofRefs, 'proofRefs', MAX_REFS, safeRef, errors);
  const qualifiedOwnerCandidates = normalizeList(record.qualifiedOwnerCandidates, 'qualifiedOwnerCandidates', MAX_REFS, (value) => SAFE_ID.test(value), errors);
  const existingGoalCandidates = normalizeList(record.existingGoalCandidates, 'existingGoalCandidates', MAX_GOALS, (value) => SAFE_GOAL.test(value), errors);

  const explicitBoundary = record.boundaryClass === null ? '' : normalizedToken(record.boundaryClass);
  if (explicitBoundary && !BOUNDARIES.has(explicitBoundary)) errors.push('boundaryClass-invalid');
  const rootCauseInput = record.rootCauseClass === null ? '' : normalizedToken(record.rootCauseClass);
  if (rootCauseInput && !ROOT_CAUSES.has(rootCauseInput)) errors.push('rootCauseClass-invalid');
  if (errors.length) return invalidResult(errors);

  const boundaryClass = boundaryFromVerdict(answerVerdict, explicitBoundary);
  if (boundaryClass) {
    return Object.freeze({
      schemaVersion: AMBIENT_QUESTION_GAP_OBSERVATION_SCHEMA_VERSION,
      status: 'BOUNDARY_RETAINED',
      buildable: false,
      questionId: record.questionId,
      correlationId: record.correlationId,
      origin,
      answerVerdict,
      epistemicState,
      gapId: '',
      gapSignature: '',
      rootCauseClass: '',
      affectedCapability: record.affectedCapability.trim(),
      affectedParticipants: Object.freeze([...affectedParticipants].sort(compareText)),
      evidenceRefs: Object.freeze([...evidenceRefs]),
      proofRefs: Object.freeze([...proofRefs]),
      canonicalGoalRef: '',
      requiresNewCanonicalGoal: false,
      routingRequired: false,
      boundaryClass,
      authority: AUTHORITY,
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  if (epistemicState === 'UNSUPPORTED_BY_THIS_PARTICIPANT' && qualifiedOwnerCandidates.length > 0) {
    return Object.freeze({
      schemaVersion: AMBIENT_QUESTION_GAP_OBSERVATION_SCHEMA_VERSION,
      status: 'OWNER_ROUTING_REQUIRED',
      buildable: false,
      questionId: record.questionId,
      correlationId: record.correlationId,
      origin,
      answerVerdict,
      epistemicState,
      gapId: '',
      gapSignature: '',
      rootCauseClass: '',
      affectedCapability: record.affectedCapability.trim(),
      affectedParticipants: Object.freeze([...affectedParticipants].sort(compareText)),
      evidenceRefs: Object.freeze([...evidenceRefs]),
      proofRefs: Object.freeze([...proofRefs]),
      qualifiedOwnerCandidates: Object.freeze([...qualifiedOwnerCandidates].sort(compareText)),
      canonicalGoalRef: '',
      requiresNewCanonicalGoal: false,
      routingRequired: true,
      boundaryClass: '',
      authority: AUTHORITY,
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  if (!BUILDABLE_VERDICTS.has(answerVerdict)) {
    return Object.freeze({
      schemaVersion: AMBIENT_QUESTION_GAP_OBSERVATION_SCHEMA_VERSION,
      status: answerVerdict === 'ANSWERED_GROUNDED' ? 'ANSWER_ACCEPTED_NO_GAP' : 'NO_BUILDABLE_GAP',
      buildable: false,
      questionId: record.questionId,
      correlationId: record.correlationId,
      origin,
      answerVerdict,
      epistemicState,
      gapId: '',
      gapSignature: '',
      rootCauseClass: '',
      affectedCapability: record.affectedCapability.trim(),
      affectedParticipants: Object.freeze([...affectedParticipants].sort(compareText)),
      evidenceRefs: Object.freeze([...evidenceRefs]),
      proofRefs: Object.freeze([...proofRefs]),
      canonicalGoalRef: '',
      requiresNewCanonicalGoal: false,
      routingRequired: false,
      boundaryClass: '',
      authority: AUTHORITY,
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  const rootCauseClass = rootCauseInput || DEFAULT_ROOT_CAUSE_BY_VERDICT[answerVerdict] || '';
  if (!ROOT_CAUSES.has(rootCauseClass)) return invalidResult(['buildable-gap-requires-root-cause']);
  const gapSignature = stableGapSignature({
    rootCauseClass,
    affectedCapability: record.affectedCapability,
    affectedParticipants,
    expectedEvidenceClass,
  });
  const gapId = `ambient-${gapSignature.slice(4, 28)}`;
  let canonicalGoalRef = '';
  let status = 'GAP_DEDUPLICATED';
  let requiresNewCanonicalGoal = false;
  if (existingGoalCandidates.length === 1) canonicalGoalRef = existingGoalCandidates[0];
  else if (existingGoalCandidates.length === 0) {
    status = 'NEW_CANONICAL_GOAL_REQUIRED';
    requiresNewCanonicalGoal = true;
  } else {
    status = 'SAFE_HOLD_AMBIGUOUS_GOAL_OWNERSHIP';
  }

  return Object.freeze({
    schemaVersion: AMBIENT_QUESTION_GAP_OBSERVATION_SCHEMA_VERSION,
    status,
    buildable: true,
    questionId: record.questionId,
    roundId: record.roundId,
    correlationId: record.correlationId,
    origin,
    askerParticipantId: record.askerParticipantId,
    targetParticipantId: record.targetParticipantId,
    intentFingerprint: record.intentFingerprint,
    expectedEvidenceClass,
    answerVerdict,
    epistemicState,
    gapId,
    gapSignature,
    rootCauseClass,
    affectedCapability: record.affectedCapability.trim(),
    affectedParticipants: Object.freeze([...affectedParticipants].sort(compareText)),
    evidenceRefs: Object.freeze([...evidenceRefs]),
    proofRefs: Object.freeze([...proofRefs]),
    existingGoalCandidates: Object.freeze([...existingGoalCandidates].sort(compareText)),
    canonicalGoalRef,
    requiresNewCanonicalGoal,
    routingRequired: false,
    boundaryClass: '',
    observedAtUtc: record.observedAtUtc,
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  });
}

export function aggregateAmbientQuestionGapOccurrencesV1(observations = []) {
  const errors = [];
  const values = Array.isArray(observations) ? observations : null;
  if (!values || Object.getPrototypeOf(values) !== Array.prototype || values.length < 1 || values.length > 512) {
    return Object.freeze({ valid: false, verdict: 'SAFE_HOLD', validationErrors: Object.freeze(['observations-invalid']) });
  }
  const normalized = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item || typeof item !== 'object' || item.buildable !== true || typeof item.gapSignature !== 'string' || !item.gapSignature.startsWith('gap-')) {
      errors.push(`observation-${index}-invalid`);
      continue;
    }
    normalized.push(item);
  }
  const signatures = new Set(normalized.map((item) => item.gapSignature));
  if (signatures.size !== 1) errors.push('observations-must-share-one-gap-signature');
  if (errors.length) return Object.freeze({ valid: false, verdict: 'SAFE_HOLD', validationErrors: Object.freeze(errors) });
  const firstSeenAtUtc = [...normalized].map((item) => item.observedAtUtc).sort(compareText)[0];
  const lastSeenAtUtc = [...normalized].map((item) => item.observedAtUtc).sort(compareText).at(-1);
  const distinctParticipantIds = [...new Set(normalized.flatMap((item) => item.affectedParticipants || []))].sort(compareText);
  const sourceQuestionRefs = [...new Set(normalized.map((item) => `question://${item.questionId}`))].sort(compareText);
  return Object.freeze({
    valid: true,
    verdict: 'GAP_OCCURRENCES_AGGREGATED',
    gapSignature: normalized[0].gapSignature,
    occurrenceCount: normalized.length,
    distinctParticipantIds: Object.freeze(distinctParticipantIds),
    sourceQuestionRefs: Object.freeze(sourceQuestionRefs),
    firstSeenAtUtc,
    lastSeenAtUtc,
    authority: AUTHORITY,
    validationErrors: Object.freeze([]),
  });
}
