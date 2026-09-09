import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGE_SHADOW_M2_IMAGE_TAG,
  resolveForgeShadowM2DigestOnBattleBridge,
} from './forgeShadowM2DigestResolverV1.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function regularFile() {
  return { isFile: () => true, isSymbolicLink: () => false };
}

function scriptedSpawn({ version = 'podman version 6.0.2\n', manifest, failManifest = false } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.length === 1 && args[0] === '--version') {
      return { status: 0, stdout: version, stderr: '' };
    }
    if (args[0] === 'manifest' && args[1] === 'inspect') {
      return failManifest
        ? { status: 1, stdout: '', stderr: 'manifest inspect failed' }
        : { status: 0, stdout: JSON.stringify(manifest), stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

function canonicalManifest(overrides = {}) {
  return {
    schemaVersion: 2,
    manifests: [
      { digest: `sha256:${'b'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64' } },
      { digest: DIGEST, platform: { os: 'linux', architecture: 'amd64' } },
    ],
    ...overrides,
  };
}

test('Forge M2 digest resolver is Windows-only and performs no command off-host', () => {
  const calls = [];
  const result = resolveForgeShadowM2DigestOnBattleBridge({
    platform: 'linux',
    spawnSyncFn: (...args) => calls.push(args),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WINDOWS_REQUIRED');
  assert.equal(result.mutationPerformed, false);
  assert.equal(calls.length, 0);
});

test('Forge M2 digest resolver reads exactly one linux/amd64 immutable descriptor over TLS', () => {
  const spawnSyncFn = scriptedSpawn({ manifest: canonicalManifest() });
  const result = resolveForgeShadowM2DigestOnBattleBridge({
    repoRoot: 'C:\\repo',
    platform: 'win32',
    architecture: 'x64',
    env: { LOCALAPPDATA: 'C:\\Users\\Stephan\\AppData\\Local' },
    lstatFn: () => regularFile(),
    spawnSyncFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'FORGE_SHADOW_M2_DIGEST_READY');
  assert.equal(result.imageTag, FORGE_SHADOW_M2_IMAGE_TAG);
  assert.equal(result.imageDigest, DIGEST);
  assert.equal(result.podmanVersion, '6.0.2');
  assert.equal(result.runtimePlatform, 'linux/amd64');
  assert.equal(result.tlsVerified, true);
  assert.equal(result.registryCredentialUsed, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.pullPerformed, false);
  assert.equal(result.containerMutationPerformed, false);
  assert.equal(spawnSyncFn.calls.length, 2);
  assert.deepEqual(spawnSyncFn.calls[0].args, ['--version']);
  assert.deepEqual(spawnSyncFn.calls[1].args, [
    'manifest', 'inspect', '--tls-verify=true', FORGE_SHADOW_M2_IMAGE_TAG,
  ]);
  assert.equal(spawnSyncFn.calls.every(({ options }) => options.shell === false), true);
  assert.equal(spawnSyncFn.calls.some(({ args }) => args.includes('pull') || args.includes('run')), false);
});

test('Forge M2 digest resolver rejects non-x64 Windows hosts', () => {
  const result = resolveForgeShadowM2DigestOnBattleBridge({ platform: 'win32', architecture: 'arm64' });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FORGE_SHADOW_M2_HOST_ARCHITECTURE_NOT_ALLOWED');
  assert.equal(result.observedArchitecture, 'arm64');
});

test('Forge M2 digest resolver returns the existing Podman prerequisite boundary when no fixed executable exists', () => {
  const result = resolveForgeShadowM2DigestOnBattleBridge({
    platform: 'win32',
    architecture: 'x64',
    env: { LOCALAPPDATA: 'C:\\Users\\Stephan\\AppData\\Local' },
    lstatFn: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED');
});

test('Forge M2 digest resolver rejects the wrong Podman version before registry access', () => {
  const spawnSyncFn = scriptedSpawn({ version: 'podman version 5.9.0\n', manifest: canonicalManifest() });
  const result = resolveForgeShadowM2DigestOnBattleBridge({
    platform: 'win32',
    architecture: 'x64',
    env: {},
    lstatFn: () => regularFile(),
    spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PODMAN_VERSION_MISMATCH');
  assert.equal(spawnSyncFn.calls.length, 1);
});

test('Forge M2 digest resolver fails closed when the amd64 descriptor is absent or ambiguous', () => {
  for (const manifest of [
    { schemaVersion: 2, manifests: [{ digest: DIGEST, platform: { os: 'linux', architecture: 'arm64' } }] },
    { schemaVersion: 2, manifests: [
      { digest: DIGEST, platform: { os: 'linux', architecture: 'amd64' } },
      { digest: `sha256:${'c'.repeat(64)}`, platform: { os: 'linux', architecture: 'amd64' } },
    ] },
  ]) {
    const spawnSyncFn = scriptedSpawn({ manifest });
    const result = resolveForgeShadowM2DigestOnBattleBridge({
      platform: 'win32', architecture: 'x64', env: {}, lstatFn: () => regularFile(), spawnSyncFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'FORGE_SHADOW_M2_AMD64_DESCRIPTOR_NOT_UNIQUE');
  }
});

test('Forge M2 digest resolver rejects a malformed descriptor digest and manifest command failure', () => {
  const malformed = scriptedSpawn({
    manifest: { schemaVersion: 2, manifests: [{ digest: 'latest', platform: { os: 'linux', architecture: 'amd64' } }] },
  });
  const malformedResult = resolveForgeShadowM2DigestOnBattleBridge({
    platform: 'win32', architecture: 'x64', env: {}, lstatFn: () => regularFile(), spawnSyncFn: malformed,
  });
  assert.equal(malformedResult.ok, false);
  assert.equal(malformedResult.blocker, 'FORGE_SHADOW_M2_DIGEST_INVALID');

  const failed = scriptedSpawn({ manifest: canonicalManifest(), failManifest: true });
  const failedResult = resolveForgeShadowM2DigestOnBattleBridge({
    platform: 'win32', architecture: 'x64', env: {}, lstatFn: () => regularFile(), spawnSyncFn: failed,
  });
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.blocker, 'FORGE_SHADOW_M2_MANIFEST_INSPECT_FAILED');
});
