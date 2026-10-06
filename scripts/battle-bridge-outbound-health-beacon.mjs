#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { buildBattleBridgeTelemetryAutorepairProjection } from '../shared/agents/battleBridgeTelemetryAutorepairV1.mjs';
import { resolveSharedWorkspacePath } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { invalidateBrokeredGithubObservation, publishBrokeredGithubMutation, readBrokeredGithubJson } from '../shared/agents/githubObservationBrokerV1.mjs';
import { projectBoundedMissionWorkerRestartBlocker } from './battle-bridge-worker-watchdog-acceptance.mjs';
import * as core from './battle-bridge-outbound-health-beacon-core.mjs';

export * from './battle-bridge-outbound-health-beacon-core.mjs';

export const BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE = 'battle-bridge-complete-state-current.json';
export const BATTLE_BRIDGE_COMPLETE_STATE_MIRROR_ROLE = 'battle-bridge-complete-state-projection';

const SHA40 = /^[0-9a-f]{40}$/;
const MAX_STATUS_BYTES = 64 * 1024;
const MAX_GITHUB_BYTES = 512 * 1024;
const WORKER_WATCHDOG_SPEC = Object.freeze({
  id: 'workerWatchdog',
  path: 'status/battle-bridge-worker-watchdog-current.json',
  staleAfterMs: 180_000,
});
const SOVEREIGN_REPAIR_SPEC = Object.freeze({
  path: 'status/sovereign-commander-repair-current.json',
  staleAfterMs: 180_000,
});
const CONTROLLER_LANE_STATUS_SPEC = Object.freeze({
  path: 'status/controller-lane-status-current.json',
  staleAfterMs: 180_000,
});
const SOVEREIGN_REPAIR_OUTCOMES = new Set(['HEALTHY', 'REPAIRED', 'NEEDS_REPAIR', 'BLOCKED']);
const WORKER_WATCHDOG_CLASSIFICATIONS = new Set([
  'WORKER_WATCHDOG_HEALTHY',
  'WORKER_WATCHDOG_RECOVERED',
  'WORKER_WATCHDOG_RECOVERY_FAILED',
  'WORKER_WATCHDOG_RECOVERY_COOLDOWN',
  'WORKER_WATCHDOG_BLOCKED',
  'WORKER_WATCHDOG_PROBE_FAILED',
  'WORKER_WATCHDOG_START_FAILED',
  'WORKER_WATCHDOG_LIVE_LOCK',
]);
const WORKER_WATCHDOG_SUCCESS_CLASSIFICATIONS = new Set([
  'WORKER_WATCHDOG_HEALTHY',
  'WORKER_WATCHDOG_RECOVERED',
]);
const WATCHDOG_RESTART_VERDICTS = new Set([
  'APPROVED_RUNTIME_RESTART_PASS',
  'APPROVED_RUNTIME_RESTART_BLOCKED',
]);

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function validHead(value) {
  const normalized = text(value, 40).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function numericCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function readJsonBounded(path) {
  if (!existsSync(path)) return null;
  try {
    const source = readFileSync(path, 'utf8');
    if (Buffer.byteLength(source, 'utf8') > MAX_STATUS_BYTES) return null;
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeWatchdogClassification(value) {
  const classification = text(value, 120).toUpperCase();
  return WORKER_WATCHDOG_CLASSIFICATIONS.has(classification) ? classification : 'UNKNOWN';
}

function safeWatchdogRestartVerdict(value) {
  const verdict = text(value, 120).toUpperCase();
  return WATCHDOG_RESTART_VERDICTS.has(verdict) ? verdict : '';
}

export function projectWorkerWatchdogBeaconFacts(record = {}, expectedHead = '') {
  const classification = safeWatchdogClassification(record.classification || record.status);
  const restartBlocker = projectBoundedMissionWorkerRestartBlocker(record.restartBlocker);
  const expected = validHead(expectedHead);
  const initial = record.initialAssessment && typeof record.initialAssessment === 'object' && !Array.isArray(record.initialAssessment)
    ? record.initialAssessment
    : {};
  const final = record.finalAssessment && typeof record.finalAssessment === 'object' && !Array.isArray(record.finalAssessment)
    ? record.finalAssessment
    : {};
  const sourceHead = validHead(record.restartSourceHead || final.sourceHead || initial.canonicalRepositoryHead);
  const heartbeatAgeMs = numericCount(final.heartbeatAgeMs ?? initial.heartbeatAgeMs);
  const exactHeadMatch = Boolean(expected && sourceHead && expected === sourceHead);
  let exactNextAction = 'READ_WATCHDOG_FAILURE_BOUNDARY';
  if (restartBlocker) exactNextAction = 'REPAIR_TYPED_MISSION_WORKER_RESTART_BLOCKER';
  else if (WORKER_WATCHDOG_SUCCESS_CLASSIFICATIONS.has(classification) && exactHeadMatch) {
    exactNextAction = 'VERIFY_MISSION_WORKER_HEARTBEAT_AND_BUILD_EXECUTION';
  } else if (classification === 'WORKER_WATCHDOG_RECOVERY_COOLDOWN') {
    exactNextAction = 'WAIT_FOR_EXISTING_WATCHDOG_RESTART_COOLDOWN';
  } else if (classification === 'UNKNOWN') {
    exactNextAction = 'READ_ONLY_WATCHDOG_STATUS_REPAIR';
  }
  return Object.freeze({
    classification,
    restartBlocker,
    restartVerdict: safeWatchdogRestartVerdict(record.restartVerdict),
    sourceHead,
    expectedHead: expected,
    exactHeadMatch,
    restartAttempted: record.restartAttempted === true,
    restartExactHeadProofOk: record.restartExactHeadProofOk === true,
    restartProofFresh: record.restartProofFresh === true,
    taskActionMatchesCanonicalWorker: initial.taskActionMatchesCanonicalWorker === true,
    processHealthy: final.processHealthy === true,
    processLaunchIdentityVerified: final.processLaunchIdentityVerified === true,
    heartbeatFresh: final.heartbeatFresh === true,
    heartbeatAgeMs,
    supervisorDetectedWorkerDown: record.supervisorDetectedWorkerDown === true,
    supervisorRestartedWorker: record.supervisorRestartedWorker === true,
    workerRecovered: record.workerRecovered === true,
    workerFromMain: record.workerFromMain === true,
    exactNextAction,
    arbitraryPathPublished: false,
    arbitraryCommandLinePublished: false,
    rawErrorPublished: false,
  });
}

export function projectBeaconStatus(record, spec, nowMs = Date.now(), expectedHead = '') {
  if (spec?.id !== 'workerWatchdog' || !record || !validHead(expectedHead)) {
    return core.projectBeaconStatus(record, spec, nowMs, expectedHead);
  }
  const base = core.projectBeaconStatus(record, spec, nowMs, expectedHead);
  const workerWatchdogFacts = projectWorkerWatchdogBeaconFacts(record, expectedHead);
  const watchdogBlocker = workerWatchdogFacts.restartBlocker
    || (!WORKER_WATCHDOG_SUCCESS_CLASSIFICATIONS.has(workerWatchdogFacts.classification)
      && workerWatchdogFacts.classification !== 'UNKNOWN'
      ? workerWatchdogFacts.classification
      : base.blocker);
  return Object.freeze({
    id: spec.id,
    state: base.state === 'STALE' ? 'STALE' : workerWatchdogFacts.classification,
    rawState: workerWatchdogFacts.classification,
    observedAtUtc: base.observedAtUtc,
    ageMs: base.ageMs,
    head: workerWatchdogFacts.sourceHead,
    blocker: watchdogBlocker,
    serviceFacts: Object.freeze({}),
    dirtFacts: Object.freeze({ known: false, blocksSync: false, blockingCount: 0 }),
    housekeeperFacts: Object.freeze({ observed: false, state: 'UNPROVEN', observedAtUtc: '', head: '', blocker: '' }),
    runtimeHeads: Object.freeze({ builtHead: '', servedHead: '', runtimeHead: '' }),
    workerWatchdogFacts,
  });
}

export function projectSovereignRepairBeaconFacts(record = null, expectedHead = '', nowMs = Date.now()) {
  const expected = validHead(expectedHead);
  const empty = (state, blocker, trafficLight = 'GREY') => Object.freeze({
    available: false,
    state,
    trafficLight,
    observedAtUtc: '',
    ageMs: null,
    sourceHead: '',
    expectedHead: expected,
    exactHeadMatch: false,
    status: '',
    outcome: '',
    cycleId: '',
    detectedFaults: Object.freeze([]),
    actions: Object.freeze([]),
    verification: Object.freeze({
      readiness: '',
      wakeState: '',
      awake: false,
      repairRequired: false,
      heartbeatFresh: false,
      busyGraceActive: false,
      heartbeatAgeSeconds: null,
    }),
    blocker,
    readOnly: true,
    rawPathsReturned: false,
    rawLogsReturned: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_REPAIR_PROOF_UNPROVEN',
  });
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return empty('UNPROVEN', 'SOVEREIGN_REPAIR_REPORT_MISSING');
  }
  if (record.reportSchema !== 'stephanos.sovereign-commander-repair-report.v1'
    || record.statusId !== 'sovereign-commander-repair-current') {
    return empty('UNPROVEN', 'SOVEREIGN_REPAIR_REPORT_SCHEMA_INVALID');
  }

  const observedAtUtc = (() => {
    const value = text(record.timestampUtc, 40);
    return Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : '';
  })();
  const observedMs = Date.parse(observedAtUtc);
  const ageMs = Number.isFinite(observedMs) ? Math.max(0, nowMs - observedMs) : null;
  const sourceHead = validHead(record.sourceHead);
  const exactHeadMatch = Boolean(expected && sourceHead && expected === sourceHead);
  const outcome = text(record.outcome, 40).toUpperCase();
  const status = text(record.status, 40).toUpperCase();
  const cycleIdCandidate = text(record.cycleId, 80);
  const cycleId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(cycleIdCandidate) ? cycleIdCandidate : '';
  const safeToken = (value, limit = 160) => {
    const candidate = text(value, limit);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(candidate) ? candidate : '';
  };
  const detectedFaults = Object.freeze((Array.isArray(record.detectedFaults) ? record.detectedFaults : [])
    .slice(0, 8)
    .map((value) => safeToken(value))
    .filter(Boolean));
  const actions = Object.freeze((Array.isArray(record.actions) ? record.actions : [])
    .slice(0, 12)
    .flatMap((action) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) return [];
      const actionId = safeToken(action.actionId, 96);
      if (!actionId) return [];
      return [Object.freeze({
        actionId,
        ok: action.ok === true,
        finalVerdict: safeToken(action.finalVerdict),
        blocker: safeToken(action.blocker),
      })];
    }));
  const rawVerification = record.verification && typeof record.verification === 'object' && !Array.isArray(record.verification)
    ? record.verification
    : {};
  const heartbeatAgeSeconds = Number(rawVerification.heartbeatAgeSeconds);
  const verification = Object.freeze({
    readiness: safeToken(rawVerification.readiness, 64),
    wakeState: safeToken(rawVerification.wakeState, 64),
    awake: rawVerification.awake === true,
    repairRequired: rawVerification.repairRequired === true,
    heartbeatFresh: rawVerification.heartbeatFresh === true,
    busyGraceActive: rawVerification.busyGraceActive === true,
    heartbeatAgeSeconds: Number.isFinite(heartbeatAgeSeconds) && heartbeatAgeSeconds >= 0
      ? Math.min(heartbeatAgeSeconds, 31_536_000)
      : null,
  });

  const stale = ageMs === null || ageMs > SOVEREIGN_REPAIR_SPEC.staleAfterMs;
  const structurallyValid = Boolean(
    observedAtUtc
    && sourceHead
    && SOVEREIGN_REPAIR_OUTCOMES.has(outcome)
    && ['READY', 'ATTENTION_REQUIRED'].includes(status)
    && cycleId,
  );
  if (!structurallyValid) return empty('UNPROVEN', 'SOVEREIGN_REPAIR_REPORT_INVALID');
  const state = stale
    ? 'STALE'
    : !exactHeadMatch
      ? 'HEAD_MISMATCH'
      : outcome;
  const trafficLight = stale || !exactHeadMatch
    ? 'AMBER'
    : ['HEALTHY', 'REPAIRED'].includes(outcome) && status === 'READY'
      ? 'GREEN'
      : 'RED';
  const blocker = trafficLight === 'GREEN'
    ? ''
    : detectedFaults[0]
      || (stale ? 'SOVEREIGN_REPAIR_REPORT_STALE' : !exactHeadMatch ? 'SOVEREIGN_REPAIR_REPORT_HEAD_MISMATCH' : 'SOVEREIGN_REPAIR_ATTENTION_REQUIRED');

  return Object.freeze({
    available: true,
    state,
    trafficLight,
    observedAtUtc,
    ageMs,
    sourceHead,
    expectedHead: expected,
    exactHeadMatch,
    status,
    outcome,
    cycleId,
    detectedFaults,
    actions,
    verification,
    blocker,
    readOnly: true,
    rawPathsReturned: false,
    rawLogsReturned: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: trafficLight === 'GREEN'
      ? 'SOVEREIGN_REPAIR_PROOF_GREEN'
      : trafficLight === 'RED'
        ? 'SOVEREIGN_REPAIR_PROOF_ATTENTION_REQUIRED'
        : 'SOVEREIGN_REPAIR_PROOF_UNPROVEN',
  });
}


