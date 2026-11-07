import { spawn } from 'node:child_process';
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_FILE_COPY_SCHEMA_V1 = 'stephanos.sovereign-file-copy.v1';
export const SOVEREIGN_FILE_HASH_SCHEMA_V1 = 'stephanos.sovereign-file-hash.v1';
export const SOVEREIGN_FILE_COPY_HASH_SEMANTICS_V1 = 'BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS';
export const SOVEREIGN_FILE_COPY_LIMITS_V1 = Object.freeze({
  pathCharacters: 1024, pathComponents: 64, fileBytes: 8_388_608, totalReadBytes: 33_554_432,
  requestBytes: 131_072, nativeMs: 5000, processMs: 20_000, terminationGraceMs: 2000,
  outputBytes: 32_768, nativeConcurrency: 1,
});
const SCRIPT = fileURLToPath(new URL('../../scripts/windows/sovereign-copy-file-content.ps1', import.meta.url));
const NATIVE = fileURLToPath(new URL('../../scripts/windows/SovereignFileCopyV1.cs', import.meta.url));
const SCRIPT_SHA256 = '282715de1c85ec3032d62136a4e3aec8048ea46b1fa911f581952996c8232ca6';
const NATIVE_SHA256 = '4373015e4539884b84effffb93df0b03a06a6a63e76c81b3f299adceaf47a7dc';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const COPY_SCOPE = 'UNNAMED_DATA_STREAM_ONLY';
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
const ARGUMENT_KEYS = Object.freeze(['source', 'destination', 'expectedSha256']);
const COMMON_KEYS = Object.freeze([
  'schemaVersion', 'ok', 'source', 'destination', 'sourceIdentity', 'destinationIdentity',
  'mutationState', 'stage', 'mutationAttempted', 'hashSemantics', 'mappedWriterExclusionProven',
  'retryAllowed', 'sourceMutationAttempted', 'copyScope',
]);
const SUCCESS_KEYS = Object.freeze([
  ...COMMON_KEYS, 'copied', 'overwritten', 'wholeFileAtomicityProven', 'sourceContentObservedUnchanged',
  'metadataPreserved', 'filesystem', 'sha256', 'sourceParentIdentity', 'destinationParentIdentity',
  'bytes', 'bytesRead', 'durationMs',
]);
const FAILURE_KEYS = Object.freeze([...COMMON_KEYS, 'blocker']);
const HASH_COMMON_KEYS = Object.freeze([
  'schemaVersion', 'ok', 'path', 'identity', 'parentIdentity', 'observationState', 'stage',
  'mutationAttempted', 'sourceMutationAttempted', 'hashSemantics', 'mappedWriterExclusionProven',
  'retryAllowed', 'hashScope',
]);
const HASH_SUCCESS_KEYS = Object.freeze([
  ...HASH_COMMON_KEYS, 'filesystem', 'sha256', 'bytes', 'bytesRead', 'durationMs', 'sourceContentObservedUnchanged',
]);
const HASH_FAILURE_KEYS = Object.freeze([...HASH_COMMON_KEYS, 'blocker']);
// These are known native denial codes, not an arbitrary code-shaped string.
// Keep this inventory aligned with the separately pinned native helper/wrapper.
const COPY_STAGES = Object.freeze(['PRECONDITION', 'NATIVE_CREATE', 'COPY', 'POSTCONDITION']);
const HASH_STAGES = Object.freeze(['PRECONDITION', 'HASH', 'POSTCONDITION']);
const PRECONDITION = Object.freeze(['PRECONDITION']);
const COPY_READ_STAGES = Object.freeze(['PRECONDITION', 'COPY', 'POSTCONDITION']);
// Each pair is [copy stages, read-only hash stages]. A post-create-only error
// cannot become a claim that creation was not attempted, and copying errors
// can never be interpreted as read-only hash evidence.
const NATIVE_BLOCKER_STAGES = Object.freeze({
  SOVEREIGN_COPY_ACCESS_DENIED: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_COPY_HASH_MISMATCH: [['COPY'], []],
  SOVEREIGN_COPY_CREATE_UNPROVEN: [['NATIVE_CREATE'], []],
  SOVEREIGN_COPY_DESTINATION_IDENTITY_UNPROVEN: [['NATIVE_CREATE', 'POSTCONDITION'], []],
  SOVEREIGN_COPY_ENCRYPTED_FILE_UNQUALIFIED: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_FILE_SIZE_LIMIT: [COPY_READ_STAGES, ['PRECONDITION', 'HASH']],
  SOVEREIGN_COPY_FLUSH_UNPROVEN: [['COPY'], []],
  SOVEREIGN_COPY_HARD_LINK_REJECTED: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_HASH_MISMATCH: [PRECONDITION, []],
  SOVEREIGN_COPY_HASH_REQUIRED: [PRECONDITION, []],
  SOVEREIGN_COPY_LOCAL_FIXED_VOLUME_REQUIRED: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_NATIVE_FAILED: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_NTFS_REQUIRED: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_OPEN_UNPROVEN: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_OPERATION_INVALID: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_PARENT_CHANGED: [['PRECONDITION', 'POSTCONDITION'], HASH_STAGES],
  SOVEREIGN_COPY_PATH_EXCLUDED: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_PATH_IDENTITY_UNPROVEN: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_PATH_INVALID: [['PRECONDITION', 'NATIVE_CREATE'], PRECONDITION],
  SOVEREIGN_COPY_PATH_MISSING: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_POSTCONDITION_UNPROVEN: [['POSTCONDITION'], []],
  SOVEREIGN_COPY_READBACK_UNPROVEN: [['POSTCONDITION'], []],
  SOVEREIGN_COPY_READ_LIMIT: [COPY_READ_STAGES, ['HASH']],
  SOVEREIGN_COPY_READ_UNPROVEN: [COPY_READ_STAGES, ['HASH']],
  SOVEREIGN_COPY_REPARSE_OR_NONREGULAR: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_REQUEST_ALREADY_USED: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_REQUEST_INVALID: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_REQUEST_LIMIT: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS: [PRECONDITION, []],
  SOVEREIGN_COPY_SAME_VOLUME_REQUIRED: [PRECONDITION, []],
  SOVEREIGN_COPY_SCOPE_BUSY: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_SOURCE_CHANGED: [COPY_READ_STAGES, ['HASH', 'POSTCONDITION']],
  SOVEREIGN_COPY_SOURCE_IDENTITY_UNPROVEN: [COPY_READ_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_SOURCE_MISMATCH: [PRECONDITION, PRECONDITION],
  SOVEREIGN_COPY_TARGET_EXISTS: [['PRECONDITION', 'NATIVE_CREATE'], []],
  SOVEREIGN_COPY_TIME_LIMIT: [COPY_STAGES, HASH_STAGES],
  SOVEREIGN_COPY_WRITE_UNPROVEN: [['COPY'], []],
});
const nativeBlockerAllowed = (blocker, stage, reading = false) => typeof blocker === 'string'
  && Object.hasOwn(NATIVE_BLOCKER_STAGES, blocker) && NATIVE_BLOCKER_STAGES[blocker][reading ? 1 : 0].includes(stage);
const HOST_NOT_STARTED = new Set([
  'SOVEREIGN_COPY_ARGUMENTS_INVALID', 'SOVEREIGN_COPY_PATH_INVALID', 'SOVEREIGN_COPY_PATH_EXCLUDED',
  'SOVEREIGN_COPY_HASH_REQUIRED', 'SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS',
  'SOVEREIGN_COPY_CROSS_VOLUME_UNQUALIFIED', 'SOVEREIGN_COPY_WINDOWS_REQUIRED',
  'SOVEREIGN_COPY_SOURCE_MISMATCH', 'SOVEREIGN_COPY_SOURCE_UNAVAILABLE',
  'SOVEREIGN_COPY_REQUEST_LIMIT', 'SOVEREIGN_COPY_CANCELLED', 'SOVEREIGN_COPY_CAPACITY_HELD',
  'SOVEREIGN_COPY_SPAWN_FAILED',
]);
const COPY_ARGUMENT_BLOCKERS = new Set([
  'SOVEREIGN_COPY_HASH_REQUIRED', 'SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS', 'SOVEREIGN_COPY_CROSS_VOLUME_UNQUALIFIED',
]);
const HOST_UNKNOWN = new Set([
  'SOVEREIGN_COPY_SPAWN_UNPROVEN', 'SOVEREIGN_COPY_PROCESS_SETUP_UNPROVEN',
  'SOVEREIGN_COPY_TIME_LIMIT', 'SOVEREIGN_COPY_CANCELLED', 'SOVEREIGN_COPY_PROCESS_ERROR',
  'SOVEREIGN_COPY_OUTPUT_LIMIT', 'SOVEREIGN_COPY_OUTPUT_FAILED', 'SOVEREIGN_COPY_INPUT_FAILED',
  'SOVEREIGN_COPY_TERMINAL_UNPROVEN', 'SOVEREIGN_COPY_RECEIPT_INVALID',
]);
const PRESPAWN_ERRORS = new Set(['EACCES', 'EAGAIN', 'EMFILE', 'ENFILE', 'ENOENT', 'ENOMEM', 'ENOTDIR', 'ENOEXEC', 'EINVAL']);
const digest = value => createHash('sha256').update(value).digest('hex');
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const identity = value => typeof value === 'string' && value.length === 25 && IDENTITY.test(value);
const hash = value => typeof value === 'string' && value.length === 64 && SHA256.test(value);
// One admission counter for this native adapter; there is no work queue, retry
// owner or persistent process registry. UNKNOWN retains it until actual close.
let activeNativeCopies = 0;

function capture(raw, keys) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.getPrototypeOf(raw) !== Object.prototype) return null;
    const own = Reflect.ownKeys(raw);
    if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch { return null; }
}

