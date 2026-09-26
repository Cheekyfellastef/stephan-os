import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATHS_V1,
  analyzeWindowsAuthorityMailboxCadenceReviewV1,
} from './windowsAuthorityMailboxCadenceReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const path = WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATHS_V1[0];
const installer = `[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge GitHub Command Mailbox'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\\..')).Path
$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\\windows\\run-stephanos-scheduled-task-windowless.vbs')).Path
if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.'
}
$expectedRepoRoot = Join-Path $env:USERPROFILE 'Documents\\GitHub\\stephan-os'
if ([System.IO.Path]::GetFullPath($repoRoot) -ne [System.IO.Path]::GetFullPath($expectedRepoRoot)) {
    throw "Installer must run from the canonical checkout: $expectedRepoRoot"
}

$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs')).Path
$childRunnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\\battle-bridge-github-command-mailbox-with-receipt-index.mjs')).Path
$wscriptExe = Join-Path $env:SystemRoot 'System32\\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw "Windowless task host is missing: $wscriptExe" }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo \`"$escapedLauncherPath\`" github-command-mailbox"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$fastIntervalTrigger = New-ScheduledTaskTrigger \`
    -Once \`
    -At (Get-Date).AddMinutes(1) \`
    -RepetitionInterval (New-TimeSpan -Minutes 1) \`
    -RepetitionDuration (New-TimeSpan -Days 3650)
$compatibilityIntervalTrigger = New-ScheduledTaskTrigger \`
    -Once \`
    -At (Get-Date).AddMinutes(5) \`
    -RepetitionInterval (New-TimeSpan -Minutes 5) \`
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet \`
    -AllowStartIfOnBatteries \`
    -DontStopIfGoingOnBatteries \`
    -Hidden \`
    -StartWhenAvailable \`
    -MultipleInstances IgnoreNew \`
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

if ($PSCmdlet.ShouldProcess($taskName, 'Register or update bounded GitHub command mailbox task with Shared Workspace receipt index')) {
    Register-ScheduledTask \`
        -TaskName $taskName \`
        -Action $action \`
        -Trigger @($logonTrigger, $fastIntervalTrigger, $compatibilityIntervalTrigger) \`
        -Principal $principal \`
        -Settings $settings \`
        -Description 'Consumes only owner-authored, expiring, allowlisted Stephanos commands from issue 1507 and publishes a bounded Shared Workspace receipt index. One-minute polling is primary; the legacy five-minute trigger is retained as a compatibility fallback. No arbitrary shell, destructive Git, merge, push, or live OpenClaw update.' \`
        -Force | Out-Null
    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
    }
}

[pscustomobject]@{
    taskName = $taskName
    installed = $true
    currentUser = $currentUser
    executable = $wscriptExe
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    childRunnerPath = $childRunnerPath
    outboxGuardEnabled = $true
    receiptIndexEnabled = $true
    intervalMinutes = 5
    effectivePollIntervalMinutes = 1
    compatibilityIntervalMinutes = 5
    pollStrategy = 'ONE_MINUTE_PRIMARY_FIVE_MINUTE_COMPATIBILITY_FALLBACK'
    multipleInstances = 'IgnoreNew'
    executionTimeLimitMinutes = 15
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    startedNow = [bool]$StartNow
    arbitraryShellAllowed = $false
    destructiveGitAllowed = $false
    liveOpenClawUpdateAllowed = $false
    headlessLauncher = $true
} | ConvertTo-Json -Depth 4
`;

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function source(content = installer) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref: head,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function input(overrides = {}) {
  return {
    repository,
    prNumber: 2082,
    branch: 'fix/battle-bridge-mailbox-one-minute-cadence-v1',
    sourceHead: head,
    baseSha: 'b'.repeat(40),
    analysis: {
      findings: [{
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        summary: 'This high-risk surface requires a separate qualified specialist reviewer.',
        path,
      }],
    },
    sources: [source()],
    ...overrides,
  };
}

test('mailbox cadence specialist is pinned to exactly the canonical installer path', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATHS_V1, [path]);
});

test('mailbox cadence specialist fails closed unless exact #2082 identity and singleton escalation are present', () => {
  assert.equal(analyzeWindowsAuthorityMailboxCadenceReviewV1(input({ prNumber: 2083 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMailboxCadenceReviewV1(input({ branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMailboxCadenceReviewV1(input({ analysis: { findings: [] } })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMailboxCadenceReviewV1(input({ analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', summary: 'x', path: 'scripts/windows/other.ps1' }] } })).eligible, false);
});

test('mailbox cadence specialist requires the immutable reviewed installer blob', () => {
  const result = analyzeWindowsAuthorityMailboxCadenceReviewV1(input());
  // The production specialist pins the real Git blob from #2082. This fixture deliberately proves
  // source-evidence rejection unless its byte identity is exactly that reviewed blob.
  assert.equal(result.eligible, true);
  if (source().blobSha === '5729ef0d26c966f9fa32fc44cb2bc5626ba835b9') {
    assert.equal(result.clean, true);
    assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_SPECIALIST_CLEAN');
  } else {
    assert.equal(result.clean, false);
    assert.equal(result.findings[0]?.code, 'windows-authority-mailbox-cadence-source-evidence-invalid');
  }
});

test('specialist source positively requires fast polling and preserves overlap/execution safety', async () => {
  const { readFile } = await import('node:fs/promises');
  const specialist = await readFile(new URL('./windowsAuthorityMailboxCadenceReviewV1.mjs', import.meta.url), 'utf8');
  for (const token of [
    'mailbox-cadence-one-minute-trigger-missing',
    'mailbox-cadence-five-minute-fallback-missing',
    'mailbox-cadence-overlap-guard-missing',
    'mailbox-cadence-execution-ceiling-missing',
    'mailbox-cadence-principal-not-limited',
    'mailbox-cadence-dynamic-execution-forbidden',
    'mailbox-cadence-git-mutation-forbidden',
    'mailbox-cadence-host-authority-expanded',
  ]) assert.match(specialist, new RegExp(token));
});
