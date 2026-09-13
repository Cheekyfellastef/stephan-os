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
  assert.match(observer, /\$observationOperationReserveSeconds\s*=\s*2\b/);
  assert.match(observer, /while \(\[datetime\]::UtcNow\.AddSeconds\(\$observationOperationReserveSeconds\) -lt \$observationDeadlineUtc\)/);
  assert.match(observer, /if \(\[datetime\]::UtcNow\.AddSeconds\(1\) -ge \$observationDeadlineUtc\) \{ return \$false \}/);
  assert.doesNotMatch(observer, /AddSeconds\(4\)/);
  assert.doesNotMatch(observer, /\$script:operationDeadlineUtc\s*=/);
});

test('cleanup observation remains read-only and fail-closed while using the full existing reserve', () => {
  const observer = sliceFunction(runtimeSource, 'Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');

  const taskReadIndex = observer.indexOf("Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker'");
  const cimGuardIndex = observer.indexOf('[datetime]::UtcNow.AddSeconds(1) -ge $observationDeadlineUtc');
  const cimReadIndex = observer.indexOf('Get-CimInstance Win32_Process');

  assert.match(observer, /Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\' -ErrorAction Stop/);
  assert.match(observer, /\[string\]\$task\.State -in @\('Ready', 'Disabled'\)/);
  assert.match(observer, /Get-CimInstance Win32_Process[^\r\n]*-OperationTimeoutSec 1 -ErrorAction Stop/);
  assert.ok(taskReadIndex >= 0 && cimGuardIndex > taskReadIndex && cimReadIndex > cimGuardIndex, 'CIM observation must be guarded by the final one-second deadline check');
  assert.match(observer, /Test-ExactCanonicalWorkerProcess -Process \$process -ExpectedRepoRoot \$ExpectedRepoRoot/);
  assert.match(observer, /\$workers\.Count -eq 0/);
  assert.match(observer, /catch \{ return \$false \}/);
  assert.doesNotMatch(observer, /Stop-Process|Stop-ScheduledTask|Start-ScheduledTask|Start-Process|\.Kill\(|Remove-Item|Set-Content|Invoke-Expression/);
});

test('PR #2191 specialist profile requires the cleanup-budget-derived window without changing legacy four-second profiles', () => {
  const inspector = sliceFunction(specialistSource, 'inspectSelfCleanupObservationBudgetSource', 'executablePowerShellSource');

  assert.match(inspector, /mission-worker-post-authority-four-second-window-missing/);
  assert.match(inspector, /mission-worker-post-authority-reserve-cap-missing/);
  assert.match(inspector, /observationDeadlineUtc[^\r\n]*missionWorkerCleanupTimeoutSeconds/);
  assert.match(inspector, /reserveDeadlineUtc[^\r\n]*missionWorkerCleanupTimeoutSeconds/);
  assert.match(inspector, /mission-worker-self-cleanup-observation-budget-window-missing/);
  assert.match(inspector, /mission-worker-self-cleanup-observation-budget-reserve-cap-missing/);
  assert.doesNotMatch(inspector, /Post-authority observation must remain a fixed four-second slice/);
});
