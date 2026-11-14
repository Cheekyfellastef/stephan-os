# Initial manual enrollment adapter, never a routine runtime command.
# The approved immutable caller independently authenticates protected source,
# specialist review/merge evidence and the exact operator enrollment decision.
# Hashes below bind those captured bytes; hashes/flags alone prove none of them.
param([switch]$OperatorApproved,[string]$ExpectedMain='')
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$bootstrap=$script:MobileInstallerEnrollmentPinnedBootstrapV1
if(-not $OperatorApproved -or $ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or $null -eq $bootstrap -or
   $bootstrap.SourceHead -cne $ExpectedMain -or $bootstrap.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or
   $bootstrap.OperatorSid -cnotmatch '^S-1-5-21-[0-9-]+$' -or $bootstrap.MachineHash -cnotmatch '^[a-f0-9]{64}$' -or
   $bootstrap.Records.Count -ne 18 -or $bootstrap.ReleaseFiles.Count -ne 4 -or
   $bootstrap.SetupDescriptorSha256 -cnotmatch '^[a-f0-9]{64}$') {throw 'MOBILE_ENROLLMENT_IMMUTABLE_APPROVAL_REQUIRED'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try {
 if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
    $identity.User.Value -cne $bootstrap.OperatorSid -or -not [Environment]::UserInteractive -or
    [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0) {throw 'MOBILE_ENROLLMENT_SAME_OPERATOR_ADMINISTRATOR_REQUIRED'}
}finally{$identity.Dispose()}
$root='C:\Program Files\Stephanos\SovereignMobileInstallerV1'
if([IO.Directory]::Exists($root) -or [IO.File]::Exists($root)) {throw 'MOBILE_ENROLLMENT_ALREADY_EXISTS_INSPECT_ONLY'}
$administrators=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$operator=[Security.Principal.SecurityIdentifier]::new($bootstrap.OperatorSid)
function Get-MobileDigest([byte[]]$bytes) {
 $hash=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
}
function Get-MobileBlob([byte[]]$bytes) {
 $hash=[Security.Cryptography.SHA1]::Create()
 try{return ([BitConverter]::ToString($hash.ComputeHash([byte[]]([Text.Encoding]::ASCII.GetBytes('blob '+$bytes.Length+[char]0)+$bytes)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
}
function Get-MobileGitObject([string]$kind,[byte[]]$bytes) {
 $hash=[Security.Cryptography.SHA1]::Create()
 try{return ([BitConverter]::ToString($hash.ComputeHash([byte[]]([Text.Encoding]::ASCII.GetBytes($kind+' '+$bytes.Length+[char]0)+$bytes)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
}
function Read-MobileProofBase64([string]$encoded,[int]$maximum) {
 if($null -eq $encoded -or $encoded.Length -gt (4*[Math]::Ceiling($maximum/3)) -or
    $encoded -cnotmatch '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_BOUND'}
 $bytes=[Convert]::FromBase64String($encoded)
 if($bytes.Length -gt $maximum -or [Convert]::ToBase64String($bytes) -cne $encoded){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_ENCODING'}
 return ,$bytes
}
function Assert-MobileSourceMembership {
 # Authenticate membership BEFORE compiling or loading any captured source.
 # Canonical remote-main/review/approval remain the immutable caller's gates.
 $wire=[string]$bootstrap.SourceProofWire
 if($wire.Length -gt 3145728 -or $wire -cmatch '[^\x20-\x7e]'){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_BOUND'}
 $parts=$wire.Split(' ')
 if($parts.Count -lt 4 -or $parts.Count -gt 131 -or $parts[0] -cne 'STEPHANOS_FIXED_RUNTIME_SOURCE_V1' -or $parts[1] -cne $ExpectedMain){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_IDENTITY'}
 $commit=Read-MobileProofBase64 $parts[2] 65536
 if((Get-MobileGitObject 'commit' $commit) -cne $ExpectedMain){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_COMMIT'}
 $text=[Text.UTF8Encoding]::new($false,$true).GetString($commit);$separator=$text.IndexOf("`n`n",[StringComparison]::Ordinal)
 if($separator -lt 0 -or $text -cnotmatch '\Atree ([a-f0-9]{40})\n' -or $Matches[1] -cne $bootstrap.SourceTree){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_TREE'}
 if(@($text.Substring(0,$separator).Split([char]10)|Where-Object{$_.StartsWith('tree ',[StringComparison]::Ordinal)}).Count -ne 1){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_TREE'}
 $trees=@{};$previous='';[long]$total=0;$entryCount=0
 foreach($part in $parts[3..($parts.Count-1)]) {
  if($part.Length -lt 42 -or $part[40] -cne ':' -or $part.Substring(0,40) -cnotmatch '^[a-f0-9]{40}$'){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_TREE'}
  $id=$part.Substring(0,40);$bytes=Read-MobileProofBase64 $part.Substring(41) 2097152;$total+=$bytes.Length
  if($total -gt 2097152 -or [StringComparer]::Ordinal.Compare($id,$previous) -le 0 -or (Get-MobileGitObject 'tree' $bytes) -cne $id){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_TREE'}
  $previous=$id;$rows=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
  $folded=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$offset=0;$lastKey=$null
  while($offset -lt $bytes.Length) {
   $entryCount++;if($entryCount -gt 32768){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_BOUND'}
   $space=[Array]::IndexOf($bytes,[byte]32,$offset);$end=if($space -ge 0){[Array]::IndexOf($bytes,[byte]0,$space+1)}else{-1}
   if($space -le $offset -or $end -le ($space+1) -or ($end+21) -gt $bytes.Length -or ($end-$space-1) -gt 255){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_TREE'}
   $mode=[Text.Encoding]::ASCII.GetString($bytes,$offset,$space-$offset)
   $name=[Text.UTF8Encoding]::new($false,$true).GetString($bytes,$space+1,$end-$space-1)
   if($mode -cnotin @('40000','100644','100755') -or $name -cin @('.','..') -or $name -cmatch '[\\/:<>"|?*\x00-\x1f\x7f]' -or
      $name.EndsWith('.') -or $name.EndsWith(' ') -or -not $folded.Add($name)){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_PATH'}
   $key=[Text.Encoding]::UTF8.GetBytes($name+$(if($mode -ceq '40000'){'/'}else{''}))
   if($null -ne $lastKey) {
    $comparison=0;$minimum=[Math]::Min($lastKey.Length,$key.Length)
    for($n=0;$n -lt $minimum -and $comparison -eq 0;$n++){$comparison=[int]$lastKey[$n]-[int]$key[$n]}
    if($comparison -eq 0){$comparison=$lastKey.Length-$key.Length};if($comparison -ge 0){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_ORDER'}
   }
   $lastKey=$key;$blob=([BitConverter]::ToString($bytes,$end+1,20)).Replace('-','').ToLowerInvariant()
   $rows[$name]=[pscustomobject]@{Mode=$mode;Sha=$blob};$offset=$end+21
  }
  $trees[$id]=$rows
 }
 $used=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 foreach($row in $records.Values) {
  $id=$bootstrap.SourceTree;$names=$row.Path.Split('/')
  for($n=0;$n -lt $names.Count;$n++) {
   if(-not $trees.ContainsKey($id) -or -not $trees[$id].ContainsKey($names[$n])){throw 'MOBILE_ENROLLMENT_SOURCE_MEMBERSHIP_UNPROVEN'}
   [void]$used.Add($id);$leaf=$trees[$id][$names[$n]]
   if($n -eq $names.Count-1){if($leaf.Mode -cne '100644' -or $leaf.Sha -cne $row.GitBlobSha){throw 'MOBILE_ENROLLMENT_SOURCE_MEMBERSHIP_UNPROVEN'}}
   else{if($leaf.Mode -cne '40000'){throw 'MOBILE_ENROLLMENT_SOURCE_MEMBERSHIP_UNPROVEN'};$id=$leaf.Sha}
  }
 }
 if($used.Count -ne $trees.Count){throw 'MOBILE_ENROLLMENT_SOURCE_PROOF_UNUSED_TREE'}
}
function Assert-MobileProtected([string]$path) {
 $current=[IO.Path]::GetFullPath($path)
 while($null -ne $current) {
  if(([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'MOBILE_ENROLLMENT_REDIRECTION_REFUSED'}
  $acl=if([IO.Directory]::Exists($current)){[IO.Directory]::GetAccessControl($current)}else{[IO.File]::GetAccessControl($current)}
  $osAncestor=$current -ceq 'C:\' -or $current -ceq 'C:\Program Files'
  $trusted=if($osAncestor){@($system.Value,$administrators.Value,'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')}else{@($system.Value,$administrators.Value)}
  $mask=if($osAncestor){0x500d0150}else{0x500d0156}
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cnotin $trusted){throw 'MOBILE_ENROLLMENT_PROTECTED_OWNER_REQUIRED'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
   if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $mask) -ne 0 -and
      (-not $osAncestor -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) -and
      $rule.IdentityReference.Value -cnotin $trusted){throw 'MOBILE_ENROLLMENT_PROTECTED_WRITER_REQUIRED'}
  }
  $parent=[IO.Path]::GetDirectoryName($current);if($parent -eq $current){break};$current=$parent
 }
}
function New-MobileDirectory([string]$path) {
 if([IO.Directory]::Exists($path)){Assert-MobileProtected $path;return}
 if([IO.File]::Exists($path)){throw 'MOBILE_ENROLLMENT_PATH_COLLISION'}
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($administrators)
 $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
 foreach($sid in @($system,$administrators)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))}
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($operator,'ReadAndExecute',$inherit,'None','Allow'))
 [void][IO.Directory]::CreateDirectory($path,$acl);Assert-MobileProtected $path
}
function Write-MobileNew([string]$name,[byte[]]$bytes) {
 if($name -cnotin @('release.pin','runtime-package.json','runtime-bootstrap.ps1','release-evidence.json','enrollment.json','state\approval-journal.wal')){throw 'MOBILE_ENROLLMENT_FILE_NOT_ADMITTED'}
 $path=[IO.Path]::Combine($root,$name)
 $file=[IO.FileStream]::new($path,'CreateNew','Write','None',4096,[IO.FileOptions]::WriteThrough)
 try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
 Assert-MobileProtected $path
}
$records=@{};[long]$total=0
foreach($row in $bootstrap.Records) {
 if($row.Path -cnotmatch '^(?:scripts/windows/[A-Za-z0-9._-]+|shared/agents/sovereignMobileInstallerNativeClosureV1.json)$' -or
    $records.ContainsKey($row.Path) -or $row.GitMode -cne '100644' -or $row.GitBlobSha -cnotmatch '^[a-f0-9]{40}$' -or
    $row.Sha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'MOBILE_ENROLLMENT_SOURCE_RECORD_REFUSED'}
 $bytes=[Convert]::FromBase64String($row.ContentBase64);$total+=$bytes.Length
 if($bytes.Length -gt 32768 -or $total -gt 1048576 -or (Get-MobileDigest $bytes) -cne $row.Sha256 -or
    (Get-MobileBlob $bytes) -cne $row.GitBlobSha){throw 'MOBILE_ENROLLMENT_SOURCE_BYTES_UNPROVEN'}
 $records[$row.Path]=[pscustomobject]@{Path=$row.Path;Bytes=$bytes;GitBlobSha=$row.GitBlobSha;GitMode=$row.GitMode}
}
[void][Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
$json=[Web.Script.Serialization.JavaScriptSerializer]::new();$json.MaxJsonLength=1048576;$json.RecursionLimit=12
$closure=$json.DeserializeObject([Text.UTF8Encoding]::new($false,$true).GetString($records['shared/agents/sovereignMobileInstallerNativeClosureV1.json'].Bytes))
if($closure.schemaVersion -cne 'stephanos.mobile-installer-native-closure.v1' -or $closure.maximumUnitBytes -ne 32768 -or $closure.paths.Count -ne 16){throw 'MOBILE_ENROLLMENT_NATIVE_CLOSURE_REFUSED'}
[string[]]$ordered=@($closure.paths);[Array]::Sort($ordered,[StringComparer]::Ordinal)
$pathWire='stephanos.mobile-installer-native-path-set.v1'+[char]0+($ordered -join [char]10)+[char]10
if((Get-MobileDigest ([Text.Encoding]::UTF8.GetBytes($pathWire))) -cne '49e2c2d5914cec1987704f2b04c332837078835348114a0a2c262aaab8f27452') {throw 'MOBILE_ENROLLMENT_NATIVE_MEMBERSHIP_REFUSED'}
foreach($path in $closure.paths){if(-not $records.ContainsKey($path)){throw 'MOBILE_ENROLLMENT_NATIVE_SOURCE_MISSING'}}
if(-not $records.ContainsKey('scripts/windows/install-battle-bridge-mobile-installer-v1.ps1')){throw 'MOBILE_ENROLLMENT_ENTRY_SOURCE_MISSING'}
if((Get-MobileDigest ([Text.Encoding]::UTF8.GetBytes($bootstrap.SetupDescriptor))) -cne $bootstrap.SetupDescriptorSha256){throw 'MOBILE_ENROLLMENT_DEVICE_DESCRIPTOR_CHANGED'}
$releaseBytes=@{};$releaseLimits=@{'release.pin'=4096;'runtime-package.json'=16777216;'runtime-bootstrap.ps1'=32768;'release-evidence.json'=1048576}
foreach($name in $releaseLimits.Keys) {
 $file=@($bootstrap.ReleaseFiles|Where-Object{$_.name -ceq $name})
 if($file.Count -ne 1 -or $file[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or
    $file[0].contentBase64.Length -gt (4*[Math]::Ceiling($releaseLimits[$name]/3))){throw 'MOBILE_ENROLLMENT_RELEASE_FILE_REFUSED'}
 $bytes=Read-MobileProofBase64 $file[0].contentBase64 $releaseLimits[$name]
 if($bytes.Length -eq 0 -or (Get-MobileDigest $bytes) -cne $file[0].sha256){throw 'MOBILE_ENROLLMENT_RELEASE_BYTES_CHANGED'}
 $releaseBytes[$name]=$bytes
}
Assert-MobileSourceMembership
# From this boundary all effects target only the reviewed fixed new root. A
# failed/partial setup is HELD for inspection: never delete, reset or overwrite.
Assert-MobileProtected 'C:\Program Files'
New-MobileDirectory 'C:\Program Files\Stephanos';New-MobileDirectory $root;New-MobileDirectory ([IO.Path]::Combine($root,'state'))
$parameters=[CodeDom.Compiler.CompilerParameters]::new()
$parameters.GenerateExecutable=$true;$parameters.GenerateInMemory=$false;$parameters.IncludeDebugInformation=$false;$parameters.TreatWarningsAsErrors=$true
$parameters.OutputAssembly=[IO.Path]::Combine($root,'installer.exe')
$parameters.TempFiles=[CodeDom.Compiler.TempFileCollection]::new($root,$false)
$parameters.CompilerOptions='/target:exe /main:Stephanos.Sovereign.SovereignMobileInstallEntryV1 /optimize+'
foreach($reference in @('System.dll','System.Core.dll','System.Management.dll','System.Web.Extensions.dll')){[void]$parameters.ReferencedAssemblies.Add($reference)}
$provider=[Microsoft.CSharp.CSharpCodeProvider]::new()
try {
 $source=($closure.paths|ForEach-Object{[Text.UTF8Encoding]::new($false,$true).GetString($records[$_].Bytes)}) -join [Environment]::NewLine
 $compiled=$provider.CompileAssemblyFromSource($parameters,@($source))
 if($compiled.Errors.HasErrors){throw 'MOBILE_ENROLLMENT_COMPILATION_FAILED'}
}finally{$provider.Dispose()}
Assert-MobileProtected $parameters.OutputAssembly
$assembly=[Reflection.Assembly]::LoadFrom($parameters.OutputAssembly)
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$core=$assembly.GetType('Stephanos.Sovereign.CoreJobCustodyV1',$true)
$memberType=$assembly.GetType('Stephanos.Sovereign.FixedRuntimeManifestFileV1',$true)
$members=[Array]::CreateInstance($memberType,$records.Count);$index=0
foreach($row in $records.Values){$member=[Activator]::CreateInstance($memberType);$member.Path=$row.Path;$member.GitBlobSha=$row.GitBlobSha;$member.GitMode=$row.GitMode;$members.SetValue($member,$index);$index++}
[void]$core.GetMethod('VerifyMobileEnrollmentSourceV1',$flags).Invoke($null,@($bootstrap.SourceProofWire,$ExpectedMain,$bootstrap.SourceTree,$members))
$assertion=$assembly.GetType('Stephanos.Sovereign.SovereignMobileInstallAssertionV1',$true)
$qualification=$assembly.GetType('Stephanos.Sovereign.MobileInstallQualifiedEnrollmentV1',$true)
[void]$qualification.GetMethod('ValidateSetupDescriptorForEnrollmentV1',$flags).Invoke($null,@($bootstrap.SetupDescriptor,
 $bootstrap.ProposedEnrollmentJson,$ExpectedMain,$bootstrap.SourceTree,(Get-MobileDigest $releaseBytes['runtime-package.json']),
 (Get-MobileDigest $releaseBytes['release-evidence.json']),[DateTime]::UtcNow))
$proof=$assertion.GetMethod('VerifyEnrollmentProofV1',$flags).Invoke($null,@($bootstrap.ProposedEnrollmentJson,$bootstrap.DeviceAssertionJson,$bootstrap.SetupDescriptor,[DateTime]::UtcNow))
$instance=[Reflection.BindingFlags]'NonPublic,Instance'
if(-not $proof.GetType().GetField('DevicePossessionVerified',$instance).GetValue($proof)){throw 'MOBILE_ENROLLMENT_DEVICE_PROOF_REFUSED'}
$proposed=$json.DeserializeObject($bootstrap.ProposedEnrollmentJson)
if($proposed['machineHash'] -cne $bootstrap.MachineHash -or $proposed['operatorSid'] -cne $bootstrap.OperatorSid -or $proposed['revoked'] -ne $false){throw 'MOBILE_ENROLLMENT_DEVICE_TARGET_CHANGED'}
$provision=$assembly.GetType('Stephanos.Sovereign.SovereignMobileInstallProvisioningV1',$true)
$receiptSpki=$provision.GetMethod('CreateReceiptKeyForEnrollmentV1',$flags).Invoke($null,@())
$proposed['receiptPublicKeySpki']=$receiptSpki
$proposed['lastSignCount']=[long]$proof.GetType().GetField('SignCount',$instance).GetValue($proof)
$enrollment=$json.Serialize($proposed)
Write-MobileNew 'enrollment.json' ([Text.UTF8Encoding]::new($false).GetBytes($enrollment))
foreach($name in @('release.pin','runtime-package.json','runtime-bootstrap.ps1','release-evidence.json')) {
 Write-MobileNew $name $releaseBytes[$name]
}
$binding=$assertion.GetMethod('ReadEnrollmentBindingV1',$flags).Invoke($null,@($enrollment))
$journal=$assembly.GetType('Stephanos.Sovereign.SovereignMobileInstallJournalV1',$true)
$header=$journal.GetMethod('CreateEnrollmentHeaderV1',$flags).Invoke($null,@($binding))
Write-MobileNew 'state\approval-journal.wal' ([Text.Encoding]::ASCII.GetBytes($header))
$anchor=$assembly.GetType('Stephanos.Sovereign.SovereignMobileInstallAnchorV1',$true)
[void]$anchor.GetMethod('AppendEnrollmentGenesisV1',$flags).Invoke($null,@($header))
$certificateSha=$provision.GetMethod('SealEnrollmentCertificateV1',$flags).Invoke($null,@())
$scheduler=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Schedule.Service',$true));$folder=$null;$task=$null
try {
 $scheduler.Connect();$folder=$scheduler.GetFolder('\')
 try{$existing=$folder.GetTask('Stephanos Mobile Runtime Installer V1');if($null -ne $existing){throw 'MOBILE_ENROLLMENT_TASK_ALREADY_EXISTS_INSPECT_ONLY'}}
 catch{if($_.Exception.Message -ceq 'MOBILE_ENROLLMENT_TASK_ALREADY_EXISTS_INSPECT_ONLY'){throw};if($_.Exception.HResult -ne -2147024894){throw}}
 $definition=$scheduler.NewTask(0)
 $definition.Principal.UserId=$bootstrap.OperatorSid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=1
 $definition.Settings.Enabled=$true;$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT0S'
 $definition.Settings.DisallowStartIfOnBatteries=$false;$definition.Settings.StopIfGoingOnBatteries=$false
 $action=$definition.Actions.Create(0);$action.Path=$parameters.OutputAssembly;$action.Arguments='';$action.WorkingDirectory=$root
 $sddl='O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;'+$bootstrap.OperatorSid+')'
 $task=$folder.RegisterTaskDefinition('Stephanos Mobile Runtime Installer V1',$definition,2,$bootstrap.OperatorSid,$null,3,$sddl)
 $task.SetSecurityDescriptor($sddl,0)
}finally{foreach($item in @($task,$folder,$scheduler)){if($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)}}}
[Console]::WriteLine('MOBILE_INSTALLER_ENROLLMENT_STAGED_V1={"certificateSha256":"'+$certificateSha+'","enrollmentStaged":true,"runtimeInstalled":false,"restartPerformed":false,"physicalAcceptanceProven":false}')
