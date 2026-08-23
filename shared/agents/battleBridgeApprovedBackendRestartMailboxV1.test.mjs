import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  BATTLE_BRIDGE_MAILBOX_PARTITION,
  executeBattleBridgeGitHubCommand,
  selectBattleBridgeGitHubCommandBatch,
  selectNextBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  executeApprovedBackendRestartOnBattleBridge,
  validateApprovedBackendRestartCommandShape,
} from './battleBridgeApprovedBackendRestartMailboxV1.mjs';

const NOW = new Date('2026-08-18T18:00:00.000Z');
const HEAD = 'a'.repeat(40);

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'backend-restart-0001',
    operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-08-18T19:00:00.000Z',
    ...overrides,
  };
}

function comment(payload = command(), overrides = {}) {
  return {
    id: 100,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-100',
    created_at: NOW.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(payload)}\n\`\`\``,
    ...overrides,
  };
}

function runtimePass(overrides = {}) {
  return {
    schemaVersion: 'stephanos.approved-runtime-restart.v1',
    target: 'backend',
    taskName: 'Stephanos Battle Bridge Backend',
    expectedHead: HEAD,
    sourceHead: HEAD,
    exactHeadProofOk: true,
    canonicalActionVerified: true,
    proofKind: 'backend-health-and-runtime-receipt',
    proofFresh: true,
    terminatedVerifiedOwnedProcess: true,
    unrelatedTasksChanged: false,
    arbitraryTaskTargetAllowed: false,
    arbitraryProcessKillAllowed: false,
    verifiedOwnedProcessTerminationOnly: true,
    liveOpenClawUpdatePerformed: false,
    ok: true,
    finalVerdict: 'APPROVED_RUNTIME_RESTART_PASS',
    ...overrides,
  };
}

test('adds exactly one named backend restart operation and accepts the ordinary owner envelope', () => {
  assert.ok(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION));
  const result = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_ACCEPTED');
  assert.equal(result.command.operation, BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION);
  assert.equal(result.command.expectedHead, HEAD);
});

test('backend restart command forbids caller-selected target, task, process, executable, args and timeout surfaces', () => {
  for (const [field, value] of [
    ['target', 'mission-worker'],
    ['taskName', 'Anything'],
    ['pid', 1234],
    ['executable', 'cmd.exe'],
    ['command', 'whoami'],
    ['args', ['anything']],
    ['timeoutSeconds', 180],
    ['scopedDelivery', { prNumber: 1 }],
  ]) {
    const result = validateApprovedBackendRestartCommandShape(command({ [field]: value }));
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'APPROVED_BACKEND_RESTART_FIELD_NOT_ALLOWED', field);
    assert.equal(result.field, field);
  }
  assert.equal(
    validateApprovedBackendRestartCommandShape(command({ expectedHead: '' })).blocker,
    'APPROVED_BACKEND_RESTART_EXPECTED_HEAD_REQUIRED',
  );
});

test('mailbox selection preserves backend restart identity and serializes it as CONTROL', () => {
  const batch = selectBattleBridgeGitHubCommandBatch([comment()], { now: NOW });
  assert.equal(batch.ok, true);
  assert.equal(batch.verdict, 'COMMAND_BATCH_READY');
  assert.equal(batch.selectedCount, 1);
  assert.equal(batch.controlCount, 1);
  assert.equal(batch.observationCount, 0);
  assert.equal(batch.commands[0].command.operation, BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION);
  assert.equal(batch.commands[0].partition, BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);

  const next = selectNextBattleBridgeGitHubCommand([comment()], { now: NOW });
  assert.equal(next.verdict, 'COMMAND_READY');
  assert.equal(next.commentId, 100);
  assert.equal(next.commentUrl.endsWith('issuecomment-100'), true);
  assert.equal(next.command.operation, BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION);
  assert.equal(next.partition, BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL);
  assert.equal('selected' in next, false);
});

test('mailbox keeps duplicate suppression and expiry semantics for backend restart', () => {
  const consumed = selectBattleBridgeGitHubCommandBatch([comment()], {
    now: NOW,
    consumedRequestIds: new Set(['backend-restart-0001']),
  });
  assert.equal(consumed.verdict, 'NO_COMMAND_READY');

  const expired = selectBattleBridgeGitHubCommandBatch([comment(command({ expiresAt: '2026-08-18T17:59:59.000Z' }))], { now: NOW });
  assert.equal(expired.verdict, 'NO_COMMAND_READY');
  assert.equal(expired.rejected.length, 1);
});

