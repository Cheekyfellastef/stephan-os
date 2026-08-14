import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { planForgeShadowM3RunnerRuntime } from './forgeShadowM3RunnerRuntimePlanV1.mjs';
import { adjudicateForgeSidecarCapacity } from './stallSentinelReviewPipelineV1.mjs';
import {
  FORGE_SHADOW_M3_CANARY_SCENARIO,
  FORGE_SHADOW_M3_CANARY_WORKFLOW,
  FORGE_SHADOW_M3_AUTHORIZATION_RESERVATION_SCHEMA,
  FORGE_SHADOW_M3_EXECUTION_BLOCKED,
  FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
  FORGE_SHADOW_M3_EXECUTION_PROVEN,
  FORGE_SHADOW_M3_EXECUTION_READY,
  FORGE_SHADOW_M3_EXECUTION_SURFACE,
  FORGE_SHADOW_M3_OPERATOR_APPROVAL_SCHEMA,
  FORGE_SHADOW_M3_OPERATOR_APPROVAL_VERIFICATION_SCHEMA,
  FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
  FORGE_SHADOW_M3_TERMINATION_ACK_SCHEMA,
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

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentDigest(value) {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function forgeM2RuntimeReceipt() {
  const body = {
    schemaVersion: 'stephanos.forge-shadow-m2-runtime-receipt.v1',
    receiptId: 'forge-m2-runtime-receipt-001',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD, sourceTree: TREE, mirrorHead: HEAD, mirrorTree: TREE,
    operation: 'INSTALL_FORGE_SHADOW_M2', state: 'DONE',
    finalVerdict: 'FORGE_SHADOW_M2_READY', completedAt: NOW,
    proofRefs: ['receipts/forge/m2-runtime-receipt-001.json'],
  };
  return { ...body, payloadSha256: contentDigest(body) };
}

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
  const authorizationId = patch.authorizationId || 'forge-m3-runtime-authorization-20260807-001';
  const issuedAtUtc = patch.issuedAtUtc || '2026-08-07T21:19:00Z';
  const expiresAtUtc = patch.expiresAtUtc || '2026-08-07T22:19:00Z';
  const runtimePlanDigest = patch.runtimePlanDigest || buildForgeShadowM3RuntimePlanDigest(plan);
  const executionSurface = patch.executionSurface || FORGE_SHADOW_M3_EXECUTION_SURFACE;
  const approvalBody = {
    schemaVersion: FORGE_SHADOW_M3_OPERATOR_APPROVAL_SCHEMA,
    issuer: 'STEPHANOS_OPERATOR_APPROVAL_GATE',
    decision: 'APPROVED',
    proofRef: `proofs/operator-approvals/${authorizationId}/${'8'.repeat(64)}.json`,
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: patch.expectedHead || HEAD,
    expectedTree: patch.expectedTree || TREE,
    runtimePlanDigest,
    authorizationId,
    executionSurface,
    issuedAtUtc,
    expiresAtUtc,
    ...(patch.approvalPatch || {}),
  };
  const approvalReceipt = {
    ...approvalBody,
    payloadSha256: contentDigest(approvalBody),
    ...(patch.approvalReceiptPatch || {}),
  };
  const { approvalPatch, approvalReceiptPatch, ...authorizationPatch } = patch;
  return {
    schemaVersion: FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
    authorizationId,
    repository: 'Cheekyfellastef/stephan-os', expectedHead: HEAD, expectedTree: TREE,
    runtimePlanDigest, issuedAtUtc, expiresAtUtc, executionSurface,
    approvalReceipt, m3Only: true, ...authorizationPatch,
  };
}

function input(planInput = runtimePlanInput(), authorizationPatch = {}) {
  const plan = planForgeShadowM3RunnerRuntime(planInput);
  assert.equal(plan.valid, true);
  return { runtimePlanInput: planInput, runtimeAuthorization: authorization(plan, authorizationPatch) };
}

function observation({ runner, artifact, runtimePlan }, patch = {}) {
  const proofDigest = runner.runnerClass === 'linux-isolated' ? '6'.repeat(64) : '7'.repeat(64);
  const registrationProofRef = `proofs/forge-shadow-m3/${runner.runnerId}/${proofDigest}.json`;
  const completedAtUtc = patch.completedAtUtc || NOW;
  return {
    schemaVersion: FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
    authorizationId: patch.authorizationId,
    invocationId: patch.invocationId,
    runnerId: runner.runnerId, poolId: runner.poolId, runnerClass: runner.runnerClass,
    runtimeBoundary: runner.runtimeBoundary, sourceHead: HEAD, sourceTree: TREE,
    forgeService: runner.forgeService, forgeListener: runner.forgeListener,
    registrationRepository: 'Cheekyfellastef/stephan-os', registrationScope: 'repository',
    registrationMode: runner.registrationMode, oneJobMode: true, registrationProofRef,
    artifactDigest: artifact.artifactDigest, artifactSetDigest: runtimePlan.artifactSetDigest,
    startedAtUtc: NOW,
    teardownStartedAtUtc: patch.teardownStartedAtUtc || completedAtUtc,
    teardownCompletedAtUtc: patch.teardownCompletedAtUtc || completedAtUtc,
    completedAtUtc,
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
    proofRefs: [registrationProofRef],
    ...patch,
  };
}

function terminationAcknowledgement(request, patch = {}) {
  return {
    schemaVersion: FORGE_SHADOW_M3_TERMINATION_ACK_SCHEMA,
    authorizationId: request.authorizationId,
    invocationId: request.invocationId,
    runnerId: request.runner.runnerId,
    terminated: true,
    teardownAcknowledged: true,
    acknowledgedAtUtc: NOW,
    quarantined: false,
    quarantineAcknowledged: false,
    quarantineReason: '',
    quarantineProofRef: '',
    ...patch,
  };
}

function quarantineAcknowledgement(request, patch = {}) {
  return terminationAcknowledgement(request, {
    quarantined: true,
    quarantineAcknowledged: true,
    quarantineReason: 'TEARDOWN_POLICY_VIOLATION',
    quarantineProofRef: `proofs/forge-shadow-m3-quarantine/${request.runner.runnerId}/${request.authorizationId}/${request.invocationId}/${'9'.repeat(64)}.json`,
    ...patch,
  });
}

function executionResult(request, observationPatch = {}, terminationPatch = {}) {
  return {
    observation: observation(request, {
      authorizationId: request.authorizationId,
      invocationId: request.invocationId,
      ...observationPatch,
    }),
    terminationAcknowledgement: terminationAcknowledgement(request, terminationPatch),
  };
}

const now = () => new Date(NOW);

function approvalVerification(request, patch = {}) {
  return {
    schemaVersion: FORGE_SHADOW_M3_OPERATOR_APPROVAL_VERIFICATION_SCHEMA,
    verifierId: 'STEPHANOS_OPERATOR_APPROVAL_VERIFIER',
    verified: true,
    proofRef: request.approvalReceipt.proofRef,
    approvalPayloadSha256: request.approvalReceipt.payloadSha256,
    authorizationId: request.authorizationId,
    repository: request.repository,
    expectedHead: request.expectedHead,
    expectedTree: request.expectedTree,
    runtimePlanDigest: request.runtimePlanDigest,
    executionSurface: request.executionSurface,
    verifiedAtUtc: NOW,
    ...patch,
  };
}

function authorizationReservation(request, patch = {}) {
  return {
    schemaVersion: FORGE_SHADOW_M3_AUTHORIZATION_RESERVATION_SCHEMA,
    reserverId: 'STEPHANOS_OPERATOR_AUTHORIZATION_RESERVER',
    reservationId: `reservation-${request.authorizationId}`,
    reserved: true,
    authorizationId: request.authorizationId,
    receiptId: request.receiptId,
    approvalPayloadSha256: request.approvalPayloadSha256,
    repository: request.repository,
    expectedHead: request.expectedHead,
    expectedTree: request.expectedTree,
    runtimePlanDigest: request.runtimePlanDigest,
    reservedAtUtc: NOW,
    ...patch,
  };
}

function executeVerified(inputValue, options = {}) {
  return executeForgeShadowM3RunnerPlan(inputValue, {
    verifyOperatorApproval: async (request) => approvalVerification(request),
    reserveOperatorAuthorization: async (request) => authorizationReservation(request),
    ...options,
  });
}

test('executes only the canonical runner estate and emits a content-addressed M3 receipt', async () => {
  const calls = [];
  const result = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      calls.push(request);
      assert.equal(request.executionDeadlineUtc, '2026-08-07T22:19:00.000Z');
      assert.equal(request.signal.aborted, false);
      return executionResult(request);
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.finalVerdict, FORGE_SHADOW_M3_EXECUTION_PROVEN);
  assert.deepEqual(calls.map((call) => call.runner.runnerId), [
    'stephanos-forge-linux-runner-01',
    'stephanos-forge-windows-proof-runner-01',
  ]);
  assert.equal(result.receipt.canCarryRealWork, false);
  assert.deepEqual(result.receipt.runnerIdentities, [
    'stephanos-forge-linux-runner-01',
    'stephanos-forge-windows-proof-runner-01',
  ]);
  assert.equal(result.receipt.teardownComplete, true);
  assert.match(result.receipt.artifactSetDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.receipt.payloadSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.values(result.authority).every((value) => value === false), true);
  assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(result.receipt, {
    expectedRepository: 'Cheekyfellastef/stephan-os', expectedHead: HEAD, expectedTree: TREE,
    expectedRuntimePlanDigest: result.runtimePlanDigest,
    expectedArtifactSetDigest: result.receipt.artifactSetDigest,
  }).ok, true);
});

