import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const entry = new URL('./windows/recover-stephanos-core-lock.ps1', import.meta.url);
const nativeTest = new URL('./windows/stephanos-core-lock-recovery.native.test.ps1', import.meta.url);
test('fixed recovery keeps elevation limited to retirement and preserves canonical startup lock', async () => {
  const source = await readFile(entry, 'utf8');
  assert.match(source, /CORE_RECOVERY_LIMITED_PARENT_REQUIRED/);
  assert.match(source, /CORE_RECOVERY_EXACT_OPERATOR_APPROVAL_REQUIRED/);
  assert.match(source, /CORE_RECOVERY_CHILD_BLOCKED_OR_UNCERTAIN/);
  assert.match(source, /--source-truth-json/);
  assert.doesNotMatch(source, /Stop-Process|Remove-Item|Register-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask|ExecutionPolicy/);
  const child = source.slice(source.indexOf('if ($RetireOnlyChild) {'), source.indexOf('# A real child process exit'));
  assert.doesNotMatch(child, /Start-Process/);
});
test('Windows native recovery refuses competing owners, replacements and ambiguous observations', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(nativeTest),
  ], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /CORE_RECOVERY_NATIVE_FIXTURES_PASS=12/);
});
test('recovery entry refuses missing approval before any native observation or mutation', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(entry),
    '-ExpectedHead', 'a'.repeat(40), '-ExpectedLockSha256', 'b'.repeat(64),
  ], { windowsHide: true, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.blocker, 'CORE_RECOVERY_EXACT_OPERATOR_APPROVAL_REQUIRED');
  assert.equal(receipt.coreStartRequested, false);
  assert.equal(receipt.lockRetired, false);
});

for (const variable of ['USERPROFILE', 'HOME', 'LOCALAPPDATA', 'STEPHANOS_SHARED_AGENT_WORKSPACE']) {
  test(`recovery entry rejects redirected ${variable} before elevation or retirement`, { skip: process.platform !== 'win32' }, () => {
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(entry),
      '-ExpectedHead', 'a'.repeat(40), '-ExpectedLockSha256', 'b'.repeat(64), '-OperatorApproved',
    ], { windowsHide: true, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, [variable]: 'C:\\core-recovery-redirected-fixture' } });
    assert.equal(result.status, 2, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.blocker, 'CORE_RECOVERY_PATH_OVERRIDE_REFUSED');
    assert.equal(receipt.lockRetired, false);
    assert.equal(receipt.coreStartRequested, false);
  });
}
