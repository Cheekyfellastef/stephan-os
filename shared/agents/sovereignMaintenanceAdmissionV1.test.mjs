import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { admitSovereignMaintenanceV1, readFixedSovereignMaintenanceGuardianV1, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER } from './sovereignMaintenanceAdmissionV1.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';
import { createSovereignCommanderHttpServer } from '../../scripts/sovereign-commander-http.mjs';

const root = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const idle = { enabled: true, running: false, timeoutCustodyHeld: false };
function envelope(actionId, operation = 'MAINTENANCE_ACTION') {
  return buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'maintenance-custody-test', missionId: 'same-mission', operation,
    payload: operation === 'START_PROCESS' ? { processId: actionId } : { actionId },
  });
}

test('all common fixed mutation entry aliases hold on timeout, unknown or busy owner evidence', async () => {
  for (const guardian of [null, {}, { ...idle, timeoutCustodyHeld: undefined },
    { ...idle, timeoutCustodyHeld: 'false' }, { ...idle, timeoutCustodyHeld: true },
    { ...idle, running: true }, Object.assign(Object.create({ timeoutCustodyHeld: false }), { enabled: true, running: false })]) {
    for (const operation of ['MAINTENANCE_ACTION', 'START_PROCESS']) {
      for (const actionId of ['repair-stephanos', 'repair-goal-builder-flow', 'repair-control-plane', 'ignite-stephanos', 'goal-discovery-heartbeat', 'fleet-goal-supervisor', 'gaming-resource-status', 'status-openclaw-whatsapp']) {
        const result = await executeSovereignCommanderCommandV1(envelope(actionId, operation), {
          repoRoot: root, readMaintenanceGuardian: () => guardian,
          spawnSyncFn() { assert.fail('held owner reached fixed mutation'); },
        });
        assert.equal(result.ok, false);
        assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED');
      }
    }
  }
  const observed = await executeSovereignCommanderCommandV1(envelope('visibility-snapshot'), {
    repoRoot: root, readMaintenanceGuardian() { assert.fail('observation must remain available'); },
    spawnSyncFn: () => ({ status: 0, stdout: '{}', stderr: '' }),
  });
  assert.equal(observed.ok, true);
  assert.equal((await admitSovereignMaintenanceV1('repair-stephanos', () => idle)).ok, true);
});

test('actual gaming Status reconciles absent state and therefore cannot receive an observation-only bypass', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
  const start = source.indexOf("if ($Action -eq 'Status')"), end = source.indexOf("if ($Action -eq 'Reconcile')", start);
  assert.ok(start >= 0 && end > start);
  const script = `$ErrorActionPreference='Stop';$Action='Status';
    function Read-GovernorState { return $null }
    function Invoke-CurrentReconcile { @{reconciled=$true} }
    ${source.slice(start, end)}`;
  const r = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  assert.equal(JSON.parse(r.stdout).reconciled, true);
});

test('cross-process owner observation uses only bounded fresh fixed health, never a caller URL', async () => {
  const nowMs = Date.parse('2026-10-21T17:00:00Z');
  const health = { ok: true, service: 'stephanos-sovereign-commander', observedAtUtc: new Date(nowMs).toISOString(), continuousRepairGuardian: { ...idle, timeoutCustodyHeld: true } };
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:18791/health'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(health));
  };
  const guardian = await readFixedSovereignMaintenanceGuardianV1({ fetchImpl, nowMs });
  assert.equal((await admitSovereignMaintenanceV1('repair-stephanos', () => guardian)).blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
  for (const change of [{ service: 'other' }, { observedAtUtc: new Date(nowMs - 31000).toISOString() }, { observedAtUtc: new Date(nowMs + 1).toISOString() }]) {
    assert.equal(await readFixedSovereignMaintenanceGuardianV1({ nowMs,
      fetchImpl: async () => new Response(JSON.stringify({ ...health, ...change })) }), null);
  }
  await assert.rejects(readFixedSovereignMaintenanceGuardianV1({ nowMs,
    fetchImpl: async () => new Response(' '.repeat(32769)) }), /TOO_LARGE/);
});

test('actual default HTTP MCP and ignition retain guardian timeout custody after child close', async () => {
  const timers = []; let child, fixedSpawns = 0;
  const created = await createSovereignCommanderHttpServer({ token: 't'.repeat(48), port: 0, repoRoot: root,
    continuousRepairEnabled: true,
    continuousRepairSetTimeoutImpl(fn, delay) { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    continuousRepairClearTimeoutImpl() {},
    continuousRepairSpawnImpl() { child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => false; return child; },
    commandExecutor: (envelope, options) => executeSovereignCommanderCommandV1(envelope, {
      ...options, spawnSyncFn() { fixedSpawns++; return { status: 0, stdout: '{}', stderr: '' }; },
    }),
  });
  await new Promise(resolve => created.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${created.server.address().port}`;
  try {
    timers[0].fn(); timers[1].fn(); child.emit('close', 0);
    assert.equal(created.continuousRepairStatus().timeoutCustodyHeld, true);
    const headers = { authorization: 'Bearer ' + 't'.repeat(48), 'content-type': 'application/json' };
    const rpc = async (method, params = {}, id = 1) => {
      const r = await fetch(base + '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }) });
      if (r.headers.get('mcp-session-id')) headers['mcp-session-id'] = r.headers.get('mcp-session-id');
      return r.status === 202 ? null : (await r.json()).result;
    };
    await rpc('initialize', { protocolVersion: '2025-06-18' });
    await rpc('notifications/initialized', {}, null); await rpc('tools/list');
    for (const actionId of ['repair-stephanos', 'repair-goal-builder-flow', 'ignite-stephanos']) {
      const r = await rpc('tools/call', { name: 'maintenance_action', arguments: { actionId } });
      assert.equal(r.structuredContent.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    }
    const observed = await rpc('tools/call', { name: 'maintenance_action', arguments: { actionId: 'visibility-snapshot' } });
    assert.equal(observed.structuredContent.ok, true);
    assert.equal(fixedSpawns, 1, 'only read-only observation executed');
  } finally { await new Promise(resolve => created.server.close(resolve)); }
});
