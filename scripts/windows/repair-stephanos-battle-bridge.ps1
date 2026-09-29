[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$BackendStartupTimeoutSeconds = 90,
    [int]$HostedPollTimeoutSeconds = 45,
    [int]$PollIntervalSeconds = 3,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead
)

$ErrorActionPreference = 'Stop'

$taskName = 'Stephanos Battle Bridge Backend'
$expectedServeHost = 'https://desktop-9flonkj.taild6f215.ts.net'
$expectedServeTarget = 'http://127.0.0.1:8787'
$localHealthUrl = 'http://127.0.0.1:8787/api/health'
$hostedHealthUrl = "$expectedServeHost/api/health"
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'

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

function Assert-ExpectedHeadImmediatelyBeforeMutation {
    param([Parameter(Mandatory = $true)][string]$Mutation)
    if (-not (Test-Path -LiteralPath $canonicalGit -PathType Leaf)) {
        throw "Canonical Git is unavailable before ${Mutation}: $canonicalGit"
    }
    $headOutput = @(& $canonicalGit -C $repoRoot rev-parse HEAD 2>$null)
    $headExitCode = $LASTEXITCODE
    if ($headExitCode -ne 0) { throw "Canonical Git head proof failed before ${Mutation}." }
    $observedHead = [string]($headOutput | Select-Object -First 1)
    $observedHead = $observedHead.Trim().ToLowerInvariant()
    if ($observedHead -ne $ExpectedHead.ToLowerInvariant()) {
        throw "BATTLE_BRIDGE_REPAIR_EXPECTED_HEAD_MISMATCH before ${Mutation}: expected=$ExpectedHead observed=$observedHead"
    }
    Write-Log "Exact-head mutation gate passed before ${Mutation}: $observedHead"
}

