import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, mkdir, symlink, writeFile, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeSovereignDirectoryCreateV1 as create, validateSovereignDirectoryTargetV1 as valid } from './sovereignDirectoryCreateV1.mjs';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';

const TARGET = 'C:\\Temp\\José-测试-🚀';
const receipt = overrides => ({ schemaVersion: 'stephanos.sovereign-directory-create.v1', ok: true,
  path: TARGET, created: true, recursive: false, parentIdentity: '12345678:1234567812345678',
  identity: '12345678:1234567812345679', mutationState: 'CREATED', ...overrides });

test('one Windows target is literal: no normalization, device aliases, network or extra scope', () => {
  assert.equal(valid(TARGET), true);
  for (const path of [null, 1, '', 'relative', '/', 'C:\\', 'C:relative',
    'C:/Temp/child', '\\\\server\\share\\child', '\\\\?\\C:\\Temp\\child',
    'C:\\Temp\\..\\child', 'C:\\Temp\\.\\child', 'C:\\Temp\\child ',
    ' C:\\Temp\\child', 'C:\\Temp\\child.', 'C:\\Temp\\child:stream',
    'C:\\Temp\\child\n', 'C:\\Temp\\a\\\\b', 'C:\\Temp\\CON', 'C:\\Temp\\con.txt',
    'C:\\Temp\\CONIN$', 'C:\\Temp\\CONOUT$', 'C:\\Temp\\LPT²',
    'C:\\Temp\\COM1.txt', 'C:\\Temp\\a*', 'C:\\Temp\\a?', 'C:\\Temp\\a|b',
    'C:\\Temp\\' + 'x'.repeat(256), 'C:\\' + 'x\\'.repeat(600)]) assert.equal(valid(path), false, String(path));
});

test('source-bound native operation sends the exact Unicode path as data to one captured fixed program', () => {
  let calls = 0;
  const result = create(TARGET, { platform: 'win32', spawnSyncFn: (executable, args, settings) => {
    calls++;
    assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(args.at(-2), '-EncodedCommand');
    const program = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const exactScript = readFileSync(new URL('../../scripts/windows/sovereign-create-directory.ps1', import.meta.url), 'utf8');
    assert.equal(program, exactScript);
    const request = JSON.parse(settings.input);
    assert.equal(request.path, TARGET);
    assert.equal(request.nativeSource, readFileSync(new URL('../../scripts/windows/SovereignDirectoryCreateV1.cs', import.meta.url), 'utf8'));
    assert.equal(settings.shell, false);
    assert.equal(settings.windowsHide, true);
    assert.equal(settings.timeout, 15_000);
    assert.equal(settings.env.NODE_OPTIONS, undefined);
    return { status: 0, stdout: JSON.stringify(receipt()) };
  }, environment: { ...process.env, NODE_OPTIONS: '--require attacker.js' } });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.path, TARGET);
});

test('helper replacement is refused before spawn and a fixed filename never substitutes for source proof', () => {
  for (const changed of ['.ps1', '.cs']) {
    let calls = 0;
    const result = create(TARGET, { platform: 'win32',
      readFileSyncFn: path => String(path).endsWith(changed) ? Buffer.from('changed bytes') : readFileSync(path),
      spawnSyncFn: () => { calls++; throw new Error('must not spawn'); } });
    assert.equal(result.blocker, 'SOVEREIGN_DIRECTORY_SOURCE_MISMATCH');
    assert.equal(result.mutationState, 'NOT_STARTED');
    assert.equal(calls, 0);
  }
});

test('ambiguous terminals, malformed receipts and wrong targets never report a completed create', () => {
  const cases = [
    { status: null, stdout: JSON.stringify(receipt()) },
    { status: 0, error: { code: 'ETIMEDOUT' }, stdout: JSON.stringify(receipt()) },
    { status: 0, signal: 'SIGTERM', stdout: JSON.stringify(receipt()) },
    { status: 0, stdout: 'not JSON' },
    ...[{ path: 'C:\\Temp\\different' }, { created: false }, { recursive: true },
      { parentIdentity: '' }, { identity: '' }, { mutationState: null }]
      .map(o => ({ status: 0, stdout: JSON.stringify(receipt(o)) })),
  ];
  for (const terminal of cases) {
    const result = create(TARGET, { platform: 'win32', spawnSyncFn: () => terminal });
    assert.equal(result.ok, false);
    assert.equal(result.mutationState, 'UNKNOWN');
  }
  const failed = create(TARGET, { platform: 'win32', spawnSyncFn: () => {
    throw new Error('unexpected runner error');
  } });
  assert.equal(failed.mutationState, 'UNKNOWN');
});

