import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, lstat, link, symlink, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  runSovereignFileMoveV1 as move, validateSovereignFileMoveArgumentsV1 as validate,
  SOVEREIGN_FILE_MOVE_SCHEMA_V1 as SCHEMA, SOVEREIGN_FILE_MOVE_HASH_SEMANTICS_V1 as HASH_SEMANTICS,
  SOVEREIGN_FILE_MOVE_LIMITS_V1 as LIMITS,
} from './sovereignFileMoveV1.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const PAYLOAD = 'file to rename';
const REQUEST = Object.freeze({ source: 'C:\\repo\\from.txt', destination: 'C:\\repo\\to.txt', expectedSha256: digest(PAYLOAD) });
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
function good(request = REQUEST, overrides = {}) {
  return { schemaVersion: SCHEMA, ok: true, source: request.source, destination: request.destination,
    identity: '12345678:0000000000000042', sourceParentIdentity: '12345678:0000000000000010',
    destinationParentIdentity: '12345678:0000000000000010', sha256: request.expectedSha256,
    bytes: Buffer.byteLength(PAYLOAD), bytesRead: Buffer.byteLength(PAYLOAD) * 2, durationMs: 1,
    moved: true, atomicRename: true, overwritten: false, sameParent: true, filesystem: 'NTFS',
    mutationState: 'MOVED', mutationAttempted: true, stage: 'POSTCONDITION',
    hashSemantics: HASH_SEMANTICS, mappedWriterExclusionProven: false, retryAllowed: false, ...overrides };
}
function refused(overrides = {}) {
  return { schemaVersion: SCHEMA, ok: false, source: REQUEST.source, destination: REQUEST.destination,
    identity: null, blocker: 'SOVEREIGN_MOVE_HASH_MISMATCH', mutationState: 'NOT_STARTED',
    mutationAttempted: false, stage: 'PRECONDITION', hashSemantics: HASH_SEMANTICS,
    mappedWriterExclusionProven: false, retryAllowed: false, ...overrides };
}
function fixture(onInput, { autoClose = true, pid = 43210 } = {}) {
  const child = new EventEmitter(); child.pid = pid; child.killCount = 0;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const input = [];
  child.stdin.on('data', chunk => input.push(Buffer.from(chunk)));
  child.stdin.on('finish', () => queueMicrotask(() => onInput(JSON.parse(Buffer.concat(input).toString('utf8')), child)));
  child.kill = () => { child.killCount++; if (autoClose) queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
  return child;
}
function terminal(receipt, status = 0, signal = null, stderr = '') {
  return fixture((input, child) => {
    if (stderr) child.stderr.write(stderr);
    child.stdout.write(typeof receipt === 'string' ? receipt : JSON.stringify(receipt));
    child.emit('close', status, signal);
  });
}
async function keepAlive(promise) {
  const timer = setTimeout(() => {}, 5000);
  try { return await promise; } finally { clearTimeout(timer); }
}

test('the literal pair and required digest are validated before native launch', async () => {
  assert.deepEqual(validate(REQUEST), { ok: true, args: REQUEST });
  assert.equal(validate({ ...REQUEST, source: 'c:\\REPO\\from.txt' }).ok, true);
  let getterCalls = 0;
  const accessor = { ...REQUEST }; Object.defineProperty(accessor, 'source', { get() { getterCalls++; return REQUEST.source; } });
  for (const raw of [undefined, null, [], 'move', {}, { ...REQUEST, expectedSha256: undefined },
    { ...REQUEST, expectedSha256: 'F'.repeat(64) }, { ...REQUEST, expectedSha256: '0'.repeat(63) },
    { ...REQUEST, expectedSha256: `${REQUEST.expectedSha256}\n` },
    { ...REQUEST, nativeSource: 'caller code' }, { ...REQUEST, overwrite: true },
    { ...REQUEST, platform: 'win32' }, Object.assign(Object.create({}), REQUEST), accessor]) {
    let calls = 0;
    const result = await move(raw, { platform: 'win32', spawnFn() { calls++; throw new Error('unexpected'); } });
    assert.equal(result.ok, false); assert.equal(result.mutationState, 'NOT_STARTED'); assert.equal(calls, 0);
  }
  assert.equal(getterCalls, 0);
});

test('aliases, sensitive locations, traversal, UNC, ADS and incomplete move scope are refused', () => {
  const invalid = [null, 4, '', 'relative', 'C:relative', 'C:\\', '\\\\host\\share\\a.txt',
    '\\\\?\\C:\\repo\\a.txt', 'C:/repo/a.txt', ' C:\\repo\\a.txt', 'C:\\repo\\a.txt ',
    'C:\\repo\\a.txt.', 'C:\\repo\\a.txt\ufeff', 'C:\\repo\\a.txt\u00a0', 'C:\\repo\\a.txt\n',
    'C:\\repo\\unpaired-\ud800.txt', 'C:\\repo\\unpaired-\udfff.txt', 'C:\\repo\\bad-\ud800x\udfff.txt',
    'C:\\repo\\..\\a.txt', 'C:\\repo\\.\\a.txt', 'C:\\repo\\a.txt:stream',
    'C:\\repo\\PROGRA~1\\a.txt', 'C:\\repo\\CON', 'C:\\repo\\CONIN$', 'C:\\repo\\LPT².txt',
    'C:\\repo\\a|b.txt', 'C:\\repo\\a*.txt', 'C:\\repo\\' + 'x'.repeat(256),
    'C:\\' + 'a\\'.repeat(65) + 'f', 'C:\\' + 'long\\'.repeat(300) + 'f'];
  const excluded = ['C:\\Windows\\a.txt', 'C:\\Users\\me\\AppData\\a.txt', 'C:\\repo\\.git\\index',
    'C:\\repo\\node_modules\\a.txt', 'C:\\repo\\.env', 'C:\\repo\\id_rsa',
    'C:\\repo\\credentials.json', 'C:\\repo\\private.pem', 'C:\\repo\\tokens.json'];
  for (const path of [...invalid, ...excluded]) {
    for (const field of ['source', 'destination']) assert.equal(validate({ ...REQUEST, [field]: path }).ok, false, String(path));
  }
  for (const destination of ['C:\\repo\\from.txt', 'c:\\REPO\\FROM.TXT'])
    assert.equal(validate({ ...REQUEST, destination }).blocker, 'SOVEREIGN_MOVE_SAME_PATH_OR_CASE_ALIAS');
  for (const destination of ['C:\\other\\to.txt', 'D:\\repo\\to.txt'])
    assert.equal(validate({ ...REQUEST, destination }).blocker, 'SOVEREIGN_MOVE_CROSS_DIRECTORY_UNQUALIFIED');
});

test('captured and hashed helper bytes receive literal data through a minimal private child environment', async () => {
  const request = { ...REQUEST, source: 'C:\\repo\\literal $(Get-Date); name.txt', destination: 'C:\\repo\\José-测试-🚀.txt' };
  let invocation, input;
  const result = await move(request, { platform: 'win32',
    environment: { ...process.env, NODE_OPTIONS: '--require private.js', PSModulePath: 'C:\\untrusted' },
    spawnFn: (...args) => { invocation = args; return fixture((value, child) => {
      input = value; child.stdout.write(JSON.stringify(good(request))); child.emit('close', 0, null);
    }); } });
  assert.equal(result.ok, true); assert.equal(result.mutationState, 'MOVED'); assert.equal(Object.isFrozen(result), true);
  const [executable, args, settings] = invocation;
  assert.equal(executable, POWERSHELL); assert.equal(settings.shell, false); assert.equal(settings.windowsHide, true);
  assert.equal(settings.env.NODE_OPTIONS, undefined);
  assert.equal(settings.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.deepEqual(settings.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), readFileSync(new URL('../../scripts/windows/sovereign-move-file.ps1', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(input).sort(), ['destination', 'expectedSha256', 'nativeSource', 'source']);
  assert.equal(input.source, request.source); assert.equal(input.destination, request.destination);
  assert.equal(input.nativeSource, readFileSync(new URL('../../scripts/windows/SovereignFileMoveV1.cs', import.meta.url), 'utf8'));
  assert.equal(result.hashSemantics, HASH_SEMANTICS); assert.equal(result.mappedWriterExclusionProven, false);
  assert.equal(result.retryAllowed, false);
});

test('replaced helper bytes, unsupported platform and already-cancelled requests cannot launch a mutation', async () => {
  for (const extension of ['.cs', '.ps1']) {
    let calls = 0;
    const result = await move(REQUEST, { platform: 'win32',
      readFileSyncFn: path => String(path).endsWith(extension) ? Buffer.from('changed') : readFileSync(path),
      spawnFn() { calls++; } });
    assert.equal(result.blocker, 'SOVEREIGN_MOVE_SOURCE_MISMATCH'); assert.equal(result.mutationState, 'NOT_STARTED'); assert.equal(calls, 0);
  }
  assert.equal((await move(REQUEST, { platform: 'linux' })).blocker, 'SOVEREIGN_MOVE_WINDOWS_REQUIRED');
  assert.equal((await move(REQUEST, { platform: 'win32', readFileSyncFn() { throw new Error('private'); } })).blocker, 'SOVEREIGN_MOVE_SOURCE_UNAVAILABLE');
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const aborted = await move(REQUEST, { platform: 'win32', signal: controller.signal, spawnFn() { calls++; } });
  assert.equal(aborted.blocker, 'SOVEREIGN_MOVE_CANCELLED'); assert.equal(aborted.mutationState, 'NOT_STARTED'); assert.equal(calls, 0);
});

test('native precondition refusals and ambiguous post-mutation failures remain distinct and private', async () => {
  const before = await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(refused(), 2, null, 'private diagnostic content') });
  assert.equal(before.mutationState, 'NOT_STARTED'); assert.equal(before.blocker, 'SOVEREIGN_MOVE_HASH_MISMATCH');
  const after = await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(refused({
    blocker: 'SOVEREIGN_MOVE_POSTCONDITION_UNPROVEN', mutationState: 'UNKNOWN', mutationAttempted: true,
    stage: 'POSTCONDITION', identity: good().identity,
  }), 2) });
  assert.equal(after.mutationState, 'UNKNOWN'); assert.equal(after.stage, 'POSTCONDITION');
  assert.equal(after.identity, good().identity); assert.equal(after.mutationAttempted, true); assert.equal(after.retryAllowed, false);
  assert.doesNotMatch(JSON.stringify(before), /private diagnostic/);
});

