import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_PROCESS_SESSION_SCHEMA_V1 = 'stephanos.sovereign-process-sessions.v1';
export const SOVEREIGN_PROCESS_SESSION_EXECUTABLE_V1 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const RECOVERY_SCRIPT_SHA256 = 'd48756676ed2fe75214c298d26c3010d08c219c2ed12ab6475998d5272645e03';
const WATCHDOG_SCRIPT_SHA256 = '948d3b7ae81589301741d2975d2f5b0878f9592e085d29e768873231d7cb0230';
export const SOVEREIGN_PROCESS_SESSION_PROFILES_V1 = Object.freeze({
  'status-recovery-mesh': Object.freeze({
    scriptPath: 'scripts/windows/status-battle-bridge-recovery-mesh.ps1',
    scriptSha256: RECOVERY_SCRIPT_SHA256,
    timeoutMs: 10_000,
  }),
  'status-worker-watchdog': Object.freeze({
    scriptPath: 'scripts/windows/status-battle-bridge-worker-watchdog.ps1',
    scriptSha256: WATCHDOG_SCRIPT_SHA256,
    timeoutMs: 10_000,
  }),
});
export const SOVEREIGN_PROCESS_SESSION_LIMITS_V1 = Object.freeze({
  nativeConcurrency: 2, sessions: 4, ttlMs: 300_000, processMs: 10_000,
  terminationGraceMs: 2000, outputBytes: 16_384, outputChunks: 256,
  chunkBytes: 1024, pageBytes: 12_288, pageDefault: 20, pageMax: 50,
});

// These are finite source reads, never caller paths. The package proof binds
// this exact adapter and both complete script byte streams independently.
const RECOVERY_SCRIPT = fileURLToPath(new URL('../../scripts/windows/status-battle-bridge-recovery-mesh.ps1', import.meta.url));
const WATCHDOG_SCRIPT = fileURLToPath(new URL('../../scripts/windows/status-battle-bridge-worker-watchdog.ps1', import.meta.url));
const SYSTEM_MODULES = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
const OPERATIONS = new Set(['START_PROCESS_SESSION', 'READ_PROCESS_OUTPUT', 'LIST_SESSIONS']);
const ID = /^process-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PRESPAWN_ERRORS = new Set(['ENOENT', 'EACCES', 'EMFILE', 'ENFILE', 'ENOMEM', 'EAGAIN', 'EINVAL', 'ENOTDIR', 'ENAMETOOLONG', 'ENOEXEC']);
const LIMITS = SOVEREIGN_PROCESS_SESSION_LIMITS_V1;
let activeNativeProcesses = 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const own = (value, key) => Object.hasOwn(value, key);
const boundedTime = (value, maximum) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : maximum;
const evidence = Object.freeze({ executionScope: 'TWO_FIXED_READ_ONLY_DIRECT_CHILD_PROFILES',
  nativeCustodyQualified: false, descendantsExcluded: false, maintenanceCustodyReleased: false });

