import assert from 'node:assert/strict';
import test from 'node:test';

import { projectVrTeachingIntoSharedWorkspace } from './vrTeachingWorkspaceProjectionV1.mjs';

const UPDATED_AT = '2026-09-16T21:15:00.000Z';

function teaching(overrides = {}) {
  return {
    teachingKey: 'teach:meta-xr-simulator:standalone-v1',
    candidateKey: 'vrdisc:meta-xr-simulator:standalone-v1',
    sourceId: 'meta-xr-simulator',
    observedIdentity: 'docs-2026-09-03',
    sourceCommentId: '5690374125',
    teachingCommentId: '5703945063',
    evidencePlanes: ['NORMATIVE_OR_OFFICIAL_SPECIFICATION', 'STEPHANOS_INFERENCE_OR_PROPOSAL'],
    confidence: 'high-official-docs; derived-method-bounded',
    licenceBoundary: 'Proprietary Meta tooling; method-level inference only.',
    reusableMethod: 'Simulator-first OpenXR preflight followed by physical-headset proof.',
    applicability: 'OpenXR protocol/input/compositor preflight.',
    nonApplicability: 'Does not prove Starfield, Air Link or Quest 3 runtime success.',
    constraints: ['Simulator support envelope only'],
    failureModes: ['Simulator success mistaken for headset proof'],
    fallback: 'Require physical Quest evidence rung.',
    requiredProofLevel: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF for physical-device claims',
    parityProjectionState: 'NOT_APPLICABLE',
    proofRefs: ['proofs/vr-teaching/meta-xr-simulator'],
    ...overrides,
  };
}

test('projects a governed teaching record into capability graph and method library visible to the VR agent', () => {
  const result = projectVrTeachingIntoSharedWorkspace({
    teachingRecords: [teaching()],
    sourceRegistry: { schema_version: '1.6', sources: [] },
    workspaceModel: { schemaVersion: 'stephanos.vr-research-lab.workspace.v2', targets: [{ name: 'Starfield VR' }], experiments: [] },
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });
  assert.equal(result.projection.capabilityGraphCandidates.length, 1);
  assert.equal(result.projection.methodLibrary.length, 1);
  assert.equal(result.agentReadModel.graphCandidates.length, 1);
  assert.equal(result.agentReadModel.ready, true);
  assert.equal(result.projectionReceipt.counters.projected, 1);
  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
});

test('deduplicates the same teaching identity in one projection cycle', () => {
  const item = teaching();
  const result = projectVrTeachingIntoSharedWorkspace({ teachingRecords: [item, item], updatedAt: UPDATED_AT, nowMs: Date.parse(UPDATED_AT) });
  assert.equal(result.projection.methodLibrary.length, 1);
  assert.equal(result.projectionReceipt.counters.duplicatesSuppressed, 1);
});

test('blocks incomplete teaching rather than strengthening uncertain evidence', () => {
  const result = projectVrTeachingIntoSharedWorkspace({
    teachingRecords: [teaching({ licenceBoundary: '', proofRefs: [] })],
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });
  assert.equal(result.projection.methodLibrary.length, 0);
  assert.equal(result.projectionReceipt.counters.policyBlocked, 1);
  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
});

test('rejects whitespace-only proof references', () => {
  const result = projectVrTeachingIntoSharedWorkspace({
    teachingRecords: [teaching({ proofRefs: ['   '] })],
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });
  assert.equal(result.projectionReceipt.counters.policyBlocked, 1);
  assert.match(result.projectionReceipt.policyBlocked[0].errors.join(','), /missing-proofRefs/);
});

test('preserves existing workspace knowledge while appending a teaching', () => {
  const result = projectVrTeachingIntoSharedWorkspace({
    teachingRecords: [teaching()],
    capabilityGraphCandidates: [{ candidateKey: 'existing-graph', reusableMethod: 'Existing graph method' }],
    methodLibrary: [{ teachingKey: 'existing-method', reusableMethod: 'Existing method' }],
    proofRefs: ['proofs/existing'],
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });
  assert.equal(result.projection.capabilityGraphCandidates.length, 2);
  assert.equal(result.projection.methodLibrary.length, 2);
  assert.deepEqual(result.projection.proofRefs, ['proofs/existing', 'proofs/vr-teaching/meta-xr-simulator']);
});

test('forbids a teaching record from self-asserting Shared Workspace confirmation', () => {
  const result = projectVrTeachingIntoSharedWorkspace({
    teachingRecords: [teaching({ sharedWorkspaceProjectionState: 'CONFIRMED' })],
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });
  assert.equal(result.projectionReceipt.counters.policyBlocked, 1);
  assert.match(result.projectionReceipt.policyBlocked[0].errors.join(','), /self-confirmed-projection-forbidden/);
});
