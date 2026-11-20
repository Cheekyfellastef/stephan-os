#!/usr/bin/env node
// Fixed observation of the existing owner and native inspector. No execution,
// installation, recovery, reservation, release or restart API is imported.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMaintenanceNativeOwnerV2 } from './sovereign-maintenance-owner-observation-v2.mjs';
import { inspectFixedRuntimeQualificationV1 } from './sovereign-fixed-runtime-parent-v1.mjs';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { createBattleBridgeMinimalChildEnvironment, resolveBattleBridgeGitExecution }
  from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { projectMaintenanceCustodyVisibilityV1 } from '../shared/agents/maintenanceCustodyVisibilityV1.mjs';
import { SOVEREIGN_MAINTENANCE_OWNER_VERSION } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1,
  SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_PREDICATES_V1,
  sovereignControlSystemGovernorHoldCodeV1,
  sovereignControlSystemGovernorObservationCodeV1,
  sovereignControlSystemOwnerDiagnosticCodeV1,
  projectSovereignControlSystemGovernorPermissionV1,
  sovereignControlSystemDiagnosticCodeV1 } from '../shared/agents/sovereignControlSystemStatusV1.mjs';

const REPOSITORY = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const GOVERNOR_PATH = 'scripts/windows/run-vr-resource-governor.ps1';
const GOVERNOR_SOURCE_LIMIT = 128 * 1024;
// One canonical-base64 record plus its newline; read one sentinel character.
const GOVERNOR_INPUT_CHAR_LIMIT = 4 * Math.ceil(GOVERNOR_SOURCE_LIMIT / 3) + 1;
const GOVERNOR_INVALID = 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_INVALID';
const GOVERNOR_SOURCE_UNPROVEN = 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_SOURCE_UNPROVEN';
const GOVERNOR_TIMEOUT = 'SOVEREIGN_CONTROL_SYSTEM_GOVERNOR_OBSERVATION_TIMEOUT';
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^control-tower-(?:build|comment)-[1-9][0-9]{0,15}-1$/;
// Closed compiled inventory only; observing a name grants no action admission.
const PROFILES = new Set(['MAINTENANCE_GOAL_BUILDER_V1', 'SOURCE_TASK_V1',
  'SPATIAL_WORKSPACE_PREPARE_V1', 'CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1']);
const UNKNOWN = 'SOVEREIGN_CONTROL_SYSTEM_OBSERVATION_UNPROVEN';
const fail = code => { throw new Error(code); };
const diagnosticCode = (error, fallback = UNKNOWN) =>
  sovereignControlSystemDiagnosticCodeV1(error?.message, fallback);

function dataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
  const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length > 64
    || keys.some(key => typeof key !== 'string')) fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !Object.hasOwn(descriptors[key], 'value'))) fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function utc(value) {
  if (typeof value !== 'string' || value.length > 32
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)) return '';
  const normalized = Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : '';
  return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : '';
}

function instant(now) {
  const value = now();
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(time)) fail(UNKNOWN);
  return new Date(time).toISOString();
}

function freezeReport(report) {
  for (const child of Object.values(report)) if (child && typeof child === 'object') {
    for (const nested of Object.values(child)) if (nested && typeof nested === 'object') Object.freeze(nested);
    Object.freeze(child);
  }
  return Object.freeze(report);
}

