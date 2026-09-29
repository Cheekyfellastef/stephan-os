import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_BLOCKED,
  FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY,
  resolveForgeShadowM3RunnerArtifacts,
} from './forgeShadowM3RunnerArtifactResolverV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const LINUX = `sha256:${'1'.repeat(64)}`;
const WINDOWS = `sha256:${'2'.repeat(64)}`;
const RELEASE = `sha256:${'3'.repeat(64)}`;
const CHECKSUMS = `sha256:${'4'.repeat(64)}`;
const PROVENANCE = `sha256:${'5'.repeat(64)}`;
const NOW = '2026-08-08T08:00:00Z';

function asset(platform, patch = {}) {
  const linux = platform === 'linux/amd64';
  const digest = linux ? LINUX : WINDOWS;
  return {
    assetId: linux ? 'forge-m3-linux-runner-artifact-v1' : 'forge-m3-windows-proof-runner-artifact-v1',
    platform,
    artifactLogicalId: linux ? 'forgejo-runner-linux-amd64' : 'forgejo-runner-windows-amd64',
    artifactDigest: digest,
    checksumDigest: digest,
    manifestEntryDigest: `sha256:${linux ? '6'.repeat(64) : '7'.repeat(64)}`,
    artifactBytes: 8 * 1024 * 1024,
    contentType: 'application/octet-stream',
    executableFormat: linux ? 'elf' : 'pe',
    proofRefs: [`proofs/forge-m3/${linux ? 'linux' : 'windows'}-runner-asset.json`],
    ...patch,
  };
}
function release(patch = {}) {
  return {
    sourceIdentity: 'forgejo-official-runner-release',
    releaseChannel: 'stable',
    version: '9.4.2',
    observedAtUtc: '2026-08-08T07:50:00Z',
    releaseManifestDigest: RELEASE,
    checksumManifestDigest: CHECKSUMS,
    provenanceDigest: PROVENANCE,
    proofRefs: ['proofs/forge-m3/official-release.json'],
    tlsVerified: true,
    releaseManifestVerified: true,
    checksumManifestVerified: true,
    mutableReferenceAccepted: false,
    credentialUsed: false,
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
    releaseObservation: release(),
    ...patch,
  };
}
const blockers = (result) => new Set(result.blockers);

test('emits deterministic runtime-plan-compatible artifact observations', () => {
  const left = resolveForgeShadowM3RunnerArtifacts(input());
  const right = resolveForgeShadowM3RunnerArtifacts(input({
    releaseObservation: release({ assets: [...release().assets].reverse() }),
  }));
  assert.equal(left.valid, true);
  assert.equal(left.finalVerdict, FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY);
  assert.equal(left.artifactSetDigest, right.artifactSetDigest);
  assert.deepEqual(left.artifactResolutions.map((item) => item.runnerClass), [
    'linux-isolated', 'windows-proof-isolated',
  ]);
  assert.ok(left.artifactResolutions.every((item) => item.tlsVerified && item.releaseManifestVerified && item.checksumVerified));
});


test('emits the exact artifact observation keys consumed by the merged runtime planner', () => {
  const result = resolveForgeShadowM3RunnerArtifacts(input());
  const expectedKeys = [
    'artifactId', 'runnerClass', 'sourceIdentity', 'releaseChannel', 'version', 'platform',
    'artifactLogicalId', 'artifactDigest', 'artifactBytes', 'releaseManifestDigest',
    'checksumManifestDigest', 'provenanceDigest', 'resolvedAtUtc', 'proofRefs',
    'tlsVerified', 'releaseManifestVerified', 'checksumVerified',
    'mutableReferenceAccepted', 'credentialUsed',
  ].sort();
  for (const observation of result.artifactResolutions) {
    assert.deepEqual(Object.keys(observation).sort(), expectedKeys);
  }
});

test('binds repository, head, tree and a fresh explicit-timezone observation', () => {
  for (const patch of [
    { repository: 'other/repo' },
    { canonicalMainHead: 'f'.repeat(39) },
    { canonicalMainTree: 'f'.repeat(39) },
    { nowUtc: 'not-a-time' },
  ]) assert.equal(resolveForgeShadowM3RunnerArtifacts(input(patch)).valid, false);
  const stale = resolveForgeShadowM3RunnerArtifacts(input({
    releaseObservation: release({ observedAtUtc: '2026-08-06T07:00:00Z' }),
  }));
  assert.ok(blockers(stale).has('release-observation-time-out-of-bounds'));
});

test('requires exactly one Linux and one Windows artifact with distinct identities', () => {
  const missing = resolveForgeShadowM3RunnerArtifacts(input({
    releaseObservation: release({ assets: [asset('linux/amd64')] }),
  }));
  assert.ok(blockers(missing).has('artifact-estate-must-be-exactly-two'));
  const duplicate = resolveForgeShadowM3RunnerArtifacts(input({
    releaseObservation: release({ assets: [asset('linux/amd64'), asset('linux/amd64')] }),
  }));
  assert.ok(blockers(duplicate).has('artifact-runner-class-duplicate'));
});

test('requires stable verified immutable release evidence without credentials', () => {
  const patches = [
    { releaseChannel: 'nightly' },
    { version: '9.4.2-rc1' },
    { tlsVerified: false },
    { releaseManifestVerified: false },
    { checksumManifestVerified: false },
    { mutableReferenceAccepted: true },
    { credentialUsed: true },
    { proofRefs: [] },
  ];
  for (const patch of patches) {
    const result = resolveForgeShadowM3RunnerArtifacts(input({ releaseObservation: release(patch) }));
    assert.equal(result.valid, false, JSON.stringify(patch));
  }
});

test('requires exact digest, checksum, size and executable identities', () => {
  const patches = [
    { checksumDigest: `sha256:${'9'.repeat(64)}` },
    { artifactBytes: 12 },
    { contentType: 'application/zip' },
    { executableFormat: 'script' },
    { manifestEntryDigest: 'bad' },
    { proofRefs: [] },
  ];
  for (const patch of patches) {
    const result = resolveForgeShadowM3RunnerArtifacts(input({
      releaseObservation: release({ assets: [asset('linux/amd64', patch), asset('windows/amd64')] }),
    }));
    assert.equal(result.valid, false, JSON.stringify(patch));
  }
});

test('rejects hidden fields and recursive authority-shaped input', () => {
  const extra = resolveForgeShadowM3RunnerArtifacts({ ...input(), extra: true });
  assert.ok(blockers(extra).has('input-fields-invalid'));
  const unsafe = resolveForgeShadowM3RunnerArtifacts(input({
    releaseObservation: release({ assets: [
      { ...asset('linux/amd64'), command: 'run anything' },
      asset('windows/amd64'),
    ] }),
  }));
  assert.ok([...blockers(unsafe)].some((code) => code.startsWith('unsafe-field:')));
});

test('projects zero runtime, credential, source and merge authority', () => {
  const result = resolveForgeShadowM3RunnerArtifacts(input());
  assert.equal(result.finalVerdict, FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY);
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('fails closed with the bounded blocked verdict', () => {
  const result = resolveForgeShadowM3RunnerArtifacts(input({ releaseObservation: null }));
  assert.equal(result.valid, false);
  assert.equal(result.finalVerdict, FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_BLOCKED);
  assert.ok(result.blockers.length > 0);
});
