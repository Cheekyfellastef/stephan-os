#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [ValidateSet('Chrome','Edge','Brave')][string]$Browser='Edge',
  [string[]]$AllowedOrigins=@('http://localhost:4173','http://127.0.0.1:4173','http://localhost:5173','http://127.0.0.1:5173')
)
$ErrorActionPreference='Stop'
$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source=Join-Path $PSScriptRoot 'SovereignBrowserWitnessHost.cs'
$outputRoot=Join-Path $repoRoot '.stephanos\local-state-checkpoints\sovereign-browser-native-host'
$hostExe=Join-Path $outputRoot 'sovereign-browser-witness-host.exe'
$hostManifest=Join-Path $outputRoot 'com.stephanos.sovereign_browser_witness.json'
$configFile=Join-Path $outputRoot 'allowed-origins.json'
$hostName='com.stephanos.sovereign_browser_witness'
$registryRoot=switch($Browser) {
  'Edge' {'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'}
  'Chrome' {'HKCU:\Software\Google\Chrome\NativeMessagingHosts'}
  'Brave' {'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'}
}
$validOrigins=New-Object System.Collections.Generic.List[string]
foreach($origin in $AllowedOrigins) {
  $uri=$null
  if(-not [Uri]::TryCreate($origin,[UriKind]::Absolute,[ref]$uri)) { throw 'BROWSER_ORIGIN_INVALID' }
  if($uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.GetLeftPart([UriPartial]::Authority) -cne $origin) { throw 'BROWSER_ORIGIN_INVALID' }
  if($uri.Scheme -eq 'http' -and $uri.Host -notin @('localhost','127.0.0.1')) { throw 'BROWSER_HTTP_ORIGIN_NOT_LOCAL' }
  if(-not $validOrigins.Contains($origin)) { [void]$validOrigins.Add($origin) }
}
if($validOrigins.Count -gt 16 -or $validOrigins.Count -lt 1) { throw 'BROWSER_ORIGIN_COUNT_INVALID' }
if(-not $PSCmdlet.ShouldProcess($hostName, "Build local host and install into $Browser HKCU registry")) { return }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot 'receipts') -Force | Out-Null
if(Test-Path -LiteralPath $hostExe) { Remove-Item -LiteralPath $hostExe -Force }
# The native host must use binary stdio framing: compile a console EXE, never a batch shim.
Add-Type -Path $source -OutputAssembly $hostExe -OutputType ConsoleApplication -ReferencedAssemblies @('System.Web.Extensions.dll','System.dll','System.Core.dll') -ErrorAction Stop
@{ allowedOrigins=@($validOrigins) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configFile -Encoding UTF8
@{
  name=$hostName
  description='Origin-scoped Stephanos browser witness for Sovereign Commander'
  path=$hostExe
  type='stdio'
  allowed_origins=@("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $hostManifest -Encoding UTF8
$registryKey=Join-Path $registryRoot $hostName
New-Item -Path $registryKey -Force | Out-Null
Set-Item -Path $registryKey -Value $hostManifest
[pscustomobject]@{
  schemaVersion='stephanos.browser-native-host-install.v1'
  installed=$true
  browser=$Browser
  hostName=$hostName
  extensionId=$ExtensionId
  manifestPath=$hostManifest
  allowedOrigins=@($validOrigins)
  readOnly=$true
  wholeBrowserAccess=$false
  warning='The extension must be installed and site permissions granted separately. No runtime proof implied.'
} | ConvertTo-Json -Depth 5
