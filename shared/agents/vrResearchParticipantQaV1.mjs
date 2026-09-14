import { createHash } from 'node:crypto';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import { VR_RESEARCH_WORKSPACE_SCHEMA_VERSION } from './vrResearchWorkspaceProjectionV1.mjs';

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
const VR_PROJECTION_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_FACT_COUNT = 64;
const MAX_FACT_ARRAY_LENGTH = 32;
const MAX_FACT_STRING_LENGTH = 2048;
const MAX_CANONICAL_ARRAY_LENGTH = 4096;
const MAX_CANONICAL_OBJECT_KEYS = 256;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_NODES = 8192;
const MAX_CANONICAL_STRING_LENGTH = 16_384;
const MAX_DATE_MS = 8_640_000_000_000_000;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const WORKSPACE_ANSWER_VERDICTS = new Set([
  'ANSWERED_GROUNDED',
  'GAP_KNOWLEDGE',
  'GAP_FRESHNESS',
]);
const WORKSPACE_ANSWER_FRESHNESS_STATES = new Set(['FRESH', 'STALE', 'UNKNOWN']);
const WORKSPACE_ANSWER_EPISTEMIC_STATES = new Set([
  'KNOWN_FROM_CANONICAL_STATE',
  'PROPOSED',
  'UNKNOWN',
  'STALE',
]);
const GROUNDED_EPISTEMIC_STATES = new Set(['KNOWN_FROM_CANONICAL_STATE', 'PROPOSED']);
const VR_FACT_ALLOWED_FIELDS = new Set([
  'sourceId',
  'title',
  'revision',
  'health',
  'licenceClass',
  'priority',
  'id',
  'name',
  'status',
  'state',
  'type',
  'category',
  'subjectRef',
  'evidencePlane',
  'claim',
  'summary',
  'owner',
  'nextAuthorisedAction',
  'existingGoalCandidates',
  'hypothesis',
  'relatedTechniques',
  'requiredEvidence',
  'evidenceRefs',
  'sourceRef',
  'runtimeRef',
  'providerId',
  'version',
]);

const INVALID_CANONICAL_VALUE = Symbol('invalid-canonical-value');

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

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

