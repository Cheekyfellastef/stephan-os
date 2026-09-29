import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
  FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
  FORGE_SHADOW_M3_TERMINATION_ACK_SCHEMA,
  buildForgeShadowM3RuntimePlanDigest,
} from './forgeShadowM3RunnerExecutionReceiptAdapterV1.mjs';
import {
  FORGE_SHADOW_M3_FIXED_EXECUTION_READY,
  FORGE_SHADOW_M3_FIXED_EXECUTION_RECEIPT_SCHEMA,
  createForgeShadowM3FixedProofExecutor,
  validateForgeShadowM3FixedProofExecutionReceipt,
} from './forgeShadowM3FixedProofExecutorV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const SCRIPT_BLOB = 'c'.repeat(40);
const BACKUP = 'd'.repeat(64);
const LINUX_DIGEST = `sha256:${'e'.repeat(64)}`;
const WINDOWS_DIGEST = `sha256:${'f'.repeat(64)}`;
const ARTIFACT_SET = '1'.repeat(64);
const REPOSITORY_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const COMPLETE = '2026-08-10T13:05:00.000Z';

function runtimePlan() {
  return {
    valid: true,
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: HEAD,
    canonicalMainTree: TREE,
    artifactSetDigest: ARTIFACT_SET,
    runnerArtifacts: [
      { runnerClass: 'linux-isolated', artifactDigest: LINUX_DIGEST, version: '11.0.1' },
      { runnerClass: 'windows-proof-isolated', artifactDigest: WINDOWS_DIGEST, version: '11.0.1' },
    ],
    runners: [
      {
        runnerId: 'stephanos-forge-linux-runner-01', poolId: 'forge-linux-build-test-v1',
        runnerClass: 'linux-isolated', runtimeBoundary: 'forge-linux-rootless-ephemeral',
        forgeService: 'stephanos-forge-shadow-m3-canary', forgeListener: '127.0.0.1:3342',
        registrationMode: 'one-time-local-contained',
      },
      {
        runnerId: 'stephanos-forge-windows-proof-runner-01', poolId: 'forge-windows-proof-v1',
        runnerClass: 'windows-proof-isolated', runtimeBoundary: 'battle-bridge-windows-proof-sandbox',
        forgeService: 'stephanos-forge-shadow-m3-canary', forgeListener: '127.0.0.1:3342',
        registrationMode: 'one-time-local-contained',
      },
    ],
    canaryForge: {
      forgejoImageDigest: `sha256:${'2'.repeat(64)}`,
      backupDigest: BACKUP,
      backupVolume: `stephanos-forge-shadow-backup-${BACKUP.slice(0, 16)}`,
    },
  };
}

function authorization(plan) {
  const authorizationId = 'forge-m3-runtime-20260810-001';
  return {
    schemaVersion: FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
    authorizationId,
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    expectedTree: TREE,
    runtimePlanDigest: buildForgeShadowM3RuntimePlanDigest(plan),
    issuedAtUtc: '2026-08-10T13:00:00.000Z',
    expiresAtUtc: '2026-08-10T15:00:00.000Z',
    executionSurface: 'CONNECTED_WINDOWS_BATTLE_BRIDGE',
    approvalReceipt: {
      schemaVersion: 'stephanos.forge-shadow-m3-operator-approval-receipt.v1',
      issuer: 'STEPHANOS_OPERATOR_APPROVAL_GATE',
      decision: 'APPROVED',
      proofRef: `proofs/operator-approvals/${authorizationId}/${'9'.repeat(64)}.json`,
      repository: 'Cheekyfellastef/stephan-os',
      expectedHead: HEAD,
      expectedTree: TREE,
      runtimePlanDigest: buildForgeShadowM3RuntimePlanDigest(plan),
      authorizationId,
      executionSurface: 'CONNECTED_WINDOWS_BATTLE_BRIDGE',
      issuedAtUtc: '2026-08-10T13:00:00.000Z',
      expiresAtUtc: '2026-08-10T15:00:00.000Z',
      payloadSha256: '8'.repeat(64),
    },
    m3Only: true,
  };
}

