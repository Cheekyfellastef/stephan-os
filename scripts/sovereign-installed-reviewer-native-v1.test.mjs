import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReviewerInstallationSourceV1 } from './build-sovereign-reviewer-installation-v1.mjs';
import { SOVEREIGN_REVIEWER_PROFILE_FILES_V1 } from '../shared/agents/sovereignInstalledReviewerProfileV1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const literal=s=>"'"+s.replaceAll("'","''")+"'";
test('Windows compiles exact reviewer native sources and exercises physical pins, governor, token policy and job drain',
  {skip:process.platform!=='win32',timeout:120000},t=>{
  const fixture=mkdtempSync(join(tmpdir(),'reviewer-native-source-fixture-'));
  t.after(()=>rmSync(fixture,{recursive:true,force:true}));
  const native=['SovereignCoreJobCustodyV1.cs','SovereignReviewerProfileV1.cs','SovereignReviewerHostV1.cs']
    .map(n=>literal(join(root,'scripts/windows',n)));
  const script=String.raw`
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$code=(@(__NATIVE__)|ForEach-Object{[IO.File]::ReadAllText($_)}) -join [Environment]::NewLine
Add-Type -TypeDefinition $code -ReferencedAssemblies 'System.Core','System.Web.Extensions' -ErrorAction Stop
$type=[Stephanos.Sovereign.CoreJobCustodyV1];$flags=[Reflection.BindingFlags]'NonPublic,Static'
$instance=[Reflection.BindingFlags]'NonPublic,Instance';$checks=0;$aclChecks=0
function Require([bool]$ok,[string]$reason){if(-not $ok){throw $reason};$script:checks++}
$read=$type.GetMethod('ReviewerReadPinnedV1',$flags)
$pinsType=$type.Assembly.GetType('Stephanos.Sovereign.ReviewerProfilePinsV1',$true)
function Pins{return [Activator]::CreateInstance($pinsType,$true)}
function Field($value,[string]$name){return $value.GetType().GetField($name,$instance).GetValue($value)}
try{$type.GetMethod('OpenReviewerProfileV1',$flags).Invoke($null,@($true))|Out-Null;throw 'UNINSTALLED_ACCEPTED'}
catch{Require ($_.Exception.InnerException.Message -eq 'REVIEWER_EMBEDDED_MANIFEST_UNPROVEN') 'UNINSTALLED_NOT_DENIED'}
$area=__FIXTURE__
$file=[IO.Path]::Combine($area,'pinned.txt');[IO.File]::WriteAllText($file,'owned fixture bytes')
$pins=Pins
try{
 [void]$type.GetMethod('ReviewerPinParentsV1',$flags).Invoke($null,@($file,$pins))
 $bytes=$read.Invoke($null,@($file,4096,$pins,1))
 Require ([Text.Encoding]::UTF8.GetString($bytes) -eq 'owned fixture bytes') 'PIN_READ_FAILED'
 $denied=$false;try{$writer=[IO.File]::Open($file,'Open','Write','ReadWrite');$writer.Dispose()}catch{$denied=$true}
 Require $denied 'WRITER_ACCEPTED_DURING_PIN'
 $denied=$false;try{[IO.File]::Move($file,$file+'.moved')}catch{$denied=$true}
 Require $denied 'RENAME_ACCEPTED_DURING_PIN'
}finally{([IDisposable]$pins).Dispose()}
$alias=[IO.Path]::Combine($area,'alias.txt');New-Item -ItemType HardLink -Path $alias -Target $file|Out-Null
$pins=Pins
try{
 $denied=$false;try{$read.Invoke($null,@($file,4096,$pins,1))|Out-Null}catch{$denied=$_.Exception.InnerException.Message -eq 'REVIEWER_FILE_IDENTITY_UNPROVEN'}
 Require $denied 'HARDLINK_ACCEPTED_AS_SOURCE'
}finally{([IDisposable]$pins).Dispose();[IO.File]::Delete($alias)}
$pinTool=$type.GetMethod('ReviewerPinToolV1',$flags);$pins=Pins
try{
 $denied=$false;try{$pinTool.Invoke($null,@($file,('a'*64),1,$pins))|Out-Null}catch{$denied=$_.Exception.InnerException.Message -eq 'REVIEWER_FIXED_TOOL_REQUIRED'}
 Require $denied 'CALLER_TOOL_PATH_ACCEPTED'
}finally{([IDisposable]$pins).Dispose()}
$now=[DateTime]::UtcNow
$state=[ordered]@{schemaVersion='stephanos.vr-resource-governor.v1';governorVersion=3;updatedAtUtc=$now.ToString('o');
 active=$false;flatGameActive=$false;airLinkActive=$false;realAirLinkActive=$false;virtualAirLinkTestActive=$false;prepareLeaseActive=$false;
 localModelAllowed=$true;heavyModelAllowed=$true;ollamaLoadMode='balanced'}
$governor=$type.GetMethod('ReviewerGovernorStateV1',$flags)
$raw=[string]($state|ConvertTo-Json -Compress)
Require ([bool]$governor.Invoke($null,@([string]$raw,[DateTime]$now))) 'FRESH_IDLE_NATIVE_GOVERNOR_REFUSED'
foreach($name in @('active','flatGameActive','airLinkActive','realAirLinkActive','virtualAirLinkTestActive','prepareLeaseActive','localModelAllowed','heavyModelAllowed')){
 $before=$state[$name];$state[$name]=-not $before
 Require (-not [bool]$governor.Invoke($null,@([string]($state|ConvertTo-Json -Compress),[DateTime]$now))) ('UNSAFE_GOVERNOR_'+$name)
 $state[$name]=$before
}
foreach($bad in @($raw.Replace('"active":false','"active":"false"'),$raw.Replace('"active":false','"active":false,"active":false'),
 $raw.Replace('"active":false','"active":false,"\u0061ctive":false'),$raw.Replace('"governorVersion":3','"governorVersion":2'),
 $raw.Replace('"active":false,',''),$raw.Replace('"ollamaLoadMode":"balanced"','"ollamaLoadMode":"cool"'))){
 Require (-not [bool]$governor.Invoke($null,@([string]$bad,[DateTime]$now))) 'MALFORMED_GOVERNOR_ACCEPTED'
}
Require (-not [bool]$governor.Invoke($null,@([string]$raw,[DateTime]$now.AddSeconds(31)))) 'STALE_GOVERNOR_ACCEPTED'
Require (-not [bool]$governor.Invoke($null,@([string]$raw,[DateTime]$now.AddSeconds(-6)))) 'FUTURE_GOVERNOR_ACCEPTED'
$pins=Pins;$installation=[Stephanos.Sovereign.ReviewerInstallationV1]::new()
$installation.ReviewerSid='S-1-5-21-111-222-333-1001'
$pinsType.GetField('Installation',$instance).SetValue($pins,$installation)
$pinsType.GetField('ActualSid',$instance).SetValue($pins,$installation.ReviewerSid)
$principal=$type.GetMethod('ReviewerInferencePrincipalV1',$flags)
Require ([bool]$principal.Invoke($null,@($pins))) 'MATCHING_NONADMIN_POLICY_REFUSED'
$pinsType.GetField('Administrator',$instance).SetValue($pins,$true)
Require (-not [bool]$principal.Invoke($null,@($pins))) 'ELEVATED_PRINCIPAL_ACCEPTED'
$pinsType.GetField('Administrator',$instance).SetValue($pins,$false)
$pinsType.GetField('ActualSid',$instance).SetValue($pins,'S-1-5-21-111-222-333-1002')
Require (-not [bool]$principal.Invoke($null,@($pins))) 'MISMATCHED_PRINCIPAL_ACCEPTED'
([IDisposable]$pins).Dispose()
if($env:STEPHANOS_REVIEWER_NATIVE_FIXTURE -ceq '1'){
 # Only this test-owned temporary tree receives fixture ACLs. Existing tool,
 # Program Files and profile ACLs are observed, never repaired by this test.
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $administrator=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 Require ($env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted' -and $administrator) 'HOSTED_ACL_FIXTURE_ONLY'
 $aclCheck=$type.GetMethod('ReviewerProtectedAclV1',$flags)
 function AclAllowed([string]$path){
  try{$aclCheck.Invoke($null,@([string]$path,[bool]$true))|Out-Null;return $true}
  catch{if($_.Exception.InnerException.Message -eq 'REVIEWER_PROTECTED_WRITE_AUTHORITY_UNPROVEN'){return $false};throw}
 }
 function AclRequire([bool]$ok,[string]$reason){Require $ok $reason;$script:aclChecks++}
 function FixtureAcl([bool]$directory){
  $acl=if($directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));$acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @('S-1-5-18','S-1-5-32-544')){
   $inherit=if($directory){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
   $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),
    [Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  }
  return $acl
 }
 foreach($sid in @('S-1-1-0','S-1-3-0')){
  $aclParent=[IO.Path]::Combine($area,'acl-'+$sid);[IO.Directory]::CreateDirectory($aclParent)|Out-Null
  $parentAcl=FixtureAcl $true
  $parentAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),
   [Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
   [Security.AccessControl.PropagationFlags]::InheritOnly,[Security.AccessControl.AccessControlType]::Allow))
  [IO.Directory]::SetAccessControl($aclParent,$parentAcl)
  $protectedChild=[IO.Path]::Combine($aclParent,'protected.txt');[IO.File]::WriteAllText($protectedChild,'fixture child')
  [IO.File]::SetAccessControl($protectedChild,(FixtureAcl $false))
  AclRequire (AclAllowed $aclParent) 'INHERIT_ONLY_PARENT_FALSELY_WRITABLE'
  AclRequire (AclAllowed $protectedChild) 'PROTECTED_CHILD_FALSELY_WRITABLE'
  if($sid -ceq 'S-1-1-0'){
   $inheritedChild=[IO.Path]::Combine($aclParent,'inherited.txt');[IO.File]::WriteAllText($inheritedChild,'ordinary inherited writer')
   $childAcl=[IO.File]::GetAccessControl($inheritedChild)
   $childAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));[IO.File]::SetAccessControl($inheritedChild,$childAcl)
   $effective=@($childAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object{
    $_.IdentityReference.Value -ceq 'S-1-1-0' -and $_.IsInherited -and $_.AccessControlType -eq 'Allow' -and
    ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0})
   AclRequire ($effective.Count -gt 0) 'FIXTURE_INHERITED_EFFECTIVE_WRITER_MISSING'
   AclRequire (-not (AclAllowed $inheritedChild)) 'INHERITED_EFFECTIVE_CHILD_WRITER_ACCEPTED'
   $effectiveAcl=FixtureAcl $true
   $effectiveAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),
    [Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
   [IO.Directory]::SetAccessControl($aclParent,$effectiveAcl)
   AclRequire (-not (AclAllowed $aclParent)) 'EFFECTIVE_PARENT_WRITER_ACCEPTED'
  }
 }
}
$terminal=$type.GetMethod('ReviewerTerminalV1',$flags)
foreach($publication in @($true,$false)){
 $raw=@{status='HIGH_RISK_LOCAL_CANDIDATE_READY';publicationOk=$publication;mergeAuthority=$false;specialistAuthority=$false}|ConvertTo-Json -Compress
 $args=@([string]$raw,'advisory','',[int]0)
 Require ([bool]$terminal.Invoke($null,$args)) 'CANDIDATE_TERMINAL_REFUSED'
 Require ($args[3] -eq $(if($publication){0}else{1})) 'FAILED_PUBLICATION_PROMOTED'
}
foreach($raw in @('{"status":"HIGH_RISK_LOCAL_CANDIDATE_READY","publicationOk":true,"mergeAuthority":true}',
 '{"status":"UNKNOWN_GOOD","publicationOk":true}',"{}"+[char]10+"{}")){
 $args=@([string]$raw,'advisory','',[int]0);Require (-not [bool]$terminal.Invoke($null,$args)) 'UNTRUSTED_TERMINAL_PROMOTED'
}
$actual=$type.GetMethod('ReviewerActualParentV1',$flags).Invoke($null,@())
Require ($actual -ne [IntPtr]::Zero) 'ACTUAL_PARENT_HANDLE_MISSING'
[void]$type.GetMethod('CloseHandle',$flags).Invoke($null,@($actual))
$parent=[Diagnostics.Process]::GetCurrentProcess()
$runner=$type.GetMethod('ReviewerRunChildV1',$flags)
$exe='C:\Program Files\nodejs\node.exe'
$environment='SystemRoot=C:\Windows'+[char]0+'WINDIR=C:\Windows'+[char]0+'PATH=C:\Windows\System32'+[char]0+[char]0
$safe=[Func[bool]]{$true};$script:childSequence=0
function Child([string]$command,[int]$deadline,[Func[bool]]$guard){
 # Production runs this fixed Node tool under DETACHED_PROCESS. Exercise its
 # actual I/O and descendants, not a PowerShell console-host substitute.
 $script:childSequence++;$childScript=[IO.Path]::Combine($area,'child-vector-'+$script:childSequence+'.cjs')
 [IO.File]::WriteAllText($childScript,$command,[Text.UTF8Encoding]::new($false))
 return $runner.Invoke($null,@([string]$exe,('"'+$childScript+'"'),[string]$area,[string]$environment,[IntPtr]$parent.Handle,$guard,[int]$deadline))
}
$child=Child "process.stdout.write('fixture-complete\n');" 10000 $safe
Require ([bool](Field $child 'Ok')) 'NATIVE_BENIGN_CHILD_FAILED'
Require ([bool](Field $child 'ZeroActive')) 'NATIVE_SUCCESS_NOT_DRAINED'
$nativeOutput=[string](Field $child 'Output')
if($nativeOutput.Trim() -ne 'fixture-complete'){
 # Diagnose only these test-controlled children. Retain the exact failing
 # assertion and production UTF-8/terminal checks; never normalize output.
 function NativeTextObservation([string]$value){
  $prefix=$value.Substring(0,[Math]::Min(64,$value.Length))
  $codes=@($prefix.ToCharArray()|ForEach-Object{([int]$_).ToString('X4')})
  return @{length=$value.Length;prefixUtf16=$codes}
 }
 $rawCommand='process.stdout.write(Buffer.from(''fixture-complete'',''utf8''));'
 $rawProbe=Child $rawCommand 10000 $safe
 $observation=@{consoleOutput=(NativeTextObservation $nativeOutput);rawUtf8Probe=@{
  ok=[bool](Field $rawProbe 'Ok');zeroActive=[bool](Field $rawProbe 'ZeroActive');
  output=(NativeTextObservation ([string](Field $rawProbe 'Output')))};qualified=$false}
 [Console]::Error.WriteLine('REVIEWER_NATIVE_OUTPUT_DIAGNOSTIC='+($observation|ConvertTo-Json -Compress -Depth 5))
}
Require ($nativeOutput.Trim() -eq 'fixture-complete') 'NATIVE_OUTPUT_CHANGED'
$loaderSource=[IO.Path]::Combine($area,'loader fixture with spaces');[IO.Directory]::CreateDirectory([IO.Path]::Combine($loaderSource,'scripts'))|Out-Null
[IO.File]::WriteAllText([IO.Path]::Combine($loaderSource,'scripts','sovereign-installed-reviewer-loader-v1.mjs'),
 'export async function resolve(s,c,next){return next(s,c);}');
[IO.File]::WriteAllText([IO.Path]::Combine($loaderSource,'scripts','sovereign-installed-reviewer-v1.mjs'),
 'console.log("native-loader-file-url-complete");');
$nodeArguments=[string]$type.GetMethod('ReviewerNodeArgumentsV1',$flags).Invoke($null,@([string]$loaderSource,'coverage'))
Require ($nodeArguments.StartsWith('--no-warnings --experimental-loader "file:///')) 'NATIVE_LOADER_ARGUMENT_NOT_FILE_URL'
$child=$runner.Invoke($null,@('C:\Program Files\nodejs\node.exe',$nodeArguments,[string]$loaderSource,[string]$environment,[IntPtr]$parent.Handle,$safe,[int]10000))
Require ([bool](Field $child 'Ok')) 'NATIVE_LOADER_FILE_URL_FAILED'
Require ([bool](Field $child 'ZeroActive')) 'NATIVE_LOADER_JOB_NOT_DRAINED'
Require ((Field $child 'Output').Trim() -eq 'native-loader-file-url-complete') 'NATIVE_LOADER_ENTRY_NOT_EXECUTED'
$child=Child "process.stderr.write('fixture-private-stderr');process.stdout.write('good-looking');" 10000 $safe
Require (-not [bool](Field $child 'Ok')) 'STDERR_PROMOTED'
Require ([bool](Field $child 'ZeroActive')) 'STDERR_JOB_NOT_DRAINED'
Require ((Field $child 'Output') -eq '') 'PRIVATE_STDERR_OR_AMBIGUOUS_OUTPUT_LEAKED'
$child=Child 'setTimeout(()=>{},20000);' 500 $safe
Require (-not [bool](Field $child 'Ok')) 'DEADLINE_CHILD_ACCEPTED'
Require ([bool](Field $child 'ZeroActive')) 'DEADLINE_JOB_NOT_DRAINED'
$script:gameClock=[Diagnostics.Stopwatch]::StartNew();$unsafe=[Func[bool]]{$script:gameClock.ElapsedMilliseconds -lt 750}
$child=Child 'setTimeout(()=>{},20000);' 10000 $unsafe
Require (-not [bool](Field $child 'Ok')) 'GAMING_CANCELLATION_ACCEPTED'
Require ([bool](Field $child 'ZeroActive')) 'GAMING_JOB_NOT_DRAINED'
$descendantMarker=[IO.Path]::Combine($area,'descendant-started.json');$rootMarker=[IO.Path]::Combine($area,'root-exited.json')
$descendantCode='require("node:fs").writeFileSync('+[string]($descendantMarker|ConvertTo-Json -Compress)+',JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000);'
$descendant='const child=require("node:child_process").spawn(process.execPath,["-e",'+[string]($descendantCode|ConvertTo-Json -Compress)+'],{stdio:"ignore",detached:false});'
$descendant+='child.once("error",()=>process.exit(91));child.once("spawn",()=>child.unref());'
$descendant+='process.on("exit",()=>require("node:fs").writeFileSync('+[string]($rootMarker|ConvertTo-Json -Compress)+',JSON.stringify({pid:process.pid})));'
$script:descendantProcess=$null
$observeDescendant=[Func[bool]]{
 if($null -eq $script:descendantProcess -and [IO.File]::Exists($descendantMarker)){
  $witness=[IO.File]::ReadAllText($descendantMarker)|ConvertFrom-Json
  $process=[Diagnostics.Process]::GetProcessById([int]$witness.pid)
  [void]$process.Handle
  if($process.HasExited){$process.Dispose();return $false}
  $script:descendantProcess=$process
 }
 return $true
}
try{
 $child=Child $descendant 2000 $observeDescendant
 Require ([IO.File]::Exists($rootMarker)) 'DESCENDANT_VECTOR_ROOT_DID_NOT_EXIT'
 Require ($null -ne $script:descendantProcess) 'LIVE_DESCENDANT_NOT_WITNESSED'
 Require (-not [bool](Field $child 'Ok')) 'LIVE_DESCENDANT_ACCEPTED'
 Require ([bool](Field $child 'ZeroActive')) 'DESCENDANT_JOB_NOT_DRAINED'
 Require ($script:descendantProcess.WaitForExit(0)) 'WITNESSED_DESCENDANT_SURVIVED_DRAIN'
}finally{if($null -ne $script:descendantProcess){$script:descendantProcess.Dispose()}}
$parent.Dispose()
[Console]::WriteLine('REVIEWER_NATIVE_FIXTURE='+(@{checks=$checks;aclChecks=$aclChecks;nativeCompiled=$true;qualified=$false;physicalBattleBridgeCommissioning=$false}|ConvertTo-Json -Compress))
`.replace('__NATIVE__',native.join(',')).replace('__FIXTURE__',literal(fixture));
  const scriptPath=join(fixture,'native-fixture.ps1');writeFileSync(scriptPath,script);
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-File',scriptPath],{encoding:'utf8',timeout:110000,maxBuffer:65536});
  assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
  const line=result.stdout.split(/\r?\n/).find(x=>x.startsWith('REVIEWER_NATIVE_FIXTURE='));
  assert.ok(line,result.stdout);const receipt=JSON.parse(line.split('=')[1]);
  assert.ok(receipt.checks>=40);assert.equal(receipt.nativeCompiled,true);assert.equal(receipt.qualified,false);
  if(process.env.STEPHANOS_REVIEWER_NATIVE_FIXTURE==='1')assert.equal(receipt.aclChecks,7);
});

