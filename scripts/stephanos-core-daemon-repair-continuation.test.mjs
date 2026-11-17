import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createCoreRepairAttemptControllerV1 } from '../shared/agents/stephanosCoreRepairAttemptV1.mjs';
import { captureCoreRepairContinuationStatusV1, unknownCoreRepairRequestStatusV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { runDurableFlywheelStartupCycle } from '../shared/agents/durableFlywheelControllerVNext.mjs';
import { coreWorkerDependentWorkAllowed, projectStephanosCoreDaemonState } from '../shared/agents/stephanosCoreDaemonV1.mjs';
import { canonicalMissionWorkerEvidenceAllowsWork } from '../shared/agents/canonicalMissionWorkerEvidenceV1.mjs';
import { unqualifiedCoreWindowsRepairV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { projectStephanosCoreOnionContinuationV1 } from '../shared/agents/stephanosCoreOnionContinuationV1.mjs';
import * as flywheel from '../shared/agents/stephanosCorePersistentFlywheelV1.mjs';

const source = await readFile(new URL('./stephanos-core-daemon.mjs', import.meta.url), 'utf8');
const HEAD = 'a'.repeat(40), NOW = '2026-11-17T10:00:00.000Z';
const worker = Object.freeze({ missionWorkerHealthy: true, missionWorkerHeartbeatAgeMs: 0 });
const AFFECTED_PHASES = ['publishOutcomeOwnershipSeed', 'runRecurringCalibrationReadiness',
  'publishWorkspaceIntegritySeedPressure', 'reconcileLearningGoals', 'loadAuthoritativeProjection',
  'closeReadyGoal', 'finalizeTerminalLane', 'ensureBacklogMission', 'recoverOrphanedBacklogMission',
  'loadCapacityRoutingInput', 'resolveCapacityCandidates', 'readMissionRecord'];
function sourceChunk(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, 'production daemon source boundaries must exist');
  return source.slice(first, last);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
async function settled(predicate) {
  for (let turn = 0; turn < 40; turn++) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail('detached fixture work did not settle within bounded event-loop turns');
}

// The real durable controller is used with an inert owner and durable-storage
// seam. Its RESERVED state is never cleared by a response or by these tests.
async function retainedManager({ pending = false, prepared = false, original = {}, phase = null,
  observerSourceHead = HEAD, beforeStatusRead = null } = {}) {
  let disk = null, slot = pending ? { state: prepared ? 'PREPARED' : 'RESERVED', continuation: {
    schemaVersion: 'stephanos.core-repair-continuation.v1', requestId: 'core-existing-0001',
    missionId: 'stephanos-core-octopus-self-heal', relatedIssue: '#2961',
    actionId: 'repair-goal-builder-flow', sourceHead: HEAD, enrollmentId: 'd'.repeat(64), sequence: 1, previousRequestId: '',
    ...original,
  } } : null;
  if (slot && phase) disk = { schemaVersion: 'stephanos.core-repair-attempt.v1', observerSourceHead,
    stage: 'DISPATCH_FENCED', continuation: slot.continuation, phase,
    createdAtUtc: '2026-11-17T09:55:00.000Z', lastDeliveryAtUtc: '2026-11-17T09:55:00.000Z',
    deliveryCount: 1, terminalState: '', terminalProofHash: '' };
  let deliveries = 0, preparations = 0, newIdentities = 0, statusReads = 0;
  function status() {
    const terminal = slot?.state === 'NOT_STARTED';
    const raw = { ...unknownCoreRepairRequestStatusV1({ continuation: slot?.continuation || null,
      observedAtUtc: NOW, observerSourceHead }), ok: true, state: slot?.state || 'READY',
      historyAuthenticated: true, initialEpochProven: true, enrollmentId: 'd'.repeat(64),
      custodyReleased: !slot || terminal, currentAdmissionAvailable: !slot || terminal,
      nextSequence: terminal ? slot.continuation.sequence + 1 : slot ? null : 1,
      previousRequestId: terminal ? slot.continuation.requestId : '',
      terminalProofHash: terminal ? 'c'.repeat(64) : '',
      sameRequestDeliveryAllowed: slot?.state === 'PREPARED' && slot.continuation.sourceHead === observerSourceHead,
      blocker: slot?.state === 'RESERVED' ? 'CORE_REPAIR_NATIVE_TERMINAL_UNPROVEN'
        : slot?.state === 'PREPARED' && slot.continuation.sourceHead !== observerSourceHead ? 'CORE_REPAIR_SOURCE_ADVANCED' : '' };
    const captured = captureCoreRepairContinuationStatusV1(raw);
    assert(captured, 'inert owner must obey the actual canonical status protocol');
    return captured;
  }
  const manager = createCoreRepairAttemptControllerV1({ observerSourceHead, now: () => NOW,
    assertCoreOwner: async () => true, readOwnerStatus: async () => {
      statusReads++;
      if (beforeStatusRead) await beforeStatusRead();
      return status();
    },
    requestId: () => { newIdentities++; return 'core-new-0000001'; },
    readAttempt: async () => disk ? { ok: true, attempt: disk } : { ok: false, blocker: 'CORE_REPAIR_STATE_MISSING' },
    writeAttempt: async ({ attempt }) => { disk = attempt; return { ok: true }; },
    prepareOwner: async ({ continuation }) => {
      preparations++; slot = { state: continuation.sourceHead === observerSourceHead ? 'PREPARED' : 'NOT_STARTED', continuation };
      return status();
    },
  });
  await manager.restore();
  const dispatchOriginal = async continuation => {
    deliveries++; assert.deepEqual(continuation, slot.continuation);
    slot = { state: 'RESERVED', continuation }; throw new Error('response lost after reservation');
  };
  return { manager, disk: () => disk, counts: () => ({ deliveries, preparations }),
    statusReads: () => statusReads,
    newIdentities: () => newIdentities, dispatchOriginal,
    enterUnknownNativeResult: () => manager.execute({ actionId: 'repair-goal-builder-flow',
      missionId: 'stephanos-core-octopus-self-heal', phase: 'goal-builder', admit: async () => true,
      dispatch: dispatchOriginal,
    }),
  };
}

async function daemonFixture(t, options = {}) {
  const owner = await retainedManager({ pending: options.pending !== false, ...options.owner });
  const calls = [], receipts = [], heartbeats = [], cycleResults = [], unhandled = [];
  const onUnhandled = error => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));
  let fingerprint = 0;
  const forbidden = name => async () => { calls.push(name); throw new Error('Affected authority entered during unresolved maintenance: ' + name); };
  const machinery = {
    publishControllerHeartbeat: async value => { calls.push('heartbeat'); heartbeats.push(value); return { ok: true }; },
    promoteIncidentLessons: async input => {
      calls.push('learning'); assert.equal(input.maxPromotions, 2);
      if (options.learningThrows) throw new Error('optional lesson failure');
      return { ok: true, promotedLessonIds: ['original-repair-incident'] };
    },
    publishReceipt: async receipt => {
      calls.push('receipt'); receipts.push(receipt);
      if (options.receiptThrows) throw new Error('optional receipt failure');
      return { ok: true };
    },
    ...Object.fromEntries(AFFECTED_PHASES.map(name => [name, forbidden(name)])),
  };
  const context = vm.createContext({ Date, Object, String, Boolean, Promise,
    process: { env: {} }, repoRoot: '/inert/repository', workspaceRoot: '/inert/workspace',
    TARGET_MATERIAL_LANES: 15, FLYWHEEL_FALLBACK_MS: 60_000,
    OCTOPUS_SELF_HEAL_ACTION_ID: 'repair-goal-builder-flow', CONTROL_PLANE_SELF_HEAL_ACTION_ID: 'repair-control-plane',
    BATTLE_BRIDGE_SELF_HEAL_ACTION_ID: 'repair-battle-bridge', DEPENDENCY_SELF_HEAL_COOLDOWN_MS: 120_000,
    ...flywheel, projectStephanosCoreOnionContinuationV1,
    coreWorkerDependentWorkAllowed, canonicalMissionWorkerEvidenceAllowsWork, projectStephanosCoreDaemonState,
    unqualifiedCoreWindowsRepairV1,
    readCanonicalMissionWorkerHeartbeatAgeMs: () => options.workerAge === undefined ? 0 : options.workerAge,
    persistentFlywheelEventFingerprint: async () => 'fixture-event-' + ++fingerprint,
    assertCoreRepairOwner: async () => options.lockOwned !== false, gamingActive: async () => options.gaming === true,
    coreAffectedWorkAdmitted: async () => true, fixtureManager: owner.manager,
    inspectFixedRuntimeQualificationV1: () => ({ ok: options.nativeQualified !== false,
      sourceHead: options.owner?.observerSourceHead || HEAD, profiles: ['MAINTENANCE_GOAL_BUILDER_V1'] }),
    dispatchCoreMaintenance: owner.dispatchOriginal,
    runBattleBridgeGoalDiscoveryHeartbeat: async () => {
      calls.push('refill'); assert.equal(owner.manager.snapshot().stage, 'READY');
      return { ok: true, finalVerdict: 'FIXTURE_REFILL_NO_ACTION' };
    },
    maybeSelfHealOctopus: async () => {
      calls.push('self-heal');
      if (options.selfHeal) return options.selfHeal(owner);
      throw new Error('optional self-heal failure');
    },
    // Exercise the actual full controller. Only external machinery is inert;
    // entering any affected production phase produces an observable failure.
    runDurableFlywheelStartupCycle: async (_defaultMachinery, cycleOptions) => {
      const result = await runDurableFlywheelStartupCycle(machinery, cycleOptions);
      cycleResults.push(result); return result;
    },
    publishControllerLaneTruth: async () => {
      calls.push('lane-publication');
      if (options.laneThrows) throw new Error('optional lane publication failure');
      return { ok: true };
    },
    reconcileOnionContinuation: async () => {
      calls.push('onion');
      if (options.onionThrows) throw new Error('optional onion publication failure');
    },
    maybeRepairCoreDependencies: options.dependency || (async () => ({ attempted: false })),
  });
  // Run actual declarations and detached production bodies without loading the
  // daemon entrypoint, acquiring a process lock, or contacting a real owner.
  vm.runInContext([
    sourceChunk('let flywheelCycleRunning = false;', '\nasync function publishControllerLaneTruth('),
    sourceChunk('async function runCoreAffectedWork(', '\nasync function dispatchCoreMaintenance('),
    sourceChunk('function startOptionalDependencyRepair(', '\nasync function runBoundedOctopusMaintenance('),
    sourceChunk('async function maybeStartPersistentFlywheel(', '\nasync function publish('),
    ...(options.realDependency ? [
      sourceChunk('async function runBoundedDependencyMaintenance(', '\nasync function assertCoreRepairOwner('),
      sourceChunk('async function resumeOriginalCoreMaintenance(', '\nfunction startOptionalDependencyRepair('),
      sourceChunk('async function runBoundedOctopusMaintenance(', '\nasync function runBoundedOctopusSelfHeal('),
    ] : []),
    `coreRepairAttempts = fixtureManager;
    globalThis.readFixtureState = () => ({ flywheelCycleRunning, dependencyRepairRunning,
      flywheelCurrentStage, flywheelStageStartedAtUtc, lastFlywheelCycleFinishedAtUtc,
      lastFlywheelError, lastFlywheelSummary, lastOctopusSelfHealVerdict, lastOctopusSelfHealBlocker,
      lastDependencySelfHealVerdict, lastDependencySelfHealBlocker });`,
  ].join('\n'), context);
  return { owner, calls, receipts, heartbeats, cycleResults, unhandled, context,
    state: () => context.readFixtureState(), start: () => context.maybeStartPersistentFlywheel(HEAD, false, worker),
    finish: async () => { await settled(() => context.readFixtureState().flywheelCycleRunning === false); await nextTurn(); },
  };
}

