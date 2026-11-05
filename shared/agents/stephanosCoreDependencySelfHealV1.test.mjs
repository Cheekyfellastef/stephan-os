import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { projectStephanosCoreDaemonState, coreWorkerDependentWorkAllowed } from './stephanosCoreDaemonV1.mjs';
import { projectStephanosControlPlaneSpine } from './stephanosControlPlaneSpineV1.mjs';
import { canonicalMissionWorkerEvidenceAllowsWork } from './canonicalMissionWorkerEvidenceV1.mjs';
import { unqualifiedCoreWindowsRepairV1 } from './sovereignMaintenanceAdmissionV1.mjs';

const HEAD = 'a'.repeat(40);
const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function maybeRepairCoreDependencies(');
const end = source.indexOf('async function runBoundedOctopusMaintenance(', start);
assert.ok(start >= 0 && end > start);

test('actual late Core reconciliation rechecks worker evidence after awaited maintenance', async () => {
  const a = source.indexOf("markFlywheelStage('RECONCILE');");
  const b = source.indexOf('lastFlywheelSummary =', a);
  assert.ok(a >= 0 && b > a);
  let age = 0, dispatches = 0;
  const context = vm.createContext({
    canonicalMissionWorkerEvidenceAllowsWork,
    readCanonicalMissionWorkerHeartbeatAgeMs: () => age,
    markFlywheelStage: () => {}, sourceHead: HEAD, repoRoot: 'repo', workspaceRoot: 'workspace', process: { env: {} },
    runDurableFlywheelStartupCycle: async () => { dispatches++; return {}; },
  });
  const run = vm.runInContext(`(async () => { ${source.slice(a, b)} })`, context);
  await run();
  assert.equal(dispatches, 1);
  for (age of [null, undefined, -1, NaN, '0', 120001, 900000]) {
    await assert.rejects(run(), /MISSION_WORKER_CUSTODY_UNPROVEN/);
    assert.equal(dispatches, 1);
  }
});

test('the actual Core Flywheel entry cannot enter indirect repair while worker custody is held', async () => {
  const entryStart = source.indexOf('async function maybeStartPersistentFlywheel(');
  const entryEnd = source.indexOf('async function publish(', entryStart);
  assert.ok(entryStart >= 0 && entryEnd > entryStart);
  const context = vm.createContext({
    coreWorkerDependentWorkAllowed, lastFlywheelWakeReason: '',
    canonicalMissionWorkerEvidenceAllowsWork, workspaceRoot: 'workspace-fixture',
    readCanonicalMissionWorkerHeartbeatAgeMs: () => null,
    persistentFlywheelEventFingerprint: () => { throw Error('INDIRECT_REPAIR_ENTRY_MUST_NOT_RUN'); },
  });
  vm.runInContext(source.slice(entryStart, entryEnd), context);
  for (const age of [null, undefined, -1, NaN, 300001, 900000]) {
    const result = await context.maybeStartPersistentFlywheel(HEAD, false, workerState({ age }));
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'PERSISTENT_FLYWHEEL_WORKER_CUSTODY_HELD');
  }
  const staleEntry = await context.maybeStartPersistentFlywheel(HEAD, false, workerState({ age: 0 }));
  assert.equal(staleEntry.shouldRun, false, 'cached green cannot replace current validated evidence');
  assert.match(source, /maybeStartPersistentFlywheel\(sourceHead, state\.gamingActive, state\)/);
});

