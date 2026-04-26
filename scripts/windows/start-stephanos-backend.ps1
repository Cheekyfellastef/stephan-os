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

function Write-Log {
    param([string]$Message)
    $entry = "[{0}] {1}" -f (Get-Date -Format 's'), $Message
    $entry | Tee-Object -FilePath $logPath -Append
}

Write-Log "Stephanos Battle Bridge backend start requested. Repo root: $repoRoot"
Write-Log "Health endpoint: $healthUrl"

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
exit 1
