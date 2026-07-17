[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$StartupTimeoutSeconds = 90,
    [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = 'Stop'

function Test-BackendHealth {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    }
    catch { return $false }
}

function Get-VerifiedBackendListener {
    $connections = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($processIds.Count -ne 1) { return $null }
    $processId = [int]$processIds[0]
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $name = ([string]$process.Name).ToLowerInvariant()
    $commandLine = ([string]$process.CommandLine).Replace('\', '/').ToLowerInvariant()
    if ($name -notin @('node.exe', 'node')) { return $null }
    if (-not $commandLine.Contains('stephanos-server/server.js')) { return $null }
    return [PSCustomObject]@{ ProcessId = $processId }
}

function Write-BackendRuntimeReceipt {
    param(
        [string]$WorkspaceRoot,
        [string]$Branch,
        [string]$HeadSha,
        [int]$ProcessId,
        [string]$HealthUrl
    )
    $statusDir = Join-Path $WorkspaceRoot 'status'
    [System.IO.Directory]::CreateDirectory($statusDir) | Out-Null
    $statusPath = Join-Path $statusDir 'stephanos-backend-runtime.json'
    $temporaryPath = "$statusPath.$PID.tmp"
    [PSCustomObject]@{
        schemaVersion = 'stephanos.backend-runtime.v1'
        timestampUtc = [DateTime]::UtcNow.ToString('o')
        branch = $Branch
        headSha = $HeadSha
        taskName = 'Stephanos Battle Bridge Backend'
        pid = $ProcessId
        healthUrl = 'loopback-backend-health'
        exactHeadProofOk = $true
        arbitraryShellAllowed = $false
        sourceMutationAllowed = $false
        pathValuesPublished = $false
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $statusPath -Force
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
Set-Location -Path $repoRoot

$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) { $git = Get-Command git -ErrorAction Stop }
$branch = (& $git.Source -C $repoRoot branch --show-current).Trim()
$headSha = (& $git.Source -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Backend startup requires canonical branch main.' }
if ($headSha -notmatch '^[0-9a-f]{40}$') { throw 'Backend startup could not prove a canonical 40-character Git head.' }

$healthUrl = 'http://127.0.0.1:8787/api/health'
$userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { throw 'USERPROFILE or HOME is required.' }
$workspaceRoot = Join-Path $userHome 'Documents\Stephanos-openclaw-workspace'
$logsDir = Join-Path $repoRoot 'logs\battle-bridge'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logsDir "backend-start-$timestamp.log"
$stdoutLogPath = Join-Path $logsDir "backend-start-$timestamp.stdout.log"
$stderrLogPath = Join-Path $logsDir "backend-start-$timestamp.stderr.log"

function Write-Log {
    param([string]$Message)
    $entry = "[{0}] {1}" -f (Get-Date -Format 's'), $Message
    $entry | Tee-Object -FilePath $logPath -Append
}

function Write-LatestBackendErrorTail {
    param([string]$RootLogsDir, [int]$TailLineCount = 80)
    if (-not (Test-Path -LiteralPath $RootLogsDir)) {
        Write-Log "No backend log directory found at $RootLogsDir"
        return
    }
    $latestStderr = Get-ChildItem -Path $RootLogsDir -Filter 'backend-start-*.stderr.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestStderr) {
        Write-Log 'No backend stderr log found to tail.'
        return
    }
    Write-Log ("Latest backend stderr log: {0}" -f $latestStderr.FullName)
    Get-Content -Path $latestStderr.FullName -Tail $TailLineCount | ForEach-Object { Write-Log $_ }
}

Write-Log "Stephanos Battle Bridge backend start requested from canonical main $headSha."
Write-Log "Backend health endpoint: $healthUrl"
Write-Log 'Frontend/dist server not started by this backend script (port 4173).'
Write-Log 'Ensuring OpenClaw readonly adapter stub lifecycle (execution remains disabled).'

try {
    $openClawEnsureOutput = npm run --silent openclaw:stub:ensure 2>&1 | Out-String
    Write-Log ("openclaw:stub:ensure -> {0}" -f $openClawEnsureOutput.Trim())
}
catch {
    Write-Log ("WARNING: OpenClaw readonly stub ensure failed: {0}" -f $_.Exception.Message)
    Write-Log 'WARNING: Continuing backend startup. OpenClaw execution remains disabled.'
}

if (Test-BackendHealth -Url $healthUrl) {
    Write-Log 'Backend already healthy; exiting without starting a new process.'
    exit 0
}

$npmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } elseif (Get-Command npm -ErrorAction SilentlyContinue) { 'npm' } else { $null }
if (-not $npmCommand) {
    Write-Log 'ERROR: npm was not found in PATH.'
    exit 1
}

$arguments = @('run', 'stephanos:backend')
Write-Log ("Starting backend with command: {0} {1}" -f $npmCommand, ($arguments -join ' '))
if ($PSCmdlet.ShouldProcess("$npmCommand $($arguments -join ' ')", 'Start Stephanos backend')) {
    $process = Start-Process -FilePath $npmCommand `
        -ArgumentList $arguments `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutLogPath `
        -RedirectStandardError $stderrLogPath `
        -WindowStyle Hidden `
        -PassThru
    Write-Log ("Start-Process launched with PID {0}." -f $process.Id)
}
else {
    Write-Log 'WhatIf: backend start command was not executed.'
    exit 0
}

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$listener = $null
while ((Get-Date) -lt $deadline) {
    if (Test-BackendHealth -Url $healthUrl) {
        $listener = Get-VerifiedBackendListener
        if ($listener) { break }
    }
    Start-Sleep -Seconds $PollIntervalSeconds
}

if ($listener) {
    Write-BackendRuntimeReceipt -WorkspaceRoot $workspaceRoot -Branch $branch -HeadSha $headSha -ProcessId $listener.ProcessId -HealthUrl $healthUrl
    Write-Log "Backend health and exact-head runtime receipt succeeded within $StartupTimeoutSeconds seconds."
    exit 0
}

Write-Log "ERROR: Backend health or verified listener did not succeed within $StartupTimeoutSeconds seconds."
Write-LatestBackendErrorTail -RootLogsDir $logsDir
exit 1