function callFor(runnerIndex = 0, acknowledgeTermination = () => true) {
  const plan = runtimePlan();
  const runner = plan.runners[runnerIndex];
  const auth = authorization(plan);
  return {
    authorization: auth,
    authorizationId: auth.authorizationId,
    invocationId: `forge-m3-invocation-${runnerIndex + 1}`,
    runtimePlan: plan,
    runner,
    artifact: plan.runnerArtifacts.find((item) => item.runnerClass === runner.runnerClass),
    executionDeadlineUtc: '2026-08-10T14:00:00.000Z',
    signal: new AbortController().signal,
    acknowledgeTermination,
    canary: {
      workflowId: 'forge-shadow-m3-isolation-canary-v1',
      scenario: 'EXACT_HEAD_ISOLATION_AND_TEARDOWN',
      repository: plan.repository,
      head: HEAD,
      tree: TREE,
    },
  };
}

function rawObservation(runner, proofHex) {
  return {
    schemaVersion: FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
    runnerId: runner.runnerId,
    poolId: runner.poolId,
    runnerClass: runner.runnerClass,
    runtimeBoundary: runner.runtimeBoundary,
    sourceHead: HEAD,
    sourceTree: TREE,
    artifactDigest: runner.runnerClass === 'linux-isolated' ? LINUX_DIGEST : WINDOWS_DIGEST,
    artifactSetDigest: ARTIFACT_SET,
    canaryForgeService: 'stephanos-forge-shadow-m3-canary',
    canaryForgeBackupDigest: BACKUP,
    canaryForgeStarted: true,
    canaryForgeDestroyed: true,
    canonicalM2Sealed: true,
    canonicalM2Unchanged: true,
    privateRelayUsed: runner.runnerClass === 'windows-proof-isolated',
    privateRelayDestroyed: true,
    startedAtUtc: '2026-08-10T13:01:00.000Z',
    completedAtUtc: '2026-08-10T13:02:00.000Z',
    installed: true, registered: true, connected: true, ephemeralRegistration: true,
    canaryWorkflowId: 'forge-shadow-m3-isolation-canary-v1',
    canaryScenario: 'EXACT_HEAD_ISOLATION_AND_TEARDOWN',
    canaryHead: HEAD, canaryTree: TREE, canarySucceeded: true,
    unregistered: true, registrationCredentialDestroyed: true,
    workspaceDestroyed: true, runtimeBoundaryDestroyed: true,
    zeroResidualRegistration: true, zeroResidualCredential: true, zeroResidualWorkspace: true,
    credentialLogged: false, credentialPersisted: false, publicExposure: false,
    tailscaleExposure: false, canonicalCheckoutMounted: false, containerSocketMounted: false,
    hostProcessAccess: false, sourceMutation: false, gitRefWrite: false,
    mergeAuthority: false, deploymentAuthority: false, arbitraryCommand: false,
    proofRefs: [`proofs/forge-shadow-m3/${runner.runnerId}/${proofHex}.json`],
  };
}

function receipt(call) {
  const plan = call.runtimePlan;
  return {
    schemaVersion: FORGE_SHADOW_M3_FIXED_EXECUTION_RECEIPT_SCHEMA,
    ok: true,
    status: FORGE_SHADOW_M3_FIXED_EXECUTION_READY,
    repository: plan.repository,
    sourceHead: HEAD,
    sourceTree: TREE,
    runtimeAuthorizationId: call.authorizationId,
    runtimePlanDigest: call.authorization.runtimePlanDigest,
    artifactSetDigest: ARTIFACT_SET,
    runnerVersion: '11.0.1',
    canonicalM2DigestBefore: BACKUP,
    canonicalM2DigestAfter: BACKUP,
    canaryForgeDestroyed: true,
    privateRelayDestroyed: true,
    registrationCredentialsDestroyed: true,
    workspacesDestroyed: true,
    observations: [rawObservation(plan.runners[0], '3'.repeat(64)), rawObservation(plan.runners[1], '4'.repeat(64))],
    authority: {
      futureExecution: false, sourceMutation: false, gitRefWrite: false,
      githubCredentialAccess: false, secretAccess: false, merge: false,
      deployment: false, arbitraryCommand: false,
    },
  };
}

function runCommandFor(resultReceipt, calls) {
  return (_executable, args) => {
    calls.push(args);
    if (args.includes('-File')) return { status: 0, stdout: JSON.stringify(resultReceipt), stderr: '' };
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('hash-object')) return { status: 0, stdout: `${SCRIPT_BLOB}\n`, stderr: '' };
    if (args.some((value) => String(value).includes(':scripts/windows/'))) return { status: 0, stdout: `${SCRIPT_BLOB}\n`, stderr: '' };
    if (args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    return { status: 0, stdout: `${TREE}\n`, stderr: '' };
  };
}

