[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$splashWrapperPath = Join-Path $repositoryRoot 'scripts\windows\launch-starfield-vr-with-splash.ps1'
$installerReceiptPath = Join-Path $workspaceRoot 'vr\starfield-vr-shortcut-install-current.json'
$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if (-not $desktopPath) {
    throw 'Unable to resolve the current user Desktop folder.'
}
$shortcutPath = Join-Path $desktopPath 'Starfield VR.lnk'

function Get-InstalledSourceHead {
    try {
        $git = Get-Command git.exe -ErrorAction Stop
        $result = & $git.Source -C $repositoryRoot rev-parse HEAD 2>$null
        if ($LASTEXITCODE -ne 0) { return '' }
        $head = ([string]$result).Trim().ToLowerInvariant()
        if ($head -match '^[0-9a-f]{40}$') { return $head }
    }
    catch {}
    return ''
}

function Read-InstallerReceipt {
    if (-not (Test-Path -LiteralPath $installerReceiptPath -PathType Leaf)) {
        return [ordered]@{ present = $false; verdict = '' }
    }
    try {
        $receipt = Get-Content -LiteralPath $installerReceiptPath -Raw | ConvertFrom-Json
        $verdict = [string]$receipt.finalVerdict
        if ($verdict.Length -gt 120) { $verdict = '' }
        return [ordered]@{ present = $true; verdict = $verdict }
    }
    catch {
        return [ordered]@{ present = $true; verdict = '' }
    }
}

$desktopIconPresent = Test-Path -LiteralPath $shortcutPath -PathType Leaf
$splashWrapperPresent = Test-Path -LiteralPath $splashWrapperPath -PathType Leaf
$shortcutTargetPath = ''
$shortcutArguments = ''
$shortcutRoutesThroughSplash = $false

if ($desktopIconPresent) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcutTargetPath = [string]$shortcut.TargetPath
        $shortcutArguments = [string]$shortcut.Arguments
        if ($shortcutTargetPath.Length -gt 500) { $shortcutTargetPath = '' }
        if ($shortcutArguments.Length -gt 1000) { $shortcutArguments = '' }

        $match = [regex]::Match($shortcutArguments, '(?i)(?:^|\s)-File\s+"([^"]+)"')
        if ($match.Success) {
            $candidate = $match.Groups[1].Value
            try {
                $candidateFull = [System.IO.Path]::GetFullPath($candidate)
                $expectedFull = [System.IO.Path]::GetFullPath($splashWrapperPath)
                $shortcutRoutesThroughSplash = [string]::Equals(
                    $candidateFull,
                    $expectedFull,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
            catch {
                $shortcutRoutesThroughSplash = $false
            }
        }
    }
    catch {
        $shortcutTargetPath = ''
        $shortcutArguments = ''
        $shortcutRoutesThroughSplash = $false
    }
}

$installerReceipt = Read-InstallerReceipt
$installedSourceHead = Get-InstalledSourceHead
$proofRoot = Join-Path $workspaceRoot 'vr'
New-Item -ItemType Directory -Path $proofRoot -Force | Out-Null
$proofPath = Join-Path $proofRoot 'starfield-vr-delivery-current.json'

$observation = [ordered]@{
    schemaVersion = 'stephanos.starfield-vr-local-delivery-observation.v1'
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    desktopIconPresent = [bool]$desktopIconPresent
    splashWrapperPresent = [bool]$splashWrapperPresent
    shortcutTargetPath = $shortcutTargetPath
    shortcutArguments = $shortcutArguments
    shortcutRoutesThroughSplash = [bool]$shortcutRoutesThroughSplash
    installerReceiptPresent = [bool]$installerReceipt.present
    installerReceiptVerdict = [string]$installerReceipt.verdict
    installedSourceHead = $installedSourceHead
}

$observation | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $proofPath -Encoding UTF8
$observation | ConvertTo-Json -Depth 6
