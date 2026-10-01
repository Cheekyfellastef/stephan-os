[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH', 'RECOVER_REMOTE_ACCESS_STACK')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$schemaVersion = 'stephanos.openclaw-battle-bridge-recovery-executor.v1'
$provider = 'openclaw-standalone'
$wscriptExe = 'C:\Windows\System32\wscript.exe'
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$canonicalLauncher = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os\scripts\windows\run-stephanos-scheduled-task-windowless.vbs'
$mailboxTask = 'Stephanos Battle Bridge GitHub Command Mailbox'
$recoveryMeshTask = 'Stephanos Battle Bridge Recovery Mesh'
$githubSyncTask = 'Stephanos Battle Bridge GitHub Sync'
$commanderWatchdogTask = 'Stephanos Commander Watchdog'
$workerWatchdogTask = 'Stephanos Mission Orchestrator Worker Watchdog'
$outboundBeaconTask = 'Stephanos Battle Bridge Outbound Health Beacon'
$backendTask = 'Stephanos Battle Bridge Backend'
$openClawGatewayTask = 'OpenClaw Gateway'
$openClawGatewayPath = Join-Path $env:USERPROFILE '.openclaw\gateway.cmd'


function Resolve-IdentitySid([string]$Identity) {
    if ([string]::IsNullOrWhiteSpace($Identity)) { return '' }
    try {
        if ($Identity -match '^S-\d-\d+(?:-\d+)+$') {
            return ([System.Security.Principal.SecurityIdentifier]::new($Identity)).Value
        }
        $account = [System.Security.Principal.NTAccount]::new($Identity)
        return $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        return ''
    }
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUserSid = if ($null -ne $currentIdentity.User) { [string]$currentIdentity.User.Value } else { '' }
if ($currentUserSid -notmatch '^S-\d-\d+(?:-\d+)+$') { throw 'Current Windows user SID is invalid.' }

function Get-FixedTaskSpec([string]$TaskName) {
    if ($TaskName -eq $mailboxTask) {
        return [pscustomobject]@{ taskName = $mailboxTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" github-command-mailbox' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $recoveryMeshTask) {
        return [pscustomobject]@{ taskName = $recoveryMeshTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" recovery-mesh' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $githubSyncTask) {
        return [pscustomobject]@{ taskName = $githubSyncTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" github-sync' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $commanderWatchdogTask) {
        return [pscustomobject]@{ taskName = $commanderWatchdogTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" desktop-commander-watchdog' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $workerWatchdogTask) {
        return [pscustomobject]@{ taskName = $workerWatchdogTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" worker-watchdog' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $outboundBeaconTask) {
        return [pscustomobject]@{ taskName = $outboundBeaconTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" outbound-health-beacon' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $backendTask) {
        return [pscustomobject]@{ taskName = $backendTask; expectedExecute = $wscriptExe; expectedArguments = ('//B //NoLogo "{0}" backend' -f $canonicalLauncher) }
    }
    if ($TaskName -eq $openClawGatewayTask) {
        return [pscustomobject]@{ taskName = $openClawGatewayTask; expectedExecute = $openClawGatewayPath; expectedArguments = '' }
    }
    throw 'Only canonical fixed Battle Bridge tasks are supported.'
}

function Get-TaskSnapshot([string]$TaskName) {
    $spec = Get-FixedTaskSpec -TaskName $TaskName
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        return [pscustomobject]@{
            taskName = $TaskName
            present = $false
            state = 'MISSING'
            actionIdentityValid = $false
            authorityIdentityValid = $false
            actionCount = 0
            lastTaskResult = $null
            lastRunTimeUtc = $null
        }
    }

    $actions = @($task.Actions)
    $identityValid = $false
    if ($actions.Count -eq 1) {
        $execute = [string]$actions[0].Execute
        $arguments = [string]$actions[0].Arguments
        $identityValid = $execute.Equals([string]$spec.expectedExecute, [System.StringComparison]::OrdinalIgnoreCase) -and ($arguments -ceq [string]$spec.expectedArguments)
    }

    $taskPrincipalSid = Resolve-IdentitySid ([string]$task.Principal.UserId)
    $authorityIdentityValid = [bool](
        [string]$task.TaskPath -eq '\' -and
        $taskPrincipalSid -eq $currentUserSid -and
        [string]$task.Principal.LogonType -eq 'Interactive' -and
        [string]$task.Principal.RunLevel -eq 'Limited' -and
        [string]$task.Settings.MultipleInstances -eq 'IgnoreNew' -and
        $task.Settings.Enabled -eq $true
    )

    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $lastRun = $null
    $lastResult = $null
    if ($null -ne $info) {
        $lastResult = [int64]$info.LastTaskResult
        if ($info.LastRunTime -and $info.LastRunTime -gt [datetime]::MinValue) {
            $lastRun = $info.LastRunTime.ToUniversalTime().ToString('o')
        }
    }

    return [pscustomobject]@{
        taskName = $TaskName
        present = $true
        state = [string]$task.State
        actionIdentityValid = [bool]$identityValid
        authorityIdentityValid = [bool]$authorityIdentityValid
        actionCount = $actions.Count
        lastTaskResult = $lastResult
        lastRunTimeUtc = $lastRun
    }
}

function Test-LocalTcpPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Invoke-FixedWake([string]$TaskName) {
    $before = Get-TaskSnapshot -TaskName $TaskName
    if (-not $before.present) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'CANONICAL_TASK_MISSING'
            before = $before
            after = $before
            startRequested = $false
        }
    }
    if (-not $before.actionIdentityValid) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'CANONICAL_TASK_ACTION_IDENTITY_INVALID'
            before = $before
            after = $before
            startRequested = $false
        }
    }
    if (-not $before.authorityIdentityValid) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'CANONICAL_TASK_AUTHORITY_IDENTITY_INVALID'
            before = $before
            after = $before
            startRequested = $false
        }
    }
    if ([string]$before.state -ceq 'Running') {
        return [pscustomobject]@{
            ok = $true
            blocker = ''
            before = $before
            after = $before
            startRequested = $false
        }
    }

    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Milliseconds 500
    $after = Get-TaskSnapshot -TaskName $TaskName
    return [pscustomobject]@{
        ok = $true
        blocker = ''
        before = $before
        after = $after
        startRequested = $true
    }
}

function Invoke-RemoteAccessStackRecovery {
    # GitHub Sync is intentionally observation-only here because its fixed
    # executor may fast-forward canonical main. This recovery action carries
    # zero source-mutation authority and must never start that task.
    $taskNames = @(
        $recoveryMeshTask,
        $mailboxTask,
        $commanderWatchdogTask,
        $workerWatchdogTask,
        $outboundBeaconTask,
        $backendTask,
        $openClawGatewayTask
    )
    $results = [ordered]@{}
    foreach ($taskName in $taskNames) {
        $key = switch ($taskName) {
            $githubSyncTask { 'githubSync' }
            $recoveryMeshTask { 'recoveryMesh' }
            $mailboxTask { 'mailbox' }
            $commanderWatchdogTask { 'commanderWatchdog' }
            $workerWatchdogTask { 'workerWatchdog' }
            $outboundBeaconTask { 'outboundHealthBeacon' }
            $backendTask { 'backend' }
            $openClawGatewayTask { 'openClawGateway' }
        }
        try {
            $results[$key] = Invoke-FixedWake -TaskName $taskName
        } catch {
            $results[$key] = [pscustomobject]@{
                ok = $false
                blocker = 'CANONICAL_TASK_WAKE_FAILED'
                before = Get-TaskSnapshot -TaskName $taskName
                after = Get-TaskSnapshot -TaskName $taskName
                startRequested = $false
            }
        }
    }

    $criticalHealthy = [bool]$results.recoveryMesh.ok
    $anyStarted = @($results.Values | Where-Object { $_.startRequested }).Count -gt 0
    return [pscustomobject]@{
        ok = $criticalHealthy
        blocker = if ($criticalHealthy) { '' } else { 'REMOTE_ACCESS_CRITICAL_TASK_NOT_RECOVERABLE' }
        components = [pscustomobject]$results
        githubSyncObservation = Get-TaskSnapshot -TaskName $githubSyncTask
        githubSyncStartAllowed = $false
        startRequested = [bool]$anyStarted
        criticalTasks = @('recoveryMesh')
        bestEffortTasks = @('mailbox','commanderWatchdog','workerWatchdog','outboundHealthBeacon','backend','openClawGateway')
        remoteChatTransportReauthenticationClaimed = $false
        physicalPowerRecoveryClaimed = $false
    }
}

$mailboxBefore = Get-TaskSnapshot -TaskName $mailboxTask
$meshBefore = Get-TaskSnapshot -TaskName $recoveryMeshTask
$remoteAccessBefore = [pscustomobject]@{
    githubSync = Get-TaskSnapshot -TaskName $githubSyncTask
    commanderWatchdog = Get-TaskSnapshot -TaskName $commanderWatchdogTask
    workerWatchdog = Get-TaskSnapshot -TaskName $workerWatchdogTask
    outboundHealthBeacon = Get-TaskSnapshot -TaskName $outboundBeaconTask
    backend = Get-TaskSnapshot -TaskName $backendTask
    openClawGateway = Get-TaskSnapshot -TaskName $openClawGatewayTask
}
$wake = $null

switch ($Action) {
    'WAKE_CANONICAL_MAILBOX' {
        $wake = Invoke-FixedWake -TaskName $mailboxTask
    }
    'WAKE_CANONICAL_RECOVERY_MESH' {
        $wake = Invoke-FixedWake -TaskName $recoveryMeshTask
    }
    'RECOVER_REMOTE_ACCESS_STACK' {
        $wake = Invoke-RemoteAccessStackRecovery
    }
    'PROBE_BATTLE_BRIDGE' {
        $wake = [pscustomobject]@{ ok = $true; blocker = ''; before = $null; after = $null; startRequested = $false }
    }
}

$mailboxAfter = Get-TaskSnapshot -TaskName $mailboxTask
$meshAfter = Get-TaskSnapshot -TaskName $recoveryMeshTask
$remoteAccessAfter = [pscustomobject]@{
    githubSync = Get-TaskSnapshot -TaskName $githubSyncTask
    commanderWatchdog = Get-TaskSnapshot -TaskName $commanderWatchdogTask
    workerWatchdog = Get-TaskSnapshot -TaskName $workerWatchdogTask
    outboundHealthBeacon = Get-TaskSnapshot -TaskName $outboundBeaconTask
    backend = Get-TaskSnapshot -TaskName $backendTask
    openClawGateway = Get-TaskSnapshot -TaskName $openClawGatewayTask
}
$ok = [bool]$wake.ok
$verdict = if (-not $ok) {
    'OPENCLAW_BATTLE_BRIDGE_RECOVERY_BLOCKED'
} elseif ($Action -eq 'PROBE_BATTLE_BRIDGE') {
    'OPENCLAW_BATTLE_BRIDGE_PROBE_COMPLETE'
} elseif ($Action -eq 'RECOVER_REMOTE_ACCESS_STACK') {
    'BATTLE_BRIDGE_REMOTE_ACCESS_RECOVERY_DISPATCHED'
} else {
    'OPENCLAW_BATTLE_BRIDGE_WAKE_DISPATCHED'
}

[pscustomobject]@{
    schemaVersion = $schemaVersion
    provider = $provider
    action = $Action
    ok = $ok
    blocker = [string]$wake.blocker
    checkoutIndependentExecutor = $true
    openClawGatewayRequired = $false
    canonicalLauncherPath = $canonicalLauncher
    canonicalLauncherPresent = [bool](Test-Path -LiteralPath $canonicalLauncher -PathType Leaf)
    mailbox = [pscustomobject]@{ before = $mailboxBefore; after = $mailboxAfter }
    recoveryMesh = [pscustomobject]@{ before = $meshBefore; after = $meshAfter }
    remoteAccessStack = [pscustomobject]@{
        before = $remoteAccessBefore
        after = $remoteAccessAfter
        recovery = if ($Action -eq 'RECOVER_REMOTE_ACCESS_STACK') { $wake } else { $null }
    }
    startRequested = [bool]$wake.startRequested
    ports = [pscustomobject]@{
        ui4173 = [bool](Test-LocalTcpPort -Port 4173)
        backend8787 = [bool](Test-LocalTcpPort -Port 8787)
        openClaw18789 = [bool](Test-LocalTcpPort -Port 18789)
    }
    freshPostActionProofRequired = $true
    arbitraryShellAllowed = $false
    callerSelectedExecutableAllowed = $false
    callerSelectedPathAllowed = $false
    callerSelectedUrlAllowed = $false
    callerSelectedTaskAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    deploymentAllowed = $false
    pcRestartAllowed = $false
    remoteChatTransportReauthenticationClaimed = $false
    physicalPowerRecoveryClaimed = $false
    finalVerdict = $verdict
} | ConvertTo-Json -Depth 8

if (-not $ok) { exit 1 }
