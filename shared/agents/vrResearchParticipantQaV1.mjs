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
const WORKSPACE_SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_FACT_COUNT = 64;
const MAX_FACT_ARRAY_LENGTH = 32;
const MAX_FACT_STRING_LENGTH = 2048;
const VR_FACT_ALLOWED_FIELDS = new Set([
  'sourceId', 'title', 'revision', 'health', 'licenceClass', 'priority',
  'id', 'name', 'status', 'state', 'type', 'category',
  'subjectRef', 'evidencePlane', 'claim', 'summary', 'owner',
  'nextAuthorisedAction', 'existingGoalCandidates',
  'hypothesis', 'relatedTechniques', 'requiredEvidence', 'evidenceRefs',
  'sourceRef', 'runtimeRef', 'providerId', 'version',
]);

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

function workspaceSafeId(value) {
  const normalized = text(value);
  if (WORKSPACE_SAFE_ID.test(normalized)) return normalized;
  return safeId(normalized) ? `vr-correlation-${hash(normalized).slice(0, 24)}` : '';
}

function projectionFreshness(projection = {}, nowMs = Date.now()) {
  const declared = text(projection.freshness).toUpperCase();
  if (declared !== 'FRESH') return declared === 'STALE' ? 'STALE' : 'UNKNOWN';
  if (!Number.isFinite(nowMs)) return 'UNKNOWN';
  const observed = Date.parse(text(projection.updatedAt));
  if (!Number.isFinite(observed) || observed > nowMs) return 'UNKNOWN';
  const staleAfterMs = Number.isFinite(projection.staleAfterMs) ? projection.staleAfterMs : 24 * 60 * 60 * 1000;
  return nowMs - observed > staleAfterMs ? 'STALE' : 'FRESH';
}

function sourceMatches(source, needle) {
  const target = text(needle).toLowerCase();
  if (!target) return false;
  return `${text(source?.sourceId)} ${text(source?.title)}`.toLowerCase().includes(target);
}

function canonicalProofRefs(value) {
  if (!Array.isArray(value)) return [];
  const refs = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return [];
    const ref = entry.trim();
    if (!ref || ref.includes('..') || !SAFE_PROOF_REF.test(ref)) return [];
    refs.push(ref);
  }
  return refs.length === new Set(refs).size ? refs : [];
}

function normalizeFactScalar(value) {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized && normalized.length <= MAX_FACT_STRING_LENGTH ? normalized : undefined;
  }
  return undefined;
}

function normalizeFactValue(value) {
  const scalar = normalizeFactScalar(value);
  if (scalar !== undefined) return scalar;
  if (!Array.isArray(value) || value.length > MAX_FACT_ARRAY_LENGTH) return undefined;
  const normalized = [];
  for (const item of value) {
    const itemValue = normalizeFactScalar(item);
    if (itemValue === undefined) return undefined;
    normalized.push(itemValue);
  }
  return Object.freeze(normalized);
}

function normalizeWorkspaceFacts(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const normalizedFacts = [];
  for (const rawFact of value.slice(0, MAX_FACT_COUNT)) {
    if (!rawFact || typeof rawFact !== 'object' || Array.isArray(rawFact) || Object.getPrototypeOf(rawFact) !== Object.prototype) continue;
    const normalizedFact = {};
    for (const [key, rawValue] of Object.entries(rawFact)) {
      if (!VR_FACT_ALLOWED_FIELDS.has(key)) continue;
      const normalizedValue = normalizeFactValue(rawValue);
      if (normalizedValue !== undefined) normalizedFact[key] = normalizedValue;
    }
    if (Object.keys(normalizedFact).length > 0) normalizedFacts.push(Object.freeze(normalizedFact));
  }
  return Object.freeze(normalizedFacts);
}

function canonicalProofValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const output = [];
    for (const item of value) {
      const normalized = canonicalProofValue(item, seen);
      if (normalized === undefined) { seen.delete(value); return undefined; }
      output.push(normalized);
    }
    seen.delete(value);
    return output;
  }
  if (!value || typeof value !== 'object') return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = {};
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) { seen.delete(value); return undefined; }
    const normalized = canonicalProofValue(descriptor.value, seen);
    if (normalized === undefined) { seen.delete(value); return undefined; }
    output[key] = normalized;
  }
  seen.delete(value);
  return output;
}

