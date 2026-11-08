#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess=$true)]
param([ValidateSet('Chrome','Edge','Brave')][string]$Browser='Edge')
$ErrorActionPreference='Stop'
$hostName='com.stephanos.sovereign_browser_witness'
$root=switch($Browser) {
  'Edge' {'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'}
  'Chrome' {'HKCU:\Software\Google\Chrome\NativeMessagingHosts'}
  'Brave' {'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'}
}
$key=Join-Path $root $hostName
if((Test-Path $key) -and $PSCmdlet.ShouldProcess($key,'Remove extension native host registration')) {
  Remove-Item -Path $key -Recurse -Force
}
[pscustomobject]@{browser=$Browser;registrationPresent=(Test-Path $key);localEvidencePreserved=$true} | ConvertTo-Json