function safeBeaconToken(value, limit = 160) {
  const candidate = text(value, limit);
  return /^[A-Za-z0-9][A-Za-z0-9._:#-]{0,159}$/.test(candidate) ? candidate : '';
}

export function projectControllerLaneBeaconFacts(record = null, nowMs = Date.now()) {
  const empty = (state, blocker, trafficLight = 'GREY') => Object.freeze({
    available: false,
    state,
    trafficLight,
    observedAtUtc: '',
    ageMs: null,
    sourceHeadBound: false,
    exactHeadMatch: null,
    physical: Object.freeze({
      expected: null,
      building: null,
      amber: null,
      red: null,
      unknown: null,
      allCurrent: false,
      allObservedEnabled: false,
      finalVerdict: '',
      controllers: Object.freeze([]),
    }),
    logical: Object.freeze({
      current: false,
      valid: false,
      physicalControllerCount: null,
      total: null,
      active: null,
      tracking: null,
      parked: null,
      retired: null,
      selectedForAdmission: null,
      finalVerdict: '',
      blockers: Object.freeze([]),
    }),
    lanes: Object.freeze({
      targetMaterialLanes: null,
      activeMaterialLaneCount: null,
      activeLaneClaimCount: null,
      freeTargetLaneSlots: null,
      runnableBacklogCount: null,
      parkedPhysicalLaneCount: null,
      refillHealth: '',
      refillState: '',
    }),
    attentionBlockers: Object.freeze(blocker ? [blocker] : []),
    blocker,
    readOnly: true,
    rawPathsReturned: false,
    rawLogsReturned: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'CONTROLLER_LANE_PROOF_UNPROVEN',
  });

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return empty('UNPROVEN', 'CONTROLLER_LANE_STATUS_MISSING');
  }
  if (record.statusId !== 'controller-lane-status-current'
      || record.controllerLaneStatusSchemaVersion !== 'stephanos.sovereign-controller-lane-status.v1') {
    return empty('UNPROVEN', 'CONTROLLER_LANE_STATUS_SCHEMA_INVALID');
  }
  const laneStatus = record.controllerLaneStatus;
  if (!laneStatus || typeof laneStatus !== 'object' || Array.isArray(laneStatus)) {
    return empty('UNPROVEN', 'CONTROLLER_LANE_STATUS_PAYLOAD_INVALID');
  }

  const observedCandidate = text(laneStatus.capturedAtUtc || record.timestampUtc, 40);
  const observedMs = Date.parse(observedCandidate);
  if (!Number.isFinite(observedMs)) return empty('UNPROVEN', 'CONTROLLER_LANE_STATUS_TIMESTAMP_INVALID');
  const observedAtUtc = new Date(observedMs).toISOString();
  const ageMs = Math.max(0, nowMs - observedMs);
  const stale = ageMs > CONTROLLER_LANE_STATUS_SPEC.staleAfterMs;

  const rawPhysical = laneStatus.physical && typeof laneStatus.physical === 'object' ? laneStatus.physical : {};
  const controllers = Object.freeze((Array.isArray(rawPhysical.controllers) ? rawPhysical.controllers : [])
    .slice(0, 5)
    .map((controller) => Object.freeze({
      controllerId: safeBeaconToken(controller?.controllerId, 80),
      freshness: safeBeaconToken(controller?.freshness, 40),
      activityState: safeBeaconToken(controller?.activityState, 80),
      trafficLight: safeBeaconToken(controller?.trafficLight, 20),
      materialLaneCount: numericCount(controller?.materialLaneCount),
      activeLaneCount: numericCount(controller?.activeLaneCount),
      parkedLaneCount: numericCount(controller?.parkedLaneCount),
      safeEligibleWorkRemaining: numericCount(controller?.safeEligibleWorkRemaining),
      blocker: safeBeaconToken(controller?.blocker, 160),
    })));
  const physical = Object.freeze({
    expected: numericCount(rawPhysical.expected),
    building: numericCount(rawPhysical.building),
    amber: numericCount(rawPhysical.amber),
    red: numericCount(rawPhysical.red),
    unknown: numericCount(rawPhysical.unknown),
    allCurrent: rawPhysical.allCurrent === true,
    allObservedEnabled: rawPhysical.allObservedEnabled === true,
    finalVerdict: safeBeaconToken(rawPhysical.finalVerdict, 100),
    controllers,
  });

  const rawLogical = laneStatus.logical && typeof laneStatus.logical === 'object' ? laneStatus.logical : {};
  const logicalBlockers = Object.freeze((Array.isArray(rawLogical.blockers) ? rawLogical.blockers : [])
    .slice(0, 12)
    .map((value) => safeBeaconToken(value, 160))
    .filter(Boolean));
  const logical = Object.freeze({
    current: rawLogical.current === true,
    valid: rawLogical.valid === true,
    physicalControllerCount: numericCount(rawLogical.physicalControllerCount),
    total: numericCount(rawLogical.total),
    active: numericCount(rawLogical.active),
    tracking: numericCount(rawLogical.tracking),
    parked: numericCount(rawLogical.parked),
    retired: numericCount(rawLogical.retired),
    selectedForAdmission: numericCount(rawLogical.selectedForAdmission),
    finalVerdict: safeBeaconToken(rawLogical.finalVerdict, 100),
    blockers: logicalBlockers,
  });

  const rawLanes = laneStatus.lanes && typeof laneStatus.lanes === 'object' ? laneStatus.lanes : {};
  const refillHealth = safeBeaconToken(rawLanes.refillHealth, 20);
  const refillState = safeBeaconToken(rawLanes.refillState, 120);
  const lanes = Object.freeze({
    targetMaterialLanes: numericCount(rawLanes.targetMaterialLanes),
    activeMaterialLaneCount: numericCount(rawLanes.activeMaterialLaneCount),
    activeLaneClaimCount: numericCount(rawLanes.activeLaneClaimCount),
    freeTargetLaneSlots: numericCount(rawLanes.freeTargetLaneSlots),
    runnableBacklogCount: numericCount(rawLanes.runnableBacklogCount),
    parkedPhysicalLaneCount: numericCount(rawLanes.parkedPhysicalLaneCount),
    refillHealth,
    refillState,
  });

  const attentionBlockers = Object.freeze([...new Set([
    ...controllers
      .filter((controller) => controller.trafficLight === 'RED')
      .map((controller) => controller.blocker || controller.controllerId)
      .filter(Boolean),
    ...logicalBlockers,
    ...(logical.valid === false ? [logical.finalVerdict] : []),
    ...(refillHealth === 'RED' ? [refillState] : []),
  ].filter(Boolean))].slice(0, 16));

  const red = !stale && (
    Number(physical.red) > 0
    || logical.valid === false
    || refillHealth === 'RED'
  );
  const trafficLight = stale ? 'AMBER' : red ? 'RED' : 'AMBER';
  const state = stale
    ? 'STALE'
    : red
      ? 'ATTENTION_REQUIRED'
      : refillHealth || 'CURRENT_UNBOUND';
  const blocker = attentionBlockers[0]
    || (stale ? 'CONTROLLER_LANE_STATUS_STALE' : 'CONTROLLER_LANE_STATUS_HEAD_BINDING_UNAVAILABLE');

  return Object.freeze({
    available: true,
    state,
    trafficLight,
    observedAtUtc,
    ageMs,
    sourceHeadBound: false,
    exactHeadMatch: null,
    physical,
    logical,
    lanes,
    attentionBlockers,
    blocker: trafficLight === 'RED' || stale ? blocker : '',
    readOnly: true,
    rawPathsReturned: false,
    rawLogsReturned: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: trafficLight === 'RED'
      ? 'CONTROLLER_LANE_PROOF_ATTENTION_REQUIRED'
      : 'CONTROLLER_LANE_PROOF_UNPROVEN',
  });
}