test('emits the exact canonical Forge routing receipt contract', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  assert.deepEqual(Object.keys(result.receipt).sort(), [
    'artifactSetDigest', 'canCarryRealWork', 'completedAt', 'finalVerdict',
    'linuxReviewRunnerConnected', 'payloadSha256', 'proofRefs', 'receiptId',
    'repository', 'runnerIdentities', 'schemaVersion', 'sourceHead', 'sourceTree',
    'teardownComplete', 'windowsProofRunnerConnected', 'zeroResidualCredential',
    'zeroResidualRegistration', 'zeroResidualWorkspace',
  ].sort());
  assert.equal(result.receipt.finalVerdict, 'FORGE_SHADOW_M3_RUNNER_CONSTRUCTION_PROVEN');
});

test('torn-down runner construction is historical proof and never current routable capacity', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.teardownComplete, true);
  assert.equal(result.receipt.canCarryRealWork, false);
  assert.notEqual(result.receipt.finalVerdict, FORGE_SHADOW_M3_EXECUTION_READY);
  const m2Receipt = forgeM2RuntimeReceipt();
  const capacity = adjudicateForgeSidecarCapacity({
    goalId: '#1671', repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD, canonicalMainTree: TREE, mirrorHead: HEAD, mirrorTree: TREE,
    sourceReady: true, m2Receipt, m3RuntimeReceipt: result.receipt,
    evidenceRefs: [...m2Receipt.proofRefs, ...result.receipt.proofRefs].sort(),
  }, { nowUtc: NOW });
  assert.equal(capacity.m2ReceiptValid, true);
  assert.equal(capacity.m3RuntimeReceiptValid, false);
  assert.equal(capacity.runtimeReady, false);
  assert.equal(capacity.exactHeadReviewReady, false);
  assert.equal(capacity.canCarryRealWork, false);
});

test('teardown evidence is ordered and quarantined beyond the canonical five-minute ceiling', async () => {
  const instants = [NOW, NOW, NOW, NOW, '2026-08-07T21:26:00Z'];
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || '2026-08-07T21:26:00Z'),
    executeRunner: async (request) => ({
      observation: observation(request, {
        authorizationId: request.authorizationId,
        invocationId: request.invocationId,
      startedAtUtc: '2026-08-07T21:20:00Z',
      teardownStartedAtUtc: '2026-08-07T21:20:00Z',
      teardownCompletedAtUtc: '2026-08-07T21:25:01Z',
      completedAtUtc: '2026-08-07T21:25:01Z',
      }),
      terminationAcknowledgement: quarantineAcknowledgement(request, {
        acknowledgedAtUtc: '2026-08-07T21:26:00Z',
      }),
    }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes(
    'runner-teardown-deadline-exceeded:stephanos-forge-linux-runner-01',
  ), JSON.stringify(result.blockers));
});

