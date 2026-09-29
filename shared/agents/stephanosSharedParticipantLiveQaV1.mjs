import { createHash } from 'node:crypto';

import { DEFAULT_PROVIDER_KEY } from '../ai/providerDefaults.mjs';
import { queryStephanosAI } from '../ai/stephanosClient.mjs';
import {
  createStephanosWorkspaceAnswerRecord,
  decodeStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import { STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION } from './stephanosConversationalCapabilityLadderV1.mjs';
import { buildStephanosRichConversationalResponseV1 } from './stephanosRichConversationalResponseV1.mjs';

export const STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION = 'stephanos.shared-participant-live-qa.v1';
export const STEPHANOS_SHARED_PARTICIPANT_ID = 'stephanos';

const MAX_ANSWER_TEXT = 24_000;
const MAX_RESPONSE_NODES = 2_048;
const MAX_ARRAY_LENGTH = 128;
const MAX_OBJECT_KEYS = 96;
const MAX_DEPTH = 10;
const MAX_LIVE_GOAL_PROJECTION_AGE_MS = 2 * 60 * 1000;
const MAX_LIVE_GOAL_PROJECTION_FUTURE_SKEW_MS = 30 * 1000;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SECRET_SHAPED_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|(?:password|credential|api[_-]?key|private[_-]?key)\s*[:=])/i;
const INVALID = Symbol('invalid-live-qa-data');

const DURABLE_SYSTEM_TRUTH_EVIDENCE_CLASSES = new Set([
  'CURRENT_PROGRAMME_STATE',
  'PROVIDER_RUNTIME_AND_ROUTE_EVIDENCE',
  'ZERO_CODEX_CONTINUITY_EVIDENCE',
  'OPENCLAW_TASK_CLASS_QUALIFICATION_EVIDENCE',
  'FORGE_FOUNDRY_CAPACITY_EVIDENCE',
  'PROVIDER_NEUTRAL_REVIEW_EVIDENCE',
  'BATTLE_BRIDGE_RECOVERY_EVIDENCE',
  'IGNITION_SELF_HEALING_EVIDENCE',
  'CONVERSATION_CONTINUITY_EVIDENCE',
  'EPISTEMIC_AND_EVIDENCE_DISCLOSURE_EVIDENCE',
  'ACTION_APPROVAL_PRESENTATION_EVIDENCE',
]);

const DURABLE_SYSTEM_TRUTH_QUESTION_CLASSES = new Set([
  'CURRENT_PROGRAMME_TRUTH',
  'ARCHITECTURE_AND_RELATIONSHIPS',
  'AGENT_AND_TOOL_CAPABILITIES',
  'BLOCKERS_AND_PROOF',
  'WHAT_CHANGED_RECENTLY',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hash(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    schedulerCreationAllowed: false,
    workerCreationAllowed: false,
    mailboxCreationAllowed: false,
    providerSelectionAuthorityAdded: false,
  });
}

