export const ELASTIC_FIVE_LANE_PARTITIONED_QUEUE_SHADOW_SCHEMA_VERSION =
  'stephanos.elastic-five-lane-partitioned-queue-shadow.v1';

export const ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1 = Object.freeze([
  'queue/source',
  'queue/review',
  'queue/proof',
  'queue/deployment',
  'queue/browser',
  'queue/recovery',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const FIXED_OPERATION = Object.freeze({
  'queue/source': 'PREPARE_SOURCE',
  'queue/review': 'REVIEW_EXACT_HEAD',
  'queue/proof': 'RUN_DETERMINISTIC_PROOF',
  'queue/deployment': 'PLAN_DEPLOYMENT',
  'queue/browser': 'CAPTURE_EXPERIENCE_PROOF',
  'queue/recovery': 'PLAN_RECOVERY',
});
const ZERO_AUTHORITY = Object.freeze({
  queueWriteAllowed: false,
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  browserMutationAllowed: false,
  recoveryExecutionAllowed: false,
  deploymentAllowed: false,
  leaseAcquisitionAllowed: false,
  mergeAllowed: false,
  controllerAuthorityTransferAllowed: false,
  fiveLaneCutoverAllowed: false,
});
const INPUT_KEYS = Object.freeze(['sourceHead', 'policies', 'jobs']);
const POLICY_KEYS = Object.freeze([
  'queueClass', 'acceptedOperation', 'concurrencyLimit', 'retryBudget',
  'deadLetterPath', 'receiptStreamId', 'issuerCapabilities',
]);
const JOB_KEYS = Object.freeze([
  'taskId', 'correlationId', 'queueClass', 'operation', 'sourceHead',
  'resourceIds', 'state', 'attempt', 'mutationIntent', 'signatureVerified',
  'issuerAuthorized',
]);

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function canonicalPlainData(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  if (allowedKeys) {
    const keys = Object.keys(value);
    if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) return false;
  }
  return true;
}

function canonicalArray(value, { minimum = 0, maximum = 1024 } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length < minimum || value.length > maximum) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function canonicalStringArray(value, { minimum = 0, maximum = 32 } = {}) {
  if (!canonicalArray(value, { minimum, maximum })) return null;
  const normalized = value.map((entry) => text(entry));
  if (normalized.some((entry) => !entry) || new Set(normalized).size !== normalized.length) return null;
  return normalized;
}

function terminalSafeHold(reasonCodes = ['PARTITIONED_QUEUE_INPUT_INVALID']) {
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_PARTITIONED_QUEUE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'SAFE_HOLD',
    operationalLaneCount: 0,
    queueLanes: Object.freeze([]),
    blockedQueueIsolationProven: false,
    oneMutationWriterPerResourceProven: false,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    finalVerdict: 'ELASTIC_FIVE_LANE_PARTITIONED_QUEUE_SHADOW_SAFE_HOLD',
  });
}

function safeHold(reasonCodes) {
  return terminalSafeHold(reasonCodes);
}

function validatePolicy(policy, queueClass) {
  if (!canonicalPlainData(policy, POLICY_KEYS)) return 'QUEUE_POLICY_NOT_CANONICAL_PLAIN_DATA';
  if (text(policy.queueClass, 80) !== queueClass) return 'QUEUE_POLICY_CLASS_MISMATCH';
  if (text(policy.acceptedOperation, 80).toUpperCase() !== FIXED_OPERATION[queueClass]) {
    return 'QUEUE_POLICY_OPERATION_MISMATCH';
  }
  if (!Number.isSafeInteger(policy.concurrencyLimit) || policy.concurrencyLimit < 1 || policy.concurrencyLimit > 16) {
    return 'QUEUE_POLICY_CONCURRENCY_LIMIT_INVALID';
  }
  if (!Number.isSafeInteger(policy.retryBudget) || policy.retryBudget < 0 || policy.retryBudget > 8) {
    return 'QUEUE_POLICY_RETRY_BUDGET_INVALID';
  }
  if (text(policy.deadLetterPath, 120) !== `dead-letter/${queueClass.slice('queue/'.length)}`) {
    return 'QUEUE_POLICY_DEAD_LETTER_PATH_INVALID';
  }
  if (!text(policy.receiptStreamId, 160)) return 'QUEUE_POLICY_RECEIPT_STREAM_MISSING';
  const capabilities = canonicalStringArray(policy.issuerCapabilities, { minimum: 1, maximum: 8 });
  if (!capabilities || capabilities.length !== 1 || capabilities[0] !== FIXED_OPERATION[queueClass]) {
    return 'QUEUE_POLICY_ISSUER_CAPABILITY_MISSING';
  }
  return '';
}

