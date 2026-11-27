// One public, observation-only projection for the existing Control Tower receipt.
// This module has no native imports, credentials, persistence or execution path.
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from './sovereignMaintenanceAdmissionV1.mjs';
export const SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1 = 'stephanos.sovereign-control-system-inspection.v1';
export const SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1 = 'stephanos.sovereign-control-system-status.v1';
export const SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1 = 2048;
export const SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_PREDICATES_V1 = Object.freeze([
  'HTTP_OK', 'HEALTH_OK', 'SERVICE', 'OBSERVATION_SCOPE', 'NO_ADMISSION', 'OWNER_VERSION',
]);

const SHA = /^[a-f0-9]{40}$/;
// Closed compiled inventory only; observing a name grants no action admission.
const PROFILES = new Set(['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1',
  'SPATIAL_WORKSPACE_PREPARE_V1', 'CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1']);
const UNKNOWN = 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN';
// This optional denial detail never joins the general blocker vocabulary or
// supplies native qualification, execution custody or governor permission.
const GOVERNOR_HOLD_CODES = new Set([
  'FIXED_RUNTIME_GOVERNOR_WORKSPACE_UNPROVEN', 'FIXED_RUNTIME_GOVERNOR_WORKSPACE_MISMATCH',
  'FIXED_RUNTIME_GOVERNOR_PREPARE_PENDING', 'FIXED_RUNTIME_GOVERNOR_OVERRIDE_UNPROVEN',
  'FIXED_RUNTIME_GOVERNOR_STATE_INVALID', 'FIXED_RUNTIME_GOVERNOR_CLOCK_UNPROVEN',
  'FIXED_RUNTIME_GOVERNOR_OBSERVATION_FUTURE', 'FIXED_RUNTIME_GOVERNOR_OBSERVATION_STALE',
  'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED', 'FIXED_RUNTIME_GOVERNOR_EVIDENCE_UNAVAILABLE',
]);

export function sovereignControlSystemGovernorHoldCodeV1(value) {
  return typeof value === 'string' && GOVERNOR_HOLD_CODES.has(value)
    ? value : 'FIXED_RUNTIME_GOVERNOR_EVIDENCE_UNAVAILABLE';
}

// Fresh signal diagnostics are separate from the persisted governor permission
// and native qualification above. Neither their success nor failure is admission.
const GOVERNOR_OBSERVATION_CODES = new Set([
  'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_SOURCE_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_TIMEOUT',
  'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID',
  'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED',
]);

export function sovereignControlSystemGovernorObservationCodeV1(value) {
  return typeof value === 'string' && GOVERNOR_OBSERVATION_CODES.has(value)
    ? value : 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_UNPROVEN';
}

// A reason for missing owner evidence is not owner identity or custody proof.
const OWNER_DIAGNOSTIC_CODES = new Set([
  'OWNER_CIM_LISTENER_QUERY_FAILED', 'OWNER_LISTENER_UNPROVEN', 'OWNER_LISTENER_NOT_PRIVATE',
  'OWNER_CIM_PROCESS_QUERY_FAILED', 'OWNER_PROCESS_UNPROVEN', 'OWNER_COMMAND_LINE_UNAVAILABLE',
  'OWNER_COMMAND_LINE_MISMATCH', 'OWNER_IMAGE_MISMATCH', 'OWNER_PROCESS_BIRTH_UNAVAILABLE',
  'OWNER_NATIVE_QUERY_UNAVAILABLE', 'OWNER_NATIVE_ACCESS_DENIED', 'OWNER_NATIVE_OPEN_FAILED',
  'OWNER_NATIVE_PROCESS_EXITED', 'OWNER_NATIVE_BIRTH_UNPROVEN', 'OWNER_NATIVE_BIRTH_MISMATCH',
  'OWNER_NATIVE_IMAGE_UNPROVEN', 'OWNER_NATIVE_IMAGE_MISMATCH', 'OWNER_IMAGE_HASH_UNPROVEN',
  'OWNER_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN',
  'OWNER_OBSERVER_TIMEOUT', 'OWNER_OBSERVER_FAILED', 'OWNER_OBSERVER_INVALID_RECEIPT',
]);

