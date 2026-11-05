# Pure decision policy, shared by production and native fixture tests.
function Assert-StephanosCoreAbsentInventoryPair {
    param($Before, $After, [double]$ElapsedSeconds)
    if ([double]::IsNaN($ElapsedSeconds) -or [double]::IsInfinity($ElapsedSeconds) -or
        $ElapsedSeconds -lt 0 -or $ElapsedSeconds -gt 10) { throw 'CORE_RECOVERY_INVENTORY_EXPIRED' }
    foreach ($capture in @($Before, $After)) {
        if ($null -eq $capture -or $capture.inventory.complete -isnot [bool] -or
            -not $capture.inventory.complete -or $capture.inventory.processCount -isnot [int] -or
            $capture.inventory.processCount -ne 0 -or $capture.identities -isnot [hashtable] -or
            $capture.identities.Count -gt 128) { throw 'CORE_PROCESS_INVENTORY_UNPROVEN' }
        foreach ($key in $capture.identities.Keys) {
            if ($key -isnot [string] -or $key -cnotmatch '^[1-9][0-9]{0,9}$' -or
                $capture.identities[$key] -isnot [string] -or
                [string]::IsNullOrWhiteSpace($capture.identities[$key])) { throw 'CORE_RECOVERY_PROCESS_IDENTITY_UNPROVEN' }
        }
    }
    if ($Before.identities.Count -ne $After.identities.Count) { throw 'CORE_RECOVERY_PROCESS_SET_CHANGED' }
    foreach ($key in $Before.identities.Keys) {
        if (-not $After.identities.ContainsKey($key) -or
            $Before.identities[$key] -cne $After.identities[$key]) { throw 'CORE_RECOVERY_PROCESS_IDENTITY_CHANGED' }
    }
}

function Assert-StephanosCoreLockAbsent {
    param([Parameter(Mandatory = $true)][string]$LockPath)
    try { [void][IO.File]::GetAttributes($LockPath) }
    catch [IO.FileNotFoundException] { return }
    catch [IO.DirectoryNotFoundException] { return }
    # Access denied, malformed paths and all other failures remain unknown.
    throw 'CORE_RECOVERY_LOCK_NOT_ABSENT'
}

function Assert-StephanosCoreAttendedChildContinuation {
    param($Child, [double]$ElapsedSeconds, [DateTime]$AttemptUtc,
        [DateTime]$NowUtc, [int]$ExpectedPid, [DateTime]$ExpectedStartedUtc)
    if ($null -eq $Child -or -not $Child.HasExited -or $Child.ExitCode -isnot [int] -or
        $Child.ExitCode -ne 0 -or [double]::IsNaN($ElapsedSeconds) -or
        [double]::IsInfinity($ElapsedSeconds) -or $ElapsedSeconds -lt 0 -or
        $ElapsedSeconds -gt 120) { throw 'CORE_RECOVERY_CHILD_BLOCKED_OR_EXPIRED' }
    # ExitTime/StartTime are read from the actual Process returned by this
    # parent's fixed RunAs launch. No receipt or caller-supplied PID is loaded.
    if ($ExpectedPid -le 0 -or $Child.Id -ne $ExpectedPid -or
        $Child.StartTime -isnot [DateTime] -or $Child.ExitTime -isnot [DateTime] -or
        $AttemptUtc.Kind -ne [DateTimeKind]::Utc -or $NowUtc.Kind -ne [DateTimeKind]::Utc -or
        $ExpectedStartedUtc.Kind -ne [DateTimeKind]::Utc) { throw 'CORE_RECOVERY_CHILD_IDENTITY_UNPROVEN' }
    $started = $Child.StartTime.ToUniversalTime()
    $exited = $Child.ExitTime.ToUniversalTime()
    $age = ($NowUtc - $exited).TotalSeconds
    $wallElapsed = ($NowUtc - $AttemptUtc).TotalSeconds
    if ($started -ne $ExpectedStartedUtc -or $started -lt $AttemptUtc -or
        $exited -lt $started -or $age -lt 0 -or $age -gt 4.9 -or
        [Math]::Abs($wallElapsed - $ElapsedSeconds) -gt 0.1) {
        throw 'CORE_RECOVERY_CHILD_BLOCKED_OR_EXPIRED'
    }
}

