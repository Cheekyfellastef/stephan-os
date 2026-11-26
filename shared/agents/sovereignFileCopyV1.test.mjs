import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import {
  runSovereignFileCopyV1 as copy, runSovereignFileHashV1 as hash,
  validateSovereignFileCopyArgumentsV1 as validate, validateSovereignFileHashArgumentsV1 as validateHash,
  normalizeSovereignFileCopyReceiptV1 as normalize, normalizeSovereignFileHashReceiptV1 as normalizeHash,
  captureSovereignFileCopyResultV1 as capture, captureSovereignFileHashResultV1 as captureHash,
  SOVEREIGN_FILE_COPY_SCHEMA_V1 as SCHEMA, SOVEREIGN_FILE_HASH_SCHEMA_V1 as HASH_SCHEMA,
  SOVEREIGN_FILE_COPY_HASH_SEMANTICS_V1 as SEMANTICS, SOVEREIGN_FILE_COPY_LIMITS_V1 as LIMITS,
} from './sovereignFileCopyV1.mjs';

const REQUEST = Object.freeze({ source: 'C:\\repo\\source.bin', destination: 'C:\\repo\\subdirectory\\copied.bin', expectedSha256: 'a'.repeat(64) });
const HASH_REQUEST = Object.freeze({ path: REQUEST.source });
const SOURCE_ID = '12345678:0000000000000042', DESTINATION_ID = '12345678:0000000000000043';
const SOURCE_PARENT = '12345678:0000000000000010', DESTINATION_PARENT = '12345678:0000000000000011';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SCRIPT = new URL('../../scripts/windows/sovereign-copy-file-content.ps1', import.meta.url);
const NATIVE = new URL('../../scripts/windows/SovereignFileCopyV1.cs', import.meta.url);

