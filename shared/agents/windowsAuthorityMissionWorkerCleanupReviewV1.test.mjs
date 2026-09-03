import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
  analyzeWindowsAuthorityMissionWorkerCleanupReviewV1,
} from './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';

const HEAD = '75b1c5521b88f32166ff92a6bbd8bce5546d5ee4';
const BASE = '1995e63cfea17533d17a0244233a117f0a86900c';
const PATH = WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1[0];

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const SAFE_EQUIVALENT_SOURCE = `
function Remove-ExactOwnedMissionWorkerRestartRequest {}
function Get-VerifiedCleanupFallbackWorkerProcess {
  param([object]$Plan, [datetime]$StartedAfterUtc, [string]$ExpectedRepoRoot, [int]$ExpectedProcessId, [datetime]$ExpectedProcessStartedAtUtc)
  if ([string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker') {
    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED'
  }
  $cleanupTask = Get-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\\'
  if ([string]$cleanupTask.State -in @('Running', 'Queued')) {
    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN'
  }
  $candidate = Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat -ExpectedRepoRoot $ExpectedRepoRoot
  if ($candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks -le $StartedAfterUtc.ToUniversalTime().Ticks) {
    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN'
  }
  $reread = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)"
  if (-not (Test-ExactCanonicalWorkerProcess -Process $reread -ExpectedRepoRoot $ExpectedRepoRoot)) {
    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED'
  }
  $processCapability = [System.Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)
  if ($processCapability.HasExited -or $processCapability.Id -ne [int]$candidate.ProcessId) {
    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED'
  }
  $null = $processCapability.Handle
  $capabilityStartedAtUtc = $processCapability.StartTime.ToUniversalTime()
  if ($capabilityStartedAtUtc.Ticks -ne $candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks) {
    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED'
  }
}
function Stop-NewlyStartedOwnedWorker {
  $verifiedInvocationProcess = Get-VerifiedInvocationProcessFromLaunchReceipt
  if ($verifiedInvocationProcess) {
    $ExpectedProcessId = $verifiedInvocationProcess.ProcessId
  }
  else {
    $fallbackProcess = Get-VerifiedCleanupFallbackWorkerProcess -Plan $Plan -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot
  }
  if ($cleanupFallbackUsed) {
    $verifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -Plan $Plan -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot
  }
  if ($verifiedWorker) {
    $reverifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -Plan $Plan -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot -ExpectedProcessId $verifiedWorker.ProcessId -ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc
  }
}
`;

const LEGACY_SAFE_SOURCE = `
function Get-VerifiedCleanupFallbackWorkerProcess {
  param([datetime]$StartedAfterUtc, [string]$ExpectedRepoRoot, [int]$ExpectedProcessId, [datetime]$ExpectedProcessStartedAtUtc)
  $task = Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\'
  if ([string]$task.State -in @('Running', 'Queued')) {
    throw 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_NOT_PROVEN'
  }
  $candidate = Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat -ExpectedRepoRoot $ExpectedRepoRoot
  if ($candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks -le $StartedAfterUtc.ToUniversalTime().Ticks) {
    throw 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_NOT_PROVEN'
  }
  $reRead = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)"
  if (-not (Test-ExactCanonicalWorkerProcess -Process $reRead -ExpectedRepoRoot $ExpectedRepoRoot)) {
    throw 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_IDENTITY_CHANGED'
  }
  $processCapability = [System.Diagnostics.Process]::GetProcessById($candidate.ProcessId)
  $null = $processCapability.Handle
  if ($processCapability.HasExited -or $processCapability.Id -ne $candidate.ProcessId) {
    throw 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_IDENTITY_CHANGED'
  }
  $capabilityProcessStartedAtUtc = $processCapability.StartTime.ToUniversalTime()
  if ($capabilityProcessStartedAtUtc.Ticks -ne $candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks) {
    throw 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_IDENTITY_CHANGED'
  }
}
function Stop-NewlyStartedOwnedWorker {
  $verifiedInvocationProcess = Get-VerifiedInvocationProcessFromLaunchReceipt
  if (-not $verifiedInvocationProcess) {
    $fallbackProcess = Get-VerifiedCleanupFallbackWorkerProcess -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot
  }
  $verifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot
  $reverifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -StartedAfterUtc $StartedAfterUtc -ExpectedRepoRoot $ExpectedRepoRoot -ExpectedProcessId $verifiedWorker.ProcessId -ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc
}
`;

function input(source = SAFE_EQUIVALENT_SOURCE, overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2097,
    branch: 'fix/mission-worker-cleanup-launch-receipt-proof-v1',
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
      parents: ['1111111111111111111111111111111111111111', BASE],
      comparison: {
        status: 'ahead',
        aheadBy: 22,
        behindBy: 0,
        baseCommitSha: BASE,
        mergeBaseCommitSha: BASE,
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

test('accepts the current #2097 safe semantic equivalents without textual assertion drift', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
});

test('continues to accept the previously recognized literal safe spelling', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(LEGACY_SAFE_SOURCE));
  assert.equal(result.clean, true);
});

