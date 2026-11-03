import { createHash } from 'node:crypto';

import {
  STEPHANOS_ANSWER_EPISTEMIC_STATES,
  STEPHANOS_ANSWER_VERDICTS,
  STEPHANOS_BUILDABLE_GAP_VERDICTS,
} from './stephanosConversationalCapabilityLadderV1.mjs';

export const STEPHANOS_AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION =
  'stephanos.ambient-question-gap-intake.v1';

export const STEPHANOS_AMBIENT_QUESTION_ORIGINS = Object.freeze([
  'FORMAL_TEN_QUESTION_ROUND',
  'AMBIENT_PARTICIPANT_CONVERSATION',
  'OPERATOR_QUERY',
  'SYSTEM_PROBE',
  'REGRESSION_REPLAY',
]);

export const STEPHANOS_AMBIENT_ROOT_CAUSE_CLASSES = Object.freeze([
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

export const STEPHANOS_AMBIENT_BOUNDARY_CLASSES = Object.freeze([
  'EXTERNAL_UNBUILDABLE',
  'INTENTIONALLY_UNSUPPORTED',
  'PRIVACY_BOUNDARY',
  'AUTHORITY_BOUNDARY',
  'SAFETY_BOUNDARY',
  'INSUFFICIENT_EVIDENCE_BY_DESIGN',
]);

const ORIGINS = new Set(STEPHANOS_AMBIENT_QUESTION_ORIGINS);
const ROOT_CAUSES = new Set(STEPHANOS_AMBIENT_ROOT_CAUSE_CLASSES);
const BOUNDARIES = new Set(STEPHANOS_AMBIENT_BOUNDARY_CLASSES);
const ANSWER_VERDICTS = new Set(STEPHANOS_ANSWER_VERDICTS);
const BUILDABLE_VERDICTS = new Set(STEPHANOS_BUILDABLE_GAP_VERDICTS);
const EPISTEMIC_STATES = new Set(STEPHANOS_ANSWER_EPISTEMIC_STATES);
const QA_CAPABILITIES = new Set(['CAN_ASK_AND_ANSWER', 'CAN_ANSWER_STATUS_ONLY', 'CAN_ASK_ONLY', 'NO_QA_ADAPTER_YET', 'INTENTIONALLY_NON_CONVERSATIONAL']);
const GOAL_STATES = new Set(['OPEN', 'READY', 'BUILDING', 'REVIEWING', 'PROVING', 'BLOCKED', 'COMPLETE']);
const GAP_STATES = new Set(['OBSERVED', 'MAPPED', 'BUILDING', 'REVIEWING', 'PROVING', 'FIXED', 'REOPENED', 'BOUNDARY_RETAINED']);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_REF = /^(?:(?:issue|pr|receipt|evidence|workspace|memory|operator|runtime|project|github|shared-workspace|question|gap):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}|(?:proof|proofs|receipt|receipts|evidence|github|shared-workspace|runtime|memory)\/[a-z0-9._/#:-]{1,220})$/i;
const MAX_QUESTION_TEXT = 4096;
const MAX_REASON_TEXT = 1200;
const MAX_EXISTING_GAPS = 2_000;
const MAX_EXISTING_GOALS = 2_000;
const MAX_ROUTING_CANDIDATES = 256;
const MAX_REFS = 32;

const DEFAULT_ROOT_CAUSE_BY_VERDICT = Object.freeze({
  GAP_KNOWLEDGE: 'KNOWLEDGE_NOT_INGESTED',
  GAP_CONTEXT: 'CONTEXT_NOT_ROUTED',
  GAP_MEMORY: 'MEMORY_NOT_RETRIEVABLE',
  GAP_RETRIEVAL: 'CANONICAL_STATE_NOT_PROJECTED',
  GAP_TOOL_OR_DATA_ACCESS: 'TOOL_OR_DATA_SOURCE_MISSING',
  GAP_CONVERSATION_FABRIC: 'QUESTION_ANSWER_TRANSPORT_MISSING',
  GAP_REASONING_OR_SYNTHESIS: 'REASONING_OR_SYNTHESIS_WEAKNESS',
  GAP_FRESHNESS: 'FRESHNESS_OR_OBSERVABILITY_GAP',
});

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  goalCreationAllowed: false,
  schedulerDispatchAllowed: false,
  sharedWorkspaceWriteAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  permissionWideningAllowed: false,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set)) return null;
    return descriptors;
  } catch {
    return null;
  }
}