function emptyReport() {
  return { schemaVersion: SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1,
    observedAtUtc: new Date().toISOString(), observationOnly: true, observationCompleted: false,
    blocker: '', source: { available: false, stable: false,
      loadedSourceBytesProven: false, remoteMainProven: false, reason: UNKNOWN },
    caller: { available: false, observationAppliesTo: 'DIAGNOSTIC_CALLER_ONLY', reason: UNKNOWN },
    owner: { available: false, stable: false, reason: UNKNOWN },
    protocol: { available: false, matches: false, reason: 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN' },
    guardian: { available: false, blocker: UNKNOWN },
    nativeRuntime: { available: false, qualificationObserved: false, reason: UNKNOWN },
    requestLedger: { requested: false, recordObserved: false, relayWorkspaceIdentityProven: false, reason: '' } };
}

function readCanonicalSourceHead() {
  if (win32.normalize(fileURLToPath(import.meta.url)).toLowerCase()
    !== win32.join(REPOSITORY, 'scripts', 'sovereign-commander-native-inspect.mjs').toLowerCase())
    fail('SOVEREIGN_CONTROL_SYSTEM_CANONICAL_SCRIPT_REQUIRED');
  for (const path of [REPOSITORY, join(REPOSITORY, '.git'), join(REPOSITORY, '.git', 'refs'),
    join(REPOSITORY, '.git', 'refs', 'heads')]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
  }
  const read = name => {
    const path = join(REPOSITORY, '.git', name), before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 256)
      fail('SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
    const fd = openSync(path, 'r');
    try {
      const opened = fstatSync(fd), bytes = Buffer.alloc(257);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > 256
        || before.dev !== opened.dev || before.ino !== opened.ino)
        fail('SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null);
        if (!count) break;
        size += count;
      }
      const after = lstatSync(path), finished = fstatSync(fd);
      if (size > 256 || before.dev !== after.dev || before.ino !== after.ino
        || before.mtimeMs !== after.mtimeMs || before.size !== after.size
        || opened.size !== finished.size || opened.mtimeMs !== finished.mtimeMs)
        fail('SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
      return bytes.subarray(0, size).toString('utf8').trim();
    } finally { closeSync(fd); }
  };
  if (read('HEAD') !== 'ref: refs/heads/main') fail('SOVEREIGN_CONTROL_SYSTEM_MAIN_REQUIRED');
  const head = read(join('refs', 'heads', 'main'));
  if (!SHA.test(head)) fail('SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
  return head;
}

function readCallerIdentity() {
  // Fixed read-only code lives in source; no caller-selected command is accepted.
  const script = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
[pscustomobject]@{schemaVersion='stephanos.sovereign-diagnostic-caller.v1';sid=$identity.User.Value;administratorEnabled=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);observedAtUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress`;
  const result = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { shell: false, windowsHide: true,
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096,
    env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }) });
  if (result.error || result.signal || result.status !== 0) fail('SOVEREIGN_CONTROL_SYSTEM_CALLER_UNPROVEN');
  try { return JSON.parse(result.stdout); } catch { fail('SOVEREIGN_CONTROL_SYSTEM_CALLER_UNPROVEN'); }
}

// The governor also owns mutating actions. Capture its one fixed source member
// through an authenticated commit/tree/blob chain, then invoke only the existing
// ObserveAdmission branch from immutable stdin bytes. Never execute a checkout
// filename after validating a separate read, or put the full script in argv.
function captureGovernorSource(expectedMain, run, monotonicNow, environment) {
  const git = resolveBattleBridgeGitExecution({ platform: 'win32', environment });
  const started = monotonicNow();
  let capturedBytes = 0;
  const object = (type, id, maximum) => {
    if (!SHA.test(id ?? '')) fail(GOVERNOR_SOURCE_UNPROVEN);
    const remaining = 10000 - (monotonicNow() - started);
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 10000) fail(GOVERNOR_TIMEOUT);
    const result = run(git.executable, [...git.fixedConfigArgs,
      `--git-dir=${win32.join(REPOSITORY, '.git')}`, `--work-tree=${REPOSITORY}`, 'cat-file', type, id],
    { cwd: REPOSITORY, env: git.environment, shell: false, windowsHide: true,
      timeout: Math.min(5000, Math.ceil(remaining)), maxBuffer: maximum });
    const elapsed = monotonicNow() - started;
    if (result?.error?.code === 'ETIMEDOUT' || elapsed > 10000) fail(GOVERNOR_TIMEOUT);
    if (!Number.isFinite(elapsed) || elapsed < 0 || result?.error || result?.status !== 0 || result?.signal
      || !Buffer.isBuffer(result.stdout) || result.stdout.length > maximum
      || (Buffer.isBuffer(result.stderr) ? result.stderr.length : result.stderr !== undefined && result.stderr !== ''))
      fail(GOVERNOR_SOURCE_UNPROVEN);
    const bytes = Buffer.from(result.stdout);
    capturedBytes += bytes.length;
    if (capturedBytes > 6 * 1024 * 1024
      || createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex') !== id)
      fail(GOVERNOR_SOURCE_UNPROVEN);
    return bytes;
  };
  let id = /^tree ([a-f0-9]{40})\n/.exec(object('commit', expectedMain, 65536).toString('utf8'))?.[1];
  const parts = GOVERNOR_PATH.split('/');
  for (let depth = 0; depth < parts.length; depth++) {
    const bytes = object('tree', id, 2 * 1024 * 1024), names = new Set();
    let selected;
    for (let offset = 0; offset < bytes.length;) {
      const space = bytes.indexOf(32, offset), nul = bytes.indexOf(0, space + 1);
      if (space <= offset || nul <= space + 1 || nul + 21 > bytes.length) fail(GOVERNOR_SOURCE_UNPROVEN);
      const mode = bytes.toString('ascii', offset, space);
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(space + 1, nul));
      if (!['40000', '100644', '100755', '120000', '160000'].includes(mode)
        || name === '.' || name === '..' || /[/\\]/.test(name) || names.has(name) || names.size >= 20000)
        fail(GOVERNOR_SOURCE_UNPROVEN);
      names.add(name);
      if (name === parts[depth]) selected = { mode, id: bytes.subarray(nul + 1, nul + 21).toString('hex') };
      offset = nul + 21;
    }
    if (!selected || selected.mode !== (depth === parts.length - 1 ? '100644' : '40000'))
      fail(GOVERNOR_SOURCE_UNPROVEN);
    id = selected.id;
  }
  const bytes = object('blob', id, GOVERNOR_SOURCE_LIMIT);
  if (!bytes.length || bytes.includes(0)) fail(GOVERNOR_SOURCE_UNPROVEN);
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return bytes;
}

const GOVERNOR_WRAPPER = String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$PSModuleAutoLoadingPreference='None'
try {
 foreach($module in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility','CimCmdlets')) {
  Import-Module ('C:\Windows\System32\WindowsPowerShell\v1.0\Modules\'+$module+'\'+$module+'.psd1') -ErrorAction Stop
 }
 $chars=[char[]]::new(__GOVERNOR_READ_CHAR_LIMIT__)
 $count=0
 while($count -lt $chars.Length){
  $read=[Console]::In.Read($chars,$count,$chars.Length-$count)
  if($read -eq 0){break}
  $count+=$read
 }
 if($count -gt __GOVERNOR_INPUT_CHAR_LIMIT__){throw 'INPUT'}
 $wire=[string]::new($chars,0,$count)
 if($wire -notmatch '\A[A-Za-z0-9+/]+={0,2}\n\z'){throw 'INPUT'}
 $bytes=[Convert]::FromBase64String($wire.TrimEnd([char]10))
 if($bytes.Length -lt 1 -or $bytes.Length -gt __GOVERNOR_SOURCE_LIMIT__){throw 'INPUT'}
 $source=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
 & ([scriptblock]::Create($source)) -Action ObserveAdmission
} catch { exit 2 }`
  .replaceAll('__GOVERNOR_READ_CHAR_LIMIT__', String(GOVERNOR_INPUT_CHAR_LIMIT + 1))
  .replaceAll('__GOVERNOR_INPUT_CHAR_LIMIT__', String(GOVERNOR_INPUT_CHAR_LIMIT))
  .replaceAll('__GOVERNOR_SOURCE_LIMIT__', String(GOVERNOR_SOURCE_LIMIT));

// Exported for the existing source tests, not registered as a remote capability.
// Production selects no source bytes, action, path, executable, or environment.
export function readSovereignGovernorDiagnosticV1(expectedMain, options = {}) {
  if (typeof expectedMain !== 'string' || !SHA.test(expectedMain)) fail(GOVERNOR_SOURCE_UNPROVEN);
  const input = dataRecord(options);
  if (Object.keys(input).some(key => !['testOnly', 'dependencies'].includes(key))) fail(GOVERNOR_INVALID);
  if (Object.keys(input).length && (input.testOnly !== true || !process.env.NODE_TEST_CONTEXT))
    fail('SOVEREIGN_CONTROL_SYSTEM_TEST_DEPENDENCIES_FORBIDDEN');
  const overrides = input.dependencies === undefined ? {} : dataRecord(input.dependencies);
  if (Object.keys(overrides).some(key => !['platform', 'spawnSync', 'readSourceHead', 'monotonicNow', 'environment'].includes(key)
    || (key === 'platform' ? !['win32', 'linux', 'darwin'].includes(overrides[key])
      : key === 'environment' ? !overrides[key] || typeof overrides[key] !== 'object' : typeof overrides[key] !== 'function')))
    fail(GOVERNOR_INVALID);
  const deps = { platform: process.platform, spawnSync, readSourceHead: readCanonicalSourceHead,
    monotonicNow: () => performance.now(), environment: process.env, ...overrides };
  if (deps.platform !== 'win32' || deps.readSourceHead() !== expectedMain) fail(GOVERNOR_SOURCE_UNPROVEN);
  const bytes = captureGovernorSource(expectedMain, deps.spawnSync, deps.monotonicNow, deps.environment);
  if (deps.readSourceHead() !== expectedMain) fail(GOVERNOR_SOURCE_UNPROVEN);
  const environment = { ...createBattleBridgeMinimalChildEnvironment(deps.environment, { platform: 'win32' }) };
  // These two existing settings add game detection only. Never inherit command,
  // PowerShell module, runtime-loader, provider or credential configuration.
  for (const name of ['STEPHANOS_GAME_PROCESS_NAMES', 'STEPHANOS_GAME_LIBRARY_ROOTS']) {
    const keys = Object.keys(deps.environment).filter(key => key.toUpperCase() === name);
    if (keys.length > 1) fail(GOVERNOR_INVALID);
    if (keys.length) {
      const value = deps.environment[keys[0]];
      if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) fail(GOVERNOR_INVALID);
      environment[name] = value;
    }
  }
  const result = deps.spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(GOVERNOR_WRAPPER, 'utf16le').toString('base64')], { cwd: REPOSITORY,
    env: Object.freeze(environment), shell: false, windowsHide: true,
    input: bytes.toString('base64') + '\n', timeout: 8000, maxBuffer: 4096 });
  if (result?.error?.code === 'ETIMEDOUT') fail(GOVERNOR_TIMEOUT);
  if (result?.error || result?.status !== 0 || result?.signal || !Buffer.isBuffer(result.stdout)
    || result.stdout.length > 4096 || (Buffer.isBuffer(result.stderr) ? result.stderr.length : result.stderr !== undefined && result.stderr !== ''))
    fail(GOVERNOR_INVALID);
  if (deps.readSourceHead() !== expectedMain) fail(GOVERNOR_SOURCE_UNPROVEN);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)); }
  catch { fail(GOVERNOR_INVALID); }
}

