import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const launcherPath = new URL('./windows/start-mission-orchestrator-worker.ps1', import.meta.url);
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const maximumLogBytes = 64 * 1024 * 1024;
const retainedArchiveBytes = 8 * 1024 * 1024;

function retentionFunction(source) {
  const startMarker = '# WORKER_LOG_RETENTION_FUNCTION_START';
  const endMarker = '# WORKER_LOG_RETENTION_FUNCTION_END';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'bounded retention function markers must be present in order');
  return source.slice(start + startMarker.length, end);
}

async function sparseFile(path, size, tail = '') {
  const handle = await open(path, 'w');
  try {
    await handle.truncate(size);
    if (tail) await handle.write(Buffer.from(tail), 0, Buffer.byteLength(tail), size - Buffer.byteLength(tail));
  } finally {
    await handle.close();
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-log-retention-'));
  const source = await readFile(launcherPath, 'utf8');
  const runner = join(root, 'run-retention.ps1');
  await writeFile(runner, `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
${retentionFunction(source)}
$logRoot = [System.IO.Path]::GetFullPath($args[0])
$logPath = Join-Path $logRoot 'worker.log'
$archivePath = Join-Path $logRoot 'worker.previous.log'
if ($args.Count -gt 1 -and $args[1] -eq 'write-large') {
    Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $archivePath -Line (('x' * 10000) + "\`nsecond-line")
} else {
    Invoke-BoundedWorkerLogRetention -LogRoot $logRoot -LogPath $logPath -ArchivePath $archivePath
}
`, 'utf8');
  return { root, runner, logPath: join(root, 'worker.log'), archivePath: join(root, 'worker.previous.log') };
}

function runRetention(fixtureRoot, runner, mode = '') {
  return spawnSync(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    runner,
    fixtureRoot,
    ...(mode ? [mode] : []),
  ], { encoding: 'utf8', windowsHide: true });
}

test('oversized current log becomes one bounded retained tail with no temporary residue', async () => {
  const paths = await fixture();
  const marker = 'exact-retained-tail-marker';
  try {
    await sparseFile(paths.logPath, maximumLogBytes + 1, marker);
    await sparseFile(paths.archivePath, retainedArchiveBytes + 1, 'old-archive');
    const result = runRetention(paths.root, paths.runner);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await assert.rejects(stat(paths.logPath), /ENOENT/);
    assert.equal((await stat(paths.archivePath)).size, retainedArchiveBytes);
    const archive = await readFile(paths.archivePath);
    assert.equal(archive.subarray(-Buffer.byteLength(marker)).toString('utf8'), marker);
    assert.deepEqual((await readdir(paths.root)).sort(), ['run-retention.ps1', 'worker.previous.log']);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('small current log is preserved while an oversized retained archive is bounded', async () => {
  const paths = await fixture();
  try {
    await sparseFile(paths.logPath, 1024, 'current-log');
    await sparseFile(paths.archivePath, retainedArchiveBytes + 1, 'retained-tail');
    const result = runRetention(paths.root, paths.runner);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal((await stat(paths.logPath)).size, 1024);
    assert.equal((await stat(paths.archivePath)).size, retainedArchiveBytes);
    assert.deepEqual((await readdir(paths.root)).sort(), ['run-retention.ps1', 'worker.log', 'worker.previous.log']);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('bounded line writer rotates during a long run and emits one capped UTF-8 line', async () => {
  const paths = await fixture();
  try {
    await sparseFile(paths.logPath, maximumLogBytes + 1, 'retained-before-write');
    const result = runRetention(paths.root, paths.runner, 'write-large');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal((await stat(paths.archivePath)).size, retainedArchiveBytes);
    const current = await readFile(paths.logPath, 'utf8');
    assert.equal(Buffer.byteLength(current) < 16 * 1024, true);
    assert.match(current, /\.\.\.\[worker-log-line-truncated\]/);
    assert.equal(current.trimEnd().includes('\n'), false);
    assert.deepEqual((await readdir(paths.root)).sort(), ['run-retention.ps1', 'worker.log', 'worker.previous.log']);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('non-file archive fails closed without moving the current log', async () => {
  const paths = await fixture();
  try {
    await sparseFile(paths.logPath, maximumLogBytes + 1, 'current-log');
    await mkdir(paths.archivePath);
    const result = runRetention(paths.root, paths.runner);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /retained log must be one plain file/);
    assert.equal((await stat(paths.logPath)).size, maximumLogBytes + 1);
    assert.equal((await stat(paths.archivePath)).isDirectory(), true);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});

test('non-file replacement backup fails closed without moving the current log', async () => {
  const paths = await fixture();
  const replacementBackupPath = join(paths.root, '.worker.previous.replaced.log');
  try {
    await sparseFile(paths.logPath, maximumLogBytes + 1, 'current-log');
    await mkdir(replacementBackupPath);
    const result = runRetention(paths.root, paths.runner);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /replacement backup must be one plain file/);
    assert.equal((await stat(paths.logPath)).size, maximumLogBytes + 1);
    assert.equal((await stat(replacementBackupPath)).isDirectory(), true);
  } finally {
    await rm(paths.root, { recursive: true, force: true });
  }
});
