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
$hostRoot=Join-Path $repoRoot '.stephanos\local-state-checkpoints\sovereign-browser-native-host'
# Each browser's registration owns its extension authorization and workspace
# configuration. Installing another browser must not rewrite either contract.
$outputRoot=Join-Path $hostRoot ($Browser.ToLowerInvariant())
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
$registryKey=Join-Path $registryRoot $hostName
$stageRoot=Join-Path $hostRoot ('.staging-' + $Browser.ToLowerInvariant() + '-' + [Guid]::NewGuid().ToString('N'))
$replacements=New-Object 'System.Collections.Generic.List[object]'
$registrationExisted=$false
$priorRegistration=$null
$registrationTouched=$false
$retainStage=$false
try {
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
  $stageExe=Join-Path $stageRoot 'sovereign-browser-witness-host.exe'
  $stageConfig=Join-Path $stageRoot 'allowed-origins.json'
  $stageManifest=Join-Path $stageRoot 'com.stephanos.sovereign_browser_witness.json'
  # Compile and validate every replacement before touching a working install.
  # The host uses binary stdio framing: compile a console EXE, never a batch shim.
  Add-Type -Path $source -OutputAssembly $stageExe -OutputType ConsoleApplication -ReferencedAssemblies @('System.Web.Extensions.dll','System.dll','System.Core.dll') -ErrorAction Stop
  [void][System.Reflection.AssemblyName]::GetAssemblyName($stageExe)
  @{ allowedOrigins=@($validOrigins) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stageConfig -Encoding UTF8
  @{
    name=$hostName
    description='Origin-scoped Stephanos browser witness for Sovereign Commander'
    path=$hostExe
    type='stdio'
    allowed_origins=@("chrome-extension://$ExtensionId/")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stageManifest -Encoding UTF8
  $checkedConfig=Get-Content -LiteralPath $stageConfig -Raw | ConvertFrom-Json
  $checkedManifest=Get-Content -LiteralPath $stageManifest -Raw | ConvertFrom-Json
  if((@($checkedConfig.allowedOrigins) -join "`n") -cne (@($validOrigins) -join "`n") -or
    $checkedManifest.name -cne $hostName -or $checkedManifest.path -cne $hostExe -or
    $checkedManifest.type -cne 'stdio' -or @($checkedManifest.allowed_origins).Count -ne 1 -or
    $checkedManifest.allowed_origins[0] -cne "chrome-extension://$ExtensionId/") { throw 'BROWSER_STAGED_CONFIGURATION_INVALID' }

  $registrationExisted=Test-Path -LiteralPath $registryKey
  if($registrationExisted) {
    $existingKey=Get-Item -LiteralPath $registryKey
    try {
      $priorRegistration=$existingKey.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if($priorRegistration -isnot [string] -or $existingKey.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String) {
        throw 'BROWSER_EXISTING_REGISTRATION_INVALID'
      }
    } finally { $existingKey.Dispose() }
  }
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $outputRoot 'receipts') -Force | Out-Null
  foreach($file in @('sovereign-browser-witness-host.exe','allowed-origins.json','com.stephanos.sovereign_browser_witness.json')) {
    $entry=[pscustomobject]@{
      target=(Join-Path $outputRoot $file)
      staged=(Join-Path $stageRoot $file)
      backup=(Join-Path $stageRoot ($file + '.previous'))
      existed=[System.IO.File]::Exists((Join-Path $outputRoot $file))
      committed=$false
    }
    [void]$replacements.Add($entry)
    if($entry.existed) { [System.IO.File]::Replace($entry.staged,$entry.target,$entry.backup) }
    else { [System.IO.File]::Move($entry.staged,$entry.target) }
    $entry.committed=$true
  }
  # Publish the registration only after the complete replacement is available.
  $registrationTouched=$true
  if(-not $registrationExisted) { New-Item -Path $registryKey -Force | Out-Null }
  Set-Item -Path $registryKey -Value $hostManifest
} catch {
  $installFailure=$_
  $rollbackFailures=New-Object 'System.Collections.Generic.List[string]'
  if($registrationTouched) {
    try {
      if($registrationExisted) { Set-Item -Path $registryKey -Value $priorRegistration }
      elseif(Test-Path -LiteralPath $registryKey) { Remove-Item -LiteralPath $registryKey -Recurse -Force }
    } catch { [void]$rollbackFailures.Add('registration') }
  }
  for($index=$replacements.Count-1;$index -ge 0;$index--) {
    $entry=$replacements[$index]
    try {
      if($entry.existed -and [System.IO.File]::Exists($entry.backup)) {
        if([System.IO.File]::Exists($entry.target)) { [System.IO.File]::Replace($entry.backup,$entry.target,$null) }
        else { [System.IO.File]::Move($entry.backup,$entry.target) }
      } elseif(-not $entry.existed -and $entry.committed) { [System.IO.File]::Delete($entry.target) }
    } catch { [void]$rollbackFailures.Add('file') }
  }
  if($rollbackFailures.Count -gt 0) {
    $retainStage=$true
    throw "BROWSER_INSTALL_ROLLBACK_INCOMPLETE: preserved recovery files at $stageRoot"
  }
  throw $installFailure
} finally {
  if(-not $retainStage -and (Test-Path -LiteralPath $stageRoot)) {
    try { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
    catch { Write-Warning "BROWSER_INSTALL_STAGING_CLEANUP_FAILED: $stageRoot" }
  }
}
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