function augmentRecordWithWorkerWatchdog(record, workerWatchdogRecord, qualifiedRepairPolicies = [], sovereignRepairRecord = null, controllerLaneStatusRecord = null) {
  const nowMs = Date.parse(String(record?.observedAtUtc || ''));
  const workerSurface = projectBeaconStatus(
    workerWatchdogRecord,
    WORKER_WATCHDOG_SPEC,
    Number.isFinite(nowMs) ? nowMs : Date.now(),
    record?.sourceHead || '',
  );
  const existing = Array.isArray(record?.surfaces)
    ? record.surfaces.filter((surface) => surface?.id !== 'workerWatchdog')
    : [];
  const missionIndex = existing.findIndex((surface) => surface?.id === 'missionWorker');
  const surfaces = missionIndex >= 0
    ? [...existing.slice(0, missionIndex), workerSurface, ...existing.slice(missionIndex)]
    : [...existing, workerSurface];
  const telemetry = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: record.sourceHead,
    surfaces,
    qualifiedRepairPolicies,
  });
  const blockers = telemetry.repairCandidates
    .map((candidate) => `${candidate.surfaceId}:${candidate.blocker || candidate.gapClass}`)
    .slice(0, 12);
  const sovereignRepair = projectSovereignRepairBeaconFacts(
    sovereignRepairRecord,
    record?.sourceHead || '',
    Number.isFinite(nowMs) ? nowMs : Date.now(),
  );
  const controllerLaneStatus = projectControllerLaneBeaconFacts(
    controllerLaneStatusRecord,
    Number.isFinite(nowMs) ? nowMs : Date.now(),
  );
  return Object.freeze({
    ...record,
    sovereignRepair,
    controllerLaneStatus,
    surfaces: Object.freeze(surfaces),
    blockerCount: blockers.length,
    blockers: Object.freeze(blockers),
    freshness: blockers.length > 0 ? 'DEGRADED' : 'FRESH',
    completeStateAnswerable: telemetry.completeStateAnswerable,
    telemetryCompleteness: telemetry.telemetryCompleteness,
    operatorNeeded: telemetry.operatorNeededNow,
    operatorAuthorizationState: telemetry.operatorAuthorizationState,
    nextAutomaticAction: telemetry.nextAutomaticAction,
    telemetry,
  });
}

