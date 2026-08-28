import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MISSION_WORKER_LOG_MAX_BYTES,
  createMissionWorkerRepositoryLogProjection,
  createMissionWorkerControllerLogProjection,
  createMissionWorkerTickLogProjection,
  inspectMissionWorkerRepositoryIdentity,
  missionWorkerTickMadeProgress,
  MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE,
  runSupervisedMissionWorker,
} from './mission-orchestrator-worker-supervised.mjs';

function sink() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

function timerHarness() {
  let callback = null;
  let cleared = false;
  return {
    setIntervalFn(fn) { callback = fn; return 17; },
    clearIntervalFn(id) { assert.equal(id, 17); cleared = true; },
    fire() { assert.ok(callback); callback(); },
    wasCleared: () => cleared,
  };
}

const actionGrant = {
  schemaVersion: 'stephanos.mission-worker-action-grant.v1',
  missionId: 'critical-supervisor-test',
  actionId: 'critical-supervisor-test-r1-action',
  adapter: 'codex',
  boundedActionCount: 1,
};
const allowWorkerTick = async () => ({
  status: 'ACTIVE',
  allowWorkerTick: true,
  workerActionGrant: actionGrant,
});
const bootstrapMailbox = async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' });
const canonicalIdentity = async ({ env }) => env.STEPHANOS_MISSION_WORKER_HEAD_SHA
  ? ({
      valid: true,
      canonical: true,
      branch: 'main',
      headSha: env.STEPHANOS_MISSION_WORKER_HEAD_SHA,
      sourceClean: true,
      worktreeClean: true,
      runtimeDirtCount: 0,
      blocker: '',
    })
  : ({
      valid: false,
      canonical: false,
      branch: '',
      headSha: '',
      sourceClean: false,
      worktreeClean: false,
      runtimeDirtCount: 0,
      blocker: 'MISSION_WORKER_LAUNCH_IDENTITY_INVALID',
    });

test('supervised worker writes running and final heartbeat around a successful tick', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const timer = timerHarness();
  let tickOptions = null;
  const env = {
    STEPHANOS_MISSION_WORKER_LAUNCH_ID: 'b'.repeat(64),
    STEPHANOS_MISSION_WORKER_LAUNCH_RECEIPT_PATH: 'C:\\bounded\\launch-receipt.json',
    STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40),
  };
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env,
    stdout: output.stream,
    stderr: errors.stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: allowWorkerTick,
    runTick: async (options) => {
      tickOptions = options;
      return { publish: { published: true } };
    },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(heartbeats.map(({ lastTickVerdict }) => lastTickVerdict), [
    'MISSION_WORKER_TICK_RUNNING',
    'MISSION_WORKER_TICK_PASS',
  ]);
  assert.ok(heartbeats.every((heartbeat) => heartbeat.env === env));
  assert.equal(timer.wasCleared(), true);
  assert.deepEqual(tickOptions.actionGrant, actionGrant);
  assert.match(output.read(), /"event":"worker-tick"/);
  assert.match(output.read(), /"publishOk":true/);
  assert.equal(errors.read(), '');
});

test('supervised worker refreshes heartbeat while a long tick is still running', async () => {
  const heartbeats = [];
  const timer = timerHarness();
  let releaseTick;
  const tickGate = new Promise((resolve) => { releaseTick = resolve; });
  let tickStarted;
  const started = new Promise((resolve) => { tickStarted = resolve; });

  const workerPromise = runSupervisedMissionWorker({
    argv: ['--once'],
    env: {
      STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40),
      STEPHANOS_MISSION_WORKER_HEARTBEAT_INTERVAL_MS: '1000',
    },
    stdout: sink().stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: allowWorkerTick,
    runTick: async () => {
      tickStarted();
      await tickGate;
      return {};
    },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });

  await started;
  timer.fire();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(heartbeats.map(({ lastTickVerdict }) => lastTickVerdict), [
    'MISSION_WORKER_TICK_RUNNING',
    'MISSION_WORKER_TICK_RUNNING',
  ]);

  releaseTick();
  assert.equal(await workerPromise, 0);
  assert.equal(heartbeats.at(-1).lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(timer.wasCleared(), true);
});

test('supervised worker records failed tick heartbeat and exits non-zero in once mode', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const timer = timerHarness();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40) },
    stdout: output.stream,
    stderr: errors.stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: allowWorkerTick,
    runTick: async () => { throw new Error('tick failed'); },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(heartbeats.map(({ lastTickVerdict }) => lastTickVerdict), [
    'MISSION_WORKER_TICK_RUNNING',
    'MISSION_WORKER_TICK_FAILED',
  ]);
  assert.match(errors.read(), /MISSION_WORKER_TICK_FAILED/);
});