function readOwnData(input, key) {
  if (!input || (typeof input !== 'object' && typeof input !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return undefined;
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function canonicalEvaluationTime(input) {
  const candidate = readOwnData(input, 'nowMs');
  const fallback = Date.now();
  const nowMs = typeof candidate === 'number'
    && Number.isFinite(candidate)
    && Math.abs(candidate) <= MAX_DATE_MS
    ? candidate
    : fallback;
  try {
    return Object.freeze({ nowMs, answeredAtUtc: new Date(nowMs).toISOString() });
  } catch {
    const safeNowMs = Date.now();
    return Object.freeze({ nowMs: safeNowMs, answeredAtUtc: new Date(safeNowMs).toISOString() });
  }
}

function evaluationNowMs(input) {
  return canonicalEvaluationTime(input).nowMs;
}

function projectionFreshness(projection = {}, nowMs = Date.now()) {
  const declared = text(projection.freshness).toUpperCase();
  if (declared !== 'FRESH') return declared === 'STALE' ? 'STALE' : 'UNKNOWN';
  if (!Number.isFinite(nowMs)) return 'UNKNOWN';
  const observed = Date.parse(text(projection.updatedAt));
  if (!Number.isFinite(observed) || observed > nowMs) return 'UNKNOWN';
  const staleAfterMs = Number.isFinite(projection.staleAfterMs)
    ? projection.staleAfterMs
    : 24 * 60 * 60 * 1000;
  return nowMs - observed > staleAfterMs ? 'STALE' : 'FRESH';
}

function sourceMatches(source, needle) {
  const target = text(needle).toLowerCase();
  if (!target) return false;
  return `${text(source?.sourceId)} ${text(source?.title)}`.toLowerCase().includes(target);
}

function canonicalDataOnly(value, state = null, depth = 0) {
  const traversal = state || { seen: new Set(), nodes: 0 };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length <= MAX_CANONICAL_STRING_LENGTH ? value : INVALID_CANONICAL_VALUE;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_CANONICAL_VALUE;
  if (!value || typeof value !== 'object' || depth > MAX_CANONICAL_DEPTH) return INVALID_CANONICAL_VALUE;

  traversal.nodes += 1;
  if (traversal.nodes > MAX_CANONICAL_NODES || traversal.seen.has(value)) return INVALID_CANONICAL_VALUE;

  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      return INVALID_CANONICAL_VALUE;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => typeof key !== 'string')) return INVALID_CANONICAL_VALUE;

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
          || length > MAX_CANONICAL_ARRAY_LENGTH) return INVALID_CANONICAL_VALUE;

        const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
        if (descriptorKeys.some((key) => !expectedKeys.has(key))) return INVALID_CANONICAL_VALUE;

        const output = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor
            || !descriptor.enumerable
            || !Object.hasOwn(descriptor, 'value')
            || descriptor.get
            || descriptor.set) return INVALID_CANONICAL_VALUE;
          const normalized = canonicalDataOnly(descriptor.value, traversal, depth + 1);
          if (normalized === INVALID_CANONICAL_VALUE) return INVALID_CANONICAL_VALUE;
          output.push(normalized);
        }
        return Object.freeze(output);
      }

      if (descriptorKeys.length > MAX_CANONICAL_OBJECT_KEYS) return INVALID_CANONICAL_VALUE;
      const output = Object.create(null);
      for (const key of descriptorKeys.sort(compareCodePoints)) {
        if (RESERVED_OBJECT_KEYS.has(key)) return INVALID_CANONICAL_VALUE;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.get
          || descriptor.set) return INVALID_CANONICAL_VALUE;
        const normalized = canonicalDataOnly(descriptor.value, traversal, depth + 1);
        if (normalized === INVALID_CANONICAL_VALUE) return INVALID_CANONICAL_VALUE;
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
    return INVALID_CANONICAL_VALUE;
  }
}

