import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_FILE_MOVE_SCHEMA_V1 = 'stephanos.sovereign-file-move.v1';
export const SOVEREIGN_FILE_MOVE_HASH_SEMANTICS_V1 = 'BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS';
export const SOVEREIGN_FILE_MOVE_LIMITS_V1 = Object.freeze({
  fileBytes: 8_388_608, totalReadBytes: 16_777_216, nativeMs: 5000,
  processMs: 20_000, terminationGraceMs: 2000, outputBytes: 32_768, nativeConcurrency: 1,
});
const SCRIPT = fileURLToPath(new URL('../../scripts/windows/sovereign-move-file.ps1', import.meta.url));
const NATIVE = fileURLToPath(new URL('../../scripts/windows/SovereignFileMoveV1.cs', import.meta.url));
const SCRIPT_SHA256 = 'c7244239f67d708f979c6d76c85962ba4ba34519dd8ef2577709466b78502e51';
const NATIVE_SHA256 = 'c0980126d050631d9788ceeee2631ecb78f0c4780c52baee6f9bb90f6c287bbf';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const IDENTITY = /^[a-f0-9]{8}:[a-f0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.config',
  '.codex', '.openclaw', '.claude', '.gemini', '.pki', '.password-store',
  'secrets', '.secrets', 'credentials', '.credentials', 'openai-secure-mcp-tunnel',
  'appdata', 'programdata', 'windows', 'program files', 'program files (x86)',
  '$recycle.bin', 'system volume information', 'recovery',
  'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]);
const SENSITIVE_FILE = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|credentials(?:\..+)?|secrets?(?:\..+)?|auth\.json|tokens?(?:\..+)?|Cookies|Login Data|Web Data)$|\.(?:key|pem|pfx|p12|kdbx|dpapi)$/i;
// Admission only, with no queue, persistent store, task owner or retry worker.
// A missing child exit keeps this slot held even after UNKNOWN is returned.
let activeNativeMoves = 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const validBlocker = value => typeof value === 'string' && value.length <= 96 && /^SOVEREIGN_MOVE_[A-Z_]+$/.test(value);
const blocked = (blocker, mutationState = 'NOT_STARTED', evidence = {}) => Object.freeze({
  ok: false, schemaVersion: SOVEREIGN_FILE_MOVE_SCHEMA_V1, blocker, mutationState,
  stage: mutationState === 'NOT_STARTED' ? 'PRECONDITION' : 'PROCESS_TERMINAL_UNPROVEN',
  mutationAttempted: mutationState === 'NOT_STARTED' ? false : null,
  hashSemantics: SOVEREIGN_FILE_MOVE_HASH_SEMANTICS_V1, mappedWriterExclusionProven: false,
  retryAllowed: false, ...evidence,
});
function plain(value, allowed) {
  try {
    return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype
      && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
        && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
  } catch { return false; }
}
function validPart(part) {
  return part.length > 0 && part.length <= 255 && part !== '.' && part !== '..'
    && part.isWellFormed()
    && !/[ .]$/.test(part) && !/[\x00-\x1f<>:"/\\|?*~]/.test(part)
    && !/^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part);
}
function validatePath(path) {
  if (typeof path !== 'string' || path !== path.trim() || path.length > 1024
    || !/^[a-z]:\\[^\\]/i.test(path)) return 'SOVEREIGN_MOVE_PATH_INVALID';
  const parts = path.slice(3).split('\\');
  if (parts.length > 64 || parts.some(part => !validPart(part))) return 'SOVEREIGN_MOVE_PATH_INVALID';
  if (parts.some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()) || SENSITIVE_FILE.test(part)))
    return 'SOVEREIGN_MOVE_PATH_EXCLUDED';
  return '';
}

export function validateSovereignFileMoveArgumentsV1(raw) {
  if (!plain(raw, ['source', 'destination', 'expectedSha256'])
    || !['source', 'destination', 'expectedSha256'].every(key => Object.hasOwn(raw, key)))
    return blocked('SOVEREIGN_MOVE_ARGUMENTS_INVALID');
  const invalid = validatePath(raw.source) || validatePath(raw.destination);
  if (invalid) return blocked(invalid);
  if (typeof raw.expectedSha256 !== 'string' || !SHA256.test(raw.expectedSha256)) return blocked('SOVEREIGN_MOVE_HASH_REQUIRED');
  if (raw.source.toLowerCase() === raw.destination.toLowerCase()) return blocked('SOVEREIGN_MOVE_SAME_PATH_OR_CASE_ALIAS');
  if (raw.source.slice(0, raw.source.lastIndexOf('\\')).toLowerCase()
    !== raw.destination.slice(0, raw.destination.lastIndexOf('\\')).toLowerCase())
    return blocked('SOVEREIGN_MOVE_CROSS_DIRECTORY_UNQUALIFIED');
  return Object.freeze({ ok: true, args: Object.freeze({
    source: raw.source, destination: raw.destination, expectedSha256: raw.expectedSha256,
  }) });
}

