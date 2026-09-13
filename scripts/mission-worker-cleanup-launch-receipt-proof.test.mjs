import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');

test('post-authority cleanup observation uses the fixed cleanup budget inside child-exit reserve', () => {
  const observer = sliceFunction('Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');
  assert.match(observer, /\$observationDeadlineUtc = \[datetime\]::UtcNow\.AddSeconds\(\$missionWorkerCleanupTimeoutSeconds\)/);
  assert.match(observer, /\$reserveDeadlineUtc = \$script:operationDeadlineUtc\.AddSeconds\(\$missionWorkerCleanupTimeoutSeconds\)/);
  assert.match(observer, /if \(\$observationDeadlineUtc -gt \$reserveDeadlineUtc\)/);
  assert.match(observer, /\$observationDeadlineUtc = \$reserveDeadlineUtc/);
  assert.match(observer, /\$observationOperationReserveSeconds = 2/);
  assert.match(observer, /while \(\[datetime\]::UtcNow\.AddSeconds\(\$observationOperationReserveSeconds\) -lt \$observationDeadlineUtc\)/);
  assert.match(observer, /if \(\[datetime\]::UtcNow\.AddSeconds\(1\) -ge \$observationDeadlineUtc\) \{ return \$false \}/);
  assert.doesNotMatch(observer, /\$script:operationDeadlineUtc\s*=/);
});

test('self-cleanup observation requires terminal fixed task and absent canonical worker', () => {
  const observer = sliceFunction('Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');
  assert.ok(observer.includes("Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\' -ErrorAction Stop"));
  assert.match(observer, /\$task -and \[string\]\$task.State -in @\('Ready', 'Disabled'\)/);
  assert.doesNotMatch(observer, /'Running'|'Queued'/);
  assert.match(observer, /\$nodeProcesses = @\(Get-CimInstance Win32_Process[^\n]*-OperationTimeoutSec 1 -ErrorAction Stop\)/);
  assert.match(observer, /foreach \(\$process in \$nodeProcesses\)/);
  assert.match(observer, /\$executablePath = \[string\]\$process\.ExecutablePath/);
  assert.match(observer, /\$commandLine = \[string\]\$process\.CommandLine/);
  assert.match(observer, /\[string\]::IsNullOrWhiteSpace\(\$executablePath\)[^\n]*\[string\]::IsNullOrWhiteSpace\(\$commandLine\)/);
  assert.match(observer, /\[void\]\[System\.IO\.Path\]::GetFullPath\(\$executablePath\)/);
  assert.match(observer, /ConvertFrom-WindowsCommandLine -CommandLine \$commandLine/);
  assert.match(observer, /if \(\$arguments\.Count -eq 0\) \{ return \$false \}/);
  assert.match(observer, /Test-ExactCanonicalWorkerProcess -Process \$process -ExpectedRepoRoot \$ExpectedRepoRoot/);
  assert.match(observer, /\$workers.Count -eq 0 -and \[datetime\]::UtcNow -lt \$observationDeadlineUtc/);
  assert.match(observer, /catch \{ return \$false \}/);
  assert.doesNotMatch(observer, /Stop-Process|Stop-ScheduledTask|Start-ScheduledTask|Start-Process|\.Kill\(|Write-|Set-Content|Remove-|Invoke-|New-Item/);
});

test('self-cleanup observation fails closed when a live Node identity is unavailable or malformed', () => {
  const observer = sliceFunction('Wait-MissionWorkerSelfCleanupObservation', 'Write-BoundedAtomicJson');
  const invariants = [
    '$executablePath = [string]$process.ExecutablePath',
    '$commandLine = [string]$process.CommandLine',
    '[string]::IsNullOrWhiteSpace($executablePath) -or [string]::IsNullOrWhiteSpace($commandLine)',
    '[void][System.IO.Path]::GetFullPath($executablePath)',
    '$arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $commandLine)',
    'if ($arguments.Count -eq 0) { return $false }',
  ];
  const hasBoundary = (text) => invariants.every((invariant) => text.includes(invariant));
  assert.equal(hasBoundary(observer), true);
  for (const invariant of invariants) {
    const hostile = observer.replace(invariant, '');
    assert.notEqual(hostile, observer, `hostile mutation must remove ${invariant}`);
    assert.equal(hasBoundary(hostile), false, `observer must reject removal of ${invariant}`);
  }
});

test('failed cleanup preserves its typed blocker after observation and cannot claim recovery', () => {
  const start = source.indexOf("$cleanupBlocker = [string]$_.Exception.Message", source.indexOf('if ($startupBlocker)'));
  const end = source.indexOf('Remove-ExactOwnedMissionWorkerRestartRequest', start);
  const fallback = source.slice(start, end);
  assert.match(fallback, /Wait-MissionWorkerSelfCleanupObservation -ExpectedRepoRoot \$repoRoot/);
  assert.match(fallback, /MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN/);
  assert.doesNotMatch(fallback, /Wait-UntilOperationDeadline|\$cleanupBlocker\s*=\s*''|\$cleanupCompleted\s*=\s*\$true/);
});

function sliceFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName
    ? source.indexOf(`function ${nextName}`, start + 1)
    : source.indexOf('\ntry {\n    if (-not $env:USERPROFILE)', start + 1);
  assert.ok(end > start, `${name} must have a bounded body`);
  return source.slice(start, end);
}

