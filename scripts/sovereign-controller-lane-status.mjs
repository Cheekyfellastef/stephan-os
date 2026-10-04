#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_CONTROLLER_FLEET,
  projectControllerFleetTelemetry,
} from '../shared/agents/controllerFleetTelemetryV1.mjs';
import {
  LOGICAL_GOAL_CONTROLLER_FABRIC_FILE,
  LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA,
} from '../shared/agents/logicalGoalControllerFabricV1.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA = 'stephanos.sovereign-controller-lane-status.v1';
export const SOVEREIGN_CONTROLLER_LANE_STATUS_MARKER = 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=';
const MAX_RECORD_FILES = 512;
const DEFAULT_STALE_AFTER_MS = 90 * 60 * 1000;

function text(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function integer(value, max = 1_000_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : 0;
}

function timestamp(value) {
  const candidate = text(value, 80);
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function logicalFabricCurrent(fabric, nowMs, staleAfterMs) {
  if (!fabric || fabric.schemaVersion !== LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA || fabric.valid !== true) return false;
  const observed = Date.parse(text(fabric.observedAtUtc, 80));
  return Number.isFinite(observed) && observed <= nowMs + 60_000 && nowMs - observed <= staleAfterMs;
}

function uniqueMaterialLaneCount(controllers = []) {
  const identities = new Set();
  controllers.forEach((controller) => {
    const controllerId = text(controller?.controllerId, 80);
    const lanes = Array.isArray(controller?.materialLanes) ? controller.materialLanes : [];
    lanes.forEach((lane, index) => {
      const laneId = text(lane?.laneId, 160);
      identities.add(laneId || `${controllerId}:material:${index}`);
    });
  });
  return identities.size;
}

function uniqueActiveLaneClaimCount(controllers = []) {
  const identities = new Set();
  controllers.forEach((controller) => {
    const controllerId = text(controller?.controllerId, 80);
    const lanes = Array.isArray(controller?.activeLanes) ? controller.activeLanes : [];
    lanes.forEach((lane, index) => identities.add(text(lane, 160) || `${controllerId}:active:${index}`));
  });
  return identities.size;
}

export function buildSovereignControllerLaneStatus({
  controllerFleet = {},
  logicalFabric = null,
  workspaceReady = true,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const controllers = Array.isArray(controllerFleet?.controllers) ? controllerFleet.controllers : [];
  const logicalCurrent = logicalFabricCurrent(logicalFabric, safeNowMs, staleAfterMs);
  const targetMaterialLanes = integer(controllerFleet?.metrics?.TARGET_MATERIAL_LANES) || 15;
  const activeMaterialLaneCount = uniqueMaterialLaneCount(controllers);
  const activeLaneClaimCount = uniqueActiveLaneClaimCount(controllers);
  const reportedMaterialLaneCountSum = controllers.reduce((sum, controller) => (
    sum + (Array.isArray(controller?.materialLanes) ? controller.materialLanes.length : 0)
  ), 0);
  const reportedSafeEligibleWorkMax = controllers.reduce((max, controller) => (
    Math.max(max, integer(controller?.safeEligibleWorkRemaining))
  ), 0);
  const reportedSafeEligibleWorkSum = controllers.reduce((sum, controller) => (
    sum + integer(controller?.safeEligibleWorkRemaining)
  ), 0);
  const parkedPhysicalLaneCount = controllers.reduce((sum, controller) => (
    sum + integer(controller?.parkedLaneCount ?? (Array.isArray(controller?.parkedLanes) ? controller.parkedLanes.length : 0), 15)
  ), 0);

  const physical = Object.freeze({
    expected: integer(controllerFleet?.expectedControllerCount) || CANONICAL_CONTROLLER_FLEET.length,
    building: integer(controllerFleet?.counts?.building),
    amber: integer(controllerFleet?.counts?.amber),
    red: integer(controllerFleet?.counts?.red),
    unknown: integer(controllerFleet?.counts?.unknown),
    allCurrent: controllerFleet?.allCurrent === true,
    allObservedEnabled: controllerFleet?.allObservedEnabled === true,
    finalVerdict: text(controllerFleet?.finalVerdict, 100).toUpperCase() || 'UNKNOWN',
    controllers: Object.freeze(controllers.slice(0, CANONICAL_CONTROLLER_FLEET.length).map((controller) => Object.freeze({
      controllerId: text(controller?.controllerId, 80),
      title: text(controller?.title, 120),
      freshness: text(controller?.freshness, 40).toUpperCase() || 'UNKNOWN',
      activityState: text(controller?.activityState, 80).toUpperCase() || 'UNKNOWN',
      trafficLight: text(controller?.trafficLight, 20).toUpperCase() || 'UNKNOWN',
      materialLaneCount: Array.isArray(controller?.materialLanes) ? controller.materialLanes.length : 0,
      activeLaneCount: integer(controller?.activeLaneCount ?? (Array.isArray(controller?.activeLanes) ? controller.activeLanes.length : 0), 15),
      parkedLaneCount: integer(controller?.parkedLaneCount ?? (Array.isArray(controller?.parkedLanes) ? controller.parkedLanes.length : 0), 15),
      safeEligibleWorkRemaining: integer(controller?.safeEligibleWorkRemaining),
      blocker: text(controller?.blocker, 120).toUpperCase(),
    }))),
  });

  const logical = Object.freeze({
    current: logicalCurrent,
    valid: logicalFabric?.valid === true,
    observedAtUtc: timestamp(logicalFabric?.observedAtUtc),
    physicalControllerCount: integer(logicalFabric?.physicalControllerCount),
    total: integer(logicalFabric?.logicalControllerCount),
    active: integer(logicalFabric?.activeLogicalControllerCount),
    tracking: integer(logicalFabric?.trackingLogicalControllerCount),
    parked: integer(logicalFabric?.parkedLogicalControllerCount),
    retired: integer(logicalFabric?.retiredLogicalControllerCount),
    selectedForAdmission: Array.isArray(logicalFabric?.controllers)
      ? logicalFabric.controllers.filter((controller) => controller?.selectedForAdmission === true && controller?.retired !== true).length
      : 0,
    finalVerdict: text(logicalFabric?.finalVerdict, 100).toUpperCase() || 'UNKNOWN',
    hostLoads: Object.freeze((Array.isArray(logicalFabric?.hostLoads) ? logicalFabric.hostLoads : [])
      .slice(0, CANONICAL_CONTROLLER_FLEET.length)
      .map((host) => Object.freeze({
        controllerId: text(host?.controllerId, 80),
        title: text(host?.title, 120),
        logicalControllerCount: integer(host?.logicalControllerCount),
        activeCount: integer(host?.activeCount),
        trackingCount: integer(host?.trackingCount),
        parkedCount: integer(host?.parkedCount),
      }))),
  });

  let refillHealth = 'GREEN';
  let refillState = 'NO_SAFE_ELIGIBLE_WORK_REPORTED';
  if (!workspaceReady || !controllerFleet?.schemaVersion) {
    refillHealth = 'GREY';
    refillState = 'CONTROLLER_TELEMETRY_UNAVAILABLE';
  } else if (physical.red > 0 || logical.valid === false) {
    refillHealth = 'RED';
    refillState = 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED';
  } else if (!physical.allCurrent || !logicalCurrent || physical.unknown > 0) {
    refillHealth = 'AMBER';
    refillState = 'TELEMETRY_STALE_OR_INCOMPLETE';
  } else if (activeMaterialLaneCount >= targetMaterialLanes) {
    refillHealth = 'GREEN';
    refillState = 'TARGET_MATERIAL_LANES_FILLED';
  } else if (reportedSafeEligibleWorkMax > 0) {
    refillHealth = 'AMBER';
    refillState = 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE';
  }

  const finalVerdict = refillHealth === 'RED'
    ? 'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED'
    : refillHealth === 'AMBER'
      ? 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED'
      : refillHealth === 'GREY'
        ? 'SOVEREIGN_CONTROLLER_LANE_STATUS_UNKNOWN'
        : 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY';

  return Object.freeze({
    schemaVersion: SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA,
    ok: true,
    capturedAtUtc: new Date(safeNowMs).toISOString(),
    physical,
    logical,
    lanes: Object.freeze({
      targetMaterialLanes,
      activeMaterialLaneCount,
      activeLaneClaimCount,
      reportedMaterialLaneCountSum,
      occupancyPercent: targetMaterialLanes > 0
        ? Math.min(100, Math.round((activeMaterialLaneCount / targetMaterialLanes) * 10000) / 100)
        : 0,
      freeTargetLaneSlots: Math.max(0, targetMaterialLanes - activeMaterialLaneCount),
      runnableBacklogCount: reportedSafeEligibleWorkMax,
      parkedPhysicalLaneCount,
      reportedSafeEligibleWorkMax,
      reportedSafeEligibleWorkSum,
      refillHealth,
      refillState,
    }),
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

async function readJsonDirectory(path, maxFiles = MAX_RECORD_FILES) {
  let names = [];
  try {
    names = (await readdir(path))
      .filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,140}\.json$/.test(name))
      .slice(0, maxFiles);
  } catch {
    return { ready: false, records: [] };
  }
  const records = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(join(path, name), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
    } catch {}
  }
  return { ready: true, records };
}

async function readLogicalFabric(root) {
  try {
    return JSON.parse(await readFile(join(root, 'status', LOGICAL_GOAL_CONTROLLER_FABRIC_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function collectSovereignControllerLaneStatus({
  repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  env = process.env,
  now = () => new Date(),
} = {}) {
  const config = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!config.ok) {
    return buildSovereignControllerLaneStatus({
      controllerFleet: {},
      logicalFabric: null,
      workspaceReady: false,
      now: now(),
    });
  }
  const [statuses, proofs, logicalFabric] = await Promise.all([
    readJsonDirectory(join(config.root, 'status')),
    readJsonDirectory(join(config.root, 'proof')),
    readLogicalFabric(config.root),
  ]);
  const current = now();
  const nowMs = current instanceof Date ? current.getTime() : Date.parse(String(current));
  const controllerFleet = projectControllerFleetTelemetry({
    statusRecords: statuses.records,
    proofRecords: proofs.records,
    nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
  });
  return buildSovereignControllerLaneStatus({
    controllerFleet,
    logicalFabric,
    workspaceReady: statuses.ready && proofs.ready,
    now: current,
  });
}

export async function runSovereignControllerLaneStatus(options = {}) {
  const status = await collectSovereignControllerLaneStatus(options);
  process.stdout.write(`${SOVEREIGN_CONTROLLER_LANE_STATUS_MARKER}${JSON.stringify(status)}\n`);
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSovereignControllerLaneStatus().catch((error) => {
    process.stderr.write(`${text(error?.message || error, 240)}\n`);
    process.exitCode = 1;
  });
}
