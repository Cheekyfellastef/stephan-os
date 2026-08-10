import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
  FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
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
      },
      {
        runnerId: 'stephanos-forge-windows-proof-runner-01', poolId: 'forge-windows-proof-v1',
        runnerClass: 'windows-proof-isolated', runtimeBoundary: 'battle-bridge-windows-proof-sandbox',
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
  return {
    schemaVersion: FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
    authorizationId: 'forge-m3-runtime-20260810-001',
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    expectedTree: TREE,
    runtimePlanDigest: buildForgeShadowM3RuntimePlanDigest(plan),
    issuedAtUtc: '2026-08-10T13:00:00.000Z',
    expiresAtUtc: '2026-08-10T15:00:00.000Z',
    executionSurface: 'CONNECTED_WINDOWS_BATTLE_BRIDGE',
    operatorApproved: true,
    m3Only: true,
  };
}

function callFor(runnerIndex = 0) {
  const plan = runtimePlan();
  const runner = plan.runners[runnerIndex];
  return {
    authorization: authorization(plan),
    runtimePlan: plan,
    runner,
    artifact: plan.runnerArtifacts.find((item) => item.runnerClass === runner.runnerClass),
    canary: {
      workflowId: 'forge-shadow-m3-isolation-canary-v1',
      scenario: 'EXACT_HEAD_ISOLATION_AND_TEARDOWN',
      repository: plan.repository,
      head: HEAD,
      tree: TREE,
    },
  };
}

function observation(runner, proofHex) {
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
    installed: true,
    registered: true,
    connected: true,
    ephemeralRegistration: true,
    canaryWorkflowId: 'forge-shadow-m3-isolation-canary-v1',
    canaryScenario: 'EXACT_HEAD_ISOLATION_AND_TEARDOWN',
    canaryHead: HEAD,
    canaryTree: TREE,
    canarySucceeded: true,
    unregistered: true,
    registrationCredentialDestroyed: true,
    workspaceDestroyed: true,
    runtimeBoundaryDestroyed: true,
    zeroResidualRegistration: true,
    zeroResidualCredential: true,
    zeroResidualWorkspace: true,
    credentialLogged: false,
    credentialPersisted: false,
    publicExposure: false,
    tailscaleExposure: false,
    canonicalCheckoutMounted: false,
    containerSocketMounted: false,
    hostProcessAccess: false,
    sourceMutation: false,
    gitRefWrite: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    arbitraryCommand: false,
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
    runtimeAuthorizationId: call.authorization.authorizationId,
    runtimePlanDigest: call.authorization.runtimePlanDigest,
    artifactSetDigest: ARTIFACT_SET,
    runnerVersion: '11.0.1',
    canonicalM2DigestBefore: BACKUP,
    canonicalM2DigestAfter: BACKUP,
    canaryForgeDestroyed: true,
    privateRelayDestroyed: true,
    registrationCredentialsDestroyed: true,
    workspacesDestroyed: true,
    observations: [observation(plan.runners[0], '3'.repeat(64)), observation(plan.runners[1], '4'.repeat(64))],
    authority: {
      futureExecution: false,
      sourceMutation: false,
      gitRefWrite: false,
      githubCredentialAccess: false,
      secretAccess: false,
      merge: false,
      deployment: false,
      arbitraryCommand: false,
    },
  };
}

test('fixed executor runs the whole estate once and returns the bound observation for each canonical runner', async () => {
  const first = callFor(0);
  const second = callFor(1);
  const calls = [];
  const resultReceipt = receipt(first);
  const runCommand = (_executable, args) => {
    calls.push(args);
    if (args.includes('-File')) return { status: 0, stdout: JSON.stringify(resultReceipt), stderr: '' };
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('hash-object')) return { status: 0, stdout: `${SCRIPT_BLOB}\n`, stderr: '' };
    if (args.some((value) => String(value).includes(':scripts/windows/'))) return { status: 0, stdout: `${SCRIPT_BLOB}\n`, stderr: '' };
    if (args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    return { status: 0, stdout: `${TREE}\n`, stderr: '' };
  };
  const execute = createForgeShadowM3FixedProofExecutor({
    platform: 'win32', runCommand, repositoryRoot: REPOSITORY_ROOT,
  });
  const linux = await execute(first);
  const windows = await execute(second);
  assert.equal(linux.runnerId, first.runner.runnerId);
  assert.equal(windows.runnerId, second.runner.runnerId);
  const powershellCalls = calls.filter((args) => args.includes('-File'));
  assert.equal(powershellCalls.length, 1);
  assert.ok(powershellCalls[0].includes('-RuntimePlanDigest'));
  assert.ok(powershellCalls[0].includes('-OperatorApproved'));
  assert.equal(powershellCalls[0].some((value) => /token|credential|command/i.test(String(value))), false);
});

test('receipt validator requires exact estate, unchanged M2, complete teardown and zero residual authority', () => {
  const call = callFor();
  assert.equal(validateForgeShadowM3FixedProofExecutionReceipt(receipt(call), call).ok, true);
  for (const patch of [
    { canonicalM2DigestAfter: '9'.repeat(64) },
    { canaryForgeDestroyed: false },
    { privateRelayDestroyed: false },
    { registrationCredentialsDestroyed: false },
    { observations: [receipt(call).observations[0]] },
    { authority: { ...receipt(call).authority, merge: true } },
  ]) {
    assert.equal(validateForgeShadowM3FixedProofExecutionReceipt({ ...receipt(call), ...patch }, call).ok, false);
  }
});

test('fixed executor fails closed on non-Windows execution, widened input or source drift', async () => {
  const call = callFor();
  const nonWindows = createForgeShadowM3FixedProofExecutor({ platform: 'linux' });
  await assert.rejects(nonWindows(call), /FORGE_M3_FIXED_EXECUTOR_WINDOWS_REQUIRED/);

  const widened = { ...call, command: 'run anything' };
  await assert.rejects(nonWindows(widened), /CALL_FIELDS_INVALID|UNSAFE_FIELD/);

  const runCommand = (_executable, args) => {
    if (args.includes('branch')) return { status: 0, stdout: 'feature\n', stderr: '' };
    return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
  };
  const drifted = createForgeShadowM3FixedProofExecutor({
    platform: 'win32', runCommand, repositoryRoot: REPOSITORY_ROOT,
  });
  await assert.rejects(drifted(call), /SOURCE_IDENTITY_CHANGED/);
});

test('fixed executor rejects plan, authorization, artifact and runner drift before host execution', async () => {
  const base = callFor();
  const execute = createForgeShadowM3FixedProofExecutor({ platform: 'linux' });
  const candidates = [
    { ...base, runtimePlan: { ...base.runtimePlan, repository: 'other/repo' } },
    { ...base, authorization: { ...base.authorization, executionSurface: 'OTHER' } },
    { ...base, runner: { ...base.runner, runnerId: 'other-runner' } },
    { ...base, artifact: { ...base.artifact, artifactDigest: `sha256:${'0'.repeat(64)}` } },
    { ...base, canary: { ...base.canary, head: '0'.repeat(40) } },
  ];
  for (const candidate of candidates) await assert.rejects(execute(candidate), /FORGE_M3_FIXED_EXECUTOR_/);
});