function governorUnavailable(reason) {
  return { available: false, reason: sovereignControlSystemGovernorObservationCodeV1(reason),
    readOnly: true, diagnosticOnly: true, executionAuthority: false };
}

function governorObservation(value, startedAtUtc, finishedAtUtc, inspectionStartedAtUtc) {
  const row = dataRecord(value), observedAtUtc = utc(row.observedAtUtc);
  if (Object.keys(row).sort().join(',') !== 'observedAtUtc,overrideMode,preparePending,readOnly,schemaVersion,signalActive'
    || row.schemaVersion !== 'stephanos.gaming-resource-admission-observation.v1'
    || row.readOnly !== true || typeof row.signalActive !== 'boolean' || typeof row.preparePending !== 'boolean'
    || !['AUTO', 'FORCE_ON', 'FORCE_OFF'].includes(row.overrideMode) || !observedAtUtc
    || Date.parse(observedAtUtc) < Date.parse(startedAtUtc) || Date.parse(observedAtUtc) > Date.parse(finishedAtUtc)
    || Date.parse(observedAtUtc) < Date.parse(inspectionStartedAtUtc)
    || Date.parse(observedAtUtc) - Date.parse(inspectionStartedAtUtc) > 30000)
    fail(GOVERNOR_INVALID);
  return { available: true, observedAtUtc, signalActive: row.signalActive,
    overrideMode: row.overrideMode, preparePending: row.preparePending,
    readOnly: true, diagnosticOnly: true, executionAuthority: false };
}