test('the exact inclusive five-minute teardown boundary remains admissible', async () => {
  const completedAtUtc = '2026-08-07T21:25:00Z';
  const instants = [NOW, NOW, NOW, NOW, completedAtUtc, NOW, completedAtUtc];
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || completedAtUtc),
    executeRunner: async (request) => executionResult(request, {
      teardownStartedAtUtc: NOW,
      teardownCompletedAtUtc: completedAtUtc,
      completedAtUtc,
    }, {
      acknowledgedAtUtc: completedAtUtc,
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
});

test('each teardown timestamp ordering predicate fails closed with the exact blocker', async (t) => {
  const cases = [
    {
      name: 'teardown starts before execution',
      patch: { teardownStartedAtUtc: '2026-08-07T21:19:59Z' },
    },
    {
      name: 'teardown completes before teardown starts',
      patch: { teardownStartedAtUtc: '2026-08-07T21:20:01Z' },
    },
    {
      name: 'teardown completion differs from overall completion',
      patch: { teardownCompletedAtUtc: '2026-08-07T21:20:01Z' },
    },
  ];

  for (const { name, patch } of cases) {
    await t.test(name, async () => {
      const instants = [NOW, NOW, NOW, NOW, '2026-08-07T21:26:00Z'];
      const result = await executeVerified(input(), {
        platform: 'win32',
        now: () => new Date(instants.shift() || '2026-08-07T21:26:00Z'),
        executeRunner: async (request) => ({
          observation: observation(request, {
            authorizationId: request.authorizationId,
            invocationId: request.invocationId,
            ...patch,
          }),
          terminationAcknowledgement: quarantineAcknowledgement(request, {
            acknowledgedAtUtc: '2026-08-07T21:26:00Z',
          }),
        }),
      });
      const orderingBlocker = 'runner-teardown-time-order-invalid:stephanos-forge-linux-runner-01';
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.blockers.filter((blocker) => blocker.includes('runner-teardown-time-order-invalid')),
        [orderingBlocker],
      );
    });
  }
});

test('teardown-policy violations remain pending until exact identity-bound quarantine proof', async () => {
  const settledAtUtc = '2026-08-07T21:26:00Z';
  const instants = [NOW, NOW, NOW, NOW, settledAtUtc, settledAtUtc];
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || settledAtUtc),
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        request.acknowledgeTermination(quarantineAcknowledgement(request, {
          invocationId: 'forge-m3-invocation-wrong',
          acknowledgedAtUtc: settledAtUtc,
        }));
        setTimeout(() => {
          request.acknowledgeTermination(quarantineAcknowledgement(request, {
            acknowledgedAtUtc: settledAtUtc,
          }));
        }, 25);
      }, { once: true });
      return executionResult(request, {
        teardownStartedAtUtc: NOW,
        teardownCompletedAtUtc: '2026-08-07T21:25:01Z',
        completedAtUtc: '2026-08-07T21:25:01Z',
      }, {
        acknowledgedAtUtc: settledAtUtc,
      });
    },
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-quarantine-ack-required')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-termination-ack-invocation-mismatch')), JSON.stringify(result.blockers));
});