function ownData(descriptors, key) {
  const descriptor = descriptors?.[key];
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function exactIso(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString() === value ? milliseconds : null;
  } catch {
    return null;
  }
}

function normalizedCapability(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, '-').toLowerCase()
    : '';
}

function denseStringList(value, maximum = MAX_REFS) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') return null;
    const item = value[index].trim();
    if (!item || item.length > 240) return null;
    output.push(item);
  }
  return [...new Set(output)];
}

function safeRefs(value) {
  const refs = denseStringList(value);
  if (!refs || refs.some((ref) => !SAFE_REF.test(ref) || ref.includes('..'))) return null;
  return refs;
}

function invalid(errors, partial = {}) {
  return Object.freeze({
    schemaVersion: STEPHANOS_AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION,
    state: 'SAFE_HOLD',
    questionId: partial.questionId || '',
    correlationId: partial.correlationId || '',
    ownerRoutingDecision: Object.freeze({ state: 'NOT_EVALUATED', selectedParticipantId: '', candidates: Object.freeze([]) }),
    answerClassification: Object.freeze({ verdict: '', rootCauseClass: '', boundaryClass: '' }),
    gapObservation: null,
    canonicalGoalRef: '',
    goalDisposition: 'NOT_EVALUATED',
    schedulerCandidate: false,
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

function normalizeQuestion(value, errors) {
  const descriptors = safePlainObject(value);
  if (!descriptors) {
    errors.push('question:data-only-object-required');
    return null;
  }
  const questionId = String(ownData(descriptors, 'questionId') || '').trim();
  const correlationId = String(ownData(descriptors, 'correlationId') || '').trim();
  const askerParticipantId = String(ownData(descriptors, 'askerParticipantId') || '').trim();
  const targetParticipantId = String(ownData(descriptors, 'targetParticipantId') || '').trim();
  const questionText = String(ownData(descriptors, 'questionText') || '').trim();
  const intentFingerprint = String(ownData(descriptors, 'intentFingerprint') || '').trim();
  const expectedEvidenceClass = String(ownData(descriptors, 'expectedEvidenceClass') || '').trim();
  const affectedCapability = normalizedCapability(ownData(descriptors, 'affectedCapability'));
  const origin = String(ownData(descriptors, 'origin') || '').trim().toUpperCase();
  const createdAtUtc = ownData(descriptors, 'createdAtUtc');

  for (const [field, candidate] of [
    ['questionId', questionId], ['correlationId', correlationId], ['askerParticipantId', askerParticipantId],
    ['targetParticipantId', targetParticipantId], ['intentFingerprint', intentFingerprint], ['expectedEvidenceClass', expectedEvidenceClass],
  ]) if (!SAFE_ID.test(candidate)) errors.push(`question:${field}-invalid`);
  if (!questionText || questionText.length > MAX_QUESTION_TEXT) errors.push('question:questionText-invalid');
  if (!affectedCapability || !SAFE_ID.test(affectedCapability)) errors.push('question:affectedCapability-invalid');
  if (!ORIGINS.has(origin)) errors.push('question:origin-invalid');
  if (exactIso(createdAtUtc) === null) errors.push('question:createdAtUtc-invalid');

  return Object.freeze({ questionId, correlationId, askerParticipantId, targetParticipantId, questionText, intentFingerprint, expectedEvidenceClass, affectedCapability, origin, createdAtUtc });
}

function normalizeAnswer(value, question, errors) {
  const descriptors = safePlainObject(value);
  if (!descriptors) {
    errors.push('answer:data-only-object-required');
    return null;
  }
  const responderParticipantId = String(ownData(descriptors, 'responderParticipantId') || '').trim();
  const answerVerdict = String(ownData(descriptors, 'answerVerdict') || '').trim().toUpperCase();
  const epistemicState = String(ownData(descriptors, 'epistemicState') || '').trim().toUpperCase();
  const evidenceRefs = safeRefs(ownData(descriptors, 'evidenceRefs') ?? []);
  const cannotAnswerReason = String(ownData(descriptors, 'cannotAnswerReason') || '').trim();
  const answeredAtUtc = ownData(descriptors, 'answeredAtUtc');
  if (!SAFE_ID.test(responderParticipantId)) errors.push('answer:responderParticipantId-invalid');
  if (!ANSWER_VERDICTS.has(answerVerdict)) errors.push('answer:answerVerdict-invalid');
  if (!EPISTEMIC_STATES.has(epistemicState)) errors.push('answer:epistemicState-invalid');
  if (!evidenceRefs) errors.push('answer:evidenceRefs-invalid');
  if (cannotAnswerReason.length > MAX_REASON_TEXT) errors.push('answer:cannotAnswerReason-too-long');
  const answeredAtMs = exactIso(answeredAtUtc);
  const createdAtMs = question ? exactIso(question.createdAtUtc) : null;
  if (answeredAtMs === null) errors.push('answer:answeredAtUtc-invalid');
  if (answeredAtMs !== null && createdAtMs !== null && answeredAtMs < createdAtMs) errors.push('answer:predates-question');
  return Object.freeze({ responderParticipantId, answerVerdict, epistemicState, evidenceRefs: Object.freeze(evidenceRefs || []), cannotAnswerReason, answeredAtUtc });
}

function normalizeRoutingCandidates(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ROUTING_CANDIDATES) {
    errors.push('routingCandidates-invalid');
    return [];
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptors = safePlainObject(value[index]);
    if (!descriptors) {
      errors.push(`routingCandidate-${index + 1}:data-only-object-required`);
      continue;
    }
    const participantId = String(ownData(descriptors, 'participantId') || '').trim();
    const capabilities = denseStringList(ownData(descriptors, 'capabilities') ?? [], 64);
    const qaCapability = String(ownData(descriptors, 'qaCapability') || '').trim().toUpperCase();
    const freshness = String(ownData(descriptors, 'freshness') || '').trim().toUpperCase();
    if (!SAFE_ID.test(participantId)) errors.push(`routingCandidate-${index + 1}:participantId-invalid`);
    if (!capabilities) errors.push(`routingCandidate-${index + 1}:capabilities-invalid`);
    if (!QA_CAPABILITIES.has(qaCapability)) errors.push(`routingCandidate-${index + 1}:qaCapability-invalid`);
    if (!['FRESH', 'RECENT', 'STALE', 'UNKNOWN'].includes(freshness)) errors.push(`routingCandidate-${index + 1}:freshness-invalid`);
    output.push(Object.freeze({ participantId, capabilities: Object.freeze((capabilities || []).map(normalizedCapability)), qaCapability, freshness }));
  }
  return output;
}

function normalizeExistingGoals(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_EXISTING_GOALS) {
    errors.push('existingGoals-invalid');
    return [];
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptors = safePlainObject(value[index]);
    if (!descriptors) {
      errors.push(`existingGoal-${index + 1}:data-only-object-required`);
      continue;
    }
    const goalRef = String(ownData(descriptors, 'goalRef') || '').trim();
    const rootCauseClasses = denseStringList(ownData(descriptors, 'rootCauseClasses') ?? [], 64);
    const capabilities = denseStringList(ownData(descriptors, 'capabilities') ?? [], 64);
    const state = String(ownData(descriptors, 'state') || '').trim().toUpperCase();
    if (!SAFE_GOAL_REF.test(goalRef)) errors.push(`existingGoal-${index + 1}:goalRef-invalid`);
    if (!rootCauseClasses || rootCauseClasses.some((item) => !ROOT_CAUSES.has(item))) errors.push(`existingGoal-${index + 1}:rootCauseClasses-invalid`);
    if (!capabilities) errors.push(`existingGoal-${index + 1}:capabilities-invalid`);
    if (!GOAL_STATES.has(state)) errors.push(`existingGoal-${index + 1}:state-invalid`);
    output.push(Object.freeze({ goalRef, rootCauseClasses: Object.freeze(rootCauseClasses || []), capabilities: Object.freeze((capabilities || []).map(normalizedCapability)), state }));
  }
  return output;
}

function normalizeExistingGaps(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_EXISTING_GAPS) {
    errors.push('existingGaps-invalid');
    return [];
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptors = safePlainObject(value[index]);
    if (!descriptors) {
      errors.push(`existingGap-${index + 1}:data-only-object-required`);
      continue;
    }
    const gapId = String(ownData(descriptors, 'gapId') || '').trim();
    const gapSignature = String(ownData(descriptors, 'gapSignature') || '').trim();
    const sourceQuestionRefs = safeRefs(ownData(descriptors, 'sourceQuestionRefs') ?? []);
    const firstSeenAtUtc = ownData(descriptors, 'firstSeenAtUtc');
    const lastSeenAtUtc = ownData(descriptors, 'lastSeenAtUtc');
    const occurrenceCount = ownData(descriptors, 'occurrenceCount');
    const distinctParticipantIds = denseStringList(ownData(descriptors, 'distinctParticipantIds') ?? [], 256);
    const canonicalGoalRef = String(ownData(descriptors, 'canonicalGoalRef') || '').trim();
    const status = String(ownData(descriptors, 'status') || '').trim().toUpperCase();
    const proofRefs = safeRefs(ownData(descriptors, 'proofRefs') ?? []);
    if (!SAFE_ID.test(gapId)) errors.push(`existingGap-${index + 1}:gapId-invalid`);
    if (!/^[a-f0-9]{64}$/.test(gapSignature)) errors.push(`existingGap-${index + 1}:gapSignature-invalid`);
    if (!sourceQuestionRefs) errors.push(`existingGap-${index + 1}:sourceQuestionRefs-invalid`);
    if (exactIso(firstSeenAtUtc) === null || exactIso(lastSeenAtUtc) === null) errors.push(`existingGap-${index + 1}:timestamps-invalid`);
    if (!Number.isSafeInteger(occurrenceCount) || occurrenceCount < 1) errors.push(`existingGap-${index + 1}:occurrenceCount-invalid`);
    if (!distinctParticipantIds || distinctParticipantIds.some((id) => !SAFE_ID.test(id))) errors.push(`existingGap-${index + 1}:distinctParticipantIds-invalid`);
    if (canonicalGoalRef && !SAFE_GOAL_REF.test(canonicalGoalRef)) errors.push(`existingGap-${index + 1}:canonicalGoalRef-invalid`);
    if (!GAP_STATES.has(status)) errors.push(`existingGap-${index + 1}:status-invalid`);
    if (!proofRefs) errors.push(`existingGap-${index + 1}:proofRefs-invalid`);
    output.push(Object.freeze({ gapId, gapSignature, sourceQuestionRefs: Object.freeze(sourceQuestionRefs || []), firstSeenAtUtc, lastSeenAtUtc, occurrenceCount, distinctParticipantIds: Object.freeze(distinctParticipantIds || []), canonicalGoalRef, status, proofRefs: Object.freeze(proofRefs || []) }));
  }
  return output;
}

