import { CONTROL_TOWER_BUILD_OPERATION, CONTROL_TOWER_OBSERVE_OPERATION,
  CONTROL_TOWER_OPERATIONS_V1 } from './controlTowerBuildRequestV1.mjs';
import { projectSovereignControlSystemStatusV1,
  SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1,
  sovereignControlSystemDiagnosticCodeV1 } from './sovereignControlSystemStatusV1.mjs';

// This is diagnostic memory in the ORIGINAL execution ledger. It is never an
// input to request authentication, replay admission, worker grants or custody.
export const CONTROL_TOWER_REQUEST_OBSERVATION_SCHEMA_V1 = 'stephanos.control-tower-request-observation.v1';
export const CONTROL_TOWER_REQUEST_OBSERVATION_MAX_BYTES_V1 = 3500;
const REQUEST = /^control-tower-build-([1-9][0-9]{0,15})-1$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['RESERVED', 'UNKNOWN', 'WAKE_COMPLETED', 'WAKE_BLOCKED',
  'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED']);
const BLOCKERS = new Set([
  'CONTROL_TOWER_REQUEST_RESERVED', 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN',
  'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN', 'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED',
  'CONTROL_TOWER_OBSERVATION_UNPROVEN', 'CONTROL_TOWER_OBSERVATION_BLOCKED',
  'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED',
  'CONTROL_TOWER_BUILD_NOT_OBSERVED', 'NO_CONTROL_TOWER_BUILD_REQUEST',
  'CONTROL_TOWER_INSTALLED_SOURCE_UNPROVEN', 'CONTROL_TOWER_BUILD_REQUEST_NOT_AUTHENTICATED',
  'CONTROL_TOWER_BUILD_REQUEST_ALREADY_RECORDED', 'CONTROL_TOWER_BUILD_REQUEST_OBSERVATION_INVALID',
  'CONTROL_TOWER_BUILD_OBSERVATION_FAILED', 'CONTROL_TOWER_LEGACY_DETAIL_UNAVAILABLE',
  'CONTROL_TOWER_STORED_OBSERVATION_INVALID',
  'CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN', 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED',
  'CONTROL_TOWER_AUTHENTICATED_BUILD_READ_FAILED', 'CONTROL_TOWER_BUILD_ACTIVE_WINDOW_OVERFLOW',
  'CONTROL_TOWER_BUILD_ARTIFACT_DIGEST_INVALID', 'CONTROL_TOWER_BUILD_ARTIFACT_INVALID',
  'CONTROL_TOWER_BUILD_CLOCK_INVALID', 'CONTROL_TOWER_BUILD_JOB_ESTATE_INVALID',
  'CONTROL_TOWER_BUILD_WORKFLOW_UNAVAILABLE', 'CONTROL_TOWER_MAIN_MOVED', 'CONTROL_TOWER_MAIN_UNPROVEN',
  'CONTROL_TOWER_READ_CREDENTIAL_UNAVAILABLE', 'CONTROL_TOWER_REQUEST_HISTORY_INVALID',
  'CONTROL_TOWER_RUN_INVENTORY_INVALID', 'LATEST_CONTROL_TOWER_BUILD_REQUEST_NOT_READY',
  'CONTROL_TOWER_BUILD_PROJECTION_CONTEXT_INVALID', 'CONTROL_TOWER_RELAY_RECORD_MISSING',
  'CONTROL_TOWER_RELAY_SCHEMA_INVALID', 'CONTROL_TOWER_RELAY_SOURCE_MISMATCH',
  'CONTROL_TOWER_RELAY_HEARTBEAT_STALE', 'CONTROL_TOWER_BUILD_RECEIPT_MISSING',
  'CONTROL_TOWER_BUILD_RECEIPT_INVALID', 'CONTROL_TOWER_BUILD_RECEIPT_STALE',
  'CONTROL_TOWER_BUILD_REQUEST_ID_INVALID', 'CONTROL_TOWER_BUILD_REQUEST_BINDING_INVALID',
  'CONTROL_TOWER_BUILD_BLOCKER_INVALID', 'CONTROL_TOWER_OBSERVATION_PROOF_INVALID',
  'CONTROL_TOWER_BUILD_WAKE_PROOF_INVALID', 'CONTROL_TOWER_WORKSPACE_UNAVAILABLE',
  'CONTROL_TOWER_RELAY_PATH_UNSAFE', 'CONTROL_TOWER_RELAY_SIZE_INVALID',
  'CONTROL_TOWER_RELAY_CHANGED_DURING_READ', 'CONTROL_TOWER_RELAY_READ_UNAVAILABLE',
  'CONTROL_TOWER_BUILD_RECEIPT_UNPROVEN', 'CONTROL_TOWER_REQUEST_OUTCOME_UNPROVEN',
  'CONTROL_TOWER_REQUEST_OPERATION_FILTER_INVALID', 'CONTROL_TOWER_RECORDED_BUILD_DETAIL_MISSING',
  'CONTROL_TOWER_RELAY_CYCLE_FAILED',
  'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED', 'SOVEREIGN_MAINTENANCE_OWNER_TOKEN_UNAVAILABLE',
  'SOVEREIGN_MAINTENANCE_OWNER_INITIALIZE_FAILED', 'SOVEREIGN_MAINTENANCE_OWNER_TOOL_UNAVAILABLE',
  'SOVEREIGN_MAINTENANCE_OWNER_RECEIPT_INVALID', 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE',
  'SOVEREIGN_MAINTENANCE_OWNER_BUSY', 'SOVEREIGN_MAINTENANCE_CUSTODY_UNPROVEN',
  'MAINTENANCE_CUSTODY_STATE_MISSING', 'MAINTENANCE_CUSTODY_STATE_INVALID',
  'MAINTENANCE_CUSTODY_AUDIT_UNAVAILABLE', 'MAINTENANCE_CUSTODY_RECORD_INVALID',
  'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN',
  'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED', 'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN',
  'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED', 'FIXED_RUNTIME_WINDOWS_REQUIRED',
  'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD', 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
  'FIXED_RUNTIME_QUALIFICATION_UNPROVEN', 'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED',
  'FIXED_RUNTIME_AUTHENTICATED_IDLE_UNPROVEN', 'FIXED_RUNTIME_NORMAL_OPERATOR_REQUIRED',
  'FIXED_RUNTIME_IDENTITY_INSPECTION_TIMEOUT', 'FIXED_RUNTIME_INSPECTOR_NOT_FOUND',
  'FIXED_RUNTIME_CURRENT_SOURCE_REF_CHANGED', 'FIXED_RUNTIME_CURRENT_SOURCE_MEMBER_CHANGED',
  'FIXED_RUNTIME_PROTECTED_INSTALLATION_INVALID', 'FIXED_RUNTIME_LATER_BOOT_UNPROVEN',
]);
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.length <= 64 && keys.every(key => typeof key === 'string'
    && Object.hasOwn(descriptors[key], 'value'));
};
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const knownBlocker = value => typeof value === 'string' && Boolean(value)
  && (BLOCKERS.has(value) || sovereignControlSystemDiagnosticCodeV1(value) === value);