test('one inert observation snapshot drives both teardown validation and quarantine classification', async () => {
  let lifecycleReads = 0;
  const result = await executeVerified(input(), {
    platform: 'win32',
    now,
    executeRunner: async (request) => {
      const returned = executionResult(request);
      Object.defineProperty(returned.observation, 'unregistered', {
        enumerable: true,
        configurable: true,
        get: () => {
          lifecycleReads += 1;
          return lifecycleReads > 1;
        },
      });
      returned.terminationAcknowledgement = quarantineAcknowledgement(request);
      return returned;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(lifecycleReads, 1);
  assert.ok(result.blockers.includes(
    'runner-teardown-incomplete:stephanos-forge-linux-runner-01:unregistered',
  ), JSON.stringify(result.blockers));
});

test('quarantine proof references bind runner, authorization and invocation identities', async () => {
  const wrongSegments = ['runner', 'authorization', 'invocation'];
  for (const wrongSegment of wrongSegments) {
    const execution = executeVerified(input(), {
      platform: 'win32',
      now,
      executeRunner: async (request) => {
        const identities = {
          runner: request.runner.runnerId,
          authorization: request.authorizationId,
          invocation: request.invocationId,
        };
        identities[wrongSegment] = `forge-m3-wrong-${wrongSegment}`;
        return executionResult(request, { unregistered: false }, {
          ...quarantineAcknowledgement(request),
          quarantineProofRef: `proofs/forge-shadow-m3-quarantine/${identities.runner}/${identities.authorization}/${identities.invocation}/${'9'.repeat(64)}.json`,
        });
      },
    });
    const state = await Promise.race([
      execution.then(() => 'unsafe-return'),
      new Promise((resolve) => setTimeout(() => resolve('held-pending'), 25)),
    ]);
    assert.equal(state, 'held-pending', wrongSegment);
  }
});

test('missing quarantine proof for a teardown-policy violation remains pending', async () => {
  const settledAtUtc = '2026-08-07T21:26:00Z';
  const instants = [NOW, NOW, NOW, NOW, settledAtUtc];
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || settledAtUtc),
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      return executionResult(request, {
        teardownStartedAtUtc: NOW,
        teardownCompletedAtUtc: '2026-08-07T21:25:01Z',
        completedAtUtc: '2026-08-07T21:25:01Z',
      }, {
        acknowledgedAtUtc: settledAtUtc,
      });
    },
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('quarantine proof cannot substitute for normal teardown proof on a valid observation', async () => {
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      return {
        observation: observation(request, {
          authorizationId: request.authorizationId,
          invocationId: request.invocationId,
        }),
        terminationAcknowledgement: quarantineAcknowledgement(request),
      };
    },
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('sparse runner proof-reference arrays fail closed before receipt construction', async () => {
  const sparseProofRefs = new Array(1);
  const result = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => executionResult(request, { proofRefs: sparseProofRefs }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes(
    'runner-proof-refs-invalid:stephanos-forge-linux-runner-01',
  ), JSON.stringify(result.blockers));
});

test('authority-bearing arrays reject every non-index own property', async () => {
  for (const extraKey of ['command', Symbol('hidden-authority')]) {
    const proofRefs = [`proofs/forge-shadow-m3/stephanos-forge-linux-runner-01/${'6'.repeat(64)}.json`];
    Object.defineProperty(proofRefs, extraKey, { value: 'hidden', enumerable: true });
    const result = await executeVerified(input(), {
      platform: 'win32', now,
      executeRunner: async (request) => executionResult(request, {
        proofRefs: request.runner.runnerClass === 'linux-isolated'
          ? proofRefs
          : observation(request, {
              authorizationId: request.authorizationId,
              invocationId: request.invocationId,
            }).proofRefs,
      }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((item) => item.includes('runner-proof-refs-invalid')), JSON.stringify(result.blockers));
  }
});

test('replans against the trusted execution clock so caller history cannot admit stale evidence', async () => {
  const result = await executeVerified(input(runtimePlanInput(), {
    issuedAtUtc: '2026-08-09T21:59:00Z',
    expiresAtUtc: '2026-08-09T22:59:00Z',
  }), {
    platform: 'win32',
    now: () => new Date('2026-08-09T22:00:00Z'),
    executeRunner: async (request) => executionResult(request),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('runtime-plan-not-ready'), JSON.stringify(result.blockers));
});

test('rechecks authorization immediately before every runner invocation', async () => {
  const instants = [
    '2026-08-07T21:20:00Z',
    '2026-08-07T21:20:00Z',
    '2026-08-07T21:20:00Z',
    '2026-08-07T21:20:00Z',
    '2026-08-07T21:20:00Z',
    '2026-08-07T22:19:00Z',
  ];
  let calls = 0;
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift()),
    executeRunner: async (request) => {
      calls += 1;
      return executionResult(request);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('runtime-authorization-expired'), JSON.stringify(result.blockers));
});

test('runtime authorization is exact-head, exact-tree, exact-plan, surface and time bound', async () => {
  for (const patch of [
    { expectedHead: 'f'.repeat(40) }, { expectedTree: 'f'.repeat(40) },
    { runtimePlanDigest: `sha256:${'f'.repeat(64)}` }, { executionSurface: 'CLOUD' },
    { approvalReceipt: undefined }, { m3Only: false },
    { expiresAtUtc: '2026-08-07T21:20:00Z' },
    { expiresAtUtc: '2026-08-08T01:19:00Z' },
  ]) {
    const result = await executeVerified(input(runtimePlanInput(), patch), {
      platform: 'win32', now, executeRunner: async (request) => executionResult(request),
    });
    assert.equal(result.ok, false);
    assert.equal(result.finalVerdict, FORGE_SHADOW_M3_EXECUTION_BLOCKED);
  }
});

test('operator approval is closed-world, content-bound and cannot be self-asserted', async () => {
  const cases = [
    [{ approvalPatch: { issuer: 'CALLER_ASSERTED_APPROVAL' } }, 'operator-approval-issuer-invalid'],
    [{ approvalPatch: { decision: 'DENIED' } }, 'operator-approval-decision-invalid'],
    [{ approvalPatch: { repository: 'attacker/repository' } }, 'operator-approval-repository-mismatch'],
    [{ approvalPatch: { expiresAtUtc: '2026-08-07T21:19:30Z' } }, 'operator-approval-expired'],
    [{ approvalPatch: { widenedAuthority: true } }, 'operator-approval-fields-invalid'],
    [{ approvalReceiptPatch: { payloadSha256: '0'.repeat(64) } }, 'operator-approval-content-digest-invalid'],
  ];
  for (const [patch, blocker] of cases) {
    let calls = 0;
    const result = await executeVerified(input(runtimePlanInput(), patch), {
      platform: 'win32', now,
      executeRunner: async (request) => {
        calls += 1;
        return executionResult(request);
      },
    });
    assert.equal(calls, 0, `${blocker} reached the executor`);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes(blocker), JSON.stringify(result.blockers));
  }
});

test('operator approval requires an independent host verifier bound to the immutable proof', async () => {
  let calls = 0;
  const executeRunner = async (request) => {
    calls += 1;
    return executionResult(request);
  };
  const missing = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'win32', now, executeRunner,
  });
  assert.equal(calls, 0);
  assert.ok(missing.blockers.includes('operator-approval-verifier-not-configured'));

  const cases = [
    [() => { throw new Error('unavailable'); }, 'operator-approval-verifier-threw'],
    [(request) => approvalVerification(request, { verified: false }), 'operator-approval-not-verified'],
    [(request) => approvalVerification(request, { approvalPayloadSha256: '0'.repeat(64) }), 'operator-approval-verification-digest-mismatch'],
    [(request) => approvalVerification(request, { authorizationId: 'forge-m3-runtime-authorization-replayed' }), 'operator-approval-verification-authorization-mismatch'],
    [(request) => approvalVerification(request, { proofRef: `proofs/operator-approvals/replayed/${'9'.repeat(64)}.json` }), 'operator-approval-verification-proof-ref-mismatch'],
    [(request) => approvalVerification(request, { verifiedAtUtc: '2026-08-07T21:18:59Z' }), 'operator-approval-verification-time-invalid'],
    [(request) => ({ ...approvalVerification(request), widenedAuthority: true }), 'operator-approval-verification-fields-invalid'],
  ];
  for (const [verifyOperatorApproval, blocker] of cases) {
    calls = 0;
    const result = await executeVerified(input(), {
      platform: 'win32', now, executeRunner, verifyOperatorApproval,
    });
    assert.equal(calls, 0, `${blocker} reached the executor`);
    assert.ok(result.blockers.includes(blocker), JSON.stringify(result.blockers));
  }
});

test('asynchronous approval verification is checked against a fresh trusted settlement clock', async () => {
  const instants = [
    '2026-08-07T21:20:00Z',
    '2026-08-07T21:20:01Z',
    '2026-08-07T21:20:01Z',
    '2026-08-07T21:20:01Z',
    '2026-08-07T21:20:02Z',
    '2026-08-07T21:20:02Z',
    '2026-08-07T21:20:03Z',
  ];
  let runner = 0;
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift()),
    verifyOperatorApproval: async (request) => approvalVerification(request, {
      verifiedAtUtc: '2026-08-07T21:20:01Z',
    }),
    executeRunner: async (request) => {
      runner += 1;
      const startedAtUtc = runner === 1 ? '2026-08-07T21:20:01Z' : '2026-08-07T21:20:02Z';
      const acknowledgedAtUtc = runner === 1 ? '2026-08-07T21:20:02Z' : '2026-08-07T21:20:03Z';
      return executionResult(request, { startedAtUtc, completedAtUtc: startedAtUtc }, { acknowledgedAtUtc });
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
});

test('unsupported but admissible runner counts fail before approval verification or host execution', async () => {
  const planInput = runtimePlanInput();
  const widenedPlanInput = {
    ...planInput,
    admissionInput: {
      ...planInput.admissionInput,
      runnerPools: [pool('windows-proof-isolated'), { ...pool('linux-isolated'), count: 2 }],
    },
  };
  let verificationCalls = 0;
  let executionCalls = 0;
  const result = await executeVerified(input(widenedPlanInput), {
    platform: 'win32', now,
    verifyOperatorApproval: async (request) => {
      verificationCalls += 1;
      return approvalVerification(request);
    },
    executeRunner: async (request) => {
      executionCalls += 1;
      return executionResult(request);
    },
  });
  assert.equal(verificationCalls, 0);
  assert.equal(executionCalls, 0);
  assert.ok(result.blockers.includes('runtime-plan-runner-estate-unsupported'), JSON.stringify(result.blockers));
});

test('authorization reservation is mandatory, atomic and consumed before runner execution', async () => {
  let calls = 0;
  const executeRunner = async (request) => {
    calls += 1;
    return executionResult(request);
  };
  const missing = await executeForgeShadowM3RunnerPlan(input(), {
    platform: 'win32', now, executeRunner,
    verifyOperatorApproval: async (request) => approvalVerification(request),
  });
  assert.equal(calls, 0);
  assert.ok(missing.blockers.includes('runtime-authorization-reserver-not-configured'));

  const consumed = new Set();
  const reserveOperatorAuthorization = async (request) => {
    await Promise.resolve();
    if (consumed.has(request.authorizationId)) {
      return authorizationReservation(request, { reserved: false });
    }
    consumed.add(request.authorizationId);
    return authorizationReservation(request);
  };
  const first = executeVerified(input(), {
    platform: 'win32', now, executeRunner, reserveOperatorAuthorization,
  });
  const replay = executeVerified(input(), {
    platform: 'win32', now, executeRunner, reserveOperatorAuthorization,
  });
  const [firstResult, replayResult] = await Promise.all([first, replay]);
  assert.equal(firstResult.ok, true, JSON.stringify(firstResult, null, 2));
  assert.equal(replayResult.ok, false);
  assert.ok(replayResult.blockers.includes('runtime-authorization-already-consumed'), JSON.stringify(replayResult.blockers));
  assert.equal(calls, 2, 'replayed authorization reached a runner');
});

test('oversized derived receipt identities fail before runner execution', async () => {
  let calls = 0;
  const result = await executeVerified(input(runtimePlanInput(), {
    authorizationId: `a${'b'.repeat(119)}`,
  }), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      calls += 1;
      return executionResult(request);
    },
  });
  assert.equal(calls, 0);
  assert.ok(result.blockers.includes('runtime-authorization-receipt-id-invalid'), JSON.stringify(result.blockers));
});

test('execution is Windows-bound and refuses to start without the fixed runner executor', async () => {
  const wrongHost = await executeVerified(input(), {
    platform: 'linux', now, executeRunner: async (request) => executionResult(request),
  });
  assert.equal(wrongHost.ok, false);
  assert.ok(wrongHost.blockers.includes('connected-windows-battle-bridge-required'));
  const missing = await executeVerified(input(), { platform: 'win32', now });
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
    { registrationRepository: 'attacker/repository' }, { registrationScope: 'instance' },
    { forgeService: 'attacker-forge' }, { forgeListener: '127.0.0.1:9999' },
    { registrationMode: 'persistent' }, { oneJobMode: false },
    { registrationProofRef: `proofs/forge-shadow-m3/unrelated/${'9'.repeat(64)}.json` },
    { proofRefs: ['proofs/forge-shadow-m3/not-content-addressed.json'] },
  ]) {
    let first = true;
    const result = await executeVerified(input(), {
      platform: 'win32', now,
      executeRunner: async (request) => {
        request.signal.addEventListener('abort', () => {
          request.acknowledgeTermination(quarantineAcknowledgement(request));
        }, { once: true });
        const selected = first ? patch : {};
        first = false;
        return executionResult(request, selected);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.receipt, null);
  }
});

test('live executor deadline enforces the per-runner limit before authorization expiry', async () => {
  const result = await executeVerified(input(runtimePlanInput(), {
    issuedAtUtc: '2026-08-07T21:19:00Z',
    expiresAtUtc: '2026-08-07T23:19:00Z',
  }), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      assert.equal(request.executionDeadlineUtc, '2026-08-07T22:20:00.000Z');
      return executionResult(request);
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
});

test('runner observations are bound to both authorization and fresh invocation identity', async () => {
  let cached;
  const replay = await executeVerified(input(), {
    platform: 'win32', now,
    createInvocationId: ({ runnerId }) => `invocation-${runnerId}`,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        request.acknowledgeTermination(terminationAcknowledgement(request));
      }, { once: true });
      if (!cached) {
        cached = executionResult(request);
        return cached;
      }
      return cached;
    },
  });
  assert.equal(replay.ok, false);
  assert.ok(replay.blockers.some((item) => item.includes('runner-invocation-identity-mismatch')), JSON.stringify(replay.blockers));
  assert.ok(replay.blockers.some((item) => item.includes('runner-termination-ack-invocation-mismatch')), JSON.stringify(replay.blockers));

  const wrongAuthorization = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => executionResult(request, {
      authorizationId: 'forge-m3-runtime-authorization-replayed',
    }),
  });
  assert.ok(wrongAuthorization.blockers.some((item) => item.includes('runner-authorization-identity-mismatch')), JSON.stringify(wrongAuthorization.blockers));
});

