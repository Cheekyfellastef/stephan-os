import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmdirSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { battleBridgeGitFixedConfigArgs, battleBridgeCanonicalRepositoryArgs } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import {
  buildEmptyRuntimeVersionQuarantineCandidateV1, EMPTY_RUNTIME_VERSION_V1 as OLD,
  INSTALLED_RUNTIME_VERSION_V1 as INSTALLED, EMPTY_RUNTIME_QUARANTINE_ENTRY_V1 as ENTRY,
} from './sovereign-fixed-runtime-empty-version-quarantine-v1.mjs';

const FACTORY='scripts/sovereign-fixed-runtime-empty-version-quarantine-v1.mjs';
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const source=readFileSync(new URL('./windows/quarantine-sovereign-fixed-runtime-empty-version-v1.ps1',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const installed={SourceHead:INSTALLED,SourceTree:'b'.repeat(40),HelperSha256:'1'.repeat(64),
  ManifestSha256:'2'.repeat(64),GitClosureSha256:'3'.repeat(64),PendingSha256:'4'.repeat(64)};
function input(){return {expectedMain:'a'.repeat(40),sourceTree:'b'.repeat(40),operatorSid:'S-1-5-21-1-2-3-1002',
  operationId:randomUUID().replaceAll('-',''),installed:{...installed},records:[FACTORY,ENTRY].map(path=>{
    const b=readFileSync(new URL('../'+path,import.meta.url));
    return {path,blobSha:blob(b),materializedSha256:hash(b),contentBase64:b.toString('base64')};
  })};}
function powershell(body){
  const prelude=`$ErrorActionPreference='Stop'
Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1'
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString('base64')}'))
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ('PARSE: '+($errors|ForEach-Object Message))}
foreach($function in $ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
 . ([scriptblock]::Create($function.Extent.Text))
}
$script:emptyClock=[Diagnostics.Stopwatch]::StartNew()
$script:emptyPins=[Collections.Generic.List[IntPtr]]::new()
$script:emptyStreams=[Collections.Generic.List[IDisposable]]::new()
`;
  const r=spawnSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-Command','& ([scriptblock]::Create([Console]::In.ReadToEnd()))'],
    {input:prelude+body,encoding:'utf8',windowsHide:true,shell:false,timeout:20000,maxBuffer:1048576});
  assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
  return JSON.parse(r.stdout.trim());
}
const windows={skip:process.platform!=='win32'||!existsSync(PS)};

test('candidate binds exact captured source, target, installed commitment and closed non-authority flags',()=>{
  const x=input(),c=buildEmptyRuntimeVersionQuarantineCandidateV1(x),p=JSON.parse(c.payloadBytes);
  assert.equal(c.targetVersion,OLD);assert.equal(c.installedSourceHead,INSTALLED);
  assert.equal(p.Installed.PendingSha256,installed.PendingSha256);
  assert.equal(c.payloadSha256,hash(c.payloadBytes));assert.equal(c.scriptSha256,hash(c.script));
  assert.equal(c.encodedCommand,Buffer.from(c.script,'utf16le').toString('base64'));
  assert.equal(p.Records.find(r=>r.Path===ENTRY).ContentBase64,x.records[1].contentBase64);
  assert.match(c.payloadPath,new RegExp('StephanosEmptyRuntimeVersion-'+x.expectedMain+'-'+x.operationId+'\\.json$'));
  for(const key of ['installed','elevationPerformed','quarantinePerformed','custodyReleased','sourceLeaseReleased',
    'runtimeQualificationGranted','pcRestartAllowed','arbitraryFilesystemAllowed','deleteAllowed','operatorApprovalProven','independentSourceAuthorityProven'])assert.equal(c[key],false,key);
  assert.ok(c.script.includes('[scriptblock]::Create'));assert.ok(c.script.includes(c.entrySha256));
  assert.ok(!c.script.includes("-File '"));assert.ok(!c.script.includes('Start-Process'));
});
test('candidate refuses historical/current collision, malformed identity, extra or substituted source records',()=>{
  for(const change of [x=>x.expectedMain=OLD,x=>x.operatorSid='S-1-5-18',x=>x.operationId='../escape',
    x=>x.sourceTree='?',x=>x.installed.SourceHead=OLD,x=>x.installed.extra=true,
    x=>x.records.push(x.records[0]),x=>x.records[0].path='scripts/other.ps1',
    x=>x.records[0].path=ENTRY,x=>x.records[0].extra=true,
    x=>x.records[0].contentBase64=Buffer.from('substituted').toString('base64'),x=>x.installed.PendingSha256='']){
    const x=input();change(x);assert.throws(()=>buildEmptyRuntimeVersionQuarantineCandidateV1(x));
  }
});
test('actual generated immutable loader executes captured fixture bytes and refuses changed or oversized input',windows,()=>{
  const dir=mkdtempSync(join(tmpdir(),'stephanos-empty-version-test-'));
  const real=realpathSync(dir),temp=realpathSync(tmpdir());
  assert.ok(real.toLowerCase().startsWith((temp+'\\').toLowerCase()));
  const path=join(dir,'captured-input.json');
  try{
    const x=input(),bytes=Buffer.from("param([switch]$OperatorApproved,[string]$ExpectedMain)\n[Console]::Write('CAPTURED_FIXTURE_ONLY')\n");
    x.records[1]={path:ENTRY,blobSha:blob(bytes),materializedSha256:hash(bytes),contentBase64:bytes.toString('base64')};
    const c=buildEmptyRuntimeVersionQuarantineCandidateV1(x);
    const script=c.script.replaceAll(c.payloadPath,path);
    const run=()=>spawnSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
    writeFileSync(path,c.payloadBytes);
    const valid=run();assert.equal(valid.error,undefined);assert.equal(valid.status,0,valid.stderr);
    assert.equal(valid.stdout,'CAPTURED_FIXTURE_ONLY');
    writeFileSync(path,Buffer.concat([c.payloadBytes,Buffer.from(' ')]));
    const changed=run();assert.notEqual(changed.status,0);assert.match(changed.stderr,/EMPTY_VERSION_INPUT_CHANGED/);
    writeFileSync(path,Buffer.alloc(1048577));
    const oversized=run();assert.notEqual(oversized.status,0);assert.match(oversized.stderr,/EMPTY_VERSION_INPUT_BOUND/);
  }finally{assert.equal(realpathSync(dir),real);rmSync(dir,{recursive:true,force:true});}
});
test('three new files do not change or join the fixed-runtime closure',()=>{
  const closure=JSON.parse(readFileSync(new URL('../shared/agents/sovereignFixedRuntimeSourceClosureV1.json',import.meta.url)));
  assert.equal(closure.paths.length,300);
  for(const p of [FACTORY,ENTRY,FACTORY.replace('.mjs','.test.mjs')])assert.equal(closure.paths.includes(p),false,p);
});
test('actual preparation capture accepts only installed host.exe + pending.json; embedded manifest is a commitment',()=>{
  const dir=mkdtempSync(join(tmpdir(),'stephanos-empty-version-test-'));
  const real=realpathSync(dir),temp=realpathSync(tmpdir());
  assert.ok(real.toLowerCase().startsWith((temp+sep).toLowerCase()));
  const host=Buffer.from('fixture host bytes; never executed');
  const pending={SchemaVersion:'stephanos.fixed-runtime-pending.v1',...installed,HelperSha256:hash(host)};
  delete pending.PendingSha256;
  writeFileSync(join(dir,'host.exe'),host);writeFileSync(join(dir,'pending.json'),JSON.stringify(pending));
  assert.deepEqual(readdirSync(dir).sort(),['host.exe','pending.json']);
  const factoryUrl=new URL('./sovereign-fixed-runtime-empty-version-quarantine-v1.mjs',import.meta.url);
  const factory=readFileSync(factoryUrl,'utf8');
  const prefix='C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1\\'+INSTALLED+'\\';
  const script=`import vm from 'node:vm';import * as fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';
const root=${JSON.stringify(dir)},prefix=${JSON.stringify(prefix)},reads=[];
const map=p=>{if(typeof p!=='string'||!p.startsWith(prefix))throw Error('UNEXPECTED_PATH');return path.join(root,p.slice(prefix.length));};
const m=new vm.SourceTextModule(Buffer.from('${Buffer.from(factory).toString('base64')}','base64').toString()+'\\nexport {captureInstalledCommitment as captureInstalledFixture,physicalTextMatchesGitBlob as matchesFixture};',
 {initializeImportMeta:meta=>meta.url=${JSON.stringify(factoryUrl.href)}});
await m.link(async spec=>{
 let ns;
 if(spec==='node:fs')ns={lstatSync:p=>fs.lstatSync(map(p)),readFileSync:p=>{reads.push(p);return fs.readFileSync(map(p));},writeFileSync:()=>{throw Error('MUTATION');},existsSync:()=>{throw Error('UNEXPECTED_EXISTS');}};
 else if(spec==='node:child_process')ns={spawnSync:()=>{throw Error('UNEXPECTED_EXECUTION');}};
 else if(spec.startsWith('../shared/'))ns={createBattleBridgeMinimalChildEnvironment:()=>{throw Error('UNEXPECTED_ENVIRONMENT');},battleBridgeGitFixedConfigArgs:()=>{throw Error('UNEXPECTED_GIT');},battleBridgeCanonicalRepositoryArgs:()=>{throw Error('UNEXPECTED_GIT');}};
 else ns=await import(spec);
 const s=new vm.SyntheticModule(Object.keys(ns),function(){for(const[k,v]of Object.entries(ns))this.setExport(k,v);});return s;
});
await m.evaluate();const valid=m.namespace.captureInstalledFixture();
const p=JSON.parse(fs.readFileSync(path.join(root,'pending.json')));p.ManifestSha256='?';fs.writeFileSync(path.join(root,'pending.json'),JSON.stringify(p));
let badManifest=false;try{m.namespace.captureInstalledFixture();}catch(e){badManifest=e.message==='EMPTY_VERSION_INSTALLED_COMMITMENT_REQUIRED';}
p.ManifestSha256='${installed.ManifestSha256}';fs.writeFileSync(path.join(root,'pending.json'),JSON.stringify(p));fs.writeFileSync(path.join(root,'host.exe'),'changed');
let badHost=false;try{m.namespace.captureInstalledFixture();}catch(e){badHost=e.message==='EMPTY_VERSION_INSTALLED_COMMITMENT_REQUIRED';}
const canonical=Buffer.from('first\\nsecond\\n');
const matches=[m.namespace.matchesFixture(canonical,canonical),m.namespace.matchesFixture(canonical,Buffer.from('first\\r\\nsecond\\r\\n')),
 m.namespace.matchesFixture(canonical,Buffer.concat([Buffer.from([239,187,191]),canonical])),m.namespace.matchesFixture(canonical,Buffer.from('changed\\n')),
 m.namespace.matchesFixture(canonical,Buffer.from('first\\rsecond\\n'))];
let badUtf8=false;try{m.namespace.matchesFixture(canonical,Buffer.from([255]));}catch{badUtf8=true;}
console.log(JSON.stringify({valid,badManifest,badHost,reads,matches,badUtf8}));`;
  try{
    const r=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],{encoding:'utf8',shell:false,windowsHide:true,timeout:10000,maxBuffer:32768});
    assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
    const out=JSON.parse(r.stdout);
    assert.equal(out.valid.ManifestSha256,pending.ManifestSha256);assert.equal(out.valid.HelperSha256,hash(host));
    assert.equal(out.valid.PendingSha256,hash(Buffer.from(JSON.stringify(pending))));
    assert.equal(out.badManifest,true);assert.equal(out.badHost,true);
    assert.deepEqual(out.matches,[true,true,false,false,false]);assert.equal(out.badUtf8,true);
    assert.equal(factory.includes("'hash-object'"),false,'no materialization filter invocation');
    assert.ok(out.reads.every(p=>p.endsWith('host.exe')||p.endsWith('pending.json')));
    assert.deepEqual(readdirSync(dir).sort(),['host.exe','pending.json']);
  }finally{assert.equal(realpathSync(dir),real);rmSync(dir,{recursive:true,force:true});}
});
test('actual preparation Git reader uses existing canonical argv and sanitized Git authority environment',()=>{
  const factoryUrl=new URL('./sovereign-fixed-runtime-empty-version-quarantine-v1.mjs',import.meta.url);
  const factory=readFileSync(factoryUrl,'utf8');
  const boundaryUrl=new URL('../shared/agents/battleBridgeExecutionBoundaryV1.mjs',import.meta.url);
  const script=`import vm from 'node:vm';
const calls=[];process.env.GIT_CONFIG_GLOBAL='malicious';process.env.GIT_REPLACE_REF_BASE='malicious';process.env.GIT_EXTERNAL_DIFF='malicious';process.env.NODE_OPTIONS='malicious';
const m=new vm.SourceTextModule(Buffer.from('${Buffer.from(factory).toString('base64')}','base64').toString()+'\\nexport {git as gitFixture};',
 {initializeImportMeta:meta=>meta.url=${JSON.stringify(factoryUrl.href)}});
await m.link(async spec=>{
 const ns=spec==='node:child_process'?{spawnSync:(exe,args,options)=>{calls.push({exe,args,env:options.env,shell:options.shell,windowsHide:options.windowsHide,timeout:options.timeout,input:options.input?.toString()});return{status:0,stdout:Buffer.from('a'.repeat(40)+'\\n')};}}:
 spec.startsWith('../shared/')?await import(${JSON.stringify(boundaryUrl.href)}):await import(spec);
 return new vm.SyntheticModule(Object.keys(ns),function(){for(const[k,v]of Object.entries(ns))this.setExport(k,v);});
});await m.evaluate();m.namespace.gitFixture(['rev-parse','HEAD']);m.namespace.gitFixture(['cat-file','blob','a'.repeat(40)]);
console.log(JSON.stringify(calls));`;
  const r=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],
    {encoding:'utf8',shell:false,windowsHide:true,timeout:10000,maxBuffer:32768});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  const calls=JSON.parse(r.stdout),prefix=[...battleBridgeGitFixedConfigArgs(),
    ...battleBridgeCanonicalRepositoryArgs('C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os')];
  assert.equal(calls.length,2);
  for(const c of calls){
    assert.equal(c.exe,'C:\\Program Files\\Git\\cmd\\git.exe');assert.deepEqual(c.args.slice(0,prefix.length),prefix);
    assert.equal(c.shell,false);assert.equal(c.windowsHide,true);assert.equal(c.timeout,5000);
    assert.equal(c.env.GIT_CONFIG_GLOBAL,process.platform==='win32'?'NUL':'/dev/null');
    assert.equal(c.env.GIT_CONFIG_NOSYSTEM,'1');assert.equal(c.env.GIT_NO_REPLACE_OBJECTS,'1');
    assert.equal(c.env.GIT_NO_LAZY_FETCH,'1');assert.equal(c.env.GIT_OPTIONAL_LOCKS,'0');
    for(const k of ['GIT_REPLACE_REF_BASE','GIT_EXTERNAL_DIFF','NODE_OPTIONS'])assert.equal(c.env[k],undefined,k);
  }
  assert.deepEqual(calls[0].args.slice(prefix.length),['rev-parse','HEAD']);
  assert.deepEqual(calls[1].args.slice(prefix.length),['cat-file','blob','a'.repeat(40)]);
});
test('actual PS AST parses; entry has no compiler, deletion, arbitrary DLL selection or runtime/custody API',windows,()=>{
  const r=powershell(`
$commands=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true)|ForEach-Object{$_.GetCommandName()})
$parameters=@($ast.ParamBlock.Parameters|ForEach-Object{$_.Name.VariablePath.UserPath})
@{commands=$commands;parameters=$parameters;functions=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)).Count}|ConvertTo-Json -Compress
`);
  assert.deepEqual(r.parameters,['OperatorApproved','ExpectedMain']);
  for(const c of ['Add-Type','Remove-Item','Move-Item','Start-Process','Invoke-Expression','Set-Acl'])assert.equal(r.commands.includes(c),false,c);
  assert.ok(r.functions>=12);assert.ok(!source.includes('LoadFrom('));assert.ok(!source.includes('recover-after-boot'));
});
test('real fixed in-memory interop proves empty/ADS/reparse/noReplace and retained same-parent identity',windows,()=>{
  const dir=mkdtempSync(join(tmpdir(),'stephanos-empty-version-test-'));
  const real=realpathSync(dir),temp=realpathSync(tmpdir());
  assert.ok(real.toLowerCase().startsWith((temp+'\\').toLowerCase()));
  const old=join(dir,OLD),occupied=join(dir,'pending-compile-'+OLD+'-'+'1'.repeat(32));
  const data=join(dir,'nonempty'),ads=join(dir,'streams'),target=join(dir,'junction-target'),link=join(dir,'junction');
  for(const p of [old,occupied,data,ads,target])mkdirSync(p);
  writeFileSync(join(data,'sentinel'),'preserve');writeFileSync(ads+':held-data','preserve');symlinkSync(target,link,'junction');
  try{
    const config=Buffer.from(JSON.stringify({dir,old,occupied,data,ads,link})).toString('base64');
    const r=powershell(`
$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}'))|ConvertFrom-Json
Initialize-EmptyVersionNative
$result=[ordered]@{}
try{
 $pin=Open-EmptyVersionDirectory $c.old $true
 $parent=Open-EmptyVersionDirectory $c.dir
 try{Assert-EmptyVersionSourceAbsent $parent.handle;$result.presentRefused=$false}catch{$result.presentRefused=$_.Exception.Message -like 'EMPTY_VERSION_SOURCE_*'}
 $before=$pin.info;$security=Get-EmptyVersionSecurity $pin.handle
 Assert-EmptyVersionDirectory $pin.handle;Assert-EmptyVersionNoAlternateStreams $pin.handle
 $result.empty=$true
 try{Assert-EmptyVersionProtectedSecurity $security;$result.unsafeAclRefused=$false}catch{$result.unsafeAclRefused=$_.Exception.Message -like 'EMPTY_VERSION_*'}
 try{Rename-EmptyVersionSameParent $pin.handle ([IO.Path]::GetFileName($c.occupied));$result.noReplace=$false}catch{$result.noReplace=$_.Exception.Message -eq 'EMPTY_VERSION_RENAME_UNPROVEN'}
 $result.sourcePreserved=[IO.Directory]::Exists($c.old)
 [IO.Directory]::Delete($c.occupied,$false)
 $name=[IO.Path]::GetFileName($c.occupied)
 Rename-EmptyVersionSameParent $pin.handle $name
 $after=Get-EmptyVersionInformation $pin.handle $true
 Assert-EmptyVersionDirectory $pin.handle;Assert-EmptyVersionNoAlternateStreams $pin.handle
 $result.sameIdentity=$before.identity -ceq $after.identity
 $result.sameAcl=$security.sha256 -ceq (Get-EmptyVersionSecurity $pin.handle).sha256
 $result.sameCreation=$before.created -ceq $after.created
 $result.oldAbsent=-not [IO.Directory]::Exists($c.old)
 $result.destinationPresent=[IO.Directory]::Exists($c.occupied)
 Assert-EmptyVersionSourceAbsent $parent.handle;$result.absenceProven=$true
 $nonempty=Open-EmptyVersionDirectory $c.data
 try{Assert-EmptyVersionDirectory $nonempty.handle;$result.contentRefused=$false}catch{$result.contentRefused=$_.Exception.Message -eq 'EMPTY_VERSION_DIRECTORY_NOT_EMPTY'}
 $stream=Open-EmptyVersionDirectory $c.ads
 try{Assert-EmptyVersionNoAlternateStreams $stream.handle;$result.adsRefused=$false}catch{$result.adsRefused=$_.Exception.Message -eq 'EMPTY_VERSION_ALTERNATE_STREAM_PRESENT'}
 try{[void](Open-EmptyVersionDirectory $c.link);$result.reparseRefused=$false}catch{$result.reparseRefused=$_.Exception.Message -eq 'EMPTY_VERSION_REDIRECTION_REFUSED'}
 $result.methods=@($script:emptyNative.GetMethods([Reflection.BindingFlags]'Public,Static,DeclaredOnly')|ForEach-Object Name)
}finally{for($i=$script:emptyPins.Count-1;$i -ge 0;$i--){[void](Invoke-EmptyVersionNative 'CloseHandle' @($script:emptyPins[$i]))}}
$result|ConvertTo-Json -Compress
`);
    for(const k of ['empty','unsafeAclRefused','noReplace','sourcePreserved','sameIdentity','sameAcl','sameCreation','oldAbsent','destinationPresent','contentRefused','adsRefused','reparseRefused','presentRefused','absenceProven'])assert.equal(r[k],true,k);
    assert.equal(r.methods.length,11);assert.equal(readFileSync(join(data,'sentinel'),'utf8'),'preserve');
    assert.equal(readFileSync(ads+':held-data','utf8'),'preserve');
  }finally{assert.equal(realpathSync(dir),real);rmSync(dir,{recursive:true,force:true});}
});
test('real protected-security predicate denies unsafe owner, writable user, null DACL and unprotected DACL',windows,()=>{
  const r=powershell(`
$results=@()
foreach($sddl in @('O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)',
 'O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;BU)',
 'O:BUG:BUD:P(A;;FA;;;BU)','O:BAG:BAD:P(A;;FA;;;BU)','O:BAG:BAD:NO_ACCESS_CONTROL','O:BAG:BAD:(A;;FA;;;BA)')){
 try{Assert-EmptyVersionProtectedSecurity ([pscustomobject]@{descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($sddl);sha256='x'});$results+=$true}catch{$results+=$false}
}
ConvertTo-Json -Compress -InputObject $results
`);
  assert.deepEqual(r,[true,true,false,false,false,false]);
});
test('exact two OS ancestors match the installed native sibling-creation policy while protected versions stay strict',windows,()=>{
  const identity=readFileSync(new URL('./windows/SovereignFixedRuntimeIdentityV1.cs',import.meta.url),'utf8');
  const expression=identity.slice(identity.indexOf('static void RuntimeFixedAncestorAclV1'))
    .match(/const FileSystemRights mutation=([^;]+);/)[1]
    .replaceAll('(FileSystemRights)','[long]')
    .replaceAll('FileSystemRights.','[long][Security.AccessControl.FileSystemRights]::').replaceAll('|',' -bor ');
  const r=powershell(`
$nativeMask=${expression}
function Test-FixtureAcl([int]$Mask,[bool]$Ancestor,[string]$Flags=''){
 $access='0x'+$Mask.ToString('x8')
 $sddl='O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;'+$Flags+';'+$access+';;;BU)'
 try{Assert-EmptyVersionProtectedSecurity ([pscustomobject]@{descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($sddl);sha256='x'}) $Ancestor;return $true}catch{return $false}
}
$siblings=@();$protected=@();$mutations=@()
foreach($m in @(2,4,6)){$siblings+=Test-FixtureAcl $m $true;$protected+=Test-FixtureAcl $m $false}
foreach($m in @(0x10,0x40,0x100,0x10000,0x40000,0x80000,0x10000000,0x40000000)){$mutations+=Test-FixtureAcl $m $true}
@{nativeMask=[long]$nativeMask;siblings=$siblings;protected=$protected;mutations=$mutations;inheritOnly=(Test-FixtureAcl 0x40000000 $true 'IO')}|ConvertTo-Json -Compress
`);
  assert.equal(r.nativeMask,0x500D0150);
  assert.deepEqual(r.siblings,[true,true,true]);assert.deepEqual(r.protected,[false,false,false]);
  assert.deepEqual(r.mutations,Array(8).fill(false));assert.equal(r.inheritOnly,true);
});
function runDriverFixture(mode='after') {
  return powershell(`
$script:failureMode='${mode}'
$targetVersion='${OLD}';$installedVersion='${INSTALLED}';$receiptName='empty-version-quarantine-receipt-v1.json'
$sourceRoot='C:\\fixture-source';$protectedRoot='C:\\fixture-protected'
$script:events=[Collections.Generic.List[string]]::new();$script:post=$false;$script:emptyCount=0
$hostBytes=[Text.Encoding]::UTF8.GetBytes('host')
$installed=[pscustomobject]@{SourceHead=$installedVersion;SourceTree=('b'*40);HelperSha256=(Get-EmptyVersionDigest $hostBytes);ManifestSha256=('2'*64);GitClosureSha256=('3'*64)}
$pending=[Text.Encoding]::UTF8.GetBytes((@{SchemaVersion='stephanos.fixed-runtime-pending.v1';SourceHead=$installed.SourceHead;SourceTree=$installed.SourceTree;HelperSha256=$installed.HelperSha256;ManifestSha256=$installed.ManifestSha256;GitClosureSha256=$installed.GitClosureSha256}|ConvertTo-Json -Compress))
$installed|Add-Member PendingSha256 (Get-EmptyVersionDigest $pending)
$bootstrap=[pscustomobject]@{SourceHead=('a'*40);SourceTree=('b'*40);OperationId=('1'*32);OperatorSid='S-1-5-21-1-2-3-1002';Installed=$installed}
function Open-EmptyVersionDirectory($Path,$Rename=$false){
 $id=if($Rename){'source'}elseif($Path.EndsWith($installedVersion)){'installed'}else{'root'}
 $physical='\\\\?\\Volume{fixture}\\'+$Path.Substring(3)
 return [pscustomobject]@{handle=[IntPtr]1;info=[pscustomobject]@{identity=$id;volume=1;path=$physical;created='1';written='2'}}
}
function Get-EmptyVersionSecurity($Handle){return [pscustomobject]@{sha256='acl'}}
function Assert-EmptyVersionProtectedSecurity($Security,$Ancestor=$false){}
function Read-EmptyVersionInstalledLeaf($RootContext,$ParentContext,$Name){
 if($Name -ceq 'pending.json'){return ,$pending}
 if($Name -ceq 'host.exe'){return ,$hostBytes}
 throw 'EMPTY_VERSION_UNEXPECTED_INSTALLED_LEAF'
}
function Read-EmptyVersionPinnedFile($Path,$Maximum,$Protected=$false){
 if($Path.EndsWith('.git\\HEAD')){return ,([Text.Encoding]::UTF8.GetBytes('ref: refs/heads/main'))}
 if($Path.EndsWith('.git\\refs\\heads\\main')){return ,([Text.Encoding]::UTF8.GetBytes($bootstrap.SourceHead))}
 throw 'EMPTY_VERSION_UNEXPECTED_FILE_READ'
}
function Invoke-EmptyVersionNative($Name,$Arguments){if($Name -eq 'GetVolumeInformationByHandleW'){[void]$Arguments[6].Append('NTFS');return $true};throw 'EMPTY_VERSION_UNEXPECTED_NATIVE'}
function Assert-EmptyVersionDirectory($Handle){$script:emptyCount++;if($script:failureMode -eq 'pre' -or ($script:failureMode -eq 'after' -and $script:post)){throw 'EMPTY_VERSION_DIRECTORY_NOT_EMPTY'}}
function Assert-EmptyVersionNoAlternateStreams($Handle){}
function Assert-EmptyVersionSourceAbsent($Handle){}
function Rename-EmptyVersionSameParent($Handle,$Basename){$script:events.Add('rename');$script:post=$true}
function Get-EmptyVersionInformation($Handle,$Directory){return [pscustomobject]@{identity=$(if($script:failureMode -eq 'identity'){'replaced'}else{'source'});volume=1;created='1';path='\\\\?\\Volume{fixture}\\fixture-protected\\pending-compile-${OLD}-'+('1'*32)}}
function Write-EmptyVersionReceipt($Path,$Record,$OperatorSid){$script:events.Add('receipt');if($script:failureMode -eq 'receipt'){throw 'EMPTY_VERSION_RECEIPT_WRITE_UNPROVEN'}}
$result=Invoke-EmptyVersionQuarantine $bootstrap
@{result=$result;events=@($script:events);emptyCount=$script:emptyCount}|ConvertTo-Json -Depth 8 -Compress
`);
}
test('actual mutation driver preserves quarantine and UNKNOWN on post-rename failure; no receipt or retry',windows,()=>{
  const r=runDriverFixture();
  assert.equal(r.result.state,'UNKNOWN');assert.equal(r.result.ok,false);assert.equal(r.result.quarantined,true);
  assert.equal(r.result.mutationAttempted,true);assert.deepEqual(r.events,['rename']);assert.equal(r.emptyCount,2);
  for(const k of ['custodyReleased','sourceLeaseReleased','runtimeQualificationGranted','pcRestartAllowed','deleteAllowed','retryAllowed'])assert.equal(r.result[k],false,k);
});
test('actual driver refuses nonempty before rename and preserves UNKNOWN for changed identity or failed receipt',windows,()=>{
  const pre=runDriverFixture('pre');
  assert.equal(pre.result.state,'BLOCKED');assert.equal(pre.result.mutationAttempted,false);
  assert.equal(pre.result.quarantined,false);assert.deepEqual(pre.events,[]);
  for(const mode of ['identity','receipt']){
    const r=runDriverFixture(mode);
    assert.equal(r.result.state,'UNKNOWN',mode);assert.equal(r.result.ok,false);
    assert.equal(r.result.quarantined,true);assert.equal(r.result.retryAllowed,false);
    assert.deepEqual(r.events,mode==='identity'?['rename']:['rename','receipt']);
  }
  const success=runDriverFixture('success');
  assert.equal(success.result.state,'QUARANTINED');assert.equal(success.result.ok,true);
  assert.equal(success.result.emptyAfterRenameBeforeReceipt,true);
  assert.equal(success.result.privilegedConcurrentWriterExclusionProven,false);
  assert.deepEqual(success.events,['rename','receipt']);
});
test('retained native observations reject unknown statuses and invalid lengths; unsigned FileID words stay exact',windows,()=>{
  const r=powershell(`
$script:responses=@{}
function Invoke-EmptyVersionNative($Name,$Arguments){
 if($Name -eq 'NtCreateFile'){
  if($script:scenario -eq 'notFound'){return [int]-1073741772}
  if($script:scenario -eq 'accessDenied'){return [int]-1073741790}
  return [int]0
 }
 if($script:scenario -eq 'overflow'){return [int]-2147483643}
 if($script:scenario -eq 'length'){
  if([IntPtr]::Size -eq 8){[Runtime.InteropServices.Marshal]::WriteInt64($Arguments[1],[IntPtr]::Size,20000)}else{[Runtime.InteropServices.Marshal]::WriteInt32($Arguments[1],[IntPtr]::Size,20000)}
  return [int]0
 }
 throw 'EMPTY_VERSION_UNEXPECTED_NATIVE'
}
$values=@()
foreach($script:scenario in @('overflow','length')){
 try{Assert-EmptyVersionNoAlternateStreams ([IntPtr]1);$values+=$false}catch{$values+=$_.Exception.Message -like 'EMPTY_VERSION_*'}
}
$buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(4)
try{[Runtime.InteropServices.Marshal]::WriteInt32($buffer,-1);$word=Read-EmptyVersionUInt32 $buffer 0}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
$absence=@()
foreach($script:scenario in @('notFound','accessDenied','unknown')){
 try{Assert-EmptyVersionSourceAbsent ([IntPtr]1);$absence+=$true}catch{$absence+=$false}
}
@{refused=$values;word=$word;absence=$absence}|ConvertTo-Json -Compress
`);
  assert.deepEqual(r.refused,[true,true]);assert.equal(r.word,4294967295);
  assert.deepEqual(r.absence,[true,false,false]);
});
test('actual captured entry refuses missing immutable approval before invoking native or filesystem mutation',windows,()=>{
  const r=spawnSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-Command','& ([scriptblock]::Create([Console]::In.ReadToEnd()))'],
    {input:source,encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:32768});
  assert.equal(r.error,undefined);assert.equal(r.status,2,r.stderr);
  const result=JSON.parse(r.stdout.trim().split('SOVEREIGN_EMPTY_RUNTIME_VERSION_QUARANTINE_V1=')[1]);
  assert.equal(result.reason,'EMPTY_VERSION_IMMUTABLE_APPROVAL_REQUIRED');
  assert.equal(result.mutationAttempted,false);assert.equal(result.quarantined,false);
});
test('actual receipt writer is create-only and durable; fixture substitutes only administrator SID with its ordinary owner',windows,()=>{
  const dir=mkdtempSync(join(tmpdir(),'stephanos-empty-version-test-'));
  const real=realpathSync(dir),temp=realpathSync(tmpdir());
  assert.ok(real.toLowerCase().startsWith((temp+'\\').toLowerCase()));
  const path=join(dir,'empty-version-quarantine-receipt-v1.json');
  try{
    const r=powershell(`
Initialize-EmptyVersionNative
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$node=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Write-EmptyVersionReceipt'},$false)
$body=$node.Extent.Text.Replace('function Write-EmptyVersionReceipt','function Write-FixtureReceipt').Replace("'S-1-5-32-544'",("'"+$sid+"'"))
. ([scriptblock]::Create($body))
$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(path).toString('base64')}'))
$record=[ordered]@{schemaVersion='stephanos.empty-runtime-version-quarantine.v1';state='QUARANTINED';custodyReleased=$false;runtimeQualificationGranted=$false}
$directory=Open-EmptyVersionDirectory ([IO.Path]::GetDirectoryName($path)) $true
Assert-EmptyVersionDirectory $directory.handle;Assert-EmptyVersionNoAlternateStreams $directory.handle
Write-FixtureReceipt $path $record $sid
$bytes=Read-EmptyVersionPinnedFile $path 16384
try{Write-FixtureReceipt $path $record $sid;$collision=$false}catch{$collision=$true}
$security=Get-EmptyVersionSecurity $script:emptyStreams[0].SafeFileHandle.DangerousGetHandle()
@{collision=$collision;owner=$security.descriptor.Owner.Value;sameOwner=$security.descriptor.Owner.Value -ceq $sid;
 protected=[bool]($security.descriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected);
 record=([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json)}|ConvertTo-Json -Depth 4 -Compress
foreach($s in $script:emptyStreams){$s.Dispose()}
for($i=$script:emptyPins.Count-1;$i -ge 0;$i--){[void](Invoke-EmptyVersionNative 'CloseHandle' @($script:emptyPins[$i]))}
`);
    assert.equal(r.collision,true);assert.equal(r.sameOwner,true);assert.equal(r.protected,true);
    assert.equal(r.record.state,'QUARANTINED');assert.equal(r.record.custodyReleased,false);
    assert.equal(r.record.runtimeQualificationGranted,false);
    assert.equal(JSON.parse(readFileSync(path,'utf8')).state,'QUARANTINED');
  }finally{assert.equal(realpathSync(dir),real);rmSync(dir,{recursive:true,force:true});}
});

