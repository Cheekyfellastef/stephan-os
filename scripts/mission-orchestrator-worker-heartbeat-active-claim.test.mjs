import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMissionWorkerHeartbeatRecord, resolveCanonicalMissionWorkerPaths, writeMissionWorkerHeartbeat } from './mission-orchestrator-worker-heartbeat.mjs';
import { createMissionWorkerActionGrantV1, missionWorkerActionGrantsMatchV1 } from '../shared/agents/missionOrchestratorWorker.mjs';
import { readMissionWorkerActiveClaim } from './mission-orchestrator-worker-heartbeat-active-claim.mjs';
import { runSupervisedMissionWorker } from './mission-orchestrator-worker-supervised.mjs';

const HEAD = 'a'.repeat(40);
const LAUNCH_ID = 'b'.repeat(64);
const WORKER_STARTED_AT = '2026-09-04T15:59:00.000Z';

function grant(overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: 'mission-active-claim-1',
    actionId: 'mission-active-claim-1-r1-task',
    actionKind: 'agent-handoff',
    adapter: 'codex',
    operation: '',
    boundedActionCount: 1,
    ...overrides,
  };
}

function queueItem(actionGrant = grant(), overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: actionGrant.adapter,
    actionId: actionGrant.actionId,
    missionId: actionGrant.missionId,
    createdAt: '2026-09-04T16:00:00.000Z',
    payload: {
      missionId: actionGrant.missionId,
      actionId: actionGrant.actionId,
      actionKind: actionGrant.actionKind,
      adapter: actionGrant.adapter,
      operation: actionGrant.operation,
    },
    ...overrides,
  };
}

function heartbeatBase(overrides = {}) {
  return {
    timestampUtc: '2026-09-04T16:00:01.000Z',
    repositoryRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    branch: 'main',
    headSha: HEAD,
    pid: 1291,
    launchIdentityId: LAUNCH_ID,
    workerStartedAtUtc: WORKER_STARTED_AT,
    ...overrides,
  };
}

function sink() {
  return { write() {} };
}

function canonicalIdentity() {
  return {
    valid: true,
    canonical: true,
    branch: 'main',
    headSha: HEAD,
    sourceClean: true,
    worktreeClean: true,
    runtimeDirtCount: 0,
    blocker: '',
  };
}

function controllerFor(actionGrant) {
  return {
    status: 'RUNNING',
    action: 'DISPATCH',
    finalVerdict: 'MISSION_WORKER_ACTION_GRANTED',
    allowWorkerTick: true,
    blockers: [],
    workerActionGrant: actionGrant,
  };
}

function workerEnv() {
  return {
    STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    STEPHANOS_MISSION_WORKER_HEAD_SHA: HEAD,
    STEPHANOS_MISSION_WORKER_BRANCH: 'main',
    STEPHANOS_MISSION_WORKER_INTERVAL_MS: '2000',
    STEPHANOS_MISSION_WORKER_HEARTBEAT_INTERVAL_MS: '30000',
  };
}