test('isolated hosted Windows installer and actual reader prove source custody without identity enrollment',
  {skip:process.platform!=='win32'||process.env.STEPHANOS_REVIEWER_NATIVE_FIXTURE!=='1',timeout:120000},t=>{
  // This fixture is explicitly enabled only in the existing hosted Windows
  // CI job. Never install a profile while running normal tests on Battle Bridge.
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  const fixture=mkdtempSync(join(tmpdir(),'reviewer-protected-hosted-fixture-'));
  t.after(()=>rmSync(fixture,{recursive:true,force:true}));
  const git=resolveBattleBridgeGitExecution();
  const command=args=>{
    const r=spawnSync(git.executable,[...git.fixedConfigArgs,'-C',fixture,...args],{encoding:'utf8',
      env:{...git.environment,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
        GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'},shell:false,maxBuffer:2097152});
    assert.equal(r.status,0,r.stderr);return r.stdout.trim();
  };
  command(['init','-b','main']);command(['remote','add','origin','https://github.com/Cheekyfellastef/stephan-os.git']);
  for(const path of SOVEREIGN_REVIEWER_PROFILE_FILES_V1){mkdirSync(dirname(join(fixture,path)),{recursive:true});writeFileSync(join(fixture,path),readFileSync(join(root,path)));}
  command(['add','.']);command(['commit','-m','isolated protected reviewer fixture']);
  const head=command(['rev-parse','HEAD']);command(['update-ref','refs/remotes/origin/main',head]);
  const packageSource=buildReviewerInstallationSourceV1({expectedMain:head,root:fixture});
  const packagePath=join(fixture,'install-fixture.ps1');writeFileSync(packagePath,packageSource.script);
  const driver=String.raw`
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:STEPHANOS_REVIEWER_NATIVE_FIXTURE -cne '1'){throw 'HOSTED_FIXTURE_ONLY'}
$root='C:\Program Files\Stephanos\SovereignReviewerV1'
if([IO.Directory]::Exists($root) -or [IO.File]::Exists($root)){throw 'FIXTURE_EXISTING_PROFILE_REFUSED'}
$created=$false;$checks=0
function Require([bool]$ok,[string]$reason){if(-not $ok){throw $reason};$script:checks++}
function Inspect([string]$hostPath){
 $raw=@(& $hostPath --inspect)
 if($LASTEXITCODE -ne 0 -or $raw.Count -ne 1 -or -not $raw[0].StartsWith('SOVEREIGN_REVIEWER_PROFILE_V1=')){return $null}
 return $raw[0].Substring('SOVEREIGN_REVIEWER_PROFILE_V1='.Length)|ConvertFrom-Json
}
function FixedToolAclDiagnostics{
 # Read-only and test-only: identify the failing fixed tool chain without
 # changing its ACL or exposing account names/unknown principal identifiers.
 function PrincipalRole([string]$sid){
  switch($sid){
   'S-1-5-18'{return 'SYSTEM'};'S-1-5-32-544'{return 'ADMINISTRATORS'}
   'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'{return 'TRUSTED_INSTALLER'}
   'S-1-1-0'{return 'EVERYONE'};'S-1-5-32-545'{return 'USERS'};'S-1-5-11'{return 'AUTHENTICATED_USERS'}
   'S-1-3-0'{return 'CREATOR_OWNER'};'S-1-3-1'{return 'CREATOR_GROUP'};default{return 'OTHER'}
  }
 }
 foreach($fixed in @(@('node-parent','C:\Program Files\nodejs'),@('node','C:\Program Files\nodejs\node.exe'),
  @('git-parent','C:\Program Files\Git'),@('git-cmd-parent','C:\Program Files\Git\cmd'),@('git','C:\Program Files\Git\cmd\git.exe'))){
  try{
   $directory=[IO.Directory]::Exists($fixed[1]);$acl=if($directory){[IO.Directory]::GetAccessControl($fixed[1])}else{[IO.File]::GetAccessControl($fixed[1])}
   $rules=@();foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rules.Count -ge 32){break}
    $rules+=@{principal=(PrincipalRole $rule.IdentityReference.Value);type=[string]$rule.AccessControlType;
     rightsHex=[Convert]::ToString([int64]$rule.FileSystemRights,16);inheritance=[string]$rule.InheritanceFlags;
     propagation=[string]$rule.PropagationFlags;inherited=[bool]$rule.IsInherited}
   }
   [Console]::Error.WriteLine('REVIEWER_FIXED_TOOL_ACL_DIAGNOSTIC='+(@{tool=$fixed[0];directory=$directory;
    owner=(PrincipalRole $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value);rules=$rules}|ConvertTo-Json -Compress -Depth 5))
  }catch{[Console]::Error.WriteLine('REVIEWER_FIXED_TOOL_ACL_DIAGNOSTIC='+(@{tool=$fixed[0];unavailable=$true}|ConvertTo-Json -Compress))}
 }
}
try{
 $created=$true
 & __PACKAGE__ -ReviewerSid ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)|Out-Null
 $hostPath=[IO.Path]::Combine($root,'host.exe');$version=[IO.Path]::Combine($root,'__HEAD__')
 $first=Inspect $hostPath
 Require ($null -ne $first -and $first.codeCustodyObserved -eq $true) 'REAL_PROTECTED_READER_NOT_OPERATIONAL'
 Require ($first.sourceHead -ceq '__HEAD__' -and $first.sourceFileCount -eq 25) 'PHYSICAL_CLOSURE_IDENTITY_CHANGED'
 Require ($first.principalMatchesProfile -eq $true) 'ACTUAL_PRINCIPAL_NOT_OBSERVED'
 Require ($first.principalAdministrator -eq $true) 'HOSTED_ELEVATED_TOKEN_NOT_OBSERVED'
 Require ($first.independentPrincipalObserved -eq $false -and $first.qualified -eq $false -and $first.physicalCommissioningProven -eq $false) 'FIXTURE_BECAME_AUTHORITY'
 $raw=@(& $hostPath --advisory);Require ($LASTEXITCODE -ne 0) 'ELEVATED_INFERENCE_ACCEPTED'
 $copy=[IO.Path]::Combine(__FIXTURE__,'copied-host.exe');[IO.File]::Copy($hostPath,$copy)
 Require ($null -eq (Inspect $copy)) 'WRITABLE_COPIED_HELPER_TRUSTED'
 $path=[IO.Path]::Combine($version,'source','shared','agents','engineeringIncidentMethodMemoryV1.mjs')
 $before=[IO.File]::ReadAllBytes($path);[IO.File]::WriteAllText($path,'changed final source')
 Require ($null -eq (Inspect $hostPath)) 'CHANGED_FINAL_SOURCE_TRUSTED'
 [IO.File]::WriteAllBytes($path,$before)
 $alias=[IO.Path]::Combine($version,'source-alias');New-Item -ItemType HardLink -Path $alias -Target $path|Out-Null
 Require ($null -eq (Inspect $hostPath)) 'SOURCE_HARDLINK_TRUSTED';[IO.File]::Delete($alias)
 $installation=[IO.Path]::Combine($version,'installation.json');$raw=[IO.File]::ReadAllText($installation)
 $bad=$raw|ConvertFrom-Json;$bad.NodeSha256='0'*64
 [IO.File]::WriteAllText($installation,($bad|ConvertTo-Json -Compress))
 Require ($null -eq (Inspect $hostPath)) 'WRONG_NATIVE_TOOL_BYTES_TRUSTED'
 [IO.File]::WriteAllText($installation,$raw)
 $acl=[IO.File]::GetAccessControl($path);$original=$acl.GetSecurityDescriptorBinaryForm()
 $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Write','Allow')
 $acl.AddAccessRule($rule);[IO.File]::SetAccessControl($path,$acl)
 Require ($null -eq (Inspect $hostPath)) 'ORDINARY_WRITE_ACE_TRUSTED'
 $acl.SetSecurityDescriptorBinaryForm($original);[IO.File]::SetAccessControl($path,$acl)
 $last=Inspect $hostPath;Require ($null -ne $last -and $last.codeCustodyObserved -eq $true) 'RESTORED_EXACT_PROFILE_FAILED'
 [Console]::WriteLine('REVIEWER_PROTECTED_HOSTED_FIXTURE='+(@{checks=$checks;actualNativeReader=$true;qualified=$false;physicalBattleBridgeCommissioning=$false}|ConvertTo-Json -Compress))
}catch{
 FixedToolAclDiagnostics
 throw
}finally{
 if($created -and [IO.Directory]::Exists($root)){
  if(([IO.File]::GetAttributes($root) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'FIXTURE_CLEANUP_REDIRECTION'}
  [IO.Directory]::Delete($root,$true)
 }
}
`.replace('__PACKAGE__',literal(packagePath)).replaceAll('__HEAD__',head).replaceAll('__FIXTURE__',literal(fixture));
  const driverPath=join(fixture,'protected-fixture.ps1');writeFileSync(driverPath,driver);
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-File',driverPath],{encoding:'utf8',timeout:110000,maxBuffer:65536});
  assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
  const line=result.stdout.split(/\r?\n/).find(x=>x.startsWith('REVIEWER_PROTECTED_HOSTED_FIXTURE='));
  assert.ok(line,result.stdout);const receipt=JSON.parse(line.split('=')[1]);
  assert.ok(receipt.checks>=12);assert.equal(receipt.actualNativeReader,true);assert.equal(receipt.qualified,false);
});