export function sovereignControlSystemOwnerDiagnosticCodeV1(value) {
  return typeof value === 'string' && OWNER_DIAGNOSTIC_CODES.has(value)
    ? value : 'OWNER_OBSERVER_INVALID_RECEIPT';
}

// Qualification-only refusal detail. Keep this separate from the general
// blocker vocabulary: a typed inspection failure is never runtime authority.
// Includes two source-declared defensive labels as coverage, not runtime facts.
export const SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1 = Object.freeze([
  'BATTLE_BRIDGE_FIXED_GIT_CONFIG_INVALID',
  'CANONICAL_GIT_PROBE_CLEANUP_UNPROVEN',
  'CANONICAL_GIT_PROBE_CONTEXT_CHANGED',
  'CANONICAL_GIT_PROBE_CONTEXT_CLOSED',
  'CANONICAL_GIT_PROBE_CONTEXT_UNPROVEN',
  'CANONICAL_GIT_PROBE_DIRECTORY_UNPROVEN',
  'CANONICAL_GIT_PROBE_FILE_CHANGED',
  'CANONICAL_GIT_PROBE_FILE_UNPROVEN',
  'CANONICAL_GIT_PROBE_HEAD_UNSUPPORTED',
  'CANONICAL_GIT_PROBE_INDEX_TIMESTAMP_UNPROVEN',
  'CANONICAL_GIT_PROBE_INDEX_UNSUPPORTED',
  'CANONICAL_GIT_PROBE_ORIGINAL_CHANGED',
  'FIXED_RUNTIME_CANONICAL_SOURCE_EXPIRED',
  'FIXED_RUNTIME_EQUIVALENT_VERSION_AMBIGUOUS',
  'FIXED_RUNTIME_GIT_CLOSURE_CHANGED',
  'FIXED_RUNTIME_GIT_CLOSURE_UNPROVEN',
  'FIXED_RUNTIME_SOURCE_PROOF_BASE64',
  'FIXED_RUNTIME_SOURCE_PROOF_CLOSURE',
  'FIXED_RUNTIME_SOURCE_PROOF_COMMIT_HASH',
  'FIXED_RUNTIME_SOURCE_PROOF_COMMIT_TREE',
  'FIXED_RUNTIME_SOURCE_PROOF_CONTEXT',
  'FIXED_RUNTIME_SOURCE_PROOF_DEADLINE',
  'FIXED_RUNTIME_SOURCE_PROOF_HEAD_CHANGED',
  'FIXED_RUNTIME_SOURCE_PROOF_MEMBERSHIP',
  'FIXED_RUNTIME_SOURCE_PROOF_MEMBER_MODE',
  'FIXED_RUNTIME_SOURCE_PROOF_OBJECT',
  'FIXED_RUNTIME_SOURCE_PROOF_OBJECT_HASH',
  'FIXED_RUNTIME_SOURCE_PROOF_READ',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_ALIAS',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_BOUND',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_HASH',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_MODE',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_ORDER',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_PATH',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_SHAPE',
  'FIXED_RUNTIME_SOURCE_PROOF_TREE_UNUSED',
  'FIXED_RUNTIME_SOURCE_PROOF_UTF8',
  'FIXED_RUNTIME_SOURCE_PROOF_WIRE_BOUND',
  'FIXED_RUNTIME_SOURCE_PROOF_WIRE_SHAPE',
  'FIXED_RUNTIME_VERSION_DISCOVERY_BOUND',
  'FIXED_RUNTIME_VERSION_DISCOVERY_UNPROVEN',
  'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN',
  'RUNTIME_SOURCE_PROOF_BASE64',
  'RUNTIME_SOURCE_PROOF_CLOSURE',
  'RUNTIME_SOURCE_PROOF_COMMIT_HASH',
  'RUNTIME_SOURCE_PROOF_COMMIT_TREE',
  'RUNTIME_SOURCE_PROOF_LEGACY_MANIFEST',
  'RUNTIME_SOURCE_PROOF_MEMBERSHIP',
  'RUNTIME_SOURCE_PROOF_MEMBER_CHANGED',
  'RUNTIME_SOURCE_PROOF_PROTECTED_CLOSURE_CHANGED',
  'RUNTIME_SOURCE_PROOF_TREE_ALIAS',
  'RUNTIME_SOURCE_PROOF_TREE_BOUND',
  'RUNTIME_SOURCE_PROOF_TREE_HASH',
  'RUNTIME_SOURCE_PROOF_TREE_MODE',
  'RUNTIME_SOURCE_PROOF_TREE_ORDER',
  'RUNTIME_SOURCE_PROOF_TREE_PATH',
  'RUNTIME_SOURCE_PROOF_TREE_SHAPE',
  'RUNTIME_SOURCE_PROOF_TREE_UNUSED',
  'RUNTIME_SOURCE_PROOF_WIRE_BOUND',
  'RUNTIME_SOURCE_PROOF_WIRE_SHAPE',
]);
const QUALIFICATION_DIAGNOSTIC_CODES = new Set(SOVEREIGN_CONTROL_SYSTEM_QUALIFICATION_DIAGNOSTIC_CODES_V1);