test('wrong identities, optimistic hashes and malformed or lost receipts never become MOVED', async () => {
  const mutations = [
    { source: 'C:\\repo\\other.txt' }, { destination: 'C:\\repo\\other.txt' }, { sha256: 'f'.repeat(64) },
    { sameParent: false }, { atomicRename: false }, { overwritten: true }, { filesystem: 'ReFS' },
    { identity: '' }, { identity: 'aaaaaaaa:0000000000000042' }, { destinationParentIdentity: '12345678:0000000000000011' },
    { bytes: LIMITS.fileBytes + 1 }, { bytesRead: 0 }, { durationMs: LIMITS.nativeMs + 1 },
    { hashSemantics: 'ATOMIC_CONTENT_CAS' }, { mappedWriterExclusionProven: true }, { retryAllowed: true },
    { mutationAttempted: false }, { stage: 'PRECONDITION' }, { content: 'private file contents' },
  ];
  for (const override of mutations) {
    const result = await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(good(REQUEST, override)) });
    assert.equal(result.ok, false, JSON.stringify(override)); assert.equal(result.mutationState, 'UNKNOWN');
    assert.equal(result.blocker, 'SOVEREIGN_MOVE_RECEIPT_INVALID'); assert.equal(result.retryAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /private file contents/);
  }
  for (const [body, status, signal] of [
    ['malformed private terminal', 0, null], [good(), null, null], [good(), 0, 'SIGTERM'], [good(), 2, null],
    [refused({ stage: 'POSTCONDITION' }), 2, null], [refused(), 0, null],
    [refused({ blocker: `SOVEREIGN_MOVE_${'X'.repeat(10000)}` }), 2, null],
  ]) {
    const result = await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(body, status, signal) });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.retryAllowed, false);
    assert.ok(JSON.stringify(result).length < 2000); assert.doesNotMatch(JSON.stringify(result), /private terminal/);
  }
});