function common(request = REQUEST) {
  return { schemaVersion: SCHEMA, ok: true, source: request.source, destination: request.destination,
    sourceIdentity: SOURCE_ID, destinationIdentity: DESTINATION_ID,
    mutationState: 'COPIED', stage: 'POSTCONDITION', mutationAttempted: true,
    hashSemantics: SEMANTICS, mappedWriterExclusionProven: false, retryAllowed: false,
    sourceMutationAttempted: false, copyScope: 'UNNAMED_DATA_STREAM_ONLY' };
}
function good(request = REQUEST, override = {}) {
  return { ...common(request), copied: true, overwritten: false, wholeFileAtomicityProven: false,
    sourceContentObservedUnchanged: true, metadataPreserved: false, filesystem: 'NTFS', sha256: request.expectedSha256,
    sourceParentIdentity: SOURCE_PARENT, destinationParentIdentity: DESTINATION_PARENT,
    bytes: 7, bytesRead: 28, durationMs: 1, ...override };
}
function refused(override = {}) {
  return { ...common(), ok: false, sourceIdentity: null, destinationIdentity: null,
    mutationState: 'NOT_STARTED', stage: 'PRECONDITION', mutationAttempted: false,
    blocker: 'SOVEREIGN_COPY_TARGET_EXISTS', ...override };
}
function hashCommon(request = HASH_REQUEST) {
  return { schemaVersion: HASH_SCHEMA, ok: true, path: request.path, identity: SOURCE_ID,
    parentIdentity: SOURCE_PARENT, observationState: 'HASHED', stage: 'POSTCONDITION',
    mutationAttempted: false, sourceMutationAttempted: false, hashSemantics: SEMANTICS,
    mappedWriterExclusionProven: false, retryAllowed: false, hashScope: 'UNNAMED_DATA_STREAM_ONLY' };
}
function goodHash(request = HASH_REQUEST, override = {}) {
  return { ...hashCommon(request), filesystem: 'NTFS', sha256: REQUEST.expectedSha256,
    bytes: 7, bytesRead: 14, durationMs: 1, sourceContentObservedUnchanged: true, ...override };
}
function refusedHash(override = {}) {
  return { ...hashCommon(), ok: false, identity: null, parentIdentity: null,
    observationState: 'NOT_OBSERVED', stage: 'PRECONDITION', blocker: 'SOVEREIGN_COPY_PATH_MISSING', ...override };
}
function fixture(onInput, { autoClose = true, pid = 43210 } = {}) {
  const child = new EventEmitter(); child.pid = pid; child.killCount = 0;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const chunks = [];
  child.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
  child.stdin.on('finish', () => queueMicrotask(() => onInput(JSON.parse(Buffer.concat(chunks).toString('utf8')), child)));
  child.kill = () => { child.killCount++; if (autoClose) queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
  return child;
}
function terminal(receipt, status = 0, signal = null, stderr = '') {
  return fixture((input, child) => {
    if (stderr) child.stderr.write(stderr);
    child.stdout.write(typeof receipt === 'string' || Buffer.isBuffer(receipt) ? receipt : JSON.stringify(receipt));
    child.emit('close', status, signal);
  });
}
async function keepAlive(promise) {
  const timer = setTimeout(() => {}, 5000);
  try { return await promise; } finally { clearTimeout(timer); }
}
function error(code) { return Object.assign(new Error('private-error-canary'), { code }); }

test('copy and hash capture only exact enumerable own data arguments before any I/O', async () => {
  const raw = { ...REQUEST }, captured = validate(raw);
  assert.equal(captured.ok, true); raw.source = 'C:\\changed.bin';
  assert.equal(captured.args.source, REQUEST.source); assert.equal(Object.isFrozen(captured.args), true);
  const rawHash = { ...HASH_REQUEST }, capturedHash = validateHash(rawHash);
  rawHash.path = 'C:\\changed.bin'; assert.equal(capturedHash.args.path, HASH_REQUEST.path);
  let calls = 0;
  for (const [runner, request, validator] of [[copy, REQUEST, validate], [hash, HASH_REQUEST, validateHash]]) {
    const accessor = { ...request }, key = Object.keys(request)[0];
    Object.defineProperty(accessor, key, { get() { calls++; return request[key]; } });
    const hidden = { ...request }; Object.defineProperty(hidden, key, { value: request[key], enumerable: false });
    const symbol = { ...request, [Symbol('extra')]: 'private' };
    for (const value of [null, undefined, [], {}, 'copy', accessor, hidden, symbol,
      Object.assign(Object.create(null), request), Object.assign(Object.create({}), request),
      { ...request, nativeSource: 'untrusted code' }, { ...request, operation: 'GET_FILE_HASH' },
      { ...request, overwrite: true }, { ...request, environment: {} }, { ...request, spawnFn: 'code' },
    ]) {
      let reads = 0, spawns = 0;
      assert.equal(validator(value).ok, false);
      const result = await runner(value, { platform: 'win32', readFileSyncFn() { reads++; }, spawnFn() { spawns++; } });
      assert.equal(result.ok, false); assert.equal(result.mutationAttempted, false);
      assert.equal(result.sourceMutationAttempted, false); assert.equal(result.retryAllowed, false);
      assert.equal(reads, 0); assert.equal(spawns, 0);
    }
  }
  assert.equal(calls, 0);
});

test('explicit local file paths reject aliases, traversal, sensitive roots, malformed Unicode and device names', () => {
  const paths = [null, 5, '', 'relative.bin', 'C:source.bin', 'C:\\', '\\\\host\\share\\file',
    '\\\\?\\C:\\repo\\file', 'C:/repo/file', ' C:\\repo\\file', 'C:\\repo\\file ',
    'C:\\repo\\file.', 'C:\\repo\\file\ufeff', 'C:\\repo\\file\u00a0', 'C:\\repo\\file\n',
    'C:\\repo\\unpaired-\ud800', 'C:\\repo\\..\\file', 'C:\\repo\\.\\file',
    'C:\\repo\\file:stream', 'C:\\repo\\PROGRA~1\\file', 'C:\\repo\\CON.bin',
    'C:\\repo\\CONIN$.bin', 'C:\\repo\\LPT².bin', 'C:\\repo\\a|b', 'C:\\repo\\a*b',
    'C:\\' + 'x'.repeat(256), 'C:\\' + Array(65).fill('a').join('\\'),
    'C:\\Windows\\a', 'C:\\Users\\me\\AppData\\a', 'C:\\repo\\.git\\a',
    'C:\\repo\\node_modules\\a', 'C:\\repo\\.env\\a', 'C:\\repo\\credentials.json',
    'C:\\repo\\tokens.bin', 'C:\\repo\\private.pem\\a', 'C:\\repo\\.ssh\\data'];
  for (const path of paths) {
    assert.equal(validate({ ...REQUEST, source: path }).ok, false, String(path));
    assert.equal(validate({ ...REQUEST, destination: path }).ok, false, String(path));
    assert.equal(validateHash({ path }).ok, false, String(path));
  }
  for (const source of ['c:\\repo\\SOURCE.BIN', 'C:\\repo\\José-测试-🚀.bin', 'C:\\repo\\literal $(Get-Date); name.bin']) {
    assert.equal(validate({ ...REQUEST, source }).ok, true); assert.equal(validateHash({ path: source }).ok, true);
  }
});

test('copy admits same or different parents on the same named volume, requiring an exact canonical digest', () => {
  assert.equal(validate({ ...REQUEST, destination: 'C:\\repo\\same-parent.bin' }).ok, true);
  assert.equal(validate({ ...REQUEST, destination: 'c:\\other\\cross-directory.bin' }).ok, true);
  assert.equal(validate({ ...REQUEST, destination: 'D:\\other\\different-drive.bin' }).blocker, 'SOVEREIGN_COPY_CROSS_VOLUME_UNQUALIFIED');
  assert.equal(validate({ ...REQUEST, destination: 'c:\\REPO\\SOURCE.BIN' }).blocker, 'SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS');
  for (const expectedSha256 of [null, 3, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64),
    'g'.repeat(64), 'a'.repeat(64) + '\n', 'a'.repeat(64) + '\r', ['a'.repeat(64)]])
    assert.equal(validate({ ...REQUEST, expectedSha256 }).blocker, 'SOVEREIGN_COPY_HASH_REQUIRED');
});

