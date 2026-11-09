import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, rm, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  createSovereignSearchSessionsV1, runSovereignNativeSearchV1,
  validateSovereignSearchArgumentsV1, SOVEREIGN_SEARCH_LIMITS,
} from './sovereignSearchSessionsV1.mjs';

const PATH = 'C:\\Users\\Operator\\Documents\\source';
const REQUEST = { path: PATH, query: 'needle', mode: 'content', caseSensitive: false, limit: 20 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function receipt(request = REQUEST, names = ['a.txt', 'b.txt'], reasons = []) {
  return {
    schemaVersion: 'stephanos.sovereign-search-snapshot.v1', ok: true,
    path: request.path, query: request.query, mode: request.mode, caseSensitive: request.caseSensitive,
    scopeIdentity: '01234567:0123456789abcdef', complete: reasons.length === 0, reasons,
    confinement: 'WINDOWS_HANDLE_RELATIVE_NO_REPARSE', snapshotConsistency: 'BOUNDED_OBSERVATION_NOT_ATOMIC_TREE_SNAPSHOT',
    stats: { entriesVisited: names.length, filesVisited: names.length, bytesRead: names.length * 20,
      resultBytes: names.length * 500, resultsCount: names.length, durationMs: 10 },
    results: names.map(relativePath => ({ path: `${request.path}\\${relativePath}`, relativePath, type: 'file',
      line: request.mode === 'content' ? 1 : null, column: request.mode === 'content' ? 1 : null,
      preview: request.mode === 'content' ? 'needle' : null })),
  };
}
function deferredScanner() {
  const calls = [];
  return { calls, scanFn(request, controls) {
    return new Promise(resolve => calls.push({ request, ...controls, resolve }));
  } };
}
async function started(service, args = REQUEST) {
  const result = await service.execute('START_SEARCH', args);
  assert.equal(result.ok, true);
  await tick();
  return result;
}
function processFixture(onInput) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = '';
  child.stdin.on('data', data => { input += data; });
  child.stdin.on('finish', () => onInput?.(JSON.parse(input), child));
  child.killCount = 0;
  child.kill = () => { child.killCount++; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
  return child;
}

test('search accepts one literal Windows scope and rejects aliases, coercion, inherited/accessor and unknown args', () => {
  assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', REQUEST).ok, true);
  assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', { path: PATH, query: '.*[literal]$(calc)' }).ok, true);
  const badPaths = ['C:\\', 'C:relative', '\\\\server\\share', '\\\\?\\C:\\scope', 'C:/scope',
    'C:\\scope\\..\\outside', 'C:\\scope\\.\\file', 'C:\\scope\\name:stream', 'C:\\scope\\NUL.txt',
    'C:\\scope\\trailing.', 'C:\\scope\\trailing ', 'C:\\scope\\\\nested', ' C:\\scope', 'C:\\scope\\',
    'C:\\Users\\OPERAT~1\\AppDat~1'];
  for (const path of badPaths) assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', { ...REQUEST, path }).ok, false, path);
  for (const path of ['C:\\Windows\\System32', 'C:\\users\\x\\AppData\\Local', 'C:\\scope\\.git',
    'C:\\scope\\.ssh', 'C:\\scope\\secrets', 'C:\\scope\\.env', 'C:\\scope\\OpenAI-Secure-MCP-Tunnel'])
    assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', { ...REQUEST, path }).blocker, 'SOVEREIGN_SEARCH_SCOPE_EXCLUDED');
  for (const patch of [{ limit: '10' }, { limit: 51 }, { limit: 0 }, { limit: null }, { caseSensitive: 'false' },
    { caseSensitive: null }, { query: '' }, { query: 'x'.repeat(201) }, { query: 'a\nb' }, { mode: 'regex' },
    { mode: null }, { recursive: true }, { command: 'whoami' }, { scanFn: () => {} }])
    assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', { ...REQUEST, ...patch }).ok, false);
  let getterCalled = false;
  const getter = { ...REQUEST }; Object.defineProperty(getter, 'query', { get() { getterCalled = true; return 'secret'; } });
  assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', getter).ok, false);
  assert.equal(getterCalled, false);
  assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', Object.create(REQUEST)).ok, false);
  assert.equal(validateSovereignSearchArgumentsV1('LIST_SEARCHES', { path: PATH }).ok, false);
});


test('search operations reject Proxy arguments before invoking hostile reflection traps', () => {
  let traps = 0;
  const hostile = new Proxy(REQUEST, {
    getPrototypeOf() { traps++; throw new Error('getPrototypeOf must never execute'); },
    ownKeys() { traps++; throw new Error('ownKeys must never execute'); },
    get() { traps++; throw new Error('get must never execute'); },
  });
  for (const operation of ['START_SEARCH', 'LIST_SEARCHES', 'GET_MORE_SEARCH_RESULTS', 'STOP_SEARCH']) {
    const response = validateSovereignSearchArgumentsV1(operation, hostile);
    assert.equal(response.ok, false, operation);
    assert.equal(response.blocker, 'SOVEREIGN_SEARCH_ARGUMENTS_INVALID', operation);
  }
  assert.equal(traps, 0);
  const revocable = Proxy.revocable(REQUEST, {});
  revocable.revoke();
  assert.equal(validateSovereignSearchArgumentsV1('START_SEARCH', revocable.proxy).blocker,
    'SOVEREIGN_SEARCH_ARGUMENTS_INVALID');
});


test('sessions return immediately, retain stable paginated snapshots and isolate response mutations', async () => {
  const scanner = deferredScanner(); const service = createSovereignSearchSessionsV1(scanner);
  const first = await started(service);
  assert.equal(first.status, 'RUNNING'); assert.equal(first.complete, false); assert.deepEqual(first.results, []);
  const native = receipt(REQUEST, ['a.txt', 'b.txt', 'c.txt']); scanner.calls[0].resolve(native); await tick();
  const page = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId, offset: 0, limit: 2 });
  assert.equal(page.status, 'COMPLETED'); assert.equal(page.complete, true); assert.equal(page.nextOffset, 2); assert.equal(page.hasMore, true);
  assert.deepEqual(page.results.map(row => row.relativePath), ['a.txt', 'b.txt']);
  native.results[0].preview = 'tampered'; page.results[0].preview = 'also tampered';
  const again = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId, limit: 2 });
  assert.equal(again.results[0].preview, 'needle');
  const last = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId, offset: page.nextOffset });
  assert.deepEqual(last.results.map(row => row.relativePath), ['c.txt']); assert.equal(last.hasMore, false);
  assert.equal((await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId, offset: 4 })).blocker, 'SOVEREIGN_SEARCH_OFFSET_OUT_OF_RANGE');
  service.dispose();
});

