import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  buildBattleBridgeGitHubCommandReceipt,
  executeBattleBridgeGitHubCommand,
  extractBattleBridgeGitHubCommand,
  selectNextBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';

const now = new Date('2026-07-16T22:30:00.000Z');

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'req-1507-0001',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: 'fb10c39a5c0178158bc3b43c5539e8f5d023bc2a',
    expiresAt: '2026-07-16T23:30:00.000Z',
    ...overrides,
  };
}

function comment(payload = command(), overrides = {}) {
  return {
    id: 100,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-100',
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(payload)}\n\`\`\``,
    ...overrides,
  };
}

test('extracts and accepts an owner-authored bounded command', () => {
  const extracted = extractBattleBridgeGitHubCommand(comment().body);
  assert.equal(extracted.ok, true);
  const validated = validateBattleBridgeGitHubCommand(extracted.command, {
    authorLogin: 'Cheekyfellastef',
    now,
  });
  assert.equal(validated.verdict, 'COMMAND_ACCEPTED');
  assert.equal(validated.command.operation, 'UPDATE_STEPHANOS_FROM_CHAT');
});

test('control-plane and explicit watchdog acceptance operations are first-class allowlisted commands', () => {
  for (const operation of [
    'READ_CAPABILITY_REGISTRY',
    'READ_SHARED_WORKSPACE_STATUS',
    'RUN_WORKER_WATCHDOG_ACCEPTANCE',
  ]) {
    assert.ok(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(operation));
    const validated = validateBattleBridgeGitHubCommand(command({ operation }), { authorLogin: 'Cheekyfellastef', now });
    assert.equal(validated.verdict, 'COMMAND_ACCEPTED');
  }
});

test('rejects non-owner, expired, wrong repository, wrong branch and arbitrary operation', () => {
  assert.equal(validateBattleBridgeGitHubCommand(command(), { authorLogin: 'someone-else', now }).blocker, 'COMMAND_AUTHOR_NOT_ALLOWED');
  assert.equal(validateBattleBridgeGitHubCommand(command({ expiresAt: '2026-07-16T22:00:00.000Z' }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'COMMAND_EXPIRED');
  assert.equal(validateBattleBridgeGitHubCommand(command({ repository: 'other/repo' }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'COMMAND_REPOSITORY_MISMATCH');
  assert.equal(validateBattleBridgeGitHubCommand(command({ branch: 'feature' }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'COMMAND_BRANCH_NOT_ALLOWED');
  assert.equal(validateBattleBridgeGitHubCommand(command({ operation: 'RUN_POWERSHELL' }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'COMMAND_OPERATION_NOT_ALLOWED');
});

test('selects only an unconsumed valid command', () => {
  const selected = selectNextBattleBridgeGitHubCommand([
    comment(command({ requestId: 'req-1507-old1' }), { id: 1 }),
    comment(command({ requestId: 'req-1507-new2' }), { id: 2 }),
  ], {
    consumedRequestIds: new Set(['req-1507-old1']),
    now,
  });
  assert.equal(selected.verdict, 'COMMAND_READY');
  assert.equal(selected.command.requestId, 'req-1507-new2');
});

test('dispatches only through the named injected handler', async () => {
  let calls = 0;
  const result = await executeBattleBridgeGitHubCommand(command(), {
    updateStephanos: async (input) => {
      calls += 1;
      return { ok: true, expectedHead: input.expectedHead };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.result.expectedHead, command().expectedHead);
});

test('dispatches registry and workspace reads through distinct bounded handlers', async () => {
  const calls = [];
  const registryResult = await executeBattleBridgeGitHubCommand(command({ operation: 'READ_CAPABILITY_REGISTRY' }), {
    readCapabilityRegistry: async () => { calls.push('registry'); return { ok: true, finalVerdict: 'STEPHANOS_CAPABILITY_REGISTRY_PASS' }; },
  });
  const workspaceResult = await executeBattleBridgeGitHubCommand(command({ operation: 'READ_SHARED_WORKSPACE_STATUS' }), {
    readSharedWorkspaceStatus: async () => { calls.push('workspace'); return { ok: true, finalVerdict: 'SHARED_WORKSPACE_STATUS_READY' }; },
  });
  assert.deepEqual(calls, ['registry', 'workspace']);
  assert.equal(registryResult.result.finalVerdict, 'STEPHANOS_CAPABILITY_REGISTRY_PASS');
  assert.equal(workspaceResult.result.finalVerdict, 'SHARED_WORKSPACE_STATUS_READY');
});

test('dispatches watchdog acceptance only through its named bounded handler', async () => {
  const calls = [];
  const result = await executeBattleBridgeGitHubCommand(command({ operation: 'RUN_WORKER_WATCHDOG_ACCEPTANCE' }), {
    runWorkerWatchdogAcceptance: async (input) => {
      calls.push(input.expectedHead);
      return {
        ok: true,
        finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_PASS',
        workerKilledObserved: true,
        workerRecovered: true,
      };
    },
  });
  assert.deepEqual(calls, [command().expectedHead]);
  assert.equal(result.ok, true);
  assert.equal(result.result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(result.result.workerKilledObserved, true);
  assert.equal(result.result.workerRecovered, true);
});

test('receipt always records the safety boundary', () => {
  const receipt = buildBattleBridgeGitHubCommandReceipt({
    command: command(),
    state: 'DONE',
    acceptedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  });
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.destructiveGitAllowed, false);
  assert.equal(receipt.liveOpenClawUpdateAllowed, false);
});
