[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Recover')]
    [string]$Mode = 'Inspect'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
$workerProbePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\windows\probe-mission-orchestrator-worker-watchdog.ps1'))
$wscriptPath = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot 'System32\wscript.exe'))

$taskSpecs = @(
    [pscustomobject]@{ Id = 'watchdog'; Name = 'Stephanos Mission Orchestrator Worker Watchdog'; LauncherId = 'worker-watchdog' },
    [pscustomobject]@{ Id = 'mailbox'; Name = 'Stephanos Battle Bridge GitHub Command Mailbox'; LauncherId = 'github-command-mailbox' },
    [pscustomobject]@{ Id = 'backend'; Name = 'Stephanos Battle Bridge Backend'; LauncherId = 'backend' },
    [pscustomobject]@{ Id = 'openclawGateway'; Name = 'OpenClaw Gateway'; LauncherId = 'openclaw-gateway' }
)

function Test-TaskAction {
    param([object]$Task, [string]$LauncherId)
    try {
        if (-not $Task -or [string]$Task.TaskPath -ne '\' -or $Task.Actions.Count -ne 1) { return $false }
        $action = $Task.Actions[0]
        $execute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$action.Execute))
        if ($LauncherId -eq 'openclaw-gateway') {
            $expectedGateway = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.openclaw\gateway.cmd'))
            if ([string]::Equals($execute, $expectedGateway, [System.StringComparison]::OrdinalIgnoreCase)
                -and [string]::IsNullOrWhiteSpace([string]$action.Arguments)) { return $true }
        }
        if (-not [string]::Equals($execute, $wscriptPath, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $arguments = ([string]$action.Arguments).Trim()
        $expectedArguments = "//B //NoLogo `"$launcherPath`" $LauncherId"
        return [string]::Equals($arguments, $expectedArguments, [System.StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Get-TaskHealth {
    param([object]$Spec)
    $task = Get-ScheduledTask -TaskName $Spec.Name -ErrorAction SilentlyContinue
    $info = if ($task) { Get-ScheduledTaskInfo -TaskName $Spec.Name -ErrorAction SilentlyContinue } else { $null }
    $actionCanonical = Test-TaskAction -Task $task -LauncherId $Spec.LauncherId
    [pscustomobject]@{
        id = $Spec.Id
        taskName = $Spec.Name
        present = [bool]$task
        state = if ($task) { [string]$task.State } else { 'Missing' }
        actionCanonical = [bool]$actionCanonical
        lastTaskResult = if ($info) { [int64]$info.LastTaskResult } else { -1 }
        lastRunTimeUtc = if ($info -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { '' }
    }
}

function Test-HttpHealth {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Get-OpenClawIdentityHealth {
    try {
        $healthResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/health' -UseBasicParsing -TimeoutSec 4
        $health = $healthResponse.Content | ConvertFrom-Json
        $healthStateValue = if ($health.status) { $health.status } else { $health.state }
        $healthState = ([string]$healthStateValue).ToLowerInvariant()
        $healthReady = $healthResponse.StatusCode -eq 200 -and ($health.ok -eq $true -or @('ok','live','ready') -contains $healthState)
        if (-not $healthReady) { throw 'OPENCLAW_HEALTH_NOT_READY' }
        $identityResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/identity' -UseBasicParsing -TimeoutSec 4
        $identity = $identityResponse.Content | ConvertFrom-Json
        $identityState = ([string]$identity.status).ToLowerInvariant()
        $identityReady = $identityResponse.StatusCode -eq 200 `
            -and [string]$identity.product -eq 'OpenClaw' `
            -and -not [string]::IsNullOrWhiteSpace([string]$identity.runtimeId) `
            -and @('ok','live','ready') -contains $identityState
        [pscustomobject]@{ healthy = [bool]$identityReady; product = [string]$identity.product; runtimeId = [string]$identity.runtimeId; status = [string]$identity.status; healthStatus = $healthState; identityVerified = [bool]$identityReady }
    } catch {
        [pscustomobject]@{ healthy = $false; product = ''; runtimeId = ''; status = ''; healthStatus = ''; identityVerified = $false; blocker = 'OPENCLAW_IDENTITY_HEALTH_NOT_PROVEN' }
    }
}

function Get-WorkerHealth {
    $raw = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $workerProbePath -Mode Inspect
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ healthy = $false; blocker = 'WORKER_PROBE_FAILED' } }
    $probe = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
    $heartbeatMs = 0
    if ($probe.heartbeat.timestampUtc) { $heartbeatMs = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$probe.heartbeat.timestampUtc)).TotalMilliseconds }
    $healthy = $probe.scheduledTask.actionMatchesCanonicalWorker -eq $true `
        -and $probe.process.running -eq $true `
        -and $probe.process.commandLineMatchesCanonicalWorker -eq $true `
        -and $heartbeatMs -ge 0 -and $heartbeatMs -le 120000 `
        -and [string]$probe.heartbeat.branch -eq 'main'
    [pscustomobject]@{ healthy = [bool]$healthy; heartbeatAgeMs = [int64]$heartbeatMs; pid = [int]$probe.process.pid }
}

