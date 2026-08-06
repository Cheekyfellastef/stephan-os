import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGE_SHADOW_PODMAN_DECISIONS,
  FORGE_SHADOW_PODMAN_IMAGE_TAG,
  FORGE_SHADOW_PODMAN_PORT,
  FORGE_SHADOW_PODMAN_RUNTIME_REPOSITORY,
  FORGE_SHADOW_PODMAN_RUNTIME_VERSION,
  planForgeShadowPodmanRuntime,
} from './forgeShadowPodmanRuntimeV1.mjs';

const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function facts(overrides = {}) {
  return {
    windows11OrNewer: true,
    wsl2Available: true,
    podmanPresent: true,
    podmanVersion: '6.0.2',
    machineExists: true,
    machineRunning: true,
    machineRootful: false,
    hostPortAvailable: true,
    imagePresentByDigest: true,
    containerExists: true,
    serviceHealthy: true,
    bootstrapIdentityPresent: true,
    bootstrapCredentialContained: true,
    githubCredentialPresent: false,
    mirrorPresent: true,
    mirrorSourceHead: HEAD,
    sealedReadOnlyPosture: true,
    parityReady: true,
    backupReady: true,
    ...overrides,
  };
}

function input(factOverrides = {}, topOverrides = {}) {
  return {
    repository: FORGE_SHADOW_PODMAN_RUNTIME_REPOSITORY,
    canonicalMainHead: HEAD,
    imageDigest: DIGEST,
    facts: facts(factOverrides),
    ...topOverrides,
  };
}

test('fixed runtime identity selects current Forgejo LTS and loopback-only port', () => {
  const result = planForgeShadowPodmanRuntime(input());
  assert.equal(result.valid, true);
  assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.READY);
  assert.equal(result.readyForM3, true);
  assert.equal(FORGE_SHADOW_PODMAN_RUNTIME_VERSION, '15.0.6');
  assert.equal(FORGE_SHADOW_PODMAN_IMAGE_TAG, '15.0.6-rootless');
  assert.equal(FORGE_SHADOW_PODMAN_PORT, 3340);
  assert.equal(result.identity.host, '127.0.0.1');
  assert.equal(result.identity.remoteUrl, 'https://github.com/Cheekyfellastef/stephan-os.git');
  assert.equal(result.authority.githubCredentialUse, false);
  assert.equal(result.authority.credentialPersistence, false);
  assert.equal(result.authority.credentialLogging, false);
  assert.equal(result.authority.hostSourceMount, false);
  assert.equal(result.authority.hostSocketMount, false);
});

test('repository, head, digest and fact schemas fail closed', () => {
  for (const candidate of [
    input({}, { repository: 'other/repo' }),
    input({}, { canonicalMainHead: 'short' }),
    input({}, { imageDigest: 'tag-only' }),
    { ...input(), command: 'dir' },
    { ...input(), facts: { ...facts(), arbitraryPath: 'C:\\' } },
  ]) {
    const result = planForgeShadowPodmanRuntime(candidate);
    assert.equal(result.valid, false);
    assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.BLOCKED);
  }
});

test('runtime fact observations require exact boolean and string types', () => {
  for (const patch of [
    { machineRootful: 'false' },
    { machineRunning: 1 },
    { githubCredentialPresent: 'false' },
    { parityReady: null },
    { podmanVersion: 6.002 },
    { mirrorSourceHead: false },
  ]) {
    const result = planForgeShadowPodmanRuntime(input(patch));
    assert.equal(result.valid, false);
    assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.BLOCKED);
    assert.ok(result.blockers.some((blocker) => blocker.startsWith('runtime-fact-type-invalid:')));
  }
});

test('Windows 11, WSL2 and rootless machine proof are mandatory', () => {
  for (const patch of [
    { windows11OrNewer: false },
    { wsl2Available: false },
    { machineRootful: true },
  ]) {
    const result = planForgeShadowPodmanRuntime(input(patch));
    assert.equal(result.valid, false);
  }
});

test('GitHub credentials and uncontained bootstrap credentials are forbidden', () => {
  assert.equal(planForgeShadowPodmanRuntime(input({ githubCredentialPresent: true })).valid, false);
  assert.equal(planForgeShadowPodmanRuntime(input({ bootstrapCredentialContained: false })).valid, false);
});

test('missing fixed Podman version yields a prerequisite action without generic install command', () => {
  const result = planForgeShadowPodmanRuntime(input({ podmanPresent: false, podmanVersion: '' }));
  assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.PODMAN_REQUIRED);
  assert.equal(result.nextAction.requiresSeparateHostPrerequisiteAuthorization, true);
  assert.equal('command' in result.nextAction, false);
});

