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
$instance=[Reflection.BindingFlags]'NonPublic,Instance';$checks=0
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
$raw=$state|ConvertTo-Json -Compress
Require ([bool]$governor.Invoke($null,@($raw,$now))) 'FRESH_IDLE_NATIVE_GOVERNOR_REFUSED'
foreach($name in @('active','flatGameActive','airLinkActive','realAirLinkActive','virtualAirLinkTestActive','prepareLeaseActive','localModelAllowed','heavyModelAllowed')){
 $before=$state[$name];$state[$name]=-not $before
 Require (-not [bool]$governor.Invoke($null,@(($state|ConvertTo-Json -Compress),$now))) ('UNSAFE_GOVERNOR_'+$name)
 $state[$name]=$before
}
foreach($bad in @($raw.Replace('"active":false','"active":"false"'),$raw.Replace('"active":false','"active":false,"active":false'),
 $raw.Replace('"active":false','"active":false,"\u0061ctive":false'),$raw.Replace('"governorVersion":3','"governorVersion":2'),
 $raw.Replace('"active":false,',''),$raw.Replace('"ollamaLoadMode":"balanced"','"ollamaLoadMode":"cool"'))){
 Require (-not [bool]$governor.Invoke($null,@($bad,$now))) 'MALFORMED_GOVERNOR_ACCEPTED'
}
Require (-not [bool]$governor.Invoke($null,@($raw,$now.AddSeconds(31)))) 'STALE_GOVERNOR_ACCEPTED'
Require (-not [bool]$governor.Invoke($null,@($raw,$now.AddSeconds(-6)))) 'FUTURE_GOVERNOR_ACCEPTED'
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
$exe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$environment='SystemRoot=C:\Windows'+[char]0+'WINDIR=C:\Windows'+[char]0+'PATH=C:\Windows\System32'+[char]0+[char]0
$safe=[Func[bool]]{$true}
function Child([string]$command,[int]$deadline,[Func[bool]]$guard){
 $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
 return $runner.Invoke($null,@($exe,('-NoLogo -NoProfile -NonInteractive -EncodedCommand '+$encoded),$area,$environment,$parent.Handle,$guard,$deadline))
}
$child=Child "[Console]::WriteLine('fixture-complete')" 10000 $safe
Require ([bool](Field $child 'Ok')) 'NATIVE_BENIGN_CHILD_FAILED'
Require ([bool](Field $child 'ZeroActive')) 'NATIVE_SUCCESS_NOT_DRAINED'
Require ((Field $child 'Output').Trim() -eq 'fixture-complete') 'NATIVE_OUTPUT_CHANGED'
$child=Child "[Console]::Error.WriteLine('fixture-private-stderr');[Console]::WriteLine('good-looking')" 10000 $safe
Require (-not [bool](Field $child 'Ok')) 'STDERR_PROMOTED'
Require ([bool](Field $child 'ZeroActive')) 'STDERR_JOB_NOT_DRAINED'
Require ((Field $child 'Output') -eq '') 'PRIVATE_STDERR_OR_AMBIGUOUS_OUTPUT_LEAKED'
$child=Child "Start-Sleep -Seconds 20" 500 $safe
Require (-not [bool](Field $child 'Ok')) 'DEADLINE_CHILD_ACCEPTED'
Require ([bool](Field $child 'ZeroActive')) 'DEADLINE_JOB_NOT_DRAINED'
$script:gameClock=[Diagnostics.Stopwatch]::StartNew();$unsafe=[Func[bool]]{$script:gameClock.ElapsedMilliseconds -lt 750}
$child=Child "Start-Sleep -Seconds 20" 10000 $unsafe
Require (-not [bool](Field $child 'Ok')) 'GAMING_CANCELLATION_ACCEPTED'
Require ([bool](Field $child 'ZeroActive')) 'GAMING_JOB_NOT_DRAINED'
$descendant="Start-Process -FilePath '"+$exe+"' -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 20' -WindowStyle Hidden|Out-Null"
$child=Child $descendant 2000 $safe
Require (-not [bool](Field $child 'Ok')) 'LIVE_DESCENDANT_ACCEPTED'
Require ([bool](Field $child 'ZeroActive')) 'DESCENDANT_JOB_NOT_DRAINED'
$parent.Dispose()
[Console]::WriteLine('REVIEWER_NATIVE_FIXTURE='+(@{checks=$checks;nativeCompiled=$true;qualified=$false;physicalBattleBridgeCommissioning=$false}|ConvertTo-Json -Compress))
`.replace('__NATIVE__',native.join(',')).replace('__FIXTURE__',literal(fixture));
  const scriptPath=join(fixture,'native-fixture.ps1');writeFileSync(scriptPath,script);
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-File',scriptPath],{encoding:'utf8',timeout:110000,maxBuffer:65536});
  assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
  const line=result.stdout.split(/\r?\n/).find(x=>x.startsWith('REVIEWER_NATIVE_FIXTURE='));
  assert.ok(line,result.stdout);const receipt=JSON.parse(line.split('=')[1]);
  assert.ok(receipt.checks>=40);assert.equal(receipt.nativeCompiled,true);assert.equal(receipt.qualified,false);
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
