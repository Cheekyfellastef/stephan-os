import {
  CODEX_AVAILABILITY,
  CODEX_TASK_CLASS,
  buildCodexCapacityProjection,
  createMeterObservation,
} from './codexCapacityGovernorV1.mjs';
import { adjudicateForgeSidecarCapacity } from './stallSentinelReviewPipelineV1.mjs';
import {
  createSharedWorkspaceStatusRecord,
  isSharedWorkspaceParticipantId,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA = 'stephanos.mission-controller-capacity-router.v1';
export const BUILD_LANE_CAPACITY_RECEIPT_SCHEMA = 'stephanos.build-lane-capacity-receipt.v1';

export const MISSION_CONTROLLER_ROUTE = Object.freeze({
  CODEX: 'CODEX',
  CHATGPT_GITHUB: 'CHATGPT_GITHUB',
  FOUNDRY_FORGE: 'FOUNDRY_FORGE',
  OPENCLAW_LOCAL: 'OPENCLAW_LOCAL',
  WAIT_FOR_PROVEN_CAPACITY: 'WAIT_FOR_PROVEN_CAPACITY',
});
export const MISSION_PROVIDER_ROUTE_INTENT = Object.freeze({
  AUTO: 'AUTO',
  CODEX: MISSION_CONTROLLER_ROUTE.CODEX,
  CHATGPT_GITHUB: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  FOUNDRY_FORGE: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
  OPENCLAW_LOCAL: MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL,
});

const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'route', 'repository', 'workerId', 'state',
  'supportedOperations', 'supportedTaskClasses', 'observedAtUtc', 'expiresAtUtc',
  'queueDepth', 'p95StartLatencySeconds', 'authorityReceiptIds', 'proofRefs',
]);
const ROUTE_ADAPTER = Object.freeze({
  [MISSION_CONTROLLER_ROUTE.CODEX]: 'codex',
  [MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB]: 'chatgpt-github',
  [MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE]: 'foundry-forge',
  [MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL]: 'openclaw-local',
});
const BUILD_LANE_RECEIPT_ROUTES = new Set([
  MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
]);
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_RECEIPT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_METER_AGE_MINUTES = 15;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function list(value) { return Array.isArray(value) ? value : []; }
function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function uniqueStrings(value) {
  const values = list(value).map(text).filter(Boolean);
  return values.length === new Set(values).size ? values : null;
}
function frozen(value) { return Object.freeze(value); }

function taskForMission(mission = {}, explicitTask = {}) {
  const allowedFiles = list(mission.allowedFiles);
  const windowsBound = explicitTask.windowsBound === true
    || allowedFiles.some((path) => /(?:^|\/)windows(?:\/|$)|\.ps1$/i.test(text(path)))
    || list(mission.requiredEvidence).some((item) => /windows runtime|battle bridge/i.test(text(item)));
  const taskClass = text(explicitTask.taskClass).toUpperCase()
    || (windowsBound
      ? CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF
      : (text(mission.currentPhase).toUpperCase() === 'REPAIR_REQUIRED'
        ? CODEX_TASK_CLASS.FOCUSED_REPAIR
        : (allowedFiles.length > 4
          ? CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION
          : CODEX_TASK_CLASS.FOCUSED_REPAIR)));
  return frozen({
    taskId: text(explicitTask.taskId) || text(mission.missionId) || 'unknown-mission',
    title: text(explicitTask.title) || text(mission.title) || text(mission.intendedOutcome) || 'Mission implementation',
    taskClass,
    preferredRoute: 'CODEX',
    complexityMultiplier: explicitTask.complexityMultiplier,
    capabilityValue: explicitTask.capabilityValue,
    urgent: explicitTask.urgent === true,
    windowsBound,
  });
}

function codexProjection(status, task, nowUtc) {
  const observedAtUtc = text(status?.observedAtUtc);
  const current = status?.schemaVersion === 'shared-agent-workspace-record.v1'
    && status?.statusId === 'codex-capacity-current'
    && status?.truthState === 'CURRENT'
    && status?.meterTruthUsable === true;
  const observation = createMeterObservation({
    observedAtUtc,
    remainingPercent: current ? status.remainingPercent : undefined,
    availability: current && Object.values(CODEX_AVAILABILITY).includes(status.availability)
      ? status.availability
      : CODEX_AVAILABILITY.UNKNOWN,
    naturalResetAtUtc: current ? status.naturalResetAtUtc : '',
    source: 'shared-workspace-codex-capacity-current',
    confidence: current && ['high', 'medium'].includes(status.confidence) ? status.confidence : 'low',
  });
  return buildCodexCapacityProjection({
    observation,
    nowUtc,
    maxMeterAgeMinutes: MAX_METER_AGE_MINUTES,
    tasks: [task],
  });
}

