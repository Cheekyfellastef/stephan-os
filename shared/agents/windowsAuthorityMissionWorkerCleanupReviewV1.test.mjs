import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
  analyzeWindowsAuthorityMissionWorkerCleanupReviewV1,
} from './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';

const HEAD = '75b1c5521b88f32166ff92a6bbd8bce5546d5ee4';
const BASE = '1995e63cfea17533d17a0244233a117f0a86900c';
const RESERVE_HEAD = '5a81595bb6125e8579aa94362920e012ab6a26fb';
const RESERVE_BASE = '373acf52588a461a7fe57a03767ca1591279d644';
const POST_AUTHORITY_HEAD = 'eaaf856e8b49d590293deb4ac798220744a1a1ad';
const POST_AUTHORITY_BASE = '5ed7621423095a0947378a27f3b5484719e6efcc';
const SELF_CLEANUP_HEAD = '20304acd0b535442fc4239de38243d7bad8dd239';
const SELF_CLEANUP_BASE = '1078045062c994664f388ba30d9d02d16ce1cf15';
const ORPHAN_HEAD = '5e04abd527ae76f782799014e1c84c150ae0e7fe';
const ORPHAN_BASE = '6555b6d9c7823522e1f4090d8ef160865e3beac1';
const ORPHAN_BLOB_SHA = '24bdbd048e30eda6641a8122d60e9262521af376';
const PATH = WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1[0];

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function replaceExactlyOnce(source, expected, replacement) {
  const first = source.indexOf(expected);
  assert.notEqual(first, -1, 'expected production source fragment must exist');
  assert.equal(source.indexOf(expected, first + 1), -1, 'production source fragment must be unique');
  return source.slice(0, first) + replacement + source.slice(first + expected.length);
}

function replaceInOrphanSelector(source, expected, replacement) {
  const start = source.indexOf('function Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat');
  assert.notEqual(start, -1, 'orphan selector must exist');
  const end = source.indexOf('\nfunction Get-VerifiedFreshWorkerInstance', start);
  assert.notEqual(end, -1, 'orphan selector boundary must exist');
  const selector = source.slice(start, end);
  const updatedSelector = replaceExactlyOnce(selector, expected, replacement);
  return source.slice(0, start) + updatedSelector + source.slice(end);
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

const RESERVE_SAFE_SOURCE = `
$missionWorkerStopTimeoutSeconds = 15
$missionWorkerCleanupTimeoutSeconds = 10
$missionWorkerFailureCleanupReserveSeconds = $missionWorkerStopTimeoutSeconds + $missionWorkerCleanupTimeoutSeconds + 5
${SAFE_EQUIVALENT_SOURCE}
function Invoke-MissionWorkerStartupHeartbeatProof {
  if (-not (Wait-UntilOperationDeadline -ReserveSeconds $missionWorkerFailureCleanupReserveSeconds -Condition { return $false })) {
    Stop-WithBlocker 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT'
  }
}
`;

const POST_AUTHORITY_SAFE_SOURCE = `
${RESERVE_SAFE_SOURCE}
function Wait-MissionWorkerSelfCleanupObservation {
  param([Parameter(Mandatory = $true)][string]$ExpectedRepoRoot)
  $observationDeadlineUtc = [datetime]::UtcNow.AddSeconds($missionWorkerCleanupTimeoutSeconds)
  $reserveDeadlineUtc = $script:operationDeadlineUtc.AddSeconds($missionWorkerCleanupTimeoutSeconds)
  if ($observationDeadlineUtc -gt $reserveDeadlineUtc) {
    $observationDeadlineUtc = $reserveDeadlineUtc
  }
  while ([datetime]::UtcNow -lt $observationDeadlineUtc) {
    try {
      $task = Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\' -ErrorAction Stop
      if ($task -and [string]$task.State -in @('Ready', 'Disabled')) {
        $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -OperationTimeoutSec 1 -ErrorAction Stop)
        $workers = @()
        foreach ($process in $nodeProcesses) {
          $executablePath = [string]$process.ExecutablePath
          $commandLine = [string]$process.CommandLine
          if ([string]::IsNullOrWhiteSpace($executablePath) -or [string]::IsNullOrWhiteSpace($commandLine)) {
            return $false
          }
          [void][System.IO.Path]::GetFullPath($executablePath)
          $arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $commandLine)
          if ($arguments.Count -eq 0) { return $false }
          if (Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot) {
            $workers += $process
          }
        }
        if ($workers.Count -eq 0 -and [datetime]::UtcNow -lt $observationDeadlineUtc) {
          return $true
        }
      }
    }
    catch { return $false }
    Start-Sleep -Milliseconds 100
  }
  return $false
}
function Invoke-PostAuthorityCleanupFailure {
  if (-not (Wait-MissionWorkerSelfCleanupObservation -ExpectedRepoRoot $repoRoot)) {
    $cleanupBlocker = 'MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN'
  }
}
`;

const LEGACY_POST_AUTHORITY_SAFE_SOURCE = POST_AUTHORITY_SAFE_SOURCE
  .replaceAll('AddSeconds($missionWorkerCleanupTimeoutSeconds)', 'AddSeconds(4)');

const ORPHAN_SAFE_SOURCE = readFileSync(
  new URL('./fixtures/mission-worker-orphan-capability-2105.ps1', import.meta.url),
  'utf8',
);

assert.equal(
  gitBlobSha(ORPHAN_SAFE_SOURCE),
  ORPHAN_BLOB_SHA,
  'historical #2105 source fixture must remain the exact already-hardened blob',
);

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
        status: 'ahead', aheadBy: 22, behindBy: 0,
        baseCommitSha: BASE, mergeBaseCommitSha: BASE,
      },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os', path: PATH, ref: HEAD, exists: true,
      size: Buffer.byteLength(source, 'utf8'), blobSha: gitBlobSha(source), content: source,
    }],
    ...overrides,
  };
}

