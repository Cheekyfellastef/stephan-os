import assert from 'node:assert/strict';
import test from 'node:test';

import { planForgeShadowM3RunnerRuntime } from './forgeShadowM3RunnerRuntimePlanV1.mjs';
import {
  FORGE_SHADOW_M3_CANARY_SCENARIO,
  FORGE_SHADOW_M3_CANARY_WORKFLOW,
  FORGE_SHADOW_M3_EXECUTION_BLOCKED,
  FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
  FORGE_SHADOW_M3_EXECUTION_READY,
  FORGE_SHADOW_M3_EXECUTION_SURFACE,
  FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
  buildForgeShadowM3RuntimePlanDigest,
  executeForgeShadowM3RunnerPlan,
  validateForgeShadowM3RunnerRuntimeReceipt,
} from './forgeShadowM3RunnerExecutionReceiptAdapterV1.mjs';

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

function m2() {
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
        readyForM3: true,
      },
    },
    arbitraryShellAllowed: false, destructiveGitAllowed: false,
    credentialsMayBeReadOrExported: false,
  };
}

function pool(runnerClass) {
  const linux = runnerClass === 'linux-isolated';
  return {
    poolId: linux ? 'forge-linux-build-test-v1' : 'forge-windows-proof-v1',
    runnerClass, count: 1,
    runtimeBoundary: linux ? 'forge-linux-rootless-ephemeral' : 'battle-bridge-windows-proof-sandbox',
    runtimeArtifactDigest: linux ? LINUX : WINDOWS,
    workloadIds: linux ? ['linux-shared-agent-tests'] : ['windows-source-controlled-proof'],
    cpuLimit: 2, memoryMiB: 4096, diskMiB: 16384,
    maxJobMinutes: linux ? 45 : 60, maxConcurrentJobs: 1,
    artifactRetentionDays: 14, maxArtifactBytes: 512 * 1024 * 1024,
    workspacePolicy: 'ephemeral-per-job', artifactPolicy: 'immutable-content-addressed',
    networkPolicy: linux ? 'forge-loopback-and-approved-readonly-egress' : 'battle-bridge-loopback-and-approved-readonly-egress',
    registrationMode: 'disabled-pending-runtime-authorization', ephemeralWorkspace: true,
    limitedUser: true, privileged: false, hostNetwork: false, hostProcessAccess: false,
    canonicalCheckoutMounted: false, containerSocketMounted: false,
    githubCredentialAvailable: false, persistentSecrets: false, publicInbound: false,
    tailscaleInbound: false, sourceMutationAuthority: false, mergeAuthority: false,
    deploymentAuthority: false, registrationRequested: false, executed: false,
  };
}

function artifact(runnerClass) {
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
    mutableReferenceAccepted: false, credentialUsed: false,
  };
}

function runtimePlanInput(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os', canonicalMainHead: HEAD,
    canonicalMainTree: TREE, nowUtc: NOW,
    admissionInput: {
      repository: 'Cheekyfellastef/stephan-os', canonicalMainHead: HEAD,
      canonicalMainTree: TREE, nowUtc: NOW, m2Receipt: m2(),
      runnerPools: [pool('windows-proof-isolated'), pool('linux-isolated')],
    },
    artifactResolutions: [artifact('windows-proof-isolated'), artifact('linux-isolated')],
    ...patch,
  };
}

function authorization(plan, patch = {}) {
  return {
    schemaVersion: FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
    authorizationId: 'forge-m3-runtime-authorization-20260807-001',
    repository: 'Cheekyfellastef/stephan-os', expectedHead: HEAD, expectedTree: TREE,
    runtimePlanDigest: buildForgeShadowM3RuntimePlanDigest(plan),
    issuedAtUtc: '2026-08-07T21:19:00Z', expiresAtUtc: '2026-08-07T22:19:00Z',
    executionSurface: FORGE_SHADOW_M3_EXECUTION_SURFACE,
    operatorApproved: true, m3Only: true, ...patch,
  };
}

function input(planInput = runtimePlanInput(), authorizationPatch = {}) {
  const plan = planForgeShadowM3RunnerRuntime(planInput);
  assert.equal(plan.valid, true);
  return { runtimePlanInput: planInput, runtimeAuthorization: authorization(plan, authorizationPatch) };
}

function observation({ runner, artifact, runtimePlan }, patch = {}) {
  const proofDigest = runner.runnerClass === 'linux-isolated' ? '6'.repeat(64) : '7'.repeat(64);
  return {
    schemaVersion: FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
    runnerId: runner.runnerId, poolId: runner.poolId, runnerClass: runner.runnerClass,
    runtimeBoundary: runner.runtimeBoundary, sourceHead: HEAD, sourceTree: TREE,
    artifactDigest: artifact.artifactDigest, artifactSetDigest: runtimePlan.artifactSetDigest,
    canaryForgeService: runtimePlan.canaryForge.serviceId,
    canaryForgeBackupDigest: runtimePlan.canaryForge.backupDigest,
    canaryForgeStarted: true, canaryForgeDestroyed: true,
    canonicalM2Sealed: true, canonicalM2Unchanged: true,
    privateRelayUsed: runner.runnerClass === 'windows-proof-isolated',
    privateRelayDestroyed: true,
    startedAtUtc: '2026-08-07T21:21:00Z', completedAtUtc: '2026-08-07T21:22:00Z',
    installed: true, registered: true, connected: true, ephemeralRegistration: true,
    canaryWorkflowId: FORGE_SHADOW_M3_CANARY_WORKFLOW,
    canaryScenario: FORGE_SHADOW_M3_CANARY_SCENARIO,
    canaryHead: HEAD, canaryTree: TREE, canarySucceeded: true,
    unregistered: true, registrationCredentialDestroyed: true,
    workspaceDestroyed: true, runtimeBoundaryDestroyed: true,
    zeroResidualRegistration: true, zeroResidualCredential: true, zeroResidualWorkspace: true,
    credentialLogged: false, credentialPersisted: false, publicExposure: false,
    tailscaleExposure: false, canonicalCheckoutMounted: false, containerSocketMounted: false,
    hostProcessAccess: false, sourceMutation: false, gitRefWrite: false,
    mergeAuthority: false, deploymentAuthority: false, arbitraryCommand: false,
    proofRefs: [`proofs/forge-shadow-m3/${runner.runnerId}/${proofDigest}.json`],
    ...patch,
  };
}

