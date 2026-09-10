import {
  MISSION_CONTROLLER_ROUTE,
  routeMissionControllerCapacity,
} from './missionControllerCapacityRouterV1.mjs';

export const GITHUB_CONTINUITY_MODE_SCHEMA = 'stephanos.github-continuity-mode.v1';
export const BATTLE_BRIDGE_CONTINUITY_HEALTH_SCHEMA = 'stephanos.battle-bridge-continuity-health.v1';

export const BATTLE_BRIDGE_AVAILABILITY = Object.freeze({
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

export const GITHUB_CONTINUITY_STATE = Object.freeze({
  NORMAL: 'NORMAL',
  GITHUB_CONTINUITY: 'GITHUB_CONTINUITY',
  DEGRADED_HOLD: 'DEGRADED_HOLD',
});

export const CONTINUITY_TASK_DISPOSITION = Object.freeze({
  CONTINUE: 'CONTINUE',
  PRESERVE_EXISTING_DISPATCH: 'PRESERVE_EXISTING_DISPATCH',
  HOLD_RUNTIME_RECOVERY: 'HOLD_RUNTIME_RECOVERY',
  HOLD_NO_PROVEN_CAPACITY: 'HOLD_NO_PROVEN_CAPACITY',
  HOLD_INVALID_TASK: 'HOLD_INVALID_TASK',
});

const HEALTH_KEYS = Object.freeze([
  'schemaVersion',
  'hostId',
  'repository',
  'observedAtUtc',
  'expiresAtUtc',
  'sourceHead',
  'availability',
  'capabilities',
  'blockers',
  'proofRefs',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_HEALTH_LIFETIME_MS = 10 * 60 * 1000;
const MAX_TASKS = 100;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactKeys(value, keys) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
  );
}

function uniqueStrings(value, { max = 32 } = {}) {
  const values = list(value).map(text).filter(Boolean);
  if (values.length > max || values.length !== new Set(values).size) return null;
  return values;
}

function frozen(value) {
  return Object.freeze(value);
}

export function validateBattleBridgeContinuityHealth(receipt, options = {}) {
  const nowMs = timestamp(options.nowUtc);
  const observedAtMs = timestamp(receipt?.observedAtUtc);
  const expiresAtMs = timestamp(receipt?.expiresAtUtc);
  const capabilities = uniqueStrings(receipt?.capabilities);
  const blockers = uniqueStrings(receipt?.blockers);
  const proofRefs = uniqueStrings(receipt?.proofRefs);
  const availability = text(receipt?.availability).toUpperCase();
  const repository = text(options.repository);
  const expectedSourceHead = text(options.expectedSourceHead).toLowerCase();
  const receiptSourceHead = text(receipt?.sourceHead).toLowerCase();

  const valid = exactKeys(receipt, HEALTH_KEYS)
    && receipt.schemaVersion === BATTLE_BRIDGE_CONTINUITY_HEALTH_SCHEMA
    && SAFE_ID.test(text(receipt.hostId))
    && REPOSITORY.test(text(receipt.repository))
    && receipt.repository === repository
    && FULL_SHA.test(expectedSourceHead)
    && FULL_SHA.test(receiptSourceHead)
    && receiptSourceHead === expectedSourceHead
    && Object.values(BATTLE_BRIDGE_AVAILABILITY).includes(availability)
    && capabilities !== null
    && blockers !== null
    && proofRefs?.length > 0
    && proofRefs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'))
    && nowMs !== null
    && observedAtMs !== null
    && expiresAtMs !== null
    && observedAtMs <= nowMs + 60_000
    && expiresAtMs > observedAtMs
    && expiresAtMs - observedAtMs <= MAX_HEALTH_LIFETIME_MS;

  if (!valid) {
    const sourceHeadMismatch = FULL_SHA.test(expectedSourceHead)
      && FULL_SHA.test(receiptSourceHead)
      && receiptSourceHead !== expectedSourceHead;
    return frozen({
      valid: false,
      current: false,
      availability: BATTLE_BRIDGE_AVAILABILITY.UNKNOWN,
      receipt: null,
      blocker: sourceHeadMismatch
        ? 'BATTLE_BRIDGE_CONTINUITY_SOURCE_HEAD_MISMATCH'
        : 'BATTLE_BRIDGE_CONTINUITY_HEALTH_INVALID',
    });
  }

  const current = expiresAtMs > nowMs;
  return frozen({
    valid: true,
    current,
    availability: current ? availability : BATTLE_BRIDGE_AVAILABILITY.UNKNOWN,
    receipt,
    blocker: current ? '' : 'BATTLE_BRIDGE_CONTINUITY_HEALTH_STALE',
  });
}

function normalizedMissionItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const mission = item.mission;
  const task = item.task ?? {};
  if (!mission || typeof mission !== 'object' || Array.isArray(mission)) return null;
  return { mission, task };
}

function taskPlan(input, item, host) {
  const normalized = normalizedMissionItem(item);
  if (!normalized) {
    return frozen({
      missionId: '',
      taskId: '',
      windowsBound: false,
      disposition: CONTINUITY_TASK_DISPOSITION.HOLD_INVALID_TASK,
      route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
      dispatchAllowed: false,
      blockers: frozen(['continuity-task-invalid']),
    });
  }

  const route = routeMissionControllerCapacity({
    mission: normalized.mission,
    task: normalized.task,
    nowUtc: input.nowUtc,
    codexStatus: input.codexStatus,
    githubLaneReceipt: input.githubLaneReceipt,
    forgeLaneReceipt: input.forgeLaneReceipt,
    forgeSidecar: input.forgeSidecar,
  });

  const existingDispatch = normalized.mission?.dispatch?.status === 'running';
  if (existingDispatch) {
    return frozen({
      missionId: text(normalized.mission.missionId),
      taskId: text(route.task?.taskId),
      windowsBound: route.task?.windowsBound === true,
      disposition: CONTINUITY_TASK_DISPOSITION.PRESERVE_EXISTING_DISPATCH,
      route: route.route,
      adapter: route.adapter,
      dispatchAllowed: false,
      selectedCapacityReceiptId: route.selectedCapacityReceiptId ?? null,
      proofRefs: frozen(list(route.proofRefs)),
      blockers: frozen(['existing-agent-dispatch-owns-mission']),
    });
  }

  const hostUnavailable = host.availability !== BATTLE_BRIDGE_AVAILABILITY.READY;
  if (hostUnavailable && route.task?.windowsBound === true) {
    return frozen({
      missionId: text(normalized.mission.missionId),
      taskId: text(route.task?.taskId),
      windowsBound: true,
      disposition: CONTINUITY_TASK_DISPOSITION.HOLD_RUNTIME_RECOVERY,
      route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
      adapter: '',
      dispatchAllowed: false,
      selectedCapacityReceiptId: null,
      proofRefs: frozen([]),
      blockers: frozen([
        'battle-bridge-unavailable',
        'windows-runtime-capability-unavailable',
      ]),
    });
  }

  if (route.dispatchAllowed === true
      && [
        MISSION_CONTROLLER_ROUTE.CODEX,
        MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
        MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
      ].includes(route.route)) {
    return frozen({
      missionId: text(normalized.mission.missionId),
      taskId: text(route.task?.taskId),
      windowsBound: route.task?.windowsBound === true,
      disposition: CONTINUITY_TASK_DISPOSITION.CONTINUE,
      route: route.route,
      adapter: route.adapter,
      dispatchAllowed: true,
      selectedCapacityReceiptId: route.selectedCapacityReceiptId ?? null,
      proofRefs: frozen(list(route.proofRefs)),
      blockers: frozen([]),
    });
  }

  return frozen({
    missionId: text(normalized.mission.missionId),
    taskId: text(route.task?.taskId),
    windowsBound: route.task?.windowsBound === true,
    disposition: CONTINUITY_TASK_DISPOSITION.HOLD_NO_PROVEN_CAPACITY,
    route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
    adapter: '',
    dispatchAllowed: false,
    selectedCapacityReceiptId: null,
    proofRefs: frozen([]),
    blockers: frozen(list(route.blockers).length ? route.blockers : ['proven-build-capacity-unavailable']),
  });
}

export function planGitHubContinuityMode(input = {}) {
  const repository = text(input.repository);
  const nowUtc = text(input.nowUtc);
  const expectedSourceHead = text(input.expectedSourceHead).toLowerCase();
  const tasks = list(input.tasks);
  const validEnvelope = REPOSITORY.test(repository)
    && timestamp(nowUtc) !== null
    && FULL_SHA.test(expectedSourceHead)
    && tasks.length <= MAX_TASKS;

  const host = validateBattleBridgeContinuityHealth(input.battleBridgeHealth, {
    repository,
    expectedSourceHead,
    nowUtc,
  });

  if (!validEnvelope) {
    return frozen({
      schemaVersion: GITHUB_CONTINUITY_MODE_SCHEMA,
      repository,
      expectedSourceHead,
      evaluatedAtUtc: nowUtc,
      state: GITHUB_CONTINUITY_STATE.DEGRADED_HOLD,
      battleBridgeAvailability: BATTLE_BRIDGE_AVAILABILITY.UNKNOWN,
      tasks: frozen([]),
      counts: frozen({ continue: 0, preserve: 0, runtimeHold: 0, capacityHold: 0, invalid: tasks.length }),
      recoveryHandoffRequired: true,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      duplicateDispatchAllowed: false,
      protectedMergeDispatchAllowed: false,
      blockers: frozen(['github-continuity-envelope-invalid']),
      finalVerdict: 'GITHUB_CONTINUITY_BLOCKED',
    });
  }

  const plannedTasks = frozen(tasks.map((item) => taskPlan(input, item, host)));
  const counts = frozen({
    continue: plannedTasks.filter((item) => item.disposition === CONTINUITY_TASK_DISPOSITION.CONTINUE).length,
    preserve: plannedTasks.filter((item) => item.disposition === CONTINUITY_TASK_DISPOSITION.PRESERVE_EXISTING_DISPATCH).length,
    runtimeHold: plannedTasks.filter((item) => item.disposition === CONTINUITY_TASK_DISPOSITION.HOLD_RUNTIME_RECOVERY).length,
    capacityHold: plannedTasks.filter((item) => item.disposition === CONTINUITY_TASK_DISPOSITION.HOLD_NO_PROVEN_CAPACITY).length,
    invalid: plannedTasks.filter((item) => item.disposition === CONTINUITY_TASK_DISPOSITION.HOLD_INVALID_TASK).length,
  });

  const hostReady = host.current && host.availability === BATTLE_BRIDGE_AVAILABILITY.READY;
  const state = hostReady
    ? GITHUB_CONTINUITY_STATE.NORMAL
    : (counts.continue > 0 || counts.preserve > 0
      ? GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY
      : GITHUB_CONTINUITY_STATE.DEGRADED_HOLD);

  const blockers = [];
  if (!host.current) blockers.push(host.blocker || 'battle-bridge-health-unproven');
  if (host.current && !hostReady) blockers.push(`battle-bridge-${host.availability.toLowerCase()}`);
  if (counts.runtimeHold > 0) blockers.push('windows-runtime-work-held-for-recovery');
  if (counts.capacityHold > 0) blockers.push('some-source-work-lacks-proven-capacity');
  if (counts.invalid > 0) blockers.push('invalid-continuity-task-held');

  return frozen({
    schemaVersion: GITHUB_CONTINUITY_MODE_SCHEMA,
    repository,
    expectedSourceHead,
    evaluatedAtUtc: nowUtc,
    state,
    battleBridgeAvailability: host.availability,
    battleBridgeHostId: text(host.receipt?.hostId),
    battleBridgeSourceHead: text(host.receipt?.sourceHead),
    tasks: plannedTasks,
    counts,
    recoveryHandoffRequired: !hostReady,
    recoveryGoalIssue: 1814,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    duplicateDispatchAllowed: false,
    protectedMergeDispatchAllowed: false,
    blockers: frozen([...new Set(blockers)]),
    finalVerdict: state === GITHUB_CONTINUITY_STATE.NORMAL
      ? 'GITHUB_CONTINUITY_NORMAL'
      : (state === GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY
        ? 'GITHUB_CONTINUITY_ACTIVE'
        : 'GITHUB_CONTINUITY_DEGRADED_HOLD'),
  });
}
