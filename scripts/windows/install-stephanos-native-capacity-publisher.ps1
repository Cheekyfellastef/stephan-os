[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "",
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Native Capacity Publisher'
$canonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
if ([string]::IsNullOrWhiteSpace($StephanosRepositoryRoot)) {
    $StephanosRepositoryRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
}
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$expectedRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$missionRunnerRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner'))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
if (-not [string]::Equals($repositoryRoot, $expectedRepositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Publisher must use the canonical Stephanos checkout: $expectedRepositoryRoot"
}
$publisherScript = Join-Path $repositoryRoot 'scripts\stephanos-native-capacity-publisher.mjs'
$sourceGateScript = Join-Path $repositoryRoot 'scripts\stephanos-native-capacity-publisher-source-gate.mjs'
foreach ($required in @($canonicalPowerShell, $canonicalNode, $canonicalGit, $publisherScript, $sourceGateScript)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required publisher dependency is missing: $required" }
}

$branch = (& $canonicalGit -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Native capacity publisher installation requires canonical main.' }
$headSha = (& $canonicalGit -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $headSha -notmatch '^[0-9a-f]{40}$') { throw 'Could not prove the canonical main head.' }
$sourceGateReceipt = (& $canonicalNode $sourceGateScript | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$sourceGateReceipt)) {
    throw 'Native capacity publisher installation requires canonical source-dirt clearance.'
}
try {
    $sourceGate = $sourceGateReceipt | ConvertFrom-Json -ErrorAction Stop
} catch {
    throw 'Native capacity publisher source-dirt receipt is invalid.'
}
if ([bool]$sourceGate.ok -ne $true `
    -or [string]$sourceGate.finalVerdict -ne 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS' `
    -or [string]$sourceGate.sourceHead -ne $headSha `
    -or [bool]$sourceGate.dirtSummary.blocksSync -ne $false) {
    throw 'Native capacity publisher installation requires canonical source-dirt clearance.'
}

function Quote-Single([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

$bootstrap = @"
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
if ([bool]`$sourceGate.ok -ne `$true `
    -or [string]`$sourceGate.finalVerdict -ne 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS' `
    -or [string]`$sourceGate.sourceHead -ne `$head `
    -or [bool]`$sourceGate.dirtSummary.blocksSync -ne `$false) { exit 75 }
& `$canonicalNode `$publisherScript
exit `$LASTEXITCODE
"@
$encodedBootstrap = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
$arguments = '-NoProfile -NonInteractive -EncodedCommand ' + $encodedBootstrap
$action = New-ScheduledTaskAction -Execute $canonicalPowerShell -Argument $arguments -WorkingDirectory $repositoryRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$registeredAction = @($registered.Actions)[0]
if (-not [string]::Equals([string]$registeredAction.Execute, $canonicalPowerShell, [System.StringComparison]::OrdinalIgnoreCase) `
    -or [string]$registeredAction.Arguments -ne $arguments `
    -or -not [string]::Equals([string]$registeredAction.WorkingDirectory, $repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Registered native capacity publisher task identity does not match the guarded bootstrap.'
}

if ($StartNow) { Start-ScheduledTask -TaskName $taskName }

[pscustomobject]@{
    schemaVersion = 'stephanos.native-capacity-publisher-install.v1'
    taskName = $taskName
    repositoryRoot = $repositoryRoot
    sourceHead = $headSha
    publisherScript = $publisherScript
    sourceGateScript = $sourceGateScript
    bootstrapExecutable = $canonicalPowerShell
    nodeExecutable = $canonicalNode
    gitExecutable = $canonicalGit
    environmentPinned = $true
    sourceValidatedBeforePublisherLoad = $true
    canonicalDirtPolicyRequired = $true
    startRequested = [bool]$StartNow
    mergeAuthority = $false
    leaseSeizureAllowed = $false
    arbitraryCommandAllowed = $false
    finalVerdict = 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED'
} | ConvertTo-Json -Compress