test('heartbeat write failure is visible and non-zero in once mode', async () => {
  const errors = sink();
  const timer = timerHarness();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40) },
    stdout: sink().stream,
    stderr: errors.stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: allowWorkerTick,
    runTick: async () => ({}),
    writeHeartbeat: async () => { throw new Error('write failed'); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 1);
  assert.match(errors.read(), /MISSION_WORKER_HEARTBEAT_WRITE_FAILED/);
});

test('supervised worker gates source work through the durable controller', async () => {
  const output = sink();
  let workerTicks = 0;
  let observedOptions = null;
  const head = 'a'.repeat(40);
  const publisherPublicKeyPath = 'C:\\MissionRunner\\keys\\stephanos-github-authorization-public.pem';
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {
      STEPHANOS_MISSION_WORKER_HEAD_SHA: head,
      STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH: publisherPublicKeyPath,
    },
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: async (_machinery, options) => {
      observedOptions = options;
      return { status: 'HOLD', allowWorkerTick: false, blockers: ['authority-held'] };
    },
    runTick: async () => { workerTicks += 1; return {}; },
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
  });
  assert.equal(exitCode, 0);
  assert.equal(workerTicks, 0);
  assert.equal(observedOptions.sourceRevision, head);
  assert.equal(observedOptions.env.STEPHANOS_MISSION_WORKER_HEAD_SHA, head);
  assert.equal(observedOptions.env.STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH, publisherPublicKeyPath);
  assert.match(output.read(), /"authority-held"/);
});

test('worker logs only bounded authority-relevant controller and tick truth', () => {
  const huge = 'x'.repeat(2_000_000);
  const controller = createMissionWorkerControllerLogProjection({
    status: 'HOLD',
    action: 'HOLD',
    finalVerdict: 'PROGRAMME_HOLD',
    allowWorkerTick: false,
    blockers: ['capacity-unavailable'],
    projection: { huge },
    actionResult: { huge },
  }, '2026-08-26T02:20:00.000Z');
  const tick = createMissionWorkerTickLogProjection({
    status: 'DONE',
    finalVerdict: 'MISSION_WORKER_DONE',
    publish: { published: true, huge },
    evidence: { huge },
  }, '2026-08-26T02:20:01.000Z');
  assert.equal(JSON.stringify(controller).length < 1_000, true);
  assert.equal(JSON.stringify(tick).length < 1_000, true);
  assert.equal(JSON.stringify(controller).includes(huge), false);
  assert.equal(JSON.stringify(tick).includes(huge), false);
  assert.equal(controller.blockers[0], 'capacity-unavailable');
  assert.equal(tick.publishOk, true);
});

test('repository identity reader brackets canonical runtime dirt with stable exact-head observations', () => {
  const head = 'a'.repeat(40);
  const calls = [];
  const runtimeDirt = [
    ' D apps/stephanos/dist/assets/index-old.js',
    ' M apps/stephanos/dist/index.html',
    ' M apps/stephanos/dist/stephanos-build.json',
    ' M stephanos-server/data/memory/durable-memory.json',
    '?? apps/stephanos/dist/assets/index-new.js',
    '?? memory/.dreams/events.jsonl',
    '?? memory/.dreams/session-ingestion.json',
    '?? memory/dreaming/deep/2026-08-27.md',
    '?? memory/dreaming/light/2026-08-27.md',
    '?? memory/dreaming/rem/2026-08-27.md',
  ].join('\n');
  const result = inspectMissionWorkerRepositoryIdentity({
    env: {
      STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
      STEPHANOS_MISSION_WORKER_HEAD_SHA: head,
    },
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      const isDirtRead = args.includes('--porcelain=v1');
      return {
        status: 0,
        signal: null,
        stdout: isDirtRead ? `${runtimeDirt}\n` : `# branch.oid ${head}\n# branch.head main\n`,
        stderr: '',
      };
    },
  });
  assert.equal(result.canonical, true);
  assert.equal(result.sourceClean, true);
  assert.equal(result.worktreeClean, false);
  assert.equal(result.runtimeDirtCount, 10);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.match(call.executable, /Git\\cmd\\git\.exe$/);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.maxBuffer, 64 * 1024);
  }
  assert.deepEqual(calls[0].args.slice(2), ['status', '--porcelain=v2', '--branch', '--untracked-files=no']);
  assert.deepEqual(calls[1].args.slice(2), ['status', '--porcelain=v1', '--untracked-files=all']);
  assert.deepEqual(calls[2].args, calls[0].args);
});

