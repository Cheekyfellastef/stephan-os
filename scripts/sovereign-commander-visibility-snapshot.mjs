#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBattleBridgeObservation } from './battle-bridge-observation.mjs';
import { collectSovereignControllerLaneStatus } from './sovereign-controller-lane-status.mjs';
import { collectSovereignMeterStatus } from './sovereign-meter-status.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { projectMaintenanceCustodyVisibilityV1, maintenanceCustodyVisibilityLightV1 } from '../shared/agents/maintenanceCustodyVisibilityV1.mjs';

export const SOVEREIGN_VISIBILITY_SNAPSHOT_SCHEMA = 'stephanos.sovereign-visibility-snapshot.v1';
export const SOVEREIGN_VISIBILITY_SNAPSHOT_MARKER = 'SOVEREIGN_COMMANDER_VISIBILITY_SNAPSHOT_RESULT=';
export const SOVEREIGN_VISIBILITY_SNAPSHOT_MAX_BYTES = 12 * 1024;

// The Core heartbeat is a separate process projection. It cannot speak for
// the maintenance executor's live timeout hold, even at the same source head.
export async function collectMaintenanceCustodyVisibility({ fetchFn = fetch } = {}) {
  const unknown = Object.freeze({ available: false, state: 'UNKNOWN',
    blocker: 'LIVE_MAINTENANCE_CUSTODY_UNPROVEN', executionAuthority: false });
  try {
    const response = await fetchFn('http://127.0.0.1:18791/health', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(1500),
      headers: { accept: 'application/json' },
    });
    if (!response.ok || !response.body?.getReader) return unknown;
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) return unknown;
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const guardian = health?.continuousRepairGuardian;
    const persistent = guardian?.persistentCustody;
    if (health?.service !== 'stephanos-sovereign-commander' || health.ok !== true
      || typeof guardian?.timeoutCustodyHeld !== 'boolean'
      || typeof guardian.running !== 'boolean' || typeof guardian.maintenanceInFlight !== 'boolean'
      || typeof persistent?.held !== 'boolean' || typeof persistent.blocker !== 'string'
      || !/^[A-Z0-9_]{0,120}$/.test(persistent.blocker)) return unknown;
    const held = guardian.timeoutCustodyHeld || persistent.held;
    const blocker = state(persistent.blocker, 120);
    return projectMaintenanceCustodyVisibilityV1({ available: true,
      state: held ? 'HELD' : blocker ? 'UNKNOWN' : 'NOT_HELD_REPORTED',
      timeoutCustodyHeld: guardian.timeoutCustodyHeld, persistentHeld: persistent.held,
      running: guardian.running, maintenanceInFlight: guardian.maintenanceInFlight,
      lastCycleId: /^[a-zA-Z0-9._:-]{1,120}$/.test(guardian.lastCycleId || '') ? guardian.lastCycleId : '',
      blocker: blocker || (held ? state(guardian.lastBlocker, 120) || 'MAINTENANCE_CUSTODY_HELD' : ''),
      evidenceSource: 'LIVE_MAINTENANCE_OWNER_HEALTH', executionAuthority: false,
    });
  } catch { return unknown; }
}

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

function sha256(value) {
  const candidate = text(value, 64).toLowerCase();
  return /^[0-9a-f]{64}$/.test(candidate) ? candidate : '';
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
  const remoteMainResult = run(
    spawnSyncFn,
    git,
    ['-C', root, 'ls-remote', '--heads', 'origin', 'refs/heads/main'],
    5_000,
  );
  const head = headResult.ok ? sha(headResult.stdout) : '';
  const branch = branchResult.ok ? text(branchResult.stdout, 120) : '';
  const remoteMainHead = remoteMainResult.ok
    ? sha(String(remoteMainResult.stdout || '').trim().split(/\s+/)[0])
    : '';
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
    remoteMainAvailable: Boolean(remoteMainHead),
    remoteMainHead,
    rawPathsReturned: false,
  });
}

