import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1,
  analyzeWindowsAuthorityStephanosCoreDaemonReviewV1,
} from './windowsAuthorityStephanosCoreDaemonReviewV1.mjs';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const [RUNNER_PATH, STATUS_PATH] = WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1;

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}
const analysis = {
  findings: WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1.map((path) => ({
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    path,
  })),
};

const runner = String.raw`[CmdletBinding()]
param([string]$RequireCapabilityVersion = '')
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$powershellExecutable = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$coreDaemonScript = Join-Path $repoRoot 'scripts\stephanos-core-daemon.mjs'
$coreDaemonStatusPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\stephanos-core-daemon-current.json'
$coreDaemonScriptPattern = [regex]::Escape($coreDaemonScript)
function Get-StephanosCoreDaemonProcesses {
  return @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe'
    [string]$_.CommandLine -match $coreDaemonScriptPattern
  })
}
$coreBefore = @(Get-StephanosCoreDaemonProcesses)
$coreHealthBefore = [pscustomobject]@{ healthy = $false }
if ($coreBefore.Count -eq 0 -or -not [bool]$coreHealthBefore.healthy) {
  if ($coreBefore.Count -gt 0) {
    $coreDaemonRestartRequested = $true
    foreach ($process in $coreBefore) {
      Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
    }
  }
}
$coreDaemonStartRequested = $true
$serverStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedServerScript) -PassThru
$vrStarted = Start-Process -FilePath $powershellExecutable -ArgumentList @('-File', $quotedVrGovernorScript) -PassThru
$coreStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedCoreDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_SCRIPT_MISSING'
$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NODE_MISSING'
$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NOT_HEALTHY'
[pscustomobject]@{
  coreDaemonHealthy = [bool]$coreDaemonOk
  sourceMutationDelegatedToMissionWorker = $true
  duplicateSchedulerAllowed = $false
  duplicateLeaseAllowed = $false
  arbitraryExecutableAllowed = $false
  arbitraryShellAllowed = $false
  unrelatedProcessRestartAllowed = $false
  pcRestartAllowed = $false
}`;

const status = String.raw`[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = 'C:\Users\operator\Documents\GitHub\stephan-os'
$coreScript = Join-Path $repoRoot 'scripts\stephanos-core-daemon.mjs'
$statusPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\stephanos-core-daemon-current.json'
$corePattern = [regex]::Escape($coreScript)
$processes = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -eq 'node.exe'
      [string]$_.CommandLine -match $corePattern
    }
)
$status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
[pscustomobject]@{
  schemaVersion = 'stephanos.core-daemon-status.v1'
  uiRequired = $false
  sourceMutationAllowed = $false
  schedulerAuthority = $false
  mergeAuthority = $false
  vendorMeterRequired = $false
  remoteCommanderRequired = $false
} | ConvertTo-Json -Depth 4
`;

function review(runnerSource = runner, statusSource = status, extra = []) {
  return analyzeWindowsAuthorityStephanosCoreDaemonReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis,
    sources: [source(RUNNER_PATH, runnerSource), source(STATUS_PATH, statusSource), ...extra],
  });
}

test('clean Core Daemon Windows estate is qualified with zero authority', () => {
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('top-level trusted specialist routes the Core Daemon pair before fallback', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis,
    sources: [source(RUNNER_PATH, runner), source(STATUS_PATH, status)],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_SPECIALIST_CLEAN');
});

test('widened execution, process kill, task, Git and writable-status authority fail closed', () => {
  const attacks = [
    [runner + "\nStart-Process -FilePath $canonicalNode -ArgumentList @($callerArgs)", status],
    [runner.replace('Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop', 'Stop-Process -Name node -Force'), status],
    [runner + "\nStart-ScheduledTask -TaskName $TaskName", status],
    [runner + "\nInvoke-Expression $env:CORE_COMMAND", status],
    [runner + "\ngit reset --hard HEAD~1", status],
    [runner, status + "\nSet-Content -LiteralPath $statusPath -Value bad"],
    [runner, status + "\nInvoke-RestMethod http://example.invalid"],
  ];
  for (const [runnerSource, statusSource] of attacks) {
    const result = review(runnerSource, statusSource);
    assert.equal(result.clean, false);
    assert.ok(result.findings.length > 0);
  }
});

test('widened source estate and wrong escalation do not inherit qualification', () => {
  assert.equal(review(runner, status, [source('scripts/windows/other.ps1', 'x')]).clean, false);
  const wrong = analyzeWindowsAuthorityStephanosCoreDaemonReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [analysis.findings[0]] },
    sources: [source(RUNNER_PATH, runner), source(STATUS_PATH, status)],
  });
  assert.equal(wrong.eligible, false);
});

test('trusted switchboard byte-pins and invokes the Core Daemon specialist', async () => {
  const wrapper = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  const child = await readFile(new URL('./windowsAuthorityStephanosCoreDaemonReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, new RegExp("STEPHANOS_CORE_DAEMON_BLOB_SHA = '" + blobSha(child) + "'"));
  assert.match(wrapper, /analyzeWindowsAuthorityStephanosCoreDaemonReviewV1/);
  assert.ok(wrapper.indexOf('analyzeWindowsAuthorityStephanosCoreDaemonReviewV1')
    < wrapper.lastIndexOf('return base.analyzeWindowsAuthoritySpecialistReview(input)'));
});