for (const scenario of [
  { name: 'healthy', state: {}, verdict: 'CORE_DEPENDENCIES_HEALTHY' },
  { name: 'cooldown', state: { backendHealthy: false }, cooldown: true,
    verdict: 'CORE_DEPENDENCY_SELF_HEAL_COOLDOWN_ACTIVE' },
  { name: 'gaming', state: { backendHealthy: false, gamingActive: true },
    verdict: 'CORE_DEPENDENCY_SELF_HEAL_GAMING_PROTECTED' },
  { name: 'owner bootstrap unavailable', state: { sovereignCommanderHealthy: false },
    verdict: 'SOVEREIGN_COMMANDER_BOOTSTRAP_CONTINUITY_HELD' },
  { name: 'worker-only custody hold', state: { missionWorkerHealthy: false },
    verdict: 'MISSION_WORKER_SELF_HEAL_CUSTODY_HELD' },
]) {
  test('no-action dependency observation leaves material admission independent: ' + scenario.name, async t => {
    let paused = false, gate = deferred();
    const f = await daemonFixture(t, { pending: false, realDependency: true, selfHeal: async () => {},
      owner: { beforeStatusRead: () => paused ? gate.promise : undefined } });
    const sample = { ...worker, sovereignCommanderHealthy: true, backendHealthy: true,
      gamingActive: false, ...scenario.state };
    // A health-only probe does not acquire owner history or native admission.
    f.context.probe = async () => true;
    if (scenario.cooldown) vm.runInContext('lastDependencySelfHealAtMs = Date.now();', f.context);
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        gate = deferred(); paused = true;
        const before = f.owner.statusReads();
        f.context.startOptionalDependencyRepair(sample, HEAD);
        await settled(() => f.state().dependencyRepairRunning === false);
        if (cycle === 0) assert.equal(f.state().lastDependencySelfHealVerdict, scenario.verdict);
        assert.equal(f.owner.statusReads(), before, 'no-action eligibility never takes the repair mutex');
        assert.equal(f.owner.manager.snapshot().held, false);
        // This material wake has its own fresh healthy worker and resource
        // evidence. A prior no-action sample cannot replace that admission.
        assert.equal((await f.start()).shouldRun, true);
        await settled(() => f.owner.statusReads() === before + 1);
        assert.equal(f.state().flywheelCycleRunning, true, 'material wake waits for its own fresh original-owner read');
        assert.equal(f.calls.filter(value => value === 'refill').length, cycle);
        paused = false; gate.resolve(); await f.finish();
        assert.equal(f.calls.filter(value => value === 'refill').length, cycle + 1);
        assert.equal(f.owner.manager.snapshot().held, false);
      }
    } finally { paused = false; gate.resolve(); }
    assert.deepEqual(f.owner.counts(), { deliveries: 0, preparations: 0 });
    assert.equal(f.owner.newIdentities(), 0); assert.deepEqual(f.unhandled, []);
  });
}

