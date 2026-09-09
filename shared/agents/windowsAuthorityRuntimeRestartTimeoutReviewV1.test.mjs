import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
  analyzeWindowsAuthorityMissionWorkerCleanupReviewV1,
} from './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';

const HEAD = '6'.repeat(40);
const BASE = 'a6d5ea18bd912f86ef60dfead153376462674618';
const PATH = WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1[0];
const BRANCH = 'fix/post-sync-runtime-restart-timeout-truth-v1';

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const SAFE_SOURCE = `
$missionWorkerStopTimeoutSeconds = 15
$missionWorkerCleanupTimeoutSeconds = 10
$missionWorkerFailureCleanupReserveSeconds = $missionWorkerStopTimeoutSeconds + $missionWorkerCleanupTimeoutSeconds + 5
function Get-VerifiedCleanupFallbackWorkerProcess {
  param([object]$Plan, [datetime]$StartedAfterUtc, [string]$ExpectedRepoRoot, [int]$ExpectedProcessId, [datetime]$ExpectedProcessStartedAtUtc)
  if ([string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker') { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED' }
  $cleanupTask = Get-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\\'
  if ([string]$cleanupTask.State -in @('Running', 'Queued')) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN' }
  $candidate = Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat -ExpectedRepoRoot $ExpectedRepoRoot
  if ($candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks -le $StartedAfterUtc.ToUniversalTime().Ticks) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN' }
  $reread = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)" -OperationTimeoutSec 1 -ErrorAction SilentlyContinue
  if (-not (Test-ExactCanonicalWorkerProcess -Process $reread -ExpectedRepoRoot $ExpectedRepoRoot)) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED' }
  $processCapability = [System.Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)
  if ($processCapability.HasExited -or $processCapability.Id -ne [int]$candidate.ProcessId) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED' }
  $null = $processCapability.Handle
  $capabilityStartedAtUtc = $processCapability.StartTime.ToUniversalTime()
  if ($capabilityStartedAtUtc.Ticks -ne $candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED' }
}
function Stop-NewlyStartedOwnedWorker {
  $verifiedInvocationProcess = Get-VerifiedInvocationProcessFromLaunchReceipt
  if ($verifiedInvocationProcess) { $ExpectedProcessId = $verifiedInvocationProcess.ProcessId }
  else { $fallbackProcess = Get-VerifiedCleanupFallbackWorkerProcess -Plan $Plan -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot }
  if ($cleanupFallbackUsed) { $verifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -Plan $Plan -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot }
  if ($verifiedWorker) { $reverifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -Plan $Plan -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot -ExpectedProcessId $verifiedWorker.ProcessId -ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc }
}
function Invoke-MissionWorkerStartupHeartbeatProof {
  if (-not (Wait-UntilOperationDeadline -ReserveSeconds $missionWorkerFailureCleanupReserveSeconds -Condition { return $false })) { Stop-WithBlocker 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT' }
}
function Wait-MissionWorkerSelfCleanupObservation {
  param([Parameter(Mandatory = $true)][string]$ExpectedRepoRoot)
  $observationDeadlineUtc = [datetime]::UtcNow.AddSeconds(4)
  $reserveDeadlineUtc = $script:operationDeadlineUtc.AddSeconds(4)
  if ($observationDeadlineUtc -gt $reserveDeadlineUtc) { $observationDeadlineUtc = $reserveDeadlineUtc }
  while ([datetime]::UtcNow -lt $observationDeadlineUtc) {
    try {
      $task = Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\' -ErrorAction Stop
      if ($task -and [string]$task.State -in @('Ready', 'Disabled')) {
        $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -OperationTimeoutSec 1 -ErrorAction Stop)
        $workers = @()
        foreach ($process in $nodeProcesses) {
          $executablePath = [string]$process.ExecutablePath
          $commandLine = [string]$process.CommandLine
          if ([string]::IsNullOrWhiteSpace($executablePath) -or [string]::IsNullOrWhiteSpace($commandLine)) { return $false }
          [void][System.IO.Path]::GetFullPath($executablePath)
          $arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $commandLine)
          if ($arguments.Count -eq 0) { return $false }
          if (Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot) { $workers += $process }
        }
        if ($workers.Count -eq 0 -and [datetime]::UtcNow -lt $observationDeadlineUtc) { return $true }
      }
    }
    catch { return $false }
    Start-Sleep -Milliseconds 100
  }
  return $false
}
function Invoke-PostAuthorityCleanupFailure {
  if (-not (Wait-MissionWorkerSelfCleanupObservation -ExpectedRepoRoot $repoRoot)) { $cleanupBlocker = 'MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN' }
}
function Get-IndependentRuntimeProcessObservation {
  $runtimeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -OperationTimeoutSec 1 -ErrorAction Stop)
  return $runtimeProcesses
}
`;

function input(source = SAFE_SOURCE, overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2160,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
      counts: { P0: 1, P1: 0, P2: 0 },
    },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      sourceCommitSha: HEAD,
      baseSha: BASE,
      liveMainBeforeSha: BASE,
      liveMainAfterSha: BASE,
      parents: [BASE],
      comparison: {
        status: 'ahead', aheadBy: 2, behindBy: 0,
        baseCommitSha: BASE, mergeBaseCommitSha: BASE,
      },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path: PATH,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(source, 'utf8'),
      blobSha: gitBlobSha(source),
      content: source,
    }],
    ...overrides,
  };
}

test('PR #2160 exact runtime-restart timeout surface is eligible and clean when every Win32 process observation is bounded', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_RUNTIME_RESTART_TIMEOUT_CLEAN');
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
});

test('PR #2160 specialist rejects an unbounded Win32 process observation outside inherited slices', () => {
  const unsafe = SAFE_SOURCE.replace(
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" -OperationTimeoutSec 1 -ErrorAction Stop)\n  return $runtimeProcesses',
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" -ErrorAction Stop)\n  return $runtimeProcesses',
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-runtime-restart-process-query-unbounded'));
});

test('PR #2160 specialist rejects timeout values other than exactly one second', () => {
  const unsafe = SAFE_SOURCE.replace(
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" -OperationTimeoutSec 1 -ErrorAction Stop)\n  return $runtimeProcesses',
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" -OperationTimeoutSec 2 -ErrorAction Stop)\n  return $runtimeProcesses',
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-runtime-restart-process-query-unbounded'));
});

test('PR #2160 specialist remains exact to the canonical branch identity', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(SAFE_SOURCE, { branch: 'fix/not-the-runtime-restart-timeout-lane' }));
  assert.equal(result.eligible, false);
  assert.equal(result.clean, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_NOT_APPLICABLE');
});

test('runtime-restart timeout specialist remains exact to PR #2160 identity', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(SAFE_SOURCE, { prNumber: 2152 }));
  assert.equal(result.eligible, false);
  assert.equal(result.clean, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_NOT_APPLICABLE');
});
