[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'Stephanos Mission Orchestrator Worker'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScriptPath = (Resolve-Path (Join-Path $scriptDir 'start-mission-orchestrator-worker.ps1')).Path
$powershellExe = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExe)) { $powershellExe = 'powershell.exe' }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$startScriptPath`""
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
if ($PSCmdlet.ShouldProcess($taskName, 'Register or update scheduled task')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the Stephanos Mission Orchestrator persistent local worker.' -Force | Out-Null
}
Write-Output "TASK_NAME=$taskName"
Write-Output "TASK_USER=$currentUser"
Write-Output "TASK_ACTION=$powershellExe $taskArgs"
Write-Output 'FINAL_VERDICT=MISSION_ORCHESTRATOR_WORKER_AUTOSTART_CONFIGURED'
