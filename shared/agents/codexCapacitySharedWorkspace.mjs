import {
  CODEX_AVAILABILITY,
  createMeterObservation,
  buildCodexCapacityProjection,
} from './codexCapacityGovernorV1.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const CODEX_CAPACITY_WORKSPACE_SCHEMA_VERSION = 'stephanos.codex-capacity-workspace.v1';
export const CODEX_CAPACITY_WORKSPACE_PARTICIPANT = 'codex-capacity-governor';
export const CODEX_CAPACITY_WORKSPACE_STATUS_ID = 'codex-capacity-current';

export const CODEX_CAPACITY_TRUTH_STATE = Object.freeze({
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

const SECRET_TEXT = /secret|token|session|password|credential|private key|\.env|cookie|authorization|bearer/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || SECRET_TEXT.test(normalized)) return fallback;
  return normalized.slice(0, 240);
}

function rounded(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null;
}

function proofRefs(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter((item) => (
      /^[a-z0-9][a-z0-9._/-]{0,239}$/i.test(item)
      && !item.split('/').includes('..')
      && !SECRET_TEXT.test(item)
    )))].slice(0, 20)
    : [];
}

function percentFromSegment(segment) {
  const match = String(segment || '').match(/\b(100|[0-9]{1,2})(?:\.([0-9]{1,2}))?\s*%/);
  if (!match) return null;
  const value = Number(`${match[1]}${match[2] ? `.${match[2]}` : ''}`);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function parseCodexRemainingPercent(meterSummary = '') {
  const safe = text(meterSummary);
  if (!safe) return null;
  const segments = safe.split(/\s*\|\s*/).filter(Boolean);
  const labelled = segments.find((segment) => (
    /\b(codex|weekly|week)\b/i.test(segment)
    && /\b(remaining|left|usage|limit)\b/i.test(segment)
    && percentFromSegment(segment) !== null
  ));
  if (labelled) return percentFromSegment(labelled);
  const percentages = segments.map(percentFromSegment).filter((value) => value !== null);
  return percentages.length === 1 ? percentages[0] : null;
}

export function createMeterObservationFromCodexStatusResult(result = {}, options = {}) {
  const remainingPercent = result.ok === true
    ? (Number.isFinite(Number(result.remainingPercent))
      ? Number(result.remainingPercent)
      : parseCodexRemainingPercent(result.meterSummary))
    : null;
  const availability = result.ok !== true || remainingPercent === null
    ? CODEX_AVAILABILITY.UNKNOWN
    : (result.activeCodexTask === true ? CODEX_AVAILABILITY.BUSY : CODEX_AVAILABILITY.AVAILABLE);
  return createMeterObservation({
    observedAtUtc: result.observedAtUtc,
    remainingPercent,
    availability,
    naturalResetAtUtc: options.naturalResetAtUtc,
    bankedResets: options.bankedResets,
    source: 'battle-bridge-authenticated-codex-ui-read-only',
    confidence: result.ok === true && result.usageSurfaceMatched === true && remainingPercent !== null ? 'high' : 'low',
  });
}

function truthState(capacity) {
  if (capacity.meterTruth?.trusted) return CODEX_CAPACITY_TRUTH_STATE.CURRENT;
  if (capacity.meterTruth?.complete && capacity.meterTruth?.fresh === false) return CODEX_CAPACITY_TRUTH_STATE.STALE;
  return CODEX_CAPACITY_TRUTH_STATE.UNKNOWN;
}

function summaryFor(slice) {
  if (slice.truthState === CODEX_CAPACITY_TRUTH_STATE.CURRENT) {
    return `Codex meter is current at ${slice.remainingPercent}% remaining; availability is ${slice.availability}.`;
  }
  if (slice.truthState === CODEX_CAPACITY_TRUTH_STATE.STALE) {
    return 'Codex meter observation is stale and must not be used for dispatch or lane selection.';
  }
  return 'Codex meter status is UNKNOWN and must not be treated as available capacity.';
}

export function createCodexCapacityWorkspaceSlice(input = {}, options = {}) {
  const publishedAtUtc = text(input.publishedAtUtc || input.timestampUtc || options.timestampUtc, new Date(0).toISOString());
  const observation = input.observation?.kind === 'stephanos.codex_capacity.meter_observation'
    ? input.observation
    : createMeterObservationFromCodexStatusResult(input.statusResult || input, options);
  const capacity = input.capacityProjection || buildCodexCapacityProjection({
    ...(input.capacity || {}),
    observation,
    nowUtc: publishedAtUtc,
  });
  const state = truthState(capacity);
  const refs = proofRefs(input.proofRefs?.length ? input.proofRefs : input.statusResult?.proofRefs || observation.proofRefs);
  const slice = {
    schemaVersion: CODEX_CAPACITY_WORKSPACE_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.workspace_status',
    participantId: CODEX_CAPACITY_WORKSPACE_PARTICIPANT,
    timestampUtc: publishedAtUtc,
    observedAtUtc: text(observation.observedAtUtc),
    truthState: state,
    availability: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT ? observation.availability : CODEX_AVAILABILITY.UNKNOWN,
    remainingPercent: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT ? rounded(observation.remainingPercent) : null,
    safelySchedulablePercent: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT ? rounded(capacity.safelySchedulablePercent) : null,
    reservedPercent: rounded(capacity.reservedPercent),
    ageMinutes: rounded(capacity.meterTruth?.ageMinutes),
    confidence: observation.confidence,
    meterTruthUsable: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT,
    capacityUsable: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT && observation.availability === CODEX_AVAILABILITY.AVAILABLE,
    naturalResetAtUtc: text(observation.naturalResetAtUtc),
    bankedResetCount: Array.isArray(observation.bankedResets) ? observation.bankedResets.length : 0,
    earliestBankedResetExpiryUtc: text(observation.bankedResets?.[0]?.expiresAtUtc),
    taskRouteDecisionRequired: true,
    selectedRoute: input.capacityProjection ? text(capacity.selectedRoute, 'UNKNOWN') : 'NOT_EVALUATED',
    dispatchAllowed: input.capacityProjection ? capacity.dispatchAllowed === true : false,
    decision: input.capacityProjection ? text(capacity.decision, 'UNKNOWN') : 'AWAITING_TASK_CONTEXT',
    exactNextAction: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT
      ? 'Re-evaluate each queued task through the canonical controller using current lane capability receipts.'
      : 'Refresh the authenticated read-only Codex usage observation before dispatch or lane selection.',
    proofRefs: refs,
    rawUiTextPublished: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  };
  return Object.freeze({ ...slice, summary: summaryFor(slice), finalVerdict: state === CODEX_CAPACITY_TRUTH_STATE.CURRENT ? 'CODEX_CAPACITY_WORKSPACE_CURRENT' : `CODEX_CAPACITY_WORKSPACE_${state}` });
}

export function createCodexCapacityWorkspaceRecords(sliceInput = {}, options = {}) {
  const slice = sliceInput?.kind === 'stephanos.codex_capacity.workspace_status'
    ? sliceInput
    : createCodexCapacityWorkspaceSlice(sliceInput, options);
  const common = {
    observedAtUtc: slice.observedAtUtc,
    truthState: slice.truthState,
    availability: slice.availability,
    remainingPercent: slice.remainingPercent,
    safelySchedulablePercent: slice.safelySchedulablePercent,
    reservedPercent: slice.reservedPercent,
    ageMinutes: slice.ageMinutes,
    confidence: slice.confidence,
    meterTruthUsable: slice.meterTruthUsable,
    capacityUsable: slice.capacityUsable,
    naturalResetAtUtc: slice.naturalResetAtUtc,
    bankedResetCount: slice.bankedResetCount,
    earliestBankedResetExpiryUtc: slice.earliestBankedResetExpiryUtc,
    taskRouteDecisionRequired: slice.taskRouteDecisionRequired,
    selectedRoute: slice.selectedRoute,
    dispatchAllowed: slice.dispatchAllowed,
    decision: slice.decision,
    exactNextAction: slice.exactNextAction,
    rawUiTextPublished: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    proofRefs: slice.proofRefs,
  };
  const statusRecord = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: CODEX_CAPACITY_WORKSPACE_STATUS_ID,
      participantId: slice.participantId,
      timestampUtc: slice.timestampUtc,
      status: slice.truthState,
      summary: slice.summary,
      proofRefs: slice.proofRefs,
    }),
    ...common,
  });
  const eventRecord = Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: `${CODEX_CAPACITY_WORKSPACE_STATUS_ID}-${slice.truthState.toLowerCase()}`,
      participantId: slice.participantId,
      timestampUtc: slice.timestampUtc,
      eventKind: 'codex-capacity-observation',
      summary: slice.summary,
    }),
    ...common,
  });
  return Object.freeze({ slice, statusRecord, eventRecord });
}

