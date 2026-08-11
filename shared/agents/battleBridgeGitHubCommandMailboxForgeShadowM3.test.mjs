import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  buildBattleBridgeGitHubCommandReceipt,
  executeBattleBridgeGitHubCommand,
  executeBattleBridgeGitHubCommandBatch,
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  FORGE_SHADOW_M3_EXECUTE_OPERATION,
  FORGE_SHADOW_M3_PREPARE_OPERATION,
  executeForgeShadowM3ArtifactPreparationOnBattleBridge,
  executeForgeShadowM3OnBattleBridge,
} from './forgeShadowM3MailboxAdapterV1.mjs';
import { FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY } from './forgeShadowM3ArtifactPreparationV1.mjs';
import { FORGE_SHADOW_M3_EXECUTION_READY } from './forgeShadowM3RunnerExecutionReceiptAdapterV1.mjs';
import { planForgeShadowM3RunnerRuntime } from './forgeShadowM3RunnerRuntimePlanV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const IMAGE = `sha256:${'c'.repeat(64)}`;
const BACKUP = 'd'.repeat(64);
const LINUX = `sha256:${'1'.repeat(64)}`;
const WINDOWS = `sha256:${'2'.repeat(64)}`;
const RELEASE = `sha256:${'3'.repeat(64)}`;
const CHECKSUM = `sha256:${'4'.repeat(64)}`;
const PROVENANCE = `sha256:${'5'.repeat(64)}`;
const PLAN_AT = '2026-08-10T14:00:00.000Z';
const NOW = new Date('2026-08-10T14:05:00.000Z');

function base(operation, patch = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: operation === FORGE_SHADOW_M3_PREPARE_OPERATION
      ? 'forge-m3-artifact-request-001'
      : 'forge-m3-runtime-request-001',
    operation,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expectedTree: TREE,
    m3Only: true,
    expiresAt: '2026-08-10T15:30:00.000Z',
    ...patch,
  };
}

function prepareCommand(patch = {}) {
  return base(FORGE_SHADOW_M3_PREPARE_OPERATION, {
    observationId: 'forge-m3-artifact-observation-001',
    ...patch,
  });
}

function executeCommand(patch = {}) {
  return base(FORGE_SHADOW_M3_EXECUTE_OPERATION, {
    m2RequestId: 'forge-m2-runtime-ready-001',
    artifactRequestId: 'forge-m3-artifact-request-001',
    runtimeAuthorizationId: 'forge-m3-runtime-authorization-001',
    runtimePlanDigest: `sha256:${'9'.repeat(64)}`,
    planAtUtc: PLAN_AT,
    runtimeExpiresAtUtc: '2026-08-10T15:00:00.000Z',
    ...patch,
  });
}

function mailboxComment(payload, { id = 1, createdAt = PLAN_AT } = {}) {
  return {
    id,
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-${id}`,
    created_at: createdAt,
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(payload)}\n\`\`\``,
  };
}

function artifact(runnerClass) {
  const linux = runnerClass === 'linux-isolated';
  return {
    artifactId: linux ? 'forge-m3-linux-runner-artifact-v1' : 'forge-m3-windows-proof-runner-artifact-v1',
    runnerClass,
    sourceIdentity: 'forgejo-official-runner-release',
    releaseChannel: 'stable',
    version: '13.0.0',
    platform: linux ? 'linux/amd64' : 'windows/amd64',
    artifactLogicalId: linux ? 'forgejo-runner-linux-amd64' : 'forgejo-runner-windows-amd64',
    artifactDigest: linux ? LINUX : WINDOWS,
    artifactBytes: 8 * 1024 * 1024,
    releaseManifestDigest: RELEASE,
    checksumManifestDigest: CHECKSUM,
    provenanceDigest: PROVENANCE,
    resolvedAtUtc: '2026-08-10T13:59:00.000Z',
    proofRefs: ['receipts/github-command-mailbox/forge-m3-artifact-request-001.json'],
    tlsVerified: true,
    releaseManifestVerified: true,
    checksumVerified: true,
    mutableReferenceAccepted: false,
    credentialUsed: false,
  };
}

