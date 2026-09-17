import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectVrTeachingIntoSharedWorkspace,
  VR_RUNTIME_ACCEPTANCE_RECEIPT_SCHEMA_VERSION,
} from './vrTeachingWorkspaceProjectionV1.mjs';

const UPDATED_AT = '2026-09-16T21:15:00.000Z';
const SOURCE_REGISTRY = [{ sourceId: 'meta-xr-simulator', observedIdentity: 'docs-2026-09-03' }];

function teaching(overrides = {}) {
  return {
    teachingKey: 'teach:meta-xr-simulator:standalone-v1',
    candidateKey: 'vrdisc:meta-xr-simulator:standalone-v1',
    sourceId: 'meta-xr-simulator',
    observedIdentity: 'docs-2026-09-03',
    evidencePlanes: ['NORMATIVE_OR_OFFICIAL_SPECIFICATION', 'STEPHANOS_INFERENCE_OR_PROPOSAL'],
    confidence: 'high-official-docs; derived-method-bounded',
    licenceBoundary: 'Proprietary Meta tooling; method-level inference only.',
    reusableMethod: 'Simulator-first OpenXR preflight followed by physical-headset proof.',
    proofRefs: ['proofs/vr-teaching/meta-xr-simulator'],
    ...overrides,
  };
}

function project(overrides = {}) {
  return projectVrTeachingIntoSharedWorkspace({
    sourceRegistry: SOURCE_REGISTRY,
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
    ...overrides,
  });
}

function runtimeReceipt(record, proofRef = 'proofs/runtime/accepted') {
  return {
    schemaVersion: VR_RUNTIME_ACCEPTANCE_RECEIPT_SCHEMA_VERSION,
    verdict: 'ACCEPTED',
    proofRef,
    sourceId: record.sourceId,
    observedIdentity: record.observedIdentity,
  };
}

test('projects governed teaching and emits content-bound receipt', () => {
  const result = project({ teachingRecords: [teaching()] });
  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
  assert.equal(result.projectionReceipt.counters.projected, 1);
  assert.match(result.projectionReceipt.contentDigest, /^fnv1a32:[a-f0-9]{8}$/);
});

test('deduplicates same stable teaching key and selects only an explicitly superseding revision', () => {
  const old = teaching({
    observedIdentity: 'docs-2026-09-03',
    freshnessIdentity: '2026-09-03',
    reusableMethod: 'Old',
  });
  const fresh = teaching({
    observedIdentity: 'docs-2026-09-17',
    freshnessIdentity: '2026-09-17',
    supersedesObservedIdentity: 'docs-2026-09-03',
    reusableMethod: 'Fresh',
  });
  const result = project({
    teachingRecords: [old, fresh],
    sourceRegistry: [{ sourceId: 'meta-xr-simulator', observedIdentity: 'docs-2026-09-17' }],
  });
  assert.equal(result.projectionReceipt.counters.projected, 1);
  assert.equal(result.projectionReceipt.counters.duplicatesSuppressed, 1);
  assert.equal(
    result.projection.methodLibrary.find((entry) => entry.teachingKey === fresh.teachingKey).reusableMethod,
    'Fresh',
  );
});

test('fails closed on differing revisions without explicit supersession regardless of input order', () => {
  const v10 = teaching({ observedIdentity: 'v10', freshnessIdentity: 'v10' });
  const v9 = teaching({ observedIdentity: 'v9', freshnessIdentity: 'v9' });
  for (const teachingRecords of [[v10, v9], [v9, v10]]) {
    const result = project({
      teachingRecords,
      sourceRegistry: [
        { sourceId: 'meta-xr-simulator', observedIdentity: teachingRecords[0].observedIdentity },
        { sourceId: 'meta-xr-simulator-secondary', observedIdentity: teachingRecords[1].observedIdentity },
      ],
    });
    assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
    assert.equal(result.projectionReceipt.counters.projected, 0);
    assert.ok(
      result.projectionReceipt.policyBlocked.some((entry) =>
        entry.errors.includes('unproven-revision-supersession') || entry.errors.includes('source-revision-mismatch'),
      ),
    );
  }
});

test('blocks conflicting equal-identity revisions instead of hash-ranking authority-bearing content', () => {
  const left = teaching({ freshnessIdentity: 'same', observedIdentity: 'docs-2026-09-03', reusableMethod: 'Method A' });
  const right = teaching({ freshnessIdentity: 'same', observedIdentity: 'docs-2026-09-03', reusableMethod: 'Method B' });
  const result = project({ teachingRecords: [left, right] });
  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
  assert.equal(result.projectionReceipt.counters.projected, 0);
  assert.equal(result.projectionReceipt.counters.policyBlocked, 1);
  assert.deepEqual(result.projectionReceipt.policyBlocked[0].errors, ['conflicting-equal-identity-revision']);
});

test('treats reordered set-like evidence as the same teaching revision', () => {
  const left = teaching({
    evidencePlanes: ['STEPHANOS_INFERENCE_OR_PROPOSAL', 'NORMATIVE_OR_OFFICIAL_SPECIFICATION'],
    proofRefs: ['proof-b', 'proof-a'],
  });
  const right = teaching({
    evidencePlanes: ['NORMATIVE_OR_OFFICIAL_SPECIFICATION', 'STEPHANOS_INFERENCE_OR_PROPOSAL'],
    proofRefs: ['proof-a', 'proof-b'],
  });
  const result = project({ teachingRecords: [left, right] });
  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
  assert.equal(result.projectionReceipt.counters.projected, 1);
  assert.equal(result.projectionReceipt.counters.duplicatesSuppressed, 1);
});

