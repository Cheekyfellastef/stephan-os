[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHead,
    [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedLockSha256,
    [switch]$AbsentLock,
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


# A full canonical remote source proof has already completed before entering
# either freshness-critical window. Check local continuity without fetching.
function Assert-CoreRecoveryLocalSource {
    Assert-CoreRecoveryEnvironment
    if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'CORE_RECOVERY_NODE_LOADER_OVERRIDE_REFUSED' }
    foreach ($file in $sourceFiles) {
        if ((Get-CoreRecoveryDigest $file) -cne $sourceDigests[$file]) { throw 'CORE_RECOVERY_SOURCE_BYTES_CHANGED' }
    }
    foreach ($file in $gitMetadataPaths) {
        if ((Get-CoreRecoveryDigest $file) -cne $gitMetadataDigests[$file]) { throw 'CORE_RECOVERY_LOCAL_GIT_METADATA_CHANGED' }
    }
    # Inherited Git overrides would void the earlier canonical proof.
    if (@(Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_' }).Count -ne 0) {
        throw 'CORE_RECOVERY_LOCAL_GIT_ENVIRONMENT_UNPROVEN'
    }
    $git = 'C:\Program Files\Git\cmd\git.exe'
    $gitDir = Join-Path $repoRoot '.git'
    if (-not [IO.Directory]::Exists($gitDir)) { throw 'CORE_RECOVERY_LOCAL_GIT_TOPOLOGY_UNPROVEN' }
    if ([IO.File]::Exists((Join-Path $gitDir 'config.worktree'))) { throw 'CORE_RECOVERY_LOCAL_GIT_TOPOLOGY_UNPROVEN' }
    $gitArgs = @('--no-optional-locks',
        '-c', 'core.autocrlf=true', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=NUL', '-c', 'core.trustctime=true',
        '-c', 'core.checkStat=default', '-c', 'core.ignoreStat=false',
        '-c', 'core.untrackedCache=false', '-c', 'core.attributesFile=',
        '-c', 'core.excludesFile=', '-c', 'credential.helper=',
        '-c', 'protocol.allow=never', '-c', 'submodule.recurse=false',
        ('--git-dir=' + $gitDir), ('--work-tree=' + $repoRoot))
    # Isolate system/global config and object substitution just as the canonical
    # preflight does. Restore the process environment even if Git throws.
    $safeGitEnvironment = @{ GIT_CONFIG_GLOBAL='NUL'; GIT_CONFIG_NOSYSTEM='1';
        GIT_NO_REPLACE_OBJECTS='1'; GIT_NO_LAZY_FETCH='1'; GIT_OPTIONAL_LOCKS='0' }
    try {
        foreach ($key in $safeGitEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($key, $safeGitEnvironment[$key], 'Process')
        }
        $heads = @(& $git @gitArgs rev-parse HEAD refs/remotes/origin/main)
        if ($LASTEXITCODE -ne 0 -or $heads.Count -ne 2 -or
            $heads[0] -cne $ExpectedHead -or $heads[1] -cne $ExpectedHead) {
            throw 'CORE_RECOVERY_LOCAL_HEAD_CHANGED'
        }
        $branch = @(& $git @gitArgs symbolic-ref --quiet --short HEAD)
        if ($LASTEXITCODE -ne 0 -or $branch.Count -ne 1 -or $branch[0] -cne 'main') {
            throw 'CORE_RECOVERY_LOCAL_BRANCH_CHANGED'
        }
        $upstream = @(& $git @gitArgs rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')
        if ($LASTEXITCODE -ne 0 -or $upstream.Count -ne 1 -or $upstream[0] -cne 'origin/main') {
            throw 'CORE_RECOVERY_LOCAL_UPSTREAM_CHANGED'
        }
    } finally {
        foreach ($key in $safeGitEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
    }
    foreach ($file in $gitMetadataPaths) {
        if ((Get-CoreRecoveryDigest $file) -cne $gitMetadataDigests[$file]) { throw 'CORE_RECOVERY_LOCAL_GIT_METADATA_CHANGED' }
    }
    foreach ($file in $sourceFiles) {
        if ((Get-CoreRecoveryDigest $file) -cne $sourceDigests[$file]) { throw 'CORE_RECOVERY_SOURCE_BYTES_CHANGED' }
    }
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
    if (($AbsentLock -and $ExpectedLockSha256) -or (-not $AbsentLock -and -not $ExpectedLockSha256)) {
        throw 'CORE_RECOVERY_EXACTLY_ONE_LOCK_MODE_REQUIRED'
    }
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
    # Full canonical proof may stabilise Git's index. Pin its resulting
    # configuration and index bytes separately in each recovery process.
    $gitMetadataPaths = @((Join-Path $repoRoot '.git\config'), (Join-Path $repoRoot '.git\index'))
    $gitMetadataDigests = @{}
    foreach ($file in $gitMetadataPaths) { $gitMetadataDigests[$file] = Get-CoreRecoveryDigest $file }
    . $policyPath
    if ($RetireOnlyChild) {
        # This elevated child can retire only the fixed lock. It never starts
        # Core, a service, a scheduled task, a builder, or a persistent helper.
        . $inventoryPath
        Import-Module (Join-Path $PSHOME 'Modules\CimCmdlets\CimCmdlets.psd1') -ErrorAction Stop
        Add-Type -TypeDefinition ([IO.File]::ReadAllText($nativePath))
        if ($AbsentLock) {
            # Same attended child/limited parent, no retirement and no report
            # accepted by the parent. Reuse existing native ancestor pins; the
            # absence handle cannot archive or commit any lock object.
            $absence = [StephanosCoreLockRecoveryV1]::new($lockPath, $true)
            try {
                $captureClock = [Diagnostics.Stopwatch]::StartNew()
                $absence.AssertAbsent()
                $before = Get-StephanosCoreProcessIdentityObservation -CoreScript $coreScript
                Assert-CoreRecoveryLocalSource
                $after = Get-StephanosCoreProcessIdentityObservation -CoreScript $coreScript
                $absence.AssertAbsent()
                Assert-StephanosCoreAbsentInventoryPair -Before $before -After $after -ElapsedSeconds $captureClock.Elapsed.TotalSeconds
                Assert-CoreRecoveryLocalSource
                Assert-StephanosCoreAbsentInventoryPair -Before $before -After $after -ElapsedSeconds $captureClock.Elapsed.TotalSeconds
            } finally { $absence.Dispose() }
            Write-CoreRecoveryResult $true 'CORE_ABSENT_INVENTORY_OBSERVED'
            exit 0
        }
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
        '-ExpectedHead', $ExpectedHead,
        '-OperatorApproved', '-RetireOnlyChild')
    if ($AbsentLock) { $arguments += '-AbsentLock' }
    else { $arguments += @('-ExpectedLockSha256', $ExpectedLockSha256) }
    $childAttemptUtc = [DateTime]::UtcNow
    $childClock = [Diagnostics.Stopwatch]::StartNew()
    if ($AbsentLock) {
        $child = Start-Process -FilePath $powerShell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru
        $childExpectedPid = $child.Id
        $childExpectedStartedUtc = $child.StartTime.ToUniversalTime()
        if (-not $child.WaitForExit(120000)) { throw 'CORE_RECOVERY_CHILD_TERMINAL_UNPROVEN' }
    } else {
        $child = Start-Process -FilePath $powerShell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    }
    if ($child.ExitCode -ne 0) { throw 'CORE_RECOVERY_CHILD_BLOCKED_OR_UNCERTAIN' }
    if (-not $AbsentLock) { $lockRetired = $true }
    if ($AbsentLock) { Assert-CoreRecoveryLocalSource }
    else { Assert-CoreRecoverySource }
    if ($AbsentLock) {
        Assert-StephanosCoreLockAbsent -LockPath $lockPath
        # Last operation before fixed start: age the native terminal timestamp,
        # including suspended-parent and source/path-check time. No reset clock.
        Assert-StephanosCoreAttendedChildContinuation -Child $child -ElapsedSeconds $childClock.Elapsed.TotalSeconds -AttemptUtc $childAttemptUtc -NowUtc ([DateTime]::UtcNow) -ExpectedPid $childExpectedPid -ExpectedStartedUtc $childExpectedStartedUtc
    }
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
