import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  observeRemoteCodexTaskVisibility,
} from './remote-codex-task-visibility-observer.mjs';
import {
  REMOTE_CODEX_VISIBILITY_STATES,
} from '../shared/agents/remoteCodexTaskVisibility.mjs';

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'remote-codex-observer-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  const currentTaskPath = path.join(workspaceRoot, 'codex-dispatch', 'current.json');
  const tasksRoot = path.join(workspaceRoot, 'codex-dispatch', 'tasks');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(path.dirname(currentTaskPath), { recursive: true });
  try {
    await run({ repoRoot, workspaceRoot, currentTaskPath, tasksRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const mirrorPublisher = async () => ({ ok: true, reason: 'REMOTE_CODEX_GITHUB_MIRROR_UPDATED' });

test('external observer reclassifies a dead RUNNING worker without depending on the emitting process', async () => {
  await withFixture(async (paths) => {
    const jobId = 'codex-job-dead-worker';
    await writeFile(paths.currentTaskPath, `${JSON.stringify({
      jobId,
      taskId: jobId,
      issueNumber: 1506,
      status: 'RUNNING',
      workerPid: 99123,
      heartbeatUtc: '2026-07-16T15:59:50.000Z',
      proofRefs: [`proof/${jobId}.json`, `receipts/${jobId}.json`],
    })}\n`);

    let observed = null;
    const result = await observeRemoteCodexTaskVisibility({
      paths,
      now: new Date('2026-07-16T16:00:00.000Z'),
      processIsAliveFn: () => false,
      publisher: async (_root, input, options) => {
        observed = { input, options };
        return { ok: true, reason: 'PUBLISHED', slice: { state: REMOTE_CODEX_VISIBILITY_STATES.WORKER_EXITED_WITHOUT_RESULT } };
      },
      mirrorPublisher,
    });

    assert.equal(result.ok, true);
    assert.equal(result.workspacePublished, true);
    assert.equal(result.mirrorPublished, true);
    assert.equal(result.taskState, REMOTE_CODEX_VISIBILITY_STATES.WORKER_EXITED_WITHOUT_RESULT);
    assert.equal(observed.input.workerAlive, false);
    assert.equal(observed.input.resultAvailable, false);
    assert.equal(observed.options.repoRoot, paths.repoRoot);
  });
});

test('external observer republishes stale heartbeat truth while a worker process is still alive', async () => {
  await withFixture(async (paths) => {
    const jobId = 'codex-job-stale-worker';
    await writeFile(paths.currentTaskPath, `${JSON.stringify({
      jobId,
      taskId: jobId,
      issueNumber: 1506,
      status: 'RUNNING',
      workerPid: 4422,
      heartbeatUtc: '2026-07-16T15:55:00.000Z',
      proofRefs: [`proof/${jobId}.json`, `receipts/${jobId}.json`],
    })}\n`);

    const result = await observeRemoteCodexTaskVisibility({
      paths,
      now: new Date('2026-07-16T16:00:00.000Z'),
      processIsAliveFn: () => true,
      publisher: async () => ({ ok: true, slice: { state: REMOTE_CODEX_VISIBILITY_STATES.RUNNING_STALE } }),
      mirrorPublisher,
    });

    assert.equal(result.taskState, REMOTE_CODEX_VISIBILITY_STATES.RUNNING_STALE);
    assert.equal(result.workerAlive, true);
    assert.equal(result.mirrorPublished, true);
  });
});

test('external observer prefers a durable result over a stale RUNNING current record', async () => {
  await withFixture(async (paths) => {
    const jobId = 'codex-job-result-ready';
    const taskRoot = path.join(paths.tasksRoot, jobId);
    await mkdir(taskRoot, { recursive: true });
    await writeFile(paths.currentTaskPath, `${JSON.stringify({
      jobId,
      taskId: jobId,
      issueNumber: 1506,
      status: 'RUNNING',
      workerPid: 5511,
      heartbeatUtc: '2026-07-16T15:55:00.000Z',
      proofRefs: [`proof/${jobId}.json`, `receipts/${jobId}.json`],
    })}\n`);
    await writeFile(path.join(taskRoot, 'result.json'), `${JSON.stringify({
      jobId,
      taskId: jobId,
      status: 'DONE',
      verdict: 'PASS',
      completedAt: '2026-07-16T15:59:59.000Z',
      sourceHeadAfter: 'a'.repeat(40),
    })}\n`);

    let publishedInput = null;
    const result = await observeRemoteCodexTaskVisibility({
      paths,
      now: new Date('2026-07-16T16:00:00.000Z'),
      processIsAliveFn: () => false,
      publisher: async (_root, input) => {
        publishedInput = input;
        return { ok: true, slice: { state: REMOTE_CODEX_VISIBILITY_STATES.RESULT_READY } };
      },
      mirrorPublisher,
    });

    assert.equal(result.resultAvailable, true);
    assert.equal(result.taskState, REMOTE_CODEX_VISIBILITY_STATES.RESULT_READY);
    assert.equal(publishedInput.status, 'DONE');
    assert.equal(publishedInput.resultVerdict, 'PASS');
  });
});

test('workspace success with mirror failure remains a truthful incomplete visibility result', async () => {
  await withFixture(async (paths) => {
    const jobId = 'codex-job-mirror-blocked';
    await writeFile(paths.currentTaskPath, `${JSON.stringify({
      jobId,
      taskId: jobId,
      issueNumber: 1506,
      status: 'RUNNING',
      workerPid: 7788,
      heartbeatUtc: '2026-07-16T15:59:50.000Z',
      proofRefs: [`proof/${jobId}.json`, `receipts/${jobId}.json`],
    })}\n`);

    const result = await observeRemoteCodexTaskVisibility({
      paths,
      now: new Date('2026-07-16T16:00:00.000Z'),
      processIsAliveFn: () => true,
      publisher: async () => ({ ok: true, reason: 'PUBLISHED', slice: { state: REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT } }),
      mirrorPublisher: async () => ({ ok: false, reason: 'GH_CLI_NOT_INSTALLED' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.workspacePublished, true);
    assert.equal(result.mirrorPublished, false);
    assert.equal(result.mirrorReason, 'GH_CLI_NOT_INSTALLED');
  });
});
