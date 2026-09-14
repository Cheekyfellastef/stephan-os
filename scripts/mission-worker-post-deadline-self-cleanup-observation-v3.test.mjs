import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test('post-authority self-cleanup proof receives a fresh fixed read-only observation window even after mutation deadline exhaustion', () => {
  const observer = sliceFunction('Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');
  assert.match(observer, /\$observationDeadlineUtc\s*=\s*\[datetime\]::UtcNow\.AddSeconds\(\$missionWorkerCleanupTimeoutSeconds\)/);
  assert.doesNotMatch(observer, /\$script:operationDeadlineUtc\.AddSeconds\(\$missionWorkerCleanupTimeoutSeconds\)/);
  assert.doesNotMatch(observer, /\$observationDeadlineUtc\s*=\s*\$reserveDeadlineUtc/);
});

test('post-deadline observation remains bounded, read-only and exact canonical-worker scoped', () => {
  const observer = sliceFunction('Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');
  assert.match(observer, /Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\' -ErrorAction Stop/);
  assert.match(observer, /Test-ExactCanonicalWorkerProcess -Process \$process -ExpectedRepoRoot \$ExpectedRepoRoot/);
  assert.match(observer, /Start-Sleep -Milliseconds 100/);
  assert.match(observer, /return \$false/);
  assert.doesNotMatch(observer, /Stop-Process|Stop-ScheduledTask|Start-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask|Remove-Item|Move-Item|Write-BoundedAtomicJson/);
});
