import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMissionWorkerHeartbeatRecord, projectMissionWorkerHeartbeat, resolveCanonicalMissionWorkerPaths } from './mission-orchestrator-worker-heartbeat.mjs';
import { readGoalBuilderSourceIdentity, readGoalBuilderWorkerHeartbeatAgeMs, runSovereignCommanderGoalBuilderRepair } from './sovereign-commander-goal-builder-repair.mjs';
import { runBattleBridgeGoalDiscoveryHeartbeat } from './battle-bridge-goal-discovery-heartbeat.mjs';
import { projectStephanosCoreDaemonState, coreWorkerDependentWorkAllowed } from '../shared/agents/stephanosCoreDaemonV1.mjs';
import vm from 'node:vm';

const HEAD = 'a'.repeat(40), nowMs = Date.parse('2026-10-21T17:00:00Z');
const PENDING_HANDOFF = 'MISSION_WORKER_EXTERNAL_HANDOFF_PENDING';
async function fixture(action) {
  const home = mkdtempSync(join(tmpdir(), 'sovereign-worker-evidence-'));
  const env = { USERPROFILE: home }, paths = resolveCanonicalMissionWorkerPaths({ env });
  mkdirSync(dirname(paths.heartbeatPath), { recursive: true });
  const record = createMissionWorkerHeartbeatRecord({ timestampUtc: '2026-10-21T16:59:59Z',
    repositoryRoot: paths.repositoryRoot, branch: 'main', headSha: HEAD, pid: 123,
    launchIdentityId: 'b'.repeat(64), workerStartedAtUtc: '2026-10-21T16:00:00Z' });
  const read = () => readGoalBuilderWorkerHeartbeatAgeMs({ env, nowMs,
    readSourceIdentity: () => ({ ok: true, branch: 'main', sourceHead: HEAD }) });
  try { await action({ env, paths, record, read }); }
  finally { rmSync(home, { recursive: true, force: true }); }
}

function coreSampler(paths, read) {
  const source = readFileSync(new URL('./stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function sample('), end = source.indexOf('\nconst sourceHead = currentHead()', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ bootstrapSovereignParentProofAvailable: false,
    probeSovereignCommanderRuntimeCompatibility: async () => ({ ok: true }),
    probe: async () => true, gamingActive: async () => false, workspaceRoot: paths.workspaceRoot,
    readCanonicalMissionWorkerHeartbeatAgeMs: read, projectStephanosCoreDaemonState });
  vm.runInContext(source.slice(start, end), context);
  return context.sample;
}

function refillWithWorkerEvidence(paths, read, overrides = {}) {
  return runBattleBridgeGoalDiscoveryHeartbeat({
    paths: { repoRoot: paths.repositoryRoot, workspaceRoot: paths.workspaceRoot },
    readWorkerHeartbeatAgeMs: read, maxWorkConservingAttempts: 1, now: new Date(nowMs),
    refreshGithubLifeboat: async () => ({ ok: true }), refreshGithubLifeboatClaimAck: async () => ({ ok: true }),
    refreshLifeboatCapacity: async () => ({ ok: true }), refreshCommanderCapacity: async () => ({ ok: true }),
    refreshSovereignCapacity: async () => ({ ok: true }), refreshOpenClawCapacity: async () => ({ ok: true }),
    readProcessingPickupMissionIdsFn: async () => [], publishTrack: async () => ({ ok: true }),
    buildClaimedGoal: async () => ({ processed: false, success: false, reason: 'queue-empty' }),
    ...overrides,
  });
}

test('actual bounded reader admits a valid canonical worker record, independent of filesystem mtime', () => fixture(({ paths, record, read }) => {
  writeFileSync(paths.heartbeatPath, JSON.stringify(record));
  utimesSync(paths.heartbeatPath, new Date(0), new Date(0));
  assert.equal(read(), 1000);
}));

