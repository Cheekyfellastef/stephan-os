[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedHead,
    [switch]$OperatorApproved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
$powerShellExecutable = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$repoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$handoffScript = Join-Path $repoRoot 'scripts\sovereign-fixed-runtime-install-handoff-v1.mjs'

function Write-FixedRuntimeInstallReceipt {
    param(
        [Parameter(Mandatory = $true)][bool]$Ok,
        [Parameter(Mandatory = $true)][string]$State,
        [Parameter(Mandatory = $true)][string]$Blocker,
        [bool]$LaterFullBootRequired = $false,
        [int]$InstallerExitCode = -1
    )
    [pscustomobject]@{
        schemaVersion = 'stephanos.fixed-runtime-approved-install.v1'
        ok = $Ok
        state = $State
        blocker = $Blocker
        expectedMain = $ExpectedHead
        installerExitCode = $InstallerExitCode
        laterFullBootRequired = $LaterFullBootRequired
        installationPerformed = $Ok
        pcRestartPerformed = $false
        arbitraryShellAllowed = $false
        mergeAuthority = $false
    } | ConvertTo-Json -Compress
}

if (-not $OperatorApproved) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_EXACT_OPERATOR_APPROVAL_REQUIRED'
    exit 2
}
if (-not $env:USERPROFILE -or -not $env:LOCALAPPDATA) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_OPERATOR_PROFILE_UNPROVEN'
    exit 2
}
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)
    -or -not (Test-Path -LiteralPath $powerShellExecutable -PathType Leaf)
    -or -not (Test-Path -LiteralPath $handoffScript -PathType Leaf)) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_DEPENDENCY_MISSING'
    exit 2
}

$preparedText = (& $nodeExecutable $handoffScript 'prepare' '--expected-main' $ExpectedHead 2>$null | Out-String).Trim()
$prepareExitCode = $LASTEXITCODE
if ($prepareExitCode -ne 0 -or -not $preparedText) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_PREPARATION_UNPROVEN'
    exit 2
}
try { $prepared = $preparedText | ConvertFrom-Json -ErrorAction Stop } catch {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_PREPARATION_INVALID'
    exit 2
}
$expectedPayloadPath = Join-Path (Join-Path $env:LOCALAPPDATA 'Temp') ("StephanosFixedRuntimeInstall-{0}.json" -f $ExpectedHead)
$preparedValid = (
    $prepared.schemaVersion -ceq 'stephanos.fixed-runtime-install-handoff.v1' -and
    $prepared.ok -eq $true -and
    $prepared.state -ceq 'READY_FOR_OPERATOR_APPROVAL' -and
    $prepared.expectedMain -ceq $ExpectedHead -and
    $prepared.powershellExecutable -ceq $powerShellExecutable -and
    [string]::Equals([string]$prepared.payloadPath, $expectedPayloadPath, [System.StringComparison]::OrdinalIgnoreCase) -and
    [string]$prepared.payloadSha256 -match '^[a-f0-9]{64}$' -and
    [int]$prepared.payloadBytes -gt 0 -and
    [int]$prepared.payloadBytes -le (16 * 1024 * 1024) -and
    [string]$prepared.encodedCommand -match '^[A-Za-z0-9+/=]{1,30000}$' -and
    [string]$prepared.encodedCommandSha256 -match '^[a-f0-9]{64}$' -and
    $prepared.installationPerformed -eq $false -and
    $prepared.elevationPerformed -eq $false -and
    $prepared.pcRestartPerformed -eq $false -and
    $prepared.arbitraryShellAllowed -eq $false -and
    $prepared.mergeAuthority -eq $false
)
if (-not $preparedValid) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_PREPARATION_INVALID'
    exit 2
}

$encodedCommand = [string]$prepared.encodedCommand
$encodedBytes = [Text.Encoding]::UTF8.GetBytes($encodedCommand)
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $encodedDigest = ([BitConverter]::ToString($sha.ComputeHash($encodedBytes))).Replace('-', '').ToLowerInvariant()
} finally {
    $sha.Dispose()
}
if ($encodedDigest -cne [string]$prepared.encodedCommandSha256) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_COMMAND_DIGEST_CHANGED'
    exit 2
}

try {
    $installer = Start-Process -FilePath $powerShellExecutable -ArgumentList @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        $encodedCommand
    ) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
} catch {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_ELEVATION_CANCELLED_OR_FAILED'
    exit 2
}
$installerExitCode = [int]$installer.ExitCode
if ($installerExitCode -ne 0) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_ELEVATED_INSTALL_FAILED' -InstallerExitCode $installerExitCode
    exit 2
}

$verifiedText = (& $nodeExecutable $handoffScript 'verify' '--expected-main' $ExpectedHead 2>$null | Out-String).Trim()
$verifyExitCode = $LASTEXITCODE
if ($verifyExitCode -ne 0 -or -not $verifiedText) {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_READBACK_UNPROVEN' -InstallerExitCode $installerExitCode
    exit 2
}
try { $verified = $verifiedText | ConvertFrom-Json -ErrorAction Stop } catch {
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker 'FIXED_RUNTIME_INSTALL_READBACK_INVALID' -InstallerExitCode $installerExitCode
    exit 2
}
if ($verified.schemaVersion -cne 'stephanos.fixed-runtime-install-handoff.v1'
    -or $verified.ok -ne $true
    -or $verified.expectedMain -cne $ExpectedHead
    -or $verified.state -notin @('PENDING_REBOOT', 'QUALIFIED')) {
    $blocker = if ([string]$verified.blocker -match '^[A-Z0-9_]{1,120}$') { [string]$verified.blocker } else { 'FIXED_RUNTIME_INSTALL_READBACK_INVALID' }
    Write-FixedRuntimeInstallReceipt -Ok $false -State 'BLOCKED' -Blocker $blocker -InstallerExitCode $installerExitCode
    exit 2
}

$laterBoot = $verified.state -ceq 'PENDING_REBOOT'
Write-FixedRuntimeInstallReceipt -Ok $true -State ([string]$verified.state) -Blocker '' -LaterFullBootRequired:$laterBoot -InstallerExitCode $installerExitCode
exit 0