test('native copy and read-only hash receipts bind exact scopes, bounds, observation semantics and independent IDs', () => {
  const copied = normalize(good(), 0, REQUEST), hashed = normalizeHash(goodHash(), 0, HASH_REQUEST);
  assert.deepEqual(copied, good()); assert.deepEqual(hashed, goodHash());
  assert.equal(Object.isFrozen(copied), true); assert.equal(Object.isFrozen(hashed), true);
  assert.deepEqual(capture(copied, REQUEST), copied); assert.deepEqual(captureHash(hashed, HASH_REQUEST), hashed);
  for (const bytes of [0, LIMITS.fileBytes]) {
    assert.equal(normalize(good(REQUEST, { bytes, bytesRead: bytes * 4 }), 0, REQUEST).bytes, bytes);
    assert.equal(normalizeHash(goodHash(HASH_REQUEST, { bytes, bytesRead: bytes * 2 }), 0, HASH_REQUEST).bytes, bytes);
  }
  const sameParent = { ...REQUEST, destination: 'C:\\repo\\copied.bin' };
  assert.equal(normalize(good(sameParent), 0, sameParent), null);
  assert.equal(normalize(good(sameParent, { destinationParentIdentity: SOURCE_PARENT }), 0, sameParent).ok, true);
});

test('copy rejects malformed, extra, nonprimitive, stale or optimistic native success fields', () => {
  const mutations = [
    { schemaVersion: HASH_SCHEMA }, { source: 'C:\\elsewhere\\secret' }, { destination: 'C:\\elsewhere\\secret' },
    { sha256: 'b'.repeat(64) }, { sha256: REQUEST.expectedSha256 + '\n' }, { copied: false }, { ok: 'true' },
    { overwritten: true }, { wholeFileAtomicityProven: true }, { sourceContentObservedUnchanged: false },
    { metadataPreserved: true }, { filesystem: 'ReFS' }, { sourceIdentity: '' }, { destinationIdentity: null },
    { destinationIdentity: SOURCE_ID }, { destinationIdentity: 'aaaaaaaa:0000000000000043' },
    { sourceIdentity: SOURCE_ID + '\n' }, { sourceParentIdentity: SOURCE_PARENT + '\n' },
    { sourceIdentity: SOURCE_PARENT }, { destinationParentIdentity: DESTINATION_ID },
    { sourceParentIdentity: 'aaaaaaaa:0000000000000010' }, { destinationParentIdentity: SOURCE_PARENT + '\r' },
    { bytes: -1 }, { bytes: LIMITS.fileBytes + 1 }, { bytesRead: 14 }, { bytesRead: LIMITS.totalReadBytes + 1 },
    { durationMs: LIMITS.nativeMs + 1 }, { durationMs: 1.5 }, { durationMs: '1' },
    { mutationState: 'MOVED' }, { stage: 'PRECONDITION' }, { mutationAttempted: false },
    { sourceMutationAttempted: true }, { mappedWriterExclusionProven: true }, { retryAllowed: true },
    { hashSemantics: 'ATOMIC_CONTENT_CAS' }, { copyScope: 'ALL_STREAMS' }, { contents: 'private-canary' },
    { nativeCustodyQualified: true }, { blocker: 'SOVEREIGN_COPY_ACCESS_DENIED' },
  ];
  for (const mutation of mutations) {
    assert.equal(normalize(good(REQUEST, mutation), 0, REQUEST), null, JSON.stringify(mutation));
    assert.equal(capture(good(REQUEST, mutation), REQUEST), null, JSON.stringify(mutation));
  }
  let accesses = 0;
  const accessor = good(); Object.defineProperty(accessor, 'source', { get() { accesses++; return REQUEST.source; } });
  const hidden = good(); Object.defineProperty(hidden, 'source', { value: REQUEST.source, enumerable: false });
  const missing = good(); delete missing.copied;
  for (const receipt of [accessor, hidden, missing, { ...good(), [Symbol('extra')]: 1 },
    Object.assign(Object.create(null), good()), Object.assign(Object.create({}), good())])
    assert.equal(capture(receipt, REQUEST), null);
  assert.equal(accesses, 0);
});

