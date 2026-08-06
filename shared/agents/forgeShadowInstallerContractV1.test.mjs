import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGE_SHADOW_INSTALLER_CONTRACT_SCHEMA,
  FORGE_SHADOW_INSTALLER_DECISIONS,
  FORGE_SHADOW_INSTALLER_REQUEST_SCHEMA,
  buildForgeShadowInstallerContract,
} from './forgeShadowInstallerContractV1.mjs';

const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function runtimeRequest(overrides = {}) {
  return {
    schemaVersion: 'stephanos.forge-shadow-runtime-request.v1',
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    boundaryId: 'forge-shadow-1',
    boundaryKind: 'wsl2',
    imageDigest: DIGEST,
    backupTargetId: 'forge-shadow-backup-1',
    statusRecord: 'status/forge-shadow-runtime.json',
    proofRecord: 'proofs/forge-shadow-parity.json',
    requiredParitySchema: 'stephanos.forge-shadow-parity.v1',
    exactRuntimeAuthorizationRequired: true,
    executable: null,
    command: null,
    environment: null,
    credentials: null,
    ...overrides,
  };
}

function executionProfile(overrides = {}) {
  return {
    adapterId: 'forge-shadow-wsl2-rootless-podman-v1',
    hostId: 'battle-bridge',
    wslDistributionId: 'stephanos-forge-shadow',
    containerEngine: 'podman-rootless',
    imageRepository: 'codeberg.org/forgejo/forgejo',
    bindAddress: '127.0.0.1',
    hostPort: 13000,
    containerPort: 3000,
    sshEnabled: false,
    readOnlyRootFilesystem: true,
    dropAllCapabilities: true,
    noNewPrivileges: true,
    dataVolumeId: 'forge-shadow-data-v1',
    gitSourceUrl: 'https://github.com/Cheekyfellastef/stephan-os.git',
    gitAuthentication: 'anonymous-public-read',
    automaticSyncEnabled: false,
    pushEnabled: false,
    forceUpdateEnabled: false,
    pruneEnabled: false,
    backupTargetId: 'forge-shadow-backup-1',
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    runtimeRequest: runtimeRequest(),
    executionProfile: executionProfile(),
    ...overrides,
  };
}

test('valid installer contract emits deterministic zero-authority execution request', () => {
  const first = buildForgeShadowInstallerContract(validInput());
  const second = buildForgeShadowInstallerContract(validInput());
  assert.equal(first.schemaVersion, FORGE_SHADOW_INSTALLER_CONTRACT_SCHEMA);
  assert.equal(first.valid, true);
  assert.equal(first.decision, FORGE_SHADOW_INSTALLER_DECISIONS.READY);
  assert.equal(first.executionRequest.schemaVersion, FORGE_SHADOW_INSTALLER_REQUEST_SCHEMA);
  assert.equal(first.executionRequest.requestId, second.executionRequest.requestId);
  assert.equal(first.executionRequest.repository, 'Cheekyfellastef/stephan-os');
  assert.equal(first.executionRequest.hostId, 'battle-bridge');
  assert.equal(first.executionRequest.bindAddress, '127.0.0.1');
  assert.equal(first.executionRequest.hostPort, 13000);
  assert.equal(first.executionRequest.containerPort, 3000);
  assert.equal(first.executionRequest.steps.length, 9);
  assert.ok(first.executionRequest.steps.every((step) => step.executed === false));
  assert.ok(first.executionRequest.steps.every((step) => step.mutationAllowedByContract === false));
  assert.equal(first.executionRequest.command, null);
  assert.equal(first.executionRequest.executable, null);
  assert.equal(first.executionRequest.environment, null);
  assert.equal(first.executionRequest.credentials, null);
  assert.equal(first.executionRequest.paths, null);
  assert.equal(first.authority.runtimeMutation, false);
  assert.equal(first.authority.githubRefWrite, false);
  assert.equal(first.authority.forgeRefWrite, false);
  assert.equal(first.authority.requiresSeparateRuntimeAuthorization, true);
});

