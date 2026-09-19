[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [switch]$OperatorApproved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'Cheekyfellastef/stephan-os'
$MinimumWindowsBuild = 19043
$MaximumWindowsBuildExclusive = 22000
$RequiredWindowsArchitecture = 'X64'
$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
$WindowsCurrentVersionKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$RepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$WrapperRelativePath = 'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1'
$ElevationScriptRelativePath = 'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ScriptPath = $MyInvocation.MyCommand.Path
$ElevationScriptPath = Join-Path $RepoRoot 'scripts\windows\enable-forge-wsl2-prerequisite-v1.ps1'
$ReceiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\forge-wsl2-prerequisite-elevated-v1.json'
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$LauncherName = 'Stephanos Forge WSL2 Bootstrap.cmd'
$LauncherPath = if ($DesktopPath) { Join-Path $DesktopPath $LauncherName } else { '' }
$ExpectedHead = $ExpectedHead.ToLowerInvariant()
$ObservedWindowsBuild = [Environment]::OSVersion.Version.Build
$ObservedWindowsProductName = ''
$ObservedWindowsInstallationType = ''
$ObservedWindowsArchitecture = ''

function Emit-Receipt([bool]$Ok, [string]$Status, [string]$Blocker, [hashtable]$Details = @{}) {
    $result = [ordered]@{
        schemaVersion = 'stephanos.forge-wsl2-prerequisite-receipt.v1'
        ok = $Ok
        status = $Status
        blocker = $Blocker
        repository = $Repository
        expectedHead = $ExpectedHead
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        wsl2Evidence = ''
        elevated = $false
        elevationAllowed = $true
        windowsFeaturesAllowed = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
        wslUpdateAllowed = $true
        defaultVersion2Allowed = $true
        rebootRequired = $false
        rebootPerformed = $false
        podmanMutation = $false
        forgeRuntimeMutation = $false
        sourceMutation = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        callerSelectedPathAllowed = $false
        callerSelectedExecutableAllowed = $false
        callerSelectedArgumentAllowed = $false
        githubCredentialUsed = $false
    }
    foreach ($key in $Details.Keys) { $result[$key] = $Details[$key] }
    $result | ConvertTo-Json -Depth 7 -Compress
}

function Exit-Blocked([string]$Blocker, [hashtable]$Details = @{}) {
    Emit-Receipt $false 'BLOCKED' $Blocker $Details
    exit 2
}

function Invoke-Fixed([string]$Exe, [string[]]$Arguments, [switch]$AllowFailure) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Exe @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($code -ne 0 -and -not $AllowFailure) { throw "Fixed executable failed with exit code $code" }
    [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Assert-CanonicalSource {
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Exit-Blocked 'CANONICAL_REPOSITORY_ROOT_MISSING' }
    if (-not (Test-Path -LiteralPath $GitExe -PathType Leaf)) { Exit-Blocked 'FIXED_GIT_EXECUTABLE_MISSING' }
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ElevationScriptPath -PathType Leaf)) {
        Exit-Blocked 'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH'
    }
    $branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()
    if ($branch -ne 'main') { Exit-Blocked 'CANONICAL_REPOSITORY_NOT_MAIN' @{ branch = $branch } }
    $head = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
    if ($head -ne $ExpectedHead) { Exit-Blocked 'CANONICAL_REPOSITORY_HEAD_MISMATCH' @{ localHead = $head } }

    foreach ($entry in @(
        [pscustomobject]@{ Relative = $WrapperRelativePath; Path = $ScriptPath },
        [pscustomobject]@{ Relative = $ElevationScriptRelativePath; Path = $ElevationScriptPath }
    )) {
        $committedBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', "$ExpectedHead`:$($entry.Relative)")).Output -join '').Trim().ToLowerInvariant()
        $workingBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'hash-object', "--path=$($entry.Relative)", $entry.Path)).Output -join '').Trim().ToLowerInvariant()
        if ($committedBlob -notmatch '^[0-9a-f]{40}$' -or $workingBlob -ne $committedBlob) {
            Exit-Blocked 'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH'
        }
    }
}

function Consume-ElevatedReceipt {
    if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) { return $false }
    try {
        $json = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8
        $receipt = $json | ConvertFrom-Json -ErrorAction Stop
        if ($receipt.schemaVersion -ne 'stephanos.forge-wsl2-prerequisite-receipt.v1' `
            -or $receipt.repository -ne $Repository `
            -or ([string]$receipt.expectedHead).ToLowerInvariant() -ne $ExpectedHead) {
            Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
            Exit-Blocked 'WSL2_ELEVATED_RECEIPT_INVALID'
        }
        $json.Trim()
        Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
        if ($receipt.ok -eq $true) { exit 0 }
        exit 2
    } catch {
        Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
        Exit-Blocked 'WSL2_ELEVATED_RECEIPT_INVALID'
    }
}

try {
    $windowsIdentity = Get-ItemProperty -LiteralPath $WindowsCurrentVersionKey -ErrorAction Stop
    $ObservedWindowsProductName = ([string]$windowsIdentity.ProductName).Trim()
    $ObservedWindowsInstallationType = ([string]$windowsIdentity.InstallationType).Trim()
    $ObservedWindowsArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
} catch {
    Exit-Blocked 'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE'
}
if ($ObservedWindowsInstallationType -ne 'Client' -or $ObservedWindowsProductName -notmatch '^Windows 10(?:\s|$)' -or $ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture) {
    Exit-Blocked 'WINDOWS_10_X64_CLIENT_REQUIRED'
}
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild -or $ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive) {
    Exit-Blocked 'WINDOWS_10_BUILD_NOT_ADMITTED'
}
if (-not (Test-Path -LiteralPath $PowerShellExe -PathType Leaf)) { Exit-Blocked 'FIXED_POWERSHELL_EXECUTABLE_MISSING' }
if (-not $OperatorApproved) { Exit-Blocked 'EXACT_WSL2_OPERATOR_APPROVAL_REQUIRED' }
Assert-CanonicalSource
Consume-ElevatedReceipt | Out-Null

if (-not $DesktopPath -or -not $LauncherPath) { Exit-Blocked 'FORGE_WSL2_DESKTOP_UNAVAILABLE' }
if (Test-Path -LiteralPath $LauncherPath) {
    Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'existing-desktop-path-refused' }
}

$launcher = @"
@echo off
"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$ElevationScriptPath" -ExpectedHead $ExpectedHead -OperatorApproved -VisibleElevationBroker
set "STEPHANOS_FORGE_EXIT=%ERRORLEVEL%"
del "%~f0"
exit /b %STEPHANOS_FORGE_EXIT%
"@
try {
    Set-Content -LiteralPath $LauncherPath -Value $launcher -Encoding ASCII
} catch {
    Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED'
}

Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED' @{
    operatorActionRequired = $true
    desktopLauncherName = $LauncherName
    desktopLauncherCreated = $true
    mutationPerformed = $false
}
exit 2
