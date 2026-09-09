import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherPath = new URL('./windows/start-mission-orchestrator-worker.ps1', import.meta.url);
const source = await readFile(launcherPath, 'utf8');

function occurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

function assertInOrder(value, fragments, message) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = value.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `${message}: missing or out of order: ${fragment}`);
    cursor = next;
  }
}

function retentionFunctions() {
  const startMarker = '# WORKER_LOG_RETENTION_FUNCTION_START';
  const endMarker = '# WORKER_LOG_RETENTION_FUNCTION_END';
  assert.equal(occurrences(source, startMarker), 1, 'retention start marker must remain unique');
  assert.equal(occurrences(source, endMarker), 1, 'retention end marker must remain unique');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(end > start, 'bounded retention function markers must remain in order');
  return source.slice(start + startMarker.length, end);
}

test('worker log retention remains a fixed-path fail-closed source contract', () => {
  const functions = retentionFunctions();
  assert.match(functions, /\$maximumLogBytes = 64MB/);
  assert.match(functions, /\$retainedArchiveBytes = 8MB/);
  assert.match(functions, /\[System\.IO\.Path\]::GetFullPath\(\$LogRoot\)/);
  assert.match(functions, /\(Split-Path -Leaf \$resolvedLogPath\) -ne 'worker\.log'/);
  assert.match(functions, /\(Split-Path -Leaf \$resolvedArchivePath\) -ne 'worker\.previous\.log'/);
  assert.match(functions, /Test-Path -LiteralPath \$resolvedRoot -PathType Container/);
  assert.equal(occurrences(functions, '[System.IO.FileAttributes]::ReparsePoint'), 4);
  assert.match(functions, /replacement backup must be one plain file/);
  assert.match(functions, /current log must be one plain file/);
  assert.match(functions, /retained log must be one plain file/);
});

test('oversized current log rotation preserves only one bounded retained tail', () => {
  const functions = retentionFunctions();
  assertInOrder(functions, [
    'if ($logItem -and [long]$logItem.Length -gt $maximumLogBytes)',
    '[System.IO.File]::Delete($resolvedArchivePath)',
    '[System.IO.File]::Move($resolvedLogPath, $resolvedArchivePath)',
    '$archiveItem = Get-Item -LiteralPath $resolvedArchivePath -Force',
    'if (-not $archiveItem -or [long]$archiveItem.Length -le $retainedArchiveBytes)',
    '$bytesToRetain = [Math]::Min([long]$retainedArchiveBytes, [long]$sourceStream.Length)',
    '[void]$sourceStream.Seek(-$bytesToRetain, [System.IO.SeekOrigin]::End)',
    '$buffer = [byte[]]::new(64KB)',
    'while ($remaining -gt 0)',
    '$destinationStream.Flush($true)',
    '[System.IO.File]::Replace($temporaryArchivePath, $resolvedArchivePath, $replacementBackupPath, $true)',
    '[System.IO.File]::Delete($replacementBackupPath)',
  ], 'retention must rotate before copying and atomically replace the archive');
  assert.match(functions, /retained log ended before its bounded tail was copied/);
  assert.match(functions, /finally \{[\s\S]*\$destinationStream\.Dispose\(\)[\s\S]*\$sourceStream\.Dispose\(\)[\s\S]*Test-Path -LiteralPath \$temporaryArchivePath -PathType Leaf[\s\S]*\[System\.IO\.File\]::Delete\(\$temporaryArchivePath\)/);
});

test('bounded line writer normalizes and caps every appended line', () => {
  const functions = retentionFunctions();
  assert.match(functions, /\$maximumLineCharacters = 4000/);
  assert.match(functions, /\$truncationMarker = '\.\.\.\[worker-log-line-truncated\]'/);
  assert.match(functions, /\(\[string\]\$Line\)\.Replace\("`r", ' '\)\.Replace\("`n", ' '\)/);
  assert.match(functions, /Substring\(0, \$maximumLineCharacters - \$truncationMarker\.Length\) \+ \$truncationMarker/);
  assertInOrder(functions, [
    'Invoke-BoundedWorkerLogRetention -LogRoot $LogRoot -LogPath $LogPath -ArchivePath $ArchivePath',
    '$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)',
    '[System.IO.File]::AppendAllText([System.IO.Path]::GetFullPath($LogPath), "$singleLine`r`n", $utf8WithoutBom)',
    'Invoke-BoundedWorkerLogRetention -LogRoot $LogRoot -LogPath $LogPath -ArchivePath $ArchivePath',
  ], 'line writer must retain before and after a bounded UTF-8 append');
  assert.equal(occurrences(functions, 'Invoke-BoundedWorkerLogRetention -LogRoot $LogRoot -LogPath $LogPath -ArchivePath $ArchivePath'), 2);
});

test('launcher binds retention to the canonical worker log and all output routes', () => {
  assert.match(source, /\$logRoot = Join-Path \$missionRunnerRoot 'logs\\mission-orchestrator-worker'/);
  assert.match(source, /\$logPath = Join-Path \$logRoot 'worker\.log'/);
  assert.match(source, /\$workerLogArchivePath = Join-Path \$logRoot 'worker\.previous\.log'/);
  assertInOrder(source, [
    '[System.IO.Directory]::CreateDirectory($logRoot) | Out-Null',
    'Invoke-BoundedWorkerLogRetention -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath',
    'Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line "[$([DateTime]::UtcNow.ToString(\'o\'))] Mission Orchestrator worker starting from canonical main $headSha"',
    '$ordinaryWorker = Start-ExactWorkerWithLaunchIdentity',
    '-CaptureOutput',
    '$stdoutRead = $ordinaryWorker.Process.StandardOutput.ReadToEndAsync()',
    '$stderrRead = $ordinaryWorker.Process.StandardError.ReadToEndAsync()',
    'foreach ($line in @($stdoutText, $stderrText))',
    'Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line ([string]$line)',
    'Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line "[$([DateTime]::UtcNow.ToString(\'o\'))] Mission Orchestrator worker exited with code $exitCode"',
  ], 'launcher must retain before startup and route immutable-process output through the bounded writer');
  assert.equal(occurrences(source, 'Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath'), 3);
  assert.doesNotMatch(source, /Out-File[^\r\n]*worker\.log|Add-Content[^\r\n]*worker\.log/i);
});