test('fixed executor accepts hardened invocation, runs estate once and returns observation plus termination acknowledgement', async () => {
  const acknowledgements = [];
  const first = callFor(0, (value) => { acknowledgements.push(value); return true; });
  const second = callFor(1, (value) => { acknowledgements.push(value); return true; });
  const calls = [];
  const execute = createForgeShadowM3FixedProofExecutor({
    platform: 'win32', runCommand: runCommandFor(receipt(first), calls), repositoryRoot: REPOSITORY_ROOT,
    now: () => new Date(COMPLETE),
  });
  const linux = await execute(first);
  const windows = await execute(second);
  assert.equal(linux.observation.runnerId, first.runner.runnerId);
  assert.equal(windows.observation.runnerId, second.runner.runnerId);
  assert.equal(linux.observation.authorizationId, first.authorizationId);
  assert.equal(linux.observation.invocationId, first.invocationId);
  assert.equal(linux.observation.forgeService, 'stephanos-forge-shadow-m3-canary');
  assert.equal(linux.observation.teardownCompletedAtUtc, COMPLETE);
  assert.equal(linux.terminationAcknowledgement.schemaVersion, FORGE_SHADOW_M3_TERMINATION_ACK_SCHEMA);
  assert.equal(acknowledgements.length, 2);
  assert.equal(calls.filter((args) => args.includes('-File')).length, 1);
  assert.ok(calls.find((args) => args.includes('-File')).includes('-OperatorApproved'));
});

test('receipt validator requires unchanged M2, complete teardown and zero residual authority', () => {
  const call = callFor();
  assert.equal(validateForgeShadowM3FixedProofExecutionReceipt(receipt(call), call).ok, true);
  for (const patch of [
    { canonicalM2DigestAfter: '9'.repeat(64) },
    { canaryForgeDestroyed: false },
    { privateRelayDestroyed: false },
    { registrationCredentialsDestroyed: false },
    { observations: [receipt(call).observations[0]] },
    { authority: { ...receipt(call).authority, merge: true } },
  ]) assert.equal(validateForgeShadowM3FixedProofExecutionReceipt({ ...receipt(call), ...patch }, call).ok, false);
});

test('fixed executor rejects old approval shape, widened invocation, abort and source drift', async () => {
  const base = callFor();
  const oldApproval = { ...base, authorization: { ...base.authorization, approvalReceipt: undefined, operatorApproved: true } };
  const executeLinux = createForgeShadowM3FixedProofExecutor({ platform: 'linux' });
  await assert.rejects(executeLinux(oldApproval), /AUTHORIZATION_INVALID|APPROVAL_INVALID/);
  await assert.rejects(executeLinux({ ...base, command: 'anything' }), /CALL_FIELDS_INVALID|UNSAFE_FIELD/);

  const abortedController = new AbortController();
  abortedController.abort();
  const aborted = { ...base, signal: abortedController.signal };
  const calls = [];
  const executeAborted = createForgeShadowM3FixedProofExecutor({
    platform: 'win32', runCommand: runCommandFor(receipt(base), calls), repositoryRoot: REPOSITORY_ROOT,
    now: () => new Date(COMPLETE),
  });
  await assert.rejects(executeAborted(aborted), /ABORTED/);

  const drifted = createForgeShadowM3FixedProofExecutor({
    platform: 'win32', repositoryRoot: REPOSITORY_ROOT,
    runCommand: (_exe, args) => args.includes('branch')
      ? { status: 0, stdout: 'feature\n', stderr: '' }
      : { status: 0, stdout: `${HEAD}\n`, stderr: '' },
  });
  await assert.rejects(drifted(base), /SOURCE_IDENTITY_CHANGED/);
});

test('fixed executor fails closed when parent termination gate rejects the acknowledgement', async () => {
  const call = callFor(0, () => false);
  const calls = [];
  const execute = createForgeShadowM3FixedProofExecutor({
    platform: 'win32', runCommand: runCommandFor(receipt(call), calls), repositoryRoot: REPOSITORY_ROOT,
    now: () => new Date(COMPLETE),
  });
  await assert.rejects(execute(call), /TERMINATION_ACK_REJECTED/);
});
