import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEPHANOS_SEMANTIC_MEMORY_SCHEMA_VERSION,
  buildStephanosSemanticMemoryV1,
} from './stephanosSemanticMemoryV1.mjs';

function claim(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_SEMANTIC_MEMORY_SCHEMA_VERSION,
    claimId: 'claim-home-route-old',
    subjectRef: 'operator://stephan',
    predicate: 'travel.preferred-route',
    valueSummary: 'The previously preferred route was the coast road.',
    claimOrigin: 'OPERATOR_TEACHING',
    authorityClass: 'SHARED_AUTHORITY',
    confidence: 1,
    freshness: 'FRESH',
    state: 'SUPERSEDED',
    validFromUtc: '2026-07-01T08:00:00.000Z',
    validUntilUtc: '2026-08-01T08:00:00.000Z',
    lastVerifiedAtUtc: '2026-07-20T08:00:00.000Z',
    supersedesClaimId: null,
    supersededByClaimId: 'claim-home-route-new',
    sourceRefs: ['operator://stephan'],
    proofRefs: ['evidence://teaching-001'],
    contradictionClaimIds: [],
    tags: ['operator-preference', 'travel'],
    ...overrides,
  };
}

function currentClaim(overrides = {}) {
  return claim({
    claimId: 'claim-home-route-new',
    valueSummary: 'The current preferred route is the inland route.',
    state: 'CURRENT',
    validFromUtc: '2026-08-01T08:00:00.000Z',
    validUntilUtc: null,
    lastVerifiedAtUtc: '2026-08-10T08:00:00.000Z',
    supersedesClaimId: 'claim-home-route-old',
    supersededByClaimId: null,
    ...overrides,
  });
}

const OBSERVED_AT = '2026-08-17T15:30:00.000Z';

test('projects current semantic truth while preserving superseded history', () => {
  const result = buildStephanosSemanticMemoryV1({
    observedAtUtc: OBSERVED_AT,
    claims: [claim(), currentClaim()],
  });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'SEMANTIC_MEMORY_PROJECTED');
  assert.deepEqual(result.currentClaims.map((item) => item.claimId), ['claim-home-route-new']);
  assert.deepEqual(result.historicalClaims.map((item) => item.claimId), ['claim-home-route-old']);
  assert.equal(result.claims.find((item) => item.claimId === 'claim-home-route-new').temporallyEffective, true);
  assert.equal(result.claims.find((item) => item.claimId === 'claim-home-route-old').temporallyEffective, false);
  assert.equal(result.semanticSubjects[0].subjectRef, 'operator://stephan');
});

test('keeps multiple current contradictory claims explicit instead of guessing a winner', () => {
  const first = currentClaim({
    claimId: 'claim-a',
    supersedesClaimId: null,
    valueSummary: 'The project status is ready.',
    subjectRef: 'project://stephan-os',
    predicate: 'status.current',
    contradictionClaimIds: ['claim-b'],
  });
  const second = currentClaim({
    claimId: 'claim-b',
    supersedesClaimId: null,
    valueSummary: 'The project status is blocked.',
    subjectRef: 'project://stephan-os',
    predicate: 'status.current',
    contradictionClaimIds: ['claim-a'],
  });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [first, second] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'SEMANTIC_MEMORY_PROJECTED_WITH_UNRESOLVED_CONTRADICTIONS');
  assert.equal(result.unresolvedContradictions.length, 1);
  assert.equal(result.unresolvedContradictions[0].explicitlyDeclared, true);
  assert.deepEqual(result.unresolvedContradictions[0].claimIds, ['claim-a', 'claim-b']);
});

test('equivalent current claims with separate provenance do not become a false contradiction', () => {
  const first = currentClaim({
    claimId: 'claim-equivalent-a',
    supersedesClaimId: null,
    subjectRef: 'project://stephan-os',
    predicate: 'status.current',
    valueSummary: 'The project status is ready.',
  });
  const second = currentClaim({
    claimId: 'claim-equivalent-b',
    supersedesClaimId: null,
    subjectRef: 'project://stephan-os',
    predicate: 'status.current',
    valueSummary: 'The project status is ready.',
    claimOrigin: 'PROJECT_EVIDENCE',
  });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [first, second] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'SEMANTIC_MEMORY_PROJECTED');
  assert.equal(result.unresolvedContradictions.length, 0);
});