function reserveInput(source = RESERVE_SAFE_SOURCE, overrides = {}) {
  return input(source, {
    prNumber: 2126,
    branch: 'fix/mission-worker-failure-cleanup-reserve-v1',
    sourceHead: RESERVE_HEAD,
    baseSha: RESERVE_BASE,
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: RESERVE_HEAD,
      sourceCommitSha: RESERVE_HEAD,
      baseSha: RESERVE_BASE,
      liveMainBeforeSha: RESERVE_BASE,
      liveMainAfterSha: RESERVE_BASE,
      parents: ['01c48ccc2d1f5628a95d3429d8db44a486f4499a', RESERVE_BASE],
      comparison: {
        status: 'ahead', aheadBy: 4, behindBy: 0,
        baseCommitSha: RESERVE_BASE, mergeBaseCommitSha: RESERVE_BASE,
      },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os', path: PATH, ref: RESERVE_HEAD, exists: true,
      size: Buffer.byteLength(source, 'utf8'), blobSha: gitBlobSha(source), content: source,
    }],
    ...overrides,
  });
}

function postAuthorityInput(source = LEGACY_POST_AUTHORITY_SAFE_SOURCE, overrides = {}) {
  return input(source, {
    prNumber: 2152,
    branch: 'fix/mission-worker-post-authority-observation-v1',
    sourceHead: POST_AUTHORITY_HEAD,
    baseSha: POST_AUTHORITY_BASE,
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: POST_AUTHORITY_HEAD,
      sourceCommitSha: POST_AUTHORITY_HEAD,
      baseSha: POST_AUTHORITY_BASE,
      liveMainBeforeSha: POST_AUTHORITY_BASE,
      liveMainAfterSha: POST_AUTHORITY_BASE,
      parents: [POST_AUTHORITY_BASE],
      comparison: {
        status: 'ahead', aheadBy: 3, behindBy: 0,
        baseCommitSha: POST_AUTHORITY_BASE, mergeBaseCommitSha: POST_AUTHORITY_BASE,
      },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os', path: PATH, ref: POST_AUTHORITY_HEAD, exists: true,
      size: Buffer.byteLength(source, 'utf8'), blobSha: gitBlobSha(source), content: source,
    }],
    ...overrides,
  });
}

function selfCleanupObservationInput(source = POST_AUTHORITY_SAFE_SOURCE, overrides = {}) {
  return input(source, {
    prNumber: 2191,
    branch: 'fix/mission-worker-self-cleanup-observation-budget-v2',
    sourceHead: SELF_CLEANUP_HEAD,
    baseSha: SELF_CLEANUP_BASE,
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: SELF_CLEANUP_HEAD,
      sourceCommitSha: SELF_CLEANUP_HEAD,
      baseSha: SELF_CLEANUP_BASE,
      liveMainBeforeSha: SELF_CLEANUP_BASE,
      liveMainAfterSha: SELF_CLEANUP_BASE,
      parents: [SELF_CLEANUP_BASE],
      comparison: {
        status: 'ahead', aheadBy: 1, behindBy: 0,
        baseCommitSha: SELF_CLEANUP_BASE, mergeBaseCommitSha: SELF_CLEANUP_BASE,
      },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os', path: PATH, ref: SELF_CLEANUP_HEAD, exists: true,
      size: Buffer.byteLength(source, 'utf8'), blobSha: gitBlobSha(source), content: source,
    }],
    ...overrides,
  });
}

