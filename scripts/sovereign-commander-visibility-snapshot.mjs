#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBattleBridgeObservation } from './battle-bridge-observation.mjs';
import { collectSovereignControllerLaneStatus } from './sovereign-controller-lane-status.mjs';
import { collectSovereignMeterStatus } from './sovereign-meter-status.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_VISIBILITY_SNAPSHOT_SCHEMA = 'stephanos.sovereign-visibility-snapshot.v1';
export const SOVEREIGN_VISIBILITY_SNAPSHOT_MARKER = 'SOVEREIGN_COMMANDER_VISIBILITY_SNAPSHOT_RESULT=';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
const coreStatusScript = resolve(repoRoot, 'scripts', 'windows', 'status-stephanos-core-daemon.ps1');

function text(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function state(value, max = 160) {
  const candidate = text(value, max).toUpperCase();
  return /^[A-Z0-9._:-]{0,160}$/.test(candidate) ? candidate : '';
}

function timestamp(value) {
  const candidate = text(value, 80);
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function integer(value, max = 1_000_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
}

function sha(value) {
  const candidate = text(value, 40).toLowerCase();
  return /^[0-9a-f]{40}$/.test(candidate) ? candidate : '';
}

function run(spawnSyncFn, executable, args, timeout = 10_000) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: 512 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
  });
}

function parseJson(raw) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function collectRepositoryVisibility({ spawnSyncFn = spawnSync, root = repoRoot } = {}) {
  const headResult = run(spawnSyncFn, git, ['-C', root, 'rev-parse', 'HEAD']);
  const branchResult = run(spawnSyncFn, git, ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const statusResult = run(spawnSyncFn, git, ['-C', root, 'status', '--porcelain=v1', '--untracked-files=normal']);
  const head = headResult.ok ? sha(headResult.stdout) : '';
  const branch = branchResult.ok ? text(branchResult.stdout, 120) : '';
  const statusLines = statusResult.ok
    ? statusResult.stdout.split(/\r?\n/).filter((line) => line.length >= 2)
    : [];
  const untrackedCount = statusLines.filter((line) => line.startsWith('??')).length;
  const trackedChangeCount = Math.max(0, statusLines.length - untrackedCount);
  return Object.freeze({
    available: Boolean(head),
    head,
    branch: /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(branch) ? branch : '',
    dirty: statusLines.length > 0,
    changedEntryCount: statusLines.length,
    trackedChangeCount,
    untrackedCount,
    rawPathsReturned: false,
  });
}

export function collectCoreDaemonVisibility({ spawnSyncFn = spawnSync } = {}) {
  const result = run(spawnSyncFn, powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', coreStatusScript,
  ]);
  const parsed = result.ok ? parseJson(result.stdout) : null;
  if (!parsed || parsed.schemaVersion !== 'stephanos.core-daemon-status.v1') {
    return Object.freeze({ available: false, ok: false });
  }
  return Object.freeze({
    available: true,
    ok: parsed.ok === true,
    processCount: integer(parsed.processCount, 100),
    daemonHealthy: parsed.daemonHealthy === true,
    readiness: state(parsed.readiness, 40) || 'UNKNOWN',
    wakeState: state(parsed.wakeState, 40) || 'UNKNOWN',
    awake: parsed.awake === true,
    repairRequired: parsed.repairRequired !== false,
    repairReason: state(parsed.repairReason, 160),
    controlPlaneFinalVerdict: state(parsed.controlPlaneFinalVerdict, 160),
    sourceHead: sha(parsed.sourceHead),
    heartbeatAgeSeconds: integer(parsed.heartbeatAgeSeconds, 31_536_000),
    sovereignCommanderHealthy: parsed.sovereignCommanderHealthy === true,
    backendHealthy: parsed.backendHealthy === true,
    missionWorkerHealthy: parsed.missionWorkerHealthy === true,
    gamingActive: parsed.gamingActive === true,
  });
}

