import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MISSION_WORKER_TASK_NAME,
  createMissionWorkerHeartbeatRecord,
  projectMissionWorkerHeartbeat,
  readMissionWorkerLaunchIdentityReceipt,
  writeMissionWorkerHeartbeat,
} from './mission-orchestrator-worker-heartbeat.mjs';

const HEAD = 'a'.repeat(40);
const LAUNCH_ID = 'b'.repeat(64);
const WORKER_STARTED_AT = '2026-07-15T02:59:59.000Z';

function identityFields() {
  return {
    launchIdentityId: LAUNCH_ID,
    workerStartedAtUtc: WORKER_STARTED_AT,
  };
}

async function writeLaunchIdentityReceipt(paths, {
  launchIdentityId = LAUNCH_ID,
  launchKind = 'guarded-restart',
  restartInvocationId = launchIdentityId,
  repositoryRoot = paths.repositoryRoot,
  branch = 'main',
  headSha = HEAD,
  pid = 1291,
  workerStartedAtUtc = WORKER_STARTED_AT,
  createdAtUtc = '2026-07-15T02:59:59.500Z',
  canonicalNode = 'C:\\Program Files\\nodejs\\node.exe',
  canonicalWorkerScript = path.resolve(paths.repositoryRoot, 'scripts', 'mission-orchestrator-worker-supervised.mjs'),
  mutate = (record) => record,
} = {}) {
  const receiptPath = path.resolve(
    paths.workspaceRoot,
    'status',
    `mission-orchestrator-worker-launch-identity-${launchIdentityId}.json`,
  );
  const record = mutate({
    schemaVersion: 'stephanos.mission-worker-launch-identity.v1',
    launchIdentityId,
    launchKind,
    restartInvocationId,
    taskName: MISSION_WORKER_TASK_NAME,
    repositoryRoot,
    branch,
    headSha,
    workerPid: pid,
    workerStartedAtUtc,
    canonicalNode,
    canonicalWorkerScript,
    createdAtUtc,
  });
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(record)}\n`, 'utf8');
  return receiptPath;
}

test('heartbeat record is bound to canonical main task and pid', () => {
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-07-15T03:00:00.000Z',
    repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
    branch: 'main',
    headSha: HEAD,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: 1291,
    ...identityFields(),
  });
  assert.equal(record.branch, 'main');
  assert.equal(record.headSha, HEAD);
  assert.equal(record.taskName, MISSION_WORKER_TASK_NAME);
  assert.equal(record.pid, 1291);
  assert.equal(record.launchIdentityId, LAUNCH_ID);
  assert.equal(record.workerStartedAtUtc, WORKER_STARTED_AT);
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
    ...identityFields(),
  };
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, branch: 'feature' }), /branch main/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, headSha: 'abc' }), /40-character/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, taskName: 'Other Task' }), /not allowlisted/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, pid: 0 }), /pid is invalid/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({ ...base, launchIdentityId: 'abc' }), /launch identity/);
  assert.throws(() => createMissionWorkerHeartbeatRecord({
    ...base,
    workerStartedAtUtc: base.timestampUtc,
  }), /process-start identity/);
});

test('worker heartbeat projection remains worker-only liveness authority', () => {
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-07-15T03:00:00.000Z',
    repositoryRoot: '/home/stephan/Documents/GitHub/stephan-os',
    branch: 'main',
    headSha: HEAD,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: 1291,
    ...identityFields(),
  });
  const projection = projectMissionWorkerHeartbeat(record, {
    nowUtc: '2026-07-15T03:01:00.000Z',
    expectedRepositoryRoot: '/home/stephan/Documents/GitHub/stephan-os',
    expectedHeadSha: HEAD,
  });
  assert.equal(projection.valid, true);
  assert.equal(projection.fresh, true);
  assert.equal(projection.authority, 'mission-worker-only');
  assert.equal(projection.controllerHeartbeatAuthority, false);

  const wrongRevision = projectMissionWorkerHeartbeat(record, {
    nowUtc: '2026-07-15T03:01:00.000Z',
    expectedRepositoryRoot: '/home/stephan/Documents/GitHub/stephan-os',
    expectedHeadSha: 'b'.repeat(40),
  });
  assert.equal(wrongRevision.valid, false);
  assert.ok(wrongRevision.errors.includes('worker-head-mismatch'));

  const wrongRepository = projectMissionWorkerHeartbeat(record, {
    nowUtc: '2026-07-15T03:01:00.000Z',
    expectedRepositoryRoot: '/home/stephan/Documents/GitHub/other-repo',
    expectedHeadSha: HEAD,
  });
  assert.equal(wrongRepository.valid, false);
  assert.ok(wrongRepository.errors.includes('worker-repository-mismatch'));

  const missingRepository = projectMissionWorkerHeartbeat({
    ...record,
    repositoryRoot: undefined,
  }, {
    nowUtc: '2026-07-15T03:01:00.000Z',
    expectedRepositoryRoot: process.cwd(),
    expectedHeadSha: HEAD,
  });
  assert.equal(missingRepository.valid, false);
  assert.ok(missingRepository.errors.includes('worker-repository-missing'));

  const relativeRepository = projectMissionWorkerHeartbeat({
    ...record,
    repositoryRoot: 'stephan-os',
  }, {
    nowUtc: '2026-07-15T03:01:00.000Z',
    expectedRepositoryRoot: path.resolve('stephan-os'),
    expectedHeadSha: HEAD,
  });
  assert.equal(relativeRepository.valid, false);
  assert.ok(relativeRepository.errors.includes('worker-repository-not-absolute'));

  const failedTick = projectMissionWorkerHeartbeat({
    ...record,
    lastTickVerdict: 'MISSION_WORKER_TICK_FAILED',
  }, {
    nowUtc: '2026-07-15T03:01:00.000Z',
    expectedRepositoryRoot: '/home/stephan/Documents/GitHub/stephan-os',
    expectedHeadSha: HEAD,
  });
  assert.equal(failedTick.valid, false);
  assert.equal(failedTick.fresh, false);
  assert.ok(failedTick.errors.includes('worker-last-tick-not-affirmative'));
});

test('heartbeat writer performs one atomic write only at the canonical path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-heartbeat-'));
  const repositoryRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  const heartbeatPath = path.join(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json');
  const paths = { repositoryRoot, workspaceRoot, heartbeatPath };
  try {
    const launchReceiptPath = await writeLaunchIdentityReceipt(paths);
    const result = await writeMissionWorkerHeartbeat({
      paths,
      expectedPaths: paths,
      timestampUtc: '2026-07-15T03:00:00.000Z',
      repositoryRoot,
      branch: 'main',
      headSha: HEAD,
      taskName: MISSION_WORKER_TASK_NAME,
      pid: 1291,
      launchIdentityId: LAUNCH_ID,
      launchReceiptPath,
      lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    });
    assert.equal(result.ok, true);
    const written = JSON.parse(await readFile(heartbeatPath, 'utf8'));
    assert.equal(written.pid, 1291);
    assert.equal(written.launchIdentityId, LAUNCH_ID);
    assert.equal(written.workerStartedAtUtc, WORKER_STARTED_AT);
    assert.equal(written.lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heartbeat writer removes its own temporary file only after launch identity validation reaches publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-heartbeat-failure-'));
  const repositoryRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  const statusRoot = path.join(workspaceRoot, 'status');
  const heartbeatPath = path.join(statusRoot, 'mission-orchestrator-worker-heartbeat.json');
  const paths = { repositoryRoot, workspaceRoot, heartbeatPath };
  try {
    const launchReceiptPath = await writeLaunchIdentityReceipt(paths);
    await mkdir(heartbeatPath, { recursive: true });
    await assert.rejects(() => writeMissionWorkerHeartbeat({
      paths,
      expectedPaths: paths,
      timestampUtc: '2026-07-15T03:00:00.000Z',
      repositoryRoot,
      branch: 'main',
      headSha: HEAD,
      taskName: MISSION_WORKER_TASK_NAME,
      pid: 1291,
      launchIdentityId: LAUNCH_ID,
      launchReceiptPath,
      lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    }));
    const entries = (await readdir(statusRoot)).sort();
    assert.deepEqual(entries, [
      'mission-orchestrator-worker-heartbeat.json',
      `mission-orchestrator-worker-launch-identity-${LAUNCH_ID}.json`,
    ].sort());
    assert.equal(entries.some((name) => name.endsWith('.tmp')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('launch identity receipt is closed-world, bounded and exact-worker bound', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-launch-identity-'));
  const repositoryRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  const paths = {
    repositoryRoot,
    workspaceRoot,
    heartbeatPath: path.join(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json'),
  };
  try {
    const launchReceiptPath = await writeLaunchIdentityReceipt(paths);
    const result = await readMissionWorkerLaunchIdentityReceipt({
      launchIdentityId: LAUNCH_ID,
      launchReceiptPath,
      expectedPaths: paths,
      repositoryRoot,
      branch: 'main',
      headSha: HEAD,
      pid: 1291,
    });
    assert.equal(result.launchIdentityId, LAUNCH_ID);
    assert.equal(result.workerStartedAtUtc, WORKER_STARTED_AT);

    await writeLaunchIdentityReceipt(paths, {
      mutate: (record) => ({ ...record, callerSelectedCommand: 'powershell.exe' }),
    });
    await assert.rejects(() => readMissionWorkerLaunchIdentityReceipt({
      launchIdentityId: LAUNCH_ID,
      launchReceiptPath,
      expectedPaths: paths,
      repositoryRoot,
      branch: 'main',
      headSha: HEAD,
      pid: 1291,
    }), /key estate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('launch identity receipt rejects missing, mismatched and caller-selected process identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mission-worker-launch-adversarial-'));
  const repositoryRoot = path.join(root, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(root, 'Documents', 'Stephanos-openclaw-workspace');
  const paths = {
    repositoryRoot,
    workspaceRoot,
    heartbeatPath: path.join(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json'),
  };
  try {
    const missingPath = path.join(workspaceRoot, 'status', `mission-orchestrator-worker-launch-identity-${LAUNCH_ID}.json`);
    await assert.rejects(() => readMissionWorkerLaunchIdentityReceipt({
      launchIdentityId: LAUNCH_ID,
      launchReceiptPath: missingPath,
      expectedPaths: paths,
      repositoryRoot,
      branch: 'main',
      headSha: HEAD,
      pid: 1291,
    }));

    const mismatches = [
      { pid: 1292 },
      { headSha: 'c'.repeat(40) },
      { workerStartedAtUtc: '2026-07-15T03:01:00.000Z' },
      { launchKind: 'ordinary', restartInvocationId: LAUNCH_ID },
      { canonicalNode: 'C:\\Windows\\System32\\cmd.exe' },
    ];
    for (const mismatch of mismatches) {
      const launchReceiptPath = await writeLaunchIdentityReceipt(paths, mismatch);
      await assert.rejects(() => readMissionWorkerLaunchIdentityReceipt({
        launchIdentityId: LAUNCH_ID,
        launchReceiptPath,
        expectedPaths: paths,
        repositoryRoot,
        branch: 'main',
        headSha: HEAD,
        pid: 1291,
      }), /does not match/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heartbeat projection rejects stale identity, future time and process-start mismatch', () => {
  const record = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-07-15T03:00:00.000Z',
    repositoryRoot: '/home/stephan/Documents/GitHub/stephan-os',
    branch: 'main',
    headSha: HEAD,
    pid: 1291,
    ...identityFields(),
  });
  const stale = projectMissionWorkerHeartbeat(record, {
    nowUtc: '2026-07-15T03:03:00.001Z',
    expectedRepositoryRoot: record.repositoryRoot,
    expectedHeadSha: HEAD,
  });
  assert.equal(stale.valid, true);
  assert.equal(stale.stale, true);

  const future = projectMissionWorkerHeartbeat(record, {
    nowUtc: '2026-07-15T02:58:59.000Z',
    expectedRepositoryRoot: record.repositoryRoot,
    expectedHeadSha: HEAD,
  });
  assert.equal(future.valid, false);
  assert.ok(future.errors.includes('future-worker-heartbeat'));

  const changedStart = projectMissionWorkerHeartbeat({
    ...record,
    workerStartedAtUtc: record.timestampUtc,
  }, {
    nowUtc: '2026-07-15T03:00:01.000Z',
    expectedRepositoryRoot: record.repositoryRoot,
    expectedHeadSha: HEAD,
  });
  assert.equal(changedStart.valid, false);
  assert.ok(changedStart.errors.includes('worker-heartbeat-not-after-process-start'));
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