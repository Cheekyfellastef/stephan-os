import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_BLOCKED,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_READY,
  buildForgeShadowM3OfficialReleaseObservationExecutionBindingDigest,
  planForgeShadowM3OfficialReleaseObservationExecutionContract,
} from './forgeShadowM3OfficialReleaseObservationExecutionContractV1.mjs';

const HEAD = 'a18c732f534d2cf9467a4799ec8dadb9a813a240';
const TREE = '2495a1af0f106ccc714561ca11a5eceee869cc62';

function input(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    canonicalMainTree: TREE,
    requestedAtUtc: '2026-08-08T04:00:00+01:00',
    requestId: 'forge-m3-official-release-observation-request-v1',
    observationId: 'forge-m3-official-release-observation-v1',
    ...patch,
  };
}

function containsKey(value, candidates) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidates.has(normalized)) return true;
    if (containsKey(nested, candidates)) return true;
  }
  return false;
}

test('emits one deterministic metadata-only execution request contract', () => {
  const left = planForgeShadowM3OfficialReleaseObservationExecutionContract(input());
  const right = planForgeShadowM3OfficialReleaseObservationExecutionContract(input());
  assert.equal(left.valid, true);
  assert.equal(left.finalVerdict, FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_READY);
  assert.equal(left.requestBindingDigest, right.requestBindingDigest);
  assert.deepEqual(left.executionRequest, right.executionRequest);
  assert.equal(left.executionRequest.executionMode, 'metadata-observation-request-only');
});

test('binds the request to repository, current main head, tree, timestamp, and distinct identities', () => {
  const ready = planForgeShadowM3OfficialReleaseObservationExecutionContract(input());
  assert.equal(ready.executionRequest.requestBindingDigest,
    buildForgeShadowM3OfficialReleaseObservationExecutionBindingDigest(input()));

  for (const patch of [
    { repository: 'other/repo' },
    { canonicalMainHead: 'not-a-sha' },
    { canonicalMainTree: 'not-a-tree' },
    { requestedAtUtc: '2026-08-08T04:00:00' },
    { requestId: 'x' },
    { observationId: 'x' },
    { observationId: 'forge-m3-official-release-observation-request-v1' },
  ]) {
    assert.equal(planForgeShadowM3OfficialReleaseObservationExecutionContract(input(patch)).valid, false);
  }
});

test('rejects missing, extra, or malformed input fields', () => {
  const { observationId, ...missing } = input();
  assert.equal(planForgeShadowM3OfficialReleaseObservationExecutionContract(missing).valid, false);
  assert.equal(planForgeShadowM3OfficialReleaseObservationExecutionContract({
    ...input(),
    unexpected: true,
  }).valid, false);
  assert.equal(planForgeShadowM3OfficialReleaseObservationExecutionContract(null).valid, false);
});

test('rejects recursive caller authority, location, version, credential, and binary fields', () => {
  const hostile = [
    { nested: { url: 'https://example.invalid' } },
    { nested: { path: '/tmp/runner' } },
    { nested: { command: 'observe' } },
    { nested: { endpoint: 'example.invalid' } },
    { nested: { token: 'secret' } },
    { nested: { credentials: { value: 'secret' } } },
    { nested: { selectedVersion: '9.4.2' } },
    { nested: { mutableReference: 'latest' } },
    { nested: { download_url: 'https://example.invalid/runner' } },
    { nested: { binary: 'bytes' } },
    { nested: { payload: { data: 'bytes' } } },
  ];
  for (const patch of hostile) {
    const result = planForgeShadowM3OfficialReleaseObservationExecutionContract({ ...input(), ...patch });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.some((blocker) => blocker.startsWith('unsafe-field:')));
  }
});

test('fixes official-source discovery without selecting a live version or caller location', () => {
  const result = planForgeShadowM3OfficialReleaseObservationExecutionContract(input());
  const discovery = result.executionRequest.discoveryContract;
  assert.equal(discovery.routeIdentity, FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE);
  assert.equal(discovery.sourceIdentity, 'forgejo-official-runner-release');
  assert.equal(discovery.releaseChannel, 'stable');
  assert.equal(discovery.selectionPolicy, 'highest-stable-semver-only');
  assert.equal(discovery.callerSourceSelectionAccepted, false);
  assert.equal(discovery.callerMutableReferenceAccepted, false);
  assert.equal(discovery.liveReleaseSelected, false);
  assert.equal(discovery.observationPerformed, false);
  assert.equal(containsKey(discovery, new Set([
    'url', 'uri', 'path', 'endpoint', 'host', 'selectedversion', 'releaseversion', 'artifactlocation',
  ])), false);
});