export function buildBattleBridgeOutboundBeacon(args = {}) {
  const base = core.buildBattleBridgeOutboundBeacon(args);
  return augmentRecordWithWorkerWatchdog(
    base,
    args.statusRecords?.workerWatchdog || null,
    args.qualifiedRepairPolicies || [],
    args.statusRecords?.sovereignRepair || null,
    args.statusRecords?.controllerLaneStatus || null,
  );
}

function digestRecord(record) {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function assertMirrorRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_RECORD_INVALID');
  if (record.schemaVersion !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_SCHEMA) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_SCHEMA_INVALID');
  if (record.repository !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_REPOSITORY_INVALID');
  if (record.issueNumber !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_ISSUE_INVALID');
  if (record.branch !== 'main' || !validHead(record.sourceHead)) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_SOURCE_IDENTITY_INVALID');
  if (!Number.isFinite(Date.parse(text(record.observedAtUtc)))) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_TIMESTAMP_INVALID');
  if (record.readOnly !== true
      || record.sourceMutationAllowed !== false
      || record.taskMutationAllowed !== false
      || record.processRestartAllowed !== false
      || record.arbitraryShellAllowed !== false
      || record.destructiveGitAllowed !== false
      || record.liveOpenClawUpdateAllowed !== false
      || record.pcRestartAllowed !== false) {
    throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_AUTHORITY_INVALID');
  }
  return record;
}

export function mirrorBattleBridgeCompleteStateToSharedWorkspace({ workspaceRoot, repoRoot, record } = {}) {
  const validated = assertMirrorRecord(record);
  const resolved = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments: ['status', BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE],
  });
  if (!resolved.ok) throw new Error(`BATTLE_BRIDGE_COMPLETE_STATE_MIRROR_${resolved.reason}`);

  mkdirSync(dirname(resolved.path), { recursive: true });
  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    writeFileSync(tempPath, payload, { flag: 'wx', mode: 0o600 });
    renameSync(tempPath, resolved.path);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }

  return Object.freeze({
    ok: true,
    state: 'SHARED_WORKSPACE_COMPLETE_STATE_MIRRORED',
    fileName: BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE,
    schemaVersion: validated.schemaVersion,
    sourceHead: validated.sourceHead,
    observedAtUtc: validated.observedAtUtc,
    recordSha256: digestRecord(validated),
  });
}