test('MCP refuses whitespace-normalized targets and unknown properties before the command fabric', async () => {
  let calls = 0;
  const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo', executor: () => { calls++; } });
  const message = { id: 1, isRequest: true };
  await handler('initialize', {}, message);
  await handler('notifications/initialized', {}, { isNotification: true });
  await handler('tools/list', {}, message);
  for (const path of ['C:\\Temp\\new ', ' C:\\Temp\\new', 'C:\\Temp\\new.', 'C:\\Temp\\..\\new']) {
    const result = await handler('tools/call', { name: 'create_directory', arguments: { path } }, message);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.blocker, 'SOVEREIGN_DIRECTORY_TARGET_INVALID');
  }
  assert.equal(calls, 0);
});

test('real Windows create is Unicode-exact, create-only, nonrecursive and rejects junction parents',
  { skip: process.platform !== 'win32' }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'sovereign-directory-')));
    try {
      const target = join(root, 'José-测试-🚀');
      let terminal;
      const result = create(target, { spawnSyncFn: (...args) => { terminal = spawnSync(...args); return terminal; } });
      // This fixture contains only a disposable CI path and committed source.
      // Keep production failures sanitized; retain the actual test subprocess
      // diagnostic here so platform failures can be fixed without guessing.
      assert.equal(result.ok, true, JSON.stringify({ result, terminal: {
        status: terminal?.status, stdout: terminal?.stdout, stderr: terminal?.stderr,
      } }));
      assert.equal((await lstat(target)).isDirectory(), true);
      const sentinel = join(target, 'keep.txt');
      await writeFile(sentinel, 'preserve');
      assert.equal(create(target).blocker, 'SOVEREIGN_DIRECTORY_TARGET_EXISTS');
      assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
      assert.equal(create(join(root, 'absent', 'child')).ok, false);
      const alias = join(root, 'junction');
      await symlink(root, alias, 'junction');
      assert.equal(create(join(alias, 'escaped')).blocker, 'SOVEREIGN_DIRECTORY_PARENT_REDIRECTED');
      await assert.rejects(lstat(join(root, 'escaped')), { code: 'ENOENT' });
      const file = join(root, 'file'); await writeFile(file, 'unchanged');
      assert.equal(create(file).ok, false);
      assert.equal(await readFile(file, 'utf8'), 'unchanged');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test('actual Windows ancestor pins deny rename and write handles until one relative create completes',
  { skip: process.platform !== 'win32' }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'sovereign-pinned-parent-')));
    const parent = join(root, 'parent'); await mkdir(parent);
    const source = readFileSync(new URL('../../scripts/windows/SovereignDirectoryCreateV1.cs', import.meta.url), 'utf8');
    const fixture = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false,$true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false,$true)
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -TypeDefinition $r.source
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class DirectoryAttackFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 public static SafeFileHandle Write(string p) { return CreateFileW(p,0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero); }
}
'@
$scope=New-Object SovereignDirectoryCreateV1 -ArgumentList ([IO.Path]::Combine($r.parent,'leaf'))
try {
 $renameDenied=$false
 try {[IO.Directory]::Move($r.parent,($r.parent+'-moved'))} catch {$renameDenied=$true}
 $writer=[DirectoryAttackFixture]::Write($r.parent)
 try {$writeDenied=$writer.IsInvalid} finally {$writer.Dispose()}
 $identity=$scope.Create()
 $reuseDenied=$false
 try {$scope.Create()|Out-Null} catch {$reuseDenied=$true}
} finally {$scope.Dispose()}
$writer=[DirectoryAttackFixture]::Write($r.parent)
try {
 $afterReleaseWritable=-not $writer.IsInvalid
 $preexistingWriterDenied=$false
 try {$blocked=New-Object SovereignDirectoryCreateV1 -ArgumentList ([IO.Path]::Combine($r.parent,'other'));$blocked.Dispose()}
 catch {$preexistingWriterDenied=$true}
} finally {$writer.Dispose()}
@{renameDenied=$renameDenied;writeDenied=$writeDenied;reuseDenied=$reuseDenied;identity=$identity;
 afterReleaseWritable=$afterReleaseWritable;preexistingWriterDenied=$preexistingWriterDenied}|ConvertTo-Json -Compress
`;
    try {
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(fixture, 'utf16le').toString('base64')],
        { input: JSON.stringify({ source, parent }), encoding: 'utf8', timeout: 30_000, windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      const proof = JSON.parse(result.stdout.trim());
      for (const key of ['renameDenied', 'writeDenied', 'reuseDenied', 'afterReleaseWritable', 'preexistingWriterDenied'])
        assert.equal(proof[key], true, key);
      assert.match(proof.identity, /^[a-f0-9]{8}:[a-f0-9]{16}$/);
      assert.equal((await lstat(join(parent, 'leaf'))).isDirectory(), true);
      await assert.rejects(lstat(join(parent, 'other')), { code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
