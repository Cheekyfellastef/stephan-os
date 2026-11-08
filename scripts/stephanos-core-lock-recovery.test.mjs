import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const entry = new URL('./windows/recover-stephanos-core-lock.ps1', import.meta.url);
const nativeTest = new URL('./windows/stephanos-core-lock-recovery.native.test.ps1', import.meta.url);
test('attended capture preserves the exact qualified watchdog helper and original load boundary', async () => {
  const helper = await readFile(new URL('./windows/stephanos-core-process-observation.ps1', import.meta.url));
  const blob = createHash('sha1').update(`blob ${helper.length}\0`).update(helper).digest('hex');
  assert.equal(blob, '9e00ce659859b0274fce36e13cb20045b1b337b1');
  const functions = [...helper.toString('utf8').matchAll(/^function ([\w-]+)/gm)].map(m => m[1]);
  assert.deepEqual(functions, ['ConvertTo-StephanosCoreProcessObservation', 'Get-StephanosCoreProcessObservation']);
  const policy = await readFile(new URL('./windows/stephanos-core-lock-recovery-policy.ps1', import.meta.url), 'utf8');
  assert.match(policy, /function Get-StephanosCoreProcessIdentityObservation/);
  const source = await readFile(entry, 'utf8');
  assert.ok(source.indexOf('. $policyPath') < source.indexOf('if ($RetireOnlyChild) {'));
  assert.ok(source.indexOf('. $inventoryPath') < source.indexOf('$before = Get-StephanosCoreProcessIdentityObservation'));
  assert.match(source, /\$sourceFiles = @\(\$entry, \$nativePath, \$policyPath, \$inventoryPath, \$coreScript\)/);
});
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

test('Windows attended absent bootstrap rejects stale terminal identity and parent delays', { skip: process.platform !== 'win32' }, () => {
  const fixture = new URL('./windows/stephanos-core-absent-bootstrap.test.ps1', import.meta.url);
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(fixture),
  ], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /CORE_ABSENT_BOOTSTRAP_POLICY_TESTS_PASS=50/);
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

test('attended source proof is separate from both short native freshness windows', async () => {
  const entry = await readFile(new URL('./windows/recover-stephanos-core-lock.ps1', import.meta.url), 'utf8');
  const native = entry.slice(entry.indexOf('            $absence = [StephanosCoreLockRecoveryV1]::new'), entry.indexOf("            Write-CoreRecoveryResult $true 'CORE_ABSENT_INVENTORY_OBSERVED'"));
  const parent = entry.slice(entry.indexOf("    $arguments = @('-NoLogo'"), entry.indexOf('    $statusPath = Join-Path'));
  assert.match(entry, /Assert-CoreRecoverySource\s+# Full canonical proof/);
  assert.match(native, /Assert-CoreRecoveryLocalSource[\s\S]*Get-StephanosCoreProcessIdentityObservation/);
  assert.equal([...native.matchAll(/Assert-CoreRecoveryLocalSource/g)].length, 2);
  assert.doesNotMatch(native, /Assert-CoreRecoverySource/);
  assert.match(parent, /if \(\$AbsentLock\) \{ Assert-CoreRecoveryLocalSource \}\s*else \{ Assert-CoreRecoverySource \}/);
  assert.doesNotMatch(parent.slice(parent.indexOf('if ($AbsentLock) { Assert-CoreRecoveryLocalSource }'), parent.indexOf('Assert-StephanosCoreAttendedChildContinuation')), /--source-truth-json|& \$node/);
  assert.match(entry, /Assert-StephanosCoreAttendedChildContinuation/);
  assert.match(entry, /Assert-CoreRecoverySource\s+Write-CoreRecoveryResult \$true 'CORE_RECOVERY_FRESH_HEARTBEAT_PROVEN'/);
  assert.match(entry, /Assert-CoreRecoveryLocalSource[\s\S]*CORE_RECOVERY_LOCAL_HEAD_CHANGED/);
  assert.match(entry, /CORE_RECOVERY_LOCAL_GIT_METADATA_CHANGED/);
});