function blocked(blocker, mutationState = 'NOT_STARTED', request = null) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_FILE_COPY_SCHEMA_V1, ok: false,
    source: request?.source ?? null, destination: request?.destination ?? null,
    sourceIdentity: null, destinationIdentity: null, mutationState,
    stage: mutationState === 'NOT_STARTED' ? 'PRECONDITION' : 'PROCESS_TERMINAL_UNPROVEN',
    mutationAttempted: mutationState === 'NOT_STARTED' ? false : null,
    hashSemantics: SOVEREIGN_FILE_COPY_HASH_SEMANTICS_V1, mappedWriterExclusionProven: false,
    retryAllowed: false, sourceMutationAttempted: false, copyScope: COPY_SCOPE, blocker,
  });
}

function hashBlocked(blocker, uncertain = false, request = null) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_FILE_HASH_SCHEMA_V1, ok: false, path: request?.path ?? null,
    identity: null, parentIdentity: null, observationState: 'NOT_OBSERVED',
    stage: uncertain ? 'PROCESS_TERMINAL_UNPROVEN' : 'PRECONDITION',
    mutationAttempted: false, sourceMutationAttempted: false,
    hashSemantics: SOVEREIGN_FILE_COPY_HASH_SEMANTICS_V1, mappedWriterExclusionProven: false,
    retryAllowed: false, hashScope: COPY_SCOPE, blocker,
  });
}

