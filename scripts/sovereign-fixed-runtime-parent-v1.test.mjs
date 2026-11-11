import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXED_MAILBOX_NATIVE_EVIDENCE_RUNTIME_PROFILE_V1, consumeFixedRuntimePrelaunchExclusionV1, consumeFixedRuntimeTerminalProvenanceV1, executeFixedMaintenanceRuntimeV1, executeFixedSourceTaskRuntimeV1} from './sovereign-fixed-runtime-parent-v1.mjs';
import {observeCurrentFixedRuntimeInstallationV1, observeCurrentFixedRuntimeQualificationV1} from './sovereign-fixed-runtime-install-current-v1.mjs';

test('child JSON copies and caller qualification cannot mint native provenance', async () => {
  const binding={requestId:'fixture-request-123',sourceHead:'a'.repeat(40),custodyRecordSha256:'b'.repeat(64),nativeRecordId:26};
  for(const value of [{executionCustodyReleased:true}, Object.freeze({executionCustodyReleased:true}), JSON.parse('{"executionCustodyReleased":true}')]) {
    assert.equal(consumeFixedRuntimeTerminalProvenanceV1(value,binding),false);
  }
  const result=await executeFixedMaintenanceRuntimeV1({ok:true,dispatchAllowed:true,profiles:['MAINTENANCE_GOAL_BUILDER_V1']},binding,{onPrepared:()=>true});
  assert.equal(result.reason,'FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED');
  assert.equal(result.taskRootCreated,false);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1({...result},binding),false);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),true);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),false);
  assert.equal(consumeFixedRuntimeTerminalProvenanceV1(result,binding),false);
});


test('a mutable or nonprimitive caller binding cannot issue a cross-task exclusion', async () => {
  const binding={requestId:'fixture-original',sourceHead:'a'.repeat(40),custodyRecordSha256:'b'.repeat(64),nativeRecordId:26,actionId:'task-a',missionId:'mission-a',claimSha256:'c'.repeat(64)};
  const original={...binding};
  const result=await executeFixedSourceTaskRuntimeV1({ok:true},binding);
  binding.actionId='task-b';
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),false);
  const again=await executeFixedSourceTaskRuntimeV1({ok:true},original);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(again,original),true);
  const bad=await executeFixedSourceTaskRuntimeV1({ok:true},{...original,actionId:{toString:()=>original.actionId}});
  assert.equal(bad.reason,'FIXED_RUNTIME_PRIMITIVE_BINDING_REQUIRED');
});


test('isolated actual parent protocol preserves zero across refusal cancellation late binding and input mutation', () => {
  const output=execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-parent-protocol-fixture-v1.mjs',import.meta.url))],{encoding:'utf8',timeout:10000,windowsHide:true});
  const result=JSON.parse(output);
  assert.equal(result.cases,27);assert.equal(result.nativeExecuted,false);assert.equal(result.productionQualification,false);
});

test('actual inspector preserves only closed native denials and never qualifies failure', () => {
  const output=execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-inspection-diagnostics-fixture-v1.mjs',import.meta.url))],{encoding:'utf8',timeout:10000,windowsHide:true});
  const result=JSON.parse(output);
  assert.equal(result.cases,46);assert.equal(result.nativeExecuted,false);assert.equal(result.productionQualification,false);
});


test('fixed runtime commissioning observation separates missing, present, restart-required and qualified', () => {
  const head='a'.repeat(40), hash='b'.repeat(64);
  const missing=observeCurrentFixedRuntimeInstallationV1(head,{platform:'win32',
    inspectPresence:()=>({ok:false,reason:'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING'})});
  assert.deepEqual(missing,{ok:true,state:'MISSING',reason:'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',installed:false,sourceHead:head});
  const present=observeCurrentFixedRuntimeInstallationV1(head,{platform:'win32',
    inspectPresence:()=>({ok:true,installed:true,sourceHead:head,helperSha256:hash,manifestSha256:'c'.repeat(64)})});
  assert.equal(present.ok,true);assert.equal(present.state,'PRESENT');assert.equal(present.installed,true);
  const restart=observeCurrentFixedRuntimeQualificationV1(head,{platform:'win32',
    inspectQualification:()=>({ok:false,reason:'RUNTIME_PENDING_LATER_BOOT_UNPROVEN'})});
  assert.deepEqual(restart,{ok:true,state:'RESTART_REQUIRED',reason:'RUNTIME_PENDING_LATER_BOOT_UNPROVEN',qualified:false,sourceHead:head});
  const qualified=observeCurrentFixedRuntimeQualificationV1(head,{platform:'win32',
    inspectQualification:()=>({ok:true,dispatchAllowed:true,sourceHead:head})});
  assert.deepEqual(qualified,{ok:true,state:'QUALIFIED',reason:'',qualified:true,sourceHead:head});
});

