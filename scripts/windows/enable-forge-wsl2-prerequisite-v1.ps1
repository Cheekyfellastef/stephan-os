[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [switch]$OperatorApproved,
    [switch]$ElevatedChild
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
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
$PowerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$DismExe = Join-Path $env:SystemRoot 'System32\dism.exe'
$WslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$ScriptPath = $MyInvocation.MyCommand.Path
$ReceiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\forge-wsl2-prerequisite-elevated-v1.json'
$ExpectedHead = $ExpectedHead.ToLowerInvariant()
$ObservedWindowsBuild = [Environment]::OSVersion.Version.Build
$ObservedWindowsProductName = ''
$ObservedWindowsInstallationType = ''
$ObservedWindowsArchitecture = ''
$ObservedWsl2Evidence = ''

function Emit-Receipt([bool]$Ok, [string]$Status, [string]$Blocker, [hashtable]$Details = @{}, [switch]$ToFile) {
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
        wsl2Evidence = $ObservedWsl2Evidence
        elevated = $ElevatedChild.IsPresent
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
    $json = $result | ConvertTo-Json -Depth 7 -Compress
    if ($ToFile) {
        $directory = Split-Path -Parent $ReceiptPath
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Set-Content -LiteralPath $ReceiptPath -Value $json -Encoding UTF8
    } else {
        $json
    }
}

function Exit-Blocked([string]$Blocker, [hashtable]$Details = @{}, [switch]$ToFile) {
    Emit-Receipt $false 'BLOCKED' $Blocker $Details -ToFile:$ToFile
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

function Get-Wsl2Evidence {
    $status = Invoke-Fixed $WslExe @('--status') -AllowFailure
    if ($status.ExitCode -eq 0) {
        $text = (($status.Output -join "`n") -replace "`0", '')
        if ($text -match '(?im)^\s*Default Version:\s*2\s*$') { return 'default-version-2' }
    }
    $list = Invoke-Fixed $WslExe @('--list', '--verbose') -AllowFailure
    if ($list.ExitCode -eq 0) {
        $text = (($list.Output -join "`n") -replace "`0", '')
        foreach ($line in @($text -split '\r?\n')) {
            if ($line -match '^\s*\*?\s*\S.*\s+2\s*$') { return 'distribution-version-2' }
        }
    }
    return ''
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-CanonicalSource([switch]$ToFile) {
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Exit-Blocked 'CANONICAL_REPOSITORY_ROOT_MISSING' -ToFile:$ToFile }
    if (-not (Test-Path -LiteralPath $GitExe -PathType Leaf)) { Exit-Blocked 'FIXED_GIT_EXECUTABLE_MISSING' -ToFile:$ToFile }
    $branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()
    if ($branch -ne 'main') { Exit-Blocked 'CANONICAL_REPOSITORY_NOT_MAIN' @{ branch = $branch } -ToFile:$ToFile }
    $head = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
    if ($head -ne $ExpectedHead) { Exit-Blocked 'CANONICAL_REPOSITORY_HEAD_MISMATCH' @{ localHead = $head } -ToFile:$ToFile }
    $committedBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', "$ExpectedHead`:scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1")).Output -join '').Trim().ToLowerInvariant()
    $workingBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'hash-object', '--path=scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1', $ScriptPath)).Output -join '').Trim().ToLowerInvariant()
    if ($committedBlob -notmatch '^[0-9a-f]{40}$' -or $workingBlob -ne $committedBlob) {
        Exit-Blocked 'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH' -ToFile:$ToFile
    }
}

try {
    $windowsIdentity = Get-ItemProperty -LiteralPath $WindowsCurrentVersionKey -ErrorAction Stop
    $ObservedWindowsProductName = ([string]$windowsIdentity.ProductName).Trim()
    $ObservedWindowsInstallationType = ([string]$windowsIdentity.InstallationType).Trim()
    $ObservedWindowsArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
} catch {
    Exit-Blocked 'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE' -ToFile:$ElevatedChild
}
if ($ObservedWindowsInstallationType -ne 'Client' -or $ObservedWindowsProductName -notmatch '^Windows 10(?:\s|$)' -or $ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture) {
    Exit-Blocked 'WINDOWS_10_X64_CLIENT_REQUIRED' -ToFile:$ElevatedChild
}
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild -or $ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive) {
    Exit-Blocked 'WINDOWS_10_BUILD_NOT_ADMITTED' -ToFile:$ElevatedChild
}
if (-not (Test-Path -LiteralPath $PowerShellExe -PathType Leaf)) { Exit-Blocked 'FIXED_POWERSHELL_EXECUTABLE_MISSING' -ToFile:$ElevatedChild }
if (-not (Test-Path -LiteralPath $DismExe -PathType Leaf)) { Exit-Blocked 'FIXED_DISM_EXECUTABLE_MISSING' -ToFile:$ElevatedChild }
if (-not (Test-Path -LiteralPath $WslExe -PathType Leaf)) { Exit-Blocked 'WSL_EXECUTABLE_MISSING' -ToFile:$ElevatedChild }
Assert-CanonicalSource -ToFile:$ElevatedChild
$ObservedWsl2Evidence = Get-Wsl2Evidence
if ($ObservedWsl2Evidence) {
    Emit-Receipt $true 'FORGE_WSL2_PREREQUISITE_READY' '' @{ rebootRequired = $false } -ToFile:$ElevatedChild
    exit 0
}
if (-not $OperatorApproved -and -not $WhatIfPreference) { Exit-Blocked 'EXACT_WSL2_OPERATOR_APPROVAL_REQUIRED' -ToFile:$ElevatedChild }
if ($WhatIfPreference) {
    Emit-Receipt $true 'WHAT_IF_READY' '' @{ mutationPerformed = $false }
    exit 0
}