test('future-dated observations and teardown acknowledgements cannot outrun trusted settlement', async () => {
  const completedAtUtc = '2026-08-07T21:20:01Z';
  const instants = [NOW, NOW, NOW, NOW, NOW, completedAtUtc];
  let calls = 0;
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || completedAtUtc),
    executeRunner: async (request) => {
      calls += 1;
      request.signal.addEventListener('abort', () => {
        request.acknowledgeTermination(terminationAcknowledgement(request, {
          acknowledgedAtUtc: completedAtUtc,
        }));
      }, { once: true });
      return executionResult(request, {
        completedAtUtc,
      }, {
        acknowledgedAtUtc: completedAtUtc,
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-time-outside-invocation')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-termination-ack-time-invalid')), JSON.stringify(result.blockers));
});

test('fulfilled settlement after the computed live deadline cannot mint a receipt', async () => {
  const instants = [
    NOW, NOW, NOW, NOW, '2026-08-07T22:20:00Z',
  ];
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift()),
    executeRunner: async (request) => executionResult(request),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-settlement-after-deadline')), JSON.stringify(result.blockers));
});

test('termination acknowledgement cannot predate observed completion', async () => {
  const instants = [NOW, NOW, NOW, NOW, '2026-08-07T21:20:01Z', '2026-08-07T21:20:01Z'];
  const result = await executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift()),
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        request.acknowledgeTermination(terminationAcknowledgement(request, {
          acknowledgedAtUtc: '2026-08-07T21:20:01Z',
        }));
      }, { once: true });
      return executionResult(request, {
        completedAtUtc: '2026-08-07T21:20:01Z',
      }, {
        acknowledgedAtUtc: NOW,
      });
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-termination-before-observation-complete')), JSON.stringify(result.blockers));
});

