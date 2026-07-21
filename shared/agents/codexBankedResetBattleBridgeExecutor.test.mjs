import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_BANKED_RESET_EXECUTION_SURFACE,
  CODEX_BANKED_RESET_OPERATION,
  CODEX_BANKED_RESET_POLICY_REF,
  buildCodexBankedResetPowerShellInvocation,
  executeCodexBankedResetOnBattleBridge,
  normalizeCodexBankedResetExecutionResult,
  validateCodexBankedResetExecutionCommand,
} from './codexBankedResetBattleBridgeExecutor.mjs';

const now = new Date('2026-07-20T22:30:00.000Z');

function command(overrides = {}) {
  return {
    operation: CODEX_BANKED_RESET_OPERATION,
    requestId: 'codex-reset-20260720-001',
    resetId: 'banked-reset-1',
    resetExpiresAtUtc: '2026-07-25T12:00:00.000Z',
    latestSafeExecutionUtc: '2026-07-20T23:20:00.000Z',
    standingOperatorPolicyRef: CODEX_BANKED_RESET_POLICY_REF,
    executionSurface: CODEX_BANKED_RESET_EXECUTION_SURFACE,
    fixedUiActionOnly: true,
    singlePressOnly: true,
    expectedHead: '88ca0b3bfdff96bd13027a8185df7d481133fb93',
    expiresAt: '2026-07-20T23:30:00.000Z',
    ...overrides,
  };
}

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'codex-reset-executor-'));
  const scripts = join(root, 'scripts', 'windows');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'invoke-codex-banked-reset-ui-with-navigation.ps1'), '# test fixture\n');
  return root;
}

function successfulProof(overrides = {}) {
  return {
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_CONFIRMED',
    requestId: command().requestId,
    resetId: command().resetId,
    resetExpiresAtUtc: command().resetExpiresAtUtc,
    observedAtUtc: '2026-07-20T22:31:00.000Z',
    completedAtUtc: '2026-07-20T22:31:10.000Z',
    usageSurfaceMatched: true,
    navigationAttempted: true,
    profileMenuOpened: true,
    usagePanelOpened: true,
    matchedProfileControl: 'Profile menu',
    matchedUsageControl: '',
    matchedUsageLabel: '1 reset available',
    usageControlResolution: 'labeled-ancestor',
    meterBefore: 'Codex usage remaining 0%',
    meterAfter: 'Codex usage remaining 100%',
    pressAttempted: true,
    pressCount: 1,
    meterRestored: true,
    resetControlDisappeared: true,
    ...overrides,
  };
}

test('validates the exact reset authority packet', () => {
  const result = validateCodexBankedResetExecutionCommand(command(), { now });
  assert.equal(result.ok, true);
  assert.equal(result.command.fixedUiActionOnly, true);
  assert.equal(result.command.singlePressOnly, true);
});

test('fails closed outside Windows and never invents a generic command', () => {
  const result = buildCodexBankedResetPowerShellInvocation(command(), {
    platform: 'linux',
    repoRoot: tempRepo(),
    now,
  });
  assert.equal(result.blocker, 'WINDOWS_REQUIRED');
});

test('builds one fixed PowerShell file invocation with shell disabled', () => {
  const root = tempRepo();
  const result = buildCodexBankedResetPowerShellInvocation(command(), {
    platform: 'win32', repoRoot: root, now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.executable, 'powershell.exe');
  assert.equal(result.shell, false);
  assert.equal(result.args.filter((value) => value === '-File').length, 1);
  assert.match(result.scriptPath, /invoke-codex-banked-reset-ui-with-navigation\.ps1$/);
  assert.ok(result.args.includes('banked-reset-1'));
  assert.equal(result.args.some((value) => /https?:|javascript|selector|cookie|token/i.test(String(value))), false);
});

test('normalizes only a proven single press with usage and meter evidence as success', () => {
  const success = normalizeCodexBankedResetExecutionResult(successfulProof(), command());
  assert.equal(success.ok, true);
  assert.equal(success.confirmationEvidencePresent, true);
  assert.equal(success.usagePanelOpened, true);
  assert.equal(success.matchedUsageLabel, '1 reset available');
  assert.equal(success.usageControlResolution, 'labeled-ancestor');

  for (const override of [
    { pressAttempted: false },
    { pressCount: 0 },
    { pressCount: 2 },
    { meterRestored: false },
    { finalVerdict: 'OTHER' },
    { usageSurfaceMatched: false },
    { meterBefore: '' },
    { meterAfter: '', resetControlDisappeared: false },
  ]) {
    const blocked = normalizeCodexBankedResetExecutionResult(successfulProof(override), command());
    assert.equal(blocked.ok, false);
  }
});

test('executes the fixed invocation and parses bounded labeled ancestry proof', () => {
  const root = tempRepo();
  const seen = [];
  const result = executeCodexBankedResetOnBattleBridge(command(), {
    platform: 'win32',
    repoRoot: root,
    now,
    spawn: (exe, args, options) => {
      seen.push({ exe, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({
          ...successfulProof(),
          desktopInteractive: true,
          appWindowFound: true,
        }),
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.matchedUsageLabel, '1 reset available');
  assert.equal(result.usageControlResolution, 'labeled-ancestor');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].exe, 'powershell.exe');
  assert.equal(seen[0].options.shell, false);
});

test('never retries an uncertain press result', () => {
  const root = tempRepo();
  let calls = 0;
  const result = executeCodexBankedResetOnBattleBridge(command(), {
    platform: 'win32', repoRoot: root, now,
    spawn: () => {
      calls += 1;
      return {
        status: 1,
        stdout: JSON.stringify({
          ok: false,
          blocker: 'BLOCKED_RESET_CONFIRMATION_NOT_PROVEN',
          finalVerdict: 'CODEX_BANKED_RESET_EXECUTION_BLOCKED',
          usageSurfaceMatched: true,
          meterBefore: 'Codex usage remaining 0%',
          pressAttempted: true,
          pressCount: 1,
          meterRestored: false,
        }),
        stderr: '',
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.pressCount, 1);
  assert.equal(result.repeatedPressAllowed, false);
});
