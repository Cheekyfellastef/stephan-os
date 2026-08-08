import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_RECEIPT_SCHEMA,
  buildForgeShadowM3OfficialReleaseSourceBindingDigest,
  planForgeShadowM3OfficialReleaseObservation,
} from './forgeShadowM3OfficialReleaseObservationBoundaryV1.mjs';
import {
  FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY,
  resolveForgeShadowM3RunnerArtifacts,
} from './forgeShadowM3RunnerArtifactResolverV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const RELEASE = `sha256:${'1'.repeat(64)}`;
const CHECKSUM = `sha256:${'2'.repeat(64)}`;
const PROVENANCE = `sha256:${'3'.repeat(64)}`;
const LINUX = `sha256:${'4'.repeat(64)}`;
const WINDOWS = `sha256:${'5'.repeat(64)}`;
const NOW = '2026-08-08T01:15:00Z';

function asset(platform, patch = {}) {
  const linux = platform === 'linux/amd64';
  const digest = linux ? LINUX : WINDOWS;
  return {
    assetId: linux
      ? 'forge-m3-linux-runner-artifact-v1'
      : 'forge-m3-windows-proof-runner-artifact-v1',
    platform,
    artifactLogicalId: linux
      ? 'forgejo-runner-linux-amd64'
      : 'forgejo-runner-windows-amd64',
    artifactDigest: digest,
    checksumDigest: digest,
    manifestEntryDigest: `sha256:${linux ? '6'.repeat(64) : '7'.repeat(64)}`,
    artifactBytes: 8 * 1024 * 1024,
    contentType: 'application/octet-stream',
    executableFormat: linux ? 'elf' : 'pe',
    proofRefs: [`proofs/forge-m3/official-release/${linux ? 'linux' : 'windows'}-asset.json`],
    metadataOnly: true,
    binaryContentPresent: false,
    callerLocationAccepted: false,
    ...patch,
  };
}

function receipt(patch = {}) {
  const observationId = patch.observationId || 'forge-m3-official-release-observation-001';
  const sourceBindingDigest = buildForgeShadowM3OfficialReleaseSourceBindingDigest({
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    canonicalMainTree: TREE,
    observationId,
  });
  return {
    schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_RECEIPT_SCHEMA,
    observationId,
    observerClass: 'source-controlled-readonly-official-release-observer',
    sourceIdentity: 'forgejo-official-runner-release',
    releaseChannel: 'stable',
    version: '9.4.2',
    observedAtUtc: '2026-08-08T01:00:00Z',
    sourceBindingDigest,
    releaseManifestDigest: RELEASE,
    checksumManifestDigest: CHECKSUM,
    provenanceDigest: PROVENANCE,
    proofRefs: ['proofs/forge-m3/official-release/release.json'],
    tlsVerified: true,
    releaseManifestVerified: true,
    checksumManifestVerified: true,
    provenanceVerified: true,
    mutableReferenceAccepted: false,
    credentialUsed: false,
    callerEndpointAccepted: false,
    artifactDownloadPerformed: false,
    filesystemWritePerformed: false,
    assets: [asset('windows/amd64'), asset('linux/amd64')],
    ...patch,
  };
}

function input(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    canonicalMainTree: TREE,
    nowUtc: NOW,
    observationReceipt: receipt(),
    ...patch,
  };
}

const blockers = (result) => new Set(result.blockers);

function hasForbiddenLocationKey(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    if (['url', 'uri', 'path', 'file', 'filename', 'binary', 'base64', 'payload'].includes(key.toLowerCase())) {
      return true;
    }
    if (hasForbiddenLocationKey(nested)) return true;
  }
  return false;
}

test('emits deterministic resolver-compatible evidence regardless of asset order', () => {
  const left = planForgeShadowM3OfficialReleaseObservation(input());
  const reversedReceipt = receipt({ assets: [...receipt().assets].reverse() });
  const right = planForgeShadowM3OfficialReleaseObservation(input({ observationReceipt: reversedReceipt }));
  assert.equal(left.valid, true);
  assert.equal(left.finalVerdict, FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY);
  assert.equal(left.observationEvidenceDigest, right.observationEvidenceDigest);
  assert.equal(left.artifactResolutionPreview.artifactSetDigest, right.artifactResolutionPreview.artifactSetDigest);
  assert.deepEqual(left.artifactResolutionPreview.artifactResolutions.map((item) => item.runnerClass), [
    'linux-isolated', 'windows-proof-isolated',
  ]);
});

test('replays the merged artifact resolver against the emitted release observation', () => {
  const boundary = planForgeShadowM3OfficialReleaseObservation(input());
  const resolution = resolveForgeShadowM3RunnerArtifacts({
    repository: boundary.repository,
    canonicalMainHead: boundary.canonicalMainHead,
    canonicalMainTree: boundary.canonicalMainTree,
    nowUtc: NOW,
    releaseObservation: boundary.releaseObservation,
  });
  assert.equal(resolution.valid, true);
  assert.equal(resolution.finalVerdict, FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY);
  assert.equal(resolution.artifactSetDigest, boundary.artifactResolutionPreview.artifactSetDigest);
});

test('binds the observation to the exact repository, head, tree, and observation identity', () => {
  for (const patch of [
    { repository: 'other/repo' },
    { canonicalMainHead: 'f'.repeat(40) },
    { canonicalMainTree: 'f'.repeat(40) },
    { nowUtc: 'not-a-time' },
  ]) assert.equal(planForgeShadowM3OfficialReleaseObservation(input(patch)).valid, false);
  const forged = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ sourceBindingDigest: `sha256:${'9'.repeat(64)}` }),
  }));
  assert.ok(blockers(forged).has('source-binding-digest-mismatch'));
});

