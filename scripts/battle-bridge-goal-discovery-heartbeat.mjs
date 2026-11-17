#!/usr/bin/env node
import process from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resolveGoalDiscoveryWorkspaceV1 } from '../shared/agents/goalDiscoveryWorkspaceV1.mjs';
import { readCanonicalMissionWorkerHeartbeatAgeMs, readCanonicalMissionWorkerSourceIdentity, readCanonicalMissionWorkerCapacityObservationEvidenceV1, canonicalMissionWorkerEvidenceAllowsWork } from '../shared/agents/canonicalMissionWorkerEvidenceV1.mjs';

import {
  AUTONOMY_BUILD_TRACK_STATUS_ID,
  projectHeartbeatAutonomyBuildTrack,
} from '../shared/agents/autonomyBuildTrackV1.mjs';
import {
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  ensureCriticalBacklogMission,
  resolveCriticalBacklogRuntimePaths,
} from '../stephanos-server/services/criticalBacklogConveyorService.js';
import { refreshForgeLifeboatCapacity } from '../stephanos-server/services/forgeLifeboatCapacityService.js';
import { refreshDesktopCommanderCapacity } from '../stephanos-server/services/desktopCommanderCapacityService.js';
import { refreshSovereignBuilder8Capacity } from '../stephanos-server/services/sovereignBuilder8CapacityService.js';
import { refreshOpenClawProviderPoolCapacity } from '../stephanos-server/services/openClawProviderPoolAdmissionService.js';
import { runGitHubLifeboatLane7 } from '../stephanos-server/services/githubLifeboatLane7Service.js';
import { refreshGitHubLifeboatLane7ClaimAck } from '../stephanos-server/services/githubLifeboatLane7ClaimAckKeeper.js';
import { resolveMissionWorkerQueueRoot } from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import { decideWorkConservingControllerCycleV1 } from '../shared/agents/providerNeutralExecutionCompatibilityV1.mjs';

// Source execution belongs to the existing supervised Mission Worker, not
// this short maintenance heartbeat. Publication remains the conveyor's job.
export async function deferSourceBuildToCanonicalWorkerV1() {
  return Object.freeze({processed:false,success:false,pickupProven:false,
    reason:'CANONICAL_MISSION_WORKER_SOURCE_PICKUP_PENDING',
    finalVerdict:'CANONICAL_MISSION_WORKER_SOURCE_PICKUP_PENDING'});
}

export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA = 'stephanos.battle-bridge-goal-discovery-heartbeat.v1';
export const BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER = 'BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT=';
export const DEFAULT_WORK_CONSERVING_SWEEP_LIMIT = 8;
export const CAPACITY_OBSERVATION_MAX_MS = 30_000;
export const BATTLE_BRIDGE_CANONICAL_GITHUB_CLI = process.platform === 'win32'
  ? 'C:\\Program Files\\GitHub CLI\\gh.exe'
  : 'gh';