function fail(operation, blocker, extra = {}) {
  return Object.freeze({ ok: false, schemaVersion: SOVEREIGN_PROCESS_SESSION_SCHEMA_V1,
    operation, blocker, ...(operation === 'START_PROCESS_SESSION' ? { launchState: 'NOT_STARTED', retryAllowed: false } : {}),
    ...evidence, ...extra });
}
function capture(raw, keys) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return null;
    const result = {};
    for (const key of Reflect.ownKeys(raw)) {
      if (typeof key !== 'string' || !keys.includes(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !own(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

export function validateSovereignProcessSessionArgumentsV1(operation, raw) {
  if (!OPERATIONS.has(operation)) return fail(operation, 'SOVEREIGN_PROCESS_OPERATION_INVALID');
  const args = capture(raw, operation === 'START_PROCESS_SESSION' ? ['profile']
    : operation === 'READ_PROCESS_OUTPUT' ? ['sessionId', 'offset', 'limit'] : []);
  if (!args) return fail(operation, 'SOVEREIGN_PROCESS_ARGUMENTS_INVALID');
  if (operation === 'START_PROCESS_SESSION') {
    if (typeof args.profile !== 'string' || !own(SOVEREIGN_PROCESS_SESSION_PROFILES_V1, args.profile))
      return fail(operation, 'SOVEREIGN_PROCESS_PROFILE_INVALID');
  } else if (operation === 'READ_PROCESS_OUTPUT') {
    if (typeof args.sessionId !== 'string' || !ID.test(args.sessionId)) return fail(operation, 'SOVEREIGN_PROCESS_SESSION_ID_INVALID');
    const offset = own(args, 'offset') ? args.offset : 0;
    const limit = own(args, 'limit') ? args.limit : LIMITS.pageDefault;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > LIMITS.outputChunks
      || !Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.pageMax)
      return fail(operation, 'SOVEREIGN_PROCESS_PAGE_INVALID');
    args.offset = offset; args.limit = limit;
  }
  return Object.freeze({ ok: true, args: Object.freeze(args) });
}

function encodedScript(script) {
  // CmdletBinding/param remain the first statements of their own script block.
  // Nothing from the request is interpolated into code or sent as stdin.
  const source = script.toString('base64');
  const wrapper = `$ErrorActionPreference='Stop'\n$PSModuleAutoLoadingPreference='None'\ntry {\n`
    + `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n`
    + `Import-Module '${SYSTEM_MODULES}\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop\n`
    + `Import-Module '${SYSTEM_MODULES}\\Microsoft.PowerShell.Management\\Microsoft.PowerShell.Management.psd1' -ErrorAction Stop\n`
    + `Import-Module '${SYSTEM_MODULES}\\ScheduledTasks\\ScheduledTasks.psd1' -ErrorAction Stop\n`
    + `& ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'))))\n`
    + `} catch { [Console]::Error.WriteLine('SOVEREIGN_PROCESS_PROFILE_FAILED'); exit 2 }`;
  return Buffer.from(wrapper, 'utf16le').toString('base64');
}

/** One private MCP handler owns this state. Options are trusted host/test seams;
 * canonical command admission and transport authentication precede execute().
 * No terminal observation here releases independent native/maintenance custody.
 */
export function createSovereignProcessSessionsV1(options = {}) {
  const sessions = new Map();
  const platform = options.platform || process.platform;
  const ttlMs = boundedTime(options.ttlMs, LIMITS.ttlMs);
  const timeoutMs = boundedTime(options.timeoutMs, LIMITS.processMs);
  const graceMs = boundedTime(options.terminationGraceMs, LIMITS.terminationGraceMs);
  const nowFn = options.nowFn || Date.now;
  let disposed = false, lastNow = 0;
  const now = () => {
    const value = nowFn();
    const safe = Number.isFinite(value) && value >= 0 && value < 8_000_000_000_000_000 ? Math.floor(value) : Date.now();
    return lastNow = Math.max(lastNow, safe);
  };
  const instant = value => value === null ? null : new Date(value).toISOString();
  const snapshot = record => Object.freeze({
    sessionId: record.id, profile: record.profile, state: record.state,
    launchState: record.spawnObserved ? 'SPAWN_OBSERVED' : record.provenNoSpawn ? 'NOT_STARTED' : 'UNKNOWN',
    createdAtUtc: instant(record.createdAt), startedAtUtc: instant(record.startedAt),
    endedAtUtc: instant(record.endedAt), expiresAtUtc: instant(record.expiresAt),
    spawnObserved: record.spawnObserved, rootExitObserved: record.rootExitObserved,
    stdioClosed: record.closed, exitCode: record.exitCode, signal: record.signal,
    outcome: record.outcome, blocker: record.blocker, terminationRequested: !!record.terminationReason,
    terminationUnproven: record.terminationUnproven && !record.closed,
    outputBytesSeen: record.bytesSeen, outputBytesStored: record.bytesStored,
    outputTruncated: record.truncated, nextOffset: record.chunks.length,
    outputComplete: record.closed && record.spawnObserved && !record.truncated && !record.terminationReason && record.decodersFlushed,
    ...evidence,
  });
  const clearPrivate = record => {
    record.hidden = true; record.chunks = []; record.bytesStored = 0; record.decoders = null;
  };
  const prune = () => {
    const at = now();
    for (const [id, record] of sessions) {
      if (at < record.expiresAt) continue;
      clearPrivate(record);
      if (record.closed || record.provenNoSpawn) sessions.delete(id);
      else record.terminate('SOVEREIGN_PROCESS_SESSION_EXPIRED');
      // An expired uncertain child remains a capacity-holding tombstone.
    }
  };

  function start(args) {
    const operation = 'START_PROCESS_SESSION';
    if (platform !== 'win32') return Promise.resolve(fail(operation, 'SOVEREIGN_PROCESS_WINDOWS_REQUIRED'));
    if (sessions.size >= LIMITS.sessions) return Promise.resolve(fail(operation, 'SOVEREIGN_PROCESS_SESSION_CAPACITY_HELD'));
    if (activeNativeProcesses >= LIMITS.nativeConcurrency) return Promise.resolve(fail(operation, 'SOVEREIGN_PROCESS_CAPACITY_HELD'));
    let script, environment;
    try {
      const file = args.profile === 'status-recovery-mesh' ? RECOVERY_SCRIPT : WATCHDOG_SCRIPT;
      script = (options.readFileSyncFn || readFileSync)(file);
      if (!Buffer.isBuffer(script) || digest(script) !== SOVEREIGN_PROCESS_SESSION_PROFILES_V1[args.profile].scriptSha256)
        return Promise.resolve(fail(operation, 'SOVEREIGN_PROCESS_SOURCE_MISMATCH'));
      new TextDecoder('utf-8', { fatal: true }).decode(script);
      environment = { ...createBattleBridgeMinimalChildEnvironment(options.environment || process.env, { platform: 'win32' }), PSModulePath: SYSTEM_MODULES };
      if (typeof environment.USERPROFILE !== 'string' || !environment.USERPROFILE)
        return Promise.resolve(fail(operation, 'SOVEREIGN_PROCESS_HOST_PROFILE_UNAVAILABLE'));
    } catch { return Promise.resolve(fail(operation, 'SOVEREIGN_PROCESS_SOURCE_UNAVAILABLE')); }
    // Capture before launch; mutable checkout bytes cannot be reopened by PS.
    const command = encodedScript(script);
    const createdAt = now();
    const record = { id: `process-${randomUUID()}`, profile: args.profile, state: 'STARTING',
      createdAt, startedAt: null, endedAt: null, expiresAt: createdAt + ttlMs,
      spawnObserved: false, provenNoSpawn: false, rootExitObserved: false, closed: false,
      exitCode: null, signal: null, outcome: 'PENDING', blocker: null, terminationReason: '',
      terminationUnproven: false, chunks: [], bytesSeen: 0, bytesStored: 0, truncated: false,
      hidden: false, decodersFlushed: false,
      decoders: { stdout: new TextDecoder('utf-8', { fatal: true }), stderr: new TextDecoder('utf-8', { fatal: true }) } };
    sessions.set(record.id, record);
    activeNativeProcesses++;
    return new Promise(resolveStart => {
      let child, released = false, startReturned = false, deadline, grace, knownPid = false, streamsReady = false;
      const release = () => { if (!released) { released = true; activeNativeProcesses--; } };
      const finishStart = (ok, blocker) => {
        if (startReturned) return;
        startReturned = true;
        const extra = { sessionId: record.id, session: snapshot(record), launchState: record.spawnObserved
          ? 'SPAWN_OBSERVED' : record.provenNoSpawn ? 'NOT_STARTED' : 'UNKNOWN', retryAllowed: false };
        resolveStart(ok ? Object.freeze({ ok: true, schemaVersion: SOVEREIGN_PROCESS_SESSION_SCHEMA_V1, operation, ...evidence, ...extra })
          : fail(operation, blocker, extra));
      };
      const killOwned = () => { try { child?.kill?.(); } catch {} };
      const stopReading = () => { for (const stream of [child?.stdout, child?.stderr]) { try { stream?.destroy?.(); } catch {} } };
      record.terminate = blocker => {
        if (record.closed || record.provenNoSpawn || record.terminationReason) return;
        record.terminationReason = blocker; record.blocker = blocker;
        record.state = 'UNKNOWN'; record.outcome = 'UNKNOWN';
        clearTimeout(deadline);
        finishStart(false, blocker);
        killOwned();
        if (record.closed) return;
        grace = setTimeout(() => { record.terminationUnproven = !record.closed; }, graceMs);
      };
      const overflow = blocker => {
        if (record.closed || record.provenNoSpawn) return;
        record.truncated = true; record.terminate(blocker); stopReading();
      };
      const appendText = (stream, text) => {
        if (!text || record.hidden || disposed) return;
        let part = '', bytes = 0;
        const push = () => {
          if (!part) return true;
          if (record.chunks.length >= LIMITS.outputChunks || record.bytesStored + bytes > LIMITS.outputBytes) return false;
          record.chunks.push(Object.freeze({ sequence: record.chunks.length, stream, text: part }));
          record.bytesStored += bytes; part = ''; bytes = 0; return true;
        };
        for (const character of text) {
          const size = Buffer.byteLength(character);
          if (bytes + size > LIMITS.chunkBytes && !push()) { overflow('SOVEREIGN_PROCESS_OUTPUT_LIMIT'); return; }
          part += character; bytes += size;
        }
        if (!push()) overflow('SOVEREIGN_PROCESS_OUTPUT_LIMIT');
      };
      const data = (stream, chunk) => {
        if (record.closed || record.hidden || disposed || record.truncated) return;
        let bytes;
        try {
          if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array) && typeof chunk !== 'string') throw Error();
          bytes = Buffer.from(chunk);
          const prior = record.bytesSeen;
          record.bytesSeen = Math.min(Number.MAX_SAFE_INTEGER, prior + bytes.length);
          const allowed = Math.max(0, Math.min(bytes.length, LIMITS.outputBytes - prior));
          if (allowed) appendText(stream, record.decoders[stream].decode(bytes.subarray(0, allowed), { stream: true }));
          if (allowed < bytes.length) overflow('SOVEREIGN_PROCESS_OUTPUT_LIMIT');
        } catch { overflow('SOVEREIGN_PROCESS_OUTPUT_ENCODING_INVALID'); }
      };
      const onError = error => {
        if (record.closed || record.provenNoSpawn) return;
        knownPid ||= Number.isSafeInteger(child?.pid) && child.pid > 0;
        if (!record.spawnObserved && !knownPid && !record.terminationReason && PRESPAWN_ERRORS.has(error?.code)) {
          record.provenNoSpawn = true; record.state = 'FAILED_TO_START'; record.outcome = 'FAILED';
          record.blocker = 'SOVEREIGN_PROCESS_SPAWN_FAILED'; record.endedAt = now(); record.expiresAt = record.endedAt + ttlMs;
          clearTimeout(deadline); clearTimeout(grace); release(); finishStart(false, record.blocker);
        } else record.terminate('SOVEREIGN_PROCESS_EXECUTION_UNPROVEN');
      };
      const onClose = (code, signal) => {
        if (record.closed) return;
        clearTimeout(deadline); clearTimeout(grace); release();
        if (!record.hidden && !disposed && !record.truncated && record.decoders) {
          try {
            appendText('stdout', record.decoders.stdout.decode());
            appendText('stderr', record.decoders.stderr.decode());
            record.decodersFlushed = !record.truncated;
          } catch { record.truncated = true; record.blocker ||= 'SOVEREIGN_PROCESS_OUTPUT_ENCODING_INVALID'; }
        }
        record.closed = true; record.decoders = null; record.endedAt = now(); record.expiresAt = record.endedAt + ttlMs;
        record.exitCode = Number.isInteger(code) ? code : null;
        record.signal = typeof signal === 'string' && /^SIG[A-Z0-9]{1,24}$/.test(signal) ? signal : null;
        if (record.spawnObserved && (record.exitCode !== null || record.signal)) record.rootExitObserved = true;
        if (!record.provenNoSpawn) {
          record.state = 'CLOSED';
          record.outcome = !record.spawnObserved || record.terminationReason || record.blocker || record.signal || record.exitCode === null
            ? 'UNKNOWN' : record.exitCode === 0 ? 'SUCCEEDED' : 'FAILED';
        }
        finishStart(false, record.blocker || 'SOVEREIGN_PROCESS_SPAWN_UNPROVEN');
        if (record.hidden) sessions.delete(record.id);
      };
      try {
        child = (options.spawnFn || spawn)(SOVEREIGN_PROCESS_SESSION_EXECUTABLE_V1,
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', command],
          { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
      } catch {
        // The returned handle is absent; a synchronous exception cannot prove
        // the OS did not create a process. Admission remains held permanently.
        record.state = 'UNKNOWN'; record.outcome = 'UNKNOWN'; record.terminationUnproven = true;
        record.blocker = 'SOVEREIGN_PROCESS_SPAWN_UNPROVEN'; finishStart(false, record.blocker); return;
      }
      try {
        knownPid = Number.isSafeInteger(child?.pid) && child.pid > 0;
        // Observe lifecycle before touching pipes: EMFILE can return null stdio.
        child.on('error', onError);
        child.once('close', onClose);
        child.once('exit', (code, signal) => {
          if (record.closed || record.provenNoSpawn) return;
          record.rootExitObserved = true;
          record.exitCode = Number.isInteger(code) ? code : null;
          record.signal = typeof signal === 'string' && /^SIG[A-Z0-9]{1,24}$/.test(signal) ? signal : null;
          if (!record.terminationReason) record.state = 'ROOT_EXITED';
        });
        child.once('spawn', () => {
          if (record.closed || record.provenNoSpawn) return;
          record.spawnObserved = true; knownPid = true; record.startedAt = now();
          if (!streamsReady) {
            record.terminate('SOVEREIGN_PROCESS_SETUP_UNPROVEN'); killOwned();
            finishStart(false, record.blocker); return;
          }
          if (disposed || record.hidden || record.terminationReason) {
            record.terminate(disposed ? 'SOVEREIGN_PROCESS_SESSION_CLOSED' : 'SOVEREIGN_PROCESS_EXECUTION_UNPROVEN');
            killOwned(); finishStart(false, record.blocker || 'SOVEREIGN_PROCESS_SESSION_CLOSED'); return;
          }
          record.state = 'RUNNING'; finishStart(true);
        });
        if (record.closed || record.provenNoSpawn) return;
        deadline = setTimeout(() => record.terminate('SOVEREIGN_PROCESS_TIME_LIMIT'), timeoutMs);
        if (!child.stdout || typeof child.stdout.on !== 'function' || !child.stderr || typeof child.stderr.on !== 'function') {
          // Await the genuine pre-spawn error when no process identity exists.
          if (knownPid) record.terminate('SOVEREIGN_PROCESS_SETUP_UNPROVEN');
          return;
        }
        child.stdout.on('error', () => overflow('SOVEREIGN_PROCESS_STREAM_UNPROVEN'));
        child.stderr.on('error', () => overflow('SOVEREIGN_PROCESS_STREAM_UNPROVEN'));
        child.stdout.on('data', bytes => data('stdout', bytes));
        child.stderr.on('data', bytes => data('stderr', bytes));
        streamsReady = true;
      } catch { record.terminate('SOVEREIGN_PROCESS_SETUP_UNPROVEN'); }
    });
  }

  async function execute(operation, raw) {
    const validated = validateSovereignProcessSessionArgumentsV1(operation, raw);
    if (!validated.ok) return validated;
    if (disposed) return fail(operation, 'SOVEREIGN_PROCESS_SESSION_CLOSED');
    prune();
    const args = validated.args;
    if (operation === 'START_PROCESS_SESSION') return start(args);
    const base = { ok: true, schemaVersion: SOVEREIGN_PROCESS_SESSION_SCHEMA_V1, operation, ...evidence };
    if (operation === 'LIST_SESSIONS') return Object.freeze({ ...base,
      sessions: Object.freeze([...sessions.values()].filter(record => !record.hidden).map(snapshot)) });
    const record = sessions.get(args.sessionId);
    if (!record || record.hidden) return fail(operation, 'SOVEREIGN_PROCESS_SESSION_UNAVAILABLE');
    if (args.offset > record.chunks.length) return fail(operation, 'SOVEREIGN_PROCESS_OFFSET_UNAVAILABLE');
    const session = snapshot(record), chunks = [];
    const page = () => ({ ...base, sessionId: record.id, session, chunks,
      offset: args.offset, nextOffset: args.offset + chunks.length,
      hasMore: args.offset + chunks.length < record.chunks.length,
      outputComplete: session.outputComplete, outputTruncated: record.truncated });
    for (let index = args.offset; index < record.chunks.length && chunks.length < args.limit; index++) {
      chunks.push(record.chunks[index]);
      if (Buffer.byteLength(JSON.stringify(page())) > LIMITS.pageBytes) { chunks.pop(); break; }
    }
    return Object.freeze({ ...page(), chunks: Object.freeze([...chunks]) });
  }
  async function dispose() {
    if (disposed) return Object.freeze({ disposed: true, ...evidence });
    disposed = true;
    for (const record of sessions.values()) {
      clearPrivate(record);
      if (!record.closed && !record.provenNoSpawn) record.terminate('SOVEREIGN_PROCESS_SESSION_CLOSED');
    }
    sessions.clear();
    return Object.freeze({ disposed: true, ...evidence });
  }
  return Object.freeze({ execute, dispose });
}
