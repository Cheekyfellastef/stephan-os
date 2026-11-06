import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_SEARCH_SESSION_SCHEMA = 'stephanos.sovereign-search-session.v1';
export const SOVEREIGN_SEARCH_LIMITS = Object.freeze({
  sessions: 4, ttlMs: 300_000, pageSize: 50, defaultPageSize: 20, pageBytes: 12_288,
  results: 1000, entries: 10_000, files: 1000, fileBytes: 262_144,
  totalBytes: 16_777_216, resultBytes: 524_288, depth: 12, scanMs: 5000,
  processMs: 20_000, outputBytes: 786_432, nativeConcurrency: 2,
});
const SNAPSHOT_SCHEMA = 'stephanos.sovereign-search-snapshot.v1';
const CONFINEMENT = 'WINDOWS_HANDLE_RELATIVE_NO_REPARSE';
const CONSISTENCY = 'BOUNDED_OBSERVATION_NOT_ATOMIC_TREE_SNAPSHOT';
const SCRIPT = fileURLToPath(new URL('../../scripts/windows/sovereign-search.ps1', import.meta.url));
const NATIVE = fileURLToPath(new URL('../../scripts/windows/SovereignSearchV1.cs', import.meta.url));
const SCRIPT_SHA256 = 'bb4f33157ae1acf5d8062a83a4be86c4f6a08c56d03f995d2de800fab1620846';
const NATIVE_SHA256 = '7e3d3308fbaea77f6eeab8315034961b27558c9deeec9d535b94e770e8f6e55b';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SESSION_ID = /^search-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const IDENTITY = /^[a-f0-9]{8}:[a-f0-9]{16}$/;
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.config',
  '.codex', '.openclaw', '.claude', '.gemini', '.pki', '.password-store',
  'secrets', '.secrets', 'credentials', '.credentials', 'openai-secure-mcp-tunnel',
  'appdata', 'programdata', 'windows', 'program files', 'program files (x86)',
  '$recycle.bin', 'system volume information', 'recovery',
  'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]);
const SENSITIVE_FILE = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|credentials(?:\..+)?|secrets?(?:\..+)?|auth\.json|tokens?(?:\..+)?|Cookies|Login Data|Web Data)$|\.(?:key|pem|pfx|p12|kdbx|dpapi)$/i;
const REASONS = new Set([
  'TIME_LIMIT', 'ENTRY_LIMIT', 'FILE_LIMIT', 'FILE_SIZE_LIMIT', 'BYTE_LIMIT',
  'RESULT_LIMIT', 'RESULT_BYTE_LIMIT', 'DEPTH_LIMIT', 'PATH_LENGTH_LIMIT',
  'ACCESS_DENIED', 'ENTRY_CHANGED_OR_BUSY', 'READ_FAILED', 'OBJECT_PATH_UNPROVEN',
  'HARD_LINK_EXCLUDED', 'LINK_OR_NONREGULAR_EXCLUDED', 'SENSITIVE_ENTRY_EXCLUDED',
  'BUILD_TREE_EXCLUDED', 'BINARY_OR_NON_UTF8_EXCLUDED', 'INVALID_ENTRY_NAME_EXCLUDED',
  'FILE_CHANGED_DURING_READ',
]);
const TERMINAL = new Set(['COMPLETED', 'INCOMPLETE', 'FAILED', 'CANCELLED']);
// Admission count only: search IDs, paths, queries and results never cross
// handler boundaries. There is no waiting queue or retry worker.
let activeNativeSearches = 0;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const validBlocker = value => typeof value === 'string' && value.length <= 96 && /^SOVEREIGN_SEARCH_[A-Z_]+$/.test(value);
const blocked = blocker => ({ ok: false, schemaVersion: SOVEREIGN_SEARCH_SESSION_SCHEMA, blocker });
function plain(object, allowed) {
  return !!object && typeof object === 'object' && !Array.isArray(object)
    && Object.getPrototypeOf(object) === Object.prototype
    && Reflect.ownKeys(object).every(key => typeof key === 'string' && allowed.includes(key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(object, key), 'value'));
}
function validPart(part) {
  return part.length > 0 && part.length <= 255 && part !== '.' && part !== '..'
    && !/[ .]$/.test(part) && !/[\x00-\x1f<>:"/\\|?*~]/.test(part)
    && !/^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part);
}
function validateScope(path) {
  if (typeof path !== 'string' || path !== path.trim() || path.length > 1024
    || !/^[a-z]:\\[^\\]/i.test(path)) return 'SOVEREIGN_SEARCH_SCOPE_INVALID';
  const parts = path.slice(3).split('\\');
  if (parts.length > 64 || parts.some(part => !validPart(part))) return 'SOVEREIGN_SEARCH_SCOPE_INVALID';
  if (parts.some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()) || SENSITIVE_FILE.test(part))) return 'SOVEREIGN_SEARCH_SCOPE_EXCLUDED';
  return '';
}

