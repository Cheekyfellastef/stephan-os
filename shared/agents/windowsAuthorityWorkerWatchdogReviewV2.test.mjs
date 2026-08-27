import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2,
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2,
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V2,
  analyzeWindowsAuthorityWorkerWatchdogReviewV2,
  reviewCurrentWorkerWatchdogSourceSemanticsV2,
  validateWorkerWatchdogReconciliationLineageV2,
} from './windowsAuthorityWorkerWatchdogReviewV2.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'f'.repeat(40);
const baseSha = 'e'.repeat(40);
const legacyV1Anchor = 'e0b9f8786a51211d2b0ca3a394ee4bc1876855fd';

function lineage(overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository,
    sourceHead,
    sourceCommitSha: sourceHead,
    baseSha,
    liveMainBeforeSha: baseSha,
    liveMainAfterSha: baseSha,
    parents: [WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2, baseSha],
    comparison: {
      status: 'ahead',
      aheadBy: 2,
      behindBy: 0,
      baseCommitSha: baseSha,
      mergeBaseCommitSha: baseSha,
    },
    ...overrides,
  };
}

function exactEscalationAnalysis() {
  return {
    findings: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}

test('V2 review binding pins the repaired PR #2045 authority blobs', () => {
  assert.equal(WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2,
    '6ca11104ed7fecd7f115eb7da2dcbbf7f8076e47');
  assert.deepEqual(WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2, [
    'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
    'scripts/windows/restart-approved-stephanos-runtime.ps1',
    'scripts/windows/start-mission-orchestrator-worker.ps1',
  ]);
  assert.deepEqual(WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V2, {
    'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': {
      blobSha: 'e1daa40b9004a9058490697fce44f481b0608527',
      size: 22621,
    },
    'scripts/windows/restart-approved-stephanos-runtime.ps1': {
      blobSha: '2bce3b6de334b1b4acd6481c1354c1e5ff097bd9',
      size: 66700,
    },
    'scripts/windows/start-mission-orchestrator-worker.ps1': {
      blobSha: '84b7f6ac4a1e53462a3c5e882fd2c3a081050a72',
      size: 31123,
    },
  });
});

test('V2 lineage accepts only one exact-current-main reconciliation from repaired head', () => {
  assert.equal(validateWorkerWatchdogReconciliationLineageV2({
    repository, sourceHead, baseSha, lineageEvidence: lineage(),
  }), true);

  for (const bad of [
    lineage({ parents: ['0'.repeat(40), baseSha] }),
    lineage({ parents: [WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2] }),
    lineage({ liveMainAfterSha: '0'.repeat(40) }),
    lineage({ comparison: { ...lineage().comparison, behindBy: 1 } }),
  ]) {
    assert.equal(validateWorkerWatchdogReconciliationLineageV2({
      repository, sourceHead, baseSha, lineageEvidence: bad,
    }), false);
  }
});

test('V2 probe semantics require immutable launch identity projection', () => {
  const source = [
    "ValidateSet('Inspect', 'StartApprovedWorkerTask')",
    "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'",
    "$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    'function Test-ExactJsonPropertyEstate',
    'function Get-VerifiedWorkerLaunchIdentity',
    'mission-orchestrator-worker-launch-identity-$launchIdentityId.json',
    "schemaVersion -ne 'stephanos.mission-worker-launch-identity.v1'",
    '$heartbeatWorkerStartedAtUtc.Ticks -ne $processStartedAtUtc.Ticks',
    '$receiptWorkerStartedAtUtc.Ticks -ne $processStartedAtUtc.Ticks',
    "launchIdentityId = if ($launchIdentity) { [string]$launchIdentity.LaunchIdentityId } else { '' }",
    'launchIdentityVerified = [bool]$launchIdentity',
    'launchIdentityId = [string]$heartbeat.launchIdentityId',
    'workerStartedAtUtc = [string]$heartbeat.workerStartedAtUtc',
  ].join('\n');
  assert.deepEqual(
    reviewCurrentWorkerWatchdogSourceSemanticsV2(
      'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
      source,
    ),
    [],
  );
  assert.notEqual(
    reviewCurrentWorkerWatchdogSourceSemanticsV2(
      'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
      source.replace('launchIdentityVerified = [bool]$launchIdentity', ''),
    ).length,
    0,
  );
});

test('V2 restart semantics require stale-request reclaim and exact-owned failure cleanup', () => {
  const source = [
    "ValidateSet('backend', 'mission-worker')",
    "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'",
    "$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'",
    'function Read-CanonicalMissionWorkerRestartRequest',
    "schemaVersion -ne 'stephanos.mission-worker-restart-request.v1'",
    'function Reclaim-ExpiredMissionWorkerRestartRequest',
    '$observed.DeadlineUtc -gt [datetime]::UtcNow',
    '[string]$recheck.Raw -ne [string]$observed.Raw',
    'MISSION_WORKER_RESTART_REQUEST_CHANGED_BEFORE_RECLAIM',
    'function Remove-ExactOwnedMissionWorkerRestartRequest',
    '[string]$observed.Record.invocationId -ne $ExpectedInvocationId',
    '[string]$observed.Record.headSha -ne $ExpectedHead',
    '$observed.DeadlineUtc.Ticks -ne $ExpectedDeadlineUtc.ToUniversalTime().Ticks',
    'MISSION_WORKER_RESTART_REQUEST_CLEANUP_IDENTITY_CHANGED',
    'Reclaim-ExpiredMissionWorkerRestartRequest X Write-BoundedAtomicJson -Path $script:restartRequestPath',
    '$script:restartRequestWritten = $true',
    'if ($startupBlocker) { Remove-ExactOwnedMissionWorkerRestartRequest',
    'catch { $restartRequestWritten Remove-ExactOwnedMissionWorkerRestartRequest',
    '[System.Diagnostics.Process]::GetProcessById($processId) X $reverifiedProcessCapability.Kill()',
  ].join('\n');
  assert.deepEqual(
    reviewCurrentWorkerWatchdogSourceSemanticsV2(
      'scripts/windows/restart-approved-stephanos-runtime.ps1',
      source,
    ),
    [],
  );
  assert.notEqual(
    reviewCurrentWorkerWatchdogSourceSemanticsV2(
      'scripts/windows/restart-approved-stephanos-runtime.ps1',
      `${source}\nInvoke-Expression $x`,
    ).length,
    0,
  );
});

test('V2 is inapplicable outside the exact three-path high-risk escalation', () => {
  const result = analyzeWindowsAuthorityWorkerWatchdogReviewV2({
    repository,
    prNumber: 2045,
    branch: 'codex/worker-watchdog-current-main-binding-v2',
    sourceHead,
    baseSha,
    lineageEvidence: lineage(),
    analysis: { findings: [] },
    sources: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.clean, false);
});

test('legacy V1 watchdog lineage falls through instead of being claimed by V2', () => {
  const result = analyzeWindowsAuthorityWorkerWatchdogReviewV2({
    repository,
    prNumber: 2045,
    branch: 'codex/worker-watchdog-current-main-binding-v2',
    sourceHead,
    baseSha,
    lineageEvidence: lineage({ parents: [legacyV1Anchor, baseSha] }),
    analysis: exactEscalationAnalysis(),
    sources: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.clean, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V2_NOT_APPLICABLE');
});

test('malformed genuine V2 lineage remains V2-owned and fails closed', () => {
  const result = analyzeWindowsAuthorityWorkerWatchdogReviewV2({
    repository,
    prNumber: 2045,
    branch: 'codex/worker-watchdog-current-main-binding-v2',
    sourceHead,
    baseSha,
    lineageEvidence: lineage({ liveMainAfterSha: '0'.repeat(40) }),
    analysis: exactEscalationAnalysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-v2-reviewed-lineage-mismatch'));
});
