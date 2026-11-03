import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1,
  projectElasticFiveLanePartitionedQueueShadowV1,
} from './elasticFiveLanePartitionedQueueShadowV1.mjs';

const HEAD = 'a'.repeat(40);
const OPERATION = {
  'queue/source': 'PREPARE_SOURCE',
  'queue/review': 'REVIEW_EXACT_HEAD',
  'queue/proof': 'RUN_DETERMINISTIC_PROOF',
  'queue/deployment': 'PLAN_DEPLOYMENT',
  'queue/browser': 'CAPTURE_EXPERIENCE_PROOF',
  'queue/recovery': 'PLAN_RECOVERY',
};

function policies() {
  return ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1.map((queueClass) => ({
    queueClass,
    acceptedOperation: OPERATION[queueClass],
    concurrencyLimit: 2,
    retryBudget: 2,
    deadLetterPath: `dead-letter/${queueClass.slice('queue/'.length)}`,
    receiptStreamId: `receipt-stream-${queueClass.slice('queue/'.length)}`,
    issuerCapabilities: [OPERATION[queueClass]],
  }));
}

function job(queueClass, overrides = {}) {
  const suffix = queueClass.slice('queue/'.length);
  return {
    taskId: `task-${suffix}`,
    correlationId: `correlation-${suffix}`,
    queueClass,
    operation: OPERATION[queueClass],
    sourceHead: HEAD,
    resourceIds: [`resource:${suffix}`],
    state: 'READY',
    attempt: 0,
    mutationIntent: queueClass === 'queue/source',
    signatureVerified: true,
    issuerAuthorized: true,
    ...overrides,
  };
}

function fixture() {
  return {
    sourceHead: HEAD,
    policies: policies(),
    jobs: ELASTIC_FIVE_LANE_QUEUE_CLASSES_V1.map((queueClass) => job(queueClass)),
  };
}

test('projects six partitioned queues while granting no queue or execution authority', () => {
  const result = projectElasticFiveLanePartitionedQueueShadowV1(fixture());
  assert.equal(result.state, 'RUNNING_SHADOW');
  assert.equal(result.operationalLaneCount, 6);
  assert.equal(result.queueLanes.length, 6);
  assert.ok(result.queueLanes.every((lane) => lane.state === 'CONTINUE_SHADOW'));
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('one blocked review queue leaves five resource-disjoint queues continuing', () => {
  const input = fixture();
  input.jobs = input.jobs.map((entry) => entry.queueClass === 'queue/review'
    ? { ...entry, state: 'BLOCKED' }
    : entry);
  const result = projectElasticFiveLanePartitionedQueueShadowV1(input);
  assert.equal(result.state, 'PARTITIONED_CONTINUATION_SHADOW');
  assert.equal(result.operationalLaneCount, 5);
  assert.equal(result.blockedQueueIsolationProven, true);
  assert.equal(result.queueLanes.find((lane) => lane.queueClass === 'queue/review').state, 'BLOCKED_ISOLATED');
  assert.ok(result.queueLanes.filter((lane) => lane.queueClass !== 'queue/review')
    .every((lane) => lane.state === 'CONTINUE_SHADOW'));
});

test('two isolated blocked queues cannot falsely claim the five-lane minimum', () => {
  const input = fixture();
  input.jobs = input.jobs.map((entry) => ['queue/review', 'queue/browser'].includes(entry.queueClass)
    ? { ...entry, state: 'BLOCKED' }
    : entry);
  const result = projectElasticFiveLanePartitionedQueueShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['FIVE_OPERATIONAL_QUEUE_LANES_NOT_PROVEN']);
});

test('operation cannot escape its queue class', () => {
  const input = fixture();
  input.jobs[0].operation = 'PLAN_DEPLOYMENT';
  const result = projectElasticFiveLanePartitionedQueueShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['QUEUE_JOB_OPERATION_NOT_ALLOWED']);
});

test('complete fixed queue policies and exact source identity are mandatory', () => {
  const missingPolicy = fixture();
  missingPolicy.policies.pop();
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(missingPolicy).reasonCodes,
    ['COMPLETE_PARTITIONED_QUEUE_POLICY_NOT_PROVEN']);

  const stale = fixture();
  stale.jobs[0].sourceHead = 'b'.repeat(40);
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(stale).reasonCodes,
    ['QUEUE_JOB_SOURCE_HEAD_MISMATCH']);
});

