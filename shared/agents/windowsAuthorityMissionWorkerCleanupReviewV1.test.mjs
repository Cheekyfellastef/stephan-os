import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
  analyzeWindowsAuthorityMissionWorkerCleanupReviewV1,
} from './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';

const HEAD = '75b1c5521b88f32166ff92a6bbd8bce5546d5ee4';
const BASE = '1995e63cfea17533d17a0244233a117f0a86900c';
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

const ORPHAN_SAFE_SOURCE = execFileSync(
  'git',
  ['cat-file', 'blob', ORPHAN_BLOB_SHA],
  { encoding: 'utf8' },
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
