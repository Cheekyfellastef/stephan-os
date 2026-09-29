import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEPHANOS_REFLECTIVE_MEMORY_SCHEMA_VERSION,
  buildStephanosReflectiveMemoryV1,
} from './stephanosReflectiveMemoryV1.mjs';

function reflection(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_REFLECTIVE_MEMORY_SCHEMA_VERSION,
    reflectionId: 'reflection-recovery-001',
    patternKey: 'preservation-safe-recovery',
    reflectionKind: 'RECOVERY_PATTERN',
    origin: 'DETERMINISTIC_SYNTHESIS',
    promotionState: 'CONFIRMED',
    patternSummary: 'Preserving the canonical lane before repairing a stalled workflow repeatedly prevents duplicate or destructive recovery.',
    scopeSummary: 'Applies to source lanes where exact branch and review evidence can be re-read before mutation.',
    authorityClass: 'SHARED_AUTHORITY',
    confidence: 0.95,
    freshness: 'FRESH',
    state: 'CURRENT',
    createdAtUtc: '2026-08-17T10:00:00.000Z',
    validatedAtUtc: '2026-08-17T12:00:00.000Z',
    lastVerifiedAtUtc: '2026-08-17T15:00:00.000Z',
    sourceEpisodeRefs: ['episode://recovery-001', 'episode://recovery-002'],
    evidenceRefs: ['proof://recovery-001', 'proof://recovery-002'],
    counterexampleRefs: ['evidence://recovery-counterexample-001'],
    derivedCandidateRefs: ['method://preservation-safe-recovery-v1'],
    supersedesReflectionId: null,
    supersededByReflectionId: null,
    ...overrides,
  };
}

