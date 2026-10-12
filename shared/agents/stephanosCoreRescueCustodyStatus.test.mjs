import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const status = await readFile(
  new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url), 'utf8',
);
const watchdog = await readFile(
  new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8',
);

test('Core status fails closed on ambiguous process and lock writer custody', () => {
  assert.match(status, /\$processes\.Count -eq 1 -and \$writerProcessObserved -and \$lockOwnerMatchesWriter/);
  assert.match(status, /\$lockOwnerPid -eq \$writerPid/);
  assert.match(status, /\$singleWriterProven -and\s+\$rescueGenerationPresent -and/);
  assert.match(status, /\$status\.PSObject\.Properties\['outerBridgeRunCount'\]/);
  assert.match(status, /\$status\.PSObject\.Properties\['outerBridgeLastStage'\]/);
  assert.match(status, /STEPHANOS_CORE_DAEMON_OWNER_CUSTODY_UNPROVEN/);
  assert.match(status, /STEPHANOS_CORE_DAEMON_RESCUE_GENERATION_UNPROVEN/);
  assert.doesNotMatch(status, /\$processes\.Count -ge 1 -and/);
});

test('Sovereign watchdog never blanket-recycles ambiguous Core process matches', () => {
  const guardAt = watchdog.indexOf("if ($coreBefore.Count -gt 1) {");
  const singleAt = watchdog.indexOf("elseif ($coreBefore.Count -eq 1 -and -not [bool]$coreHealthBefore.healthy)", guardAt);
  const missingAt = watchdog.indexOf("elseif ($coreBefore.Count -eq 0)", singleAt);
  assert.ok(guardAt >= 0 && singleAt > guardAt && missingAt > singleAt);
  assert.match(watchdog.slice(guardAt, singleAt), /SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS/);
  assert.match(watchdog.slice(singleAt, missingAt), /SOVEREIGN_COMMANDER_CORE_DAEMON_SINGLE_WRITER_UNVERIFIED/);
  assert.doesNotMatch(watchdog, /foreach \(\$process in \$coreBefore\)/);
  assert.doesNotMatch(watchdog, /Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/);
  assert.match(watchdog, /\$coreDaemonOk = \[bool\]\(\$coreAfter\.Count -eq 1 -and \$coreHealthAfter\.healthy -and -not \$coreDaemonBlocker\)/);
  assert.match(watchdog, /\$coreDaemonOk = \[bool\]\(\$coreObserved\.Count -eq 1 -and \$coreObservedHealth\.healthy -and -not \$coreDaemonBlocker\)/);
  assert.doesNotMatch(watchdog, /\$coreDaemonOk = \[bool\]\(\$coreAfter\.Count -ge 1/);
});

test('Custody observations remain read-only and do not directly seize lease or kill processes', () => {
  assert.doesNotMatch(status, /Stop-Process|taskkill|Remove-Item|Unregister-ScheduledTask/);
  assert.match(status, /singleWriterProven = \$singleWriterProven/);
  assert.match(status, /rescueAttemptCount = \$rescueAttemptCount/);
});
