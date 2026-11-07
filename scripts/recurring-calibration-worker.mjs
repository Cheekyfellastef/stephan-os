#!/usr/bin/env node
import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { runRecurringCalibrationReadinessV1 } from '../shared/agents/recurringCalibrationRunnerV1.mjs';

export const RECURRING_CALIBRATION_WORKER_SCHEMA = 'stephanos.recurring-calibration-worker.v1';
export const RECURRING_CALIBRATION_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

async function acquireSingleFlightLock(lockPath, nowMs) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({
        schemaVersion: RECURRING_CALIBRATION_WORKER_SCHEMA,
        pid: process.pid,
        startedAtUtc: new Date(nowMs).toISOString(),
      }) + '\n', 'utf8');
      return handle;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let lockStat = null;
      try { lockStat = await stat(lockPath); } catch {}
      if (!lockStat || nowMs - lockStat.mtimeMs <= RECURRING_CALIBRATION_LOCK_STALE_MS) return null;
      await rm(lockPath, { force: true });
    }
  }
  return null;
}

export async function runRecurringCalibrationWorker({
  env = process.env,
  runCalibration = runRecurringCalibrationReadinessV1,
  now = () => new Date(),
} = {}) {
  const repoRoot = String(env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT || process.cwd()).trim();
  const workspaceRoot = String(env.STEPHANOS_SHARED_AGENT_WORKSPACE || '').trim();
  if (!repoRoot || !workspaceRoot) {
    return Object.freeze({
      schemaVersion: RECURRING_CALIBRATION_WORKER_SCHEMA,
      ok: false,
      reason: 'CALIBRATION_WORKER_PATHS_UNAVAILABLE',
    });
  }

  const nowDate = now();
  const nowMs = nowDate instanceof Date ? nowDate.getTime() : Date.parse(String(nowDate));
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const lockPath = path.join(workspaceRoot, 'locks', 'recurring-calibration-worker.lock');
  const lockHandle = await acquireSingleFlightLock(lockPath, safeNowMs);
  if (!lockHandle) {
    return Object.freeze({
      schemaVersion: RECURRING_CALIBRATION_WORKER_SCHEMA,
      ok: true,
      reason: 'CALIBRATION_WORKER_ALREADY_RUNNING',
      skipped: true,
    });
  }

  try {
    const result = await runCalibration({
      root: workspaceRoot,
      workspaceRoot,
      repoRoot,
      nowUtc: new Date(safeNowMs).toISOString(),
      trigger: 'SCHEDULED',
    });
    return Object.freeze({
      schemaVersion: RECURRING_CALIBRATION_WORKER_SCHEMA,
      ok: result?.ok === true,
      reason: result?.reason || 'CALIBRATION_WORKER_COMPLETED',
      skipped: false,
      dueParticipantIds: Array.isArray(result?.readiness?.dueParticipantIds)
        ? Object.freeze([...result.readiness.dueParticipantIds])
        : Object.freeze([]),
      receiptEventId: result?.receipt?.eventId || '',
      publicationOk: result?.publication?.ok === true,
    });
  } finally {
    await lockHandle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

async function main() {
  try {
    const result = await runRecurringCalibrationWorker();
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.ok === true ? 0 : 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      schemaVersion: RECURRING_CALIBRATION_WORKER_SCHEMA,
      ok: false,
      reason: 'CALIBRATION_WORKER_FAILED',
      error: error?.message || String(error),
    }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
