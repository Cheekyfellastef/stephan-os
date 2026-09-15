import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStephanosMemoryRetentionCapacityPolicyV1 } from './stephanosMemoryRetentionCapacityPolicyV1.mjs';

const NOW = '2026-08-17T16:00:00.000Z';
const day = 24 * 60 * 60 * 1000;
const isoAgo = (days) => new Date(Date.parse(NOW) - days * day).toISOString();
function record(overrides = {}) {
  return {
    recordId: 'r1', cognitiveClass: 'SEMANTIC_MEMORY', retentionClass: 'DURABLE_EVIDENCE',
    lifecycleState: 'CURRENT', authorityClass: 'SHARED_AUTHORITY', approximateBytes: 1024,
    createdAtUtc: isoAgo(10), lastTouchedAtUtc: isoAgo(1), validUntilUtc: null,
    protectedReasons: [], sourceRefs: ['memory://r1'], ...overrides,
  };
}
function evaluate(records, capacityLimitBytes = 100_000) {
  return buildStephanosMemoryRetentionCapacityPolicyV1({ observedAtUtc: NOW, capacityLimitBytes, records });
}

test('retains active and current records regardless of ordinary age', () => {
  const result = evaluate([record()]);
  assert.equal(result.valid, true);
  assert.equal(result.decisions[0].action, 'RETAIN_HOT');
});

test('expired working memory becomes an expiry candidate but is not deleted', () => {
  const result = evaluate([record({ recordId: 'working', cognitiveClass: 'WORKING_MEMORY', retentionClass: 'EPHEMERAL_SESSION', lifecycleState: 'RESOLVED', createdAtUtc: isoAgo(1), lastTouchedAtUtc: isoAgo(1), validUntilUtc: isoAgo(0.5), sourceRefs: ['memory://working'] })]);
  assert.equal(result.decisions[0].action, 'EXPIRY_CANDIDATE');
  assert.equal(result.authority.deleteAllowed, false);
});

test('cold repetitive telemetry becomes a compaction candidate', () => {
  const result = evaluate([record({ recordId: 'telemetry', cognitiveClass: 'OTHER_GOVERNED_MEMORY', retentionClass: 'REPETITIVE_TELEMETRY', lifecycleState: 'RESOLVED', createdAtUtc: isoAgo(30), lastTouchedAtUtc: isoAgo(10), sourceRefs: ['runtime://telemetry'] })]);
  assert.equal(result.decisions[0].action, 'COMPACTION_CANDIDATE');
  assert.equal(result.authority.compactionExecutionAllowed, false);
});

test('cold superseded history becomes archive candidate rather than deletion candidate', () => {
  const result = evaluate([record({ recordId: 'old-claim', retentionClass: 'SUPERSEDED_PROJECTION', lifecycleState: 'SUPERSEDED', createdAtUtc: isoAgo(100), lastTouchedAtUtc: isoAgo(40), sourceRefs: ['claim://old-claim'] })]);
  assert.equal(result.decisions[0].action, 'ARCHIVE_CANDIDATE');
  assert.equal(result.authority.archiveExecutionAllowed, false);
});

test('tombstones are always retained', () => {
  const result = evaluate([record({ recordId: 'tomb', retentionClass: 'TOMBSTONE', lifecycleState: 'RESOLVED', createdAtUtc: isoAgo(500), lastTouchedAtUtc: isoAgo(500), sourceRefs: ['memory://tomb'] })]);
  assert.equal(result.decisions[0].action, 'RETAIN_TOMBSTONE');
  assert.deepEqual(result.protectedRecordIds, ['tomb']);
});

test('protected decisions corrections approvals privacy actions and authority evidence cannot be compacted or expired', () => {
  for (const reason of ['OPERATOR_DECISION', 'OPERATOR_APPROVAL', 'DURABLE_CORRECTION', 'LEGAL_PRIVACY_ACTION', 'AUTHORITY_EVIDENCE', 'AUDIT_REQUIRED']) {
    const result = evaluate([record({ recordId: `p-${reason}`, cognitiveClass: 'WORKING_MEMORY', retentionClass: 'EPHEMERAL_SESSION', lifecycleState: 'EXPIRED', createdAtUtc: isoAgo(100), lastTouchedAtUtc: isoAgo(100), validUntilUtc: isoAgo(90), protectedReasons: [reason], sourceRefs: [`memory://p-${reason}`] })]);
    assert.equal(result.decisions[0].action, 'RETAIN_HOT', reason);
  }
});

test('unknown authority or lifecycle fails safe instead of proposing destructive maintenance', () => {
  const result = evaluate([record({ authorityClass: 'UNKNOWN' })]);
  assert.equal(result.valid, true);
  assert.equal(result.decisions[0].action, 'SAFE_HOLD');
});

test('capacity pressure is observable without capacity eviction authority', () => {
  const result = evaluate([record({ approximateBytes: 9600 })], 10_000);
  assert.equal(result.capacityPressure.level, 'CRITICAL');
  assert.equal(result.verdict, 'RETENTION_PLAN_READY_WITH_CAPACITY_PRESSURE');
  assert.equal(result.authority.capacityEvictionAllowed, false);
});

test('capacity exceeded remains a plan and never selects protected records for eviction', () => {
  const result = evaluate([
    record({ recordId: 'protected', approximateBytes: 9000, protectedReasons: ['OPERATOR_DECISION'], sourceRefs: ['decision://protected'] }),
    record({ recordId: 'active', approximateBytes: 9000, sourceRefs: ['memory://active'] }),
  ], 10_000);
  assert.equal(result.capacityPressure.level, 'EXCEEDED');
  assert.equal(result.decisions.find((x) => x.recordId === 'protected').action, 'RETAIN_HOT');
  assert.equal(result.authority.capacityEvictionAllowed, false);
});

test('hostile accessor and sparse-array shapes fail closed without reading authority fields', () => {
  let reads = 0;
  const hostile = record();
  Object.defineProperty(hostile, 'authorityClass', { enumerable: true, get() { reads += 1; return 'SHARED_AUTHORITY'; } });
  const accessor = evaluate([hostile]);
  assert.equal(accessor.valid, false);
  assert.equal(reads, 0);
  const sparse = [];
  sparse.length = 2;
  sparse[1] = record({ recordId: 'sparse' });
  assert.equal(evaluate(sparse).valid, false);
});

test('projection identity is deterministic and all maintenance/mutation authority remains false', () => {
  const input = [record()];
  const first = evaluate(input);
  const second = evaluate(input);
  assert.equal(first.evaluationId, second.evaluationId);
  assert.match(first.evaluationId, /^retention-[0-9a-f]{32}$/);
  assert(Object.values(first.authority).every((allowed) => allowed === false));
  assert.equal(Object.isFrozen(first), true);
});