test('hash rejects malformed identities, contradictory mutation flags and missing complete two-pass observation', () => {
  for (const mutation of [
    { schemaVersion: SCHEMA }, { path: 'C:\\elsewhere\\secret' }, { identity: SOURCE_ID + '\n' },
    { parentIdentity: SOURCE_PARENT + '\n' }, { identity: SOURCE_PARENT },
    { parentIdentity: 'aaaaaaaa:0000000000000010' }, { sha256: REQUEST.expectedSha256 + '\n' },
    { sha256: 'A'.repeat(64) }, { sha256: null }, { bytesRead: 7 }, { bytes: LIMITS.fileBytes + 1 },
    { bytesRead: LIMITS.fileBytes * 2 + 1 }, { durationMs: -1 }, { durationMs: LIMITS.nativeMs + 1 },
    { sourceContentObservedUnchanged: false }, { observationState: 'NOT_OBSERVED' }, { stage: 'HASH' },
    { mutationAttempted: true }, { sourceMutationAttempted: true }, { retryAllowed: true },
    { mappedWriterExclusionProven: true }, { hashScope: 'ALL_STREAMS' }, { filesystem: 'ReFS' },
    { content: 'private-canary' }, { source: REQUEST.source },
  ]) {
    assert.equal(normalizeHash(goodHash(HASH_REQUEST, mutation), 0, HASH_REQUEST), null, JSON.stringify(mutation));
    assert.equal(captureHash(goodHash(HASH_REQUEST, mutation), HASH_REQUEST), null, JSON.stringify(mutation));
  }
  let accesses = 0;
  const accessor = goodHash(); Object.defineProperty(accessor, 'sha256', { get() { accesses++; return REQUEST.expectedSha256; } });
  assert.equal(captureHash(accessor, HASH_REQUEST), null); assert.equal(accesses, 0);
});

test('native refusal and post-create uncertainty are distinct; only closed blocker codes survive', () => {
  assert.deepEqual(normalize(refused(), 2, REQUEST), refused());
  assert.deepEqual(normalizeHash(refusedHash(), 2, HASH_REQUEST), refusedHash());
  for (const stage of ['NATIVE_CREATE', 'COPY', 'POSTCONDITION']) {
    const result = refused({ mutationState: 'UNKNOWN', stage, mutationAttempted: true,
      sourceIdentity: SOURCE_ID, destinationIdentity: stage === 'NATIVE_CREATE' ? null : DESTINATION_ID,
      blocker: stage === 'NATIVE_CREATE' ? 'SOVEREIGN_COPY_CREATE_UNPROVEN' : 'SOVEREIGN_COPY_SOURCE_CHANGED' });
    assert.deepEqual(normalize(result, 2, REQUEST), result); assert.deepEqual(capture(result, REQUEST), result);
  }
  for (const stage of ['HASH', 'POSTCONDITION']) {
    const result = refusedHash({ stage, identity: SOURCE_ID, parentIdentity: SOURCE_PARENT, blocker: 'SOVEREIGN_COPY_SOURCE_CHANGED' });
    assert.deepEqual(normalizeHash(result, 2, HASH_REQUEST), result); assert.deepEqual(captureHash(result, HASH_REQUEST), result);
  }
  for (const blocker of ['SOVEREIGN_COPY_PRIVATE_DATA', 'SOVEREIGN_COPY_TARGET_EXISTS\n', 'private exception', '', 4]) {
    assert.equal(normalize(refused({ blocker }), 2, REQUEST), null);
    assert.equal(capture(refused({ blocker }), REQUEST), null);
    assert.equal(normalizeHash(refusedHash({ blocker }), 2, HASH_REQUEST), null);
    assert.equal(captureHash(refusedHash({ blocker }), HASH_REQUEST), null);
  }
  for (const mutation of [
    { mutationAttempted: true }, { stage: 'POSTCONDITION' }, { destinationIdentity: DESTINATION_ID },
    { mutationState: 'UNKNOWN', mutationAttempted: false },
    { mutationState: 'UNKNOWN', stage: 'COPY', mutationAttempted: true },
    { mutationState: 'UNKNOWN', stage: 'NATIVE_CREATE', mutationAttempted: null }, { exception: 'private-canary' },
  ]) assert.equal(capture(refused(mutation), REQUEST), null);
  for (const mutation of [{ stage: 'HASH' }, { identity: SOURCE_ID }, { observationState: 'HASHED' },
    { stage: 'PROCESS_TERMINAL_UNPROVEN', blocker: 'SOVEREIGN_COPY_PATH_MISSING' }, { exception: 'private-canary' }])
    assert.equal(captureHash(refusedHash(mutation), HASH_REQUEST), null);
  assert.equal(normalize(good(), 2, REQUEST), null); assert.equal(normalize(refused(), 0, REQUEST), null);
  assert.equal(normalizeHash(goodHash(), 2, HASH_REQUEST), null); assert.equal(normalizeHash(refusedHash(), 0, HASH_REQUEST), null);
});