test('runtime request is bound to canonical repository, exact head, WSL2, digest and fixed proof records', () => {
  for (const request of [
    runtimeRequest({ repository: 'other/repo' }),
    runtimeRequest({ canonicalMainHead: 'short' }),
    runtimeRequest({ boundaryKind: 'container' }),
    runtimeRequest({ imageDigest: 'forgejo:latest' }),
    runtimeRequest({ statusRecord: 'status/other.json' }),
    runtimeRequest({ proofRecord: 'proofs/other.json' }),
    runtimeRequest({ requiredParitySchema: 'other' }),
    runtimeRequest({ exactRuntimeAuthorizationRequired: false }),
  ]) {
    const result = buildForgeShadowInstallerContract(validInput({ runtimeRequest: request }));
    assert.equal(result.valid, false);
  }
});

test('runtime request cannot smuggle command, executable, environment or credentials', () => {
  for (const field of ['command', 'executable', 'environment', 'credentials']) {
    const request = runtimeRequest({ [field]: field === 'environment' ? { TOKEN: 'x' } : 'x' });
    const result = buildForgeShadowInstallerContract(validInput({ runtimeRequest: request }));
    assert.equal(result.valid, false, field);
    assert.ok(result.blockers.includes(`runtime-request-${field}-must-be-null`));
  }
});

test('installer route is fixed to Battle Bridge WSL2 and rootless Podman', () => {
  for (const profile of [
    executionProfile({ adapterId: 'generic' }),
    executionProfile({ hostId: 'other-host' }),
    executionProfile({ wslDistributionId: 'Ubuntu' }),
    executionProfile({ containerEngine: 'docker' }),
    executionProfile({ imageRepository: 'docker.io/forgejo/forgejo' }),
  ]) {
    const result = buildForgeShadowInstallerContract(validInput({ executionProfile: profile }));
    assert.equal(result.valid, false);
  }
});

test('listener, ssh and container privilege posture fail closed', () => {
  for (const profile of [
    executionProfile({ bindAddress: '0.0.0.0' }),
    executionProfile({ hostPort: 3000 }),
    executionProfile({ containerPort: 8080 }),
    executionProfile({ sshEnabled: true }),
    executionProfile({ readOnlyRootFilesystem: false }),
    executionProfile({ dropAllCapabilities: false }),
    executionProfile({ noNewPrivileges: false }),
  ]) {
    const result = buildForgeShadowInstallerContract(validInput({ executionProfile: profile }));
    assert.equal(result.valid, false);
  }
});

test('Git source is fixed anonymous fetch-only with no automatic sync, push, force or prune', () => {
  for (const profile of [
    executionProfile({ gitSourceUrl: 'https://example.com/repo.git' }),
    executionProfile({ gitAuthentication: 'token' }),
    executionProfile({ automaticSyncEnabled: true }),
    executionProfile({ pushEnabled: true }),
    executionProfile({ forceUpdateEnabled: true }),
    executionProfile({ pruneEnabled: true }),
  ]) {
    const result = buildForgeShadowInstallerContract(validInput({ executionProfile: profile }));
    assert.equal(result.valid, false);
  }
});

test('backup identity must remain bound across plan and installer profile', () => {
  const result = buildForgeShadowInstallerContract(validInput({
    executionProfile: executionProfile({ backupTargetId: 'other-backup' }),
  }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('backup-target-id-mismatch'));
});

test('unexpected command, path, secret, port or environment fields are rejected by exact schemas', () => {
  for (const candidate of [
    { ...validInput(), command: 'install' },
    { ...validInput(), executionProfile: { ...executionProfile(), path: '/tmp' } },
    { ...validInput(), executionProfile: { ...executionProfile(), secret: 'x' } },
    { ...validInput(), executionProfile: { ...executionProfile(), environment: { X: '1' } } },
    { ...validInput(), runtimeRequest: { ...runtimeRequest(), arguments: ['x'] } },
  ]) {
    const result = buildForgeShadowInstallerContract(candidate);
    assert.equal(result.valid, false);
    assert.ok(result.blockers.some((blocker) => blocker.includes('schema-unbounded')));
  }
});