function orphanInput(source = ORPHAN_SAFE_SOURCE, overrides = {}) {
  return input(source, {
    prNumber: 2105,
    branch: 'fix/mission-worker-orphan-capability-starttime-v1',
    sourceHead: ORPHAN_HEAD,
    baseSha: ORPHAN_BASE,
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: ORPHAN_HEAD,
      sourceCommitSha: ORPHAN_HEAD,
      baseSha: ORPHAN_BASE,
      liveMainBeforeSha: ORPHAN_BASE,
      liveMainAfterSha: ORPHAN_BASE,
      parents: [ORPHAN_BASE],
      comparison: {
        status: 'ahead', aheadBy: 2, behindBy: 0,
        baseCommitSha: ORPHAN_BASE, mergeBaseCommitSha: ORPHAN_BASE,
      },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os', path: PATH, ref: ORPHAN_HEAD, exists: true,
      size: Buffer.byteLength(source, 'utf8'), blobSha: gitBlobSha(source), content: source,
    }],
    ...overrides,
  });
}

test('current #2097 cleanup semantic equivalents remain eligible and clean', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
});

test('cleanup fallback remains narrow, exact and typed', () => {
  for (const [unsafe, code] of [
    [SAFE_EQUIVALENT_SOURCE.replace("Stephanos Mission Orchestrator Worker", "Other Mission Worker"), 'mission-worker-cleanup-task-not-fixed'],
    [SAFE_EQUIVALENT_SOURCE.replace('$null = $processCapability.Handle', '$null = 1'), 'mission-worker-cleanup-capability-recheck-missing'],
    [SAFE_EQUIVALENT_SOURCE.replace('GetProcessById([int]$candidate.ProcessId)', 'GetProcessById([int]$ExpectedProcessId)'), 'mission-worker-cleanup-capability-bind-missing'],
    [SAFE_EQUIVALENT_SOURCE.replaceAll('MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN', 'UNRELATED_BLOCKER'), 'mission-worker-cleanup-not-proven-blocker-missing'],
    [SAFE_EQUIVALENT_SOURCE.replaceAll('MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED', 'UNRELATED_BLOCKER'), 'mission-worker-cleanup-identity-changed-blocker-missing'],
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === code));
  }
});