function qualifiedRoutes(candidates, affectedCapability, targetParticipantId) {
  const freshnessRank = { FRESH: 0, RECENT: 1, STALE: 2, UNKNOWN: 3 };
  return candidates
    .filter((candidate) => candidate.participantId !== targetParticipantId)
    .filter((candidate) => ['CAN_ASK_AND_ANSWER', 'CAN_ANSWER_STATUS_ONLY'].includes(candidate.qaCapability))
    .filter((candidate) => candidate.capabilities.includes(affectedCapability))
    .filter((candidate) => ['FRESH', 'RECENT'].includes(candidate.freshness))
    .sort((left, right) => freshnessRank[left.freshness] - freshnessRank[right.freshness]
      || compareText(left.participantId, right.participantId));
}

function rootCauseFor(answerVerdict, override) {
  const normalizedOverride = String(override || '').trim().toUpperCase();
  if (normalizedOverride) return ROOT_CAUSES.has(normalizedOverride) ? normalizedOverride : '';
  return DEFAULT_ROOT_CAUSE_BY_VERDICT[answerVerdict] || '';
}

function boundaryFor(answerVerdict, override) {
  const normalized = String(override || '').trim().toUpperCase();
  if (normalized) return BOUNDARIES.has(normalized) ? normalized : '';
  if (answerVerdict === 'EXTERNAL_UNBUILDABLE') return 'EXTERNAL_UNBUILDABLE';
  if (answerVerdict === 'INTENTIONALLY_UNSUPPORTED') return 'INTENTIONALLY_UNSUPPORTED';
  if (answerVerdict === 'UNSAFE_OR_AUTHORITY_BOUNDARY') return 'AUTHORITY_BOUNDARY';
  return '';
}

