import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_PATHS_V1,
  analyzeWindowsAuthorityRecoveryMeshLaunchLivenessReviewV1,
} from './windowsAuthorityRecoveryMeshLaunchLivenessReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_PATHS_V1[0];

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

const CLEAN = String.raw`[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
$repoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$runnerPath = Join-Path $repoRoot 'scripts\battle-bridge-recovery-mesh.mjs'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$launchStatusPath = Join-Path $workspaceRoot 'status\battle-bridge-recovery-mesh-launch-current.json'
$mutex = New-Object System.Threading.Mutex($false, 'Local\StephanosBattleBridgeRecoveryMeshV1')
$mutexHeld = $mutex.WaitOne(0)
if (-not $mutexHeld) { Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_MUTEX_BUSY' }
'RECOVERY_MESH_STALE_LOCK_RECLAIM_FAILED'
'RECOVERY_MESH_RUNNER_STARTING'
'RECOVERY_MESH_RUNNER_COMPLETED'
'RECOVERY_MESH_RUNNER_FAILED'
'RECOVERY_MESH_HIDDEN_WRAPPER_FAILED'
'RECOVERY_LOCK_MULTIPLE_LINKS_REJECTED'
[StephanosRecoveryMeshLauncherPathIdentity]::OpenVerifiedForDelete($lockPath, $lockIdentity)
[StephanosRecoveryMeshLauncherPathIdentity]::DeleteByHandle($lockHandle)
$env:STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'
$env:STEPHANOS_RECOVERY_MESH_LAUNCHER_PID = [string]$PID
$runnerOutput = @(& $nodeExecutable $runnerPath 2>&1)
$runnerExitCode = $LASTEXITCODE
$runnerResult = $runnerText | ConvertFrom-Json
$runnerResultParsed = $null -ne $runnerResult
if ($runnerResultParsed -and $runnerExitCode -eq 0) {
  Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_RUNNER_COMPLETED'
} else {
  Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_RUNNER_FAILED'
}
$record = [ordered]@{
  visiblePowerShellRequired = $false
  arbitraryShellAllowed = $false
  arbitraryPowerShellAllowed = $false
  sourceMutationAllowed = $false
  pcRestartAllowed = $false
}
`;

function sourceRecord(content = CLEAN) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path: PATH,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function review(content = CLEAN, overrides = {}) {
  return analyzeWindowsAuthorityRecoveryMeshLaunchLivenessReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
    },
    sources: [sourceRecord(content)],
    ...overrides,
  });
}

test('accepts only the fixed no-argument Recovery Mesh hidden launch contract', () => {
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.match(result.proofRefs[0], /windows-authority-recovery-mesh-launch-liveness/);
});

test('requires nonzero runner results to stay failed even when JSON parses', () => {
  const weakened = CLEAN.replace('if ($runnerResultParsed -and $runnerExitCode -eq 0)', 'if ($runnerResultParsed)');
  const result = review(weakened);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'recovery-launch-exit-gate-not-fail-closed'));
});

test('rejects caller parameters and dynamic or task mutation authority', () => {
  const callerShaped = CLEAN.replace('param()', 'param([string]$Command)');
  assert.ok(review(callerShaped).findings.some((item) => item.code === 'recovery-launch-caller-parameters-forbidden'));

  const dynamic = `${CLEAN}\nStart-Process calc.exe`;
  assert.ok(review(dynamic).findings.some((item) => item.code === 'recovery-launch-dynamic-execution-forbidden'));

  const taskMutation = `${CLEAN}\nStart-ScheduledTask -TaskName 'anything'`;
  assert.ok(review(taskMutation).findings.some((item) => item.code === 'recovery-launch-task-mutation-forbidden'));
});

test('fails closed on widened source evidence or a different high-risk path', () => {
  const widened = review(CLEAN, { sources: [sourceRecord(), { ...sourceRecord(), path: 'scripts/windows/other.ps1' }] });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));

  const wrongPath = analyzeWindowsAuthorityRecoveryMeshLaunchLivenessReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }] },
    sources: [sourceRecord()],
  });
  assert.equal(wrongPath.eligible, false);
});
