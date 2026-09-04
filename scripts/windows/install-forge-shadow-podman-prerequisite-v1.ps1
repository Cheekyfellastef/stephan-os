[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [switch]$OperatorApproved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'Cheekyfellastef/stephan-os'
$PodmanVersion = '6.0.2'
$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'
$MinimumWindowsBuild = 19043
$MaximumWindowsBuildExclusive = 22000
$RequiredWindowsArchitecture = 'X64'
$PodmanDesktopVersion = '1.29.1'
$PodmanDesktopSourceCommit = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc'
$PodmanDesktopPodmanManifestBlob = '5acfedd1c3171414aa218a1d5d95ea7529687809'
$CompatibilityAuthority = 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2'
$WindowsCurrentVersionKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$InstallerUrl = 'https://github.com/podman-container-tools/podman/releases/download/v6.0.2/podman-installer-windows-amd64.msi'
$InstallerSha256 = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f'
$RepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
$WslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$MsiexecExe = Join-Path $env:SystemRoot 'System32\msiexec.exe'
$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$ExpectedHead = $ExpectedHead.ToLowerInvariant()
$ObservedWindowsBuild = [Environment]::OSVersion.Version.Build
$ObservedWindowsProductName = ''
$ObservedWindowsInstallationType = ''
$ObservedWindowsArchitecture = ''
$ObservedWsl2Evidence = ''

function Emit-Blocked([string]$Blocker, [hashtable]$Details = @{}) {
    $result = [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-prerequisite-receipt.v1'
        ok = $false
        status = 'BLOCKED'
        blocker = $Blocker
        repository = $Repository
        expectedHead = $ExpectedHead
        podmanVersion = $PodmanVersion
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        installerSha256 = $InstallerSha256
        userScope = $true
        adminRequired = $false
        sourceMutation = $false
        forgeRuntimeMutation = $false
        machineMutation = $false
        containerMutation = $false
        imagePull = $false
        githubCredentialUsed = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        callerSelectedUrlAllowed = $false
        callerSelectedPathAllowed = $false
        callerSelectedExecutableAllowed = $false
    }
    foreach ($key in $Details.Keys) { $result[$key] = $Details[$key] }
    $result | ConvertTo-Json -Depth 6 -Compress
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
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Fixed executable failed with exit code $code"
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Get-PodmanVersion([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    $probe = Invoke-Fixed $Path @('--version') -AllowFailure
    if ($probe.ExitCode -ne 0) { return '' }
    return (($probe.Output -join ' ').Trim())
}

function Get-Wsl2Evidence {
    $status = Invoke-Fixed $WslExe @('--status') -AllowFailure
    if ($status.ExitCode -eq 0) {
        $statusText = (($status.Output -join "`n") -replace "`0", '')
        if ($statusText -match '(?im)^\s*Default Version:\s*2\s*$') {
            return 'default-version-2'
        }
    }

    $list = Invoke-Fixed $WslExe @('--list', '--verbose') -AllowFailure
    if ($list.ExitCode -eq 0) {
        $listText = (($list.Output -join "`n") -replace "`0", '')
        foreach ($line in @($listText -split '\r?\n')) {
            if ($line -match '^\s*\*?\s*\S.*\s+2\s*$') {
                return 'distribution-version-2'
            }
        }
    }
    return ''
}

try {
    $windowsIdentity = Get-ItemProperty -LiteralPath $WindowsCurrentVersionKey -ErrorAction Stop
    $ObservedWindowsProductName = ([string]$windowsIdentity.ProductName).Trim()
    $ObservedWindowsInstallationType = ([string]$windowsIdentity.InstallationType).Trim()
    $ObservedWindowsArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
} catch {
    Emit-Blocked 'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE'
}
if ($ObservedWindowsInstallationType -ne 'Client' -or $ObservedWindowsProductName -notmatch '^Windows 10(?:\s|$)') {
    Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED'
}
if ($ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture) {
    Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' @{ observedWindowsArchitecture = $ObservedWindowsArchitecture }
}

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Emit-Blocked 'CANONICAL_REPOSITORY_ROOT_MISSING' }
if (-not (Test-Path -LiteralPath $GitExe -PathType Leaf)) { Emit-Blocked 'FIXED_GIT_EXECUTABLE_MISSING' }
if (-not (Test-Path -LiteralPath $WslExe -PathType Leaf)) { Emit-Blocked 'WSL_EXECUTABLE_MISSING' }
if (-not (Test-Path -LiteralPath $MsiexecExe -PathType Leaf)) { Emit-Blocked 'MSIEXEC_EXECUTABLE_MISSING' }
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild) {
    Emit-Blocked 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED'
}
if ($ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive) {
    Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' @{ observedWindowsBuild = $ObservedWindowsBuild }
}

$branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()
if ($branch -ne 'main') { Emit-Blocked 'CANONICAL_REPOSITORY_NOT_MAIN' @{ branch = $branch } }
$localHead = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
if ($localHead -ne $ExpectedHead) { Emit-Blocked 'CANONICAL_REPOSITORY_HEAD_MISMATCH' @{ localHead = $localHead } }
$localTree = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', "$ExpectedHead^{tree}")).Output -join '').Trim().ToLowerInvariant()
if ($localTree -notmatch '^[0-9a-f]{40}$') { Emit-Blocked 'CANONICAL_REPOSITORY_TREE_INVALID' }

$ObservedWsl2Evidence = Get-Wsl2Evidence
if (-not $ObservedWsl2Evidence) { Emit-Blocked 'WSL2_NOT_AVAILABLE' }

if (-not $OperatorApproved -and -not $WhatIfPreference) { Emit-Blocked 'EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED' }

$existingVersion = Get-PodmanVersion $PodmanUserExe
if ($existingVersion) {
    if ($existingVersion -notmatch '^podman version 6\.0\.2(?:\s|$)') {
        Emit-Blocked 'PODMAN_USER_VERSION_MISMATCH' @{ observedVersion = $existingVersion }
    }
    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-prerequisite-receipt.v1'
        ok = $true
        status = 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'
        blocker = ''
        repository = $Repository
        expectedHead = $ExpectedHead
        canonicalTree = $localTree
        podmanVersion = $PodmanVersion
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        podmanExecutableIdentity = 'fixed-user-podman'
        installerSha256 = $InstallerSha256
        installerSignatureValid = $null
        installPerformed = $false
        userScope = $true
        adminRequired = $false
        sourceMutation = $false
        forgeRuntimeMutation = $false
        machineMutation = $false
        containerMutation = $false
        imagePull = $false
        githubCredentialUsed = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        callerSelectedUrlAllowed = $false
        callerSelectedPathAllowed = $false
        callerSelectedExecutableAllowed = $false
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

if ($WhatIfPreference) {
    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-prerequisite-receipt.v1'
        ok = $true
        status = 'WHAT_IF_READY'
        blocker = ''
        repository = $Repository
        expectedHead = $ExpectedHead
        canonicalTree = $localTree
        podmanVersion = $PodmanVersion
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        installerSha256 = $InstallerSha256
        installPerformed = $false
        userScope = $true
        adminRequired = $false
        sourceMutation = $false
        forgeRuntimeMutation = $false
        machineMutation = $false
        containerMutation = $false
        imagePull = $false
        githubCredentialUsed = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

$tempRoot = Join-Path $env:TEMP 'stephanos-forge-podman-prerequisite-v1'
$msiPath = Join-Path $tempRoot 'podman-installer-windows-amd64-6.0.2.msi'
$installPerformed = $false
$signatureValid = $false
try {
    if (-not $PSCmdlet.ShouldProcess($PodmanUserExe, 'Install fixed user-scoped Podman 6.0.2 prerequisite')) {
        Emit-Blocked 'RUNTIME_MUTATION_NOT_CONFIRMED'
    }
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    if (Test-Path -LiteralPath $msiPath) { Remove-Item -LiteralPath $msiPath -Force }

    Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $msiPath -MaximumRedirection 5
    $actualDigest = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualDigest -ne $InstallerSha256) {
        Emit-Blocked 'PODMAN_INSTALLER_DIGEST_MISMATCH' @{ observedSha256 = $actualDigest }
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $msiPath
    if ([string]$signature.Status -ne 'Valid') {
        Emit-Blocked 'PODMAN_INSTALLER_SIGNATURE_INVALID' @{ signatureStatus = [string]$signature.Status }
    }
    $signatureValid = $true

    $process = Start-Process -FilePath $MsiexecExe -ArgumentList @(
        '/i', $msiPath,
        '/qn',
        '/norestart',
        'ALLUSERS=2',
        'MSIINSTALLPERUSER=1'
    ) -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -notin @(0, 3010)) {
        Emit-Blocked 'PODMAN_USER_INSTALL_FAILED' @{ exitCode = $process.ExitCode }
    }
    $installPerformed = $true

    if (-not (Test-Path -LiteralPath $PodmanUserExe -PathType Leaf)) {
        Emit-Blocked 'PODMAN_USER_EXECUTABLE_MISSING_AFTER_INSTALL'
    }
    $installedVersion = Get-PodmanVersion $PodmanUserExe
    if ($installedVersion -notmatch '^podman version 6\.0\.2(?:\s|$)') {
        Emit-Blocked 'PODMAN_USER_VERSION_NOT_PROVEN' @{ observedVersion = $installedVersion }
    }

    $headAfter = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
    $treeAfter = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', "$ExpectedHead^{tree}")).Output -join '').Trim().ToLowerInvariant()
    if ($headAfter -ne $ExpectedHead -or $treeAfter -ne $localTree) {
        Emit-Blocked 'CANONICAL_REPOSITORY_CHANGED_DURING_PREREQUISITE_INSTALL' @{ localHead = $headAfter; canonicalTree = $treeAfter }
    }

    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-prerequisite-receipt.v1'
        ok = $true
        status = 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'
        blocker = ''
        repository = $Repository
        expectedHead = $ExpectedHead
        canonicalTree = $localTree
        podmanVersion = $PodmanVersion
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        podmanExecutableIdentity = 'fixed-user-podman'
        installerSha256 = $InstallerSha256
        installerSignatureValid = $signatureValid
        installPerformed = $installPerformed
        userScope = $true
        adminRequired = $false
        sourceMutation = $false
        forgeRuntimeMutation = $false
        machineMutation = $false
        containerMutation = $false
        imagePull = $false
        githubCredentialUsed = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        callerSelectedUrlAllowed = $false
        callerSelectedPathAllowed = $false
        callerSelectedExecutableAllowed = $false
    } | ConvertTo-Json -Depth 6 -Compress
} catch {
    Emit-Blocked 'PODMAN_PREREQUISITE_INSTALLER_EXCEPTION' @{ errorType = $_.Exception.GetType().FullName }
} finally {
    if (Test-Path -LiteralPath $msiPath -PathType Leaf) {
        Remove-Item -LiteralPath $msiPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $tempRoot -PathType Container) {
        Remove-Item -LiteralPath $tempRoot -Force -Recurse -ErrorAction SilentlyContinue
    }
}
