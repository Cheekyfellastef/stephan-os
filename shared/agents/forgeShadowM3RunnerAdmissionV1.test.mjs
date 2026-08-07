import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGE_SHADOW_M3_BLOCKED_VERDICT,
  FORGE_SHADOW_M3_READY_VERDICT,
  planForgeShadowM3RunnerAdmission,
} from './forgeShadowM3RunnerAdmissionV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const IMAGE = `sha256:${'c'.repeat(64)}`;
const BACKUP = 'd'.repeat(64);
const NOW = '2026-08-07T20:30:00Z';

function m2Receipt(overrides = {}) {
  const resultOverrides = overrides.resultResult || {};
  const executionOverrides = overrides.result || {};
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'forge-m2-install-ready-001',
    operation: 'INSTALL_FORGE_SHADOW_M2',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    expectedHead: HEAD,
    forgejoVersion: '15.0.6',
    forgejoImageDigest: IMAGE,
    runtimeBoundary: 'podman-wsl-rootless',
    m2Only: true,
    state: 'DONE',
    acceptedAt: '2026-08-07T20:00:00Z',
    heartbeatAt: '2026-08-07T20:05:00Z',
    completedAt: '2026-08-07T20:10:00Z',
    blocker: '',
    proofRefs: ['receipts/github-command-mailbox/forge-m2-install-ready-001.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'INSTALL_FORGE_SHADOW_M2',
      requestId: 'forge-m2-install-ready-001',
      result: {
        ok: true,
        blocker: '',
        finalVerdict: 'FORGE_SHADOW_M2_READY',
        repository: 'Cheekyfellastef/stephan-os',
        sourceHead: HEAD,
        canonicalTree: TREE,
        installerBlob: 'e'.repeat(40),
        forgejoVersion: '15.0.6',
        podmanVersion: '6.0.2',
        forgejoImageDigest: IMAGE,
        runtimeBoundary: 'podman-wsl-rootless',
        machine: 'stephanos-forge-shadow',
        podmanConnection: 'stephanos-forge-shadow',
        container: 'stephanos-forge-shadow',
        listener: '127.0.0.1:3340',
        mirrorHead: HEAD,
        mirrorTree: TREE,
        backupDigest: BACKUP,
        backupVolume: `stephanos-forge-shadow-backup-${BACKUP.slice(0, 16)}`,
        restoreDrillPassed: true,
        rootFilesystemReadOnly: true,
        allCapabilitiesDropped: true,
        noNewPrivileges: true,
        githubCredentialUsed: false,
        credentialPersisted: false,
        credentialLogged: false,
        runnerRegistration: false,
        actionsExecution: false,
        mergeAuthority: false,
        readyForM3: true,
        ...resultOverrides,
      },
      ...executionOverrides,
    },
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    credentialsMayBeReadOrExported: false,
    ...overrides,
  };
  delete receipt.resultResult;
  if (overrides.result) {
    receipt.result = {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'INSTALL_FORGE_SHADOW_M2',
      requestId: receipt.requestId,
      result: {
        ok: true,
        blocker: '',
        finalVerdict: 'FORGE_SHADOW_M2_READY',
        repository: 'Cheekyfellastef/stephan-os',
        sourceHead: HEAD,
        canonicalTree: TREE,
        installerBlob: 'e'.repeat(40),
        forgejoVersion: '15.0.6',
        podmanVersion: '6.0.2',
        forgejoImageDigest: IMAGE,
        runtimeBoundary: 'podman-wsl-rootless',
        machine: 'stephanos-forge-shadow',
        podmanConnection: 'stephanos-forge-shadow',
        container: 'stephanos-forge-shadow',
        listener: '127.0.0.1:3340',
        mirrorHead: HEAD,
        mirrorTree: TREE,
        backupDigest: BACKUP,
        backupVolume: `stephanos-forge-shadow-backup-${BACKUP.slice(0, 16)}`,
        restoreDrillPassed: true,
        rootFilesystemReadOnly: true,
        allCapabilitiesDropped: true,
        noNewPrivileges: true,
        githubCredentialUsed: false,
        credentialPersisted: false,
        credentialLogged: false,
        runnerRegistration: false,
        actionsExecution: false,
        mergeAuthority: false,
        readyForM3: true,
        ...resultOverrides,
      },
      ...executionOverrides,
    };
  }
  return receipt;
}