// This validates raw data before the execution fabric can trim/coerce a scope.
// Dependencies and platform/process controls are never accepted as tool args.
export function validateSovereignSearchArgumentsV1(operation, raw) {
  if (operation === 'START_SEARCH') {
    if (!plain(raw, ['path', 'query', 'mode', 'caseSensitive', 'limit'])
      || !Object.hasOwn(raw, 'path') || !Object.hasOwn(raw, 'query')) return blocked('SOVEREIGN_SEARCH_ARGUMENTS_INVALID');
    const invalidScope = validateScope(raw.path);
    if (invalidScope) return blocked(invalidScope);
    if (typeof raw.query !== 'string' || raw.query.length < 1 || raw.query.length > 200 || /[\x00-\x1f\x7f]/.test(raw.query))
      return blocked('SOVEREIGN_SEARCH_QUERY_INVALID');
    const mode = raw.mode ?? 'content', caseSensitive = raw.caseSensitive ?? false;
    const limit = raw.limit ?? SOVEREIGN_SEARCH_LIMITS.defaultPageSize;
    if ((Object.hasOwn(raw, 'mode') && raw.mode == null) || !['file', 'content'].includes(mode)) return blocked('SOVEREIGN_SEARCH_MODE_INVALID');
    if ((Object.hasOwn(raw, 'caseSensitive') && raw.caseSensitive == null) || typeof caseSensitive !== 'boolean'
      || (Object.hasOwn(raw, 'limit') && raw.limit == null) || !integer(limit, 1, SOVEREIGN_SEARCH_LIMITS.pageSize))
      return blocked('SOVEREIGN_SEARCH_ARGUMENTS_INVALID');
    return { ok: true, args: Object.freeze({ path: raw.path, query: raw.query, mode, caseSensitive, limit }) };
  }
  if (operation === 'LIST_SEARCHES') return plain(raw, [])
    ? { ok: true, args: Object.freeze({}) } : blocked('SOVEREIGN_SEARCH_ARGUMENTS_INVALID');
  if (operation !== 'GET_MORE_SEARCH_RESULTS' && operation !== 'STOP_SEARCH') return blocked('SOVEREIGN_SEARCH_OPERATION_INVALID');
  const keys = operation === 'STOP_SEARCH' ? ['searchId'] : ['searchId', 'offset', 'limit'];
  if (!plain(raw, keys) || !Object.hasOwn(raw, 'searchId') || typeof raw.searchId !== 'string' || !SESSION_ID.test(raw.searchId)) return blocked('SOVEREIGN_SEARCH_ARGUMENTS_INVALID');
  if (operation === 'STOP_SEARCH') return { ok: true, args: Object.freeze({ searchId: raw.searchId }) };
  const offset = raw.offset ?? 0, limit = raw.limit ?? SOVEREIGN_SEARCH_LIMITS.defaultPageSize;
  if ((Object.hasOwn(raw, 'offset') && raw.offset == null) || (Object.hasOwn(raw, 'limit') && raw.limit == null)
    || !integer(offset, 0, SOVEREIGN_SEARCH_LIMITS.results) || !integer(limit, 1, SOVEREIGN_SEARCH_LIMITS.pageSize))
    return blocked('SOVEREIGN_SEARCH_ARGUMENTS_INVALID');
  return { ok: true, args: Object.freeze({ searchId: raw.searchId, offset, limit }) };
}