export function compareBattleBridgeCompleteStateMirrors(githubRecord, sharedWorkspaceRecord) {
  if (!githubRecord || typeof githubRecord !== 'object' || Array.isArray(githubRecord)
      || !sharedWorkspaceRecord || typeof sharedWorkspaceRecord !== 'object' || Array.isArray(sharedWorkspaceRecord)) {
    return Object.freeze({ state: 'UNPROVEN', consistent: false, mismatches: Object.freeze(['record-missing']) });
  }

  const invalidRecords = [];
  try {
    assertMirrorRecord(githubRecord);
  } catch {
    invalidRecords.push('github-record-invalid');
  }
  try {
    assertMirrorRecord(sharedWorkspaceRecord);
  } catch {
    invalidRecords.push('shared-workspace-record-invalid');
  }
  if (invalidRecords.length > 0) {
    return Object.freeze({
      state: 'UNPROVEN',
      consistent: false,
      mismatches: Object.freeze(invalidRecords),
    });
  }

  const fields = [
    'schemaVersion',
    'repository',
    'issueNumber',
    'observedAtUtc',
    'sourceHead',
    'branch',
    'freshness',
    'completeStateAnswerable',
    'telemetryCompleteness',
    'operatorNeeded',
    'nextAutomaticAction',
  ];
  const mismatches = fields.filter((field) => JSON.stringify(githubRecord[field]) !== JSON.stringify(sharedWorkspaceRecord[field]));
  const githubDigest = digestRecord(githubRecord);
  const sharedWorkspaceDigest = digestRecord(sharedWorkspaceRecord);
  if (githubDigest !== sharedWorkspaceDigest && mismatches.length === 0) mismatches.push('record-digest');
  return Object.freeze({
    state: mismatches.length === 0 ? 'CONSISTENT' : 'CONFLICTING',
    consistent: mismatches.length === 0,
    sourceHead: validHead(githubRecord.sourceHead) || validHead(sharedWorkspaceRecord.sourceHead),
    observedAtUtc: text(githubRecord.observedAtUtc || sharedWorkspaceRecord.observedAtUtc),
    githubRecordSha256: githubDigest,
    sharedWorkspaceRecordSha256: sharedWorkspaceDigest,
    mismatches: Object.freeze(mismatches),
  });
}