test('repository identity reader keeps real source dirt blocking even when canonical main advanced', () => {
  const head = 'a'.repeat(40);
  const advancedHead = 'b'.repeat(40);
  const result = inspectMissionWorkerRepositoryIdentity({
    env: {
      STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
      STEPHANOS_MISSION_WORKER_HEAD_SHA: head,
    },
    spawnSyncFn: (_executable, args) => ({
      status: 0,
      signal: null,
      stdout: args.includes('--porcelain=v1')
        ? ' M scripts/mission-orchestrator-worker-supervised.mjs\n M apps/stephanos/dist/index.html\n'
        : `# branch.oid ${advancedHead}\n# branch.head main\n`,
      stderr: '',
    }),
  });
  assert.equal(result.valid, true);
  assert.equal(result.canonical, false);
  assert.equal(result.sourceClean, false);
  assert.equal(result.worktreeClean, false);
  assert.equal(result.runtimeDirtCount, 1);
  assert.equal(result.blocker, 'MISSION_WORKER_CANONICAL_SOURCE_DIRTY');
  const projection = createMissionWorkerRepositoryLogProjection(result, '2026-08-26T12:00:00.000Z');
  assert.equal(JSON.stringify(projection).length < 1_000, true);
  assert.equal(JSON.stringify(projection).includes('mission-orchestrator-worker-supervised.mjs'), false);
});

test('repository identity reader rejects ambiguous and accessor-shaped process evidence without invoking it', () => {
  const head = 'a'.repeat(40);
  const env = {
    STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    STEPHANOS_MISSION_WORKER_HEAD_SHA: head,
  };
  const ambiguous = inspectMissionWorkerRepositoryIdentity({
    env,
    spawnSyncFn: () => ({
      status: 0,
      signal: null,
      stdout: `# branch.oid ${head}\n# branch.oid ${head}\n# branch.head main\n`,
    }),
  });
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.blocker, 'MISSION_WORKER_REPOSITORY_IDENTITY_AMBIGUOUS');

  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'status', { enumerable: true, get() { invoked = true; throw new Error('must not run'); } });
  const rejected = inspectMissionWorkerRepositoryIdentity({ env, spawnSyncFn: () => hostile });
  assert.equal(invoked, false);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.blocker, 'MISSION_WORKER_REPOSITORY_IDENTITY_READ_FAILED');
});

test('repository identity reader rejects head movement during its dirt observation', () => {
  const expectedHead = 'a'.repeat(40);
  let call = 0;
  const result = inspectMissionWorkerRepositoryIdentity({
    env: {
      STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
      STEPHANOS_MISSION_WORKER_HEAD_SHA: expectedHead,
    },
    spawnSyncFn: (_executable, args) => {
      call += 1;
      return {
        status: 0,
        signal: null,
        stdout: args.includes('--porcelain=v1')
          ? ''
          : `# branch.oid ${call === 1 ? expectedHead : 'b'.repeat(40)}\n# branch.head main\n`,
      };
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.blocker, 'MISSION_WORKER_REPOSITORY_IDENTITY_CHANGED_DURING_READ');
});

test('worker waits safely through branch drift then exits once for canonical reload', async () => {
  const head = 'a'.repeat(40);
  let identityReads = 0;
  let controllerCycles = 0;
  const heartbeats = [];
  const output = sink();
  const errors = sink();
  const exitCode = await runSupervisedMissionWorker({
    argv: [],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    stdout: output.stream,
    stderr: errors.stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: async () => {
      identityReads += 1;
      if (identityReads === 1) return { valid: true, canonical: false, branch: 'codex/repair', headSha: 'b'.repeat(40), sourceClean: false, worktreeClean: false, runtimeDirtCount: 0, blocker: 'CANONICAL_REPOSITORY_BRANCH_NOT_MAIN' };
      return { valid: true, canonical: true, branch: 'main', headSha: head, sourceClean: true, worktreeClean: true, runtimeDirtCount: 0, blocker: '' };
    },
    runControllerCycle: async () => { controllerCycles += 1; return { status: 'HOLD', allowWorkerTick: false }; },
    runTick: async () => assert.fail('worker tick must remain held'),
    writeHeartbeat: async (heartbeat) => { heartbeats.push(heartbeat); },
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    sleep: async () => {},
  });
  assert.equal(exitCode, MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE);
  assert.equal(controllerCycles, 0);
  assert.equal(heartbeats.length, 0);
  assert.match(output.read(), /CANONICAL_REPOSITORY_BRANCH_NOT_MAIN/);
  assert.match(output.read(), /"reloadRequired":true/);
  assert.match(errors.read(), /MISSION_WORKER_CANONICAL_RELOAD_REQUIRED/);
});

test('worker exits before controller execution when canonical main advances through approved runtime dirt', async () => {
  let controllerCycles = 0;
  const output = sink();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40) },
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: async () => ({ valid: true, canonical: false, branch: 'main', headSha: 'b'.repeat(40), sourceClean: true, worktreeClean: false, runtimeDirtCount: 6, blocker: 'MISSION_WORKER_CANONICAL_HEAD_CHANGED' }),
    runControllerCycle: async () => { controllerCycles += 1; return { status: 'HOLD', allowWorkerTick: false }; },
    runTick: async () => assert.fail('worker tick must not run'),
    writeHeartbeat: async () => {},
  });
  assert.equal(exitCode, MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE);
  assert.equal(controllerCycles, 0);
  assert.match(output.read(), /"sourceClean":true/);
  assert.match(output.read(), /"worktreeClean":false/);
  assert.match(output.read(), /"runtimeDirtCount":6/);
});

