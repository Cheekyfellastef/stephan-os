// One public, observation-only projection for the existing Control Tower receipt.
// This module has no native imports, credentials, persistence or execution path.
export const SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1 = 'stephanos.sovereign-control-system-inspection.v1';
export const SOVEREIGN_CONTROL_SYSTEM_STATUS_SCHEMA_V1 = 'stephanos.sovereign-control-system-status.v1';
export const SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1 = 2048;

const SHA = /^[a-f0-9]{40}$/;
const PROFILES = new Set(['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1']);
const UNKNOWN = 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN';
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
      stable: o.result.available && Boolean(o.result.observedAtUtc) && o.row.stable === true };
    const guardianValid = g.result.available && owner.available && owner.stable
      && ['enabled', 'running', 'scheduled', 'maintenanceInFlight'].every(key => typeof g.row[key] === 'boolean')
      && ['HELD', 'NOT_HELD_REPORTED', 'UNKNOWN'].includes(g.row.custodyState);
    const guardian = { available: guardianValid,
      ...(guardianValid ? Object.fromEntries(['enabled', 'running', 'scheduled', 'maintenanceInFlight', 'custodyState']
        .map(key => [key, g.row[key]])) : {}),
      blocker: sovereignControlSystemDiagnosticCodeV1(g.row.blocker ?? g.result.reason),
      ...(typeof g.row.sourceHead === 'string' && SHA.test(g.row.sourceHead) ? { sourceHead: g.row.sourceHead } : {}),
      ...(g.result.observedAtUtc ? { observedAtUtc: g.result.observedAtUtc } : {}) };
    const profilesValid = Array.isArray(n.row.profiles) && n.row.profiles.length <= 2
      && n.row.profiles.every(profile => typeof profile === 'string' && PROFILES.has(profile))
      && new Set(n.row.profiles).size === n.row.profiles.length;
    const nativeHead = typeof n.row.sourceHead === 'string' && SHA.test(n.row.sourceHead) ? n.row.sourceHead : '';
    const qualificationObserved = n.result.available && n.row.qualificationObserved === true
      && Boolean(nativeHead && n.result.observedAtUtc) && nativeHead === sourceHead
      && source.available && profilesValid && n.result.reason === '';
    const nativeDenial = n.result.available && n.row.qualificationObserved === false
      && typeof n.row.reason === 'string' && CODES.has(n.row.reason) && Boolean(n.result.observedAtUtc);
    const nativeRuntime = { ...n.result, available: qualificationObserved || nativeDenial, qualificationObserved,
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
      nativeRuntime: frozen(nativeRuntime), requestLedger: frozen(requestLedger) });
    if (new TextEncoder().encode(JSON.stringify(projected)).byteLength > SOVEREIGN_CONTROL_SYSTEM_STATUS_MAX_BYTES_V1)
      return refusal('SOVEREIGN_CONTROL_SYSTEM_STATUS_BOUND_EXCEEDED', observedAtUtc);
    return projected;
  } catch { return refusal('SOVEREIGN_CONTROL_SYSTEM_STATUS_INVALID'); }
}