function readSelectedRequestLedger(requestId) {
  const fromEnvironment = Boolean(process.env.STEPHANOS_SHARED_WORKSPACE_ROOT);
  const workspace = process.env.STEPHANOS_SHARED_WORKSPACE_ROOT
    || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace');
  return { record: createMailboxExecutionLedger(join(workspace, 'github-command-mailbox')).read(requestId),
    workspaceSelection: fromEnvironment ? 'ENVIRONMENT' : 'DEFAULT' };
}

async function readHealth(fetchFn) {
  const response = await fetchFn(HEALTH_URL, { method: 'GET', redirect: 'error',
    signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!response.ok || !response.body?.getReader) fail('SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      if (!(row.value instanceof Uint8Array)) fail('SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN');
      bytes += row.value.byteLength;
      if (bytes > 65536) fail('SOVEREIGN_CONTROL_SYSTEM_HEALTH_BOUND_EXCEEDED');
      chunks.push(Buffer.from(row.value));
    }
  } finally { try { await reader.cancel(); } catch {} finally { reader.releaseLock(); } }
  let health;
  try { health = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN'); }
  if (health?.ok !== true || health.service !== 'stephanos-sovereign-commander')
    fail('SOVEREIGN_CONTROL_SYSTEM_HEALTH_IDENTITY_UNPROVEN');
  return health;
}

async function readProtocolHealth(fetchFn) {
  const controller = new AbortController(); let timer, reader, expired = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; controller.abort();
      reject(new Error('SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_TIMEOUT')); }, 3000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetchFn('http://127.0.0.1:18791/health?view=protocol', {
        method: 'GET', redirect: 'error', credentials: 'omit',
        signal: controller.signal, headers: { accept: 'application/json' },
      });
      if (controller.signal.aborted || !response.body?.getReader)
        fail('SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN');
      reader = response.body.getReader(); const chunks = []; let size = 0;
      for (;;) {
        const row = await reader.read();
        if (controller.signal.aborted) fail('SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_TIMEOUT');
        if (row.done) break;
        if (!(row.value instanceof Uint8Array)) fail('SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN');
        size += row.value.byteLength;
        if (size > 65536) fail('SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_BOUND_EXCEEDED');
        chunks.push(Buffer.from(row.value));
      }
      const health = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      return { httpOk: response.ok === true, health };
    })()]);
  } catch (error) {
    if (expired) fail('SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer); controller.abort();
    // Cleanup must not extend the observation deadline when a reader stalls.
    try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch {}
    try { reader?.releaseLock(); } catch {}
  }
}

