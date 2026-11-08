import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createConnection } from 'node:net';
import { createBattleBridgeSupervisorStartupPublisher } from '../../shared/agents/battleBridgePublisherLoop.mjs';
import { refreshBattleBridgeSharedWorkspacePublisher } from '../../scripts/battle-bridge-shared-workspace-publisher.mjs';
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
  const live = projection.valid && projection.fresh;
  const ready = live && projection.lastTickAffirmative === true;
  const degraded = live && projection.lastTickAffirmative === false;
  const stale = projection.valid && projection.stale;
  return {
    status: ready
      ? BATTLE_BRIDGE_SERVICE_STATUS.READY
      : degraded
        ? BATTLE_BRIDGE_SERVICE_STATUS.DEGRADED
        : BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN,
    reachable: live,
    usable: ready,
    browserCompatible: false,
    summary: ready
      ? `Mission Worker heartbeat is canonically valid and fresh (${projection.lastTickVerdict}).`
      : degraded
        ? `Mission Worker is live but its last tick is degraded (${projection.lastTickVerdict}).`
        : stale
          ? `Mission Worker heartbeat is canonically valid but stale (${projection.ageMs}ms).`
          : `Mission Worker heartbeat failed canonical validation (${projection.errors.join(',') || projection.finalVerdict}).`,
    exactNextAction: ready
      ? 'Continue polling the canonical Mission Worker heartbeat.'
      : degraded
        ? 'Keep the worker live and repair or retry the reported bounded execution defect.'
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

// Fixed read-only localhost observation in the already-existing backend loop.
// It does not perform Git network I/O, create source authority or claim a served head.
const BACKEND_CANONICAL_PORTS = Object.freeze([
  Object.freeze({ id: 'backend', host: '127.0.0.1', port: 8787 }),
  Object.freeze({ id: 'stephanos-ui', host: '127.0.0.1', port: 4173 }),
  Object.freeze({ id: 'openclaw-gateway', host: '127.0.0.1', port: 18789 }),
]);
function probeBackendCanonicalPortV1(service) {
  return new Promise(resolve => {
    const socket = createConnection({ host: service.host, port: service.port });
    let settled = false;
    const finish = (ready, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ready, evidence: { probe: 'tcp-connect', host: service.host,
        port: service.port, detail } });
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', error =>
      finish(false, error?.code === 'ECONNREFUSED' ? 'refused' : 'socket-error'));
  });
}
export async function collectBackendCanonicalLocalServiceFactsV1({ probe = probeBackendCanonicalPortV1 } = {}) {
  if (typeof probe !== 'function') throw new Error('BACKEND_CANONICAL_PROBE_UNAVAILABLE');
  const observed = await Promise.all(BACKEND_CANONICAL_PORTS.map(probe));
  const services = {};
  for (const [index, service] of BACKEND_CANONICAL_PORTS.entries()) {
    const value = observed[index];
    if (typeof value?.ready !== 'boolean' || value?.evidence?.probe !== 'tcp-connect'
      || value.evidence.host !== service.host || value.evidence.port !== service.port)
      throw new Error('BACKEND_CANONICAL_PROBE_IDENTITY_UNPROVEN');
    services[service.id] = value;
  }
  return Object.freeze({ observedFacts: Object.freeze({ services }),
    authority: Object.freeze({ executesCommands: false, mutatesRuntime: false,
      sourceMutationAllowed: false, servedHeadAttested: false }) });
}
export async function refreshBackendPublisherCanonicalV1({
  repoRoot, workspaceRoot, timestampUtc,
  observe = collectBackendCanonicalLocalServiceFactsV1,
  publisher = refreshBattleBridgeSharedWorkspacePublisher,
} = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot ||
    typeof workspaceRoot !== 'string' || !workspaceRoot ||
    !Number.isFinite(Date.parse(timestampUtc || '')))
    throw new Error('BACKEND_CANONICAL_REFRESH_INPUT_INVALID');
  const facts = await observe();
  const services = facts?.observedFacts?.services;
  if (!BACKEND_CANONICAL_PORTS.every(item =>
    typeof services?.[item.id]?.ready === 'boolean'
    && services[item.id].evidence?.probe === 'tcp-connect'
    && services[item.id].evidence.host === item.host
    && services[item.id].evidence.port === item.port)
    || Object.hasOwn(facts, 'sourceFacts'))
    throw new Error('BACKEND_CANONICAL_REFRESH_PROOF_UNPROVEN');
  const result = await publisher({
    repoRoot, sharedWorkspace: workspaceRoot, timestampUtc,
    facts, mode: 'periodic-existing-backend-publisher',
  });
  if (result?.ok !== true) throw new Error('BACKEND_CANONICAL_REFRESH_FAILED');
  return Object.freeze({ ok: true, status: result.status,
    sourceAuthority: false, servedHeadAttested: false, workerPickupProven: false });
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
    secondaryDiagnosticOnly: true,
    buildSlice: async ({ timestampUtc }) => {
      await refreshBackendPublisherCanonicalV1({
        repoRoot: input.repoRoot, workspaceRoot: validation.root, timestampUtc,
      });
      return buildBattleBridgePublisherLiveSliceFromWorkspace(validation.root, {
        timestampUtc, expectedRepositoryRoot, expectedHeadSha,
      });
    },
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