// Real handle, inheritance and ACL fixtures; only BA is mapped to the ordinary
// fixture owner. Production readers, reference checks and protected bits stay real.
function installedLeafFixture(root, body) {
  const config=Buffer.from(JSON.stringify({root,version:INSTALLED})).toString('base64');
  return powershell(`
$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}'))|ConvertFrom-Json
Initialize-EmptyVersionNative
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach($name in @('Assert-EmptyVersionProtectedSecurity','Assert-EmptyVersionInstalledLeafSecurity')){
 $node=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)
 . ([scriptblock]::Create($node.Extent.Text.Replace("'S-1-5-32-544'",("'"+$sid+"'"))))
}
$protectedRoot=$c.root;$installedVersion=$c.version
function Set-FixtureDirectoryAcl([string]$Path,[bool]$Protected=$true){
 $acl=[Security.AccessControl.DirectorySecurity]::new()
 $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($sid));$acl.SetAccessRuleProtection($Protected,$false)
 foreach($owner in @($sid,'S-1-5-18')){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
   [Security.Principal.SecurityIdentifier]::new($owner),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 }
 $access=[Security.AccessControl.AccessControlSections]::Access
 $existing=[IO.Directory]::GetAccessControl($Path,$access)
 $existing.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($access),$access)
 [IO.Directory]::SetAccessControl($Path,$existing)
}
function Test-FixtureRefusal([scriptblock]$Action){
 try{[void](& $Action);return $false}catch{return $_.Exception.Message -like 'EMPTY_VERSION_*'}
}
$parentPath=[IO.Path]::Combine($protectedRoot,$installedVersion)
Set-FixtureDirectoryAcl $protectedRoot
Set-FixtureDirectoryAcl $parentPath
try{
 ${body}
}finally{
 foreach($stream in $script:emptyStreams){$stream.Dispose()}
 for($i=$script:emptyPins.Count-1;$i -ge 0;$i--){[void](Invoke-EmptyVersionNative 'CloseHandle' @($script:emptyPins[$i]))}
}
`);
}
function withInstalledLeafFixture(run) {
  const dir=mkdtempSync(join(tmpdir(),'stephanos-empty-version-leaf-test-'));
  const real=realpathSync(dir),temp=realpathSync(tmpdir());
  assert.ok(real.toLowerCase().startsWith((temp+sep).toLowerCase()));
  const parent=join(dir,INSTALLED);mkdirSync(parent);
  try{return run(dir,parent);}finally{assert.equal(realpathSync(dir),real);rmSync(dir,{recursive:true,force:true});}
}