function runFixed(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    maxBuffer: MAX_GITHUB_BYTES,
  });
  return Object.freeze({
    ok: !result.error && result.status === 0,
    status: result.status ?? null,
    stdout: String(result.stdout || ''),
    stderr: text(result.stderr || result.error?.message || '', 500),
  });
}

function existingBeaconCommentId(repoRoot) {
  const endpoint = `repos/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments?per_page=100`;
  const observed = readBrokeredGithubJson({
    key: `health-beacon-thread:${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}`,
    endpoint,
    args: ['--paginate', '--slurp'],
    ttlMs: 6 * 60 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
    ghCommand: BATTLE_BRIDGE_WINDOWS_HOST.githubCli,
    cwd: repoRoot,
  });
  if (!observed.ok) throw new Error('OUTBOUND_BEACON_GITHUB_READ_FAILED');
  const pages = observed.payload;
  const comments = Array.isArray(pages) ? pages.flat().filter((value) => value && typeof value === 'object') : [];
  const matches = comments.filter((comment) => String(comment.body || '').includes(core.BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER));
  const id = Number(matches.at(-1)?.id || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function publishBeacon(repoRoot, body) {
  const existingId = existingBeaconCommentId(repoRoot);
  const publication = publishBrokeredGithubMutation({
    key: `health-beacon-publication:${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}`,
    body,
    material: core.buildBattleBridgeOutboundBeaconMaterialBody(body),
    heartbeatMs: 5 * 60_000,
    publish: (nextBody) => {
      const args = existingId
        ? ['api', '-X', 'PATCH', `repos/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/comments/${existingId}`, '-f', `body=${nextBody}`]
        : ['api', '-X', 'POST', `repos/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments`, '-f', `body=${nextBody}`];
      const result = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, args, { cwd: repoRoot, timeout: 120_000 });
      if (result.ok && !existingId) {
        invalidateBrokeredGithubObservation({ key: `health-beacon-thread:${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}` });
      }
      return Object.freeze({ ok: result.ok, reason: result.ok ? (existingId ? 'UPDATED' : 'CREATED') : 'OUTBOUND_BEACON_GITHUB_PUBLISH_FAILED' });
    },
  });
  if (!publication.ok) throw new Error('OUTBOUND_BEACON_GITHUB_PUBLISH_FAILED');
  return publication.published === false ? publication.reason : (existingId ? 'UPDATED' : 'CREATED');
}

export function runBattleBridgeOutboundHealthBeacon(options = {}) {
  const requestedPublish = typeof options.publish === 'function' ? options.publish : publishBeacon;
  const coreResult = core.runBattleBridgeOutboundHealthBeacon({
    ...options,
    publish: () => 'CAPTURED_FOR_WATCHDOG_AUGMENTATION',
  });
  const env = options.env || process.env;
  const repoRoot = resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
  const workerWatchdogRecord = readJsonBounded(join(workspaceRoot, ...WORKER_WATCHDOG_SPEC.path.split('/')));
  const sovereignRepairRecord = readJsonBounded(join(workspaceRoot, ...SOVEREIGN_REPAIR_SPEC.path.split('/')));
  const controllerLaneStatusRecord = readJsonBounded(join(workspaceRoot, ...CONTROLLER_LANE_STATUS_SPEC.path.split('/')));
  const record = augmentRecordWithWorkerWatchdog(
    coreResult.record,
    workerWatchdogRecord,
    [],
    sovereignRepairRecord,
    controllerLaneStatusRecord,
  );
  const publication = requestedPublish(repoRoot, core.buildBattleBridgeOutboundBeaconBody(record));
  const mirror = typeof options.mirror === 'function' ? options.mirror : mirrorBattleBridgeCompleteStateToSharedWorkspace;
  const workspaceMirror = mirror({ workspaceRoot, repoRoot, record });
  return Object.freeze({ ...coreResult, publication, record, workspaceMirror });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = runBattleBridgeOutboundHealthBeacon();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${text(error?.message || error, 200)}\n`);
    process.exitCode = 1;
  }
}