function validateSnapshot(raw, request) {
  const keys = ['schemaVersion', 'ok', 'complete', 'path', 'query', 'mode', 'caseSensitive', 'scopeIdentity',
    'confinement', 'snapshotConsistency', 'reasons', 'stats', 'results'];
  if (!plain(raw, keys) || keys.some(key => !Object.hasOwn(raw, key)) || raw.schemaVersion !== SNAPSHOT_SCHEMA || raw.ok !== true
    || raw.path !== request.path || raw.query !== request.query || raw.mode !== request.mode
    || raw.caseSensitive !== request.caseSensitive || raw.confinement !== CONFINEMENT
    || raw.snapshotConsistency !== CONSISTENCY || !IDENTITY.test(raw.scopeIdentity || '')
    || typeof raw.complete !== 'boolean' || !Array.isArray(raw.reasons) || raw.reasons.length > REASONS.size
    || raw.reasons.some(reason => !REASONS.has(reason)) || new Set(raw.reasons).size !== raw.reasons.length
    || raw.complete !== (raw.reasons.length === 0) || !Array.isArray(raw.results)
    || raw.results.length > SOVEREIGN_SEARCH_LIMITS.results) return null;
  const stats = raw.stats;
  const statCaps = { entriesVisited: SOVEREIGN_SEARCH_LIMITS.entries, filesVisited: SOVEREIGN_SEARCH_LIMITS.files,
    bytesRead: SOVEREIGN_SEARCH_LIMITS.totalBytes, resultBytes: SOVEREIGN_SEARCH_LIMITS.resultBytes,
    resultsCount: SOVEREIGN_SEARCH_LIMITS.results, durationMs: SOVEREIGN_SEARCH_LIMITS.processMs };
  if (!plain(stats, Object.keys(statCaps)) || Object.entries(statCaps).some(([key, max]) => !Object.hasOwn(stats, key) || !integer(stats[key], 0, max))
    || stats.resultsCount !== raw.results.length || bytes(raw.results) > SOVEREIGN_SEARCH_LIMITS.resultBytes) return null;
  const results = [];
  for (const result of raw.results) {
    const resultKeys = ['path', 'relativePath', 'type', 'line', 'column', 'preview'];
    if (!plain(result, resultKeys) || resultKeys.some(key => !Object.hasOwn(result, key))
      || result.type !== 'file' || typeof result.relativePath !== 'string'
      || result.relativePath.split('\\').some(part => !validPart(part))
      || result.path !== `${request.path}\\${result.relativePath}` || result.path.length > 1024
      || result.relativePath.split('\\').some(part => SENSITIVE_FILE.test(part))
      || result.relativePath.split('\\').slice(0, -1).some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()))) return null;
    if (request.mode === 'content') {
      if (!integer(result.line, 1, SOVEREIGN_SEARCH_LIMITS.fileBytes + 1)
        || !integer(result.column, 1, SOVEREIGN_SEARCH_LIMITS.fileBytes + 1)
        || typeof result.preview !== 'string' || result.preview.length > 240 || result.preview.includes('\0')) return null;
      results.push(Object.freeze({ path: result.path, relativePath: result.relativePath, type: 'file',
        line: result.line, column: result.column, preview: result.preview }));
    } else {
      if (result.line != null || result.column != null || result.preview != null) return null;
      results.push(Object.freeze({ path: result.path, relativePath: result.relativePath, type: 'file' }));
    }
  }
  return Object.freeze({ complete: raw.complete, reasons: Object.freeze([...raw.reasons]),
    stats: Object.freeze({ ...stats }), scopeIdentity: raw.scopeIdentity, results: Object.freeze(results) });
}

