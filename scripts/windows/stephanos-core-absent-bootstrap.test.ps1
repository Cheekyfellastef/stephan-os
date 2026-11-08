$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'stephanos-core-process-observation.ps1')
. (Join-Path $PSScriptRoot 'stephanos-core-lock-recovery-policy.ps1')
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'StephanosCoreLockRecoveryV1.cs')))
$script:passed = 0
function Case([string]$Name, [scriptblock]$Run) {
    & $Run
    $script:passed++
    Write-Output ('PASS ' + $Name)
}
function Denied([scriptblock]$Run) {
    $failed = $false
    try { & $Run } catch { $failed = $true }
    if (-not $failed) { throw 'UNSAFE_CASE_ADMITTED' }
}
$core = 'C:\repo\scripts\stephanos-core-daemon.mjs'
$script:rows = @([pscustomobject]@{Name='node.exe';ProcessId=51;CreationDate=[DateTime]'2026-11-05T12:00:00Z';ExecutablePath='C:\Program Files\nodejs\node.exe';CommandLine='node C:\repo\unrelated.mjs'})
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $script:rows }
$goodRow = $script:rows[0]
$before = Get-StephanosCoreProcessIdentityObservation -CoreScript $core
Case 'complete identical native observation pair' {
    $after = Get-StephanosCoreProcessIdentityObservation -CoreScript $core
    Assert-StephanosCoreAbsentInventoryPair -Before $before -After $after -ElapsedSeconds 0.1
}
foreach ($fault in @('birth','command','executable','new-node','missing-node','duplicate','hidden','live-core','missing-birth','missing-image','cap')) {
    Case $fault {
        $script:rows = @($goodRow.PSObject.Copy())
        switch ($fault) {
            'birth' { $script:rows[0].CreationDate = $goodRow.CreationDate.AddSeconds(1) }
            'command' { $script:rows[0].CommandLine += ' changed' }
            'executable' { $script:rows[0].ExecutablePath = 'C:\alternate\node.exe' }
            'new-node' { $new = $goodRow.PSObject.Copy(); $new.ProcessId = 52; $script:rows += $new }
            'missing-node' { $script:rows = @() }
            'duplicate' { $script:rows += $goodRow }
            'hidden' { $script:rows[0].CommandLine = '' }
            'live-core' { $script:rows[0].CommandLine = 'node ' + $core }
            'missing-birth' { $script:rows[0].CreationDate = $null }
            'missing-image' { $script:rows[0].ExecutablePath = '' }
            'cap' { $script:rows = @($goodRow) * 129 }
        }
        Denied {
            $after = Get-StephanosCoreProcessIdentityObservation -CoreScript $core
            Assert-StephanosCoreAbsentInventoryPair -Before $before -After $after -ElapsedSeconds 0.1
        }
    }
}
foreach ($age in @(-1,10.001,[double]::NaN,[double]::PositiveInfinity)) {
    Case ('capture-expiry-' + $age) { Denied { Assert-StephanosCoreAbsentInventoryPair -Before $before -After $before -ElapsedSeconds $age } }
}
Case 'unknown complete flag is not absence' {
    $bad = @{inventory=@{complete='true';processCount=0};identities=@{}}
    Denied { Assert-StephanosCoreAbsentInventoryPair -Before $bad -After $bad -ElapsedSeconds 0 }
}
$attempt = [DateTime]::SpecifyKind([DateTime]'2026-11-05T12:00:00', [DateTimeKind]::Utc)
$child = [pscustomobject]@{HasExited=$true;ExitCode=0;Id=51;StartTime=$attempt.AddSeconds(0.1);ExitTime=$attempt.AddSeconds(1.9)}
function Check-Child($Value, [double]$Elapsed = 2, [DateTime]$Now = $attempt.AddSeconds(2)) {
    Assert-StephanosCoreAttendedChildContinuation -Child $Value -ElapsedSeconds $Elapsed -AttemptUtc $attempt -NowUtc $Now -ExpectedPid 51 -ExpectedStartedUtc $attempt.AddSeconds(0.1)
}
Case 'successful just-completed child decision' { Check-Child $child }
foreach ($bad in @($null, [pscustomobject]@{HasExited=$false;ExitCode=0}, [pscustomobject]@{HasExited=$true;ExitCode=2}, [pscustomobject]@{HasExited=$true;ExitCode='0'})) {
    Case 'failed or malformed child decision' { Denied { Check-Child $bad } }
}
foreach ($age in @(-1,120.001,[double]::NaN,[double]::PositiveInfinity)) {
    Case ('child-expiry-' + $age) { Denied { Check-Child $child $age } }
}
foreach ($fault in @('old-exit','future-exit','changed-birth','changed-pid','clock-forward','clock-backward','unspecified-clock')) {
    Case ('native-terminal-' + $fault) {
        $bad = $child.PSObject.Copy()
        $now = $attempt.AddSeconds(2)
        switch ($fault) {
            'old-exit' { $now = $attempt.AddSeconds(32) }
            'future-exit' { $bad.ExitTime = $now.AddSeconds(1) }
            'changed-birth' { $bad.StartTime = $attempt.AddSeconds(0.2) }
            'changed-pid' { $bad.Id = 52 }
            'clock-forward' { $now = $now.AddSeconds(0.2) }
            'clock-backward' { $now = $now.AddSeconds(-0.2) }
            'unspecified-clock' { $now = [DateTime]::SpecifyKind($now,[DateTimeKind]::Unspecified) }
        }
        $elapsed = if ($fault -eq 'old-exit') { 32 } else { 2 }
        Denied { Check-Child $bad $elapsed $now }
    }
}
Case 'real disposable absent and present path' {
    $fixture = Join-Path $PSScriptRoot ('core-absent-test-' + [Guid]::NewGuid().ToString('N'))
    Assert-StephanosCoreLockAbsent -LockPath $fixture
    [IO.File]::WriteAllText($fixture, 'sentinel')
    try {
        Denied { Assert-StephanosCoreLockAbsent -LockPath $fixture }
        if ([IO.File]::ReadAllText($fixture) -cne 'sentinel') { throw 'FIXTURE_MUTATED' }
    } finally { [IO.File]::Delete($fixture) }
}