test('validated Plan task binding is mandatory when the task literal is not inlined', () => {
  const unsafe = SAFE_EQUIVALENT_SOURCE.replace(
    "if ([string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker') {\n    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED'\n  }",
    '',
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-task-not-fixed'));
});

test('root Scheduled Task path remains mandatory', () => {
  const unsafe = SAFE_EQUIVALENT_SOURCE.replace("-TaskPath '\\'", "-TaskPath '\\Other\\'");
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-task-not-fixed'));
});

test('PowerShell variable case does not weaken exact canonical command recheck', () => {
  const upper = SAFE_EQUIVALENT_SOURCE.replaceAll('$reread', '$reRead');
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(upper)).clean, true);

  const missing = SAFE_EQUIVALENT_SOURCE.replace(
    'if (-not (Test-ExactCanonicalWorkerProcess -Process $reread -ExpectedRepoRoot $ExpectedRepoRoot)) {',
    'if (-not $reread) {',
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(missing));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-command-recheck-missing'));
});

test('explicit integer cast is accepted but capability binding to another PID is rejected', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input()).clean, true);
  const unsafe = SAFE_EQUIVALENT_SOURCE.replace(
    'GetProcessById([int]$candidate.ProcessId)',
    'GetProcessById([int]$ExpectedProcessId)',
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-capability-bind-missing'));
});

test('capability safety facts are order independent but individually mandatory', () => {
  for (const unsafe of [
    SAFE_EQUIVALENT_SOURCE.replace('$null = $processCapability.Handle', '$null = 1'),
    SAFE_EQUIVALENT_SOURCE.replace('$processCapability.HasExited', '$false'),
    SAFE_EQUIVALENT_SOURCE.replace('$processCapability.Id -ne [int]$candidate.ProcessId', '$false'),
    SAFE_EQUIVALENT_SOURCE.replace('$processCapability.StartTime.ToUniversalTime()', '[datetime]::UtcNow'),
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-capability-recheck-missing'));
  }
});

test('resolved cleanup blocker contract and historical fallback blocker contract are both typed and closed', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input()).clean, true);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(LEGACY_SAFE_SOURCE)).clean, true);

  const missingNotProven = SAFE_EQUIVALENT_SOURCE.replaceAll('MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN', 'UNRELATED_BLOCKER');
  const missingChanged = SAFE_EQUIVALENT_SOURCE.replaceAll('MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED', 'UNRELATED_BLOCKER');
  assert.ok(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(missingNotProven)).findings.some((item) => item.code === 'mission-worker-cleanup-not-proven-blocker-missing'));
  assert.ok(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(missingChanged)).findings.some((item) => item.code === 'mission-worker-cleanup-identity-changed-blocker-missing'));
});

test('positive receipt branch plus else fallback is narrow, unconditional fallback is rejected', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input()).clean, true);
  const unsafe = SAFE_EQUIVALENT_SOURCE.replace(
    "if ($verifiedInvocationProcess) {\n    $ExpectedProcessId = $verifiedInvocationProcess.ProcessId\n  }\n  else {",
    "if ($verifiedInvocationProcess) {\n    $ExpectedProcessId = $verifiedInvocationProcess.ProcessId\n  }\n  {",
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-fallback-not-narrow'));
});

test('receipt preference, fallback re-verification and exact identity pins remain mandatory', () => {
  const weakened = SAFE_EQUIVALENT_SOURCE
    .replace('Get-VerifiedInvocationProcessFromLaunchReceipt', 'Get-VerifiedCleanupFallbackWorkerProcess')
    .replace('-ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc', '');
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(weakened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-receipt-not-preferred'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-exact-reverification-missing'));
});

test('generic termination, arbitrary shell and caller-selected authority remain rejected', () => {
  const widened = SAFE_EQUIVALENT_SOURCE
    .replace('[string]$ExpectedRepoRoot', '[string]$ExpectedRepoRoot, [string]$TaskName')
    .replace('function Stop-NewlyStartedOwnedWorker {', "function Stop-NewlyStartedOwnedWorker {\n  Stop-Process -Id $candidate.ProcessId");
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(widened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-generic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-caller-authority-forbidden'));
});

test('wrong PR, branch, current-main lineage or source proof fail closed', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(SAFE_EQUIVALENT_SOURCE, { prNumber: 2098 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(SAFE_EQUIVALENT_SOURCE, { branch: 'other' })).eligible, false);

  const drift = input();
  drift.lineageEvidence.liveMainAfterSha = '2222222222222222222222222222222222222222';
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(drift).clean, false);

  const malformed = input();
  malformed.sources[0].blobSha = '3333333333333333333333333333333333333333';
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(malformed).clean, false);
});