test('requires exactly the fixed Linux and Windows metadata observation estate', () => {
  const result = planForgeShadowM3OfficialReleaseObservationExecutionContract(input());
  const observations = result.executionRequest.requiredArtifactObservations;
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((item) => item.runnerClass), [
    'linux-isolated',
    'windows-proof-isolated',
  ]);
  assert.deepEqual(observations.map((item) => item.platform), ['linux/amd64', 'windows/amd64']);
  assert.deepEqual(observations.map((item) => item.artifactId), [
    'forge-m3-linux-runner-artifact-v1',
    'forge-m3-windows-proof-runner-artifact-v1',
  ]);
  assert.equal(new Set(observations.map((item) => item.artifactId)).size, 2);
  assert.equal(new Set(observations.map((item) => item.runnerClass)).size, 2);
  assert.ok(observations.every((item) => item.metadataOnly && !item.artifactPayloadRequested));
  assert.ok(observations.every((item) => item.minimumArtifactBytes === 1024 * 1024));
  assert.ok(observations.every((item) => item.maximumArtifactBytes === 512 * 1024 * 1024));
});

test('preserves the merged observation receipt verification requirements', () => {
  const receipt = planForgeShadowM3OfficialReleaseObservationExecutionContract(input())
    .executionRequest.receiptContract;
  assert.equal(receipt.maximumObservationAgeSeconds, 86400);
  assert.equal(receipt.explicitTimezoneRequired, true);
  assert.equal(receipt.stableSemanticVersionRequired, true);
  assert.equal(receipt.tlsVerificationRequired, true);
  assert.equal(receipt.releaseManifestVerificationRequired, true);
  assert.equal(receipt.checksumManifestVerificationRequired, true);
  assert.equal(receipt.provenanceVerificationRequired, true);
  assert.equal(receipt.mutableReferenceAccepted, false);
  assert.equal(receipt.credentialUseAccepted, false);
  assert.equal(receipt.callerSourceSelectionAccepted, false);
  assert.equal(receipt.artifactPayloadAccepted, false);
  assert.equal(receipt.filesystemMutationAccepted, false);
});

test('projects zero runtime, source, credential, merge, and deployment authority', () => {
  const authority = planForgeShadowM3OfficialReleaseObservationExecutionContract(input()).authority;
  for (const [key, value] of Object.entries(authority)) {
    assert.equal(value, key === 'separateObservationExecutionAuthorizationRequired', key);
  }
});

test('changes the binding digest when an exact identity changes', () => {
  const baseline = planForgeShadowM3OfficialReleaseObservationExecutionContract(input()).requestBindingDigest;
  for (const patch of [
    { canonicalMainHead: 'b'.repeat(40) },
    { canonicalMainTree: 'c'.repeat(40) },
    { requestedAtUtc: '2026-08-08T04:01:00+01:00' },
    { requestId: 'forge-m3-official-release-observation-request-v2' },
    { observationId: 'forge-m3-official-release-observation-v2' },
  ]) {
    const changed = planForgeShadowM3OfficialReleaseObservationExecutionContract(input(patch));
    assert.equal(changed.valid, true);
    assert.notEqual(changed.requestBindingDigest, baseline);
  }
});

test('blocked evidence emits bounded blockers and no execution request or digest', () => {
  const blocked = planForgeShadowM3OfficialReleaseObservationExecutionContract({
    ...input(),
    sourceUrl: 'https://example.invalid',
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.finalVerdict, FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_BLOCKED);
  assert.ok(blocked.blockers.length >= 1);
  assert.equal(blocked.executionRequest, null);
  assert.equal(blocked.requestBindingDigest, '');
  assert.equal(blocked.authority.networkFetch, false);
  assert.equal(blocked.authority.metadataObservation, false);
});