function validateJob(job, sourceHead, policyByClass) {
  if (!canonicalPlainData(job, JOB_KEYS)) return 'QUEUE_JOB_NOT_CANONICAL_PLAIN_DATA';
  const queueClass = text(job.queueClass, 80);
  const policy = policyByClass.get(queueClass);
  if (!policy) return 'QUEUE_JOB_CLASS_UNKNOWN';
  if (!text(job.taskId, 140) || !text(job.correlationId, 140)) return 'QUEUE_JOB_IDENTITY_INCOMPLETE';
  if (text(job.sourceHead, 40).toLowerCase() !== sourceHead) return 'QUEUE_JOB_SOURCE_HEAD_MISMATCH';
  if (text(job.operation, 80).toUpperCase() !== FIXED_OPERATION[queueClass]) return 'QUEUE_JOB_OPERATION_NOT_ALLOWED';
  if (job.signatureVerified !== true || job.issuerAuthorized !== true) return 'QUEUE_JOB_AUTHENTICITY_UNPROVEN';
  if (!Number.isSafeInteger(job.attempt) || job.attempt < 0 || job.attempt > 100) return 'QUEUE_JOB_ATTEMPT_INVALID';
  const resources = canonicalStringArray(job.resourceIds, { minimum: 1, maximum: 16 });
  if (!resources) return 'QUEUE_JOB_RESOURCE_SCOPE_INVALID';
  const state = text(job.state, 40).toUpperCase();
  if (!['READY', 'RUNNING', 'BLOCKED', 'FAILED'].includes(state)) return 'QUEUE_JOB_STATE_UNKNOWN';
  if (typeof job.mutationIntent !== 'boolean') return 'QUEUE_JOB_MUTATION_INTENT_MISSING';
  return '';
}