test('pre-spawn failure is known; a throwing launcher or post-spawn error cannot prove no mutation', async () => {
  const absent = await move(REQUEST, { platform: 'win32', spawnFn() {
    const child = fixture(() => {}, { pid: null });
    queueMicrotask(() => child.emit('error', new Error('private executable path'))); return child;
  } });
  assert.equal(absent.mutationState, 'NOT_STARTED'); assert.equal(absent.blocker, 'SOVEREIGN_MOVE_SPAWN_FAILED');
  // A fresh module instance isolates the intentionally permanent unknown-child
  // admission hold; the production module must not silently release that hold.
  const isolated = await import(`./sovereignFileMoveV1.mjs?opaque-spawn=${Date.now()}`);
  const thrown = await isolated.runSovereignFileMoveV1(REQUEST, { platform: 'win32', spawnFn() { throw new Error('private launcher error'); } });
  assert.equal(thrown.mutationState, 'UNKNOWN');
  let retries = 0;
  const held = await isolated.runSovereignFileMoveV1(REQUEST, { platform: 'win32', spawnFn() { retries++; } });
  assert.equal(held.blocker, 'SOVEREIGN_MOVE_CAPACITY_HELD'); assert.equal(retries, 0);
  const after = await move(REQUEST, { platform: 'win32', spawnFn() { return fixture((input, child) => child.emit('error', new Error('private process error'))); } });
  assert.equal(after.mutationState, 'UNKNOWN'); assert.equal(after.blocker, 'SOVEREIGN_MOVE_PROCESS_ERROR');
  assert.doesNotMatch(JSON.stringify([absent, thrown, after]), /private/);
});

