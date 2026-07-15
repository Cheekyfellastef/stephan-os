#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runMissionWorkerTick } from './mission-orchestrator-worker.mjs';
import { writeMissionWorkerHeartbeat } from './mission-orchestrator-worker-heartbeat.mjs';

export async function runSupervisedMissionWorker({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  runTick = runMissionWorkerTick,
  writeHeartbeat = writeMissionWorkerHeartbeat,
  sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
} = {}) {
  const once = argv.includes('--once');
  const intervalMs = Number.parseInt(env.STEPHANOS_MISSION_WORKER_INTERVAL_MS || '2000', 10);
  let exitCode = 0;
  do {
    const checkedAt = new Date().toISOString();
    let lastTickVerdict = 'MISSION_WORKER_TICK_PASS';
    try {
      const result = await runTick();
      stdout.write(`${JSON.stringify({ checkedAt, ...result })}\n`);
    } catch (error) {
      lastTickVerdict = 'MISSION_WORKER_TICK_FAILED';
      stderr.write(`${JSON.stringify({ checkedAt, finalVerdict: lastTickVerdict, error: error.message })}\n`);
      if (once) exitCode = 1;
    }
    try {
      await writeHeartbeat({ env, timestampUtc: checkedAt, lastTickVerdict });
    } catch (error) {
      stderr.write(`${JSON.stringify({ checkedAt, finalVerdict: 'MISSION_WORKER_HEARTBEAT_WRITE_FAILED', error: error.message })}\n`);
      if (once) exitCode = 1;
    }
    if (!once) await sleep(Math.max(Number.isFinite(intervalMs) ? intervalMs : 2000, 250));
  } while (!once);
  return exitCode;
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  process.exitCode = await runSupervisedMissionWorker();
}
