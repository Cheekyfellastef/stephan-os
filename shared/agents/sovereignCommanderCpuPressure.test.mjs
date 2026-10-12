import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeCpuPressureSnapshotProjection, SOVEREIGN_COMMANDER_REMOTE_ACTIONS, executeSovereignCommanderRemoteOnBattleBridge } from './sovereignCommanderRemoteMailboxV1.mjs';

const registry = await readFile(new URL('./sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../scripts/sovereign-commander-mcp.mjs', import.meta.url), 'utf8');
const script = await readFile(new URL('../../scripts/windows/read-battle-bridge-cpu-pressure.ps1', import.meta.url), 'utf8');

const sample = (patch = {}) => ({
  schemaVersion: 'stephanos.battle-bridge-cpu-pressure.v1',
  capturedAtUtc: '2026-10-12T00:00:00.000Z',
  sampleSeconds: 5,
  processorCount: 8,
  metadataAvailable: true,
  rows: [
    {
      pid: 5996,
      processName: 'powershell',
      parentPid: 7000,
      startedAtUtc: '2026-10-12T00:00:00.000Z',
      cpuPercent: 9.3,
      script: 'run-vr-resource-governor.ps1',
      sampleMatched: true,
    },
  ],
  readOnly: true,
  sourceMutationAllowed: false,
  processTerminationAllowed: false,
  arbitraryShellAllowed: false,
  arbitraryProcessInspectionAllowed: false,
  rawCommandLinesReturned: false,
  rawPathsReturned: false,
  secretMaterialIncluded: false,
  unknownMeansGreen: false,
  finalVerdict: 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED',
  ...patch,
});
const envelope = (data) => ({ structuredContent: { stdout: JSON.stringify(data) } });

test('fixed registry, MCP, and GitHub mailbox expose only bounded CPU snapshot action', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('cpu-pressure-snapshot'));
  assert.match(registry, /'cpu-pressure-snapshot': frozen\(\{/);
  assert.match(registry, /read-battle-bridge-cpu-pressure\.ps1/);
  assert.match(registry, /timeoutMs: 25_000/);
  assert.match(mcp, /'cpu-pressure-snapshot'/);
  assert.match(script, /Start-Sleep -Seconds 5/);
  assert.match(script, /StartedTicks -eq \$startTime\.Ticks/);
  assert.doesNotMatch(script, /\$id\b/i, 'PowerShell $id aliases the reserved $PID variable');
  assert.match(script, /\$processId = \[int\]\$p\.Id/);
  assert.match(script, /TotalMilliseconds\) -gt 2/);
  assert.match(script, /rawCommandLinesReturned = \$false/);
  assert.match(script, /processTerminationAllowed = \$false/);
  assert.doesNotMatch(script, /\b(?:Stop-Process|taskkill|Invoke-Expression|Register-ScheduledTask)\b/i);
});

test('mailbox projects measured CPU and known script basename without raw command line or path', () => {
  const p = safeCpuPressureSnapshotProjection(envelope(sample()), 'cpu-pressure-snapshot');
  assert.equal(p.finalVerdict, 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED');
  assert.equal(p.rows[0].pid, 5996);
  assert.equal(p.rows[0].cpuPercent, 9.3);
  assert.equal(p.rows[0].script, 'run-vr-resource-governor.ps1');
  assert.equal(Object.hasOwn(p.rows[0], 'commandLine'), false);
  assert.equal(Object.hasOwn(p.rows[0], 'path'), false);
  assert.equal(p.processTerminationAllowed, false);
  assert.equal(p.rawPathsReturned, false);
});

test('mailbox CPU projection fails closed on fake permission or unsanitized path/script', () => {
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample()), 'visibility-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ rawCommandLinesReturned: true })), 'cpu-pressure-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ processTerminationAllowed: true })), 'cpu-pressure-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ rows: [{ ...sample().rows[0], script: 'secret.ps1' }] })), 'cpu-pressure-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ rows: [{ ...sample().rows[0], cpuPercent: 999 }] })), 'cpu-pressure-snapshot'), null);
});

const CPU_HEAD = 'a'.repeat(40);
const CPU_COMMAND = Object.freeze({
  schemaVersion: 'stephanos.battle-bridge-github-command.v1',
  requestId: 'test-fixed-cpu-snapshot',
  operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 2808,
  branch: 'main',
  operatorApproval: 'operator-approved',
  expectedHead: CPU_HEAD,
  expiresAt: '2026-10-12T03:00:00.000Z',
  remoteAction: 'cpu-pressure-snapshot',
});
function cpuRunner({ dirty = false, badPayload = false, sampleStatus = 0, observedHead = CPU_HEAD } = {}) {
  const calls = [];
  const spawnSyncFn = (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse')) return { status: 0, stdout: observedHead + '\n' };
    if (args.includes('diff')) return { status: dirty ? 1 : 0, stdout: '' };
    if (executable === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') {
      return { status: sampleStatus, stdout: badPayload ? '{malformed' : JSON.stringify(sample()) };
    }
    throw new Error('unexpected process/executable: ' + executable);
  };
  return { calls, spawnSyncFn };
}
test('canonical mailbox runs only fixed read-only PowerShell CPU sample, without MCP or lifecycle side effects', async () => {
  const runner = cpuRunner();
  const receipt = await executeSovereignCommanderRemoteOnBattleBridge(CPU_COMMAND, {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    spawnSyncFn: runner.spawnSyncFn,
    fetchFn: () => { throw new Error('MCP network request not permitted for fixed CPU snapshot'); },
    ensureRuntimeFn: () => { throw new Error('CPU snapshot must not recycle Commander'); },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_COMPLETE');
  assert.equal(receipt.result.executionSurface, 'canonical-sovereign-mailbox-fixed-sampler');
  assert.equal(receipt.result.cpuPressure.rows[0].cpuPercent, 9.3);
  assert.equal(receipt.result.proofHash.length, 64);
  assert.equal(receipt.result.cpuPressure.rawCommandLinesReturned, false);
  assert.equal(runner.calls.length, 5, 'branch, head, two clean-script checks, fixed CPU sampler');
  assert.equal(runner.calls.at(-1).args.at(-1).endsWith('read-battle-bridge-cpu-pressure.ps1'), true);
  assert.equal(runner.calls.at(-1).args.includes('-NoProfile'), true);
  assert.equal(runner.calls.at(-1).args.includes('-NonInteractive'), true);
  assert.equal(receipt.result.pcRestartAuthority, false);
});
test('fixed CPU sampler fails closed on local script changes, unexpected HEAD, bad JSON and failed process', async () => {
  for (const [params, blocker, callCount] of [
    [{ dirty: true }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SCRIPT_NOT_CANONICAL', 4],
    [{ observedHead: 'b'.repeat(40) }, 'SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH', 2],
    [{ badPayload: true }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_RECEIPT_INVALID', 5],
    [{ sampleStatus: 124 }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_RECEIPT_INVALID', 5],
  ]) {
    const runner = cpuRunner(params);
    const receipt = await executeSovereignCommanderRemoteOnBattleBridge(CPU_COMMAND, {
      env: { USERPROFILE: 'C:\\Users\\Operator' },
      spawnSyncFn: runner.spawnSyncFn,
      fetchFn: () => { throw new Error('Unexpected network call'); },
      ensureRuntimeFn: () => { throw new Error('Unexpected runtime mutation'); },
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.blocker, blocker);
    assert.equal(runner.calls.length, callCount);
    assert.equal(JSON.stringify(receipt).includes('malformed'), false);
  }
});