export function buildHeadSyncVisibility({ repository = {}, core = {} } = {}) {
  const canonicalMainHead = sha(repository?.remoteMainHead);
  const repositoryHead = sha(repository?.head);
  const runtimeHead = sha(core?.sourceHead);
  const remoteMainAvailable = repository?.remoteMainAvailable === true && Boolean(canonicalMainHead);
  const repositoryMatchesMain = Boolean(remoteMainAvailable && repositoryHead && repositoryHead === canonicalMainHead);
  const runtimeMatchesRepository = Boolean(runtimeHead && repositoryHead && runtimeHead === repositoryHead);
  const runtimeMatchesMain = Boolean(remoteMainAvailable && runtimeHead && runtimeHead === canonicalMainHead);

  let syncState = 'REMOTE_MAIN_UNKNOWN';
  let trafficLight = 'AMBER';
  let exactNextAction = 'REFRESH_REMOTE_MAIN_PROOF';

  if (remoteMainAvailable && !repositoryHead) {
    syncState = 'REPOSITORY_HEAD_UNKNOWN';
    trafficLight = 'RED';
    exactNextAction = 'REPAIR_REPOSITORY_VISIBILITY';
  } else if (remoteMainAvailable && repositoryHead !== canonicalMainHead) {
    syncState = 'REPOSITORY_DRIFT';
    trafficLight = 'RED';
    exactNextAction = 'SYNC_REPOSITORY_TO_MAIN';
  } else if (remoteMainAvailable && repositoryMatchesMain && !runtimeHead) {
    syncState = 'RUNTIME_HEAD_UNKNOWN';
    trafficLight = 'RED';
    exactNextAction = 'REPAIR_RUNTIME_HEAD_VISIBILITY';
  } else if (remoteMainAvailable && repositoryMatchesMain && runtimeHead !== canonicalMainHead) {
    syncState = 'RUNTIME_DRIFT';
    trafficLight = 'RED';
    exactNextAction = 'RELOAD_RUNTIME_AT_REPOSITORY_HEAD';
  } else if (remoteMainAvailable && repositoryMatchesMain && runtimeMatchesMain) {
    syncState = 'CURRENT';
    trafficLight = 'GREEN';
    exactNextAction = 'NONE';
  }

  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-head-sync.v1',
    canonicalMainHead,
    repositoryHead,
    runtimeHead,
    remoteMainAvailable,
    repositoryMatchesMain,
    runtimeMatchesRepository,
    runtimeMatchesMain,
    exactHeadChainProven: syncState === 'CURRENT',
    mainChangedSinceRepository: Boolean(remoteMainAvailable && repositoryHead && !repositoryMatchesMain),
    mainChangedSinceRuntime: Boolean(remoteMainAvailable && runtimeHead && !runtimeMatchesMain),
    syncState,
    trafficLight,
    exactNextAction,
    readOnly: true,
    sourceMutationAllowed: false,
    unknownMeansGreen: false,
    finalVerdict: `SOVEREIGN_HEAD_SYNC_${syncState}`,
  });
}

