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
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date().toISOString(),
} = {}) {
  const once = argv.includes('--once');
  const intervalMs = Number.parseInt(env.STEPHANOS_MISSION_WORKER_INTERVAL_MS || '2000', 10);
  const heartbeatIntervalMs = Math.max(
    Number.parseInt(env.STEPHANOS_MISSION_WORKER_HEARTBEAT_INTERVAL_MS || '30000', 10) || 30000,
    1000,
  );
  let exitCode = 0;
  do {
    const checkedAt = now();
    let lastTickVerdict = 'MISSION_WORKER_TICK_PASS';
    let heartbeatWriteFailed = false;
    let heartbeatWrites = Promise.resolve();

    const queueHeartbeat = (lastTickVerdictValue, timestampUtc = now()) => {
      heartbeatWrites = heartbeatWrites.then(async () => {
        try {
          await writeHeartbeat({ env, timestampUtc, lastTickVerdict: lastTickVerdictValue });
        } catch (error) {
          heartbeatWriteFailed = true;
          stderr.write(`${JSON.stringify({ checkedAt: timestampUtc, finalVerdict: 'MISSION_WORKER_HEARTBEAT_WRITE_FAILED', error: error.message })}\n`);
        }
      });
      return heartbeatWrites;
    };

    await queueHeartbeat('MISSION_WORKER_TICK_RUNNING', checkedAt);
    const heartbeatTimer = setIntervalFn(() => {
      void queueHeartbeat('MISSION_WORKER_TICK_RUNNING');
    }, heartbeatIntervalMs);

    try {
      const result = await runTick();
      stdout.write(`${JSON.stringify({ checkedAt, ...result })}\n`);
    } catch (error) {
      lastTickVerdict = 'MISSION_WORKER_TICK_FAILED';
      stderr.write(`${JSON.stringify({ checkedAt, finalVerdict: lastTickVerdict, error: error.message })}\n`);
      if (once) exitCode = 1;
    } finally {
      clearIntervalFn(heartbeatTimer);
      await heartbeatWrites;
    }

    await queueHeartbeat(lastTickVerdict);
    if (heartbeatWriteFailed && once) exitCode = 1;

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