test('file mode retains filename records without fabricating content or line positions', async () => {
  const request = { ...REQUEST, mode: 'file', query: '.txt' };
  const service = createSovereignSearchSessionsV1({ scanFn: args => receipt(args) });
  const first = await started(service, request);
  const result = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId });
  assert.deepEqual(result.results[0], { path: `${PATH}\\a.txt`, relativePath: 'a.txt', type: 'file' });
  service.dispose();
});

test('foreign, expired and missing valid search IDs disclose no other handler inventory', async () => {
  let clock = 1_700_000_000_000;
  const left = createSovereignSearchSessionsV1({ now: () => clock, scanFn: args => receipt(args) });
  const right = createSovereignSearchSessionsV1({ now: () => clock, scanFn: args => receipt(args) });
  const result = await started(left);
  for (const operation of ['GET_MORE_SEARCH_RESULTS', 'STOP_SEARCH']) {
    assert.equal((await right.execute(operation, { searchId: result.searchId })).blocker, 'SOVEREIGN_SEARCH_SESSION_UNAVAILABLE');
  }
  assert.deepEqual((await right.execute('LIST_SEARCHES', {})).searches, []);
  clock += SOVEREIGN_SEARCH_LIMITS.ttlMs;
  assert.equal((await left.execute('GET_MORE_SEARCH_RESULTS', { searchId: result.searchId })).blocker, 'SOVEREIGN_SEARCH_SESSION_UNAVAILABLE');
  left.dispose(); right.dispose();
});