function Test-StephanosRecoveredCoreHeartbeat {
    param($Lock, $Status, [int]$StartedPid, [string]$ExpectedHead, [DateTime]$AttemptUtc, [DateTime]$NowUtc)
    try {
        $when = [DateTime]::Parse($Status.timestampUtc).ToUniversalTime()
        $heartbeat = [DateTime]::Parse($Status.heartbeatAtUtc).ToUniversalTime()
        $started = [DateTime]::Parse($Lock.startedAtUtc).ToUniversalTime()
        return $Lock.schemaVersion -ceq 'stephanos.core-daemon-lock.v1' -and
            $Status.schemaVersion -ceq 'shared-agent-workspace-record.v1' -and
            $Status.kind -ceq 'stephanos.shared_workspace.status' -and
            $Status.statusId -ceq 'stephanos-core-daemon-current' -and
            $Lock.pid -eq $StartedPid -and $Status.processId -eq $StartedPid -and
            $Lock.sourceHead -ceq $ExpectedHead -and $Status.sourceHead -ceq $ExpectedHead -and
            $started -ge $AttemptUtc -and $started -le $NowUtc -and
            $when -eq $heartbeat -and $when -ge $started -and $when -le $NowUtc -and
            ($NowUtc - $when).TotalSeconds -le 30
    } catch { return $false }
}

function Assert-StephanosCoreLockRecoveryEvidence {
    param($Lock, [string]$Digest, [string]$ExpectedDigest, $Observation,
        [DateTime]$BootUtc, [DateTime]$NowUtc, [DateTime]$CreatedUtc, [DateTime]$WrittenUtc,
        [bool]$LockPidPresent)
    if ($ExpectedDigest -cnotmatch '^[a-f0-9]{64}$' -or $Digest -cne $ExpectedDigest) { throw 'CORE_RECOVERY_DIGEST_MISMATCH' }
    if ($null -eq $Lock -or $Lock.schemaVersion -cne 'stephanos.core-daemon-lock.v1' -or
        $Lock.pid -isnot [int] -or $Lock.pid -le 0 -or
        $Lock.sourceHead -cnotmatch '^[a-f0-9]{40}$' -or
        $Lock.startedAtUtc -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { throw 'CORE_RECOVERY_LOCK_INVALID' }
    $started = [DateTime]::ParseExact($Lock.startedAtUtc, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
    if ($BootUtc -ge $NowUtc -or $started -ge $BootUtc -or $CreatedUtc -ge $BootUtc -or $WrittenUtc -ge $BootUtc) { throw 'CORE_RECOVERY_PREBOOT_LOCK_UNPROVEN' }
    if ($Observation.complete -ne $true -or $null -eq $Observation.processCount) { throw 'CORE_PROCESS_INVENTORY_UNPROVEN' }
    if ($Observation.processCount -ne 0 -or $LockPidPresent) { throw 'CORE_RECOVERY_PROCESS_PRESENT' }
}

function Invoke-StephanosCoreLockRetirement {
    param($Handle, [string]$ExpectedDigest, [scriptblock]$Observe, [scriptblock]$AssertSource, [string]$ArchivePath)
    $lock = $Handle.Text | ConvertFrom-Json -ErrorAction Stop
    & $AssertSource
    $before = & $Observe $lock.pid
    Assert-StephanosCoreLockRecoveryEvidence -Lock $lock -Digest $Handle.Digest -ExpectedDigest $ExpectedDigest -Observation $before.inventory -BootUtc $before.bootUtc -NowUtc $before.nowUtc -CreatedUtc $Handle.CreatedUtc -WrittenUtc $Handle.WrittenUtc -LockPidPresent $before.pidPresent
    $Handle.Archive($ArchivePath)
    & $AssertSource
    $after = & $Observe $lock.pid
    if ($after.bootUtc -ne $before.bootUtc) { throw 'CORE_RECOVERY_BOOT_CHANGED' }
    Assert-StephanosCoreLockRecoveryEvidence -Lock $lock -Digest $Handle.Digest -ExpectedDigest $ExpectedDigest -Observation $after.inventory -BootUtc $after.bootUtc -NowUtc $after.nowUtc -CreatedUtc $Handle.CreatedUtc -WrittenUtc $Handle.WrittenUtc -LockPidPresent $after.pidPresent
    $Handle.Commit($ExpectedDigest)
}
