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
$WrapperRelativePath = 'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1'
$ElevationScriptRelativePath = 'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1'
$RepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$ScriptPath = $MyInvocation.MyCommand.Path
$ElevationScriptPath = Join-Path $RepoRoot ($ElevationScriptRelativePath -replace '/', '\')
$ReceiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\forge-wsl2-prerequisite-elevated-v1.json'
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$LauncherName = 'Stephanos Forge WSL2 Bootstrap.cmd'
$LauncherPath = Join-Path $DesktopPath $LauncherName
$WindowsCurrentVersionKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
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
        minimumWindowsBuild = 19043
        maximumWindowsBuildExclusive = 22000
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

function Invoke-Fixed([string]$Exe, [string[]]$Arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Exe @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Assert-CanonicalSource {
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Exit-Blocked 'CANONICAL_REPOSITORY_ROOT_MISSING' }
    if (-not (Test-Path -LiteralPath $GitExe -PathType Leaf)) { Exit-Blocked 'FIXED_GIT_EXECUTABLE_MISSING' }
    if (-not (Test-Path -LiteralPath $PowerShellExe -PathType Leaf)) { Exit-Blocked 'FIXED_POWERSHELL_EXECUTABLE_MISSING' }
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ElevationScriptPath -PathType Leaf)) {
        Exit-Blocked 'FORGE_WSL2_PREREQUISITE_SOURCE_MISSING'
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

function Test-ElevatedReceiptReady {
    if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) { return $false }
    try {
        $json = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($json)) { return $false }
        $receipt = $json | ConvertFrom-Json -ErrorAction Stop
        $identityValid = $receipt.schemaVersion -eq 'stephanos.forge-wsl2-prerequisite-receipt.v1' `
            -and $receipt.repository -eq $Repository `
            -and ([string]$receipt.expectedHead).ToLowerInvariant() -eq $ExpectedHead
        $terminalResult = ($receipt.ok -eq $true) `
            -or ($receipt.ok -eq $false -and -not [string]::IsNullOrWhiteSpace([string]$receipt.blocker))
        return $identityValid -and $terminalResult -and -not [string]::IsNullOrWhiteSpace([string]$receipt.status)
    } catch {
        return $false
    }
}

function Consume-ElevatedReceipt {
    if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) { return }
    try {
        $json = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8
        $receipt = $json | ConvertFrom-Json -ErrorAction Stop
        if ($receipt.schemaVersion -ne 'stephanos.forge-wsl2-prerequisite-receipt.v1'
            -or $receipt.repository -ne $Repository
            -or ([string]$receipt.expectedHead).ToLowerInvariant() -ne $ExpectedHead) {
            Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
            Exit-Blocked 'WSL2_ELEVATED_RECEIPT_INVALID'
        }
        Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
        $json.Trim()
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
if ($ObservedWindowsInstallationType -ne 'Client' -or $ObservedWindowsProductName -notmatch '^Windows 10(?:\s|$)' -or $ObservedWindowsArchitecture -ne 'X64') {
    Exit-Blocked 'WINDOWS_10_X64_CLIENT_REQUIRED'
}
if ($ObservedWindowsBuild -lt 19043 -or $ObservedWindowsBuild -ge 22000) {
    Exit-Blocked 'WINDOWS_10_BUILD_NOT_ADMITTED'
}
if (-not $OperatorApproved) { Exit-Blocked 'EXACT_WSL2_OPERATOR_APPROVAL_REQUIRED' }

Assert-CanonicalSource
Consume-ElevatedReceipt

if ([string]::IsNullOrWhiteSpace($DesktopPath) -or -not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
    Exit-Blocked 'FORGE_WSL2_OPERATOR_DESKTOP_UNAVAILABLE'
}
if (Test-Path -LiteralPath $LauncherPath) {
    Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'existing-desktop-path-refused' }
}

$launcher = @"
@echo off
"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$ElevationScriptPath" -ExpectedHead $ExpectedHead -OperatorApproved -VisibleElevationBroker
set "STEPHANOS_FORGE_EXIT=%ERRORLEVEL%"
exit /b %STEPHANOS_FORGE_EXIT%
"@
$LauncherWaitSeconds = 600
$launcherStream = $null

try {
    $launcherBytes = [System.Text.Encoding]::ASCII.GetBytes("$launcher`r`n")
    $launcherStream = [System.IO.FileStream]::new(
        $LauncherPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::Read
    )
    $launcherStream.Write($launcherBytes, 0, $launcherBytes.Length)
    $launcherStream.Flush($true)
    $launcherStream.Position = 0
    Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED' @{
        desktopLauncherName = $LauncherName
        mutationPerformed = $false
        launcherLocked = $true
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($LauncherWaitSeconds)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-ElevatedReceiptReady)) {
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-ElevatedReceiptReady)) {
        Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_TIMEOUT' @{
            desktopLauncherName = $LauncherName
            mutationPerformed = $null
            mutationState = 'UNKNOWN_OR_IN_PROGRESS'
            launcherLocked = $true
        }
        exit 2
    }
} catch {
    Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'locked-launcher-create-failed' }
} finally {
    if ($null -ne $launcherStream) {
        $launcherStream.Dispose()
    }
    Remove-Item -LiteralPath $LauncherPath -Force -ErrorAction SilentlyContinue
}

Consume-ElevatedReceipt