test('cleanup generic execution and caller-selected authority remain rejected', () => {
  const widened = SAFE_EQUIVALENT_SOURCE
    .replace('[string]$ExpectedRepoRoot', '[string]$ExpectedRepoRoot, [string]$TaskName')
    .replace('function Stop-NewlyStartedOwnedWorker {', "function Stop-NewlyStartedOwnedWorker {\n  Stop-Process -Id $candidate.ProcessId");
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(widened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-generic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-caller-authority-forbidden'));
});

test('exact #2126 cleanup reserve profile is eligible and clean only on its exact branch', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(reserveInput());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_RESERVE_CLEAN');
  assert.ok(result.proofRefs.some((item) => item.includes('derived-failure-cleanup-window')));
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(reserveInput(RESERVE_SAFE_SOURCE, { branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(reserveInput(RESERVE_SAFE_SOURCE, { prNumber: 2127 })).eligible, false);
});

test('#2126 reserve review rejects changed budgets, legacy reserve and duplicated wiring', () => {
  for (const [unsafe, code] of [
    [RESERVE_SAFE_SOURCE.replace('$missionWorkerStopTimeoutSeconds = 15', '$missionWorkerStopTimeoutSeconds = 16'), 'mission-worker-cleanup-reserve-stop-budget-changed'],
    [RESERVE_SAFE_SOURCE.replace('$missionWorkerCleanupTimeoutSeconds = 10', '$missionWorkerCleanupTimeoutSeconds = 9'), 'mission-worker-cleanup-reserve-cleanup-budget-changed'],
    [RESERVE_SAFE_SOURCE.replace('+ $missionWorkerCleanupTimeoutSeconds + 5', '+ $missionWorkerCleanupTimeoutSeconds + 4'), 'mission-worker-cleanup-reserve-derivation-invalid'],
    [RESERVE_SAFE_SOURCE.replace('-ReserveSeconds $missionWorkerFailureCleanupReserveSeconds', '-ReserveSeconds 8'), 'mission-worker-cleanup-reserve-heartbeat-wait-missing'],
    [`${RESERVE_SAFE_SOURCE}\n$missionWorkerFailureCleanupReserveSeconds = 30\n`, 'mission-worker-cleanup-reserve-shape-not-singleton'],
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(reserveInput(unsafe));
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === code));
  }
});

test('exact #2152 post-authority observation profile remains four-second and branch exact', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(postAuthorityInput());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_POST_AUTHORITY_OBSERVATION_CLEAN');
  assert.ok(result.proofRefs.some((item) => item.includes('fail-closed-uninspectable-node')));
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(postAuthorityInput(POST_AUTHORITY_SAFE_SOURCE)).clean, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(postAuthorityInput(LEGACY_POST_AUTHORITY_SAFE_SOURCE, { branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(postAuthorityInput(LEGACY_POST_AUTHORITY_SAFE_SOURCE, { prNumber: 2153 })).eligible, false);
});

test('exact #2191 cleanup-budget observation profile is independently eligible and clean', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(selfCleanupObservationInput());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_SELF_CLEANUP_OBSERVATION_BUDGET_CLEAN');
  assert.ok(result.proofRefs.some((item) => item.includes('mission-worker-self-cleanup-observation-budget/pr-2191')));
  const legacy = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(selfCleanupObservationInput(LEGACY_POST_AUTHORITY_SAFE_SOURCE));
  assert.equal(legacy.clean, false);
  assert.ok(legacy.findings.some((item) => item.code === 'mission-worker-self-cleanup-observation-budget-window-missing'));
  assert.ok(legacy.findings.some((item) => item.code === 'mission-worker-self-cleanup-observation-budget-reserve-cap-missing'));
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(selfCleanupObservationInput(POST_AUTHORITY_SAFE_SOURCE, { branch: 'other' })).eligible, false);
});

test('#2152 observer rejects removed deadline, task and live Node identity boundaries', () => {
  for (const [unsafe, code] of [
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('$observationDeadlineUtc = [datetime]::UtcNow.AddSeconds(4)', '$observationDeadlineUtc = [datetime]::UtcNow.AddSeconds(5)'), 'mission-worker-post-authority-four-second-window-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('$reserveDeadlineUtc = $script:operationDeadlineUtc.AddSeconds(4)', '$reserveDeadlineUtc = $script:operationDeadlineUtc.AddSeconds(5)'), 'mission-worker-post-authority-reserve-cap-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace("[string]$task.State -in @('Ready', 'Disabled')", "[string]$task.State -in @('Ready', 'Running')"), 'mission-worker-post-authority-terminal-task-state-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('-OperationTimeoutSec 1 -ErrorAction Stop', '-ErrorAction Stop'), 'mission-worker-post-authority-node-query-not-fixed'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('foreach ($process in $nodeProcesses)', 'foreach ($process in @())'), 'mission-worker-post-authority-node-enumeration-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('$executablePath = [string]$process.ExecutablePath', '$executablePath = $null'), 'mission-worker-post-authority-executable-inspection-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('$commandLine = [string]$process.CommandLine', '$commandLine = $null'), 'mission-worker-post-authority-command-inspection-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('if ([string]::IsNullOrWhiteSpace($executablePath) -or [string]::IsNullOrWhiteSpace($commandLine)) {', 'if ($false) {'), 'mission-worker-post-authority-uninspectable-node-not-blocked'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('[void][System.IO.Path]::GetFullPath($executablePath)', '$null = $executablePath'), 'mission-worker-post-authority-executable-normalization-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('$arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $commandLine)', '$arguments = @("node", "worker")'), 'mission-worker-post-authority-command-parse-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('if ($arguments.Count -eq 0) { return $false }', 'if ($false) { return $false }'), 'mission-worker-post-authority-malformed-command-not-blocked'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot', '$true'), 'mission-worker-post-authority-canonical-classifier-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('$workers.Count -eq 0 -and [datetime]::UtcNow -lt $observationDeadlineUtc', '$workers.Count -ge 0'), 'mission-worker-post-authority-absence-proof-missing'],
    [LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace('catch { return $false }', 'catch { }'), 'mission-worker-post-authority-observation-failure-not-blocked'],
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(postAuthorityInput(unsafe));
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false, code);
    assert.ok(result.findings.some((item) => item.code === code), code);
  }
});