test('healthy backend samples resume their original PREPARED backend action without replacing its identity or phase', async t => {
  const f = await daemonFixture(t, { realDependency: true, owner: { prepared: true, phase: 'backend', original: {
    actionId: 'repair-battle-bridge', missionId: 'stephanos-core-backend-self-heal',
  } } });
  const original = f.owner.disk(), candidate = f.owner.manager.pendingAttempt();
  assert(Object.isFrozen(candidate)); assert(Object.isFrozen(candidate.continuation));
  const result = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
    backendHealthy: true, gamingActive: false }, HEAD);
  assert.equal(result.attempted, true); assert.equal(result.recovered, false);
  assert.deepEqual(f.owner.counts(), { deliveries: 1, preparations: 1 }); assert.equal(f.owner.newIdentities(), 0);
  assert.deepEqual(f.owner.disk().continuation, original.continuation);
  assert.equal(f.owner.disk().phase, original.phase); assert.equal(f.owner.disk().createdAtUtc, original.createdAtUtc);
  assert.equal(f.owner.manager.snapshot().held, true); assert.deepEqual(f.unhandled, []);
});

test('original goal-builder PREPARED resumes on unchanged source even when fresh productivity no longer asks for self-heal', async t => {
  const f = await daemonFixture(t, { realDependency: true, owner: { prepared: true, phase: 'goal-builder-retry' } });
  const original = f.owner.disk();
  vm.runInContext('lastOctopusBuildSummary = Object.freeze({ octopusNeedsRepair: false });', f.context);
  const result = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
    backendHealthy: true, gamingActive: false }, HEAD);
  assert.equal(result.attempted, true); assert.equal(f.calls.includes('self-heal'), false);
  assert.deepEqual(f.owner.counts(), { deliveries: 1, preparations: 1 }); assert.equal(f.owner.newIdentities(), 0);
  assert.deepEqual(f.owner.disk().continuation, original.continuation);
  assert.equal(f.owner.disk().phase, 'goal-builder-retry'); assert.equal(f.owner.disk().createdAtUtc, original.createdAtUtc);
  const observedAgain = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
    backendHealthy: true, gamingActive: false }, HEAD);
  assert.equal(observedAgain.attempted, false); assert.equal(f.owner.counts().deliveries, 1);
});

