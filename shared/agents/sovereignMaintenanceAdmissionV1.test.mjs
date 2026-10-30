import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER, SOVEREIGN_MAINTENANCE_OWNER_VERSION,
  unqualifiedCoreWindowsRepairV1 } from './sovereignMaintenanceAdmissionV1.mjs';
import { callSovereignMaintenanceOwnerV1 } from './sovereignCommanderRemoteMailboxV1.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';
import { createSovereignCommanderHttpServer, startSovereignCommanderContinuousRepairGuardian } from '../../scripts/sovereign-commander-http.mjs';

const root = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const idle = { enabled: true, running: false, timeoutCustodyHeld: false };

function coreMaintenanceFunction(name, nextName, overrides = {}) {
  const source = readFileSync(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\nasync function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    projectStephanosCoreDaemonState: value => value,
    readCanonicalMissionWorkerHeartbeatAgeMs: () => 0,
    coreWorkerDependentWorkAllowed: () => true,
    unqualifiedCoreWindowsRepairV1,
    repoRoot: root, workspaceRoot: 'C:\\fixture\\workspace',
    lastOctopusSelfHealAttemptCount: 1, lastDependencySelfHealAttemptCount: 1,
    OCTOPUS_SELF_HEAL_RELATED_ISSUE: '#2961', RELATED_ISSUE: '#2961', PROOF_REF: 'fixture-proof',
    STEPHANOS_EXECUTION_SURFACE: { SOVEREIGN_COMMANDER: 'sovereign-commander' },
    SOVEREIGN_COMMANDER_OPERATION: { MAINTENANCE_ACTION: 'MAINTENANCE_ACTION' },
    buildStephanosExecutionSurfaceCatalogV1: () => ({}),
    buildStephanosExecutionCommandEnvelopeV1: value => value,
    ...overrides,
  });
  vm.runInContext(source.slice(start, end), context);
  return context[name];
}

test('actual Core automatic initial, escalation and retry cannot enter manual owner admission without native custody', async () => {
  for (const [actionId, phase] of [
    ['repair-goal-builder-flow', 'goal-builder'],
    ['repair-control-plane', 'control-plane'],
    ['repair-goal-builder-flow', 'goal-builder-retry'],
  ]) {
    let automaticCalls = 0;
    const guardian = startSovereignCommanderContinuousRepairGuardian({
      spawnImpl: () => assert.fail('manual fixture must not spawn'),
      setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
    });
    const run = coreMaintenanceFunction('runBoundedOctopusMaintenance', 'runBoundedOctopusSelfHeal', {
      executeSovereignCommanderCommandV1: envelope => {
        automaticCalls++;
        return guardian.withMaintenanceOwner({ plan: { processId: actionId } }, async () => ({
          ok: false, structuredContent: { status: null, errorCode: 'ETIMEDOUT' },
        }));
      },
    });
    try {
      const result = await run(actionId, 'a'.repeat(40), phase);
      assert.equal(automaticCalls, 0, phase);
      assert.equal(result.blocker, 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE');
      assert.equal(result.executionState, 'NOT_STARTED');
      assert.equal(result.maintenanceReservationCreated, false);
      assert.equal(result.nativeCustodyQualified, false);
      assert.equal(guardian.status().timeoutCustodyHeld, false);
      let manualCalls = 0;
      const manual = await guardian.withMaintenanceOwner({ plan: { processId: 'repair-ui-4173' } }, async () => {
        manualCalls++;
        return { ok: true, structuredContent: { status: 0, stdout: '' } };
      });
      assert.equal(manualCalls, 1);
      assert.equal(manual.ok, true);
    } finally { guardian.stop(); }
  }
});

test('Core still checks worker custody before considering automatic broad maintenance', async () => {
  const run = coreMaintenanceFunction('runBoundedOctopusMaintenance', 'runBoundedOctopusSelfHeal', {
    coreWorkerDependentWorkAllowed: () => false,
    unqualifiedCoreWindowsRepairV1() { assert.fail('invalid worker reached later admission'); },
    executeSovereignCommanderCommandV1() { assert.fail('invalid worker reached owner'); },
  });
  const result = await run('repair-goal-builder-flow', 'a'.repeat(40), 'goal-builder');
  assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
});

test('the separate existing backend dependency action retains its original owner route', async () => {
  const calls = [];
  const run = coreMaintenanceFunction('runBoundedDependencyMaintenance', 'maybeRepairCoreDependencies', {
    unqualifiedCoreWindowsRepairV1() { assert.fail('dependency-specific action acquired broad-repair policy'); },
    executeSovereignCommanderCommandV1(envelope) { calls.push(envelope.payload.actionId); return { ok: true }; },
  });
  const result = await run('repair-battle-bridge', 'a'.repeat(40), 'stephanos-core-backend-self-heal');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['repair-battle-bridge']);
});
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
    child.stdout.emit('data', 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT='
      + JSON.stringify({ schemaVersion: 'stephanos.sovereign-commander-goal-builder-repair.v1', ok: true, steps: [] }));
    child.emit('close', 0, null);
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