test('projects confirmed evidence-backed multi-episode reflection without promoting it into another memory class', () => {
  const result = buildStephanosReflectiveMemoryV1({ reflections: [reflection()] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'REFLECTIVE_MEMORY_PROJECTED');
  assert.deepEqual(result.confirmedReflections.map((item) => item.reflectionId), ['reflection-recovery-001']);
  assert.equal(result.authority.semanticFactPromotionAllowed, false);
  assert.equal(result.authority.methodPromotionAllowed, false);
});

test('model synthesis remains an inferred candidate and cannot self-confirm', () => {
  const candidate = reflection({
    reflectionId: 'reflection-model',
    patternKey: 'model-pattern',
    origin: 'MODEL_SYNTHESIS',
    promotionState: 'CANDIDATE',
    authorityClass: 'INFERRED',
    validatedAtUtc: null,
  });
  const result = buildStephanosReflectiveMemoryV1({ reflections: [candidate] });
  assert.equal(result.valid, true);
  assert.equal(result.confirmedReflections.length, 0);
  assert.deepEqual(result.candidateReflections.map((item) => item.reflectionId), ['reflection-model']);

  const selfConfirmed = { ...candidate, promotionState: 'CONFIRMED', authorityClass: 'SHARED_AUTHORITY', validatedAtUtc: '2026-08-17T12:00:00.000Z' };
  const rejected = buildStephanosReflectiveMemoryV1({ reflections: [selfConfirmed] });
  assert.equal(rejected.valid, false);
  assert(rejected.validationErrors.some((error) => error.includes('model-synthesis')));
});

test('confirmed reflections require shared authority and validation timestamp', () => {
  for (const overrides of [{ authorityClass: 'LOCAL_MIRROR' }, { validatedAtUtc: null }]) {
    const result = buildStephanosReflectiveMemoryV1({ reflections: [reflection(overrides)] });
    assert.equal(result.valid, false);
    assert.equal(result.verdict, 'SAFE_HOLD');
  }
});

test('reflection requires at least two distinct source episodes', () => {
  const tooFew = buildStephanosReflectiveMemoryV1({ reflections: [reflection({ sourceEpisodeRefs: ['episode://one'] })] });
  assert.equal(tooFew.valid, false);
  assert(tooFew.validationErrors.some((error) => error.includes('at-least-two-source-episodes')));

  const duplicate = buildStephanosReflectiveMemoryV1({ reflections: [reflection({ sourceEpisodeRefs: ['episode://one', 'episode://one'] })] });
  assert.equal(duplicate.valid, false);
  assert(duplicate.validationErrors.some((error) => error.includes('contains-duplicate')));
});

test('counterexamples remain visible evidence rather than being discarded by a strong pattern', () => {
  const result = buildStephanosReflectiveMemoryV1({ reflections: [reflection()] });
  assert.deepEqual(result.confirmedReflections[0].counterexampleRefs, ['evidence://recovery-counterexample-001']);
  assert.equal(result.confirmedReflections[0].confidence, 0.95);
});

test('supersession preserves old reflection history and must stay within one pattern key', () => {
  const oldReflection = reflection({
    reflectionId: 'reflection-old',
    state: 'SUPERSEDED',
    supersededByReflectionId: 'reflection-new',
  });
  const newReflection = reflection({
    reflectionId: 'reflection-new',
    createdAtUtc: '2026-08-17T13:00:00.000Z',
    supersedesReflectionId: 'reflection-old',
  });
  const result = buildStephanosReflectiveMemoryV1({ reflections: [oldReflection, newReflection] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.confirmedReflections.map((item) => item.reflectionId), ['reflection-new']);
  assert.deepEqual(result.historicalReflections.map((item) => item.reflectionId), ['reflection-old']);

  const wrong = { ...newReflection, patternKey: 'different-pattern' };
  const rejected = buildStephanosReflectiveMemoryV1({ reflections: [oldReflection, wrong] });
  assert.equal(rejected.valid, false);
  assert(rejected.validationErrors.some((error) => error.includes('different-pattern-key')));
});

test('competing confirmed current reflections remain an explicit pattern conflict', () => {
  const first = reflection({ reflectionId: 'reflection-a' });
  const second = reflection({ reflectionId: 'reflection-b', patternSummary: 'A competing interpretation of the same evidence remains unresolved.' });
  const result = buildStephanosReflectiveMemoryV1({ reflections: [first, second] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'REFLECTIVE_MEMORY_PROJECTED_WITH_CONFLICTS');
  assert.deepEqual(result.patternConflicts[0].reflectionIds, ['reflection-a', 'reflection-b']);
});

test('derived method and lesson references remain candidates without write or promotion authority', () => {
  const result = buildStephanosReflectiveMemoryV1({ reflections: [reflection({
    derivedCandidateRefs: ['method://method-candidate-001', 'lesson://lesson-candidate-001'],
  })] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.confirmedReflections[0].derivedCandidateRefs, ['method://method-candidate-001', 'lesson://lesson-candidate-001']);
  assert.equal(result.authority.methodPromotionAllowed, false);
  assert.equal(result.authority.lessonPromotionAllowed, false);
});

test('rejects psychological/sensitive text, local paths and hostile shapes before authority use', () => {
  for (const patternSummary of [
    'The operator has a psychological profile that explains the pattern.',
    'The proof lives at C:\\Users\\Stephan\\private.txt.',
  ]) {
    const result = buildStephanosReflectiveMemoryV1({ reflections: [reflection({ patternSummary })] });
    assert.equal(result.valid, false);
    assert(result.validationErrors.some((error) => error.includes('patternSummary-invalid')));
  }

  let reads = 0;
  const hostile = reflection();
  Object.defineProperty(hostile, 'authorityClass', {
    enumerable: true,
    get() {
      reads += 1;
      return 'SHARED_AUTHORITY';
    },
  });
  const accessor = buildStephanosReflectiveMemoryV1({ reflections: [hostile] });
  assert.equal(accessor.valid, false);
  assert.equal(reads, 0);

  const sparse = [];
  sparse.length = 2;
  sparse[1] = reflection({ reflectionId: 'reflection-sparse' });
  assert.equal(buildStephanosReflectiveMemoryV1({ reflections: sparse }).valid, false);
});

test('projection identity is deterministic and all mutation or authority expansion remains false', () => {
  const input = { reflections: [reflection()] };
  const first = buildStephanosReflectiveMemoryV1(input);
  const second = buildStephanosReflectiveMemoryV1(input);
  assert.equal(first.projectionId, second.projectionId);
  assert.match(first.projectionId, /^reflective-[0-9a-f]{32}$/);
  assert(Object.values(first.authority).every((allowed) => allowed === false));
  assert.equal(Object.isFrozen(first), true);
});