const now = () => new Date(NOW);

test('executes only the canonical runner estate and emits a content-addressed M3 receipt', async () => {
  const calls = [];
  const result = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      calls.push(request);
      return observation(request);
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.finalVerdict, FORGE_SHADOW_M3_EXECUTION_READY);
  assert.deepEqual(calls.map((call) => call.runner.runnerId), [
    'stephanos-forge-linux-runner-01',
    'stephanos-forge-windows-proof-runner-01',
  ]);
  assert.equal(result.receipt.canCarryRealWork, true);
  assert.equal(result.receipt.runnerCount, 2);
  assert.ok(result.receipt.runners.every((runner) => runner.ephemeralRegistration && runner.unregistered));
  assert.ok(Object.values(result.receipt.authority).every((value) => value === false));
  assert.match(result.receipt.receiptDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(result.receipt, {
    expectedRepository: 'Cheekyfellastef/stephan-os', expectedHead: HEAD, expectedTree: TREE,
    expectedRuntimePlanDigest: result.runtimePlanDigest,
    expectedArtifactSetDigest: result.receipt.artifactSetDigest,
  }).ok, true);
});

test('runtime authorization is exact-head, exact-tree, exact-plan, surface and time bound', async () => {
  for (const patch of [
    { expectedHead: 'f'.repeat(40) }, { expectedTree: 'f'.repeat(40) },
    { runtimePlanDigest: `sha256:${'f'.repeat(64)}` }, { executionSurface: 'CLOUD' },
    { operatorApproved: false }, { m3Only: false },
    { expiresAtUtc: '2026-08-07T21:20:00Z' },
    { expiresAtUtc: '2026-08-08T01:19:00Z' },
  ]) {
    const result = await executeForgeShadowM3RunnerPlan(input(runtimePlanInput(), patch), {
      platform: 'win32', now, executeRunner: async (request) => observation(request),
    });
    assert.equal(result.ok, false);
    assert.equal(result.finalVerdict, FORGE_SHADOW_M3_EXECUTION_BLOCKED);
  }
});

test('execution is Windows-bound and refuses to start without the fixed runner executor', async () => {
  const wrongHost = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'linux', now, executeRunner: async (request) => observation(request),
  });
  assert.equal(wrongHost.ok, false);
  assert.ok(wrongHost.blockers.includes('connected-windows-battle-bridge-required'));
  const missing = await executeForgeShadowM3RunnerPlan(input(), { platform: 'win32', now });
  assert.equal(missing.ok, false);
  assert.ok(missing.blockers.includes('fixed-runner-executor-not-configured'));
});

test('runner proof fails closed on identity, canary, teardown, authority or proof drift', async () => {
  for (const patch of [
    { sourceHead: 'f'.repeat(40) }, { artifactDigest: `sha256:${'f'.repeat(64)}` },
    { ephemeralRegistration: false }, { canarySucceeded: false },
    { unregistered: false }, { registrationCredentialDestroyed: false },
    { workspaceDestroyed: false }, { runtimeBoundaryDestroyed: false },
    { canonicalCheckoutMounted: true }, { containerSocketMounted: true },
    { hostProcessAccess: true }, { gitRefWrite: true }, { mergeAuthority: true },
    { canaryForgeDestroyed: false }, { canonicalM2Unchanged: false },
    { privateRelayUsed: true }, { privateRelayDestroyed: false },
    { proofRefs: ['proofs/forge-shadow-m3/not-content-addressed.json'] },
  ]) {
    let first = true;
    const result = await executeForgeShadowM3RunnerPlan(input(), {
      platform: 'win32', now,
      executeRunner: async (request) => {
        const selected = first ? patch : {};
        first = false;
        return observation(request, selected);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.receipt, null);
  }
});

test('credential-shaped or widened executor observations are rejected and never serialized', async () => {
  const result = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => ({ ...observation(request), token: 'must-not-survive' }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('runner-observation-unsafe-field')), JSON.stringify(result.blockers));
  assert.doesNotMatch(JSON.stringify(result), /must-not-survive/);
});

test('executor failures cannot mint a runtime receipt', async () => {
  const result = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'win32', now,
    executeRunner: async () => { throw new Error('host failed'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.receipt, null);
  assert.ok(result.blockers[0].startsWith('runner-executor-threw:'));
  assert.doesNotMatch(JSON.stringify(result), /host failed/);
});

test('receipt validation detects post-issuance mutation and hidden fields', async () => {
  const result = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'win32', now, executeRunner: async (request) => observation(request),
  });
  const mutated = structuredClone(result.receipt);
  mutated.canCarryRealWork = false;
  assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(mutated).ok, false);
  const widened = { ...structuredClone(result.receipt), command: 'not-allowed' };
  assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(widened).ok, false);
});