// Exercise the actual wrappers, not a model of the guardian's own condition.
test('completed wrapper exits retain nested timeout custody in scheduled and both manual aliases', async () => {
  const { runSovereignCommanderGoalBuilderRepair } = await import('../../scripts/sovereign-commander-goal-builder-repair.mjs');
  const { runSovereignCommanderStephanosRepair } = await import('../../scripts/sovereign-commander-stephanos-repair.mjs');
  const head = 'a'.repeat(40);
  for (const errorCode of ['ETIMEDOUT', 'ABORT_ERR']) {
    const builder = runSovereignCommanderGoalBuilderRepair({
      readWorkerHeartbeatAgeMs: () => 0,
      runStep: step => step.id === 'goal-discovery-heartbeat'
        ? { ok: false, status: null, stdout: '', errorCode }
        : { ok: true, status: 0, stdout: '{}' },
    });
    const composed = runSovereignCommanderStephanosRepair({
      readHead: () => head,
      runStep: step => step.id === 'sovereign-control-plane-caretaker'
        ? { ok: true, status: 0, stdout: JSON.stringify({ healthy: true,
          coreDaemonHealthy: true, coreDaemonSourceHead: head }) }
        : { ok: false, status: 2, stdout: 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=' + JSON.stringify(builder) },
    });
    assert.equal(builder.blocker, errorCode);
    assert.equal(composed.blocker, errorCode);
    for (const [actionId, marker, receipt] of [
      ['repair-goal-builder-flow', 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=', builder],
      ['repair-stephanos', 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=', composed],
    ]) {
      for (const operation of ['MAINTENANCE_ACTION', 'START_PROCESS']) {
        const guardian = startSovereignCommanderContinuousRepairGuardian({
          spawnImpl: () => assert.fail('manual fixture must not spawn'),
      setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
        });
        try {
          const command = { operation, plan: { kind: 'fixed-process', processId: actionId } };
          const result = await guardian.withMaintenanceOwner(command, async () => ({ ok: false,
            structuredContent: { status: 2, signal: '', errorCode: '', stdout: marker + JSON.stringify(receipt) } }));
          assert.equal(result.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
          assert.equal(guardian.status().timeoutCustodyHeld, true);
          assert.equal(guardian.status().scheduled, false);
          assert.equal(guardian.runNow(), false);
          await guardian.withMaintenanceOwner(command, () => assert.fail('nested timeout admitted another child'));
        } finally { guardian.stop(); }
      }
    }
    for (const topLevelGreen of [false, true]) {
      const timers = []; let child, launches = 0;
      const guardian = startSovereignCommanderContinuousRepairGuardian({
        spawnImpl() { launches++; child = new EventEmitter(); child.stdout = new EventEmitter();
          child.stderr = new EventEmitter(); return child; },
        setTimeoutImpl(fn, delay) { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
        clearTimeoutImpl() {},
      });
      try {
        timers[0].fn();
        child.stdout.emit('data', 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=' + JSON.stringify({
          ...composed, ok: topLevelGreen, blocker: 'UNRELATED_OUTER_HOLD', reporting: { ok: true },
        }) + '\n');
        child.emit('close', topLevelGreen ? 0 : 2);
        assert.equal(guardian.status().timeoutCustodyHeld, true);
        assert.equal(guardian.status().scheduled, false);
        assert.equal(guardian.status().lastBlocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
        assert.equal(guardian.runNow(), false);
        child.emit('close', 0); // A late successful close cannot release descendants.
        assert.equal(guardian.status().timeoutCustodyHeld, true);
        assert.equal(launches, 1);
      } finally { guardian.stop(); }
    }
  }
});

test('shared terminal custody invariant is monotone under nested negative evidence and bounded malformed graphs', async () => {
  const { sovereignMaintenanceCustodyUnprovenV1: held } = await import('./sovereignMaintenanceAdmissionV1.mjs');
  const execution = { status: 2, signal: '', errorCode: '' };
  const ordinary = { blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING', steps: [{ status: 2, errorCode: '' }] };
  assert.equal(held(execution, ordinary), false, 'completed ordinary HOLD retains normal paced retry');
  for (const token of ['ETIMEDOUT', 'ABORT_ERR']) {
    for (const field of ['blocker', 'errorCode', 'controlPlaneResidualBlocker']) {
      for (let depth = 0; depth < 8; depth++) {
        let nested = { status: 2, [field]: token };
        for (let i = 0; i < depth; i++) nested = { status: 0, steps: [{ status: 0 }, nested, { status: 0 }] };
        for (const status of [0, 2]) assert.equal(held({ ...execution, status }, nested), true);
      }
    }
  }
  const cycle = {}; cycle.steps = [cycle];
  for (const receipt of [cycle, { steps: {} }, { steps: [null] }, { steps: [{ status: null }] },
    { steps: Array.from({ length: 129 }, () => ({ status: 0 })) }]) assert.equal(held(execution, receipt), true);
  assert.equal(held({ status: 0, signal: 'SIGTERM' }), true);
  assert.equal(held({ status: null }), true);
});

test('actual bare-JSON control-plane protocol holds the real manual owner after internal native timeout', async () => {
  const { runSovereignCommanderControlPlaneRepair } = await import('../../scripts/sovereign-commander-control-plane-repair.mjs');
  const { readSovereignMaintenanceTerminalReceiptV1: read, sovereignMaintenanceCustodyUnprovenV1: held } = await import('./sovereignMaintenanceAdmissionV1.mjs');
  const receipt = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo', platform: 'win32',
    spawnSyncFn: (exe, args) => exe.includes('Git')
      ? { status: 0, stdout: args.at(-1) === '--show-current' ? 'main\n' : 'a'.repeat(40) }
      : { status: null, stdout: '', error: { code: 'ETIMEDOUT' } },
    reconciler: ({ spawnSyncFn }) => {
      spawnSyncFn('fixed-installer', []);
      return { ok: false, blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
        sourceMutationAllowed: false, gitMutationAllowed: false, arbitraryShellAllowed: false, pcRestartAllowed: false };
    },
  });
  const stdout = JSON.stringify(receipt) + '\n'; // Exact existing CLI output, no invented marker.
  const parsed = read(stdout, 'repair-control-plane');
  assert.equal(parsed.schemaVersion, 'stephanos.sovereign-commander-control-plane-repair.v1');
  assert.equal(held({ status: 1 }, parsed), true);
  assert.equal(held({ status: 0 }, { repair: { tasks: [{ status: 0, executionEvidence: [{ status: null, errorCode: 'ETIMEDOUT' }] }] } }), true);
  for (const operation of ['MAINTENANCE_ACTION', 'START_PROCESS']) {
    const guardian = startSovereignCommanderContinuousRepairGuardian({
      spawnImpl: () => assert.fail('manual fixture must not spawn'),
      setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
    });
    try {
      const result = await guardian.withMaintenanceOwner({ operation, plan: { processId: 'repair-control-plane' } },
        async () => ({ ok: false, structuredContent: { status: 1, errorCode: '', signal: '', stdout } }));
      assert.equal(result.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
      assert.equal(guardian.status().scheduled, false);
      assert.equal(guardian.status().timeoutCustodyHeld, true);
      assert.equal(guardian.runNow(), false);
    } finally { guardian.stop(); }
  }
});

test('missing, malformed, unknown and oversized wrapper protocols cannot release descendant custody', async () => {
  const { readSovereignMaintenanceTerminalReceiptV1: read, sovereignMaintenanceCustodyUnprovenV1: held } = await import('./sovereignMaintenanceAdmissionV1.mjs');
  for (const processId of ['repair-stephanos', 'repair-goal-builder-flow', 'repair-control-plane']) {
    for (const stdout of ['', '{', '{}', JSON.stringify({ schemaVersion: 'unknown', ok: true }), 'x'.repeat(65537)]) {
      assert.equal(held({ status: 0 }, read(stdout, processId)), true);
    }
  }
  assert.equal(held({ status: 0 }, read('', 'unrelated-fixed-action')), false);
});

test('terminal protocol is bound to the requested wrapper, exact format and final record', async () => {
  const { readSovereignMaintenanceTerminalReceiptV1: read, sovereignMaintenanceCustodyUnprovenV1: held } = await import('./sovereignMaintenanceAdmissionV1.mjs');
  const protocols = [
    ['repair-stephanos', 'stephanos.sovereign-commander-stephanos-repair.v1', 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=', 2],
    ['repair-goal-builder-flow', 'stephanos.sovereign-commander-goal-builder-repair.v1', 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=', 2],
    ['repair-control-plane', 'stephanos.sovereign-commander-control-plane-repair.v1', '', 1],
  ];
  for (const [processId, schema, marker, failedExit] of protocols) {
    for (const ok of [true, false]) {
      const receipt = { schemaVersion: schema, ok, steps: [], blocker: ok ? '' : 'ORDINARY_COMPLETED_HOLD' };
      const wire = marker + JSON.stringify(receipt);
      const status = ok ? 0 : failedExit;
      assert.equal(held({ status }, read(wire, processId), processId), false);
      assert.equal(held({ status: ok ? failedExit : 0 }, read(wire, processId), processId), true, 'contradictory exit cannot release');
      for (const [otherId, otherSchema, otherMarker] of protocols) {
        if (otherId === processId) continue;
        const otherWire = otherMarker + JSON.stringify({ schemaVersion: otherSchema, ok: true, steps: [] });
        for (const output of [otherWire, wire + '\n' + otherWire,
          marker + JSON.stringify({ schemaVersion: otherSchema, ok: true }), otherWire + '\n{truncated']) {
          assert.equal(held({ status }, read(output, processId), processId), true, processId + ' must reject ' + otherId);
        }
        assert.equal(held({ status }, read(otherWire + '\n' + wire, processId), processId), false);
      }
      const wrongFormat = marker ? JSON.stringify(receipt) : 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_RESULT=' + JSON.stringify(receipt);
      assert.equal(held({ status }, read(wrongFormat, processId), processId), true);
    }
  }
});


test('Core reopens only its fixed goal repair after current actual qualification and owner routing', async () => {
  const calls=[];
  const run=coreMaintenanceFunction('runBoundedOctopusMaintenance','runBoundedOctopusSelfHeal',{
    inspectFixedRuntimeQualificationV1:()=>({ok:true,sourceHead:'a'.repeat(40),profiles:['MAINTENANCE_GOAL_BUILDER_V1']}),
    executeSovereignCommanderCommandV1:envelope=>{calls.push(envelope);return {ok:false,blocker:'OWNER_INDEPENDENT_ADMISSION_REQUIRED'};},
  });
  assert.equal((await run('repair-goal-builder-flow','a'.repeat(40),'goal-builder')).blocker,'OWNER_INDEPENDENT_ADMISSION_REQUIRED');
  assert.equal(calls.length,1);assert.equal(calls[0].payload.actionId,'repair-goal-builder-flow');
  assert.equal(Object.hasOwn(calls[0].payload,'qualified'),false);
  await run('repair-control-plane','a'.repeat(40),'control-plane');
  await run('repair-goal-builder-flow','b'.repeat(40),'goal-builder');
  assert.equal(calls.length,1,'unsupported profile and source drift never reach owner');
});


test('default Windows owner cannot reserve or run an unsupported profile', {skip:process.platform!=='win32'}, async () => {
  const guardian=startSovereignCommanderContinuousRepairGuardian({setTimeoutImpl:()=>({unref(){}}),clearTimeoutImpl(){}});
  try {
    const result=await guardian.withMaintenanceOwner({plan:{processId:'repair-control-plane'}},()=>assert.fail('unsupported child launched'));
    assert.equal(result.blocker,'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED');
    assert.equal(guardian.status().timeoutCustodyHeld,false);
    assert.equal(guardian.status().maintenanceInFlight,false);
  } finally {guardian.stop();}
});