test('session capacity is bounded; terminal stop releases only its retained snapshot', async () => {
  const service = createSovereignSearchSessionsV1({ scanFn: args => receipt(args) });
  const ids = [];
  for (let i = 0; i < SOVEREIGN_SEARCH_LIMITS.sessions; i++) ids.push((await started(service)).searchId);
  assert.equal((await service.execute('START_SEARCH', REQUEST)).blocker, 'SOVEREIGN_SEARCH_SESSION_LIMIT');
  const released = await service.execute('STOP_SEARCH', { searchId: ids[0] });
  assert.equal(released.status, 'COMPLETED'); assert.equal(released.released, true);
  assert.equal((await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: ids[0] })).blocker, 'SOVEREIGN_SEARCH_SESSION_UNAVAILABLE');
  assert.equal((await service.execute('START_SEARCH', REQUEST)).ok, true);
  service.dispose();
  assert.equal((await service.execute('LIST_SEARCHES', {})).blocker, 'SOVEREIGN_SEARCH_HANDLER_CLOSED');
});

test('cancellation affects only the owned scan and waits for physical terminal confirmation', async () => {
  const scanner = deferredScanner(); const service = createSovereignSearchSessionsV1(scanner);
  const first = await started(service), other = await started(service);
  const stopped = await service.execute('STOP_SEARCH', { searchId: first.searchId });
  assert.equal(stopped.status, 'CANCEL_REQUESTED'); assert.equal(stopped.resultSetFinal, false);
  assert.equal(scanner.calls[0].signal.aborted, true); assert.equal(scanner.calls[1].signal.aborted, false);
  scanner.calls[0].onState({ status: 'TERMINATION_UNPROVEN' });
  assert.equal((await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId })).status, 'TERMINATION_UNPROVEN');
  assert.equal((await service.execute('STOP_SEARCH', { searchId: first.searchId })).released, undefined);
  scanner.calls[0].resolve({ ok: false, blocker: 'SOVEREIGN_SEARCH_CANCELLED', cancellationConfirmed: true }); await tick();
  assert.equal((await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId })).status, 'CANCELLED');
  assert.equal((await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: other.searchId })).status, 'RUNNING');
  service.dispose(); assert.equal(scanner.calls[1].signal.aborted, true);
});

test('TTL clears private expired state but retains in-flight admission until actual completion', async () => {
  let clock = 1_700_000_000_000; const scanner = deferredScanner();
  const service = createSovereignSearchSessionsV1({ ...scanner, now: () => clock });
  const ids = [];
  for (let i = 0; i < SOVEREIGN_SEARCH_LIMITS.sessions; i++) ids.push((await started(service)).searchId);
  clock += SOVEREIGN_SEARCH_LIMITS.ttlMs;
  assert.deepEqual((await service.execute('LIST_SEARCHES', {})).searches, []);
  assert.equal((await service.execute('START_SEARCH', REQUEST)).blocker, 'SOVEREIGN_SEARCH_SESSION_LIMIT');
  assert.equal(scanner.calls.every(call => call.signal.aborted), true);
  scanner.calls[0].resolve({ ok: false, blocker: 'SOVEREIGN_SEARCH_CANCELLED', cancellationConfirmed: true }); await tick();
  assert.equal((await service.execute('START_SEARCH', REQUEST)).ok, true);
  service.dispose();
});

test('every native omission or budget reason remains incomplete, including zero matching results', async () => {
  for (const reason of ['TIME_LIMIT', 'ENTRY_LIMIT', 'FILE_LIMIT', 'BYTE_LIMIT', 'RESULT_LIMIT', 'RESULT_BYTE_LIMIT',
    'DEPTH_LIMIT', 'ACCESS_DENIED', 'LINK_OR_NONREGULAR_EXCLUDED', 'SENSITIVE_ENTRY_EXCLUDED']) {
    const service = createSovereignSearchSessionsV1({ scanFn: args => receipt(args, [], [reason]) });
    const first = await started(service);
    const result = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.complete, false); assert.deepEqual(result.reasons, [reason]);
    service.dispose();
  }
});

