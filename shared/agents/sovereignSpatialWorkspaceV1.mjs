// One bounded preparation action in the existing Commander. These flags are
// evidence: false means unproved, not proof that a component is absent.
export const SPATIAL_PREPARE_ACTION = 'prepare-spatial-workspace';
export const SPATIAL_PREPARE_SCHEMA = 'stephanos.spatial-workspace-readiness.v1';
export const SPATIAL_PREPARE_MARKER = 'SOVEREIGN_SPATIAL_WORKSPACE_RESULT=';
export const SPATIAL_PREPARE_MAX_OUTPUT_BYTES = 8192;
export const SPATIAL_PREPARE_TIMEOUT_MS = 210000;
export const SPATIAL_PREPARE_FLAGS = Object.freeze([
  'installationVerified', 'uiReady', 'helperProbePassed', 'nativeProbePassed',
  'existingHostPreserved', 'createdProbeStopped', 'hostRunningAfter',
  'mutationAttempted', 'readyForOperatorLaunch', 'interactiveAcceptance',
  'voiceAcceptance', 'headsetAcceptance',
]);
export const SPATIAL_PREPARE_BLOCKERS = Object.freeze([
  'SPATIAL_PREPARE_PLATFORM_UNSUPPORTED', 'SPATIAL_PREPARE_EXPECTED_HEAD_INVALID',
  'SPATIAL_PREPARE_OPERATOR_CONTEXT_REQUIRED', 'SPATIAL_PREPARE_SOURCE_MISMATCH',
  'SPATIAL_PREPARE_SOURCE_UNPROVEN', 'SPATIAL_PREPARE_LOCK_BUSY',
  'SPATIAL_PREPARE_NODE_MISSING', 'SPATIAL_PREPARE_COMPILER_MISSING',
  'SPATIAL_PREPARE_SDK_MISSING', 'SPATIAL_PREPARE_INSTALLATION_INVALID',
  'SPATIAL_PREPARE_INSTALL_FAILED', 'SPATIAL_PREPARE_PORT_OCCUPIED',
  'SPATIAL_PREPARE_HOST_IDENTITY_UNPROVEN', 'SPATIAL_PREPARE_HOST_START_FAILED',
  'SPATIAL_PREPARE_HOST_HEALTH_UNPROVEN', 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED',
  'SPATIAL_PREPARE_UI_UNAVAILABLE', 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN',
  'SPATIAL_PREPARE_GAMING_HOLD', 'SPATIAL_PREPARE_RECEIPT_INVALID',
  'SPATIAL_PREPARE_EXECUTION_FAILED', 'SPATIAL_PREPARE_FAILED',
]);
const blockers = new Set(SPATIAL_PREPARE_BLOCKERS);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const fields = Object.freeze([
  'schemaVersion', 'actionId', 'sourceHead', 'buildId', 'ok', 'blocker',
  ...SPATIAL_PREPARE_FLAGS,
]);
const readyFlags = Object.freeze([
  'installationVerified', 'uiReady', 'helperProbePassed', 'nativeProbePassed',
  'createdProbeStopped', 'readyForOperatorLaunch', 'mutationAttempted',
]);

export function spatialPrepareBlockedV1(expectedMain, blocker, { mutationAttempted = false } = {}) {
  return Object.freeze({
    schemaVersion: SPATIAL_PREPARE_SCHEMA,
    actionId: SPATIAL_PREPARE_ACTION,
    // Request/source binding; a failed record is never installed-head evidence.
    sourceHead: typeof expectedMain === 'string' && SHA40.test(expectedMain) ? expectedMain : '',
    buildId: '', ok: false,
    blocker: blockers.has(blocker) ? blocker : 'SPATIAL_PREPARE_FAILED',
    ...Object.fromEntries(SPATIAL_PREPARE_FLAGS.map(key => [key, false])),
    mutationAttempted: mutationAttempted === true,
    createdProbeStopped: mutationAttempted !== true && blocker !== 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN',
  });
}

