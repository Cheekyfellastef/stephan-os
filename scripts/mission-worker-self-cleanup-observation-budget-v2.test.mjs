import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtimeSource = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
const specialistSource = await readFile(new URL('../shared/agents/windowsAuthorityMissionWorkerCleanupReviewV1.mjs', import.meta.url), 'utf8');

function sliceFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.ok(end > start, `${name} must have a bounded source slice`);
  return source.slice(start, end);
}

test('post-authority cleanup observation consumes the existing fixed cleanup budget instead of a shorter literal window', () => {
  const observer = sliceFunction(runtimeSource, 'Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');

  assert.match(runtimeSource, /\$missionWorkerCleanupTimeoutSeconds\s*=\s*10\b/);
  assert.match(observer, /\$observationDeadlineUtc\s*=\s*\[datetime\]::UtcNow\.AddSeconds\(\$missionWorkerCleanupTimeoutSeconds\)/);
  assert.match(observer, /\$reserveDeadlineUtc\s*=\s*\$script:operationDeadlineUtc\.AddSeconds\(\$missionWorkerCleanupTimeoutSeconds\)/);
  assert.doesNotMatch(observer, /AddSeconds\(4\)/);
  assert.doesNotMatch(observer, /\$script:operationDeadlineUtc\s*=/);
});

test('cleanup observation remains read-only and fail-closed while using the full existing reserve', () => {
  const observer = sliceFunction(runtimeSource, 'Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');

  assert.match(observer, /Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\' -ErrorAction Stop/);
  assert.match(observer, /\[string\]\$task\.State -in @\('Ready', 'Disabled'\)/);
  assert.match(observer, /Get-CimInstance Win32_Process[^\r\n]*-OperationTimeoutSec 1 -ErrorAction Stop/);
  assert.match(observer, /Test-ExactCanonicalWorkerProcess -Process \$process -ExpectedRepoRoot \$ExpectedRepoRoot/);
  assert.match(observer, /\$workers\.Count -eq 0/);
  assert.match(observer, /catch \{ return \$false \}/);
  assert.doesNotMatch(observer, /Stop-Process|Stop-ScheduledTask|Start-ScheduledTask|Start-Process|\.Kill\(|Remove-Item|Set-Content|Invoke-Expression/);
});

test('existing Windows specialist requires the cleanup-budget-derived observation window and rejects the retired four-second pin', () => {
  assert.match(specialistSource, /missionWorkerCleanupTimeoutSeconds/);
  assert.match(specialistSource, /observationDeadlineUtc[^\r\n]*missionWorkerCleanupTimeoutSeconds/);
  assert.match(specialistSource, /reserveDeadlineUtc[^\r\n]*missionWorkerCleanupTimeoutSeconds/);
  assert.doesNotMatch(specialistSource, /mission-worker-post-authority-four-second-window-missing/);
  assert.doesNotMatch(specialistSource, /Post-authority observation must remain a fixed four-second slice/);
});