test('a rejected observation preserves its later completion boundary until delayed teardown proof', async () => {
  const completedAtUtc = '2026-08-07T21:20:05Z';
  const instants = [NOW, NOW, NOW, NOW, completedAtUtc, completedAtUtc];
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || completedAtUtc),
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(() => {
          request.acknowledgeTermination(quarantineAcknowledgement(request, {
            acknowledgedAtUtc: completedAtUtc,
          }));
        }, 25);
      }, { once: true });
      return executionResult(request, {
        completedAtUtc,
        unregistered: false,
      }, {
        acknowledgedAtUtc: NOW,
      });
    },
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.receipt, null);
  assert.ok(result.blockers.some((item) => item.includes('runner-teardown-incomplete')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-quarantine-ack-required')), JSON.stringify(result.blockers));
});

test('a malformed overall completion cannot erase a safe later teardown-completion boundary', async () => {
  const teardownCompletedAtUtc = '2026-08-07T21:20:05Z';
  const instants = [NOW, NOW, NOW, NOW, teardownCompletedAtUtc, teardownCompletedAtUtc];
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32',
    now: () => new Date(instants.shift() || teardownCompletedAtUtc),
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(() => {
          request.acknowledgeTermination(quarantineAcknowledgement(request, {
            acknowledgedAtUtc: teardownCompletedAtUtc,
          }));
        }, 25);
      }, { once: true });
      return {
        observation: observation(request, {
          authorizationId: request.authorizationId,
          invocationId: request.invocationId,
          teardownCompletedAtUtc,
          completedAtUtc: 'not-an-instant',
        }),
        terminationAcknowledgement: quarantineAcknowledgement(request, {
          acknowledgedAtUtc: NOW,
        }),
      };
    },
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-time-invalid')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-termination-before-observation-complete')), JSON.stringify(result.blockers));
});

test('missing or permanently early teardown proof for a rejected observation remains pending', async () => {
  const completedAtUtc = '2026-08-07T21:20:05Z';
  for (const publishEarlyAfterAbort of [false, true]) {
    const instants = [NOW, NOW, NOW, NOW, completedAtUtc, completedAtUtc];
    let aborted = false;
    const execution = executeVerified(input(), {
      platform: 'win32',
      now: () => new Date(instants.shift() || completedAtUtc),
      executeRunner: async (request) => {
        request.signal.addEventListener('abort', () => {
          aborted = true;
          if (publishEarlyAfterAbort) {
            request.acknowledgeTermination(quarantineAcknowledgement(request, {
              acknowledgedAtUtc: NOW,
            }));
          }
        }, { once: true });
        const result = executionResult(request, {
          completedAtUtc,
          unregistered: false,
        }, {
          acknowledgedAtUtc: NOW,
        });
        if (!publishEarlyAfterAbort) result.terminationAcknowledgement = undefined;
        return result;
      },
    });
    const state = await Promise.race([
      execution.then(() => 'unsafe-return'),
      new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
    ]);
    assert.equal(aborted, true);
    assert.equal(state, 'held-pending');
  }
});

test('malformed or hostile completion evidence fails closed without throwing', async () => {
  const candidates = [
    (request) => executionResult(request, {
      completedAtUtc: 'not-an-instant',
    }, {
      terminated: false,
    }),
    (request) => {
      const result = executionResult(request, {}, { terminated: false });
      Object.defineProperty(result.observation, 'completedAtUtc', {
        enumerable: true,
        get: () => { throw new Error('hostile completion getter'); },
      });
      return result;
    },
  ];
  for (const candidate of candidates) {
    let aborted = false;
    const execution = executeVerified(input(), {
      platform: 'win32', now,
      executeRunner: async (request) => {
        request.signal.addEventListener('abort', () => {
          aborted = true;
          setTimeout(() => {
            request.acknowledgeTermination(quarantineAcknowledgement(request));
          }, 20);
        }, { once: true });
        return candidate(request);
      },
    });
    const result = await execution;
    assert.equal(aborted, true);
    assert.equal(result.ok, false);
    assert.equal(result.receipt, null);
    assert.ok(result.blockers.some((item) => (
      item.includes('runner-time-invalid')
      || item.includes('runner-execution-result-inspection-threw')
    )), JSON.stringify(result.blockers));
  }
});

test('two runner proof estates may safely fill the aggregate sixteen-reference receipt bound', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => executionResult(request, {
      proofRefs: Array.from({ length: 8 }, (_, index) => (
        `proofs/forge-shadow-m3/${request.runner.runnerId}/${String(index + 1).repeat(64)}.json`
      )),
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.receipt.proofRefs.length, 16);
});

test('deadline abort waits for executor settlement and delayed teardown acknowledgement', async () => {
  const deadlineInput = input(runtimePlanInput(), {
    issuedAtUtc: '2026-08-07T21:19:59Z',
    expiresAtUtc: '2026-08-07T21:20:00.010Z',
  });
  let aborted = false;
  const started = Date.now();
  const execution = executeVerified(deadlineInput, {
    platform: 'win32', now,
    executeRunner: (request) => new Promise((resolve) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(() => resolve(executionResult(request)), 25);
      }, { once: true });
    }),
  });
  const early = await Promise.race([
    execution.then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
  ]);
  assert.equal(early, 'pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.ok(Date.now() - started >= 25);
  assert.ok(result.blockers.some((item) => item.includes('runner-execution-deadline-exceeded')), JSON.stringify(result.blockers));
});