test('#2152 observer cannot mutate deadline, process or Scheduled Task authority', () => {
  for (const [addition, code] of [
    ["\n  $script:operationDeadlineUtc = [datetime]::UtcNow.AddMinutes(5)", 'mission-worker-post-authority-deadline-mutation-forbidden'],
    ["\n  Stop-Process -Id 1234", 'mission-worker-post-authority-mutation-forbidden'],
    ["\n  Start-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker'", 'mission-worker-post-authority-mutation-forbidden'],
  ]) {
    const unsafe = LEGACY_POST_AUTHORITY_SAFE_SOURCE.replace(
      'function Wait-MissionWorkerSelfCleanupObservation {',
      `function Wait-MissionWorkerSelfCleanupObservation {${addition}`,
    );
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(postAuthorityInput(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === code));
  }
});

test('exact #2105 already-hardened source is eligible and clean without replaying the repair', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_ORPHAN_CAPABILITY_CLEAN');
  assert.ok(result.proofRefs.some((item) => item.includes('same-api-starttime-rebound')));
});

test('#2105 capability and CIM observations remain bound to typed fail-closed branches', () => {
  for (const unsafe of [
    ORPHAN_SAFE_SOURCE.replace('if ($processCapability.HasExited -or $processCapability.Id -ne $processId) {', 'if ($false) {'),
    ORPHAN_SAFE_SOURCE.replace('if (-not $candidateReRead -or -not (Test-ExactCanonicalWorkerProcess -Process $candidateReRead -ExpectedRepoRoot $ExpectedRepoRoot)) {', 'if ($false) {'),
    ORPHAN_SAFE_SOURCE.replace('if ($candidateReReadStartedAtUtc.Ticks -ne $candidateStartedAtUtc.Ticks) {', 'if ($false) {'),
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-exact-source-not-pinned'));
  }
});

test('#2105 same-api Process.StartTime identity remains mandatory and cross-api equality forbidden', () => {
  const wrongReturn = ORPHAN_SAFE_SOURCE.replace(
    'ProcessStartedAtUtc = $capabilityProcessStartedAtUtc',
    'ProcessStartedAtUtc = $candidateStartedAtUtc',
  );
  let result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(wrongReturn));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-same-api-return-missing'));

  const crossApi = ORPHAN_SAFE_SOURCE.replace(
    '$candidateReRead = Get-CimInstance Win32_Process',
    "if ($capabilityProcessStartedAtUtc.Ticks -ne $candidateStartedAtUtc.Ticks) { Stop-WithBlocker 'MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED' }\n        $candidateReRead = Get-CimInstance Win32_Process",
  );
  result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(crossApi));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-cross-api-tick-equality-forbidden'));
});

test('#2105 exact PID capability, handle, uniqueness and caller boundary remain mandatory', () => {
  for (const [unsafe, code] of [
    [replaceInOrphanSelector(ORPHAN_SAFE_SOURCE, 'GetProcessById($processId)', 'GetProcessById(1234)'), 'mission-worker-orphan-capability-bind-missing'],
    [replaceInOrphanSelector(ORPHAN_SAFE_SOURCE, '$null = $processCapability.Handle', '$null = 1'), 'mission-worker-orphan-capability-handle-missing'],
    [replaceInOrphanSelector(ORPHAN_SAFE_SOURCE, "if ($canonicalWorkers.Count -gt 1) {", 'if ($false) {'), 'mission-worker-orphan-uniqueness-missing'],
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === code));
  }

  const widened = replaceInOrphanSelector(
    ORPHAN_SAFE_SOURCE,
    '[Parameter(Mandatory = $true)][string]$ExpectedRepoRoot\n    )',
    '[Parameter(Mandatory = $true)][string]$ExpectedRepoRoot,\n        [int]$ProcessId\n    )',
  ).replace('$canonicalWorkers = @()', '$canonicalWorkers = @()\n    Stop-Process -Id $ProcessId');
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(widened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-generic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-caller-authority-forbidden'));
});

test('#2105 full-source pin and exact identity fail closed', () => {
  const unsafe = `${ORPHAN_SAFE_SOURCE}\nStop-Process -Id 1234\n`;
  let result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(unsafe));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-exact-source-not-pinned'));
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(ORPHAN_SAFE_SOURCE, { branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(ORPHAN_SAFE_SOURCE, { prNumber: 2106 })).eligible, false);
});