function Test-BackendExactHeadHealth {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$ExpectedSourceHead,
        [int]$TimeoutSeconds = 8
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        if ($response.StatusCode -ne 200) {
            return [PSCustomObject]@{
                Url = $Url
                Healthy = $false
                StatusCode = $response.StatusCode
                SourceHead = $null
                Error = "BACKEND_HEALTH_HTTP_STATUS:$($response.StatusCode)"
            }
        }

        try {
            $payload = $response.Content | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            return [PSCustomObject]@{
                Url = $Url
                Healthy = $false
                StatusCode = $response.StatusCode
                SourceHead = $null
                Error = 'BACKEND_HEALTH_IDENTITY_JSON_INVALID'
            }
        }

        $observedSchemaVersion = if ($null -ne $payload.schemaVersion) { [string]$payload.schemaVersion } else { '' }
        if (-not [string]::Equals($observedSchemaVersion, 'stephanos.backend-health.v1', [System.StringComparison]::Ordinal)) {
            return [PSCustomObject]@{
                Url = $Url
                Healthy = $false
                StatusCode = $response.StatusCode
                SourceHead = $null
                Error = 'BACKEND_HEALTH_SCHEMA_MISSING_OR_MISMATCH'
            }
        }

        $observedRuntimeId = ''
        if ($null -ne $payload.backendIdentity -and $null -ne $payload.backendIdentity.runtimeId) {
            $observedRuntimeId = [string]$payload.backendIdentity.runtimeId
        }
        if (-not [string]::Equals($observedRuntimeId, 'stephanos-battle-bridge-backend', [System.StringComparison]::Ordinal)) {
            return [PSCustomObject]@{
                Url = $Url
                Healthy = $false
                StatusCode = $response.StatusCode
                SourceHead = $null
                Error = 'BACKEND_HEALTH_RUNTIME_ID_MISSING_OR_MISMATCH'
            }
        }

        $observedSourceHead = ''
        if ($null -ne $payload.backendIdentity -and $null -ne $payload.backendIdentity.sourceHead) {
            $observedSourceHead = ([string]$payload.backendIdentity.sourceHead).Trim().ToLowerInvariant()
        }
        $expected = $ExpectedSourceHead.Trim().ToLowerInvariant()
        if ($observedSourceHead -notmatch '^[0-9a-f]{40}$') {
            return [PSCustomObject]@{
                Url = $Url
                Healthy = $false
                StatusCode = $response.StatusCode
                SourceHead = if ($observedSourceHead) { $observedSourceHead } else { $null }
                Error = 'BACKEND_HEALTH_SOURCE_HEAD_MISSING_OR_INVALID'
            }
        }
        if ($observedSourceHead -ne $expected) {
            return [PSCustomObject]@{
                Url = $Url
                Healthy = $false
                StatusCode = $response.StatusCode
                SourceHead = $observedSourceHead
                Error = "BACKEND_HEALTH_SOURCE_HEAD_MISMATCH expected=$expected observed=$observedSourceHead"
            }
        }

        return [PSCustomObject]@{
            Url = $Url
            Healthy = $true
            StatusCode = $response.StatusCode
            SourceHead = $observedSourceHead
            Error = $null
        }
    }
    catch {
        return [PSCustomObject]@{
            Url = $Url
            Healthy = $false
            StatusCode = $null
            SourceHead = $null
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

$localResult = Test-BackendExactHeadHealth -Url $localHealthUrl -ExpectedSourceHead $ExpectedHead
if ($localResult.Healthy) {
    Write-Log "Local backend already healthy at exact head $($localResult.SourceHead) (HTTP $($localResult.StatusCode))."
}
else {
    Write-Log "Local backend unhealthy or not bound to expected head: $($localResult.Error)"
    $startScriptPath = Join-Path $scriptDir 'start-stephanos-backend.ps1'
    if (-not (Test-Path -LiteralPath $startScriptPath)) {
        Write-Log "ERROR: Backend starter script is missing: $startScriptPath"
        exit 1
    }

    $powershellExe = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $powershellExe)) {
        $powershellExe = 'powershell.exe'
    }

    $startArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startScriptPath, '-StartupTimeoutSeconds', $BackendStartupTimeoutSeconds, '-PollIntervalSeconds', $PollIntervalSeconds, '-ExpectedHead', $ExpectedHead)
    Write-Log ("Invoking backend starter: {0} {1}" -f $powershellExe, ($startArgs -join ' '))

    if ($PSCmdlet.ShouldProcess($startScriptPath, 'Start Stephanos backend')) {
        Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend starter child'
        & $powershellExe @startArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR: Backend starter exited with code $LASTEXITCODE"
            exit 1
        }
    }

    $localResult = Test-BackendExactHeadHealth -Url $localHealthUrl -ExpectedSourceHead $ExpectedHead
    if (-not $localResult.Healthy) {
        Write-Log "ERROR: Backend remains unhealthy or wrong-head after starter run: $($localResult.Error)"
        Write-LatestBackendErrorTail -RootLogsDir $logsDir
        exit 1
    }

    Write-Log "Local backend healthy after recovery at exact head $($localResult.SourceHead) (HTTP $($localResult.StatusCode))."
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
        Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'Tailscale Serve repair'
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
    $hostedResult = Test-BackendExactHeadHealth -Url $hostedHealthUrl -ExpectedSourceHead $ExpectedHead
    if ($hostedResult.Healthy) {
        $hostedHealthy = $true
        break
    }

    Write-Log ("Hosted bridge exact-head health pending: {0}" -f $hostedResult.Error)
    Start-Sleep -Seconds $PollIntervalSeconds
}

if (-not $hostedHealthy) {
    Write-Log "ERROR: Hosted bridge exact-head health check failed at $hostedHealthUrl within $HostedPollTimeoutSeconds seconds."
    exit 6
}

Write-Log "Hosted bridge healthy at exact head $($hostedResult.SourceHead) (HTTP $($hostedResult.StatusCode))."

Write-Log 'Ensuring readonly OpenClaw adapter stub at 127.0.0.1:8790.'
$openClawEnsureOutput = ''
try {
    Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure'
    $openClawEnsureOutput = npm run --silent openclaw:stub:ensure 2>&1 | Out-String
    Write-Log ("openclaw:stub:ensure -> {0}" -f $openClawEnsureOutput.Trim())
}
catch {
    Write-Log ("WARNING: openclaw:stub:ensure failed: {0}" -f $_.Exception.Message)
    Write-Log 'WARNING: Continue with backend/bridge repair success. OpenClaw execution remains disabled.'
}
Write-Log 'What to run now: npm run stephanos:battle-bridge:status ; npm run stephanos:battle-bridge:repair ; then re-run readonly validation in UI.'
Write-Log 'Battle Bridge repair completed successfully.'
exit 0