// Exercise the actual daemon repair routine with controlled observations and
// maintenance receipts, without loading its entrypoint or touching PC state.
test('each actual Octopus maintenance edge re-samples worker evidence before automatic custody admission', async () => {
  const maintenanceStart = source.indexOf('async function runBoundedOctopusMaintenance(');
  const maintenanceEnd = source.indexOf('async function runBoundedOctopusSelfHeal(', maintenanceStart);
  let age = 0, samples = 0, dispatches = 0;
  const context = vm.createContext({
    Object, projectStephanosCoreDaemonState, coreWorkerDependentWorkAllowed, unqualifiedCoreWindowsRepairV1,
    readCanonicalMissionWorkerHeartbeatAgeMs: ({ expectedSourceHead }) => { assert.equal(expectedSourceHead, HEAD); samples++; return age; },
    repoRoot: 'repo-fixture', workspaceRoot: 'workspace-fixture',
    buildStephanosExecutionSurfaceCatalogV1: () => ({}),
    buildStephanosExecutionCommandEnvelopeV1: input => input,
    STEPHANOS_EXECUTION_SURFACE: { SOVEREIGN_COMMANDER: 'SOVEREIGN_COMMANDER' },
    SOVEREIGN_COMMANDER_OPERATION: { MAINTENANCE_ACTION: 'MAINTENANCE_ACTION' },
    OCTOPUS_SELF_HEAL_RELATED_ISSUE: '#2961', PROOF_REF: 'proof-fixture', lastOctopusSelfHealAttemptCount: 1,
    executeSovereignCommanderCommandV1: async () => { dispatches++; return { ok: true }; },
  });
  vm.runInContext(source.slice(maintenanceStart, maintenanceEnd), context);
  for (const phase of ['goal-builder', 'control-plane', 'goal-builder-retry']) {
    age = 0;
    const fresh = await context.runBoundedOctopusMaintenance('fixed-fixture', HEAD, phase);
    assert.equal(fresh.ok, false);
    assert.equal(fresh.blocker, 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE');
    assert.equal(fresh.maintenanceReservationCreated, false);
    const count = dispatches;
    for (age of [null, undefined, -1, NaN, '0', 300001, 900000]) {
      const result = await context.runBoundedOctopusMaintenance('fixed-fixture', HEAD, phase);
      assert.equal(result.ok, false);
      assert.equal(result.attempted, false);
      assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
      assert.equal(dispatches, count);
    }
  }
  assert.equal(samples, 24); assert.equal(dispatches, 0);
});

function isolatedRepair({ verifiedAge = null, repairOk = true } = {}) {
  let clock = 1_000_000;
  const actions = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return clock; } },
    lastDependencySelfHealAtMs: null, lastDependencySelfHealAtUtc: '',
    lastDependencySelfHealVerdict: 'NOT_RUN', lastDependencySelfHealBlocker: '',
    lastDependencySelfHealAttemptCount: 0, lastDependencySelfHealProofHashes: [],
    canonicalMissionWorkerEvidenceAllowsWork,
    DEPENDENCY_SELF_HEAL_COOLDOWN_MS: 120_000,
    BATTLE_BRIDGE_SELF_HEAL_ACTION_ID: 'repair-battle-bridge',
    workerHeartbeatPath: 'test-worker-heartbeat',
    workspaceRoot: 'workspace-fixture',
    probe: async () => true,
    readCanonicalMissionWorkerHeartbeatAgeMs: () => verifiedAge,
    runBoundedDependencyMaintenance: async (actionId, head, missionId) => {
      actions.push({ actionId, head, missionId });
      return { ok: repairOk, proofHash: 'b'.repeat(64), blocker: repairOk ? '' : 'BACKEND_REPAIR_HELD' };
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context, actions,
    advance: ms => { clock += ms; },
    run: state => context.maybeRepairCoreDependencies(state, HEAD),
  };
}

function workerState({ gamingActive = false, age = null, backendHealthy = true } = {}) {
  return projectStephanosCoreDaemonState({
    sourceHead: HEAD, sovereignCommanderHealthy: true, backendHealthy,
    missionWorkerHeartbeatAgeMs: age, gamingActive,
  });
}