test('model inference cannot silently acquire authoritative memory status', () => {
  const inferred = currentClaim({
    claimId: 'claim-inferred',
    supersedesClaimId: null,
    claimOrigin: 'MODEL_INFERENCE',
    authorityClass: 'SHARED_AUTHORITY',
  });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [inferred] });
  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'SAFE_HOLD');
  assert(result.validationErrors.some((error) => error.includes('model-inference-must-remain-inferred')));
});

test('valid model inference remains visibly inferred and read-only', () => {
  const inferred = currentClaim({
    claimId: 'claim-inferred',
    supersedesClaimId: null,
    claimOrigin: 'MODEL_INFERENCE',
    authorityClass: 'INFERRED',
    confidence: 0.4,
  });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [inferred] });
  assert.equal(result.valid, true);
  assert.equal(result.currentClaims[0].authorityClass, 'INFERRED');
  assert.equal(result.authority.durablePromotionAllowed, false);
  assert.equal(result.authority.providerPromptUseAllowed, false);
});

test('supersession must stay within one semantic key and be reciprocal', () => {
  const oldClaim = claim();
  const replacement = currentClaim({ predicate: 'travel.avoided-route' });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [oldClaim, replacement] });
  assert.equal(result.valid, false);
  assert(result.validationErrors.some((error) => error.includes('supersedes-different-semantic-key')));
  assert(result.validationErrors.some((error) => error.includes('supersededBy-different-semantic-key')));
});

test('supersession cycles fail closed rather than inventing a current lineage', () => {
  const first = claim({
    claimId: 'claim-cycle-a',
    state: 'SUPERSEDED',
    validFromUtc: '2026-07-01T08:00:00.000Z',
    validUntilUtc: '2026-07-15T08:00:00.000Z',
    supersedesClaimId: 'claim-cycle-b',
    supersededByClaimId: 'claim-cycle-b',
  });
  const second = claim({
    claimId: 'claim-cycle-b',
    state: 'SUPERSEDED',
    validFromUtc: '2026-07-01T08:00:00.000Z',
    validUntilUtc: '2026-07-20T08:00:00.000Z',
    supersedesClaimId: 'claim-cycle-a',
    supersededByClaimId: 'claim-cycle-a',
  });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [first, second] });
  assert.equal(result.valid, false);
  assert(result.validationErrors.some((error) => error.includes('supersession-cycle-detected')));
});

test('future or expired claims are not projected as current truth merely because state says CURRENT', () => {
  const future = currentClaim({
    claimId: 'claim-future',
    supersedesClaimId: null,
    validFromUtc: '2026-09-01T08:00:00.000Z',
    lastVerifiedAtUtc: null,
  });
  const expired = currentClaim({
    claimId: 'claim-expired',
    supersedesClaimId: null,
    predicate: 'travel.secondary-route',
    validFromUtc: '2026-07-01T08:00:00.000Z',
    validUntilUtc: '2026-08-01T08:00:00.000Z',
    lastVerifiedAtUtc: '2026-07-15T08:00:00.000Z',
  });
  const result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [future, expired] });
  assert.equal(result.valid, true);
  assert.equal(result.currentClaims.length, 0);
  assert.deepEqual(result.historicalClaims.map((item) => item.claimId).sort(), ['claim-expired', 'claim-future']);
});

test('rejects secrets, raw logs and local paths from semantic value summaries', () => {
  for (const valueSummary of [
    'The access token is abc123.',
    'Preserve the raw prompt from the provider.',
    'Use C:\\Users\\Stephan\\secret.txt as the memory fact.',
    'Use /root/.ssh/id_rsa as the memory fact.',
    'Read /workspace/agent/cache.db as the memory fact.',
  ]) {
    const result = buildStephanosSemanticMemoryV1({
      observedAtUtc: OBSERVED_AT,
      claims: [currentClaim({ claimId: 'claim-sensitive', supersedesClaimId: null, valueSummary })],
    });
    assert.equal(result.valid, false, valueSummary);
    assert(result.validationErrors.some((error) => error.includes('valueSummary-invalid')), valueSummary);
  }
});

