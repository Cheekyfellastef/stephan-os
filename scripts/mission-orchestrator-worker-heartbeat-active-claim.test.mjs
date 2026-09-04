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

test('supervised worker binds only its in-flight exact grant to running heartbeats', async () => {
  const actionGrant = grant();
  const heartbeats = [];
  let timerCallback = null;
  const env = {
    STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    STEPHANOS_MISSION_WORKER_HEAD_SHA: HEAD,
    STEPHANOS_MISSION_WORKER_BRANCH: 'main',
    STEPHANOS_MISSION_WORKER_INTERVAL_MS: '2000',
    STEPHANOS_MISSION_WORKER_HEARTBEAT_INTERVAL_MS: '30000',
  };

  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env,
    stdout: sink(),
    stderr: sink(),
    bootstrapMailbox: async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' }),
    inspectRepositoryIdentity: async () => ({
      valid: true,
      canonical: true,
      branch: 'main',
      headSha: HEAD,
      sourceClean: true,
      worktreeClean: true,
      runtimeDirtCount: 0,
      blocker: '',
    }),
    runControllerCycle: async () => ({
      status: 'RUNNING',
      action: 'DISPATCH',
      finalVerdict: 'MISSION_WORKER_ACTION_GRANTED',
      allowWorkerTick: true,
      blockers: [],
      workerActionGrant: actionGrant,
    }),
    runTick: async () => {
      timerCallback();
      return {
        publish: { published: true },
        processed: { processed: true },
      };
    },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
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