test('real installer-shaped inherited leaves require genuine live fixed-parent contexts, including recycled handles',windows,()=>{
  const r=withInstalledLeafFixture(dir=>installedLeafFixture(dir,`
[IO.File]::WriteAllBytes([IO.Path]::Combine($parentPath,'pending.json'),[Text.Encoding]::UTF8.GetBytes('pending fixture'))
[IO.File]::WriteAllBytes([IO.Path]::Combine($parentPath,'host.exe'),[Text.Encoding]::UTF8.GetBytes('host fixture'))
$root=Open-EmptyVersionDirectory $protectedRoot
$parent=Open-EmptyVersionDirectory $parentPath
$bytes=Read-EmptyVersionInstalledLeaf $root $parent 'pending.json'
$hostBytes=Read-EmptyVersionInstalledLeaf $root $parent 'host.exe'
$acl=Get-EmptyVersionSecurity $script:emptyStreams[0].SafeFileHandle.DangerousGetHandle()
$result=[ordered]@{pending=([Text.Encoding]::UTF8.GetString($bytes));host=([Text.Encoding]::UTF8.GetString($hostBytes));
 inherited=(-not [bool]($acl.descriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected))}
$result.strictDirectoryRefusesInherited=Test-FixtureRefusal {Assert-EmptyVersionProtectedSecurity $acl}
$result.forged=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root ([pscustomobject]@{handle=$parent.handle;info=$parent.info}) 'pending.json'}
$result.unpinned=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root $null 'pending.json'}
$wrongPath=[IO.Path]::Combine($protectedRoot,'wrong-parent');[void][IO.Directory]::CreateDirectory($wrongPath);Set-FixtureDirectoryAcl $wrongPath
$wrong=Open-EmptyVersionDirectory $wrongPath
$result.wrongParent=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root $wrong 'pending.json'}
$result.wrongRoot=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $wrong $parent 'pending.json'}
$result.names=@('other','../pending.json','PENDING.JSON','host.exe:extra')|ForEach-Object{
 $name=$_;Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root $parent $name}
}
[void](Invoke-EmptyVersionNative 'CloseHandle' @($parent.handle));[void]$script:emptyPins.Remove($parent.handle)
$result.closed=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root $parent 'pending.json'}
$reopened=Open-EmptyVersionDirectory $parentPath
$result.reopened=([Text.Encoding]::UTF8.GetString((Read-EmptyVersionInstalledLeaf $root $reopened 'pending.json')) -ceq 'pending fixture')
# Deterministically model OS numeric-handle recycling. The closed original
# token must remain invalid even with a live same-directory handle.
$oldRecord=@($script:emptyDirectoryContexts|Where-Object{[object]::ReferenceEquals($_.Context,$parent)})[0]
$oldRecord.Handle=$reopened.handle
$result.recycled=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root $parent 'pending.json'}
$result|ConvertTo-Json -Compress
`));
  assert.equal(r.pending,'pending fixture');assert.equal(r.host,'host fixture');assert.equal(r.inherited,true);
  for(const k of ['strictDirectoryRefusesInherited','forged','unpinned','wrongParent','wrongRoot','closed','reopened','recycled'])assert.equal(r[k],true,k);
  assert.deepEqual(r.names,[true,true,true,true]);
});