function dataOnly(value, state = null, depth = 0) {
  const traversal = state || { seen: new Set(), nodes: 0 };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
  if (typeof value === 'string') return value.length <= MAX_ANSWER_TEXT ? value : INVALID;
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return INVALID;
  traversal.nodes += 1;
  if (traversal.nodes > MAX_RESPONSE_NODES || traversal.seen.has(value)) return INVALID;

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
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) return INVALID;
        const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
        if (keys.some((key) => !expected.has(key))) return INVALID;
        const output = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return INVALID;
          const child = dataOnly(descriptor.value, traversal, depth + 1);
          if (child === INVALID) return INVALID;
          output.push(child);
        }
        return Object.freeze(output);
      }

      if (keys.length > MAX_OBJECT_KEYS) return INVALID;
      const output = Object.create(null);
      for (const key of keys.sort()) {
        if (RESERVED_KEYS.has(key)) return INVALID;
        const descriptor = descriptors[key];
        if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return INVALID;
        const child = dataOnly(descriptor.value, traversal, depth + 1);
        if (child === INVALID) return INVALID;
        Object.defineProperty(output, key, {
          value: child,
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

function cleanStringArray(value, limit = 32) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const output = [];
  for (const item of value.slice(0, limit)) {
    const normalized = text(item);
    if (normalized && !SECRET_SHAPED_TEXT.test(normalized)) output.push(normalized);
  }
  return Object.freeze([...new Set(output)]);
}

function evidenceToken(kind, value) {
  return `${kind}:sha256:${hash(value).slice(0, 40)}`;
}

function requiresDurableSystemTruth(question = {}) {
  return DURABLE_SYSTEM_TRUTH_EVIDENCE_CLASSES.has(text(question.expectedEvidenceClass))
    || DURABLE_SYSTEM_TRUTH_QUESTION_CLASSES.has(text(question.questionClass));
}

function timestampPosture(value, nowMs) {
  const timestampMs = Date.parse(text(value));
  if (!Number.isFinite(timestampMs)) return 'INVALID';
  const ageMs = nowMs - timestampMs;
  if (ageMs < -MAX_LIVE_GOAL_PROJECTION_FUTURE_SKEW_MS) return 'FUTURE';
  if (ageMs > MAX_LIVE_GOAL_PROJECTION_AGE_MS) return 'STALE';
  return 'FRESH';
}

function classifyLiveGoalProjection(projection, nowMs) {
  if (!projection || typeof projection !== 'object' || projection.schemaVersion !== 'stephanos.live-goal-projection.v1') {
    return Object.freeze({ posture: 'ABSENT_OR_INVALID', observedRuntimeProof: false });
  }

  const generatedAtPosture = timestampPosture(projection.generatedAt, nowMs);
  const heartbeat = projection.heartbeat && typeof projection.heartbeat === 'object' ? projection.heartbeat : {};
  const heartbeatPosture = timestampPosture(heartbeat.generatedAt, nowMs);
  const backend = projection.backendStatus && typeof projection.backendStatus === 'object' ? projection.backendStatus : {};
  const backendStatus = text(backend.status).toLowerCase();
  const missionStatus = text(projection.missionOperationsStatus?.status).toLowerCase();
  const canonicalSource = text(projection.projectionSource) === 'live-goal-projection-service'
    && text(heartbeat.projectionSource) === 'live-goal-projection-service';
  const liveSourceTruth = text(projection.sourceTruth).toLowerCase() === 'live';
  const backendLive = backend.ok === true || backendStatus === 'live' || backendStatus === 'ok';
  const heartbeatLive = heartbeat.backendLive === true;
  const missionLive = missionStatus === 'ready' || missionStatus === 'empty';
  const timestampsFresh = generatedAtPosture === 'FRESH' && heartbeatPosture === 'FRESH';

  if (!timestampsFresh) {
    return Object.freeze({ posture: 'STALE_OR_INVALID_TIMESTAMP', observedRuntimeProof: false });
  }
  if (!canonicalSource) {
    return Object.freeze({ posture: 'NON_CANONICAL_SOURCE', observedRuntimeProof: false });
  }
  if (!liveSourceTruth) {
    const posture = text(projection.sourceTruth).toLowerCase() === 'mixed'
      ? 'MIXED'
      : (text(projection.sourceTruth).toLowerCase() === 'static-fallback' ? 'STATIC_FALLBACK' : 'NON_LIVE_SOURCE_TRUTH');
    return Object.freeze({ posture, observedRuntimeProof: false });
  }
  if (!backendLive || !heartbeatLive) {
    return Object.freeze({ posture: 'BACKEND_OR_HEARTBEAT_NOT_LIVE', observedRuntimeProof: false });
  }
  if (!missionLive) {
    return Object.freeze({ posture: 'MISSION_OPERATIONS_NOT_LIVE', observedRuntimeProof: false });
  }
  return Object.freeze({ posture: 'LIVE_CURRENT', observedRuntimeProof: true });
}

function deriveGroundingEvidence(response = {}, options = {}) {
  const data = response?.data && typeof response.data === 'object' ? response.data : {};
  const execution = data.execution_metadata && typeof data.execution_metadata === 'object'
    ? data.execution_metadata
    : {};
  const refs = [];
  const sources = [];
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  let observedRuntimeProof = false;
  let liveGoalProjectionPosture = 'ABSENT';

  const liveGoalProjection = data.liveGoalProjection && typeof data.liveGoalProjection === 'object'
    ? data.liveGoalProjection
    : null;
  if (liveGoalProjection?.schemaVersion === 'stephanos.live-goal-projection.v1') {
    const classifiedProjection = classifyLiveGoalProjection(liveGoalProjection, nowMs);
    liveGoalProjectionPosture = classifiedProjection.posture;
    refs.push(evidenceToken('live-goal-projection', JSON.stringify({
      generatedAt: liveGoalProjection.generatedAt || '',
      projectionSource: liveGoalProjection.projectionSource || '',
      sourceTruth: liveGoalProjection.sourceTruth || '',
      backendStatus: liveGoalProjection.backendStatus || {},
      heartbeat: liveGoalProjection.heartbeat || {},
      missionOperationsStatus: liveGoalProjection.missionOperationsStatus || {},
      proofTruth: liveGoalProjection.proofTruth || {},
    })));
    sources.push('live-goal-projection');
    observedRuntimeProof = classifiedProjection.observedRuntimeProof;
  }

  if (execution.retrieval_used === true) {
    const retrieved = cleanStringArray(execution.retrieved_sources, 8);
    for (const source of retrieved) refs.push(evidenceToken('local-retrieval', source));
    if (retrieved.length > 0) sources.push('local-retrieval');
  }

  const memoryHits = Array.isArray(response?.memory_hits) ? response.memory_hits.slice(0, 8) : [];
  if (memoryHits.length > 0) {
    for (const hit of memoryHits) {
      const safeHit = dataOnly(hit);
      if (safeHit !== INVALID) refs.push(evidenceToken('memory-hit', JSON.stringify(safeHit)));
    }
    if (refs.some((ref) => ref.startsWith('memory-hit:'))) sources.push('durable-memory');
  }

  if (execution.grounding_active_for_request === true) {
    const requestId = text(response?.debug?.request_id) || text(data?.request_trace?.requestId) || 'grounded-request';
    refs.push(evidenceToken('provider-grounding', requestId));
    sources.push('provider-grounding');
  }

  const freshnessIntegrity = execution.freshness_integrity_preserved === true;
  const answerTruthMode = text(execution.answer_truth_mode || execution.effective_answer_mode).toLowerCase();
  const freshness = freshnessIntegrity || observedRuntimeProof
    ? 'FRESH'
    : (answerTruthMode.includes('stale') ? 'STALE' : 'UNKNOWN');

  return Object.freeze({
    evidenceRefs: Object.freeze([...new Set(refs)]),
    sourcesConsulted: Object.freeze([...new Set(sources)]),
    freshness,
    observedRuntimeProof,
    liveGoalProjectionPosture,
  });
}

function answerIdFor(question, outputText, response = {}) {
  const requestId = text(response?.debug?.request_id) || 'no-request-id';
  return `live-qa-${hash(JSON.stringify({
    roundId: question.roundId,
    questionId: question.questionId,
    requestId,
    outputDigest: hash(outputText),
  })).slice(0, 24)}`;
}

function makeAnswer({ question, response, outputText, answeredAtUtc, nowMs, failureReason = '' }) {
  const grounding = deriveGroundingEvidence(response, { nowMs });
  const failed = Boolean(failureReason);
  const durableSystemTruthRequired = requiresDurableSystemTruth(question);
  const effectiveFreshness = durableSystemTruthRequired && !grounding.observedRuntimeProof
    ? (grounding.liveGoalProjectionPosture === 'STALE_OR_INVALID_TIMESTAMP' ? 'STALE' : 'UNKNOWN')
    : grounding.freshness;
  const grounded = !failed
    && grounding.evidenceRefs.length > 0
    && grounding.sourcesConsulted.length > 0
    && ['FRESH', 'RECENT'].includes(effectiveFreshness)
    && (!durableSystemTruthRequired || grounding.observedRuntimeProof);

  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_ANSWER_SCHEMA_VERSION,
    answerId: answerIdFor(question, outputText, response),
    questionId: question.questionId,
    roundId: question.roundId,
    responderParticipantId: STEPHANOS_SHARED_PARTICIPANT_ID,
    answerText: outputText,
    epistemicState: failed
      ? 'UNKNOWN'
      : (grounding.observedRuntimeProof ? 'OBSERVED_FROM_RUNTIME_OR_PROOF' : 'INFERRED_FROM_EVIDENCE'),
    evidenceRefs: failed ? Object.freeze([]) : grounding.evidenceRefs,
    freshness: failed ? 'UNKNOWN' : effectiveFreshness,
    sourcesConsulted: failed ? Object.freeze([]) : grounding.sourcesConsulted,
    cannotAnswerReason: failed ? failureReason : null,
    answerVerdict: failed
      ? 'GAP_TOOL_OR_DATA_ACCESS'
      : (grounded ? 'ANSWERED_GROUNDED' : 'ANSWERED_PARTIAL'),
    gapRefs: failed ? Object.freeze(['#1308']) : Object.freeze([]),
    answeredAtUtc,
  });
}