function canonicalProofRefs(value) {
  const canonical = canonicalDataOnly(value);
  if (canonical === INVALID_CANONICAL_VALUE || !Array.isArray(canonical)) return [];
  const refs = [];
  for (const entry of canonical) {
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
  const canonical = canonicalDataOnly(value);
  if (canonical === INVALID_CANONICAL_VALUE || !Array.isArray(canonical)) return Object.freeze([]);
  const normalizedFacts = [];
  for (const rawFact of canonical.slice(0, MAX_FACT_COUNT)) {
    if (!rawFact || typeof rawFact !== 'object' || Array.isArray(rawFact)) continue;
    const normalizedFact = {};
    for (const key of Object.keys(rawFact).sort(compareCodePoints)) {
      if (!VR_FACT_ALLOWED_FIELDS.has(key)) continue;
      const normalizedValue = normalizeFactValue(rawFact[key]);
      if (normalizedValue !== undefined) {
        Object.defineProperty(normalizedFact, key, {
          value: normalizedValue,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
    }
    if (Object.keys(normalizedFact).length > 0) normalizedFacts.push(Object.freeze(normalizedFact));
  }
  return Object.freeze(normalizedFacts);
}

function canonicalProjectionSnapshot(projection) {
  const canonical = canonicalDataOnly(projection);
  if (canonical === INVALID_CANONICAL_VALUE
    || !canonical
    || typeof canonical !== 'object'
    || Array.isArray(canonical)) return null;
  const projectionId = text(canonical.projectionId);
  if (canonical.schemaVersion !== VR_RESEARCH_WORKSPACE_SCHEMA_VERSION
    || !VR_PROJECTION_ID.test(projectionId)) return null;
  return canonical;
}

function projectionProofBinding(projection = {}) {
  const canonical = canonicalProjectionSnapshot(projection);
  if (!canonical) return null;
  const projectionId = text(canonical.projectionId);
  return Object.freeze({
    schemaVersion: VR_RESEARCH_WORKSPACE_SCHEMA_VERSION,
    projectionId,
    projectionHash: `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`,
  });
}

function exactAttestationKeys(attestation, binding) {
  const expected = ['verified', 'proofRef', ...Object.keys(binding)].sort(compareCodePoints);
  return JSON.stringify(Object.keys(attestation).sort(compareCodePoints)) === JSON.stringify(expected);
}

function verifyBoundProofRefs(refs, binding, input = {}) {
  const proofVerifier = readOwnData(input, 'proofVerifier');
  if (refs.length === 0 || !binding || typeof proofVerifier !== 'function') return false;
  try {
    return refs.every((ref) => {
      const supplied = proofVerifier(ref, binding);
      const attestation = canonicalDataOnly(supplied);
      if (attestation === INVALID_CANONICAL_VALUE
        || !attestation
        || typeof attestation !== 'object'
        || Array.isArray(attestation)
        || !exactAttestationKeys(attestation, binding)) return false;
      return attestation.verified === true
        && attestation.proofRef === ref
        && Object.keys(binding).every((key) => attestation[key] === binding[key]);
    });
  } catch {
    return false;
  }
}

function projectionProofRefsVerified(refs, projection, input = {}) {
  return verifyBoundProofRefs(refs, projectionProofBinding(projection), input);
}

function answerEnvelope(request, projection, input, values = {}) {
  const evaluationTime = canonicalEvaluationTime(input);
  const nowMs = evaluationTime.nowMs;
  const freshness = projectionFreshness(projection, nowMs);
  const projectionEvidenceRefs = canonicalProofRefs(projection?.proofRefs);
  const requestedGrounded = values.grounded === true;
  const evidencePresent = projectionEvidenceRefs.length > 0;
  const evidenceVerified = evidencePresent && projectionProofRefsVerified(projectionEvidenceRefs, projection, input);
  const grounded = requestedGrounded && freshness === 'FRESH' && evidenceVerified;
  const evidenceGap = requestedGrounded && freshness === 'FRESH' && !grounded;
  const verdict = freshness !== 'FRESH'
    ? 'GAP_FRESHNESS'
    : grounded
      ? 'ANSWERED_GROUNDED'
      : values.verdict || 'GAP_KNOWLEDGE';
  const epistemicState = freshness === 'STALE'
    ? 'STALE'
    : freshness !== 'FRESH'
      ? 'UNKNOWN'
      : grounded
        ? values.epistemicState || 'KNOWN_FROM_CANONICAL_STATE'
        : values.epistemicState || 'UNKNOWN';
  const answerId = `vr-answer-${hash({
    questionId: request.questionId,
    verdict,
    projectionId: projection.projectionId,
  }).slice(0, 20)}`;
  const cannotAnswerReason = grounded
    ? null
    : text(values.cannotAnswerReason || (evidenceGap
      ? evidencePresent
        ? 'Canonical VR research projection proof references are not verified by the trusted proof authority.'
        : 'Canonical VR research projection does not carry proof references required to ground this answer.'
      : freshness !== 'FRESH'
        ? 'Canonical VR research projection is stale or missing trustworthy freshness evidence.'
        : 'Canonical VR research projection does not currently contain enough evidence for this question.'));
  const answeredAtCandidate = readOwnData(input, 'answeredAtUtc');
  const answeredAtUtc = timestamp(answeredAtCandidate)
    && Date.parse(answeredAtCandidate) === nowMs
    ? answeredAtCandidate
    : evaluationTime.answeredAtUtc;
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
    answeredAtUtc,
  });
}

function normalizedRecord(input) {
  const canonical = canonicalDataOnly(input);
  return canonical === INVALID_CANONICAL_VALUE
    || !canonical
    || typeof canonical !== 'object'
    || Array.isArray(canonical)
    ? null
    : canonical;
}

function normalizeRequest(request = {}) {
  const canonical = normalizedRecord(request) || Object.create(null);
  return Object.freeze({
    schemaVersion: text(canonical.schemaVersion),
    questionId: text(canonical.questionId),
    askerParticipantId: text(canonical.askerParticipantId),
    targetParticipantId: text(canonical.targetParticipantId),
    questionClass: text(canonical.questionClass).toUpperCase(),
    questionText: text(canonical.questionText),
    subjectRef: text(canonical.subjectRef),
    createdAtUtc: text(canonical.createdAtUtc),
  });
}

function validateRequest(request = {}) {
  const canonical = normalizedRecord(request);
  const normalized = normalizeRequest(canonical || {});
  const errors = [];
  if (!canonical) errors.push('request-must-be-data-only');
  if (normalized.schemaVersion !== VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  for (const field of ['questionId', 'askerParticipantId', 'targetParticipantId']) {
    if (!safeId(normalized[field])) errors.push(`${field}-invalid`);
  }
  if (normalized.targetParticipantId !== VR_RESEARCH_PARTICIPANT_ID) errors.push('target-participant-mismatch');
  if (!VR_RESEARCH_QUESTION_CLASSES.includes(normalized.questionClass)) errors.push('questionClass-invalid');
  if (!normalized.questionText) errors.push('questionText-required');
  if (!timestamp(normalized.createdAtUtc)) errors.push('createdAtUtc-invalid');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), normalized });
}