test('pending handoff keeps the actual reader, Core, repair and refill ready without proving material progress', () => fixture(async ({ paths, record, read }) => {
  const pending = { ...record, lastTickVerdict: PENDING_HANDOFF };
  writeFileSync(paths.heartbeatPath, JSON.stringify(pending));
  assert.equal(read(), 1000, 'authenticated queued work must not strand its consumer');
  const projection = projectMissionWorkerHeartbeat(pending, { nowUtc: new Date(nowMs).toISOString(),
    expectedRepositoryRoot: paths.repositoryRoot, expectedHeadSha: HEAD });
  assert.equal(projection.lastTickConsumptionReady, true);
  assert.equal(projection.lastTickAffirmative, false);
  assert.equal(pending.sourceMutationAllowed, false); assert.equal(pending.arbitraryShellAllowed, false);
  const state = await coreSampler(paths, read)(HEAD);
  assert.equal(state.missionWorkerHealthy, true);
  assert.equal(coreWorkerDependentWorkAllowed(state), true);

  const steps = [];
  const repair = runSovereignCommanderGoalBuilderRepair({ readWorkerHeartbeatAgeMs: read,
    runStep(step) { steps.push(step.id); return { ok: false, status: 2 }; } });
  assert.deepEqual(steps, ['fleet-goal-supervisor', 'controller-lane-status', 'goal-discovery-heartbeat']);
  assert.equal(repair.blocker, 'GOAL_DISCOVERY_HEARTBEAT_FAILED');
  assert.equal(repair.mergeAuthority, false);

  const missionId = 'critical-2961-pending-handoff'; let conveyors = 0, consumers = 0;
  const refill = await refillWithWorkerEvidence(paths, read, {
    conveyor: async () => { conveyors++; return { ok: true,
      elasticAdmission: { activeMissions: [{ missionId, dispatch: { status: 'queued' } }], runnableMissions: [] },
      elasticIgnition: { availableSlots: 1, dispatchCount: 0, dispatched: [], held: [] } }; },
    buildClaimedGoal: async () => { consumers++; return { processed: false, success: false, reason: 'queue-empty' }; },
  });
  assert.equal(conveyors, 1); assert.equal(consumers, 1);
  assert.equal(refill.materialActionsSucceeded, 0); assert.equal(refill.materialProgress, false);
  assert.deepEqual(refill.successfulMissionIds, []);
  assert.deepEqual(refill.pendingExternalPickupMissionIds, [missionId]);
  assert.equal(refill.noRunnableSourceWorkProven, false);
  assert.equal(refill.controllerContinuity, 'CONTINUE_NEXT_SWEEP');
  assert.equal(refill.mergeAuthority, false); assert.equal(refill.runtimeMutationAuthority, false);
  assert.equal(refill.arbitraryShellAllowed, false);
}));

test('fresh malformed, oversized, unrelated, stale, failed and invalid-launch records cannot start even the supervisor', () => fixture(({ paths, record, read }) => {
  for (const lastTickVerdict of ['MISSION_WORKER_RUNNING', PENDING_HANDOFF]) {
    const attacks = ['{bad', ' '.repeat(16385), JSON.stringify(null), JSON.stringify([]),
    ...[
      { schemaVersion: 'other' }, { repositoryRoot: join(paths.repositoryRoot, 'other') },
      { headSha: 'c'.repeat(40) }, { branch: 'other' }, { taskName: 'other' }, { pid: 0 },
      { launchIdentityId: 'wrong' }, { workerStartedAtUtc: record.timestampUtc },
      { timestampUtc: '2026-10-21T16:00:01Z' }, { timestampUtc: '2026-10-21T17:00:01Z' },
      { lastTickVerdict: 'MISSION_WORKER_TICK_FAILED' }, { arbitraryShellAllowed: true }, { sourceMutationAllowed: true },
    ].map(change => JSON.stringify({ ...record, lastTickVerdict, ...change }))];
    for (const bytes of attacks) {
      writeFileSync(paths.heartbeatPath, bytes);
      assert.equal(read(), null);
      const result = runSovereignCommanderGoalBuilderRepair({ readWorkerHeartbeatAgeMs: read,
        runStep() { assert.fail('unqualified record reached a repair step'); } });
      assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
    }
  }
  rmSync(paths.heartbeatPath);
  assert.equal(read(), null, 'missing heartbeat grants no readiness');
  mkdirSync(paths.heartbeatPath);
  assert.equal(read(), null, 'fresh directory is not a worker heartbeat');
}));

