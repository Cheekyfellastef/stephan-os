[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "",
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Native Capacity Publisher'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
if ([string]::IsNullOrWhiteSpace($StephanosRepositoryRoot)) {
    $StephanosRepositoryRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
}
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$expectedRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repositoryRoot, $expectedRepositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Publisher must use the canonical Stephanos checkout: $expectedRepositoryRoot"
}
foreach ($required in @($canonicalNode, $canonicalGit, (Join-Path $repositoryRoot 'scripts\stephanos-native-capacity-publisher.mjs'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required publisher dependency is missing: $required" }
}

$branch = (& $canonicalGit -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Native capacity publisher installation requires canonical main.' }
$headSha = (& $canonicalGit -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $headSha -notmatch '^[0-9a-f]{40}$') { throw 'Could not prove the canonical main head.' }
$trackedDirt = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no')
if ($LASTEXITCODE -ne 0 -or $trackedDirt.Count -ne 0) { throw 'Native capacity publisher installation requires tracked-clean source.' }

$publisherScript = Join-Path $repositoryRoot 'scripts\stephanos-native-capacity-publisher.mjs'
$arguments = '"' + $publisherScript + '"'
$action = New-ScheduledTaskAction -Execute $canonicalNode -Argument $arguments -WorkingDirectory $repositoryRoot
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
if (-not [string]::Equals([string]$registeredAction.Execute, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase) `
    -or [string]$registeredAction.Arguments -ne $arguments `
    -or -not [string]::Equals([string]$registeredAction.WorkingDirectory, $repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Registered native capacity publisher task identity does not match the guarded source.'
}

if ($StartNow) { Start-ScheduledTask -TaskName $taskName }

[pscustomobject]@{
    schemaVersion = 'stephanos.native-capacity-publisher-install.v1'
    taskName = $taskName
    repositoryRoot = $repositoryRoot
    sourceHead = $headSha
    publisherScript = $publisherScript
    nodeExecutable = $canonicalNode
    startRequested = [bool]$StartNow
    mergeAuthority = $false
    leaseSeizureAllowed = $false
    arbitraryCommandAllowed = $false
    finalVerdict = 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED'
} | ConvertTo-Json -Compress