function promiseGate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function observeCarriedSourceClaim(priorFailure, mode = 'held-after-pickup') {
  const home = await mkdtemp(path.join(os.tmpdir(), 'carried-source-claim-'));
  const env = { ...workerEnv(), USERPROFILE: home };
  const paths = resolveCanonicalMissionWorkerPaths({ env });
  const queueRoot = path.join(home, 'worker-queue');
  Object.assign(env, {
    STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: paths.repositoryRoot,
    STEPHANOS_MISSION_WORKER_TASK_NAME: 'Stephanos Mission Orchestrator Worker',
    STEPHANOS_MISSION_WORKER_LAUNCH_ID: LAUNCH_ID,
    STEPHANOS_MISSION_WORKER_QUEUE_DIR: queueRoot,
  });
  const receiptPath = path.join(paths.workspaceRoot, 'status', `mission-orchestrator-worker-launch-identity-${LAUNCH_ID}.json`);
  env.STEPHANOS_MISSION_WORKER_LAUNCH_RECEIPT_PATH = receiptPath;
  const actionGrant = { ...createMissionWorkerActionGrantV1(grant({
    grantId: 'grant-current-source', controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD, missionRevision: 1, currentPhase: 'AGENT_IMPLEMENTATION',
    adapter: 'foundry-forge', providerRouteIntent: 'AUTO', capacityRoute: 'FOUNDRY_FORGE',
    capacityReceiptId: 'capacity-current-source', capacityProofRefs: ['proof/capacity.json'],
    workerId: 'stephanos-forge-lifeboat-local', laneId: 'lane-current-source',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 2961, prNumber: null,
    branch: 'openclaw/source-current', headSha: null, mergeAuthority: false, leaseSeizureAllowed: false,
  })) };
  assert.equal(missionWorkerActionGrantsMatchV1(actionGrant, actionGrant), true);
  const priorGrant = { ...actionGrant, actionId: 'prior-source-action', missionRevision: 0 };
  const originalItem = queueItem(actionGrant, { actionGrant: structuredClone(actionGrant), payload: {
    ...queueItem(actionGrant).payload, allowedFiles: ['shared/agents/one.mjs'],
    requiredTests: ['node --test shared/agents/one.test.mjs'], requiredEvidence: ['source tests'],
  } });
  const originalBytes = JSON.stringify(originalItem);
  const processingPath = path.join(queueRoot, 'foundry-forge', 'processing', `${actionGrant.actionId}.json`);
  const firstWriteEntered = promiseGate(), releaseFirstWrite = promiseGate(), timerWriteFinished = promiseGate();
  const changedGrantWriteFinished = promiseGate();
  const allowClaimRead = promiseGate(), originalClaimRead = promiseGate();
  const queuedLiteralMode = ['mutated-before-queued-write', 'settled-before-queued-write'].includes(mode);
  const records = [], histories = [], writeErrors = [], requestedVerdicts = [];
  let cycle = 0, sleeps = 0, activeWrites = 0, timer, joinAllowed, changedGrantJoinAllowed, claimObserved = false;
  const heldResult = (selected, reason) => ({ processed: {
    schemaVersion: 'stephanos.provider-neutral-source-builder.v1', processed: true, success: false,
    missionId: selected.missionId, actionId: selected.actionId, adapter: selected.adapter,
    finalVerdict: 'NATIVE_SOURCE_FINALIZATION_HELD', executionCustodyReleased: false,
    sourceState: 'UNKNOWN', reason,
  } });
  try {
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await mkdir(path.dirname(processingPath), { recursive: true });
    await writeFile(receiptPath, JSON.stringify({
      schemaVersion: 'stephanos.mission-worker-launch-identity.v1', launchIdentityId: LAUNCH_ID,
      launchKind: 'ordinary', restartInvocationId: '', taskName: env.STEPHANOS_MISSION_WORKER_TASK_NAME,
      repositoryRoot: paths.repositoryRoot, branch: 'main', headSha: HEAD, workerPid: 1291,
      workerStartedAtUtc: WORKER_STARTED_AT,
      canonicalNode: 'C:\\Program Files\\nodejs\\node.exe',
      canonicalWorkerScript: path.resolve(paths.repositoryRoot, 'scripts', 'mission-orchestrator-worker-supervised.mjs'),
      createdAtUtc: WORKER_STARTED_AT,
    }));
    await assert.rejects(runSupervisedMissionWorker({
      argv: [], env, stdout: sink(), stderr: sink(),
      inspectRepositoryIdentity: async () => canonicalIdentity(),
      bootstrapMailbox: async () => ({ ok: true }), listMissionState: async () => [],
      readMissionState: async () => null, loadCapacityRoutingInput: async () => ({}),
      runCompletionGuardianCycle: async () => ({ ok: true }),
      appendMissionStateEvent: () => assert.fail('claim observation attempted mission mutation'),
      runControllerCycle: async (_input, options) => {
        cycle++;
        histories.push(structuredClone(options.controllerLivenessEvidence.surfaceFailures));
        if (cycle === 1 && priorFailure === 'NO_WORKER_GRANT') return {
          status: 'ACTIVE', allowWorkerTick: false,
          authoritativeProjection: { status: 'ACTIVE', lane: { active: true } },
        };
        if (cycle <= 2) return { ...controllerFor(cycle === 1 ? priorGrant : actionGrant),
          status: 'ACTIVE', authoritativeProjection: { status: 'ACTIVE' } };
        return { status: 'IDLE', allowWorkerTick: false, authoritativeProjection: { status: 'READY' } };
      },
      readActiveClaim: async options => {
        if (queuedLiteralMode) await allowClaimRead.promise;
        const observed = await readMissionWorkerActiveClaim(options);
        if (observed) originalClaimRead.resolve();
        if (observed && mode === 'mutated-during-claim-read' && !claimObserved) {
          claimObserved = true;
          actionGrant.sourceRevision = 'c'.repeat(40);
        }
        return observed;
      },
      writeHeartbeat: async input => {
        requestedVerdicts.push({ cycle, verdict: input.lastTickVerdict });
        const currentAction = input.activeActionGrant?.actionId === actionGrant.actionId;
        const index = currentAction ? ++activeWrites : 0;
        if (index === 1) {
          firstWriteEntered.resolve();
          await releaseFirstWrite.promise;
          if (mode === 'write-failure') throw new Error('fixture atomic write failed');
        }
        let publication;
        try { publication = await writeMissionWorkerHeartbeat({ ...input, pid: 1291 }); }
        catch (error) {
          writeErrors.push(error.message);
          if (index === 2) timerWriteFinished.resolve({ error: error.message });
          throw error;
        }
        records.push({ cycle, record: publication.record });
        if (index === 2) timerWriteFinished.resolve(publication.record);
        if (index === 3) changedGrantWriteFinished.resolve(publication.record);
        return publication;
      },
      runTick: async options => {
        if (options.actionGrant.actionId === priorGrant.actionId) return heldResult(priorGrant, 'PRIOR_SOURCE_HELD');
        await writeFile(processingPath, originalBytes);
        if (queuedLiteralMode) {
          // An earlier timer write holds the serialized queue. Let the watcher
          // observe the real claim and enqueue its literal behind that IO.
          timer();
          await firstWriteEntered.promise;
          allowClaimRead.resolve();
          const joined = options.awaitActiveClaimHeartbeat(structuredClone(actionGrant));
          await originalClaimRead.promise;
          await new Promise(resolve => setImmediate(resolve));
          if (mode === 'mutated-before-queued-write') {
            actionGrant.sourceRevision = 'c'.repeat(40);
            releaseFirstWrite.resolve();
            joinAllowed = await joined;
          } else {
            void joined.then(value => { joinAllowed = value; });
            // Return the held tick first, so its finally invalidates the grant
            // before the earlier IO releases the queued literal publication.
            setImmediate(() => releaseFirstWrite.resolve());
          }
          return heldResult(actionGrant, 'CURRENT_SOURCE_HELD');
        }
        const joined = options.awaitActiveClaimHeartbeat(structuredClone(actionGrant));
        if (mode !== 'mutated-during-claim-read') {
          const entered = await Promise.race([firstWriteEntered.promise.then(() => true), joined.then(() => false)]);
          assert.equal(entered, true, 'the real processing claim must reach atomic publication before the join fails');
          // Force a timer to enqueue while the first atomic RUNNING publication
          // is still awaited. It must resolve its verdict after that write.
          timer();
          releaseFirstWrite.resolve();
        }
        joinAllowed = await joined;
        if (mode !== 'mutated-during-claim-read') {
          const periodic = await timerWriteFinished.promise;
          assert.equal(periodic.lastTickVerdict, mode === 'write-failure'
            ? `CONTROLLER_EXECUTION_DEFECT_${priorFailure}` : 'MISSION_WORKER_TICK_RUNNING');
          if (joinAllowed) {
            const onDisk = JSON.parse(await readFile(paths.heartbeatPath, 'utf8'));
            assert.equal(onDisk.lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
            assert.equal(onDisk.activeTaskId, actionGrant.actionId);
          }
          if (mode === 'mutated-after-publication') {
            actionGrant.sourceRevision = 'c'.repeat(40);
            timer();
            const changed = await changedGrantWriteFinished.promise;
            assert.equal(changed.lastTickVerdict, `CONTROLLER_EXECUTION_DEFECT_${priorFailure}`);
            assert.equal(Object.hasOwn(changed, 'activeTaskId'), false);
            changedGrantJoinAllowed = await options.awaitActiveClaimHeartbeat(structuredClone(actionGrant));
          }
        }
        // This fixture stops at the real publication join; it never launches a
        // native process or manufactures a successful source outcome.
        return heldResult(actionGrant, 'CURRENT_SOURCE_HELD');
      },
      activeClaimProbeIntervalMs: 1,
      setIntervalFn: callback => { timer = callback; return 17; }, clearIntervalFn: () => {},
      sleep: async () => { if (++sleeps === 3) throw new Error('carried-claim-observation-complete'); },
      now: () => '2026-09-04T16:00:01.000Z',
    }), /carried-claim-observation-complete/);
    assert.equal(await readFile(processingPath, 'utf8'), originalBytes, 'the original processing claim remains untouched');
    return { records, histories, joinAllowed, changedGrantJoinAllowed, writeErrors, requestedVerdicts };
  } finally { await rm(home, { recursive: true, force: true }); }
}

for (const priorFailure of ['NO_WORKER_GRANT', 'NO_MATERIAL_PROGRESS']) {
  test('current source claim publication supersedes carried ' + priorFailure + ' without clearing failed outcomes', async () => {
    const observed = await observeCarriedSourceClaim(priorFailure);
    assert.equal(observed.joinAllowed, true, JSON.stringify(observed.writeErrors));
    assert.equal(observed.records.some(({ record }) => record.lastTickVerdict === `CONTROLLER_EXECUTION_DEFECT_${priorFailure}`), true);
    const running = observed.records.filter(({ cycle, record }) => cycle === 2 && record.lastTickVerdict === 'MISSION_WORKER_TICK_RUNNING');
    assert.equal(running.length, 2, 'the actual claim publication and queued timer retain current execution');
    assert.equal(running.every(({ record }) => record.executionPhase === 'processing:foundry-forge' && /^claim:[a-f0-9]{64}$/.test(record.activeReceiptId)), true);
    assert.equal(observed.records.at(-1).record.lastTickVerdict, 'CONTROLLER_EXECUTION_DEFECT_NO_MATERIAL_PROGRESS');
    assert.deepEqual(observed.histories[2].slice(0, observed.histories[1].length), observed.histories[1], 'pickup does not erase historical surface failures');
    assert.equal(observed.histories[2].at(-1).failureClass, 'CURRENT_SOURCE_HELD');
  });
}

for (const mode of ['write-failure', 'mutated-during-claim-read']) {
  test('carried failure cannot authorize source pickup after ' + mode, async () => {
    const observed = await observeCarriedSourceClaim('NO_WORKER_GRANT', mode);
    assert.equal(observed.joinAllowed, false);
    assert.equal(observed.records.some(({ cycle, record }) => cycle === 2 && record.lastTickVerdict === 'MISSION_WORKER_TICK_RUNNING'), false);
    assert.equal(observed.records.at(-1).record.lastTickVerdict, 'CONTROLLER_EXECUTION_DEFECT_NO_MATERIAL_PROGRESS');
  });
}

for (const mode of ['mutated-before-queued-write', 'settled-before-queued-write']) {
  test('queued source RUNNING publication is fenced when ' + mode, async () => {
    const observed = await observeCarriedSourceClaim('NO_WORKER_GRANT', mode);
    assert.equal(observed.joinAllowed, false);
    assert.equal(observed.requestedVerdicts.some(({ cycle, verdict }) => cycle === 2 && verdict === 'MISSION_WORKER_TICK_RUNNING'), false,
      'an invalidated queued publication never reaches the actual writer');
    assert.equal(observed.records.some(({ cycle, record }) => cycle === 2 && record.lastTickVerdict === 'MISSION_WORKER_TICK_RUNNING'), false);
  });
}

test('a proven current claim cannot keep periodic RUNNING or resume permission after its grant mutates', async () => {
  const observed = await observeCarriedSourceClaim('NO_MATERIAL_PROGRESS', 'mutated-after-publication');
  assert.equal(observed.joinAllowed, true, 'the unchanged original claim was initially proven');
  assert.equal(observed.changedGrantJoinAllowed, false);
  assert.equal(observed.records.at(-1).record.lastTickVerdict, 'CONTROLLER_EXECUTION_DEFECT_NO_MATERIAL_PROGRESS');
  assert.deepEqual(observed.histories[2].slice(0, observed.histories[1].length), observed.histories[1]);
});

test('active claim requires the exact granted action in the exact processing queue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-active-claim-'));
  const actionGrant = grant();
  const processingRoot = path.join(root, actionGrant.adapter, 'processing');
  const claimPath = path.join(processingRoot, `${actionGrant.actionId}.json`);
  try {
    assert.equal(await readMissionWorkerActiveClaim({ queueRoot: root, actionGrant }), null);

    await mkdir(processingRoot, { recursive: true });
    await writeFile(claimPath, `${JSON.stringify(queueItem(actionGrant))}\n`, 'utf8');
    const claim = await readMissionWorkerActiveClaim({ queueRoot: root, actionGrant });
    assert.equal(claim.missionId, actionGrant.missionId);
    assert.equal(claim.activeTaskId, actionGrant.actionId);
    assert.match(claim.activeReceiptId, /^claim:[a-f0-9]{64}$/);
    assert.equal(claim.executionPhase, 'processing:codex');

    await writeFile(claimPath, `${JSON.stringify(queueItem(actionGrant, {
      payload: { ...queueItem(actionGrant).payload, missionId: 'different-mission' },
    }))}\n`, 'utf8');
    assert.equal(await readMissionWorkerActiveClaim({ queueRoot: root, actionGrant }), null);

    assert.equal(await readMissionWorkerActiveClaim({
      queueRoot: root,
      actionGrant: grant({ actionId: '../escape' }),
    }), null);
    assert.equal(await readMissionWorkerActiveClaim({
      queueRoot: root,
      actionGrant: grant({ adapter: 'chatgpt-github' }),
    }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('running heartbeat is not advertised until a real active claim is proven', () => {
  const withoutClaim = createMissionWorkerHeartbeatRecord(heartbeatBase({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
  }));
  assert.equal(withoutClaim.lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(withoutClaim.activeTaskId, undefined);
  assert.equal(withoutClaim.activeReceiptId, undefined);
  assert.equal(withoutClaim.executionPhase, undefined);

  const activeClaim = {
    activeTaskId: 'mission-active-claim-1-r1-task',
    activeReceiptId: `claim:${'c'.repeat(64)}`,
    executionPhase: 'processing:codex',
  };
  const withClaim = createMissionWorkerHeartbeatRecord(heartbeatBase({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeClaim,
  }));
  assert.equal(withClaim.lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
  assert.equal(withClaim.activeTaskId, activeClaim.activeTaskId);
  assert.equal(withClaim.activeReceiptId, activeClaim.activeReceiptId);
  assert.equal(withClaim.executionPhase, activeClaim.executionPhase);

  const partialClaim = createMissionWorkerHeartbeatRecord(heartbeatBase({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeClaim: { activeTaskId: activeClaim.activeTaskId },
  }));
  assert.equal(partialClaim.lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(partialClaim.activeTaskId, undefined);
});

test('supervised worker binds only its in-flight exact grant to periodic running heartbeats', async () => {
  const actionGrant = grant();
  const heartbeats = [];
  let timerCallback = null;

  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: workerEnv(),
    stdout: sink(),
    stderr: sink(),
    bootstrapMailbox: async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' }),
    inspectRepositoryIdentity: async () => canonicalIdentity(),
    runControllerCycle: async () => controllerFor(actionGrant),
    runTick: async () => {
      timerCallback();
      return {
        publish: { published: true },
        processed: { processed: true },
      };
    },
    readActiveClaim: async () => null,
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    activeClaimProbeIntervalMs: 1,
    setIntervalFn: (callback) => {
      timerCallback = callback;
      return 7;
    },
    clearIntervalFn: () => {},
    now: () => '2026-09-04T16:00:01.000Z',
  });

  assert.equal(exitCode, 0);
  assert.equal(heartbeats.length, 3);
  assert.equal(heartbeats[0].lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
  assert.equal(heartbeats[0].activeActionGrant, undefined);
  assert.equal(heartbeats[1].lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
  assert.deepEqual(heartbeats[1].activeActionGrant, actionGrant);
  assert.equal(heartbeats[2].lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(heartbeats[2].activeActionGrant, undefined);
});

test('short claimed tick emits one active heartbeat without waiting for the periodic timer', async () => {
  const actionGrant = grant();
  const heartbeats = [];
  let tickStarted = false;
  let releaseTick;
  let claimReads = 0;

  const exitCodePromise = runSupervisedMissionWorker({
    argv: ['--once'],
    env: workerEnv(),
    stdout: sink(),
    stderr: sink(),
    bootstrapMailbox: async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' }),
    inspectRepositoryIdentity: async () => canonicalIdentity(),
    runControllerCycle: async () => controllerFor(actionGrant),
    runTick: async () => {
      tickStarted = true;
      await new Promise((resolve) => { releaseTick = resolve; });
      return {
        publish: { published: true },
        processed: { processed: true },
      };
    },
    readActiveClaim: async () => {
      claimReads += 1;
      if (!tickStarted) return null;
      const claim = {
        activeTaskId: actionGrant.actionId,
        activeReceiptId: `claim:${'c'.repeat(64)}`,
        executionPhase: 'processing:codex',
      };
      queueMicrotask(() => releaseTick());
      return claim;
    },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    activeClaimProbeIntervalMs: 1,
    setIntervalFn: () => 7,
    clearIntervalFn: () => {},
    now: () => '2026-09-04T16:00:01.000Z',
  });

  const exitCode = await exitCodePromise;
  assert.equal(exitCode, 0);
  assert.ok(claimReads >= 1);
  assert.equal(heartbeats.length, 3);
  assert.equal(heartbeats[0].activeActionGrant, undefined);
  assert.equal(heartbeats[1].lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
  assert.deepEqual(heartbeats[1].activeActionGrant, actionGrant);
  assert.equal(heartbeats[2].lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(heartbeats[2].activeActionGrant, undefined);
});

test('claim watcher stops when the tick finishes and never publishes stale activity afterward', async () => {
  const actionGrant = grant();
  const heartbeats = [];
  let claimReads = 0;

  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: workerEnv(),
    stdout: sink(),
    stderr: sink(),
    bootstrapMailbox: async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' }),
    inspectRepositoryIdentity: async () => canonicalIdentity(),
    runControllerCycle: async () => controllerFor(actionGrant),
    runTick: async () => ({
      publish: { published: true },
      processed: { processed: true },
    }),
    readActiveClaim: async () => {
      claimReads += 1;
      return null;
    },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    activeClaimProbeIntervalMs: 1,
    setIntervalFn: () => 7,
    clearIntervalFn: () => {},
    now: () => '2026-09-04T16:00:01.000Z',
  });

  assert.equal(exitCode, 0);
  assert.ok(claimReads >= 1);
  assert.equal(heartbeats.length, 2);
  assert.equal(heartbeats[0].activeActionGrant, undefined);
  assert.equal(heartbeats[1].lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(heartbeats[1].activeActionGrant, undefined);
});


test('local source processing heartbeat preserves exact canonical task class and original grant', async () => {
  const parent=await mkdtemp(path.join(os.tmpdir(),'fixed-source-active-'));
  try {
    const actionGrant=grant({adapter:'foundry-forge',capacityRoute:'FOUNDRY_FORGE',
      workerId:'stephanos-forge-lifeboat-local',currentPhase:'REPAIR_REQUIRED',
      mergeAuthority:false,leaseSeizureAllowed:false});
    const item=queueItem(actionGrant,{actionGrant,payload:{...queueItem(actionGrant).payload,
      allowedFiles:['shared/agents/one.mjs'],requiredEvidence:['source tests']}});
    const processing=path.join(parent,'foundry-forge','processing');
    await mkdir(processing,{recursive:true});
    const claimPath=path.join(processing,actionGrant.actionId+'.json');
    const read=()=>readMissionWorkerActiveClaim({queueRoot:parent,actionGrant});
    await writeFile(claimPath,JSON.stringify(item));
    const active=await read();
    assert.equal(active.executionPhase,'processing:foundry-forge');
    assert.match(active.activeReceiptId,/^claim:[a-f0-9]{64}$/);
    for(const alter of [
      value=>{value.actionGrant.workerId='another-worker';},
      value=>{value.actionGrant.mergeAuthority=true;},
      value=>{value.payload.requiredEvidence=['Windows runtime proof'];},
      value=>{value.payload.requiredEvidence=['Battle Bridge evidence'];},
      value=>{value.payload.allowedFiles=[];},
      value=>{value.payload.allowedFiles=['a','b','c','d','e'];},
    ]) {
      const invalid=structuredClone(item);alter(invalid);
      await writeFile(claimPath,JSON.stringify(invalid));
      assert.equal(await read(),null);
    }
  } finally {await rm(parent,{recursive:true,force:true});}
});

// Append these tests to the existing heartbeat-active-claim test module.
for (const mode of ['delayed-success','write-failure','wrong-action','wrong-claim','wrong-phase','wrong-verdict','no-active-record','missing-receipt','missing-phase','claim-timeout']) {
  test('source launch joins actual active-claim publication: '+mode, async () => {
    const actionGrant=grant({adapter:'foundry-forge',capacityRoute:'FOUNDRY_FORGE',workerId:'stephanos-forge-lifeboat-local'});
    const activeClaim={activeTaskId:actionGrant.actionId,activeReceiptId:'claim:'+'c'.repeat(64),executionPhase:'processing:foundry-forge'};
    let join,started=false,published=false,launchAttempted=false,finishWrite,publicationEntered;
    const writing=new Promise(resolve=>{publicationEntered=resolve;});
    const writeGate=new Promise(resolve=>{finishWrite=resolve;});
    const running=runSupervisedMissionWorker({
      argv:['--once'],env:workerEnv(),stdout:sink(),stderr:sink(),
      bootstrapMailbox:async()=>({ok:true,status:'MAILBOX_ALREADY_REGISTERED'}),
      inspectRepositoryIdentity:async()=>canonicalIdentity(),runControllerCycle:async()=>controllerFor(actionGrant),
      runTick:async options=>{
        join=options.awaitActiveClaimHeartbeat;
        assert.equal(typeof join,'function');started=true;
        assert.equal(await join({...actionGrant,actionId:'foreign-action'}),false);
        const allowed=await join(structuredClone(actionGrant));
        launchAttempted=allowed;
        assert.equal(allowed,mode==='delayed-success');
        if(allowed)assert.equal(published,true);
        return {publish:{published:true},processed:{processed:true}};
      },
      readActiveClaim:async()=>started&&mode!=='claim-timeout'?activeClaim:null,
      writeHeartbeat:async input=>{
        if(!input.activeActionGrant)return {ok:true,record:{}};
        publicationEntered();await writeGate;
        if(mode==='write-failure')throw new Error('simulated atomic write failure');
        published=true;
        const record={...activeClaim,lastTickVerdict:'MISSION_WORKER_TICK_RUNNING'};
        if(mode==='wrong-action')record.activeTaskId='foreign-action';
        if(mode==='wrong-claim')record.activeReceiptId='claim:'+'d'.repeat(64);
        if(mode==='wrong-phase')record.executionPhase='processing:foreign-adapter';
        if(mode==='wrong-verdict')record.lastTickVerdict='MISSION_WORKER_TICK_PASS';
        if(mode==='no-active-record')delete record.activeTaskId;
        if(mode==='missing-receipt')delete record.activeReceiptId;
        if(mode==='missing-phase')delete record.executionPhase;
        return {ok:true,record};
      },
      activeClaimProbeIntervalMs:1,setIntervalFn:()=>7,clearIntervalFn:()=>{},
      now:()=> '2026-09-04T16:00:01.000Z',
    });
    if(mode!=='claim-timeout') {
      // Bounded wait also lets the immutable-baseline negative fail cleanly.
      await Promise.race([writing,running]);
      assert.equal(launchAttempted,false);
      finishWrite();
    }
    const code=await running;
    assert.equal(code,mode==='write-failure'?1:0);
    assert.equal(launchAttempted,mode==='delayed-success');
    assert.equal(await join(structuredClone(actionGrant)),false);
  });
}

test('active publication cannot qualify a mutated original in-flight grant',async()=>{
  const actionGrant=grant(),activeClaim={activeTaskId:actionGrant.actionId,activeReceiptId:'claim:'+'c'.repeat(64),executionPhase:'processing:codex'};
  let join,started=false;
  const code=await runSupervisedMissionWorker({
    argv:['--once'],env:workerEnv(),stdout:sink(),stderr:sink(),
    bootstrapMailbox:async()=>({ok:true}),inspectRepositoryIdentity:async()=>canonicalIdentity(),
    runControllerCycle:async()=>controllerFor(actionGrant),
    runTick:async options=>{join=options.awaitActiveClaimHeartbeat;assert.equal(typeof join,'function');started=true;
      assert.equal(await join(structuredClone(actionGrant)),false);
      return {publish:{published:true},processed:{processed:true}};},
    readActiveClaim:async()=>started?activeClaim:null,
    writeHeartbeat:async input=>{if(!input.activeActionGrant)return {ok:true,record:{}};
      actionGrant.operation='different-operation';
      return {ok:true,record:{...activeClaim,lastTickVerdict:'MISSION_WORKER_TICK_RUNNING'}};},
    activeClaimProbeIntervalMs:1,setIntervalFn:()=>7,clearIntervalFn:()=>{},now:()=> '2026-09-04T16:00:01.000Z',
  });
  assert.equal(code,0);
});
