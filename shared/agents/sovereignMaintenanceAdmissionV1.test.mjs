import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER, SOVEREIGN_MAINTENANCE_OWNER_VERSION } from './sovereignMaintenanceAdmissionV1.mjs';
import { callSovereignMaintenanceOwnerV1 } from './sovereignCommanderRemoteMailboxV1.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';
import { createSovereignCommanderHttpServer, startSovereignCommanderContinuousRepairGuardian } from '../../scripts/sovereign-commander-http.mjs';

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

test('cross-process mutation aliases always delegate; idle health cannot authorize a local child', async () => {
  for (const guardian of [null, {}, idle, { ...idle, scheduled: true }, { ...idle, timeoutCustodyHeld: true }]) {
    for (const operation of ['MAINTENANCE_ACTION', 'START_PROCESS']) {
      for (const actionId of ['repair-stephanos', 'repair-goal-builder-flow', 'repair-control-plane', 'ignite-stephanos', 'goal-discovery-heartbeat', 'fleet-goal-supervisor', 'gaming-resource-status', 'status-openclaw-whatsapp']) {
        const result = await executeSovereignCommanderCommandV1(envelope(actionId, operation), {
          repoRoot: root, readMaintenanceGuardian: () => guardian,
          callMaintenanceOwner: async () => ({ ok: false, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE' }),
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

test('delegation requires the fixed owner protocol before reading credentials or invoking a tool', async () => {
  const result = await callSovereignMaintenanceOwnerV1({ actionId: 'repair-stephanos' }, {
    fetchFn: async url => { assert.equal(url, 'http://127.0.0.1:18791/health'); return new Response(JSON.stringify({ ok: true,
      service: 'stephanos-sovereign-commander', continuousRepairGuardian: idle })); },
    readFileFn() { assert.fail('old idle health cannot qualify the owner protocol'); },
  });
  assert.equal(result.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED');
});

test('the existing guardian atomically reserves manual execution before await and retains unknown terminal custody', async () => {
  const timers = []; let starts = 0, release;
  const guardian = startSovereignCommanderContinuousRepairGuardian({
    setTimeoutImpl(fn, delay) { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeoutImpl() {}, spawnImpl() { starts++; assert.fail('reserved owner launched another cycle'); },
  });
  try {
    const heldRun = guardian.withMaintenanceOwner({ commandId: 'same-request' }, () => new Promise(resolve => { release = resolve; }));
    assert.equal(guardian.status().maintenanceInFlight, true);
    timers[0].fn(); // Even a timer already queued before cancellation cannot race admission.
    assert.equal(guardian.runNow(), false); assert.equal(starts, 0);
    const concurrent = await guardian.withMaintenanceOwner({}, () => { assert.fail('concurrent owner mutation'); });
    assert.equal(concurrent.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_BUSY');
    release({ ok: true, structuredContent: { status: 0, signal: '' } });
    assert.equal((await heldRun).ok, true);
    assert.equal(guardian.status().maintenanceInFlight, false);
    const unknown = await guardian.withMaintenanceOwner({}, async () => ({ ok: false,
      structuredContent: { status: null, signal: '', errorCode: 'ETIMEDOUT' } }));
    assert.equal(unknown.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    assert.equal(guardian.status().timeoutCustodyHeld, true);
    assert.equal(guardian.runNow(), false);
  } finally { guardian.stop(); }
});

test('Core/stdio delegation executes in the actual HTTP owner while health remains responsive and the timer cannot race', async () => {
  const token = 't'.repeat(48), timers = [], childTimers = []; let child, guardianStarts = 0, fixedStarts = 0, ready;
  const spawned = new Promise(resolve => { ready = resolve; });
  const created = await createSovereignCommanderHttpServer({ token, port: 0, repoRoot: root, continuousRepairEnabled: true,
    continuousRepairSetTimeoutImpl(fn, delay) { const t = { fn, delay, unref() {} }; timers.push(t); return t; },
    continuousRepairClearTimeoutImpl() {}, continuousRepairSpawnImpl() { guardianStarts++; assert.fail('timer overlapped manual execution'); },
    commandExecutor: (input, options) => executeSovereignCommanderCommandV1(input, { ...options,
      spawnFn() { fixedStarts++; child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => false; ready(); return child; },
      setTimeoutFn(fn) { const t = { fn, unref() {} }; childTimers.push(t); return t; }, clearTimeoutFn() {},
    }),
  });
  await new Promise(resolve => created.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${created.server.address().port}`;
  const delegate = request => callSovereignMaintenanceOwnerV1(request, {
    readFileFn: async () => token,
    fetchFn: (url, options) => { assert.ok(url.startsWith('http://127.0.0.1:18791/')); return fetch(url.replace('http://127.0.0.1:18791', base), options); },
  });
  const invoke = () => executeSovereignCommanderCommandV1(envelope('repair-goal-builder-flow'), { repoRoot: root,
    callMaintenanceOwner: delegate, spawnSyncFn() { assert.fail('delegating process launched a local child'); } });
  try {
    const first = invoke(); await spawned;
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.maintenanceOwnerAdmissionVersion, SOVEREIGN_MAINTENANCE_OWNER_VERSION);
    assert.equal(health.continuousRepairGuardian.maintenanceInFlight, true);
    timers[0].fn(); assert.equal(guardianStarts, 0);
    const second = await invoke(); assert.equal(second.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_BUSY');
    assert.equal(fixedStarts, 1);
    child.stdout.emit('data', '{"ok":true}'); child.emit('close', 0, null);
    const result = await first;
    assert.equal(result.ok, true); assert.equal(result.command.missionId, 'same-mission');
    assert.ok(result.structuredContent.ownerCommandId);
    assert.equal(created.continuousRepairStatus().maintenanceInFlight, false);
    // A new request whose owned child times out retains the SAME HTTP owner.
    const timed = invoke();
    for (let attempts = 0; fixedStarts < 2 && attempts < 5000; attempts++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(fixedStarts, 2, 'second owned request must reach its bounded child');
    childTimers.at(-1).fn();
    assert.equal((await timed).blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    child.emit('close', 0, null);
    assert.equal(created.continuousRepairStatus().timeoutCustodyHeld, true);
    assert.equal((await invoke()).blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
  } finally { child?.emit('close', 1, null); await new Promise(resolve => created.server.close(resolve)); }
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
