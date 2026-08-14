import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_SHADOW_M3_RUNTIME_BLOCKED,
  FORGE_SHADOW_M3_RUNTIME_READY,
  planForgeShadowM3RunnerRuntime,
} from './forgeShadowM3RunnerRuntimePlanV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const IMAGE = `sha256:${'c'.repeat(64)}`;
const BACKUP = 'd'.repeat(64);
const LINUX = `sha256:${'1'.repeat(64)}`;
const WINDOWS = `sha256:${'2'.repeat(64)}`;
const RELEASE = `sha256:${'3'.repeat(64)}`;
const CHECKSUM = `sha256:${'4'.repeat(64)}`;
const PROVENANCE = `sha256:${'5'.repeat(64)}`;
const NOW = '2026-08-07T21:20:00Z';

function m2(patch = {}, resultPatch = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'forge-m2-runtime-ready-001', operation: 'INSTALL_FORGE_SHADOW_M2',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 1507, branch: 'main',
    expectedHead: HEAD, forgejoVersion: '15.0.6', forgejoImageDigest: IMAGE,
    runtimeBoundary: 'podman-wsl-rootless', m2Only: true, state: 'DONE',
    acceptedAt: '2026-08-07T20:50:00Z', heartbeatAt: '2026-08-07T20:55:00Z',
    completedAt: '2026-08-07T21:00:00Z', blocker: '',
    proofRefs: ['receipts/github-command-mailbox/forge-m2-runtime-ready-001.json'],
    result: {
      ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', operation: 'INSTALL_FORGE_SHADOW_M2',
      requestId: 'forge-m2-runtime-ready-001', result: {
        ok: true, blocker: '', finalVerdict: 'FORGE_SHADOW_M2_READY',
        repository: 'Cheekyfellastef/stephan-os', sourceHead: HEAD, canonicalTree: TREE,
        installerBlob: 'e'.repeat(40), forgejoVersion: '15.0.6', podmanVersion: '6.0.2',
        forgejoImageDigest: IMAGE, runtimeBoundary: 'podman-wsl-rootless',
        machine: 'stephanos-forge-shadow', podmanConnection: 'stephanos-forge-shadow',
        container: 'stephanos-forge-shadow', listener: '127.0.0.1:3340',
        mirrorHead: HEAD, mirrorTree: TREE, backupDigest: BACKUP,
        backupVolume: `stephanos-forge-shadow-backup-${BACKUP.slice(0, 16)}`,
        restoreDrillPassed: true, rootFilesystemReadOnly: true,
        allCapabilitiesDropped: true, noNewPrivileges: true,
        githubCredentialUsed: false, credentialPersisted: false, credentialLogged: false,
        runnerRegistration: false, actionsExecution: false, mergeAuthority: false,
        readyForM3: true, ...resultPatch,
      },
    },
    arbitraryShellAllowed: false, destructiveGitAllowed: false,
    credentialsMayBeReadOrExported: false, ...patch,
  };
}
function pool(runnerClass, patch = {}) {
  const linux = runnerClass === 'linux-isolated';
  return {
    poolId: linux ? 'forge-linux-build-test-v1' : 'forge-windows-proof-v1',
    runnerClass, count: linux ? 3 : 1,
    runtimeBoundary: linux ? 'forge-linux-rootless-ephemeral' : 'battle-bridge-windows-proof-sandbox',
    runtimeArtifactDigest: linux ? LINUX : WINDOWS,
    workloadIds: linux ? ['linux-shared-agent-tests', 'linux-stephanos-ui-build'] : ['windows-source-controlled-proof'],
    cpuLimit: linux ? 4 : 2, memoryMiB: 4096, diskMiB: 16384,
    maxJobMinutes: linux ? 45 : 60, maxConcurrentJobs: linux ? 3 : 1,
    artifactRetentionDays: 14, maxArtifactBytes: 512 * 1024 * 1024,
    workspacePolicy: 'ephemeral-per-job', artifactPolicy: 'immutable-content-addressed',
    networkPolicy: linux ? 'forge-loopback-and-approved-readonly-egress' : 'battle-bridge-loopback-and-approved-readonly-egress',
    registrationMode: 'disabled-pending-runtime-authorization', ephemeralWorkspace: true,
    limitedUser: true, privileged: false, hostNetwork: false, hostProcessAccess: false,
    canonicalCheckoutMounted: false, containerSocketMounted: false,
    githubCredentialAvailable: false, persistentSecrets: false, publicInbound: false,
    tailscaleInbound: false, sourceMutationAuthority: false, mergeAuthority: false,
    deploymentAuthority: false, registrationRequested: false, executed: false, ...patch,
  };
}
function admission(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os', canonicalMainHead: HEAD,
    canonicalMainTree: TREE, nowUtc: NOW, m2Receipt: m2(),
    runnerPools: [pool('windows-proof-isolated'), pool('linux-isolated')], ...patch,
  };
}
function artifact(runnerClass, patch = {}) {
  const linux = runnerClass === 'linux-isolated';
  return {
    artifactId: linux ? 'forge-m3-linux-runner-artifact-v1' : 'forge-m3-windows-proof-runner-artifact-v1',
    runnerClass, sourceIdentity: 'forgejo-official-runner-release', releaseChannel: 'stable',
    version: '9.4.2', platform: linux ? 'linux/amd64' : 'windows/amd64',
    artifactLogicalId: linux ? 'forgejo-runner-linux-amd64' : 'forgejo-runner-windows-amd64',
    artifactDigest: linux ? LINUX : WINDOWS, artifactBytes: 8 * 1024 * 1024,
    releaseManifestDigest: RELEASE, checksumManifestDigest: CHECKSUM,
    provenanceDigest: PROVENANCE, resolvedAtUtc: '2026-08-07T21:10:00Z',
    proofRefs: [`proofs/forge-m3/${linux ? 'linux' : 'windows'}-artifact.json`],
    tlsVerified: true, releaseManifestVerified: true, checksumVerified: true,
    mutableReferenceAccepted: false, credentialUsed: false, ...patch,
  };
}
function input(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os', canonicalMainHead: HEAD,
    canonicalMainTree: TREE, nowUtc: NOW, admissionInput: admission(),
    artifactResolutions: [artifact('windows-proof-isolated'), artifact('linux-isolated')],
    ...patch,
  };
}
const blockers = (result) => new Set(result.blockers);

