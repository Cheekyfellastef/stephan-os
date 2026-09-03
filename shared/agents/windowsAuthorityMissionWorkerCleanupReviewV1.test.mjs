import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
  analyzeWindowsAuthorityMissionWorkerCleanupReviewV1,
} from './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';

const HEAD = 'a4c9bcdbd43181481854c2f9855a71cd57f4a28e';
const BASE = 'e8ffb503867ed37affb4744340a61f04135755e6';
const PATH = WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1[0];

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const GOOD_SOURCE = `
function Remove-ExactOwnedMissionWorkerRestartRequest {}
function Get-VerifiedCleanupFallbackWorkerProcess {
  param([datetime]$StartedAfterUtc, [string]$ExpectedRepoRoot, [int]$ExpectedProcessId, [datetime]$ExpectedProcessStartedAtUtc)
  $notProven = 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_NOT_PROVEN'
  $changed = 'MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_IDENTITY_CHANGED'
  $task = Get-ScheduledTask -TaskName 'Stephanos Mission Orchestrator Worker' -TaskPath '\\'
  if ([string]$task.State -in @('Running', 'Queued')) { throw $notProven }
  $candidate = Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat -ExpectedRepoRoot $ExpectedRepoRoot
  if ($candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks -le $StartedAfterUtc.ToUniversalTime().Ticks) { throw $notProven }
  $reRead = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)"
  if (-not (Test-ExactCanonicalWorkerProcess -Process $reRead -ExpectedRepoRoot $ExpectedRepoRoot)) { throw $changed }
  $processCapability = [System.Diagnostics.Process]::GetProcessById($candidate.ProcessId)
  $null = $processCapability.Handle
  if ($processCapability.HasExited -or $processCapability.StartTime.ToUniversalTime().Ticks -ne $candidate.ProcessStartedAtUtc.ToUniversalTime().Ticks) { throw $changed }
}
function Stop-NewlyStartedOwnedWorker {
  $verifiedInvocationProcess = Get-VerifiedInvocationProcessFromLaunchReceipt
  if (-not $verifiedInvocationProcess) {
    $verifiedInvocationProcess = Get-VerifiedCleanupFallbackWorkerProcess
  }
  $reverifiedWorker = Get-VerifiedCleanupFallbackWorkerProcess -ExpectedProcessId $verifiedWorker.ProcessId -ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc
}
`;

function input(source = GOOD_SOURCE, overrides = {}) {
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
        status: 'ahead', aheadBy: 12, behindBy: 0,
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

test('exact #2097 cleanup escalation is cleared without Codex by the protected deterministic specialist', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_CLEAN');
});

test('canonical restart-request helper may precede the cleanup functions without invalidating review', () => {
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(GOOD_SOURCE));
  assert.equal(result.clean, true);
  assert.equal(result.findings.some((item) => item.code === 'mission-worker-cleanup-functions-missing'), false);
});

test('wrong PR, branch, path or escalation cannot enter the profile', () => {
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(GOOD_SOURCE, { prNumber: 2098 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(GOOD_SOURCE, { branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(GOOD_SOURCE, {
    analysis: { findings: [{ severity: 'P0', code: 'other', path: PATH }], counts: { P0: 1, P1: 0, P2: 0 } },
  })).eligible, false);
});

test('current-main drift and malformed source proof fail closed', () => {
  const drift = input(GOOD_SOURCE);
  drift.lineageEvidence.liveMainAfterSha = '2222222222222222222222222222222222222222';
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(drift).clean, false);
  const malformed = input(GOOD_SOURCE);
  malformed.sources[0].blobSha = '3333333333333333333333333333333333333333';
  assert.equal(analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(malformed).clean, false);
});

test('receipt preference, re-verification and quiescence are mandatory', () => {
  const weakened = GOOD_SOURCE
    .replace("State -in @('Running', 'Queued')", "State -eq 'Disabled'")
    .replace('Get-VerifiedInvocationProcessFromLaunchReceipt', 'Get-VerifiedCleanupFallbackWorkerProcess')
    .replace('-ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc', '');
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(weakened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-task-quiescence-missing'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-receipt-not-preferred'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-exact-reverification-missing'));
});

test('generic termination, arbitrary shell and caller-selected authority are rejected', () => {
  const widened = GOOD_SOURCE
    .replace('[string]$ExpectedRepoRoot', '[string]$ExpectedRepoRoot, [string]$TaskName')
    .replace('function Stop-NewlyStartedOwnedWorker {', "Stop-Process -Id $candidate.ProcessId\nfunction Stop-NewlyStartedOwnedWorker {");
  const result = analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input(widened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-generic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'mission-worker-cleanup-caller-authority-forbidden'));
});
