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
  runSovereignPdfWriteV1 as write, validateSovereignPdfWriteArgumentsV1 as validate,
  renderSovereignTextPdfV1 as render, SOVEREIGN_PDF_WRITE_SCHEMA_V1 as SCHEMA,
  SOVEREIGN_PDF_WRITE_LIMITS_V1 as LIMITS,
} from './sovereignPdfWriteV1.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const REQUEST = Object.freeze({ path: 'C:\\repo\\report.pdf', pages: [{ lines: ['private-canary (literal) \\ text', 'Second line'] }] });
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
function facts(request = REQUEST) {
  const bytes = render(request);
  return { sha256: digest(bytes), bytes: bytes.length, pageCount: request.pages.length, targetSha256: digest(Buffer.from(request.path, 'utf8')) };
}
function good(request = REQUEST, overrides = {}) {
  return { schemaVersion: SCHEMA, ok: true, ...facts(request), identity: '12345678:0000000000000042',
    parentIdentity: '12345678:0000000000000010', created: true, overwritten: false, filesystem: 'NTFS',
    bytesRead: render(request).length, durationMs: 1, mutationState: 'CREATED', mutationAttempted: true,
    stage: 'POSTCONDITION', retryAllowed: false, atomicDocumentPublication: false, ...overrides };
}
function refused(overrides = {}) {
  return { schemaVersion: SCHEMA, ok: false, ...facts(), identity: null, parentIdentity: null,
    blocker: 'SOVEREIGN_PDF_TARGET_EXISTS', mutationState: 'NOT_STARTED', mutationAttempted: false,
    stage: 'PRECONDITION', retryAllowed: false, atomicDocumentPublication: false, ...overrides };
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

test('descriptor capture is closed, deeply copied and refuses accessor, sparse and prototype inputs before I/O', async () => {
  const raw = { path: REQUEST.path, pages: [{ lines: ['original'] }] };
  const captured = validate(raw);
  assert.equal(captured.ok, true); raw.pages[0].lines[0] = 'changed'; raw.pages.push({ lines: [] });
  assert.deepEqual(captured.args.pages, [{ lines: ['original'] }]);
  assert.equal(Object.isFrozen(captured.args.pages[0].lines), true);
  let getterCalls = 0;
  const accessor = { path: REQUEST.path, pages: [] };
  Object.defineProperty(accessor, 'pages', { get() { getterCalls++; return REQUEST.pages; } });
  const nested = { lines: [] }; Object.defineProperty(nested, 'lines', { get() { getterCalls++; return ['text']; } });
  const index = ['text']; Object.defineProperty(index, '0', { get() { getterCalls++; return 'text'; } });
  const extraArray = ['text']; extraArray.other = 'data';
  const symbolArray = ['text']; symbolArray[Symbol('extra')] = 'data';
  const inherited = Object.assign(Object.create({}), REQUEST);
  for (const value of [undefined, null, [], 'pdf', {}, accessor, inherited,
    { ...REQUEST, contentBase64: 'cGRm' }, { ...REQUEST, overwrite: false }, { ...REQUEST, nativeSource: 'code' },
    { ...REQUEST, environment: {} }, { ...REQUEST, pages: [nested] },
    { ...REQUEST, pages: [{ lines: index }] }, { ...REQUEST, pages: [{ lines: extraArray }] },
    { ...REQUEST, pages: [{ lines: symbolArray }] }, { ...REQUEST, pages: new Array(1) },
    { ...REQUEST, pages: [{ lines: new Array(1) }] }, { ...REQUEST, pages: [{ lines: [], font: 'Helvetica' }] },
    { ...REQUEST, pages: [{ lines: Object.assign(Object.create(Array.prototype), { length: 1, 0: 'text' }) }] },
  ]) {
    let reads = 0, spawns = 0;
    const result = await write(value, { platform: 'win32', readFileSyncFn() { reads++; }, spawnFn() { spawns++; } });
    assert.equal(result.ok, false); assert.equal(result.mutationState, 'NOT_STARTED');
    assert.equal(reads, 0); assert.equal(spawns, 0);
    assert.throws(() => render(value), /^Error: SOVEREIGN_PDF_[A-Z_]+$/);
  }
  assert.equal(getterCalls, 0);
});

test('page, line, ASCII and aggregate bounds are checked without replacement or truncation', () => {
  const invalid = [
    [], Array.from({ length: LIMITS.pages + 1 }, () => ({ lines: [] })),
    [{ lines: Array(LIMITS.linesPerPage + 1).fill('') }],
    ...['a'.repeat(81), '\n', '\r', '\t', '\0', '\x7f', 'café', '测试', '🚀', '\ud800'].map(line => ({ lines: [line] })).map(page => [page]),
    [{ lines: [null] }], [{ lines: [3] }],
  ];
  for (const pages of invalid) assert.equal(validate({ path: REQUEST.path, pages }).ok, false);
  const pages = Array.from({ length: 4 }, () => ({ lines: Array(60).fill('a'.repeat(68)) }));
  assert.equal(validate({ path: REQUEST.path, pages }).ok, true);
  pages[0].lines[0] += 'a'.repeat(12); pages[0].lines[1] += 'a'.repeat(12);
  pages[0].lines[2] += 'a'.repeat(12); pages[0].lines[3] += 'a'.repeat(12);
  pages[0].lines[4] += 'a'.repeat(12); pages[0].lines[5] += 'a'.repeat(5);
  assert.equal(validate({ path: REQUEST.path, pages }).blocker, 'SOVEREIGN_PDF_TEXT_LIMIT');
  const allEmpty = { path: REQUEST.path, pages: Array.from({ length: 8 }, () => ({ lines: Array(60).fill('') })) };
  assert.equal(validate(allEmpty).ok, true); assert.ok(render(allEmpty).length < LIMITS.pdfBytes);
});

test('explicit PDF-only paths reject aliases, special files, sensitive roots and host state directories', () => {
  const invalid = [null, 4, '', 'relative.pdf', 'C:report.pdf', 'C:\\', '\\\\host\\share\\a.pdf',
    '\\\\?\\C:\\repo\\a.pdf', 'C:/repo/a.pdf', ' C:\\repo\\a.pdf', 'C:\\repo\\a.pdf ',
    'C:\\repo\\a.pdf.', 'C:\\repo\\a.pdf\ufeff', 'C:\\repo\\a.pdf\u00a0', 'C:\\repo\\a.pdf\n',
    'C:\\repo\\unpaired-\ud800.pdf', 'C:\\repo\\..\\a.pdf', 'C:\\repo\\.\\a.pdf',
    'C:\\repo\\a.pdf:stream', 'C:\\repo\\PROGRA~1\\a.pdf', 'C:\\repo\\CON.pdf',
    'C:\\repo\\CONIN$.pdf', 'C:\\repo\\LPT².pdf', 'C:\\repo\\a|b.pdf', 'C:\\repo\\a*.pdf',
    'C:\\repo\\a.txt', 'C:\\' + 'x'.repeat(234) + '.pdf',
    'C:\\Windows\\a.pdf', 'C:\\Users\\me\\AppData\\a.pdf', 'C:\\repo\\.git\\a.pdf',
    'C:\\repo\\node_modules\\a.pdf', 'C:\\repo\\.env\\a.pdf', 'C:\\repo\\credentials.pdf',
    'C:\\repo\\tokens.pdf', 'C:\\repo\\private.pem\\a.pdf'];
  for (const path of invalid) assert.equal(validate({ ...REQUEST, path }).ok, false, String(path));
  for (const path of ['c:\\repo\\REPORT.PDF', 'C:\\repo\\José-测试-🚀.pdf', 'C:\\repo\\literal $(Get-Date); name.pdf'])
    assert.equal(validate({ ...REQUEST, path }).ok, true, path);
});

test('real PDF byte offsets, stream lengths, page tree and inert text survive delimiter-looking inputs', () => {
  const lines = ['() \\ < > % endstream /OpenAction 4 0 R', 'BT /F1 999 Tf (evil) Tj ET', ''];
  const request = { path: REQUEST.path, pages: [{ lines }, { lines: ['Second page'] }] };
  const bytes = render(request), source = bytes.toString('ascii');
  assert.deepEqual(render(request), bytes); assert.equal(bytes.subarray(0, 9).toString(), '%PDF-1.4\n');
  const xrefOffset = Number(source.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.equal(bytes.subarray(xrefOffset, xrefOffset + 4).toString(), 'xref');
  const rows = source.slice(xrefOffset).split('\n');
  const count = Number(rows[1].split(' ')[1]);
  assert.equal(count, 8); assert.equal(rows[2], '0000000000 65535 f ');
  for (let number = 1; number < count; number++) {
    const offset = Number(rows[2 + number].slice(0, 10));
    assert.equal(bytes.subarray(offset, offset + `${number} 0 obj\n`.length).toString(), `${number} 0 obj\n`);
  }
  const streams = [...source.matchAll(/\/Length (\d+) >>\nstream\n/g)];
  assert.equal(streams.length, 2);
  for (const match of streams) {
    const start = match.index + match[0].length, length = Number(match[1]);
    assert.equal(source.slice(start + length, start + length + 9), 'endstream');
    assert.equal(source.slice(start, start + length).endsWith('ET\n'), true);
  }
  const decoded = [...source.matchAll(/<([0-9a-f]*)> Tj/g)].map(match => Buffer.from(match[1], 'hex').toString('ascii'));
  assert.deepEqual(decoded, [...lines, 'Second page']);
  assert.doesNotMatch(source, /\/OpenAction|\(evil\)|999 Tf/);
  assert.match(source, /\/Count 2 \/Kids \[4 0 R 6 0 R\]/);
  assert.match(source, /\/MediaBox \[0 0 612 792\]/);
});

test('maximum descriptor remains bounded and renderer returns independent byte buffers', () => {
  const pages = Array.from({ length: 8 }, () => ({ lines: Array(60).fill('\\'.repeat(34)) }));
  const request = { path: REQUEST.path, pages };
  const bytes = render(request);
  assert.ok(bytes.length < LIMITS.pdfBytes); assert.equal((bytes.toString('ascii').match(/\/Type \/Page\b/g) || []).length, 8);
  bytes.fill(0); assert.equal(render(request).subarray(0, 9).toString(), '%PDF-1.4\n');
});

test('only generated bytes and captured helpers reach a fixed minimal-environment native child', async () => {
  const request = { ...REQUEST, path: 'C:\\repo\\José-测试-🚀 $(Get-Date).pdf' };
  let invocation, input;
  const result = await write(request, { platform: 'win32', environment: { ...process.env,
    NODE_OPTIONS: '--require private.js', PSModulePath: 'C:\\untrusted' }, spawnFn(...args) {
    invocation = args; return fixture((value, child) => { input = value; child.stdout.write(JSON.stringify(good(request))); child.emit('close', 0, null); });
  } });
  assert.equal(result.ok, true); assert.equal(result.mutationState, 'CREATED'); assert.equal(Object.isFrozen(result), true);
  const [executable, args, settings] = invocation;
  assert.equal(executable, POWERSHELL); assert.equal(settings.shell, false); assert.equal(settings.windowsHide, true);
  assert.deepEqual(settings.stdio, ['pipe', 'pipe', 'pipe']); assert.equal(settings.env.NODE_OPTIONS, undefined);
  assert.equal(settings.env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), readFileSync(new URL('../../scripts/windows/sovereign-write-pdf.ps1', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(input).sort(), ['contentBase64', 'nativeSource', 'pageCount', 'path', 'sha256']);
  assert.deepEqual(Buffer.from(input.contentBase64, 'base64'), render(request)); assert.equal(input.path, request.path);
  assert.equal(input.nativeSource, readFileSync(new URL('../../scripts/windows/SovereignPdfWriteV1.cs', import.meta.url), 'utf8'));
  assert.doesNotMatch(JSON.stringify(result), /private-canary|José|Get-Date|C:/);
  assert.equal(Object.hasOwn(result, 'path'), false); assert.equal(result.atomicDocumentPublication, false); assert.equal(result.retryAllowed, false);
});

test('source replacement, unavailable host and pre-cancelled requests cannot start native creation', async () => {
  for (const extension of ['.ps1', '.cs']) {
    let spawns = 0;
    const result = await write(REQUEST, { platform: 'win32', readFileSyncFn: path => String(path).endsWith(extension)
      ? Buffer.from('changed') : readFileSync(path), spawnFn() { spawns++; } });
    assert.equal(result.blocker, 'SOVEREIGN_PDF_SOURCE_MISMATCH'); assert.equal(result.mutationState, 'NOT_STARTED'); assert.equal(spawns, 0);
  }
  assert.equal((await write(REQUEST, { platform: 'linux' })).blocker, 'SOVEREIGN_PDF_WINDOWS_REQUIRED');
  assert.equal((await write(REQUEST, { platform: 'win32', readFileSyncFn() { throw new Error('private path'); } })).blocker, 'SOVEREIGN_PDF_SOURCE_UNAVAILABLE');
  const controller = new AbortController(); controller.abort(); let spawns = 0;
  const result = await write(REQUEST, { platform: 'win32', signal: controller.signal, spawnFn() { spawns++; } });
  assert.equal(result.blocker, 'SOVEREIGN_PDF_CANCELLED'); assert.equal(result.mutationState, 'NOT_STARTED'); assert.equal(spawns, 0);
});

test('validated native precondition refusals and uncertain attempted writes remain distinct', async () => {
  const before = await write(REQUEST, { platform: 'win32', spawnFn: () => terminal(refused(), 2, null, 'private diagnostic') });
  assert.equal(before.blocker, 'SOVEREIGN_PDF_TARGET_EXISTS'); assert.equal(before.mutationState, 'NOT_STARTED');
  for (const stage of ['NATIVE_CREATE', 'WRITE', 'POSTCONDITION']) {
    const after = await write(REQUEST, { platform: 'win32', spawnFn: () => terminal(refused({ mutationState: 'UNKNOWN',
      mutationAttempted: true, stage, identity: good().identity, parentIdentity: good().parentIdentity }), 2) });
    assert.equal(after.mutationState, 'UNKNOWN'); assert.equal(after.mutationAttempted, true); assert.equal(after.stage, stage);
    assert.equal(after.retryAllowed, false); assert.equal(after.atomicDocumentPublication, false);
  }
  assert.doesNotMatch(JSON.stringify(before), /private diagnostic|private-canary/);
});

test('mismatched output or scope, optimistic semantics and raw extra fields never become CREATED', async () => {
  const mutations = [
    { sha256: 'f'.repeat(64) }, { targetSha256: 'e'.repeat(64) }, { bytes: facts().bytes + 1 }, { pageCount: 2 },
    { created: false }, { overwritten: true }, { filesystem: 'ReFS' }, { identity: '' },
    { identity: 'aaaaaaaa:0000000000000042' }, { parentIdentity: null }, { bytesRead: 0 },
    { durationMs: LIMITS.nativeMs + 1 }, { atomicDocumentPublication: true }, { retryAllowed: true },
    { mutationState: 'MOVED' }, { mutationAttempted: false }, { stage: 'PRECONDITION' },
    { path: REQUEST.path }, { content: 'private-canary' },
  ];
  for (const override of mutations) {
    const result = await write(REQUEST, { platform: 'win32', spawnFn: () => terminal(good(REQUEST, override)) });
    assert.equal(result.ok, false); assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.blocker, 'SOVEREIGN_PDF_RECEIPT_INVALID');
    assert.equal(Object.hasOwn(result, 'path'), false); assert.doesNotMatch(JSON.stringify(result), /private-canary/);
  }
  for (const [body, status, signal] of [
    ['malformed private terminal', 0, null], [Buffer.from([0xff]), 0, null], [good(), null, null],
    [good(), 0, 'SIGTERM'], [good(), 2, null], [refused(), 0, null],
    [refused({ stage: 'POSTCONDITION' }), 2, null], [refused({ blocker: 'SOVEREIGN_PDF_' + 'X'.repeat(200) }), 2, null],
  ]) {
    const result = await write(REQUEST, { platform: 'win32', spawnFn: () => terminal(body, status, signal) });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.retryAllowed, false);
    assert.ok(JSON.stringify(result).length < 2000); assert.doesNotMatch(JSON.stringify(result), /private terminal/);
  }
});

test('real null-stdio pre-spawn failure is known while opaque launch failure permanently retains admission', async () => {
  const absent = await write(REQUEST, { platform: 'win32', spawnFn() {
    const child = new EventEmitter(); child.pid = undefined; child.stdin = null; child.stdout = null; child.stderr = null;
    child.kill = () => { throw new Error('must not kill missing child'); };
    queueMicrotask(() => { child.emit('error', new Error('descriptor exhaustion')); child.emit('close', -24, null); }); return child;
  } });
  assert.equal(absent.mutationState, 'NOT_STARTED'); assert.equal(absent.blocker, 'SOVEREIGN_PDF_SPAWN_FAILED');
  const isolated = await import(`./sovereignPdfWriteV1.mjs?opaque-launch=${Date.now()}`);
  const thrown = await isolated.runSovereignPdfWriteV1(REQUEST, { platform: 'win32', spawnFn() { throw new Error('private launcher'); } });
  assert.equal(thrown.mutationState, 'UNKNOWN');
  let spawns = 0;
  const held = await isolated.runSovereignPdfWriteV1(REQUEST, { platform: 'win32', spawnFn() { spawns++; } });
  assert.equal(held.blocker, 'SOVEREIGN_PDF_CAPACITY_HELD'); assert.equal(spawns, 0);
  assert.equal((await write(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});

test('post-spawn stream and setup failures stay private and terminate only the owned child', async () => {
  for (const stage of ['process', 'stdout', 'stderr', 'stdin', 'setup']) {
    let child;
    const result = await write(REQUEST, { platform: 'win32', spawnFn() {
      child = fixture((input, running) => {
        if (stage === 'process') running.emit('error', new Error('private failure'));
        else if (stage !== 'setup') running[stage].emit('error', new Error('private failure'));
      });
      if (stage === 'setup') child.stdout.on = () => { throw new Error('private setup'); };
      return child;
    } });
    assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(child.killCount, 1); assert.doesNotMatch(JSON.stringify(result), /private failure|private setup/);
  }
});

test('abort during setup sends no payload; unclosed cancellation retains global capacity until actual close', async () => {
  const setupController = new AbortController(); let setupChild, payloads = 0;
  const setup = await write(REQUEST, { platform: 'win32', signal: setupController.signal, spawnFn() {
    setupChild = fixture(() => { payloads++; }); setupController.abort(); return setupChild;
  } });
  assert.equal(setup.mutationState, 'UNKNOWN'); assert.equal(payloads, 0); assert.equal(setupChild.killCount, 1);
  const controller = new AbortController(); let child, began;
  const started = new Promise(resolve => { began = resolve; });
  const first = write(REQUEST, { platform: 'win32', signal: controller.signal, terminationGraceMs: 10,
    spawnFn() { child = fixture(() => began(), { autoClose: false }); return child; } });
  await started;
  let otherSpawns = 0;
  assert.equal((await write(REQUEST, { platform: 'win32', spawnFn() { otherSpawns++; } })).blocker, 'SOVEREIGN_PDF_CAPACITY_HELD');
  controller.abort(); const unknown = await keepAlive(first);
  assert.equal(unknown.mutationState, 'UNKNOWN'); assert.equal(child.killCount, 1);
  assert.equal((await write(REQUEST, { platform: 'win32', spawnFn() { otherSpawns++; } })).blocker, 'SOVEREIGN_PDF_CAPACITY_HELD');
  assert.equal(otherSpawns, 0); child.emit('close', null, 'SIGTERM');
  assert.equal((await write(REQUEST, { platform: 'win32', spawnFn: () => terminal(good()) })).ok, true);
});

test('native process and output budgets never certify successful file creation', async () => {
  let child;
  const timed = await keepAlive(write(REQUEST, { platform: 'win32', timeoutMs: 10,
    spawnFn() { child = fixture(() => {}); return child; } }));
  assert.equal(timed.blocker, 'SOVEREIGN_PDF_TIME_LIMIT'); assert.equal(timed.mutationState, 'UNKNOWN'); assert.equal(child.killCount, 1);
  for (const stream of ['stdout', 'stderr']) {
    const result = await write(REQUEST, { platform: 'win32', spawnFn: () => fixture((input, running) => running[stream].write(Buffer.alloc(LIMITS.outputBytes + 1))) });
    assert.equal(result.blocker, 'SOVEREIGN_PDF_OUTPUT_LIMIT'); assert.equal(result.mutationState, 'UNKNOWN');
  }
});

const WINDOWS = { skip: process.platform !== 'win32', timeout: 90_000 };
async function withDirectory(run) {
  const root = await mkdtemp(join(homedir(), 'sovereign-pdf-write-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function nativeFixture(program, data) {
  const source = readFileSync(new URL('../../scripts/windows/SovereignPdfWriteV1.cs', import.meta.url), 'utf8');
  const input = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false,$true)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false,$true)
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -TypeDefinition $r.nativeSource
$content=[Convert]::FromBase64String($r.contentBase64)
` + program;
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(input, 'utf16le').toString('base64')],
    { input: JSON.stringify({ ...data, nativeSource: source }), encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(result.status, 0, JSON.stringify({ error: result.error?.code, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim());
}
function nativeInput(path, request = REQUEST) {
  const bytes = render({ ...request, path });
  return { path, contentBase64: bytes.toString('base64'), sha256: digest(bytes), pageCount: request.pages.length };
}

test('Windows fixed helper creates actual multi-page PDF bytes at a Unicode destination and returns only digest evidence', WINDOWS, async () => {
  await withDirectory(async root => {
    const path = join(root, 'José-测试-🚀.pdf');
    const request = { path, pages: [{ lines: REQUEST.pages[0].lines }, { lines: Array(60).fill('A'.repeat(80)) }] };
    const expected = render(request), result = await write(request);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.mutationState, 'CREATED');
    assert.equal(result.overwritten, false); assert.equal(result.atomicDocumentPublication, false);
    assert.equal(result.bytes, expected.length); assert.equal(result.bytesRead, expected.length); assert.equal(result.sha256, digest(expected));
    assert.equal(result.pageCount, 2); assert.equal(result.targetSha256, digest(Buffer.from(path, 'utf8')));
    assert.equal(Object.hasOwn(result, 'path'), false); assert.doesNotMatch(JSON.stringify(result), /private-canary|José/);
    assert.deepEqual(await readFile(path), expected);
  });
});

test('Windows existing files, hardlinks and directories remain untouched, and missing or junction parents never create', WINDOWS, async () => {
  await withDirectory(async root => {
    const file = join(root, 'existing.pdf'), hard = join(root, 'hard.pdf'), folder = join(root, 'folder.pdf');
    await writeFile(file, 'incumbent'); await link(file, hard); await mkdir(folder);
    for (const path of [file, hard, folder]) {
      const result = await write({ ...REQUEST, path });
      assert.equal(result.ok, false); assert.equal(result.mutationState, 'NOT_STARTED');
    }
    assert.equal(await readFile(file, 'utf8'), 'incumbent'); assert.equal(await readFile(hard, 'utf8'), 'incumbent');
    assert.equal((await lstat(folder)).isDirectory(), true);
    const missing = await write({ ...REQUEST, path: join(root, 'absent', 'report.pdf') });
    assert.equal(missing.mutationState, 'NOT_STARTED');
    const outside = join(root, 'outside'); await mkdir(outside);
    const junction = join(root, 'junction'); await symlink(outside, junction, 'junction');
    const redirected = await write({ ...REQUEST, path: join(junction, 'report.pdf') });
    assert.equal(redirected.ok, false); assert.equal(redirected.mutationState, 'NOT_STARTED');
    await assert.rejects(lstat(join(outside, 'report.pdf')), { code: 'ENOENT' });
  });
});

test('Windows FILE_CREATE refuses a raced incumbent after retained-parent preparation without overwrite', WINDOWS, async () => {
  await withDirectory(async root => {
    const path = join(root, 'race.pdf');
    const proof = nativeFixture(String.raw`
$scope=New-Object SovereignPdfWriteV1 -ArgumentList $r.path,$content,$r.sha256,$r.pageCount
try {
 [IO.File]::WriteAllText($r.path,'raced incumbent')
 $refused=$false
 try {$scope.Write()|Out-Null} catch {$refused=$true}
 @{refused=$refused;attempted=$scope.MutationAttempted;stage=$scope.Stage}|ConvertTo-Json -Compress
} finally {$scope.Dispose()}
`, nativeInput(path));
    assert.deepEqual(proof, { refused: true, attempted: true, stage: 'NATIVE_CREATE' });
    assert.equal(await readFile(path, 'utf8'), 'raced incumbent');
  });
});

test('Windows private byte capture and retained ancestors/output deny substitution, writers and premature reuse', WINDOWS, async () => {
  await withDirectory(async root => {
    const parent = join(root, 'parent'); await mkdir(parent); const path = join(parent, 'captured.pdf');
    const proof = nativeFixture(String.raw`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class PdfWriteHandleFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 public static SafeFileHandle Open(string p,uint access) {return CreateFileW(p,access,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);}
}
'@
$scope=New-Object SovereignPdfWriteV1 -ArgumentList $r.path,$content,$r.sha256,$r.pageCount
try {
 $constructorDidNotCreate=-not [IO.File]::Exists($r.path)
 $parentRenameDenied=$false
 try {[IO.Directory]::Move($r.parent,($r.parent+'-changed'))} catch {$parentRenameDenied=$true}
 $writer=[PdfWriteHandleFixture]::Open($r.parent,0x40000000)
 try {$parentWriteDenied=$writer.IsInvalid} finally {$writer.Dispose()}
 $content[0]=0
 $result=$scope.Write()
 $reader=[PdfWriteHandleFixture]::Open($r.path,2147483648)
 try {$outputReadDenied=$reader.IsInvalid} finally {$reader.Dispose()}
 $writer=[PdfWriteHandleFixture]::Open($r.path,0x40000000)
 try {$outputWriteDenied=$writer.IsInvalid} finally {$writer.Dispose()}
 $renameDenied=$false
 try {[IO.File]::Move($r.path,($r.path+'.moved'))} catch {$renameDenied=$true}
 $reuseDenied=$false
 try {$scope.Write()|Out-Null} catch {$reuseDenied=$true}
} finally {$scope.Dispose()}
$reader=[PdfWriteHandleFixture]::Open($r.path,2147483648)
try {$readAfterClose=-not $reader.IsInvalid} finally {$reader.Dispose()}
@{constructorDidNotCreate=$constructorDidNotCreate;parentRenameDenied=$parentRenameDenied;parentWriteDenied=$parentWriteDenied;
outputReadDenied=$outputReadDenied;outputWriteDenied=$outputWriteDenied;renameDenied=$renameDenied;
reuseDenied=$reuseDenied;readAfterClose=$readAfterClose;created=$result.created}|ConvertTo-Json -Compress
`, { ...nativeInput(path), parent });
    for (const value of Object.values(proof)) assert.equal(value, true, JSON.stringify(proof));
    assert.deepEqual(await readFile(path), render({ ...REQUEST, path }));
  });
});

test('Windows metadata-only in-place junction conversion cannot redirect retained-parent creation or an existing output', WINDOWS, async () => {
  await withDirectory(async root => {
    const parent = join(root, 'empty-parent'), outside = join(root, 'outside');
    const laterParent = join(root, 'later-parent'), laterOutside = join(root, 'later-outside');
    const controlParent = join(root, 'control-parent'), controlOutside = join(root, 'control-outside');
    await Promise.all([parent, outside, laterParent, laterOutside, controlParent, controlOutside].map(path => mkdir(path)));
    const path = join(parent, 'report.pdf'), laterPath = join(laterParent, 'report.pdf');
    const proof = nativeFixture(String.raw`
Add-Type -TypeDefinition @'
using System; using System.Text; using System.ComponentModel;
using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class PdfMetadataReparseFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool DeviceIoControl(SafeFileHandle h,uint code,byte[] input,int inputBytes,
  IntPtr output,int outputBytes,out int returned,IntPtr overlapped);
 public static SafeFileHandle Metadata(string path) {
  // FILE_WRITE_ATTRIBUTES is deliberately narrower than GENERIC_WRITE. Its
  // sharing semantics cannot be inferred from the other writer fixture.
  var handle=CreateFileW(path,0x100,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
  if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error);}
  return handle;
 }
 public static int TrySet(SafeFileHandle handle,string target) {
  byte[] substitute=Encoding.Unicode.GetBytes(@"\??\"+target), print=Encoding.Unicode.GetBytes(target);
  byte[] buffer=new byte[16+substitute.Length+2+print.Length+2];
  BitConverter.GetBytes(0xA0000003u).CopyTo(buffer,0);
  BitConverter.GetBytes(checked((ushort)(buffer.Length-8))).CopyTo(buffer,4);
  BitConverter.GetBytes(checked((ushort)substitute.Length)).CopyTo(buffer,10);
  BitConverter.GetBytes(checked((ushort)(substitute.Length+2))).CopyTo(buffer,12);
  BitConverter.GetBytes(checked((ushort)print.Length)).CopyTo(buffer,14);
  substitute.CopyTo(buffer,16);print.CopyTo(buffer,18+substitute.Length);
  int returned;
  return DeviceIoControl(handle,0x900A4,buffer,buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero)
   ? 0 : Marshal.GetLastWin32Error();
 }
 public static void Remove(SafeFileHandle handle) {
  byte[] buffer=new byte[8];BitConverter.GetBytes(0xA0000003u).CopyTo(buffer,0);int returned;
  if(!DeviceIoControl(handle,0x900AC,buffer,buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero))
   throw new Win32Exception(Marshal.GetLastWin32Error());
 }
}
'@
$controlSetter=$null;$controlConverted=$false;$controlRedirected=$false
try {
 # The identical metadata-only FSCTL must work without production pins. An
 # invalid fixture buffer or unusable metadata handle is not a safe denial.
 $controlSetter=[PdfMetadataReparseFixture]::Metadata($r.controlParent)
 $controlSetError=[PdfMetadataReparseFixture]::TrySet($controlSetter,$r.controlOutside)
 if($controlSetError -ne 0){throw ('FIXTURE_METADATA_REPARSE_CONTROL_FAILED:'+ $controlSetError)}
 $controlConverted=$true
 $controlProbe=[IO.Path]::Combine($r.controlParent,'control-probe.txt')
 $controlOutsideProbe=[IO.Path]::Combine($r.controlOutside,'control-probe.txt')
 [IO.File]::WriteAllText($controlProbe,'control-outside')
 $controlRedirected=[IO.File]::ReadAllText($controlOutsideProbe) -ceq 'control-outside'
 [IO.File]::Delete($controlOutsideProbe)
} finally {
 try {if($controlConverted -and $null -ne $controlSetter){[PdfMetadataReparseFixture]::Remove($controlSetter)}}
 finally {if($null -ne $controlSetter){$controlSetter.Dispose()}}
}
$scope=$null;$setter=$null;$converted=$false;$relativeCreated=$false;$relativeRefused=$false
$productionRefused=$false;$productionCreated=$false;$pathnameRedirected=$false
$productionOutside=$false;$relativeOutside=$false
try {
 $scope=New-Object SovereignPdfWriteV1 -ArgumentList $r.path,$content,$r.sha256,$r.pageCount
 $setter=[PdfMetadataReparseFixture]::Metadata($r.parent)
 $setError=[PdfMetadataReparseFixture]::TrySet($setter,$r.outside)
 $converted=$setError -eq 0
 if($converted) {
  # Establish a real redirect, then remove only this disposable probe.
  $probe=[IO.Path]::Combine($r.parent,'pathname-probe.txt')
  $outsideProbe=[IO.Path]::Combine($r.outside,'pathname-probe.txt')
  [IO.File]::WriteAllText($probe,'outside-probe')
  $pathnameRedirected=[IO.File]::ReadAllText($outsideProbe) -ceq 'outside-probe'
  [IO.File]::Delete($outsideProbe)
 }
 try {$written=$scope.Write();$productionCreated=$written.created} catch {
  $cause=$_.Exception;while($null -ne $cause.InnerException){$cause=$cause.InnerException}
  if($cause.Message -cnotmatch '\ASOVEREIGN_PDF_[A-Z_]+\z' -and $cause -isnot [ComponentModel.Win32Exception]) {throw}
  $productionRefused=$true
 }
 $productionOutside=[IO.File]::Exists([IO.Path]::Combine($r.outside,'report.pdf'))
 # Invoke the exact production relative-create primitive while the parent
 # already carries the raced reparse, covering the check-to-create window.
 # No hook, bypass or sharing relaxation is added to production source.
 $flags=[Reflection.BindingFlags]'NonPublic,Instance'
 $parentField=[SovereignPdfWriteV1].GetField('parent',$flags)
 if($null -eq $parentField){throw 'FIXTURE_PARENT_FIELD_MISSING'}
 $pin=$parentField.GetValue($scope)
 $handleField=$pin.GetType().GetField('Handle')
 if($null -eq $handleField){throw 'FIXTURE_PARENT_HANDLE_MISSING'}
 $retained=$handleField.GetValue($pin)
 $relative=[SovereignPdfWriteV1].GetMethod('RelativeOpen',[Reflection.BindingFlags]'NonPublic,Static')
 if($null -eq $relative){throw 'FIXTURE_RELATIVE_PRIMITIVE_MISSING'}
 $created=$null
 try {
  $created=$relative.Invoke($null,@($retained,'relative-only.pdf',$true,$false,$false))
  $relativeCreated=-not $created.IsInvalid
 } catch {
  $cause=$_.Exception;while($null -ne $cause.InnerException){$cause=$cause.InnerException}
  if($cause -isnot [ComponentModel.Win32Exception] -and $cause.Message -cnotmatch '\ASOVEREIGN_PDF_[A-Z_]+\z') {throw}
  $relativeRefused=$true
 } finally {if($null -ne $created){$created.Dispose()}}
 $relativeOutside=[IO.File]::Exists([IO.Path]::Combine($r.outside,'relative-only.pdf'))
} finally {
 try {if($converted -and $null -ne $setter){[PdfMetadataReparseFixture]::Remove($setter)}}
 finally {if($null -ne $setter){$setter.Dispose()};if($null -ne $scope){$scope.Dispose()}}
}
$relativeOriginal=[IO.File]::Exists([IO.Path]::Combine($r.parent,'relative-only.pdf'))
$productionOriginal=[IO.File]::Exists($r.path)
# A second real FSCTL attempt is made after a created output exists. A directory
# normally must be empty for SET_REPARSE_POINT; test the call, do not infer it
# from a denied GENERIC_WRITE handle or from the earlier empty-directory result.
$laterScope=$null;$laterSetter=$null;$laterConverted=$false;$laterOutsideCreated=$false
try {
 $laterScope=New-Object SovereignPdfWriteV1 -ArgumentList $r.laterPath,$content,$r.sha256,$r.pageCount
 $laterReceipt=$laterScope.Write()
 $laterSetter=[PdfMetadataReparseFixture]::Metadata($r.laterParent)
 $laterSetError=[PdfMetadataReparseFixture]::TrySet($laterSetter,$r.laterOutside)
 $laterConverted=$laterSetError -eq 0
 $laterOutsideCreated=[IO.File]::Exists([IO.Path]::Combine($r.laterOutside,'report.pdf'))
} finally {
 try {if($laterConverted -and $null -ne $laterSetter){[PdfMetadataReparseFixture]::Remove($laterSetter)}}
 finally {if($null -ne $laterSetter){$laterSetter.Dispose()};if($null -ne $laterScope){$laterScope.Dispose()}}
}
@{controlRedirected=$controlRedirected;setError=$setError;converted=$converted;pathnameRedirected=$pathnameRedirected;
productionRefused=$productionRefused;productionCreated=$productionCreated;productionOutside=$productionOutside;
relativeCreated=$relativeCreated;relativeRefused=$relativeRefused;relativeOutside=$relativeOutside;
relativeOriginal=$relativeOriginal;productionOriginal=$productionOriginal;
laterCreated=$laterReceipt.created;laterSetError=$laterSetError;laterConverted=$laterConverted;
laterOutsideCreated=$laterOutsideCreated}|ConvertTo-Json -Compress
`, { ...nativeInput(path), parent, outside, laterParent, laterOutside, laterPath, controlParent, controlOutside });
    assert.equal(proof.controlRedirected, true, JSON.stringify(proof));
    assert.equal(Number.isInteger(proof.setError), true, JSON.stringify(proof));
    assert.equal(Number.isInteger(proof.laterSetError), true, JSON.stringify(proof));
    assert.equal(proof.converted, proof.setError === 0);
    if (proof.converted) {
      assert.equal(proof.pathnameRedirected, true, JSON.stringify(proof));
      assert.equal(proof.productionRefused, true, JSON.stringify(proof));
      assert.equal(proof.productionCreated, false, JSON.stringify(proof));
      assert.equal(proof.productionOriginal, false, JSON.stringify(proof));
    } else {
      assert.equal(proof.setError > 0, true, JSON.stringify(proof));
      assert.equal(proof.productionCreated, true, JSON.stringify(proof));
      assert.deepEqual(await readFile(path), render({ ...REQUEST, path }));
    }
    assert.equal(proof.relativeCreated || proof.relativeRefused, true, JSON.stringify(proof));
    if (proof.relativeCreated) assert.equal(proof.relativeOriginal, true, JSON.stringify(proof));
    assert.equal(proof.productionOutside, false, JSON.stringify(proof));
    assert.equal(proof.relativeOutside, false, JSON.stringify(proof));
    assert.equal(proof.laterCreated, true, JSON.stringify(proof));
    assert.equal(proof.laterOutsideCreated, false, JSON.stringify(proof));
    assert.deepEqual(await readFile(laterPath), render({ ...REQUEST, path: laterPath }));
    for (const escaped of [join(outside, 'report.pdf'), join(outside, 'relative-only.pdf'), join(laterOutside, 'report.pdf')])
      await assert.rejects(lstat(escaped), { code: 'ENOENT' });
  });
});

test('Windows native validates path/hash/bounds before construction and no leaf exists on failed admission', WINDOWS, async () => {
  await withDirectory(async root => {
    const path = join(root, 'denied.pdf');
    const proof = nativeFixture(String.raw`
$checks=@()
$prior=[Threading.Thread]::CurrentThread.CurrentCulture
try {
 foreach($culture in @('en-US','tr-TR')) {
  [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($culture)
  [SovereignPdfWriteV1]::ValidateRequest($r.path,$content,$r.sha256,$r.pageCount)
  foreach($bad in @(([char]0xfeff+$r.path),($r.path+[char]0xfeff),($r.path+[char]0xd800),($r.path+'.txt'))) {
   $denied=$false
   try {[SovereignPdfWriteV1]::ValidateRequest($bad,$content,$r.sha256,$r.pageCount)} catch {$denied=$true}
   $checks+=$denied
  }
 }
} finally {[Threading.Thread]::CurrentThread.CurrentCulture=$prior}
$wrongHash=$false;$tooLarge=$false;$badPages=$false
try {$scope=New-Object SovereignPdfWriteV1 -ArgumentList $r.path,$content,('f'*64),$r.pageCount;$scope.Dispose()} catch {$wrongHash=$true}
try {[SovereignPdfWriteV1]::ValidateRequest($r.path,(New-Object byte[] 65537),$r.sha256,$r.pageCount)} catch {$tooLarge=$true}
try {[SovereignPdfWriteV1]::ValidateRequest($r.path,$content,$r.sha256,9)} catch {$badPages=$true}
@{checks=$checks;wrongHash=$wrongHash;tooLarge=$tooLarge;badPages=$badPages;absent=(-not [IO.File]::Exists($r.path))}|ConvertTo-Json -Compress
`, nativeInput(path));
    assert.equal(proof.checks.length, 8); assert.equal(proof.checks.every(Boolean), true);
    for (const key of ['wrongHash', 'tooLarge', 'badPages', 'absent']) assert.equal(proof[key], true, JSON.stringify(proof));
    await assert.rejects(lstat(path), { code: 'ENOENT' });
  });
});

test('Windows actual created PDF with a lost terminal remains UNKNOWN and is never replayed', WINDOWS, async () => {
  await withDirectory(async root => {
    const path = join(root, 'lost-terminal.pdf'); let spawns = 0;
    const result = await write({ ...REQUEST, path }, { spawnFn(...args) {
      spawns++; const child = spawn(...args); child.stdout.on('data', chunk => chunk.fill(32)); return child;
    } });
    assert.equal(result.ok, false); assert.equal(result.mutationState, 'UNKNOWN'); assert.equal(result.retryAllowed, false);
    assert.equal(spawns, 1); assert.deepEqual(await readFile(path), render({ ...REQUEST, path }));
  });
});