test('emits a deterministic unexecuted runtime plan from canonical admission and immutable artifacts', () => {
  const left = planForgeShadowM3RunnerRuntime(input());
  const right = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [...input().artifactResolutions].reverse() }));
  assert.equal(left.valid, true); assert.equal(left.finalVerdict, FORGE_SHADOW_M3_RUNTIME_READY);
  assert.equal(left.artifactSetDigest, right.artifactSetDigest);
  assert.deepEqual(left.runners.map((runner) => runner.runnerId), [
    'stephanos-forge-linux-runner-01', 'stephanos-forge-linux-runner-02',
    'stephanos-forge-linux-runner-03', 'stephanos-forge-windows-proof-runner-01',
  ]);
  assert.equal(left.executionPlan.length, 11);
  assert.ok(left.executionPlan.every((step) => step.executed === false && step.requiresSeparateRuntimeAuthorization === true));
  assert.ok(left.runners.every((runner) => !runner.installed && !runner.registered && !runner.connected && !runner.executed));
});

test('reruns the canonical admission planner and rejects fake or blocked evidence', () => {
  const missing = planForgeShadowM3RunnerRuntime(input({ admissionInput: { finalVerdict: 'FORGE_SHADOW_M3_RUNNER_ADMISSION_PLAN_READY' } }));
  assert.equal(missing.valid, false); assert.equal(missing.finalVerdict, FORGE_SHADOW_M3_RUNTIME_BLOCKED);
  const blocked = planForgeShadowM3RunnerRuntime(input({ admissionInput: admission({ m2Receipt: m2({ state: 'ACCEPTED' }) }) }));
  assert.ok([...blockers(blocked)].some((code) => code.startsWith('admission-')));
});

