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
const ORPHAN_HEAD = '5e04abd527ae76f782799014e1c84c150ae0e7fe';
const ORPHAN_BASE = '6555b6d9c7823522e1f4090d8ef160865e3beac1';
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

const ORPHAN_BASE_SOURCE = readFileSync(
  new URL('../../scripts/windows/restart-approved-stephanos-runtime.ps1', import.meta.url),
  'utf8',
);

const ORPHAN_SAFE_SOURCE = replaceExactlyOnce(
  replaceExactlyOnce(
    replaceExactlyOnce(
      ORPHAN_BASE_SOURCE,
      '    $processStartedAtUtc = ([datetime]$candidate.CreationDate).ToUniversalTime()',
      '    $candidateStartedAtUtc = ([datetime]$candidate.CreationDate).ToUniversalTime()',
    ),
    `        $capabilityProcessStartedAtUtc = $processCapability.StartTime.ToUniversalTime()
        if ($capabilityProcessStartedAtUtc.Ticks -ne $processStartedAtUtc.Ticks) {
            Stop-WithBlocker 'MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED'
        }`,
    `        $capabilityProcessStartedAtUtc = $processCapability.StartTime.ToUniversalTime()

        $candidateReRead = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $candidateReRead -or -not (Test-ExactCanonicalWorkerProcess -Process $candidateReRead -ExpectedRepoRoot $ExpectedRepoRoot)) {
            Stop-WithBlocker 'MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED'
        }
        $candidateReReadStartedAtUtc = ([datetime]$candidateReRead.CreationDate).ToUniversalTime()
        if ($candidateReReadStartedAtUtc.Ticks -ne $candidateStartedAtUtc.Ticks) {
            Stop-WithBlocker 'MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED'
        }
`,
  ),
  `        return [PSCustomObject]@{
            ProcessId = $processId
            ProcessStartedAtUtc = $processStartedAtUtc
            ProcessCapability = $processCapability
            CanonicalWorkerCommandVerified = $true
        }`,
  `        return [PSCustomObject]@{
            ProcessId = $processId
            ProcessStartedAtUtc = $capabilityProcessStartedAtUtc
            ProcessCapability = $processCapability
            CanonicalWorkerCommandVerified = $true
        }`,
);

assert.equal(gitBlobSha(ORPHAN_SAFE_SOURCE), '24bdbd048e30eda6641a8122d60e9262521af376');

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
    "if ([string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker') {\n    Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED'\n  }", '',
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
    'if (-not (Test-ExactCanonicalWorkerProcess -Process $reread -ExpectedRepoRoot $ExpectedRepoRoot)) {', 'if (-not $reread) {',
  );
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(missing));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-command-recheck-missing'));
});

test('explicit integer cast is accepted but capability binding to another PID is rejected', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input()).clean, true);
  const unsafe = SAFE_EQUIVALENT_SOURCE.replace('GetProcessById([int]$candidate.ProcessId)', 'GetProcessById([int]$ExpectedProcessId)');
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

test('wrong cleanup PR, branch, current-main lineage or source proof fail closed', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(SAFE_EQUIVALENT_SOURCE, { prNumber: 2098 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(SAFE_EQUIVALENT_SOURCE, { branch: 'other' })).eligible, false);
  const drift = input();
  drift.lineageEvidence.liveMainAfterSha = '2222222222222222222222222222222222222222';
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(drift).clean, false);
  const malformed = input();
  malformed.sources[0].blobSha = '3333333333333333333333333333333333333333';
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(malformed).clean, false);
});

test('exact #2105 orphan capability rebinding profile is eligible and clean', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_ORPHAN_CAPABILITY_CLEAN');
  assert.ok(result.proofRefs.some((item) => item.includes('same-api-starttime-rebound')));
});

test('#2105 binds capability and CIM observations to typed fail-closed branches', () => {
  for (const [unsafe, code] of [
    [ORPHAN_SAFE_SOURCE.replace('if ($processCapability.HasExited -or $processCapability.Id -ne $processId) {', 'if ($false) {'), 'mission-worker-orphan-exact-source-not-pinned'],
    [ORPHAN_SAFE_SOURCE.replace('if (-not $candidateReRead -or -not (Test-ExactCanonicalWorkerProcess -Process $candidateReRead -ExpectedRepoRoot $ExpectedRepoRoot)) {', 'if ($false) {'), 'mission-worker-orphan-exact-source-not-pinned'],
    [ORPHAN_SAFE_SOURCE.replace('if ($candidateReReadStartedAtUtc.Ticks -ne $candidateStartedAtUtc.Ticks) {', 'if ($false) {'), 'mission-worker-orphan-exact-source-not-pinned'],
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === code));
  }
});

test('#2105 full-source pin rejects unsafe mutations outside the selector', () => {
  const unsafe = `${ORPHAN_SAFE_SOURCE}\nStop-Process -Id 1234\n`;
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(unsafe));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-exact-source-not-pinned'));
});

test('#2105 requires same-api Process.StartTime identity and forbids cross-api tick equality', () => {
  const wrongReturn = ORPHAN_SAFE_SOURCE.replace('ProcessStartedAtUtc = $capabilityProcessStartedAtUtc', 'ProcessStartedAtUtc = $candidateStartedAtUtc');
  let result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(wrongReturn));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-same-api-return-missing'));

  const crossApi = ORPHAN_SAFE_SOURCE.replace(
    '$candidateReRead = Get-CimInstance Win32_Process',
    "if ($capabilityProcessStartedAtUtc.Ticks -ne $candidateStartedAtUtc.Ticks) { Stop-WithBlocker 'MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED' }\n    $candidateReRead = Get-CimInstance Win32_Process",
  );
  result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(crossApi));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-cross-api-tick-equality-forbidden'));
});

test('#2105 keeps exact PID capability, handle and canonical uniqueness proofs mandatory', () => {
  for (const [unsafe, code] of [
    [replaceInOrphanSelector(ORPHAN_SAFE_SOURCE, 'GetProcessById($processId)', 'GetProcessById(1234)'), 'mission-worker-orphan-capability-bind-missing'],
    [replaceInOrphanSelector(ORPHAN_SAFE_SOURCE, '$null = $processCapability.Handle', '$null = 1'), 'mission-worker-orphan-capability-handle-missing'],
    [replaceInOrphanSelector(ORPHAN_SAFE_SOURCE, "if ($canonicalWorkers.Count -gt 1) {", 'if ($false) {'), 'mission-worker-orphan-uniqueness-missing'],
  ]) {
    const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(unsafe));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === code));
  }
});

test('#2105 rejects generic process authority, caller PID and wrong identity', () => {
  const widened = replaceInOrphanSelector(
    ORPHAN_SAFE_SOURCE,
    '[Parameter(Mandatory = $true)][string]$ExpectedRepoRoot\n    )',
    '[Parameter(Mandatory = $true)][string]$ExpectedRepoRoot,\n        [int]$ProcessId\n    )',
  ).replace('$canonicalWorkers = @()', '$canonicalWorkers = @()\n  Stop-Process -Id $ProcessId');
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(widened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-generic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-orphan-caller-authority-forbidden'));
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(ORPHAN_SAFE_SOURCE, { branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(orphanInput(ORPHAN_SAFE_SOURCE, { prNumber: 2106 })).eligible, false);
});
