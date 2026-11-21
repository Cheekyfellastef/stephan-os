import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const entry = new URL('./windows/recover-stephanos-core-lock.ps1', import.meta.url);
const powerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const head = 'a'.repeat(40), lock = 'b'.repeat(64);
function invoke(path, args = [], env = process.env) {
  return spawnSync(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path,
    '-ExpectedHead', head, ...args], { windowsHide: true, encoding: 'utf8', shell: false, timeout: 10_000, env });
}
function assertRefused(result) {
  assert.equal(result.status, 2, result.stderr || result.error?.message);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 'stephanos.core-lock-recovery.v1');
  assert.equal(receipt.finalVerdict, 'CORE_RECOVERY_BLOCKED');
  assert.equal(receipt.blocker, 'CORE_RECOVERY_TRUSTED_BOOTSTRAP_REQUIRED');
  assert.equal(receipt.expectedHead, head);
  for (const name of ['ok', 'lockRetired', 'coreStartRequested', 'buildPickupProven',
    'leaseReleaseAllowed', 'standingElevationCreated', 'pcRestartAllowed']) assert.equal(receipt[name], false, name);
  return receipt;
}

test('historical reviewed inventory remains exact test-only provenance and cannot qualify the current observer', async () => {
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
  const historical = JSON.parse(await readFile(new URL('../shared/agents/fixtures/stephanosCoreHistoricalRecoveryEntryV1.json', import.meta.url), 'utf8'));
  assert.equal(historical.sourceHead, '8ef452ae017a42f417dcbaa3f8365b38dce2b897');
  assert.equal(historical.testOnly, true);
  assert.equal(historical.runtimeAuthority, false);
  const historicalBytes = Buffer.from(historical.source, 'utf8');
  assert.equal(createHash('sha1').update('blob ' + historicalBytes.length + '\0').update(historicalBytes).digest('hex'), 'ccd8f358fcfa6d6ebf4f0a409ac2c7a32caec58c');
  assert.equal(historical.blobSha, 'ccd8f358fcfa6d6ebf4f0a409ac2c7a32caec58c');
  const helper = await readFile(new URL('./windows/stephanos-core-process-observation.ps1', import.meta.url));
  assert.notEqual(createHash('sha1').update('blob ' + helper.length + '\0').update(helper).digest('hex'), reviewedBlob);
});

test('active recovery entry contains only a deterministic refusal and preserves the public arguments', async () => {
  const source = await readFile(entry, 'utf8');
  for (const name of ['ExpectedHead', 'ExpectedLockSha256', 'AbsentLock', 'OperatorApproved', 'RetireOnlyChild']) {
    assert.ok(source.includes('$' + name), name);
  }
  assert.match(source, /CORE_RECOVERY_TRUSTED_BOOTSTRAP_REQUIRED/);
  assert.doesNotMatch(source, /Start-Process|Stop-Process|Remove-Item|Add-Type|Import-Module|ReadAll|OpenProcess|RunAs|Invoke-Expression|ScriptBlock|Register-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask|ExecutionPolicy/);
  assert.doesNotMatch(source, /^\s*\.\s+/m);
  assert.doesNotMatch(source, /\$env:|\$repoRoot|\$lockPath|\$nativePath|\$policyPath|\$inventoryPath|\$ownerNativePath|\$coreScript/);
});

test('every supported recovery switch/lock mode refuses before elevation, loading, lock access or startup',
  { skip: process.platform !== 'win32' }, () => {
    for (let bits = 0; bits < 16; bits++) {
      const args = [];
      if (bits & 1) args.push('-OperatorApproved');
      if (bits & 2) args.push('-AbsentLock');
      if (bits & 4) args.push('-RetireOnlyChild');
      if (bits & 8) args.push('-ExpectedLockSha256', lock);
      const receipt = assertRefused(invoke(fileURLToPath(entry), args));
      assert.equal(receipt.expectedLockSha256 || '', bits & 8 ? lock : '');
    }
  });

test('recovery refuses beside tampered dependencies and redirected state without executing or changing them',
  { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'core-refusal-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, 'scripts', 'windows');
    await mkdir(folder, { recursive: true });
    const copiedEntry = join(folder, 'recover-stephanos-core-lock.ps1');
    await writeFile(copiedEntry, await readFile(entry));
    const malicious = ['stephanos-core-lock-recovery-policy.ps1', 'stephanos-core-process-observation.ps1',
      'read-sovereign-maintenance-owner-v2.ps1', 'StephanosCoreLockRecoveryV1.cs'];
    for (const name of malicious) await writeFile(join(folder, name), 'throw "TAMPERED_DEPENDENCY_MUST_NOT_LOAD"');
    const lockPath = join(root, 'stephanos-core-daemon.lock.json'), bytes = Buffer.from('original lock bytes');
    await writeFile(lockPath, bytes);
    const before = await readdir(folder);
    for (const args of [['-OperatorApproved', '-AbsentLock'], ['-OperatorApproved', '-RetireOnlyChild', '-ExpectedLockSha256', lock]]) {
      assertRefused(invoke(copiedEntry, args, { ...process.env, USERPROFILE: root, HOME: root,
        LOCALAPPDATA: root, STEPHANOS_SHARED_AGENT_WORKSPACE: root, NODE_OPTIONS: '--invalid-fixture-option' }));
      assert.deepEqual(await readFile(lockPath), bytes);
      assert.deepEqual(await readdir(folder), before);
    }
  });

test('historical native lock/policy fixtures remain negative proof only, outside the active entry',
  { skip: process.platform !== 'win32' }, () => {
    const fixture = fileURLToPath(new URL('./windows/stephanos-core-lock-recovery.native.test.ps1', import.meta.url));
    const result = spawnSync(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture],
      { windowsHide: true, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /CORE_RECOVERY_NATIVE_FIXTURES_PASS=12/);
  });

test('historical attended policy still rejects ambiguous absent-owner and delayed-parent evidence',
  { skip: process.platform !== 'win32' }, () => {
    const fixture = fileURLToPath(new URL('./windows/stephanos-core-absent-bootstrap.test.ps1', import.meta.url));
    const result = spawnSync(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture],
      { windowsHide: true, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /CORE_ABSENT_BOOTSTRAP_POLICY_TESTS_PASS=49/);
  });