test('malformed, escaping, secret-bearing and falsely complete native receipts fail closed', async () => {
  const attacks = [
    value => { value.complete = true; value.reasons = ['TIME_LIMIT']; },
    value => { value.confinement = 'PATH_CHECK_ONLY'; },
    value => { value.path = 'C:\\outside'; },
    value => { value.results[0].relativePath = '..\\secret'; value.results[0].path = `${PATH}\\..\\secret`; },
    value => { value.results[0].relativePath = '.env'; value.results[0].path = `${PATH}\\.env`; },
    value => { value.results[0].relativePath = '.ssh\\key'; value.results[0].path = `${PATH}\\.ssh\\key`; },
    value => { value.results[0].preview = 'x'.repeat(241); },
    value => { value.stats.bytesRead = SOVEREIGN_SEARCH_LIMITS.totalBytes + 1; },
    value => { value.stats.entriesVisited = -1; },
    value => { value.stats.resultsCount = 1000; },
    value => { value.scopeIdentity = ''; },
  ];
  for (const attack of attacks) {
    const native = receipt(); attack(native);
    const service = createSovereignSearchSessionsV1({ scanFn: () => native });
    const first = await started(service);
    const result = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId });
    assert.equal(result.status, 'FAILED'); assert.equal(result.blocker, 'SOVEREIGN_SEARCH_RECEIPT_INVALID'); assert.deepEqual(result.results, []);
    service.dispose();
  }
});

test('page byte budget preserves a resumable cursor and all final results exactly once', async () => {
  const names = Array.from({ length: 100 }, (_, i) => `${String(i).padStart(3, '0')}-${'a'.repeat(190)}.txt`);
  const native = receipt(REQUEST, names); native.results.forEach(row => { row.preview = 'x'.repeat(240); });
  const service = createSovereignSearchSessionsV1({ scanFn: () => native });
  const first = await started(service); let offset = 0; const seen = [];
  do {
    const result = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId, offset, limit: 50 });
    assert.equal(result.status, 'COMPLETED'); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SOVEREIGN_SEARCH_LIMITS.pageBytes);
    assert.ok(result.nextOffset > offset); seen.push(...result.results.map(row => row.relativePath)); offset = result.nextOffset;
    if (!result.hasMore) break;
  } while (offset < names.length);
  assert.deepEqual(seen, names); service.dispose();
});

