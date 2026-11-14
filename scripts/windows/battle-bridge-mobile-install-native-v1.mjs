// Fixed native bridge for the existing #1814 recovery owner.
// Structural observations are not enrollment, release eligibility or approval.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from '../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { normalizeMobileInstallationCandidateV1, projectMobileInstallationV1,
  verifyMobileInstallationAssertionV1 } from '../../shared/agents/battleBridgeMobileInstallationV1.mjs';

export const MOBILE_INSTALL_NATIVE_OBSERVATION_SCHEMA_V1 = 'stephanos.mobile-install-native-observation.v1';
export const MOBILE_INSTALL_NATIVE_PROBE_SCHEMA_V1 = 'stephanos.mobile-install-native-probe.v1';
export const MOBILE_INSTALL_NATIVE_MARKER_V1 = 'STEPHANOS_MOBILE_INSTALL_OBSERVATION_V1=';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const PROBE = fileURLToPath(new URL('./observe-battle-bridge-mobile-install-v1.ps1', import.meta.url));
const PROBE_SHA256 = '337ccbc676dbc44aa96f3344c15c499536b1fa2070a196b2385329c53d967913';
const PROBE_SCRIPT = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$mobileProbeFile=[IO.FileStream]::new('__PATH__','Open','Read','Read')
try{
 if($mobileProbeFile.Length -lt 2 -or $mobileProbeFile.Length -gt 32768){throw 'MOBILE_PROBE_SOURCE_BOUND'}
 $mobileProbeBytes=[byte[]]::new([int]$mobileProbeFile.Length);$mobileProbeAt=0
 while($mobileProbeAt -lt $mobileProbeBytes.Length){$mobileProbeRead=$mobileProbeFile.Read($mobileProbeBytes,$mobileProbeAt,$mobileProbeBytes.Length-$mobileProbeAt);if($mobileProbeRead -le 0){throw 'MOBILE_PROBE_SOURCE_CHANGED'};$mobileProbeAt+=$mobileProbeRead}
 if($mobileProbeFile.ReadByte() -ne -1 -or $mobileProbeFile.Length -ne $mobileProbeBytes.Length){throw 'MOBILE_PROBE_SOURCE_CHANGED'}
 $mobileProbeSha=[Security.Cryptography.SHA256]::Create()
 try{$mobileProbeDigest=([BitConverter]::ToString($mobileProbeSha.ComputeHash($mobileProbeBytes))).Replace('-','').ToLowerInvariant()}finally{$mobileProbeSha.Dispose()}
 if($mobileProbeDigest -cne '__SHA__'){throw 'MOBILE_PROBE_SOURCE_CHANGED'}
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($mobileProbeBytes)))
}finally{$mobileProbeFile.Dispose()}
`.replace('__PATH__', PROBE.replaceAll("'", "''")).replace('__SHA__', PROBE_SHA256);
const PROBE_ARGS = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64')]);
const CLIENT_MARKER = 'STEPHANOS_MOBILE_INSTALL_CLIENT_V1=';
// Source-defined unprivileged client only. Lock and inspect the administrative
// helper before loading it; mutable checkout source is never compiled/elevated.
const CLIENT_SCRIPT = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$root='C:\Program Files\Stephanos\SovereignMobileInstallerV1'
$path=[IO.Path]::Combine($root,'installer.exe')
$trusted=@('S-1-5-18','S-1-5-32-544')
function Assert-Acl($acl,[bool]$osAncestor){
 $owners=if($osAncestor){@($trusted)+@('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')}else{@($trusted)}
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cnotin $owners){throw 'MOBILE_CLIENT_PROTECTED_OWNER_UNPROVEN'}
 $mutation=if($osAncestor){0x500D0150}else{0x500D0156}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if((-not $osAncestor -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) -and
   $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.FileSystemRights -band $mutation) -ne 0 -and
   $rule.IdentityReference.Value -cnotin $owners){throw 'MOBILE_CLIENT_PROTECTED_WRITE_UNPROVEN'}
 }
}
foreach($directory in @('C:\','C:\Program Files','C:\Program Files\Stephanos',$root)){
 if(([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'MOBILE_CLIENT_REDIRECTION_REFUSED'}
 Assert-Acl ([IO.Directory]::GetAccessControl($directory)) ($directory -ceq 'C:\' -or $directory -ceq 'C:\Program Files')
}
$file=$null
try{
 $file=[IO.FileStream]::new($path,'Open','Read','Read')
 Assert-Acl ($file.GetAccessControl()) $false
 if(([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -lt 2 -or $file.Length -gt 2097152){throw 'MOBILE_CLIENT_HELPER_UNPROVEN'}
 $assembly=[Reflection.Assembly]::LoadFrom($path)
 if(-not [String]::Equals($assembly.Location,$path,[StringComparison]::OrdinalIgnoreCase)){throw 'MOBILE_CLIENT_HELPER_LOCATION_UNPROVEN'}
 $flags=[Reflection.BindingFlags]'NonPublic,Static'
 $enrollment=[string]$assembly.GetType('Stephanos.Sovereign.MobileInstallQualifiedEnrollmentV1',$true).GetMethod('ReadProtectedClientEnrollmentV1',$flags).Invoke($null,@())
 if($enrollment.Length -gt 8192){throw 'MOBILE_CLIENT_ENROLLMENT_BOUND'}
 $request=[Text.StringBuilder]::new();$buffer=[char[]]::new(4096)
 while(($count=[Console]::In.Read($buffer,0,$buffer.Length)) -gt 0){
  if($request.Length+$count -gt 32768){throw 'MOBILE_CLIENT_REQUEST_BOUND'}
  [void]$request.Append($buffer,0,$count)
 }
 $response=[string]$assembly.GetType('Stephanos.Sovereign.SovereignMobileInstallEntryV1',$true).GetMethod('CallProtectedPipeV1',$flags).Invoke($null,@($request.ToString()))
 if($response.Length -gt 32768){throw 'MOBILE_CLIENT_RESPONSE_BOUND'}
 $trustedWire=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($enrollment))
 $responseWire=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($response))
 [Console]::Write('STEPHANOS_MOBILE_INSTALL_CLIENT_V1={"schemaVersion":"stephanos.mobile-install-client.v1","trustedEnrollmentBase64":"'+$trustedWire+'","responseBase64":"'+$responseWire+'"}')
}finally{if($null -ne $file){$file.Dispose()}}
`;
const CLIENT_ARGS = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(CLIENT_SCRIPT, 'utf16le').toString('base64')]);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^mobile-install-[a-z0-9][a-z0-9-]{7,63}$/;
const matches = (expression, value) => typeof value === 'string' && expression.test(value);
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_AGE_MS = 30_000;
export const MOBILE_INSTALL_NATIVE_CACHE_MS_V1 = 15_000;
const DEFAULT_PROBE_SLOT = { pending: false };
const PROBE_REASONS = new Set([
  'MOBILE_INSTALL_ENROLLMENT_MISSING', 'MOBILE_INSTALL_ENROLLMENT_INCOMPLETE',
  'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN', 'MOBILE_INSTALL_TASK_UNPROVEN',
  'MOBILE_INSTALL_OPERATOR_SESSION_MISSING', 'MOBILE_INSTALL_NATIVE_VERIFIER_QUALIFICATION_REQUIRED',
  'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN',
]);
const PROBE_KEYS = ['schemaVersion', 'observedAtUtc', 'state', 'reason', 'sameOperator',
  'interactiveSession', 'fixedTask', 'protectedFiles', 'helperSha256', 'installationAuthority'];