test('each pinned native code has a permitted mode/stage while post-create codes never claim no creation', async () => {
  const wrapper = readFileSync(SCRIPT, 'utf8');
  const codes = new Set([...wrapper.matchAll(/'((?:SOVEREIGN_COPY_)[A-Z_]+)'/g)].map(match => match[1]));
  assert.ok(codes.size >= 30);
  for (const blocker of codes) {
    const candidates = [refused({ blocker }), refused({ blocker, sourceIdentity: SOURCE_ID }), ...['NATIVE_CREATE', 'COPY', 'POSTCONDITION'].map(stage =>
      refused({ blocker, stage, mutationState: 'UNKNOWN', mutationAttempted: true,
        sourceIdentity: SOURCE_ID, destinationIdentity: DESTINATION_ID }))];
    assert.ok(candidates.some(receipt => normalize(receipt, 2, REQUEST)), blocker);
  }
  assert.equal(normalize(refused({ blocker: 'SOVEREIGN_COPY_NOT_A_NATIVE_CODE' }), 2, REQUEST), null);
  const postCreate = {
    SOVEREIGN_COPY_CREATE_UNPROVEN: ['NATIVE_CREATE'],
    SOVEREIGN_COPY_DESTINATION_IDENTITY_UNPROVEN: ['NATIVE_CREATE', 'POSTCONDITION'],
    SOVEREIGN_COPY_WRITE_UNPROVEN: ['COPY'], SOVEREIGN_COPY_COPY_HASH_MISMATCH: ['COPY'],
    SOVEREIGN_COPY_FLUSH_UNPROVEN: ['COPY'], SOVEREIGN_COPY_READBACK_UNPROVEN: ['POSTCONDITION'],
    SOVEREIGN_COPY_POSTCONDITION_UNPROVEN: ['POSTCONDITION'],
  };
  for (const [blocker, permittedStages] of Object.entries(postCreate)) {
    const malformed = refused({ blocker });
    assert.equal(normalize(malformed, 2, REQUEST), null, blocker); assert.equal(capture(malformed, REQUEST), null, blocker);
    const actual = await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(malformed, 2) });
    assert.equal(actual.mutationState, 'UNKNOWN'); assert.equal(actual.blocker, 'SOVEREIGN_COPY_RECEIPT_INVALID');
    for (const stage of ['NATIVE_CREATE', 'COPY', 'POSTCONDITION']) {
      const receipt = refused({ blocker, stage, mutationState: 'UNKNOWN', mutationAttempted: true,
        sourceIdentity: SOURCE_ID, destinationIdentity: DESTINATION_ID });
      assert.equal(Boolean(normalize(receipt, 2, REQUEST)), permittedStages.includes(stage), blocker + ':' + stage);
    }
    for (const stage of ['PRECONDITION', 'HASH', 'POSTCONDITION']) {
      const receipt = refusedHash({ blocker, stage, identity: SOURCE_ID, parentIdentity: SOURCE_PARENT });
      assert.equal(normalizeHash(receipt, 2, HASH_REQUEST), null, blocker + ':' + stage);
      assert.equal(captureHash(receipt, HASH_REQUEST), null, blocker + ':' + stage);
    }
  }
  for (const blocker of ['SOVEREIGN_COPY_HASH_REQUIRED', 'SOVEREIGN_COPY_HASH_MISMATCH',
    'SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS', 'SOVEREIGN_COPY_SAME_VOLUME_REQUIRED', 'SOVEREIGN_COPY_TARGET_EXISTS']) {
    assert.equal(captureHash(refusedHash({ blocker }), HASH_REQUEST), null, blocker);
    for (const stage of ['PRECONDITION', 'HASH', 'POSTCONDITION']) {
      const receipt = refusedHash({ blocker, stage, identity: SOURCE_ID, parentIdentity: SOURCE_PARENT });
      assert.equal(normalizeHash(receipt, 2, HASH_REQUEST), null, blocker + ':' + stage);
      assert.equal(captureHash(receipt, HASH_REQUEST), null, blocker + ':' + stage);
    }
  }
  for (const blocker of ['SOVEREIGN_COPY_HASH_MISMATCH', 'SOVEREIGN_COPY_SOURCE_CHANGED',
    'SOVEREIGN_COPY_READ_LIMIT', 'SOVEREIGN_COPY_READ_UNPROVEN']) {
    assert.equal(capture(refused({ blocker }), REQUEST), null, blocker);
    assert.equal(capture(refused({ blocker, sourceIdentity: SOURCE_ID }), REQUEST).blocker, blocker);
  }
});