function m2Receipt() {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'forge-m2-runtime-ready-001',
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
    acceptedAt: '2026-08-10T13:40:00.000Z',
    heartbeatAt: '2026-08-10T13:45:00.000Z',
    completedAt: '2026-08-10T13:50:00.000Z',
    blocker: '',
    proofRefs: ['receipts/github-command-mailbox/forge-m2-runtime-ready-001.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'INSTALL_FORGE_SHADOW_M2',
      requestId: 'forge-m2-runtime-ready-001',
      result: {
        ok: true, blocker: '', finalVerdict: 'FORGE_SHADOW_M2_READY',
        repository: 'Cheekyfellastef/stephan-os', sourceHead: HEAD, canonicalTree: TREE,
        installerBlob: 'e'.repeat(40), forgejoVersion: '15.0.6', podmanVersion: '6.0.2',
        forgejoImageDigest: IMAGE, runtimeBoundary: 'podman-wsl-rootless',
        machine: 'stephanos-forge-shadow', podmanConnection: 'stephanos-forge-shadow',
        container: 'stephanos-forge-shadow', listener: '127.0.0.1:3340',
        mirrorHead: HEAD, mirrorTree: TREE, backupDigest: BACKUP,
        backupVolume: `stephanos-forge-shadow-backup-${BACKUP.slice(0, 16)}`,
        restoreDrillPassed: true, rootFilesystemReadOnly: true, allCapabilitiesDropped: true,
        noNewPrivileges: true, githubCredentialUsed: false, credentialPersisted: false,
        credentialLogged: false, runnerRegistration: false, actionsExecution: false,
        mergeAuthority: false, readyForM3: true,
      },
    },
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    credentialsMayBeReadOrExported: false,
  };
}

function artifactReceipt() {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'forge-m3-artifact-request-001',
    operation: FORGE_SHADOW_M3_PREPARE_OPERATION,
    expectedHead: HEAD,
    expectedTree: TREE,
    state: 'DONE',
    blocker: '',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: FORGE_SHADOW_M3_PREPARE_OPERATION,
      requestId: 'forge-m3-artifact-request-001',
      result: {
        ok: true,
        finalVerdict: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY,
        sourceHead: HEAD,
        sourceTree: TREE,
        artifactResolutions: [artifact('windows-proof-isolated'), artifact('linux-isolated')],
        cacheReceipt: { valid: true },
      },
    },
  };
}

test('the canonical mailbox exposes exactly one preparation and one execution operation', () => {
  for (const operation of [FORGE_SHADOW_M3_PREPARE_OPERATION, FORGE_SHADOW_M3_EXECUTE_OPERATION]) {
    assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.filter((value) => value === operation).length, 1);
  }
});

test('mailbox validation normalizes the closed-world M3 fields', () => {
  const prepared = validateBattleBridgeGitHubCommand(prepareCommand(), { authorLogin: 'Cheekyfellastef', now: NOW });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.expectedTree, TREE);
  assert.equal(prepared.command.observationId, 'forge-m3-artifact-observation-001');
  const executed = validateBattleBridgeGitHubCommand(executeCommand(), { authorLogin: 'Cheekyfellastef', now: NOW });
  assert.equal(executed.ok, true);
  assert.equal(executed.command.m2RequestId, 'forge-m2-runtime-ready-001');
  assert.equal(executed.command.planAtUtc, PLAN_AT);
});

test('M3 fields are operation-bound and arbitrary build or execution surfaces are rejected', () => {
  for (const candidate of [
    prepareCommand({ url: 'https://example.invalid' }),
    prepareCommand({ m2RequestId: 'forge-m2-runtime-ready-001' }),
    executeCommand({ command: 'run anything' }),
    executeCommand({ runtimePlanDigest: 'latest' }),
    executeCommand({ runtimeExpiresAtUtc: '2026-08-10T17:00:00.000Z' }),
    executeCommand({ expectedTree: '' }),
  ]) assert.equal(validateBattleBridgeGitHubCommand(candidate, { authorLogin: 'Cheekyfellastef', now: NOW }).ok, false);
  const nonM3 = {
    ...base('RUN_BATTLE_BRIDGE_DIAGNOSTICS'),
    expectedTree: TREE,
  };
  assert.equal(validateBattleBridgeGitHubCommand(nonM3, { authorLogin: 'Cheekyfellastef', now: NOW }).blocker, 'FORGE_M3_FIELD_NOT_ALLOWED');
});

