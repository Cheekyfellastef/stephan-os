[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'

$taskName = 'Stephanos Battle Bridge Backend'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScriptPath = (Resolve-Path (Join-Path $scriptDir 'start-stephanos-backend.ps1')).Path
$powershellExe = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExe)) {
    $powershellExe = 'powershell.exe'
}

$escapedScriptPath = $startScriptPath.Replace('"', '""')
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$escapedScriptPath`""
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable

if ($PSCmdlet.ShouldProcess($taskName, 'Register/Update scheduled task')) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description 'Starts Stephanos backend at user logon for Battle Bridge Tailscale Serve proxy.' `
        -Force | Out-Null
}

Write-Host "Scheduled task configured: $taskName"
Write-Host "Trigger: At logon for $currentUser"
Write-Host "Action: $powershellExe $taskArgs"
Write-Host 'Tailscale Serve was not modified by this installer.'
Write-Host 'Test now (manual run):'
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host 'Task status check:'
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Format-List TaskName,State"