function projectionProofBinding(projection = {}) {
  if (projection?.schemaVersion !== VR_RESEARCH_WORKSPACE_SCHEMA_VERSION || !safeId(projection?.projectionId)) return null;
  const canonical = canonicalProofValue(projection);
  if (canonical === undefined) return null;
  return Object.freeze({
    schemaVersion: VR_RESEARCH_WORKSPACE_SCHEMA_VERSION,
    projectionId: projection.projectionId,
    projectionHash: `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`,
  });
}

function proofRefsVerified(refs, input = {}) {
  if (refs.length === 0 || typeof input.proofVerifier !== 'function') return false;
  try {
    return refs.every((ref) => input.proofVerifier(ref) === true);
  } catch {
    return false;
  }
}

function projectionProofRefsVerified(refs, projection, input = {}) {
  if (refs.length === 0 || typeof input.proofVerifier !== 'function') return false;
  const binding = projectionProofBinding(projection);
  if (!binding) return false;
  try {
    return refs.every((ref) => {
      const attestation = input.proofVerifier(ref, binding);
      return Boolean(
        attestation && typeof attestation === 'object' && !Array.isArray(attestation)
        && attestation.verified === true
        && attestation.proofRef === ref
        && attestation.schemaVersion === binding.schemaVersion
        && attestation.projectionId === binding.projectionId
        && attestation.projectionHash === binding.projectionHash
      );
    });
  } catch {
    return false;
  }
}

function answerEnvelope(request, projection, input, values = {}) {
  const freshness = projectionFreshness(projection, Number.isFinite(input.nowMs) ? input.nowMs : Date.now());
  const projectionEvidenceRefs = canonicalProofRefs(projection?.proofRefs);
  const requestedGrounded = values.grounded === true;
  const evidencePresent = projectionEvidenceRefs.length > 0;
  const evidenceVerified = evidencePresent && projectionProofRefsVerified(projectionEvidenceRefs, projection, input);
  const grounded = requestedGrounded && freshness === 'FRESH' && evidenceVerified;
  const evidenceGap = requestedGrounded && freshness === 'FRESH' && !grounded;
  const verdict = freshness !== 'FRESH' ? 'GAP_FRESHNESS' : grounded ? 'ANSWERED_GROUNDED' : values.verdict || 'GAP_KNOWLEDGE';
  const epistemicState = freshness === 'STALE' ? 'STALE' : freshness !== 'FRESH' ? 'UNKNOWN' : grounded ? values.epistemicState || 'KNOWN_FROM_CANONICAL_STATE' : values.epistemicState || 'UNKNOWN';
  const answerId = `vr-answer-${hash({ questionId: request.questionId, verdict, projectionId: projection.projectionId }).slice(0, 20)}`;
  const cannotAnswerReason = grounded ? null : text(values.cannotAnswerReason || (evidenceGap ? evidencePresent ? 'Canonical VR research projection proof references are not verified by the trusted proof authority.' : 'Canonical VR research projection does not carry proof references required to ground this answer.' : freshness !== 'FRESH' ? 'Canonical VR research projection is stale or missing trustworthy freshness evidence.' : 'Canonical VR research projection does not currently contain enough evidence for this question.'));
  return Object.freeze({
    schemaVersion: VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION,
    answerId,
    questionId: request.questionId,
    responderParticipantId: VR_RESEARCH_PARTICIPANT_ID,
    answerText: text(values.answerText || cannotAnswerReason),
    epistemicState,
    evidenceRefs: Object.freeze(grounded ? projectionEvidenceRefs : canonicalProofRefs(values.evidenceRefs)),
    freshness,
    cannotAnswerReason,
    answerVerdict: verdict,
    facts: normalizeWorkspaceFacts(values.facts),
    answeredAtUtc: text(input.answeredAtUtc || new Date(Number.isFinite(input.nowMs) ? input.nowMs : Date.now()).toISOString()),
  });
}

function normalizeRequest(request = {}) {
  return Object.freeze({ schemaVersion:text(request.schemaVersion), questionId:text(request.questionId), askerParticipantId:text(request.askerParticipantId), targetParticipantId:text(request.targetParticipantId), questionClass:text(request.questionClass).toUpperCase(), questionText:text(request.questionText), subjectRef:text(request.subjectRef), createdAtUtc:text(request.createdAtUtc) });
}

