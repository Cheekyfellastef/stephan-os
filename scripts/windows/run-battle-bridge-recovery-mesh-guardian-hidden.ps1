[CmdletBinding()]
param(
    [ValidateRange(2, 15)]
    [int]$StaleAfterMinutes = 4
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'
$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'
$guardianId = 'stephanos-battle-bridge-recovery-mesh-guardian-v1'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$githubCli = 'C:\Program Files\GitHub CLI\gh.exe'
$fixedPowerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wscriptExe = 'C:\Windows\System32\wscript.exe'
$scheduledTaskMutationScope = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_OR_MAILBOX_ONLY'
$mailboxStaleAfterMinutes = 12
$mailboxRepairProofWaitSeconds = 20

function Stop-Guardian {
    param(
        [Parameter(Mandatory = $true)][string]$Blocker,
        [string]$Detail = ''
    )

    [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-mesh-guardian.v1'
        guardianId = $guardianId
        recoveryTaskName = $recoveryTaskName
        mailboxTaskName = $mailboxTaskName
        status = 'BLOCKED'
        blocker = $Blocker
        detail = $Detail
        mailboxRepairAttempted = $false
        mailboxRepairApplied = $false
        recoveryRepairAttempted = $false
        recoveryRepairApplied = $false
        scheduledTaskMutationScope = $scheduledTaskMutationScope
        arbitraryShellAllowed = $false
        arbitraryTaskNameAllowed = $false
        sourceMutationAllowed = $false
        gitMutationAllowed = $false
        arbitraryRuntimeMutationAllowed = $false
        mergeAuthority = $false
        finalVerdict = 'BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 6
    exit 2
}

function Write-MailboxRepairPending {
    param(
        [Parameter(Mandatory = $true)][string]$Reason,
        [string]$SourceRelation = '',
        [string]$SourceHead = '',
        [string]$RemoteHead = '',
        [object]$RepairReceipt = $null
    )

    [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-mesh-guardian.v1'
        guardianId = $guardianId
        status = 'MAILBOX_REPAIR_PENDING_PROOF'
        blocker = $Reason
        sourceHead = $SourceHead
        trustedRemoteMainHead = $RemoteHead
        sourceRelation = $SourceRelation
        recoveryTaskName = $recoveryTaskName
        mailboxTaskName = $mailboxTaskName
        mailboxHealthy = $false
        mailboxRepairAttempted = $true
        mailboxRepairApplied = $false
        mailboxRepairReceipt = $RepairReceipt
        recoveryRepairAttempted = $false
        recoveryRepairApplied = $false
        scheduledTaskMutationScope = $scheduledTaskMutationScope
        arbitraryShellAllowed = $false
        arbitraryTaskNameAllowed = $false
        sourceMutationAllowed = $false
        gitMutationAllowed = $false
        arbitraryRuntimeMutationAllowed = $false
        mergeAuthority = $false
        finalVerdict = 'BATTLE_BRIDGE_MAILBOX_REPAIR_PENDING_PROOF'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 7
    exit 3
}

function Read-FixedGitText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $text = (& $gitExe @Arguments 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'FIXED_GIT_READ_FAILED' }
    return $text
}

function Read-FixedGitHubText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $text = (& $githubCli @Arguments 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $text) { Stop-Guardian -Blocker 'FIXED_GITHUB_READ_FAILED' }
    return $text
}

function Read-FixedGitHubJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $raw = (& $githubCli @Arguments 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $raw) { Stop-Guardian -Blocker 'FIXED_GITHUB_COMPARE_READ_FAILED' }
    try { return $raw | ConvertFrom-Json }
    catch { Stop-Guardian -Blocker 'FIXED_GITHUB_COMPARE_JSON_INVALID' }
}

