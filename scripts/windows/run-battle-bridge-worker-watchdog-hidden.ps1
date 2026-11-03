[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.'
}

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$launchStatusPath = Join-Path $workspaceRoot 'status\battle-bridge-worker-watchdog-launch-current.json'

function Write-WatchdogLaunchStatus {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(
            'WATCHDOG_HIDDEN_WRAPPER_STARTED',
            'WATCHDOG_HIDDEN_WRAPPER_FAILED',
            'WATCHDOG_RUNNER_STARTING',
            'WATCHDOG_RUNNER_COMPLETED',
            'WATCHDOG_RUNNER_FAILED'
        )]
        [string]$Classification,
        [bool]$RunnerStarted = $false,
        [bool]$RunnerCompleted = $false,
        [int]$RunnerExitCode = -1,
        [bool]$RunnerResultParsed = $false,
        [string]$RunnerClassification = '',
        [string]$Failure = ''
    )

    $statusDirectory = Split-Path -Parent $launchStatusPath
    New-Item -ItemType Directory -Path $statusDirectory -Force | Out-Null
    $temporaryPath = "${launchStatusPath}.$PID.tmp"
    $record = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-worker-watchdog-launch.v1'
        timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        classification = $Classification
        hiddenWrapperStarted = $true
        runnerStarted = $RunnerStarted
        runnerCompleted = $RunnerCompleted
        runnerExitCode = $RunnerExitCode
        runnerResultParsed = $RunnerResultParsed
        runnerClassification = $RunnerClassification
        failure = $Failure
        visiblePowerShellRequired = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
    }
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $launchStatusPath -Force
}

try {
    Write-WatchdogLaunchStatus -Classification 'WATCHDOG_HIDDEN_WRAPPER_STARTED'

    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
    $expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
    if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
        throw "Worker watchdog launcher must run from the canonical checkout: $expectedRepoRoot"
    }

    $runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-worker-watchdog-runner.mjs')).Path
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction Stop }

    Write-WatchdogLaunchStatus -Classification 'WATCHDOG_RUNNER_STARTING' -RunnerStarted $true
    $runnerOutput = @(& $nodeCommand.Source $runnerPath 2>&1)
    $runnerExitCode = $LASTEXITCODE
    $runnerText = ($runnerOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $runnerResult = $null
    try {
        $runnerResult = $runnerText | ConvertFrom-Json
    } catch {
        $runnerResult = $null
    }

    if ($runnerResult) {
        Write-WatchdogLaunchStatus `
            -Classification 'WATCHDOG_RUNNER_COMPLETED' `
            -RunnerStarted $true `
            -RunnerCompleted $true `
            -RunnerExitCode $runnerExitCode `
            -RunnerResultParsed $true `
            -RunnerClassification ([string]$runnerResult.classification)
    } else {
        $boundedFailure = if ($runnerText.Length -gt 4000) { $runnerText.Substring(0, 4000) } else { $runnerText }
        Write-WatchdogLaunchStatus `
            -Classification 'WATCHDOG_RUNNER_FAILED' `
            -RunnerStarted $true `
            -RunnerCompleted $true `
            -RunnerExitCode $runnerExitCode `
            -Failure $boundedFailure
    }
    exit $runnerExitCode
} catch {
    Write-WatchdogLaunchStatus `
        -Classification 'WATCHDOG_HIDDEN_WRAPPER_FAILED' `
        -Failure $_.Exception.Message
    exit 2
}