test('M3 wiring preserves immutable command-age and execution-slot preflight barriers', async () => {
  const oversizedWindow = selectBattleBridgeGitHubCommandBatch([
    mailboxComment(prepareCommand({ expiresAt: '2026-08-10T20:00:01.000Z' })),
  ], { now: NOW });
  assert.equal(oversizedWindow.verdict, 'NO_COMMAND_READY');
  assert.equal(oversizedWindow.terminalRejections.length, 1);
  assert.equal(oversizedWindow.terminalRejections[0].blocker, 'COMMAND_EXPIRY_TOO_FAR_AHEAD');

  const batch = selectBattleBridgeGitHubCommandBatch([
    mailboxComment(prepareCommand(), { id: 2 }),
  ], { now: NOW });
  assert.equal(batch.verdict, 'COMMAND_BATCH_READY');

  const events = [];
  const result = await executeBattleBridgeGitHubCommandBatch(batch, {
    now: () => NOW,
    preflightCommand: async () => ({ ok: false, blocker: 'COMMAND_EXPECTED_HEAD_SUPERSEDED' }),
    beforeExecute: async () => events.push('accepted'),
    executeCommand: async () => {
      events.push('executed');
      return { ok: true };
    },
    onTerminal: async (_entry, execution) => {
      events.push(`terminal:${execution.blocker}`);
      return execution;
    },
  });
  assert.deepEqual(events, ['terminal:COMMAND_EXPECTED_HEAD_SUPERSEDED']);
  assert.equal(result.results[0].result.blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
});

test('preparation handler binds the live call to the accepted mailbox identity', async () => {
  let observed;
  const result = await executeForgeShadowM3ArtifactPreparationOnBattleBridge(prepareCommand(), {
    now: () => NOW,
    prepare: async (input) => {
      observed = input;
      return { ok: true, finalVerdict: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(observed, {
    repository: 'Cheekyfellastef/stephan-os', expectedHead: HEAD, expectedTree: TREE,
    requestId: 'forge-m3-artifact-request-001', observationId: 'forge-m3-artifact-observation-001',
    requestedAtUtc: NOW.toISOString(), operatorApproved: true, m3Only: true,
  });
});

test('execution handler derives the exact plan from durable M2 and artifact receipts', async () => {
  const receipts = new Map([
    ['forge-m2-runtime-ready-001', m2Receipt()],
    ['forge-m3-artifact-request-001', artifactReceipt()],
  ]);
  const readReceipt = async (requestId) => receipts.get(requestId);
  const first = await executeForgeShadowM3OnBattleBridge(executeCommand(), {
    now: () => NOW, platform: 'win32', readReceipt,
    executePlan: async () => assert.fail('digest mismatch must block before execution'),
    createExecutor: () => async () => ({}),
  });
  assert.equal(first.blocker, 'FORGE_M3_RUNTIME_PLAN_DIGEST_MISMATCH');
  assert.match(first.observedRuntimePlanDigest, /^sha256:[0-9a-f]{64}$/);

  let call;
  const ready = await executeForgeShadowM3OnBattleBridge(executeCommand({
    runtimePlanDigest: first.observedRuntimePlanDigest,
  }), {
    now: () => NOW, platform: 'win32', readReceipt,
    executePlan: async (input) => {
      call = input;
      return { ok: true, finalVerdict: FORGE_SHADOW_M3_EXECUTION_READY, receipt: { valid: true } };
    },
    createExecutor: () => async () => ({}),
  });
  assert.equal(ready.ok, true);
  assert.equal(call.runtimeAuthorization.runtimePlanDigest, first.observedRuntimePlanDigest);
  assert.equal(call.runtimeAuthorization.operatorApproved, true);
  assert.equal(call.runtimeAuthorization.m3Only, true);
  assert.deepEqual(call.runtimePlanInput.admissionInput.runnerPools.map((pool) => [pool.runnerClass, pool.count]), [
    ['windows-proof-isolated', 1], ['linux-isolated', 1],
  ]);
  assert.deepEqual(planForgeShadowM3RunnerRuntime(call.runtimePlanInput).runners.map((runner) => runner.runnerId), [
    'stephanos-forge-linux-runner-01',
    'stephanos-forge-windows-proof-runner-01',
  ]);
});

test('shared mailbox dispatch and receipts preserve M3 identity without credentials', async () => {
  const validated = validateBattleBridgeGitHubCommand(prepareCommand(), { authorLogin: 'Cheekyfellastef', now: NOW });
  const execution = await executeBattleBridgeGitHubCommand(validated.command, {
    prepareForgeShadowM3Artifacts: async () => ({ ok: true, finalVerdict: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY }),
  });
  assert.equal(execution.ok, true);
  const receipt = buildBattleBridgeGitHubCommandReceipt({
    command: validated.command, state: 'DONE', acceptedAt: NOW.toISOString(),
    heartbeatAt: NOW.toISOString(), completedAt: NOW.toISOString(), result: execution,
  });
  assert.equal(receipt.expectedTree, TREE);
  assert.equal(receipt.m3Only, true);
  assert.equal(receipt.observationId, 'forge-m3-artifact-observation-001');
  assert.equal(receipt.credentialsMayBeReadOrExported, false);
  assert.doesNotMatch(JSON.stringify(receipt), /password|privatekey|cookie|session/i);
});