export function collectCoreDaemonVisibility({ spawnSyncFn = spawnSync } = {}) {
  const result = run(spawnSyncFn, powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', coreStatusScript,
  ]);
  const parsed = result.ok ? parseJson(result.stdout) : null;
  if (!parsed || parsed.schemaVersion !== 'stephanos.core-daemon-status.v1') {
    return Object.freeze({ schemaVersion: 'stephanos.core-daemon-status.v1', available: false, ok: false });
  }
  return Object.freeze({
    schemaVersion: 'stephanos.core-daemon-status.v1',
    available: true,
    ok: parsed.ok === true && parsed.processInventoryComplete === true && parsed.processCount === 1,
    processCount: parsed.processInventoryComplete === true && typeof parsed.processCount === 'number'
      ? integer(parsed.processCount, 100) : null,
    processInventoryComplete: parsed.processInventoryComplete === true,
    processObservationBlocker: state(parsed.processObservationBlocker, 120),
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
    ? parsed.dependencySelfHealProofHashes.map(sha256).filter(Boolean).slice(0, 8)
    : [];
  return Object.freeze({
    available: true,
    outerBridgeRunCount: integer(parsed.outerBridgeRunCount, 1_000_000),
    outerBridgeInFlight: parsed.outerBridgeInFlight === true,
    outerBridgeLastPublicationOk: parsed.outerBridgeLastPublicationOk === true,
    outerBridgeLastStage: state(parsed.outerBridgeLastStage, 80) || 'NOT_OBSERVED',
    outerBridgeLastBlocker: state(parsed.outerBridgeLastBlocker, 120) || 'NOT_OBSERVED',
    outerBridgeLastVerdict: state(parsed.outerBridgeLastVerdict, 120) || 'NOT_RUN',
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
    octopusSelfHealLastProofHash: sha256(parsed.octopusSelfHealLastProofHash),
    flywheelCycleRunning: parsed.flywheelCycleRunning === true,
    flywheelLastCycleFinishedAtUtc: timestamp(parsed.flywheelLastCycleFinishedAtUtc),
    flywheelLastStatus: state(parsed.flywheelLastStatus, 120),
    flywheelLastAction: state(parsed.flywheelLastAction, 120),
    flywheelLastBlockerCount: integer(parsed.flywheelLastBlockerCount, 1_000_000),
  });
}

// Observe the already-running Core Daemon bridge without creating a
// recovery task, touching the original source lease or exposing raw workspace.
export async function collectSovereignOuterBridgeVisibility(options = {}) {
  const parsed = await readWorkspaceStatusFile('sovereign-outer-bridge-current.json', options);
  const bridge = parsed?.bridge;
  const unknown = Object.freeze({
    available: false, current: false, exactHeadMatch: false, cycleAgeSeconds: null,
    sourceHead: '', stage: 'UNVERIFIED', rescueBlocker: 'OUTER_BRIDGE_STATUS_NOT_PROVEN',
    canonicalLeaseReleaseProven: false, physicalPickupProven: false,
    twoUnattendedRefillsProven: false, canonicalHandbackEligible: false,
    oneCanonicalLeaseAuthority: true, readOnly: true,
  });
  if (parsed?.statusId !== 'sovereign-outer-bridge-current'
    || parsed?.participantId !== 'stephanos-core-daemon'
    || parsed?.status !== 'HELD'
    || bridge?.schemaVersion !== 'stephanos.sovereign-outer-bridge.v1'
    || bridge?.sourceMutationAllowed !== false
    || bridge?.leaseSeizureAllowed !== false
    || bridge?.duplicateSchedulerAllowed !== false
    || bridge?.mergeAuthority !== false) return unknown;
  const observedAtUtc = timestamp(bridge.observedAtUtc);
  const statusTimestampUtc = timestamp(parsed.timestampUtc);
  const nowMs = options?.now instanceof Date ? options.now.getTime() : Date.now();
  const ageMs = observedAtUtc ? nowMs - Date.parse(observedAtUtc) : NaN;
  const current = Boolean(statusTimestampUtc && observedAtUtc
    && statusTimestampUtc === observedAtUtc && Number.isFinite(ageMs)
    && ageMs >= 0 && ageMs <= 3 * 60_000);
  const sourceHead = sha(bridge.sourceHead);
  const stage = state(bridge.stage, 80);
  const known = ['OUTER_BRIDGE_WIDE','OUTER_BRIDGE_NARROWING_LEASE',
    'OUTER_BRIDGE_NARROWING_PICKUP','CANONICAL_REJOIN_READY'];
  const allowedStage = known.includes(stage) ? stage : 'UNVERIFIED';
  return Object.freeze({
    available: true, current,
    observedAtUtc, cycleAgeSeconds: Number.isFinite(ageMs) && ageMs >= 0
      ? Math.floor(ageMs / 1000) : null,
    sourceHead, exactHeadMatch: false, // proven only by the caller's exact local source
    stage: allowedStage,
    rescueBlocker: state(bridge.rescueBlocker, 120) || 'OUTER_BRIDGE_BLOCKER_UNVERIFIED',
    // Be conservative: local source and current cycle are independently required.
    canonicalLeaseReleaseProven: current && bridge.canonicalLeaseReleaseProven === true,
    physicalPickupProven: false,
    twoUnattendedRefillsProven: false,
    canonicalHandbackEligible: false,
    oneCanonicalLeaseAuthority: bridge.oneCanonicalLeaseAuthority === true,
    readOnly: true,
  });
}

export async function collectRelayVisibility(options = {}) {
  const parsed = await readWorkspaceStatusFile('sovereign-relay-current.json', options);
  if (!parsed || ![
    parsed.schema,
    parsed.schemaVersion,
  ].includes('stephanos.sovereign-relay-daemon.v1')) {
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

function compactObservation(observation = {}) {
  const safeLoadedModels = Object.freeze((Array.isArray(observation?.ollama?.loadedModels)
    ? observation.ollama.loadedModels
    : [])
    .slice(0, 4)
    .map((model) => Object.freeze({
      name: text(model?.name, 120),
      sizeBytes: integer(model?.sizeBytes, Number.MAX_SAFE_INTEGER),
      sizeVramBytes: integer(model?.sizeVramBytes, Number.MAX_SAFE_INTEGER),
      contextLength: integer(model?.contextLength, 10_000_000),
    })));
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: observation?.ok === true,
    capturedAtUtc: timestamp(observation?.capturedAtUtc),
    hostRole: observation?.hostRole === 'battle-bridge' ? 'battle-bridge' : '',
    uptimeSeconds: integer(observation?.uptimeSeconds, Number.MAX_SAFE_INTEGER),
    memory: Object.freeze({
      totalBytes: integer(observation?.memory?.totalBytes, Number.MAX_SAFE_INTEGER),
      freeBytes: integer(observation?.memory?.freeBytes, Number.MAX_SAFE_INTEGER),
      usedBytes: integer(observation?.memory?.usedBytes, Number.MAX_SAFE_INTEGER),
    }),
    gpu: Object.freeze({
      available: observation?.gpu?.available === true,
      name: text(observation?.gpu?.name, 120),
      memoryTotalMiB: integer(observation?.gpu?.memoryTotalMiB, 1_000_000),
      memoryUsedMiB: integer(observation?.gpu?.memoryUsedMiB, 1_000_000),
      memoryFreeMiB: integer(observation?.gpu?.memoryFreeMiB, 1_000_000),
      utilizationGpuPercent: integer(observation?.gpu?.utilizationGpuPercent, 100),
    }),
    ollama: Object.freeze({
      reachable: observation?.ollama?.reachable === true,
      installedModelCount: integer(observation?.ollama?.installedModelCount, 10_000),
      loadedModelCount: integer(observation?.ollama?.loadedModelCount, 10_000),
      installedModelsTruncated: true,
      loadedModelsTruncated: Number(observation?.ollama?.loadedModelCount || 0) > safeLoadedModels.length,
      installedModels: Object.freeze([]),
      loadedModels: safeLoadedModels,
    }),
    services: Object.freeze(Object.fromEntries(
      ['ui', 'backend', 'openclaw', 'sovereign-commander', 'ollama']
        .map((id) => [id, Object.freeze({
          reachable: observation?.services?.[id]?.reachable === true,
          ready: observation?.services?.[id]?.ready === true,
          httpStatus: integer(observation?.services?.[id]?.httpStatus, 599) ?? 0,
        })]),
    )),
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: observation?.finalVerdict === 'BATTLE_BRIDGE_OBSERVATION_READY'
      ? 'BATTLE_BRIDGE_OBSERVATION_READY'
      : '',
  });
}

function compactControllers(controllers = {}) {
  const physicalControllers = Object.freeze((Array.isArray(controllers?.physical?.controllers)
    ? controllers.physical.controllers
    : [])
    .slice(0, 5)
    .map((controller) => Object.freeze({
      controllerId: text(controller?.controllerId, 80),
      title: text(controller?.title, 120),
      freshness: state(controller?.freshness, 40) || 'UNKNOWN',
      activityState: state(controller?.activityState, 80) || 'UNKNOWN',
      trafficLight: state(controller?.trafficLight, 20) || 'UNKNOWN',
      materialLaneCount: integer(controller?.materialLaneCount, 100_000),
      activeLaneCount: integer(controller?.activeLaneCount, 100_000),
      parkedLaneCount: integer(controller?.parkedLaneCount, 100_000),
      safeEligibleWorkRemaining: integer(controller?.safeEligibleWorkRemaining, 1_000_000),
      blocker: state(controller?.blocker, 120),
    })));
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: controllers?.ok === true,
    capturedAtUtc: timestamp(controllers?.capturedAtUtc),
    physical: Object.freeze({
      expected: integer(controllers?.physical?.expected, 100),
      building: integer(controllers?.physical?.building, 100),
      amber: integer(controllers?.physical?.amber, 100),
      red: integer(controllers?.physical?.red, 100),
      unknown: integer(controllers?.physical?.unknown, 100),
      allCurrent: controllers?.physical?.allCurrent === true,
      allObservedEnabled: controllers?.physical?.allObservedEnabled === true,
      finalVerdict: state(controllers?.physical?.finalVerdict, 120) || 'UNKNOWN',
      controllers: physicalControllers,
    }),
    logical: Object.freeze({
      current: controllers?.logical?.current === true,
      valid: controllers?.logical?.valid === true,
      observedAtUtc: timestamp(controllers?.logical?.observedAtUtc),
      physicalControllerCount: integer(controllers?.logical?.physicalControllerCount, 100),
      total: integer(controllers?.logical?.total, 1_000_000),
      active: integer(controllers?.logical?.active, 1_000_000),
      tracking: integer(controllers?.logical?.tracking, 1_000_000),
      parked: integer(controllers?.logical?.parked, 1_000_000),
      retired: integer(controllers?.logical?.retired, 1_000_000),
      selectedForAdmission: integer(controllers?.logical?.selectedForAdmission, 1_000_000),
      finalVerdict: state(controllers?.logical?.finalVerdict, 120) || 'UNKNOWN',
      hostLoads: Object.freeze([]),
    }),
    lanes: Object.freeze({
      targetMaterialLanes: integer(controllers?.lanes?.targetMaterialLanes, 100_000),
      activeMaterialLaneCount: integer(controllers?.lanes?.activeMaterialLaneCount, 100_000),
      activeLaneClaimCount: integer(controllers?.lanes?.activeLaneClaimCount, 100_000),
      reportedMaterialLaneCountSum: integer(controllers?.lanes?.reportedMaterialLaneCountSum, 100_000),
      occupancyPercent: Number.isFinite(Number(controllers?.lanes?.occupancyPercent))
        ? Math.max(0, Math.min(100, Number(controllers.lanes.occupancyPercent)))
        : null,
      freeTargetLaneSlots: integer(controllers?.lanes?.freeTargetLaneSlots, 100_000),
      runnableBacklogCount: integer(controllers?.lanes?.runnableBacklogCount, 1_000_000),
      parkedPhysicalLaneCount: integer(controllers?.lanes?.parkedPhysicalLaneCount, 100_000),
      reportedSafeEligibleWorkMax: integer(controllers?.lanes?.reportedSafeEligibleWorkMax, 1_000_000),
      reportedSafeEligibleWorkSum: integer(controllers?.lanes?.reportedSafeEligibleWorkSum, 1_000_000),
      refillHealth: state(controllers?.lanes?.refillHealth, 20) || 'GREY',
      refillState: state(controllers?.lanes?.refillState, 120),
    }),
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: state(controllers?.finalVerdict, 120) || 'SOVEREIGN_CONTROLLER_LANE_STATUS_UNKNOWN',
  });
}