test('worker neither reloads nor refreshes affirmative heartbeat across unpublished source dirt', async () => {
  let controllerCycles = 0;
  const heartbeats = [];
  const errors = sink();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40) },
    stdout: sink().stream,
    stderr: errors.stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: async () => ({
      valid: true,
      canonical: false,
      branch: 'main',
      headSha: 'b'.repeat(40),
      sourceClean: false,
      worktreeClean: false,
      runtimeDirtCount: 1,
      blocker: 'MISSION_WORKER_CANONICAL_SOURCE_DIRTY',
    }),
    runControllerCycle: async () => { controllerCycles += 1; return { status: 'HOLD', allowWorkerTick: false }; },
    runTick: async () => assert.fail('worker tick must remain held'),
    writeHeartbeat: async (heartbeat) => { heartbeats.push(heartbeat); },
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
  });
  assert.equal(exitCode, 0);
  assert.equal(controllerCycles, 0);
  assert.equal(heartbeats.length, 0);
  assert.doesNotMatch(errors.read(), /MISSION_WORKER_CANONICAL_RELOAD_REQUIRED/);
});

test('a transient unproven identity read does not create a reload loop', async () => {
  const head = 'a'.repeat(40);
  let identityReads = 0;
  let controllerCycles = 0;
  let heartbeatWrites = 0;
  const exitCode = await runSupervisedMissionWorker({
    argv: [],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    stdout: sink().stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: async () => {
      identityReads += 1;
      if (identityReads === 1) return { valid: false, canonical: false, branch: '', headSha: '', sourceClean: false, worktreeClean: false, runtimeDirtCount: 0, blocker: 'MISSION_WORKER_REPOSITORY_IDENTITY_READ_FAILED' };
      return { valid: true, canonical: true, branch: 'main', headSha: head, sourceClean: true, worktreeClean: true, runtimeDirtCount: 0, blocker: '' };
    },
    runControllerCycle: async () => { controllerCycles += 1; return { status: 'HOLD', allowWorkerTick: false }; },
    runTick: async () => assert.fail('worker tick must remain held'),
    writeHeartbeat: async () => { heartbeatWrites += 1; },
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    sleep: async () => {
      if (identityReads === 1) {
        assert.equal(heartbeatWrites, 0, 'unproven repository identity must not refresh affirmative heartbeat truth');
      }
      if (identityReads >= 2) throw new Error('stop-after-recovery');
    },
  }).catch((error) => error);
  assert.match(exitCode.message, /stop-after-recovery/);
  assert.equal(controllerCycles, 1);
});