function validateRequest(request = {}) {
  const normalized = normalizeRequest(request);
  const errors = [];
  if (normalized.schemaVersion !== VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['questionId','askerParticipantId','targetParticipantId']) if (!safeId(normalized[field])) errors.push(`${field}-invalid`);
  if (normalized.targetParticipantId !== VR_RESEARCH_PARTICIPANT_ID) errors.push('target-participant-mismatch');
  if (!VR_RESEARCH_QUESTION_CLASSES.includes(normalized.questionClass)) errors.push('questionClass-invalid');
  if (!normalized.questionText) errors.push('questionText-required');
  if (!timestamp(normalized.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return Object.freeze({ valid:errors.length === 0, errors:Object.freeze(errors), normalized });
}

export function createVrResearchQuestion(input = {}) {
  return Object.freeze({ schemaVersion:VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION, questionId:text(input.questionId), askerParticipantId:text(input.askerParticipantId || 'chatgpt-bridge'), targetParticipantId:VR_RESEARCH_PARTICIPANT_ID, questionClass:text(input.questionClass).toUpperCase(), questionText:text(input.questionText), subjectRef:text(input.subjectRef), createdAtUtc:text(input.createdAtUtc) });
}

function sourceStackAnswer(request, projection, input) {
  const sources = list(projection?.sourceRegistry?.sources);
  if (sources.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason:'No canonical VR source records are present.' });
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`${sources.length} canonical VR research sources are currently projected.`, facts:sources.map((source) => ({ sourceId:source.sourceId, title:source.title, revision:source.revision, health:source.health, licenceClass:source.licenceClass })) });
}
function nextExperimentAnswer(request, projection, input) {
  const next = list(projection.researchQueue)[0] || list(projection.experiments).find((experiment) => !['validated','complete','retired'].includes(text(experiment?.status).toLowerCase()));
  if (!next) return answerEnvelope(request, projection, input, { cannotAnswerReason:'No active VR research experiment is present in canonical projection state.' });
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`The next projected VR research item is ${text(next.title || next.id)} with status ${text(next.status || 'unknown')}.`, facts:[{ id:next.id, title:next.title, status:next.status }] });
}
function evidencePlaneAnswer(request, projection, input) {
  const subject = text(request.subjectRef);
  const fact = list(projection.facts).find((candidate) => text(candidate?.subjectRef).toLowerCase() === subject.toLowerCase() && text(candidate?.evidencePlane));
  if (!fact) return answerEnvelope(request, projection, input, { cannotAnswerReason:`No canonical evidence-plane fact is recorded for ${subject || 'the requested subject'}.` });
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`${subject} is supported by ${fact.evidencePlane}.`, facts:[fact] });
}
function authoringVsRuntimeAnswer(request, projection, input) {
  const facts = list(projection.facts).filter((fact) => ['OFFICIAL_AUTHORING_EVIDENCE','OBSERVED_RUNTIME_OR_HEADSET_PROOF'].includes(text(fact?.evidencePlane)));
  if (facts.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason:'No separated authoring/runtime evidence facts are present.' });
  const authoring = facts.filter((fact) => fact.evidencePlane === 'OFFICIAL_AUTHORING_EVIDENCE');
  const runtime = facts.filter((fact) => fact.evidencePlane === 'OBSERVED_RUNTIME_OR_HEADSET_PROOF');
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`Canonical projection contains ${authoring.length} authoring fact(s) and ${runtime.length} observed runtime/headset fact(s); neither substitutes for the other.`, facts });
}
function namedSourceAnswer(request, projection, input, needle, label) {
  const source = list(projection?.sourceRegistry?.sources).find((candidate) => sourceMatches(candidate, needle));
  if (!source) return answerEnvelope(request, projection, input, { cannotAnswerReason:`${label} is not present in the canonical source projection.` });
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`${label} is registered as ${source.health}, revision ${source.revision}, with licence class ${source.licenceClass}.`, facts:[source] });
}
function licenceAnswer(request, projection, input) {
  const sources = list(projection?.sourceRegistry?.sources);
  if (sources.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason:'No source licence state is projected.' });
  const restricted = sources.filter((source) => source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY');
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`${restricted.length} of ${sources.length} projected sources are restricted or analysis-only and must not be treated as reusable implementation code.`, facts:restricted });
}
function spatialBlockerAnswer(request, projection, input) {
  const blockers = list(projection.blockers); const runtimeRequests = list(projection.runtimeEvidenceRequests);
  if (blockers.length === 0 && runtimeRequests.length === 0) return answerEnvelope(request, projection, input, { cannotAnswerReason:'Canonical projection does not currently state the evidence needed to explain Spatial Bridge blocking conditions.' });
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`${blockers.length} blocker(s) and ${runtimeRequests.length} outstanding runtime/headset evidence request(s) are currently projected before stronger Spatial Bridge claims can be made.`, facts:[...blockers,...runtimeRequests] });
}
function nextGoalAnswer(request, projection, input) {
  const action = text(projection.nextAuthorisedAction);
  if (!action) return answerEnvelope(request, projection, input, { cannotAnswerReason:'No next authorised VR action is projected.' });
  return answerEnvelope(request, projection, input, { grounded:true, epistemicState:'PROPOSED', answerText:action, facts:[{ nextAuthorisedAction:action, existingGoalCandidates:['#1594','#1596','#1597','#1605','#1723','#1760'] }] });
}
function unknownsAnswer(request, projection, input) {
  const unknowns = [...list(projection.blockers),...list(projection.runtimeEvidenceRequests),...list(projection.discoveryCandidates)];
  if (unknowns.length === 0) return answerEnvelope(request, projection, input, { grounded:true, answerText:'No explicit unknown, blocker, runtime evidence request or discovery candidate is currently projected.', facts:[] });
  return answerEnvelope(request, projection, input, { grounded:true, answerText:`${unknowns.length} explicit unresolved VR research item(s) are currently projected.`, facts:unknowns });
}

