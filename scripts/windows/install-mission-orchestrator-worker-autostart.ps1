[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'Stephanos Mission Orchestrator Worker'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = (Resolve-Path (Join-Path $scriptDir 'run-stephanos-scheduled-task-windowless.vbs')).Path
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw "Windowless task host is missing: $wscriptExe" }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$taskArgs = "//B //NoLogo `"$escapedLauncherPath`" mission-worker"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
if ($PSCmdlet.ShouldProcess($taskName, 'Register or update scheduled task')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the Stephanos Mission Orchestrator persistent local worker.' -Force | Out-Null
}
Write-Output "TASK_NAME=$taskName"
Write-Output "TASK_USER=$currentUser"
Write-Output "TASK_ACTION=$wscriptExe $taskArgs"
Write-Output 'FINAL_VERDICT=MISSION_ORCHESTRATOR_WORKER_AUTOSTART_CONFIGURED'
