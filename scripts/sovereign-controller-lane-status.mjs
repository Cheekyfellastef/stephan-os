#!/usr/bin/env node
import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
import {
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceWriteAncestors,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { getSharedWorkspaceSpecializedStatusRecord } from '../shared/agents/sharedWorkspaceSpecializedStatusRegistryV1.mjs';

export const SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA = 'stephanos.sovereign-controller-lane-status.v1';
export const SOVEREIGN_CONTROLLER_LANE_STATUS_MARKER = 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=';
export const SOVEREIGN_CONTROLLER_LANE_STATUS_FILE = 'controller-lane-status-current.json';
export const SOVEREIGN_CONTROLLER_LANE_STATUS_STATUS_ID = 'controller-lane-status-current';
export const STEPHANOS_BUILD_TRUTH_SCHEMA = 'stephanos.sovereign-build-truth.v1';
export const STEPHANOS_BUILD_TRUTH_FILE = 'stephanos-build-truth-current.json';
export const STEPHANOS_BUILD_TRUTH_STATUS_ID = 'stephanos-build-truth-current';
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

function canonicalGoalKey(value) {
  const raw = text(value, 160);
  if (!raw) return '';
  const match = raw.match(/(?:^|[^0-9])#?(\d+)(?:$|[^0-9])/);
  return match ? `#${match[1]}` : raw.toLowerCase();
}

function latestTimestamp(values = []) {
  return values.map((value) => timestamp(value)).filter(Boolean).sort().at(-1) || '';
}

function autonomyProvenanceProved(value = {}) {
  return value?.schemaVersion === 'stephanos.autonomy-provenance.v1'
    && ['stephanos', 'stephanos-foreman'].includes(text(value?.initiatorId, 80).toLowerCase())
    && ['self-initiated', 'autonomous-loop'].includes(text(value?.triggerClass, 80).toLowerCase())
    && value?.operatorInitiated === false
    && value?.chatgptInitiated === false
    && value?.manualPoke === false;
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
      lastMaterialActionAtUtc: timestamp(controller?.lastMaterialActionAtUtc),
      exactNextAction: text(controller?.exactNextAction, 220),
      proofRefs: Object.freeze((Array.isArray(controller?.proofRefs) ? controller.proofRefs : []).slice(0, 12).map((value) => text(value, 220))),
      materialLanes: Object.freeze((Array.isArray(controller?.materialLanes) ? controller.materialLanes : []).slice(0, 15).map((lane) => Object.freeze({
        laneId: text(lane?.laneId, 160),
        goalId: text(lane?.goalId, 160),
        prNumber: integer(lane?.prNumber) || null,
        workerId: text(lane?.workerId, 120),
        lastMaterialAction: text(lane?.lastMaterialAction, 160),
        lastMaterialActionAtUtc: timestamp(lane?.lastMaterialActionAtUtc),
        proofRef: text(lane?.proofRef, 220),
        blocker: text(lane?.blocker, 160),
        nextAutomaticAction: text(lane?.nextAutomaticAction, 220),
        autonomyProvenance: lane?.autonomyProvenance && typeof lane.autonomyProvenance === 'object'
          ? Object.freeze({
              schemaVersion: text(lane.autonomyProvenance.schemaVersion, 100),
              missionId: text(lane.autonomyProvenance.missionId, 120),
              initiatorId: text(lane.autonomyProvenance.initiatorId, 120),
              triggerClass: text(lane.autonomyProvenance.triggerClass, 120),
              operatorInitiated: lane.autonomyProvenance.operatorInitiated === true,
              chatgptInitiated: lane.autonomyProvenance.chatgptInitiated === true,
              manualPoke: lane.autonomyProvenance.manualPoke === true,
            })
          : null,
      }))),
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
    blockers: Object.freeze((Array.isArray(logicalFabric?.blockers) ? logicalFabric.blockers : [])
      .slice(0, 12)
      .map((blocker) => text(blocker, 160).toUpperCase())
      .filter(Boolean)),
    controllers: Object.freeze((Array.isArray(logicalFabric?.controllers) ? logicalFabric.controllers : [])
      .filter((controller) => controller?.retired !== true)
      .map((controller) => Object.freeze({
        logicalControllerId: text(controller?.logicalControllerId, 120),
        issueNumber: integer(controller?.goalIssueNumber),
        goalRef: text(controller?.goalRef, 80),
        title: text(controller?.goalTitle, 220),
        lifecycle: text(controller?.lifecycle, 80).toUpperCase(),
        continuityState: text(controller?.continuityState, 40).toUpperCase(),
        route: text(controller?.route, 120).toUpperCase(),
        hostControllerId: text(controller?.hostControllerId, 80),
        hostControllerTitle: text(controller?.hostControllerTitle, 120),
        selectedForAdmission: controller?.selectedForAdmission === true,
        executionOwner: text(controller?.executionOwner, 120),
      }))),
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


export function buildStephanosBuildTruth(status = {}) {
  const physicalControllers = Array.isArray(status?.physical?.controllers) ? status.physical.controllers : [];
  const logicalControllers = Array.isArray(status?.logical?.controllers) ? status.logical.controllers : [];
  const physicalById = new Map(physicalControllers.map((controller) => [text(controller?.controllerId, 80), controller]));
  const goalRows = logicalControllers.map((logical) => {
    const host = physicalById.get(text(logical?.hostControllerId, 80)) || {};
    const goalKey = canonicalGoalKey(logical?.goalRef || logical?.issueNumber || logical?.logicalControllerId);
    const lanes = Array.isArray(host?.materialLanes) ? host.materialLanes : [];
    const lane = lanes.find((candidate) => canonicalGoalKey(candidate?.goalId) === goalKey) || null;
    const continuityState = text(logical?.continuityState, 40).toUpperCase() || 'TRACKING';
    let state = continuityState === 'ACTIVE' ? 'BUILDING' : continuityState === 'PARKED' ? 'HELD' : 'QUEUED';
    if (text(host?.freshness, 40).toUpperCase() !== 'CURRENT') state = 'STALE';
    else if (text(host?.trafficLight, 20).toUpperCase() === 'RED') state = 'BLOCKED';
    else if (text(host?.activityState, 80).toUpperCase() === 'BUILDING' && (logical?.selectedForAdmission === true || continuityState === 'ACTIVE')) state = 'BUILDING';
    else if (logical?.selectedForAdmission === true && text(host?.activityState, 80).toUpperCase().includes('ELIGIBLE_WORK')) state = 'BLOCKED';
    const blocker = text(lane?.blocker || host?.blocker, 160);
    if (blocker && state !== 'STALE') state = 'BLOCKED';
    return Object.freeze({
      issue: goalKey || (logical?.issueNumber ? `#${logical.issueNumber}` : ''),
      title: text(logical?.title, 220),
      state,
      controllerId: text(logical?.hostControllerId, 80),
      controllerTitle: text(logical?.hostControllerTitle, 120),
      logicalLaneId: text(logical?.logicalControllerId, 120),
      builder: text(lane?.workerId || logical?.executionOwner, 120) || 'canonical-mission-worker',
      currentPhase: text(lane?.lastMaterialAction || host?.activityState || logical?.route, 160).toUpperCase(),
      lastMaterialProgressAtUtc: latestTimestamp([lane?.lastMaterialActionAtUtc, host?.lastMaterialActionAtUtc]),
      prNumber: integer(lane?.prNumber) || null,
      proofRefs: Object.freeze([...new Set([text(lane?.proofRef, 220), ...(Array.isArray(host?.proofRefs) ? host.proofRefs : [])].filter(Boolean))].slice(0, 12)),
      blocker,
      nextAction: text(lane?.nextAutomaticAction || host?.exactNextAction, 220) || 'Continue through the canonical goal fabric.',
      autonomous: autonomyProvenanceProved(lane?.autonomyProvenance),
      autonomyTruth: autonomyProvenanceProved(lane?.autonomyProvenance) ? 'PROVEN' : 'UNPROVEN',
      selectedForAdmission: logical?.selectedForAdmission === true,
    });
  });

  const activeGoals = goalRows.filter((goal) => ['BUILDING', 'QUEUED', 'HELD', 'BLOCKED', 'STALE'].includes(goal.state));
  const buildingGoals = activeGoals.filter((goal) => goal.state === 'BUILDING');
  const autonomousBuildingGoalCount = buildingGoals.filter((goal) => goal.autonomous === true).length;
  const autonomous = buildingGoals.length > 0 && autonomousBuildingGoalCount === buildingGoals.length;
  const anyBuilding = activeGoals.some((goal) => goal.state === 'BUILDING') || integer(status?.physical?.building) > 0 || integer(status?.lanes?.activeMaterialLaneCount) > 0;
  const stale = status?.physical?.allCurrent !== true || status?.logical?.current !== true;
  const stranded = text(status?.lanes?.refillState, 120).toUpperCase() === 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE';
  const blocked = integer(status?.physical?.red) > 0 || text(status?.lanes?.refillHealth, 20).toUpperCase() === 'RED' || stranded || activeGoals.some((goal) => goal.state === 'BLOCKED');
  const held = !anyBuilding && !blocked && activeGoals.some((goal) => goal.state === 'HELD');
  const queued = !anyBuilding && !blocked && activeGoals.some((goal) => goal.state === 'QUEUED');
  const state = stale ? 'STALE'
    : blocked ? 'BLOCKED'
      : anyBuilding ? 'BUILDING'
        : held ? 'HELD'
          : queued ? 'QUEUED'
            : 'IDLE_GREEN';
  const lastMaterialProgressAtUtc = latestTimestamp([
    ...physicalControllers.map((controller) => controller?.lastMaterialActionAtUtc),
    ...activeGoals.map((goal) => goal.lastMaterialProgressAtUtc),
  ]);
  const blockers = [...new Set([
    ...activeGoals.map((goal) => goal.blocker).filter(Boolean),
    ...(stranded ? ['SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE'] : []),
  ])];

  return Object.freeze({
    schemaVersion: STEPHANOS_BUILD_TRUTH_SCHEMA,
    observedAtUtc: timestamp(status?.capturedAtUtc) || new Date().toISOString(),
    state,
    trafficLight: state === 'BUILDING' || state === 'IDLE_GREEN' ? 'GREEN'
      : state === 'QUEUED' ? 'BLUE'
        : state === 'HELD' ? 'AMBER'
          : state === 'STALE' ? 'GREY'
            : 'RED',
    autonomous,
    autonomyTruth: autonomous ? 'PROVEN' : 'UNPROVEN',
    autonomousBuildingGoalCount,
    activeGoalCount: activeGoals.length,
    buildingGoalCount: buildingGoals.length,
    queuedGoalCount: activeGoals.filter((goal) => goal.state === 'QUEUED').length,
    heldGoalCount: activeGoals.filter((goal) => goal.state === 'HELD').length,
    blockedGoalCount: activeGoals.filter((goal) => goal.state === 'BLOCKED').length,
    activeMaterialLaneCount: integer(status?.lanes?.activeMaterialLaneCount, 15),
    targetMaterialLaneCount: integer(status?.lanes?.targetMaterialLanes, 15) || 15,
    lastMaterialProgressAtUtc,
    goals: Object.freeze(activeGoals),
    blockers: Object.freeze(blockers),
    nextAction: state === 'BLOCKED'
      ? 'Repair the blocked autonomous build flow and re-dispatch safe eligible work.'
      : state === 'STALE'
        ? 'Refresh Sovereign Commander controller and logical-lane evidence.'
        : state === 'BUILDING'
          ? 'Continue autonomous building and publish fresh material proof.'
          : state === 'QUEUED'
            ? 'Dispatch the selected safe goal into a material builder lane.'
            : state === 'HELD'
              ? 'Keep held work visible and release it automatically when its guard condition clears.'
              : 'Remain ready and immediately admit the next safe eligible goal.',
    source: 'sovereign-controller-lane-status',
    sourceVerdict: text(status?.finalVerdict, 120),
    staleMeansGreen: false,
    noWorkMeansGreenOnlyWhenCurrent: true,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    mergeAuthority: false,
  });
}

export function buildSharedWorkspaceStephanosBuildTruthRecord(buildTruth = {}) {
  const timestampUtc = timestamp(buildTruth?.observedAtUtc) || new Date().toISOString();
  const summary = `Stephanos foreman ${text(buildTruth?.state, 40).toUpperCase() || 'UNKNOWN'}: ${integer(buildTruth?.buildingGoalCount)} building, ${integer(buildTruth?.activeGoalCount)} active/queued/held, lanes ${integer(buildTruth?.activeMaterialLaneCount, 15)}/${integer(buildTruth?.targetMaterialLaneCount, 15) || 15}.`;
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: STEPHANOS_BUILD_TRUTH_STATUS_ID,
      participantId: 'sovereign-commander',
      timestampUtc,
      relatedIssue: '#2002',
      status: text(buildTruth?.state, 40).toUpperCase() || 'UNKNOWN',
      summary,
      proofRefs: [...new Set((Array.isArray(buildTruth?.goals) ? buildTruth.goals : []).flatMap((goal) => Array.isArray(goal?.proofRefs) ? goal.proofRefs : []))].slice(0, 24),
    }),
    stephanosBuildTruth: buildTruth,
    readOnly: true,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    mergeAuthority: false,
  });
}

