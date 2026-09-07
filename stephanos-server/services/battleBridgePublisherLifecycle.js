import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createBattleBridgeSupervisorStartupPublisher } from '../../shared/agents/battleBridgePublisherLoop.mjs';
import {
  BATTLE_BRIDGE_SERVICE_STATUS,
  createBattleBridgePublisherSlice,
} from '../../shared/agents/battleBridgePublisher.mjs';
import {
  DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
  projectMissionWorkerHeartbeat,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { validateSharedWorkspaceFeedConfig, MISSING_WORKSPACE_NEXT_ACTION } from './sharedWorkspaceDashboardFeedService.js';

export const BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS = 5 * 60 * 1000;

function timestampMs(...values) {
  for (const value of values) {
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function isFresh(recordTimestamp, nowTimestamp, maxAgeMs = BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS) {
  const observedMs = timestampMs(recordTimestamp);
  const nowMs = timestampMs(nowTimestamp);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return false;
  const ageMs = nowMs - observedMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function servicePublication(service = {}, { fresh, name }) {
  if (!fresh) return {
    status: BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN,
    reachable: false,
    usable: false,
    browserCompatible: false,
    summary: `${name} source evidence is missing or stale.`,
    exactNextAction: `Refresh the existing ${name} proof source; do not infer live health from stale evidence.`,
  };
  const ready = service?.ready === true || String(service?.state || '').toLowerCase() === 'ready';
  return {
    status: ready ? BATTLE_BRIDGE_SERVICE_STATUS.READY : BATTLE_BRIDGE_SERVICE_STATUS.DEGRADED,
    reachable: ready,
    usable: ready,
    browserCompatible: ready,
    summary: ready ? `${name} is ready in the fresh Ignition supervisor record.` : `${name} is not ready in the fresh Ignition supervisor record.`,
    exactNextAction: ready ? 'Continue polling the current Battle Bridge proof sources.' : `Use the existing ${name} recovery route and prove recovery before claiming ready.`,
  };
}

function workerPublication(worker = {}, {
  timestampUtc,
  expectedRepositoryRoot,
  expectedHeadSha,
} = {}) {
  const projection = projectMissionWorkerHeartbeat(worker, {
    nowUtc: timestampUtc,
    maxAgeMs: DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
    expectedRepositoryRoot,
    expectedHeadSha,
  });
  const ready = projection.valid && projection.fresh;
  const stale = projection.valid && projection.stale;
  return {
    status: ready ? BATTLE_BRIDGE_SERVICE_STATUS.READY : BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN,
    reachable: ready,
    usable: ready,
    browserCompatible: false,
    summary: ready
      ? `Mission Worker heartbeat is canonically valid and fresh (${projection.lastTickVerdict}).`
      : stale
        ? `Mission Worker heartbeat is canonically valid but stale (${projection.ageMs}ms).`
        : `Mission Worker heartbeat failed canonical validation (${projection.errors.join(',') || projection.finalVerdict}).`,
    exactNextAction: ready
      ? 'Continue polling the canonical Mission Worker heartbeat.'
      : 'Use the existing Mission Worker watchdog/recovery route and require a fresh exact-repository/exact-head canonical heartbeat.',
  };
}

export function buildBattleBridgePublisherLiveSlice({
  supervisor = null,
  worker = null,
  timestampUtc,
  expectedRepositoryRoot,
  expectedHeadSha,
} = {}) {
  const supervisorTimestamp = supervisor?.generatedAt || supervisor?.generatedAtUtc || supervisor?.timestampUtc || supervisor?.observedAtUtc;
  const supervisorFresh = isFresh(supervisorTimestamp, timestampUtc);
  const supervisorGreen = supervisorFresh && String(supervisor?.trafficLight || supervisor?.status || '').toLowerCase() === 'green';

  return createBattleBridgePublisherSlice({
    timestampUtc,
    services: {
      backend: servicePublication(supervisor?.services?.backend8787, { fresh: supervisorFresh, name: 'backend8787' }),
      'battle-bridge-supervisor': {
        status: supervisorGreen ? BATTLE_BRIDGE_SERVICE_STATUS.READY : (supervisorFresh ? BATTLE_BRIDGE_SERVICE_STATUS.DEGRADED : BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN),
        reachable: supervisorGreen,
        usable: supervisorGreen,
        browserCompatible: false,
        summary: supervisorGreen ? 'Battle Bridge Ignition supervisor proof is fresh and green.' : (supervisorFresh ? 'Battle Bridge Ignition supervisor proof is fresh but not green.' : 'Battle Bridge Ignition supervisor proof is missing or stale.'),
        exactNextAction: supervisorGreen ? 'Continue polling the current Ignition supervisor proof.' : 'Refresh the existing Ignition supervisor proof before claiming Battle Bridge readiness.',
      },
      'mission-worker': workerPublication(worker, {
        timestampUtc,
        expectedRepositoryRoot,
        expectedHeadSha,
      }),
      'openclaw-gateway': servicePublication(supervisor?.services?.openClaw18789, { fresh: supervisorFresh, name: 'openClaw18789' }),
    },
  });
}

async function readWorkspaceJson(root, relativePath) {
  try {
    const source = await readFile(join(root, ...relativePath), 'utf8');
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function buildBattleBridgePublisherLiveSliceFromWorkspace(root, {
  timestampUtc,
  expectedRepositoryRoot,
  expectedHeadSha,
} = {}) {
  const [supervisor, worker] = await Promise.all([
    readWorkspaceJson(root, ['status', 'battle-bridge-ignition-supervisor-current.json']),
    readWorkspaceJson(root, ['status', 'mission-orchestrator-worker-heartbeat.json']),
  ]);
  return buildBattleBridgePublisherLiveSlice({
    supervisor,
    worker,
    timestampUtc,
    expectedRepositoryRoot,
    expectedHeadSha,
  });
}

export async function startBattleBridgePublisherLoopForBackend(input = {}) {
  const validation = await validateSharedWorkspaceFeedConfig(input);
  if (!validation.ok) {
    return Object.freeze({
      started: false,
      state: 'unavailable',
      reason: validation.reason,
      workspaceRoot: 'UNKNOWN',
      exactNextAction: MISSING_WORKSPACE_NEXT_ACTION,
      stop: () => ({ stopped: true, finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_NOT_STARTED' }),
    });
  }
  const expectedRepositoryRoot = input.repoRoot;
  const expectedHeadSha = String(input.env?.STEPHANOS_BACKEND_SOURCE_HEAD || '').trim().toLowerCase();
  const loop = createBattleBridgeSupervisorStartupPublisher({
    root: validation.root,
    repoRoot: input.repoRoot,
    intervalMs: input.intervalMs,
    runImmediately: input.runImmediately,
    buildSlice: ({ timestampUtc }) => buildBattleBridgePublisherLiveSliceFromWorkspace(validation.root, {
      timestampUtc,
      expectedRepositoryRoot,
      expectedHeadSha,
    }),
  });
  return Object.freeze({
    started: true,
    state: 'ready',
    reason: 'BATTLE_BRIDGE_PUBLISHER_LOOP_STARTED',
    workspaceRoot: validation.root,
    loop,
    stop: () => loop.stop(),
  });
}