test('new operation dispatches only to the named backend restart handler while legacy commands still delegate unchanged', async () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef', now: NOW, authoredAt: NOW,
  }).command;
  let restartCalls = 0;
  const result = await executeBattleBridgeGitHubCommand(validated, {
    restartApprovedBackend: async (input) => {
      restartCalls += 1;
      assert.equal(input.operation, BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION);
      return { ok: true, finalVerdict: 'BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_PASS' };
    },
    updateStephanos: async () => { throw new Error('wrong handler'); },
  });
  assert.equal(result.ok, true);
  assert.equal(restartCalls, 1);

  const legacy = {
    ...command({ operation: 'UPDATE_STEPHANOS_FROM_CHAT', requestId: 'legacy-update-0001' }),
  };
  const legacyValidated = validateBattleBridgeGitHubCommand(legacy, {
    authorLogin: 'Cheekyfellastef', now: NOW, authoredAt: NOW,
  });
  assert.equal(legacyValidated.ok, true);
  let legacyCalls = 0;
  const legacyResult = await executeBattleBridgeGitHubCommand(legacyValidated.command, {
    updateStephanos: async () => { legacyCalls += 1; return { ok: true, finalVerdict: 'LEGACY_PASS' }; },
  });
  assert.equal(legacyResult.ok, true);
  assert.equal(legacyCalls, 1);
});

test('Windows adapter invokes only the fixed approved backend restart primitive and returns sanitized exact-head proof', async () => {
  const calls = [];
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), {
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' },
    home: 'C:\\Users\\Stephan',
    existsSyncFn: () => true,
    spawnSyncFn: (executable, args, options) => {
      calls.push({ executable, args: [...args], options: { ...options } });
      return { status: 0, stdout: `${JSON.stringify(runtimePass())}\n`, stderr: '', error: null };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_PASS');
  assert.equal(result.target, 'backend');
  assert.equal(result.expectedHead, HEAD);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.arbitraryTaskTargetAllowed, false);
  assert.equal(result.arbitraryProcessKillAllowed, false);
  assert.equal(result.verifiedOwnedProcessTerminationOnly, true);
  assert.equal('stdout' in result, false);
  assert.equal('stderr' in result, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(calls[0].args, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os\\scripts\\windows\\restart-approved-stephanos-runtime.ps1',
    '-Target', 'backend', '-ExpectedHead', HEAD, '-TimeoutSeconds', '90',
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});

test('normal approved restart does not require the legacy migration helper', async () => {
  const existenceChecks = [];
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), {
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' },
    home: 'C:\\Users\\Stephan',
    existsSyncFn: (path) => {
      existenceChecks.push(String(path));
      return !String(path).endsWith('migrate-legacy-stephanos-backend-listener-v1.ps1');
    },
    spawnSyncFn: () => ({ status: 0, stdout: `${JSON.stringify(runtimePass())}\n`, stderr: '', error: null }),
  });
  assert.equal(result.ok, true);
  assert.equal(existenceChecks.some((path) => path.endsWith('migrate-legacy-stephanos-backend-listener-v1.ps1')), false);
});

test('legacy migration helper is required only after the exact non-allowlisted listener blocker', async () => {
  const blocked = {
    schemaVersion: 'stephanos.approved-runtime-restart.v1',
    ok: false,
    blocker: 'BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED',
    finalVerdict: 'APPROVED_RUNTIME_RESTART_BLOCKED',
  };
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), {
    platform: 'win32',
    env: { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' },
    home: 'C:\\Users\\Stephan',
    existsSyncFn: (path) => !String(path).endsWith('migrate-legacy-stephanos-backend-listener-v1.ps1'),
    spawnSyncFn: () => ({ status: 1, stdout: `${JSON.stringify(blocked)}\n`, stderr: '', error: null }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LEGACY_BACKEND_MIGRATION_SCRIPT_MISSING');
});

test('Windows adapter fails closed off Windows and on malformed or widened runtime proof', async () => {
  assert.equal((await executeApprovedBackendRestartOnBattleBridge(command(), { platform: 'linux' })).blocker, 'APPROVED_BACKEND_RESTART_WINDOWS_REQUIRED');

  for (const payload of [
    runtimePass({ taskName: 'Other Task' }),
    runtimePass({ sourceHead: 'b'.repeat(40) }),
    runtimePass({ arbitraryProcessKillAllowed: true }),
  ]) {
    const result = await executeApprovedBackendRestartOnBattleBridge(command(), {
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' },
      existsSyncFn: () => true,
      spawnSyncFn: () => ({ status: 0, stdout: `${JSON.stringify(payload)}\n`, stderr: '', error: null }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'APPROVED_BACKEND_RESTART_PROOF_INVALID');
  }
});