export function answerVrResearchQuestion(request = {}, projection = {}, input = {}) {
  const validation = validateRequest(request);
  if (!validation.valid) return Object.freeze({ valid:false, errors:validation.errors, answer:null, gapObservation:null });
  const normalizedRequest = validation.normalized;
  if (!projection || projection.schemaVersion !== VR_RESEARCH_WORKSPACE_SCHEMA_VERSION) {
    const answer = answerEnvelope(normalizedRequest, projection || {}, input, { cannotAnswerReason:'Canonical VR research workspace projection is missing or incompatible.' });
    return Object.freeze({ valid:true, errors:Object.freeze([]), answer, gapObservation:createVrResearchQaGapObservation(normalizedRequest, answer) });
  }
  const questionClass = normalizedRequest.questionClass;
  let answer;
  if (questionClass === 'SOURCE_STACK') answer = sourceStackAnswer(normalizedRequest, projection, input);
  else if (questionClass === 'NEXT_EXPERIMENT') answer = nextExperimentAnswer(normalizedRequest, projection, input);
  else if (questionClass === 'EVIDENCE_PLANE') answer = evidencePlaneAnswer(normalizedRequest, projection, input);
  else if (questionClass === 'AUTHORING_VS_RUNTIME') answer = authoringVsRuntimeAnswer(normalizedRequest, projection, input);
  else if (questionClass === 'VORPX_BASELINE') answer = namedSourceAnswer(normalizedRequest, projection, input, 'vorpx', 'vorpX baseline');
  else if (questionClass === 'SKYRIM_PARITY') answer = namedSourceAnswer(normalizedRequest, projection, input, 'skyrim', 'Skyrim VR parity source');
  else if (questionClass === 'LICENCE_BOUNDARIES') answer = licenceAnswer(normalizedRequest, projection, input);
  else if (questionClass === 'SPATIAL_BRIDGE_BLOCKERS') answer = spatialBlockerAnswer(normalizedRequest, projection, input);
  else if (questionClass === 'NEXT_BOUNDED_GOAL') answer = nextGoalAnswer(normalizedRequest, projection, input);
  else answer = unknownsAnswer(normalizedRequest, projection, input);
  const gapObservation = answer.answerVerdict.startsWith('GAP_') ? createVrResearchQaGapObservation(normalizedRequest, answer) : null;
  return Object.freeze({ valid:true, errors:Object.freeze([]), answer, gapObservation });
}