export async function publishSharedWorkspaceStephanosBuildTruth(buildTruth, {
  repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  env = process.env,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const config = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!config.ok || !config.root) return Object.freeze({ ok: false, reason: config.reason || 'SHARED_WORKSPACE_UNAVAILABLE' });
  const record = buildSharedWorkspaceStephanosBuildTruthRecord(buildTruth);
  try {
    const write = await writeAtomicJsonFn(
      config.root,
      ['status', STEPHANOS_BUILD_TRUTH_FILE],
      record,
      { repoRoot, nowMs: Date.parse(record.timestampUtc), staleAfterMs: Number.MAX_SAFE_INTEGER },
    );
    return Object.freeze({ ok: write?.ok === true, reason: write?.reason || 'STEPHANOS_BUILD_TRUTH_PUBLICATION_FAILED', path: write?.path || '' });
  } catch (error) {
    return Object.freeze({ ok: false, reason: error?.code || error?.message || 'STEPHANOS_BUILD_TRUTH_PUBLICATION_FAILED' });
  }
}

export function buildSharedWorkspaceControllerLaneStatusRecord(status = {}) {
  const timestampUtc = timestamp(status?.capturedAtUtc) || new Date().toISOString();
  const active = integer(status?.lanes?.activeMaterialLaneCount, 15);
  const target = integer(status?.lanes?.targetMaterialLanes, 15) || 15;
  const logicalActive = integer(status?.logical?.active);
  const logicalTotal = integer(status?.logical?.total);
  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: SOVEREIGN_CONTROLLER_LANE_STATUS_STATUS_ID,
      participantId: 'sovereign-commander',
      timestampUtc,
      relatedIssue: '#1622',
      status: text(status?.finalVerdict, 100).toUpperCase() || 'UNKNOWN',
      summary: `Sovereign lane truth: material ${active}/${target}; logical ${logicalActive}/${logicalTotal}; refill=${text(status?.lanes?.refillHealth, 20).toUpperCase() || 'UNKNOWN'}.`,
      proofRefs: [],
    }),
    controllerLaneStatusSchemaVersion: SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA,
    controllerLaneStatus: status,
    readOnly: true,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    mergeAuthority: false,
  });
}

