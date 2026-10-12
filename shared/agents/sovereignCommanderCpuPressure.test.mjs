import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeCpuPressureSnapshotProjection, SOVEREIGN_COMMANDER_REMOTE_ACTIONS } from './sovereignCommanderRemoteMailboxV1.mjs';

const registry = await readFile(new URL('./sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../scripts/sovereign-commander-mcp.mjs', import.meta.url), 'utf8');
const script = await readFile(new URL('../../scripts/windows/read-battle-bridge-cpu-pressure.ps1', import.meta.url), 'utf8');
const mailbox = await readFile(new URL('./sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8');
const requiredVersion = await readFile(new URL('../../scripts/sovereign-commander-ignition-autoheal.mjs', import.meta.url), 'utf8');
const reportedVersion = await readFile(new URL('../../scripts/sovereign-commander-http.mjs', import.meta.url), 'utf8');

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
  assert.match(mailbox, /const COMMANDER_RUNTIME_PREFLIGHT_ACTIONS = new Set\(\[\s*'cpu-pressure-snapshot'/);
  assert.match(mailbox, /SOVEREIGN_COMMANDER_REMOTE_CPU_ACTION_STALE_RUNTIME/);
  assert.match(mailbox, /if \(!listed\.ok[\s\S]{0,550}SOVEREIGN_COMMANDER_REMOTE_TOOL_SURFACE_INVALID[\s\S]{0,650}SOVEREIGN_COMMANDER_REMOTE_CPU_ACTION_STALE_RUNTIME/);
  assert.match(mailbox, /commanderOnly: shape\.command\.remoteAction === 'cpu-pressure-snapshot'/);
  assert.match(requiredVersion, /2026-10-12-cpu-pressure-snapshot-v5/);
  assert.match(reportedVersion, /2026-10-12-cpu-pressure-snapshot-v5/);
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