function Resolve-WindowsAccountSid {
    param([string]$AccountName)

    $candidate = ([string]$AccountName).Trim()
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }

    $names = @($candidate)
    if (-not $candidate.Contains('\') -and -not [string]::IsNullOrWhiteSpace($env:COMPUTERNAME)) {
        $names += "$env:COMPUTERNAME\$candidate"
    }

    foreach ($name in @($names | Select-Object -Unique)) {
        try {
            $account = New-Object System.Security.Principal.NTAccount($name)
            $sid = $account.Translate([System.Security.Principal.SecurityIdentifier])
            if ($sid -and -not [string]::IsNullOrWhiteSpace([string]$sid.Value)) {
                return [string]$sid.Value
            }
        } catch {
            # Unresolvable principals fail closed.
        }
    }

    return ''
}

function Test-TaskPrincipalMatchesCurrentUser {
    param([string]$PrincipalUserId)

    $principalSid = Resolve-WindowsAccountSid -AccountName $PrincipalUserId
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSid = if ($identity -and $identity.User) {
        [string]$identity.User.Value
    } else {
        ''
    }

    return -not [string]::IsNullOrWhiteSpace($principalSid) `
        -and -not [string]::IsNullOrWhiteSpace($currentSid) `
        -and [string]::Equals(
            $principalSid,
            $currentSid,
            [System.StringComparison]::Ordinal
        )
}

