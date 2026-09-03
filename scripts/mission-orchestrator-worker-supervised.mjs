#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureBattleBridgeGitHubCommandMailbox } from '../shared/agents/battleBridgeGitHubCommandMailboxBootstrap.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { runDurableFlywheelStartupCycle } from '../shared/agents/durableFlywheelControllerVNext.mjs';
import { readMissionControllerCapacityRoutingInput } from '../stephanos-server/services/programmeAuthorityService.js';
import { classifyDirt } from './battle-bridge-github-sync-policy.mjs';
import { runMissionWorkerTick } from './mission-orchestrator-worker.mjs';
import { writeMissionWorkerHeartbeat } from './mission-orchestrator-worker-heartbeat.mjs';

export const MISSION_WORKER_LOG_PROJECTION_SCHEMA = 'stephanos.mission-worker-log-projection.v1';
export const MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE = 75;
export const MISSION_WORKER_LOG_MAX_BYTES = 1_024;

const SHA_40 = /^[0-9a-f]{40}$/;
const MAX_GIT_STATUS_BYTES = 64 * 1024;
const PROGRESS_RECHECK_INTERVAL_MS = 250;
const MAX_CONSECUTIVE_PROGRESS_RECHECKS = 8;

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
    publishOk: ownData(publication, 'published') === true,
  });
}

function stableLogSignature(projection) {
  const { checkedAt: _checkedAt, ...stable } = projection;
  return JSON.stringify(stable);
}

function processResultText(result, key) {
  const value = ownData(result, key);
  return typeof value === 'string' ? value : '';
}

export function missionWorkerTickMadeProgress(result) {
  const publication = ownData(result, 'publish');
  const processing = ownData(result, 'processed');
  return ownData(publication, 'published') === true
    || ownData(processing, 'processed') === true;
}

function invalidRepositoryIdentity(blocker, overrides = {}) {
  return Object.freeze({
    valid: false,
    canonical: false,
    branch: '',
    headSha: '',
    sourceClean: false,
    worktreeClean: false,
    runtimeDirtCount: 0,
    blocker,
    ...overrides,
  });
}

function runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args }) {
  let result;
  try {
    result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repositoryRoot, ...args], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 10_000,
      maxBuffer: MAX_GIT_STATUS_BYTES,
    });
  } catch {
    return Object.freeze({ ok: false, stdout: '' });
  }
  const status = ownData(result, 'status');
  const signal = ownData(result, 'signal');
  const error = ownData(result, 'error');
  const stdout = processResultText(result, 'stdout');
  const ok = status === 0
    && signal === null
    && error === undefined
    && Buffer.byteLength(stdout, 'utf8') <= MAX_GIT_STATUS_BYTES;
  return Object.freeze({ ok, stdout: ok ? stdout : '' });
}

function parsePorcelainV2Identity(stdout) {
  let branch = '';
  let headSha = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      if (branch) return null;
      branch = line.slice('# branch.head '.length).trim();
    } else if (line.startsWith('# branch.oid ')) {
      if (headSha) return null;
      headSha = line.slice('# branch.oid '.length).trim().toLowerCase();
    }
  }
  return branch && SHA_40.test(headSha) ? Object.freeze({ branch, headSha }) : null;
}