export function validateBuildLaneCapacityReceipt(receipt, expected = {}) {
  const nowMs = timestamp(expected.nowUtc);
  const observedAtMs = timestamp(receipt?.observedAtUtc);
  const expiresAtMs = timestamp(receipt?.expiresAtUtc);
  const operations = uniqueStrings(receipt?.supportedOperations);
  const classes = uniqueStrings(receipt?.supportedTaskClasses);
  const authorities = uniqueStrings(receipt?.authorityReceiptIds);
  const proofRefs = uniqueStrings(receipt?.proofRefs);
  const route = text(receipt?.route).toUpperCase();
  const valid = exactKeys(receipt, RECEIPT_KEYS)
    && receipt.schemaVersion === BUILD_LANE_CAPACITY_RECEIPT_SCHEMA
    && SAFE_ID.test(text(receipt.receiptId))
    && BUILD_LANE_RECEIPT_ROUTES.has(route)
    && receipt.repository === expected.repository
    && REPOSITORY.test(text(receipt.repository))
    && isSharedWorkspaceParticipantId(receipt.workerId)
    && receipt.state === 'READY'
    && operations?.includes('SOURCE_CONSTRUCTION')
    && operations?.includes('FOCUSED_TESTS')
    && classes?.includes(expected.taskClass)
    && authorities !== null
    && proofRefs?.length > 0
    && proofRefs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'))
    && nowMs !== null && observedAtMs !== null && expiresAtMs !== null
    && observedAtMs <= nowMs + 60_000
    && expiresAtMs > nowMs
    && expiresAtMs > observedAtMs
    && expiresAtMs - observedAtMs <= MAX_RECEIPT_LIFETIME_MS
    && Number.isSafeInteger(receipt.queueDepth) && receipt.queueDepth >= 0 && receipt.queueDepth <= 1000
    && Number.isFinite(receipt.p95StartLatencySeconds)
    && receipt.p95StartLatencySeconds >= 0 && receipt.p95StartLatencySeconds <= 24 * 60 * 60;
  return frozen({ valid: Boolean(valid), route, receipt: valid ? receipt : null });
}