test('blocks incomplete, unconfident and whitespace-proof teachings', () => {
  for (const patch of [{ licenceBoundary: '' }, { confidence: '   ' }, { proofRefs: ['   '] }]) {
    const result = project({ teachingRecords: [teaching(patch)] });
    assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
    assert.equal(result.projectionReceipt.counters.policyBlocked, 1);
  }
});

test('requires typed source-bound acceptance receipt for every runtime evidence claim', () => {
  const runtime = teaching({
    requiredProofLevel: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF',
    evidencePlanes: ['OBSERVED_RUNTIME_OR_HEADSET_PROOF'],
    proofRefs: ['proofs/runtime/accepted'],
  });

  const missing = project({ teachingRecords: [runtime] });
  assert.equal(missing.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
  assert.ok(missing.projectionReceipt.policyBlocked[0].errors.includes('runtime-acceptance-proof-missing'));

  const legacyOnly = project({
    teachingRecords: [runtime],
    runtimeAcceptanceProofRefs: ['proofs/runtime/accepted'],
  });
  assert.equal(legacyOnly.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');

  const ready = project({
    teachingRecords: [runtime],
    runtimeAcceptanceReceipts: [runtimeReceipt(runtime)],
  });
  assert.equal(ready.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');

  const implicitRuntimeClaim = teaching({
    requiredProofLevel: '',
    evidencePlanes: ['OBSERVED_RUNTIME_OR_HEADSET_PROOF'],
    proofRefs: ['proofs/runtime/accepted'],
  });
  const implicitBlocked = project({ teachingRecords: [implicitRuntimeClaim] });
  assert.equal(implicitBlocked.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
  const implicitReady = project({
    teachingRecords: [implicitRuntimeClaim],
    runtimeAcceptanceReceipts: [runtimeReceipt(implicitRuntimeClaim)],
  });
  assert.equal(implicitReady.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
});

test('requires the canonical source registry and exact registered revision', () => {
  assert.equal(project({ teachingRecords: [teaching()] }).projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');

  const missingRegistry = projectVrTeachingIntoSharedWorkspace({
    teachingRecords: [teaching()],
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });
  assert.equal(missingRegistry.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
  assert.ok(missingRegistry.projectionReceipt.policyBlocked[0].errors.includes('canonical-source-registry-required'));

  for (const record of [teaching({ sourceId: 'invented' }), teaching({ observedIdentity: 'wrong-revision' })]) {
    const result = project({ teachingRecords: [record] });
    assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
  }
});

test('preserves legacy string graph candidates and existing knowledge', () => {
  const result = project({
    teachingRecords: [],
    capabilityGraphCandidates: ['cutscene-theatre', { candidateKey: 'existing-graph' }],
    methodLibrary: [{ teachingKey: 'existing-method', reusableMethod: 'Existing' }],
    proofRefs: ['proofs/existing'],
  });
  assert.deepEqual(result.projection.capabilityGraphCandidates, ['cutscene-theatre', { candidateKey: 'existing-graph' }]);
  assert.equal(result.projection.methodLibrary.length, 1);
  assert.deepEqual(result.projection.proofRefs, ['proofs/existing']);
});

test('refresh replaces stale graph entries through either teaching or candidate identity alias', () => {
  const fresh = teaching({
    teachingKey: 'teach-refresh',
    candidateKey: 'candidate-refresh',
    observedIdentity: 'docs-2026-09-17',
    reusableMethod: 'Fresh method',
  });
  const sourceRegistry = [{ sourceId: 'meta-xr-simulator', observedIdentity: 'docs-2026-09-17' }];
  for (const existing of [
    { candidateKey: 'candidate-refresh', observedIdentity: 'old' },
    { teachingKey: 'teach-refresh', observedIdentity: 'old' },
  ]) {
    const result = project({ teachingRecords: [fresh], capabilityGraphCandidates: [existing], sourceRegistry });
    const candidates = result.projection.capabilityGraphCandidates.filter(
      (entry) => entry?.candidateKey === 'candidate-refresh' || entry?.teachingKey === 'teach-refresh',
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].observedIdentity, 'docs-2026-09-17');
  }
});

test('same method text does not collapse distinct stable graph identities', () => {
  const existing = {
    teachingKey: 'other-teaching',
    candidateKey: 'other-candidate',
    reusableMethod: 'Shared method',
    proofRefs: ['proof-old'],
  };
  const result = project({
    teachingRecords: [teaching({ reusableMethod: 'Shared method' })],
    capabilityGraphCandidates: [existing],
  });
  assert.equal(result.projection.capabilityGraphCandidates.length, 2);
  assert.ok(result.projection.capabilityGraphCandidates.some((entry) => entry?.candidateKey === 'other-candidate'));
});

test('receipt binding changes when authority-bearing teaching content changes', () => {
  const left = project({ teachingRecords: [teaching({ reusableMethod: 'Method A' })] });
  const right = project({ teachingRecords: [teaching({ reusableMethod: 'Method B' })] });
  assert.notEqual(left.projectionReceipt.contentDigest, right.projectionReceipt.contentDigest);
  assert.notEqual(left.projectionReceipt.receiptId, right.projectionReceipt.receiptId);
});

test('forbids self-confirmed projection', () => {
  const result = project({ teachingRecords: [teaching({ sharedWorkspaceProjectionState: 'CONFIRMED' })] });
  assert.equal(result.projectionReceipt.counters.policyBlocked, 1);
});
