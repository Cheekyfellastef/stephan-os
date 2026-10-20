[CmdletBinding()]
param()

# Fixed, unattended Sovereign CPU relief: one demonstrably orphaned, CPU-hot,
# historical Recovery Lifeboat process only. No caller-controlled paths/PIDs.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$schema = 'stephanos.battle-bridge-verified-cpu-relief.v1'
$verdict = 'CPU_RELIEF_HELD'
$blocker = ''
$selectedPid = 0
$selectedStart = ''
$preCpu = $null
$postCpu = $null
$selectedScript = ''
$terminated = $false
$handle = $null
$cpuAfter = $null
$cpuReductionVerified = $false
$sampleSeconds = 5
$minimumProcessAgeMinutes = 15
$minimumWholeCpuPct = 80
$minimumCandidateCpuPct = 5
$root = Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'
$taskName = 'Stephanos Battle Bridge Recovery Lifeboat'
$gamingNames = @('Starfield','SkyrimVR','SkyrimSE','Cyberpunk2077','RDR2','NMS','NoMansSky','Borderlands2','vrserver','vrcompositor','steamvr')
$allowed = @(
    (Join-Path $root 'run-battle-bridge-recovery-lifeboat-active-v1.ps1'),
    (Join-Path $root 'banks\A\run-battle-bridge-recovery-lifeboat-bank-v1.ps1'),
    (Join-Path $root 'banks\B\run-battle-bridge-recovery-lifeboat-bank-v1.ps1')
)
function Resolve-OwnerSid([string]$Identity) {
    if (-not $Identity) { return '' }
    try {
        if ($Identity -match '^S-\\d-\\d+(?:-\\d+)+
    $cpu = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
    if ($cpu.Count -lt 1 -or @($cpu | Where-Object { $null -eq $_.LoadPercentage }).Count -gt 0) {
        throw 'CPU_TOTAL_COUNTER_UNAVAILABLE'
    }
    return [double](($cpu | Measure-Object -Property LoadPercentage -Average).Average)
}
function Test-GamingInactive {
    # An unavailable process query never becomes an unsafe "no game" result.
    $all = @(Get-Process -ErrorAction Stop)
    return @($all | Where-Object { $gamingNames -contains $_.ProcessName }).Count -eq 0
}
function Get-ApprovedScript([string]$CommandLine) {
    # Exactly -File and an installed, fixed lifeboat script; no -Command or
    # encoded command. The relative script basename alone is insufficient.
    if ([string]::IsNullOrWhiteSpace($CommandLine) -or $CommandLine -match '(?i)\s-(?:command|encodedcommand|enc)\b') { return '' }
    foreach ($path in $allowed) {
        $quoted = [regex]::Escape($path)
        if ($CommandLine -match ('(?i)(?:^|\s)-File\s+(?:"{0}"|{0})(?:\s|$)' -f $quoted)) {
            return [System.IO.Path]::GetFileName($path)
        }
    }
    return ''
}
function Test-MatchingCimProcess($Before, $After) {
    if ($null -eq $Before -or $null -eq $After) { return $false }
    $difference = [math]::Abs(($Before.CreationDate.ToUniversalTime() - $After.CreationDate.ToUniversalTime()).TotalMilliseconds)
    return [bool](($Before.ProcessId -eq $After.ProcessId) -and ($difference -le 2) -and ([string]$Before.CommandLine -ceq [string]$After.CommandLine) -and ([int]$Before.ParentProcessId -eq [int]$After.ParentProcessId))
}
try {
    if (-not $env:LOCALAPPDATA) { throw 'CPU_RELIEF_LOCALAPPDATA_UNAVAILABLE' }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if (-not (Test-CanonicalLifeboatTask $task)) {
        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_IDENTITY_INVALID'
    } elseif ([string]$task.State -eq 'Running') {
        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_ACTIVE'
    } elseif ([string]$task.State -ne 'Ready') {
        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_NOT_READY'
    } elseif (-not (Test-GamingInactive)) {
        $blocker = 'CPU_RELIEF_GAMING_PROTECTED'
    } else {
        $preCpu = Get-TotalCpuLoad
        if ($preCpu -lt $minimumWholeCpuPct) {
            $verdict = 'CPU_RELIEF_NOT_NEEDED'
        } else {
            $selfSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            $inventory = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop)
            $candidate = $null
            foreach ($item in $inventory) {
                $scriptName = Get-ApprovedScript ([string]$item.CommandLine)
                if (-not $scriptName) { continue }
                $started = $item.CreationDate.ToUniversalTime()
                if (([DateTime]::UtcNow - $started).TotalMinutes -lt $minimumProcessAgeMinutes) { continue }
                $parentId = [int]$item.ParentProcessId
                if ($parentId -lt 1) { continue }
                $parent = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $parentId) -ErrorAction Stop
                if ($null -ne $parent -and $parent.CreationDate.ToUniversalTime() -le $started) { continue }
                $owner = Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid -ErrorAction Stop
                if ($owner.ReturnValue -ne 0 -or [string]$owner.Sid -cne $selfSid) { continue }
                if ($null -eq $candidate -or $item.CreationDate.ToUniversalTime() -lt $candidate.CreationDate.ToUniversalTime()) {
                    # Work-conserving: choose only the oldest *verified* orphan.
                    # Later cycles may handle the next independent stale chain.
                    $candidate = $item
                    $selectedScript = $scriptName
                }
            }
            if ($null -ne $candidate -and -not $blocker) {
                $processId = [int]$candidate.ProcessId
                $handle = [Diagnostics.Process]::GetProcessById($processId)
                $null = $handle.Handle
                $handleStartUtc = $handle.StartTime.ToUniversalTime()
                if ([math]::Abs(($handleStartUtc - $candidate.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 2) {
                    $blocker = 'CPU_RELIEF_PROCESS_IDENTITY_CHANGED'
                } else {
                    $initialCpuTime = [double]$handle.TotalProcessorTime.TotalSeconds
                    Start-Sleep -Seconds $sampleSeconds
                    $handle.Refresh()
                    $followup = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $processId) -ErrorAction Stop
                    $postCpu = Get-TotalCpuLoad
                    if (-not (Test-MatchingCimProcess $candidate $followup)) {
                        $blocker = 'CPU_RELIEF_PROCESS_IDENTITY_CHANGED'
                    } elseif (-not (Test-GamingInactive)) {
                        $blocker = 'CPU_RELIEF_GAMING_PROTECTED'
                    } elseif (-not (Test-CanonicalLifeboatTask (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop))) {
                        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_IDENTITY_CHANGED'
                    } elseif ([string](Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State -ne 'Ready') {
                        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_CHANGED'
                    } elseif ($postCpu -lt $minimumWholeCpuPct) {
                        $verdict = 'CPU_RELIEF_PRESSURE_CLEARED'
                    } else {
                        $candidateCpuPct = ([double]$handle.TotalProcessorTime.TotalSeconds - $initialCpuTime) * 100 / $sampleSeconds / [Environment]::ProcessorCount
                        if ($candidateCpuPct -lt $minimumCandidateCpuPct) {
                            $verdict = 'CPU_RELIEF_TARGET_NOT_HOT'
                        } else {
                            # The Process object owns a verified handle to this exact
                            # original process, not a potentially reused bare PID.
                            $selectedPid = $processId
                            $selectedStart = $handleStartUtc.ToString('o')
                            $handle.Kill()
                            if (-not $handle.WaitForExit(7000)) {
                                $blocker = 'CPU_RELIEF_TERMINATION_UNVERIFIED'
                            } else {
                                $terminated = $true
                                Start-Sleep -Seconds 2
                                $cpuAfter = Get-TotalCpuLoad
                                $cpuReductionVerified = ($postCpu - $cpuAfter) -ge 5
                                $verdict = if ($cpuReductionVerified) {
                                    'CPU_RELIEF_ORPHAN_TERMINATED_CPU_IMPROVED'
                                } else {
                                    'CPU_RELIEF_ORPHAN_TERMINATED_CPU_RECHECK_REQUIRED'
                                }
                            }
                        }
                    }
                }
            } elseif (-not $blocker) {
                $verdict = 'CPU_RELIEF_NO_VERIFIED_ORPHAN'
            }
        }
    }
} catch {
    $blocker = 'CPU_RELIEF_EVIDENCE_OR_OS_FAILURE'
} finally {
    if ($null -ne $handle) { try { $handle.Dispose() } catch {} }
}
[pscustomobject]@{
    schemaVersion = $schema
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    ok = (-not $blocker)
    blocker = $blocker
    finalVerdict = if ($blocker) { 'CPU_RELIEF_BLOCKED' } else { $verdict }
    taskIdentity = $taskName
    rootScopedToLifeboat = $true
    minimumProcessAgeMinutes = $minimumProcessAgeMinutes
    minimumWholeCpuPct = $minimumWholeCpuPct
    minimumCandidateCpuPct = $minimumCandidateCpuPct
    beforeSystemCpuPct = $preCpu
    sampledSystemCpuPct = $postCpu
    verifiedOrphanPid = $selectedPid
    verifiedOrphanStartedAtUtc = $selectedStart
    fixedScriptBasename = $selectedScript
    oneProcessTerminated = $terminated
    afterSystemCpuPct = $cpuAfter
    cpuReductionVerified = $cpuReductionVerified
    arbitraryPidAllowed = $false
    arbitraryPathAllowed = $false
    arbitraryShellAllowed = $false
    vrProcessTerminationAllowed = $false
    protectedServiceTerminationAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
    unknownMeansGreen = $false
} | ConvertTo-Json -Compress -Depth 4
) { return ([System.Security.Principal.SecurityIdentifier]::new($Identity)).Value }
        return ([System.Security.Principal.NTAccount]::new($Identity)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch { return '' }
}
function Test-CanonicalLifeboatTask($Task) {
    if ($null -eq $Task) { return $false }
    $actions = @($Task.Actions)
    $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $expectedArguments = '//B //Nologo "' + (Join-Path $root 'run-battle-bridge-recovery-lifeboat-windowless-v2.vbs') + '"'
    return [bool]($actions.Count -eq 1 -and
        [string]$Task.TaskPath -ceq '\\' -and
        (Resolve-OwnerSid ([string]$Task.Principal.UserId)) -ceq $userSid -and
        [string]$Task.Principal.LogonType -ceq 'Interactive' -and
        [string]$Task.Principal.RunLevel -ceq 'Limited' -and
        [string]$Task.Settings.MultipleInstances -ceq 'IgnoreNew' -and
        $Task.Settings.Enabled -eq $true -and
        [string]$actions[0].Execute -ieq 'C:\\Windows\\System32\\wscript.exe' -and
        [string]$actions[0].Arguments -ceq $expectedArguments)
}
function Get-TotalCpuLoad {
    $cpu = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
    if ($cpu.Count -lt 1 -or @($cpu | Where-Object { $null -eq $_.LoadPercentage }).Count -gt 0) {
        throw 'CPU_TOTAL_COUNTER_UNAVAILABLE'
    }
    return [double](($cpu | Measure-Object -Property LoadPercentage -Average).Average)
}
function Test-GamingInactive {
    # An unavailable process query never becomes an unsafe "no game" result.
    $all = @(Get-Process -ErrorAction Stop)
    return @($all | Where-Object { $gamingNames -contains $_.ProcessName }).Count -eq 0
}
function Get-ApprovedScript([string]$CommandLine) {
    # Exactly -File and an installed, fixed lifeboat script; no -Command or
    # encoded command. The relative script basename alone is insufficient.
    if ([string]::IsNullOrWhiteSpace($CommandLine) -or $CommandLine -match '(?i)\s-(?:command|encodedcommand|enc)\b') { return '' }
    foreach ($path in $allowed) {
        $quoted = [regex]::Escape($path)
        if ($CommandLine -match ('(?i)(?:^|\s)-File\s+(?:"{0}"|{0})(?:\s|$)' -f $quoted)) {
            return [System.IO.Path]::GetFileName($path)
        }
    }
    return ''
}
function Test-MatchingCimProcess($Before, $After) {
    if ($null -eq $Before -or $null -eq $After) { return $false }
    $difference = [math]::Abs(($Before.CreationDate.ToUniversalTime() - $After.CreationDate.ToUniversalTime()).TotalMilliseconds)
    return [bool](($Before.ProcessId -eq $After.ProcessId) -and ($difference -le 2) -and ([string]$Before.CommandLine -ceq [string]$After.CommandLine) -and ([int]$Before.ParentProcessId -eq [int]$After.ParentProcessId))
}
try {
    if (-not $env:LOCALAPPDATA) { throw 'CPU_RELIEF_LOCALAPPDATA_UNAVAILABLE' }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if ([string]$task.State -eq 'Running') {
        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_ACTIVE'
    } elseif ([string]$task.State -ne 'Ready') {
        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_NOT_READY'
    } elseif (-not (Test-GamingInactive)) {
        $blocker = 'CPU_RELIEF_GAMING_PROTECTED'
    } else {
        $preCpu = Get-TotalCpuLoad
        if ($preCpu -lt $minimumWholeCpuPct) {
            $verdict = 'CPU_RELIEF_NOT_NEEDED'
        } else {
            $selfSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            $inventory = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop)
            $candidate = $null
            foreach ($item in $inventory) {
                $scriptName = Get-ApprovedScript ([string]$item.CommandLine)
                if (-not $scriptName) { continue }
                $started = $item.CreationDate.ToUniversalTime()
                if (([DateTime]::UtcNow - $started).TotalMinutes -lt $minimumProcessAgeMinutes) { continue }
                $parentId = [int]$item.ParentProcessId
                if ($parentId -lt 1) { continue }
                $parent = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $parentId) -ErrorAction Stop
                if ($null -ne $parent -and $parent.CreationDate.ToUniversalTime() -le $started) { continue }
                $owner = Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid -ErrorAction Stop
                if ($owner.ReturnValue -ne 0 -or [string]$owner.Sid -cne $selfSid) { continue }
                if ($null -eq $candidate -or $item.CreationDate.ToUniversalTime() -lt $candidate.CreationDate.ToUniversalTime()) {
                    # Work-conserving: choose only the oldest *verified* orphan.
                    # Later cycles may handle the next independent stale chain.
                    $candidate = $item
                    $selectedScript = $scriptName
                }
            }
            if ($null -ne $candidate -and -not $blocker) {
                $processId = [int]$candidate.ProcessId
                $handle = [Diagnostics.Process]::GetProcessById($processId)
                $null = $handle.Handle
                $handleStartUtc = $handle.StartTime.ToUniversalTime()
                if ([math]::Abs(($handleStartUtc - $candidate.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 2) {
                    $blocker = 'CPU_RELIEF_PROCESS_IDENTITY_CHANGED'
                } else {
                    $initialCpuTime = [double]$handle.TotalProcessorTime.TotalSeconds
                    Start-Sleep -Seconds $sampleSeconds
                    $handle.Refresh()
                    $followup = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $processId) -ErrorAction Stop
                    $postCpu = Get-TotalCpuLoad
                    if (-not (Test-MatchingCimProcess $candidate $followup)) {
                        $blocker = 'CPU_RELIEF_PROCESS_IDENTITY_CHANGED'
                    } elseif (-not (Test-GamingInactive)) {
                        $blocker = 'CPU_RELIEF_GAMING_PROTECTED'
                    } elseif ([string](Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State -ne 'Ready') {
                        $blocker = 'CPU_RELIEF_LIFEBOAT_TASK_CHANGED'
                    } elseif ($postCpu -lt $minimumWholeCpuPct) {
                        $verdict = 'CPU_RELIEF_PRESSURE_CLEARED'
                    } else {
                        $candidateCpuPct = ([double]$handle.TotalProcessorTime.TotalSeconds - $initialCpuTime) * 100 / $sampleSeconds / [Environment]::ProcessorCount
                        if ($candidateCpuPct -lt $minimumCandidateCpuPct) {
                            $verdict = 'CPU_RELIEF_TARGET_NOT_HOT'
                        } else {
                            # The Process object owns a verified handle to this exact
                            # original process, not a potentially reused bare PID.
                            $selectedPid = $processId
                            $selectedStart = $handleStartUtc.ToString('o')
                            $handle.Kill()
                            if (-not $handle.WaitForExit(7000)) {
                                $blocker = 'CPU_RELIEF_TERMINATION_UNVERIFIED'
                            } else {
                                $terminated = $true
                                Start-Sleep -Seconds 2
                                $cpuAfter = Get-TotalCpuLoad
                                $cpuReductionVerified = ($postCpu - $cpuAfter) -ge 5
                                $verdict = if ($cpuReductionVerified) {
                                    'CPU_RELIEF_ORPHAN_TERMINATED_CPU_IMPROVED'
                                } else {
                                    'CPU_RELIEF_ORPHAN_TERMINATED_CPU_RECHECK_REQUIRED'
                                }
                            }
                        }
                    }
                }
            } elseif (-not $blocker) {
                $verdict = 'CPU_RELIEF_NO_VERIFIED_ORPHAN'
            }
        }
    }
} catch {
    $blocker = 'CPU_RELIEF_EVIDENCE_OR_OS_FAILURE'
} finally {
    if ($null -ne $handle) { try { $handle.Dispose() } catch {} }
}
[pscustomobject]@{
    schemaVersion = $schema
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    ok = (-not $blocker)
    blocker = $blocker
    finalVerdict = if ($blocker) { 'CPU_RELIEF_BLOCKED' } else { $verdict }
    taskIdentity = $taskName
    rootScopedToLifeboat = $true
    minimumProcessAgeMinutes = $minimumProcessAgeMinutes
    minimumWholeCpuPct = $minimumWholeCpuPct
    minimumCandidateCpuPct = $minimumCandidateCpuPct
    beforeSystemCpuPct = $preCpu
    sampledSystemCpuPct = $postCpu
    verifiedOrphanPid = $selectedPid
    verifiedOrphanStartedAtUtc = $selectedStart
    fixedScriptBasename = $selectedScript
    oneProcessTerminated = $terminated
    afterSystemCpuPct = $cpuAfter
    cpuReductionVerified = $cpuReductionVerified
    arbitraryPidAllowed = $false
    arbitraryPathAllowed = $false
    arbitraryShellAllowed = $false
    vrProcessTerminationAllowed = $false
    protectedServiceTerminationAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
    unknownMeansGreen = $false
} | ConvertTo-Json -Compress -Depth 4
