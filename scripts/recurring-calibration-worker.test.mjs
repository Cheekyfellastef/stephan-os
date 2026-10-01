import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RECURRING_CALIBRATION_WORKER_SCHEMA,
  runRecurringCalibrationWorker,
} from './recurring-calibration-worker.mjs';

test('one-shot calibration worker runs canonical full calibration and releases its lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stephanos-calibration-worker-'));
  const workspaceRoot = path.join(root, 'workspace');
  const repoRoot = path.join(root, 'repo');
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  let calls = 0;
  try {
    const result = await runRecurringCalibrationWorker({
      env: {
        STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot,
        STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: repoRoot,
      },
      now: () => new Date('2026-09-28T21:00:00.000Z'),
      runCalibration: async (options) => {
        calls += 1;
        assert.equal(options.workspaceRoot, workspaceRoot);
        assert.equal(options.repoRoot, repoRoot);
        assert.equal(options.trigger, 'SCHEDULED');
        return {
          ok: true,
          reason: 'RECURRING_CALIBRATION_READINESS_EVALUATED',
          readiness: { dueParticipantIds: ['stephanos'] },
          receipt: { eventId: 'calibration-receipt-1' },
          publication: { ok: true },
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.schemaVersion, RECURRING_CALIBRATION_WORKER_SCHEMA);
    assert.equal(result.ok, true);
    assert.deepEqual(result.dueParticipantIds, ['stephanos']);
    assert.equal(result.receiptEventId, 'calibration-receipt-1');
    await assert.rejects(stat(path.join(workspaceRoot, 'locks', 'recurring-calibration-worker.lock')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('one-shot calibration worker skips when another calibration worker holds the lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stephanos-calibration-worker-lock-'));
  const workspaceRoot = path.join(root, 'workspace');
  const repoRoot = path.join(root, 'repo');
  const lockDir = path.join(workspaceRoot, 'locks');
  await mkdir(lockDir, { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  await writeFile(
    path.join(lockDir, 'recurring-calibration-worker.lock'),
    JSON.stringify({ pid: 123, startedAtUtc: '2026-09-28T21:00:00.000Z' }),
    'utf8',
  );
  let calls = 0;
  try {
    const result = await runRecurringCalibrationWorker({
      env: {
        STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot,
        STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: repoRoot,
      },
      now: () => new Date('2026-09-28T21:01:00.000Z'),
      runCalibration: async () => {
        calls += 1;
        return { ok: true };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CALIBRATION_WORKER_ALREADY_RUNNING');
    assert.equal(result.skipped, true);
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