function validPart(part) {
  return part.length > 0 && part.length <= 255 && part !== '.' && part !== '..'
    && part.isWellFormed() && !/[ .]$/.test(part) && !/[\x00-\x1f<>:"/\\|?*~]/.test(part)
    && !/^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part);
}

function pathBlocker(path) {
  if (typeof path !== 'string' || path !== path.trim() || path.length > SOVEREIGN_FILE_COPY_LIMITS_V1.pathCharacters
    || !/^[a-z]:\\[^\\]/i.test(path)) return 'SOVEREIGN_COPY_PATH_INVALID';
  const parts = path.slice(3).split('\\');
  if (parts.length > SOVEREIGN_FILE_COPY_LIMITS_V1.pathComponents || parts.some(part => !validPart(part)))
    return 'SOVEREIGN_COPY_PATH_INVALID';
  if (parts.some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()) || SENSITIVE_FILE.test(part)))
    return 'SOVEREIGN_COPY_PATH_EXCLUDED';
  return '';
}

export function validateSovereignFileCopyArgumentsV1(raw) {
  const args = capture(raw, ARGUMENT_KEYS);
  if (!args) return blocked('SOVEREIGN_COPY_ARGUMENTS_INVALID');
  const invalid = pathBlocker(args.source) || pathBlocker(args.destination);
  if (invalid) return blocked(invalid);
  if (!hash(args.expectedSha256))
    return blocked('SOVEREIGN_COPY_HASH_REQUIRED');
  if (args.source.toLowerCase() === args.destination.toLowerCase())
    return blocked('SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS');
  if (args.source[0].toLowerCase() !== args.destination[0].toLowerCase())
    return blocked('SOVEREIGN_COPY_CROSS_VOLUME_UNQUALIFIED');
  return Object.freeze({ ok: true, args });
}