export function sovereignControlSystemQualificationDiagnosticCodeV1(value) {
  return typeof value === 'string' && QUALIFICATION_DIAGNOSTIC_CODES.has(value) ? value : '';
}

export const SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1 = Object.freeze([
  'PHASE', 'OVERRIDE', 'LOAD', 'COOLDOWN', 'ACTIVE', 'FLAT_GAME', 'AIR_LINK',
  'REAL_AIR_LINK', 'VIRTUAL_AIR_LINK', 'PREPARE_LEASE', 'LOCAL_MODEL', 'HEAVY_MODEL',
]);

// Retain the original admission sample through at most 15 seconds of diagnostic
// return time after its existing 30-second freshness check. This grants no
// admission, and historical reprojection compares original times, never now.
export function projectSovereignControlSystemGovernorPermissionV1(value, nativeObservedAtUtc) {
  try {
    const row = record(value), observedAtUtc = utc(row.observedAtUtc), nativeTime = utc(nativeObservedAtUtc);
    if (Object.keys(row).sort().join(',') !== 'failed,observedAtUtc' || !observedAtUtc || !nativeTime)
      return null;
    const age = Date.parse(nativeTime) - Date.parse(observedAtUtc);
    const labels = row.failed, predicates = SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_PERMISSION_PREDICATES_V1;
    if (age < 0 || age > 45000 || !Array.isArray(labels) || Object.getPrototypeOf(labels) !== Array.prototype
      || labels.length < 1 || labels.length > predicates.length || Reflect.ownKeys(labels).length !== labels.length + 1)
      return null;
    const descriptors = Object.getOwnPropertyDescriptors(labels), failed = [];
    let previous = -1;
    for (let index = 0; index < labels.length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
      const position = predicates.indexOf(descriptor.value);
      if (position <= previous) return null;
      previous = position;
      failed.push(descriptor.value);
    }
    return Object.freeze({ observedAtUtc, failed: Object.freeze(failed) });
  } catch { return null; }
}