test('real Node pre-spawn null-stdio shape is observed without an unhandled setup failure', async () => {
  const result = await move(REQUEST, { platform: 'win32', spawnFn() {
    const child = new EventEmitter(); child.pid = undefined;
    child.stdin = null; child.stdout = null; child.stderr = null;
    child.kill = () => { throw new Error('must not kill an absent child'); };
    queueMicrotask(() => { const error = new Error('descriptor exhaustion'); error.code = 'EMFILE'; child.emit('error', error); child.emit('close', -24, null); });
    return child;
  } });
  assert.equal(result.blocker, 'SOVEREIGN_MOVE_SPAWN_FAILED'); assert.equal(result.mutationState, 'NOT_STARTED');
  assert.equal((await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});

test('aborting during process setup never sends the mutation payload afterwards', async () => {
  const controller = new AbortController(); let child, payloads = 0;
  const result = await move(REQUEST, { platform: 'win32', signal: controller.signal, spawnFn() {
    child = fixture(() => { payloads++; }); controller.abort(); return child;
  } });
  assert.equal(result.blocker, 'SOVEREIGN_MOVE_CANCELLED'); assert.equal(result.mutationState, 'UNKNOWN');
  assert.equal(payloads, 0); assert.equal(child.stdin.writableEnded, false); assert.equal(child.killCount, 1);
});

test('post-spawn stream setup or stdin errors terminate boundedly and release only on close', async () => {
  for (const stage of ['stream', 'stdin']) {
    let child;
    const result = await move(REQUEST, { platform: 'win32', spawnFn() {
      child = fixture(() => {});
      if (stage === 'stream') child.stdout.on = () => { throw new Error('private setup error'); };
      else child.stdin.end = () => { throw new Error('private stdin error'); };
      return child;
    } });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(child.killCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /private/);
    assert.equal((await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
  }
});

test('concurrent mutation admission remains held until actual close even after a bounded UNKNOWN cancellation', async () => {
  const controller = new AbortController(); let child, began;
  const started = new Promise(resolve => { began = resolve; });
  const first = move(REQUEST, { platform: 'win32', signal: controller.signal, terminationGraceMs: 10,
    spawnFn() { child = fixture(() => began(), { autoClose: false }); return child; } });
  await started;
  let otherSpawns = 0;
  assert.equal((await move(REQUEST, { platform: 'win32', spawnFn() { otherSpawns++; } })).blocker, 'SOVEREIGN_MOVE_CAPACITY_HELD');
  controller.abort();
  const result = await keepAlive(first);
  assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.blocker, 'SOVEREIGN_MOVE_CANCELLED'); assert.equal(child.killCount, 1);
  assert.equal((await move(REQUEST, { platform: 'win32', spawnFn() { otherSpawns++; } })).blocker, 'SOVEREIGN_MOVE_CAPACITY_HELD');
  assert.equal(otherSpawns, 0);
  child.emit('close', null, 'SIGTERM');
  assert.equal((await move(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});

test('run and output budgets terminate only the owned child and never certify an effect', async () => {
  let timed;
  const timeout = await keepAlive(move(REQUEST, { platform: 'win32', timeoutMs: 10, spawnFn() { timed = fixture(() => {}); return timed; } }));
  assert.equal(timeout.mutationState, 'UNKNOWN'); assert.equal(timeout.blocker, 'SOVEREIGN_MOVE_TIME_LIMIT'); assert.equal(timed.killCount, 1);
  for (const stream of ['stdout', 'stderr']) {
    let oversized;
    const result = await move(REQUEST, { platform: 'win32', spawnFn() {
      oversized = fixture((input, child) => child[stream].write(Buffer.alloc(LIMITS.outputBytes + 1, 65))); return oversized;
    } });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.blocker, 'SOVEREIGN_MOVE_OUTPUT_LIMIT');
    assert.equal(oversized.killCount, 1); assert.ok(JSON.stringify(result).length < 2000);
  }
});

const WINDOWS = { skip: process.platform !== 'win32', timeout: 90_000 };
async function withDirectory(run) {
  const root = await mkdtemp(join(homedir(), 'sovereign-file-move-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function nativeFixture(program, data) {
  const source = readFileSync(new URL('../../scripts/windows/SovereignFileMoveV1.cs', import.meta.url), 'utf8');
  const input = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false,$true)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false,$true)
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -TypeDefinition $r.nativeSource
` + program;
  const terminal = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(input, 'utf16le').toString('base64')],
    { input: JSON.stringify({ ...data, nativeSource: source }), encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(terminal.status, 0, JSON.stringify({ error: terminal.error?.code, stdout: terminal.stdout, stderr: terminal.stderr }));
  return JSON.parse(terminal.stdout.trim());
}

test('Windows fixed native helper renames Unicode and empty files without copying or exposing contents', WINDOWS, async () => {
  await withDirectory(async root => {
    for (const [index, content] of [Buffer.from('private-canary\0binary'), Buffer.alloc(0)].entries()) {
      const source = join(root, `from-${index}.txt`), destination = join(root, `José-测试-🚀-${index}.txt`);
      await writeFile(source, content);
      const result = await move({ source, destination, expectedSha256: digest(content) });
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.mutationState, 'MOVED');
      assert.equal(result.sameParent, true); assert.equal(result.atomicRename, true); assert.equal(result.overwritten, false);
      assert.equal(result.bytes, content.length); assert.equal(result.bytesRead, content.length * 2);
      assert.equal(result.sha256, digest(content)); assert.equal(result.sourceParentIdentity, result.destinationParentIdentity);
      assert.equal(result.hashSemantics, HASH_SEMANTICS); assert.equal(result.mappedWriterExclusionProven, false);
      assert.doesNotMatch(JSON.stringify(result), /private-canary/);
      assert.deepEqual(await readFile(destination), content); await assert.rejects(lstat(source), { code: 'ENOENT' });
    }
  });
});

test('Windows pre-existing destinations and wrong source hashes leave both names unchanged', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.txt'), destination = join(root, 'existing.txt');
    await writeFile(source, 'source'); await writeFile(destination, 'destination');
    const exists = await move({ source, destination, expectedSha256: digest('source') });
    assert.equal(exists.ok, false); assert.equal(exists.mutationState, 'NOT_STARTED'); assert.equal(exists.blocker, 'SOVEREIGN_MOVE_TARGET_EXISTS');
    assert.equal(await readFile(source, 'utf8'), 'source'); assert.equal(await readFile(destination, 'utf8'), 'destination');
    const absent = join(root, 'absent.txt');
    const mismatch = await move({ source, destination: absent, expectedSha256: digest('wrong') });
    assert.equal(mismatch.mutationState, 'NOT_STARTED'); assert.equal(mismatch.blocker, 'SOVEREIGN_MOVE_HASH_MISMATCH');
    assert.equal(await readFile(source, 'utf8'), 'source'); await assert.rejects(lstat(absent), { code: 'ENOENT' });
  });
});

test('Windows kernel no-replace refuses a destination created after the source and parent were retained', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.txt'), destination = join(root, 'raced.txt');
    await writeFile(source, 'source');
    const proof = nativeFixture(String.raw`
$scope=New-Object SovereignFileMoveV1 -ArgumentList $r.source,$r.destination,$r.expectedSha256
try {
 [IO.File]::WriteAllText($r.destination,'racer')
 $refused=$false
 try {$scope.Move()|Out-Null} catch {$refused=$true}
 @{refused=$refused;attempted=$scope.MutationAttempted;stage=$scope.Stage;identity=$scope.Identity}|ConvertTo-Json -Compress
} finally {$scope.Dispose()}
`, { source, destination, expectedSha256: digest('source') });
    assert.equal(proof.refused, true); assert.equal(proof.attempted, true); assert.equal(proof.stage, 'NATIVE_RENAME');
    assert.equal(await readFile(source, 'utf8'), 'source'); assert.equal(await readFile(destination, 'utf8'), 'racer');
  });
});

test('Windows captured source and parent handles reject substitution and ordinary writers through the rename', WINDOWS, async () => {
  await withDirectory(async root => {
    const parent = join(root, 'parent'); await mkdir(parent);
    const source = join(parent, 'source.txt'), destination = join(parent, 'renamed.txt'); await writeFile(source, 'source');
    const proof = nativeFixture(String.raw`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class FileMoveWriterFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 public static SafeFileHandle Write(string p) {return CreateFileW(p,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);}
}
'@
$scope=New-Object SovereignFileMoveV1 -ArgumentList $r.source,$r.destination,$r.expectedSha256
try {
 $parentRenameDenied=$false
 try {[IO.Directory]::Move($r.parent,($r.parent+'-changed'))} catch {$parentRenameDenied=$true}
 $sourceRenameDenied=$false
 try {[IO.File]::Move($r.source,($r.source+'.changed'))} catch {$sourceRenameDenied=$true}
 $writer=[FileMoveWriterFixture]::Write($r.parent)
 try {$parentWriteDenied=$writer.IsInvalid} finally {$writer.Dispose()}
 $writer=[FileMoveWriterFixture]::Write($r.source)
 try {$sourceWriteDenied=$writer.IsInvalid} finally {$writer.Dispose()}
 $result=$scope.Move()
 $reuseDenied=$false
 try {$scope.Move()|Out-Null} catch {$reuseDenied=$true}
} finally {$scope.Dispose()}
$writer=[FileMoveWriterFixture]::Write($r.destination)
try {
 $writerAfterRelease=-not $writer.IsInvalid
 $preexistingWriterDenied=$false
 try {$other=New-Object SovereignFileMoveV1 -ArgumentList $r.destination,$r.source,$r.expectedSha256;$other.Dispose()}
 catch {$preexistingWriterDenied=$true}
} finally {$writer.Dispose()}
@{parentRenameDenied=$parentRenameDenied;sourceRenameDenied=$sourceRenameDenied;parentWriteDenied=$parentWriteDenied;
sourceWriteDenied=$sourceWriteDenied;writerAfterRelease=$writerAfterRelease;preexistingWriterDenied=$preexistingWriterDenied;
reuseDenied=$reuseDenied;moved=$result.moved;identity=$result.identity}|ConvertTo-Json -Compress
`, { parent, source, destination, expectedSha256: digest('source') });
    for (const key of ['parentRenameDenied', 'sourceRenameDenied', 'parentWriteDenied', 'sourceWriteDenied',
      'writerAfterRelease', 'preexistingWriterDenied', 'reuseDenied', 'moved']) assert.equal(proof[key], true, JSON.stringify(proof));
    assert.equal(await readFile(destination, 'utf8'), 'source'); await assert.rejects(lstat(source), { code: 'ENOENT' });
  });
});

test('Windows nonregular files, hard links, junction parents and oversized input cannot enter mutation', WINDOWS, async () => {
  await withDirectory(async root => {
    const folder = join(root, 'folder'); await mkdir(folder);
    const directory = await move({ source: folder, destination: join(root, 'folder-renamed'), expectedSha256: digest('') });
    assert.equal(directory.ok, false); assert.equal(directory.mutationState, 'NOT_STARTED'); assert.equal((await lstat(folder)).isDirectory(), true);
    const original = join(root, 'original.txt'), hard = join(root, 'hard.txt'); await writeFile(original, 'private-canary'); await link(original, hard);
    const linked = await move({ source: hard, destination: join(root, 'hard-renamed.txt'), expectedSha256: digest('private-canary') });
    assert.equal(linked.blocker, 'SOVEREIGN_MOVE_HARD_LINK_REJECTED'); assert.equal(linked.mutationState, 'NOT_STARTED');
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'source.txt'), 'outside');
    const junction = join(root, 'junction'); await symlink(outside, junction, 'junction');
    const redirected = await move({ source: join(junction, 'source.txt'), destination: join(junction, 'renamed.txt'), expectedSha256: digest('outside') });
    assert.equal(redirected.ok, false); assert.equal(redirected.mutationState, 'NOT_STARTED');
    assert.equal(await readFile(join(outside, 'source.txt'), 'utf8'), 'outside'); await assert.rejects(lstat(join(outside, 'renamed.txt')), { code: 'ENOENT' });
    const large = join(root, 'large.dat'); const bytes = Buffer.alloc(LIMITS.fileBytes + 1); await writeFile(large, bytes);
    const bounded = await move({ source: large, destination: join(root, 'large-renamed.dat'), expectedSha256: digest(bytes) });
    assert.equal(bounded.blocker, 'SOVEREIGN_MOVE_FILE_SIZE_LIMIT'); assert.equal(bounded.mutationState, 'NOT_STARTED');
    assert.equal((await lstat(large)).size, bytes.length);
  });
});

test('Windows native validation independently refuses cross-directory and case-only requests', WINDOWS, async () => {
  await withDirectory(async root => {
    const other = join(root, 'other'); await mkdir(other);
    const source = join(root, 'source.txt'); await writeFile(source, 'source');
    const proof = nativeFixture(String.raw`
 $cross=$false;$alias=$false;$high=$false;$low=$false
try {$x=New-Object SovereignFileMoveV1 -ArgumentList $r.source,$r.destination,$r.expectedSha256;$x.Dispose()} catch {$cross=$true}
try {$x=New-Object SovereignFileMoveV1 -ArgumentList $r.source,($r.source.ToUpperInvariant()),$r.expectedSha256;$x.Dispose()} catch {$alias=$true}
try {[SovereignFileMoveV1]::ValidateRequest($r.source,($r.source+[char]0xd800),$r.expectedSha256)} catch {$high=$true}
try {[SovereignFileMoveV1]::ValidateRequest($r.source,($r.source+[char]0xdfff),$r.expectedSha256)} catch {$low=$true}
@{cross=$cross;alias=$alias;high=$high;low=$low}|ConvertTo-Json -Compress
`, { source, destination: join(other, 'destination.txt'), expectedSha256: digest('source') });
    assert.deepEqual(proof, { cross: true, alias: true, high: true, low: true }); assert.equal(await readFile(source, 'utf8'), 'source');
  });
});

test('a real Windows rename with a lost terminal is UNKNOWN and is never replayed', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.txt'), destination = join(root, 'renamed.txt'); await writeFile(source, 'source');
    let spawns = 0;
    const result = await move({ source, destination, expectedSha256: digest('source') }, { spawnFn(...args) {
      spawns++; const child = spawn(...args);
      // Corrupt only the test transport after the actual fixed helper runs.
      // This does not retry or alter any native mutation code.
      child.stdout.on('data', chunk => chunk.fill(32)); return child;
    } });
    assert.equal(result.ok, false); assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.retryAllowed, false);
    assert.equal(spawns, 1); assert.equal(await readFile(destination, 'utf8'), 'source'); await assert.rejects(lstat(source), { code: 'ENOENT' });
  });
});