export function validateSovereignFileHashArgumentsV1(raw) {
  const args = capture(raw, ['path']);
  if (!args) return hashBlocked('SOVEREIGN_COPY_ARGUMENTS_INVALID');
  const invalid = pathBlocker(args.path);
  if (invalid) return hashBlocked(invalid);
  return Object.freeze({ ok: true, args });
}

function commonReceipt(receipt, request) {
  return receipt.schemaVersion === SOVEREIGN_FILE_COPY_SCHEMA_V1
    && receipt.source === request.source && receipt.destination === request.destination
    && receipt.hashSemantics === SOVEREIGN_FILE_COPY_HASH_SEMANTICS_V1
    && receipt.copyScope === COPY_SCOPE && receipt.mappedWriterExclusionProven === false
    && receipt.retryAllowed === false && receipt.sourceMutationAttempted === false;
}

function consistentIdentities(receipt) {
  const source = receipt.sourceIdentity, destination = receipt.destinationIdentity;
  return (source === null || identity(source)) && (destination === null || identity(destination))
    && (destination === null || source !== null && source !== destination && source.slice(0, 8) === destination.slice(0, 8));
}

function nativeReceipt(value, status, request) {
  const success = capture(value, SUCCESS_KEYS);
  if (success) {
    if (status !== 0 || !commonReceipt(success, request) || success.ok !== true || success.copied !== true
      || success.mutationState !== 'COPIED' || success.stage !== 'POSTCONDITION' || success.mutationAttempted !== true
      || success.overwritten !== false || success.wholeFileAtomicityProven !== false || success.metadataPreserved !== false
      || success.sourceContentObservedUnchanged !== true || success.filesystem !== 'NTFS'
      || success.sha256 !== request.expectedSha256 || !identity(success.sourceIdentity) || !identity(success.destinationIdentity)
      || !consistentIdentities(success) || !identity(success.sourceParentIdentity) || !identity(success.destinationParentIdentity)
      || success.sourceIdentity.slice(0, 8) !== success.sourceParentIdentity.slice(0, 8)
      || success.sourceIdentity.slice(0, 8) !== success.destinationParentIdentity.slice(0, 8)
      || [success.sourceParentIdentity, success.destinationParentIdentity].some(parent =>
        parent === success.sourceIdentity || parent === success.destinationIdentity)
      || !integer(success.bytes, SOVEREIGN_FILE_COPY_LIMITS_V1.fileBytes)
      || !integer(success.bytesRead, SOVEREIGN_FILE_COPY_LIMITS_V1.totalReadBytes) || success.bytesRead !== 4 * success.bytes
      || !integer(success.durationMs, SOVEREIGN_FILE_COPY_LIMITS_V1.nativeMs)) return null;
    const sourceParent = request.source.slice(0, request.source.lastIndexOf('\\')).toLowerCase();
    const destinationParent = request.destination.slice(0, request.destination.lastIndexOf('\\')).toLowerCase();
    if (sourceParent === destinationParent && success.sourceParentIdentity !== success.destinationParentIdentity) return null;
    return success;
  }
  const failure = capture(value, FAILURE_KEYS);
  if (!failure || status !== 2 || !commonReceipt(failure, request) || failure.ok !== false
    || !nativeBlockerAllowed(failure.blocker, failure.stage) || !consistentIdentities(failure)) return null;
  const before = failure.mutationState === 'NOT_STARTED' && failure.stage === 'PRECONDITION'
    && failure.mutationAttempted === false && failure.destinationIdentity === null
    && (!['SOVEREIGN_COPY_HASH_MISMATCH', 'SOVEREIGN_COPY_SOURCE_CHANGED',
      'SOVEREIGN_COPY_READ_LIMIT', 'SOVEREIGN_COPY_READ_UNPROVEN'].includes(failure.blocker)
      || identity(failure.sourceIdentity));
  const after = failure.mutationState === 'UNKNOWN' && failure.mutationAttempted === true
    && ['NATIVE_CREATE', 'COPY', 'POSTCONDITION'].includes(failure.stage)
    && identity(failure.sourceIdentity)
    && (failure.stage === 'NATIVE_CREATE' && failure.blocker !== 'SOVEREIGN_COPY_DESTINATION_IDENTITY_UNPROVEN'
      || identity(failure.destinationIdentity));
  return before || after ? failure : null;
}

