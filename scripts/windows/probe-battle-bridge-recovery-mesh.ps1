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
$backendFreshnessProbePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\battle-bridge-backend-freshness-probe.mjs'))
$backendRuntimeReceiptPath = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot 'status\stephanos-backend-runtime.json'))
$wscriptPath = 'C:\Windows\System32\wscript.exe'
$canonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$runtimeMemoryPath = 'stephanos-server/data/memory/durable-memory.json'
$runtimeUiDistPrefix = 'apps/stephanos/dist/'

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
            if ([string]::Equals($execute, $expectedGateway, [System.StringComparison]::OrdinalIgnoreCase) `
                -and [string]::IsNullOrWhiteSpace([string]$action.Arguments)) { return $true }
        }
        if (-not [string]::Equals($execute, $wscriptPath, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $arguments = ([string]$action.Arguments).Trim()
        $expectedArguments = "//B //NoLogo `"$launcherPath`" $LauncherId"
        return [string]::Equals($arguments, $expectedArguments, [System.StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Test-TaskAuthority {
    param([object]$Task)
    try {
        if (-not $Task -or -not $Task.Principal -or -not $Task.Settings) { return $false }
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        return [string]::Equals([string]$Task.Principal.UserId, $currentUser, [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]$Task.Principal.LogonType -eq 'Interactive' `
            -and [string]$Task.Principal.RunLevel -eq 'Limited' `
            -and [string]$Task.Settings.MultipleInstances -eq 'IgnoreNew' `
            -and $Task.Settings.Enabled -eq $true
    } catch { return $false }
}

function Get-TaskHealth {
    param([object]$Spec)
    $task = Get-ScheduledTask -TaskName $Spec.Name -ErrorAction SilentlyContinue
    $info = if ($task) { Get-ScheduledTaskInfo -TaskName $Spec.Name -ErrorAction SilentlyContinue } else { $null }
    $actionCanonical = Test-TaskAction -Task $task -LauncherId $Spec.LauncherId
    $authorityCanonical = Test-TaskAuthority -Task $task
    [pscustomobject]@{
        id = $Spec.Id
        taskName = $Spec.Name
        present = [bool]$task
        state = if ($task) { [string]$task.State } else { 'Missing' }
        actionCanonical = [bool]$actionCanonical
        authorityCanonical = [bool]$authorityCanonical
        lastTaskResult = if ($info) { [int64]$info.LastTaskResult } else { -1 }
        lastRunTimeUtc = if ($info -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { '' }
    }
}

function Test-CanonicalBackendCommandLine {
    param([string]$CommandLine, [string]$ExpectedSourceHead)
    $commandLine = (([string]$CommandLine -replace '\s+', ' ').Trim())
    $canonicalBootstrapEval = "import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)"
    $expectedCommands = @(
        "`"$canonicalNode`" --input-type=module --eval `"$canonicalBootstrapEval`"",
        "$canonicalNode --input-type=module --eval `"$canonicalBootstrapEval`""
    )
    foreach ($expectedCommand in $expectedCommands) {
        if ([string]::Equals($commandLine, $expectedCommand, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Test-RuntimeUiDistStatus {
    param([string]$Status)
    return $Status -eq ' M' -or $Status -eq ' D'
}

function Convert-ProcessCreationDateToUtcText {
    param([object]$CreationDate)
    if ($CreationDate -is [DateTime]) {
        return ([DateTime]$CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    if ($CreationDate -is [DateTimeOffset]) {
        return ([DateTimeOffset]$CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    $creationText = [string]$CreationDate
    if ([string]::IsNullOrWhiteSpace($creationText)) { throw 'BACKEND_LISTENER_CREATION_TIME_MISSING' }
    return [System.Management.ManagementDateTimeConverter]::ToDateTime($creationText).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Get-BackendListenerIdentity {
    param([string]$ExpectedSourceHead)
    try {
        $listeners = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop)
        $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($processIds.Count -ne 1) { throw 'BACKEND_LISTENER_OWNERSHIP_AMBIGUOUS' }
        $processId = [int]$processIds[0]
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
        if (-not $process) { throw 'BACKEND_LISTENER_PROCESS_MISSING' }
        $executable = [System.IO.Path]::GetFullPath([string]$process.ExecutablePath)
        if (-not [string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'BACKEND_LISTENER_EXECUTABLE_FOREIGN' }
        if (-not (Test-CanonicalBackendCommandLine -CommandLine ([string]$process.CommandLine) -ExpectedSourceHead $ExpectedSourceHead)) { throw 'BACKEND_LISTENER_COMMAND_FOREIGN' }
        $creationUtc = Convert-ProcessCreationDateToUtcText -CreationDate $process.CreationDate
        return [pscustomobject]@{ healthy = $true; pid = $processId; creationTimeUtc = $creationUtc; blocker = '' }
    } catch {
        $reason = [string]$_.Exception.Message
        if ($reason -notin @('BACKEND_LISTENER_OWNERSHIP_AMBIGUOUS','BACKEND_LISTENER_PROCESS_MISSING','BACKEND_LISTENER_EXECUTABLE_FOREIGN','BACKEND_LISTENER_COMMAND_FOREIGN')) { $reason = 'BACKEND_LISTENER_OWNERSHIP_UNVERIFIABLE' }
        return [pscustomobject]@{ healthy = $false; pid = 0; creationTimeUtc = ''; blocker = $reason }
    }
}

function Get-BackendFreshnessHealth {
    param([string]$ExpectedSourceHead, [object]$BackendTask)
    try {
        if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) { throw 'RECOVERY_CANONICAL_NODE_EXECUTABLE_MISSING' }
        if (-not (Test-Path -LiteralPath $backendFreshnessProbePath -PathType Leaf)) { throw 'RECOVERY_BACKEND_FRESHNESS_PROBE_MISSING' }
        if (-not $BackendTask.present -or -not $BackendTask.actionCanonical -or -not $BackendTask.authorityCanonical) { throw 'BACKEND_TASK_AUTHORITY_INVALID' }
        $listenerBefore = Get-BackendListenerIdentity -ExpectedSourceHead $ExpectedSourceHead
        if (-not $listenerBefore.healthy) { throw $listenerBefore.blocker }
        $raw = & $canonicalNode $backendFreshnessProbePath --expected-source-head $ExpectedSourceHead
        if ($LASTEXITCODE -ne 0) { throw 'RECOVERY_BACKEND_FRESHNESS_PROBE_FAILED' }
        $proof = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
        $requiredRoutes = @($proof.requiredRoutes)
        $routeProofs = @($proof.routeProofs)
        $routesCanonical = $requiredRoutes.Count -eq 2 `
            -and $requiredRoutes[0] -eq '/api/health' `
            -and $requiredRoutes[1] -eq '/api/mission-operations' `
            -and $routeProofs.Count -eq 2 `
            -and @($routeProofs | Where-Object { $_.route -eq '/api/health' -and $_.ok -eq $true }).Count -eq 1 `
            -and @($routeProofs | Where-Object { $_.route -eq '/api/mission-operations' -and $_.ok -eq $true }).Count -eq 1
        if (-not (Test-Path -LiteralPath $backendRuntimeReceiptPath -PathType Leaf)) { throw 'BACKEND_RUNTIME_RECEIPT_MISSING' }
        $receipt = Get-Content -LiteralPath $backendRuntimeReceiptPath -Raw | ConvertFrom-Json
        $listenerAfter = Get-BackendListenerIdentity -ExpectedSourceHead $ExpectedSourceHead
        if (-not $listenerAfter.healthy) { throw $listenerAfter.blocker }
        if ($listenerBefore.pid -ne $listenerAfter.pid -or $listenerBefore.creationTimeUtc -ne $listenerAfter.creationTimeUtc) { throw 'BACKEND_LISTENER_IDENTITY_CHANGED' }
        $receiptPropertyNames = @($receipt.PSObject.Properties.Name)
        $receiptSourceClean = if ($receiptPropertyNames -contains 'sourceWorktreeClean') { [bool]$receipt.sourceWorktreeClean } else { [bool]$receipt.trackedWorktreeClean }
        $receiptTrackedTruth = [bool]$receipt.trackedWorktreeClean -or (($receiptPropertyNames -contains 'runtimeMemoryDirtTolerated') -and [bool]$receipt.runtimeMemoryDirtTolerated)
        $receiptCanonical = [string]$receipt.schemaVersion -eq 'stephanos.backend-runtime.v1' `
            -and [string]$receipt.taskName -eq 'Stephanos Battle Bridge Backend' `
            -and [string]$receipt.branch -eq 'main' `
            -and ([string]$receipt.headSha).ToLowerInvariant() -eq $ExpectedSourceHead `
            -and [int]$receipt.pid -eq $listenerAfter.pid `
            -and [string]$receipt.processStartTimeUtc -eq $listenerAfter.creationTimeUtc `
            -and $receipt.exactHeadProofOk -eq $true `
            -and $receiptSourceClean `
            -and $receiptTrackedTruth `
            -and $receipt.arbitraryShellAllowed -eq $false `
            -and $receipt.sourceMutationAllowed -eq $false
        if (-not $receiptCanonical) { throw 'BACKEND_TASK_PROCESS_OWNERSHIP_STALE_OR_INVALID' }
        $taskRunUtc = if ($BackendTask.lastRunTimeUtc) { [DateTimeOffset]::Parse([string]$BackendTask.lastRunTimeUtc) } else { [DateTimeOffset]::MinValue }
        $processStartUtc = [DateTimeOffset]::Parse([string]$listenerAfter.creationTimeUtc)
        if ([Math]::Abs(($taskRunUtc - $processStartUtc).TotalMinutes) -gt 5) { throw 'BACKEND_TASK_PROCESS_LINEAGE_NOT_PROVEN' }
        $healthy = [string]$proof.schemaVersion -eq 'stephanos.backend-freshness-supervisor.v1' `
            -and [string]$proof.finalVerdict -eq 'BACKEND_CURRENT' `
            -and $proof.backendCurrent -eq $true `
            -and $routesCanonical
        return [pscustomobject]@{ healthy = [bool]$healthy; proof = $proof; listener = $listenerAfter; blocker = if ($healthy) { '' } else { 'BACKEND_CANONICAL_FRESHNESS_NOT_CURRENT' } }
    } catch {
        return [pscustomobject]@{ healthy = $false; proof = $null; listener = $null; blocker = if ($_.Exception.Message) { [string]$_.Exception.Message } else { 'BACKEND_CANONICAL_FRESHNESS_NOT_PROVEN' } }
    }
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
    $raw = & $canonicalPowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $workerProbePath -Mode Inspect
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

$sourceControlExecutable = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path -LiteralPath $sourceControlExecutable -PathType Leaf)) { throw 'RECOVERY_CANONICAL_GIT_EXECUTABLE_MISSING' }
function Get-CanonicalTrackedWorktreeAssessment {
    param([string]$GitExecutable, [string]$RepositoryRoot)
    $trackedStatus = @(& $GitExecutable -C $RepositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'RECOVERY_CANONICAL_TRACKED_WORKTREE_INSPECTION_FAILED' }
    $runtimeMemoryDirty = $false
    $runtimeUiDistDirty = $false
    $sourceDirt = @()
    foreach ($raw in @($trackedStatus)) {
        $line = [string]$raw
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line.Length -lt 4) {
            $sourceDirt += $line
            continue
        }
        $status = $line.Substring(0, 2)
        $pathSegment = $line.Substring(3).Trim()
        if ($pathSegment.Contains(' -> ')) {
            $sourceDirt += $line
            continue
        }
        $path = $pathSegment.Trim('"').Replace('\', '/')
        if ($status -eq ' M' -and $path -eq $runtimeMemoryPath) {
            $runtimeMemoryDirty = $true
            continue
        }
        if ((Test-RuntimeUiDistStatus -Status $status) -and $path.StartsWith($runtimeUiDistPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $runtimeUiDistDirty = $true
            continue
        }
        $sourceDirt += $line
    }
    return [pscustomobject]@{
        RuntimeMemoryDirty = [bool]$runtimeMemoryDirty
        RuntimeUiDistDirty = [bool]$runtimeUiDistDirty
        SourceDirt = @($sourceDirt)
    }
}
function Assert-CanonicalSourceWorktreeClean {
    param([string]$GitExecutable, [string]$RepositoryRoot)
    $assessment = Get-CanonicalTrackedWorktreeAssessment -GitExecutable $GitExecutable -RepositoryRoot $RepositoryRoot
    if ($assessment.SourceDirt.Count -ne 0) { throw 'RECOVERY_CANONICAL_TRACKED_SOURCE_WORKTREE_DIRTY' }
    return $assessment
}
function Assert-CanonicalTrackedWorktreeClean {
    param([string]$GitExecutable, [string]$RepositoryRoot)
    return Assert-CanonicalSourceWorktreeClean -GitExecutable $GitExecutable -RepositoryRoot $RepositoryRoot
}
$sourceHeadRaw = & $sourceControlExecutable -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1
$branchRaw = & $sourceControlExecutable -C $repoRoot branch --show-current 2>$null | Select-Object -First 1
$sourceHead = if ($sourceHeadRaw) { ([string]$sourceHeadRaw).Trim().ToLowerInvariant() } else { '' }
$branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $branch -ne 'main') { throw 'RECOVERY_CANONICAL_SOURCE_IDENTITY_INVALID' }
$beforeWorktree = Assert-CanonicalTrackedWorktreeClean -GitExecutable $sourceControlExecutable -RepositoryRoot $repoRoot

$before = @{}
foreach ($spec in $taskSpecs) { $before[$spec.Id] = Get-TaskHealth -Spec $spec }
$backendBeforeRecovery = if ($Mode -eq 'Recover') {
    Get-BackendFreshnessHealth -ExpectedSourceHead $sourceHead -BackendTask $before.backend
} else { $null }

$startedTasks = @()
$backendRestartSkippedAsCurrent = $false
if ($Mode -eq 'Recover') {
    foreach ($spec in $taskSpecs) {
        $observed = $before[$spec.Id]
        if (-not $observed.present) { continue }
        if (-not $observed.actionCanonical) { continue }
        if (-not $observed.authorityCanonical) { continue }
        if ($spec.Id -eq 'backend' -and $backendBeforeRecovery.healthy) {
            $backendRestartSkippedAsCurrent = $true
            continue
        }
        if ([string]$observed.state -ne 'Running') {
            Start-ScheduledTask -TaskName $spec.Name
            $startedTasks += $spec.Id
        }
    }
}

$after = @{}
foreach ($spec in $taskSpecs) { $after[$spec.Id] = Get-TaskHealth -Spec $spec }
$worker = Get-WorkerHealth
$worker.healthy = [bool]($worker.healthy -and $after.watchdog.actionCanonical -and $after.watchdog.authorityCanonical)
$openClawHealth = Get-OpenClawIdentityHealth
$backendFreshness = Get-BackendFreshnessHealth -ExpectedSourceHead $sourceHead -BackendTask $after.backend
$afterWorktree = Assert-CanonicalSourceWorktreeClean -GitExecutable $sourceControlExecutable -RepositoryRoot $repoRoot
$mailboxTask = $after.mailbox
$mailboxLastRunMs = if ($mailboxTask.lastRunTimeUtc) { ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($mailboxTask.lastRunTimeUtc)).TotalMilliseconds } else { [double]::PositiveInfinity }
$mailboxHealthy = $mailboxTask.present `
    -and $mailboxTask.actionCanonical `
    -and $mailboxTask.authorityCanonical `
    -and $mailboxTask.lastTaskResult -eq 0 `
    -and ($mailboxTask.state -eq 'Running' -or $mailboxLastRunMs -le 420000)

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-probe.v1'
    mode = $Mode
    sourceHead = $sourceHead
    branch = $branch
    trackedWorktreeClean = -not [bool]($afterWorktree.RuntimeMemoryDirty -or $afterWorktree.RuntimeUiDistDirty)
    sourceWorktreeClean = $true
    runtimeMemoryDirtTolerated = [bool]$afterWorktree.RuntimeMemoryDirty
    runtimeMemoryDirtPresentBefore = [bool]$beforeWorktree.RuntimeMemoryDirty
    runtimeUiDistDirtTolerated = [bool]$afterWorktree.RuntimeUiDistDirty
    runtimeUiDistDirtPresentBefore = [bool]$beforeWorktree.RuntimeUiDistDirty
    backendRestartSkippedAsCurrent = [bool]$backendRestartSkippedAsCurrent
    worker = $worker
    mailbox = [pscustomobject]@{ healthy = [bool]$mailboxHealthy; state = $mailboxTask.state; lastTaskResult = $mailboxTask.lastTaskResult; lastRunAgeMs = if ([double]::IsInfinity($mailboxLastRunMs)) { -1 } else { [int64]$mailboxLastRunMs }; task = $mailboxTask }
    backend = [pscustomobject]@{ healthy = [bool]($backendFreshness.healthy -and $after.backend.actionCanonical -and $after.backend.authorityCanonical); freshnessProof = $backendFreshness.proof; listener = $backendFreshness.listener; blocker = $backendFreshness.blocker; task = $after.backend }
    openclawGateway = [pscustomobject]@{ healthy = [bool]($openClawHealth.healthy -and $after.openclawGateway.actionCanonical -and $after.openclawGateway.authorityCanonical); identityVerified = [bool]$openClawHealth.identityVerified; product = $openClawHealth.product; runtimeId = $openClawHealth.runtimeId; status = $openClawHealth.status; healthStatus = $openClawHealth.healthStatus; task = $after.openclawGateway }
    watchdog = $after.watchdog
    startedTasks = @($startedTasks)
    maximumTaskStarts = 4
    arbitraryTaskNameAllowed = $false
    arbitraryPowerShellAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 8