function project(input) {
  if (!canonicalPlainData(input, INPUT_KEYS)) {
    return terminalSafeHold(['PARTITIONED_QUEUE_INPUT_NOT_CANONICAL_PLAIN_DATA']);
  }
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  if (!SHA40.test(sourceHead)) return safeHold(['EXACT_SOURCE_HEAD_UNPROVEN']);
  if (!canonicalArray(input.policies, { minimum: 0, maximum: 32 })) {
    return safeHold(['QUEUE_POLICY_SET_INVALID']);
  }
  if (!canonicalArray(input.jobs, { minimum: 0, maximum: 512 })) {
    return safeHold(['QUEUE_JOB_SET_INVALID']);
  }
  const policyByClass = new Map();
  for (const policy of input.policies) {
    if (!canonicalPlainData(policy, POLICY_KEYS)) return safeHold(['QUEUE_POLICY_NOT_CANONICAL_PLAIN_DATA']);
    const queueClass = text(policy.queueClass, 80);
    if (!ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1.includes(queueClass)) return safeHold(['QUEUE_POLICY_CLASS_UNKNOWN']);
    if (policyByClass.has(queueClass)) return safeHold(['DUPLICATE_QUEUE_POLICY']);
    const blocker = validatePolicy(policy, queueClass);
    if (blocker) return safeHold([blocker]);
    policyByClass.set(queueClass, policy);
  }
  if (policyByClass.size !== ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1.length) {
    return safeHold(['COMPLETE_PARTITIONED_QUEUE_POLICY_NOT_PROVEN']);
  }

  const taskIds = new Set();
  const mutationWriterByResource = new Map();
  const jobsByClass = new Map(ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1.map((queueClass) => [queueClass, []]));
  for (const job of input.jobs) {
    const blocker = validateJob(job, sourceHead, policyByClass);
    if (blocker) return safeHold([blocker]);
    const taskId = text(job.taskId, 140);
    if (taskIds.has(taskId)) return safeHold(['DUPLICATE_QUEUE_TASK_ID']);
    taskIds.add(taskId);
    const queueClass = text(job.queueClass, 80);
    const state = text(job.state, 40).toUpperCase();
    const resources = canonicalStringArray(job.resourceIds, { minimum: 1, maximum: 16 });
    if (job.mutationIntent && ['READY', 'RUNNING'].includes(state)) {
      for (const resourceId of resources) {
        if (mutationWriterByResource.has(resourceId)) {
          return safeHold(['MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE']);
        }
        mutationWriterByResource.set(resourceId, taskId);
      }
    }
    jobsByClass.get(queueClass).push(job);
  }

  const queueLanes = [];
  for (const queueClass of ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1) {
    const policy = policyByClass.get(queueClass);
    const jobs = jobsByClass.get(queueClass);
    const running = jobs.filter((job) => text(job.state, 40).toUpperCase() === 'RUNNING').length;
    if (running > policy.concurrencyLimit) return safeHold(['QUEUE_CONCURRENCY_LIMIT_EXCEEDED']);
    const blocked = jobs.filter((job) => text(job.state, 40).toUpperCase() === 'BLOCKED').length;
    const deadLetter = jobs.filter((job) =>
      text(job.state, 40).toUpperCase() === 'FAILED' && job.attempt >= policy.retryBudget).length;
    const ready = jobs.filter((job) => text(job.state, 40).toUpperCase() === 'READY').length;
    queueLanes.push(Object.freeze({
      queueClass,
      acceptedOperation: FIXED_OPERATION[queueClass],
      state: blocked > 0 && ready === 0 && running === 0 ? 'BLOCKED_ISOLATED' : 'CONTINUE_SHADOW',
      readyCount: ready,
      runningCount: running,
      blockedCount: blocked,
      deadLetterCount: deadLetter,
      concurrencyLimit: policy.concurrencyLimit,
      retryBudget: policy.retryBudget,
      deadLetterPath: text(policy.deadLetterPath, 120),
      receiptStreamId: text(policy.receiptStreamId, 160),
      queueWriteAllowed: false,
      dispatchAllowed: false,
    }));
  }

  const operationalLaneCount = queueLanes.filter((lane) => lane.state === 'CONTINUE_SHADOW').length;
  if (operationalLaneCount < 5) return safeHold(['FIVE_OPERATIONAL_QUEUE_LANES_NOT_PROVEN']);
  const isolatedBlockers = queueLanes.filter((lane) => lane.state === 'BLOCKED_ISOLATED').length;
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_PARTITIONED_QUEUE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: isolatedBlockers > 0 ? 'PARTITIONED_CONTINUATION_SHADOW' : 'RUNNING_SHADOW',
    sourceHead,
    operationalLaneCount,
    isolatedBlockedQueueCount: isolatedBlockers,
    queueLanes: Object.freeze(queueLanes),
    blockedQueueIsolationProven: isolatedBlockers > 0,
    oneMutationWriterPerResourceProven: true,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze(isolatedBlockers > 0
      ? ['BLOCKED_QUEUE_ISOLATION_SHADOW_PROVEN', 'FIVE_RESOURCE_DISJOINT_QUEUE_LANES_CONTINUE']
      : ['PARTITIONED_QUEUE_SHADOW_RUNNING']),
    finalVerdict: 'ELASTIC_FIVE_LANE_PARTITIONED_QUEUE_SHADOW_READY_NO_AUTHORITY',
  });
}

export function projectElasticFiveLanePartitionedQueueShadowV1(input = {}) {
  try {
    return project(input);
  } catch {
    return terminalSafeHold(['PARTITIONED_QUEUE_INPUT_INSPECTION_FAILED']);
  }
}