export function inspectMissionWorkerRepositoryIdentity({
  env = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  const repositoryRoot = boundedText(env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT, 1024);
  const expectedHeadSha = boundedText(env.STEPHANOS_MISSION_WORKER_HEAD_SHA, 40).toLowerCase();
  if (!path.win32.isAbsolute(repositoryRoot) || !SHA_40.test(expectedHeadSha)) {
    return invalidRepositoryIdentity('MISSION_WORKER_LAUNCH_IDENTITY_INVALID');
  }

  const identityArgs = ['status', '--porcelain=v2', '--branch', '--untracked-files=no'];
  const identityBeforeRead = runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args: identityArgs });
  const dirtRead = runBoundedGitObservation({
    repositoryRoot,
    spawnSyncFn,
    args: ['status', '--porcelain=v1', '--untracked-files=all'],
  });
  const identityAfterRead = runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args: identityArgs });
  if (!identityBeforeRead.ok || !dirtRead.ok || !identityAfterRead.ok) {
    return invalidRepositoryIdentity('MISSION_WORKER_REPOSITORY_IDENTITY_READ_FAILED');
  }

  const identityBefore = parsePorcelainV2Identity(identityBeforeRead.stdout);
  const identityAfter = parsePorcelainV2Identity(identityAfterRead.stdout);
  if (!identityBefore || !identityAfter) {
    return invalidRepositoryIdentity('MISSION_WORKER_REPOSITORY_IDENTITY_AMBIGUOUS');
  }
  if (identityBefore.branch !== identityAfter.branch || identityBefore.headSha !== identityAfter.headSha) {
    return invalidRepositoryIdentity('MISSION_WORKER_REPOSITORY_IDENTITY_CHANGED_DURING_READ');
  }

  const dirtLines = dirtRead.stdout.split(/\r?\n/).filter(Boolean);
  const dirt = classifyDirt(dirtLines);
  const sourceClean = dirt.blocksSync === false;
  const worktreeClean = dirtLines.length === 0;
  const runtimeDirtCount = Array.isArray(dirt.runtimeOnly) ? dirt.runtimeOnly.length : 0;
  const { branch, headSha } = identityAfter;
  const canonical = branch === 'main' && headSha === expectedHeadSha && sourceClean;
  return Object.freeze({
    valid: true,
    canonical,
    branch,
    headSha,
    sourceClean,
    worktreeClean,
    runtimeDirtCount,
    blocker: canonical
      ? ''
      : branch !== 'main'
        ? 'CANONICAL_REPOSITORY_BRANCH_NOT_MAIN'
        : !sourceClean
          ? 'MISSION_WORKER_CANONICAL_SOURCE_DIRTY'
          : 'MISSION_WORKER_CANONICAL_HEAD_CHANGED',
  });
}

export function createMissionWorkerRepositoryLogProjection(identity, checkedAt, reloadRequired = false) {
  return Object.freeze({
    schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA,
    event: 'repository-identity',
    checkedAt: boundedText(checkedAt, 48),
    valid: ownData(identity, 'valid') === true,
    canonical: ownData(identity, 'canonical') === true,
    branch: boundedText(ownData(identity, 'branch'), 120),
    headSha: boundedText(ownData(identity, 'headSha'), 40).toLowerCase(),
    sourceClean: ownData(identity, 'sourceClean') === true,
    worktreeClean: ownData(identity, 'worktreeClean') === true,
    runtimeDirtCount: Number.isInteger(ownData(identity, 'runtimeDirtCount'))
      ? Math.max(0, Math.min(ownData(identity, 'runtimeDirtCount'), 10_000))
      : 0,
    reloadRequired,
    blocker: boundedText(ownData(identity, 'blocker'), 160),
  });
}