test('cleanup fallback can prove only a newly-created exact canonical worker when the per-invocation launch receipt is absent', () => {
  const helper = sliceFunction('Get-VerifiedCleanupFallbackWorkerProcess', 'Stop-NewlyStartedOwnedWorker');
  assert.match(helper, /Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat/);
  assert.match(helper, /StartedAfterUtc/);
  assert.match(helper, /ProcessStartedAtUtc/);
  assert.match(helper, /Ticks\s*-le\s*\$StartedAfterUtc\.ToUniversalTime\(\)\.Ticks/);
  assert.match(helper, /Get-ScheduledTask/);
  assert.ok(helper.includes("-TaskPath '" + String.fromCharCode(92) + "'"));
  assert.match(helper, /Running/);
  assert.match(helper, /Queued/);
  assert.match(helper, /ProcessCapability/);
  assert.match(helper, /HasExited/);
  assert.match(helper, /StartTime\.ToUniversalTime\(\)/);
  assert.doesNotMatch(helper, /Stop-Process/);
  assert.doesNotMatch(helper, /caller|Caller|arbitrary|Arbitrary/);
});

test('cleanup still prefers exact invocation launch receipt and only falls back after exact claim proof', () => {
  const cleanup = sliceFunction('Stop-NewlyStartedOwnedWorker');
  const claim = cleanup.indexOf('MISSION_WORKER_CLEANUP_INVOCATION_CLAIM_NOT_PROVEN');
  const receipt = cleanup.indexOf('Get-VerifiedInvocationProcessFromLaunchReceipt');
  const fallback = cleanup.indexOf('Get-VerifiedCleanupFallbackWorkerProcess');
  assert.ok(claim >= 0 && receipt > claim && fallback > receipt);
  assert.match(cleanup, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN/);
  assert.match(cleanup, /ExpectedProcessId/);
  assert.match(cleanup, /ExpectedProcessStartedAtUtc/);
});

test('cleanup fallback remains fail closed on pre-existing, ambiguous, changed, or non-canonical workers', () => {
  const helper = sliceFunction('Get-VerifiedCleanupFallbackWorkerProcess', 'Stop-NewlyStartedOwnedWorker');
  assert.match(helper, /Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat/);
  assert.match(helper, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN/);
  assert.match(helper, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED/);
  assert.match(helper, /ProcessId/);
  assert.match(helper, /ProcessStartedAtUtc/);
  assert.doesNotMatch(helper, /Kill\(/);
});

test('existing cleanup keeps cancellation and exact process re-verification before any termination', () => {
  const cleanup = sliceFunction('Stop-NewlyStartedOwnedWorker');
  const cancel = cleanup.indexOf('mission-orchestrator-worker-restart-cancel-$ExpectedInvocationId.json');
  const reverify = cleanup.lastIndexOf('Get-VerifiedFreshWorkerInstance');
  const waitForExit = cleanup.indexOf('Get-CimInstance Win32_Process');
  assert.ok(cancel >= 0);
  assert.ok(reverify >= 0);
  assert.ok(waitForExit > cancel);
  assert.doesNotMatch(cleanup, /Stop-Process/);
});

test('failed startup preserves a derived cleanup reserve before heartbeat timeout', () => {
  assert.match(source, /\$missionWorkerFailureCleanupReserveSeconds\s*=\s*\$missionWorkerStopTimeoutSeconds\s*\+\s*\$missionWorkerCleanupTimeoutSeconds\s*\+\s*5/);
  assert.match(source, /Wait-UntilOperationDeadline\s+-ReserveSeconds\s+\$missionWorkerFailureCleanupReserveSeconds\s+-Condition\s*\{/);
  assert.doesNotMatch(source, /Wait-UntilOperationDeadline\s+-ReserveSeconds\s+8\s+-Condition\s*\{[\s\S]{0,1200}MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/);
});

test('failure cleanup reserve stays bounded and derives only from fixed stop and cleanup budgets', () => {
  const stop = source.match(/\$missionWorkerStopTimeoutSeconds\s*=\s*(\d+)/);
  const cleanup = source.match(/\$missionWorkerCleanupTimeoutSeconds\s*=\s*(\d+)/);
  const extra = source.match(/\$missionWorkerFailureCleanupReserveSeconds\s*=\s*\$missionWorkerStopTimeoutSeconds\s*\+\s*\$missionWorkerCleanupTimeoutSeconds\s*\+\s*(\d+)/);
  assert.ok(stop && cleanup && extra);
  const reserve = Number(stop[1]) + Number(cleanup[1]) + Number(extra[1]);
  assert.equal(reserve, 30);
  assert.ok(reserve < 60);
});