export function normalizeSovereignFileCopyReceiptV1(value, status, request) {
  const checked = validateSovereignFileCopyArgumentsV1(request);
  return checked.ok ? nativeReceipt(value, status, checked.args) : null;
}

// The canonical command handler captures the adapter's normalized result again.
// This validates a result shape; it neither invents a child exit status nor
// promotes caller JSON into a native observation or execution dependency.
export function captureSovereignFileCopyResultV1(value, request) {
  const checked = validateSovereignFileCopyArgumentsV1(request);
  if (!checked.ok) return null;
  const native = nativeReceipt(value, 0, checked.args) || nativeReceipt(value, 2, checked.args);
  if (native) return native;
  const failure = capture(value, FAILURE_KEYS);
  if (!failure || !commonReceipt(failure, checked.args) || failure.ok !== false
    || failure.sourceIdentity !== null || failure.destinationIdentity !== null) return null;
  if (failure.mutationState === 'NOT_STARTED' && failure.stage === 'PRECONDITION'
    && failure.mutationAttempted === false && HOST_NOT_STARTED.has(failure.blocker)) return failure;
  if (failure.mutationState === 'UNKNOWN' && failure.stage === 'PROCESS_TERMINAL_UNPROVEN'
    && failure.mutationAttempted === null && HOST_UNKNOWN.has(failure.blocker)) return failure;
  return null;
}

function commonHashReceipt(receipt, request) {
  return receipt.schemaVersion === SOVEREIGN_FILE_HASH_SCHEMA_V1 && receipt.path === request.path
    && receipt.mutationAttempted === false && receipt.sourceMutationAttempted === false
    && receipt.hashSemantics === SOVEREIGN_FILE_COPY_HASH_SEMANTICS_V1 && receipt.hashScope === COPY_SCOPE
    && receipt.mappedWriterExclusionProven === false && receipt.retryAllowed === false;
}

function hashIdentities(receipt, nullable) {
  if (nullable && receipt.identity === null && receipt.parentIdentity === null) return true;
  return identity(receipt.identity) && identity(receipt.parentIdentity)
    && receipt.identity !== receipt.parentIdentity && receipt.identity.slice(0, 8) === receipt.parentIdentity.slice(0, 8);
}

