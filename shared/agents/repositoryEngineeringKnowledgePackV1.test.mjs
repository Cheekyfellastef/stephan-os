import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_AUTHORITY_V1,
  REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_SCHEMA_V1,
  buildRepositoryEngineeringKnowledgePackV1,
  isRepositoryEngineeringKnowledgePackCurrentV1,
  validateRepositoryEngineeringKnowledgePackInputV1,
} from './repositoryEngineeringKnowledgePackV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);

function canonicalInput(overrides = {}) {
  return {
    originatingGoalOrWorkId: '#1957',
    repository: 'Cheekyfellastef/stephan-os',
    baseHead: HEAD,
    baseTree: TREE,
    createdAtUtc: '2026-08-22T13:10:00.000Z',
    ownerRefs: ['#1957'],
    relatedGoalAndPrRefs: ['#1956', '#1776'],
    relevantPaths: [
      'shared/agents/repositoryEngineeringKnowledgePackV1.mjs',
      'shared/agents/repositoryEngineeringKnowledgePackV1.test.mjs',
    ],
    interfacesAndSchemas: ['stephanos.repository-engineering-knowledge-pack.v1'],
    invariants: [
      'One canonical owner remains authoritative.',
      'Current exact base identity is required before implementation.',
    ],
    forbiddenChanges: [
      'Do not create another scheduler, repository index or review system.',
      'Do not grant source, merge, deployment or runtime authority.',
    ],
    dependencies: ['#1308', '#1556', '#1645', '#1607'],
    knownIncidentsAndFailureModes: ['stale exact-head evidence can invalidate a previously green review'],
    requiredTests: ['shared/agents/repositoryEngineeringKnowledgePackV1.test.mjs'],
    reviewAndRiskClass: 'STANDARD_PROVIDER_NEUTRAL_REVIEW',
    externalEvidenceRefs: ['proof:current-main'],
    methodRefs: ['method:preservation-convergence'],
    freshness: 'CURRENT',
    conflicts: [],
    sizeBudget: { maxBytes: 24 * 1024 },
    omittedSensitiveState: true,
    acceptanceAndProofWriteback: ['#1956', '#1607'],
    authority: { ...REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_AUTHORITY_V1 },
    ...overrides,
  };
}

test('builds one deterministic immutable exact-current repository engineering pack', () => {
  const first = buildRepositoryEngineeringKnowledgePackV1(canonicalInput());
  const second = buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ providerClass: 'OPENCLAW_LOCAL' }));

  assert.equal(first.schemaVersion, REPOSITORY_ENGINEERING_KNOWLEDGE_PACK_SCHEMA_V1);
  assert.equal(first.packId, second.packId);
  assert.deepEqual(first.ownerRefs, ['#1957']);
  assert.deepEqual(first.relevantPaths, [...first.relevantPaths].sort());
  assert.equal(first.authority.sourceMutationAllowed, false);
  assert.equal(first.authority.mergeAllowed, false);
  assert.equal(first.authority.runtimeMutationAllowed, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.authority), true);
  assert.equal(isRepositoryEngineeringKnowledgePackCurrentV1(first, { baseHead: HEAD, baseTree: TREE }), true);
});

test('rejects duplicate, unsafe and absolute relevant paths', () => {
  for (const relevantPaths of [
    ['shared/agents/example.mjs', 'shared/agents/example.mjs'],
    ['../outside.mjs'],
    ['C:\\temp\\outside.mjs'],
    ['/absolute/path.mjs'],
  ]) {
    const result = validateRepositoryEngineeringKnowledgePackInputV1(canonicalInput({ relevantPaths }));
    assert.equal(result.valid, false);
    assert.equal(result.pack, null);
  }
});

test('fails closed on missing or ambiguous ownership and malformed exact identity', () => {
  assert.throws(
    () => buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ ownerRefs: [] })),
    /owner-refs-too-short/,
  );
  assert.throws(
    () => buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ ownerRefs: ['#1957', '#1956'] })),
    /owner-refs-too-long/,
  );
  assert.throws(
    () => buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ baseHead: 'not-a-sha' })),
    /base-head-invalid/,
  );
  assert.throws(
    () => buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ baseTree: 'not-a-tree' })),
    /base-tree-invalid/,
  );
});

test('refuses stale or conflicting knowledge', () => {
  assert.throws(
    () => buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ freshness: 'STALE' })),
    /freshness-not-current/,
  );
  assert.throws(
    () => buildRepositoryEngineeringKnowledgePackV1(canonicalInput({ conflicts: ['owner identity conflict'] })),
    /conflicting-knowledge-not-admissible/,
  );
});

test('refuses authority widening before producing a pack', () => {
  const result = validateRepositoryEngineeringKnowledgePackInputV1(canonicalInput({
    authority: { sourceMutationAllowed: true },
  }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('authority-widening-rejected'));
});

test('fails closed when the compact pack exceeds its declared byte budget', () => {
  const largeInvariants = Array.from({ length: 20 }, (_, index) => `${index}-${'x'.repeat(400)}`);
  const result = validateRepositoryEngineeringKnowledgePackInputV1(canonicalInput({
    invariants: largeInvariants,
    sizeBudget: { maxBytes: 1024 },
  }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('pack-size-budget-exceeded'));
});

test('a later head or tree change invalidates the old pack', () => {
  const pack = buildRepositoryEngineeringKnowledgePackV1(canonicalInput());
  assert.equal(isRepositoryEngineeringKnowledgePackCurrentV1(pack, {
    baseHead: 'c'.repeat(40),
    baseTree: TREE,
  }), false);
  assert.equal(isRepositoryEngineeringKnowledgePackCurrentV1(pack, {
    baseHead: HEAD,
    baseTree: 'd'.repeat(40),
  }), false);
});