test('fixed helper is byte pinned, uses minimal hidden non-shell process, and passes caller text only as JSON stdin', async () => {
  const request = { ...REQUEST, query: '$(calc); literal.*' }; let observed;
  const result = await runSovereignNativeSearchV1(request, { platform: 'win32',
    environment: { ...process.env, NODE_OPTIONS: '--require evil', PSModulePath: 'evil' },
    spawnFn(executable, args, options) {
      observed = { executable, args, options };
      return processFixture((input, child) => {
        observed.input = input; child.stdout.write(JSON.stringify(receipt(request)));
        child.emit('close', 0, null);
      });
    } });
  assert.equal(result.ok, true); assert.equal(observed.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(observed.options.shell, false); assert.equal(observed.options.windowsHide, true);
  assert.equal(observed.options.env.NODE_OPTIONS, undefined);
  assert.equal(observed.options.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(observed.args.some(arg => arg.includes(request.query) || arg.includes(PATH)), false);
  assert.equal(observed.input.query, request.query); assert.equal(observed.input.path, PATH);
  assert.match(observed.input.nativeSource, /NtQueryDirectoryFile/);
  let spawned = false;
  const tampered = await runSovereignNativeSearchV1(REQUEST, { platform: 'win32', readFileSyncFn: () => Buffer.from('tampered'),
    spawnFn() { spawned = true; } });
  assert.equal(tampered.blocker, 'SOVEREIGN_SEARCH_SOURCE_MISMATCH'); assert.equal(spawned, false);
  assert.equal((await runSovereignNativeSearchV1(REQUEST, { platform: 'linux' })).blocker, 'SOVEREIGN_SEARCH_WINDOWS_REQUIRED');
});

test('post-spawn kill failure holds global capacity until close, even beyond uncertainty deadline', { timeout: 8000 }, async () => {
  const children = [], controls = [], states = [];
  const promises = [];
  for (let i = 0; i < 2; i++) {
    const controller = new AbortController(); controls.push(controller);
    promises.push(runSovereignNativeSearchV1(REQUEST, { platform: 'win32', signal: controller.signal,
      onState: state => states.push(state), spawnFn() {
        const child = processFixture(); children.push(child);
        child.kill = () => { child.killCount++; child.emit('error', Object.assign(new Error('denied'), { code: 'EPERM' })); return false; };
        queueMicrotask(() => child.emit('spawn')); return child;
      } }));
  }
  await tick(); controls.forEach(control => control.abort());
  let settled = 0; promises.forEach(promise => promise.then(() => settled++));
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.equal(settled, 0); assert.equal(states.length, 2);
  assert.equal(states.every(state => state.status === 'TERMINATION_UNPROVEN'), true);
  const held = await runSovereignNativeSearchV1(REQUEST, { platform: 'win32', spawnFn() { assert.fail('must not spawn a third child'); } });
  assert.equal(held.blocker, 'SOVEREIGN_SEARCH_NATIVE_CAPACITY_HELD');
  children.forEach(child => child.emit('close', null, 'SIGTERM'));
  const results = await Promise.all(promises);
  assert.equal(results.every(result => result.cancellationConfirmed === true), true);
  const next = await runSovereignNativeSearchV1(REQUEST, { platform: 'win32', spawnFn() {
    return processFixture((input, child) => { child.stdout.write(JSON.stringify(receipt())); child.emit('close', 0, null); });
  } });
  assert.equal(next.ok, true);
});

test('proven spawn failure releases admission and native stderr never becomes tool output', async () => {
  for (let i = 0; i < 4; i++) {
    const result = await runSovereignNativeSearchV1(REQUEST, { platform: 'win32', spawnFn() { throw new Error('private machine detail'); } });
    assert.equal(result.blocker, 'SOVEREIGN_SEARCH_SPAWN_FAILED'); assert.doesNotMatch(JSON.stringify(result), /private/);
  }
  const result = await runSovereignNativeSearchV1(REQUEST, { platform: 'win32', spawnFn() {
    return processFixture((input, child) => { child.stderr.write('credential-file-private-content'); child.emit('close', 1, null); });
  } });
  assert.equal(result.blocker, 'SOVEREIGN_SEARCH_NATIVE_FAILED'); assert.doesNotMatch(JSON.stringify(result), /credential/);
});

test('oversized native streams terminate only their child and unbounded error strings are not retained', async () => {
  let child;
  const overflow = await runSovereignNativeSearchV1(REQUEST, { platform: 'win32', spawnFn() {
    child = processFixture((input, owned) => owned.stdout.write(Buffer.alloc(SOVEREIGN_SEARCH_LIMITS.outputBytes + 1, 65)));
    return child;
  } });
  assert.equal(overflow.blocker, 'SOVEREIGN_SEARCH_OUTPUT_LIMIT'); assert.equal(child.killCount, 1);
  const service = createSovereignSearchSessionsV1({ scanFn: () => ({ ok: false, blocker: `SOVEREIGN_SEARCH_${'A'.repeat(50000)}` }) });
  const first = await started(service);
  const failure = await service.execute('GET_MORE_SEARCH_RESULTS', { searchId: first.searchId });
  assert.equal(failure.blocker, 'SOVEREIGN_SEARCH_NATIVE_FAILED'); assert.ok(Buffer.byteLength(JSON.stringify(failure)) < 2000);
  service.dispose();
});

test('Windows native helper compiles and performs literal content/filename searches in a disposable directory',
  { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
    const root = await mkdtemp(join(homedir(), 'sovereign-search-fixture-'));
    try {
      await writeFile(join(root, 'a.txt'), 'needle.[x]\nplain\n');
      await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested', 'b.txt'), 'NEEDLE.[X]\n');
      const result = await runSovereignNativeSearchV1({ path: root, query: 'needle.[x]' });
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, true); assert.equal(result.results.length, 2);
      assert.equal(result.confinement, 'WINDOWS_HANDLE_RELATIVE_NO_REPARSE');
      const names = await runSovereignNativeSearchV1({ path: root, query: 'A.TXT', mode: 'file' });
      assert.equal(names.ok, true); assert.equal(names.results.length, 1); assert.equal(names.results[0].relativePath, 'a.txt');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test('Windows native confinement rejects junctions, hard links and sensitive files without reading outside scope',
  { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
    const root = await mkdtemp(join(homedir(), 'sovereign-search-scope-'));
    const outside = await mkdtemp(join(homedir(), 'sovereign-search-outside-'));
    try {
      await writeFile(join(outside, 'private.txt'), 'private-canary');
      await symlink(outside, join(root, 'linked'), 'junction');
      await link(join(outside, 'private.txt'), join(root, 'hard.txt'));
      await writeFile(join(root, '.env'), 'private-canary');
      const result = await runSovereignNativeSearchV1({ path: root, query: 'private-canary' });
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.complete, false); assert.equal(result.results.length, 0);
      for (const reason of ['LINK_OR_NONREGULAR_EXCLUDED', 'HARD_LINK_EXCLUDED', 'SENSITIVE_ENTRY_EXCLUDED']) assert.ok(result.reasons.includes(reason), reason);
      const escaped = await runSovereignNativeSearchV1({ path: join(root, 'linked'), query: 'private-canary' });
      assert.equal(escaped.ok, false);
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

test('Windows retained ancestor handles refuse rename and existing/new directory writers',
  { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
    const root = await mkdtemp(join(homedir(), 'sovereign-search-pin-'));
    const source = readFileSync(new URL('../../scripts/windows/SovereignSearchV1.cs', import.meta.url), 'utf8');
    const fixture = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false,$true)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false,$true)
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -TypeDefinition $r.source
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class SearchPinAttack {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 public static SafeFileHandle Write(string p) { return CreateFileW(p,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero); }
}
'@
$scope=New-Object SovereignSearchV1 -ArgumentList $r.path,'needle','content',$false
try {
 $renameDenied=$false
 try {[IO.Directory]::Move($r.path,($r.path+'-moved'))} catch {$renameDenied=$true}
 $writer=[SearchPinAttack]::Write($r.path)
 try {$writeDenied=$writer.IsInvalid} finally {$writer.Dispose()}
 $receipt=$scope.Run()
} finally {$scope.Dispose()}
$writer=[SearchPinAttack]::Write($r.path)
try {
 $afterReleaseWritable=-not $writer.IsInvalid
 $preexistingWriterDenied=$false
 try {$blocked=New-Object SovereignSearchV1 -ArgumentList $r.path,'needle','content',$false; $blocked.Dispose()}
 catch {$preexistingWriterDenied=$true}
} finally {$writer.Dispose()}
@{renameDenied=$renameDenied;writeDenied=$writeDenied;afterReleaseWritable=$afterReleaseWritable;
preexistingWriterDenied=$preexistingWriterDenied;complete=$receipt.complete}|ConvertTo-Json -Compress
`;
    try {
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(fixture, 'utf16le').toString('base64')],
        { input: JSON.stringify({ source, path: root }), encoding: 'utf8', windowsHide: true, timeout: 30000 });
      assert.equal(result.status, 0, result.stderr); const proof = JSON.parse(result.stdout.trim());
      for (const key of ['renameDenied', 'writeDenied', 'afterReleaseWritable', 'preexistingWriterDenied', 'complete']) assert.equal(proof[key], true, key);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