function protocolObservation({ httpOk, health }, observedAtUtc) {
  const version = health?.maintenanceOwnerAdmissionVersion;
  const predicates = [httpOk, health?.ok === true, health?.service === 'stephanos-sovereign-commander',
    health?.observationScope === 'TRANSPORT_PROTOCOL_ONLY', health?.maintenanceAdmissionProven === false,
    version === SOVEREIGN_MAINTENANCE_OWNER_VERSION];
  const failedPredicates = SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_PREDICATES_V1.filter((_, index) => !predicates[index]);
  return { available: true, matches: failedPredicates.length === 0, failedPredicates,
    expectedVersion: SOVEREIGN_MAINTENANCE_OWNER_VERSION,
    observedVersion: version === SOVEREIGN_MAINTENANCE_OWNER_VERSION ? version : version === undefined ? 'MISSING'
      : typeof version === 'string' && version.length <= 128 ? 'OTHER' : 'INVALID',
    observedAtUtc, reason: failedPredicates.length ? 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED' : '' };
}

function validOwner(value, nowMs) {
  const row = dataRecord(value), observedAtUtc = utc(row.observedAtUtc), createdAtUtc = utc(row.createdAtUtc);
  if (Object.keys(row).sort().join(',') !== 'commandSha256,createdAtUtc,imageSha256,observedAtUtc,pid,schemaVersion'
    || row.schemaVersion !== 'stephanos.maintenance-owner-native-observation.v2'
    || !Number.isSafeInteger(row.pid) || row.pid < 1 || !observedAtUtc || !createdAtUtc
    || Date.parse(createdAtUtc) > Date.parse(observedAtUtc) || nowMs < Date.parse(observedAtUtc)
    || nowMs - Date.parse(observedAtUtc) > 15000
    || !DIGEST.test(row.commandSha256 ?? '') || !DIGEST.test(row.imageSha256 ?? ''))
    fail('SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN');
  return { ...row, observedAtUtc, createdAtUtc };
}

function guardianObservation(health, observedAtUtc) {
  const guardian = health?.continuousRepairGuardian, persistent = guardian?.persistentCustody;
  if (!guardian || ['enabled', 'running', 'scheduled', 'maintenanceInFlight', 'timeoutCustodyHeld']
    .some(key => typeof guardian[key] !== 'boolean') || typeof persistent?.held !== 'boolean'
    || typeof persistent.blocker !== 'string' || !/^[A-Z0-9_]{0,120}$/.test(persistent.blocker))
    fail('SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN');
  const custody = projectMaintenanceCustodyVisibilityV1({ available: true,
    timeoutCustodyHeld: guardian.timeoutCustodyHeld, persistentHeld: persistent.held,
    running: guardian.running, maintenanceInFlight: guardian.maintenanceInFlight,
    lastCycleId: guardian.lastCycleId, blocker: persistent.blocker,
    evidenceSource: 'LIVE_MAINTENANCE_OWNER_HEALTH', executionAuthority: false });
  return { available: true, enabled: guardian.enabled, running: guardian.running,
    scheduled: guardian.scheduled, maintenanceInFlight: guardian.maintenanceInFlight,
    custodyState: custody.state,
    blocker: sovereignControlSystemDiagnosticCodeV1(custody.blocker || guardian.lastBlocker || ''),
    ...(typeof guardian.lastSourceHead === 'string' && SHA.test(guardian.lastSourceHead)
      ? { sourceHead: guardian.lastSourceHead } : {}), observedAtUtc };
}

// Dependencies are available only to explicit node:test fixtures. Production
// callers select no executable, path, PID, host, environment, reader or command.
export async function inspectSovereignControlSystemV1(options = {}) {
  const report = emptyReport();
  try {
    const input = dataRecord(options);
    if (Object.keys(input).some(key => !['expectedMain', 'controlTowerRequestId', 'testOnly', 'dependencies'].includes(key))
      || (input.expectedMain !== undefined && (typeof input.expectedMain !== 'string' || !SHA.test(input.expectedMain)))
      || (input.controlTowerRequestId !== undefined && (typeof input.controlTowerRequestId !== 'string'
        || !REQUEST_ID.test(input.controlTowerRequestId)))
      || (input.testOnly !== undefined && typeof input.testOnly !== 'boolean'))
      fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
    if ((input.dependencies !== undefined || input.testOnly === true)
      && (input.testOnly !== true || !process.env.NODE_TEST_CONTEXT))
      fail('SOVEREIGN_CONTROL_SYSTEM_TEST_DEPENDENCIES_FORBIDDEN');
    const overrides = input.dependencies === undefined ? {} : dataRecord(input.dependencies);
    const keys = ['platform', 'now', 'readSourceHead', 'readCaller', 'readOwner', 'readGovernor', 'fetchFn', 'inspectRuntime', 'readLedger'];
    if (Object.keys(overrides).some(key => !keys.includes(key)
      || (key === 'platform' ? !['win32', 'linux', 'darwin'].includes(overrides[key]) : typeof overrides[key] !== 'function')))
      fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
    const deps = { platform: process.platform, now: () => new Date(), readSourceHead: readCanonicalSourceHead,
      readCaller: readCallerIdentity, readOwner: readMaintenanceNativeOwnerV2, fetchFn: fetch,
      readGovernor: readSovereignGovernorDiagnosticV1,
      inspectRuntime: inspectFixedRuntimeQualificationV1, readLedger: readSelectedRequestLedger, ...overrides };
    report.observedAtUtc = instant(deps.now);
    report.requestLedger.requested = input.controlTowerRequestId !== undefined;
    if (input.expectedMain) report.source.expectedMain = input.expectedMain;
    if (deps.platform !== 'win32') fail('SOVEREIGN_CONTROL_SYSTEM_WINDOWS_REQUIRED');
    let sourceHead;
    try { sourceHead = await deps.readSourceHead(); }
    catch (error) { fail(diagnosticCode(error, 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN')); }
    if (typeof sourceHead !== 'string' || !SHA.test(sourceHead)) fail('SOVEREIGN_CONTROL_SYSTEM_SOURCE_UNPROVEN');
    report.source = { ...report.source, available: true, sourceHead, reason: '',
      ...(input.expectedMain ? { expectedMainMatches: input.expectedMain === sourceHead } : {}) };
    if (input.expectedMain && input.expectedMain !== sourceHead) fail('SOVEREIGN_CONTROL_SYSTEM_EXPECTED_MAIN_MISMATCH');

    // Sample first so a failed owner bracket cannot hide fresh gaming facts.
    // The persisted governor hold below remains the independent admission gate.
    try {
      const startedAtUtc = instant(deps.now), observation = await deps.readGovernor(sourceHead);
      report.governorObservation = governorObservation(observation, startedAtUtc, instant(deps.now), report.observedAtUtc);
    } catch (error) {
      report.governorObservation = governorUnavailable(error?.message === 'SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID'
        ? GOVERNOR_INVALID : error?.message);
    }

    try {
      const caller = dataRecord(await deps.readCaller()), observedAtUtc = utc(caller.observedAtUtc);
      if (Object.keys(caller).sort().join(',') !== 'administratorEnabled,observedAtUtc,schemaVersion,sid'
        || caller.schemaVersion !== 'stephanos.sovereign-diagnostic-caller.v1'
        || typeof caller.sid !== 'string' || caller.sid.length > 180
        || !/^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/.test(caller.sid)
        || typeof caller.administratorEnabled !== 'boolean' || !observedAtUtc
        || Date.parse(observedAtUtc) > Date.parse(instant(deps.now))
        || Date.parse(instant(deps.now)) - Date.parse(observedAtUtc) > 15000)
        fail('SOVEREIGN_CONTROL_SYSTEM_CALLER_UNPROVEN');
      report.caller = { available: true, sid: caller.sid, administratorEnabled: caller.administratorEnabled,
        observedAtUtc, observationAppliesTo: 'DIAGNOSTIC_CALLER_ONLY', reason: '' };
    } catch (error) { report.caller.reason = diagnosticCode(error, 'SOVEREIGN_CONTROL_SYSTEM_CALLER_UNPROVEN'); }

    const observeOwner = async () => {
      try { return { ok: true, value: validOwner(await deps.readOwner(), Date.parse(instant(deps.now))) }; }
      catch (error) {
        const reason = diagnosticCode(error, 'SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN');
        return { ok: false, reason,
          ...(reason === 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' && Object.hasOwn(error, 'diagnosticCode')
            ? { diagnosticCode: sovereignControlSystemOwnerDiagnosticCodeV1(
              Object.getOwnPropertyDescriptor(error, 'diagnosticCode')?.value) } : {}) };
      }
    };
    const before = await observeOwner();
    let health, healthTime, healthReason = '';
    const [healthRead, protocolRead] = await Promise.allSettled([
      (async () => ({ health: await readHealth(deps.fetchFn), observedAtUtc: instant(deps.now) }))(),
      (async () => ({ exchange: await readProtocolHealth(deps.fetchFn), observedAtUtc: instant(deps.now) }))(),
    ]);
    if (healthRead.status === 'fulfilled') {
      health = healthRead.value.health; healthTime = healthRead.value.observedAtUtc;
    } else healthReason = diagnosticCode(healthRead.reason, 'SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN');
    const after = await observeOwner();
    const same = before.ok && after.ok && ['pid', 'createdAtUtc', 'commandSha256', 'imageSha256']
      .every(key => before.value[key] === after.value[key]);
    const ownerReason = same ? '' : before.ok && after.ok ? 'SOVEREIGN_CONTROL_SYSTEM_OWNER_CHANGED'
      : before.reason || after.reason || 'SOVEREIGN_CONTROL_SYSTEM_OWNER_UNPROVEN';
    report.owner = { available: before.ok && after.ok, stable: same,
      reason: ownerReason,
      ...(ownerReason === 'MAINTENANCE_MIGRATION_OWNER_UNPROVEN' && (before.diagnosticCode || after.diagnosticCode)
        ? { diagnosticCode: before.diagnosticCode || after.diagnosticCode } : {}),
      ...(after.ok ? { observedAtUtc: after.value.observedAtUtc } : {}),
      before, after };
    if (same && protocolRead.status === 'fulfilled') {
      report.protocol = protocolObservation(protocolRead.value.exchange, protocolRead.value.observedAtUtc);
    } else report.protocol.reason = !same ? report.owner.reason
      : diagnosticCode(protocolRead.reason, 'SOVEREIGN_CONTROL_SYSTEM_PROTOCOL_UNPROVEN');
    if (same && health) {
      try { report.guardian = guardianObservation(health, healthTime); }
      catch (error) { report.guardian.blocker = diagnosticCode(error, 'SOVEREIGN_CONTROL_SYSTEM_HEALTH_UNPROVEN'); }
    } else report.guardian.blocker = healthReason || report.owner.reason;

    // The helper observation is separate from the native bracket around health.
    // Its private qualification object is deliberately discarded, never executed.
    try {
      const native = dataRecord(await deps.inspectRuntime()), observedAtUtc = instant(deps.now);
      if (native.ok === false) {
        const governorHoldCode = native.reason === 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD'
          ? sovereignControlSystemGovernorHoldCodeV1(native.governorHoldCode) : '';
        const governorPermission = governorHoldCode === 'FIXED_RUNTIME_GOVERNOR_PERMISSION_DENIED'
          && (!Object.hasOwn(native, 'sourceHead') || native.sourceHead === sourceHead)
          && Object.hasOwn(native, 'governorPermission')
          ? projectSovereignControlSystemGovernorPermissionV1(native.governorPermission, observedAtUtc) : null;
        report.nativeRuntime = { available: true, qualificationObserved: false,
          reason: sovereignControlSystemDiagnosticCodeV1(native.reason, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN'), observedAtUtc,
          ...(governorHoldCode ? { governorHoldCode } : {}),
          ...(governorPermission ? { governorPermission } : {}) };
      }
      else if (native.ok === true && native.sourceHead === sourceHead && utc(native.observedAtUtc)
        && Date.parse(native.observedAtUtc) <= Date.parse(observedAtUtc)
        && Date.parse(observedAtUtc) - Date.parse(native.observedAtUtc) <= 15000
        && Array.isArray(native.profiles) && native.profiles.length <= PROFILES.size
        && native.profiles.every(profile => PROFILES.has(profile))
        && new Set(native.profiles).size === native.profiles.length) {
        report.nativeRuntime = { available: true, qualificationObserved: true, reason: '',
          sourceHead: native.sourceHead, profiles: [...native.profiles], observedAtUtc: utc(native.observedAtUtc),
          ...(utc(native.bootStartedAtUtc) && Date.parse(native.bootStartedAtUtc) <= Date.parse(native.observedAtUtc)
            ? { bootStartedAtUtc: utc(native.bootStartedAtUtc) } : {}) };
      } else fail('FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
    } catch (error) { report.nativeRuntime.reason = diagnosticCode(error, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN'); }

    if (input.controlTowerRequestId) {
      try {
        const selected = dataRecord(await deps.readLedger(input.controlTowerRequestId));
        const record = selected.record === null ? null : dataRecord(selected.record);
        if (!['ENVIRONMENT', 'DEFAULT'].includes(selected.workspaceSelection)
          || (record && (record.schemaVersion !== 'stephanos.mailbox-execution-ledger-entry.v1'
            || record.requestId !== input.controlTowerRequestId || record.issueNumber !== 2315
            || !['RESERVED', 'TERMINAL', 'RETIRED'].includes(record.phase)
            || (record.phase === 'TERMINAL' && !['DONE', 'BLOCKED'].includes(record.terminalState))
            || (record.phase !== 'TERMINAL' && record.terminalState !== undefined))))
          fail('SOVEREIGN_CONTROL_SYSTEM_LEDGER_UNPROVEN');
        report.requestLedger = { requested: true, recordObserved: record !== null,
          requestId: input.controlTowerRequestId, workspaceSelection: selected.workspaceSelection,
          relayWorkspaceIdentityProven: false, reason: record ? '' : 'SOVEREIGN_CONTROL_SYSTEM_REQUEST_NOT_OBSERVED',
          ...(record ? { phase: record.phase, ...(record.phase === 'TERMINAL' ? { terminalState: record.terminalState } : {}) } : {}) };
      } catch (error) { report.requestLedger.reason = diagnosticCode(error, 'SOVEREIGN_CONTROL_SYSTEM_LEDGER_UNPROVEN'); }
    }
    try { report.source.stable = await deps.readSourceHead() === sourceHead; }
    catch { report.source.stable = false; }
    if (!report.source.stable) {
      report.source.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED';
      report.protocol = { available: false, matches: false, reason: report.source.reason };
      report.nativeRuntime.qualificationObserved = false;
      report.nativeRuntime.reason = 'SOVEREIGN_CONTROL_SYSTEM_SOURCE_CHANGED';
      delete report.nativeRuntime.profiles;
      delete report.nativeRuntime.governorHoldCode;
      delete report.nativeRuntime.governorPermission;
      if (report.governorObservation) report.governorObservation = governorUnavailable(report.source.reason);
      delete report.owner.diagnosticCode;
    }
    report.observationCompleted = report.source.stable && (report.nativeRuntime.available || report.guardian.available);
    report.blocker = report.source.reason || report.owner.reason || report.guardian.blocker
      || report.nativeRuntime.reason || report.caller.reason || report.requestLedger.reason || '';
  } catch (error) { report.blocker = diagnosticCode(error); }
  return freezeReport(report);
}

export function parseSovereignControlSystemInspectionArgumentsV1(args) {
  if (!Array.isArray(args) || args.length > 4 || args.length % 2 !== 0)
    fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index] === '--expected-main' ? 'expectedMain'
      : args[index] === '--control-tower-request' ? 'controlTowerRequestId' : '';
    if (!key || Object.hasOwn(result, key) || typeof args[index + 1] !== 'string'
      || !(key === 'expectedMain' ? SHA : REQUEST_ID).test(args[index + 1]))
      fail('SOVEREIGN_CONTROL_SYSTEM_ARGUMENTS_INVALID');
    result[key] = args[index + 1];
  }
  return Object.freeze(result);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  let report;
  try { report = await inspectSovereignControlSystemV1(parseSovereignControlSystemInspectionArgumentsV1(process.argv.slice(2))); }
  catch (error) { const refused = emptyReport(); refused.blocker = diagnosticCode(error); report = freezeReport(refused); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.observationCompleted ? 0 : 2;
}