export async function writeControllerLaneSpecializedStatus(record, {
  root,
  repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  writeFileFn = writeFile,
  renameFn = rename,
  unlinkFn = unlink,
  nowMs = Date.now(),
} = {}) {
  if (
    record?.statusId !== SOVEREIGN_CONTROLLER_LANE_STATUS_STATUS_ID
    || record?.controllerLaneStatusSchemaVersion !== SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA
    || record?.controllerLaneStatus?.schemaVersion !== SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA
  ) {
    return Object.freeze({ ok: false, reason: 'CONTROLLER_LANE_STATUS_RECORD_INVALID' });
  }
  const registration = getSharedWorkspaceSpecializedStatusRecord(SOVEREIGN_CONTROLLER_LANE_STATUS_FILE);
  if (!registration?.schemaIds?.includes(SOVEREIGN_CONTROLLER_LANE_STATUS_SCHEMA)) {
    return Object.freeze({ ok: false, reason: 'CONTROLLER_LANE_STATUS_NOT_REGISTERED' });
  }
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: layout.reason || 'SHARED_WORKSPACE_UNAVAILABLE' });
  const resolved = resolveSharedWorkspacePath({
    root: layout.root,
    repoRoot,
    segments: ['status', SOVEREIGN_CONTROLLER_LANE_STATUS_FILE],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason || 'CONTROLLER_LANE_STATUS_PATH_BLOCKED' });
  const ancestors = await validateSharedWorkspaceWriteAncestors(resolved);
  if (!ancestors.ok) return Object.freeze({ ok: false, reason: ancestors.reason || 'CONTROLLER_LANE_STATUS_ANCESTOR_BLOCKED' });

  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tempPath = `${resolved.path}.${process.pid}.${Number(nowMs) || Date.now()}.tmp`;
  try {
    await writeFileFn(tempPath, payload, { flag: 'wx', mode: 0o600 });
    const publicationAncestors = await validateSharedWorkspaceWriteAncestors(resolved);
    if (!publicationAncestors.ok) {
      try { await unlinkFn(tempPath); } catch {}
      return Object.freeze({ ok: false, reason: publicationAncestors.reason || 'CONTROLLER_LANE_STATUS_ANCESTOR_BLOCKED' });
    }
    await renameFn(tempPath, resolved.path);
    return Object.freeze({
      ok: true,
      reason: 'CONTROLLER_LANE_STATUS_PUBLISHED',
      path: resolved.path,
      bytes: Buffer.byteLength(payload),
    });
  } catch (error) {
    try { await unlinkFn(tempPath); } catch {}
    return Object.freeze({ ok: false, reason: error?.code || error?.message || 'CONTROLLER_LANE_STATUS_PUBLICATION_FAILED' });
  }
}

export async function publishSharedWorkspaceControllerLaneStatus(status, {
  repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  env = process.env,
  specializedWriterFn = writeControllerLaneSpecializedStatus,
} = {}) {
  const config = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!config.ok || !config.root) {
    return Object.freeze({ ok: false, reason: config.reason || 'SHARED_WORKSPACE_UNAVAILABLE' });
  }
  const record = buildSharedWorkspaceControllerLaneStatusRecord(status);
  return specializedWriterFn(record, { root: config.root, repoRoot });
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
  await publishSharedWorkspaceControllerLaneStatus(status, options);
  await publishSharedWorkspaceStephanosBuildTruth(buildStephanosBuildTruth(status), options);
  process.stdout.write(`${SOVEREIGN_CONTROLLER_LANE_STATUS_MARKER}${JSON.stringify(status)}\n`);
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSovereignControllerLaneStatus().catch((error) => {
    process.stderr.write(`${text(error?.message || error, 240)}\n`);
    process.exitCode = 1;
  });
}
