# SOURCE-ONLY installer body carried in a reviewed immutable exact-main package.
# Invocation is an attended privileged action, never an automatic sync hook.
# This installs code custody only. It creates no account, service, key or signer.
param([Parameter(Mandatory=$true)][string]$ExpectedMain,
 [Parameter(Mandatory=$true)][string]$ReviewerSid,[string]$ExpectedInstalledHead='')
$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None'
$source=$script:SovereignReviewerInstallerSourceV1
if($ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or $null -eq $source -or
 $source.SchemaVersion -cne 'stephanos.reviewer-install-source.v1' -or $source.SourceHead -cne $ExpectedMain -or
 $source.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or $source.Records.Count -ne 25 -or
 $ReviewerSid -cnotmatch '^S-1-5-21-[0-9-]{8,100}$' -or
 ($ExpectedInstalledHead -ne '' -and $ExpectedInstalledHead -cnotmatch '^[a-f0-9]{40}$')){throw 'REVIEWER_INSTALL_IMMUTABLE_SOURCE_REQUIRED'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{
 if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'REVIEWER_INSTALL_ADMINISTRATOR_REQUIRED'
 }
 $installerSid=$identity.User.Value
}finally{$identity.Dispose()}
$reviewer=[Security.Principal.SecurityIdentifier]::new($ReviewerSid)
# A real pre-existing principal is required; never create/rename/enroll one.
[void]$reviewer.Translate([Security.Principal.NTAccount])
$root='C:\Program Files\Stephanos\SovereignReviewerV1'
$version=[IO.Path]::Combine($root,$ExpectedMain)
$hostPath=[IO.Path]::Combine($root,'host.exe')
$admins=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$users=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
function Digest([byte[]]$bytes,[string]$algorithm='SHA256'){
 $hasher=[Security.Cryptography.HashAlgorithm]::Create($algorithm)
 try{return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
}
function Physical([string]$path){
 $full=[IO.Path]::GetFullPath($path)
 while($null -ne $full){
  if(([IO.File]::GetAttributes($full) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REVIEWER_INSTALL_REDIRECTION_REFUSED'}
  $parent=[IO.Path]::GetDirectoryName($full);if($parent -eq $full){break};$full=$parent
 }
}
function Protected([string]$path){
 Physical $path
 $acl=if([IO.Directory]::Exists($path)){[IO.Directory]::GetAccessControl($path)}else{[IO.File]::GetAccessControl($path)}
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cnotin @($admins.Value,$system.Value)){throw 'REVIEWER_INSTALL_OWNER_UNPROVEN'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band 0x500D0156) -ne 0 -and
   $rule.IdentityReference.Value -cnotin @($admins.Value,$system.Value)){throw 'REVIEWER_INSTALL_WRITE_AUTHORITY_UNPROVEN'}
 }
}
function Protected-Ancestor([string]$path){
 Physical $path
 $trusted=@($admins.Value,$system.Value,'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
 $acl=[IO.Directory]::GetAccessControl($path)
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cnotin $trusted){throw 'REVIEWER_INSTALL_ANCESTOR_OWNER_UNPROVEN'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow' -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
   ($rule.FileSystemRights -band 0x500D0140) -ne 0 -and $rule.IdentityReference.Value -cnotin $trusted){
   throw 'REVIEWER_INSTALL_ANCESTOR_WRITE_AUTHORITY_UNPROVEN'
  }
 }
}
function New-ProtectedDirectory([string]$path){
 if([IO.Directory]::Exists($path)){Protected $path;return}
 if([IO.File]::Exists($path)){throw 'REVIEWER_INSTALL_PATH_COLLISION'}
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($admins)
 $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
 foreach($sid in @($admins,$system)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))}
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,'ReadAndExecute',$inherit,'None','Allow'))
 [void][IO.Directory]::CreateDirectory($path,$acl);Protected $path
}
function Write-New([string]$path,[byte[]]$bytes){
 # Supply owner/DACL atomically at creation. Do not depend on the elevated
 # token's default owner or briefly expose a caller-owned writable new file.
 $acl=[Security.AccessControl.FileSecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($admins)
 foreach($sid in @($admins,$system)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))}
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,'ReadAndExecute','Allow'))
 $file=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,
  4096,[IO.FileOptions]::None,$acl)
 try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
 Protected $path
}
$records=@{};$total=0
foreach($row in $source.Records){
 if($row.Path -cnotmatch '^(scripts|shared)/[A-Za-z0-9._/-]+$' -or $row.Path.Contains('..') -or $row.Path.Contains('//') -or
  $records.ContainsKey($row.Path) -or $row.GitBlobSha1 -cnotmatch '^[a-f0-9]{40}$' -or $row.Sha256 -cnotmatch '^[a-f0-9]{64}$'){
  throw 'REVIEWER_INSTALL_SOURCE_MEMBER_INVALID'
 }
 $bytes=[Convert]::FromBase64String($row.ContentBase64);$total+=$bytes.Length
 $header=[Text.Encoding]::ASCII.GetBytes(('blob '+$bytes.Length+[char]0))
 $gitBytes=[byte[]]::new($header.Length+$bytes.Length);[Array]::Copy($header,$gitBytes,$header.Length);[Array]::Copy($bytes,0,$gitBytes,$header.Length,$bytes.Length)
 if($bytes.Length -gt 2097152 -or $total -gt 4194304 -or (Digest $bytes) -cne $row.Sha256 -or (Digest $gitBytes 'SHA1') -cne $row.GitBlobSha1){
  throw 'REVIEWER_INSTALL_SOURCE_BYTES_UNPROVEN'
 }
 $records[$row.Path]=[pscustomobject]@{Path=$row.Path;GitBlobSha1=$row.GitBlobSha1;Sha256=$row.Sha256;Bytes=$bytes}
}
$native=@('SovereignCoreJobCustodyV1.cs','SovereignReviewerProfileV1.cs','SovereignReviewerHostV1.cs')
foreach($name in $native){if(-not $records.ContainsKey('scripts/windows/'+$name) -or $records['scripts/windows/'+$name].Bytes.Length -gt 32768){throw 'REVIEWER_INSTALL_NATIVE_UNIT_UNPROVEN'}}
foreach($path in @('scripts/sovereign-installed-reviewer-v1.mjs','scripts/sovereign-installed-reviewer-loader-v1.mjs',
 'shared/agents/sovereignInstalledReviewerProfileV1.mjs','scripts/windows/install-sovereign-reviewer-profile-v1.ps1')){
 if(-not $records.ContainsKey($path)){throw 'REVIEWER_INSTALL_REQUIRED_SOURCE_MISSING'}
}
# Refuse unsafe/pre-existing namespaces. Never repair their ACLs as a side effect.
foreach($ancestor in @('C:\','C:\Program Files')){Protected-Ancestor $ancestor}
New-ProtectedDirectory 'C:\Program Files\Stephanos';New-ProtectedDirectory $root
if([IO.Directory]::Exists($version) -or [IO.File]::Exists($version)){throw 'REVIEWER_INSTALL_VERSION_EXISTS_INSPECT_ONLY'}
$oldPin=$null;$provider=$null;$nativePins=$null
try{
 if([IO.File]::Exists($hostPath)){
  if($ExpectedInstalledHead -eq ''){throw 'REVIEWER_INSTALL_EXPECTED_PREDECESSOR_REQUIRED'}
  Protected $hostPath
  # Reflection-only load cannot run the predecessor's implementation. Existing
  # active host pins deny the later atomic replacement; no forced termination.
  $oldBytes=[IO.File]::ReadAllBytes($hostPath)
  $old=[Reflection.Assembly]::ReflectionOnlyLoad($oldBytes)
  $resource=$old.GetManifestResourceStream('Stephanos.ReviewerProfile.ManifestV1')
  if($null -eq $resource -or $resource.Length -gt 131072){throw 'REVIEWER_INSTALL_PREDECESSOR_UNPROVEN'}
  $reader=[IO.StreamReader]::new($resource)
  try{$prior=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  if($prior.SourceHead -cne $ExpectedInstalledHead){throw 'REVIEWER_INSTALL_PREDECESSOR_CHANGED'}
 }elseif($ExpectedInstalledHead -ne ''){throw 'REVIEWER_INSTALL_PREDECESSOR_MISSING'}
 New-ProtectedDirectory $version;New-ProtectedDirectory ([IO.Path]::Combine($version,'source'))
 $manifest=[ordered]@{SchemaVersion='stephanos.reviewer-profile-manifest.v1';SourceHead=$ExpectedMain;SourceTree=$source.SourceTree;Files=@()}
 foreach($key in @($records.Keys|Sort-Object)){
  $row=$records[$key];$manifest.Files+=@{Path=$row.Path;GitBlobSha1=$row.GitBlobSha1;Sha256=$row.Sha256}
  $cursor=[IO.Path]::Combine($version,'source')
  $parts=$key.Split('/')
  for($i=0;$i -lt $parts.Count-1;$i++){$cursor=[IO.Path]::Combine($cursor,$parts[$i]);New-ProtectedDirectory $cursor}
  Write-New ([IO.Path]::Combine($cursor,$parts[-1])) $row.Bytes
 }
 $manifestBytes=[Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 8 -Compress))
 Write-New ([IO.Path]::Combine($version,'manifest.json')) $manifestBytes
 $staging=[IO.Path]::Combine($root,'pending-compile-'+$ExpectedMain+'-'+[Guid]::NewGuid().ToString('N'))
 New-ProtectedDirectory $staging
 $resourcePath=[IO.Path]::Combine($staging,'Stephanos.ReviewerProfile.ManifestV1');Write-New $resourcePath $manifestBytes
 $parameters=[CodeDom.Compiler.CompilerParameters]::new()
 $parameters.GenerateExecutable=$true;$parameters.GenerateInMemory=$false;$parameters.IncludeDebugInformation=$false;$parameters.TreatWarningsAsErrors=$true
 $parameters.OutputAssembly=[IO.Path]::Combine($staging,'host.exe');$parameters.TempFiles=[CodeDom.Compiler.TempFileCollection]::new($staging,$false)
 $parameters.CompilerOptions='/target:exe /main:Stephanos.Sovereign.SovereignReviewerHostV1 /optimize+'
 foreach($reference in @('System.dll','System.Core.dll','System.Web.Extensions.dll')){[void]$parameters.ReferencedAssemblies.Add($reference)}
 [void]$parameters.EmbeddedResources.Add($resourcePath)
 $nativeSource=($native|ForEach-Object{[Text.UTF8Encoding]::new($false,$true).GetString($records['scripts/windows/'+$_].Bytes)}) -join [Environment]::NewLine
 $provider=[Microsoft.CSharp.CSharpCodeProvider]::new();$compiled=$provider.CompileAssemblyFromSource($parameters,@($nativeSource))
 if($compiled.Errors.HasErrors){throw 'REVIEWER_INSTALL_COMPILATION_FAILED'}
 Protected $parameters.OutputAssembly
 $assembly=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes($parameters.OutputAssembly))
 $type=$assembly.GetType('Stephanos.Sovereign.CoreJobCustodyV1',$true);$flags=[Reflection.BindingFlags]'NonPublic,Static'
 $nativePins=[Activator]::CreateInstance($assembly.GetType('Stephanos.Sovereign.ReviewerProfilePinsV1',$true),$true)
 foreach($path in @('C:\','C:\Program Files')){[void]$type.GetMethod('ReviewerAncestorAclV1',$flags).Invoke($null,@($path))}
 # Pin all installed source paths and compare the exact raw Git bytes before
 # publishing the helper. The runtime repeats this readback for every entry.
 foreach($row in $records.Values){
  $path=[IO.Path]::Combine($version,'source',$row.Path.Replace('/','\'))
  [void]$type.GetMethod('ReviewerPinParentsV1',$flags).Invoke($null,@($path,$nativePins))
  $bytes=$type.GetMethod('ReviewerReadPinnedV1',$flags).Invoke($null,@($path,2097152,$nativePins,1))
  if((Digest $bytes) -cne $row.Sha256){throw 'REVIEWER_INSTALL_FINAL_SOURCE_CHANGED'}
 }
 $tools=@()
 foreach($path in @('C:\Program Files\nodejs\node.exe','C:\Program Files\Git\cmd\git.exe')){
  $links=[int]$type.GetMethod('ReviewerObserveToolLinksV1',$flags).Invoke($null,@($path))
  $digest=Digest ([IO.File]::ReadAllBytes($path))
  [void]$type.GetMethod('ReviewerPinToolV1',$flags).Invoke($null,@($path,$digest,$links,$nativePins))
  $tools+=@{Sha256=$digest;Links=$links}
 }
 $installation=[ordered]@{SchemaVersion='stephanos.reviewer-installation.v1';SourceHead=$ExpectedMain;
  ManifestSha256=(Digest $manifestBytes);HelperSha256=(Digest ([IO.File]::ReadAllBytes($parameters.OutputAssembly)));
  MachineHash=$type.GetMethod('ReviewerMachineHashV1',$flags).Invoke($null,@());ReviewerSid=$ReviewerSid;InstallerSid=$installerSid;InstalledAtUtc=[DateTime]::UtcNow.ToString('o');
  NodeSha256=$tools[0].Sha256;NodeLinkCount=$tools[0].Links;GitSha256=$tools[1].Sha256;GitLinkCount=$tools[1].Links}
 Write-New ([IO.Path]::Combine($version,'installation.json')) ([Text.UTF8Encoding]::new($false).GetBytes(($installation|ConvertTo-Json -Compress)))
 # Only this attended administrator may promote the fixed helper. Complete
 # version contents already exist. Active readers prevent atomic replacement.
 if([IO.File]::Exists($hostPath)){
  if((Digest ([IO.File]::ReadAllBytes($hostPath))) -cne (Digest $oldBytes)){throw 'REVIEWER_INSTALL_PREDECESSOR_CHANGED'}
  $backup=[IO.Path]::Combine($root,'retired-'+$ExpectedInstalledHead+'-'+[Guid]::NewGuid().ToString('N')+'.exe')
  [IO.File]::Replace($parameters.OutputAssembly,$hostPath,$backup,$false)
 }else{[IO.File]::Move($parameters.OutputAssembly,$hostPath)}
 Protected $hostPath
 [Console]::WriteLine('SOVEREIGN_REVIEWER_INSTALL_SOURCE_CUSTODY_ONLY_V1='+(@{sourceHead=$ExpectedMain;sourceTree=$source.SourceTree;
   installed=$true;independentPrincipalObserved=$false;qualified=$false;signingAuthority=$false;reviewerEnrollmentAuthority=$false;physicalCommissioningProven=$false}|ConvertTo-Json -Compress))
}finally{
 if($null -ne $nativePins){([IDisposable]$nativePins).Dispose()}
 if($null -ne $provider){$provider.Dispose()}
 if($null -ne $oldPin){$oldPin.Dispose()}
 # Preserve any incomplete protected version for inspection. Never recursively
 # delete an unverified path, clear a custody incident or restart a controller.
}
