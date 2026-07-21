import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_BANKED_RESET_STATUS_OPERATION,
  buildCodexBankedResetStatusPowerShellInvocation,
  normalizeCodexBankedResetStatusResult,
  readCodexBankedResetStatusOnBattleBridge,
  validateCodexBankedResetStatusCommand,
} from './codexBankedResetStatusBattleBridgeReader.mjs';

const now = new Date('2026-07-20T22:30:00.000Z');

function command(overrides = {}) {
  return {
    operation: CODEX_BANKED_RESET_STATUS_OPERATION,
    requestId: 'codex-reset-status-20260720-001',
    expectedHead: '88ca0b3bfdff96bd13027a8185df7d481133fb93',
    expiresAt: '2026-07-20T23:30:00.000Z',
    ...overrides,
  };
}

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'codex-reset-status-reader-'));
  const scripts = join(root, 'scripts', 'windows');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'read-codex-banked-reset-status.ps1'), '# test fixture\n');
  return root;
}

test('validates a bounded read-only status command', () => {
  const result = validateCodexBankedResetStatusCommand(command(), { now });
  assert.equal(result.ok, true);
  assert.equal(result.command.readOnly, true);
});

test('builds one fixed read-only PowerShell invocation with shell disabled', () => {
  const result = buildCodexBankedResetStatusPowerShellInvocation(command(), {
    platform: 'win32',
    repoRoot: tempRepo(),
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.executable, 'powershell.exe');
  assert.equal(result.shell, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.pressCount, 0);
  assert.equal(result.args.some((value) => /https?:|javascript|selector|cookie|token/i.test(String(value))), false);
});

test('fails closed outside Windows', () => {
  const result = buildCodexBankedResetStatusPowerShellInvocation(command(), {
    platform: 'linux',
    repoRoot: tempRepo(),
    now,
  });
  assert.equal(result.blocker, 'WINDOWS_REQUIRED');
});

test('normalizes only read-only usage-surface proof as success', () => {
  const success = normalizeCodexBankedResetStatusResult({
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_READY',
    observedAtUtc: '2026-07-20T22:31:00.000Z',
    matchedWindow: 'ChatGPT - Codex Usage',
    meterSummary: 'Codex weekly usage remaining 0%',
    expiryTexts: ['Banked reset expires 25 Jul 2026'],
    resetButtons: ['Use reset'],
    usageSurfaceMatched: true,
    desktopInteractive: true,
    appWindowFound: true,
    pressAttempted: false,
    pressCount: 0,
  }, command());
  assert.equal(success.ok, true);
  assert.equal(success.readOnly, true);
  assert.equal(success.expiryTexts[0], 'Banked reset expires 25 Jul 2026');

  for (const override of [
    { usageSurfaceMatched: false },
    { pressAttempted: true },
    { pressCount: 1 },
    { finalVerdict: 'OTHER' },
  ]) {
    const blocked = normalizeCodexBankedResetStatusResult({
      ok: true,
      finalVerdict: 'CODEX_BANKED_RESET_STATUS_READY',
      usageSurfaceMatched: true,
      pressAttempted: false,
      pressCount: 0,
      ...override,
    }, command());
    assert.equal(blocked.ok, false);
  }
});

test('executes exactly once and returns bounded status proof', () => {
  let calls = 0;
  const result = readCodexBankedResetStatusOnBattleBridge(command(), {
    platform: 'win32',
    repoRoot: tempRepo(),
    now,
    spawn: (exe, args, options) => {
      calls += 1;
      assert.equal(exe, 'powershell.exe');
      assert.equal(options.shell, false);
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          finalVerdict: 'CODEX_BANKED_RESET_STATUS_READY',
          observedAtUtc: '2026-07-20T22:31:00.000Z',
          usageSurfaceMatched: true,
          pressAttempted: false,
          pressCount: 0,
          meterSummary: 'Codex weekly usage remaining 0%',
          expiryTexts: ['Banked reset expires 25 Jul 2026'],
          resetButtons: ['Use reset'],
        }),
        stderr: '',
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.pressCount, 0);
});