function Test-MailboxTaskIdentity {
    param(
        [object]$Task,
        [string]$ExpectedLauncherPath
    )
    try {
        if (-not $Task -or [string]$Task.TaskPath -ne '\' -or $Task.Actions.Count -ne 1 -or -not $Task.Principal -or -not $Task.Settings) { return $false }
        $action = $Task.Actions[0]
        $execute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$action.Execute))
        if (-not [string]::Equals($execute, $wscriptExe, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $expectedArguments = "//B //NoLogo `"$ExpectedLauncherPath`" github-command-mailbox"
        if (-not [string]::Equals(([string]$action.Arguments).Trim(), $expectedArguments, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $principalMatchesCurrentUser = Test-TaskPrincipalMatchesCurrentUser -PrincipalUserId ([string]$Task.Principal.UserId)
        return $principalMatchesCurrentUser `
            -and [string]$Task.Principal.LogonType -eq 'Interactive' `
            -and [string]$Task.Principal.RunLevel -eq 'Limited' `
            -and [string]$Task.Settings.MultipleInstances -eq 'IgnoreNew' `
            -and $Task.Settings.Enabled -eq $true
    } catch { return $false }
}

function Test-RecoveryTaskIdentity {
    param(
        [object]$Task,
        [string]$ExpectedLauncherPath
    )
    try {
        if (-not $Task -or [string]$Task.TaskPath -ne '\' -or $Task.Actions.Count -ne 1 -or -not $Task.Principal -or -not $Task.Settings) { return $false }
        $action = $Task.Actions[0]
        $execute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$action.Execute))
        if (-not [string]::Equals($execute, $wscriptExe, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $expectedArguments = "//B //NoLogo `"$ExpectedLauncherPath`" recovery-mesh"
        if (-not [string]::Equals(([string]$action.Arguments).Trim(), $expectedArguments, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $principalMatchesCurrentUser = Test-TaskPrincipalMatchesCurrentUser -PrincipalUserId ([string]$Task.Principal.UserId)
        return $principalMatchesCurrentUser `
            -and [string]$Task.Principal.LogonType -eq 'Interactive' `
            -and [string]$Task.Principal.RunLevel -eq 'Limited' `
            -and [string]$Task.Settings.MultipleInstances -eq 'IgnoreNew' `
            -and $Task.Settings.Enabled -eq $true
    } catch { return $false }
}

function Get-TaskHealth {
    param(
        [string]$FixedName,
        [scriptblock]$IdentityCheck,
        [int]$FreshMinutes
    )
    $task = Get-ScheduledTask -TaskName $FixedName -ErrorAction SilentlyContinue
    $info = if ($task) { Get-ScheduledTaskInfo -TaskName $FixedName -ErrorAction SilentlyContinue } else { $null }
    $identityCanonical = if ($task) { & $IdentityCheck $task } else { $false }
    $now = Get-Date
    $lastRun = if ($info) { $info.LastRunTime } else { $null }
    $age = if ($lastRun -and $lastRun -gt [datetime]::MinValue) { ($now - $lastRun).TotalMinutes } else { $null }
    $lastResult = if ($info) { [int]$info.LastTaskResult } else { $null }
    $healthy = $null -ne $task -and $null -ne $info -and $identityCanonical -and $lastResult -eq 0 -and $null -ne $age -and $age -le $FreshMinutes
    return [pscustomobject]@{
        task = $task
        info = $info
        taskState = if ($task) { [string]$task.State } else { '' }
        lastRunTime = $lastRun
        identityCanonical = [bool]$identityCanonical
        ageMinutes = $age
        lastResult = $lastResult
        healthy = [bool]$healthy
    }
}

if (-not $env:USERPROFILE) { Stop-Guardian -Blocker 'USERPROFILE_REQUIRED' }
foreach ($fixedExecutable in @($gitExe, $githubCli, $fixedPowerShellExe, $wscriptExe)) {
    if (-not (Test-Path -LiteralPath $fixedExecutable -PathType Leaf)) { Stop-Guardian -Blocker 'FIXED_EXECUTABLE_MISSING' }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$mailboxInstallerPath = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-github-command-mailbox.ps1'
$recoveryInstallerPath = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-recovery-mesh.ps1'
$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
$mailboxRunnerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'))
$mailboxChildRunnerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\battle-bridge-github-command-mailbox-with-receipt-index.mjs'))
$authoritySourcePaths = @(
    'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
    'scripts/battle-bridge-github-command-mailbox-with-receipt-index.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
    'scripts/battle-bridge-recovery-mesh.mjs',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1'
)

if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { Stop-Guardian -Blocker 'CANONICAL_REPOSITORY_MISSING' }
foreach ($authorityPath in $authoritySourcePaths) {
    $absoluteAuthorityPath = Join-Path $repoRoot ($authorityPath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $absoluteAuthorityPath -PathType Leaf)) { Stop-Guardian -Blocker 'FIXED_AUTHORITY_SOURCE_MISSING' }
    $item = Get-Item -LiteralPath $absoluteAuthorityPath -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Guardian -Blocker 'FIXED_AUTHORITY_SOURCE_REPARSE_POINT' }
}

$branch = Read-FixedGitText -Arguments @('-C', $repoRoot, 'branch', '--show-current')
if ($branch -ne 'main') { Stop-Guardian -Blocker 'CANONICAL_MAIN_BRANCH_REQUIRED' }
$origin = Read-FixedGitText -Arguments @('-C', $repoRoot, 'remote', 'get-url', 'origin')
if ($origin -notmatch '^(https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?|git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?|ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?)$') {
    Stop-Guardian -Blocker 'CANONICAL_ORIGIN_REQUIRED'
}
$localHead = (Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).ToLowerInvariant()
if ($localHead -notmatch '^[0-9a-f]{40}$') { Stop-Guardian -Blocker 'LOCAL_HEAD_INVALID' }

foreach ($authorityPath in $authoritySourcePaths) {
    & $gitExe -C $repoRoot diff --quiet -- $authorityPath
    if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'LOCAL_AUTHORITY_SOURCE_DIRTY' }
    & $gitExe -C $repoRoot diff --cached --quiet -- $authorityPath
    if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'LOCAL_AUTHORITY_SOURCE_STAGED_DIRTY' }
}