test('rejects generic token credentials while preserving ordinary token terminology', () => {
  for (const valueSummary of [
    'token=abcdef0123456789abcdef0123456789',
    'token: abcdef0123456789abcdef0123456789',
    'token abcdef0123456789abcdef0123456789',
    'token credential must stay private',
    'GitHub token is ghp_abcdefghijklmnopqrstuvwxyz123456',
    'GitHub token was ghp_abcdefghijklmnopqrstuvwxyz123456',
  ]) {
    const result = buildStephanosSemanticMemoryV1({
      observedAtUtc: OBSERVED_AT,
      claims: [currentClaim({ claimId: 'claim-generic-token-secret', supersedesClaimId: null, valueSummary })],
    });
    assert.equal(result.valid, false, valueSummary);
    assert(result.validationErrors.some((error) => error.includes('valueSummary-invalid')), valueSummary);
  }

  const ordinary = buildStephanosSemanticMemoryV1({
    observedAtUtc: OBSERVED_AT,
    claims: [currentClaim({
      claimId: 'claim-token-budget',
      supersedesClaimId: null,
      valueSummary: 'The Codex token budget is currently constrained.',
    })],
  });
  assert.equal(ordinary.valid, true);
});

test('verification timestamps after the observation instant fail closed', () => {
  const result = buildStephanosSemanticMemoryV1({
    observedAtUtc: OBSERVED_AT,
    claims: [currentClaim({
      claimId: 'claim-future-verification',
      supersedesClaimId: null,
      lastVerifiedAtUtc: '2026-08-18T08:00:00.000Z',
    })],
  });
  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'SAFE_HOLD');
  assert(result.validationErrors.some((error) => error.includes('lastVerifiedAtUtc-after-observedAtUtc')));
});

test('non-string hostile claim IDs fail closed without throwing', () => {
  const hostile = currentClaim({ claimId: Symbol('hostile-claim-id'), supersedesClaimId: null });
  let result;
  assert.doesNotThrow(() => {
    result = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [hostile] });
  });
  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'SAFE_HOLD');
  assert(result.validationErrors.some((error) => error.includes('claimId-invalid')));
});

test('rejects accessors, custom prototypes and sparse arrays before reading authority-bearing fields', () => {
  let accessorReads = 0;
  const hostile = currentClaim({ claimId: 'claim-hostile', supersedesClaimId: null });
  Object.defineProperty(hostile, 'authorityClass', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'SHARED_AUTHORITY';
    },
  });
  const accessorResult = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [hostile] });
  assert.equal(accessorResult.valid, false);
  assert.equal(accessorReads, 0);

  const custom = Object.setPrototypeOf(currentClaim({ claimId: 'claim-custom', supersedesClaimId: null }), { poisoned: true });
  const customResult = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: [custom] });
  assert.equal(customResult.valid, false);

  const sparse = [];
  sparse.length = 2;
  sparse[1] = currentClaim({ claimId: 'claim-sparse', supersedesClaimId: null });
  const sparseResult = buildStephanosSemanticMemoryV1({ observedAtUtc: OBSERVED_AT, claims: sparse });
  assert.equal(sparseResult.valid, false);
});

test('projection identity is deterministic and all mutation authority remains false', () => {
  const input = { observedAtUtc: OBSERVED_AT, claims: [claim(), currentClaim()] };
  const first = buildStephanosSemanticMemoryV1(input);
  const second = buildStephanosSemanticMemoryV1(input);
  assert.equal(first.projectionId, second.projectionId);
  assert.match(first.projectionId, /^semantic-[0-9a-f]{32}$/);
  assert(Object.values(first.authority).every((allowed) => allowed === false));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.claims), true);
});