if (-not $ElevatedChild) {
    if (Test-Path -LiteralPath $ReceiptPath) { Remove-Item -LiteralPath $ReceiptPath -Force }
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', $ScriptPath,
        '-ExpectedHead', $ExpectedHead,
        '-OperatorApproved', '-ElevatedChild'
    )
    try {
        $process = Start-Process -FilePath $PowerShellExe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    } catch {
        Exit-Blocked 'WSL2_ELEVATION_CANCELLED_OR_FAILED'
    }
    if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) {
        Exit-Blocked 'WSL2_ELEVATED_RECEIPT_MISSING' @{ elevatedExitCode = $process.ExitCode }
    }
    try {
        $json = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8
        $receipt = $json | ConvertFrom-Json -ErrorAction Stop
        if ($receipt.schemaVersion -ne 'stephanos.forge-wsl2-prerequisite-receipt.v1' -or $receipt.expectedHead -ne $ExpectedHead) {
            Exit-Blocked 'WSL2_ELEVATED_RECEIPT_INVALID'
        }
        $json.Trim()
        exit $process.ExitCode
    } finally {
        Remove-Item -LiteralPath $ReceiptPath -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Administrator)) { Exit-Blocked 'WSL2_ELEVATION_NOT_EFFECTIVE' -ToFile }
if ($OperatorApproved) { $ConfirmPreference = 'None' }
if (-not $PSCmdlet.ShouldProcess('Windows 10 WSL2 prerequisite', 'Enable only Microsoft-Windows-Subsystem-Linux and VirtualMachinePlatform')) {
    Exit-Blocked 'WSL2_MUTATION_NOT_CONFIRMED' -ToFile
}

$featureResults = @()
foreach ($Feature in $RequiredFeatures) {
    $probe = Invoke-Fixed $DismExe @('/online', '/Get-FeatureInfo', "/FeatureName:$Feature", '/English') -AllowFailure
    $alreadyEnabled = $probe.ExitCode -eq 0 -and (($probe.Output -join "`n") -match '(?im)^\s*State\s*:\s*Enabled\s*$')
    if ($alreadyEnabled) {
        $featureResults += [ordered]@{ feature = $Feature; alreadyEnabled = $true; exitCode = 0 }
        continue
    }
    $enable = Invoke-Fixed $DismExe @('/online', '/enable-feature', "/featurename:$Feature", '/all', '/norestart') -AllowFailure
    if ($enable.ExitCode -notin @(0, 3010)) {
        Exit-Blocked 'WSL2_WINDOWS_FEATURE_ENABLE_FAILED' @{ feature = $Feature; exitCode = $enable.ExitCode } -ToFile
    }
    $featureResults += [ordered]@{ feature = $Feature; alreadyEnabled = $false; exitCode = $enable.ExitCode }
}

if ($featureResults | Where-Object { -not $_.alreadyEnabled }) {
    Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_REBOOT_REQUIRED' @{
        rebootRequired = $true
        mutationPerformed = $true
        enabledFeatures = @($featureResults)
    } -ToFile
    exit 2
}

$update = Invoke-Fixed $WslExe @('--update') -AllowFailure
if ($update.ExitCode -ne 0) {
    Exit-Blocked 'WSL2_UPDATE_FAILED' @{ exitCode = $update.ExitCode } -ToFile
}
$default = Invoke-Fixed $WslExe @('--set-default-version', '2') -AllowFailure
if ($default.ExitCode -ne 0) {
    Exit-Blocked 'WSL2_DEFAULT_VERSION_2_FAILED' @{ exitCode = $default.ExitCode } -ToFile
}
$ObservedWsl2Evidence = Get-Wsl2Evidence
if (-not $ObservedWsl2Evidence) { Exit-Blocked 'WSL2_PROOF_NOT_READY_AFTER_CONFIGURATION' -ToFile }
Assert-CanonicalSource -ToFile
Emit-Receipt $true 'FORGE_WSL2_PREREQUISITE_READY' '' @{
    mutationPerformed = $true
    rebootRequired = $false
    wsl2Evidence = $ObservedWsl2Evidence
} -ToFile
exit 0