test('persistent worker re-probes repository identity before every controller cycle', async () => {
  const head = 'a'.repeat(40);
  let identityReads = 0;
  let controllerCycles = 0;
  await assert.rejects(runSupervisedMissionWorker({
    argv: [],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    stdout: sink().stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: async () => {
      identityReads += 1;
      if (identityReads === 1) {
        return { valid: true, canonical: true, branch: 'main', headSha: head, sourceClean: true, worktreeClean: true, runtimeDirtCount: 0, blocker: '' };
      }
      return { valid: true, canonical: false, branch: 'main', headSha: head, sourceClean: false, worktreeClean: false, runtimeDirtCount: 0, blocker: 'MISSION_WORKER_CANONICAL_SOURCE_DIRTY' };
    },
    runControllerCycle: async () => { controllerCycles += 1; return { status: 'HOLD', allowWorkerTick: false }; },
    runTick: async () => assert.fail('worker tick must remain held'),
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    sleep: async () => {
      if (identityReads >= 2) throw new Error('stop-after-fresh-identity-proof');
    },
  }), /stop-after-fresh-identity-proof/);
  assert.equal(identityReads, 2);
  assert.equal(controllerCycles, 1);
});

test('worker fast-follows proven progress with a bounded burst then restores the steady delay', async () => {
  const delays = [];
  let cycles = 0;
  await assert.rejects(runSupervisedMissionWorker({
    argv: [],
    env: {
      STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40),
      STEPHANOS_MISSION_WORKER_INTERVAL_MS: '2000',
    },
    stdout: sink().stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: allowWorkerTick,
    runTick: async () => {
      cycles += 1;
      return cycles % 2
        ? { publish: { published: true }, processed: { processed: false } }
        : { publish: { published: false }, processed: { processed: true } };
    },
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    sleep: async (delayMs) => {
      delays.push(delayMs);
      if (delays.length === 9) throw new Error('stop-after-bounded-fast-follow');
    },
  }), /stop-after-bounded-fast-follow/);
  assert.equal(cycles, 9);
  assert.deepEqual(delays, [250, 250, 250, 250, 250, 250, 250, 250, 2000]);
});

test('worker progress detection is descriptor-safe and ignores caller-shaped getters', () => {
  let touched = 0;
  const publication = {};
  Object.defineProperty(publication, 'published', {
    enumerable: true,
    get() { touched += 1; return true; },
  });
  assert.equal(missionWorkerTickMadeProgress({ publish: publication }), false);
  assert.equal(touched, 0);
  assert.equal(missionWorkerTickMadeProgress({ processed: { processed: true } }), true);
});

test('worker log byte bounds hold for escaped Unicode fields and accessor-shaped lists', () => {
  const hostile = '"\\\n💥'.repeat(2_000);
  const controller = createMissionWorkerControllerLogProjection({
    status: hostile,
    action: hostile,
    finalVerdict: hostile,
    allowWorkerTick: true,
    blockers: [hostile, hostile, hostile, hostile],
    workerActionGrant: {
      missionId: hostile,
      actionId: hostile,
      adapter: hostile,
    },
  }, hostile);
  const tick = createMissionWorkerTickLogProjection({
    status: hostile,
    state: hostile,
    phase: hostile,
    finalVerdict: hostile,
    blocker: hostile,
    publish: { ok: true },
  }, hostile);
  assert.equal(Buffer.byteLength(`${JSON.stringify(controller)}\n`) <= MISSION_WORKER_LOG_MAX_BYTES, true);
  assert.equal(Buffer.byteLength(`${JSON.stringify(tick)}\n`) <= MISSION_WORKER_LOG_MAX_BYTES, true);

  let getterCalls = 0;
  const blockers = [];
  Object.defineProperty(blockers, '0', {
    get() { getterCalls += 1; return 'must-not-run'; },
  });
  blockers.length = 1;
  const accessorProjection = createMissionWorkerControllerLogProjection({ blockers }, hostile);
  assert.deepEqual(accessorProjection.blockers, []);
  assert.equal(getterCalls, 0);
});

test('long-running worker suppresses unchanged controller telemetry', async () => {
  const output = sink();
  let sleeps = 0;
  await assert.rejects(runSupervisedMissionWorker({
    argv: [],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: 'a'.repeat(40) },
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox,
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: async () => ({
      status: 'HOLD',
      action: 'HOLD',
      finalVerdict: 'PROGRAMME_HOLD',
      allowWorkerTick: false,
      blockers: ['capacity-unavailable'],
    }),
    runTick: async () => ({}),
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    sleep: async () => {
      sleeps += 1;
      if (sleeps >= 2) throw new Error('stop-test-loop');
    },
  }), /stop-test-loop/);
  const controllerLines = output.read().split('\n').filter((line) => line.includes('"event":"controller-cycle"'));
  assert.equal(controllerLines.length, 1);
});