test('fixed pinned helpers receive data-only native operations with a minimal environment', async () => {
  for (const [runner, request, expected, operation] of [
    [copy, { ...REQUEST, source: 'C:\\repo\\José-测试-🚀 $(Get-Date); source.bin' }, good, 'COPY_FILE_CONTENT'],
    [hash, { path: 'C:\\repo\\José-测试-🚀 $(Get-Date); source.bin' }, goodHash, 'GET_FILE_HASH'],
  ]) {
    let invocation, input;
    const result = await runner(request, { platform: 'win32', environment: { ...process.env,
      NODE_OPTIONS: '--require private.js', PSModulePath: 'C:\\untrusted', GITHUB_TOKEN: 'private-canary' }, spawnFn(...args) {
      invocation = args;
      return fixture((value, child) => { input = value; child.stdout.write(JSON.stringify(expected(request))); child.emit('close', 0, null); });
    } });
    assert.equal(result.ok, true); assert.equal(Object.isFrozen(result), true);
    const [executable, args, settings] = invocation;
    assert.equal(executable, POWERSHELL); assert.equal(settings.shell, false); assert.equal(settings.windowsHide, true);
    assert.deepEqual(settings.stdio, ['pipe', 'pipe', 'pipe']); assert.equal(settings.env.NODE_OPTIONS, undefined);
    assert.equal(settings.env.GITHUB_TOKEN, undefined); assert.equal(settings.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
    assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), readFileSync(SCRIPT, 'utf8'));
    assert.deepEqual(Object.keys(input).sort(), [...Object.keys(request), 'nativeSource', 'operation'].sort());
    assert.equal(input.nativeSource, readFileSync(NATIVE, 'utf8')); assert.equal(input.operation, operation);
    for (const [key, value] of Object.entries(request)) assert.equal(input[key], value);
    assert.ok(Buffer.byteLength(JSON.stringify(input)) <= LIMITS.requestBytes);
    assert.doesNotMatch(JSON.stringify(result), /private-canary|private\.js/);
  }
});

test('helper replacement, oversized or inaccessible helper, unavailable platform and pre-cancel refuse before process launch', async () => {
  for (const [runner, request, resultCapture] of [[copy, REQUEST, capture], [hash, HASH_REQUEST, captureHash]]) {
    for (const extension of ['.ps1', '.cs']) {
      let spawns = 0;
      const result = await runner(request, { platform: 'win32', readFileSyncFn: path => String(path).endsWith(extension)
        ? Buffer.from('changed helper') : readFileSync(path), spawnFn() { spawns++; } });
      assert.equal(result.blocker, 'SOVEREIGN_COPY_SOURCE_MISMATCH'); assert.equal(result.mutationAttempted, false);
      assert.equal(spawns, 0); assert.deepEqual(resultCapture(result, request), result);
    }
    for (const readFileSyncFn of [() => { throw new Error('private-path-canary'); },
      () => Buffer.alloc(LIMITS.requestBytes + 1), () => ({ toString() { throw new Error('not bytes'); } })]) {
      const result = await runner(request, { platform: 'win32', readFileSyncFn, spawnFn() { assert.fail('must not spawn'); } });
      assert.equal(result.blocker, 'SOVEREIGN_COPY_SOURCE_UNAVAILABLE'); assert.equal(result.mutationAttempted, false);
      assert.doesNotMatch(JSON.stringify(result), /private-path-canary/);
    }
    const unavailable = await runner(request, { platform: 'linux' });
    assert.equal(unavailable.blocker, 'SOVEREIGN_COPY_WINDOWS_REQUIRED'); assert.deepEqual(resultCapture(unavailable, request), unavailable);
    const controller = new AbortController(); controller.abort();
    const cancelled = await runner(request, { platform: 'win32', signal: controller.signal, spawnFn() { assert.fail('must not spawn'); } });
    assert.equal(cancelled.blocker, 'SOVEREIGN_COPY_CANCELLED'); assert.equal(cancelled.mutationAttempted, false);
    assert.deepEqual(resultCapture(cancelled, request), cancelled);
  }
});

test('native JSON must be one complete UTF8 flat object without repeated fields, trailing data or raw error leakage', async () => {
  const raw = JSON.stringify(good());
  for (const body of [
    'malformed private-canary', Buffer.from([0xff]), raw + raw, raw + ' private-canary', '\ufeff' + raw,
    raw.replace('"ok":true', '"ok":true,"ok":true'), raw.replace('"ok":true', '"ok":true,"\\u006fk":true'),
    JSON.stringify(good(REQUEST, { privateData: { content: 'private-canary' } })),
    JSON.stringify({ ...good(), content: ['private-canary'] }), JSON.stringify([good()]),
    raw.replace('"bytes":7', '"bytes":{}'), raw.replace('"bytes":7', '"bytes":null'),
  ]) {
    const result = await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(body) });
    assert.equal(result.ok, false); assert.equal(result.mutationState, 'UNKNOWN');
    assert.equal(result.blocker, 'SOVEREIGN_COPY_RECEIPT_INVALID'); assert.equal(result.retryAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /private-canary/); assert.deepEqual(capture(result, REQUEST), result);
  }
  const observed = await hash(HASH_REQUEST, { platform: 'win32', spawnFn: () => terminal(JSON.stringify(goodHash()) + '\n{}') });
  assert.equal(observed.observationState, 'NOT_OBSERVED'); assert.equal(observed.mutationAttempted, false);
  assert.equal(observed.stage, 'PROCESS_TERMINAL_UNPROVEN'); assert.deepEqual(captureHash(observed, HASH_REQUEST), observed);
});