test('machine init and start plans are fixed and explicitly rootless', () => {
  const init = planForgeShadowPodmanRuntime(input({ machineExists: false, machineRunning: false }));
  assert.equal(init.decision, FORGE_SHADOW_PODMAN_DECISIONS.MACHINE_INIT_REQUIRED);
  assert.deepEqual(init.nextAction.argv, [
    'machine', 'init', '--provider', 'wsl', '--rootful=false', '--cpus', '4',
    '--memory', '4096', '--disk-size', '40', '--update-connection=false', 'stephanos-forge-shadow',
  ]);

  const start = planForgeShadowPodmanRuntime(input({ machineRunning: false }));
  assert.equal(start.decision, FORGE_SHADOW_PODMAN_DECISIONS.MACHINE_START_REQUIRED);
  assert.deepEqual(start.nextAction.argv, [
    'machine', 'start', '--update-connection=false', 'stephanos-forge-shadow',
  ]);
});

test('exact digest pull is required before any service bootstrap', () => {
  const result = planForgeShadowPodmanRuntime(input({ imagePresentByDigest: false }));
  assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.IMAGE_PULL_REQUIRED);
  assert.deepEqual(result.nextAction.argv, ['pull', `code.forgejo.org/forgejo/forgejo@${DIGEST}`]);
});

test('fixed loopback port collision fails closed', () => {
  const result = planForgeShadowPodmanRuntime(input({ containerExists: false, hostPortAvailable: false }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('fixed-loopback-port-not-available'));
});

test('bootstrap grants one local ephemeral credential but never persistence, logging or GitHub use', () => {
  const result = planForgeShadowPodmanRuntime(input({ containerExists: false }));
  assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.SERVICE_BOOTSTRAP_REQUIRED);
  assert.equal(result.nextAction.localCredentialCreation, 'isolated-random-local-only');
  assert.equal(result.nextAction.credentialPersistenceAllowed, false);
  assert.equal(result.nextAction.credentialLoggingAllowed, false);
  assert.equal(result.nextAction.githubCredentialAllowed, false);

  const bootstrap = planForgeShadowPodmanRuntime(input({ serviceHealthy: false }));
  assert.equal(bootstrap.nextAction.temporaryTokenTransport, 'fixed-installer-process-memory-only');
  assert.equal(bootstrap.nextAction.tokenPersistenceAllowed, false);
  assert.equal(bootstrap.nextAction.tokenLoggingAllowed, false);
  assert.equal(bootstrap.nextAction.tokenMustBeRevokedImmediatelyAfterMirrorCreation, true);
  assert.equal(bootstrap.nextAction.temporaryRepositoryTokenScope, 'write:repository,write:user');
});

test('only one exact unauthenticated public pull mirror may be created', () => {
  const result = planForgeShadowPodmanRuntime(input({ mirrorPresent: false, mirrorSourceHead: '' }));
  assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.MIRROR_BOOTSTRAP_REQUIRED);
  assert.equal(result.nextAction.remoteUrl, 'https://github.com/Cheekyfellastef/stephan-os.git');
  assert.equal(result.nextAction.authentication, 'none-public-read');
  assert.equal(result.nextAction.automaticSync, false);
  assert.equal(result.nextAction.targetRepository, 'stephan-os');
});

test('wrong mirrored source head blocks rather than being silently resynchronized', () => {
  const result = planForgeShadowPodmanRuntime(input({ mirrorSourceHead: 'c'.repeat(40) }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('mirror-source-head-mismatch'));
});

test('sealed posture requires read-only rootfs, no capabilities and no-new-privileges', () => {
  const seal = planForgeShadowPodmanRuntime(input({ sealedReadOnlyPosture: false }));
  assert.equal(seal.decision, FORGE_SHADOW_PODMAN_DECISIONS.SEAL_REQUIRED);
  assert.equal(seal.nextAction.disableActions, true);
  assert.equal(seal.nextAction.disablePackages, true);
  assert.equal(seal.nextAction.disableMigrations, true);
  assert.equal(seal.nextAction.disableNewMirrors, true);
  assert.equal(seal.nextAction.disablePeriodicMirrorUpdates, true);
  assert.equal(seal.nextAction.readOnlyRootFilesystem, true);
  assert.equal(seal.nextAction.dropAllCapabilities, true);
  assert.equal(seal.nextAction.noNewPrivileges, true);
  assert.equal(seal.nextAction.writableDataSurface, '/var/lib/gitea');
  assert.deepEqual(seal.nextAction.boundedEphemeralWritableSurfaces, ['/run', '/tmp', '/var/tmp']);
  assert.equal(seal.nextAction.runnerRegistration, false);
  assert.equal(seal.nextAction.publicExposure, false);
});

test('M2 cannot be ready until exact parity and restorable backup both pass', () => {
  for (const patch of [
    { parityReady: false },
    { backupReady: false },
  ]) {
    const result = planForgeShadowPodmanRuntime(input(patch));
    assert.equal(result.decision, FORGE_SHADOW_PODMAN_DECISIONS.PARITY_REQUIRED);
    assert.equal(result.nextAction.requiredParitySchema, 'stephanos.forge-shadow-parity.v1');
  }
});