// Deliberately closed: an uppercase exception message is not public telemetry.
const CODES = new Set([
  UNKNOWN,
  'SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID',
  'SOVEREIGN_CONTROL_SYSTEM_TEST_DEPENDENCIES_FORBIDDEN',
  'SOVEREIGN_CONTROL_SYSTEM_WINDOWS_REQUIRED',
  'SOVEREIGN_CONTROL_SYSTEM_CANONICAL_SCRIPT_REQUIRED',
  'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_MAIN_REQUIRED',
  'SOVEREIGN_CONTROL_SYSTEM_EXPECTED_MAIN_MISMATCH',
  'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED',
  'SOVEREIGN_CONTROL_SYSTEM_CALLER_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_OWNER_CHANGED',
  'SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_HEALTH_BOUND_EXCEEDED',
  'SOVEREIGN_CONTROL_SYSTEM_HEALTH_IDENTITY_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN', 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_TIMEOUT',
  'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_BOUND_EXCEEDED', 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED',
  'SOVEREIGN_CONTROL_SYSTEM_LEDGER_UNPROVEN',
  'SOVEREIGN_CONTROL_SYSTEM_REQUEST_NOT_OBSERVED',
  'SOVEREIGN_CONTROL_SYSTEM_STATUS_INVALID',
  'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED',
  'MAINTENANCE_MIGRATION_OWNER_UNPROVEN',
  'LIVE_MAINTENANCE_CUSTODY_UNPROVEN',
  'MAINTENANCE_CUSTODY_HELD', 'MAINTENANCE_CUSTODY_STATE_MISSING',
  'MAINTENANCE_CUSTODY_STATE_UNPROVEN', 'MAINTENANCE_CUSTODY_RESERVED',
  'MAINTENANCE_CUSTODY_RESERVATION_UNPROVEN', 'MAINTENANCE_CUSTODY_RELEASE_UNPROVEN',
  'MAINTENANCE_CUSTODY_NOT_OWNED', 'MAINTENANCE_CUSTODY_OWNER_CHANGED',
  'MAINTENANCE_CUSTODY_JOURNAL_CAPACITY_UNAVAILABLE',
  'MAINTENANCE_OS_JOURNAL_CAPACITY_UNAVAILABLE',
  'MAINTENANCE_NATIVE_ROOT_UNPROVEN', 'MAINTENANCE_NATIVE_TERMINAL_UNPROVEN',
  'MAILBOX_EXECUTION_LEDGER_DIRECTORY_UNSAFE',
  'MAILBOX_EXECUTION_LEDGER_REQUEST_INVALID',
  'MAILBOX_EXECUTION_LEDGER_ENTRY_UNSAFE', 'MAILBOX_EXECUTION_LEDGER_ENTRY_INVALID',
  'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE', 'SOVEREIGN_MAINTENANCE_OWNER_BUSY',
  'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_FAILED',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_SPAWN_FAILED',
  'SOVEREIGN_COMMANDER_REPAIR_REPORT_MISSING',
  'SOVEREIGN_COMMANDER_REPAIR_REPORT_PUBLICATION_FAILED',
  'SOVEREIGN_CONTINUOUS_FIXED_COMMAND_NOT_ADMITTED',
  'SOVEREIGN_CONTINUOUS_NATIVE_FALLBACK_FORBIDDEN',
  'SOVEREIGN_CONTINUOUS_MAINTENANCE_CANCELLED',
  'SOVEREIGN_CONTINUOUS_MAINTENANCE_UNPROVEN',
  'SOVEREIGN_QUALIFIED_MAINTENANCE_BLOCKED',
  'SOVEREIGN_QUALIFIED_MAINTENANCE_REPORT_UNPROVEN',
  'FIXED_RUNTIME_WINDOWS_REQUIRED', 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',
  'FIXED_RUNTIME_FILE_UNPROVEN', 'FIXED_RUNTIME_CANONICAL_BRANCH_REQUIRED',
  'FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN', 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
  'FIXED_RUNTIME_PARENT_REDIRECTION', 'FIXED_RUNTIME_PROTECTION_UNPROVEN',
  'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN', 'FIXED_RUNTIME_REPORT_BOUND',
  'FIXED_RUNTIME_REPORT_SHAPE', 'FIXED_RUNTIME_IDENTITY_INSPECTION_UNPROVEN',
  'FIXED_RUNTIME_IDENTITY_INSPECTION_TIMEOUT', 'FIXED_RUNTIME_INSPECTOR_NOT_FOUND',
  'FIXED_RUNTIME_AUTHENTICATED_IDLE_UNPROVEN', 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN',
  'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED', 'FIXED_RUNTIME_PROFILE_NOT_COMPILED',
  'FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED', 'FIXED_RUNTIME_EXACT_RESERVATION_REQUIRED',
  'FIXED_RUNTIME_OPERATION_CANCELLED', 'FIXED_RUNTIME_OPERATION_EVIDENCE_UNPROVEN',
  'FIXED_RUNTIME_TERMINAL_CUSTODY_UNPROVEN', 'FIXED_RUNTIME_TRANSPORT_UNPROVEN',
  'RUNTIME_NORMAL_OPERATOR_REQUIRED', 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN',
  'RUNTIME_WINDOWS_BOOT_UNPROVEN', 'RUNTIME_MACHINE_UNPROVEN',
  'RUNTIME_SOURCE_REF_CHANGED', 'RUNTIME_SOURCE_MEMBER_CHANGED',
  'RUNTIME_SOURCE_MEMBER_UNPROVEN', 'RUNTIME_MANIFEST_CLOSURE_INCOMPLETE',
  'RUNTIME_MANIFEST_IDENTITY_UNPROVEN', 'RUNTIME_EMBEDDED_MANIFEST_UNPROVEN',
  'RUNTIME_HELPER_LOCATION_UNPROVEN', 'RUNTIME_HELPER_UNEXPECTED_CONTENT',
  'RUNTIME_PROTECTED_OWNER_UNPROVEN', 'RUNTIME_PROTECTED_WRITE_AUTHORITY_UNPROVEN',
  'RUNTIME_ANCESTOR_OWNER_UNPROVEN', 'RUNTIME_ANCESTOR_WRITE_AUTHORITY_UNPROVEN',
  'RUNTIME_FIXED_EXECUTABLE_CHANGED', 'RUNTIME_FIXED_EXECUTABLE_IDENTITY_UNPROVEN',
  'RUNTIME_JOURNAL_MAPPING_UNPROVEN', 'RUNTIME_JOURNAL_OWNER_UNPROVEN',
  'RUNTIME_JOURNAL_MUTATION_AUTHORITY_UNPROVEN', 'RUNTIME_JOURNAL_RETENTION_UNPROVEN',
  'RUNTIME_JOURNAL_ACCESS_UNPROVEN', 'RUNTIME_JOURNAL_BOOTSTRAP_UNPROVEN',
  'RUNTIME_NATIVE_ANCHOR_MISSING', 'RUNTIME_NATIVE_ANCHOR_MALFORMED',
  'RUNTIME_NATIVE_ANCHOR_SCAN_EXHAUSTED', 'RUNTIME_NATIVE_ANCHOR_AUTHENTICATION_FAILED',
  'RUNTIME_CUSTODY_RECORD_AUTHENTICATION_FAILED', 'RUNTIME_CUSTODY_RECORD_SCHEMA_UNPROVEN',
  'RUNTIME_CUSTODY_PHASE_UNPROVEN', 'RUNTIME_CUSTODY_BOOT_UNPROVEN',
  'RUNTIME_CUSTODY_TERMINAL_UNPROVEN',
]);