test('wrong status, signal or unproved launch never promote a plausible native receipt', async () => {
  for (const [receipt, status, signal] of [[good(), 2, null], [refused(), 0, null],
    [good(), null, null], [good(), 0, 'SIGTERM'], [good(REQUEST, { overwritten: true }), 0, null]]) {
    const result = await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(receipt, status, signal, 'private-stderr-canary') });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(result), /private-stderr-canary/);
  }
  const unknown = await copy(REQUEST, { platform: 'win32', spawnFn: () => {
    const child = terminal(good()); child.pid = undefined; return child;
  } });
  assert.equal(unknown.blocker, 'SOVEREIGN_COPY_TERMINAL_UNPROVEN');
});

test('known pre-spawn errors with null stdio prove no launch and release shared admission exactly once', async () => {
  for (const code of ['ENOENT', 'EACCES', 'EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM', 'ENOTDIR', 'ENOEXEC', 'EINVAL']) {
    let child;
    const result = await copy(REQUEST, { platform: 'win32', spawnFn() {
      child = new EventEmitter(); child.pid = undefined; child.stdout = null; child.stderr = null; child.stdin = null;
      child.kill = () => assert.fail('cannot signal an unspawned child');
      queueMicrotask(() => { child.emit('error', error(code)); child.emit('close', -1, null); }); return child;
    } });
    assert.equal(result.blocker, 'SOVEREIGN_COPY_SPAWN_FAILED'); assert.equal(result.mutationState, 'NOT_STARTED');
    assert.deepEqual(capture(result, REQUEST), result);
    assert.equal((await hash(HASH_REQUEST, { platform: 'win32', spawnFn: () => terminal(goodHash()) })).ok, true);
  }
});

