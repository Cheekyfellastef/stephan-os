import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planForgeShadowM3OfficialReleaseObservationExecutionContract,
} from './forgeShadowM3OfficialReleaseObservationExecutionContractV1.mjs';
import {
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_BLOCKED,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_READY,
  planForgeShadowM3OfficialReleaseMetadataObserverAdapter,
} from './forgeShadowM3OfficialReleaseMetadataObserverAdapterPlanV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const REQUESTED_AT = '2026-08-08T07:00:00Z';
const PREPARED_AT = '2026-08-08T07:05:00Z';

function executionRequest(patch = {}) {
  return planForgeShadowM3OfficialReleaseObservationExecutionContract({
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    canonicalMainTree: TREE,
    requestedAtUtc: REQUESTED_AT,
    requestId: 'forge-m3-observation-request-001',
    observationId: 'forge-m3-observation-001',
    ...patch,
  }).executionRequest;
}

function input(patch = {}) {
  return {
    adapterId: 'forge-m3-official-release-metadata-observer-adapter-v1',
    preparedAtUtc: PREPARED_AT,
    executionRequest: executionRequest(),
    ...patch,
  };
}

test('emits one deterministic adapter plan bound to the exact execution request', () => {
  const first = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input());
  const second = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input());
  assert.equal(first.valid, true);
  assert.equal(first.finalVerdict, FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_READY);
  assert.deepEqual(first, second);
  assert.match(first.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.adapterPlan.requestIdentity.requestBindingDigest, executionRequest().requestBindingDigest);
});

test('fixes source, route, stable selection, receipt schema and four bounded steps', () => {
  const result = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input());
  assert.equal(result.adapterPlan.discoveryRoute, 'forgejo-official-runner-stable-release-metadata-v1');
  assert.equal(result.adapterPlan.sourceIdentity, 'forgejo-official-runner-release');
  assert.equal(result.adapterPlan.releaseChannel, 'stable');
  assert.equal(result.adapterPlan.stableSelectionPolicy, 'highest-stable-semver-only');
  assert.equal(result.adapterPlan.expectedReceiptSchema, 'stephanos.forge-shadow-m3-official-release-observation-receipt.v1');
  assert.deepEqual(result.adapterPlan.steps.map((step) => step.stepId), [
    'validate-exact-execution-request',
    'observe-fixed-official-stable-release-metadata',
    'verify-release-checksum-and-provenance-manifest-metadata',
    'project-bound-observation-receipt',
  ]);
});

test('rejects a forged request binding or changed nested contract', () => {
  const request = executionRequest();
  for (const forged of [
    { ...request, requestBindingDigest: 'sha256:' + '9'.repeat(64) },
    { ...request, executionMode: 'live-download' },
    { ...request, discoveryContract: { ...request.discoveryContract, releaseChannel: 'nightly' } },
    { ...request, receiptContract: { ...request.receiptContract, credentialUseAccepted: true } },
  ]) {
    const result = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input({ executionRequest: forged }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('execution-request-contract-mismatch'));
  }
});

test('rejects malformed, impossible, early, or stale preparation timestamps', () => {
  for (const preparedAtUtc of [
    '2026-02-30T07:05:00Z',
    '2026-08-08T06:59:59Z',
    '2026-08-08T07:15:00.001Z',
    '2026-08-08T07:05:00',
  ]) {
    assert.equal(planForgeShadowM3OfficialReleaseMetadataObserverAdapter(
      input({ preparedAtUtc }),
    ).valid, false);
  }
});

test('rejects invalid execution-request identities without propagating a plan', () => {
  for (const patch of [
    { repository: 'example/other' },
    { canonicalMainHead: 'not-a-head' },
    { requestId: 'x' },
    { observationId: 'forge-m3-observation-request-001' },
  ]) {
    const result = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(
      input({ executionRequest: executionRequest(patch) }),
    );
    assert.equal(result.valid, false);
    assert.equal(result.adapterPlan, null);
    assert.equal(result.planDigest, '');
  }
});

test('rejects extra caller endpoint, version, command, credential, or payload surfaces', () => {
  for (const extra of [
    { url: 'https://example.invalid' },
    { selectedVersion: '99.0.0' },
    { command: 'download' },
    { token: 'secret' },
    { payload: 'bytes' },
  ]) {
    const result = planForgeShadowM3OfficialReleaseMetadataObserverAdapter({ ...input(), ...extra });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('input-shape-invalid'));
  }
});

test('projects zero execution authority and preserves a separate observation gate', () => {
  const result = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input());
  for (const [key, value] of Object.entries(result.authority)) {
    assert.equal(value, key === 'separateObservationExecutionAuthorizationRequired');
  }
  assert.ok(result.adapterPlan.steps.every((step) => step.networkAccess === false));
  assert.ok(result.adapterPlan.steps.every((step) => step.artifactPayloadAccess === false));
  assert.equal(result.adapterPlan.constraints.observationPerformedByThisPlan, false);
});

test('never emits endpoint, command, credential, binary, or payload fields', () => {
  const serialized = JSON.stringify(
    planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input()),
  ).toLowerCase();
  for (const forbidden of ['"url"', '"endpoint"', '"command"', '"token"', '"credential"', '"binary"', '"payload"']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('changes the plan digest when the adapter identity or preparation time changes', () => {
  const baseline = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input()).planDigest;
  const changedId = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input({
    adapterId: 'forge-m3-official-release-metadata-observer-adapter-v2',
  })).planDigest;
  const changedTime = planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input({
    preparedAtUtc: '2026-08-08T07:06:00Z',
  })).planDigest;
  assert.notEqual(changedId, baseline);
  assert.notEqual(changedTime, baseline);
});

test('blocked input fails closed with bounded deterministic blockers', () => {
  const first = planForgeShadowM3OfficialReleaseMetadataObserverAdapter({});
  const second = planForgeShadowM3OfficialReleaseMetadataObserverAdapter({});
  assert.equal(first.valid, false);
  assert.equal(first.finalVerdict, FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_BLOCKED);
  assert.equal(first.adapterPlan, null);
  assert.equal(first.planDigest, '');
  assert.deepEqual(first.blockers, second.blockers);
});