function blocked(classification, errors = []) {
  return Object.freeze({
    ok: false,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION,
    classification,
    errors: Object.freeze([...errors]),
    question: null,
    answer: null,
    answerRecord: null,
    richResponse: null,
    ...authorityBoundary(),
  });
}

export async function answerStephanosWorkspaceQuestionRecord(questionRecord, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const answeredAtUtc = now.toISOString();
  const decoded = decodeStephanosWorkspaceQuestionRecord(questionRecord, {
    workspaceValidationOptions: { nowMs },
    questionValidationOptions: options.questionValidationOptions,
  });
  if (!decoded.valid) return blocked('QUESTION_RECORD_REJECTED', decoded.errors);

  const question = decoded.question;
  if (text(question.targetParticipantId).toLowerCase() !== STEPHANOS_SHARED_PARTICIPANT_ID) {
    return blocked('QUESTION_TARGET_NOT_STEPHANOS', ['targetParticipantId-must-be-stephanos']);
  }

  const durableSystemTruthRequired = requiresDurableSystemTruth(question);
  const queryFn = typeof options.queryFn === 'function' ? options.queryFn : queryStephanosAI;
  let rawResponse;
  try {
    rawResponse = await queryFn({
      provider: DEFAULT_PROVIDER_KEY,
      messages: [{ role: 'user', content: question.questionText }],
      context: {
        surface: 'shared-participant-qa',
        roundId: question.roundId,
        questionId: question.questionId,
        questionClass: question.questionClass,
        expectedEvidenceClass: question.expectedEvidenceClass,
        contextRefs: [...question.contextRefs],
        noveltyRefs: [...question.noveltyRefs],
        durableSystemTruthRequired,
        durableSystemTruthRequirement: durableSystemTruthRequired
          ? 'LIVE_DURABLE_SYSTEM_TRUTH'
          : 'STANDARD_EVIDENCE',
      },
      routeMode: 'auto',
      fallbackEnabled: true,
      runtimeContext: options.runtimeContext && typeof options.runtimeContext === 'object' ? options.runtimeContext : {},
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    rawResponse = {
      success: false,
      output_text: 'Stephanos could not complete this question through the existing AI route.',
      error: text(error?.message) || 'Stephanos AI route failed.',
      data: {},
      debug: {},
    };
  }

  const response = dataOnly(rawResponse);
  if (response === INVALID || !response || typeof response !== 'object' || Array.isArray(response)) {
    return blocked('AI_RESPONSE_REJECTED_AS_NON_DATA', ['ai-response-must-be-bounded-data-only']);
  }

  let outputText = text(response.output_text);
  const responseSucceeded = response.success === true && outputText.length > 0;
  if (outputText.length > MAX_ANSWER_TEXT || SECRET_SHAPED_TEXT.test(outputText)) {
    return blocked('AI_RESPONSE_UNSAFE_FOR_SHARED_WORKSPACE', ['ai-output-secret-shaped-or-oversized']);
  }
  if (!outputText) outputText = 'Stephanos could not complete this question through the existing AI route.';

  const failureReason = responseSucceeded
    ? ''
    : text(response.error) || 'Existing Stephanos AI route did not produce a successful answer.';
  const answer = makeAnswer({ question, response, outputText, answeredAtUtc, nowMs, failureReason });
  const built = createStephanosWorkspaceAnswerRecord(answer, {
    recipientParticipantId: question.askerParticipantId,
    relatedIssue: text(questionRecord.relatedIssue) || '#1308',
    relatedPr: text(questionRecord.relatedPr),
    proofRefs: Array.isArray(questionRecord.proofRefs) ? [...questionRecord.proofRefs] : [],
    workspaceValidationOptions: { nowMs },
  });
  if (!built.valid) return blocked('ANSWER_RECORD_BUILD_FAILED', built.errors);

  const richResponse = buildStephanosRichConversationalResponseV1({
    question,
    answer,
    structured: options.richResponseStructured,
  });
  if (!richResponse.valid) return blocked('RICH_RESPONSE_BUILD_FAILED', richResponse.errors);

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION,
    classification: responseSucceeded
      ? (answer.answerVerdict === 'ANSWERED_GROUNDED' ? 'STEPHANOS_GROUNDED_ANSWER_READY' : 'STEPHANOS_PARTIAL_ANSWER_READY')
      : 'STEPHANOS_GAP_ANSWER_READY',
    question,
    answer,
    answerRecord: built.record,
    richResponse,
    ...authorityBoundary(),
  });
}