test('recognized degraded ticks cannot acquire consumption readiness through caller-supplied fields', () => fixture(({ paths, record, read }) => {
  for (const lastTickVerdict of ['MISSION_WORKER_STALLED_MISSION_SIDELINED',
    'CONTROLLER_EXECUTION_DEFECT_NO_MATERIAL_PROGRESS', 'CONTROLLER_EXECUTION_DEFECT_NO_WORKER_GRANT',
    'MISSION_WORKER_TICK_FAILED', 'MISSION_WORKER_COMPLETION_GUARDIAN_FAILED', 'UNRECOGNIZED']) {
    writeFileSync(paths.heartbeatPath, JSON.stringify({ ...record, lastTickVerdict,
      lastTickConsumptionReady: true, lastTickAffirmative: true }));
    assert.equal(read(), null, lastTickVerdict);
    const result = runSovereignCommanderGoalBuilderRepair({ readWorkerHeartbeatAgeMs: read,
      runStep() { assert.fail('degraded tick reached a repair step'); } });
    assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
  }
}));

test('a configured nondefault tree stays held even when both trees contain fresh valid-looking records', () => fixture(({ env, paths, record, read }) => {
  writeFileSync(paths.heartbeatPath, JSON.stringify(record));
  env.STEPHANOS_SHARED_AGENT_WORKSPACE = join(env.USERPROFILE, 'custom');
  const customHeartbeat = join(env.STEPHANOS_SHARED_AGENT_WORKSPACE, 'status', 'mission-orchestrator-worker-heartbeat.json');
  mkdirSync(dirname(customHeartbeat), { recursive: true });
  writeFileSync(customHeartbeat, JSON.stringify(record));
  assert.equal(read(), null);
}));

test('each mutating step rechecks evidence after the preceding awaited/process work', () => {
  const calls = []; let reads = 0;
  const result = runSovereignCommanderGoalBuilderRepair({
    readWorkerHeartbeatAgeMs: () => ++reads === 1 ? 1000 : null,
    runStep(step) { calls.push(step.id); return { ok: false, status: 2 }; },
  });
  assert.deepEqual(calls, ['fleet-goal-supervisor', 'controller-lane-status']);
  assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
});