function canonicalSignature(rootCauseClass, question) {
  const payload = {
    rootCauseClass,
    affectedCapability: question.affectedCapability,
    expectedEvidenceClass: question.expectedEvidenceClass.toUpperCase(),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function goalMatchScore(goal, rootCauseClass, affectedCapability) {
  if (goal.state === 'COMPLETE') return 99;
  const root = goal.rootCauseClasses.includes(rootCauseClass);
  const capability = goal.capabilities.includes(affectedCapability);
  if (root && capability) return 0;
  if (root) return 1;
  if (capability) return 2;
  return 99;
}

function chooseGoal(goals, rootCauseClass, affectedCapability) {
  const ranked = goals
    .map((goal) => ({ goal, score: goalMatchScore(goal, rootCauseClass, affectedCapability) }))
    .filter((entry) => entry.score < 99)
    .sort((left, right) => left.score - right.score || compareText(left.goal.goalRef, right.goal.goalRef));
  if (!ranked.length) return Object.freeze({ state: 'NEW_CANONICAL_GAP_GOAL_REQUIRED', goalRef: '', candidates: Object.freeze([]) });
  const topScore = ranked[0].score;
  const top = ranked.filter((entry) => entry.score === topScore);
  if (top.length > 1) {
    return Object.freeze({ state: 'AMBIGUOUS_EXISTING_GOAL_OWNER', goalRef: '', candidates: Object.freeze(top.map((entry) => entry.goal.goalRef)) });
  }
  return Object.freeze({ state: 'ATTACH_TO_EXISTING_GOAL', goalRef: top[0].goal.goalRef, candidates: Object.freeze(ranked.map((entry) => entry.goal.goalRef)) });
}

function aggregateGap(existingGap, signature, rootCauseClass, question, answer, canonicalGoalRef) {
  const questionRef = `question://${question.questionId}`;
  const participantIds = new Set(existingGap?.distinctParticipantIds || []);
  participantIds.add(question.targetParticipantId);
  const sourceQuestionRefs = new Set(existingGap?.sourceQuestionRefs || []);
  sourceQuestionRefs.add(questionRef);
  const proofRefs = new Set(existingGap?.proofRefs || []);
  for (const ref of answer.evidenceRefs) proofRefs.add(ref);
  const firstSeenAtUtc = existingGap?.firstSeenAtUtc || question.createdAtUtc;
  const lastSeenAtUtc = answer.answeredAtUtc;
  const occurrenceCount = existingGap ? existingGap.occurrenceCount + 1 : 1;
  return Object.freeze({
    gapId: existingGap?.gapId || `ambient-gap-${signature.slice(0, 24)}`,
    gapSignature: signature,
    sourceQuestionRefs: Object.freeze([...sourceQuestionRefs].sort(compareText)),
    firstSeenAtUtc,
    lastSeenAtUtc,
    occurrenceCount,
    distinctParticipantIds: Object.freeze([...participantIds].sort(compareText)),
    rootCauseClass,
    affectedCapability: question.affectedCapability,
    affectedParticipants: Object.freeze([...participantIds].sort(compareText)),
    evidenceRefs: Object.freeze([...proofRefs].sort(compareText)),
    existingGoalCandidates: Object.freeze([]),
    canonicalGoalRef: existingGap?.canonicalGoalRef || canonicalGoalRef,
    status: existingGap?.status === 'FIXED' ? 'REOPENED' : (canonicalGoalRef ? 'MAPPED' : 'OBSERVED'),
    proofRefs: Object.freeze([...proofRefs].sort(compareText)),
  });
}

export function evaluateStephanosAmbientQuestionGapIntakeV1(input = {}) {
  const top = safePlainObject(input);
  if (!top) return invalid(['input:data-only-object-required']);
  const errors = [];
  const question = normalizeQuestion(ownData(top, 'question'), errors);
  const answer = normalizeAnswer(ownData(top, 'answer'), question, errors);
  const routingCandidates = normalizeRoutingCandidates(ownData(top, 'routingCandidates'), errors);
  const existingGoals = normalizeExistingGoals(ownData(top, 'existingGoals'), errors);
  const existingGaps = normalizeExistingGaps(ownData(top, 'existingGaps'), errors);
  const rootCauseOverride = ownData(top, 'rootCauseClass');
  const boundaryOverride = ownData(top, 'boundaryClass');
  if (errors.length) return invalid(errors, question || {});

  if (answer.epistemicState === 'UNSUPPORTED_BY_THIS_PARTICIPANT') {
    const routes = qualifiedRoutes(routingCandidates, question.affectedCapability, question.targetParticipantId);
    if (routes.length) {
      return Object.freeze({
        schemaVersion: STEPHANOS_AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION,
        state: 'OWNER_REROUTING',
        questionId: question.questionId,
        correlationId: question.correlationId,
        ownerRoutingDecision: Object.freeze({ state: 'REROUTE_REQUIRED', selectedParticipantId: routes[0].participantId, candidates: Object.freeze(routes.map((route) => route.participantId)) }),
        answerClassification: Object.freeze({ verdict: answer.answerVerdict, rootCauseClass: '', boundaryClass: '' }),
        gapObservation: null,
        canonicalGoalRef: '',
        goalDisposition: 'NO_GAP_WHILE_QUALIFIED_OWNER_EXISTS',
        schedulerCandidate: false,
        authority: AUTHORITY,
        valid: true,
        validationErrors: Object.freeze([]),
      });
    }
    return invalid(['owner-routing-exhaustion-not-proven'], question);
  }

  if (answer.answerVerdict === 'ANSWERED_GROUNDED') {
    return Object.freeze({
      schemaVersion: STEPHANOS_AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION,
      state: 'ANSWERED',
      questionId: question.questionId,
      correlationId: question.correlationId,
      ownerRoutingDecision: Object.freeze({ state: 'DIRECT_TARGET_ACCEPTED', selectedParticipantId: answer.responderParticipantId, candidates: Object.freeze([]) }),
      answerClassification: Object.freeze({ verdict: answer.answerVerdict, rootCauseClass: '', boundaryClass: '' }),
      gapObservation: null,
      canonicalGoalRef: '',
      goalDisposition: 'NO_GAP',
      schedulerCandidate: false,
      authority: AUTHORITY,
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  const boundaryClass = boundaryFor(answer.answerVerdict, boundaryOverride);
  if (['EXTERNAL_UNBUILDABLE', 'INTENTIONALLY_UNSUPPORTED', 'UNSAFE_OR_AUTHORITY_BOUNDARY'].includes(answer.answerVerdict)) {
    if (!boundaryClass) return invalid(['boundaryClass-invalid-or-missing'], question);
    return Object.freeze({
      schemaVersion: STEPHANOS_AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION,
      state: 'BOUNDARY_RETAINED',
      questionId: question.questionId,
      correlationId: question.correlationId,
      ownerRoutingDecision: Object.freeze({ state: 'DIRECT_TARGET_ACCEPTED', selectedParticipantId: answer.responderParticipantId, candidates: Object.freeze([]) }),
      answerClassification: Object.freeze({ verdict: answer.answerVerdict, rootCauseClass: '', boundaryClass }),
      gapObservation: null,
      canonicalGoalRef: '',
      goalDisposition: 'BOUNDARY_NOT_AUTO_BUILDABLE',
      schedulerCandidate: false,
      authority: AUTHORITY,
      valid: true,
      validationErrors: Object.freeze([]),
    });
  }

  const rootCauseClass = rootCauseFor(answer.answerVerdict, rootCauseOverride);
  if (answer.answerVerdict === 'ANSWERED_PARTIAL' && !rootCauseClass) {
    return invalid(['partial-answer-requires-explicit-buildable-root-cause'], question);
  }
  if (!BUILDABLE_VERDICTS.has(answer.answerVerdict) && answer.answerVerdict !== 'ANSWERED_PARTIAL') {
    return invalid(['answer-verdict-not-buildable'], question);
  }
  if (!rootCauseClass) return invalid(['rootCauseClass-invalid-or-missing'], question);

  const signature = canonicalSignature(rootCauseClass, question);
  const matchingGaps = existingGaps.filter((gap) => gap.gapSignature === signature);
  if (matchingGaps.length > 1) return invalid(['duplicate-canonical-gap-signature-detected'], question);
  const existingGap = matchingGaps[0] || null;

  let goalDecision;
  if (existingGap?.canonicalGoalRef) {
    goalDecision = Object.freeze({ state: 'ATTACH_TO_EXISTING_GOAL', goalRef: existingGap.canonicalGoalRef, candidates: Object.freeze([existingGap.canonicalGoalRef]) });
  } else {
    goalDecision = chooseGoal(existingGoals, rootCauseClass, question.affectedCapability);
  }
  if (goalDecision.state === 'AMBIGUOUS_EXISTING_GOAL_OWNER') {
    return Object.freeze({
      ...invalid(['ambiguous-existing-goal-owner'], question),
      ownerRoutingDecision: Object.freeze({ state: 'DIRECT_TARGET_ACCEPTED', selectedParticipantId: answer.responderParticipantId, candidates: Object.freeze([]) }),
      answerClassification: Object.freeze({ verdict: answer.answerVerdict, rootCauseClass, boundaryClass: '' }),
      goalDisposition: goalDecision.state,
    });
  }

  const gapObservation = aggregateGap(existingGap, signature, rootCauseClass, question, answer, goalDecision.goalRef);
  const enrichedGap = Object.freeze({
    ...gapObservation,
    existingGoalCandidates: goalDecision.candidates,
  });

  return Object.freeze({
    schemaVersion: STEPHANOS_AMBIENT_QUESTION_GAP_INTAKE_SCHEMA_VERSION,
    state: 'GAP_DEDUPLICATED',
    questionId: question.questionId,
    correlationId: question.correlationId,
    ownerRoutingDecision: Object.freeze({ state: 'DIRECT_TARGET_ACCEPTED', selectedParticipantId: answer.responderParticipantId, candidates: Object.freeze([]) }),
    answerClassification: Object.freeze({ verdict: answer.answerVerdict, rootCauseClass, boundaryClass: '' }),
    gapObservation: enrichedGap,
    canonicalGoalRef: goalDecision.goalRef,
    goalDisposition: goalDecision.state,
    schedulerCandidate: true,
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  });
}