function normalizeReceipt(receipt, status, request) {
  const common = ['schemaVersion', 'ok', 'source', 'destination', 'identity', 'mutationState', 'stage',
    'mutationAttempted', 'hashSemantics', 'mappedWriterExclusionProven', 'retryAllowed'];
  const success = ['moved', 'atomicRename', 'overwritten', 'sameParent', 'filesystem', 'sha256',
    'sourceParentIdentity', 'destinationParentIdentity', 'bytes', 'bytesRead', 'durationMs'];
  const failure = ['blocker'];
  if (!plain(receipt, [...common, ...success, ...failure]) || common.some(key => !Object.hasOwn(receipt, key))
    || receipt.schemaVersion !== SOVEREIGN_FILE_MOVE_SCHEMA_V1
    || receipt.source !== request.source || receipt.destination !== request.destination
    || receipt.hashSemantics !== SOVEREIGN_FILE_MOVE_HASH_SEMANTICS_V1
    || receipt.mappedWriterExclusionProven !== false || receipt.retryAllowed !== false) return null;
  if (receipt.ok === false && status === 2) {
    if (!plain(receipt, [...common, ...failure]) || !validBlocker(receipt.blocker)
      || (receipt.identity !== null && !IDENTITY.test(receipt.identity || ''))) return null;
    const notStarted = receipt.mutationState === 'NOT_STARTED' && receipt.mutationAttempted === false && receipt.stage === 'PRECONDITION';
    const unknown = receipt.mutationState === 'UNKNOWN' && receipt.mutationAttempted === true
      && ['NATIVE_RENAME', 'POSTCONDITION'].includes(receipt.stage);
    if (!notStarted && !unknown) return null;
    return blocked(receipt.blocker, receipt.mutationState, {
      source: request.source, destination: request.destination, identity: receipt.identity,
      stage: receipt.stage, mutationAttempted: receipt.mutationAttempted,
    });
  }
  if (receipt.ok !== true || status !== 0 || !plain(receipt, [...common, ...success])
    || success.some(key => !Object.hasOwn(receipt, key)) || receipt.moved !== true
    || receipt.mutationState !== 'MOVED' || receipt.mutationAttempted !== true || receipt.stage !== 'POSTCONDITION'
    || receipt.atomicRename !== true || receipt.overwritten !== false || receipt.sameParent !== true
    || receipt.filesystem !== 'NTFS' || receipt.sha256 !== request.expectedSha256
    || !IDENTITY.test(receipt.identity || '') || !IDENTITY.test(receipt.sourceParentIdentity || '')
    || receipt.destinationParentIdentity !== receipt.sourceParentIdentity
    || receipt.identity.slice(0, 8) !== receipt.sourceParentIdentity.slice(0, 8)
    || !integer(receipt.bytes, SOVEREIGN_FILE_MOVE_LIMITS_V1.fileBytes)
    || !integer(receipt.bytesRead, SOVEREIGN_FILE_MOVE_LIMITS_V1.totalReadBytes)
    || receipt.bytesRead !== receipt.bytes * 2
    || !integer(receipt.durationMs, SOVEREIGN_FILE_MOVE_LIMITS_V1.nativeMs)) return null;
  return Object.freeze({ ...receipt });
}