test('opaque pre-spawn errors retain UNKNOWN and admission until owned close', async () => {
  let child;
  const result = await keepAlive(copy(REQUEST, { platform: 'win32', terminationGraceMs: 10, spawnFn() {
    child = new EventEmitter(); child.pid = undefined; child.stdout = null; child.stderr = null; child.stdin = null;
    child.kill = () => assert.fail('no observed process to signal');
    queueMicrotask(() => child.emit('error', error('SOMETHING_UNKNOWN'))); return child;
  } }));
  assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.blocker, 'SOVEREIGN_COPY_PROCESS_ERROR');
  const held = await hash(HASH_REQUEST, { platform: 'win32', spawnFn() { assert.fail('capacity must stay held'); } });
  assert.equal(held.blocker, 'SOVEREIGN_COPY_CAPACITY_HELD'); assert.equal(held.observationState, 'NOT_OBSERVED');
  child.emit('close', -1, null);
  assert.equal((await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});

test('post-spawn signalling errors cannot masquerade as known pre-spawn refusal or release capacity', async () => {
  let child;
  const result = await keepAlive(copy(REQUEST, { platform: 'win32', timeoutMs: 10, terminationGraceMs: 10, spawnFn() {
    child = fixture(() => {}, { autoClose: false });
    child.kill = () => { child.killCount++; child.pid = undefined; child.emit('error', error('EACCES')); return false; };
    return child;
  } }));
  assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.blocker, 'SOVEREIGN_COPY_TIME_LIMIT');
  assert.equal(child.killCount, 1); assert.doesNotMatch(JSON.stringify(result), /private-error-canary/);
  assert.equal((await hash(HASH_REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
  child.emit('error', error('ENOENT')); assert.equal(child.killCount, 1);
  assert.equal((await copy(REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
  child.emit('close', null, 'SIGTERM');
  assert.equal((await hash(HASH_REQUEST, { platform: 'win32', spawnFn: () => terminal(goodHash()) })).ok, true);
});

test('pre-spawn timeout defers signalling until actual spawn and still keeps admission after grace expiry', async () => {
  let child;
  const result = await keepAlive(copy(REQUEST, { platform: 'win32', timeoutMs: 10, terminationGraceMs: 10, spawnFn() {
    child = new EventEmitter(); child.pid = undefined; child.stdout = null; child.stderr = null; child.stdin = null;
    child.killCount = 0; child.kill = () => { child.killCount++; return true; }; return child;
  } }));
  assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(child.killCount, 0);
  assert.equal((await hash(HASH_REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
  child.pid = 43210; child.emit('spawn'); assert.equal(child.killCount, 1);
  child.emit('spawn'); child.emit('error', error('EACCES')); assert.equal(child.killCount, 1);
  child.emit('close', null, 'SIGTERM');
  assert.equal((await hash(HASH_REQUEST, { platform: 'win32', spawnFn: () => terminal(goodHash()) })).ok, true);
});

test('abort during launch sends no payload; shared hash/copy admission survives failed or uncertain termination', async () => {
  const controller = new AbortController(); let child, payloads = 0;
  const result = await copy(REQUEST, { platform: 'win32', signal: controller.signal, spawnFn() {
    child = fixture(() => { payloads++; }); controller.abort(); return child;
  } });
  assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(payloads, 0); assert.equal(child.killCount, 1);
  for (const behavior of ['throw', 'false', 'true']) {
    let running, began;
    const started = new Promise(resolve => { began = resolve; });
    const cancellation = new AbortController();
    const pending = hash(HASH_REQUEST, { platform: 'win32', signal: cancellation.signal, terminationGraceMs: 10, spawnFn() {
      running = fixture(() => began(), { autoClose: false });
      running.kill = () => { running.killCount++; if (behavior === 'throw') throw new Error('private-kill-canary'); return behavior === 'true'; };
      return running;
    } });
    await started;
    assert.equal((await copy(REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
    cancellation.abort(); const unknown = await keepAlive(pending);
    assert.equal(unknown.observationState, 'NOT_OBSERVED'); assert.equal(unknown.mutationAttempted, false);
    assert.equal(unknown.stage, 'PROCESS_TERMINAL_UNPROVEN'); assert.equal(running.killCount, 1);
    assert.deepEqual(captureHash(unknown, HASH_REQUEST), unknown); assert.doesNotMatch(JSON.stringify(unknown), /private-kill-canary/);
    assert.equal((await copy(REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
    running.emit('close', null, 'SIGTERM');
    assert.equal((await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
  }
});

test('stdout/stderr overflow retains bounded uncertainty and actual-close capacity rather than replaying', async () => {
  for (const stream of ['stdout', 'stderr']) {
    let child;
    const result = await keepAlive(copy(REQUEST, { platform: 'win32', terminationGraceMs: 10, spawnFn() {
      child = fixture((input, running) => running[stream].write(Buffer.alloc(LIMITS.outputBytes + 1)), { autoClose: false }); return child;
    } }));
    assert.equal(result.blocker, 'SOVEREIGN_COPY_OUTPUT_LIMIT'); assert.equal(result.mutationState, 'UNKNOWN');
    assert.equal(child.killCount, 1); assert.equal((await hash(HASH_REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
    child.emit('close', null, 'SIGTERM');
  }
  assert.equal((await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});

test('launched child setup and stream errors remain typed UNKNOWN and only signal the captured child once', async () => {
  for (const target of ['process', 'stdout', 'stderr', 'stdin', 'setup', 'missing']) {
    let child;
    const result = await copy(REQUEST, { platform: 'win32', spawnFn() {
      child = fixture((input, running) => {
        if (target === 'process') running.emit('error', error('ENOENT'));
        else if (!['setup', 'missing'].includes(target)) running[target].emit('error', error('EACCES'));
      });
      if (target === 'setup') child.stdout.on = () => { throw new Error('private-setup-canary'); };
      if (target === 'missing') child.stdout = null;
      return child;
    } });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(child.killCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-setup-canary|private-error-canary/);
  }
});

test('opaque launcher throws and opaque returned handles never manufacture no-launch proof', async () => {
  const isolated = await import(`./sovereignFileCopyV1.mjs?opaque-copy-${Date.now()}`);
  const thrown = await isolated.runSovereignFileCopyV1(REQUEST, { platform: 'win32', spawnFn() { throw new Error('private-launch-canary'); } });
  assert.equal(thrown.mutationState, 'UNKNOWN'); assert.equal(thrown.blocker, 'SOVEREIGN_COPY_SPAWN_UNPROVEN');
  assert.doesNotMatch(JSON.stringify(thrown), /private-launch-canary/);
  assert.equal((await isolated.runSovereignFileHashV1(HASH_REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
  const opaque = await import(`./sovereignFileCopyV1.mjs?opaque-handle-${Date.now()}`);
  const result = await keepAlive(opaque.runSovereignFileHashV1(HASH_REQUEST, { platform: 'win32', terminationGraceMs: 10,
    spawnFn: () => ({ pid: 43210, kill() { return true; } }) }));
  assert.equal(result.observationState, 'NOT_OBSERVED'); assert.equal(result.stage, 'PROCESS_TERMINAL_UNPROVEN');
  assert.equal((await opaque.runSovereignFileCopyV1(REQUEST, { platform: 'win32' })).blocker, 'SOVEREIGN_COPY_CAPACITY_HELD');
  assert.equal((await copy(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});