test('forged jobs and duplicate task identities fail closed', () => {
  const forged = fixture();
  forged.jobs[0].signatureVerified = false;
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(forged).reasonCodes,
    ['QUEUE_JOB_AUTHENTICITY_UNPROVEN']);

  const duplicate = fixture();
  duplicate.jobs[1].taskId = duplicate.jobs[0].taskId;
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(duplicate).reasonCodes,
    ['DUPLICATE_QUEUE_TASK_ID']);
});

test('enumerable authority smuggling and extra issuer capabilities fail closed', () => {
  const smuggled = fixture();
  smuggled.jobs[0].executeNow = true;
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(smuggled).reasonCodes,
    ['QUEUE_JOB_NOT_CANONICAL_PLAIN_DATA']);

  const widened = fixture();
  widened.policies[0].issuerCapabilities.push('DEPLOY_NOW');
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(widened).reasonCodes,
    ['QUEUE_POLICY_ISSUER_CAPABILITY_MISSING']);
});

test('multiple mutation writers for one resource fail across queue partitions', () => {
  const input = fixture();
  input.jobs[0].resourceIds = ['repo:main'];
  input.jobs[1] = job('queue/review', {
    resourceIds: ['repo:main'],
    mutationIntent: true,
  });
  const result = projectElasticFiveLanePartitionedQueueShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE']);
});

test('failed work reaches only its declared shadow dead-letter path at the retry boundary', () => {
  const input = fixture();
  input.jobs[2] = job('queue/proof', { state: 'FAILED', attempt: 2 });
  const result = projectElasticFiveLanePartitionedQueueShadowV1(input);
  assert.equal(result.state, 'RUNNING_SHADOW');
  const proof = result.queueLanes.find((lane) => lane.queueClass === 'queue/proof');
  assert.equal(proof.deadLetterCount, 1);
  assert.equal(proof.deadLetterPath, 'dead-letter/proof');
  assert.equal(proof.queueWriteAllowed, false);
});

test('concurrency overflow fails closed instead of spilling into another queue', () => {
  const input = fixture();
  input.jobs = input.jobs.filter((entry) => entry.queueClass !== 'queue/source');
  input.jobs.push(job('queue/source', { taskId: 'source-a', state: 'RUNNING' }));
  input.jobs.push(job('queue/source', { taskId: 'source-b', state: 'RUNNING', resourceIds: ['resource:source-b'] }));
  input.jobs.push(job('queue/source', { taskId: 'source-c', state: 'RUNNING', resourceIds: ['resource:source-c'] }));
  const result = projectElasticFiveLanePartitionedQueueShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['QUEUE_CONCURRENCY_LIMIT_EXCEEDED']);
});

test('hidden, symbol, accessor and hostile reflection inputs return deterministic safe hold', () => {
  for (const mutate of [
    (entry) => Object.defineProperty(entry, 'executeNow', { value: true, enumerable: false }),
    (entry) => { entry[Symbol('executeNow')] = true; },
    (entry) => Object.defineProperty(entry, 'executeNow', { get() { return true; }, enumerable: true }),
  ]) {
    const input = fixture();
    mutate(input.jobs[0]);
    assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(input).reasonCodes,
      ['QUEUE_JOB_NOT_CANONICAL_PLAIN_DATA']);
  }

  const symbolArray = fixture();
  symbolArray.jobs[0].resourceIds[Symbol('executeNow')] = true;
  assert.deepEqual(projectElasticFiveLanePartitionedQueueShadowV1(symbolArray).reasonCodes,
    ['QUEUE_JOB_RESOURCE_SCOPE_INVALID']);

  const hostile = new Proxy({}, { ownKeys() { throw null; } });
  const hostileResult = projectElasticFiveLanePartitionedQueueShadowV1(hostile);
  assert.equal(hostileResult.state, 'SAFE_HOLD');
  assert.deepEqual(hostileResult.reasonCodes, ['PARTITIONED_QUEUE_INPUT_INSPECTION_FAILED']);
});
