import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEPHANOS_PROCEDURAL_MEMORY_SCHEMA_VERSION,
  buildStephanosProceduralMemoryV1,
} from './stephanosProceduralMemoryV1.mjs';

function step(overrides = {}) {
  return {
    stepId: 'observe',
    instructionSummary: 'Read the exact current evidence before selecting the next bounded action.',
    expectedEvidenceClass: 'current-evidence',
    ...overrides,
  };
}

function method(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_PROCEDURAL_MEMORY_SCHEMA_VERSION,
    recordId: 'method-recovery-v1',
    methodId: 'preservation-safe-recovery',
    version: '1.0.0',
    problemClass: 'Recover a stalled source lane without destroying canonical work.',
    methodSummary: 'Re-read exact identities, preserve the canonical lane, and choose the smallest bounded recovery action supported by evidence.',
    validationState: 'VALIDATED',
    state: 'CURRENT',
    authorityClass: 'SHARED_AUTHORITY',
    confidence: 0.95,
    freshness: 'FRESH',
    validatedAtUtc: '2026-08-10T12:00:00.000Z',
    lastVerifiedAtUtc: '2026-08-17T12:00:00.000Z',
    supersedesRecordId: null,
    supersededByRecordId: null,
    prerequisiteRefs: ['architecture://canonical-lane'],
    evidenceRefs: ['proof://recovery-round-001'],
    applicableDomains: ['source-recovery', 'goal-build'],
    failureModes: ['Exact source identity can become stale while the recovery is being prepared.'],
    steps: [step()],
    ...overrides,
  };
}

test('projects a validated current shared method as reusable procedural memory', () => {
  const result = buildStephanosProceduralMemoryV1({ methods: [method()] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'PROCEDURAL_MEMORY_PROJECTED');
  assert.deepEqual(result.reusableMethods.map((item) => item.recordId), ['method-recovery-v1']);
  assert.equal(result.candidateMethods.length, 0);
});

test('candidate methods remain candidates and cannot masquerade as reusable', () => {
  const candidate = method({
    recordId: 'method-candidate',
    validationState: 'CANDIDATE',
    authorityClass: 'INFERRED',
    confidence: 0.5,
    validatedAtUtc: null,
  });
  const result = buildStephanosProceduralMemoryV1({ methods: [candidate] });
  assert.equal(result.valid, true);
  assert.equal(result.reusableMethods.length, 0);
  assert.deepEqual(result.candidateMethods.map((item) => item.recordId), ['method-candidate']);
});

test('validated methods require shared authority and validation evidence', () => {
  for (const overrides of [
    { authorityClass: 'INFERRED' },
    { evidenceRefs: [] },
    { validatedAtUtc: null },
  ]) {
    const result = buildStephanosProceduralMemoryV1({ methods: [method(overrides)] });
    assert.equal(result.valid, false);
    assert.equal(result.verdict, 'SAFE_HOLD');
  }
});

test('superseded method versions remain historical and require reciprocal same-method lineage', () => {
  const oldMethod = method({
    recordId: 'method-v1',
    version: '1.0.0',
    state: 'SUPERSEDED',
    supersededByRecordId: 'method-v2',
  });
  const newMethod = method({
    recordId: 'method-v2',
    version: '2.0.0',
    supersedesRecordId: 'method-v1',
  });
  const result = buildStephanosProceduralMemoryV1({ methods: [oldMethod, newMethod] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.reusableMethods.map((item) => item.recordId), ['method-v2']);
  assert.deepEqual(result.historicalMethods.map((item) => item.recordId), ['method-v1']);
});

test('cross-method supersession fails closed', () => {
  const oldMethod = method({
    recordId: 'method-a-v1',
    methodId: 'method-a',
    state: 'SUPERSEDED',
    supersededByRecordId: 'method-b-v2',
  });
  const newMethod = method({
    recordId: 'method-b-v2',
    methodId: 'method-b',
    supersedesRecordId: 'method-a-v1',
  });
  const result = buildStephanosProceduralMemoryV1({ methods: [oldMethod, newMethod] });
  assert.equal(result.valid, false);
  assert(result.validationErrors.some((error) => error.includes('different-method')));
});

test('multiple validated current versions of the same method are surfaced as a conflict, not silently ranked', () => {
  const first = method({ recordId: 'method-current-a', version: '1.0.0' });
  const second = method({ recordId: 'method-current-b', version: '2.0.0' });
  const result = buildStephanosProceduralMemoryV1({ methods: [first, second] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'PROCEDURAL_MEMORY_PROJECTED_WITH_CONFLICTS');
  assert.equal(result.methodConflicts.length, 1);
  assert.deepEqual(result.methodConflicts[0].recordIds, ['method-current-a', 'method-current-b']);
});

test('supersession cycles fail closed', () => {
  const first = method({
    recordId: 'method-cycle-a',
    state: 'SUPERSEDED',
    supersedesRecordId: 'method-cycle-b',
    supersededByRecordId: 'method-cycle-b',
  });
  const second = method({
    recordId: 'method-cycle-b',
    state: 'SUPERSEDED',
    supersedesRecordId: 'method-cycle-a',
    supersededByRecordId: 'method-cycle-a',
  });
  const result = buildStephanosProceduralMemoryV1({ methods: [first, second] });
  assert.equal(result.valid, false);
  assert(result.validationErrors.some((error) => error.includes('supersession-cycle-detected')));
});

test('procedure memory rejects executable command and path shaped instructions', () => {
  for (const instructionSummary of [
    'Run powershell -File repair.ps1.',
    'Use C:\\Users\\Stephan\\repair.ps1.',
    'Run sudo systemctl restart stephanos.',
  ]) {
    const result = buildStephanosProceduralMemoryV1({
      methods: [method({ steps: [step({ instructionSummary })] })],
    });
    assert.equal(result.valid, false);
    assert(result.validationErrors.some((error) => error.includes('instructionSummary-invalid')));
  }
});

test('hostile accessors, custom prototypes and sparse arrays fail before authority can be read', () => {
  let reads = 0;
  const hostile = method();
  Object.defineProperty(hostile, 'authorityClass', {
    enumerable: true,
    get() {
      reads += 1;
      return 'SHARED_AUTHORITY';
    },
  });
  const accessor = buildStephanosProceduralMemoryV1({ methods: [hostile] });
  assert.equal(accessor.valid, false);
  assert.equal(reads, 0);

  const custom = Object.setPrototypeOf(method({ recordId: 'custom' }), { poisoned: true });
  assert.equal(buildStephanosProceduralMemoryV1({ methods: [custom] }).valid, false);

  const sparse = [];
  sparse.length = 2;
  sparse[1] = method({ recordId: 'sparse' });
  assert.equal(buildStephanosProceduralMemoryV1({ methods: sparse }).valid, false);
});

test('projection is deterministic and cannot execute, validate, write or widen authority', () => {
  const input = { methods: [method()] };
  const first = buildStephanosProceduralMemoryV1(input);
  const second = buildStephanosProceduralMemoryV1(input);
  assert.equal(first.projectionId, second.projectionId);
  assert.match(first.projectionId, /^procedural-[0-9a-f]{32}$/);
  assert(Object.values(first.authority).every((value) => value === false));
  assert.equal(Object.isFrozen(first), true);
});
