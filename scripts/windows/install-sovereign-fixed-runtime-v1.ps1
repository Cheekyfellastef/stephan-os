# Invoked only from the existing operator-approved immutable-source installer.
# The source-defined candidate builder is not itself operator/GitHub authority.
param([switch]$OperatorApproved,[string]$ExpectedMain='')
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$bootstrap=$script:FixedRuntimeInstallerPinnedBootstrapV1
if(-not $OperatorApproved -or $ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or
 $null -eq $bootstrap -or $bootstrap.SourceHead -cne $ExpectedMain -or
 $bootstrap.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or
 $bootstrap.OperatorSid -cnotmatch '^S-1-5-21-[0-9-]+$' -or
 $bootstrap.Records.Count -lt 40 -or $bootstrap.Records.Count -gt 284){throw 'FIXED_INSTALL_IMMUTABLE_APPROVAL_REQUIRED'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{
 if(-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'FIXED_INSTALL_ADMINISTRATOR_REQUIRED'
 }
 if($identity.User.Value -cne $bootstrap.OperatorSid){throw 'FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED'}
}finally{$identity.Dispose()}
$sourceRoot='C:\Users\Stephan Callear\Documents\GitHub\stephan-os'
$protectedRoot='C:\Program Files\Stephanos\SovereignFixedRuntimeV1'
$administrators=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$operator=[Security.Principal.SecurityIdentifier]::new($bootstrap.OperatorSid)
# Verify only two exact Git refs (loose or packed) before compilation.
function Test-FixedRefPresent([string]$path){
 try {
  $attributes=[IO.File]::GetAttributes($path)
  if(($attributes -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) -ne 0){throw 'FIXED_INSTALL_REF_CHANGED'}
  return $true
 }catch{
  $errorType=$_.Exception
  if($errorType -is [Management.Automation.MethodInvocationException]){$errorType=$errorType.InnerException}
  if($errorType -is [IO.FileNotFoundException] -or $errorType -is [IO.DirectoryNotFoundException]){return $false}
  throw
 }
}
function Assert-FixedGitRef([string]$reference,[string]$expected){
 if($reference -cnotin @('refs/heads/main','refs/remotes/origin/main') -or $expected -cnotmatch '^[a-f0-9]{40}$'){throw 'FIXED_INSTALL_REF_CHANGED'}
 $loose=[IO.Path]::Combine($sourceRoot,'.git',$reference.Replace('/','\'))
 if(Test-FixedRefPresent $loose){
  Assert-Physical $loose
  $file=[IO.FileStream]::new($loose,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$handles.Add($file)
  if($file.Length -gt 128){throw 'FIXED_INSTALL_REF_CHANGED'}
  $reader=[IO.StreamReader]::new($file,[Text.UTF8Encoding]::new($false,$true),$false,1024,$true)
  try{$value=$reader.ReadToEnd()}finally{$reader.Dispose()}
  if($value -cne $expected -and $value -cne ($expected+[char]10) -and $value -cne ($expected+[char]13+[char]10)){throw 'FIXED_INSTALL_REF_CHANGED'}
  return
 }
 $packed=[IO.Path]::Combine($sourceRoot,'.git','packed-refs');Assert-Physical $packed
 $file=[IO.FileStream]::new($packed,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$handles.Add($file)
 if($file.Length -le 0 -or $file.Length -gt 1048576){throw 'FIXED_INSTALL_REF_CHANGED'}
 $reader=[IO.StreamReader]::new($file,[Text.UTF8Encoding]::new($false,$true),$false,1024,$true)
 try{$rows=($reader.ReadToEnd()).Split([char]10)}finally{$reader.Dispose()}
 $found=$false;$tag=$false
 for($i=0;$i -lt $rows.Length;$i++){
  $line=$rows[$i]
  if($line.EndsWith([char]13)){$line=$line.Substring(0,$line.Length-1)}
  if($i -eq $rows.Length-1 -and $line.Length -eq 0){continue}
  if($line.Length -eq 0 -or $line.Length -gt 260){throw 'FIXED_INSTALL_REF_CHANGED'}
  if($line[0] -eq '#'){$tag=$false;continue}
  if($line[0] -eq '^'){
   if(-not $tag -or $line.Substring(1) -cnotmatch '^[a-f0-9]{40}$'){throw 'FIXED_INSTALL_REF_CHANGED'}
   $tag=$false;continue
  }
  if($line -cmatch '^([a-f0-9]{40}) (refs/[A-Za-z0-9._/-]{1,210})$'){
   $ref=$Matches[2];$refHash=$Matches[1]
  }else{throw 'FIXED_INSTALL_REF_CHANGED'}
  if($ref.Contains('..') -or $ref.Contains('//') -or $ref.EndsWith('/') -or $ref.EndsWith('.lock')){throw 'FIXED_INSTALL_REF_CHANGED'}
  $tag=$ref.StartsWith('refs/tags/',[StringComparison]::Ordinal)
  if($ref -ceq $reference){
   if($found -or $refHash -cne $expected){throw 'FIXED_INSTALL_REF_CHANGED'}
   $found=$true
  }
 }
 if(-not $found -or (Test-FixedRefPresent $loose)){throw 'FIXED_INSTALL_REF_CHANGED'}
}
function Get-Digest([byte[]]$bytes){
 $sha=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Get-GitBlob([byte[]]$bytes){
 $prefix=[Text.Encoding]::ASCII.GetBytes('blob '+$bytes.Length+[char]0)
 $sha=[Security.Cryptography.SHA1]::Create()
 try{return ([BitConverter]::ToString($sha.ComputeHash([byte[]]($prefix+$bytes)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Assert-Physical([string]$path){
 $full=[IO.Path]::GetFullPath($path)
 while($null -ne $full){
  if(([IO.File]::GetAttributes($full) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'FIXED_INSTALL_REDIRECTION_REFUSED'}
  $parent=[IO.Path]::GetDirectoryName($full)
  if($parent -eq $full){break};$full=$parent
 }
}
function Assert-Protected([string]$path){
 Assert-Physical $path
 $acl=if([IO.Directory]::Exists($path)){[IO.Directory]::GetAccessControl($path)}else{[IO.File]::GetAccessControl($path)}
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cnotin @($system.Value,$administrators.Value)){throw 'FIXED_INSTALL_OWNER_UNPROVEN'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
   ($rule.FileSystemRights -band 0x500D0156) -ne 0 -and
   $rule.IdentityReference.Value -cnotin @($system.Value,$administrators.Value)){throw 'FIXED_INSTALL_WRITE_AUTHORITY_UNPROVEN'}
 }
}
function New-ProtectedDirectory([string]$path){
 if([IO.Directory]::Exists($path)){Assert-Protected $path;return}
 if([IO.File]::Exists($path)){throw 'FIXED_INSTALL_PATH_COLLISION'}
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($administrators)
 $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
 foreach($sid in @($system,$administrators)){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))
 }
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($operator,'ReadAndExecute',$inherit,'None','Allow'))
 [void][IO.Directory]::CreateDirectory($path,$acl)
 Assert-Protected $path
}
$records=@{};$total=0
foreach($row in $bootstrap.Records){
 if($row.Path -cnotmatch '^(?:(?:scripts|shared|stephanos-server)/[A-Za-z0-9._/-]+|package\.json|\.gitattributes|integrations/openclaw/stephanos-builder-provider/lib/oc1-(?:gateway-provider|repository-scout)\.mjs)$' -or
  $row.Path.Contains('..') -or $row.Path.Contains('//') -or $records.ContainsKey($row.Path) -or
  $row.Sha256 -cnotmatch '^[a-f0-9]{64}$' -or $row.MaterializedSha256 -cnotmatch '^[a-f0-9]{64}$' -or
  $row.GitBlobSha -cnotmatch '^[a-f0-9]{40}$' -or $row.GitMode -cne '100644'){throw 'FIXED_INSTALL_SOURCE_MEMBER_REFUSED'}
 $bytes=[Convert]::FromBase64String($row.ContentBase64);$total+=$bytes.Length
 if($bytes.Length -gt 2097152 -or $total -gt 8388608 -or (Get-Digest $bytes) -cne $row.Sha256 -or
  (Get-GitBlob $bytes) -cne $row.GitBlobSha){throw 'FIXED_INSTALL_SOURCE_BYTES_UNPROVEN'}
 $records[$row.Path]=[pscustomobject]@{Path=$row.Path;GitBlobSha=$row.GitBlobSha;GitMode=$row.GitMode;Sha256=$row.Sha256;MaterializedSha256=$row.MaterializedSha256;Bytes=$bytes}
}
$native=@('SovereignCoreJobCustodyV1.cs','SovereignFixedRuntimeJobV1.cs','SovereignFixedRuntimeIdentityV1.cs','SovereignFixedRuntimeAuthorityV1.cs','SovereignFixedRuntimeHostV1.cs','SovereignFixedRuntimeSourceV1.cs')
foreach($name in $native){if(-not $records.ContainsKey('scripts/windows/'+$name) -or $records['scripts/windows/'+$name].Bytes.Length -gt 32768){throw 'FIXED_INSTALL_NATIVE_UNIT_UNPROVEN'}}
if(-not $records.ContainsKey('scripts/windows/install-sovereign-fixed-runtime-v1.ps1')){throw 'FIXED_INSTALL_SELF_SOURCE_UNPROVEN'}
$handles=[Collections.Generic.List[IO.FileStream]]::new()
$nativePins=$null;$provider=$null
try{
 $manifest=[ordered]@{SchemaVersion='stephanos.fixed-runtime-manifest.v1';SourceHead=$ExpectedMain;SourceTree=$bootstrap.SourceTree;Files=@()}
 [string[]]$orderedPaths=@($records.Keys);[Array]::Sort($orderedPaths,[StringComparer]::Ordinal)
 $closureText='stephanos.fixed-runtime-git-closure.v1'+[char]0
 foreach($key in $orderedPaths){
  $row=$records[$key];$manifest.Files+=@{Path=$row.Path;GitBlobSha=$row.GitBlobSha;GitMode=$row.GitMode;Sha256=$row.Sha256;MaterializedSha256=$row.MaterializedSha256}
  $closureText+=$row.Path+[char]0+$row.GitMode+[char]0+$row.GitBlobSha+[char]10
  $path=[IO.Path]::Combine($sourceRoot,$key.Replace('/','\'));Assert-Physical $path
  $file=[IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$handles.Add($file)
  $memory=[IO.MemoryStream]::new();try{$file.CopyTo($memory);$actual=$memory.ToArray()}finally{$memory.Dispose()}
  if((Get-Digest $actual) -cne $row.MaterializedSha256){throw 'FIXED_INSTALL_CANONICAL_BYTES_CHANGED'}
 }
 # Refuse source drift before any protected compiler descendant.
 $path=[IO.Path]::Combine($sourceRoot,'.git','HEAD');Assert-Physical $path
 $file=[IO.FileStream]::new($path,'Open','Read','Read');$handles.Add($file)
 $reader=[IO.StreamReader]::new($file,[Text.UTF8Encoding]::new($false,$true),$false,1024,$true)
 try{if($reader.ReadToEnd().Trim() -cne 'ref: refs/heads/main'){throw 'FIXED_INSTALL_REF_CHANGED'}}finally{$reader.Dispose()}
 Assert-FixedGitRef 'refs/heads/main' $ExpectedMain
 Assert-FixedGitRef 'refs/remotes/origin/main' $ExpectedMain
 # Every compiler input/scratch/output is beneath an OS-admin protected namespace.
 # Never normalize a pre-existing unsafe directory, config, or helper version.
 New-ProtectedDirectory 'C:\Program Files\Stephanos'
 New-ProtectedDirectory $protectedRoot
 $version=[IO.Path]::Combine($protectedRoot,$ExpectedMain)
 if([IO.Directory]::Exists($version) -or [IO.File]::Exists($version)){throw 'FIXED_INSTALL_VERSION_ALREADY_EXISTS_INSPECT_ONLY'}
 New-ProtectedDirectory $version
 $staging=[IO.Path]::Combine($protectedRoot,'pending-compile-'+$ExpectedMain+'-'+[Guid]::NewGuid().ToString('N'))
 New-ProtectedDirectory $staging
 $manifestBytes=[Text.UTF8Encoding]::new($false).GetBytes(($manifest|ConvertTo-Json -Depth 8 -Compress))
 $manifestPath=[IO.Path]::Combine($staging,'Stephanos.FixedRuntime.ManifestV1')
 [IO.File]::WriteAllBytes($manifestPath,$manifestBytes)
 $parameters=[CodeDom.Compiler.CompilerParameters]::new()
 $parameters.GenerateExecutable=$true;$parameters.GenerateInMemory=$false;$parameters.IncludeDebugInformation=$false
 $parameters.TreatWarningsAsErrors=$true
 $parameters.OutputAssembly=[IO.Path]::Combine($staging,'host.exe')
 $parameters.TempFiles=[CodeDom.Compiler.TempFileCollection]::new($staging,$false)
 $parameters.CompilerOptions='/target:exe /main:Stephanos.Sovereign.FixedRuntimeHostV1 /optimize+'
 foreach($reference in @('System.dll','System.Core.dll','System.Management.dll','System.Web.Extensions.dll')){[void]$parameters.ReferencedAssemblies.Add($reference)}
 [void]$parameters.EmbeddedResources.Add($manifestPath)
 $nativeSource=($native|ForEach-Object{[Text.UTF8Encoding]::new($false,$true).GetString($records['scripts/windows/'+$_].Bytes)}) -join [Environment]::NewLine
 $provider=[Microsoft.CSharp.CSharpCodeProvider]::new()
 $compiled=$provider.CompileAssemblyFromSource($parameters,@($nativeSource))
 if($compiled.Errors.HasErrors){throw 'FIXED_INSTALL_COMPILATION_FAILED'}
 $compileCompleted=[DateTime]::UtcNow.ToString('o')
 Assert-Protected $parameters.OutputAssembly
 # Administrative installation only; runtime may never compile or self-activate.
 $finalHelper=[IO.Path]::Combine($version,'host.exe')
 [IO.File]::Move($parameters.OutputAssembly,$finalHelper)
 $assembly=[Reflection.Assembly]::LoadFrom($finalHelper)
 $type=$assembly.GetType('Stephanos.Sovereign.CoreJobCustodyV1',$true)
 $flags=[Reflection.BindingFlags]'NonPublic,Static'
 $nativePins=[Activator]::CreateInstance($assembly.GetType('Stephanos.Sovereign.FixedRuntimeIdentityPinsV1',$true),$true)
 foreach($row in $records.Values){
  $path=[IO.Path]::Combine($sourceRoot,$row.Path.Replace('/','\'))
  [void]$type.GetMethod('RuntimePinParentsV1',$flags).Invoke($null,@($path,$nativePins))
  $bytes=$type.GetMethod('RuntimeReadPinnedV1',$flags).Invoke($null,@($path,2097152,$nativePins))
  if((Get-Digest $bytes) -cne $row.MaterializedSha256){throw 'FIXED_INSTALL_FINAL_SOURCE_CHANGED'}
 }
 foreach($path in @('C:\','C:\Program Files')){[void]$type.GetMethod('RuntimeFixedAncestorAclV1',$flags).Invoke($null,@($path))}
 # Link counts are captured through the same native fixed-tool primitive in
 # installer code, not guessed from historical fixtures or normalized to one.
 $observations=$type.GetMethod('RuntimeObserveFixedToolsV1',$flags).Invoke($null,@($nativePins))
 $installed=[DateTime]::UtcNow.ToString('o')
 if([DateTime]::Parse($installed) -le [DateTime]::Parse($compileCompleted)){throw 'FIXED_INSTALL_TIME_ORDER_UNPROVEN'}
 $pending=[ordered]@{SchemaVersion='stephanos.fixed-runtime-pending.v1';SourceHead=$ExpectedMain;SourceTree=$bootstrap.SourceTree;
  HelperSha256=(Get-Digest ([IO.File]::ReadAllBytes([IO.Path]::Combine($version,'host.exe'))));ManifestSha256=(Get-Digest $manifestBytes);
  GitClosureSha256=(Get-Digest ([Text.UTF8Encoding]::new($false).GetBytes($closureText)));
  MachineHash=$type.GetMethod('RuntimeMachineHashV1',$flags).Invoke($null,@());CompilerCompletedAtUtc=$compileCompleted;InstalledAtUtc=$installed;OperatorSid=$bootstrap.OperatorSid;
  NodeExecutableSha256=$observations[0].Sha256;GitExecutableSha256=$observations[1].Sha256;PowerShellExecutableSha256=$observations[2].Sha256;
  NodeExecutableLinkCount=$observations[0].LinkCount;GitExecutableLinkCount=$observations[1].LinkCount;PowerShellExecutableLinkCount=$observations[2].LinkCount}
 $pendingPath=[IO.Path]::Combine($version,'pending.json')
 $file=[IO.FileStream]::new($pendingPath,'CreateNew','Write','None')
 try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($pending|ConvertTo-Json -Compress));$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
 Assert-Protected $pendingPath
 [Console]::WriteLine('SOVEREIGN_FIXED_RUNTIME_INSTALL_PENDING_V1='+($pending|ConvertTo-Json -Compress))
 # PENDING only: true later full boot + authenticated custody IDLE + exact pins
 # are independently mandatory. This installer never clears any incident.
}finally{
 if($null -ne $nativePins){([IDisposable]$nativePins).Dispose()}
 if($null -ne $provider){$provider.Dispose()}
 for($i=$handles.Count-1;$i -ge 0;$i--){$handles[$i].Dispose()}
 # Keep bounded protected compiler diagnostics/artifacts on failure. Do not
 # recursively delete an unverified path or overwrite a partial installation.
}