async function readWorkspaceStatusFile(name, { root = repoRoot, env = process.env, readFileFn = readFile } = {}) {
  const config = resolveSharedWorkspaceRuntimeConfig({ repoRoot: root, env });
  if (!config.ok) return null;
  try {
    const parsed = JSON.parse(await readFileFn(join(config.root, 'status', name), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function collectSelfHealVisibility(options = {}) {
  const parsed = await readWorkspaceStatusFile('stephanos-core-daemon-current.json', options);
  if (!parsed) return Object.freeze({ available: false });
  const hashes = Array.isArray(parsed.dependencySelfHealProofHashes)
    ? parsed.dependencySelfHealProofHashes.map(sha).filter(Boolean).slice(0, 8)
    : [];
  return Object.freeze({
    available: true,
    dependencySelfHealEnabled: parsed.dependencySelfHealEnabled === true,
    dependencySelfHealLastAttemptAtUtc: timestamp(parsed.dependencySelfHealLastAttemptAtUtc),
    dependencySelfHealAttemptCount: integer(parsed.dependencySelfHealAttemptCount, 1_000_000),
    dependencySelfHealLastVerdict: state(parsed.dependencySelfHealLastVerdict, 160),
    dependencySelfHealLastBlocker: state(parsed.dependencySelfHealLastBlocker, 160),
    dependencySelfHealProofHashes: Object.freeze(hashes),
    octopusSelfHealEnabled: parsed.octopusSelfHealEnabled === true,
    octopusSelfHealLastAttemptAtUtc: timestamp(parsed.octopusSelfHealLastAttemptAtUtc),
    octopusSelfHealAttemptCount: integer(parsed.octopusSelfHealAttemptCount, 1_000_000),
    octopusSelfHealLastVerdict: state(parsed.octopusSelfHealLastVerdict, 160),
    octopusSelfHealLastBlocker: state(parsed.octopusSelfHealLastBlocker, 160),
    octopusSelfHealLastProofHash: sha(parsed.octopusSelfHealLastProofHash),
    flywheelCycleRunning: parsed.flywheelCycleRunning === true,
    flywheelLastCycleFinishedAtUtc: timestamp(parsed.flywheelLastCycleFinishedAtUtc),
    flywheelLastStatus: state(parsed.flywheelLastStatus, 120),
    flywheelLastAction: state(parsed.flywheelLastAction, 120),
    flywheelLastBlockerCount: integer(parsed.flywheelLastBlockerCount, 1_000_000),
  });
}

export async function collectRelayVisibility(options = {}) {
  const parsed = await readWorkspaceStatusFile('sovereign-relay-current.json', options);
  if (!parsed || parsed.schemaVersion !== 'stephanos.sovereign-relay-daemon.v1') {
    return Object.freeze({ available: false, daemonHealthy: false, carrierHealthy: false });
  }
  const heartbeatAtUtc = timestamp(parsed.heartbeatAtUtc);
  const nowMs = options?.now instanceof Date ? options.now.getTime() : Date.now();
  const heartbeatMs = heartbeatAtUtc ? Date.parse(heartbeatAtUtc) : NaN;
  const heartbeatAgeSeconds = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.floor((nowMs - heartbeatMs) / 1000))
    : null;
  return Object.freeze({
    available: true,
    daemonHealthy: parsed.daemonHealthy === true,
    carrierHealthy: parsed.carrierHealthy === true,
    deliveryState: state(parsed.deliveryState, 80),
    adaptivePollMode: state(parsed.adaptivePollMode, 40),
    nextPollMs: integer(parsed.nextPollMs, 60_000),
    heartbeatAtUtc,
    heartbeatAgeSeconds,
    carrierConsecutiveFailures: integer(parsed.carrierConsecutiveFailures, 1_000_000),
    scheduledMailboxFallbackExpected: parsed.scheduledMailboxFallbackExpected === true,
    fallbackCovered: parsed.fallbackCovered === true,
    retryIdentityPreserved: parsed.retryIdentityPreserved === true,
    blocker: state(parsed.blocker, 160),
    finalVerdict: state(parsed.finalVerdict, 120),
  });
}

function trafficLightFromServices(services = {}) {
  const commander = services?.['sovereign-commander'];
  const backend = services?.backend;
  if (commander?.ready !== true || backend?.ready !== true) return 'RED';
  if (services?.ui?.ready !== true || services?.openclaw?.ready !== true) return 'AMBER';
  return 'GREEN';
}

export function buildSovereignVisibilitySnapshot({
  capturedAtUtc = new Date().toISOString(),
  repository = {},
  observation = {},
  core = {},
  selfHeal = {},
  controllers = {},
  meters = {},
  relay = {},
} = {}) {
  const repositoryLight = !repository?.available
    ? 'RED'
    : (repository?.branch !== 'main' || repository?.dirty === true ? 'AMBER' : 'GREEN');
  const coreLight = core?.available === true
    && core?.ok === true
    && core?.daemonHealthy === true
    && core?.readiness === 'READY'
    && core?.wakeState === 'AWAKE'
    && core?.awake === true
    && core?.repairRequired === false
    && core?.sourceHead === repository?.head
    && Number.isInteger(core?.heartbeatAgeSeconds)
    && core.heartbeatAgeSeconds <= 60
    ? 'GREEN'
    : 'RED';
  const servicesLight = trafficLightFromServices(observation?.services);
  const lanesLight = ['GREEN', 'AMBER', 'RED', 'GREY'].includes(controllers?.lanes?.refillHealth)
    ? controllers.lanes.refillHealth
    : 'GREY';
  const transportLight = relay?.available === true
    && relay?.daemonHealthy === true
    && Number.isInteger(relay?.heartbeatAgeSeconds)
    && relay.heartbeatAgeSeconds <= 30
    ? (relay?.carrierHealthy === true ? 'GREEN' : 'AMBER')
    : 'AMBER';
  const lights = [repositoryLight, coreLight, servicesLight, lanesLight, transportLight];
  const finalVerdict = lights.includes('RED')
    ? 'SOVEREIGN_VISIBILITY_SNAPSHOT_ATTENTION_REQUIRED'
    : (lights.some((light) => light !== 'GREEN')
      ? 'SOVEREIGN_VISIBILITY_SNAPSHOT_DEGRADED_OR_INCOMPLETE'
      : 'SOVEREIGN_VISIBILITY_SNAPSHOT_READY');

  return Object.freeze({
    schemaVersion: SOVEREIGN_VISIBILITY_SNAPSHOT_SCHEMA,
    ok: true,
    capturedAtUtc: timestamp(capturedAtUtc),
    repository,
    observation,
    core,
    selfHeal,
    controllers,
    meters,
    relay,
    health: Object.freeze({
      repository: repositoryLight,
      core: coreLight,
      services: servicesLight,
      laneRefill: lanesLight,
      transport: transportLight,
    }),
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryProcessInspectionAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    remoteCommanderRequired: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

export async function collectSovereignVisibilitySnapshot({
  spawnSyncFn = spawnSync,
  env = process.env,
  now = () => new Date(),
  readFileFn = readFile,
  battleBridgeCollector = collectBattleBridgeObservation,
  controllerCollector = collectSovereignControllerLaneStatus,
  meterCollector = collectSovereignMeterStatus,
} = {}) {
  const current = now();
  const [observation, controllers, meters, selfHeal, relay] = await Promise.all([
    battleBridgeCollector({ spawnSyncFn, env, now: () => current }),
    controllerCollector({ env, now: () => current }),
    meterCollector({ env, spawnSyncFn, now: () => current }),
    collectSelfHealVisibility({ env, readFileFn, now: current }),
    collectRelayVisibility({ env, readFileFn, now: current }),
  ]);
  const repository = collectRepositoryVisibility({ spawnSyncFn });
  const core = collectCoreDaemonVisibility({ spawnSyncFn });
  return buildSovereignVisibilitySnapshot({
    capturedAtUtc: current.toISOString(),
    repository,
    observation,
    core,
    selfHeal,
    controllers,
    meters,
    relay,
  });
}

export async function runSovereignVisibilitySnapshot(options = {}) {
  const snapshot = await collectSovereignVisibilitySnapshot(options);
  process.stdout.write(`${SOVEREIGN_VISIBILITY_SNAPSHOT_MARKER}${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSovereignVisibilitySnapshot().catch((error) => {
    process.stderr.write(`${text(error?.message || error, 240)}\n`);
    process.exitCode = 1;
  });
}