// Private authenticated callers supply one explicit pair and observed hash.
// Dependencies, clocks, cancellation and process controls are trusted options;
// no JSON tool argument can select executable/script bytes or widen the scope.
export async function runSovereignFileMoveV1(request, options = {}) {
  const validation = validateSovereignFileMoveArgumentsV1(request);
  if (!validation.ok) return validation;
  request = validation.args;
  if ((options.platform || process.platform) !== 'win32') return blocked('SOVEREIGN_MOVE_WINDOWS_REQUIRED');
  let script, nativeSource;
  try {
    const read = options.readFileSyncFn || readFileSync;
    script = read(SCRIPT); nativeSource = read(NATIVE);
    if (digest(script) !== SCRIPT_SHA256 || digest(nativeSource) !== NATIVE_SHA256) return blocked('SOVEREIGN_MOVE_SOURCE_MISMATCH');
  } catch { return blocked('SOVEREIGN_MOVE_SOURCE_UNAVAILABLE'); }
  if (options.signal?.aborted) return blocked('SOVEREIGN_MOVE_CANCELLED');
  if (activeNativeMoves >= SOVEREIGN_FILE_MOVE_LIMITS_V1.nativeConcurrency) return blocked('SOVEREIGN_MOVE_CAPACITY_HELD');
  activeNativeMoves++;
  const privateScope = { source: request.source, destination: request.destination };
  const timeBound = (value, maximum) => Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : maximum;
  const processMs = timeBound(options.timeoutMs, SOVEREIGN_FILE_MOVE_LIMITS_V1.processMs);
  const graceMs = timeBound(options.terminationGraceMs, SOVEREIGN_FILE_MOVE_LIMITS_V1.terminationGraceMs);
  return new Promise(resolve => {
    let child, spawned = false, finished = false, released = false, terminationReason = '', missingStreams = false;
    let output = [], outputBytes = 0, deadline, terminationDeadline;
    const release = () => { if (!released) { released = true; activeNativeMoves--; } };
    const finish = receipt => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(terminationDeadline);
      options.signal?.removeEventListener('abort', cancel); output = [];
      resolve(receipt);
    };
    const unknown = blocker => blocked(blocker, 'UNKNOWN', privateScope);
    const terminate = blocker => {
      if (finished || terminationReason) return;
      terminationReason = blocker;
      try { child.kill(); } catch {}
      if (finished) return;
      // Requesting termination does not establish native outcome or exit.
      // Return bounded uncertainty, retaining admission until actual close.
      terminationDeadline = setTimeout(() => finish(unknown(blocker)), graceMs);
      terminationDeadline.unref?.();
    };
    const cancel = () => terminate('SOVEREIGN_MOVE_CANCELLED');
    try {
      child = (options.spawnFn || spawn)(POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
          Buffer.from(script.toString('utf8'), 'utf16le').toString('base64')],
        { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...createBattleBridgeMinimalChildEnvironment(options.environment || process.env),
            PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
    } catch {
      // An opaque synchronous exception can occur after OS process creation.
      // With no returned child handle, neither no-effect nor exit is proven.
      // Keep admission held; do not manufacture a safe retry from this throw.
      finish(unknown('SOVEREIGN_MOVE_SPAWN_UNPROVEN')); return;
    }
    const onError = () => {
      if (!spawned && !(Number.isSafeInteger(child.pid) && child.pid > 0)) {
        release(); finish(blocked('SOVEREIGN_MOVE_SPAWN_FAILED'));
      } else terminate('SOVEREIGN_MOVE_PROCESS_ERROR');
    };
    const onClose = (status, signal) => {
      release();
      if (finished) return;
      if (terminationReason) { finish(unknown(terminationReason)); return; }
      if (signal || !Number.isInteger(status)) { finish(unknown('SOVEREIGN_MOVE_TERMINAL_UNPROVEN')); return; }
      let receipt;
      try { receipt = JSON.parse(Buffer.concat(output).toString('utf8').trim()); } catch {}
      const normalized = normalizeReceipt(receipt, status, request);
      finish(normalized || unknown('SOVEREIGN_MOVE_RECEIPT_INVALID'));
    };
    try {
      // Node can return a child with all three streams null after EMFILE or
      // ENFILE, then emit error/close. Observe lifecycle before touching stdio.
      spawned = Number.isSafeInteger(child.pid) && child.pid > 0;
      child.on('error', onError);
      child.once('close', onClose);
      child.once('spawn', () => { spawned = true; if (missingStreams) terminate('SOVEREIGN_MOVE_PROCESS_SETUP_UNPROVEN'); });
      deadline = setTimeout(() => terminate('SOVEREIGN_MOVE_TIME_LIMIT'), processMs);
      deadline.unref?.();
      missingStreams = !child.stdout || typeof child.stdout.on !== 'function'
        || !child.stderr || typeof child.stderr.on !== 'function'
        || !child.stdin || typeof child.stdin.on !== 'function' || typeof child.stdin.end !== 'function';
      if (missingStreams) {
        if (spawned) terminate('SOVEREIGN_MOVE_PROCESS_SETUP_UNPROVEN');
        return; // Await the pre-spawn error or a bounded uncertain terminal.
      }
      child.stdout.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > SOVEREIGN_FILE_MOVE_LIMITS_V1.outputBytes) { output = []; terminate('SOVEREIGN_MOVE_OUTPUT_LIMIT'); }
        else if (!finished && !terminationReason) output.push(Buffer.from(chunk));
      });
      child.stderr.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > SOVEREIGN_FILE_MOVE_LIMITS_V1.outputBytes) terminate('SOVEREIGN_MOVE_OUTPUT_LIMIT');
      });
      child.stdin.on('error', () => terminate('SOVEREIGN_MOVE_INPUT_FAILED'));
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      if (!finished && !terminationReason) {
        try { child.stdin.end(JSON.stringify({ ...request, nativeSource: nativeSource.toString('utf8') })); }
        catch { terminate('SOVEREIGN_MOVE_INPUT_FAILED'); }
      }
    } catch { terminate('SOVEREIGN_MOVE_PROCESS_SETUP_UNPROVEN'); }
  });
}