function linuxPool(overrides = {}) {
  return {
    poolId: 'forge-linux-build-test-v1',
    runnerClass: 'linux-isolated',
    count: 3,
    runtimeBoundary: 'forge-linux-rootless-ephemeral',
    runtimeArtifactDigest: `sha256:${'1'.repeat(64)}`,
    workloadIds: ['linux-shared-agent-tests', 'linux-stephanos-ui-build'],
    cpuLimit: 4,
    memoryMiB: 4096,
    diskMiB: 16384,
    maxJobMinutes: 45,
    maxConcurrentJobs: 3,
    artifactRetentionDays: 14,
    maxArtifactBytes: 512 * 1024 * 1024,
    workspacePolicy: 'ephemeral-per-job',
    artifactPolicy: 'immutable-content-addressed',
    networkPolicy: 'forge-loopback-and-approved-readonly-egress',
    registrationMode: 'disabled-pending-runtime-authorization',
    ephemeralWorkspace: true,
    limitedUser: true,
    privileged: false,
    hostNetwork: false,
    hostProcessAccess: false,
    canonicalCheckoutMounted: false,
    containerSocketMounted: false,
    githubCredentialAvailable: false,
    persistentSecrets: false,
    publicInbound: false,
    tailscaleInbound: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    registrationRequested: false,
    executed: false,
    ...overrides,
  };
}

function windowsPool(overrides = {}) {
  return {
    poolId: 'forge-windows-proof-v1',
    runnerClass: 'windows-proof-isolated',
    count: 1,
    runtimeBoundary: 'battle-bridge-windows-proof-sandbox',
    runtimeArtifactDigest: `sha256:${'2'.repeat(64)}`,
    workloadIds: ['windows-source-controlled-proof'],
    cpuLimit: 2,
    memoryMiB: 4096,
    diskMiB: 16384,
    maxJobMinutes: 60,
    maxConcurrentJobs: 1,
    artifactRetentionDays: 14,
    maxArtifactBytes: 512 * 1024 * 1024,
    workspacePolicy: 'ephemeral-per-job',
    artifactPolicy: 'immutable-content-addressed',
    networkPolicy: 'battle-bridge-loopback-and-approved-readonly-egress',
    registrationMode: 'disabled-pending-runtime-authorization',
    ephemeralWorkspace: true,
    limitedUser: true,
    privileged: false,
    hostNetwork: false,
    hostProcessAccess: false,
    canonicalCheckoutMounted: false,
    containerSocketMounted: false,
    githubCredentialAvailable: false,
    persistentSecrets: false,
    publicInbound: false,
    tailscaleInbound: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    registrationRequested: false,
    executed: false,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    canonicalMainTree: TREE,
    nowUtc: NOW,
    m2Receipt: m2Receipt(),
    runnerPools: [windowsPool(), linuxPool()],
    ...overrides,
  };
}

function codes(result) {
  return new Set(result.blockers);
}

test('creates a deterministic zero-authority M3 plan only from a real exact M2 receipt', () => {
  const result = planForgeShadowM3RunnerAdmission(input());
  assert.equal(result.valid, true);
  assert.equal(result.decision, FORGE_SHADOW_M3_READY_VERDICT);
  assert.equal(result.finalVerdict, FORGE_SHADOW_M3_READY_VERDICT);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.m2Evidence.sourceHead, HEAD);
  assert.equal(result.m2Evidence.sourceTree, TREE);
  assert.deepEqual(result.runnerPools.map((pool) => pool.runnerClass), [
    'linux-isolated',
    'windows-proof-isolated',
  ]);
  assert.equal(result.authority.runnerRegistration, false);
  assert.equal(result.authority.runnerExecution, false);
  assert.equal(result.authority.workflowExecution, false);
  assert.equal(result.authority.merge, false);
  assert.equal(result.authority.deployment, false);
  assert.equal(result.authority.separateRuntimeAuthorizationRequired, true);
  assert.ok(result.runnerPools.every((pool) => (
    pool.executed === false
    && pool.registrationAllowed === false
    && pool.requiresSeparateRuntimeAuthorization === true
  )));
});

test('fails closed without the exact completed mailbox M2 receipt', () => {
  for (const receipt of [null, {}, m2Receipt({ state: 'ACCEPTED' }), m2Receipt({ blocker: 'FAILED' })]) {
    const result = planForgeShadowM3RunnerAdmission(input({ m2Receipt: receipt }));
    assert.equal(result.valid, false);
    assert.equal(result.finalVerdict, FORGE_SHADOW_M3_BLOCKED_VERDICT);
  }
});

