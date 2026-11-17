import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const entry = new URL('./windows/recover-stephanos-core-lock.ps1', import.meta.url);
const nativeTest = new URL('./windows/stephanos-core-lock-recovery.native.test.ps1', import.meta.url);
test('attended capture preserves the exact qualified watchdog helper and original load boundary', async () => {
  // The previously qualified watchdog inventory is retained as immutable,
  // test-only data. A proposed native observer must not silently requalify it.
  const frozen = JSON.parse(await readFile(
    new URL('../shared/agents/fixtures/stephanosCoreReviewedProcessObservationV1.json', import.meta.url), 'utf8'));
  assert.equal(frozen.schemaVersion, 'stephanos.test-only-reviewed-core-inventory-fixture.v1');
  assert.equal(frozen.sourcePath, 'scripts/windows/stephanos-core-process-observation.ps1');
  assert.equal(frozen.sourceHead, '62d659f63ada09586967882cb790b8363a0bf1a0');
  assert.equal(frozen.testOnly, true);
  assert.equal(frozen.runtimeAuthority, false);
  const reviewed = Buffer.from(frozen.source, 'utf8');
  const reviewedBlob = createHash('sha1').update('blob ' + reviewed.length + '\0').update(reviewed).digest('hex');
  assert.equal(reviewedBlob, '9e00ce659859b0274fce36e13cb20045b1b337b1');
  assert.equal(frozen.blobSha, reviewedBlob);
  const reviewedFunctions = [...frozen.source.matchAll(/^function ([\w-]+)/gm)].map(m => m[1]);
  assert.deepEqual(reviewedFunctions, ['ConvertTo-StephanosCoreProcessObservation', 'Get-StephanosCoreProcessObservation']);

  // The new observer remains an unqualified source candidate. Pin its exact
  // code separately, and retain the existing recovery-script load-order gates.
  const helper = await readFile(new URL('./windows/stephanos-core-process-observation.ps1', import.meta.url));
  const candidateBlob = createHash('sha1').update('blob ' + helper.length + '\0').update(helper).digest('hex');
  assert.notEqual(candidateBlob, reviewedBlob);
  assert.doesNotMatch(helper.toString('utf8'), /^\.\s*\(Join-Path \$PSScriptRoot 'read-sovereign-maintenance-owner-v2\.ps1'\)$/m);
  assert.match(helper.toString('utf8'), /ReadAllBytes\(\$ownerNativePath\)/);
  assert.match(helper.toString('utf8'), /\[ScriptBlock\]::Create\(\$canonicalSource\)/);
  const ownerNativeText = await readFile(new URL('./windows/read-sovereign-maintenance-owner-v2.ps1', import.meta.url), 'utf8');
  const ownerNativeDigest = createHash('sha256').update(ownerNativeText.replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(ownerNativeDigest, 'a00610021f2ed29c3c18189e1ed65f261dc66a3de9e889aa394f46a78a40c261');
  assert.match(helper.toString('utf8'), /a00610021f2ed29c3c18189e1ed65f261dc66a3de9e889aa394f46a78a40c261/);
  const functions = [...helper.toString('utf8').matchAll(/^function ([\w-]+)/gm)].map(m => m[1]);
  assert.deepEqual(functions, ['ConvertTo-StephanosCoreProcessObservation', 'Get-StephanosCoreProcessObservation']);
  const policy = await readFile(new URL('./windows/stephanos-core-lock-recovery-policy.ps1', import.meta.url), 'utf8');
  assert.match(policy, /function Get-StephanosCoreProcessIdentityObservation/);
  const source = await readFile(entry, 'utf8');
  assert.ok(source.indexOf('. $policyPath') < source.indexOf('if ($RetireOnlyChild) {'));
  assert.ok(source.indexOf('. $inventoryPath') < source.indexOf('$before = Get-StephanosCoreProcessIdentityObservation'));
  assert.match(source, /\$sourceFiles = @\(\$entry, \$nativePath, \$policyPath, \$inventoryPath, \$ownerNativePath, \$coreScript\)/);
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
  assert.match(result.stdout, /CORE_ABSENT_BOOTSTRAP_POLICY_TESTS_PASS=49/);
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