function nativeHashReceipt(value, status, request) {
  const success = capture(value, HASH_SUCCESS_KEYS);
  if (success) return status === 0 && commonHashReceipt(success, request) && success.ok === true
    && success.observationState === 'HASHED' && success.stage === 'POSTCONDITION'
    && hashIdentities(success, false) && success.filesystem === 'NTFS' && hash(success.sha256)
    && success.sourceContentObservedUnchanged === true
    && integer(success.bytes, SOVEREIGN_FILE_COPY_LIMITS_V1.fileBytes)
    && integer(success.bytesRead, SOVEREIGN_FILE_COPY_LIMITS_V1.fileBytes * 2)
    && success.bytesRead === success.bytes * 2 && integer(success.durationMs, SOVEREIGN_FILE_COPY_LIMITS_V1.nativeMs)
    ? success : null;
  const failure = capture(value, HASH_FAILURE_KEYS);
  return failure && status === 2 && commonHashReceipt(failure, request) && failure.ok === false
    && failure.observationState === 'NOT_OBSERVED' && nativeBlockerAllowed(failure.blocker, failure.stage, true)
    && ['PRECONDITION', 'HASH', 'POSTCONDITION'].includes(failure.stage)
    && hashIdentities(failure, failure.stage === 'PRECONDITION') ? failure : null;
}

export function normalizeSovereignFileHashReceiptV1(value, status, request) {
  const checked = validateSovereignFileHashArgumentsV1(request);
  return checked.ok ? nativeHashReceipt(value, status, checked.args) : null;
}

export function captureSovereignFileHashResultV1(value, request) {
  const checked = validateSovereignFileHashArgumentsV1(request);
  if (!checked.ok) return null;
  const native = nativeHashReceipt(value, 0, checked.args) || nativeHashReceipt(value, 2, checked.args);
  if (native) return native;
  const failure = capture(value, HASH_FAILURE_KEYS);
  if (!failure || !commonHashReceipt(failure, checked.args) || failure.ok !== false
    || failure.observationState !== 'NOT_OBSERVED' || failure.identity !== null || failure.parentIdentity !== null) return null;
  if (failure.stage === 'PRECONDITION' && HOST_NOT_STARTED.has(failure.blocker)
    && !COPY_ARGUMENT_BLOCKERS.has(failure.blocker)) return failure;
  if (failure.stage === 'PROCESS_TERMINAL_UNPROVEN' && HOST_UNKNOWN.has(failure.blocker)) return failure;
  return null;
}

function readSource(path, override) {
  if (override) {
    const value = override(path);
    if (!(Buffer.isBuffer(value) || typeof value === 'string' || value instanceof Uint8Array)) throw new Error();
    const bytes = Buffer.from(value);
    if (bytes.length > SOVEREIGN_FILE_COPY_LIMITS_V1.requestBytes) throw new Error();
    return bytes;
  }
  const descriptor = openSync(path, 'r');
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > SOVEREIGN_FILE_COPY_LIMITS_V1.requestBytes) throw new Error();
    const buffer = Buffer.alloc(SOVEREIGN_FILE_COPY_LIMITS_V1.requestBytes + 1);
    let count = 0, read;
    do {
      read = readSync(descriptor, buffer, count, buffer.length - count, null);
      count += read;
    } while (read > 0 && count < buffer.length);
    if (count > SOVEREIGN_FILE_COPY_LIMITS_V1.requestBytes) throw new Error();
    return buffer.subarray(0, count);
  } finally { closeSync(descriptor); }
}

// Native receipts are deliberately flat. Parse precisely one object of JSON
// primitives, rejecting repeated (including escaped) keys and trailing data.
function parseNativeOutput(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let offset = 0;
  const skip = () => { while (/[ \t\r\n]/.test(text[offset] || '\0')) offset++; };
  const string = () => {
    const start = offset;
    if (text[offset++] !== '"') throw new Error();
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') { offset++; continue; }
      if (char === '"') return JSON.parse(text.slice(start, offset));
    }
    throw new Error();
  };
  const result = {};
  skip(); if (text[offset++] !== '{') throw new Error(); skip();
  if (text[offset] !== '}') while (true) {
    const key = string(); skip();
    if (Object.hasOwn(result, key) || text[offset++] !== ':') throw new Error(); skip();
    let value;
    if (text[offset] === '"') value = string();
    else {
      const start = offset;
      while (offset < text.length && !/[},]/.test(text[offset])) offset++;
      value = JSON.parse(text.slice(start, offset));
      if (value !== null && !['boolean', 'number'].includes(typeof value)) throw new Error();
    }
    Object.defineProperty(result, key, { value, enumerable: true });
    skip();
    if (text[offset] === '}') break;
    if (text[offset++] !== ',') throw new Error(); skip();
  }
  if (text[offset++] !== '}') throw new Error(); skip();
  if (offset !== text.length) throw new Error();
  return result;
}