test('binds the M2 receipt and nested result to exact canonical head and tree', () => {
  const wrongOuterHead = planForgeShadowM3RunnerAdmission(input({
    m2Receipt: m2Receipt({ expectedHead: 'f'.repeat(40) }),
  }));
  assert.ok(codes(wrongOuterHead).has('m2-receipt-head-mismatch'));

  const wrongResult = planForgeShadowM3RunnerAdmission(input({
    m2Receipt: m2Receipt({ resultResult: { mirrorTree: 'f'.repeat(40) } }),
  }));
  assert.ok(codes(wrongResult).has('m2-result-tree-parity-failed'));
});

test('rejects stale, future, unordered, and proofless M2 evidence', () => {
  const stale = planForgeShadowM3RunnerAdmission(input({
    m2Receipt: m2Receipt({
      acceptedAt: '2026-08-05T18:00:00Z',
      heartbeatAt: '2026-08-05T18:05:00Z',
      completedAt: '2026-08-05T18:10:00Z',
    }),
  }));
  assert.ok(codes(stale).has('m2-receipt-stale'));

  const future = planForgeShadowM3RunnerAdmission(input({
    m2Receipt: m2Receipt({ completedAt: '2026-08-07T21:00:00Z' }),
  }));
  assert.ok(codes(future).has('m2-receipt-completed-in-future'));

  const unordered = planForgeShadowM3RunnerAdmission(input({
    m2Receipt: m2Receipt({ heartbeatAt: '2026-08-07T19:55:00Z' }),
  }));
  assert.ok(codes(unordered).has('m2-receipt-time-order-invalid'));

  const proofless = planForgeShadowM3RunnerAdmission(input({
    m2Receipt: m2Receipt({ proofRefs: [] }),
  }));
  assert.ok(codes(proofless).has('m2-receipt-proof-refs-invalid'));
});

test('rejects weakened M2 privilege, backup, credential, and M3 readiness seals', () => {
  const cases = [
    ['m2-result-no-new-privileges-missing', { noNewPrivileges: false }],
    ['m2-result-runner-registration-already-enabled', { runnerRegistration: true }],
    ['m2-result-actions-execution-already-enabled', { actionsExecution: true }],
    ['m2-result-github-credential-used', { githubCredentialUsed: true }],
    ['m2-result-not-ready-for-m3', { readyForM3: false }],
    ['m2-result-backup-identity-invalid', { backupVolume: 'wrong' }],
  ];
  for (const [expected, patch] of cases) {
    const result = planForgeShadowM3RunnerAdmission(input({
      m2Receipt: m2Receipt({ resultResult: patch }),
    }));
    assert.ok(codes(result).has(expected), expected);
  }
});

test('requires exactly one Linux pool and one isolated Windows proof pool', () => {
  const missing = planForgeShadowM3RunnerAdmission(input({ runnerPools: [linuxPool()] }));
  assert.ok(codes(missing).has('runner-pool-estate-must-be-exactly-two'));
  assert.ok(codes(missing).has('runner-class-required:windows-proof-isolated'));

  const duplicate = planForgeShadowM3RunnerAdmission(input({ runnerPools: [linuxPool(), linuxPool({ poolId: 'second-linux' })] }));
  assert.ok(codes(duplicate).has('runner-class-duplicate'));
  assert.ok(codes(duplicate).has('runner-class-required:windows-proof-isolated'));
});

test('rejects arbitrary workload identities and class-boundary drift', () => {
  const workload = planForgeShadowM3RunnerAdmission(input({
    runnerPools: [linuxPool({ workloadIds: ['run-anything'] }), windowsPool()],
  }));
  assert.ok(codes(workload).has('runner-workload-not-allowed:forge-linux-build-test-v1'));

  const boundary = planForgeShadowM3RunnerAdmission(input({
    runnerPools: [linuxPool({ runtimeBoundary: 'docker-privileged' }), windowsPool()],
  }));
  assert.ok(codes(boundary).has('runner-runtime-boundary-mismatch:forge-linux-build-test-v1'));
});