export async function runSupervisedMissionWorker({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  bootstrapMailbox = ensureBattleBridgeGitHubCommandMailbox,
  runControllerCycle = runDurableFlywheelStartupCycle,
  loadCapacityRoutingInput = readMissionControllerCapacityRoutingInput,
  runTick = runMissionWorkerTick,
  writeHeartbeat = writeMissionWorkerHeartbeat,
  inspectRepositoryIdentity = inspectMissionWorkerRepositoryIdentity,
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
  let lastRepositoryLogSignature = '';
  let lastTickLogSignature = '';
  let repositoryDriftObserved = false;
  let consecutiveProgressRechecks = 0;
  let mailboxBootstrapPending = true;

  do {
    const checkedAt = now();
    let identity;
    try {
      identity = await inspectRepositoryIdentity({ env });
    } catch {
      identity = Object.freeze({
        valid: false,
        canonical: false,
        branch: '',
        headSha: '',
        sourceClean: false,
        worktreeClean: false,
        runtimeDirtCount: 0,
        blocker: 'MISSION_WORKER_REPOSITORY_IDENTITY_READ_FAILED',
      });
    }
    const identityValid = ownData(identity, 'valid') === true;
    const identityCanonical = ownData(identity, 'canonical') === true;
    const observedBranch = boundedText(ownData(identity, 'branch'), 120);
    const observedHeadSha = boundedText(ownData(identity, 'headSha'), 40).toLowerCase();
    const observedSourceClean = ownData(identity, 'sourceClean') === true;
    const expectedHeadSha = boundedText(env.STEPHANOS_MISSION_WORKER_HEAD_SHA, 40).toLowerCase();
    const recoveredLaunchIdentity = identityValid
      && observedBranch === 'main'
      && observedHeadSha === expectedHeadSha
      && observedSourceClean;
    const changedCanonicalHead = identityValid
      && observedBranch === 'main'
      && SHA_40.test(observedHeadSha)
      && observedHeadSha !== expectedHeadSha
      && observedSourceClean;
    const reloadRequired = changedCanonicalHead || (repositoryDriftObserved && recoveredLaunchIdentity);
    const repositoryLog = createMissionWorkerRepositoryLogProjection(identity, checkedAt, reloadRequired);
    const repositoryLogSignature = stableLogSignature(repositoryLog);
    if (once || repositoryLogSignature !== lastRepositoryLogSignature) {
      stdout.write(`${JSON.stringify(repositoryLog)}\n`);
      lastRepositoryLogSignature = repositoryLogSignature;
    }
    if (reloadRequired) {
      stderr.write(`${JSON.stringify({
        schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA,
        event: 'worker-reload',
        checkedAt,
        finalVerdict: 'MISSION_WORKER_CANONICAL_RELOAD_REQUIRED',
        exitCode: MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE,
      })}\n`);
      return MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE;
    }
    if (identityValid && !identityCanonical) repositoryDriftObserved = true;
    if (!identityCanonical) {
      consecutiveProgressRechecks = 0;
      if (once) return 0;
      await sleep(Math.max(Number.isFinite(intervalMs) ? intervalMs : 2000, 250));
      continue;
    }
    let lastTickVerdict = 'MISSION_WORKER_TICK_PASS';
    let heartbeatWriteFailed = false;
    let heartbeatWrites = Promise.resolve();
    let tickMadeProgress = false;

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
      if (mailboxBootstrapPending) {
        mailboxBootstrapPending = false;
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
      }

      const capacityRoutingOptions = {
        root: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
        repoRoot: env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT,
        nowUtc: checkedAt,
      };
      const controller = await runControllerCycle({}, {
        env,
        ...capacityRoutingOptions,
        sourceRevision: env.STEPHANOS_MISSION_WORKER_HEAD_SHA,
      });
      const controllerLog = createMissionWorkerControllerLogProjection(controller, checkedAt);
      const controllerLogSignature = stableLogSignature(controllerLog);
      if (once || controllerLogSignature !== lastControllerLogSignature) {
        stdout.write(`${JSON.stringify(controllerLog)}\n`);
        lastControllerLogSignature = controllerLogSignature;
      }
      if (controller?.allowWorkerTick === true) {
        const capacityRoute = boundedText(ownData(controller?.workerActionGrant, 'capacityRoute'), 48);
        const capacityRouting = capacityRoute
          ? await loadCapacityRoutingInput(capacityRoutingOptions)
          : undefined;
        const result = await runTick({
          env,
          actionGrant: controller.workerActionGrant,
          capacityRouting,
        });
        tickMadeProgress = missionWorkerTickMadeProgress(result);
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

    if (!once) {
      const steadyDelayMs = Math.max(Number.isFinite(intervalMs) ? intervalMs : 2000, 250);
      let delayMs = steadyDelayMs;
      if (tickMadeProgress && consecutiveProgressRechecks < MAX_CONSECUTIVE_PROGRESS_RECHECKS) {
        consecutiveProgressRechecks += 1;
        delayMs = PROGRESS_RECHECK_INTERVAL_MS;
      } else {
        consecutiveProgressRechecks = 0;
      }
      await sleep(delayMs);
    }
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