export function createBuildLaneCapacityStatusRecord(receipt, options = {}) {
  const firstTaskClass = list(receipt?.supportedTaskClasses)[0];
  const validation = validateBuildLaneCapacityReceipt(receipt, {
    repository: receipt?.repository,
    taskClass: firstTaskClass,
    nowUtc: options.nowUtc || receipt?.observedAtUtc,
  });
  if (!validation.valid) return null;
  const statusId = receipt.route === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB
    ? 'chatgpt-github-build-capacity-current'
    : 'foundry-forge-build-capacity-current';
  return frozen({
    ...createSharedWorkspaceStatusRecord({
      statusId,
      participantId: receipt.workerId,
      timestampUtc: receipt.observedAtUtc,
      status: receipt.state,
      summary: `${receipt.route} build capacity is ${receipt.state}; queue depth ${receipt.queueDepth}, p95 start ${receipt.p95StartLatencySeconds}s.`,
      proofRefs: receipt.proofRefs,
    }),
    capacityReceipt: receipt,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export async function publishBuildLaneCapacityToSharedWorkspace(root, receipt, options = {}) {
  const record = createBuildLaneCapacityStatusRecord(receipt, options);
  if (!record) return frozen({ ok: false, reason: 'BUILD_LANE_CAPACITY_RECEIPT_INVALID', record: null });
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs: timestamp(options.nowUtc || receipt.observedAtUtc),
  });
  if (!validation.valid) return frozen({ ok: false, reason: validation.errors[0], record, validation });
  const write = await writeAtomicJson(root, ['status', `${record.statusId}.json`], record, options);
  return frozen({
    ok: write.ok === true,
    reason: write.ok ? 'BUILD_LANE_CAPACITY_PUBLISHED' : write.reason,
    record,
    write,
  });
}

function candidateForReceipt(receipt, expected) {
  const validation = validateBuildLaneCapacityReceipt(receipt, expected);
  if (!validation.valid) return null;
  return frozen({
    route: validation.route,
    adapter: ROUTE_ADAPTER[validation.route],
    workerId: receipt.workerId,
    queueDepth: receipt.queueDepth,
    p95StartLatencySeconds: receipt.p95StartLatencySeconds,
    receiptId: receipt.receiptId,
    authorityReceiptIds: frozen([...receipt.authorityReceiptIds]),
    proofRefs: frozen([...receipt.proofRefs]),
  });
}

function selectFallback(input, task, nowUtc) {
  const expected = { repository: text(input.mission?.repository), taskClass: task.taskClass, nowUtc };
  const candidates = [];
  if (!task.windowsBound) {
    const github = candidateForReceipt(input.githubLaneReceipt, expected);
    if (github?.route === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB) candidates.push(github);
  }
  const forge = adjudicateForgeSidecarCapacity(input.forgeSidecar, { nowUtc });
  const forgeCandidate = candidateForReceipt(input.forgeLaneReceipt, expected);
  if (
    forge?.canCarryRealWork === true
    && forgeCandidate?.route === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE
    && forgeCandidate.authorityReceiptIds.includes(forge.m2ReceiptId)
    && forgeCandidate.authorityReceiptIds.includes(forge.m3RuntimeReceiptId)
  ) candidates.push(forgeCandidate);
  candidates.sort((left, right) => (
    left.p95StartLatencySeconds - right.p95StartLatencySeconds
    || left.queueDepth - right.queueDepth
    || left.route.localeCompare(right.route)
  ));
  return frozen({ selected: candidates[0] || null, candidates: frozen(candidates), forge });
}

export function routeMissionControllerCapacity(input = {}) {
  const nowUtc = text(input.nowUtc);
  const task = taskForMission(input.mission, input.task);
  const base = {
    schemaVersion: MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA,
    missionId: text(input.mission?.missionId),
    repository: text(input.mission?.repository),
    task,
    evaluatedAtUtc: nowUtc,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  };
  if (timestamp(nowUtc) === null || !base.missionId || !REPOSITORY.test(base.repository)) {
    return frozen({ ...base, route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY, adapter: '', dispatchAllowed: false, blockers: frozen(['mission-routing-identity-invalid']), finalVerdict: 'MISSION_CONTROLLER_CAPACITY_BLOCKED' });
  }
  if (input.mission?.dispatch?.status === 'running') {
    return frozen({ ...base, route: text(input.mission.dispatch.adapter).toUpperCase(), adapter: text(input.mission.dispatch.adapter), dispatchAllowed: false, blockers: frozen(['existing-agent-dispatch-owns-mission']), finalVerdict: 'MISSION_CONTROLLER_EXISTING_DISPATCH_PRESERVED' });
  }
  const codex = codexProjection(input.codexStatus, task, nowUtc);
  if (codex.dispatchAllowed) {
    return frozen({ ...base, route: MISSION_CONTROLLER_ROUTE.CODEX, adapter: ROUTE_ADAPTER.CODEX, dispatchAllowed: true, codex, selectedCapacityReceiptId: null, proofRefs: frozen([]), blockers: frozen([]), finalVerdict: 'MISSION_CONTROLLER_ROUTE_READY' });
  }
  const fallback = selectFallback(input, task, nowUtc);
  if (fallback.selected) {
    return frozen({ ...base, route: fallback.selected.route, adapter: fallback.selected.adapter, workerId: fallback.selected.workerId, dispatchAllowed: true, codex, fallbackCandidates: fallback.candidates, selectedCapacityReceiptId: fallback.selected.receiptId, proofRefs: fallback.selected.proofRefs, blockers: frozen([]), finalVerdict: 'MISSION_CONTROLLER_FALLBACK_ROUTE_READY' });
  }
  return frozen({
    ...base,
    route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
    adapter: '',
    dispatchAllowed: false,
    codex,
    fallbackCandidates: fallback.candidates,
    blockers: frozen(['codex-capacity-unavailable', task.windowsBound ? 'proven-windows-capable-fallback-unavailable' : 'proven-build-fallback-unavailable']),
    finalVerdict: 'MISSION_CONTROLLER_CAPACITY_BLOCKED',
  });
}