function heldElasticDispatch(result = {}) {
  const ignition = result?.elasticIgnition;
  const dispatchCount = Number(ignition?.dispatchCount || 0);
  const held = Array.isArray(ignition?.held) ? ignition.held : [];
  if (dispatchCount > 0 || held.length === 0) return null;
  return Object.freeze({
    classification: String(ignition?.classification || 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD'),
    held: Object.freeze(held.map((item) => Object.freeze({
      missionId: String(item?.missionId || ''),
      reason: String(item?.reason || 'ELASTIC_SOURCE_BUILD_HELD'),
    }))),
  });
}

// One existing model/resource capacity observation, never a substitute for the
// operational worker predicate used by every admission/dispatch path below.
export async function runBattleBridgeCapacityObservationHeartbeat({
  env = process.env,
  expectedSourceHead = '', budgetMs = CAPACITY_OBSERVATION_MAX_MS,
  paths = resolveCriticalBacklogRuntimePaths(),
  readWorkerObservation = readCanonicalMissionWorkerCapacityObservationEvidenceV1,
  refreshLifeboatCapacity = refreshForgeLifeboatCapacity, lifeboatOptions = {},
  nowMs = () => performance.now(),
} = {}) {
  const base = { capacityObservationOnly: true, admissionAttempted: false,
    sourceBuildAttempted: false, idleProven: false, physicalExclusionGranted: false,
    workAuthorized: false, ...authorityBoundary() };
  let lifeboatCapacity;
  const held = blocker => Object.freeze({ ...base, ok: false, blocker,
    workerObservationProven: false, capacityObservationProven: false,
    ...(lifeboatCapacity === undefined ? {} : { lifeboatCapacity }),
    finalVerdict: 'CAPACITY_OBSERVATION_HELD' });
  if (!/^[a-f0-9]{40}$/.test(expectedSourceHead)) return held('CAPACITY_OBSERVATION_SOURCE_UNPROVEN');
  const began = nowMs();
  if (!Number.isFinite(began) || !Number.isFinite(budgetMs) || budgetMs <= 0) return held('CAPACITY_OBSERVATION_BUDGET_EXHAUSTED');
  const deadline = began + Math.min(CAPACITY_OBSERVATION_MAX_MS, budgetMs);
  let previousClockMs = began, invalidClock = false;
  const remaining = () => {
    const current = nowMs();
    if (!Number.isFinite(current) || current < previousClockMs) invalidClock = true;
    previousClockMs = current;
    return invalidClock ? 0 : Math.floor(deadline - current);
  };
  // Keep final identity observation and wrapper debt/cleanup time separate from
  // generation. Filesystem completion remains cooperative, never detached.
  const observationRemaining = () => Math.max(0, remaining() - 1_000);
  const producerRemaining = () => Math.max(0, remaining() - 2_000);
  const identity = evidence => evidence?.capacityObservationAllowed === true
    && evidence.observationOnly === true && evidence.workAuthorized === false
    && evidence.sourceHead === expectedSourceHead && Number.isInteger(evidence.pid) && evidence.pid > 0
    && /^[a-f0-9]{64}$/.test(evidence.launchIdentityId || '')
    && typeof evidence.workerStartedAtUtc === 'string' && Number.isFinite(Date.parse(evidence.workerStartedAtUtc))
    ? JSON.stringify([evidence.sourceHead, evidence.pid, evidence.launchIdentityId, evidence.workerStartedAtUtc]) : '';
  try {
    if (producerRemaining() <= 0) return held('CAPACITY_OBSERVATION_BUDGET_EXHAUSTED');
    const observationOptions = { env, workspaceRoot: paths.workspaceRoot, expectedSourceHead, remainingMs: observationRemaining };
    const before = await readWorkerObservation(observationOptions);
    const binding = identity(before);
    if (!binding) return held('CAPACITY_OBSERVATION_WORKER_UNPROVEN');
    const probeTimeoutMs = Math.min(10_000, producerRemaining());
    if (probeTimeoutMs <= 0) return held('CAPACITY_OBSERVATION_BUDGET_EXHAUSTED');
    // The existing producer independently checks current source/model and the
    // fresh governor before probing and publishing. No execution is requested.
    lifeboatCapacity = await refreshLifeboatCapacity({ ...lifeboatOptions, env, paths, probeTimeoutMs,
      remainingMs: producerRemaining,
      // Reuse the canonical fixed-Git source observer and reduce each finite
      // child timeout to this stage's remaining budget. This supplies no
      // resource/execution permission.
      readSourceHead: () => {
        const source = readCanonicalMissionWorkerSourceIdentity({ env, remainingMs: producerRemaining });
        return source.ok && source.sourceHead === expectedSourceHead ? source.sourceHead : '';
      },
    });
    if (observationRemaining() <= 0) return held('CAPACITY_OBSERVATION_BUDGET_EXHAUSTED');
    const after = await readWorkerObservation(observationOptions);
    if (identity(after) !== binding) return held('CAPACITY_OBSERVATION_WORKER_CHANGED');
    if (observationRemaining() <= 0) return held('CAPACITY_OBSERVATION_BUDGET_EXHAUSTED');
    // A producer receipt is model/resource evidence. An identity change can
    // hold this stage but cannot retroactively rewrite that independent receipt.
    return Object.freeze({ ...base, ok: lifeboatCapacity?.ok === true,
      sourceHead: expectedSourceHead, workerObservationProven: true,
      capacityObservationProven: lifeboatCapacity?.ok === true,
      reportedWorkerVerdict: String(after.reportedTickVerdict || ''),
      executionMetadataState: after.executionMetadataState === 'REPORTED' ? 'REPORTED' : 'UNREPORTED',
      blocker: lifeboatCapacity?.ok === true ? '' : String(lifeboatCapacity?.reason || 'FORGE_CAPACITY_OBSERVATION_UNAVAILABLE'),
      lifeboatCapacity: lifeboatCapacity || null,
      finalVerdict: lifeboatCapacity?.ok === true ? 'CAPACITY_OBSERVATION_COMPLETE' : 'CAPACITY_OBSERVATION_HELD' });
  } catch { return held('CAPACITY_OBSERVATION_EXCEPTION'); }
}

function authorityBoundary() {
  return {
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
  };
}

function sweepLimit(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return DEFAULT_WORK_CONSERVING_SWEEP_LIMIT;
  return numeric;
}

function observedResourceDerivedSweepWidth(result = {}) {
  const admission = result?.elasticAdmission || {};
  const ignition = result?.elasticIgnition || {};
  const inventoryCounts = [
    admission.admittedIssueNumbers,
    admission.activeMissions,
    admission.runnableMissions,
    ignition.dispatched,
    ignition.held,
  ].filter(Array.isArray).map((items) => items.length);
  return Math.max(DEFAULT_WORK_CONSERVING_SWEEP_LIMIT, ...inventoryCounts);
}

function goalBuildCycleId(timestampUtc) {
  const compact = String(timestampUtc || '').replace(/[^0-9]/g, '').slice(0, 17);
  return `goal-build-cycle-${compact || 'unknown'}`;
}

function buildCycleDecision({ result, materialActionsSucceeded, waitingLaneCount, noRunnableSourceWorkProven = false } = {}) {
  const admission = result?.elasticAdmission || {};
  const ignition = result?.elasticIgnition || {};
  const safeEligibleWorkRemaining = noRunnableSourceWorkProven
    ? 0
    : (Array.isArray(admission.runnableMissions) ? admission.runnableMissions.length : 0);
  const freeCandidate = Number(
    ignition.availableSlots
      ?? admission.remainingAdmissionSlots
      ?? 0,
  );
  const provenSafeFreeLanes = noRunnableSourceWorkProven
    ? 0
    : (Number.isSafeInteger(freeCandidate) && freeCandidate > 0 ? freeCandidate : 0);
  return decideWorkConservingControllerCycleV1({
    materialActionsSucceeded,
    safeEligibleWorkRemaining,
    provenSafeFreeLanes,
    waitingLaneCount,
    allPermittedLanesExactlyParked: noRunnableSourceWorkProven,
  });
}

function addElasticBlockers(blockers, elasticHold) {
  for (const item of elasticHold?.held || []) blockers.add(`${item.missionId}:${item.reason}`);
}

function elasticDispatchMissionIds(result = {}) {
  const dispatched = Array.isArray(result?.elasticIgnition?.dispatched)
    ? result.elasticIgnition.dispatched
    : [];
  return dispatched
    .map((item) => String(item?.missionId || '').trim().toLowerCase())
    .filter(Boolean);
}

const PICKUP_PENDING_DISPATCH_STATUSES = new Set([
  'pending',
  'published',
  'accepted',
  'queued',
  'claimed',
  'dispatching',
  'running',
]);

function canonicalPickupPendingElasticMissionIds(result = {}) {
  const activeMissions = Array.isArray(result?.elasticAdmission?.activeMissions)
    ? result.elasticAdmission.activeMissions
    : [];
  return activeMissions
    .filter((mission) => PICKUP_PENDING_DISPATCH_STATUSES.has(
      String(mission?.dispatch?.status || '').trim().toLowerCase(),
    ))
    .map((mission) => String(mission?.missionId || '').trim().toLowerCase())
    .filter(Boolean);
}

function terminalElasticMissionIds(result = {}) {
  const activeIds = new Set((Array.isArray(result?.elasticAdmission?.activeMissions)
    ? result.elasticAdmission.activeMissions
    : [])
    .map((mission) => String(mission?.missionId || '').trim().toLowerCase())
    .filter(Boolean));
  return (Array.isArray(result?.elasticAdmission?.elasticMissions)
    ? result.elasticAdmission.elasticMissions
    : [])
    .map((mission) => String(mission?.missionId || '').trim().toLowerCase())
    .filter((missionId) => missionId && !activeIds.has(missionId));
}

const PROCESSING_PICKUP_ADAPTERS = Object.freeze([
  'codex',
  'openclaw-github-readonly',
  'openclaw-readonly',
  'openclaw-signed',
  'openclaw-standalone',
  'openclaw-local',
  'chatgpt-github',
  'foundry-forge',
  'desktop-commander',
  'sovereign-commander',
  'stephanos-native',
]);

export async function readProcessingPickupMissionIds({
  env = process.env,
  queueRoot = resolveMissionWorkerQueueRoot(env),
  readdirFn = readdir,
  readFileFn = readFile,
} = {}) {
  if (!queueRoot) return Object.freeze([]);
  const missionIds = new Set();
  for (const adapter of PROCESSING_PICKUP_ADAPTERS) {
    const processingRoot = join(queueRoot, adapter, 'processing');
    let entries = [];
    try {
      entries = await readdirFn(processingRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      continue;
    }
    for (const entry of entries.slice(0, 256)) {
      if (!entry?.isFile?.() || !entry.name.endsWith('.json')) continue;
      try {
        const item = JSON.parse(String(await readFileFn(join(processingRoot, entry.name), 'utf8')));
        const missionId = String(item?.missionId || '').trim().toLowerCase();
        const payloadMissionId = String(item?.payload?.missionId || '').trim().toLowerCase();
        if (
          item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
          && String(item?.adapter || '').trim().toLowerCase() === adapter
          && missionId
          && payloadMissionId === missionId
        ) missionIds.add(missionId);
      } catch {}
    }
  }
  return Object.freeze([...missionIds].sort());
}

function sourceBuildBlocker(sourceBuild = {}) {
  const missionId = String(sourceBuild?.missionId || sourceBuild?.actionId || 'claimed-source-lane');
  const reason = String(sourceBuild?.error || sourceBuild?.reason || sourceBuild?.finalVerdict || 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED');
  return `${missionId}:${reason}`;
}

const SAFE_HEARTBEAT_BLOCKER = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;

function conveyorHeartbeatBlocker(result = {}) {
  for (const candidate of [
    result?.blocker,
    result?.activeMissionIgnition?.blocker,
    result?.activeMissionIgnition?.classification,
    result?.classification,
    result?.finalVerdict,
  ]) {
    const blocker = String(candidate || '').trim();
    if (SAFE_HEARTBEAT_BLOCKER.test(blocker)) return blocker;
  }
  return 'GOAL_DISCOVERY_CONVEYOR_BLOCKED';
}

function sourceBuildIsBlocked(sourceBuild = {}) {
  if (sourceBuild?.processed === true) return sourceBuild?.success === false;
  return [
    'PROVIDER_NEUTRAL_ORPHAN_RECOVERY_HOLD',
    'PROVIDER_NEUTRAL_SOURCE_BUILD_EXCEPTION',
    'PROVIDER_NEUTRAL_PENDING_QUEUE_RECOVERY',
  ].includes(String(sourceBuild?.finalVerdict || ''));
}

function provenExceptionIdentity(error = {}) {
  const missionId = typeof error?.missionId === 'string' ? error.missionId.trim() : '';
  const actionId = typeof error?.actionId === 'string' ? error.actionId.trim() : '';
  return Object.freeze({ missionId, actionId });
}

function sourceBuildException(error) {
  const identity = provenExceptionIdentity(error);
  const detail = String(error?.message || 'unknown source-builder exception')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 512);
  return Object.freeze({
    processed: false,
    success: false,
    missionId: identity.missionId,
    actionId: identity.actionId,
    providerInvoked: false,
    providerCompleted: false,
    failureStage: 'WORKER',
    reason: 'PROVIDER_NEUTRAL_SOURCE_BUILD_EXCEPTION',
    error: detail,
    finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_BUILD_EXCEPTION',
  });
}

function frozenSweepAttempt({ cycleId, attemptNumber, result, sourceBuild, elasticHold, autonomyTrack }) {
  return Object.freeze({
    cycleId,
    attemptNumber,
    conveyorClassification: String(result?.classification || ''),
    sourceBuildProcessed: sourceBuild?.processed === true,
    sourceBuildSuccess: sourceBuild?.success === true,
    sourceBuildMissionId: String(sourceBuild?.missionId || ''),
    sourceBuildVerdict: String(sourceBuild?.finalVerdict || sourceBuild?.reason || ''),
    elasticHoldClassification: String(elasticHold?.classification || ''),
    autonomyCurrentGate: String(autonomyTrack?.currentGate || ''),
    autonomyCurrentState: String(autonomyTrack?.currentState || ''),
    gateStates: Object.freeze(Array.isArray(autonomyTrack?.gates)
      ? autonomyTrack.gates.map((gate) => Object.freeze({ id: gate.id, state: gate.state, reason: gate.reason }))
      : []),
  });
}

function unavailableLifeboat(error) {
  return Object.freeze({
    ok: false,
    available: false,
    reason: `FORGE_LIFEBOAT_CAPACITY_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function unavailableDesktopCommander(error) {
  return Object.freeze({
    ok: false,
    available: false,
    reason: `DESKTOP_COMMANDER_CAPACITY_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function unavailableOpenClawProviderPool(error) {
  return Object.freeze({
    ok: false,
    available: false,
    reason: `OPENCLAW_PROVIDER_POOL_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function unavailableGithubLifeboat(error) {
  return Object.freeze({
    ok: false,
    available: false,
    reason: `GITHUB_LIFEBOAT_LANE7_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function unavailableGithubLifeboatClaimAck(error) {
  return Object.freeze({
    ok: false,
    published: false,
    reason: `GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_REFRESH_FAILED:${String(error?.message || 'unknown')}`,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function trackConveyorResult(result, sourceBuild, elasticHold) {
  const built = sourceBuild?.processed === true && sourceBuild?.success === true;
  const blocked = sourceBuildIsBlocked(sourceBuild);
  if (built || blocked || !elasticHold) return result;
  return Object.freeze({
    ...result,
    elasticIgnition: Object.freeze({ ...(result?.elasticIgnition || {}), ok: false }),
  });
}

export async function publishAutonomyBuildTrackStatus(track, {
  paths = resolveCriticalBacklogRuntimePaths(),
} = {}) {
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: AUTONOMY_BUILD_TRACK_STATUS_ID,
      participantId: 'battle-bridge-goal-discovery',
      timestampUtc: track.timestampUtc,
      relatedIssue: '#1622',
      status: `${track.currentGate}:${track.currentState}`,
      summary: track.blocker
        ? `Autonomy build track blocked at ${track.currentGate}: ${track.blocker}`
        : `Autonomy build track is at ${track.currentGate} (${track.currentState}).`,
      proofRefs: [],
    }),
    autonomyTrack: track,
    ...authorityBoundary(),
  });
  return writeAtomicJson(
    paths.workspaceRoot,
    ['status', `${AUTONOMY_BUILD_TRACK_STATUS_ID}.json`],
    statusRecord,
    { repoRoot: paths.repoRoot },
  );
}

async function publishTrackSafely(track, publishTrack, paths) {
  try {
    return await publishTrack(track, { paths });
  } catch (error) {
    return Object.freeze({ ok: false, reason: String(error?.message || 'AUTONOMY_BUILD_TRACK_PUBLICATION_FAILED') });
  }
}

async function projectAndPublishTrack({ result, sourceBuild, elasticHold, timestampUtc, cycleId, attemptNumber, materialActionsSucceeded, successfulMissionIds, cycleDecision, publishTrack, paths }) {
  const autonomyTrack = projectHeartbeatAutonomyBuildTrack({
    conveyorResult: trackConveyorResult(result, sourceBuild, elasticHold),
    sourceBuild: sourceBuild || null,
    timestampUtc,
    cycleId,
    attemptNumber,
    materialActionsSucceeded,
    successfulMissionIds,
    cycleDecision,
  });
  const trackPublication = await publishTrackSafely(autonomyTrack, publishTrack, paths);
  return Object.freeze({ autonomyTrack, trackPublication });
}

export async function runBattleBridgeGoalDiscoveryHeartbeat({
  conveyor = ensureCriticalBacklogMission,
  refreshLifeboatCapacity = refreshForgeLifeboatCapacity,
  lifeboatOptions = {},
  refreshCommanderCapacity = refreshDesktopCommanderCapacity,
  commanderOptions = {},
  refreshSovereignCapacity = refreshSovereignBuilder8Capacity,
  sovereignOptions = {},
  refreshOpenClawCapacity = refreshOpenClawProviderPoolCapacity,
  openClawOptions = {},
  refreshGithubLifeboat = runGitHubLifeboatLane7,
  githubLifeboatOptions = {},
  refreshGithubLifeboatClaimAck = refreshGitHubLifeboatLane7ClaimAck,
  githubLifeboatClaimAckOptions = {},
  buildClaimedGoal = deferSourceBuildToCanonicalWorkerV1,
  builderOptions = {},
  readWorkerHeartbeatAgeMs = readCanonicalMissionWorkerHeartbeatAgeMs,
  readProcessingPickupMissionIdsFn = readProcessingPickupMissionIds,
  maxWorkConservingAttempts,
  paths = resolveCriticalBacklogRuntimePaths(),
  publishTrack = publishAutonomyBuildTrackStatus,
  now = new Date(),
} = {}) {
  const explicitSweepLimit = maxWorkConservingAttempts !== undefined && maxWorkConservingAttempts !== null;
  let limit = sweepLimit(maxWorkConservingAttempts);
  const parkedLaneBlockers = new Set();
  const sweepAttempts = [];
  const timestampUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const cycleId = goalBuildCycleId(timestampUtc);
  let materialActionsSucceeded = 0;
  const successfulMissionIds = new Set();
  const pendingExternalPickupMissionIds = new Set();
  const claimedExternalPickupMissionIds = new Set();
  let lastMaterialSourceBuild = null;
  let lastCycleDecision = null;
  let latestResult = null;
  let latestSourceBuild = null;
  let latestElasticHold = null;
  let latestAutonomyTrack = null;
  let latestTrackPublication = null;
  let lifeboatCapacity = null;
  let commanderCapacity = null;
  let sovereignCapacity = null;
  let openClawCapacity = null;
  let githubLifeboat = null;
  let githubLifeboatClaimAck = null;
  const effectiveBuilderOptions = Object.freeze({
    ...builderOptions,
    repoRoot: builderOptions.repoRoot || paths.repoRoot,
    sharedWorkspaceRoot: resolveGoalDiscoveryWorkspaceV1({ builderOptions, paths }),
  });
  const workerAllowed = () => {
    try {
      const age = readWorkerHeartbeatAgeMs({ workspaceRoot: effectiveBuilderOptions.sharedWorkspaceRoot });
      return canonicalMissionWorkerEvidenceAllowsWork(age);
    } catch { return false; }
  };
  const workerHold = () => Object.freeze({ schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
    ok: false, blocker: 'MISSION_WORKER_CUSTODY_UNPROVEN', cycleId,
    materialActionsSucceeded, sweepAttemptCount: sweepAttempts.length,
    sweepAttempts: Object.freeze([...sweepAttempts]), sourceBuild: latestSourceBuild,
    ...authorityBoundary(), finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED' });
  if (!workerAllowed()) return workerHold();

  try {
    try {
      githubLifeboat = await refreshGithubLifeboat({
        ...githubLifeboatOptions,
        readWorkerHeartbeatAgeMs,
        workerWorkspaceRoot: effectiveBuilderOptions.sharedWorkspaceRoot,
        gitCommand: githubLifeboatOptions.gitCommand || 'git',
        ghCommand: githubLifeboatOptions.ghCommand || BATTLE_BRIDGE_CANONICAL_GITHUB_CLI,
      });
    } catch (error) { githubLifeboat = unavailableGithubLifeboat(error); }

    if (!workerAllowed()) return workerHold();
    try {
      githubLifeboatClaimAck = await refreshGithubLifeboatClaimAck({
        ...githubLifeboatClaimAckOptions,
        readWorkerHeartbeatAgeMs,
        workerWorkspaceRoot: effectiveBuilderOptions.sharedWorkspaceRoot,
        sourceHead: githubLifeboat?.sourceHead || githubLifeboatClaimAckOptions.sourceHead || '',
      });
    } catch (error) { githubLifeboatClaimAck = unavailableGithubLifeboatClaimAck(error); }

    if (!workerAllowed()) return workerHold();
    try { lifeboatCapacity = await refreshLifeboatCapacity(lifeboatOptions); }
    catch (error) { lifeboatCapacity = unavailableLifeboat(error); }

    if (!workerAllowed()) return workerHold();
    try { commanderCapacity = await refreshCommanderCapacity(commanderOptions); }
    catch (error) { commanderCapacity = unavailableDesktopCommander(error); }

    if (!workerAllowed()) return workerHold();
    try { sovereignCapacity = await refreshSovereignCapacity({ paths, ...sovereignOptions }); }
    catch (error) { sovereignCapacity = { ok: false, available: false, reason: 'SOVEREIGN_BUILDER8_CAPACITY_REFRESH_EXCEPTION' }; }

    if (!workerAllowed()) return workerHold();
    try { openClawCapacity = await refreshOpenClawCapacity(openClawOptions); }
    catch (error) { openClawCapacity = unavailableOpenClawProviderPool(error); }

    for (let attemptIndex = 0; attemptIndex < limit; attemptIndex += 1) {
      if (!workerAllowed()) return workerHold();
      const result = await conveyor({
        allowLegacyMissionCreation: false,
        admissionOwner: 'battle-bridge-goal-discovery',
      });
      latestResult = result || null;
      if (!explicitSweepLimit) limit = Math.max(limit, observedResourceDerivedSweepWidth(result));
      if (result?.ok !== true) {
        const projected = await projectAndPublishTrack({
          result: result || { ok: false, blocker: 'CONVEYOR_RESULT_MISSING' },
          sourceBuild: null,
          elasticHold: null,
          timestampUtc,
          cycleId,
          attemptNumber: attemptIndex + 1,
          materialActionsSucceeded,
          successfulMissionIds: [...successfulMissionIds],
          cycleDecision: null,
          publishTrack,
          paths,
        });
        return Object.freeze({
          schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
          ok: false,
          blocker: conveyorHeartbeatBlocker(result || {}),
          cycleId,
          githubLifeboat,
          githubLifeboatClaimAck,
          lifeboatCapacity,
          commanderCapacity,
          sovereignCapacity,
          openClawCapacity,
          conveyorResult: result || null,
          sourceBuild: latestSourceBuild,
          autonomyTrack: projected.autonomyTrack,
          trackPublication: projected.trackPublication,
          sweepAttemptCount: sweepAttempts.length,
          sweepAttempts: Object.freeze([...sweepAttempts]),
          parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
          ...authorityBoundary(),
          finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
        });
      }

      const elasticHold = heldElasticDispatch(result);
      latestElasticHold = elasticHold;
      addElasticBlockers(parkedLaneBlockers, elasticHold);

      for (const missionId of canonicalPickupPendingElasticMissionIds(result)) {
        pendingExternalPickupMissionIds.add(missionId);
      }
      for (const missionId of elasticDispatchMissionIds(result)) {
        pendingExternalPickupMissionIds.add(missionId);
      }
      for (const missionId of terminalElasticMissionIds(result)) {
        pendingExternalPickupMissionIds.delete(missionId);
        claimedExternalPickupMissionIds.delete(missionId);
      }
      let processingPickupMissionIds = [];
      try {
        processingPickupMissionIds = await readProcessingPickupMissionIdsFn({ env: effectiveBuilderOptions.env || process.env });
      } catch {
        processingPickupMissionIds = [];
      }
      for (const missionId of claimedExternalPickupMissionIds) pendingExternalPickupMissionIds.delete(missionId);
      for (const missionId of processingPickupMissionIds) pendingExternalPickupMissionIds.delete(String(missionId).trim().toLowerCase());

      let sourceBuild;
      if (!workerAllowed()) return workerHold();
      try {
        sourceBuild = await buildClaimedGoal(effectiveBuilderOptions);
      } catch (error) {
        sourceBuild = sourceBuildException(error);
      }
      latestSourceBuild = sourceBuild || null;
      const claimedMissionId = sourceBuild?.processed === true
        ? String(sourceBuild?.missionId || '').trim().toLowerCase()
        : '';
      if (claimedMissionId) {
        claimedExternalPickupMissionIds.add(claimedMissionId);
        pendingExternalPickupMissionIds.delete(claimedMissionId);
      }
      const externalPickupPending = pendingExternalPickupMissionIds.size > 0;
      const runnableMissionCount = Array.isArray(result?.elasticAdmission?.runnableMissions)
        ? result.elasticAdmission.runnableMissions.length
        : 0;
      const built = sourceBuild?.processed === true && sourceBuild?.success === true;
      const blocked = sourceBuildIsBlocked(sourceBuild);
      if (built) {
        materialActionsSucceeded += 1;
        lastMaterialSourceBuild = sourceBuild;
        const successfulMissionId = String(
          sourceBuild?.missionId
            || result?.elasticAdmission?.selectedMission?.missionId
            || '',
        ).trim();
        if (successfulMissionId) successfulMissionIds.add(successfulMissionId);
      }

      // A provider-neutral worker returning "no item processed" is not proof that
      // canonical runnable work disappeared. Keep sweeping while the scheduler
      // still exposes runnable missions so safe eligible work cannot collapse
      // into a false healthy-idle result.
      const canonicalProgrammeHeld = String(result?.programmeStatus || '').toUpperCase() === 'HOLD';
      const returningNoWork = !built
        && !blocked
        && !elasticHold
        && !externalPickupPending
        && runnableMissionCount === 0
        && !canonicalProgrammeHeld;
      const observationCycleDecision = returningNoWork
        ? buildCycleDecision({
          result,
          materialActionsSucceeded,
          waitingLaneCount: parkedLaneBlockers.size,
          noRunnableSourceWorkProven: true,
        })
        : null;
      if (observationCycleDecision) lastCycleDecision = observationCycleDecision;

      const projected = await projectAndPublishTrack({
        result,
        sourceBuild,
        elasticHold,
        timestampUtc,
        cycleId,
        attemptNumber: attemptIndex + 1,
        materialActionsSucceeded,
        successfulMissionIds: [...successfulMissionIds],
        cycleDecision: observationCycleDecision,
        publishTrack,
        paths,
      });
      latestAutonomyTrack = projected.autonomyTrack;
      latestTrackPublication = projected.trackPublication;
      sweepAttempts.push(frozenSweepAttempt({
        cycleId,
        attemptNumber: attemptIndex + 1,
        result,
        sourceBuild,
        elasticHold,
        autonomyTrack: projected.autonomyTrack,
      }));

      if (blocked) {
        parkedLaneBlockers.add(sourceBuildBlocker(sourceBuild));
        continue;
      }

      if (built) {
        // A material source action is not a return boundary. Re-observe the
        // canonical scheduler/conveyor so another resource-disjoint goal can
        // consume free capacity in the same unattended cycle.
        continue;
      }

      if (!elasticHold && !externalPickupPending && runnableMissionCount === 0) {
        const materialProgress = materialActionsSucceeded > 0;
        if (canonicalProgrammeHeld) {
          lastCycleDecision = buildCycleDecision({
            result,
            materialActionsSucceeded,
            waitingLaneCount: parkedLaneBlockers.size,
            noRunnableSourceWorkProven: false,
          });
        }
        return Object.freeze({
          schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
          ok: true,
          cycleId,
          githubLifeboat,
          githubLifeboatClaimAck,
          lifeboatCapacity,
          commanderCapacity,
          sovereignCapacity,
          openClawCapacity,
          conveyorResult: result,
          sourceBuild: lastMaterialSourceBuild || sourceBuild || null,
          lastObservedSourceBuild: sourceBuild || null,
          elasticHold: null,
          autonomyTrack: latestAutonomyTrack,
          trackPublication: latestTrackPublication,
          sweepAttemptCount: sweepAttempts.length,
          sweepAttempts: Object.freeze([...sweepAttempts]),
          materialActionsSucceeded,
          successfulMissionIds: Object.freeze([...successfulMissionIds]),
          pendingExternalPickupMissionIds: Object.freeze([...pendingExternalPickupMissionIds]),
          cycleDecision: lastCycleDecision,
          parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
          noRunnableSourceWorkProven: !canonicalProgrammeHeld,
          materialProgress,
          controllerContinuity: canonicalProgrammeHeld ? 'RECONCILE_CANONICAL_PROGRAMME_HOLD' : 'RETURN_WORK_CONSERVING',
          ...authorityBoundary(),
          finalVerdict: canonicalProgrammeHeld
            ? 'GOAL_DISCOVERY_HEARTBEAT_CANONICAL_PROGRAMME_HOLD'
            : materialProgress
              ? 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED'
              : 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE',
        });
      }
    }

    lastCycleDecision = buildCycleDecision({
      result: latestResult,
      materialActionsSucceeded,
      waitingLaneCount: parkedLaneBlockers.size,
      noRunnableSourceWorkProven: false,
    });
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: true,
      cycleId,
      githubLifeboat,
      githubLifeboatClaimAck,
      lifeboatCapacity,
      commanderCapacity,
      sovereignCapacity,
      openClawCapacity,
      conveyorResult: latestResult,
      sourceBuild: lastMaterialSourceBuild || latestSourceBuild,
      lastObservedSourceBuild: latestSourceBuild,
      elasticHold: latestElasticHold,
      autonomyTrack: latestAutonomyTrack,
      trackPublication: latestTrackPublication,
      sweepAttemptCount: sweepAttempts.length,
      sweepAttempts: Object.freeze([...sweepAttempts]),
      materialActionsSucceeded,
      successfulMissionIds: Object.freeze([...successfulMissionIds]),
      pendingExternalPickupMissionIds: Object.freeze([...pendingExternalPickupMissionIds]),
      cycleDecision: lastCycleDecision,
      parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
      heldLaneParked: parkedLaneBlockers.size > 0,
      noRunnableSourceWorkProven: false,
      workConservingSweepExhausted: true,
      materialProgress: materialActionsSucceeded > 0,
      controllerContinuity: 'CONTINUE_NEXT_SWEEP',
      ...authorityBoundary(),
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_WORK_CONSERVING_SWEEP_EXHAUSTED',
    });
  } catch (error) {
    const blocker = String(error?.message || 'GOAL_DISCOVERY_HEARTBEAT_FAILED');
    const projected = await projectAndPublishTrack({
      result: { ok: false, blocker },
      sourceBuild: null,
      elasticHold: null,
      timestampUtc,
      cycleId,
      attemptNumber: sweepAttempts.length + 1,
      materialActionsSucceeded,
      successfulMissionIds: [...successfulMissionIds],
      cycleDecision: null,
      publishTrack,
      paths,
    });
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_SCHEMA,
      ok: false,
      blocker,
      cycleId,
      githubLifeboat,
      githubLifeboatClaimAck,
      lifeboatCapacity,
      commanderCapacity,
      sovereignCapacity,
      openClawCapacity,
      conveyorResult: latestResult,
      sourceBuild: latestSourceBuild,
      autonomyTrack: projected.autonomyTrack,
      trackPublication: projected.trackPublication,
      sweepAttemptCount: sweepAttempts.length,
      sweepAttempts: Object.freeze([...sweepAttempts]),
      parkedLaneBlockers: Object.freeze([...parkedLaneBlockers]),
      ...authorityBoundary(),
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat();
  process.stdout.write(`${BATTLE_BRIDGE_GOAL_DISCOVERY_HEARTBEAT_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
