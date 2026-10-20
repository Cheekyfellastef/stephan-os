import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { projectStephanosCoreDaemonState } from './stephanosCoreDaemonV1.mjs';
import { projectStephanosControlPlaneSpine } from './stephanosControlPlaneSpineV1.mjs';

const HEAD = 'a'.repeat(40);
const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function maybeRepairCoreDependencies(');
const end = source.indexOf('async function runBoundedOctopusMaintenance(', start);
assert.ok(start >= 0 && end > start);

// Exercise the actual daemon repair routine with controlled observations and
// maintenance receipts, without loading its entrypoint or touching PC state.
function isolatedRepair({ verifiedAge = null, repairOk = true } = {}) {
  let clock = 1_000_000;
  const actions = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return clock; } },
    lastDependencySelfHealAtMs: null, lastDependencySelfHealAtUtc: '',
    lastDependencySelfHealVerdict: 'NOT_RUN', lastDependencySelfHealBlocker: '',
    lastDependencySelfHealAttemptCount: 0, lastDependencySelfHealProofHashes: [],
    DEPENDENCY_SELF_HEAL_COOLDOWN_MS: 120_000,
    BATTLE_BRIDGE_SELF_HEAL_ACTION_ID: 'repair-battle-bridge',
    MISSION_WORKER_START_ACTION_ID: 'start-mission-orchestrator-worker',
    workerHeartbeatPath: 'test-worker-heartbeat',
    probe: async () => true,
    fileAgeMs: async () => verifiedAge,
    runBoundedDependencyMaintenance: async (actionId, head, missionId) => {
      actions.push({ actionId, head, missionId });
      return { ok: repairOk, proofHash: 'b'.repeat(64), blocker: repairOk ? '' : 'WORKER_START_HELD' };
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context, actions,
    advance: ms => { clock += ms; },
    run: state => context.maybeRepairCoreDependencies(state, HEAD),
  };
}

function workerState({ gamingActive = false, age = null } = {}) {
  return projectStephanosCoreDaemonState({
    sourceHead: HEAD, sovereignCommanderHealthy: true, backendHealthy: true,
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

test('existing measured-stale worker repair still requires a newly observed heartbeat after its action', async () => {
  const h = isolatedRepair();
  const result = await h.run(workerState({ age: 300001 }));
  assert.equal(result.attempted, true);
  assert.equal(result.recovered, false);
  assert.deepEqual(h.actions, [{
    actionId: 'start-mission-orchestrator-worker', head: HEAD,
    missionId: 'stephanos-core-mission-worker-self-heal',
  }]);
  assert.equal(h.context.lastDependencySelfHealBlocker, 'MISSION_WORKER_UNHEALTHY_AFTER_REPAIR');
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_VERIFICATION_STILL_UNHEALTHY');
  assert.equal(h.context.lastDependencySelfHealProofHashes[0], 'b'.repeat(64));
});

test('worker repair becomes recovered only with a newly observed fresh heartbeat', async () => {
  const h = isolatedRepair({ verifiedAge: 1000 });
  const result = await h.run(workerState({ age: 300001 }));
  assert.equal(result.attempted, true);
  assert.equal(result.recovered, true);
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED');
  assert.equal(h.context.lastDependencySelfHealBlocker, '');
});

test('unchanged measured-stale heartbeat respects existing cooldown before retrying the same repair', async () => {
  const h = isolatedRepair({ repairOk: false });
  await h.run(workerState({ age: 300001 }));
  assert.equal(h.context.lastDependencySelfHealBlocker, 'WORKER_START_HELD');
  const held = await h.run(workerState({ age: 300001 }));
  assert.equal(held.attempted, false);
  assert.equal(held.recovered, false);
  assert.equal(h.actions.length, 1);
  assert.equal(h.context.lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_COOLDOWN_ACTIVE');
  h.advance(120_000);
  await h.run(workerState({ age: 300001 }));
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