test('binds repository, head, tree, and canonical admission time', () => {
  for (const patch of [
    { repository: 'other/repo' }, { canonicalMainHead: 'f'.repeat(40) },
    { canonicalMainTree: 'f'.repeat(40) }, { nowUtc: 'not-a-time' },
  ]) assert.equal(planForgeShadowM3RunnerRuntime(input(patch)).valid, false);
  const drift = planForgeShadowM3RunnerRuntime(input({ admissionInput: admission({ canonicalMainHead: 'f'.repeat(40) }) }));
  assert.ok(blockers(drift).has('admission-head-mismatch') || blockers(drift).has('admission-not-ready'));
});

test('requires exactly one immutable artifact per admitted runner class and exact admitted digest', () => {
  const missing = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [artifact('linux-isolated')] }));
  assert.ok(blockers(missing).has('artifact-estate-must-be-exactly-two'));
  const duplicate = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [artifact('linux-isolated'), artifact('linux-isolated')] }));
  assert.ok(blockers(duplicate).has('artifact-runner-class-duplicate'));
  const mismatch = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [artifact('linux-isolated', { artifactDigest: `sha256:${'9'.repeat(64)}` }), artifact('windows-proof-isolated')] }));
  assert.ok(blockers(mismatch).has('artifact-admission-digest-mismatch:linux-isolated'));
});

test('requires one stable release set with fixed logical identities and platforms', () => {
  const result = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [
    artifact('linux-isolated'), artifact('windows-proof-isolated', { version: '9.4.3', platform: 'linux/amd64' }),
  ] }));
  assert.ok(blockers(result).has('artifact-release-set-mismatch'));
  assert.ok([...blockers(result)].some((code) => code.startsWith('artifact-identity-mismatch:')));
});

test('rejects stale, future, mutable, credentialed, or unverified artifacts', () => {
  const patches = [
    { resolvedAtUtc: '2026-08-05T20:00:00Z' }, { resolvedAtUtc: '2026-08-07T22:00:00Z' },
    { mutableReferenceAccepted: true }, { credentialUsed: true }, { checksumVerified: false },
    { proofRefs: [] },
  ];
  for (const patch of patches) {
    const result = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [artifact('linux-isolated', patch), artifact('windows-proof-isolated')] }));
    assert.equal(result.valid, false);
  }
});

test('rejects hidden fields and arbitrary authority-shaped surfaces recursively', () => {
  const extra = planForgeShadowM3RunnerRuntime({ ...input(), extra: true });
  assert.ok(blockers(extra).has('input-fields-invalid'));
  const unsafe = planForgeShadowM3RunnerRuntime(input({ artifactResolutions: [
    { ...artifact('linux-isolated'), command: 'run anything' }, artifact('windows-proof-isolated'),
  ] }));
  assert.ok([...blockers(unsafe)].some((code) => code.startsWith('unsafe-field:')));
});

test('projects zero runtime and GitHub authority plus mandatory teardown', () => {
  const result = planForgeShadowM3RunnerRuntime(input());
  for (const [key, value] of Object.entries(result.authority)) {
    assert.equal(value, key === 'separateRuntimeAuthorizationRequired', key);
  }
  assert.equal(result.teardownPolicy.maximumTeardownSeconds, 300);
  assert.equal(result.teardownPolicy.quarantineOnTeardownFailure, true);
  assert.equal(result.teardownPolicy.zeroResidualRegistrationRequired, true);
  assert.equal(result.teardownPolicy.zeroResidualCredentialRequired, true);
  assert.equal(result.proofPolicy.credentialMaterialForbidden, true);
});