const utc = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === (value.length === 20 ? value.slice(0, -1) + '.000Z' : value);
};
const noAuthority = Object.freeze({ historical: true, diagnosticOnly: true,
  buildStartedProven: false, nativePickupProven: false, goalCompletionProven: false,
  sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false });
export const controlTowerObservationBlockerV1 = (value, fallback = 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN') =>
  knownBlocker(value) ? value : knownBlocker(fallback) ? fallback : 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN';

export function projectControlTowerRequestObservationV1(value, {
  requestId = '', commandDigest = '', nowMs = Date.now(),
} = {}) {
  if (!object(value) || value.schemaVersion !== CONTROL_TOWER_REQUEST_OBSERVATION_SCHEMA_V1
    || !Number.isFinite(nowMs) || !positive(value.runId) || value.runAttempt !== 1
    || value.requestId !== 'control-tower-build-' + value.runId + '-1'
    || !matches(REQUEST, value.requestId) || (requestId && requestId !== value.requestId)
    || !CONTROL_TOWER_OPERATIONS_V1.includes(value.operation) || !matches(SHA, value.sourceHead)
    || !positive(value.artifactId) || !matches(HASH, value.artifactSha256)
    || !matches(HASH, value.commandDigest) || (commandDigest && commandDigest !== value.commandDigest)
    || Object.entries(noAuthority).some(([flag, expected]) => Object.hasOwn(value, flag) && value[flag] !== expected)
    || !STATES.has(value.state) || ![value.createdAtUtc, value.expiresAtUtc, value.acceptedAtUtc, value.observedAtUtc].every(utc)
    || Date.parse(value.expiresAtUtc) - Date.parse(value.createdAtUtc) !== 600000
    || Date.parse(value.acceptedAtUtc) < Date.parse(value.createdAtUtc)
    || Date.parse(value.acceptedAtUtc) >= Date.parse(value.expiresAtUtc)
    || Date.parse(value.observedAtUtc) < Date.parse(value.acceptedAtUtc)
    || Date.parse(value.observedAtUtc) > nowMs + 5000
    || typeof value.blocker !== 'string' || (value.blocker && !knownBlocker(value.blocker))) return null;
  const wakeProofHash = value.wakeProofHash || '';
  const observationProofHash = value.observationProofHash || '';
  if ((value.wakeProofHash != null && typeof value.wakeProofHash !== 'string')
    || (value.observationProofHash != null && typeof value.observationProofHash !== 'string')) return null;
  let controlSystemStatus = null;
  if (value.controlSystemStatus != null) {
    if (!object(value.controlSystemStatus) || value.operation !== CONTROL_TOWER_OBSERVE_OPERATION
      || value.controlSystemStatus.schemaVersion !== SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1) return null;
    controlSystemStatus = projectSovereignControlSystemStatusV1(value.controlSystemStatus);
    if (!controlSystemStatus || controlSystemStatus.schemaVersion !== SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1
      || !matches(HASH, observationProofHash)) return null;
  } else if (observationProofHash) return null;
  if (value.state === 'WAKE_COMPLETED') {
    if (value.operation !== CONTROL_TOWER_BUILD_OPERATION || value.blocker || !matches(HASH, wakeProofHash)) return null;
  } else if (wakeProofHash) return null;
  if (value.state === 'WAKE_BLOCKED' && (value.operation !== CONTROL_TOWER_BUILD_OPERATION || !value.blocker)) return null;
  if (value.state === 'OBSERVATION_COMPLETED'
    && (value.operation !== CONTROL_TOWER_OBSERVE_OPERATION || value.blocker
      || controlSystemStatus?.observationCompleted !== true
      || controlSystemStatus.source?.sourceHead !== value.sourceHead
      || controlSystemStatus.source?.expectedMain !== value.sourceHead)) return null;
  if (value.state === 'OBSERVATION_BLOCKED'
    && (value.operation !== CONTROL_TOWER_OBSERVE_OPERATION || !value.blocker)) return null;
  if (['RESERVED', 'UNKNOWN'].includes(value.state) && (!value.blocker || controlSystemStatus || wakeProofHash || observationProofHash)) return null;
  if (value.state === 'RESERVED' && value.observedAtUtc !== value.acceptedAtUtc) return null;
  const projected = Object.freeze({
    schemaVersion: CONTROL_TOWER_REQUEST_OBSERVATION_SCHEMA_V1,
    requestId: value.requestId, runId: value.runId, runAttempt: 1, operation: value.operation,
    sourceHead: value.sourceHead, artifactId: value.artifactId, artifactSha256: value.artifactSha256,
    commandDigest: value.commandDigest, createdAtUtc: value.createdAtUtc, expiresAtUtc: value.expiresAtUtc,
    acceptedAtUtc: value.acceptedAtUtc, observedAtUtc: value.observedAtUtc,
    state: value.state, blocker: value.blocker, wakeProofHash, observationProofHash,
    ...(controlSystemStatus ? { controlSystemStatus } : {}), ...noAuthority,
  });
  return new TextEncoder().encode(JSON.stringify(projected)).length <= CONTROL_TOWER_REQUEST_OBSERVATION_MAX_BYTES_V1 ? projected : null;
}

export function createControlTowerRequestObservationV1(request, {
  commandDigest, acceptedAtUtc, observedAtUtc = acceptedAtUtc, state = 'RESERVED',
  blocker = 'CONTROL_TOWER_REQUEST_RESERVED', wakeProofHash = '', controlSystemStatus = null, observationProofHash = '',
  nowMs = Date.now(),
} = {}) {
  const safeStatus = controlSystemStatus == null ? null : projectSovereignControlSystemStatusV1(controlSystemStatus);
  return projectControlTowerRequestObservationV1({ ...request,
    schemaVersion: CONTROL_TOWER_REQUEST_OBSERVATION_SCHEMA_V1,
    commandDigest, acceptedAtUtc, observedAtUtc, state,
    blocker: blocker ? controlTowerObservationBlockerV1(blocker,
      request?.operation === CONTROL_TOWER_OBSERVE_OPERATION ? 'CONTROL_TOWER_OBSERVATION_UNPROVEN' : 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN') : '',
    wakeProofHash, controlSystemStatus: safeStatus,
    observationProofHash: safeStatus ? observationProofHash : '',
  }, { nowMs });
}

// Validate a metadata-bearing ledger observation without borrowing its current
// poll's time/head. Legacy entries retain phase truth but cannot invent detail.
export function projectControlTowerLedgerObservationV1(record, { nowMs = Date.now() } = {}) {
  if (!object(record) || typeof record.requestId !== 'string') return null;
  const matched = REQUEST.exec(record.requestId);
  if (!matched || !Number.isSafeInteger(Number(matched[1])) || record.issueNumber !== 2315
    || !['RESERVED', 'TERMINAL', 'RETIRED'].includes(record.phase)) return null;
  const observation = projectControlTowerRequestObservationV1(record.controlTowerObservation,
    { requestId: record.requestId, commandDigest: record.commandDigest, nowMs });
  const terminal = observation && ['WAKE_COMPLETED', 'WAKE_BLOCKED', 'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED'].includes(observation.state);
  const expectedState = observation?.state.endsWith('_COMPLETED') ? 'DONE' : 'BLOCKED';
  const consistent = observation && (record.phase === 'RESERVED' ? observation.state === 'RESERVED'
    && !record.terminalState && !record.terminalProofHash
    : record.phase === 'TERMINAL' && terminal && record.terminalState === expectedState
      && (observation.state !== 'WAKE_COMPLETED' || record.terminalProofHash === observation.wakeProofHash));
  if (consistent) return Object.freeze({ ...observation, ledgerPhase: record.phase,
    terminalState: record.terminalState || '', detailState: 'OBSERVED' });
  return Object.freeze({ schemaVersion: CONTROL_TOWER_REQUEST_OBSERVATION_SCHEMA_V1,
    requestId: record.requestId, runId: Number(matched[1]), runAttempt: 1,
    operation: '', sourceHead: '', acceptedAtUtc: '', observedAtUtc: '',
    state: record.phase === 'RESERVED' ? 'RESERVED' : 'UNKNOWN',
    blocker: record.controlTowerObservation == null ? 'CONTROL_TOWER_LEGACY_DETAIL_UNAVAILABLE' : 'CONTROL_TOWER_STORED_OBSERVATION_INVALID',
    ledgerPhase: record.phase,
    terminalState: record.phase === 'TERMINAL' && ['DONE', 'BLOCKED'].includes(record.terminalState) ? record.terminalState : '',
    detailState: record.controlTowerObservation == null ? 'LEGACY_DETAIL_UNAVAILABLE' : 'INVALID', ...noAuthority });
}

export function projectControlTowerLatestRequestObservationV1(value, { expectedHead = '', nowMs = Date.now() } = {}) {
  if (!object(value)) return null;
  const valid = projectControlTowerRequestObservationV1(value, { nowMs });
  if (valid && ['RESERVED', 'TERMINAL'].includes(value.ledgerPhase)
    && (value.ledgerPhase === 'RESERVED' ? valid.state === 'RESERVED' && value.terminalState === ''
      : ['WAKE_COMPLETED', 'WAKE_BLOCKED', 'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED'].includes(valid.state)
        && value.terminalState === (valid.state.endsWith('_COMPLETED') ? 'DONE' : 'BLOCKED'))) {
    return Object.freeze({ ...valid, ledgerPhase: value.ledgerPhase, terminalState: value.terminalState || '',
      detailState: 'OBSERVED', exactHeadMatch: matches(SHA, expectedHead) ? valid.sourceHead === expectedHead : false,
      evidenceState: matches(SHA, expectedHead) && valid.sourceHead === expectedHead ? 'HISTORICAL' : 'HEAD_MISMATCH',
      ageMs: Math.max(0, nowMs - Date.parse(valid.observedAtUtc)) });
  }
  if (value.detailState === 'MISSING') {
    const missing = controlTowerMissingLedgerObservationV1(value.requestId);
    if (!missing || value.state !== 'UNKNOWN' || value.ledgerPhase !== 'UNPROVEN'
      || value.runId !== missing.runId || value.terminalState !== '') return null;
    return Object.freeze({ ...missing, exactHeadMatch: false, evidenceState: 'MISSING', ageMs: null });
  }
  if (value.detailState !== 'LEGACY_DETAIL_UNAVAILABLE' && value.detailState !== 'INVALID') return null;
  const legacy = projectControlTowerLedgerObservationV1({ requestId: value.requestId, issueNumber: 2315,
    phase: value.ledgerPhase, terminalState: value.terminalState,
    ...(value.detailState === 'INVALID' ? { controlTowerObservation: {} } : {}) }, { nowMs });
  if (!legacy || legacy.runId !== value.runId || legacy.state !== value.state) return null;
  return Object.freeze({ ...legacy, exactHeadMatch: false, evidenceState: legacy.detailState, ageMs: null });
}

// A previously retained, validated status pointer whose record disappeared is
// a history gap, never proof of terminal release. It supplies no ledger phase,
// source, acceptance time, or execution result.
export function controlTowerMissingLedgerObservationV1(requestId) {
  const matched = typeof requestId === 'string' ? REQUEST.exec(requestId) : null;
  if (!matched || !Number.isSafeInteger(Number(matched[1]))) return null;
  return Object.freeze({ schemaVersion: CONTROL_TOWER_REQUEST_OBSERVATION_SCHEMA_V1,
    requestId, runId: Number(matched[1]), runAttempt: 1, operation: '', sourceHead: '',
    acceptedAtUtc: '', observedAtUtc: '', state: 'UNKNOWN', ledgerPhase: 'UNPROVEN',
    terminalState: '', detailState: 'MISSING', blocker: 'CONTROL_TOWER_RECORDED_BUILD_DETAIL_MISSING', ...noAuthority });
}

// Execution uncertainty is the original ledger's phase/outcome, not the lack
// of newer descriptive metadata. Legacy terminal DONE/BLOCKED remains terminal
// while its original time/head and detailed wake result remain unavailable.
export function controlTowerBuildObservationUnresolvedV1(value, { nowMs = Date.now() } = {}) {
  if (value == null) return false;
  const seen = projectControlTowerLatestRequestObservationV1(value, { nowMs });
  if (!seen || seen.ledgerPhase !== 'TERMINAL' || !['DONE', 'BLOCKED'].includes(seen.terminalState)) return true;
  if (seen.detailState === 'LEGACY_DETAIL_UNAVAILABLE') return false;
  return seen.detailState !== 'OBSERVED' || seen.operation !== CONTROL_TOWER_BUILD_OPERATION
    || !['WAKE_COMPLETED', 'WAKE_BLOCKED'].includes(seen.state);
}