function frozen(value) { return Object.freeze(value); }
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN;
}
function plainData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === 'string'
    && keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

// This parser consumes only a bounded, fixed probe protocol. In particular, a
// helper which claims authority or adds fields cannot upgrade this read adapter.
export function parseMobileInstallNativeObservationV1(stdout, { nowMs = Date.now() } = {}) {
  if (typeof stdout !== 'string' || !Number.isFinite(nowMs)
      || Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) return null;
  const text = stdout.trim();
  if (!text.startsWith(MOBILE_INSTALL_NATIVE_MARKER_V1) || /[\r\n]/.test(text)) return null;
  let row;
  try { row = JSON.parse(text.slice(MOBILE_INSTALL_NATIVE_MARKER_V1.length)); } catch { return null; }
  if (!plainData(row, PROBE_KEYS) || row.schemaVersion !== MOBILE_INSTALL_NATIVE_PROBE_SCHEMA_V1
      || row.installationAuthority !== false || !['MISSING', 'UNPROVEN', 'UNQUALIFIED'].includes(row.state)
      || !PROBE_REASONS.has(row.reason)) return null;
  const at = iso(row.observedAtUtc);
  if (!Number.isFinite(at) || at > nowMs + 5_000 || nowMs - at > MAX_AGE_MS) return null;
  if (!['sameOperator', 'interactiveSession', 'fixedTask', 'protectedFiles'].every(key =>
    row[key] === null || typeof row[key] === 'boolean')) return null;
  if (row.helperSha256 !== null && !matches(SHA64, row.helperSha256)) return null;
  if (row.state === 'MISSING' && (row.reason !== 'MOBILE_INSTALL_ENROLLMENT_MISSING'
      || row.fixedTask !== null || row.protectedFiles !== null || row.helperSha256 !== null)) return null;
  if (row.state === 'UNQUALIFIED' && (row.reason !== 'MOBILE_INSTALL_NATIVE_VERIFIER_QUALIFICATION_REQUIRED'
      || !row.sameOperator || !row.interactiveSession || !row.fixedTask || !row.protectedFiles
      || !matches(SHA64, row.helperSha256))) return null;
  return frozen({ ...row });
}

