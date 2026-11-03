import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMissionWorkerHeartbeatRecord } from './mission-orchestrator-worker-heartbeat.mjs';
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
for (const mode of ['delayed-success','write-failure','wrong-action','wrong-claim','no-active-record','claim-timeout']) {
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
        if(mode==='no-active-record')delete record.activeTaskId;
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
