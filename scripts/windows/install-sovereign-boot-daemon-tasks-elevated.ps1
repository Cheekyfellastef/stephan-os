[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [switch]$OperatorApproved,
    [switch]$ElevatedChild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$powerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wscriptExe = 'C:\Windows\System32\wscript.exe'
$scriptPath = $MyInvocation.MyCommand.Path
$receiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\sovereign-boot-daemon-bootstrap-v1.json'
$expectedHeadLower = $ExpectedHead.ToLowerInvariant()
$fixedSourcePaths = @(
    'scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1',
    'scripts/windows/install-sovereign-commander.ps1',
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs'
)

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Fixed {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Executable @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Fixed executable failed with exit code $code."
    }
    [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Write-Receipt {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Payload,
        [switch]$Persist
    )
    $json = $Payload | ConvertTo-Json -Depth 9 -Compress
    if ($Persist) {
        $directory = Split-Path -Parent $receiptPath
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        $temporaryPath = Join-Path $directory ("sovereign-boot-daemon-bootstrap-v1.{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
        try {
            [System.IO.File]::WriteAllText($temporaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
            Move-Item -LiteralPath $temporaryPath -Destination $receiptPath -Force
        } finally {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    } else {
        $json
    }
}

function Stop-Bootstrap {
    param([string]$Blocker, [switch]$Persist)
    Write-Receipt -Persist:$Persist -Payload ([ordered]@{
        schemaVersion = 'stephanos.sovereign-boot-daemon-bootstrap.v1'
        ok = $false
        finalVerdict = 'SOVEREIGN_BOOT_DAEMON_BOOTSTRAP_BLOCKED'
        blocker = $Blocker
        expectedHead = $expectedHeadLower
        elevated = [bool](Test-Administrator)
        arbitraryShellAllowed = $false
        arbitraryTaskNameAllowed = $false
        mergeAuthority = $false
        pcRestartAuthority = $false
        credentialExported = $false
        sourceMutationAllowed = $false
        standingElevatedTaskCreated = $false
    })
    exit 2
}

function Assert-CanonicalSource {
    if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { Stop-Bootstrap 'CANONICAL_REPOSITORY_ROOT_MISSING' -Persist:$ElevatedChild }
    if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) { Stop-Bootstrap 'FIXED_GIT_EXECUTABLE_MISSING' -Persist:$ElevatedChild }
    $branch = ((Invoke-Fixed -Executable $gitExe -Arguments @('-C', $repoRoot, 'branch', '--show-current')).Output -join '').Trim()
    if ($branch -ne 'main') { Stop-Bootstrap 'CANONICAL_REPOSITORY_NOT_MAIN' -Persist:$ElevatedChild }
    $head = ((Invoke-Fixed -Executable $gitExe -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
    if ($head -ne $expectedHeadLower) { Stop-Bootstrap 'CANONICAL_REPOSITORY_HEAD_MISMATCH' -Persist:$ElevatedChild }
    foreach ($path in $fixedSourcePaths) {
        $unstaged = Invoke-Fixed -Executable $gitExe -Arguments @('-C', $repoRoot, 'diff', '--quiet', '--', $path) -AllowFailure
        $staged = Invoke-Fixed -Executable $gitExe -Arguments @('-C', $repoRoot, 'diff', '--cached', '--quiet', '--', $path) -AllowFailure
        if ($unstaged.ExitCode -ne 0 -or $staged.ExitCode -ne 0) {
            Stop-Bootstrap 'BOOTSTRAP_AUTHORITY_SOURCE_DIRTY' -Persist:$ElevatedChild
        }
    }
}

function Get-BootTaskProof {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$ExpectedArguments
    )
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    [xml]$xml = Export-ScheduledTask -TaskName $TaskName
    $action = @($task.Actions)[0]
    $bootTriggerPresent = $null -ne $xml.Task.Triggers.BootTrigger
    $logonType = [string]$xml.Task.Principals.Principal.LogonType
    $hidden = [string]$xml.Task.Settings.Hidden -eq 'true'
    $startWhenAvailable = [string]$xml.Task.Settings.StartWhenAvailable -eq 'true'
    $multipleInstances = [string]$xml.Task.Settings.MultipleInstancesPolicy
    $restartCount = [int]$xml.Task.Settings.RestartOnFailure.Count
    $restartInterval = [string]$xml.Task.Settings.RestartOnFailure.Interval
    $executeMatches = [string]::Equals([string]$action.Execute, $wscriptExe, [System.StringComparison]::OrdinalIgnoreCase)
    $argumentsMatch = [string]::Equals([string]$action.Arguments, $ExpectedArguments, [System.StringComparison]::Ordinal)
    $runLevel = [string]$xml.Task.Principals.Principal.RunLevel
    $bootSafe = $bootTriggerPresent -and $logonType -eq 'S4U' -and $runLevel -eq 'LeastPrivilege' -and $hidden -and $startWhenAvailable -and $multipleInstances -eq 'IgnoreNew' -and $restartCount -eq 3 -and $restartInterval -eq 'PT1M' -and $executeMatches -and $argumentsMatch
    [pscustomobject]@{
        taskName = $TaskName
        bootTriggerPresent = [bool]$bootTriggerPresent
        logonType = $logonType
        runLevel = $runLevel
        hidden = [bool]$hidden
        startWhenAvailable = [bool]$startWhenAvailable
        multipleInstances = $multipleInstances
        restartCount = $restartCount
        restartInterval = $restartInterval
        windowlessWscript = [bool]$executeMatches
        fixedArgumentsMatch = [bool]$argumentsMatch
        requiresInteractiveLogon = $false
        bootSafe = [bool]$bootSafe
    }
}

Assert-CanonicalSource
if (-not $OperatorApproved) { Stop-Bootstrap 'EXACT_OPERATOR_APPROVAL_REQUIRED' -Persist:$ElevatedChild }
if (-not (Test-Path -LiteralPath $powerShellExe -PathType Leaf)) { Stop-Bootstrap 'FIXED_POWERSHELL_EXECUTABLE_MISSING' -Persist:$ElevatedChild }
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { Stop-Bootstrap 'FIXED_WSCRIPT_EXECUTABLE_MISSING' -Persist:$ElevatedChild }

if (-not (Test-Administrator)) {
    if ($ElevatedChild) { Stop-Bootstrap 'BOOT_TASK_ELEVATION_NOT_EFFECTIVE' -Persist }
    Remove-Item -LiteralPath $receiptPath -Force -ErrorAction SilentlyContinue
    $quotedScriptPath = '"' + $scriptPath + '"'
    $brokerArguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', $quotedScriptPath,
        '-ExpectedHead', $expectedHeadLower,
        '-OperatorApproved',
        '-ElevatedChild'
    )
    try {
        $broker = Start-Process -FilePath $powerShellExe -ArgumentList $brokerArguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    } catch {
        Stop-Bootstrap 'BOOT_TASK_ELEVATION_CANCELLED_OR_FAILED'
    }
    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
        Stop-Bootstrap 'BOOT_TASK_ELEVATED_RECEIPT_MISSING'
    }
    try {
        $json = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8
        $receipt = $json | ConvertFrom-Json -ErrorAction Stop
        if ([string]$receipt.schemaVersion -ne 'stephanos.sovereign-boot-daemon-bootstrap.v1' -or [string]$receipt.expectedHead -ne $expectedHeadLower) {
            Stop-Bootstrap 'BOOT_TASK_ELEVATED_RECEIPT_INVALID'
        }
        $json.Trim()
        exit $broker.ExitCode
    } finally {
        Remove-Item -LiteralPath $receiptPath -Force -ErrorAction SilentlyContinue
    }
}

Assert-CanonicalSource

$commanderInstaller = Join-Path $repoRoot 'scripts\windows\install-sovereign-commander.ps1'
$recoveryInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-recovery-mesh.ps1'
$commanderRaw = (& $powerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $commanderInstaller -StartNow 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Stop-Bootstrap 'SOVEREIGN_COMMANDER_ELEVATED_INSTALL_FAILED' -Persist }
$recoveryRaw = (& $powerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $recoveryInstaller -StartNow 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Stop-Bootstrap 'RECOVERY_MESH_ELEVATED_INSTALL_FAILED' -Persist }

try {
    $commanderReceipt = $commanderRaw | ConvertFrom-Json -ErrorAction Stop
    $recoveryReceipt = $recoveryRaw | ConvertFrom-Json -ErrorAction Stop
} catch {
    Stop-Bootstrap 'BOOT_TASK_INSTALL_RECEIPT_INVALID' -Persist
}
if ([string]$commanderReceipt.finalVerdict -ne 'SOVEREIGN_COMMANDER_TASK_INSTALLED' -or $commanderReceipt.installed -ne $true -or $commanderReceipt.startedNow -ne $true) {
    Stop-Bootstrap 'SOVEREIGN_COMMANDER_ELEVATED_INSTALL_UNPROVEN' -Persist
}
if ([string]$recoveryReceipt.finalVerdict -ne 'BATTLE_BRIDGE_RECOVERY_MESH_INSTALLED' -or $recoveryReceipt.installed -ne $true -or $recoveryReceipt.startedNow -ne $true -or $recoveryReceipt.guardianInstalled -ne $true) {
    Stop-Bootstrap 'RECOVERY_MESH_ELEVATED_INSTALL_UNPROVEN' -Persist
}

$launcherPath = Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'
$quotedLauncher = '"' + $launcherPath + '"'
$commanderProof = Get-BootTaskProof -TaskName 'Stephanos Sovereign Commander' -ExpectedArguments ("//B //NoLogo {0} sovereign-commander-watchdog" -f $quotedLauncher)
$recoveryProof = Get-BootTaskProof -TaskName 'Stephanos Battle Bridge Recovery Mesh' -ExpectedArguments ("//B //NoLogo {0} recovery-mesh" -f $quotedLauncher)
$guardianProof = Get-BootTaskProof -TaskName 'Stephanos Battle Bridge Recovery Mesh Guardian' -ExpectedArguments ("//B //NoLogo {0} recovery-mesh-guardian" -f $quotedLauncher)
$allBootSafe = $commanderProof.bootSafe -and $recoveryProof.bootSafe -and $guardianProof.bootSafe
if (-not $allBootSafe) { Stop-Bootstrap 'BOOT_TASK_LIFECYCLE_PROOF_FAILED' -Persist }

Write-Receipt -Persist -Payload ([ordered]@{
    schemaVersion = 'stephanos.sovereign-boot-daemon-bootstrap.v1'
    ok = $true
    finalVerdict = 'SOVEREIGN_BOOT_DAEMON_TASKS_INSTALLED_AND_PROVEN'
    blocker = ''
    expectedHead = $expectedHeadLower
    elevated = $true
    oneTimeElevationOnly = $true
    tasks = @($commanderProof, $recoveryProof, $guardianProof)
    requiresInteractiveLogon = $false
    visiblePowerShellRequired = $false
    arbitraryShellAllowed = $false
    arbitraryTaskNameAllowed = $false
    mergeAuthority = $false
    pcRestartAuthority = $false
    credentialExported = $false
    sourceMutationAllowed = $false
    standingElevatedTaskCreated = $false
})
exit 0
