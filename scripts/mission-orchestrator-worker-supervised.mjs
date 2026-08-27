#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureBattleBridgeGitHubCommandMailbox } from '../shared/agents/battleBridgeGitHubCommandMailboxBootstrap.mjs';
import { runDurableFlywheelStartupCycle } from '../shared/agents/durableFlywheelControllerVNext.mjs';
import { runMissionWorkerTick } from './mission-orchestrator-worker.mjs';
import { writeMissionWorkerHeartbeat } from './mission-orchestrator-worker-heartbeat.mjs';

export const MISSION_WORKER_LOG_PROJECTION_SCHEMA = 'stephanos.mission-worker-log-projection.v1';
export const MISSION_WORKER_LOG_MAX_BYTES = 1_024;

function ownData(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(value, maximumEncodedBytes = 96) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  let encodedBytes = 0;
  let output = '';
  for (const character of normalized) {
    const encodedCharacter = JSON.stringify(character).slice(1, -1);
    const nextBytes = Buffer.byteLength(encodedCharacter);
    if (encodedBytes + nextBytes > maximumEncodedBytes) break;
    output += character;
    encodedBytes += nextBytes;
  }
  return output;
}

function boundedTextList(value, maximumItems = 4, maximumItemEncodedBytes = 48) {
  try {
    if (!Array.isArray(value)) return [];
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
      ? lengthDescriptor.value
      : Number.NaN;
    if (!Number.isInteger(length) || length < 0 || length > maximumItems) return [];
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return [];
      const item = boundedText(descriptor.value, maximumItemEncodedBytes);
      if (item) output.push(item);
    }
    return output;
  } catch {
    return [];
  }
}

export function createMissionWorkerControllerLogProjection(controller, checkedAt) {
  const grant = ownData(controller, 'workerActionGrant');
  return Object.freeze({
    schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA,
    event: 'controller-cycle',
    checkedAt: boundedText(checkedAt, 32),
    status: boundedText(ownData(controller, 'status'), 32),
    action: boundedText(ownData(controller, 'action'), 48),
    finalVerdict: boundedText(ownData(controller, 'finalVerdict'), 64),
    allowWorkerTick: ownData(controller, 'allowWorkerTick') === true,
    blockers: Object.freeze(boundedTextList(ownData(controller, 'blockers'))),
    missionId: boundedText(ownData(grant, 'missionId'), 96),
    actionId: boundedText(ownData(grant, 'actionId'), 96),
    adapter: boundedText(ownData(grant, 'adapter'), 32),
  });
}

export function createMissionWorkerTickLogProjection(result, checkedAt) {
  const publication = ownData(result, 'publish');
  return Object.freeze({
    schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA,
    event: 'worker-tick',
    checkedAt: boundedText(checkedAt, 32),
    status: boundedText(ownData(result, 'status'), 32),
    state: boundedText(ownData(result, 'state'), 32),
    phase: boundedText(ownData(result, 'phase'), 48),
    finalVerdict: boundedText(ownData(result, 'finalVerdict'), 64),
    blocker: boundedText(ownData(result, 'blocker'), 96),
    publishOk: ownData(publication, 'ok') === true,
  });
}

function stableLogSignature(projection) {
  const { checkedAt: _checkedAt, ...stable } = projection;
  return JSON.stringify(stable);
}

export async function runSupervisedMissionWorker({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  bootstrapMailbox = ensureBattleBridgeGitHubCommandMailbox,
  runControllerCycle = runDurableFlywheelStartupCycle,
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
  let lastControllerLogSignature = '';
  let lastTickLogSignature = '';

  try {
    const mailboxBootstrap = await bootstrapMailbox({ env });
    stdout.write(`${JSON.stringify({ checkedAt: now(), ...mailboxBootstrap })}\n`);
  } catch (error) {
    stderr.write(`${JSON.stringify({
      checkedAt: now(),
      finalVerdict: 'MAILBOX_SELF_BOOTSTRAP_FAILED',
      error: error?.message || String(error),
      operatorNeeded: true,
    })}\n`);
    if (once) exitCode = 1;
  }

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
      const controller = await runControllerCycle({}, {
        env,
        nowUtc: checkedAt,
        sourceRevision: env.STEPHANOS_MISSION_WORKER_HEAD_SHA,
      });
      const controllerLog = createMissionWorkerControllerLogProjection(controller, checkedAt);
      const controllerLogSignature = stableLogSignature(controllerLog);
      if (once || controllerLogSignature !== lastControllerLogSignature) {
        stdout.write(`${JSON.stringify(controllerLog)}\n`);
        lastControllerLogSignature = controllerLogSignature;
      }
      if (controller?.allowWorkerTick === true) {
        const result = await runTick({
          env,
          actionGrant: controller.workerActionGrant,
        });
        const tickLog = createMissionWorkerTickLogProjection(result, checkedAt);
        const tickLogSignature = stableLogSignature(tickLog);
        if (once || tickLogSignature !== lastTickLogSignature) {
          stdout.write(`${JSON.stringify(tickLog)}\n`);
          lastTickLogSignature = tickLogSignature;
        }
      }
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