test('fixed runtime commissioning observation refuses wrong identity and unrelated denial', () => {
  const head='a'.repeat(40);
  const wrong=observeCurrentFixedRuntimeInstallationV1(head,{platform:'win32',
    inspectPresence:()=>({ok:true,installed:true,sourceHead:'d'.repeat(40),helperSha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)})});
  assert.equal(wrong.ok,false);assert.equal(wrong.reason,'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
  const blocked=observeCurrentFixedRuntimeQualificationV1(head,{platform:'win32',
    inspectQualification:()=>({ok:false,reason:'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD'})});
  assert.equal(blocked.ok,false);assert.equal(blocked.state,'BLOCKED');assert.equal(blocked.reason,'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
});

test('current-main fixed runtime preparer stays fixed-source and carries no restart or arbitrary shell surface', () => {
  const source=readFileSync(fileURLToPath(new URL('./sovereign-fixed-runtime-install-current-v1.mjs',import.meta.url)),'utf8');
  assert.match(source,/FIXED_RUNTIME_SOURCE_PATHS_V1/);
  assert.match(source,/buildFixedRuntimeInstallerCandidateV1/);
  assert.match(source,/rev-parse', expectedMain \+ ':' \+ relative/);
  assert.match(source,/cat-file', 'blob', blobSha/);
  assert.match(source,/hash-object', '--path=' \+ relative, '--stdin/);
  assert.match(source,/input: physicalBytes/);
  assert.match(source,/materializedBlobSha !== expectedBlobSha/);
  assert.match(source,/return hash\(physicalBytes\)/);
  assert.match(source,/materializedSha256/);
  assert.match(source,/FIXED_RUNTIME_INSTALL_SOURCE_MATERIALIZATION_CHANGED/);
  assert.doesNotMatch(source,/Buffer\.from\(actual\)\.equals\(expectedBytes\)/);
  assert.match(source,/writeFileFn\(candidate\.payloadPath, payload, \{ flag: 'wx', mode: 0o600 \}\)/);
  assert.doesNotMatch(source,/cmd\.exe|Invoke-Expression|Restart-Computer|Stop-Computer|shutdown\.exe|git\s+reset|git\s+clean|git\s+push/i);
});


test('mailbox native evidence fixed profile is inspectable but remains pre-job fail-closed', () => {
  assert.deepEqual(FIXED_MAILBOX_NATIVE_EVIDENCE_RUNTIME_PROFILE_V1,{
    profile:'CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1',signerCommissioned:false,dispatchAllowed:false,reason:'NATIVE_ROTATION_PRODUCER_UNQUALIFIED',
  });
  const host=readFileSync(fileURLToPath(new URL('./windows/SovereignFixedRuntimeHostV1.cs',import.meta.url)),'utf8');
  const parent=readFileSync(fileURLToPath(new URL('./sovereign-fixed-runtime-parent-v1.mjs',import.meta.url)),'utf8');
  assert.equal(host.includes('Profiles=new string[]{"MAINTENANCE_GOAL_BUILDER_V1","SOURCE_TASK_V1","CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1"}'),true);
  assert.equal(host.includes('if(mailboxNativeEvidence) throw new InvalidOperationException("NATIVE_ROTATION_PRODUCER_UNQUALIFIED")'),true);
  assert.ok(host.indexOf('if(mailboxNativeEvidence) throw new InvalidOperationException("NATIVE_ROTATION_PRODUCER_UNQUALIFIED")') < host.indexOf('job=CreateJobObjectW'));
  assert.doesNotMatch(parent,/executeFixedMailboxNativeEvidenceRuntimeV1/);
  assert.doesNotMatch(parent,/generateKeyPairSync|privateKey|private-key/i);
});


test('native frame canonical wire denies escaped JSON aliases before parsing', () => {
  const host=readFileSync(fileURLToPath(new URL('./windows/SovereignFixedRuntimeHostV1.cs',import.meta.url)),'utf8');
  const denial=host.indexOf('RUNTIME_FRAME_ESCAPED_WIRE_FORBIDDEN');
  const decoder=host.indexOf('parser.DeserializeObject(raw)');
  assert.ok(denial>0 && decoder>denial, 'escaped wire rejected before JSON dictionary');
});

test('real Windows fixed runtime parser rejects escaped JSON property aliases', {skip:process.platform!=='win32'}, () => {
  const script=String.raw`$ErrorActionPreference='Stop'
$root=(Get-Location).Path
$names=@('SovereignCoreJobCustodyV1.cs','SovereignFixedRuntimeJobV1.cs','SovereignFixedRuntimeIdentityV1.cs','SovereignFixedRuntimeAuthorityV1.cs','SovereignFixedRuntimeHostV1.cs','SovereignFixedRuntimeSourceV1.cs')
$src=($names|ForEach-Object{[IO.File]::ReadAllText((Join-Path $root ('scripts\windows\'+$_)))}) -join [Environment]::NewLine
Add-Type -TypeDefinition $src -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management'
$h=@'
public static class StephanosFrameAliasRegressionV1 {
 public static string Check(System.Reflection.MethodInfo parser,string json) {
  try{return parser.Invoke(null,new object[]{json})==null?"NULL":"ACCEPTED";}
  catch(System.Reflection.TargetInvocationException e){return "REJECT:"+e.InnerException.Message;}
 }
}
'@
Add-Type -TypeDefinition $h
$parser=[Stephanos.Sovereign.CoreJobCustodyV1].GetMethod('ParseFixedRuntimeRequestV1',[Reflection.BindingFlags]'NonPublic,Static')
$sha=([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash([byte[]]@()))).Replace('-','').ToLowerInvariant()
$f=[ordered]@{SchemaVersion='stephanos.fixed-runtime-request.v1';RequestId='mailboxnative-2315-review';Profile='CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1';RuntimeSourceHead='a'*40;InstallationSourceHead='a'*40;SourceProofSha256='b'*64;OwnerPid=$PID;TaskFrameBase64='';TaskBindingSha256=$sha}
$json=ConvertTo-Json -InputObject $f -Compress -Depth 5
$canonical='"Profile":"CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1"'
if(-not $json.Contains($canonical)){throw 'CANONICAL_FRAME_MISSING'}
$cases=@(
@{input=$json;expected='ACCEPTED'},
@{input=$json.Replace($canonical,'"Profile":"SOURCE_TASK_V1","Profile":"CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1"');expected='REJECT:RUNTIME_FRAME_DUPLICATE_FIELD'},
@{input=$json.Replace($canonical,'"Profile":"CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1","\u0050rofile":"SOURCE_TASK_V1"');expected='REJECT:RUNTIME_FRAME_ESCAPED_WIRE_FORBIDDEN'},
@{input=$json.Replace($canonical,'"\u0050rofile":"SOURCE_TASK_V1","Profile":"CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1"');expected='REJECT:RUNTIME_FRAME_ESCAPED_WIRE_FORBIDDEN'},
@{input=$json.Replace('"SchemaVersion":','"\u0053chemaVersion":');expected='REJECT:RUNTIME_FRAME_ESCAPED_WIRE_FORBIDDEN'},
@{input=$json.Replace('"TaskFrameBase64":','"\u0054askFrameBase64":');expected='REJECT:RUNTIME_FRAME_ESCAPED_WIRE_FORBIDDEN'}
)
foreach($item in $cases){$actual=[StephanosFrameAliasRegressionV1]::Check($parser,[string]$item.input);if($actual -cne $item.expected){throw ('FRAME_ALIAS_REGRESSION_FAILED:'+ $item.expected+':'+$actual)}}
Write-Output 'RUNTIME_FRAME_ESCAPED_KEY_REGRESSION_PASS_6_OF_6'`;
  const output=execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],
    {cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536});
  assert.match(output,/RUNTIME_FRAME_ESCAPED_KEY_REGRESSION_PASS_6_OF_6/);
});

test('fixed-runtime source validates packed canonical local and origin refs through its fixed Git probe', (t) => {
  const source=readFileSync(new URL('./sovereign-fixed-runtime-parent-v1.mjs',import.meta.url),'utf8');
  const from=source.indexOf('function fixedRuntimeExactRefShaV1(');
  const until=source.indexOf('\nfunction protectedInstallationAt(',from);
  assert.ok(from>=0 && until>from, 'production ref functions found');
  const root=mkdtempSync(join(tmpdir(),'fixed-runtime-packed-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'checkout'), privateGit=join(root,'private');
  mkdirSync(repo);mkdirSync(privateGit);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:4000}).trim();
  git('init','-b','main');
  const newCommit=()=>git('-c','user.name=Fixture','-c','user.email=fixture@example.test',
    'commit','--allow-empty','-m','fixed-ref-fixture');
  newCommit();
  const first=git('rev-parse','HEAD');
  git('update-ref','refs/remotes/origin/main',first);
  copyFileSync(join(repo,'.git','HEAD'),join(privateGit,'HEAD'));
  copyFileSync(join(repo,'.git','index'),join(privateGit,'index'));
  writeFileSync(join(privateGit,'commondir'),join(repo,'.git')+'\n');
  writeFileSync(join(privateGit,'config.worktree'),'');
  let asserted=0,closed=0;
  const context={
    assert:()=>{asserted++;assert.equal(existsSync(join(repo,'.git','HEAD')),true);},
    repositoryArgs:()=>['--git-dir='+privateGit,'--work-tree='+repo],
    close:()=>{closed++;return true;},
  };
  const factory=new Function('SOURCE','join','boundedFile','createBattleBridgeGitProbeContextV1',
    'isBattleBridgeGitProbeContextV1','resolveBattleBridgeGitExecution','spawnSync',
    'Buffer','performance','sourceDenied','process',
    source.slice(from,until)+'\nreturn {fixedRuntimeExactRefShaV1,exactHead};');
  const {fixedRuntimeExactRefShaV1,exactHead}=factory(repo,join,
    (path,max)=>{const bytes=readFileSync(path);assert.ok(bytes.length<=max);return bytes;},
    ()=>context,()=>true,()=>({executable:'git',fixedConfigArgs:[],environment:process.env}),
    spawnSync,Buffer,performance,code=>{throw Error('FIXED_RUNTIME_SOURCE_PROOF_'+code);},process);
  const ref=name=>fixedRuntimeExactRefShaV1(name,context,
    {executable:'git',fixedConfigArgs:[],environment:process.env},performance.now());
  assert.equal(exactHead(),first);
  assert.equal(ref('refs/remotes/origin/main'),first);
  git('pack-refs','--all','--prune');
  assert.equal(existsSync(join(repo,'.git','refs','heads','main')),false);
  assert.equal(existsSync(join(repo,'.git','refs','remotes','origin','main')),false);
  assert.equal(exactHead(),first);
  assert.equal(ref('refs/remotes/origin/main'),first);
  assert.throws(()=>ref('refs/heads/feature'),/REF_NOT_ALLOWED/);
  git('update-ref','-d','refs/remotes/origin/main');
  assert.throws(()=>ref('refs/remotes/origin/main'),/REF_UNPROVEN/);
  git('update-ref','refs/remotes/origin/main',first);
  newCommit();
  const second=git('rev-parse','HEAD');
  assert.notEqual(first,second);
  assert.equal(exactHead(),second);
  assert.equal(ref('refs/remotes/origin/main'),first);
  git('update-ref','refs/remotes/origin/main',second);
  assert.equal(ref('refs/remotes/origin/main'),second);
  git('switch','-c','other');
  assert.throws(()=>exactHead(),/CANONICAL_BRANCH_REQUIRED/);
  git('switch','main');
  git('checkout','--detach',second);
  assert.throws(()=>exactHead(),/CANONICAL_BRANCH_REQUIRED/);
  git('switch','main');
  assert.equal(exactHead(),second);
  assert.ok(asserted>=14,'every Git result has pre/post context assertions');
  assert.ok(closed>=4,'canonical head probes close their context');
});
