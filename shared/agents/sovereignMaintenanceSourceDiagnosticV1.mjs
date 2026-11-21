// Diagnostic vocabulary from the canonical source collector and its existing
// topology/configuration/runtime-directory checks. No source or custody proof.
import { projectBattleBridgeGitConfigurationDiagnosticV1 } from './battleBridgeGitConfigurationDiagnosticV1.mjs';
const sourceCodes = new Set([
  'CANONICAL_GIT_PROBE_DIRECTORY_UNPROVEN', 'CANONICAL_GIT_PROBE_FILE_UNPROVEN',
  'CANONICAL_GIT_PROBE_FILE_CHANGED', 'CANONICAL_GIT_PROBE_CONTEXT_CHANGED',
  'CANONICAL_GIT_PROBE_CONTEXT_CLOSED', 'CANONICAL_GIT_PROBE_ORIGINAL_CHANGED',
  'CANONICAL_GIT_PROBE_HEAD_UNSUPPORTED', 'CANONICAL_GIT_PROBE_INDEX_UNSUPPORTED',
  'CANONICAL_GIT_PROBE_INDEX_TIMESTAMP_UNPROVEN', 'CANONICAL_GIT_PROBE_CLEANUP_UNPROVEN',
  'CANONICAL_GIT_PROBE_CONTEXT_UNPROVEN', 'CANONICAL_GIT_PROBE_CONFIGURATION_NOT_EMPTY',
  'CANONICAL_GIT_PROBE_SUBMODULE_UNSUPPORTED',
  'CANONICAL_CHECKOUT_DIRTY', 'CANONICAL_GIT_CONFIGURATION_CHANGED', 'CANONICAL_GIT_CONFIGURATION_INVALID',
  'CANONICAL_GIT_METADATA_SCAN_FAILED', 'CANONICAL_GIT_METADATA_SCAN_LIMIT_EXCEEDED',
  'CANONICAL_GIT_REPARSE_POINT_PRESENT', 'CANONICAL_GIT_TOPOLOGY_CHANGED', 'CANONICAL_GIT_TOPOLOGY_INVALID',
  'CANONICAL_GIT_TOPOLOGY_UNPROVEN', 'CANONICAL_MAIN_NOT_CURRENT', 'CANONICAL_MAIN_SOURCE_UNPROVEN',
  'CANONICAL_REMOTE_TRUTH_INVALID', 'CANONICAL_SOURCE_STATUS_INVALID', 'CANONICAL_SOURCE_TRUTH_CHANGED',
  'CANONICAL_SOURCE_TRUTH_UNPROVEN', 'CANONICAL_TRACKED_VISIBILITY_CHANGED', 'CANONICAL_UPSTREAM_UNPROVEN',
  'FIXED_AUTHORITY_GIT_FAILED', 'GIT_COMMON_DIRECTORY_REDIRECT_PRESENT', 'GIT_GRAFTS_PRESENT',
  'GIT_OBJECT_ALTERNATES_PRESENT', 'HIDDEN_TRACKED_PATHS_PRESENT', 'IGNITION_RUNTIME_AGGREGATE_SCAN_FAILED',
]);
const sourceSteps = new Set([
  'source-config-before-fetch', 'source-tracked-visibility-before-fetch', 'source-status-before-fetch',
  'source-branch-before-fetch', 'source-upstream-before-fetch', 'source-head-before-fetch',
  'source-fetch', 'source-origin-head', 'source-divergence', 'source-status-after-fetch',
  'source-config-after-fetch', 'source-branch-after-fetch', 'source-upstream-after-fetch',
  'source-head-after-fetch', 'source-origin-head-after-fetch', 'source-tracked-visibility-after-fetch',
  'source-status-final', 'source-tracked-visibility-final', 'source-heads-final',
  'source-isolated-config-before-fetch', 'source-isolated-config-after-fetch',
]);

export function projectMaintenanceSourceDiagnosticV1(code, step, configuration) {
  const sourceCode = typeof code === 'string' && sourceCodes.has(code) ? code : 'UNKNOWN';
  return Object.freeze({ sourceCode,
    ...(sourceCode === 'FIXED_AUTHORITY_GIT_FAILED' ? {
      sourceStep: typeof step === 'string' && sourceSteps.has(step) ? step : 'UNKNOWN',
    } : {}),
    ...(['CANONICAL_GIT_CONFIGURATION_INVALID', 'CANONICAL_GIT_CONFIGURATION_CHANGED'].includes(sourceCode) ? {
      sourceConfiguration: projectBattleBridgeGitConfigurationDiagnosticV1(configuration),
    } : {}),
  });
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
