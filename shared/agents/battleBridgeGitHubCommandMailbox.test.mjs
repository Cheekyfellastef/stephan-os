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
import {
  CODEX_BANKED_RESET_EXECUTION_SURFACE,
  CODEX_BANKED_RESET_OPERATION,
  CODEX_BANKED_RESET_POLICY_REF,
} from './codexBankedResetBattleBridgeExecutor.mjs';

const now = new Date('2026-07-20T22:30:00.000Z');

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
    expiresAt: '2026-07-20T23:30:00.000Z',
    ...overrides,
  };
}

function resetCommand(overrides = {}) {
  return command({
    requestId: 'codex-reset-20260720-001',
    operation: CODEX_BANKED_RESET_OPERATION,
    resetId: 'banked-reset-1',
    resetExpiresAtUtc: '2026-07-25T12:00:00.000Z',
    latestSafeExecutionUtc: '2026-07-20T23:20:00.000Z',
    standingOperatorPolicyRef: CODEX_BANKED_RESET_POLICY_REF,
    executionSurface: CODEX_BANKED_RESET_EXECUTION_SURFACE,
    fixedUiActionOnly: true,
    singlePressOnly: true,
    ...overrides,
  });
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

test('control-plane and banked reset commands are allowlisted', () => {
  for (const operation of [
    'READ_CAPABILITY_REGISTRY',
    'READ_SHARED_WORKSPACE_STATUS',
    'READ_CRITICAL_BACKLOG_STATUS',
    'RUN_WORKER_WATCHDOG_ACCEPTANCE',
    'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    CODEX_BANKED_RESET_OPERATION,
  ]) {
    assert.ok(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(operation));
  }
});

test('accepts exactly one bounded banked reset command and preserves fixed fields', () => {
  const validated = validateBattleBridgeGitHubCommand(resetCommand(), {
    authorLogin: 'Cheekyfellastef', now,
  });
  assert.equal(validated.verdict, 'COMMAND_ACCEPTED');
  assert.equal(validated.command.resetId, 'banked-reset-1');
  assert.equal(validated.command.standingOperatorPolicyRef, CODEX_BANKED_RESET_POLICY_REF);
  assert.equal(validated.command.executionSurface, CODEX_BANKED_RESET_EXECUTION_SURFACE);
  assert.equal(validated.command.fixedUiActionOnly, true);
  assert.equal(validated.command.singlePressOnly, true);
});

test('rejects unsafe reset command fields and generic automation inputs', () => {
  for (const [field, value] of [
    ['url', 'https://example.com'],
    ['selector', '#button'],
    ['javascript', 'document.body.click()'],
    ['command', 'powershell -enc ...'],
    ['profilePath', 'C:/Users/test'],
    ['token', 'secret'],
  ]) {
    const result = validateBattleBridgeGitHubCommand(resetCommand({ [field]: value }), {
      authorLogin: 'Cheekyfellastef', now,
    });
    assert.equal(result.blocker, 'RESET_COMMAND_UNSAFE_FIELD_PRESENT');
    assert.equal(result.field, field);
  }
});

test('rejects reset commands without policy, fixed surface, single press and safe timing', () => {
  const cases = [
    [{ standingOperatorPolicyRef: 'other-policy' }, 'RESET_COMMAND_POLICY_MISMATCH'],
    [{ executionSurface: 'GENERIC_BROWSER' }, 'RESET_COMMAND_EXECUTION_SURFACE_MISMATCH'],
    [{ fixedUiActionOnly: false }, 'RESET_COMMAND_FIXED_UI_ACTION_REQUIRED'],
    [{ singlePressOnly: false }, 'RESET_COMMAND_SINGLE_PRESS_REQUIRED'],
    [{ latestSafeExecutionUtc: '2026-07-20T22:00:00.000Z' }, 'RESET_COMMAND_ACTION_EXPIRED'],
    [{ latestSafeExecutionUtc: '2026-07-21T00:00:00.000Z' }, 'RESET_COMMAND_LATEST_SAFE_AFTER_COMMAND_EXPIRY'],
    [{ resetExpiresAtUtc: '2026-07-20T22:00:00.000Z' }, 'RESET_COMMAND_SELECTED_RESET_EXPIRED'],
  ];
  for (const [override, blocker] of cases) {
    assert.equal(validateBattleBridgeGitHubCommand(resetCommand(override), {
      authorLogin: 'Cheekyfellastef', now,
    }).blocker, blocker);
  }
});

test('forbids reset-only fields on every other mailbox operation', () => {
  const result = validateBattleBridgeGitHubCommand(command({ resetId: 'banked-reset-1' }), {
    authorLogin: 'Cheekyfellastef', now,
  });
  assert.equal(result.blocker, 'RESET_COMMAND_FIELD_NOT_ALLOWED');
  assert.equal(result.field, 'resetId');
});

test('receipt target is mandatory, path-safe and forbidden on all other operations', () => {
  assert.equal(validateBattleBridgeGitHubCommand(command({ operation: 'READ_MAILBOX_RECEIPT' }), {
    authorLogin: 'Cheekyfellastef', now,
  }).blocker, 'COMMAND_TARGET_REQUEST_ID_INVALID');
  assert.equal(validateBattleBridgeGitHubCommand(command({
    operation: 'READ_MAILBOX_RECEIPT', targetRequestId: '../state.json',
  }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'COMMAND_TARGET_REQUEST_ID_INVALID');
  assert.equal(validateBattleBridgeGitHubCommand(command({ targetRequestId: 'req-1507-other1' }), {
    authorLogin: 'Cheekyfellastef', now,
  }).blocker, 'COMMAND_TARGET_REQUEST_ID_NOT_ALLOWED');
});

test('rejects non-owner, expired, wrong repository, wrong branch and arbitrary operation', () => {
  assert.equal(validateBattleBridgeGitHubCommand(command(), { authorLogin: 'someone-else', now }).blocker, 'COMMAND_AUTHOR_NOT_ALLOWED');
  assert.equal(validateBattleBridgeGitHubCommand(command({ expiresAt: '2026-07-20T22:00:00.000Z' }), { authorLogin: 'Cheekyfellastef', now }).blocker, 'COMMAND_EXPIRED');
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

test('dispatches reset only through the named bounded handler', async () => {
  const calls = [];
  const validated = validateBattleBridgeGitHubCommand(resetCommand(), {
    authorLogin: 'Cheekyfellastef', now,
  });
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    redeemBankedCodexReset: async (input) => {
      calls.push(input.resetId);
      return {
        ok: true,
        finalVerdict: 'CODEX_BANKED_RESET_CONFIRMED',
        resetId: input.resetId,
        pressAttempted: true,
        pressCount: 1,
        meterRestored: true,
      };
    },
  });
  assert.deepEqual(calls, ['banked-reset-1']);
  assert.equal(result.ok, true);
  assert.equal(result.result.pressCount, 1);
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

test('receipt records exact reset authority and safety boundary', () => {
  const validated = validateBattleBridgeGitHubCommand(resetCommand(), {
    authorLogin: 'Cheekyfellastef', now,
  });
  const receipt = buildBattleBridgeGitHubCommandReceipt({
    command: validated.command,
    state: 'DONE',
    acceptedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  });
  assert.equal(receipt.expectedHead, resetCommand().expectedHead);
  assert.equal(receipt.resetId, 'banked-reset-1');
  assert.equal(receipt.fixedUiActionOnly, true);
  assert.equal(receipt.singlePressOnly, true);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.equal(receipt.arbitraryBrowserAutomationAllowed, false);
  assert.equal(receipt.credentialsMayBeReadOrExported, false);
});