function runFixedNativeProcess(spawnFn, slot, { args, input = null, maximum = MAX_OUTPUT_BYTES }) {
  if (slot.pending) return Promise.resolve({ failed: true, held: true });
  slot.pending = true;
  return new Promise(resolve => {
    let child;
    let failed = false;
    let settled = false;
    let total = 0;
    const stdout = [];
    let timer;
    let cleanupTimer;
    const finish = (status, signal, held = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      let output = '';
      try { if (!failed) output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout)); } catch { failed = true; }
      resolve({ status, signal, failed, held, started: Boolean(child?.pid), stdout: failed ? '' : output });
    };
    const stop = () => {
      failed = true;
      // Response time remains bounded if termination is uncertain, while the
      // retained slot forbids a replacement process until genuine close.
      try { child?.kill('SIGKILL'); } catch { /* close/error remains authoritative */ }
      if (!cleanupTimer) {
        cleanupTimer = setTimeout(() => finish(null, null, true), 1_000);
        cleanupTimer.unref?.();
      }
    };
    try {
      child = spawnFn(POWERSHELL, args, {
        shell: false, windowsHide: true, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }),
      });
      timer = setTimeout(stop, 10_000);
      timer.unref?.();
      const consume = (chunk, retain) => {
        if (settled || failed) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > maximum) { stop(); return; }
        if (retain) stdout.push(bytes);
      };
      child.stdout.on('data', chunk => consume(chunk, true));
      child.stderr.on('data', chunk => consume(chunk, false));
      child.once('error', () => {
        failed = true;
        if (!child.pid) { slot.pending = false; finish(null, null); }
        else stop();
      });
      child.once('close', (status, signal) => {
        slot.pending = false;
        finish(status, signal);
      });
      if (input !== null) { child.stdin.once('error', stop); child.stdin.end(input); }
    } catch {
      failed = true;
      if (child?.pid) stop();
      else { slot.pending = false; finish(null, null); }
    }
  });
}
function runNativeProbe(spawnFn, slot) {
  return runFixedNativeProcess(spawnFn, slot, { args: [...PROBE_ARGS] });
}

export async function observeBattleBridgeMobileInstallNativeV1({
  expectedMain, platform = process.platform, nowMs = Date.now(), nowFn, spawnFn = spawn,
  probeSlot = DEFAULT_PROBE_SLOT,
} = {}) {
  const clockValid = Number.isFinite(nowMs) && Math.abs(nowMs) <= 8.64e15;
  const base = { schemaVersion: MOBILE_INSTALL_NATIVE_OBSERVATION_SCHEMA_V1,
    expectedSourceHead: matches(SHA40, expectedMain) ? expectedMain : null,
    observedAtUtc: clockValid ? new Date(nowMs).toISOString() : null,
    candidate: null, enrollment: null, receipt: null,
    installationAuthority: false, nativeExecutionAvailable: false,
    enrollmentObservation: null };
  if (platform !== 'win32') return frozen({ ...base, reason: 'MOBILE_INSTALL_WINDOWS_REQUIRED' });
  if (!matches(SHA40, expectedMain) || !clockValid)
    return frozen({ ...base, reason: 'MOBILE_INSTALL_EXACT_SOURCE_REQUIRED' });
  let enrollmentObservation = null;
  let held = false;
  try {
    const result = await runNativeProbe(spawnFn, probeSlot);
    held = result.held === true;
    if (!result.failed && !result.signal && result.status === 0)
      enrollmentObservation = parseMobileInstallNativeObservationV1(result.stdout, { nowMs: nowFn ? nowFn() : nowMs });
  } catch { /* Private stderr, exception text and paths never enter the public projection. */ }
  return frozen({ ...base, enrollmentObservation,
    reason: held ? 'MOBILE_INSTALL_NATIVE_OBSERVER_PROCESS_HELD'
      : enrollmentObservation?.reason || 'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN' });
}

