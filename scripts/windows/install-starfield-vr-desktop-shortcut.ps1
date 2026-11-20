[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ProfilePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcherScript = Join-Path $repositoryRoot 'scripts\windows\launch-starfield-vr.ps1'
$splashLauncherScript = Join-Path $repositoryRoot 'scripts\windows\launch-starfield-vr-with-splash.ps1'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
if (-not $ProfilePath) {
    $ProfilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile.json'
}

$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($required in @($launcherScript, $splashLauncherScript, $powershellExecutable)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required Starfield VR launcher component is missing: $required"
    }
}
if ($launcherScript.Contains('"') -or $splashLauncherScript.Contains('"') -or $ProfilePath.Contains('"')) {
    throw 'Launcher and profile paths must not contain quote characters.'
}

$sourceHead = ''
try { $sourceHead = (& git -C $repositoryRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant() } catch { $sourceHead = '' }
if ($sourceHead.Length -ne 40 -or $sourceHead -notmatch '^[a-f0-9]{40}') {
    throw 'Unable to prove the repository source head for Starfield VR shortcut installation.'
}
$shortcutSourcePaths = @(
    'scripts/windows/install-starfield-vr-desktop-shortcut.ps1',
    'scripts/windows/launch-starfield-vr-with-splash.ps1',
    'scripts/windows/launch-starfield-vr.ps1'
)
$dirtyShortcutSource = (& git -C $repositoryRoot status --porcelain --untracked-files=no -- $shortcutSourcePaths 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify Starfield VR shortcut source against the current repository head.'
}
if ($dirtyShortcutSource) {
    throw "Starfield VR shortcut installation blocked dirty reviewed source: $dirtyShortcutSource"
}
$splashLauncherSha256 = (Get-FileHash -LiteralPath $splashLauncherScript -Algorithm SHA256).Hash.ToLowerInvariant()

$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if (-not $desktopPath) {
    throw 'Unable to resolve the current user Desktop folder.'
}
$shortcutPath = Join-Path $desktopPath 'Starfield VR.lnk'
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$splashLauncherScript`" -ProfilePath `"$ProfilePath`""
$iconPath = $powershellExecutable

if (Test-Path -LiteralPath $ProfilePath -PathType Leaf) {
    try {
        $profile = Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
        $candidateIcon = [string]$profile.game.launchExecutablePath
        if ($candidateIcon -and (Test-Path -LiteralPath $candidateIcon -PathType Leaf)) {
            $iconPath = (Resolve-Path -LiteralPath $candidateIcon).Path
        }
    }
    catch {
        Write-Warning "Profile is not ready for icon selection yet: $($_.Exception.Message)"
    }
}

if ($PSCmdlet.ShouldProcess($shortcutPath, 'Create or update Starfield VR desktop shortcut')) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershellExecutable
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $repositoryRoot
    $shortcut.Description = 'Open the verified Starfield VR launch experience for Quest 3 Meta Air Link.'
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Save()
}

$proofRoot = Join-Path $workspaceRoot 'vr'
New-Item -ItemType Directory -Path $proofRoot -Force | Out-Null
$proofPath = Join-Path $proofRoot 'starfield-vr-shortcut-install-current.json'
$proof = [ordered]@{
    schemaVersion = 'stephanos.starfield-vr-shortcut-install.v2'
    writtenAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    goal = 1591
    workerGoal = 1595
    shortcutName = 'Starfield VR'
    shortcutPath = $shortcutPath
    targetPath = $powershellExecutable
    arguments = $arguments
    workingDirectory = $repositoryRoot
    splashLauncherScript = $splashLauncherScript
    splashLauncherSha256 = $splashLauncherSha256
    sourceHead = $sourceHead
    sourceClean = $true
    sourcePaths = $shortcutSourcePaths
    launcherScript = $launcherScript
    profilePath = $ProfilePath
    iconPath = $iconPath
    created = if ($WhatIfPreference) { $false } else { Test-Path -LiteralPath $shortcutPath -PathType Leaf }
    finalVerdict = if ($WhatIfPreference) { 'STARFIELD_VR_SHORTCUT_PREVIEWED' } else { 'STARFIELD_VR_SHORTCUT_INSTALLED' }
}
$proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $proofPath -Encoding UTF8
$proof | ConvertTo-Json -Depth 8
