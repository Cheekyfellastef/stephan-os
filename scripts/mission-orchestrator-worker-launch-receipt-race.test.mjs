import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MISSION_WORKER_LAUNCH_RECEIPT_RETRY_ATTEMPTS,
  MISSION_WORKER_LAUNCH_RECEIPT_RETRY_DELAY_MS,
  MISSION_WORKER_TASK_NAME,
  writeMissionWorkerHeartbeat,
} from './mission-orchestrator-worker-heartbeat.mjs';

const HEAD = 'a'.repeat(40);
const LAUNCH_ID = 'b'.repeat(64);
const PID = 1291;
const WORKER_STARTED_AT = '2026-09-01T02:59:59.000Z';
const HEARTBEAT_AT = '2026-09-01T03:00:00.000Z';

function launchReceipt(paths) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 'stephanos.mission-worker-launch-identity.v1',
    launchIdentityId: LAUNCH_ID,
    launchKind: 'guarded-restart',
    restartInvocationId: LAUNCH_ID,
    taskName: MISSION_WORKER_TASK_NAME,
    repositoryRoot: paths.repositoryRoot,
    branch: 'main',
    headSha: HEAD,
    workerPid: PID,
    workerStartedAtUtc: WORKER_STARTED_AT,
    canonicalNode: 'C:\\Program Files\\nodejs\\node.exe',
    canonicalWorkerScript: path.resolve(paths.repositoryRoot, 'scripts', 'mission-orchestrator-worker-supervised.mjs'),
    createdAtUtc: '2026-09-01T02:59:59.500Z',
  })}\n`, 'utf8');
}

function pathsFor(root) {
  const repositoryRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  return {
    repositoryRoot,
    workspaceRoot,
    heartbeatPath: path.join(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json'),
  };
}

function heartbeatInput(paths, launchReceiptPath, overrides = {}) {
  return {
    paths,
    expectedPaths: paths,
    timestampUtc: HEARTBEAT_AT,
    repositoryRoot: paths.repositoryRoot,
    branch: 'main',
    headSha: HEAD,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: PID,
    launchIdentityId: LAUNCH_ID,
    launchReceiptPath,
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    ...overrides,
  };
}

test('heartbeat writer bridges only a bounded ENOENT launch-receipt creation race', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-launch-race-'));
  const paths = pathsFor(root);
  const launchReceiptPath = path.join(
    paths.workspaceRoot,
    'status',
    `mission-orchestrator-worker-launch-identity-${LAUNCH_ID}.json`,
  );
  const receipt = launchReceipt(paths);
  let reads = 0;
  const sleeps = [];

  try {
    const result = await writeMissionWorkerHeartbeat(heartbeatInput(paths, launchReceiptPath, {
      lstatFn: async () => {
        reads += 1;
        if (reads < 3) {
          const error = new Error('launch receipt not created yet');
          error.code = 'ENOENT';
          throw error;
        }
        return {
          size: receipt.length,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
      },
      readFileFn: async () => receipt,
      sleepFn: async (delayMs) => { sleeps.push(delayMs); },
    }));

    assert.equal(result.ok, true);
    assert.equal(reads, 3);
    assert.deepEqual(sleeps, [
      MISSION_WORKER_LAUNCH_RECEIPT_RETRY_DELAY_MS,
      MISSION_WORKER_LAUNCH_RECEIPT_RETRY_DELAY_MS,
    ]);
    const heartbeat = JSON.parse(await readFile(paths.heartbeatPath, 'utf8'));
    assert.equal(heartbeat.headSha, HEAD);
    assert.equal(heartbeat.pid, PID);
    assert.equal(heartbeat.launchIdentityId, LAUNCH_ID);
    assert.equal(heartbeat.lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heartbeat writer never retries a non-ENOENT launch identity failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-launch-failclosed-'));
  const paths = pathsFor(root);
  const launchReceiptPath = path.join(
    paths.workspaceRoot,
    'status',
    `mission-orchestrator-worker-launch-identity-${LAUNCH_ID}.json`,
  );
  let reads = 0;
  let sleeps = 0;

  try {
    await assert.rejects(() => writeMissionWorkerHeartbeat(heartbeatInput(paths, launchReceiptPath, {
      lstatFn: async () => {
        reads += 1;
        const error = new Error('access denied');
        error.code = 'EACCES';
        throw error;
      },
      readFileFn: async () => Buffer.alloc(0),
      sleepFn: async () => { sleeps += 1; },
    })), /access denied/);
    assert.equal(reads, 1);
    assert.equal(sleeps, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heartbeat writer stops at the fixed ENOENT retry bound', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-launch-bound-'));
  const paths = pathsFor(root);
  const launchReceiptPath = path.join(
    paths.workspaceRoot,
    'status',
    `mission-orchestrator-worker-launch-identity-${LAUNCH_ID}.json`,
  );
  let reads = 0;
  let sleeps = 0;

  try {
    await assert.rejects(() => writeMissionWorkerHeartbeat(heartbeatInput(paths, launchReceiptPath, {
      lstatFn: async () => {
        reads += 1;
        const error = new Error('still missing');
        error.code = 'ENOENT';
        throw error;
      },
      readFileFn: async () => Buffer.alloc(0),
      sleepFn: async (delayMs) => {
        assert.equal(delayMs, MISSION_WORKER_LAUNCH_RECEIPT_RETRY_DELAY_MS);
        sleeps += 1;
      },
    })), /still missing/);
    assert.equal(reads, MISSION_WORKER_LAUNCH_RECEIPT_RETRY_ATTEMPTS);
    assert.equal(sleeps, MISSION_WORKER_LAUNCH_RECEIPT_RETRY_ATTEMPTS - 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
