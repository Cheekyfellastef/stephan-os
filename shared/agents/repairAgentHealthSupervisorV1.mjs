export const REPAIR_AGENT_HEALTH_SUPERVISOR_SCHEMA = 'stephanos.repair-agent-health-supervisor.v1';

export const REPAIR_AGENT_SYSTEM_IDS = Object.freeze([
  'githubSync',
  'postSyncRefresh',
  'workerWatchdog',
  'missionWorker',
  'githubCommandMailbox',
  'recoveryMesh',
  'recoveryLifeboat',
  'repairAgentHealthSupervisor',
]);

export const REPAIR_AGENT_HEALTH_STATES = Object.freeze([
  'HEALTHY',
  'DEGRADED',
  'STALE',
  'MISSING',
  'BLOCKED',
  'RECOVERING',
  'HARD_HOLD',
]);

const SYSTEM_ID_SET = new Set(REPAIR_AGENT_SYSTEM_IDS);
const STATE_SET = new Set(REPAIR_AGENT_HEALTH_STATES);
const SHA40 = /^[0-9a-f]{40}$/;
const MAX_FUTURE_SKEW_MS = 30_000;

const DEFAULT_STALE_AFTER_MS = Object.freeze({
  githubSync: 180_000,
  postSyncRefresh: 300_000,
  workerWatchdog: 180_000,
  missionWorker: 180_000,
  githubCommandMailbox: 420_000,
  recoveryMesh: 180_000,
  recoveryLifeboat: 300_000,
  repairAgentHealthSupervisor: 180_000,
});

const DEFAULT_REPAIR_ROUTE = Object.freeze({
  githubSync: 'CONTROL_PLANE_SELF_REPAIR',
  postSyncRefresh: 'POST_SYNC_RUNTIME_REFRESH_REPAIR',
  workerWatchdog: 'MISSION_WORKER_WATCHDOG_RECOVERY',
  missionWorker: 'MISSION_WORKER_WATCHDOG_RECOVERY',
  githubCommandMailbox: 'CONTROL_PLANE_SELF_REPAIR',
  recoveryMesh: 'CONTROL_PLANE_SELF_REPAIR',
  recoveryLifeboat: 'CONTROL_PLANE_SELF_REPAIR',
  repairAgentHealthSupervisor: 'INDEPENDENT_CROSS_WATCH_RESTORE',
});

const HEAD_BOUND_SYSTEMS = new Set([
  'githubSync',
  'postSyncRefresh',
  'workerWatchdog',
  'missionWorker',
  'repairAgentHealthSupervisor',
]);