export async function publishCodexCapacityToSharedWorkspace(root, sliceInput = {}, options = {}) {
  const records = createCodexCapacityWorkspaceRecords(sliceInput, options);
  for (const record of [records.statusRecord, records.eventRecord]) {
    const validation = validateSharedWorkspaceRecord(record, options);
    if (!validation.valid) return { ok: false, reason: validation.errors[0], ...records, validation, writes: [] };
  }
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: options.repoRoot });
  if (!layout.ok) return { ok: false, reason: layout.reason, ...records, writes: [] };
  const writes = [
    await writeAtomicJson(layout.root, ['status', `${CODEX_CAPACITY_WORKSPACE_STATUS_ID}.json`], records.statusRecord, options),
    await appendWorkspaceJsonl(layout.root, ['events', 'codex-capacity.jsonl'], records.eventRecord, options),
  ];
  const failed = writes.find((write) => !write.ok);
  return {
    ok: !failed,
    reason: failed?.reason || 'CODEX_CAPACITY_WORKSPACE_PUBLISHED',
    ...records,
    writes,
    finalVerdict: failed ? 'CODEX_CAPACITY_WORKSPACE_PUBLISH_BLOCKED' : 'CODEX_CAPACITY_WORKSPACE_PUBLISH_PASS',
  };
}
