[CmdletBinding()]
param([string]$LocalUrl = 'http://127.0.0.1:4173/apps/vr-link/index.html')
$ErrorActionPreference='Stop'
if ($LocalUrl -notmatch '^http://127\.0\.0\.1:[0-9]{2,5}/apps/vr-link/index\.html$') {
  throw 'Only the bounded loopback VR Link route is permitted.'
}
$desktop=[Environment]::GetFolderPath('Desktop')
$target=Join-Path $desktop 'Stephanos VR Link.lnk'
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($target)
$shortcut.TargetPath='explorer.exe'
$shortcut.Arguments=$LocalUrl
$shortcut.Description='Open Stephanos VR Link Holodeck Baseline on local Battle Bridge'
$shortcut.Save()
[pscustomobject]@{ok=(Test-Path -LiteralPath $target);path=$target;url=$LocalUrl;finalVerdict='STEPHANOS_VR_LINK_SHORTCUT_CREATED'}|ConvertTo-Json -Compress