export function createVrResearchQuestion(input = {}) {
  const canonical = normalizedRecord(input) || Object.create(null);
  return Object.freeze({
    schemaVersion: VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION,
    questionId: text(canonical.questionId),
    askerParticipantId: text(canonical.askerParticipantId || 'chatgpt-bridge'),
    targetParticipantId: VR_RESEARCH_PARTICIPANT_ID,
    questionClass: text(canonical.questionClass).toUpperCase(),
    questionText: text(canonical.questionText),
    subjectRef: text(canonical.subjectRef),
    createdAtUtc: text(canonical.createdAtUtc),
  });
}

function sourceStackAnswer(request, projection, input) {
  const sources = list(projection?.sourceRegistry?.sources);
  if (sources.length === 0) {
    return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No canonical VR source records are present.' });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${sources.length} canonical VR research sources are currently projected.`,
    facts: sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      revision: source.revision,
      health: source.health,
      licenceClass: source.licenceClass,
    })),
  });
}

function nextExperimentAnswer(request, projection, input) {
  const next = list(projection.researchQueue)[0]
    || list(projection.experiments).find((experiment) => !['validated', 'complete', 'retired'].includes(text(experiment?.status).toLowerCase()));
  if (!next) {
    return answerEnvelope(request, projection, input, {
      cannotAnswerReason: 'No active VR research experiment is present in canonical projection state.',
    });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `The next projected VR research item is ${text(next.title || next.id)} with status ${text(next.status || 'unknown')}.`,
    facts: [{ id: next.id, title: next.title, status: next.status }],
  });
}

function evidencePlaneAnswer(request, projection, input) {
  const subject = text(request.subjectRef);
  const fact = list(projection.facts).find((candidate) => text(candidate?.subjectRef).toLowerCase() === subject.toLowerCase()
    && text(candidate?.evidencePlane));
  if (!fact) {
    return answerEnvelope(request, projection, input, {
      cannotAnswerReason: `No canonical evidence-plane fact is recorded for ${subject || 'the requested subject'}.`,
    });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${subject} is supported by ${fact.evidencePlane}.`,
    facts: [fact],
  });
}

function authoringVsRuntimeAnswer(request, projection, input) {
  const facts = list(projection.facts).filter((fact) => [
    'OFFICIAL_AUTHORING_EVIDENCE',
    'OBSERVED_RUNTIME_OR_HEADSET_PROOF',
  ].includes(text(fact?.evidencePlane)));
  if (facts.length === 0) {
    return answerEnvelope(request, projection, input, {
      cannotAnswerReason: 'No separated authoring/runtime evidence facts are present.',
    });
  }
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
  if (!source) {
    return answerEnvelope(request, projection, input, {
      cannotAnswerReason: `${label} is not present in the canonical source projection.`,
    });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${label} is registered as ${source.health}, revision ${source.revision}, with licence class ${source.licenceClass}.`,
    facts: [source],
  });
}