export function sovereignControlSystemDiagnosticCodeV1(value, fallback = UNKNOWN) {
  return value === '' ? '' : typeof value === 'string' && CODES.has(value) ? value
    : CODES.has(fallback) ? fallback : UNKNOWN;
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return {};
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64 || keys.some(key => typeof key !== 'string')) return {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !Object.hasOwn(descriptors[key], 'value'))) return {};
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function utc(value) {
  if (typeof value !== 'string' || value.length > 32
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) return '';
  const time = Date.parse(value);
  const normalized = Number.isFinite(time) ? new Date(time).toISOString() : '';
  return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : '';
}

function frozen(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') Object.freeze(child);
  return Object.freeze(value);
}

function refusal(blocker, observedAtUtc = '') {
  return Object.freeze({ schemaVersion: SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1,
    ...(observedAtUtc ? { observedAtUtc } : {}), observationOnly: true, observationCompleted: false, blocker });
}

function base(value) {
  const row = record(value);
  return { row, result: { available: row.available === true,
    reason: sovereignControlSystemDiagnosticCodeV1(row.reason ?? (row.available === true ? '' : UNKNOWN)),
    ...(utc(row.observedAtUtc) ? { observedAtUtc: utc(row.observedAtUtc) } : {}) } };
}

function projectProtocol(value, source, owner) {
  const row = record(value), observedAtUtc = utc(row.observedAtUtc);
  const unavailable = reason => frozen({ available: false, matches: false,
    reason: sovereignControlSystemDiagnosticCodeV1(reason || 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN') });
  if (!source.available || !source.stable || source.expectedMainMatches === false)
    return unavailable(source.reason || 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
  if (!owner.available || !owner.stable) return unavailable(owner.reason || 'SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN');
  if (row.available !== true) return unavailable(row.reason);
  const labels = row.failedPredicates;
  if (!Array.isArray(labels) || Object.getPrototypeOf(labels) !== Array.prototype || labels.length > 6
    || Reflect.ownKeys(labels).length !== labels.length + 1) return unavailable();
  const failedPredicates = [];
  for (let index = 0; index < labels.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(labels, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string')
      return unavailable();
    failedPredicates.push(descriptor.value);
  }
  const canonical = SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_PREDICATES_V1.filter(label => failedPredicates.includes(label));
  const observedVersion = row.observedVersion;
  if (canonical.length !== failedPredicates.length || canonical.some((label, index) => label !== failedPredicates[index])
    || row.expectedVersion !== SOVEREIGN_MAINTENANCE_OWNER_VERSION
    || ![SOVEREIGN_MAINTENANCE_OWNER_VERSION, 'MISSING', 'OTHER', 'INVALID'].includes(observedVersion)
    || failedPredicates.includes('OWNER_VERSION') !== (observedVersion !== SOVEREIGN_MAINTENANCE_OWNER_VERSION)
    || !observedAtUtc || Date.parse(observedAtUtc) > Date.parse(owner.observedAtUtc)
    || Date.parse(owner.observedAtUtc) - Date.parse(observedAtUtc) > 15000
    || row.reason !== (failedPredicates.length ? 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED' : ''))
    return unavailable();
  return frozen({ available: true, matches: failedPredicates.length === 0,
    failedPredicates: Object.freeze(failedPredicates), expectedVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION,
    observedVersion, observedAtUtc, reason: row.reason });
}

function projectGovernorObservation(value, source, inspectionStartedAtUtc) {
  const row = record(value);
  const unavailable = reason => frozen({ available: false,
    reason: sovereignControlSystemGovernorObservationCodeV1(reason),
    readOnly: true, diagnosticOnly: true, executionAuthority: false });
  if (!source.available || !source.stable || source.reason !== '' || source.expectedMainMatches === false)
    return unavailable(source.reason || 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
  const keys = Object.keys(row).sort().join(',');
  if (row.readOnly !== true || row.diagnosticOnly !== true || row.executionAuthority !== false)
    return unavailable('SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID');
  if (row.available === false) {
    return keys === 'available,diagnosticOnly,executionAuthority,readOnly,reason'
      ? unavailable(row.reason) : unavailable('SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID');
  }
  const observedAtUtc = utc(row.observedAtUtc);
  // The producer samples immediately after its initial source read and verifies
  // the child's actual start/end window. This relative bound preserves original
  // time during historical reprojection; it never refreshes permission or truth.
  if (keys !== 'available,diagnosticOnly,executionAuthority,observedAtUtc,overrideMode,preparePending,readOnly,signalActive'
    || row.available !== true || !observedAtUtc
    || Date.parse(observedAtUtc) < Date.parse(inspectionStartedAtUtc)
    || Date.parse(observedAtUtc) - Date.parse(inspectionStartedAtUtc) > 30000
    || typeof row.signalActive !== 'boolean' || typeof row.preparePending !== 'boolean'
    || !['AUTO', 'FORCE_ON', 'FORCE_OFF'].includes(row.overrideMode))
    return unavailable('SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID');
  return frozen({ available: true, observedAtUtc,
    signalActive: row.signalActive, overrideMode: row.overrideMode, preparePending: row.preparePending,
    readOnly: true, diagnosticOnly: true, executionAuthority: false });
}

// Accepts an inspection or an already-public receipt. Re-projecting a valid
// public receipt is idempotent, so ledger/beacon/chat share this single boundary.
export function projectSovereignControlSystemStatusV1(value) {
  try {
    const input = record(value), observedAtUtc = utc(input.observedAtUtc);
    if (![SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1, SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1]
      .includes(input.schemaVersion) || input.observationOnly !== true || !observedAtUtc)
      return refusal('SOVEREIGN_CONTROL_SYSTEM_STATUS_INVALID');
    if (input.schemaVersion === SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1
      && ['SOVEREIGN_CONTROL_SYSTEM_STATUS_INVALID', 'SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED']
        .includes(input.blocker)) return refusal(input.blocker, observedAtUtc);

    const s = base(input.source), c = base(input.caller), o = base(input.owner);
    const g = base(input.guardian), n = base(input.nativeRuntime), l = record(input.requestLedger);
    const sourceHead = typeof s.row.sourceHead === 'string' && SHA.test(s.row.sourceHead) ? s.row.sourceHead : '';
    const expectedMain = typeof s.row.expectedMain === 'string' && SHA.test(s.row.expectedMain) ? s.row.expectedMain : '';
    const source = { available: s.result.available && Boolean(sourceHead),
      ...(sourceHead ? { sourceHead } : {}), ...(expectedMain ? { expectedMain,
        expectedMainMatches: sourceHead === expectedMain } : {}),
      stable: s.result.available && Boolean(sourceHead) && s.row.stable === true,
      loadedSourceBytesProven: false, remoteMainProven: false, reason: s.result.reason };
    const caller = { ...c.result, available: c.result.available && typeof c.row.administratorEnabled === 'boolean',
      ...(c.result.available && typeof c.row.administratorEnabled === 'boolean'
        ? { administratorEnabled: c.row.administratorEnabled } : {}) };
    const owner = { ...o.result, available: o.result.available && Boolean(o.result.observedAtUtc),
      stable: o.result.available && Boolean(o.result.observedAtUtc) && o.row.stable === true,
      ...(Object.hasOwn(o.row, 'diagnosticCode') && o.row.available === false && o.row.stable === false
        && o.result.reason === 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN'
        && source.available && source.stable && source.reason === '' && source.expectedMainMatches !== false
        ? { diagnosticCode: sovereignControlSystemOwnerDiagnosticCodeV1(o.row.diagnosticCode) } : {}) };
    const guardianValid = g.result.available && owner.available && owner.stable
      && ['enabled', 'running', 'scheduled', 'maintenanceInFlight'].every(key => typeof g.row[key] === 'boolean')
      && ['HELD', 'NOT_HELD_REPORTED', 'UNKNOWN'].includes(g.row.custodyState);
    const guardian = { available: guardianValid,
      ...(guardianValid ? Object.fromEntries(['enabled', 'running', 'scheduled', 'maintenanceInFlight', 'custodyState']
        .map(key => [key, g.row[key]])) : {}),
      blocker: sovereignControlSystemDiagnosticCodeV1(g.row.blocker ?? g.result.reason),
      ...(typeof g.row.sourceHead === 'string' && SHA.test(g.row.sourceHead) ? { sourceHead: g.row.sourceHead } : {}),
      ...(g.result.observedAtUtc ? { observedAtUtc: g.result.observedAtUtc } : {}) };
    const profilesValid = Array.isArray(n.row.profiles) && n.row.profiles.length <= PROFILES.size
      && n.row.profiles.every(profile => typeof profile === 'string' && PROFILES.has(profile))
      && new Set(n.row.profiles).size === n.row.profiles.length;
    const nativeHead = typeof n.row.sourceHead === 'string' && SHA.test(n.row.sourceHead) ? n.row.sourceHead : '';
    const qualificationObserved = n.result.available && n.row.qualificationObserved === true
      && Boolean(nativeHead && n.result.observedAtUtc) && nativeHead === sourceHead
      && source.available && profilesValid && n.result.reason === '';
    const nativeDenial = n.result.available && n.row.qualificationObserved === false
      && typeof n.row.reason === 'string' && CODES.has(n.row.reason) && Boolean(n.result.observedAtUtc);
    // Keep historical receipts byte-identical when this optional leaf was absent.
    const governorHoldCode = nativeDenial && n.row.reason === 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD'
      && source.available && source.stable && source.reason === '' && (!expectedMain || expectedMain === sourceHead)
      && Object.hasOwn(n.row, 'governorHoldCode')
      ? sovereignControlSystemGovernorHoldCodeV1(n.row.governorHoldCode) : '';
    const governorPermission = governorHoldCode === 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED'
      && (!Object.hasOwn(n.row, 'sourceHead') || nativeHead === sourceHead)
      && Object.hasOwn(n.row, 'governorPermission')
      ? projectSovereignControlSystemGovernorPermissionV1(n.row.governorPermission, n.result.observedAtUtc) : null;
    const qualificationDiagnosticCode = nativeDenial && n.row.reason === 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN'
      && source.available && source.stable && source.reason === ''
      && (!Object.hasOwn(s.row, 'expectedMain') || expectedMain === sourceHead)
      && (!Object.hasOwn(n.row, 'sourceHead') || nativeHead === sourceHead)
      && Object.hasOwn(n.row, 'qualificationDiagnosticCode')
      ? sovereignControlSystemQualificationDiagnosticCodeV1(n.row.qualificationDiagnosticCode) : '';
    const nativeRuntime = { ...n.result, available: qualificationObserved || nativeDenial, qualificationObserved,
      ...(governorHoldCode ? { governorHoldCode } : {}),
      ...(governorPermission ? { governorPermission } : {}),
      ...(qualificationDiagnosticCode ? { qualificationDiagnosticCode } : {}),
      ...(nativeHead ? { sourceHead: nativeHead } : {}),
      ...(qualificationObserved ? { profiles: Object.freeze([...n.row.profiles]) } : {}),
      ...(utc(n.row.bootStartedAtUtc) && n.result.observedAtUtc
        && Date.parse(n.row.bootStartedAtUtc) <= Date.parse(n.result.observedAtUtc)
        ? { bootStartedAtUtc: utc(n.row.bootStartedAtUtc) } : {}) };
    if (n.row.qualificationObserved === true && !qualificationObserved && nativeRuntime.reason === '')
      nativeRuntime.reason = 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN';
    const phaseValid = ['RESERVED', 'TERMINAL', 'RETIRED'].includes(l.phase);
    const terminalValid = l.phase !== 'TERMINAL' || ['DONE', 'BLOCKED'].includes(l.terminalState);
    const requestLedger = { requested: l.requested === true,
      recordObserved: l.requested === true && l.recordObserved === true && phaseValid && terminalValid,
      ...(l.requested === true && l.recordObserved === true && phaseValid && terminalValid ? {
        phase: l.phase, ...(l.phase === 'TERMINAL' ? { terminalState: l.terminalState } : {}) } : {}),
      relayWorkspaceIdentityProven: false,
      reason: sovereignControlSystemDiagnosticCodeV1(l.reason ?? '') };
    const projected = frozen({ schemaVersion: SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1,
      observedAtUtc, observationOnly: true,
      observationCompleted: input.observationCompleted === true && source.available && source.stable
        && (!expectedMain || sourceHead === expectedMain)
        && (nativeRuntime.available || guardian.available),
      blocker: sovereignControlSystemDiagnosticCodeV1(input.blocker ?? ''),
      source: frozen(source), caller: frozen(caller), owner: frozen(owner), guardian: frozen(guardian),
      nativeRuntime: frozen(nativeRuntime), requestLedger: frozen(requestLedger),
      // Historical receipt hashes remain unchanged when no protocol leaf existed.
      ...(Object.hasOwn(input, 'protocol') ? { protocol: projectProtocol(input.protocol, source, owner) } : {}),
      ...(Object.hasOwn(input, 'governorObservation') ? {
        governorObservation: projectGovernorObservation(input.governorObservation, source, observedAtUtc),
      } : {}) });
    if (new TextEncoder().encode(JSON.stringify(projected)).byteLength > SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1)
      return refusal('SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED', observedAtUtc);
    return projected;
  } catch { return refusal('SOVEREIGN_CONTROL_SYSTEM_STATUS_INVALID'); }
}
