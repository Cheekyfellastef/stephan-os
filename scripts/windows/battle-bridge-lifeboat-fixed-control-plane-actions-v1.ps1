[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')]
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

function Get-FixedTaskSpec([string]$TaskName) {
    if ($TaskName -eq $mailboxTask) {
        return [pscustomobject]@{
            taskName = $mailboxTask
            expectedArguments = "//B //NoLogo `"$canonicalLauncher`" github-command-mailbox"
        }
    }
    if ($TaskName -eq $recoveryMeshTask) {
        return [pscustomobject]@{
            taskName = $recoveryMeshTask
            expectedArguments = "//B //NoLogo `"$canonicalLauncher`" recovery-mesh"
        }
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
        $identityValid = $execute.Equals($wscriptExe, [System.StringComparison]::OrdinalIgnoreCase) -and ($arguments -ceq $spec.expectedArguments)
    }

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

    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Milliseconds 750
    $after = Get-TaskSnapshot -TaskName $TaskName
    return [pscustomobject]@{
        ok = $true
        blocker = ''
        before = $before
        after = $after
        startRequested = $true
    }
}

$mailboxBefore = Get-TaskSnapshot -TaskName $mailboxTask
$meshBefore = Get-TaskSnapshot -TaskName $recoveryMeshTask
$wake = $null

switch ($Action) {
    'WAKE_CANONICAL_MAILBOX' {
        $wake = Invoke-FixedWake -TaskName $mailboxTask
    }
    'WAKE_CANONICAL_RECOVERY_MESH' {
        $wake = Invoke-FixedWake -TaskName $recoveryMeshTask
    }
    'PROBE_BATTLE_BRIDGE' {
        $wake = [pscustomobject]@{ ok = $true; blocker = ''; before = $null; after = $null; startRequested = $false }
    }
}

$mailboxAfter = Get-TaskSnapshot -TaskName $mailboxTask
$meshAfter = Get-TaskSnapshot -TaskName $recoveryMeshTask
$ok = [bool]$wake.ok
$verdict = if (-not $ok) {
    'OPENCLAW_BATTLE_BRIDGE_RECOVERY_BLOCKED'
} elseif ($Action -eq 'PROBE_BATTLE_BRIDGE') {
    'OPENCLAW_BATTLE_BRIDGE_PROBE_COMPLETE'
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
    finalVerdict = $verdict
} | ConvertTo-Json -Depth 8

if (-not $ok) { exit 1 }