function licenceAnswer(request, projection, input) {
  const sources = list(projection?.sourceRegistry?.sources);
  if (sources.length === 0) {
    return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No source licence state is projected.' });
  }
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
    return answerEnvelope(request, projection, input, {
      cannotAnswerReason: 'Canonical projection does not currently state the evidence needed to explain Spatial Bridge blocking conditions.',
    });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${blockers.length} blocker(s) and ${runtimeRequests.length} outstanding runtime/headset evidence request(s) are currently projected before stronger Spatial Bridge claims can be made.`,
    facts: [...blockers, ...runtimeRequests],
  });
}

function nextGoalAnswer(request, projection, input) {
  const action = text(projection.nextAuthorisedAction);
  if (!action) {
    return answerEnvelope(request, projection, input, { cannotAnswerReason: 'No next authorised VR action is projected.' });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    epistemicState: 'PROPOSED',
    answerText: action,
    facts: [{
      nextAuthorisedAction: action,
      existingGoalCandidates: ['#1594', '#1596', '#1597', '#1605', '#1723', '#1760'],
    }],
  });
}

function unknownsAnswer(request, projection, input) {
  const unknowns = [
    ...list(projection.blockers),
    ...list(projection.runtimeEvidenceRequests),
    ...list(projection.discoveryCandidates),
  ];
  if (unknowns.length === 0) {
    return answerEnvelope(request, projection, input, {
      grounded: true,
      answerText: 'No explicit unknown, blocker, runtime evidence request or discovery candidate is currently projected.',
      facts: [],
    });
  }
  return answerEnvelope(request, projection, input, {
    grounded: true,
    answerText: `${unknowns.length} explicit unresolved VR research item(s) are currently projected.`,
    facts: unknowns,
  });
}

export function answerVrResearchQuestion(request = {}, projection = {}, input = {}) {
  const validation = validateRequest(request);
  if (!validation.valid) {
    return Object.freeze({ valid: false, errors: validation.errors, answer: null, gapObservation: null });
  }
  const normalizedRequest = validation.normalized;
  const safeProjection = canonicalProjectionSnapshot(projection);
  if (!safeProjection) {
    const answer = answerEnvelope(normalizedRequest, {}, input, {
      cannotAnswerReason: 'Canonical VR research workspace projection is missing or incompatible.',
    });
    return Object.freeze({
      valid: true,
      errors: Object.freeze([]),
      answer,
      gapObservation: createVrResearchQaGapObservation(normalizedRequest, answer),
    });
  }

  const questionClass = normalizedRequest.questionClass;
  let answer;
  if (questionClass === 'SOURCE_STACK') answer = sourceStackAnswer(normalizedRequest, safeProjection, input);
  else if (questionClass === 'NEXT_EXPERIMENT') answer = nextExperimentAnswer(normalizedRequest, safeProjection, input);
  else if (questionClass === 'EVIDENCE_PLANE') answer = evidencePlaneAnswer(normalizedRequest, safeProjection, input);
  else if (questionClass === 'AUTHORING_VS_RUNTIME') answer = authoringVsRuntimeAnswer(normalizedRequest, safeProjection, input);
  else if (questionClass === 'VORPX_BASELINE') answer = namedSourceAnswer(normalizedRequest, safeProjection, input, 'vorpx', 'vorpX baseline');
  else if (questionClass === 'SKYRIM_PARITY') answer = namedSourceAnswer(normalizedRequest, safeProjection, input, 'skyrim', 'Skyrim VR parity source');
  else if (questionClass === 'LICENCE_BOUNDARIES') answer = licenceAnswer(normalizedRequest, safeProjection, input);
  else if (questionClass === 'SPATIAL_BRIDGE_BLOCKERS') answer = spatialBlockerAnswer(normalizedRequest, safeProjection, input);
  else if (questionClass === 'NEXT_BOUNDED_GOAL') answer = nextGoalAnswer(normalizedRequest, safeProjection, input);
  else answer = unknownsAnswer(normalizedRequest, safeProjection, input);

  const gapObservation = answer.answerVerdict.startsWith('GAP_')
    ? createVrResearchQaGapObservation(normalizedRequest, answer)
    : null;
  return Object.freeze({ valid: true, errors: Object.freeze([]), answer, gapObservation });
}

export function createVrResearchQaGapObservation(request = {}, answer = {}) {
  const safeRequest = normalizedRecord(request) || Object.create(null);
  const safeAnswer = normalizedRecord(answer) || Object.create(null);
  const questionClass = text(safeRequest.questionClass).toUpperCase();
  const gapId = `vr-qgap-${hash({
    questionId: safeRequest.questionId,
    questionClass,
    verdict: safeAnswer.answerVerdict,
  }).slice(0, 20)}`;
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
    questionId: text(safeRequest.questionId),
    participantId: VR_RESEARCH_PARTICIPANT_ID,
    gapClass: text(safeAnswer.answerVerdict),
    summary: text(safeAnswer.cannotAnswerReason),
    evidenceRefs: Object.freeze(canonicalProofRefs(safeAnswer.evidenceRefs)),
    existingGoalCandidates: Object.freeze(goalCandidatesByClass[questionClass] || ['#1597', '#1723']),
    repairGoalRef: null,
    status: 'OBSERVED_NEEDS_DEDUPLICATION',
  });
}

function normalizeWorkspaceAnswer(answer = {}) {
  const canonical = normalizedRecord(answer) || Object.create(null);
  return Object.freeze({
    schemaVersion: text(canonical.schemaVersion),
    answerId: text(canonical.answerId),
    questionId: text(canonical.questionId),
    responderParticipantId: text(canonical.responderParticipantId),
    answerText: text(canonical.answerText),
    epistemicState: text(canonical.epistemicState),
    evidenceRefs: Object.freeze(canonicalProofRefs(canonical.evidenceRefs)),
    freshness: text(canonical.freshness),
    cannotAnswerReason: canonical.cannotAnswerReason === null ? null : text(canonical.cannotAnswerReason),
    answerVerdict: text(canonical.answerVerdict),
    facts: normalizeWorkspaceFacts(canonical.facts),
    answeredAtUtc: text(canonical.answeredAtUtc),
  });
}

function validateWorkspaceAnswerForRequest(answer, request) {
  const errors = [];
  if (answer.schemaVersion !== VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION) errors.push('answer-schema-version-mismatch');
  if (!safeId(answer.answerId)) errors.push('answerId-invalid');
  if (!safeId(answer.questionId)) errors.push('answer-questionId-invalid');
  if (answer.questionId !== request.questionId) errors.push('answer-questionId-mismatch');
  if (answer.responderParticipantId !== VR_RESEARCH_PARTICIPANT_ID) errors.push('answer-responder-mismatch');
  if (!timestamp(answer.answeredAtUtc)) errors.push('answer-answeredAtUtc-invalid');

  const verdict = text(answer.answerVerdict);
  const freshness = text(answer.freshness);
  const epistemicState = text(answer.epistemicState);
  const reasonPresent = typeof answer.cannotAnswerReason === 'string' && answer.cannotAnswerReason.length > 0;

  if (!WORKSPACE_ANSWER_VERDICTS.has(verdict)) errors.push('answer-verdict-invalid');
  if (!WORKSPACE_ANSWER_FRESHNESS_STATES.has(freshness)) errors.push('answer-freshness-invalid');
  if (!WORKSPACE_ANSWER_EPISTEMIC_STATES.has(epistemicState)) errors.push('answer-epistemic-state-invalid');

  if (WORKSPACE_ANSWER_VERDICTS.has(verdict)
    && WORKSPACE_ANSWER_FRESHNESS_STATES.has(freshness)
    && WORKSPACE_ANSWER_EPISTEMIC_STATES.has(epistemicState)) {
    if (verdict === 'ANSWERED_GROUNDED') {
      if (freshness !== 'FRESH') errors.push('answer-grounded-requires-fresh');
      if (!GROUNDED_EPISTEMIC_STATES.has(epistemicState)) errors.push('answer-grounded-epistemic-state-invalid');
      if (answer.cannotAnswerReason !== null) errors.push('answer-grounded-cannot-have-refusal-reason');
    } else if (verdict === 'GAP_KNOWLEDGE') {
      if (freshness !== 'FRESH') errors.push('answer-knowledge-gap-requires-fresh');
      if (epistemicState !== 'UNKNOWN') errors.push('answer-knowledge-gap-epistemic-state-invalid');
      if (!reasonPresent) errors.push('answer-gap-refusal-reason-required');
    } else if (verdict === 'GAP_FRESHNESS') {
      if (!['STALE', 'UNKNOWN'].includes(freshness)) errors.push('answer-freshness-gap-state-invalid');
      if (epistemicState !== freshness) errors.push('answer-freshness-gap-epistemic-state-mismatch');
      if (!reasonPresent) errors.push('answer-gap-refusal-reason-required');
    }
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function workspaceAnswerProofBinding(request, answer) {
  const canonical = canonicalDataOnly({ request, answer });
  if (canonical === INVALID_CANONICAL_VALUE) return null;
  return Object.freeze({
    schemaVersion: VR_RESEARCH_PARTICIPANT_QA_SCHEMA_VERSION,
    questionId: request.questionId,
    answerId: answer.answerId,
    answerHash: `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`,
  });
}

export function createVrResearchQaWorkspaceAnswerRecord(request = {}, answer = {}, input = {}) {
  const requestValidation = validateRequest(request);
  const normalizedRequest = requestValidation.normalized;
  const normalizedAnswer = normalizeWorkspaceAnswer(answer);
  const answerValidation = validateWorkspaceAnswerForRequest(normalizedAnswer, normalizedRequest);
  const messageId = `vr-qa-${hash({
    questionId: normalizedRequest.questionId,
    answerId: normalizedAnswer.answerId,
  }).slice(0, 20)}`;
  const answerProofRefs = canonicalProofRefs(normalizedAnswer.evidenceRefs);
  const suppliedProofRefs = canonicalProofRefs(readOwnData(input, 'proofRefs'));
  const grounded = normalizedAnswer.answerVerdict === 'ANSWERED_GROUNDED';
  const candidateProofRefs = grounded
    ? answerProofRefs
    : answerProofRefs.length > 0
      ? answerProofRefs
      : suppliedProofRefs;
  const proofBinding = requestValidation.valid && answerValidation.valid
    ? workspaceAnswerProofBinding(normalizedRequest, normalizedAnswer)
    : null;
  const proofRefs = verifyBoundProofRefs(candidateProofRefs, proofBinding, input)
    ? candidateProofRefs
    : [];
  const correlationCandidate = readOwnData(input, 'correlationId');
  const validationOptions = readOwnData(input, 'validationOptions');
  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId,
    participantId: VR_RESEARCH_PARTICIPANT_ID,
    recipientParticipantId: normalizedRequest.askerParticipantId,
    timestampUtc: normalizedAnswer.answeredAtUtc,
    correlationId: workspaceSafeId(correlationCandidate || normalizedRequest.questionId),
    relatedIssue: '#1723',
    proofRefs,
    channel: 'vr-research-qa',
    recordSubtype: 'conversation-answer',
    subjectId: normalizedRequest.questionId,
    summary: `VR research answer ${normalizedRequest.questionId}: ${normalizedAnswer.answerVerdict}`,
    body: JSON.stringify({ request: normalizedRequest, answer: normalizedAnswer }),
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
  });
  return Object.freeze({
    record,
    answerValidation,
    validation: validateSharedWorkspaceRecord(record, validationOptions),
  });
}
