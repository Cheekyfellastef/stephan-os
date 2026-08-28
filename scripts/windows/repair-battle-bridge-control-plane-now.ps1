[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateRange(60, 900)]
    [int]$ConvergenceTimeoutSeconds = 480,

    [ValidateRange(1, 15)]
    [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$repository = 'Cheekyfellastef/stephan-os'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$syncTaskName = 'Stephanos Battle Bridge GitHub Sync'
$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'
$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'
$fixedPowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Write-BoundedReceipt {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Receipt,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Stop-BoundedRescue {
    param(
        [Parameter(Mandatory = $true)][string]$Blocker,
        [string]$Detail = ''
    )

    $failure = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-no-faff-rescue.v1'
        repository = $repository
        status = 'BLOCKED'
        blocker = $Blocker
        detail = $Detail
        sourceMutationPerformedByRescue = $false
        sourceConvergencePerformedByExistingReviewedSync = $false
        destructiveGitAllowed = $false
        arbitraryShellAllowed = $false
        tailscaleCredentialRequired = $false
        forgeMutationPerformed = $false
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
        finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_BLOCKED'
    }
    try { Write-BoundedReceipt -Receipt $failure -Path $script:receiptPath } catch { }
    throw "$Blocker`: $Detail"
}

function Read-FixedGitText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = (& $gitExe @Arguments | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Stop-BoundedRescue -Blocker 'FIXED_GIT_READ_FAILED' -Detail ($Arguments -join ' ')
    }
    return $output
}

function Read-PublicMainHead {
    $line = Read-FixedGitText -Arguments @('ls-remote', $publicRemote, 'refs/heads/main')
    $parts = @($line -split '\s+' | Where-Object { $_ })
    if ($parts.Count -ne 2 -or $parts[0] -notmatch '^[0-9a-f]{40}$' -or $parts[1] -ne 'refs/heads/main') {
        Stop-BoundedRescue -Blocker 'PUBLIC_MAIN_HEAD_PROOF_INVALID'
    }
    return $parts[0].ToLowerInvariant()
}

function Invoke-FixedInstaller {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedTaskName
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Stop-BoundedRescue -Blocker 'FIXED_INSTALLER_MISSING' -Detail $Path
    }

    $raw = (& $Path -StartNow | Out-String).Trim()
    if (-not $raw) {
        Stop-BoundedRescue -Blocker 'FIXED_INSTALLER_RECEIPT_MISSING' -Detail $ExpectedTaskName
    }

    try { $receipt = $raw | ConvertFrom-Json }
    catch { Stop-BoundedRescue -Blocker 'FIXED_INSTALLER_RECEIPT_INVALID' -Detail $ExpectedTaskName }

    if ([string]$receipt.taskName -ne $ExpectedTaskName) {
        Stop-BoundedRescue -Blocker 'FIXED_INSTALLER_TASK_IDENTITY_MISMATCH' -Detail $ExpectedTaskName
    }
    if ($receipt.installed -ne $true -or $receipt.startedNow -ne $true) {
        Stop-BoundedRescue -Blocker 'FIXED_INSTALLER_DID_NOT_START_TASK' -Detail $ExpectedTaskName
    }
    return $receipt
}

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$proofRoot = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner\proof'
$script:receiptPath = Join-Path $proofRoot 'battle-bridge-no-faff-rescue-latest.json'

if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) {
    Stop-BoundedRescue -Blocker 'CANONICAL_REPOSITORY_MISSING' -Detail $repoRoot
}
if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) {
    Stop-BoundedRescue -Blocker 'FIXED_GIT_EXECUTABLE_MISSING' -Detail $gitExe
}

Set-Location -LiteralPath $repoRoot
$branch = Read-FixedGitText -Arguments @('-C', $repoRoot, 'branch', '--show-current')
if ($branch -ne 'main') {
    Stop-BoundedRescue -Blocker 'CANONICAL_MAIN_BRANCH_REQUIRED' -Detail $branch
}

$origin = Read-FixedGitText -Arguments @('-C', $repoRoot, 'remote', 'get-url', 'origin')
if ($origin -notmatch '^(https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?|git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?|ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?)$') {
    Stop-BoundedRescue -Blocker 'CANONICAL_ORIGIN_REQUIRED' -Detail $origin
}

$syncInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-github-sync.ps1'
$recoveryInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-recovery-mesh.ps1'
$mailboxInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-github-command-mailbox.ps1'
$dispatchInstaller = Join-Path $repoRoot 'scripts\windows\install-stephanos-codex-dispatch-plugin.ps1'
$dispatchStatus = Join-Path $repoRoot 'scripts\windows\status-stephanos-codex-dispatch-plugin.ps1'

if (-not $PSCmdlet.ShouldProcess($repoRoot, 'Start the three existing reviewed Battle Bridge control-plane tasks, converge to public main, and repair the existing Codex dispatch attachment')) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-no-faff-rescue-plan.v1'
        repository = $repository
        taskNames = @($syncTaskName, $recoveryTaskName, $mailboxTaskName)
        codexDispatchInstaller = 'scripts/windows/install-stephanos-codex-dispatch-plugin.ps1'
        codexDispatchStatus = 'scripts/windows/status-stephanos-codex-dispatch-plugin.ps1'
        sourceMutationPerformedByRescue = $false
        sourceConvergenceDelegatedToExistingReviewedSync = $true
        tailscaleCredentialRequired = $false
        finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_PLAN_READY'
    } | ConvertTo-Json -Depth 6
    return
}

$syncReceipts = @()
$targetHead = ''
$observedHead = ''
$stable = $false

for ($round = 1; $round -le 3; $round += 1) {
    $targetHead = Read-PublicMainHead
    $syncReceipts += Invoke-FixedInstaller -Path $syncInstaller -ExpectedTaskName $syncTaskName

    $deadline = (Get-Date).AddSeconds($ConvergenceTimeoutSeconds)
    do {
        Start-Sleep -Seconds $PollIntervalSeconds
        $observedHead = (Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).ToLowerInvariant()
    } while ($observedHead -ne $targetHead -and (Get-Date) -lt $deadline)

    if ($observedHead -ne $targetHead) {
        Stop-BoundedRescue -Blocker 'EXACT_MAIN_CONVERGENCE_TIMEOUT' -Detail "observed=$observedHead expected=$targetHead"
    }

    $latestPublicHead = Read-PublicMainHead
    if ($latestPublicHead -eq $observedHead) {
        $stable = $true
        break
    }
}

if (-not $stable) {
    Stop-BoundedRescue -Blocker 'PUBLIC_MAIN_MOVED_DURING_RESCUE' -Detail "observed=$observedHead latest=$(Read-PublicMainHead)"
}

$observedTree = (Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', ($observedHead + '^{tree}'))).ToLowerInvariant()
if ($observedTree -notmatch '^[0-9a-f]{40}$') {
    Stop-BoundedRescue -Blocker 'EXACT_TREE_PROOF_FAILED'
}

$recoveryReceipt = Invoke-FixedInstaller -Path $recoveryInstaller -ExpectedTaskName $recoveryTaskName
$mailboxReceipt = Invoke-FixedInstaller -Path $mailboxInstaller -ExpectedTaskName $mailboxTaskName
Start-Sleep -Seconds 8

$taskProof = foreach ($taskName in @($syncTaskName, $recoveryTaskName, $mailboxTaskName)) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
    [ordered]@{
        taskName = $taskName
        present = [bool]($null -ne $task)
        state = if ($task) { [string]$task.State } else { '' }
        # Task Scheduler exposes HRESULT-style results as UInt32 values. Keep the
        # complete value in Int64 so failures such as 0x80070120 remain reportable
        # instead of crashing the rescue receipt projection under StrictMode.
        lastTaskResult = if ($info) { [int64]$info.LastTaskResult } else { $null }
    }
}

# PowerShell unwraps a one-item pipeline to a scalar under StrictMode. Materialize
# the filtered proof as an array so zero, one, and many missing tasks share the
# same deterministic Count contract.
if (@($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0) {
    Stop-BoundedRescue -Blocker 'CONTROL_PLANE_TASK_PROOF_FAILED'
}

if (-not (Test-Path -LiteralPath $fixedPowerShellExe -PathType Leaf)) {
    Stop-BoundedRescue -Blocker 'FIXED_WINDOWS_POWERSHELL_MISSING' -Detail $fixedPowerShellExe
}
foreach ($fixedDispatchScript in @($dispatchInstaller, $dispatchStatus)) {
    if (-not (Test-Path -LiteralPath $fixedDispatchScript -PathType Leaf)) {
        Stop-BoundedRescue -Blocker 'FIXED_CODEX_DISPATCH_SCRIPT_MISSING' -Detail $fixedDispatchScript
    }
}

function Read-CodexDispatchStatus {
    $raw = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $dispatchStatus -RepositoryRoot $repoRoot 2>&1 | Out-String).Trim()
    try { return $raw | ConvertFrom-Json }
    catch { Stop-BoundedRescue -Blocker 'CODEX_DISPATCH_STATUS_INVALID' -Detail $raw }
}