# Execute the candidate's actual limited-parent continuation with native I/O
# replaced by explicit fixtures. These prove decisions, never native admission.
$entrySource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'recover-stephanos-core-lock.ps1'))
$nativeBegin = $entrySource.IndexOf('            $absence = [StephanosCoreLockRecoveryV1]::new')
$nativeEnd = $entrySource.IndexOf("            Write-CoreRecoveryResult `$true 'CORE_ABSENT_INVENTORY_OBSERVED'", $nativeBegin)
if ($nativeBegin -lt 0 -or $nativeEnd -le $nativeBegin) { throw 'NATIVE_SOURCE_BOUNDARY_MISSING' }
$nativeBody = [scriptblock]::Create($entrySource.Substring($nativeBegin, $nativeEnd - $nativeBegin))
foreach ($fault in @('none','source-drift','node-birth-race','lock-arrival')) {
    Case ('actual-native-child-' + $fault) {
        $script:rows = @($goodRow.PSObject.Copy())
        $script:sourceFault = $fault
        $script:sourceChecks = 0
        $script:localChecks = 0
        $coreScript = $core
        $lockPath = Join-Path $PSScriptRoot ('core-native-test-' + [Guid]::NewGuid().ToString('N'))
        function Assert-CoreRecoverySource { throw 'SLOW_REMOTE_SOURCE_IN_NATIVE_WINDOW' }
        function Assert-CoreRecoveryLocalSource {
            $script:localChecks++
            if ($script:sourceFault -eq 'source-drift') { throw 'SOURCE_DRIFT_FIXTURE' }
            if ($script:sourceFault -eq 'node-birth-race') { $script:rows[0].CreationDate = $goodRow.CreationDate.AddSeconds(1) }
            if ($script:sourceFault -eq 'lock-arrival' -and $script:localChecks -eq 1) { [IO.File]::WriteAllText($lockPath, 'another-owner') }
        }
        try {
            if ($fault -eq 'none') { . $nativeBody }
            else { Denied { . $nativeBody } }
        } finally {
            if ([IO.File]::Exists($lockPath)) { [IO.File]::Delete($lockPath) }
        }
    }
}
$begin = $entrySource.IndexOf("    `$arguments = @('-NoLogo'")
$end = $entrySource.IndexOf('    $statusPath = Join-Path', $begin)
if ($begin -lt 0 -or $end -le $begin) { throw 'PARENT_SOURCE_BOUNDARY_MISSING' }
$parentBody = [scriptblock]::Create($entrySource.Substring($begin, $end - $begin))
foreach ($fault in @('none','child-nonzero','child-not-terminal','child-timeout','source-change','lock-race','forged-success-report','delayed-parent-resumption','delayed-continuation')) {
    Case ('actual-parent-' + $fault) {
        $script:starts = 0
        $script:elevations = 0
        $script:sourceChecks = 0
        $script:testFault = $fault
        $AbsentLock = $true
        $ExpectedHead = 'a' * 40
        $ExpectedLockSha256 = ''
        $powerShell = 'fixed-powershell'
        $entry = 'fixed-entry'
        $node = 'fixed-node'
        $coreScript = 'fixed-core'
        $repoRoot = 'fixed-root'
        $lockPath = Join-Path $PSScriptRoot ('core-race-test-' + [Guid]::NewGuid().ToString('N'))
        $coreStartRequested = $false
        function Assert-CoreRecoverySource { throw 'SLOW_REMOTE_SOURCE_AFTER_CHILD_EXIT' }
        function Assert-CoreRecoveryLocalSource {
            $script:sourceChecks++
            if ($script:testFault -eq 'source-change') { throw 'SOURCE_CHANGED_FIXTURE' }
            if ($script:testFault -eq 'delayed-continuation') { Start-Sleep -Milliseconds 5100 }
        }
        function Start-Process {
            param($FilePath, $ArgumentList, $Verb, $WindowStyle, [switch]$PassThru, [switch]$Wait, $WorkingDirectory)
            if ($FilePath -eq 'fixed-powershell') {
                $script:elevations++
                if ($Verb -cne 'RunAs' -or $Wait -or $ArgumentList -notcontains '-AbsentLock') { throw 'CHILD_ROUTE_CHANGED' }
                if ($script:testFault -eq 'lock-race') { [IO.File]::WriteAllText($lockPath, 'competing-owner') }
                # This fake report is deliberately not a native successful exit.
                $code = if ($script:testFault -in @('child-nonzero','forged-success-report')) { 2 } else { 0 }
                $value = [pscustomobject]@{HasExited=($script:testFault -ne 'child-not-terminal');ExitCode=$code;Id=51;StartTime=[DateTime]::UtcNow;ExitTime=[DateTime]::UtcNow;report=@{ok=$true}}
                $value | Add-Member ScriptMethod WaitForExit {
                    param($Milliseconds)
                    if ($script:testFault -eq 'delayed-parent-resumption') { Start-Sleep -Milliseconds 5100 }
                    return $script:testFault -ne 'child-timeout'
                }
                return $value
            }
            if ($FilePath -cne 'fixed-node' -or $Verb) { throw 'UNEXPECTED_START_ROUTE' }
            $script:starts++
            return [pscustomobject]@{Id=999}
        }
        try {
            if ($fault -eq 'none') {
                . $parentBody
                if ($script:starts -ne 1 -or -not $coreStartRequested -or $script:elevations -ne 1) { throw 'SINGLE_CONTINUATION_MISSING' }
            } else {
                Denied { . $parentBody }
                if ($script:starts -ne 0) { throw 'UNCERTAIN_CHILD_STARTED_CORE' }
            }
        } finally {
            if ([IO.File]::Exists($lockPath)) { [IO.File]::Delete($lockPath) }
        }
    }
}
Case 'native absence pins parent and never mutates a lock' {
    $directory = Join-Path $PSScriptRoot ('absence-native-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($directory)
    $fixture = Join-Path $directory 'lock.json'
    $handle = [StephanosCoreLockRecoveryV1]::new($fixture, $true)
    try {
        $handle.AssertAbsent()
        Denied { [IO.Directory]::Move($directory, ($directory + '-renamed')) }
        Denied { $handle.Archive(($fixture + '.archive')) }
        Denied { $handle.Commit(('a' * 64)) }
        [IO.File]::WriteAllText($fixture, 'competing-owner')
        Denied { $handle.AssertAbsent() }
        if ([IO.File]::ReadAllText($fixture) -cne 'competing-owner') { throw 'COMPETING_OWNER_CHANGED' }
    } finally {
        $handle.Dispose()
        if ([IO.Directory]::Exists(($directory + '-renamed'))) { [IO.Directory]::Move(($directory + '-renamed'), $directory) }
        if ([IO.File]::Exists($fixture)) { [IO.File]::Delete($fixture) }
        [IO.Directory]::Delete($directory)
    }
}
Case 'actual native process terminal time is consumed and ages out' {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $info.Arguments = '-NoProfile -NonInteractive -Command "exit 0"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $request = [DateTime]::UtcNow
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $native = [Diagnostics.Process]::Start($info)
    try {
        $nativePid = $native.Id
        $nativeStarted = $native.StartTime.ToUniversalTime()
        if (-not $native.WaitForExit(5000)) { throw 'BENIGN_NATIVE_FIXTURE_TERMINAL_UNPROVEN' }
        Assert-StephanosCoreAttendedChildContinuation -Child $native -ElapsedSeconds $clock.Elapsed.TotalSeconds -AttemptUtc $request -NowUtc ([DateTime]::UtcNow) -ExpectedPid $nativePid -ExpectedStartedUtc $nativeStarted
        $late = $native.ExitTime.ToUniversalTime().AddSeconds(6)
        Denied { Assert-StephanosCoreAttendedChildContinuation -Child $native -ElapsedSeconds ($late - $request).TotalSeconds -AttemptUtc $request -NowUtc $late -ExpectedPid $nativePid -ExpectedStartedUtc $nativeStarted }
    } finally { $native.Dispose() }
}

# Exercise production local Git continuity on real disposable Windows metadata.
# No protected checkout, network, elevation or Core process is touched.
Case 'actual fixed local Git continuity and adversarial drift' {
    $git = 'C:\Program Files\Git\cmd\git.exe'
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('core-local-git-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($scratch)
    $savedGitEnv = @(Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_' } | ForEach-Object {
        [pscustomobject]@{ Name=$_.Name; Value=$_.Value }
    })
    try {
        foreach ($row in $savedGitEnv) { [Environment]::SetEnvironmentVariable($row.Name, $null, 'Process') }
        & $git init --initial-branch=main $scratch | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_INIT_FAILED' }
        $pin = Join-Path $scratch 'pinned-source.txt'
        [IO.File]::WriteAllText($pin, 'canonical')
        & $git -C $scratch add pinned-source.txt
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_ADD_FAILED' }
        & $git -C $scratch -c 'user.name=Fixture' -c 'user.email=fixture@example.invalid' commit -m initial | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_COMMIT_FAILED' }
        # A configured local-only remote is required for Git to recognise
        # refs/remotes/origin/main as a tracking branch. Never fetch from it.
        & $git -C $scratch remote add origin $scratch
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_ORIGIN_FAILED' }
        & $git -C $scratch update-ref refs/remotes/origin/main HEAD
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_REMOTE_FAILED' }
        & $git -C $scratch branch --set-upstream-to=origin/main main | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_UPSTREAM_FAILED' }
        $ExpectedHead = (& $git -C $scratch rev-parse HEAD).Trim()
        $repoRoot = $scratch
        $sourceFiles = @($pin)
        $sourceDigests = @{}
        $gitMetadataPaths = @((Join-Path $scratch '.git\config'), (Join-Path $scratch '.git\index'))
        $gitMetadataDigests = @{}
        $digestStart = $entrySource.IndexOf('function Get-CoreRecoveryDigest')
        $localStart = $entrySource.IndexOf('function Assert-CoreRecoveryLocalSource', $digestStart)
        $envStart = $entrySource.IndexOf('function Assert-CoreRecoveryEnvironment', $localStart)
        if ($digestStart -lt 0 -or $localStart -le $digestStart -or $envStart -le $localStart) { throw 'LOCAL_GIT_ACTUAL_SOURCE_BOUNDARY_MISSING' }
        . ([scriptblock]::Create($entrySource.Substring($digestStart, $localStart - $digestStart)))
        . ([scriptblock]::Create($entrySource.Substring($localStart, $envStart - $localStart)))
        function Assert-CoreRecoveryEnvironment { }
        $sourceDigests[$pin] = Get-CoreRecoveryDigest $pin
        foreach ($file in $gitMetadataPaths) { $gitMetadataDigests[$file] = Get-CoreRecoveryDigest $file }
        Assert-CoreRecoveryLocalSource

        [IO.File]::WriteAllText($pin, 'changed')
        Denied { Assert-CoreRecoveryLocalSource }
        [IO.File]::WriteAllText($pin, 'canonical')
        Assert-CoreRecoveryLocalSource

        $config = $gitMetadataPaths[0]
        $originalConfig = [IO.File]::ReadAllBytes($config)
        [IO.File]::AppendAllText($config, [Environment]::NewLine + '# injected')
        Denied { Assert-CoreRecoveryLocalSource }
        [IO.File]::WriteAllBytes($config, $originalConfig)
        Assert-CoreRecoveryLocalSource

        $index = $gitMetadataPaths[1]
        $originalIndex = [IO.File]::ReadAllBytes($index)
        [IO.File]::AppendAllText($index, '!')
        Denied { Assert-CoreRecoveryLocalSource }
        [IO.File]::WriteAllBytes($index, $originalIndex)
        Assert-CoreRecoveryLocalSource

        $env:GIT_DIR = $scratch
        Denied { Assert-CoreRecoveryLocalSource }
        [Environment]::SetEnvironmentVariable('GIT_DIR', $null, 'Process')
        Assert-CoreRecoveryLocalSource

        & $git -C $scratch symbolic-ref HEAD refs/heads/other
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_REPOINT_FAILED' }
        Denied { Assert-CoreRecoveryLocalSource }
        & $git -C $scratch symbolic-ref HEAD refs/heads/main
        if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GIT_FIXTURE_RESTORE_FAILED' }
        Assert-CoreRecoveryLocalSource
    } finally {
        foreach ($row in $savedGitEnv) { [Environment]::SetEnvironmentVariable($row.Name, $row.Value, 'Process') }
        if ([IO.Directory]::Exists($scratch)) {
            # Git object files are read-only on Windows; clear only this
            # uniquely generated temporary fixture's file attributes.
            foreach ($file in [IO.Directory]::EnumerateFiles($scratch, '*', [IO.SearchOption]::AllDirectories)) {
                [IO.File]::SetAttributes($file, [IO.FileAttributes]::Normal)
            }
            [IO.Directory]::Delete($scratch, $true)
        }
    }
}

Write-Output ('CORE_ABSENT_BOOTSTRAP_POLICY_TESTS_PASS=' + $script:passed)
