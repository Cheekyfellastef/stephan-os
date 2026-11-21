[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHead,
    [switch]$OperatorApproved
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $OperatorApproved) { throw 'FRONTEND_AUTOSTART_EXPLICIT_INSTALL_APPROVAL_REQUIRED' }
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$expectedRepo = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repoRoot, $expectedRepo, [StringComparison]::OrdinalIgnoreCase)) { throw 'FRONTEND_CANONICAL_CHECKOUT_REQUIRED' }
$node = 'C:\Program Files\nodejs\node.exe'
$sourceProbe = Join-Path $repoRoot 'scripts\battle-bridge-ignition-supervisor.mjs'
Push-Location -LiteralPath $repoRoot
try {
    $sourceText = & $node $sourceProbe --source-truth-json
    if ($LASTEXITCODE -ne 0) { throw 'FRONTEND_INSTALL_SOURCE_UNPROVEN' }
    $source = $sourceText | ConvertFrom-Json
    if ($source.ok -ne $true -or $source.head -ne $ExpectedHead) { throw 'FRONTEND_INSTALL_EXACT_HEAD_CHANGED' }
} finally { Pop-Location }
$taskName = 'Stephanos Battle Bridge Frontend'
# Never overwrite a task of unknown provenance; existing definitions survive.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'FRONTEND_AUTOSTART_TASK_ALREADY_EXISTS' }
$launcher = Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'
$runner = Join-Path $repoRoot 'scripts\windows\run-stephanos-frontend-hidden.ps1'
foreach ($path in @($launcher, $runner, $node)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'FRONTEND_STARTUP_DEPENDENCY_MISSING' } }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' -Argument ('//B //NoLogo "' + $launcher + '" frontend')
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT30S'
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
if ($PSCmdlet.ShouldProcess($taskName, 'Install frontend startup client of the existing Commander guardian')) {
    # No -Force: registration races cannot replace somebody else's task.
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($boot,$logon) -Principal $principal -Settings $settings -Description 'Starts the normal frontend through existing guarded repair-ui-4173 after boot; no custody recovery, controller or source-lease authority.' | Out-Null
    [pscustomobject]@{schemaVersion='stephanos.frontend-autostart-install.v1';installed=$true;taskName=$taskName;sourceHead=$ExpectedHead;atStartup=$true;atLogon=$true;runLevel='Limited';logonType='S4U';otherTasksChanged=$false;sourceLeasesReleased=$false} | ConvertTo-Json
}