test('rejects caller locations, commands, credentials, and binary-shaped surfaces recursively', () => {
  for (const unsafe of [
    { url: 'https://example.invalid/release' },
    { nested: { path: '/tmp/runner' } },
    { nested: { command: 'download' } },
    { nested: { token: 'secret' } },
    { nested: { binary: 'base64-data' } },
    { nested: { payload: { data: 'bytes' } } },
  ]) {
    const result = planForgeShadowM3OfficialReleaseObservation({ ...input(), ...unsafe });
    assert.ok([...blockers(result)].some((code) => code.startsWith('unsafe-field:')));
  }
});

test('requires exactly the fixed Linux and Windows metadata-only asset estate', () => {
  const missing = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ assets: [asset('linux/amd64')] }),
  }));
  assert.ok(blockers(missing).has('asset-estate-must-be-exactly-two'));

  const duplicate = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ assets: [asset('linux/amd64'), asset('linux/amd64')] }),
  }));
  assert.ok(blockers(duplicate).has('asset-runner-class-duplicate'));

  const wrongIdentity = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ assets: [
      asset('linux/amd64', { artifactLogicalId: 'caller-chosen-runner' }),
      asset('windows/amd64', { executableFormat: 'elf' }),
    ] }),
  }));
  assert.ok([...blockers(wrongIdentity)].some((code) => code.startsWith('asset-logical-id-mismatch:')));
  assert.ok([...blockers(wrongIdentity)].some((code) => code.startsWith('asset-executable-format-mismatch:')));
});

test('rejects stale, future, unstable, mutable, credentialed, or unverified release evidence', () => {
  const patches = [
    { observedAtUtc: '2026-08-06T00:00:00Z' },
    { observedAtUtc: '2026-08-08T02:00:00Z' },
    { releaseChannel: 'nightly' },
    { version: '9.4.2-rc1' },
    { mutableReferenceAccepted: true },
    { credentialUsed: true },
    { callerEndpointAccepted: true },
    { tlsVerified: false },
    { releaseManifestVerified: false },
    { checksumManifestVerified: false },
    { provenanceVerified: false },
  ];
  for (const patch of patches) {
    assert.equal(planForgeShadowM3OfficialReleaseObservation(input({
      observationReceipt: receipt(patch),
    })).valid, false);
  }
});

test('forbids artifact download, filesystem writes, binary content, and caller-selected locations', () => {
  for (const patch of [
    { artifactDownloadPerformed: true },
    { filesystemWritePerformed: true },
    { assets: [asset('linux/amd64', { binaryContentPresent: true }), asset('windows/amd64')] },
    { assets: [asset('linux/amd64'), asset('windows/amd64', { callerLocationAccepted: true })] },
    { assets: [asset('linux/amd64', { metadataOnly: false }), asset('windows/amd64')] },
  ]) {
    assert.equal(planForgeShadowM3OfficialReleaseObservation(input({
      observationReceipt: receipt(patch),
    })).valid, false);
  }
});

test('rejects checksum drift, duplicate artifact digests, invalid size, and unsafe proof references', () => {
  const checksumDrift = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ assets: [
      asset('linux/amd64', { checksumDigest: `sha256:${'8'.repeat(64)}` }),
      asset('windows/amd64'),
    ] }),
  }));
  assert.ok([...blockers(checksumDrift)].some((code) => code.startsWith('asset-checksum-mismatch:')));

  const duplicateDigest = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ assets: [
      asset('linux/amd64'),
      asset('windows/amd64', { artifactDigest: LINUX, checksumDigest: LINUX }),
    ] }),
  }));
  assert.ok(blockers(duplicateDigest).has('artifact-digest-duplicate'));

  for (const assetPatch of [
    { artifactBytes: 10 },
    { proofRefs: ['../unsafe'] },
  ]) {
    assert.equal(planForgeShadowM3OfficialReleaseObservation(input({
      observationReceipt: receipt({ assets: [asset('linux/amd64', assetPatch), asset('windows/amd64')] }),
    })).valid, false);
  }
});

test('emits the exact resolver releaseObservation shape without any caller location or binary field', () => {
  const result = planForgeShadowM3OfficialReleaseObservation(input());
  assert.deepEqual(Object.keys(result.releaseObservation).sort(), [
    'assets', 'checksumManifestDigest', 'checksumManifestVerified', 'credentialUsed',
    'mutableReferenceAccepted', 'observedAtUtc', 'proofRefs', 'provenanceDigest',
    'releaseChannel', 'releaseManifestDigest', 'releaseManifestVerified',
    'sourceIdentity', 'tlsVerified', 'version',
  ].sort());
  assert.equal(hasForbiddenLocationKey(result.releaseObservation), false);
  assert.ok(result.releaseObservation.assets.every((item) => !hasForbiddenLocationKey(item)));
});

test('projects zero authority and fails closed without propagating rejected evidence', () => {
  const ready = planForgeShadowM3OfficialReleaseObservation(input());
  for (const [key, value] of Object.entries(ready.authority)) {
    assert.equal(value, key === 'separateObservationExecutionAuthorizationRequired', key);
  }
  assert.equal(ready.observationContract.metadataOnly, true);
  assert.equal(ready.observationContract.callerEndpointAccepted, false);
  assert.equal(ready.observationContract.binaryContentAccepted, false);
  assert.equal(ready.observationContract.artifactDownloadPerformed, false);

  const blocked = planForgeShadowM3OfficialReleaseObservation(input({
    observationReceipt: receipt({ artifactDownloadPerformed: true }),
  }));
  assert.equal(blocked.valid, false);
  assert.equal(blocked.finalVerdict, FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED);
  assert.equal(blocked.releaseObservation, null);
  assert.equal(blocked.artifactResolutionPreview, null);
  assert.equal(blocked.observationEvidenceDigest, '');
});
