import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MISSION_WORKER_TASK_NAME,
  createMissionWorkerHeartbeatRecord,
  writeMissionWorkerHeartbeat,
} from './mission-orchestrator-worker-heartbeat.mjs';

const HEAD = 'a'.repeat(40);

test('heartbeat record is bound to canonical main task and pid', () => {
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-07-15T03:00:00.000Z',
    repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
    branch: 'main',
    headSha: HEAD,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: 1291,
  });
  assert.equal(record.branch, 'main');
  assert.equal(record.headSha, HEAD);
  assert.equal(record.taskName, MISSION_WORKER_TASK_NAME);
  assert.equal(record.pid, 1291);
  assert.equal(record.arbitraryShellAllowed, false);
});

test('heartbeat record rejects wrong branch, head, task or pid', () => {
  const base = {
    timestampUtc: '2026-07-15T03:00:00.000Z',
    repositoryRoot: '/home/stephan/Documents/GitHub/stephan-os',
    branch: 'main',
    headSha: HEAD,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: 1291,
  };
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, branch: 'feature' }), /branch main/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, headSha: 'abc' }), /40-character/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, taskName: 'Other Task' }), /not allowlisted/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, pid: 0 }), /pid is invalid/);
});

test('heartbeat writer performs one atomic write only at the canonical path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-heartbeat-'));
  const repositoryRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  const heartbeatPath = path.join(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json');
  const paths = { repositoryRoot, workspaceRoot, heartbeatPath };
  try {
    const result = await writeMissionWorkerHeartbeat({
      paths,
      expectedPaths: paths,
      timestampUtc: '2026-07-15T03:00:00.000Z',
      repositoryRoot,
      branch: 'main',
      headSha: HEAD,
      taskName: MISSION_WORKER_TASK_NAME,
      pid: 1291,
      lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    });
    assert.equal(result.ok, true);
    const written = JSON.parse(await readFile(heartbeatPath, 'utf8'));
    assert.equal(written.pid, 1291);
    assert.equal(written.lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heartbeat writer refuses non-canonical source or destination paths', async () => {
  const canonical = {
    repositoryRoot: '/canonical/Documents/GitHub/stephan-os',
    workspaceRoot: '/canonical/Documents/Stephanos-openclaw-workspace',
    heartbeatPath: '/canonical/Documents/Stephanos-openclaw-workspace/status/mission-orchestrator-worker-heartbeat.json',
  };
  await assert.rejects(() => writeMissionWorkerHeartbeat({
    paths: { ...canonical, heartbeatPath: '/tmp/heartbeat.json' },
    expectedPaths: canonical,
    repositoryRoot: canonical.repositoryRoot,
    branch: 'main',
    headSha: HEAD,
    pid: 1291,
  }), /output path is not canonical/);
  await assert.rejects(() => writeMissionWorkerHeartbeat({
    paths: canonical,
    expectedPaths: canonical,
    repositoryRoot: '/tmp/stephan-os',
    branch: 'main',
    headSha: HEAD,
    pid: 1291,
  }), /source repository is not canonical/);
});