$remoteMainHead = (Read-FixedGitHubText -Arguments @('api', 'repos/Cheekyfellastef/stephan-os/branches/main', '--jq', '.commit.sha')).ToLowerInvariant()
if ($remoteMainHead -notmatch '^[0-9a-f]{40}$') { Stop-Guardian -Blocker 'REMOTE_MAIN_HEAD_INVALID' }

$sourceRelation = ''
if ($localHead -eq $remoteMainHead) {
    $sourceRelation = 'EXACT'
} else {
    $comparePath = 'repos/Cheekyfellastef/stephan-os/compare/' + $localHead + '...' + $remoteMainHead
    $comparison = Read-FixedGitHubJson -Arguments @('api', $comparePath)
    $trustedAncestor = $comparison.status -eq 'ahead' `
        -and $comparison.ahead_by -gt 0 `
        -and $comparison.behind_by -eq 0 `
        -and $comparison.merge_base_commit.sha -eq $localHead
    if (-not $trustedAncestor) { Stop-Guardian -Blocker 'LOCAL_HEAD_NOT_TRUSTED_MAIN_ANCESTOR' }
    $sourceRelation = 'TRUSTED_ANCESTOR'
}

$mailboxHealth = Get-TaskHealth -FixedName $mailboxTaskName -FreshMinutes $mailboxStaleAfterMinutes -IdentityCheck {
    param($candidate)
    Test-MailboxTaskIdentity -Task $candidate -ExpectedLauncherPath $launcherPath
}
$recoveryHealth = Get-TaskHealth -FixedName $recoveryTaskName -FreshMinutes $StaleAfterMinutes -IdentityCheck {
    param($candidate)
    Test-RecoveryTaskIdentity -Task $candidate -ExpectedLauncherPath $launcherPath
}

$mailboxHealthy = $mailboxHealth.healthy
$mailboxRepairAttempted = $false
$mailboxRepairApplied = $false
$mailboxRepairReceipt = $null
$mailboxRepairRunProven = $false
if (-not $mailboxHealthy) {
    if ($mailboxHealth.identityCanonical -and $mailboxHealth.taskState -eq 'Running') {
        Write-MailboxRepairPending -Reason 'MAILBOX_TASK_RUNNING_WITHOUT_SUCCESS_PROOF' -SourceRelation $sourceRelation -SourceHead $localHead -RemoteHead $remoteMainHead
    }

    $mailboxRepairAttempted = $true
    $mailboxLastRunBefore = if ($mailboxHealth.lastRunTime -and $mailboxHealth.lastRunTime -gt [datetime]::MinValue) { [datetime]$mailboxHealth.lastRunTime } else { [datetime]::MinValue }
    $mailboxRepairStartedAt = Get-Date
    $mailboxRaw = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $mailboxInstallerPath -StartNow 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $mailboxRaw) { Stop-Guardian -Blocker 'MAILBOX_REPAIR_INSTALLER_FAILED' }
    try { $mailboxInstallerReceiptRaw = $mailboxRaw | ConvertFrom-Json }
    catch { Stop-Guardian -Blocker 'MAILBOX_REPAIR_RECEIPT_INVALID' }
    if ([string]$mailboxInstallerReceiptRaw.taskName -ne $mailboxTaskName `
        -or $mailboxInstallerReceiptRaw.installed -ne $true `
        -or $mailboxInstallerReceiptRaw.startedNow -ne $true `
        -or $mailboxInstallerReceiptRaw.receiptIndexEnabled -ne $true `
        -or $mailboxInstallerReceiptRaw.outboxGuardEnabled -ne $true `
        -or [string]$mailboxInstallerReceiptRaw.runnerPath -ne $mailboxRunnerPath `
        -or [string]$mailboxInstallerReceiptRaw.childRunnerPath -ne $mailboxChildRunnerPath `
        -or [int]$mailboxInstallerReceiptRaw.intervalMinutes -ne 5 `
        -or [string]$mailboxInstallerReceiptRaw.runLevel -ne 'Limited' `
        -or $mailboxInstallerReceiptRaw.arbitraryShellAllowed -ne $false `
        -or $mailboxInstallerReceiptRaw.destructiveGitAllowed -ne $false `
        -or $mailboxInstallerReceiptRaw.liveOpenClawUpdateAllowed -ne $false) {
        Stop-Guardian -Blocker 'MAILBOX_REPAIR_RECEIPT_REJECTED'
    }
    $mailboxRepairReceipt = [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-github-command-mailbox-install.v1'
        taskName = [string]$mailboxInstallerReceiptRaw.taskName
        installed = [bool]$mailboxInstallerReceiptRaw.installed
        startedNow = [bool]$mailboxInstallerReceiptRaw.startedNow
        receiptIndexEnabled = [bool]$mailboxInstallerReceiptRaw.receiptIndexEnabled
        outboxGuardEnabled = [bool]$mailboxInstallerReceiptRaw.outboxGuardEnabled
        runnerPath = [string]$mailboxInstallerReceiptRaw.runnerPath
        childRunnerPath = [string]$mailboxInstallerReceiptRaw.childRunnerPath
        intervalMinutes = [int]$mailboxInstallerReceiptRaw.intervalMinutes
        runLevel = [string]$mailboxInstallerReceiptRaw.runLevel
        arbitraryShellAllowed = [bool]$mailboxInstallerReceiptRaw.arbitraryShellAllowed
        destructiveGitAllowed = [bool]$mailboxInstallerReceiptRaw.destructiveGitAllowed
        liveOpenClawUpdateAllowed = [bool]$mailboxInstallerReceiptRaw.liveOpenClawUpdateAllowed
        normalizedFromFixedInstaller = $true
    }
    if ([string]$mailboxRepairReceipt.schemaVersion -ne 'stephanos.battle-bridge-github-command-mailbox-install.v1' `
        -or [string]$mailboxRepairReceipt.taskName -ne $mailboxTaskName `
        -or $mailboxRepairReceipt.installed -ne $true `
        -or $mailboxRepairReceipt.startedNow -ne $true) {
        Stop-Guardian -Blocker 'MAILBOX_REPAIR_NORMALIZED_RECEIPT_REJECTED'
    }

    $repairedMailboxTask = Get-ScheduledTask -TaskName $mailboxTaskName -ErrorAction SilentlyContinue
    if (-not (Test-MailboxTaskIdentity -Task $repairedMailboxTask -ExpectedLauncherPath $launcherPath)) {
        Stop-Guardian -Blocker 'MAILBOX_REPAIR_TASK_IDENTITY_UNPROVEN'
    }

    $mailboxProofDeadline = (Get-Date).AddSeconds($mailboxRepairProofWaitSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $postTask = Get-ScheduledTask -TaskName $mailboxTaskName -ErrorAction SilentlyContinue
        $postInfo = if ($postTask) { Get-ScheduledTaskInfo -TaskName $mailboxTaskName -ErrorAction SilentlyContinue } else { $null }
        $postIdentity = Test-MailboxTaskIdentity -Task $postTask -ExpectedLauncherPath $launcherPath
        $postRunTime = if ($postInfo) { $postInfo.LastRunTime } else { $null }
        $postRunAdvanced = $postRunTime -and $postRunTime -gt $mailboxLastRunBefore -and $postRunTime -ge $mailboxRepairStartedAt.AddSeconds(-2)
        $mailboxRepairRunProven = $postIdentity `
            -and $null -ne $postInfo `
            -and $postRunAdvanced `
            -and [int]$postInfo.LastTaskResult -eq 0 `
            -and [string]$postTask.State -ne 'Running'
    } while (-not $mailboxRepairRunProven -and (Get-Date) -lt $mailboxProofDeadline)

    if (-not $mailboxRepairRunProven) {
        Write-MailboxRepairPending -Reason 'MAILBOX_REPAIR_SUCCESSFUL_RUN_NOT_YET_PROVEN' -SourceRelation $sourceRelation -SourceHead $localHead -RemoteHead $remoteMainHead -RepairReceipt $mailboxRepairReceipt
    }

    $mailboxHealthy = $true
    $mailboxRepairApplied = $true
}

$recoveryRepairAttempted = $false
$recoveryRepairApplied = $false
$recoveryRepairReceipt = $null
if ($sourceRelation -eq 'EXACT') {
    if (-not $recoveryHealth.healthy) {
        $recoveryRepairAttempted = $true
        $recoveryRaw = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $recoveryInstallerPath -StartNow -RecoveryMeshOnly 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $recoveryRaw) { Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_INSTALLER_FAILED' }
        try { $recoveryRepairReceipt = $recoveryRaw | ConvertFrom-Json }
        catch { Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_RECEIPT_INVALID' }
        if ([string]$recoveryRepairReceipt.schemaVersion -ne 'stephanos.battle-bridge-recovery-mesh-install.v1' `
            -or [string]$recoveryRepairReceipt.taskName -ne $recoveryTaskName `
            -or $recoveryRepairReceipt.taskPresentAfter -ne $true `
            -or $recoveryRepairReceipt.startedNow -ne $true `
            -or $recoveryRepairReceipt.recoveryMeshOnly -ne $true) {
            Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_RECEIPT_REJECTED'
        }
        $repairedRecoveryTask = Get-ScheduledTask -TaskName $recoveryTaskName -ErrorAction SilentlyContinue
        if (-not (Test-RecoveryTaskIdentity -Task $repairedRecoveryTask -ExpectedLauncherPath $launcherPath)) {
            Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_TASK_IDENTITY_UNPROVEN'
        }
        $recoveryRepairApplied = $true
    }
}

$status = if ($mailboxRepairApplied -or $recoveryRepairApplied) { 'REPAIRED' } elseif ($sourceRelation -eq 'TRUSTED_ANCESTOR') { 'MAILBOX_SUPERVISION_READY_WHILE_SOURCE_BEHIND' } else { 'HEALTHY' }
[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-guardian.v1'
    guardianId = $guardianId
    status = $status
    sourceHead = $localHead
    trustedRemoteMainHead = $remoteMainHead
    sourceRelation = $sourceRelation
    recoveryTaskName = $recoveryTaskName
    mailboxTaskName = $mailboxTaskName
    mailboxHealthy = [bool]$mailboxHealthy
    mailboxRepairAttempted = $mailboxRepairAttempted
    mailboxRepairApplied = $mailboxRepairApplied
    mailboxRepairRunProven = $mailboxRepairRunProven
    mailboxRepairReceipt = $mailboxRepairReceipt
    recoveryHealthyBefore = [bool]$recoveryHealth.healthy
    recoveryRepairAttempted = $recoveryRepairAttempted
    recoveryRepairApplied = $recoveryRepairApplied
    recoveryRepairReceipt = $recoveryRepairReceipt
    recoveryRepairAllowed = ($sourceRelation -eq 'EXACT')
    mailboxStaleAfterMinutes = $mailboxStaleAfterMinutes
    recoveryStaleAfterMinutes = $StaleAfterMinutes
    scheduledTaskMutationScope = $scheduledTaskMutationScope
    arbitraryShellAllowed = $false
    arbitraryTaskNameAllowed = $false
    sourceMutationAllowed = $false
    gitMutationAllowed = $false
    arbitraryRuntimeMutationAllowed = $false
    mergeAuthority = $false
    finalVerdict = if ($mailboxRepairApplied -and $mailboxRepairRunProven) { 'BATTLE_BRIDGE_MAILBOX_RECOVERED_BY_RECOVERY_GUARDIAN' } elseif ($recoveryRepairApplied) { 'BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_REPAIRED' } else { 'BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_HEALTHY' }
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Depth 8
