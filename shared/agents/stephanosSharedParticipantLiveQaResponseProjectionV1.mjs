import { queryStephanosAI } from '../ai/stephanosClient.mjs';
import {
  STEPHANOS_SHARED_PARTICIPANT_ID,
  STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION,
  answerStephanosWorkspaceQuestionRecord as answerCoreQuestionRecord,
} from './stephanosSharedParticipantLiveQaV1.mjs';

export {
  STEPHANOS_SHARED_PARTICIPANT_ID,
  STEPHANOS_SHARED_PARTICIPANT_LIVE_QA_SCHEMA_VERSION,
};

const MAX_ANSWER_TEXT = 24_000;
const MAX_RESPONSE_NODES = 2_048;
const MAX_ARRAY_LENGTH = 128;
const MAX_OBJECT_KEYS = 96;
const MAX_DEPTH = 10;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INVALID = Symbol('invalid-live-qa-projection');

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

function isPlainDataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readOwnDataField(value, key, path) {
  if (!isPlainDataObject(value)) {
    return Object.freeze({ valid: false, present: false, value: null, error: `${path}-must-be-plain-data-object` });
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return Object.freeze({ valid: true, present: false, value: null, error: '' });
    if (descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return Object.freeze({ valid: false, present: true, value: null, error: `${path}.${key}-must-be-own-enumerable-data` });
    }
    return Object.freeze({ valid: true, present: true, value: descriptor.value, error: '' });
  } catch {
    return Object.freeze({ valid: false, present: false, value: null, error: `${path}.${key}-descriptor-read-failed` });
  }
}

function readDataFields(value, keys, path) {
  if (!isPlainDataObject(value)) return Object.freeze({ valid: false, fields: null, error: `${path}-must-be-plain-data-object` });
  const fields = Object.create(null);
  for (const key of keys) {
    const field = readOwnDataField(value, key, path);
    if (!field.valid) return Object.freeze({ valid: false, fields: null, error: field.error });
    if (field.present) fields[key] = field.value;
  }
  return Object.freeze({ valid: true, fields, error: '' });
}

function readArrayPrefix(value, limit, path) {
  if (!Array.isArray(value)) return Object.freeze({ valid: false, value: null, error: `${path}-must-be-array` });
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return Object.freeze({ valid: false, value: null, error: `${path}-must-be-plain-array` });
    }
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0) {
      return Object.freeze({ valid: false, value: null, error: `${path}-length-invalid` });
    }
    const output = [];
    for (let index = 0; index < Math.min(length, limit); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return Object.freeze({ valid: false, value: null, error: `${path}.${index}-must-be-own-enumerable-data` });
      }
      output.push(descriptor.value);
    }
    return Object.freeze({ valid: true, value: output, error: '' });
  } catch {
    return Object.freeze({ valid: false, value: null, error: `${path}-descriptor-read-failed` });
  }
}

function projectObject(value, keys, path) {
  const selected = readDataFields(value, keys, path);
  if (!selected.valid) return selected;
  const projected = dataOnly(selected.fields);
  if (projected === INVALID || !projected || typeof projected !== 'object' || Array.isArray(projected)) {
    return Object.freeze({ valid: false, fields: null, error: `${path}-must-be-bounded-data-only` });
  }
  return Object.freeze({ valid: true, fields: projected, error: '' });
}

