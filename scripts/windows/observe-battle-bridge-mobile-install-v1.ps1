# Read-only structural observation for the existing #1814 recovery owner.
# This script neither enrolls nor invokes an installer. A matching task and
# protected files are not specialist qualification or a reusable authority proof.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSModuleAutoLoadingPreference = 'None'

$root = 'C:\Program Files\Stephanos\SovereignMobileInstallerV1'
$helper = [IO.Path]::Combine($root, 'installer.exe')
$configuration = [IO.Path]::Combine($root, 'enrollment.json')
$taskName = 'Stephanos Mobile Runtime Installer V1'
$systemSid = 'S-1-5-18'
$administratorsSid = 'S-1-5-32-544'
$trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$result = [ordered]@{
 schemaVersion = 'stephanos.mobile-install-native-probe.v1'
 observedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
 state = 'UNPROVEN'
 reason = 'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN'
 sameOperator = $null
 interactiveSession = $null
 fixedTask = $null
 protectedFiles = $null
 helperSha256 = $null
 installationAuthority = $false
}

function Assert-PhysicalProtectedPath([string]$path) {
 $current = [IO.Path]::GetFullPath($path)
 while ($null -ne $current) {
  if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
   throw 'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN'
  }
  $acl = if ([IO.Directory]::Exists($current)) { [IO.Directory]::GetAccessControl($current) } else { [IO.File]::GetAccessControl($current) }
  # Match the fixed-runtime distinction: OS ancestors may be owned by TrustedInstaller
  # and permit creating new children, but may not permit replacement of this route.
  $osAncestor = $current -ceq 'C:\' -or $current -ceq 'C:\Program Files'
  $trusted = if ($osAncestor) { @($systemSid, $administratorsSid, $trustedInstallerSid) } else { @($systemSid, $administratorsSid) }
  $mutation = if ($osAncestor) { 0x500D0150 } else { 0x500D0156 }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cnotin $trusted) {
   throw 'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN'
  }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
   if ((-not $osAncestor -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) -and
       $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
       ($rule.FileSystemRights -band $mutation) -ne 0 -and
       $rule.IdentityReference.Value -cnotin $trusted) {
    throw 'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN'
   }
  }
  $parent = [IO.Path]::GetDirectoryName($current)
  if ($parent -eq $current) { break }
  $current = $parent
 }
}

function Assert-ProtectedTask([object]$task) {
 $acl = [Security.AccessControl.RawSecurityDescriptor]::new($task.GetSecurityDescriptor(7))
 if ($null -eq $acl.DiscretionaryAcl -or $acl.Owner.Value -cnotin @($systemSid, $administratorsSid)) {
  throw 'MOBILE_INSTALL_TASK_UNPROVEN'
 }
 foreach ($ace in $acl.DiscretionaryAcl) {
  if ($ace -isnot [Security.AccessControl.CommonAce]) { throw 'MOBILE_INSTALL_TASK_UNPROVEN' }
  if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
      ($ace.AccessMask -band 0x500D0156) -ne 0 -and
      $ace.SecurityIdentifier.Value -cnotin @($systemSid, $administratorsSid)) {
   throw 'MOBILE_INSTALL_TASK_UNPROVEN'
  }
 }
}