test('retained unqualified control-plane preparation stays held under its exact original action', async t => {
  const f = await daemonFixture(t, { realDependency: true, owner: { prepared: true, phase: 'control-plane',
    original: { actionId: 'repair-control-plane' } } });
  const original = f.owner.disk();
  const result = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
    backendHealthy: true, gamingActive: false }, HEAD);
  assert.equal(result.attempted, false); assert.equal(result.blocker, 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE');
  assert.deepEqual(f.owner.counts(), { deliveries: 0, preparations: 0 }); assert.equal(f.owner.newIdentities(), 0);
  assert.deepEqual(f.owner.disk(), original); assert.equal(f.owner.manager.snapshot().held, true);
});

for (const guard of [{ gaming: true }, { workerAge: null }, { nativeQualified: false }, { lockOwned: false }]) {
  test('resumed original goal-builder uses current action guard: ' + Object.keys(guard)[0], async t => {
    const f = await daemonFixture(t, { realDependency: true, ...guard, owner: { prepared: true, phase: 'goal-builder' } });
    const original = f.owner.disk();
    const result = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
      backendHealthy: true, gamingActive: false }, HEAD);
    assert.equal(result.attempted, false); assert.equal(f.owner.counts().deliveries, 0);
    assert.equal(f.owner.newIdentities(), 0); assert.deepEqual(f.owner.disk().continuation, original.continuation);
    assert.equal(f.owner.manager.snapshot().held, true);
  });
}

