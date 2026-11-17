// Admission to existing fixed maintenance; this is neither a new execution
// owner nor proof of Windows descendant exclusion or cross-restart custody.
import {
  FLEET_SUPERVISOR_ACTION, FLEET_SUPERVISOR_SCHEMA, FLEET_SUPERVISOR_MARKER,
} from './sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
import { SPATIAL_PREPARE_ACTION, SPATIAL_PREPARE_SCHEMA, SPATIAL_PREPARE_MARKER } from './sovereignSpatialWorkspaceV1.mjs';
const READ_ONLY_ACTIONS = new Set([
  'battle-bridge-status', 'battle-bridge-observe', 'diagnose-ignition', 'meter-status',
  'controller-lane-status', 'rescue-island-readonly-boundary', 'visibility-snapshot',
  'cpu-pressure-snapshot', 'status-recovery-mesh', 'status-worker-watchdog',
  'status-stephanos-core-daemon',
  'status-mission-orchestrator-worker', 'status-stephanos-backend',
  'starfield-vr-telemetry-archive',
  'observe-open-stephanos-tabs', // fixed --native-receipt-only; no CDP or writes
]);
// Names do not prove observation-only behavior. Gaming Status can reconcile
// missing state and evict Ollama; the opaque OpenClaw CLI can load plugins.
// Both retain ordinary owner admission rather than bypassing a custody hold.
export const SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER =
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
export const SOVEREIGN_MAINTENANCE_OWNER_VERSION = '2026-10-28-fixed-runtime-reservation-v2';

// Shared disposition for automatic broad Core repair. Native custody has not
// been enrolled. Neither a healthy worker nor the manual maintenance route
// can turn an automatic caller into an operator-approved repair. There is no
// caller-provided qualification flag and no maintenance reservation to release.
export function unqualifiedCoreWindowsRepairV1() {
  return Object.freeze({
    ok: false, attempted: false, dispatchAllowed: false,
    executionState: 'NOT_STARTED', maintenanceReservationCreated: false,
    nativeCustodyQualified: false,
    blocker: 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE',
    sourceMutationAllowed: false,
    finalVerdict: 'CORE_AUTOMATIC_MAINTENANCE_NOT_STARTED',
  });
}

export function isSovereignMaintenanceObservationV1(processId) {
  return READ_ONLY_ACTIONS.has(processId);
}