test('missing worker evidence reports degraded custody hold without starting a possible detached worker', async () => {
  const h = isolatedRepair();
  const state = workerState();
  const spine = projectStephanosControlPlaneSpine({ coreState: state });
  assert.equal(spine.awake, false);
  assert.equal(spine.repairRequired, true);
  assert.equal(spine.repairReason, 'MISSION_WORKER_UNHEALTHY');
  const result = await h.run(state);
  assert.equal(result.attempted, true);
  assert.equal(result.recovered, false);
  assert.equal(h.actions.length, 0);
  assert.equal(h.context.lastDependencySelfHealBlocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
  assert.equal(h.context.lastDependencySelfHealVerdict, 'MISSION_WORKER_SELF_HEAL_CUSTODY_HELD');
  const held = await h.run(state);
  assert.equal(held.attempted, false);
  assert.equal(h.actions.length, 0);
});

test('missing and measured-stale worker evidence share one no-start custody invariant', async () => {
  for (const age of [null, undefined, -1, NaN, 300001, 900000]) {
    const h = isolatedRepair({ verifiedAge: 1000 });
    const result = await h.run(workerState({ age }));
    assert.equal(result.attempted, true);
    assert.equal(result.recovered, false);
    assert.equal(h.actions.length, 0);
    assert.equal(h.context.lastDependencySelfHealBlocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
  }
});

test('independent backend repair is allowed but action receipt alone cannot prove recovery', async () => {
  const h = isolatedRepair();
  const result = await h.run(workerState({ age: 1000, backendHealthy: false }));
  assert.equal(result.attempted, true);
  assert.equal(result.recovered, false);
  assert.deepEqual(h.actions, [{
    actionId: 'repair-battle-bridge', head: HEAD,
    missionId: 'stephanos-core-backend-self-heal',
  }]);
  assert.equal(h.context.lastDependencySelfHealBlocker, 'MISSION_WORKER_UNHEALTHY_AFTER_REPAIR');
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_VERIFICATION_STILL_UNHEALTHY');
  assert.equal(h.context.lastDependencySelfHealProofHashes[0], 'b'.repeat(64));
});

test('independent backend repair recovers only after fresh dependency verification', async () => {
  const h = isolatedRepair({ verifiedAge: 1000 });
  const result = await h.run(workerState({ age: 1000, backendHealthy: false }));
  assert.equal(result.attempted, true);
  assert.equal(result.recovered, true);
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED');
  assert.equal(h.context.lastDependencySelfHealBlocker, '');
});

test('worker custody hold preserves completed independent backend repair evidence', async () => {
  const h = isolatedRepair();
  const result = await h.run(workerState({ age: 300001, backendHealthy: false }));
  assert.equal(result.recovered, false);
  assert.equal(h.actions.length, 1);
  assert.equal(h.actions[0].actionId, 'repair-battle-bridge');
  assert.equal(h.context.lastDependencySelfHealBlocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
  assert.equal(h.context.lastDependencySelfHealProofHashes[0], 'b'.repeat(64));
});

test('unchanged backend failure respects existing cooldown before retrying the same repair', async () => {
  const h = isolatedRepair({ repairOk: false });
  await h.run(workerState({ age: 1000, backendHealthy: false }));
  assert.equal(h.context.lastDependencySelfHealBlocker, 'BACKEND_REPAIR_HELD');
  const held = await h.run(workerState({ age: 1000, backendHealthy: false }));
  assert.equal(held.attempted, false);
  assert.equal(held.recovered, false);
  assert.equal(h.actions.length, 1);
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_COOLDOWN_ACTIVE');
  h.advance(120_000);
  await h.run(workerState({ age: 1000, backendHealthy: false }));
  assert.equal(h.actions.length, 2);
  assert.equal(h.context.lastDependencySelfHealAttemptCount, 2);
});

test('missing heartbeat remains degraded during gaming without starting a worker', async () => {
  const h = isolatedRepair();
  const state = workerState({ gamingActive: true });
  const result = await h.run(state);
  assert.equal(state.readiness, 'DEGRADED');
  assert.equal(state.computePosture, 'GAMING_PROTECTED');
  assert.equal(result.attempted, false);
  assert.equal(result.recovered, false);
  assert.equal(h.actions.length, 0);
  assert.equal(h.context.lastDependencySelfHealAttemptCount, 0);
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_GAMING_PROTECTED');
});