const DEFAULT_CLIENT_SLOT = { pending: false };
const ENROLLMENT_KEYS = ['schemaVersion', 'machineHash', 'operatorSid', 'generation', 'rpId', 'origin',
  'credentialId', 'publicKeySpki', 'userHandle', 'lastSignCount', 'revoked', 'receiptPublicKeySpki'];
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
function canonicalData(value) {
  if (Array.isArray(value)) return value.map(canonicalData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalData(value[key])]));
  return value;
}
function decodeClientJson(value, maximum) {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maximum / 3)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== value) return null;
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
}
function readClientResponse(stdout, expectedMain, requestedId, minimumSequence, nowMs) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 65536 || !stdout.startsWith(CLIENT_MARKER)) return null;
  let envelope;
  try { envelope = JSON.parse(stdout.slice(CLIENT_MARKER.length)); } catch { return null; }
  if (!plainData(envelope, ['schemaVersion', 'trustedEnrollmentBase64', 'responseBase64'])
      || envelope.schemaVersion !== 'stephanos.mobile-install-client.v1') return null;
  const enrollment = decodeClientJson(envelope.trustedEnrollmentBase64, 8192);
  const response = decodeClientJson(envelope.responseBase64, 32768);
  if (!plainData(enrollment, ENROLLMENT_KEYS)
      || !plainData(response, ['schemaVersion', 'candidate', 'enrollment', 'receipt'])
      || response.schemaVersion !== 'stephanos.mobile-install-pipe-response.v1'
      || JSON.stringify(canonicalData(enrollment)) !== JSON.stringify(canonicalData(response.enrollment))) return null;
  const normalized = normalizeMobileInstallationCandidateV1(response.candidate, { nowMs, enforceFreshness: false });
  if (!normalized.ok || normalized.candidate.sourceHead !== expectedMain
      || (requestedId && normalized.candidate.requestId !== requestedId)) return null;
  const snapshot = { candidate: normalized.candidate, enrollment, receipt: response.receipt };
  const projected = projectMobileInstallationV1(snapshot, { nowMs, minimumSequence });
  const expired = projected.state === 'BLOCKED' && projected.reasonCode === 'CANDIDATE_NOT_FRESH';
  if ((!projected.receiptVerified && !expired) || projected.state === 'READY') return null;
  const sequence = response.receipt.payload.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence < minimumSequence) return null;
  return deepFreeze({ ...snapshot, minimumSequence: sequence, installationAuthority: false,
    nativeExecutionAvailable: true, requestId: snapshot.candidate.requestId, status: projected.state,
    accepted: projected.state !== 'AWAITING_APPROVAL', dispatched: false });
}

