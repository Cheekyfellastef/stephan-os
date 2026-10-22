import assert from 'node:assert/strict';
import test from 'node:test';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';
import {
  buildStephanosMemoryAdequacyEvidenceCollectorsV1,
  STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_AUTHORITY,
  STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_INPUT_SCHEMA_V1,
} from './stephanosMemoryAdequacyEvidenceCollectorsV1.mjs';

function item(overrides = {}) {
  return {
    evidenceId: 'evidence:1',
    family: 'GITHUB_GOAL_PR',
    subjectRef: 'issue:1645',
    state: 'OPEN',
    authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY,
    observedAtUtc: '2026-08-17T16:00:00Z',
    source: 'github-connected-read',
    proofRefs: ['github/issues/1645'],
    relationshipRefs: ['goal:1645'],
    retentionDeclared: true,
    ...overrides,
  };
}

function collect(evidence = [item()], observedAtUtc = '2026-08-17T16:10:00Z') {
  return buildStephanosMemoryAdequacyEvidenceCollectorsV1({
    schemaVersion: STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_INPUT_SCHEMA_V1,
    observedAtUtc,
    evidence,
  });
}

test('collects GitHub goal and PR evidence into goal-decision memory', () => {
  const result = collect();
  assert.equal(result.observations[0].domain, 'goal-decision-memory');
  assert.equal(result.observations[0].authorityClass, STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY);
  assert.equal(result.observations[0].recordCount, 1);
});

test('collects all four outstanding evidence families into canonical adequacy domains', () => {
  const result = collect([
    item(),
    item({ evidenceId: 'evidence:2', family: 'RUNTIME_PROOF', subjectRef: 'runtime:bridge', state: 'PROVEN', proofRefs: ['runtime/proof/bridge'], relationshipRefs: [] }),
    item({ evidenceId: 'evidence:3', family: 'LESSON_RELATIONSHIP', subjectRef: 'lesson:lock-race', state: 'VALIDATED', proofRefs: ['memory/lesson/lock-race'], relationshipRefs: ['incident:lock-race'] }),
    item({ evidenceId: 'evidence:4', family: 'SHARED_WORKSPACE_RECEIPT', subjectRef: 'receipt:42', state: 'DONE', proofRefs: ['shared-workspace/receipt/42'], relationshipRefs: ['goal:1645'] }),
  ]);
  assert.deepEqual(result.observations.map((observation) => observation.domain), [
    'goal-decision-memory',
    'runtime-proof-memory',
    'lessons-incident-memory',
    'project-architecture-memory',
  ]);
});

test('mixed evidence never upgrades authority above the weakest member', () => {
  const result = collect([
    item({ evidenceId: 'evidence:a' }),
    item({ evidenceId: 'evidence:b', subjectRef: 'pr:1863', authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR, proofRefs: ['github/pulls/1863'] }),
  ]);
  assert.equal(result.observations[0].authorityClass, STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR);
});

test('unknown authority remains unknown', () => {
  const result = collect([item({ authorityClass: STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN })]);
  assert.equal(result.observations[0].authorityClass, STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN);
});

test('oldest family timestamp is used so freshness cannot be hidden by a newer sibling', () => {
  const result = collect([
    item({ evidenceId: 'evidence:a', observedAtUtc: '2026-08-16T12:00:00Z' }),
    item({ evidenceId: 'evidence:b', subjectRef: 'pr:1863', observedAtUtc: '2026-08-17T16:00:00Z', proofRefs: ['github/pulls/1863'] }),
  ]);
  assert.equal(result.observations[0].observedAtUtc, '2026-08-16T12:00:00.000Z');
});

test('retention is only DECLARED when every evidence item declares it', () => {
  const declared = collect([item(), item({ evidenceId: 'evidence:2', subjectRef: 'pr:1863', proofRefs: ['github/pulls/1863'] })]);
  assert.equal(declared.observations[0].retentionPolicy, 'DECLARED');
  const unknown = collect([item(), item({ evidenceId: 'evidence:2', subjectRef: 'pr:1863', proofRefs: ['github/pulls/1863'], retentionDeclared: false })]);
  assert.equal(unknown.observations[0].retentionPolicy, 'UNKNOWN');
});

test('deletion conflict and backup remain unknown rather than inferred from source presence', () => {
  const observation = collect().observations[0];
  assert.equal(observation.deletionState, 'UNKNOWN');
  assert.equal(observation.conflictState, 'UNKNOWN');
  assert.equal(observation.backupState, 'UNKNOWN');
});

test('unsafe proof references fail closed', () => {
  assert.throws(() => collect([item({ proofRefs: ['../../secret'] })]), /UNSAFE_PROOF_REF/);
  assert.throws(() => collect([item({ proofRefs: ['/tmp/proof'] })]), /UNSAFE_PROOF_REF/);
});

test('unexpected raw content fields are rejected', () => {
  assert.throws(() => collect([{ ...item(), content: 'raw conversation' }]), /UNEXPECTED_FIELD/);
  assert.throws(() => collect([{ ...item(), payload: 'secret' }]), /UNEXPECTED_FIELD/);
});

test('duplicate evidence identities fail closed', () => {
  assert.throws(() => collect([item(), { ...item() }]), /DUPLICATE_EVIDENCE/);
});

test('future-dated evidence beyond tolerance fails closed', () => {
  assert.throws(() => collect([item({ observedAtUtc: '2026-08-17T16:12:00Z' })]), /FUTURE_EVIDENCE/);
});

test('input order does not change observation order or authority result', () => {
  const a = item({ evidenceId: 'evidence:a' });
  const b = item({ evidenceId: 'evidence:b', family: 'RUNTIME_PROOF', subjectRef: 'runtime:x', proofRefs: ['runtime/proof/x'], relationshipRefs: [] });
  assert.deepEqual(collect([b, a]).observations, collect([a, b]).observations);
});

test('accessor-bearing and sparse hostile input fails closed', () => {
  const hostile = item();
  Object.defineProperty(hostile, 'source', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => collect([hostile]), /ACCESSOR_REJECTED/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => collect(sparse), /SPARSE_ARRAY_REJECTED/);
});

test('collector grants no authority upgrades, GitHub writes or runtime mutations', () => {
  for (const [key, value] of Object.entries(STEPHANOS_MEMORY_ADEQUACY_EVIDENCE_AUTHORITY)) {
    assert.equal(value, false, `${key} must remain false`);
  }
  assert.equal(collect().authority.authorityUpgradeAllowed, false);
});
