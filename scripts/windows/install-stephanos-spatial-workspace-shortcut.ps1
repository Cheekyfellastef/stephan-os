[CmdletBinding()]
param(
    [string]$ShortcutName = 'Stephanos Spatial Workspace.lnk'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcherScript = Join-Path $repositoryRoot 'scripts\windows\launch-stephanos-spatial-workspace.ps1'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
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

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExecutable
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcherScript + '"'
$shortcut.WorkingDirectory = $repositoryRoot
$iconLibrary = Join-Path $env:SystemRoot 'System32\imageres.dll'
if (Test-Path -LiteralPath $iconLibrary -PathType Leaf) {
    $shortcut.IconLocation = $iconLibrary + ',72'
}
$shortcut.Description = 'Open the Stephanos Spatial Workspace VR entry card.'
$shortcut.Save()

[pscustomobject]@{
    schemaVersion = 'stephanos.spatial-workspace-shortcut.v1'
    verdict = 'SPATIAL_WORKSPACE_SHORTCUT_READY'
    path = $shortcutPath
    launcher = $launcherScript
} | ConvertTo-Json -Compress