// The observation remains structural-only. A mutation is sent only through the
// fixed protected client and is independently reverified by the native owner.
export function createBattleBridgeMobileInstallationProviderV1(options = {}) {
  // Read caching belongs to this adapter, not a new runtime owner. Concurrent
  // mobile polls share the same read and cannot fan out PowerShell children.
  const clock = options.nowFn || Date.now;
  const probeSlot = options.probeSlot || DEFAULT_PROBE_SLOT;
  const clientSlot = options.clientSlot || DEFAULT_CLIENT_SLOT;
  const spawnFn = options.spawnFn || spawn;
  const snapshots = new Map(), watermarks = new Map(), attempted = new Set();
  let cached = null;
  let cachedAt = -Infinity;
  let inFlight = null;
  const unavailable = (requestId, reason = 'MOBILE_INSTALL_NATIVE_VERIFIER_UNAVAILABLE', status = 'BLOCKED', dispatched = false) => frozen({ ok: false, status,
    reason, requestId: matches(REQUEST_ID, requestId) ? requestId : null, accepted: false, dispatched,
    installationAuthority: false, nativeExecutionAvailable: false, candidate: null, enrollment: null, receipt: null });
  const native = async (operation, requestId = null, assertion = null) => {
    const nowMs = clock();
    if ((options.platform || process.platform) !== 'win32' || !matches(SHA40, options.expectedMain) || !Number.isFinite(nowMs))
      return unavailable(requestId);
    let wire = 'STEPHANOS_MOBILE_INSTALL_PIPE_V1|' + operation;
    if (operation !== 'PREPARE') {
      if (!matches(REQUEST_ID, requestId)) return unavailable(null, 'MOBILE_INSTALL_REQUEST_ID_INVALID', 'UNKNOWN');
      wire += '|' + requestId;
    }
    if (operation === 'APPROVE') wire += '|' + Buffer.from(JSON.stringify(assertion), 'utf8').toString('base64');
    if (!['PREPARE', 'APPROVE', 'RECONCILE', 'CANCEL'].includes(operation) || Buffer.byteLength(wire) > 32768)
      return unavailable(requestId, 'MOBILE_INSTALL_NATIVE_REQUEST_INVALID', 'UNKNOWN');
    const result = await runFixedNativeProcess(spawnFn, clientSlot, { args: [...CLIENT_ARGS], input: wire, maximum: 65536 });
    if (result.failed || result.held || result.signal || result.status !== 0) {
      if (operation === 'APPROVE' && !result.started && !result.held) attempted.delete(requestId);
      return unavailable(requestId, 'MOBILE_INSTALL_NATIVE_RESULT_UNPROVEN', 'UNKNOWN', operation === 'APPROVE' && Boolean(result.started || result.held));
    }
    const minimum = requestId ? watermarks.get(requestId) || 0 : 0;
    const verified = readClientResponse(result.stdout, options.expectedMain, requestId, minimum, clock());
    if (!verified || (watermarks.size >= 1024 && !watermarks.has(verified.requestId)))
      return unavailable(requestId, 'MOBILE_INSTALL_NATIVE_RECEIPT_UNPROVEN', 'UNKNOWN', operation === 'APPROVE');
    const previous = watermarks.get(verified.requestId) || 0;
    if (verified.minimumSequence < previous) return unavailable(requestId, 'MOBILE_INSTALL_NATIVE_RECEIPT_ROLLBACK', 'UNKNOWN', operation === 'APPROVE');
    watermarks.set(verified.requestId, verified.minimumSequence); snapshots.set(verified.requestId, verified);
    if (['FAILED', 'CANCELLED', 'INSTALLED_PENDING_BOOT'].includes(verified.status)) attempted.delete(verified.requestId);
    return frozen({ ...verified, ok: true, dispatched: operation === 'APPROVE' });
  };
  const observe = () => {
    const nowMs = clock();
    if (cached && nowMs >= cachedAt && nowMs - cachedAt < MOBILE_INSTALL_NATIVE_CACHE_MS_V1)
      return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(async () => {
      const nativeObservation = await observeBattleBridgeMobileInstallNativeV1({ ...options, nowMs, nowFn: clock, probeSlot });
      const structural = frozen({ candidate: null, enrollment: null, receipt: null, nativeObservation });
      cached = nativeObservation.enrollmentObservation?.state === 'UNQUALIFIED'
        ? frozen({ ...await native('PREPARE'), nativeObservation }) : structural;
      cachedAt = nowMs;
      return cached;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const ready = async requestId => {
    const observed = await observe();
    return observed.nativeExecutionAvailable ? observed : frozen({ ...observed, ...unavailable(requestId,
      observed.nativeObservation?.reason || observed.reason || 'MOBILE_INSTALL_NATIVE_VERIFIER_UNAVAILABLE', requestId ? 'UNKNOWN' : 'BLOCKED') });
  };
  return frozen({
    observe,
    prepare: async () => { const current = await ready(null); return current.nativeExecutionAvailable ? native('PREPARE') : current; },
    approve: async input => {
      if (!plainData(input, ['requestId', 'assertion']) || !matches(REQUEST_ID, input.requestId))
        return unavailable(input?.requestId, 'MOBILE_INSTALL_ASSERTION_INVALID');
      const { requestId, assertion } = input;
      if (attempted.has(requestId) || attempted.size >= 64) return unavailable(requestId, 'MOBILE_INSTALL_RECONCILIATION_REQUIRED', 'UNKNOWN');
      const known = snapshots.get(requestId);
      if (!known || known.status !== 'AWAITING_APPROVAL' || !verifyMobileInstallationAssertionV1({
        candidate: known.candidate, enrollment: known.enrollment, assertion }, { nowMs: clock() }).ok)
        return unavailable(requestId, 'MOBILE_INSTALL_ASSERTION_INVALID');
      attempted.add(requestId);cached = null;cachedAt = -Infinity;
      return native('APPROVE', requestId, assertion);
    },
    reconcile: async requestId => {
      if (!matches(REQUEST_ID, requestId)) return unavailable(null, 'MOBILE_INSTALL_REQUEST_ID_INVALID', 'UNKNOWN');
      const current = await ready(requestId);
      return current.nativeExecutionAvailable ? native('RECONCILE', requestId) : current;
    },
    cancel: async requestId => {
      if (!matches(REQUEST_ID, requestId)) return unavailable(null, 'MOBILE_INSTALL_REQUEST_ID_INVALID', 'UNKNOWN');
      const current = await ready(requestId);cached = null;cachedAt = -Infinity;
      return current.nativeExecutionAvailable ? native('CANCEL', requestId) : current;
    },
  });
}

export const createBattleBridgeMobileInstallNativeProviderV1 = createBattleBridgeMobileInstallationProviderV1;
