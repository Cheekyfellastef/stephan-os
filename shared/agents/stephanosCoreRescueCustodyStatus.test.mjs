import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const status = await readFile(
  new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url), 'utf8',
);
const watchdog = await readFile(
  new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8',
);
const remote = await readFile(
  new URL('./sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8',
);

test('Core status fails closed on ambiguous process and lock writer custody', () => {
  assert.match(status, /\$processes\.Count -eq 1 -and \$writerProcessObserved -and \$lockOwnerMatchesWriter/);
  assert.match(status, /\$lockOwnerPid -eq \$writerPid/);
  assert.match(status, /\$singleWriterProven -and\s+\$rescueGenerationPresent -and/);
  assert.match(status, /\$status\.PSObject\.Properties\['outerBridgeRunCount'\]/);
  assert.match(status, /\$status\.PSObject\.Properties\['outerBridgeLastStage'\]/);
  assert.match(status, /STEPHANOS_CORE_DAEMON_OWNER_CUSTODY_UNPROVEN/);
  assert.match(status, /STEPHANOS_CORE_DAEMON_RESCUE_GENERATION_UNPROVEN/);
  assert.match(status, /\$stage -cmatch/);
  assert.match(status, /\$rescueGenerationPresent = \$true/);
  assert.match(status, /\[int\]::TryParse\(\[string\]\$status\.outerBridgeRunCount/);
  assert.doesNotMatch(status, /\$processes\.Count -ge 1 -and/);
});

test('Sovereign watchdog never blanket-recycles ambiguous Core process matches', () => {
  const guardAt = watchdog.indexOf("if ($coreBefore.Count -gt 1) {");
  const singleAt = watchdog.indexOf("elseif ($coreBefore.Count -eq 1 -and -not [bool]$coreHealthBefore.healthy)", guardAt);
  const missingAt = watchdog.indexOf("elseif ($coreBefore.Count -eq 0)", singleAt);
  assert.ok(guardAt >= 0 && singleAt > guardAt && missingAt > singleAt);
  assert.match(watchdog.slice(guardAt, singleAt), /SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS/);
  assert.match(watchdog.slice(singleAt, missingAt), /SOVEREIGN_COMMANDER_CORE_DAEMON_SINGLE_WRITER_UNVERIFIED/);
  const afterCoreAt = watchdog.indexOf('$coreAfter = @(Get-StephanosCoreDaemonProcesses)', missingAt);
  assert.ok(afterCoreAt > missingAt);
  const coreLifecycleOnly = watchdog.slice(guardAt, afterCoreAt);
  assert.doesNotMatch(coreLifecycleOnly, /foreach \(\$process in \$coreBefore\)/);
  assert.doesNotMatch(coreLifecycleOnly, /Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/);
  assert.match(watchdog, /\$coreDaemonOk = \[bool\]\(\$coreAfter\.Count -eq 1 -and \$coreHealthAfter\.healthy -and -not \$coreDaemonBlocker\)/);
  assert.match(watchdog, /\$coreDaemonOk = \[bool\]\(\$coreObserved\.Count -eq 1 -and \$coreObservedHealth\.healthy -and -not \$coreDaemonBlocker\)/);
  assert.doesNotMatch(watchdog, /\$coreDaemonOk = \[bool\]\(\$coreAfter\.Count -ge 1/);
  assert.match(watchdog, /\$coreDaemonLockPath = Join-Path/);
  assert.match(watchdog, /\$writerCustodyProven = \[bool\]\(/);
  assert.match(watchdog, /\$lockOwnerPid -eq \$writerPid/);
  assert.match(watchdog, /\$rescueGenerationProven = \[bool\]\(/);
  const healthStart = watchdog.indexOf('function Get-StephanosCoreDaemonHealth {');
  const healthEnd = watchdog.indexOf('function Get-SovereignRelayDaemonProcesses {', healthStart);
  const coreHealthOnly = watchdog.slice(healthStart, healthEnd);
  assert.match(coreHealthOnly, /\$writerCustodyProven -and \$rescueGenerationProven -and/g);
  assert.ok((coreHealthOnly.match(/\$writerCustodyProven -and \$rescueGenerationProven -and/g) || []).length >= 2);
});

test('Custody observations remain read-only and do not directly seize lease or kill processes', () => {
  assert.doesNotMatch(status, /Stop-Process|taskkill|Remove-Item|Unregister-ScheduledTask/);
  assert.match(status, /singleWriterProven = \$singleWriterProven/);
  assert.match(status, /rescueAttemptCount = \$rescueAttemptCount/);
});

test('remote Core status exposes bounded proof booleans but not raw process identity', () => {
  const start = remote.indexOf('function safeCoreDaemonStatusProjection(value = {})');
  const end = remote.indexOf('function safeProjectSearchProjection(', start);
  assert.ok(start >= 0 && end > start);
  const projection = remote.slice(start, end);
  for (const field of [
    'singleWriterProven', 'writerProcessObserved', 'lockOwnerMatchesWriter',
    'rescueGenerationPresent', 'rescueAttemptCount', 'reportedDaemonHealthy',
  ]) {
    assert.match(projection, new RegExp(field + ':'));
  }
  assert.doesNotMatch(projection, /processId:|lockOwnerPid:|commandLine:|lockPath:/);
  assert.match(projection, /Number\.isSafeInteger\(parsed\.rescueAttemptCount\)/);
});