test('rejects host, checkout, socket, credential, public, and privilege access', () => {
  const cases = [
    ['runner-privilege-expansion-forbidden:forge-linux-build-test-v1', { privileged: true }],
    ['runner-host-network-forbidden:forge-linux-build-test-v1', { hostNetwork: true }],
    ['runner-host-process-access-forbidden:forge-linux-build-test-v1', { hostProcessAccess: true }],
    ['runner-canonical-checkout-mount-forbidden:forge-linux-build-test-v1', { canonicalCheckoutMounted: true }],
    ['runner-container-socket-mount-forbidden:forge-linux-build-test-v1', { containerSocketMounted: true }],
    ['runner-github-credential-forbidden:forge-linux-build-test-v1', { githubCredentialAvailable: true }],
    ['runner-public-inbound-forbidden:forge-linux-build-test-v1', { publicInbound: true }],
    ['runner-tailscale-inbound-forbidden:forge-linux-build-test-v1', { tailscaleInbound: true }],
    ['runner-registration-request-forbidden:forge-linux-build-test-v1', { registrationRequested: true }],
    ['runner-execution-forbidden:forge-linux-build-test-v1', { executed: true }],
  ];
  for (const [expected, patch] of cases) {
    const result = planForgeShadowM3RunnerAdmission(input({
      runnerPools: [linuxPool(patch), windowsPool()],
    }));
    assert.ok(codes(result).has(expected), expected);
  }
});

test('rejects unbounded resources and non-ephemeral artifact posture', () => {
  const result = planForgeShadowM3RunnerAdmission(input({
    runnerPools: [linuxPool({
      count: 6,
      cpuLimit: 8,
      maxJobMinutes: 500,
      maxConcurrentJobs: 6,
      artifactRetentionDays: 365,
      maxArtifactBytes: Number.MAX_SAFE_INTEGER,
      ephemeralWorkspace: false,
      artifactPolicy: 'mutable',
    }), windowsPool()],
  }));
  const blocked = codes(result);
  for (const expected of [
    'runner-count-out-of-bounds:forge-linux-build-test-v1',
    'runner-cpu-out-of-bounds:forge-linux-build-test-v1',
    'runner-job-time-out-of-bounds:forge-linux-build-test-v1',
    'runner-concurrency-out-of-bounds:forge-linux-build-test-v1',
    'runner-artifact-retention-out-of-bounds:forge-linux-build-test-v1',
    'runner-artifact-size-out-of-bounds:forge-linux-build-test-v1',
    'runner-ephemeral-workspace-required:forge-linux-build-test-v1',
    'runner-artifact-policy-invalid:forge-linux-build-test-v1',
  ]) assert.ok(blocked.has(expected), expected);
});

test('rejects caller-supplied command, shell, environment, token, and path surfaces recursively', () => {
  for (const [field, value] of [
    ['command', 'npm test'],
    ['shell', 'pwsh'],
    ['environment', { MODE: 'unsafe' }],
    ['token', 'secret'],
    ['path', 'C:\\work'],
  ]) {
    const result = planForgeShadowM3RunnerAdmission({ ...input(), [field]: value });
    assert.ok([...codes(result)].some((code) => code.startsWith(`unsafe-field:${field}`)), field);
  }
});

test('closed-world runner pool fields reject hidden execution surfaces', () => {
  const result = planForgeShadowM3RunnerAdmission(input({
    runnerPools: [{ ...linuxPool(), workingDirectory: '/host' }, windowsPool()],
  }));
  assert.ok(codes(result).has('runner-pool-fields-invalid:forge-linux-build-test-v1'));
});

test('equivalent input order produces the same canonical runner plan', () => {
  const left = planForgeShadowM3RunnerAdmission(input({
    runnerPools: [windowsPool({ workloadIds: ['windows-source-controlled-proof', 'windows-edge-runtime-proof'] }), linuxPool()],
  }));
  const right = planForgeShadowM3RunnerAdmission(input({
    runnerPools: [linuxPool({ workloadIds: ['linux-stephanos-ui-build', 'linux-shared-agent-tests'] }), windowsPool({ workloadIds: ['windows-edge-runtime-proof', 'windows-source-controlled-proof'] })],
  }));
  assert.equal(left.valid, true);
  assert.equal(right.valid, true);
  assert.deepEqual(left.runnerPools.map(({ runnerClass, workloadIds }) => ({ runnerClass, workloadIds })), [
    { runnerClass: 'linux-isolated', workloadIds: ['linux-shared-agent-tests', 'linux-stephanos-ui-build'] },
    { runnerClass: 'windows-proof-isolated', workloadIds: ['windows-edge-runtime-proof', 'windows-source-controlled-proof'] },
  ]);
  assert.deepEqual(right.runnerPools, left.runnerPools);
});