// Closed wire contracts: a descendant's receipt cannot substitute for its parent.
const TERMINAL_PROTOCOLS = Object.freeze({
  [SPATIAL_PREPARE_ACTION]: Object.freeze({ schema: SPATIAL_PREPARE_SCHEMA,
    marker: SPATIAL_PREPARE_MARKER, failedExit: 2, uniqueMarker: true, canonicalJson: true }),
  [FLEET_SUPERVISOR_ACTION]: Object.freeze({ schema: FLEET_SUPERVISOR_SCHEMA,
    marker: FLEET_SUPERVISOR_MARKER, failedExit: 2, uniqueMarker: true, canonicalJson: true }),
  'repair-stephanos': Object.freeze({ schema: 'stephanos.sovereign-commander-stephanos-repair.v1', marker: 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=', failedExit: 2 }),
  'repair-goal-builder-flow': Object.freeze({ schema: 'stephanos.sovereign-commander-goal-builder-repair.v1', marker: 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=', failedExit: 2 }),
  'repair-control-plane': Object.freeze({ schema: 'stephanos.sovereign-commander-control-plane-repair.v1', marker: '', failedExit: 1 }),
});

// Terminal parent exit is not descendant exclusion. Share this negative-evidence
// model between scheduled repair and manually reserved fixed maintenance.
export function sovereignMaintenanceCustodyUnprovenV1(execution = {}, receipt = {}, processId = '') {
  if (!Number.isInteger(execution.status) || execution.signal) return true;
  const protocol = Object.hasOwn(TERMINAL_PROTOCOLS, processId) ? TERMINAL_PROTOCOLS[processId] : null;
  if (protocol && (receipt?.schemaVersion !== protocol.schema || typeof receipt?.ok !== 'boolean'
      || execution.status !== (receipt.ok ? 0 : protocol.failedExit))) return true;
  const pending = [execution, receipt];
  const seen = new Set();
  while (pending.length) {
    const row = pending.pop();
    if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
    if (seen.has(row) || seen.size >= 256) return true;
    seen.add(row);
    if ((Object.hasOwn(row, 'status') && !Number.isInteger(row.status)) || row.signal) return true;
    for (const field of ['errorCode', 'blocker', 'controlPlaneResidualBlocker']) {
      const value = typeof row[field] === 'string' ? row[field] : '';
      if (/(?:^|[^A-Z0-9])(?:ETIMEDOUT|ABORT_ERR)(?:$|[^A-Z0-9])/.test(value)
          || value === SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER) return true;
    }
    for (const field of ['steps', 'tasks', 'executionEvidence']) {
      if (!Object.hasOwn(row, field)) continue;
      if (!Array.isArray(row[field]) || row[field].length > 128) return true;
      pending.push(...row[field]);
    }
    if (Object.hasOwn(row, 'repair')) pending.push(row.repair);
  }
  return false;
}

export function readSovereignMaintenanceTerminalReceiptV1(stdout = '', processId = '') {
  const protocol = Object.hasOwn(TERMINAL_PROTOCOLS, processId) ? TERMINAL_PROTOCOLS[processId] : null;
  if (!protocol) return {};
  const hold = () => ({ status: null });
  const raw = typeof stdout === 'string' ? stdout.trim() : '';
  if (!raw || Buffer.byteLength(raw, 'utf8') > 64 * 1024) return hold();
  // Each established CLI writes its own terminal record last. Never scan back
  // to an earlier descendant record after the requested parent's record is lost.
  const line = raw.split(/\r?\n/).at(-1).trim();
  if (protocol.marker && !line.startsWith(protocol.marker)) return hold();
  if (protocol.uniqueMarker && raw.split(/\r?\n/)
    .filter(value => value.trim().startsWith(protocol.marker)).length !== 1) return hold();
  const candidate = protocol.marker ? line.slice(protocol.marker.length) : line;
  try {
    const receipt = JSON.parse(candidate);
    if (protocol.canonicalJson && JSON.stringify(receipt) !== candidate) return hold();
    if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)
        && receipt.schemaVersion === protocol.schema && typeof receipt.ok === 'boolean') return receipt;
  } catch {}
  return hold();
}

// Original Core repair identity and retained owner observation. These additions
// share the established maintenance boundary and do not expand execution scope.
// Correlation and closed observation only. Native custody remains with the
// existing OS-anchored maintenance owner; caller metadata cannot grant it.
export const CORE_REPAIR_CONTINUATION_SCHEMA_V1 = 'stephanos.core-repair-continuation.v1';
export const CORE_REPAIR_REQUEST_STATUS_SCHEMA_V1 = 'stephanos.core-repair-request-status.v1';
export const CORE_REPAIR_OWNER_PROTOCOL_V1 = 'core-request-prepare-execute-v1';
export const CORE_REPAIR_REQUEST_ID_V1 = /^[a-z0-9][a-z0-9._-]{7,79}$/;
export const CORE_REPAIR_ACTIONS_V1 = Object.freeze([
  'repair-goal-builder-flow', 'repair-battle-bridge', 'repair-control-plane',
]);
export const CORE_REPAIR_MISSIONS_V1 = Object.freeze([
  'stephanos-core-octopus-self-heal', 'stephanos-core-backend-self-heal',
  'stephanos-core-dependency-self-heal',
]);
export const CORE_REPAIR_REQUEST_STATES_V1 = Object.freeze([
  'LEGACY_HISTORY_UNPROVEN', 'UNKNOWN', 'READY', 'PREPARED', 'RESERVED', 'NOT_STARTED',
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'CONFLICT', 'SUPERSEDED',
]);
export const CORE_REPAIR_CONTINUATION_INPUT_SCHEMA_V1 = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'enrollmentId', 'requestId', 'missionId', 'relatedIssue', 'actionId', 'sourceHead', 'sequence', 'previousRequestId'],
  properties: {
    schemaVersion: { type: 'string', const: CORE_REPAIR_CONTINUATION_SCHEMA_V1 },
    enrollmentId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    requestId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{7,79}$' },
    missionId: { type: 'string', enum: CORE_REPAIR_MISSIONS_V1 },
    relatedIssue: { type: 'string', const: '#2961' },
    actionId: { type: 'string', enum: CORE_REPAIR_ACTIONS_V1 },
    sourceHead: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    sequence: { type: 'integer', minimum: 1, maximum: 1000000000 },
    previousRequestId: { type: 'string', maxLength: 80 },
  },
});
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const CODE = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;
const correlationKeys = Object.freeze([
  'schemaVersion', 'enrollmentId', 'requestId', 'missionId', 'relatedIssue', 'actionId',
  'sourceHead', 'sequence', 'previousRequestId',
]);
const statusKeys = Object.freeze([
  'schemaVersion', 'ok', 'state', 'continuation', 'observedAtUtc', 'observerSourceHead',
  'historyAuthenticated', 'custodyReleased', 'currentAdmissionAvailable', 'nextSequence',
  'previousRequestId', 'terminalProofHash', 'blocker', 'sameRequestDeliveryAllowed',
  'sameRequestPreparationAllowed', 'ownerProtocolVersion', 'preparationRequired', 'initialEpochProven', 'enrollmentId',
  'replayAllowed', 'readOnly', 'executionAuthority',
]);
function data(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
const sequence = value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000_000;
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

export function captureCoreRepairContinuationV1(value) {
  try {
    if (!data(value, correlationKeys)
      || correlationKeys.filter(key => key !== 'sequence').some(key => typeof value[key] !== 'string')
      || value.schemaVersion !== CORE_REPAIR_CONTINUATION_SCHEMA_V1
      || !HASH.test(value.enrollmentId)
      || !CORE_REPAIR_REQUEST_ID_V1.test(value.requestId)
      || !CORE_REPAIR_MISSIONS_V1.includes(value.missionId)
      || value.relatedIssue !== '#2961' || !CORE_REPAIR_ACTIONS_V1.includes(value.actionId)
      || !SHA.test(value.sourceHead) || !sequence(value.sequence)
      || (value.sequence === 1 ? value.previousRequestId !== ''
        : !CORE_REPAIR_REQUEST_ID_V1.test(value.previousRequestId))
      || value.requestId === value.previousRequestId) return null;
    return Object.freeze(Object.fromEntries(correlationKeys.map(key => [key, value[key]])));
  } catch { return null; }
}

export function captureCoreRepairStatusRequestV1(value) {
  try {
    if (data(value, [])) return Object.freeze({});
    if (!data(value, ['continuation'])) return null;
    const continuation = captureCoreRepairContinuationV1(value.continuation);
    return continuation ? Object.freeze({ continuation }) : null;
  } catch { return null; }
}

export function captureCoreRepairPrepareRequestV1(value) {
  const request = captureCoreRepairStatusRequestV1(value);
  return request?.continuation ? request : null;
}

export function sameCoreRepairContinuationV1(left, right) {
  const a = captureCoreRepairContinuationV1(left), b = captureCoreRepairContinuationV1(right);
  return Boolean(a && b && correlationKeys.every(key => a[key] === b[key]));
}

export function captureCoreRepairContinuationStatusV1(value) {
  try {
    if (!data(value, statusKeys) || value.schemaVersion !== CORE_REPAIR_REQUEST_STATUS_SCHEMA_V1
      || !CORE_REPAIR_REQUEST_STATES_V1.includes(value.state) || !utc(value.observedAtUtc)
      || (value.observerSourceHead !== '' && !SHA.test(value.observerSourceHead))
      || ['ok', 'historyAuthenticated', 'custodyReleased', 'currentAdmissionAvailable', 'sameRequestDeliveryAllowed',
        'sameRequestPreparationAllowed', 'initialEpochProven']
        .some(key => typeof value[key] !== 'boolean')
      || value.ownerProtocolVersion !== CORE_REPAIR_OWNER_PROTOCOL_V1 || value.preparationRequired !== true
      || typeof value.enrollmentId !== 'string' || (value.enrollmentId !== '' && !HASH.test(value.enrollmentId))
      || ['observerSourceHead', 'previousRequestId', 'terminalProofHash', 'blocker'].some(key => typeof value[key] !== 'string')
      || value.replayAllowed !== false || value.readOnly !== true || value.executionAuthority !== false
      || (value.nextSequence !== null && !sequence(value.nextSequence))
      || (value.previousRequestId !== '' && !CORE_REPAIR_REQUEST_ID_V1.test(value.previousRequestId))
      || (value.terminalProofHash !== '' && !HASH.test(value.terminalProofHash))
      || (value.blocker !== '' && !CODE.test(value.blocker))) return null;
    const continuation = value.continuation === null ? null : captureCoreRepairContinuationV1(value.continuation);
    if (value.continuation !== null && !continuation) return null;
    if (value.historyAuthenticated && continuation && continuation.enrollmentId !== value.enrollmentId) return null;
    if (value.sameRequestDeliveryAllowed && (value.state !== 'PREPARED' || !value.historyAuthenticated
      || !continuation || value.observerSourceHead !== continuation.sourceHead
      || value.blocker !== '')) return null;
    if (value.sameRequestPreparationAllowed && (value.state !== 'UNKNOWN' || !value.historyAuthenticated
      || !continuation || value.observerSourceHead !== continuation.sourceHead
      || value.blocker !== 'CORE_REPAIR_REQUEST_NOT_PREPARED')) return null;
    if ((value.historyAuthenticated || value.custodyReleased || value.currentAdmissionAvailable)
        && (!SHA.test(value.observerSourceHead) || !value.historyAuthenticated
          || !value.initialEpochProven || !HASH.test(value.enrollmentId))) return null;
    if (value.initialEpochProven !== HASH.test(value.enrollmentId)) return null;
    if (['LEGACY_HISTORY_UNPROVEN', 'CONFLICT', 'SUPERSEDED', 'PREPARED', 'RESERVED'].includes(value.state)
        && (value.custodyReleased || value.currentAdmissionAvailable || value.nextSequence !== null)) return null;
    if (value.state === 'UNKNOWN' && !value.sameRequestPreparationAllowed && (value.currentAdmissionAvailable || value.nextSequence !== null)) return null;
    if (['PREPARED', 'RESERVED', 'NOT_STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value.state)
        && (!continuation || !value.historyAuthenticated)) return null;
    if (['NOT_STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value.state) && !HASH.test(value.terminalProofHash)) return null;
    if (value.nextSequence !== null && (!value.historyAuthenticated || !value.custodyReleased
        || !value.currentAdmissionAvailable || (value.sameRequestPreparationAllowed
          ? value.nextSequence !== continuation.sequence || value.previousRequestId !== continuation.previousRequestId
          : continuation
          ? value.nextSequence !== continuation.sequence + 1 || value.previousRequestId !== continuation.requestId
          : value.nextSequence !== 1 || value.previousRequestId !== ''))) return null;
    if (value.state === 'READY' && (continuation || !value.historyAuthenticated || !value.custodyReleased)) return null;
    return Object.freeze({ ...Object.fromEntries(statusKeys.map(key => [key, value[key]])), continuation });
  } catch { return null; }
}

export function unknownCoreRepairRequestStatusV1({ continuation = null, observedAtUtc = new Date().toISOString(),
  observerSourceHead = '', state = 'UNKNOWN', blocker = 'CORE_REPAIR_REQUEST_HISTORY_UNPROVEN' } = {}) {
  const captured = captureCoreRepairContinuationV1(continuation);
  return Object.freeze({ schemaVersion: CORE_REPAIR_REQUEST_STATUS_SCHEMA_V1, ok: false,
    state: ['UNKNOWN', 'LEGACY_HISTORY_UNPROVEN', 'CONFLICT', 'SUPERSEDED'].includes(state) ? state : 'UNKNOWN',
    continuation: captured, observedAtUtc: utc(observedAtUtc) ? observedAtUtc : new Date().toISOString(),
    observerSourceHead: typeof observerSourceHead === 'string' && SHA.test(observerSourceHead) ? observerSourceHead : '', historyAuthenticated: false,
    custodyReleased: false, currentAdmissionAvailable: false, nextSequence: null, previousRequestId: '',
    terminalProofHash: '', blocker: typeof blocker === 'string' && CODE.test(blocker) ? blocker : 'CORE_REPAIR_REQUEST_HISTORY_UNPROVEN',
    sameRequestDeliveryAllowed: false, sameRequestPreparationAllowed: false,
    ownerProtocolVersion: CORE_REPAIR_OWNER_PROTOCOL_V1, preparationRequired: true,
    initialEpochProven: false, enrollmentId: '', replayAllowed: false, readOnly: true, executionAuthority: false });
}

// Fixed, bounded child-result projection shared by immediate and retained owner receipts.
const GOAL_BUILDER_REPAIR_RESULT_MARKER = 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=';
const SAFE_GOAL_BUILDER_BLOCKER = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;

export function projectGoalBuilderChildBlockerV1(processId, stdout) {
  if (processId !== 'repair-goal-builder-flow') return '';
  const raw = String(stdout || '');
  if (!raw || Buffer.byteLength(raw, 'utf8') > 16 * 1024) return '';
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const marked = lines.filter(line => line.startsWith(GOAL_BUILDER_REPAIR_RESULT_MARKER));
  if (marked.length !== 1) return '';
  try {
    const value = JSON.parse(marked[0].slice(GOAL_BUILDER_REPAIR_RESULT_MARKER.length));
    const blocker = typeof value?.blocker === 'string' ? value.blocker.trim() : '';
    if (!value || Array.isArray(value)
      || value.schemaVersion !== 'stephanos.sovereign-commander-goal-builder-repair.v1'
      || value.ok !== false
      || !['SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED', 'SOVEREIGN_GOAL_BUILDER_ORIGINAL_OWNER_RECOVERY_REQUIRED'].includes(value.finalVerdict)
      || value.canonicalGoalFabricOnly !== true
      || value.duplicateSchedulerAllowed !== false
      || value.mergeAuthority !== false
      || value.arbitraryShellAllowed !== false
      || !SAFE_GOAL_BUILDER_BLOCKER.test(blocker)) return '';
    return blocker;
  } catch {
    return '';
  }
}
