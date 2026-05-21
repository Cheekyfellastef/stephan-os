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
    catch {
        return $false
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')
Set-Location -Path $repoRoot

$healthUrl = 'http://127.0.0.1:8787/api/health'
$logsDir = Join-Path $repoRoot 'logs\battle-bridge'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logsDir "backend-start-$timestamp.log"
$stdoutLogPath = Join-Path $logsDir "backend-start-$timestamp.stdout.log"
$stderrLogPath = Join-Path $logsDir "backend-start-$timestamp.stderr.log"

function Write-LatestBackendErrorTail {
    param(
        [string]$RootLogsDir,
        [int]$TailLineCount = 80
    )

    if (-not (Test-Path -LiteralPath $RootLogsDir)) {
        Write-Log "No backend log directory found at $RootLogsDir"
        return
    }

    $latestStderr = Get-ChildItem -Path $RootLogsDir -Filter 'backend-start-*.stderr.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latestStderr) {
        Write-Log 'No backend stderr log found to tail.'
        return
    }

    Write-Log ("Latest backend stderr log: {0}" -f $latestStderr.FullName)
    Write-Log ("----- stderr tail (last {0} lines) -----" -f $TailLineCount)
    Get-Content -Path $latestStderr.FullName -Tail $TailLineCount | ForEach-Object { Write-Log $_ }
    Write-Log '----- end stderr tail -----'
}

function Write-Log {
    param([string]$Message)
    $entry = "[{0}] {1}" -f (Get-Date -Format 's'), $Message
    $entry | Tee-Object -FilePath $logPath -Append
}

Write-Log "Stephanos Battle Bridge backend start requested. Repo root: $repoRoot"
Write-Log "Health endpoint: $healthUrl"
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

$arguments = @('run', 'stephanos:serve')
Write-Log ("Starting backend with command: {0} {1}" -f $npmCommand, ($arguments -join ' '))

if ($PSCmdlet.ShouldProcess("$npmCommand $($arguments -join ' ')", 'Start Stephanos backend')) {
    $process = Start-Process -FilePath $npmCommand `
        -ArgumentList $arguments `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutLogPath `
        -RedirectStandardError $stderrLogPath `
        -WindowStyle Hidden `
        -PassThru

    Write-Log ("Start-Process launched with PID {0}. stdout={1} stderr={2}" -f $process.Id, $stdoutLogPath, $stderrLogPath)
}
else {
    Write-Log 'WhatIf: backend start command was not executed.'
    exit 0
}

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    if (Test-BackendHealth -Url $healthUrl) {
        $healthy = $true
        break
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}

if ($healthy) {
    Write-Log "Backend health check succeeded within $StartupTimeoutSeconds seconds."
    exit 0
}

Write-Log "ERROR: Backend health check did not succeed within $StartupTimeoutSeconds seconds."
Write-LatestBackendErrorTail -RootLogsDir $logsDir
exit 1