export function projectStephanosAiResponseForWorkspaceV1(rawResponse) {
  const top = readDataFields(rawResponse, ['success', 'output_text', 'error', 'data', 'debug', 'memory_hits'], 'ai-response');
  if (!top.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([top.error]) });
  const response = Object.create(null);

  if (Object.hasOwn(top.fields, 'success')) {
    if (typeof top.fields.success !== 'boolean') {
      return Object.freeze({ valid: false, response: null, errors: Object.freeze(['ai-response.success-must-be-boolean']) });
    }
    response.success = top.fields.success;
  }
  if (Object.hasOwn(top.fields, 'output_text')) {
    if (typeof top.fields.output_text !== 'string') {
      return Object.freeze({ valid: false, response: null, errors: Object.freeze(['ai-response.output_text-must-be-string']) });
    }
    response.output_text = top.fields.output_text;
  }
  if (Object.hasOwn(top.fields, 'error') && top.fields.error !== null) {
    const safeError = dataOnly(top.fields.error);
    if (safeError === INVALID || typeof safeError !== 'string') {
      return Object.freeze({ valid: false, response: null, errors: Object.freeze(['ai-response.error-must-be-bounded-string']) });
    }
    response.error = safeError;
  }

  if (Object.hasOwn(top.fields, 'data') && top.fields.data !== null) {
    const data = readDataFields(top.fields.data, ['execution_metadata', 'liveGoalProjection', 'request_trace'], 'ai-response.data');
    if (!data.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([data.error]) });
    const projectedData = Object.create(null);
    if (Object.hasOwn(data.fields, 'execution_metadata')) {
      const execution = readDataFields(data.fields.execution_metadata, [
        'retrieval_used',
        'retrieved_sources',
        'grounding_active_for_request',
        'freshness_integrity_preserved',
        'answer_truth_mode',
        'effective_answer_mode',
      ], 'ai-response.data.execution_metadata');
      if (!execution.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([execution.error]) });
      const projectedExecution = { ...execution.fields };
      if (Object.hasOwn(execution.fields, 'retrieved_sources')) {
        const prefix = readArrayPrefix(execution.fields.retrieved_sources, 8, 'ai-response.data.execution_metadata.retrieved_sources');
        if (!prefix.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([prefix.error]) });
        projectedExecution.retrieved_sources = prefix.value;
      }
      const safeExecution = dataOnly(projectedExecution);
      if (safeExecution === INVALID) {
        return Object.freeze({ valid: false, response: null, errors: Object.freeze(['ai-response.data.execution_metadata-must-be-bounded-data-only']) });
      }
      projectedData.execution_metadata = safeExecution;
    }
    if (Object.hasOwn(data.fields, 'liveGoalProjection')) {
      const projection = readDataFields(data.fields.liveGoalProjection, [
        'schemaVersion',
        'generatedAt',
        'projectionSource',
        'sourceTruth',
        'backendStatus',
        'heartbeat',
        'missionOperationsStatus',
        'proofTruth',
      ], 'ai-response.data.liveGoalProjection');
      if (!projection.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([projection.error]) });
      const projectedProjection = { ...projection.fields };
      for (const [key, keys] of [
        ['backendStatus', ['ok', 'status']],
        ['heartbeat', ['generatedAt', 'projectionSource', 'backendLive']],
        ['missionOperationsStatus', ['status']],
        ['proofTruth', ['github', 'local', 'browser']],
      ]) {
        if (!Object.hasOwn(projection.fields, key)) continue;
        const nested = projectObject(projection.fields[key], keys, `ai-response.data.liveGoalProjection.${key}`);
        if (!nested.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([nested.error]) });
        projectedProjection[key] = nested.fields;
      }
      const safeProjection = dataOnly(projectedProjection);
      if (safeProjection === INVALID) {
        return Object.freeze({ valid: false, response: null, errors: Object.freeze(['ai-response.data.liveGoalProjection-must-be-bounded-data-only']) });
      }
      projectedData.liveGoalProjection = safeProjection;
    }
    if (Object.hasOwn(data.fields, 'request_trace')) {
      const trace = projectObject(data.fields.request_trace, ['requestId'], 'ai-response.data.request_trace');
      if (!trace.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([trace.error]) });
      projectedData.request_trace = trace.fields;
    }
    response.data = Object.freeze(projectedData);
  }

  if (Object.hasOwn(top.fields, 'debug') && top.fields.debug !== null) {
    const debug = projectObject(top.fields.debug, ['request_id'], 'ai-response.debug');
    if (!debug.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([debug.error]) });
    response.debug = debug.fields;
  }
  if (Object.hasOwn(top.fields, 'memory_hits') && top.fields.memory_hits !== null) {
    const prefix = readArrayPrefix(top.fields.memory_hits, 8, 'ai-response.memory_hits');
    if (!prefix.valid) return Object.freeze({ valid: false, response: null, errors: Object.freeze([prefix.error]) });
    const safeMemoryHits = dataOnly(prefix.value);
    if (safeMemoryHits === INVALID) {
      return Object.freeze({ valid: false, response: null, errors: Object.freeze(['ai-response.memory_hits-must-be-bounded-data-only']) });
    }
    response.memory_hits = safeMemoryHits;
  }

  return Object.freeze({ valid: true, response: Object.freeze(response), errors: Object.freeze([]) });
}

export async function answerStephanosWorkspaceQuestionRecord(questionRecord, options = {}) {
  const queryFn = typeof options.queryFn === 'function' ? options.queryFn : queryStephanosAI;
  let projectionFailure = null;
  const result = await answerCoreQuestionRecord(questionRecord, {
    ...options,
    queryFn: async (request) => {
      const rawResponse = await queryFn(request);
      const projected = projectStephanosAiResponseForWorkspaceV1(rawResponse);
      if (projected.valid) return projected.response;
      projectionFailure = projected.errors;
      return {
        success: false,
        output_text: 'Stephanos could not safely consume the AI response envelope.',
        error: 'AI response projection rejected.',
        data: {},
        debug: {},
        memory_hits: [],
      };
    },
  });
  if (projectionFailure) return blocked('AI_RESPONSE_REJECTED_AS_NON_DATA', projectionFailure);
  return result;
}