test('non-cooperative executor cannot make the adapter return while host work remains unsettled', async () => {
  const deadlineInput = input(runtimePlanInput(), {
    issuedAtUtc: '2026-08-07T21:19:59Z',
    expiresAtUtc: '2026-08-07T21:20:00.010Z',
  });
  let aborted = false;
  const execution = executeVerified(deadlineInput, {
    platform: 'win32', now,
    executeRunner: (request) => new Promise(() => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    }),
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('fulfilled settlement-clock exceptions abort and wait for valid teardown proof', async () => {
  let clockReads = 0;
  let aborted = false;
  const started = Date.now();
  const execution = executeVerified(input(), {
    platform: 'win32',
    now: () => {
      clockReads += 1;
      if (clockReads === 5) throw new Error('trusted settlement clock unavailable');
      return new Date(NOW);
    },
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(() => {
          request.acknowledgeTermination(terminationAcknowledgement(request));
        }, 25);
      }, { once: true });
      return executionResult(request, {}, { terminated: false });
    },
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.ok(Date.now() - started >= 25);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-settlement-now-invalid')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-termination-not-acknowledged')), JSON.stringify(result.blockers));
});

test('rejected settlement-clock exceptions cannot return without teardown proof', async () => {
  let clockReads = 0;
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32',
    now: () => {
      clockReads += 1;
      if (clockReads === 5) throw new Error('trusted settlement clock unavailable');
      return new Date(NOW);
    },
    executeRunner: (request) => new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      reject(new Error('host failed while settlement clock was unavailable'));
    }),
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('hostile fulfilled values abort and wait for valid teardown proof', async () => {
  const candidates = [
    () => new Proxy({}, {
      ownKeys: () => { throw new Error('result keys unavailable'); },
    }),
    (request) => {
      const result = executionResult(request, {}, { terminated: false });
      Object.defineProperty(result.observation, 'installed', {
        enumerable: true,
        get: () => { throw new Error('nested observation unavailable'); },
      });
      return result;
    },
  ];
  for (const candidate of candidates) {
    let aborted = false;
    const execution = executeVerified(input(), {
      platform: 'win32', now,
      executeRunner: async (request) => {
        request.signal.addEventListener('abort', () => {
          aborted = true;
          setTimeout(() => {
            request.acknowledgeTermination(terminationAcknowledgement(request));
            request.acknowledgeTermination(quarantineAcknowledgement(request));
          }, 25);
        }, { once: true });
        return candidate(request);
      },
    });
    const early = await Promise.race([
      execution.then(() => 'unsafe-return'),
      new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
    ]);
    assert.equal(early, 'held-pending');
    const result = await execution;
    assert.equal(aborted, true);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((item) => item.includes('runner-execution-result-inspection-threw')), JSON.stringify(result.blockers));
  }
});

test('cyclic fulfilled values abort and wait for valid teardown proof', async () => {
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(() => {
          request.acknowledgeTermination(terminationAcknowledgement(request));
        }, 25);
      }, { once: true });
      const result = executionResult(request, {}, { terminated: false });
      result.observation.cycle = result.observation;
      return result;
    },
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-observation-fields-invalid')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-observation-unsafe-field')), JSON.stringify(result.blockers));
});

test('result-inspection exceptions cannot return without teardown proof', async () => {
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      return new Proxy({}, {
        ownKeys: () => { throw new Error('result keys unavailable'); },
      });
    },
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('malformed fulfilled results trigger abort and wait for delayed valid teardown proof', async () => {
  let aborted = false;
  const started = Date.now();
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        setTimeout(() => {
          request.acknowledgeTermination(terminationAcknowledgement(request));
        }, 25);
      }, { once: true });
      return { observation: observation(request, {
        authorizationId: request.authorizationId,
        invocationId: request.invocationId,
      }) };
    },
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.ok(Date.now() - started >= 25);
  assert.ok(result.blockers.some((item) => item.includes('runner-execution-result-fields-invalid')), JSON.stringify(result.blockers));
});

test('widened fulfilled results trigger abort before a blocked return', async () => {
  let aborted = false;
  const result = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        request.acknowledgeTermination(terminationAcknowledgement(request));
      }, { once: true });
      return { ...executionResult(request), widenedAuthority: true };
    },
  });
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-execution-result-fields-invalid')), JSON.stringify(result.blockers));
});

test('fulfilled results missing termination acknowledgement cannot return', async () => {
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      return { observation: observation(request, {
        authorizationId: request.authorizationId,
        invocationId: request.invocationId,
      }) };
    },
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('malformed, widened or hostile acknowledgements cannot permit a rejection return', async () => {
  for (const candidate of [
    { terminated: true },
    (request) => ({ ...terminationAcknowledgement(request), widenedAuthority: true }),
    (request) => quarantineAcknowledgement(request, { quarantineAcknowledged: false }),
    (request) => quarantineAcknowledgement(request, { quarantineReason: 'CALLER_SELECTED' }),
    (request) => quarantineAcknowledgement(request, {
      quarantineProofRef: `proofs/forge-shadow-m3/unrelated/${'9'.repeat(64)}.json`,
    }),
    () => new Proxy({}, {
      ownKeys: () => { throw new Error('acknowledgement keys unavailable'); },
    }),
  ]) {
    const execution = executeVerified(input(), {
      platform: 'win32', now,
      executeRunner: (request) => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          request.acknowledgeTermination(typeof candidate === 'function' ? candidate(request) : candidate);
        }, { once: true });
        reject(new Error('host failed before valid teardown proof'));
      }),
    });
    const state = await Promise.race([
      execution.then(() => 'unsafe-return'),
      new Promise((resolve) => setTimeout(() => resolve('held-pending'), 25)),
    ]);
    assert.equal(state, 'held-pending');
  }
});

test('wrong identity, stale, future or false acknowledgements cannot permit a rejection return', async () => {
  const cases = [
    (request) => terminationAcknowledgement(request, { invocationId: 'forge-m3-invocation-wrong' }),
    (request) => terminationAcknowledgement(request, { authorizationId: 'forge-m3-runtime-authorization-wrong' }),
    (request) => terminationAcknowledgement(request, { runnerId: 'stephanos-forge-runner-wrong' }),
    (request) => terminationAcknowledgement(request, { acknowledgedAtUtc: '2026-08-07T21:19:59Z' }),
    (request) => terminationAcknowledgement(request, { acknowledgedAtUtc: '2026-08-07T21:20:01Z' }),
    (request) => terminationAcknowledgement(request, { terminated: false }),
    (request) => terminationAcknowledgement(request, { teardownAcknowledged: false }),
  ];
  for (const candidate of cases) {
    const execution = executeVerified(input(), {
      platform: 'win32', now,
      executeRunner: (request) => new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          request.acknowledgeTermination(candidate(request));
        }, { once: true });
        reject(new Error('host failed before valid teardown proof'));
      }),
    });
    const state = await Promise.race([
      execution.then(() => 'unsafe-return'),
      new Promise((resolve) => setTimeout(() => resolve('held-pending'), 25)),
    ]);
    assert.equal(state, 'held-pending');
  }
});

