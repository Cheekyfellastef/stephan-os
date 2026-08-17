[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceHandler = Join-Path $sourceRoot 'scripts\windows\invoke-battle-bridge-local-chat-recovery-v1.ps1'
$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'))
$installRoot = Join-Path $lifeboatRoot 'local-chat'
$installedHandler = Join-Path $installRoot 'invoke-battle-bridge-local-chat-recovery-v1.ps1'
$statePath = Join-Path $lifeboatRoot 'state\active-bank.json'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$protocolKey = 'HKCU:\Software\Classes\stephanos-recover'
$commandKey = Join-Path $protocolKey 'shell\open\command'

foreach ($required in @($sourceHandler, $powershellExe, $statePath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required local recovery prerequisite is missing: $required" }
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ([string]$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1') { throw 'Installed lifeboat active-bank schema is invalid.' }
if ([string]$state.activeBank -notin @('A', 'B')) { throw 'Installed lifeboat active bank is invalid.' }
if ([string]$state.selfTestVerdict -ne 'PASS') { throw 'Installed lifeboat is not self-test proven.' }

[System.IO.Directory]::CreateDirectory($installRoot) | Out-Null
$sourceHash = (Get-FileHash -LiteralPath $sourceHandler -Algorithm SHA256).Hash.ToLowerInvariant()

if ($PSCmdlet.ShouldProcess($installedHandler, 'Install bounded local ChatGPT recovery URI handler outside the repository checkout')) {
    Copy-Item -LiteralPath $sourceHandler -Destination $installedHandler -Force
}
$installedHash = (Get-FileHash -LiteralPath $installedHandler -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -ne $sourceHash) { throw 'Installed local recovery handler hash does not match reviewed source.' }

$command = "`"$powershellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$installedHandler`" -Uri `"%1`""
if ($PSCmdlet.ShouldProcess('stephanos-recover:', 'Register fixed per-user local recovery protocol')) {
    New-Item -Path $protocolKey -Force | Out-Null
    Set-Item -Path $protocolKey -Value 'URL:Stephanos Recovery Lifeboat Protocol'
    New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-Item -Path $commandKey -Force | Out-Null
    Set-Item -Path $commandKey -Value $command
}

$observedCommand = (Get-Item -LiteralPath $commandKey).GetValue('')
if ([string]$observedCommand -cne $command) { throw 'Registered local recovery protocol command identity mismatch.' }

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-local-chat-recovery-install.v1'
    protocol = 'stephanos-recover'
    installedHandler = $installedHandler
    handlerSha256 = $installedHash
    lifeboatRoot = $lifeboatRoot
    activeBank = [string]$state.activeBank
    activeManifestSha256 = [string]$state.manifestSha256
    protocolCommandIdentityVerified = $true
    acceptedUris = @(
        'stephanos-recover://probe',
        'stephanos-recover://wake-mailbox',
        'stephanos-recover://wake-recovery-mesh'
    )
    arbitraryShellAllowed = $false
    callerSelectedExecutableAllowed = $false
    callerSelectedPathAllowed = $false
    callerSelectedUrlAllowed = $false
    callerSelectedTaskAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    deploymentAllowed = $false
    pcRestartAllowed = $false
} | ConvertTo-Json -Depth 6
