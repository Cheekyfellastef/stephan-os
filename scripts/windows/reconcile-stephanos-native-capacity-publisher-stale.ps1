[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedHead,
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$')][string]$RequestId
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Restricted to one existing native-capacity task. Never touch original
# source writers, Core, Mission Worker, leases, or other Scheduled Tasks.
$taskName = 'Stephanos Native Capacity Publisher'
$canonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
if (-not $env:USERPROFILE -or -not $env:LOCALAPPDATA) { throw 'NATIVE_RECONCILE_PROFILE_UNAVAILABLE' }
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$sourceGate = Join-Path $repositoryRoot 'scripts\stephanos-native-capacity-publisher-source-gate.mjs'
$publisher = Join-Path $repositoryRoot 'scripts\stephanos-native-capacity-publisher.mjs'
foreach ($file in @($canonicalPowerShell, $canonicalNode, $canonicalGit, $sourceGate, $publisher)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'NATIVE_RECONCILE_PINNED_BINARY_MISSING' }
}
$branch = (& $canonicalGit -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'NATIVE_RECONCILE_MAIN_REQUIRED' }
$head = (& $canonicalGit -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedHead) { throw 'NATIVE_RECONCILE_HEAD_CHANGED' }
$sourceReceipt = (& $canonicalNode $sourceGate | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or -not $sourceReceipt) { throw 'NATIVE_RECONCILE_DIRT_UNKNOWN' }
$gate = $sourceReceipt | ConvertFrom-Json -ErrorAction Stop
if ($gate.ok -ne $true -or $gate.finalVerdict -ne 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS' -or $gate.sourceHead -ne $ExpectedHead -or $gate.dirtSummary.blocksSync -ne $false) {
    throw 'NATIVE_RECONCILE_DIRT_OR_SOURCE_UNSAFE'
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$actions = @($task.Actions)
if ($actions.Count -ne 1 -or -not $task.Principal -or -not $task.Settings -or [string]$task.Settings.MultipleInstances -ne 'IgnoreNew' -or [string]$task.Principal.LogonType -ne 'Interactive' -or [string]$task.Principal.RunLevel -ne 'Limited') {
    throw 'NATIVE_RECONCILE_TASK_IDENTITY_INVALID'
}
$callerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
try {
    $taskSid = (New-Object System.Security.Principal.NTAccount([string]$task.Principal.UserId)).Translate([System.Security.Principal.SecurityIdentifier]).Value
} catch { throw 'NATIVE_RECONCILE_TASK_OWNER_UNVERIFIED' }
if ($taskSid -ne $callerSid) { throw 'NATIVE_RECONCILE_TASK_OWNER_MISMATCH' }
$action = $actions[0]
if (-not [string]::Equals([string]$action.Execute, $canonicalPowerShell, [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals([string]$action.WorkingDirectory, $repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'NATIVE_RECONCILE_TASK_ACTION_CHANGED'
}
$argMatch = [regex]::Match([string]$action.Arguments, '^-NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$')
if (-not $argMatch.Success) { throw 'NATIVE_RECONCILE_BOOTSTRAP_ARGUMENTS_CHANGED' }
try { $bootstrap = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($argMatch.Groups[1].Value)) }
catch { throw 'NATIVE_RECONCILE_BOOTSTRAP_DECODE_INVALID' }
# Exact canonical installer-generated bootstrap: deny changed variables/control flow.
function Quote-Single([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}
$missionRunnerRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner'))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$sourceGateScript = $sourceGate
$publisherScript = $publisher
$expectedBootstrap = @"
`$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
`$repositoryRoot = $(Quote-Single $repositoryRoot)
`$canonicalGit = $(Quote-Single $canonicalGit)
`$canonicalNode = $(Quote-Single $canonicalNode)
`$publisherScript = $(Quote-Single $publisherScript)
`$sourceGateScript = $(Quote-Single $sourceGateScript)
`$env:STEPHANOS_GIT_EXECUTABLE = `$canonicalGit
`$env:STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT = `$repositoryRoot
`$env:STEPHANOS_MISSION_RUNNER_ROOT = $(Quote-Single $missionRunnerRoot)
`$env:STEPHANOS_SHARED_AGENT_WORKSPACE = $(Quote-Single $workspaceRoot)
`$branch = (& `$canonicalGit -C `$repositoryRoot branch --show-current).Trim()
if (`$LASTEXITCODE -ne 0 -or `$branch -ne 'main') { exit 75 }
`$head = (& `$canonicalGit -C `$repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if (`$LASTEXITCODE -ne 0 -or `$head -notmatch '^[0-9a-f]{40}$') { exit 75 }
`$sourceGateReceipt = (& `$canonicalNode `$sourceGateScript | Select-Object -Last 1)
if (`$LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]`$sourceGateReceipt)) { exit 75 }
try { `$sourceGate = `$sourceGateReceipt | ConvertFrom-Json -ErrorAction Stop } catch { exit 75 }
if ([bool]`$sourceGate.ok -ne `$true -or
    [string]`$sourceGate.finalVerdict -ne 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS' -or
    [string]`$sourceGate.sourceHead -ne `$head -or
    [bool]`$sourceGate.dirtSummary.blocksSync -ne `$false) { exit 75 }
& `$canonicalNode `$publisherScript
exit `$LASTEXITCODE
"@
$lf = [string][char]10
$crlf = [string]([char]13) + [string]([char]10)
if (-not [string]::Equals($bootstrap.Replace($crlf, $lf), $expectedBootstrap.Replace($crlf, $lf), [System.StringComparison]::Ordinal)) {
    throw 'NATIVE_RECONCILE_CANONICAL_BOOTSTRAP_CHANGED'
}
function Assert-FixedPublisherTaskIdentity([object]$Candidate, [string]$ExpectedArguments) {
    $candidateActions = @($Candidate.Actions)
    if ($candidateActions.Count -ne 1 -or -not $Candidate.Principal -or -not $Candidate.Settings -or [string]$Candidate.Settings.MultipleInstances -ne 'IgnoreNew' -or [string]$Candidate.Principal.LogonType -ne 'Interactive' -or [string]$Candidate.Principal.RunLevel -ne 'Limited' -or [string]$Candidate.Principal.UserId -ne [string]$task.Principal.UserId) {
        throw 'NATIVE_RECONCILE_TASK_CHANGED_DURING_HANDOFF'
    }
    try {
        $candidateSid = (New-Object System.Security.Principal.NTAccount([string]$Candidate.Principal.UserId)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch { throw 'NATIVE_RECONCILE_TASK_OWNER_UNVERIFIED' }
    if ($candidateSid -ne $callerSid) { throw 'NATIVE_RECONCILE_TASK_OWNER_MISMATCH' }
    if (-not [string]::Equals([string]$candidateActions[0].Execute, $canonicalPowerShell, [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals([string]$candidateActions[0].WorkingDirectory, $repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals([string]$candidateActions[0].Arguments, $ExpectedArguments, [System.StringComparison]::Ordinal)) {
        throw 'NATIVE_RECONCILE_TASK_ACTION_CHANGED_DURING_HANDOFF'
    }
}

# A one-shot durable fence is created BEFORE task stop. Even if it fails
# halfway, the same source revision cannot spin more restarts.
$journalRoot = Join-Path $env:LOCALAPPDATA 'Stephanos\native-publisher-reconcile'
[System.IO.Directory]::CreateDirectory($journalRoot) | Out-Null
$fencePath = Join-Path $journalRoot ($ExpectedHead + '.json')
try {
    $stream = [System.IO.File]::Open($fencePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch [System.IO.IOException] {
    throw 'NATIVE_RECONCILE_EXACT_HEAD_ALREADY_ATTEMPTED'
}
try {
    $entry = @{ schemaVersion='stephanos.native-publisher-single-task-reconcile.v1';
        expectedHead=$ExpectedHead; requestId=$RequestId; taskName=$taskName;
        requestedAtUtc=[DateTime]::UtcNow.ToString('o'); singleAttempt=$true;
        sourceMutationAllowed=$false; leaseReleaseAllowed=$false; mergeAuthority=$false }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($entry | ConvertTo-Json -Compress))
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
} finally { $stream.Dispose() }

Assert-FixedPublisherTaskIdentity (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop) ([string]$action.Arguments)
$stopped = $false
if ([string]$task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $stopped = $true
    $quiescent = $false
    for ($i=0; $i -lt 5; $i++) {
        Start-Sleep -Seconds 1
        $state = (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State
        if ([string]$state -eq 'Ready') { $quiescent = $true; break }
    }
    if (-not $quiescent) { throw 'NATIVE_RECONCILE_TASK_NOT_QUIESCENT' }
}
$secondHead = (& $canonicalGit -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $secondHead -ne $ExpectedHead) { throw 'NATIVE_RECONCILE_SOURCE_MOVED' }
$stillRegistered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
Assert-FixedPublisherTaskIdentity $stillRegistered ([string]$action.Arguments)
Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
[pscustomobject]@{
    schemaVersion = 'stephanos.native-publisher-single-task-reconcile.v1'
    finalVerdict = 'NATIVE_PUBLISHER_FIXED_TASK_RESTART_REQUESTED'
    expectedHead = $ExpectedHead
    taskName = $taskName
    stoppedPreviousTask = $stopped
    startRequested = $true
    signedCapacityVerified = $false
    leaseReleaseAllowed = $false
    sourceMutationAllowed = $false
    mergeAuthority = $false
} | ConvertTo-Json -Compress
