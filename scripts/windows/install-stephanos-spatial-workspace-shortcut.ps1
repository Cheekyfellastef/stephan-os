[CmdletBinding()]
param(
    [string]$ShortcutName = 'Stephanos Spatial Workspace.lnk',
    [switch]$VerifiedHelperOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'spatial-window-install-lock.ps1')
$installationLock = Enter-SpatialWindowInstallLock -RepositoryRoot $repositoryRoot
try {
$launcherScript = Join-Path $repositoryRoot 'scripts\windows\launch-stephanos-spatial-workspace.ps1'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw 'Spatial Workspace shortcut installer could not resolve an existing Desktop directory.'
}
$invalidShortcutName = [string]::IsNullOrWhiteSpace($ShortcutName) -or [System.IO.Path]::IsPathRooted($ShortcutName) -or [System.IO.Path]::GetFileName($ShortcutName) -ne $ShortcutName -or [System.IO.Path]::GetExtension($ShortcutName) -ne '.lnk'
if ($invalidShortcutName) {
    throw 'Spatial Workspace shortcut name must be one leaf .lnk filename on the desktop.'
}
$desktopFullPath = [System.IO.Path]::GetFullPath($desktop).TrimEnd('\')
$shortcutPath = [System.IO.Path]::GetFullPath((Join-Path $desktopFullPath $ShortcutName))
$shortcutParent = [System.IO.Path]::GetDirectoryName($shortcutPath)
if (-not [System.StringComparer]::OrdinalIgnoreCase.Equals($shortcutParent, $desktopFullPath)) {
    throw 'Spatial Workspace shortcut destination must remain exactly on the desktop.'
}

if (-not (Test-Path -LiteralPath $launcherScript -PathType Leaf)) {
    throw "Spatial Workspace launcher is missing: $launcherScript"
}

if (-not $VerifiedHelperOnly) { & (Join-Path $PSScriptRoot 'install-spatial-window.ps1') }
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $repositoryRoot 'scripts\spatial-window-host.mjs') --verify-installation | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The console installation did not verify; no shortcut was changed.' }
Assert-SpatialWindowPlainPath -Path $shortcutPath

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExecutable
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcherScript + '"'
$shortcut.WorkingDirectory = $repositoryRoot
$iconLibrary = Join-Path $env:SystemRoot 'System32\imageres.dll'
if (Test-Path -LiteralPath $iconLibrary -PathType Leaf) {
    $shortcut.IconLocation = $iconLibrary + ',72'
}
$shortcut.Description = 'Open Spatial Workspace and its local ChatGPT window console.'
$shortcut.Save()
$saved = $shell.CreateShortcut($shortcutPath)
if ($saved.TargetPath -ne $powershellExecutable -or $saved.Arguments -cne $shortcut.Arguments -or $saved.WorkingDirectory -ne $repositoryRoot) { throw 'The Spatial Workspace shortcut did not verify.' }

[pscustomobject]@{
    schemaVersion = 'stephanos.spatial-workspace-shortcut.v1'
    verdict = 'SPATIAL_WORKSPACE_SHORTCUT_READY'
    path = $shortcutPath
    launcher = $launcherScript
} | ConvertTo-Json -Compress
} finally { Exit-SpatialWindowInstallLock -Mutex $installationLock }
