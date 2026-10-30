$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'stephanos-core-lock-recovery-policy.ps1')
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'StephanosCoreLockRecoveryV1.cs')))
$root = Join-Path ([IO.Path]::GetTempPath()) ('core-recovery-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$script:cases = 0
function Assert-True($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Assert-Throws([scriptblock]$Run, [string]$Message) {
    $failed = $false
    try { & $Run } catch { $failed = $true }
    Assert-True $failed $Message
}
$record = @{ schemaVersion = 'stephanos.core-daemon-lock.v1'; pid = 4102; sourceHead = ('a' * 40); startedAtUtc = '2026-01-01T00:00:00.000Z' } | ConvertTo-Json -Compress
$boot = [DateTime]'2026-01-02T00:00:00Z'
$now = [DateTime]'2026-01-03T00:00:00Z'
function New-Fixture {
    $script:cases++
    $path = Join-Path $root ('lock-' + $script:cases + '.json')
    [IO.File]::WriteAllText($path, $record, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::SetCreationTimeUtc($path, [DateTime]'2026-01-01T00:00:00Z')
    [IO.File]::SetLastWriteTimeUtc($path, [DateTime]'2026-01-01T00:00:00Z')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    @{ path = $path; digest = $digest; archive = ($path + '.archive') }
}
$good = { param($OwnerPid) @{ inventory = @{complete=$true; processCount=0}; bootUtc=$boot; nowUtc=$now; pidPresent=$false } }
try {
    $freshLock = @{schemaVersion='stephanos.core-daemon-lock.v1'; pid=51; sourceHead=('a'*40); startedAtUtc='2026-01-03T00:00:01.000Z'}
    $freshStatus = @{schemaVersion='shared-agent-workspace-record.v1'; kind='stephanos.shared_workspace.status'; statusId='stephanos-core-daemon-current'; processId=51; sourceHead=('a'*40); timestampUtc='2026-01-03T00:00:02.000Z'; heartbeatAtUtc='2026-01-03T00:00:02.000Z'}
    $checkFresh = { param($Status) Test-StephanosRecoveredCoreHeartbeat -Lock $freshLock -Status $Status -StartedPid 51 -ExpectedHead ('a'*40) -AttemptUtc $now -NowUtc $now.AddSeconds(3) }
    Assert-True (& $checkFresh $freshStatus) 'FRESH_HEARTBEAT_NOT_ACCEPTED'
    foreach ($change in @(@{processId=52}, @{sourceHead=('b'*40)}, @{schemaVersion='forged'}, @{timestampUtc='2026-01-03T00:00:04.000Z'; heartbeatAtUtc='2026-01-03T00:00:04.000Z'}, @{timestampUtc='2026-01-01T00:00:00.000Z'}, @{heartbeatAtUtc='invalid'})) {
        $bad = $freshStatus.Clone()
        foreach ($key in $change.Keys) { $bad[$key] = $change[$key] }
        Assert-True (-not (& $checkFresh $bad)) 'FALSE_HEARTBEAT_ACCEPTED'
    }
    # Real Windows handles: competing opens, writers and path replacements fail.
    $fixture = New-Fixture
    $handle = [StephanosCoreLockRecoveryV1]::new($fixture.path)
    try {
        Assert-Throws { [StephanosCoreLockRecoveryV1]::new($fixture.path) } 'COMPETING_RECOVERY_OPENED'
        Assert-Throws { [IO.File]::WriteAllText($fixture.path, 'replacement') } 'LOCK_WRITE_WAS_ALLOWED'
        Assert-Throws { [IO.File]::Move($fixture.path, ($fixture.path + '.moved')) } 'LOCK_RENAME_WAS_ALLOWED'
        Assert-Throws { $handle.Commit(('b' * 64)) } 'WRONG_DIGEST_DELETED_LOCK'
    } finally { $handle.Dispose() }
    Assert-True ([IO.File]::Exists($fixture.path)) 'REFUSAL_REMOVED_LOCK'

    # Exercise the actual retirement function against native temporary handles.
    foreach ($fault in @('none','hidden','live-core','pid-reused','second-observation','source-change','archive-failure','same-boot','boot-change','digest-change')) {
        $fixture = New-Fixture
        $handle = [StephanosCoreLockRecoveryV1]::new($fixture.path)
        $script:observations = 0; $script:sourceReads = 0
        $observe = {
            param($OwnerPid)
            $script:observations++
            $value = & $good $OwnerPid
            if ($fault -eq 'hidden') { $value.inventory.complete = $false; $value.inventory.processCount = $null }
            if ($fault -eq 'live-core' -or ($fault -eq 'second-observation' -and $script:observations -eq 2)) { $value.inventory.processCount = 1 }
            if ($fault -eq 'pid-reused') { $value.pidPresent = $true }
            if ($fault -eq 'same-boot') { $value.bootUtc = [DateTime]'2025-12-31T00:00:00Z' }
            if ($fault -eq 'boot-change' -and $script:observations -eq 2) { $value.bootUtc = $boot.AddMinutes(1) }
            $value
        }
        $source = { $script:sourceReads++; if ($fault -eq 'source-change' -and $script:sourceReads -eq 2) { throw 'SOURCE_CHANGED' } }
        if ($fault -eq 'archive-failure') { [IO.File]::WriteAllText($fixture.archive, 'existing') }
        $digest = if ($fault -eq 'digest-change') { 'b' * 64 } else { $fixture.digest }
        try {
            $invoke = { Invoke-StephanosCoreLockRetirement -Handle $handle -ExpectedDigest $digest -Observe $observe -AssertSource $source -ArchivePath $fixture.archive }
            if ($fault -eq 'none') { & $invoke } else { Assert-Throws $invoke ('FAULT_NOT_BLOCKED_' + $fault) }
        } finally { $handle.Dispose() }
        if ($fault -eq 'none') {
            Assert-True (-not [IO.File]::Exists($fixture.path)) 'ORIGINAL_LOCK_NOT_RETIRED'
            Assert-True ([IO.File]::ReadAllText($fixture.archive) -ceq $record) 'ARCHIVE_NOT_EXACT'
            [IO.File]::WriteAllText($fixture.path, 'successor-lock')
            $handle.Dispose()
            Assert-True ([IO.File]::ReadAllText($fixture.path) -ceq 'successor-lock') 'SUCCESSOR_LOCK_REMOVED'
        } else { Assert-True ([IO.File]::ReadAllText($fixture.path) -ceq $record) ('LOCK_CHANGED_' + $fault) }
    }

    $fixture = New-Fixture
    $link = $fixture.path + '.linked'
    New-Item -ItemType HardLink -Path $link -Target $fixture.path | Out-Null
    Assert-Throws { [StephanosCoreLockRecoveryV1]::new($fixture.path) } 'MULTIPLE_LINKS_ACCEPTED'
    $junction = Join-Path $root 'junction'
    $target = Join-Path $root 'target'
    [IO.Directory]::CreateDirectory($target) | Out-Null
    New-Item -ItemType Junction -Path $junction -Target $target | Out-Null
    [IO.File]::WriteAllText((Join-Path $target 'lock.json'), $record)
    Assert-Throws { [StephanosCoreLockRecoveryV1]::new((Join-Path $junction 'lock.json')) } 'REPARSE_ANCESTOR_ACCEPTED'
    # Remove only the junction itself; never recurse through its target.
    [IO.Directory]::Delete($junction)
    Write-Output ('CORE_RECOVERY_NATIVE_FIXTURES_PASS=' + $script:cases)
} finally {
    if ([IO.Path]::GetFullPath($root).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