$before = @{}
foreach ($spec in $taskSpecs) { $before[$spec.Id] = Get-TaskHealth -Spec $spec }

$startedTasks = @()
if ($Mode -eq 'Recover') {
    foreach ($spec in $taskSpecs) {
        $observed = $before[$spec.Id]
        if (-not $observed.present) { continue }
        if (-not $observed.actionCanonical) { continue }
        if ([string]$observed.state -ne 'Running') {
            Start-ScheduledTask -TaskName $spec.Name
            $startedTasks += $spec.Id
        }
    }
}

$after = @{}
foreach ($spec in $taskSpecs) { $after[$spec.Id] = Get-TaskHealth -Spec $spec }
$worker = Get-WorkerHealth
$openClawHealth = Get-OpenClawIdentityHealth
$mailboxTask = $after.mailbox
$mailboxLastRunMs = if ($mailboxTask.lastRunTimeUtc) { ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($mailboxTask.lastRunTimeUtc)).TotalMilliseconds } else { [double]::PositiveInfinity }
$mailboxHealthy = $mailboxTask.present -and $mailboxTask.actionCanonical -and ($mailboxTask.state -eq 'Running' -or $mailboxLastRunMs -le 420000)
$sourceHeadRaw = & git.exe -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1
$branchRaw = & git.exe -C $repoRoot branch --show-current 2>$null | Select-Object -First 1
$sourceHead = if ($sourceHeadRaw) { ([string]$sourceHeadRaw).Trim().ToLowerInvariant() } else { '' }
$branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-probe.v1'
    mode = $Mode
    sourceHead = $sourceHead
    branch = $branch
    worker = $worker
    mailbox = [pscustomobject]@{ healthy = [bool]$mailboxHealthy; state = $mailboxTask.state; lastRunAgeMs = if ([double]::IsInfinity($mailboxLastRunMs)) { -1 } else { [int64]$mailboxLastRunMs } }
    backend = [pscustomobject]@{ healthy = [bool](Test-HttpHealth -Url 'http://127.0.0.1:8787/api/health'); task = $after.backend }
    openclawGateway = [pscustomobject]@{ healthy = [bool]$openClawHealth.healthy; identityVerified = [bool]$openClawHealth.identityVerified; product = $openClawHealth.product; runtimeId = $openClawHealth.runtimeId; status = $openClawHealth.status; healthStatus = $openClawHealth.healthStatus; task = $after.openclawGateway }
    watchdog = $after.watchdog
    startedTasks = @($startedTasks)
    maximumTaskStarts = 4
    arbitraryTaskNameAllowed = $false
    arbitraryPowerShellAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 8