$identity = $null
$process = $null
$stream = $null
$hash = $null
$scheduler = $null
$folder = $null
$task = $null
try {
 $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
 $process = [Diagnostics.Process]::GetCurrentProcess()
 $result.interactiveSession = [Environment]::UserInteractive -and ($process.SessionId -gt 0)
 if (-not [IO.Directory]::Exists($root) -and -not [IO.File]::Exists($root)) {
  $result.state = 'MISSING'; $result.reason = 'MOBILE_INSTALL_ENROLLMENT_MISSING'
 } else {
  if (-not [IO.File]::Exists($helper) -or -not [IO.File]::Exists($configuration)) {
   throw 'MOBILE_INSTALL_ENROLLMENT_INCOMPLETE'
  }
  Assert-PhysicalProtectedPath $helper
  Assert-PhysicalProtectedPath $configuration
  # Content is not deserialized as trust material. The installed verifier, once
  # independently qualified, must validate its own protected policy and keys.
  $configInfo = [IO.FileInfo]::new($configuration)
  if ($configInfo.Length -lt 2 -or $configInfo.Length -gt 16384) { throw 'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN' }
  $stream = [IO.FileStream]::new($helper, 'Open', 'Read', 'Read')
  if ($stream.Length -lt 2 -or $stream.Length -gt 2097152 -or $stream.ReadByte() -ne 77 -or $stream.ReadByte() -ne 90) {
   throw 'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN'
  }
  $stream.Position = 0
  $hash = [Security.Cryptography.SHA256]::Create()
  $result.helperSha256 = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  $result.protectedFiles = $true
  $scheduler = [Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service', $true))
  $scheduler.Connect()
  $folder = $scheduler.GetFolder('\')
  $task = $folder.GetTask($taskName)
  Assert-ProtectedTask $task
  $definition = $task.Definition
  $principal = $definition.Principal
  $result.sameOperator = ([string]$principal.UserId -ceq $identity.User.Value -or [string]$principal.UserId -ieq $identity.Name)
  if (-not $result.sameOperator -or [int]$principal.LogonType -ne 3 -or [int]$principal.RunLevel -ne 1 -or
      $definition.Actions.Count -ne 1 -or $definition.Triggers.Count -ne 0 -or -not $definition.Settings.Enabled -or
      [int]$definition.Settings.MultipleInstances -ne 2) { throw 'MOBILE_INSTALL_TASK_UNPROVEN' }
  $action = $definition.Actions.Item(1)
  if ([int]$action.Type -ne 0 -or [string]$action.Path -ine $helper -or
      [string]$action.Arguments -cne '' -or [string]$action.WorkingDirectory -ine $root) {
   throw 'MOBILE_INSTALL_TASK_UNPROVEN'
  }
  $result.fixedTask = $true
  if (-not $result.interactiveSession) { throw 'MOBILE_INSTALL_OPERATOR_SESSION_MISSING' }
  # Structural presence never upgrades to enrolled/ready or grants installation.
  # Hard-link/file-ID pins, policy verification and native qualification are not
  # established by this read-only script and must remain a separate boundary.
  $result.state = 'UNQUALIFIED'
  $result.reason = 'MOBILE_INSTALL_NATIVE_VERIFIER_QUALIFICATION_REQUIRED'
 }
} catch {
 $reason = [string]$_.Exception.Message
 $known = @('MOBILE_INSTALL_ENROLLMENT_INCOMPLETE', 'MOBILE_INSTALL_PROTECTED_PATH_UNPROVEN',
  'MOBILE_INSTALL_TASK_UNPROVEN', 'MOBILE_INSTALL_OPERATOR_SESSION_MISSING')
 if ($reason -cin $known) { $result.reason = $reason }
 else { $result.reason = 'MOBILE_INSTALL_NATIVE_OBSERVATION_UNPROVEN' }
 $result.state = 'UNPROVEN'
} finally {
 if ($null -ne $stream) { $stream.Dispose() }
 if ($null -ne $hash) { $hash.Dispose() }
 if ($null -ne $identity) { $identity.Dispose() }
 if ($null -ne $process) { $process.Dispose() }
 foreach ($com in @($task, $folder, $scheduler)) {
  if ($null -ne $com -and [Runtime.InteropServices.Marshal]::IsComObject($com)) {
   try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com) } catch { }
  }
 }
}
# A NoProfile process with module autoload disabled must not depend on implicit
# Utility-module loading (or a user-provided PSModulePath) for its output.
[void][Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
$serializer = [Web.Script.Serialization.JavaScriptSerializer]::new()
$serializer.MaxJsonLength = 16384
$serializer.RecursionLimit = 3
[Console]::WriteLine('STEPHANOS_MOBILE_INSTALL_OBSERVATION_V1=' + $serializer.Serialize($result))