test('stale original source reaches metadata-only retirement before healthy-state selection, without executable delivery', async t => {
  const nextHead = 'b'.repeat(40);
  const f = await daemonFixture(t, { realDependency: true, owner: { prepared: true, phase: 'goal-builder', observerSourceHead: nextHead } });
  const original = f.owner.disk();
  const result = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
    backendHealthy: true, gamingActive: false }, nextHead);
  assert.equal(result.attempted, false); assert.equal(f.owner.counts().deliveries, 0);
  assert.equal(f.owner.counts().preparations, 1); assert.equal(f.owner.newIdentities(), 0);
  assert.equal(f.owner.disk().stage, 'SETTLED'); assert.equal(f.owner.disk().terminalState, 'NOT_STARTED');
  assert.deepEqual(f.owner.disk().continuation, original.continuation); assert.equal(f.owner.manager.pendingAttempt(), null);
});

test('stale original RESERVED source remains held and is never routed through an executable wrapper', async t => {
  const nextHead = 'b'.repeat(40);
  const f = await daemonFixture(t, { realDependency: true, owner: { phase: 'goal-builder', observerSourceHead: nextHead } });
  const original = f.owner.disk();
  const result = await f.context.maybeRepairCoreDependencies({ ...worker, sovereignCommanderHealthy: true,
    backendHealthy: true, gamingActive: false }, nextHead);
  assert.equal(result.attempted, false); assert.equal(result.blocker, 'CORE_REPAIR_SOURCE_ADVANCED_ORIGINAL_RETAINED');
  assert.deepEqual(f.owner.counts(), { deliveries: 0, preparations: 0 }); assert.equal(f.owner.newIdentities(), 0);
  assert.deepEqual(f.owner.disk(), original); assert.equal(f.owner.manager.snapshot().held, true);
});

test('thrown optional self-heal preserves its real pending identity while bounded Flywheel learning and proof continue', async t => {
  const f = await daemonFixture(t, { pending: false, selfHeal: async owner => {
    const result = await owner.enterUnknownNativeResult(); assert.equal(result.attempted, true);
    throw new Error('optional repair code failed after owner response loss');
  } });
  assert.equal((await f.start()).shouldRun, true); await f.finish();
  assert.deepEqual(f.owner.counts(), { deliveries: 1, preparations: 1 });
  assert.equal(f.owner.disk().stage, 'RESULT_UNPROVEN');
  assert.equal(f.owner.disk().continuation.requestId, 'core-new-0000001');
  assert.equal(f.owner.manager.snapshot().held, true);
  assert.deepEqual(f.calls, ['refill', 'self-heal', 'heartbeat', 'learning', 'receipt', 'heartbeat', 'lane-publication', 'onion']);
  assert.equal(f.cycleResults[0].maintenanceContinuationHeld, true);
  assert.equal(f.cycleResults[0].allowWorkerTick, false); assert.equal(f.cycleResults[0].boundedMutationSteps, 0);
  assert.equal(f.receipts[0].workerActionGrantId, null); assert.equal(f.receipts[0].goalClosureState, null);
  assert.equal(f.state().lastOctopusSelfHealVerdict, 'OCTOPUS_SELF_HEAL_CONTINUATION_HELD');
  assert.equal(f.state().flywheelCurrentStage, 'IDLE'); assert.equal(f.state().flywheelStageStartedAtUtc, '');
  assert.equal(f.state().flywheelCycleRunning, false); assert(f.state().lastFlywheelCycleFinishedAtUtc);
  assert.deepEqual(f.unhandled, []);
});