test('actual Core sampler and direct refill share validated bytes; malformed fresh records cannot open either path', () => fixture(async ({ paths, record, read }) => {
  const sample = coreSampler(paths, read);
  for (const bytes of ['{bad', JSON.stringify({ ...record, headSha: 'c'.repeat(40) }), JSON.stringify({ ...record, taskName: 'other' })]) {
    writeFileSync(paths.heartbeatPath, bytes);
    const state = await sample(HEAD);
    assert.equal(state.missionWorkerHealthy, false);
    assert.equal(coreWorkerDependentWorkAllowed(state), false);
    const refill = await runBattleBridgeGoalDiscoveryHeartbeat({ paths: { repoRoot: paths.repositoryRoot, workspaceRoot: paths.workspaceRoot },
      readWorkerHeartbeatAgeMs: read,
      conveyor() { assert.fail('direct refill reached conveyor with invalid worker'); },
      refreshGithubLifeboat() { assert.fail('invalid worker reached any refill work'); },
      buildClaimedGoal() { assert.fail('invalid worker reached source build'); },
    });
    assert.equal(refill.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
  }
  rmSync(paths.heartbeatPath); mkdirSync(paths.heartbeatPath);
  assert.equal((await sample(HEAD)).missionWorkerHealthy, false);
}));

test('pending handoff evidence changed during awaited capacity or conveyor work cannot reach source execution', () => fixture(async ({ paths, record, read }) => {
  for (const boundary of ['capacity', 'conveyor']) {
    for (const changed of [{ timestampUtc: '2026-10-21T16:00:01Z' }, { headSha: 'c'.repeat(40) }]) {
      const pending = { ...record, lastTickVerdict: PENDING_HANDOFF };
      writeFileSync(paths.heartbeatPath, JSON.stringify(pending));
      let conveyors = 0, builds = 0;
      const invalidate = async at => {
        await Promise.resolve();
        if (boundary === at) writeFileSync(paths.heartbeatPath, JSON.stringify({ ...pending, ...changed }));
      };
      const result = await refillWithWorkerEvidence(paths, read, {
        refreshGithubLifeboat: async () => { await invalidate('capacity'); return { ok: true }; },
        conveyor: async () => { conveyors++; await invalidate('conveyor'); return { ok: true }; },
        buildClaimedGoal() { builds++; assert.fail('changed pending-handoff evidence reached source execution'); },
      });
      assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
      assert.equal(conveyors, boundary === 'capacity' ? 0 : 1); assert.equal(builds, 0);
      assert.equal(result.materialActionsSucceeded, 0);
    }
  }
}));

test('actual direct refill revalidates after awaited capacity and conveyor work before source building', async () => {
  for (const expiry of ['capacity', 'conveyor']) {
    let valid = true, conveyors = 0, builds = 0;
    const result = await runBattleBridgeGoalDiscoveryHeartbeat({
      readWorkerHeartbeatAgeMs: () => valid ? 1000 : null,
      refreshGithubLifeboat: async () => { if (expiry === 'capacity') valid = false; return { ok: true }; },
      refreshGithubLifeboatClaimAck: async () => ({ ok: true }),
      refreshLifeboatCapacity: async () => ({ ok: true }), refreshCommanderCapacity: async () => ({ ok: true }),
      refreshSovereignCapacity: async () => ({ ok: true }), refreshOpenClawCapacity: async () => ({ ok: true }),
      conveyor: async () => { conveyors++; valid = false; return { ok: true }; },
      readProcessingPickupMissionIdsFn: async () => [],
      buildClaimedGoal() { builds++; assert.fail('expired evidence reached source building'); },
    });
    assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
    assert.equal(conveyors, expiry === 'capacity' ? 0 : 1); assert.equal(builds, 0);
  }
});

test('source identity observation reuses fixed Git custody and strips inherited execution settings', () => {
  const calls = [];
  const result = readGoalBuilderSourceIdentity({ env: { ...process.env, GIT_DIR: 'foreign', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'hostile', NODE_OPTIONS: '--require hostile' },
    spawnSyncFn(executable, args, options) {
      calls.push(args);
      assert.match(executable, /(?:Program Files[\\/]Git[\\/]cmd[\\/]git\.exe|\/usr\/bin\/git)$/);
      assert.ok(args.includes('core.fsmonitor=false'));
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.notEqual(options.env.GIT_DIR, 'foreign'); assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(Object.values(options.env).includes('hostile'), false);
      return { status: 0, stdout: args.includes('symbolic-ref') ? 'main\n' : HEAD + '\n' };
    },
  });
  assert.deepEqual(result, { ok: true, sourceHead: HEAD, branch: 'main' });
  assert.equal(calls.length, 2);
});

test('production freshness and future-time checks use the clock after blocking source identity reads', () => fixture(({ env, paths, record }) => {
  const realNow = Date.now;
  try {
    for (const lastTickVerdict of ['MISSION_WORKER_RUNNING', PENDING_HANDOFF]) {
      for (const [initialAge, identityDelay, expectedAge] of [
        [119850, 100, 119950], [119950, 150, null], [120001, 0, null],
        [-50, 150, 100], [-200, 100, null],
      ]) {
        let clock = nowMs; let identityFinished = false; const samples = [];
        writeFileSync(paths.heartbeatPath, JSON.stringify({ ...record, lastTickVerdict,
          timestampUtc: new Date(nowMs - initialAge).toISOString() }));
        Date.now = () => { samples.push(identityFinished); return clock; };
        const age = readGoalBuilderWorkerHeartbeatAgeMs({ env,
          readSourceIdentity: () => {
            clock += identityDelay; identityFinished = true;
            return { ok: true, branch: 'main', sourceHead: HEAD };
          },
        });
        assert.equal(age, expectedAge, `${lastTickVerdict}: age=${initialAge}, identityDelay=${identityDelay}`);
        assert.deepEqual(samples, [true], 'production clock must not be sampled before source identity finishes');
      }
    }
  } finally { Date.now = realNow; }
}));