// A fixed, source-captured helper. No search parameter is a command-line token,
// shell expression, script pathname or selectable executable.
export async function runSovereignNativeSearchV1(request, options = {}) {
  const failure = (blocker, extra = {}) => ({ ok: false, blocker, ...extra });
  const validation = validateSovereignSearchArgumentsV1('START_SEARCH', request);
  if (!validation.ok) return failure(validation.blocker);
  request = validation.args;
  if ((options.platform || process.platform) !== 'win32') return failure('SOVEREIGN_SEARCH_WINDOWS_REQUIRED');
  let script, nativeSource;
  try {
    const read = options.readFileSyncFn || readFileSync;
    script = read(SCRIPT); nativeSource = read(NATIVE);
    if (hash(script) !== SCRIPT_SHA256 || hash(nativeSource) !== NATIVE_SHA256) return failure('SOVEREIGN_SEARCH_SOURCE_MISMATCH');
  } catch { return failure('SOVEREIGN_SEARCH_SOURCE_UNAVAILABLE'); }
  if (options.signal?.aborted) return failure('SOVEREIGN_SEARCH_CANCELLED', { cancellationConfirmed: true });
  if (activeNativeSearches >= SOVEREIGN_SEARCH_LIMITS.nativeConcurrency) return failure('SOVEREIGN_SEARCH_NATIVE_CAPACITY_HELD');
  activeNativeSearches++;
  return new Promise(resolve => {
    let child, finished = false, spawned = false, slotReleased = false;
    let cancelRequested = false, terminationReason = '', output = [], outputSize = 0;
    let deadline, terminationDeadline;
    const releaseSlot = () => { if (!slotReleased) { slotReleased = true; activeNativeSearches--; } };
    const reportState = value => { try { options.onState?.(value); } catch {} };
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(terminationDeadline);
      options.signal?.removeEventListener('abort', cancel);
      resolve(result);
    };
    const terminate = reason => {
      if (finished || terminationReason) return;
      terminationReason = reason;
      try { child.kill(); } catch {}
      if (finished) return;
      // A kill request is not proof of exit. Keep both Promise and process
      // admission until close; only the nonterminal observation changes.
      terminationDeadline = setTimeout(() => { if (!finished) reportState({ status: 'TERMINATION_UNPROVEN',
        blocker: 'SOVEREIGN_SEARCH_TERMINATION_UNPROVEN' }); }, 2000);
      terminationDeadline.unref?.();
    };
    const cancel = () => { cancelRequested = true; terminate('SOVEREIGN_SEARCH_CANCELLED'); };
    try {
      child = (options.spawnFn || spawn)(POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script.toString('utf8'), 'utf16le').toString('base64')],
        { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...createBattleBridgeMinimalChildEnvironment(options.environment || process.env),
            PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
    } catch { releaseSlot(); finish(failure('SOVEREIGN_SEARCH_SPAWN_FAILED')); return; }
    spawned = Number.isSafeInteger(child.pid) && child.pid > 0;
    child.once('spawn', () => { spawned = true; });
    child.on('error', () => {
      // Node also emits error when kill/send fails after a successful spawn.
      if (!spawned && !(Number.isSafeInteger(child.pid) && child.pid > 0)) {
        releaseSlot(); finish(failure('SOVEREIGN_SEARCH_SPAWN_FAILED'));
      } else terminate('SOVEREIGN_SEARCH_PROCESS_ERROR');
    });
    child.stdout.on('data', chunk => {
      outputSize += Buffer.byteLength(chunk);
      if (outputSize > SOVEREIGN_SEARCH_LIMITS.outputBytes) { output = []; terminate('SOVEREIGN_SEARCH_OUTPUT_LIMIT'); }
      else if (!terminationReason) output.push(Buffer.from(chunk));
    });
    // Never return native stderr, which can contain machine paths or source text.
    child.stderr.on('data', chunk => {
      outputSize += Buffer.byteLength(chunk);
      if (outputSize > SOVEREIGN_SEARCH_LIMITS.outputBytes) terminate('SOVEREIGN_SEARCH_OUTPUT_LIMIT');
    });
    child.once('close', (code, signal) => {
      releaseSlot();
      if (cancelRequested) { finish(failure('SOVEREIGN_SEARCH_CANCELLED', { cancellationConfirmed: true })); return; }
      if (terminationReason) { finish(failure(terminationReason)); return; }
      if (signal || !Number.isInteger(code)) { finish(failure('SOVEREIGN_SEARCH_TERMINAL_UNPROVEN')); return; }
      let receipt;
      try { receipt = JSON.parse(Buffer.concat(output).toString('utf8').trim()); } catch {}
      if (code === 0 && receipt?.schemaVersion === SNAPSHOT_SCHEMA && receipt.ok === true) { finish(receipt); return; }
      finish(failure(receipt?.schemaVersion === SNAPSHOT_SCHEMA && validBlocker(receipt.blocker)
        ? receipt.blocker : 'SOVEREIGN_SEARCH_NATIVE_FAILED'));
    });
    child.stdin.on('error', () => terminate('SOVEREIGN_SEARCH_INPUT_FAILED'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    deadline = setTimeout(() => terminate('SOVEREIGN_SEARCH_TIME_LIMIT'), SOVEREIGN_SEARCH_LIMITS.processMs);
    deadline.unref?.();
    try { child.stdin.end(JSON.stringify({ path: request.path, query: request.query, mode: request.mode,
      caseSensitive: request.caseSensitive, nativeSource: nativeSource.toString('utf8') })); }
    catch { terminate('SOVEREIGN_SEARCH_INPUT_FAILED'); }
  });
}

// One factory belongs to one authenticated MCP handler. No global result store,
// durable queue, worker, source lease or cross-handler lookup is introduced.
export function createSovereignSearchSessionsV1(options = {}) {
  const sessions = new Map();
  const now = options.now || Date.now;
  const scan = options.scanFn || ((request, controls) => runSovereignNativeSearchV1(request, { ...options, ...controls }));
  let disposed = false;
  const expire = () => {
    const time = now();
    for (const [id, session] of sessions) {
      if (time >= session.expiresAt) {
        session.controller.abort();
        if (session.processPending) { session.expired = true; session.snapshot = null; session.request = null; }
        else sessions.delete(id);
      }
    }
  };
  const summary = session => ({ searchId: session.id, path: session.request.path,
    mode: session.request.mode, status: session.status, complete: session.snapshot?.complete === true,
    resultSetFinal: TERMINAL.has(session.status), cancelRequested: session.cancelRequested,
    createdAt: new Date(session.createdAt).toISOString(), expiresAt: new Date(session.expiresAt).toISOString(),
    totalResults: session.snapshot?.results.length || 0,
    reasons: session.snapshot ? [...session.snapshot.reasons] : [],
    ...(session.blocker ? { blocker: session.blocker } : {}),
    ...(session.snapshot ? { stats: { ...session.snapshot.stats }, scopeIdentity: session.snapshot.scopeIdentity,
      confinement: CONFINEMENT, snapshotConsistency: CONSISTENCY } : {}),
  });
  const page = (session, offset, limit) => {
    const all = session.snapshot?.results || [];
    if (offset > all.length) return blocked('SOVEREIGN_SEARCH_OFFSET_OUT_OF_RANGE');
    const result = { ok: true, schemaVersion: SOVEREIGN_SEARCH_SESSION_SCHEMA, ...summary(session),
      offset, nextOffset: offset, hasMore: offset < all.length, results: [] };
    for (let i = offset; i < all.length && result.results.length < limit; i++) {
      result.results.push({ ...all[i] });
      if (bytes(result) > SOVEREIGN_SEARCH_LIMITS.pageBytes - 128) { result.results.pop(); break; }
    }
    result.nextOffset = offset + result.results.length;
    result.hasMore = result.nextOffset < all.length;
    return result;
  };
  const complete = (session, receipt) => {
    if (disposed || sessions.get(session.id) !== session) return;
    session.processPending = false;
    if (session.expired) { sessions.delete(session.id); return; }
    if (receipt?.ok !== true) {
      session.status = session.cancelRequested && receipt?.cancellationConfirmed === true ? 'CANCELLED' : 'FAILED';
      session.blocker = validBlocker(receipt?.blocker)
        ? receipt.blocker : 'SOVEREIGN_SEARCH_NATIVE_FAILED';
      return;
    }
    const snapshot = validateSnapshot(receipt, session.request);
    if (!snapshot) { session.status = 'FAILED'; session.blocker = 'SOVEREIGN_SEARCH_RECEIPT_INVALID'; return; }
    session.snapshot = snapshot;
    session.status = snapshot.complete ? 'COMPLETED' : 'INCOMPLETE';
  };
  return Object.freeze({
    async execute(operation, raw = {}) {
      if (disposed) return blocked('SOVEREIGN_SEARCH_HANDLER_CLOSED');
      const validation = validateSovereignSearchArgumentsV1(operation, raw);
      if (!validation.ok) return validation;
      expire();
      const args = validation.args;
      if (operation === 'LIST_SEARCHES') return { ok: true, schemaVersion: SOVEREIGN_SEARCH_SESSION_SCHEMA,
        searches: [...sessions.values()].filter(session => !session.expired).map(summary),
        limits: { sessions: SOVEREIGN_SEARCH_LIMITS.sessions, ttlMs: SOVEREIGN_SEARCH_LIMITS.ttlMs,
          nativeConcurrency: SOVEREIGN_SEARCH_LIMITS.nativeConcurrency } };
      if (operation === 'START_SEARCH') {
        if (sessions.size >= SOVEREIGN_SEARCH_LIMITS.sessions) return blocked('SOVEREIGN_SEARCH_SESSION_LIMIT');
        const createdAt = now();
        const session = { id: `search-${randomUUID()}`, request: args, createdAt,
          expiresAt: createdAt + SOVEREIGN_SEARCH_LIMITS.ttlMs, status: 'RUNNING',
          cancelRequested: false, controller: new AbortController(), snapshot: null, blocker: '',
          processPending: true, expired: false };
        sessions.set(session.id, session);
        Promise.resolve().then(() => scan(args, { signal: session.controller.signal, onState: state => {
          if (!disposed && sessions.get(session.id) === session && !session.expired
            && session.processPending && state?.status === 'TERMINATION_UNPROVEN') {
            session.status = 'TERMINATION_UNPROVEN'; session.blocker = 'SOVEREIGN_SEARCH_TERMINATION_UNPROVEN';
          }
        } }))
          .then(receipt => complete(session, receipt), () => complete(session, { ok: false, blocker: 'SOVEREIGN_SEARCH_NATIVE_FAILED' }));
        return page(session, 0, args.limit);
      }
      const session = sessions.get(args.searchId);
      // Foreign, missing and expired IDs deliberately have one indistinguishable response.
      if (!session || session.expired) return blocked('SOVEREIGN_SEARCH_SESSION_UNAVAILABLE');
      if (operation === 'STOP_SEARCH') {
        if (TERMINAL.has(session.status)) {
          sessions.delete(session.id);
          return { ok: true, schemaVersion: SOVEREIGN_SEARCH_SESSION_SCHEMA, ...summary(session), released: true };
        }
        if (!TERMINAL.has(session.status)) {
          session.cancelRequested = true; session.status = 'CANCEL_REQUESTED'; session.controller.abort();
        }
        return { ok: true, schemaVersion: SOVEREIGN_SEARCH_SESSION_SCHEMA, ...summary(session) };
      }
      return page(session, args.offset, args.limit);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const session of sessions.values()) session.controller.abort();
      sessions.clear();
    },
  });
}
