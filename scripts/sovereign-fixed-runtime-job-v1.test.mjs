import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

test('the runtime kernel remains a separate bounded unit without changing Core limits', () => {
  const source = readFileSync(new URL('./windows/SovereignFixedRuntimeJobV1.cs', import.meta.url));
  assert.ok(source.length > 0 && source.length <= 32768);
  const core = readFileSync(new URL('./windows/SovereignCoreJobCustodyV1.cs', import.meta.url));
  assert.ok(core.length <= 32768);
});

function runFixture(terminalGuardBaseline = 'None', witnessPublication = 'Atomic') {
  const fixtureUrl = new URL('./windows/test-sovereign-fixed-runtime-job-v1.ps1', import.meta.url);
  const ps = value => "'" + value.replaceAll("'", "''") + "'";
  const fixturePath = fileURLToPath(fixtureUrl);
  const fixtureDirectory = fileURLToPath(new URL('./windows/', import.meta.url));
  const expected = createHash('sha256').update(readFileSync(fixtureUrl)).digest('hex');
  // Keep the Windows command line short while authenticating the exact fixture
  // bytes before creating its in-memory test script block.
  const code = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';"
    + "$bytes=[IO.File]::ReadAllBytes(" + ps(fixturePath) + ");"
    + "$sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};"
    + "if($actual -cne '" + expected + "'){throw 'FIXTURE_SOURCE_CHANGED'};"
    + "$source=[Text.UTF8Encoding]::new($false,$true).GetString($bytes).Replace('$PSScriptRoot'," + ps(ps(fixtureDirectory)) + ");"
    + "& ([scriptblock]::Create($source)) -FixtureNodePath " + ps(process.execPath) + " -FixtureTerminalGuardBaseline " + ps(terminalGuardBaseline) + " -FixtureWitnessPublication " + ps(witnessPublication);
  assert.ok(code.length < 4096);
  let stdout;
  try { stdout = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(code, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'], timeout: 85000, maxBuffer: 128 * 1024 }); }
  catch (error) {
    throw new Error('NATIVE_FIXTURE_CHILD_FAILED:' + terminalGuardBaseline + ':'
      + String(error.stderr || error.message).slice(0, 12000));
  }
  return JSON.parse(stdout.trim());
}
test('native runtime stage has actual bound zero/exclusion and never promotes cleanup to success', {
  skip: process.platform !== 'win32', timeout: 90000,
}, () => {
  const result = runFixture();
  assert.equal(result.schemaVersion, 'stephanos.fixed-runtime-native-fixture.v1');
  assert.equal(result.ok, true);
  assert.equal(result.runtimeQualified, false);
  assert.equal(result.fixtureExecutableSha256,
    createHash('sha256').update(readFileSync(process.execPath)).digest('hex'));
  assert.notEqual(result.fixtureExecutable.toLowerCase(), process.execPath.toLowerCase());
  const cases = new Map(result.cases.map(row => [row.Mode, row]));
  assert.deepEqual([...cases.keys()], ['normal','failed','input','deadline','orphan','overflow','query','cancel','parent-death','spawn-fail','bind-denied','drain-cancel','drain-parent-death','witness-paused']);
  for (const [mode, row] of cases) {
    assert.equal(row.RuntimeQualified, false, mode);
    assert.equal(row.SourceMutationAllowed, false, mode);
    assert.equal(row.ObserverFaultCode, '', mode);
    const receipt = row.Receipt;
    if (mode !== 'spawn-fail') {
      assert.equal(row.RootCaptured, true, mode);
      assert.equal(row.RootImagePath.toLowerCase(), result.fixtureExecutable.toLowerCase(), mode);
      assert.equal(row.RootEndedByHandle, true, mode);
      assert.equal(receipt.AssignedBeforeExecution, true, mode);
      assert.equal(receipt.RootCreatedAtUtc, row.RootCreatedAtUtc, mode);
      assert.ok(Number.isSafeInteger(receipt.RootPid) && receipt.RootPid > 0, mode);
    }
    assert.equal(receipt.OperationOk, ['normal','input','witness-paused'].includes(mode), mode);
    assert.equal(receipt.ExecutionCustodyReleased, mode !== 'query', mode);
    assert.equal(receipt.ZeroActiveProcessesObserved, mode !== 'query', mode);
  }
  assert.equal(cases.get('bind-denied').BoundBeforeExecution, true);
  assert.equal(cases.get('bind-denied').Receipt.NormalRootExit, false);
  assert.equal(cases.get('bind-denied').Receipt.Reason, 'PARENT_BINDING_UNPROVEN');
  for (const mode of ['drain-cancel','drain-parent-death']) {
    assert.equal(cases.get(mode).TerminalDrainObserved, true, mode);
    assert.equal(cases.get(mode).Receipt.NormalRootExit, true, mode);
    assert.equal(cases.get(mode).Receipt.ExitCode, 0, mode);
    assert.equal(cases.get(mode).Receipt.OperationOk, false, mode);
    assert.equal(cases.get(mode).Receipt.ExecutionCustodyReleased, true, mode);
  }
  assert.equal(cases.get('drain-cancel').Receipt.Reason, 'CANCELLED');
  assert.equal(cases.get('drain-parent-death').Receipt.Reason, 'OWNER_ENDED');
  assert.equal(cases.get('witness-paused').PartialWitnessIgnored, true);
  const orphan = cases.get('orphan');
  assert.equal(orphan.Receipt.NormalRootExit, true);
  assert.equal(orphan.DescendantCaptured, true);
  assert.equal(orphan.DescendantEndedByHandle, true);
  assert.equal(orphan.Receipt.Reason, 'LIVE_DESCENDANT_REMAINS');
  assert.ok(orphan.Receipt.ObservedLiveDescendantPid > 0);
  assert.equal(orphan.Receipt.ObservedLiveDescendantCreatedAtUtc, orphan.DescendantCreatedAtUtc);
  assert.equal(cases.get('failed').Receipt.ExitCode, 2);
  assert.equal(cases.get('failed').Receipt.CancellationRequested, false);
  assert.equal(cases.get('query').Receipt.ExecutionCustodyReleased, false);
  assert.equal(cases.get('query').RootEndedByHandle, true);
  assert.equal(cases.get('overflow').Receipt.OutputComplete, false);
  assert.equal(cases.get('overflow').Receipt.OutputOverflow, true);
  assert.equal(cases.get('parent-death').Receipt.Reason, 'OWNER_ENDED');
  assert.equal(cases.get('cancel').Receipt.Reason, 'CANCELLED');
  assert.equal(cases.get('deadline').Receipt.Reason, 'DEADLINE');
  assert.equal(cases.get('input').Receipt.Output, '19');
});

test('the Windows terminal-drain fixtures fail if the final owner/cancel guard is removed', {
  skip: process.platform !== 'win32', timeout: 60000,
}, () => {
  for (const [baseline, mode] of [['Cancel','drain-cancel'],['ParentDeath','drain-parent-death']]) {
    const observed = runFixture(baseline);
    assert.equal(observed.ok, false, 'Mutated source remains an observation-only failing variant');
    assert.equal(observed.runtimeQualified, false);
    assert.equal(observed.counterfactualVariant, baseline);
    assert.equal(observed.cases.length, 1);
    const row = observed.cases[0];
    assert.equal(row.Mode, mode);
    assert.equal(row.RuntimeQualified, false);
    assert.equal(row.SourceMutationAllowed, false);
    assert.equal(row.TerminalDrainObserved, true, JSON.stringify(row));
    assert.equal(row.RootCaptured, true);
    assert.equal(row.RootEndedByHandle, true);
    assert.equal(row.Receipt.RootCreatedAtUtc, row.RootCreatedAtUtc);
    assert.equal(row.Receipt.NormalRootExit, true);
    assert.equal(row.Receipt.ExitCode, 0);
    assert.equal(row.Receipt.OutputComplete, true);
    assert.equal(row.Receipt.OperationOk, true, 'Removing only the guard must reproduce the specialist finding');
    assert.equal(row.Receipt.ExecutionCustodyReleased, true);
    assert.equal(row.Receipt.ZeroActiveProcessesObserved, true);
  }
});

test('a visible incomplete producer cannot become a native process witness', {
  skip: process.platform !== 'win32', timeout: 30000,
}, () => {
  const observed=runFixture('None','VisiblePartial');
  assert.equal(observed.ok,false);
  assert.equal(observed.runtimeQualified,false);
  assert.equal(observed.witnessPublicationVariant,'VisiblePartial');
  assert.equal(observed.cases.length,1);
  const row=observed.cases[0];
  assert.equal(row.Mode,'witness-paused');
  assert.ok(['WITNESS_READ_FAILED','WITNESS_FORMAT_INVALID'].includes(row.ObserverFaultCode));
  assert.equal(row.RootCaptured,false);
  assert.equal(row.Receipt.OperationOk,false);
  assert.equal(row.Receipt.Launched,true);
  assert.equal(row.Receipt.AssignedBeforeExecution,true);
  assert.equal(row.Receipt.ExecutionCustodyReleased,true);
  assert.equal(row.Receipt.ZeroActiveProcessesObserved,true);
});
