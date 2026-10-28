import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the runtime kernel remains a separate bounded unit without changing Core limits', () => {
  const source = readFileSync(new URL('./windows/SovereignFixedRuntimeJobV1.cs', import.meta.url));
  assert.ok(source.length > 0 && source.length <= 32768);
  const core = readFileSync(new URL('./windows/SovereignCoreJobCustodyV1.cs', import.meta.url));
  assert.ok(core.length <= 32768);
});

test('native runtime stage has actual bound zero/exclusion and never promotes cleanup to success', {
  skip: process.platform !== 'win32', timeout: 90000,
}, () => {
  const fixtureUrl = new URL('./windows/test-sovereign-fixed-runtime-job-v1.ps1', import.meta.url);
  const fixtureDirectory = fileURLToPath(new URL('./windows/', import.meta.url)).replaceAll("'", "''");
  const code = readFileSync(fixtureUrl, 'utf8').replaceAll('$PSScriptRoot', "'" + fixtureDirectory + "'");
  const stdout = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(code, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 85000, maxBuffer: 128 * 1024 });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.schemaVersion, 'stephanos.fixed-runtime-native-fixture.v1');
  assert.equal(result.ok, true);
  assert.equal(result.runtimeQualified, false);
  const cases = new Map(result.cases.map(row => [row.Mode, row]));
  assert.deepEqual([...cases.keys()], ['normal','failed','input','deadline','orphan','overflow','query','cancel','parent-death','spawn-fail']);
  for (const [mode, row] of cases) {
    assert.equal(row.RuntimeQualified, false, mode);
    assert.equal(row.SourceMutationAllowed, false, mode);
    const receipt = row.Receipt;
    if (mode !== 'spawn-fail') {
      assert.equal(row.RootCaptured, true, mode);
      assert.equal(row.RootEndedByHandle, true, mode);
      assert.equal(receipt.AssignedBeforeExecution, true, mode);
      assert.equal(receipt.RootCreatedAtUtc, row.RootCreatedAtUtc, mode);
      assert.ok(Number.isSafeInteger(receipt.RootPid) && receipt.RootPid > 0, mode);
    }
    assert.equal(receipt.OperationOk, ['normal','input'].includes(mode), mode);
    assert.equal(receipt.ExecutionCustodyReleased, mode !== 'query', mode);
    assert.equal(receipt.ZeroActiveProcessesObserved, mode !== 'query', mode);
  }
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
