import { createHash } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  VR_RESEARCH_WORKSPACE_SCHEMA_VERSION,
} from './vrResearchWorkspaceProjectionV1.mjs';

export const VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION = 'stephanos.vr-research-participant-qa.v1';
export const VR_RESEARCH_PARTICIPANT_ID = 'stephanos-vr-research';
export const VR_RESEARCH_QA_CAPABILITY = 'CAN_ASK_AND_ANSWER';

export const VR_RESEARCH_QUESTION_CLASSES = Object.freeze([
  'SOURCE_STACK',
  'NEXT_EXPERIMENT',
  'EVIDENCE_PLANE',
  'AUTHORING_VS_RUNTIME',
  'VORPX_BASELINE',
  'SKYRIM_PARITY',
  'LICENCE_BOUNDARIES',
  'SPATIAL_BRIDGE_BLOCKERS',
  'NEXT_BOUNDED_GOAL',
  'KNOWN_UNKNOWNS',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function timestamp(value) {
  const candidate = text(value);
  const parsed = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function projectionFreshness(projection = {}, nowMs = Date.now()) {
  if (text(projection.freshness).toUpperCase() === 'STALE') return 'STALE';
  const observed = Date.parse(text(projection.updatedAt));
  if (!Number.isFinite(observed)) return 'UNKNOWN';
  const staleAfterMs = Number.isFinite(projection.staleAfterMs) ? projection.staleAfterMs : 24 * 60 * 60 * 1000;
  return nowMs - observed > staleAfterMs ? 'STALE' : 'FRESH';
}

function sourceMatches(source, needle) {
  const target = text(needle).toLowerCase();
  if (!target) return false;
  return `${text(source?.sourceId)} ${text(source?.title)}`.toLowerCase().includes(target);
}

function evidenceRefs(projection = {}) {
  const refs = list(projection.proofRefs).map(String).filter(Boolean);
  if (refs.length > 0) return refs;
  return projection.projectionId ? [`evidence/receipts/${projection.projectionId}`] : [];
}

function answerEnvelope(request, projection, input, values = {}) {
  const freshness = projectionFreshness(projection, Number.isFinite(input.nowMs) ? input.nowMs : Date.now());
  const grounded = values.grounded === true && freshness === 'FRESH';
  const verdict = freshness !== 'FRESH'
    ? 'GAP_FRESHNESS'
    : grounded
      ? 'ANSWERED_GROUNDED'
      : values.verdict || 'GAP_KNOWLEDGE';
  const epistemicState = freshness !== 'FRESH'
    ? 'STALE'
    : grounded
      ? values.epistemicState || 'KNOWN_FROM_CANONICAL_STATE'
      : values.epistemicState || 'UNKNOWN';
  const answerId = `vr-answer-${hash({ questionId: request.questionId, verdict, projectionId: projection.projectionId }).slice(0, 20)}`;
  const cannotAnswerReason = grounded ? null : text(values.cannotAnswerReason || (freshness !== 'FRESH' ? 'Canonical VR research projection is stale or missing freshness evidence.' : 'Canonical VR research projection does not currently contain enough evidence for this question.'));
  return Object.freeze({
    schemaVersion: VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION,
    answerId,
    questionId: request.questionId,
    responderParticipantId: VR_RESEARCH_PARTICIPANT_ID,
    answerText: text(values.answerText || cannotAnswerReason),
    epistemicState,
    evidenceRefs: Object.freeze(grounded ? evidenceRefs(projection) : list(values.evidenceRefs).map(String).filter(Boolean)),
    freshness,
    cannotAnswerReason,
    answerVerdict: verdict,
    facts: Object.freeze(list(values.facts)),
    answeredAtUtc: text(input.answeredAtUtc || new Date(Number.isFinite(input.nowMs) ? input.nowMs : Date.now()).toISOString()),
  });
}

function validateRequest(request = {}) {
  const errors = [];
  if (request.schemaVersion !== VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['questionId', 'askerParticipantId', 'targetParticipantId']) if (!safeId(request[field])) errors.push(`${field}-invalid`);
  if (request.targetParticipantId !== VR_RESEARCH_PARTICIPANT_ID) errors.push('target-participant-mismatch');
  if (!VR_RESEARCH_QUESTION_CLASSES.includes(text(request.questionClass).toUpperCase())) errors.push('questionClass-invalid');
  if (!text(request.questionText)) errors.push('questionText-required');
  if (!timestamp(request.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createVrResearchQuestion(input = {}) {
  return Object.freeze({
    schemaVersion: VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION,
    questionId: text(input.questionId),
    askerParticipantId: text(input.askerParticipantId || 'chatgpt-bridge'),
    targetParticipantId: VR_RESEARCH_PARTICIPANT_ID,
    questionClass: text(input.questionClass).toUpperCase(),
    questionText: text(input.questionText),
    subjectRef: text(input.subjectRef),
    createdAtUtc: text(input.createdAtUtc),
  });
}

function sourceStackAnswer(request, projection, input) {
  const sources = list(projection?.sourceRegistry?.sources);
  if (sources.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No canonical VR source records are present.' });
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${sources.length} canonical VR research sources are currently projected.`,
    facts: sources.map((source) => ({ sourceId: source.sourceId, title: source.title, revision: source.revision, health: source.health, licenceClass: source.licenceClass })),
  });
}

function nextExperimentAnswer(request, projection, input) {
  const next = list(projection.researchQueue)[0] || list(projection.experiments).find((experiment) => !['validated', 'complete', 'retired'].includes(text(experiment?.status).toLowerCase()));
  if (!next) return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No active VR research experiment is present in canonical projection state.' });
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `The next projected VR research item is ${text(next.title || next.id)} with status ${text(next.status || 'unknown')}.`,
    facts: [{ id: next.id, title: next.title, status: next.status }],
  });
}

function evidencePlaneAnswer(request, projection, input) {
  const subject = text(request.subjectRef);
  const fact = list(projection.facts).find((candidate) => text(candidate?.subjectRef).toLowerCase() === subject.toLowerCase() && text(candidate?.evidencePlane));
  if (!fact) return answerEnvelope(request, projection, input, { cannotAnswerReason: `No canonical evidence-plane fact is recorded for ${subject || 'the requested subject'}.` });
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${subject} is supported by ${fact.evidencePlane}.`,
    facts: [fact],
  });
}

function authoringVsRuntimeAnswer(request, projection, input) {
  const facts = list(projection.facts).filter((fact) => ['OFFICIAL_AUTHORING_EVIDENCE', 'OBSERVED_RUNTIME_OR_HEADSET_PROOF'].includes(text(fact?.evidencePlane)));
  if (facts.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No separated authoring/runtime evidence facts are present.' });
  const authoring = facts.filter((fact) => fact.evidencePlane === 'OFFICIAL_AUTHORING_EVIDENCE');
  const runtime = facts.filter((fact) => fact.evidencePlane === 'OBSERVED_RUNTIME_OR_HEADSET_PROOF');
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `Canonical projection contains ${authoring.length} authoring fact(s) and ${runtime.length} observed runtime/headset fact(s); neither substitutes for the other.`,
    facts,
  });
}

function namedSourceAnswer(request, projection, input, needle, label) {
  const source = list(projection?.sourceRegistry?.sources).find((candidate) => sourceMatches(candidate, needle));
  if (!source) return answerEnvelope(request, projection, input, { cannotAnswerReason: `${label} is not present in the canonical source projection.` });
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${label} is registered as ${source.health}, revision ${source.revision}, with licence class ${source.licenceClass}.`,
    facts: [source],
  });
}

function licenceAnswer(request, projection, input) {
  const sources = list(projection?.sourceRegistry?.sources);
  if (sources.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No source licence state is projected.' });
  const restricted = sources.filter((source) => source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY');
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${restricted.length} of ${sources.length} projected sources are restricted or analysis-only and must not be treated as reusable implementation code.`,
    facts: restricted,
  });
}

function spatialBlockerAnswer(request, projection, input) {
  const blockers = list(projection.blockers);
  const runtimeRequests = list(projection.runtimeEvidenceRequests);
  if (blockers.length === 0 && runtimeRequests.length === 0) {
    return answerEnvelope(request, projection, input, { cannotAnswerReason: 'Canonical projection does not currently state the evidence needed to explain Spatial Bridge blocking conditions.' });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${blockers.length} blocker(s) and ${runtimeRequests.length} outstanding runtime/headset evidence request(s) are currently projected before stronger Spatial Bridge claims can be made.`,
    facts: [...blockers, ...runtimeRequests],
  });
}

function nextGoalAnswer(request, projection, input) {
  const action = text(projection.nextAuthorisedAction);
  if (!action) return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No next authorised VR action is projected.' });
  return answerEnvelope(request, projection, input, {
    grounded: true,
    epistemicState: 'PROPOSED',
    answerText: action,
    facts: [{ nextAuthorisedAction: action, existingGoalCandidates: ['#1594', '#1596', '#1597', '#1605', '#1723', '#1760'] }],
  });
}

function unknownsAnswer(request, projection, input) {
  const blockers = list(projection.blockers);
  const runtimeRequests = list(projection.runtimeEvidenceRequests);
  const discovery = list(projection.discoveryCandidates);
  const unknowns = [...blockers, ...runtimeRequests, ...discovery];
  if (unknowns.length === 0) return answerEnvelope(request, projection, input, { grounded: true, answerText: 'No explicit unknown, blocker, runtime evidence request or discovery candidate is currently projected.', facts: [] });
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${unknowns.length} explicit unresolved VR research item(s) are currently projected.`,
    facts: unknowns,
  });
}

export function answerVrResearchQuestion(request = {}, projection = {}, input = {}) {
  const validation = validateRequest(request);
  if (!validation.valid) return Object.freeze({ valid: false, errors: validation.errors, answer: null, gapObservation: null });
  if (!projection || projection.schemaVersion !== VR_RESEARCH_WORKSPACE_SCHEMA_VERSION) {
    const answer = answerEnvelope(request, projection || {}, input, { cannotAnswerReason: 'Canonical VR research workspace projection is missing or incompatible.' });
    return Object.freeze({ valid: true, errors: Object.freeze([]), answer, gapObservation: createVrResearchQaGapObservation(request, answer) });
  }
  const questionClass = request.questionClass;
  let answer;
  if (questionClass === 'SOURCE_STACK') answer = sourceStackAnswer(request, projection, input);
  else if (questionClass === 'NEXT_EXPERIMENT') answer = nextExperimentAnswer(request, projection, input);
  else if (questionClass === 'EVIDENCE_PLANE') answer = evidencePlaneAnswer(request, projection, input);
  else if (questionClass === 'AUTHORING_VS_RUNTIME') answer = authoringVsRuntimeAnswer(request, projection, input);
  else if (questionClass === 'VORPX_BASELINE') answer = namedSourceAnswer(request, projection, input, 'vorpx', 'vorpX baseline');
  else if (questionClass === 'SKYRIM_PARITY') answer = namedSourceAnswer(request, projection, input, 'skyrim', 'Skyrim VR parity source');
  else if (questionClass === 'LICENCE_BOUNDARIES') answer = licenceAnswer(request, projection, input);
  else if (questionClass === 'SPATIAL_BRIDGE_BLOCKERS') answer = spatialBlockerAnswer(request, projection, input);
  else if (questionClass === 'NEXT_BOUNDED_GOAL') answer = nextGoalAnswer(request, projection, input);
  else answer = unknownsAnswer(request, projection, input);
  const gapObservation = answer.answerVerdict.startsWith('GAP_') ? createVrResearchQaGapObservation(request, answer) : null;
  return Object.freeze({ valid: true, errors: Object.freeze([]), answer, gapObservation });
}

export function createVrResearchQaGapObservation(request = {}, answer = {}) {
  const gapId = `vr-qgap-${hash({ questionId: request.questionId, questionClass: request.questionClass, verdict: answer.answerVerdict }).slice(0, 20)}`;
  const goalCandidatesByClass = {
    SOURCE_STACK: ['#1596', '#1597'],
    NEXT_EXPERIMENT: ['#1593', '#1597'],
    EVIDENCE_PLANE: ['#1592', '#1594', '#1597'],
    AUTHORING_VS_RUNTIME: ['#1594', '#1595', '#1611'],
    VORPX_BASELINE: ['#1591', '#1596'],
    SKYRIM_PARITY: ['#1591', '#1593'],
    LICENCE_BOUNDARIES: ['#1592', '#1596'],
    SPATIAL_BRIDGE_BLOCKERS: ['#1605', '#1723', '#1760'],
    NEXT_BOUNDED_GOAL: ['#1597', '#1723'],
    KNOWN_UNKNOWNS: ['#1597', '#1723'],
  };
  return Object.freeze({
    gapId,
    questionId: request.questionId,
    participantId: VR_RESEARCH_PARTICIPANT_ID,
    gapClass: answer.answerVerdict,
    summary: answer.cannotAnswerReason,
    evidenceRefs: answer.evidenceRefs,
    existingGoalCandidates: Object.freeze(goalCandidatesByClass[request.questionClass] || ['#1597', '#1723']),
    repairGoalRef: null,
    status: 'OBSERVED_NEEDS_DEDUPLICATION',
  });
}

export function createVrResearchQaWorkspaceAnswerRecord(request = {}, answer = {}, input = {}) {
  const messageId = `vr-qa-${hash({ questionId: request.questionId, answerId: answer.answerId }).slice(0, 20)}`;
  const proofRefs = answer.evidenceRefs.length > 0 ? [...answer.evidenceRefs] : [`receipts/${messageId}`];
  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId,
    participantId: VR_RESEARCH_PARTICIPANT_ID,
    recipientParticipantId: request.askerParticipantId,
    timestampUtc: answer.answeredAtUtc,
    correlationId: safeId(input.correlationId || request.questionId),
    relatedIssue: '#1723',
    proofRefs,
    channel: 'vr-research-qa',
    recordSubtype: 'conversation-answer',
    subjectId: request.questionId,
    summary: `VR research answer ${request.questionId}: ${answer.answerVerdict}`,
    body: JSON.stringify({ request, answer }),
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
  });
  return Object.freeze({ record, validation: validateSharedWorkspaceRecord(record, input.validationOptions) });
}