test('real leaf ACL, ADS, hardlink, unprotected parent and parent drift remain refusals',windows,()=>{
  const results=[];
  for(const mode of ['unsafeGrant','ads','hardlink','unprotectedParent','parentDrift']){
    results.push(withInstalledLeafFixture((dir,parent)=>{
      if(mode==='ads'){writeFileSync(join(parent,'pending.json'),'pending fixture');writeFileSync(join(parent,'pending.json')+':held-data','preserve');}
      if(mode==='hardlink'){
        writeFileSync(join(parent,'pending.json'),'pending fixture');linkSync(join(parent,'pending.json'),join(parent,'alias'));
      }
      return installedLeafFixture(dir,`
$mode='${mode}'
$file=[IO.Path]::Combine($parentPath,'pending.json')
if($mode -cnotin @('hardlink','ads')){[IO.File]::WriteAllBytes($file,[Text.Encoding]::UTF8.GetBytes('pending fixture'))}
if($mode -ceq 'unsafeGrant'){
 $acl=[IO.File]::GetAccessControl($file)
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
  [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Write','Allow'))
 [IO.File]::SetAccessControl($file,$acl)
}
if($mode -ceq 'unprotectedParent'){Set-FixtureDirectoryAcl $parentPath $false}
$root=Open-EmptyVersionDirectory $protectedRoot;$parent=Open-EmptyVersionDirectory $parentPath
if($mode -ceq 'parentDrift'){
 $node=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-EmptyVersionInstalledFileStreams'},$false)
 . ([scriptblock]::Create($node.Extent.Text.Replace('function Assert-EmptyVersionInstalledFileStreams','function Invoke-FixtureFileStreams')))
 $script:streamCalls=0
 function Assert-EmptyVersionInstalledFileStreams([IntPtr]$Handle,[long]$ExpectedLength){
  Invoke-FixtureFileStreams $Handle $ExpectedLength
  $script:streamCalls++
  if($script:streamCalls -eq 2){
   $acl=[IO.Directory]::GetAccessControl($parentPath)
   $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'ReadAndExecute','Allow'))
   [IO.Directory]::SetAccessControl($parentPath,$acl)
  }
 }
}
$refused=Test-FixtureRefusal {Read-EmptyVersionInstalledLeaf $root $parent 'pending.json'}
@{mode=$mode;refused=$refused;preserved=[IO.File]::Exists($file);driftAfterRead=($script:streamCalls -eq 2)}|ConvertTo-Json -Compress
`);
    }));
  }
  for(const r of results){assert.equal(r.refused,true,r.mode);assert.equal(r.preserved,true,r.mode);}
  assert.equal(results.find(x=>x.mode==='parentDrift').driftAfterRead,true);
});

