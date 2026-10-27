[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHead,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedLockSha256,
    [switch]$OperatorApproved,
    [switch]$RetireOnlyChild
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$profileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$repoRoot = Join-Path $profileRoot 'Documents\GitHub\stephan-os'
$stateRoot = Join-Path $profileRoot 'AppData\Local\Stephanos'
$lockPath = Join-Path $stateRoot 'stephanos-core-daemon.lock.json'
$coreScript = Join-Path $repoRoot 'scripts\stephanos-core-daemon.mjs'
$node = 'C:\Program Files\nodejs\node.exe'
$powerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$entry = Join-Path $repoRoot 'scripts\windows\recover-stephanos-core-lock.ps1'
$nativePath = Join-Path $repoRoot 'scripts\windows\StephanosCoreLockRecoveryV1.cs'
$policyPath = Join-Path $repoRoot 'scripts\windows\stephanos-core-lock-recovery-policy.ps1'
$inventoryPath = Join-Path $repoRoot 'scripts\windows\stephanos-core-process-observation.ps1'
$startedAt = [DateTime]::UtcNow
$coreStartRequested = $false
$lockRetired = $false

function Get-CoreRecoveryDigest([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Assert-CoreRecoveryEnvironment {
    # Match every path input used by stephanos-core-daemon.mjs. A redirected
    # daemon must never be launched after retiring this fixed canonical lock.
    $expectedPaths = @{
        USERPROFILE = $profileRoot
        HOME = $profileRoot
        LOCALAPPDATA = (Join-Path $profileRoot 'AppData\Local')
        STEPHANOS_SHARED_AGENT_WORKSPACE = (Join-Path $profileRoot 'Documents\Stephanos-openclaw-workspace')
    }
    foreach ($name in $expectedPaths.Keys) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ([string]::IsNullOrEmpty($value)) { continue }
        if ($value -notmatch '^[a-zA-Z]:[\\/]' -or
            -not [string]::Equals([IO.Path]::GetFullPath($value).TrimEnd('\'), $expectedPaths[$name].TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'CORE_RECOVERY_PATH_OVERRIDE_REFUSED'
        }
    }
}

function Write-CoreRecoveryResult {
    param([bool]$Ok, [string]$Verdict, [string]$Blocker = '')
    [ordered]@{
        schemaVersion = 'stephanos.core-lock-recovery.v1'
        ok = $Ok; finalVerdict = $Verdict; blocker = $Blocker
        expectedHead = $ExpectedHead; expectedLockSha256 = $ExpectedLockSha256
        observedAtUtc = [DateTime]::UtcNow.ToString('o')
        lockRetired = $lockRetired; coreStartRequested = $coreStartRequested
        buildPickupProven = $false; leaseReleaseAllowed = $false
        standingElevationCreated = $false; pcRestartAllowed = $false
    } | ConvertTo-Json -Compress
}

try {
    if (-not $OperatorApproved) { throw 'CORE_RECOVERY_EXACT_OPERATOR_APPROVAL_REQUIRED' }
    Assert-CoreRecoveryEnvironment
    if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'CORE_RECOVERY_NODE_LOADER_OVERRIDE_REFUSED' }
    if (-not [string]::Equals([IO.Path]::GetFullPath($PSCommandPath), $entry, [StringComparison]::OrdinalIgnoreCase)) { throw 'CORE_RECOVERY_CANONICAL_ENTRY_REQUIRED' }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($RetireOnlyChild -and -not $elevated) { throw 'CORE_RECOVERY_NATIVE_OBSERVER_REQUIRES_ADMINISTRATOR' }
    if (-not $RetireOnlyChild -and $elevated) { throw 'CORE_RECOVERY_LIMITED_PARENT_REQUIRED' }
    $sourceFiles = @($entry, $nativePath, $policyPath, $inventoryPath, $coreScript)
    $sourceDigests = @{}
    foreach ($file in $sourceFiles) { $sourceDigests[$file] = Get-CoreRecoveryDigest $file }
    function Assert-CoreRecoverySource {
        Assert-CoreRecoveryEnvironment
        $report = @(& $node (Join-Path $repoRoot 'scripts\battle-bridge-ignition-supervisor.mjs') '--source-truth-json')
        if ($LASTEXITCODE -ne 0) { throw 'CORE_RECOVERY_CANONICAL_SOURCE_UNPROVEN' }
        $truth = ($report -join "`n") | ConvertFrom-Json -ErrorAction Stop
        if ($truth.ok -ne $true -or $truth.head -cne $ExpectedHead) { throw 'CORE_RECOVERY_SOURCE_CHANGED' }
        foreach ($file in $sourceFiles) {
            if ((Get-CoreRecoveryDigest $file) -cne $sourceDigests[$file]) { throw 'CORE_RECOVERY_SOURCE_BYTES_CHANGED' }
        }
    }
    Assert-CoreRecoverySource
    . $policyPath
    if ($RetireOnlyChild) {
        # This elevated child can retire only the fixed lock. It never starts
        # Core, a service, a scheduled task, a builder, or a persistent helper.
        . $inventoryPath
        Import-Module (Join-Path $PSHOME 'Modules\CimCmdlets\CimCmdlets.psd1') -ErrorAction Stop
        Add-Type -TypeDefinition ([IO.File]::ReadAllText($nativePath))
        $handle = [StephanosCoreLockRecoveryV1]::new($lockPath)
        try {
            $observe = {
                param([int]$LockPid)
                $inventory = Get-StephanosCoreProcessObservation -CoreScript $coreScript
                $bootUtc = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime()
                # PID reuse is conservatively held, even when the reused PID is
                # not Node. A failed PID query never means an absent process.
                $pidRows = @(Get-CimInstance Win32_Process -Filter "ProcessId = $LockPid" -ErrorAction Stop)
                @{ inventory = $inventory; bootUtc = $bootUtc; nowUtc = [DateTime]::UtcNow; pidPresent = ($pidRows.Count -ne 0) }
            }
            $archive = Join-Path $stateRoot ('stephanos-core-daemon.retired-' + $ExpectedLockSha256 + '-' + [Guid]::NewGuid().ToString('N') + '.json')
            Invoke-StephanosCoreLockRetirement -Handle $handle -ExpectedDigest $ExpectedLockSha256 -Observe $observe -AssertSource ${function:Assert-CoreRecoverySource} -ArchivePath $archive
            $lockRetired = $true
        } finally { $handle.Dispose() }
        Write-CoreRecoveryResult $true 'CORE_STALE_LOCK_RETIRED'
        exit 0
    }

    # A real child process exit is the continuation signal; no writable receipt
    # or caller-authored observation can authorise starting the limited Core.
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', ('"' + $entry + '"'),
        '-ExpectedHead', $ExpectedHead, '-ExpectedLockSha256', $ExpectedLockSha256,
        '-OperatorApproved', '-RetireOnlyChild')
    $child = Start-Process -FilePath $powerShell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($child.ExitCode -ne 0) { throw 'CORE_RECOVERY_CHILD_BLOCKED_OR_UNCERTAIN' }
    $lockRetired = $true
    Assert-CoreRecoverySource
    # The canonical daemon still uses its unchanged exclusive-create lock.
    # A competing admitted start can win; it cannot cause a second owner.
    $core = Start-Process -FilePath $node -ArgumentList ('"' + $coreScript + '"') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    $coreStartRequested = $true
    $statusPath = Join-Path $profileRoot 'Documents\Stephanos-openclaw-workspace\status\stephanos-core-daemon-current.json'
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        if ($core.HasExited) { throw 'CORE_RECOVERY_STARTED_PROCESS_EXITED' }
        try {
            $currentLock = [IO.File]::ReadAllText($lockPath) | ConvertFrom-Json
            $status = [IO.File]::ReadAllText($statusPath) | ConvertFrom-Json
            if (Test-StephanosRecoveredCoreHeartbeat -Lock $currentLock -Status $status -StartedPid $core.Id -ExpectedHead $ExpectedHead -AttemptUtc $startedAt -NowUtc ([DateTime]::UtcNow)) {
                Assert-CoreRecoverySource
                Write-CoreRecoveryResult $true 'CORE_RECOVERY_FRESH_HEARTBEAT_PROVEN'
                exit 0
            }
        } catch { if ($_.Exception.Message -like 'CORE_RECOVERY_*') { throw } }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'CORE_RECOVERY_HEARTBEAT_UNPROVEN'
} catch {
    # No kill, second start, path-based unlink, automatic retry or lease action.
    Write-CoreRecoveryResult $false 'CORE_RECOVERY_BLOCKED' ([string]$_.Exception.Message)
    exit 2
}