export async function runSovereignFileCopyV1(raw, options = {}) {
  const validation = validateSovereignFileCopyArgumentsV1(raw);
  if (!validation.ok) return validation;
  return runNative('COPY_FILE_CONTENT', validation.args, options);
}

export async function runSovereignFileHashV1(raw, options = {}) {
  const validation = validateSovereignFileHashArgumentsV1(raw);
  if (!validation.ok) return validation;
  return runNative('GET_FILE_HASH', validation.args, options);
}

async function runNative(operation, request, options) {
  const reading = operation === 'GET_FILE_HASH';
  const refuse = blocker => reading ? hashBlocked(blocker, false, request) : blocked(blocker, 'NOT_STARTED', request);
  const unknown = blocker => reading ? hashBlocked(blocker, true, request) : blocked(blocker, 'UNKNOWN', request);
  const receiptOf = reading ? nativeHashReceipt : nativeReceipt;
  if ((options.platform || process.platform) !== 'win32') return refuse('SOVEREIGN_COPY_WINDOWS_REQUIRED');
  let script, nativeSource, input;
  try {
    script = readSource(SCRIPT, options.readFileSyncFn);
    nativeSource = readSource(NATIVE, options.readFileSyncFn);
    if (digest(script) !== SCRIPT_SHA256 || digest(nativeSource) !== NATIVE_SHA256) return refuse('SOVEREIGN_COPY_SOURCE_MISMATCH');
    input = JSON.stringify({ operation, ...request, nativeSource: new TextDecoder('utf-8', { fatal: true }).decode(nativeSource) });
  } catch { return refuse('SOVEREIGN_COPY_SOURCE_UNAVAILABLE'); }
  if (Buffer.byteLength(input, 'utf8') > SOVEREIGN_FILE_COPY_LIMITS_V1.requestBytes) return refuse('SOVEREIGN_COPY_REQUEST_LIMIT');
  if (options.signal?.aborted) return refuse('SOVEREIGN_COPY_CANCELLED');
  if (activeNativeCopies >= SOVEREIGN_FILE_COPY_LIMITS_V1.nativeConcurrency) return refuse('SOVEREIGN_COPY_CAPACITY_HELD');
  activeNativeCopies++;
  const bound = (value, maximum) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : maximum;
  return new Promise(resolve => {
    let child, ownedKill, spawned = false, pidObserved = false, pidUnproven = false, signalAttempted = false;
    let finished = false, released = false, closed = false, missingStreams = false, terminationReason = '';
    let output = [], outputBytes = 0, deadline, terminationDeadline;
    const release = () => { if (!released) { released = true; activeNativeCopies--; } };
    const observePid = () => {
      try { const pid = child?.pid; pidObserved ||= Number.isSafeInteger(pid) && pid > 0; }
      catch { pidUnproven = true; }
    };
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(terminationDeadline);
      options.signal?.removeEventListener('abort', cancel);
      output = []; resolve(result);
    };
    const signalOwned = () => {
      if (closed || signalAttempted || !ownedKill) return;
      observePid();
      if (!spawned && !pidObserved) return;
      // Capture once; latch before invoking because kill can emit error/close
      // synchronously. Such an error can never prove a pre-spawn refusal.
      signalAttempted = true;
      try { ownedKill(); } catch {}
    };
    const terminate = blocker => {
      if (finished || closed || terminationReason) return;
      terminationReason = blocker;
      output = []; signalOwned();
      if (finished) return;
      terminationDeadline = setTimeout(() => finish(unknown(blocker)),
        bound(options.terminationGraceMs, SOVEREIGN_FILE_COPY_LIMITS_V1.terminationGraceMs));
      terminationDeadline.unref?.();
    };
    const cancel = () => terminate('SOVEREIGN_COPY_CANCELLED');
    const onError = error => {
      if (closed) return;
      observePid();
      let code;
      try { code = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch {}
      if (!spawned && !pidObserved && !pidUnproven && !signalAttempted && PRESPAWN_ERRORS.has(code)) {
        release(); finish(refuse('SOVEREIGN_COPY_SPAWN_FAILED'));
      } else terminate('SOVEREIGN_COPY_PROCESS_ERROR');
    };
    const onClose = (status, signal) => {
      if (closed) return;
      closed = true; release();
      if (finished) return;
      if (terminationReason) { finish(unknown(terminationReason)); return; }
      observePid();
      if ((!spawned && !pidObserved) || signal || !Number.isInteger(status)) {
        finish(unknown('SOVEREIGN_COPY_TERMINAL_UNPROVEN')); return;
      }
      let receipt;
      try { receipt = receiptOf(parseNativeOutput(Buffer.concat(output)), status, request); } catch {}
      finish(receipt || unknown('SOVEREIGN_COPY_RECEIPT_INVALID'));
    };
    const onOutput = (chunk, collect) => {
      if (finished || terminationReason) return;
      let bytes;
      try {
        if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) throw new Error();
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > SOVEREIGN_FILE_COPY_LIMITS_V1.outputBytes) { terminate('SOVEREIGN_COPY_OUTPUT_LIMIT'); return; }
        bytes = Buffer.from(chunk);
      } catch { terminate('SOVEREIGN_COPY_OUTPUT_FAILED'); return; }
      if (collect) output.push(bytes);
    };
    try {
      child = (options.spawnFn || spawn)(POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
          Buffer.from(script.toString('utf8'), 'utf16le').toString('base64')],
        { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...createBattleBridgeMinimalChildEnvironment(options.environment || process.env),
            PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
    } catch {
      // An opaque synchronous throw cannot establish that no OS child exists.
      // No returned handle means this admission cannot be safely released here.
      finish(unknown('SOVEREIGN_COPY_SPAWN_UNPROVEN')); return;
    }
    deadline = setTimeout(() => terminate('SOVEREIGN_COPY_TIME_LIMIT'),
      bound(options.timeoutMs, SOVEREIGN_FILE_COPY_LIMITS_V1.processMs));
    deadline.unref?.();
    try {
      observePid();
      child.on('error', onError);
      child.on('close', onClose);
      child.on('spawn', () => {
        spawned = true; observePid();
        if (terminationReason) signalOwned();
        else if (missingStreams) terminate('SOVEREIGN_COPY_PROCESS_SETUP_UNPROVEN');
      });
      const kill = child?.kill;
      if (typeof kill === 'function') ownedKill = kill.bind(child);
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      missingStreams = !child.stdout || typeof child.stdout.on !== 'function'
        || !child.stderr || typeof child.stderr.on !== 'function'
        || !child.stdin || typeof child.stdin.on !== 'function' || typeof child.stdin.end !== 'function';
      if (missingStreams) {
        if (spawned || pidObserved) terminate('SOVEREIGN_COPY_PROCESS_SETUP_UNPROVEN');
        return;
      }
      child.stdout.on('data', chunk => onOutput(chunk, true));
      child.stderr.on('data', chunk => onOutput(chunk, false));
      child.stdout.on('error', () => terminate('SOVEREIGN_COPY_OUTPUT_FAILED'));
      child.stderr.on('error', () => terminate('SOVEREIGN_COPY_OUTPUT_FAILED'));
      child.stdin.on('error', () => terminate('SOVEREIGN_COPY_INPUT_FAILED'));
      if (!finished && !terminationReason) {
        try { child.stdin.end(input); } catch { terminate('SOVEREIGN_COPY_INPUT_FAILED'); }
      }
    } catch { terminate('SOVEREIGN_COPY_PROCESS_SETUP_UNPROVEN'); }
  });
}