test('inherited leaf policy retains complete owner and ACL validation without granting directory inheritance',windows,()=>{
  const r=powershell(`
$values=@();$directory=@()
foreach($sddl in @('O:BAG:BAD:(A;;FA;;;SY)(A;;FA;;;BA)',
 'O:SYG:SYD:(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;BU)',
 'O:BUG:BUD:(A;;FA;;;BU)','O:BAG:BAD:(A;;FA;;;BU)',
 'O:BAG:BAD:NO_ACCESS_CONTROL','O:BAG:BAD:(A;ID;FW;;;BU)',
 'O:BAG:BAD:(XA;;FA;;;BA;(Exists @User.Department))')){
 try{$security=[pscustomobject]@{descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($sddl);sha256='x'};
  Assert-EmptyVersionInstalledLeafSecurity $security;$values+=$true}catch{$values+=$false}
 try{Assert-EmptyVersionProtectedSecurity $security;$directory+=$true}catch{$directory+=$false}
}
@{leaf=$values;directory=$directory}|ConvertTo-Json -Compress
`);
  assert.deepEqual(r.leaf,[true,true,false,false,false,false,false]);assert.deepEqual(r.directory,Array(7).fill(false));
});

test('actual reparse installed-parent route is refused before an inherited leaf can be read',windows,()=>{
  const r=withInstalledLeafFixture((dir,parent)=>{
    const target=join(dir,'junction-target');mkdirSync(target);writeFileSync(join(target,'pending.json'),'preserve');
    rmdirSync(parent);symlinkSync(target,parent,'junction');
    const result=installedLeafFixture(dir,`
[IO.File]::WriteAllBytes([IO.Path]::Combine($parentPath,'host.exe'),[Text.Encoding]::UTF8.GetBytes('host fixture'))
$root=Open-EmptyVersionDirectory $protectedRoot
$refused=Test-FixtureRefusal {$parent=Open-EmptyVersionDirectory $parentPath;Read-EmptyVersionInstalledLeaf $root $parent 'pending.json'}
@{refused=$refused}|ConvertTo-Json -Compress
`);
    assert.equal(readFileSync(join(target,'pending.json'),'utf8'),'preserve');return result;
  });
  assert.equal(r.refused,true);
});