test('pending detached self-heal leaves the caller responsive and enforces one Flywheel cycle until finally settles', async t => {
  const repair = deferred(); let selfHeals = 0;
  const f = await daemonFixture(t, { selfHeal: async () => { selfHeals++; await repair.promise; } });
  assert.equal((await f.start()).shouldRun, true);
  await settled(() => selfHeals === 1);
  const second = await f.start();
  assert.equal(second.shouldRun, false); assert.equal(second.reason, 'PERSISTENT_FLYWHEEL_SINGLE_FLIGHT_ACTIVE');
  assert.equal(f.state().flywheelCycleRunning, true); assert.equal(f.calls.includes('refill'), false);
  repair.resolve(); await f.finish();
  assert.equal((await f.start()).shouldRun, true); await f.finish();
  assert.equal(selfHeals, 2); assert.equal(f.calls.filter(value => value === 'learning').length, 2);
  assert.equal(f.calls.some(value => AFFECTED_PHASES.includes(value)), false);
  assert.equal(f.owner.manager.snapshot().held, true); assert.deepEqual(f.owner.counts(), { deliveries: 0, preparations: 0 });
  assert.deepEqual(f.unhandled, []);
});

for (const failure of [{ learningThrows: true }, { receiptThrows: true, onionThrows: true },
  { laneThrows: true, onionThrows: true }, { onionThrows: true }]) {
  test('optional publication failure stays contained and releases Flywheel single-flight: ' + Object.keys(failure).join(','), async t => {
    const f = await daemonFixture(t, failure);
    assert.equal((await f.start()).shouldRun, true); await f.finish();
    assert.equal(f.calls.filter(value => value === 'learning').length, 1);
    assert.equal(f.calls.includes('refill'), false);
    assert.equal(f.calls.some(value => AFFECTED_PHASES.includes(value)), false);
    assert.equal(f.state().flywheelCycleRunning, false); assert.equal(f.state().flywheelCurrentStage, 'IDLE');
    assert.equal(f.owner.manager.snapshot().held, true); assert.deepEqual(f.owner.counts(), { deliveries: 0, preparations: 0 });
    for (const receipt of f.receipts) {
      assert.equal(receipt.workerActionGrantId, null); assert.equal(receipt.boundedMutationSteps, 0);
    }
    assert.deepEqual(f.unhandled, []);
    assert.equal((await f.start()).shouldRun, true); await f.finish();
    assert.equal(f.calls.filter(value => value === 'learning').length, 2);
    assert.deepEqual(f.unhandled, []);
  });
}

for (const rejects of [false, true]) {
  test('optional dependency repair returns before pending owner IO and resets after ' + (rejects ? 'rejection' : 'success'), async t => {
    const dependency = deferred(); let dependencyCalls = 0, heartbeats = 0;
    const f = await daemonFixture(t, { dependency: async () => { dependencyCalls++; return dependency.promise; } });
    const result = f.context.startOptionalDependencyRepair({}, HEAD);
    assert.equal(result, undefined); assert.equal(f.state().dependencyRepairRunning, true);
    f.context.startOptionalDependencyRepair({}, HEAD); assert.equal(dependencyCalls, 1);
    await (async () => { heartbeats++; })();
    assert.equal(heartbeats, 1, 'the main heartbeat path can continue before optional owner IO settles');
    assert.equal(f.state().dependencyRepairRunning, true);
    if (rejects) dependency.reject(new Error('optional dependency owner unavailable'));
    else dependency.resolve({ attempted: false, recovered: false });
    await settled(() => f.state().dependencyRepairRunning === false); await nextTurn();
    if (rejects) {
      assert.equal(f.state().lastDependencySelfHealVerdict, 'CORE_DEPENDENCY_SELF_HEAL_CONTINUATION_HELD');
      assert.equal(f.state().lastDependencySelfHealBlocker, f.owner.manager.snapshot().blocker);
    }
    f.context.startOptionalDependencyRepair({}, HEAD);
    await settled(() => f.state().dependencyRepairRunning === false); await nextTurn();
    assert.equal(dependencyCalls, 2); assert.deepEqual(f.unhandled, []);
    assert.equal(f.owner.manager.snapshot().held, true); assert.deepEqual(f.owner.counts(), { deliveries: 0, preparations: 0 });
  });
}