test('a delayed valid acknowledgement permits a blocked rejection result', async () => {
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: (request) => new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
        request.acknowledgeTermination({ ...terminationAcknowledgement(request), widenedAuthority: true });
        setTimeout(() => {
          request.acknowledgeTermination(terminationAcknowledgement(request));
        }, 25);
      }, { once: true });
      reject(new Error('host failed before teardown completed'));
    }),
  });
  const early = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 15)),
  ]);
  assert.equal(early, 'held-pending');
  const result = await execution;
  assert.equal(aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.authority.runtimeMutation, false);
  assert.ok(result.blockers.some((item) => item.includes('runner-executor-threw')), JSON.stringify(result.blockers));
  assert.ok(result.blockers.some((item) => item.includes('runner-termination-ack-fields-invalid')), JSON.stringify(result.blockers));
});

test('credential-shaped or widened executor observations are rejected and never serialized', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: async (request) => ({
      ...executionResult(request),
      observation: { ...executionResult(request).observation, token: 'must-not-survive' },
    }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('runner-observation-unsafe-field')), JSON.stringify(result.blockers));
  assert.doesNotMatch(JSON.stringify(result), /must-not-survive/);
});

test('executor failures cannot mint a runtime receipt', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: (request) => new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => {
        request.acknowledgeTermination(terminationAcknowledgement(request));
      }, { once: true });
      reject(new Error('host failed'));
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.receipt, null);
  assert.ok(result.blockers[0].startsWith('runner-executor-threw:'));
  assert.doesNotMatch(JSON.stringify(result), /host failed/);
});

test('executor rejection cannot return while termination remains unacknowledged', async () => {
  let aborted = false;
  const execution = executeVerified(input(), {
    platform: 'win32', now,
    executeRunner: (request) => new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      reject(new Error('host failed before proof'));
    }),
  });
  const state = await Promise.race([
    execution.then(() => 'unsafe-return'),
    new Promise((resolve) => setTimeout(() => resolve('held-pending'), 35)),
  ]);
  assert.equal(aborted, true);
  assert.equal(state, 'held-pending');
});

test('receipt validation detects post-issuance mutation and hidden fields', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  const mutated = structuredClone(result.receipt);
  mutated.canCarryRealWork = true;
  assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(mutated).ok, false);
  const widened = { ...structuredClone(result.receipt), command: 'not-allowed' };
  assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(widened).ok, false);
});

test('closed-world records include non-enumerable and symbolic own keys', async () => {
  for (const extraKey of ['command', Symbol('hidden-authority')]) {
    const candidate = structuredClone(input());
    Object.defineProperty(candidate.runtimeAuthorization, extraKey, {
      value: 'hidden',
      enumerable: false,
    });
    let executorCalls = 0;
    const result = await executeVerified(candidate, {
      platform: 'win32',
      now,
      executeRunner: async (request) => {
        executorCalls += 1;
        return executionResult(request);
      },
    });
    assert.equal(result.ok, false, String(extraKey));
    assert.equal(executorCalls, 0, String(extraKey));
    assert.ok(result.blockers.includes('runtime-authorization-fields-invalid'), JSON.stringify(result.blockers));
  }

  const valid = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  for (const extraKey of ['command', Symbol('hidden-authority')]) {
    const widened = structuredClone(valid.receipt);
    Object.defineProperty(widened, extraKey, { value: 'hidden', enumerable: false });
    assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(widened).ok, false, String(extraKey));
  }
});

test('receipt validation returns one immutable inert projection', async () => {
  const executed = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  const hostile = structuredClone(executed.receipt);
  let capacityReads = 0;
  Object.defineProperty(hostile, 'canCarryRealWork', {
    enumerable: true,
    configurable: true,
    get: () => {
      capacityReads += 1;
      return capacityReads > 1;
    },
  });
  const validation = validateForgeShadowM3RunnerRuntimeReceipt(hostile);
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
  assert.equal(capacityReads, 1);
  assert.notEqual(validation.receipt, hostile);
  assert.equal(validation.receipt.canCarryRealWork, false);
  assert.equal(Object.isFrozen(validation.receipt), true);
  assert.equal(Object.isFrozen(validation.receipt.runnerIdentities), true);
  assert.equal(Object.isFrozen(validation.receipt.proofRefs), true);
});

test('receipt validation rejects named and symbolic properties on every authority array', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  for (const field of ['proofRefs', 'runnerIdentities']) {
    for (const extraKey of ['command', Symbol('hidden-authority')]) {
      const widened = structuredClone(result.receipt);
      Object.defineProperty(widened[field], extraKey, { value: 'hidden', enumerable: true });
      assert.equal(validateForgeShadowM3RunnerRuntimeReceipt(widened).ok, false, `${field}:${String(extraKey)}`);
    }
  }
});

test('the public receipt validator is total for hostile and cyclic caller values', async () => {
  const result = await executeVerified(input(), {
    platform: 'win32', now, executeRunner: async (request) => executionResult(request),
  });
  const throwingGetter = structuredClone(result.receipt);
  Object.defineProperty(throwingGetter, 'receiptId', {
    enumerable: true,
    get: () => { throw new Error('hostile receipt getter'); },
  });
  const cyclic = structuredClone(result.receipt);
  cyclic.cycle = cyclic;
  const candidates = [
    new Proxy({}, { ownKeys: () => { throw new Error('hostile ownKeys trap'); } }),
    throwingGetter,
    cyclic,
  ];
  for (const candidate of candidates) {
    let validation;
    assert.doesNotThrow(() => { validation = validateForgeShadowM3RunnerRuntimeReceipt(candidate); });
    assert.equal(validation.ok, false);
    assert.deepEqual(validation.blockers, ['receipt-inspection-failed']);
    assert.equal(validation.receipt, null);
  }

  let hostileExpectation;
  assert.doesNotThrow(() => {
    hostileExpectation = validateForgeShadowM3RunnerRuntimeReceipt(result.receipt, new Proxy({
      expectedRepository: 'Cheekyfellastef/stephan-os',
    }, {
      get: () => { throw new Error('hostile expectation getter'); },
    }));
  });
  assert.deepEqual(hostileExpectation.blockers, ['receipt-inspection-failed']);
});
