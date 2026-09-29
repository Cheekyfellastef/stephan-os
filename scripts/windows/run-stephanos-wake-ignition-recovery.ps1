[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "Wake ignition recovery must run from the canonical checkout: $expectedRepoRoot"
}

function Test-LocalEndpoint([string]$Url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    } catch {
        return $false
    }
}

$before = [ordered]@{
    ui4173 = Test-LocalEndpoint 'http://127.0.0.1:4173/__stephanos/health'
    backend8787 = Test-LocalEndpoint 'http://127.0.0.1:8787/api/health'
    openClaw18789 = Test-LocalEndpoint 'http://127.0.0.1:18789/health'
}
$healthyBefore = [bool]($before.ui4173 -and $before.backend8787 -and $before.openClaw18789)
$spawned = $false
$startedPid = 0
$blocker = ''
$logRoot = ''
$stdoutLog = ''
$stderrLog = ''

if (-not $healthyBefore) {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $blocker = 'STEPHANOS_WAKE_IGNITION_NPM_NOT_FOUND'
    } else {
        $sharedWorkspace = if ($env:STEPHANOS_SHARED_WORKSPACE -and $env:STEPHANOS_SHARED_WORKSPACE.Trim()) {
            $env:STEPHANOS_SHARED_WORKSPACE.Trim()
        } elseif ($env:STEPHANOS_OPENCLAW_WORKSPACE -and $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()) {
            $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()
        } else {
            Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Stephanos-openclaw-workspace'
        }
        $logRoot = Join-Path $sharedWorkspace 'logs\wake-ignition-recovery'
        New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
        $stdoutLog = Join-Path $logRoot "$stamp.stdout.log"
        $stderrLog = Join-Path $logRoot "$stamp.stderr.log"
        $cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $fixedCommand = ('"{0}" run stephanos:ignite' -f $npm.Source)

        $approvalName = 'STEPHANOS_APPROVE_OPENCLAW_CONTROL_PANEL_STARTGATEWAY'
        $previousApproval = [Environment]::GetEnvironmentVariable($approvalName, 'Process')
        try {
            [Environment]::SetEnvironmentVariable($approvalName, '1', 'Process')
            $started = Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/s', '/c', $fixedCommand) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
            $spawned = $true
            $startedPid = [int]$started.Id
        } catch {
            $blocker = 'STEPHANOS_WAKE_IGNITION_START_FAILED'
        } finally {
            [Environment]::SetEnvironmentVariable($approvalName, $previousApproval, 'Process')
        }
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.wake-ignition-recovery.v1'
    canonicalRepoRoot = $repoRoot
    healthyBefore = $healthyBefore
    before = [pscustomobject]$before
    ignitionSpawned = $spawned
    startedPid = $startedPid
    blocker = $blocker
    logRoot = $logRoot
    stdoutLog = $stdoutLog
    stderrLog = $stderrLog
    fixedIgnitionCommand = 'npm run stephanos:ignite'
    openClawStartGatewayApprovalOnly = $true
    sourceMutationAuthorityGranted = $false
    arbitraryShellAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryArgumentsAllowed = $false
    packageInstallAllowed = $false
    mergeAuthority = $false
    pcRestartAllowed = $false
    finalVerdict = if ($healthyBefore) { 'STEPHANOS_ALREADY_HEALTHY' } elseif ($spawned) { 'STEPHANOS_WAKE_IGNITION_DISPATCHED' } else { 'STEPHANOS_WAKE_IGNITION_BLOCKED' }
} | ConvertTo-Json -Depth 5

if (-not $healthyBefore -and -not $spawned) { exit 2 }
