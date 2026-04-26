[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$BackendStartupTimeoutSeconds = 90,
    [int]$HostedPollTimeoutSeconds = 45,
    [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = 'Stop'

$taskName = 'Stephanos Battle Bridge Backend'
$expectedServeHost = 'https://desktop-9flonkj.taild6f215.ts.net'
$expectedServeTarget = 'http://127.0.0.1:8787'
$localHealthUrl = 'http://127.0.0.1:8787/api/health'
$hostedHealthUrl = "$expectedServeHost/api/health"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
Set-Location -Path $repoRoot

$logsDir = Join-Path $repoRoot 'logs\battle-bridge'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logsDir "repair-$timestamp.log"

function Write-Log {
    param([string]$Message)
    $entry = "[{0}] {1}" -f (Get-Date -Format 's'), $Message
    $entry | Tee-Object -FilePath $logPath -Append
}

function Test-Url {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 8
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        return [PSCustomObject]@{
            Url = $Url
            Healthy = ($response.StatusCode -eq 200)
            StatusCode = $response.StatusCode
            Error = $null
        }
    }
    catch {
        return [PSCustomObject]@{
            Url = $Url
            Healthy = $false
            StatusCode = $null
            Error = $_.Exception.Message
        }
    }
}

function Test-ExpectedServeMapping {
    param(
        [string]$ServeStatusText,
        [string]$ExpectedHost,
        [string]$ExpectedTarget
    )

    if ([string]::IsNullOrWhiteSpace($ServeStatusText)) {
        return $false
    }

    $normalized = $ServeStatusText.ToLowerInvariant()
    $hostOk = $normalized.Contains($ExpectedHost.ToLowerInvariant())
    $targetOk = $normalized.Contains($ExpectedTarget.ToLowerInvariant())

    return ($hostOk -and $targetOk)
}

function Get-TailscaleCommand {
    $command = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidatePaths = @(
        'C:\Program Files\Tailscale\tailscale.exe',
        'C:\Program Files (x86)\Tailscale\tailscale.exe'
    )

    foreach ($path in $candidatePaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    return $null
}

Write-Log "Stephanos Battle Bridge repair started. Repo root: $repoRoot"
Write-Log "Task: $taskName"
Write-Log "Expected Serve mapping: $expectedServeHost/ -> $expectedServeTarget"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Log ("Scheduled task present. State={0}; LastTaskResult={1}" -f $task.State, $taskInfo.LastTaskResult)
}
else {
    Write-Log 'WARNING: Scheduled task not found. Backend autostart at logon is not configured.'
}

$localResult = Test-Url -Url $localHealthUrl
if ($localResult.Healthy) {
    Write-Log "Local backend already healthy (HTTP $($localResult.StatusCode))."
}
else {
    Write-Log "Local backend unhealthy: $($localResult.Error)"
    $startScriptPath = Join-Path $scriptDir 'start-stephanos-backend.ps1'
    if (-not (Test-Path -LiteralPath $startScriptPath)) {
        Write-Log "ERROR: Backend starter script is missing: $startScriptPath"
        exit 1
    }

    $powershellExe = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $powershellExe)) {
        $powershellExe = 'powershell.exe'
    }

    $startArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScriptPath, '-StartupTimeoutSeconds', $BackendStartupTimeoutSeconds, '-PollIntervalSeconds', $PollIntervalSeconds)
    Write-Log ("Invoking backend starter: {0} {1}" -f $powershellExe, ($startArgs -join ' '))

    if ($PSCmdlet.ShouldProcess($startScriptPath, 'Start Stephanos backend')) {
        & $powershellExe @startArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR: Backend starter exited with code $LASTEXITCODE"
            exit 1
        }
    }

    $localResult = Test-Url -Url $localHealthUrl
    if (-not $localResult.Healthy) {
        Write-Log "ERROR: Backend remains unhealthy after starter run: $($localResult.Error)"
        exit 1
    }

    Write-Log "Local backend healthy after recovery (HTTP $($localResult.StatusCode))."
}

$tailscaleExe = Get-TailscaleCommand
if (-not $tailscaleExe) {
    Write-Log 'ERROR: tailscale.exe not found. Backend startup was checked, but bridge transport cannot be repaired without Tailscale CLI.'
    exit 2
}

Write-Log "Using tailscale CLI: $tailscaleExe"

$tailscaleStatusOutput = ''
$tailscaleServeStatusOutput = ''

try {
    $tailscaleStatusOutput = & $tailscaleExe status 2>&1 | Out-String
    Write-Log 'tailscale status collected.'
}
catch {
    Write-Log "WARNING: tailscale status failed: $($_.Exception.Message)"
}

try {
    $tailscaleServeStatusOutput = & $tailscaleExe serve status 2>&1 | Out-String
    Write-Log 'tailscale serve status collected.'
}
catch {
    Write-Log "ERROR: tailscale serve status failed: $($_.Exception.Message)"
    exit 3
}

$serveMappingPresent = Test-ExpectedServeMapping -ServeStatusText $tailscaleServeStatusOutput -ExpectedHost $expectedServeHost -ExpectedTarget $expectedServeTarget
if ($serveMappingPresent) {
    Write-Log 'Expected Tailscale Serve mapping is already present; no serve mutation required.'
}
else {
    Write-Log 'Expected Serve mapping missing. Restoring / -> http://127.0.0.1:8787 (tailnet-only, no Funnel).'
    if ($PSCmdlet.ShouldProcess('tailscale serve', 'Restore expected Battle Bridge mapping')) {
        & $tailscaleExe serve --bg $expectedServeTarget | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR: tailscale serve --bg $expectedServeTarget failed with exit code $LASTEXITCODE"
            exit 4
        }
    }

    $tailscaleServeStatusOutput = & $tailscaleExe serve status 2>&1 | Out-String
    $serveMappingPresent = Test-ExpectedServeMapping -ServeStatusText $tailscaleServeStatusOutput -ExpectedHost $expectedServeHost -ExpectedTarget $expectedServeTarget
    if (-not $serveMappingPresent) {
        Write-Log 'ERROR: Serve mapping is still missing after repair command.'
        exit 5
    }

    Write-Log 'Serve mapping restored successfully.'
}

$deadline = (Get-Date).AddSeconds($HostedPollTimeoutSeconds)
$hostedHealthy = $false
$hostedResult = $null

while ((Get-Date) -lt $deadline) {
    $hostedResult = Test-Url -Url $hostedHealthUrl
    if ($hostedResult.Healthy) {
        $hostedHealthy = $true
        break
    }

    Write-Log ("Hosted bridge health pending: {0}" -f $hostedResult.Error)
    Start-Sleep -Seconds $PollIntervalSeconds
}

if (-not $hostedHealthy) {
    Write-Log "ERROR: Hosted bridge health check failed at $hostedHealthUrl within $HostedPollTimeoutSeconds seconds."
    exit 6
}

Write-Log "Hosted bridge healthy (HTTP $($hostedResult.StatusCode))."
Write-Log 'Battle Bridge repair completed successfully.'
exit 0
