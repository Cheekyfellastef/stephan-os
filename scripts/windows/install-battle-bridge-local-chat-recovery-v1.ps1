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

foreach ($required in @($sourceHandler, $powershellExe, $statePath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required local recovery prerequisite is missing: $required" }
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ([string]$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1') { throw 'Installed lifeboat active-bank schema is invalid.' }
if ([string]$state.activeBank -notin @('A', 'B')) { throw 'Installed lifeboat active bank is invalid.' }
if ([string]$state.selfTestVerdict -ne 'PASS') { throw 'Installed lifeboat is not self-test proven.' }

[System.IO.Directory]::CreateDirectory($installRoot) | Out-Null
$sourceHash = (Get-FileHash -LiteralPath $sourceHandler -Algorithm SHA256).Hash.ToLowerInvariant()

if ($PSCmdlet.ShouldProcess($installedHandler, 'Install bounded local ChatGPT recovery handler outside the repository checkout')) {
    Copy-Item -LiteralPath $sourceHandler -Destination $installedHandler -Force
}
$installedHash = (Get-FileHash -LiteralPath $installedHandler -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -ne $sourceHash) { throw 'Installed local recovery handler hash does not match reviewed source.' }

$protocols = @(
    [pscustomobject]@{ Scheme = 'stephanos-recover-probe'; Action = 'PROBE_BATTLE_BRIDGE'; Description = 'Stephanos Recovery Lifeboat Probe' },
    [pscustomobject]@{ Scheme = 'stephanos-recover-mailbox'; Action = 'WAKE_CANONICAL_MAILBOX'; Description = 'Stephanos Recovery Lifeboat Mailbox Wake' },
    [pscustomobject]@{ Scheme = 'stephanos-recover-mesh'; Action = 'WAKE_CANONICAL_RECOVERY_MESH'; Description = 'Stephanos Recovery Lifeboat Mesh Wake' }
)

$registered = @()
foreach ($protocol in $protocols) {
    $protocolKey = "HKCU:\Software\Classes\$($protocol.Scheme)"
    $commandKey = Join-Path $protocolKey 'shell\open\command'
    $command = "`"$powershellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$installedHandler`" -Action $($protocol.Action)"

    if ($command.Contains('%1')) { throw 'Fixed local recovery protocol must not receive caller-controlled URI text.' }
    if ($PSCmdlet.ShouldProcess("$($protocol.Scheme):", "Register fixed per-user local recovery action $($protocol.Action)")) {
        New-Item -Path $protocolKey -Force | Out-Null
        Set-Item -Path $protocolKey -Value "URL:$($protocol.Description)"
        New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
        New-Item -Path $commandKey -Force | Out-Null
        Set-Item -Path $commandKey -Value $command
    }

    $observedCommand = (Get-Item -LiteralPath $commandKey).GetValue('')
    if ([string]$observedCommand -cne $command) { throw "Registered local recovery protocol command identity mismatch for $($protocol.Scheme)." }
    $registered += [pscustomobject]@{
        scheme = $protocol.Scheme
        action = $protocol.Action
        commandIdentityVerified = $true
        callerControlledUriPassedToHandler = $false
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-local-chat-recovery-install.v1'
    installedHandler = $installedHandler
    handlerSha256 = $installedHash
    lifeboatRoot = $lifeboatRoot
    activeBank = [string]$state.activeBank
    activeManifestSha256 = [string]$state.manifestSha256
    registeredProtocols = $registered
    acceptedUris = @(
        'stephanos-recover-probe:',
        'stephanos-recover-mailbox:',
        'stephanos-recover-mesh:'
    )
    arbitraryShellAllowed = $false
    callerSelectedExecutableAllowed = $false
    callerSelectedPathAllowed = $false
    callerSelectedUrlAllowed = $false
    callerSelectedTaskAllowed = $false
    callerControlledUriPassedToHandler = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    deploymentAllowed = $false
    pcRestartAllowed = $false
} | ConvertTo-Json -Depth 6