export function createVrResearchQaGapObservation(request = {}, answer = {}) {
  const questionClass = text(request.questionClass).toUpperCase();
  const gapId = `vr-qgap-${hash({ questionId:request.questionId, questionClass, verdict:answer.answerVerdict }).slice(0, 20)}`;
  const goalCandidatesByClass = { SOURCE_STACK:['#1596','#1597'], NEXT_EXPERIMENT:['#1593','#1597'], EVIDENCE_PLANE:['#1592','#1594','#1597'], AUTHORING_VS_RUNTIME:['#1594','#1595','#1611'], VORPX_BASELINE:['#1591','#1596'], SKYRIM_PARITY:['#1591','#1593'], LICENCE_BOUNDARIES:['#1592','#1596'], SPATIAL_BRIDGE_BLOCKERS:['#1605','#1723','#1760'], NEXT_BOUNDED_GOAL:['#1597','#1723'], KNOWN_UNKNOWNS:['#1597','#1723'] };
  return Object.freeze({ gapId, questionId:request.questionId, participantId:VR_RESEARCH_PARTICIPANT_ID, gapClass:answer.answerVerdict, summary:answer.cannotAnswerReason, evidenceRefs:answer.evidenceRefs, existingGoalCandidates:Object.freeze(goalCandidatesByClass[questionClass] || ['#1597','#1723']), repairGoalRef:null, status:'OBSERVED_NEEDS_DEDUPLICATION' });
}

function normalizeWorkspaceAnswer(answer = {}) {
  return Object.freeze({ schemaVersion:text(answer.schemaVersion), answerId:text(answer.answerId), questionId:text(answer.questionId), responderParticipantId:text(answer.responderParticipantId), answerText:text(answer.answerText), epistemicState:text(answer.epistemicState), evidenceRefs:Object.freeze(canonicalProofRefs(answer.evidenceRefs)), freshness:text(answer.freshness), cannotAnswerReason:answer.cannotAnswerReason === null ? null : text(answer.cannotAnswerReason), answerVerdict:text(answer.answerVerdict), facts:normalizeWorkspaceFacts(answer.facts), answeredAtUtc:text(answer.answeredAtUtc) });
}
function validateWorkspaceAnswerForRequest(answer, request) {
  const errors = [];
  if (answer.schemaVersion !== VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION) errors.push('answer-schema-version-mismatch');
  if (!safeId(answer.answerId)) errors.push('answerId-invalid');
  if (!safeId(answer.questionId)) errors.push('answer-questionId-invalid');
  if (answer.questionId !== request.questionId) errors.push('answer-questionId-mismatch');
  if (answer.responderParticipantId !== VR_RESEARCH_PARTICIPANT_ID) errors.push('answer-responder-mismatch');
  if (!timestamp(answer.answeredAtUtc)) errors.push('answer-answeredAtUtc-invalid');
  if (!text(answer.answerVerdict)) errors.push('answer-verdict-required');
  if (!text(answer.freshness)) errors.push('answer-freshness-required');
  return Object.freeze({ valid:errors.length === 0, errors:Object.freeze(errors) });
}

export function createVrResearchQaWorkspaceAnswerRecord(request = {}, answer = {}, input = {}) {
  const requestValidation = validateRequest(request);
  const normalizedRequest = requestValidation.normalized;
  const normalizedAnswer = normalizeWorkspaceAnswer(answer);
  const answerValidation = validateWorkspaceAnswerForRequest(normalizedAnswer, normalizedRequest);
  const messageId = `vr-qa-${hash({ questionId:normalizedRequest.questionId, answerId:normalizedAnswer.answerId }).slice(0, 20)}`;
  const answerProofRefs = canonicalProofRefs(normalizedAnswer.evidenceRefs);
  const suppliedProofRefs = canonicalProofRefs(input.proofRefs);
  const candidateProofRefs = answerProofRefs.length > 0 ? answerProofRefs : suppliedProofRefs;
  const proofRefs = requestValidation.valid && answerValidation.valid && proofRefsVerified(candidateProofRefs, input) ? candidateProofRefs : [];
  const record = Object.freeze({ schemaVersion:SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, kind:SHARED_WORKSPACE_RECORD_KINDS.MESSAGE, messageId, participantId:VR_RESEARCH_PARTICIPANT_ID, recipientParticipantId:normalizedRequest.askerParticipantId, timestampUtc:normalizedAnswer.answeredAtUtc, correlationId:workspaceSafeId(input.correlationId || normalizedRequest.questionId), relatedIssue:'#1723', proofRefs, channel:'vr-research-qa', recordSubtype:'conversation-answer', subjectId:normalizedRequest.questionId, summary:`VR research answer ${normalizedRequest.questionId}: ${normalizedAnswer.answerVerdict}`, body:JSON.stringify({ request:normalizedRequest, answer:normalizedAnswer }), sourceMutationAllowed:false, commandExecutionAllowed:false, mergeAllowed:false, deploymentAllowed:false });
  return Object.freeze({ record, answerValidation, validation:validateSharedWorkspaceRecord(record, input.validationOptions) });
}