$dispatchInstallPerformed = $false
$dispatchInstallExitCode = $null
$dispatchProof = Read-CodexDispatchStatus
if ($dispatchProof.localBridgeReady -ne $true) {
    $dispatchInstallPerformed = $true
    $dispatchInstallOutput = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $dispatchInstaller -RepositoryRoot $repoRoot 2>&1 | Out-String).Trim()
    $dispatchInstallExitCode = $LASTEXITCODE
    if ($dispatchInstallExitCode -ne 0) {
        Stop-BoundedRescue -Blocker 'CODEX_DISPATCH_INSTALL_FAILED' -Detail $dispatchInstallOutput
    }
    $dispatchProof = Read-CodexDispatchStatus
}

if ($dispatchProof.readyForRemoteChatDispatch -ne $true) {
    $dispatchBlocker = [string]$dispatchProof.finalVerdict
    $dispatchNextAction = if ($dispatchProof.readyForCodexCliDispatch -eq $true) {
        'Establish the separately reviewed authenticated ChatGPT transport; the proven local Codex stdio session cannot establish remote transport identity.'
    }
    elseif ($dispatchProof.localBridgeReady -eq $true) {
        $attachmentBlocker = [string]$dispatchProof.attachmentBlocker
        if ([string]::IsNullOrWhiteSpace($attachmentBlocker)) {
            $attachmentBlocker = 'LOCAL_CODEX_SESSION_PROOF_UNAVAILABLE'
        }
        "Start a compatible local Codex MCP session and complete initialize/initialized/tools-list. Current attachment blocker: $attachmentBlocker"
    }
    else {
        'Repair the fixed local Codex CLI/plugin prerequisite named by codexDispatchStatus.'
    }
    $pending = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-no-faff-rescue.v2'
        repository = $repository
        status = 'CONTROL_PLANE_READY_REMOTE_CODEX_BLOCKED'
        branch = 'main'
        publicMainHead = $targetHead
        observedHead = $observedHead
        observedTree = $observedTree
        syncReceipts = @($syncReceipts)
        recoveryMesh = $recoveryReceipt
        githubCommandMailbox = $mailboxReceipt
        taskProof = @($taskProof)
        codexDispatchInstallPerformed = $dispatchInstallPerformed
        codexDispatchInstallExitCode = $dispatchInstallExitCode
        codexDispatchStatus = $dispatchProof
        readyForCodexCliDispatch = ($dispatchProof.readyForCodexCliDispatch -eq $true)
        readyForRemoteChatDispatch = $false
        blocker = $dispatchBlocker
        exactNextAction = $dispatchNextAction
        sourceMutationPerformedByRescue = $false
        sourceConvergencePerformedByExistingReviewedSync = $true
        newWorkerCreated = $false
        newMailboxCreated = $false
        destructiveGitAllowed = $false
        arbitraryShellAllowed = $false
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
        finalVerdict = $dispatchBlocker
    }
    Write-BoundedReceipt -Receipt $pending -Path $script:receiptPath
    $pending | ConvertTo-Json -Depth 12
    exit 2
}

$success = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-no-faff-rescue.v2'
    repository = $repository
    status = 'READY'
    branch = 'main'
    originCanonical = $true
    publicMainHead = $targetHead
    observedHead = $observedHead
    observedTree = $observedTree
    syncReceipts = @($syncReceipts)
    recoveryMesh = $recoveryReceipt
    githubCommandMailbox = $mailboxReceipt
    taskProof = @($taskProof)
    codexDispatchInstallPerformed = $dispatchInstallPerformed
    codexDispatchInstallExitCode = $dispatchInstallExitCode
    codexDispatchStatus = $dispatchProof
    remoteCodexAttachmentReady = $true
    newWorkerCreated = $false
    newMailboxCreated = $false
    sourceMutationPerformedByRescue = $false
    sourceConvergencePerformedByExistingReviewedSync = $true
    destructiveGitAllowed = $false
    arbitraryShellAllowed = $false
    tailscaleCredentialRequired = $false
    forgeMutationPerformed = $false
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_READY'
}
Write-BoundedReceipt -Receipt $success -Path $script:receiptPath
$success | ConvertTo-Json -Depth 10