function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function blockedResult({ blocker, expectedHead = '', observedAtUtc = '' }) {
  return Object.freeze({
    ok: false,
    schemaVersion: REPAIR_AGENT_HEALTH_SUPERVISOR_SCHEMA,
    classification: 'REPAIR_AGENT_HEALTH_SUPERVISOR_BLOCKED',
    blocker,
    expectedHead,
    observedAtUtc,
    systems: Object.freeze([]),
    repairCandidates: Object.freeze([]),
    allEightHealthy: false,
    independentHealthTruthRequired: true,
    selfCrossWatchRequired: true,
    arbitraryShellAllowed: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}

function normalizeSystem({ id, record, expectedHead, nowMs }) {
  const repairRoute = DEFAULT_REPAIR_ROUTE[id];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return Object.freeze({
      id,
      state: 'MISSING',
      observedAtUtc: '',
      sourceHead: '',
      blocker: 'SYSTEM_HEALTH_RECORD_MISSING',
      repairRoute,
      repairRequired: true,
    });
  }

  const suppliedState = text(record.state).toUpperCase();
  if (!STATE_SET.has(suppliedState)) {
    return Object.freeze({
      id,
      state: 'HARD_HOLD',
      observedAtUtc: text(record.observedAtUtc),
      sourceHead: text(record.sourceHead).toLowerCase(),
      blocker: 'SYSTEM_HEALTH_STATE_INVALID',
      repairRoute,
      repairRequired: false,
    });
  }

  const observedAtMs = validTimestamp(record.observedAtUtc);
  if (observedAtMs === null) {
    return Object.freeze({
      id,
      state: 'HARD_HOLD',
      observedAtUtc: text(record.observedAtUtc),
      sourceHead: text(record.sourceHead).toLowerCase(),
      blocker: 'SYSTEM_HEALTH_TIMESTAMP_INVALID',
      repairRoute,
      repairRequired: false,
    });
  }

  if (observedAtMs - nowMs > MAX_FUTURE_SKEW_MS) {
    return Object.freeze({
      id,
      state: 'HARD_HOLD',
      observedAtUtc: new Date(observedAtMs).toISOString(),
      sourceHead: text(record.sourceHead).toLowerCase(),
      blocker: 'SYSTEM_HEALTH_TIMESTAMP_FUTURE',
      repairRoute,
      repairRequired: false,
    });
  }

  if (nowMs - observedAtMs > DEFAULT_STALE_AFTER_MS[id]) {
    return Object.freeze({
      id,
      state: 'STALE',
      observedAtUtc: new Date(observedAtMs).toISOString(),
      sourceHead: text(record.sourceHead).toLowerCase(),
      blocker: 'SYSTEM_HEALTH_RECORD_STALE',
      repairRoute,
      repairRequired: true,
    });
  }

  const sourceHead = text(record.sourceHead).toLowerCase();
  if (HEAD_BOUND_SYSTEMS.has(id)) {
    if (!SHA40.test(sourceHead)) {
      return Object.freeze({
        id,
        state: 'HARD_HOLD',
        observedAtUtc: new Date(observedAtMs).toISOString(),
        sourceHead,
        blocker: 'SYSTEM_SOURCE_HEAD_UNPROVEN',
        repairRoute,
        repairRequired: false,
      });
    }
    if (sourceHead !== expectedHead) {
      return Object.freeze({
        id,
        state: 'BLOCKED',
        observedAtUtc: new Date(observedAtMs).toISOString(),
        sourceHead,
        blocker: 'SYSTEM_SOURCE_HEAD_MISMATCH',
        repairRoute,
        repairRequired: true,
      });
    }
  }

  if (id === 'repairAgentHealthSupervisor' && suppliedState === 'HEALTHY' && record.crossWatchHealthy !== true) {
    return Object.freeze({
      id,
      state: 'DEGRADED',
      observedAtUtc: new Date(observedAtMs).toISOString(),
      sourceHead,
      blocker: 'SYSTEM_8_CROSS_WATCH_UNPROVEN',
      repairRoute,
      repairRequired: true,
    });
  }

  return Object.freeze({
    id,
    state: suppliedState,
    observedAtUtc: new Date(observedAtMs).toISOString(),
    sourceHead,
    blocker: text(record.blocker),
    repairRoute,
    repairRequired: suppliedState !== 'HEALTHY',
  });
}

export function evaluateRepairAgentHealthSupervisorV1({
  expectedHead = '',
  observedAtUtc = new Date().toISOString(),
  systems = {},
} = {}) {
  const normalizedExpectedHead = text(expectedHead).toLowerCase();
  if (!SHA40.test(normalizedExpectedHead)) {
    return blockedResult({ blocker: 'EXPECTED_HEAD_INVALID', observedAtUtc: text(observedAtUtc) });
  }

  const nowMs = validTimestamp(observedAtUtc);
  if (nowMs === null) {
    return blockedResult({
      blocker: 'OBSERVATION_TIME_INVALID',
      expectedHead: normalizedExpectedHead,
      observedAtUtc: text(observedAtUtc),
    });
  }

  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    return blockedResult({
      blocker: 'SYSTEM_HEALTH_ESTATE_INVALID',
      expectedHead: normalizedExpectedHead,
      observedAtUtc: new Date(nowMs).toISOString(),
    });
  }

  const unknownIds = Object.keys(systems).filter((id) => !SYSTEM_ID_SET.has(id));
  if (unknownIds.length > 0) {
    return blockedResult({
      blocker: 'UNKNOWN_SYSTEM_HEALTH_RECORD',
      expectedHead: normalizedExpectedHead,
      observedAtUtc: new Date(nowMs).toISOString(),
    });
  }

  const normalized = REPAIR_AGENT_SYSTEM_IDS.map((id) => normalizeSystem({
    id,
    record: systems[id],
    expectedHead: normalizedExpectedHead,
    nowMs,
  }));
  const repairCandidates = normalized.filter((system) => system.repairRequired);
  const allEightHealthy = normalized.length === 8 && normalized.every((system) => system.state === 'HEALTHY');
  const hardHold = normalized.some((system) => system.state === 'HARD_HOLD');

  return Object.freeze({
    ok: !hardHold,
    schemaVersion: REPAIR_AGENT_HEALTH_SUPERVISOR_SCHEMA,
    classification: allEightHealthy
      ? 'REPAIR_AGENT_ALL_EIGHT_HEALTHY'
      : hardHold
        ? 'REPAIR_AGENT_HEALTH_SUPERVISOR_HARD_HOLD'
        : 'REPAIR_AGENT_REPAIR_REQUIRED',
    blocker: hardHold ? 'SYSTEM_HEALTH_EVIDENCE_INVALID' : '',
    expectedHead: normalizedExpectedHead,
    observedAtUtc: new Date(nowMs).toISOString(),
    systems: Object.freeze(normalized),
    repairCandidates: Object.freeze(repairCandidates),
    allEightHealthy,
    independentHealthTruthRequired: true,
    selfCrossWatchRequired: true,
    arbitraryShellAllowed: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}
