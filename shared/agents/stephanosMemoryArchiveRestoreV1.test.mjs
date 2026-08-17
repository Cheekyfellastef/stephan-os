import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStephanosMemoryArchiveIndexV1,
  buildStephanosMemoryRestorePlanV1,
  STEPHANOS_MEMORY_ARCHIVE_AUTHORITY,
  STEPHANOS_MEMORY_ARCHIVE_INPUT_SCHEMA_V1,
  STEPHANOS_MEMORY_RESTORE_INPUT_SCHEMA_V1,
} from './stephanosMemoryArchiveRestoreV1.mjs';

const d = (ch) => `sha256:${ch.repeat(64)}`;

function record(overrides = {}) {
  return {
    recordId: 'memory:alpha',
    namespace: 'project',
    memoryType: 'DECISION',
    cognitiveClass: 'SEMANTIC_MEMORY',
    authorityClass: 'SHARED_AUTHORITY',
    state: 'CURRENT',
    observedAtUtc: '2026-08-17T12:00:00Z',
    sourceRefs: ['issue:#1645'],
    proofRefs: ['pr:#1850'],
    tags: ['memory', 'project'],
    digest: d('a'),
    sensitivityClass: 'NORMAL',
    ...overrides,
  };
}

function index(records = [record()]) {
  return buildStephanosMemoryArchiveIndexV1({
    schemaVersion: STEPHANOS_MEMORY_ARCHIVE_INPUT_SCHEMA_V1,
    exportedAtUtc: '2026-08-17T15:00:00Z',
    records,
  });
}

function restore(archiveIndex, currentRecords = []) {
  return buildStephanosMemoryRestorePlanV1({
    schemaVersion: STEPHANOS_MEMORY_RESTORE_INPUT_SCHEMA_V1,
    archiveIndex,
    currentRecords,
  });
}

test('builds a deterministic sorted metadata-only archive index', () => {
  const first = index([record({ recordId: 'memory:z', digest: d('b') }), record({ recordId: 'memory:a' })]);
  const second = index([record({ recordId: 'memory:a' }), record({ recordId: 'memory:z', digest: d('b') })]);
  assert.deepEqual(first.records.map((item) => item.recordId), ['memory:a', 'memory:z']);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(first.recordCount, 2);
});

test('rejects payload/content fields so archive index cannot leak raw memory', () => {
  assert.throws(() => index([{ ...record(), payload: 'secret full transcript' }]), /UNEXPECTED_FIELD/);
  assert.throws(() => index([{ ...record(), content: 'raw prompt' }]), /UNEXPECTED_FIELD/);
});

test('preserves tombstone metadata and never proposes resurrection', () => {
  const archive = index([record({ state: 'TOMBSTONE', digest: d('c') })]);
  const plan = restore(archive);
  assert.equal(plan.items[0].disposition, 'RETAIN_TOMBSTONE');
  assert.match(plan.items[0].reason, /never resurrect/i);
});

test('proposes restore only for a missing authority-confirmed current record', () => {
  const plan = restore(index());
  assert.equal(plan.items[0].disposition, 'RESTORE_CANDIDATE');
  assert.equal(plan.summary.RESTORE_CANDIDATE, 1);
});

test('current tombstone outranks archived current content', () => {
  const plan = restore(index(), [{
    recordId: 'memory:alpha', authorityClass: 'SHARED_AUTHORITY', state: 'TOMBSTONE', digest: d('d'),
  }]);
  assert.equal(plan.items[0].disposition, 'RETAIN_TOMBSTONE');
});

test('skips an archived record already present with the same digest and state', () => {
  const plan = restore(index(), [{
    recordId: 'memory:alpha', authorityClass: 'SHARED_AUTHORITY', state: 'CURRENT', digest: d('a'),
  }]);
  assert.equal(plan.items[0].disposition, 'SKIP_ALREADY_PRESENT');
});

test('does not restore superseded history over a newer current record', () => {
  const archive = index([record({ recordId: 'memory:old', state: 'SUPERSEDED', digest: d('e'), supersededBy: ['memory:new'] })]);
  const plan = restore(archive, [{
    recordId: 'memory:new', authorityClass: 'SHARED_AUTHORITY', state: 'CURRENT', digest: d('f'), supersedes: ['memory:old'],
  }]);
  assert.equal(plan.items[0].disposition, 'SKIP_SUPERSEDED');
});

test('holds identity conflicts instead of guessing which digest is true', () => {
  const plan = restore(index(), [{
    recordId: 'memory:alpha', authorityClass: 'SHARED_AUTHORITY', state: 'CURRENT', digest: d('9'),
  }]);
  assert.equal(plan.items[0].disposition, 'HOLD_CONFLICT');
});

test('local mirror, pending and inferred authority cannot become restore candidates', () => {
  for (const authorityClass of ['LOCAL_MIRROR', 'PENDING_INTENT', 'INFERRED', 'UNKNOWN']) {
    const plan = restore(index([record({ authorityClass })]));
    assert.equal(plan.items[0].disposition, 'HOLD_AUTHORITY');
  }
});

test('sensitive classifications remain metadata-only and are held from restore', () => {
  const archive = index([record({ sensitivityClass: 'OMITTED_SENSITIVE' })]);
  assert.equal(archive.records[0].sensitiveContentOmitted, true);
  const plan = restore(archive);
  assert.equal(plan.items[0].disposition, 'HOLD_SENSITIVE');
});

test('rejects duplicate conflicting archive identities', () => {
  assert.throws(() => index([record(), record({ digest: d('b') })]), /DUPLICATE_CONFLICT/);
});

test('rejects accessor-bearing and sparse hostile input', () => {
  const hostile = record();
  Object.defineProperty(hostile, 'source', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => index([hostile]), /ACCESSOR_REJECTED/);
  const sparse = [];
  sparse.length = 2;
  sparse[1] = record();
  assert.throws(() => buildStephanosMemoryArchiveIndexV1({
    schemaVersion: STEPHANOS_MEMORY_ARCHIVE_INPUT_SCHEMA_V1,
    exportedAtUtc: '2026-08-17T15:00:00Z', records: sparse,
  }), /SPARSE_ARRAY_REJECTED/);
});

test('detects archive index tampering before producing a restore plan', () => {
  const archive = index();
  const tampered = { ...archive, records: [{ ...archive.records[0], digest: d('7') }] };
  assert.throws(() => restore(tampered), /ARCHIVE_DIGEST_MISMATCH/);
});

test('all mutation and execution authority remains false', () => {
  for (const [key, value] of Object.entries(STEPHANOS_MEMORY_ARCHIVE_AUTHORITY)) {
    assert.equal(value, false, `${key} must remain false`);
  }
  assert.equal(restore(index()).authority.restoreExecutionAllowed, false);
});