export function projectSpatialPreparationReceiptV1(value, expectedMain) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !SHA40.test(expectedMain ?? '')
      || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')
      || value.schemaVersion !== SPATIAL_PREPARE_SCHEMA
      || value.actionId !== SPATIAL_PREPARE_ACTION || value.sourceHead !== expectedMain
      || typeof value.ok !== 'boolean' || typeof value.blocker !== 'string'
      || typeof value.buildId !== 'string' || (value.buildId !== '' && !SHA64.test(value.buildId))
      || SPATIAL_PREPARE_FLAGS.some(key => typeof value[key] !== 'boolean')
      || value.interactiveAcceptance !== false || value.voiceAcceptance !== false
      || value.headsetAcceptance !== false
      || value.ok !== value.readyForOperatorLaunch
      || (value.installationVerified && !SHA64.test(value.buildId))
      || (value.nativeProbePassed && !value.installationVerified)
      || (value.helperProbePassed && !value.installationVerified)
      || (value.blocker === 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN' && value.createdProbeStopped)
      || value.hostRunningAfter !== value.existingHostPreserved) return null;
  if (value.ok) {
    if (value.blocker !== '' || readyFlags.some(key => value[key] !== true) || value.existingHostPreserved) return null;
  } else if (!blockers.has(value.blocker)) return null;
  // A closed projection prevents process identities, window titles, paths,
  // raw compiler output and exception strings becoming public mailbox data.
  return Object.freeze(Object.fromEntries(fields.map(key => [key, value[key]])));
}

export function parseSpatialPreparationOutputV1(stdout, expectedMain) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > SPATIAL_PREPARE_MAX_OUTPUT_BYTES) return null;
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length !== 1 || !lines[0].startsWith(SPATIAL_PREPARE_MARKER)) return null;
  const raw = lines[0].slice(SPATIAL_PREPARE_MARKER.length);
  try {
    const parsed = JSON.parse(raw);
    // Reject duplicate keys, ambiguous whitespace/number encodings and hidden
    // records instead of accepting whichever JSON value happened to win.
    if (JSON.stringify(parsed) !== raw) return null;
    return projectSpatialPreparationReceiptV1(parsed, expectedMain);
  } catch { return null; }
}

export function parseSpatialPreparationArgumentsV1(args) {
  return Array.isArray(args) && args.length === 2 && args[0] === '--expected-main'
    && typeof args[1] === 'string' && SHA40.test(args[1])
    ? Object.freeze({ ok: true, expectedMain: args[1] })
    : Object.freeze({ ok: false, expectedMain: '', blocker: 'SPATIAL_PREPARE_EXPECTED_HEAD_INVALID' });
}

// This coordinator cannot grant native authority. The existing maintenance
// owner and compiled profile supply physical custody before invoking the CLI.
export async function runSpatialPreparationV1({
  expectedMain, platform = process.platform, observeSource, gamingAdmission,
  runWindowsPreparation,
} = {}) {
  const denied = (blocker, options) => spatialPrepareBlockedV1(expectedMain, blocker, options);
  if (typeof expectedMain !== 'string' || !SHA40.test(expectedMain)) return denied('SPATIAL_PREPARE_EXPECTED_HEAD_INVALID');
  if (platform !== 'win32') return denied('SPATIAL_PREPARE_PLATFORM_UNSUPPORTED');
  let source;
  try { source = await observeSource(); }
  catch { return denied('SPATIAL_PREPARE_SOURCE_UNPROVEN'); }
  if (source?.ok !== true || source?.head !== expectedMain || source?.branch !== 'main') return denied('SPATIAL_PREPARE_SOURCE_MISMATCH');
  try {
    if ((await gamingAdmission())?.ok !== true) return denied('SPATIAL_PREPARE_GAMING_HOLD');
  } catch { return denied('SPATIAL_PREPARE_GAMING_HOLD'); }
  let execution;
  try { execution = await runWindowsPreparation(expectedMain); }
  catch { return denied('SPATIAL_PREPARE_EXECUTION_FAILED', { mutationAttempted: true }); }
  if (execution?.error || execution?.signal || !Number.isInteger(execution?.status)) {
    return denied('SPATIAL_PREPARE_EXECUTION_FAILED', { mutationAttempted: true });
  }
  const receipt = parseSpatialPreparationOutputV1(execution.stdout, expectedMain);
  if (!receipt || execution.status !== (receipt.ok ? 0 : 2)) {
    return denied('SPATIAL_PREPARE_RECEIPT_INVALID', { mutationAttempted: true });
  }
  return receipt;
}