function compactMeters(meters = {}) {
  const attentionMeters = Object.freeze((Array.isArray(meters?.meters) ? meters.meters : [])
    .filter((meter) => String(meter?.trafficLight || '').toUpperCase() !== 'GREEN')
    .slice(0, 12)
    .map((meter) => Object.freeze({
      meterId: text(meter?.meterId, 120).toLowerCase(),
      provider: text(meter?.provider, 120).toLowerCase(),
      source: text(meter?.source, 120).toLowerCase(),
      observationState: state(meter?.observationState, 40) || 'UNKNOWN',
      trafficLight: state(meter?.trafficLight, 20) || 'GREY',
      blocker: state(meter?.blocker, 120),
    })));
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: meters?.ok === true,
    capturedAtUtc: timestamp(meters?.capturedAtUtc),
    counts: Object.freeze({
      total: integer(meters?.counts?.total, 10_000),
      green: integer(meters?.counts?.green, 10_000),
      amber: integer(meters?.counts?.amber, 10_000),
      red: integer(meters?.counts?.red, 10_000),
      grey: integer(meters?.counts?.grey, 10_000),
    }),
    attentionMeters,
    attentionMetersTruncated: Number(meters?.counts?.amber || 0)
      + Number(meters?.counts?.red || 0)
      + Number(meters?.counts?.grey || 0) > attentionMeters.length,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: state(meters?.finalVerdict, 120),
  });
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
  outerBridge = {},
  maintenanceCustody = {},
} = {}) {
  const compactObservationValue = compactObservation(observation);
  const compactControllersValue = compactControllers(controllers);
  const compactMetersValue = compactMeters(meters);
  const projectedMaintenanceCustody = projectMaintenanceCustodyVisibilityV1(maintenanceCustody);
  const headSync = buildHeadSyncVisibility({ repository, core });
  const headMatchedBridge = outerBridge?.available === true
    && outerBridge?.current === true
    && sha(outerBridge.sourceHead) === sha(repository.head)
    && sha(outerBridge.sourceHead) === sha(core.sourceHead)
    && headSync.exactHeadChainProven === true;
  const projectedOuterBridge = Object.freeze({
    available: outerBridge?.available === true,
    current: headMatchedBridge,
    exactHeadMatch: headMatchedBridge,
    sourceHead: headMatchedBridge ? sha(outerBridge.sourceHead) : '',
    observedAtUtc: timestamp(outerBridge?.observedAtUtc),
    cycleAgeSeconds: integer(outerBridge?.cycleAgeSeconds, 31_536_000),
    stage: headMatchedBridge ? state(outerBridge?.stage, 80) : 'UNVERIFIED',
    rescueBlocker: state(outerBridge?.rescueBlocker, 120) || 'OUTER_BRIDGE_STATUS_NOT_PROVEN',
    canonicalLeaseReleaseProven: headMatchedBridge && outerBridge?.canonicalLeaseReleaseProven === true,
    physicalPickupProven: false,
    twoUnattendedRefillsProven: false,
    canonicalHandbackEligible: false,
    readOnly: true, sourceMutationAllowed: false, mergeAuthority: false,
  });
  const repositoryLight = !repository?.available
    ? 'RED'
    : (repository?.branch !== 'main' || repository?.dirty === true ? 'AMBER' : 'GREEN');
  const coreLight = core?.available === true
    && core?.processInventoryComplete === true
    && core?.processCount === 1
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
  const servicesLight = trafficLightFromServices(compactObservationValue?.services);
  const lanesLight = ['GREEN', 'AMBER', 'RED', 'GREY'].includes(compactControllersValue?.lanes?.refillHealth)
    ? compactControllersValue.lanes.refillHealth
    : 'GREY';
  const transportLight = relay?.available === true
    && relay?.daemonHealthy === true
    && Number.isInteger(relay?.heartbeatAgeSeconds)
    && relay.heartbeatAgeSeconds <= 30
    ? (relay?.carrierHealthy === true ? 'GREEN' : 'AMBER')
    : 'AMBER';
  const headSyncLight = headSync.trafficLight;
  const maintenanceLight = maintenanceCustodyVisibilityLightV1(projectedMaintenanceCustody);
  const lights = [repositoryLight, coreLight, headSyncLight, servicesLight, lanesLight, transportLight, maintenanceLight];
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
    observation: compactObservationValue,
    core,
    headSync,
    selfHeal,
    maintenanceCustody: projectedMaintenanceCustody,
    controllers: compactControllersValue,
    meters: compactMetersValue,
    relay,
    outerBridge: projectedOuterBridge,
    health: Object.freeze({
      repository: repositoryLight,
      core: coreLight,
      headSync: headSyncLight,
      services: servicesLight,
      laneRefill: lanesLight,
      transport: transportLight,
      maintenanceCustody: maintenanceLight,
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
  fetchFn = fetch,
} = {}) {
  const current = now();
  const [observation, controllers, meters, selfHeal, relay, outerBridge, maintenanceCustody] = await Promise.all([
    battleBridgeCollector({ spawnSyncFn, env, now: () => current }),
    controllerCollector({ env, now: () => current }),
    meterCollector({ env, spawnSyncFn, now: () => current }),
    collectSelfHealVisibility({ env, readFileFn, now: current }),
    collectRelayVisibility({ env, readFileFn, now: current }),
    collectSovereignOuterBridgeVisibility({ env, readFileFn, now: current }),
    collectMaintenanceCustodyVisibility({ fetchFn }),
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
    outerBridge,
    maintenanceCustody,
  });
}

export function renderSovereignVisibilitySnapshotLine(snapshot = {}) {
  const line = `${SOVEREIGN_VISIBILITY_SNAPSHOT_MARKER}${JSON.stringify(snapshot)}`;
  if (Buffer.byteLength(line, 'utf8') > SOVEREIGN_VISIBILITY_SNAPSHOT_MAX_BYTES) {
    throw new Error('SOVEREIGN_VISIBILITY_SNAPSHOT_BYTE_BUDGET_EXCEEDED');
  }
  return line;
}

export async function runSovereignVisibilitySnapshot(options = {}) {
  const snapshot = await collectSovereignVisibilitySnapshot(options);
  process.stdout.write(`${renderSovereignVisibilitySnapshotLine(snapshot)}\n`);
  return snapshot;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSovereignVisibilitySnapshot().catch((error) => {
    process.stderr.write(`${text(error?.message || error, 240)}\n`);
    process.exitCode = 1;
  });
}
