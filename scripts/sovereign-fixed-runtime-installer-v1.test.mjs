import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FIXED_RUNTIME_SOURCE_PATHS_V1,FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1,buildFixedRuntimeInstallerCandidateV1,fixedRuntimeGitClosureSha256V1} from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const path=fileURLToPath(new URL('./windows/install-sovereign-fixed-runtime-v1.ps1',import.meta.url));
const literal=s=>"'"+s.replaceAll("'","''")+"'";
test('pending installer parses and direct invocation refuses before installation', {skip:process.platform!=='win32'},()=>{
 const script=String.raw`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$source=[IO.File]::ReadAllText(__PATH__)
[void][Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count -ne 0){throw ('INSTALLER_PARSE_FAILED:'+($errors.Message -join '|'))}
try{& ([scriptblock]::Create($source)) -OperatorApproved -ExpectedMain ('a'*40);throw 'DIRECT_INSTALL_ACCEPTED'}
catch{if($_.Exception.Message -cne 'FIXED_INSTALL_IMMUTABLE_APPROVAL_REQUIRED'){throw}}
[Console]::Write('FIXED_INSTALL_REFUSED_BEFORE_MUTATION')`.replace('__PATH__',literal(path));
 const output=execFileSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(output,'FIXED_INSTALL_REFUSED_BEFORE_MUTATION');
});


test('fixed installation candidate preserves exact blobs and stays below the existing command budget without granting authority',()=>{
 const records=FIXED_RUNTIME_SOURCE_PATHS_V1.map(path=>{
  const bytes=readFileSync(new URL('../'+path,import.meta.url));
  return {path,contentBase64:bytes.toString('base64'),
    blobSha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),
    materializedSha256:createHash('sha256').update(bytes).digest('hex')};
 });
 const input={expectedMain:'a'.repeat(40),sourceTree:'b'.repeat(40),operatorSid:'S-1-5-21-1-2-3-1001',records};
 const candidate=buildFixedRuntimeInstallerCandidateV1(input);
 assert.ok(candidate.encodedCommand.length<30000);
 assert.equal(candidate.independentSourceAuthorityProven,false);assert.equal(candidate.operatorApprovalProven,false);
 assert.equal(candidate.installed,false);assert.equal(candidate.custodyReleased,false);
 assert.equal(createHash('sha256').update(candidate.payloadBytes).digest('hex'),candidate.payloadSha256);
 const payload=JSON.parse(candidate.payloadBytes.toString('utf8'));
 assert.equal(payload.Records.length,records.length);
 assert.ok(payload.Records.every(row=>/^[a-f0-9]{64}$/.test(row.MaterializedSha256)));
 for(const row of payload.Records) {
  assert.equal(row.GitBlobSha,records.find(record=>record.path===row.Path).blobSha);
  assert.equal(row.GitMode,'100644');
 }
 assert.equal(fixedRuntimeGitClosureSha256V1(payload.Records),
  fixedRuntimeGitClosureSha256V1([...payload.Records].reverse()));
 assert.throws(()=>fixedRuntimeGitClosureSha256V1(payload.Records.map((row,i)=>i===0?{...row,GitBlobSha:''}:row)),
  /FIXED_RUNTIME_GIT_CLOSURE_UNPROVEN/);
 assert.match(candidate.payloadPath,/StephanosFixedRuntimeInstall-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json$/);
 assert.equal(candidate.environment.NODE_OPTIONS,undefined);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:[...records,records[0]]}),/EXACT_SOURCE_REQUIRED/);
 const corrupt=records.map((row,i)=>i===0?{...row,blobSha:'f'.repeat(40)}:row);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:corrupt}),/SOURCE_BLOB_MISMATCH/);
 const rebound=records.map((row,i)=>i===0?{...row,path:'scripts/../../outside.mjs'}:row);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:rebound}),/SOURCE_RECORD_INVALID/);
 const badMaterialized=records.map((row,i)=>i===0?{...row,materializedSha256:'bad'}:row);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:badMaterialized}),/SOURCE_RECORD_INVALID/);
 const legacy=records.map(({materializedSha256,...row})=>row);
 const legacyCandidate=buildFixedRuntimeInstallerCandidateV1({...input,records:legacy});
 const legacyPayload=JSON.parse(legacyCandidate.payloadBytes.toString('utf8'));
 assert.ok(legacyPayload.Records.every(row=>row.MaterializedSha256===row.Sha256));
 assert.equal(fixedRuntimeGitClosureSha256V1(legacyPayload.Records),fixedRuntimeGitClosureSha256V1(payload.Records));
});


test('fixed manifest covers current static and literal dynamic imports plus custody runtime-read inputs',()=>{
 const output=execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000});
 const result=JSON.parse(output);assert.ok(result.memberCount<=FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1);
  assert.equal(result.memberCount,300);
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-ignition-diagnosis.mjs'));
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-persistent-runtime-repair.mjs'));assert.deepEqual(result.missing,[]);
 assert.deepEqual(result.bare,[]);assert.equal(result.repositoryModulesEvaluated,false);
});


test('custody design source remains strict UTF8 for the independent reviewer',()=>{
 const bytes=readFileSync(new URL('../docs/architecture/sovereign-fixed-runtime-job-custody-v1.md',import.meta.url));
 assert.doesNotThrow(()=>new TextDecoder('utf-8',{fatal:true}).decode(bytes));
});


function boundedReadCandidateFixture() {
 const entry="param([switch]$OperatorApproved,[string]$ExpectedMain)\n[Console]::WriteLine('FIXED_BOOTSTRAP_FIXTURE_ENTRY')";
 const records=FIXED_RUNTIME_SOURCE_PATHS_V1.map(member=>{
  const bytes=Buffer.from(member==='scripts/windows/install-sovereign-fixed-runtime-v1.ps1'?entry:'fixture:'+member);
  return {path:member,contentBase64:bytes.toString('base64'),
   blobSha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),
   materializedSha256:createHash('sha256').update(bytes).digest('hex')};
 });
 return buildFixedRuntimeInstallerCandidateV1({expectedMain:'a'.repeat(40),sourceTree:'b'.repeat(40),
  operatorSid:'S-1-5-21-1-2-3-1001',records});
}

function runBoundedWindowsFixture(directory,script) {
 const scriptPath=join(directory,'fixture.ps1');
 writeFileSync(scriptPath,script,'utf8');
 return execFileSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath],
  {encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:65536}).trim();
}

test('actual installer and generated bootstrap readers bound open files, preserve byte arrays and refuse hostile streams',
 {skip:process.platform!=='win32'},()=>{
 const directory=mkdtempSync(join(tmpdir(),'fixed-installer-bounds-'));
 try{
  const bootstrapPath=join(directory,'generated-bootstrap.ps1');
  writeFileSync(bootstrapPath,boundedReadCandidateFixture().script,'utf8');
  const script=String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=__ROOT__
$tokens=$null;$errors=$null
$installerAst=[Management.Automation.Language.Parser]::ParseFile(__INSTALLER__,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'INSTALLER_PARSE'}
foreach($name in @('Read-FixedInstallerBoundedBytesV1','Get-Digest','Assert-Physical')){
 $nodes=@($installerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($nodes.Count -ne 1){throw 'INSTALLER_FUNCTION_MISSING'}
 . ([scriptblock]::Create($nodes[0].Extent.Text))
}
$bootstrapAst=[Management.Automation.Language.Parser]::ParseFile(__BOOTSTRAP__,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'BOOTSTRAP_PARSE'}
$nodes=@($bootstrapAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Read-FixedBootstrapBoundedBytesV1'},$true))
if($nodes.Count -ne 1){throw 'BOOTSTRAP_FUNCTION_MISSING'}
. ([scriptblock]::Create($nodes[0].Extent.Text))
function Require([bool]$condition,[string]$label){if(-not $condition){throw ('BOUND_ASSERT:'+ $label)}}
function Expect-Hold([scriptblock]$action,[string]$code){
 $held=$false
 try{& $action | Out-Null}catch{if($_.Exception.Message -cne $code){throw};$held=$true}
 Require $held ('missing '+$code)
}
Add-Type -TypeDefinition @'
using System;
using System.IO;
public sealed class FixedInstallerHostileStream : MemoryStream {
 public long Declared, Final = -2;
 public bool LengthUnavailable;
 public int Reads, Sentinels, LengthCalls;
 public FixedInstallerHostileStream(byte[] body,long declared) : base(body) { Declared=declared; }
 public override long Length {
  get { LengthCalls++; if(LengthUnavailable) throw new IOException("unavailable");
   return LengthCalls>1 && Final!=-2 ? Final : Declared; }
 }
 public override int Read(byte[] buffer,int offset,int count) { Reads++; return base.Read(buffer,offset,count); }
 public override int ReadByte() { Sentinels++; return base.ReadByte(); }
}
'@
$checked=0
foreach($kind in @('installer','bootstrap')){
 $maximum=if($kind -eq 'installer'){2097152}else{16777216}
 $code=if($kind -eq 'installer'){'FIXED_INSTALL_CANONICAL_BYTES_CHANGED'}else{'FIXED_BOOTSTRAP_INPUT_BOUND'}
 function Read-Current([IO.Stream]$stream){
  if($kind -eq 'installer'){return ,(Read-FixedInstallerBoundedBytesV1 $stream $maximum $code)}
  return ,(Read-FixedBootstrapBoundedBytesV1 $stream)
 }
 $disk=[IO.Path]::Combine($root,$kind+'.bin')
 foreach($size in @(0,17,$maximum)){
  $writer=[IO.File]::Open($disk,'Create','Write','None')
  try{$writer.SetLength($size)}finally{$writer.Dispose()}
  $stream=[IO.File]::Open($disk,'Open','Read','Read')
  try{
   $result=Read-Current $stream
   Require ($result -is [byte[]]) ($kind+' byte-array')
   Require ($result.Length -eq $size) ($kind+' exact bytes')
   Require $stream.CanRead ($kind+' caller handle retained')
   Require ($stream.Position -eq $size) ($kind+' exact position')
   $checked++
  }finally{$stream.Dispose()}
 }
 $writer=[IO.File]::Open($disk,'Create','Write','None')
 try{$writer.SetLength($maximum+1)}finally{$writer.Dispose()}
 $stream=[IO.File]::Open($disk,'Open','Read','Read')
 try{
  Expect-Hold { $null=Read-Current $stream } $code
  Require ($stream.Position -eq 0) ($kind+' oversized file not read')
  Require $stream.CanRead ($kind+' failed handle retained')
  $checked++
 }finally{$stream.Dispose()}
 foreach($declared in @(-1,($maximum+1))){
  $stream=[FixedInstallerHostileStream]::new([byte[]](1,2,3),$declared)
  try{
   Expect-Hold {$null=Read-Current $stream} $code
   Require ($stream.Reads -eq 0 -and $stream.Sentinels -eq 0) ($kind+' invalid length not read')
   $checked++
  }finally{$stream.Dispose()}
 }
 $stream=[FixedInstallerHostileStream]::new([byte[]](1,2,3),3);$stream.LengthUnavailable=$true
 try{Expect-Hold {$null=Read-Current $stream} $code;Require ($stream.Reads -eq 0) 'unavailable not read';$checked++}finally{$stream.Dispose()}
 $stream=[FixedInstallerHostileStream]::new([byte[]](1,2),3)
 try{Expect-Hold {$null=Read-Current $stream} $code;Require ($stream.Reads -ge 2 -and $stream.Sentinels -eq 0) 'short read refused';$checked++}finally{$stream.Dispose()}
 $stream=[FixedInstallerHostileStream]::new([byte[]](1,2,3,4),2)
 try{Expect-Hold {$null=Read-Current $stream} $code;Require ($stream.Position -eq 3 -and $stream.Sentinels -eq 1) 'one refusal byte only';$checked++}finally{$stream.Dispose()}
 $stream=[FixedInstallerHostileStream]::new([byte[]](1,2,3),3);$stream.Final=4
 try{Expect-Hold {$null=Read-Current $stream} $code;Require ($stream.Sentinels -eq 1 -and $stream.LengthCalls -eq 2) 'post-read length drift';$checked++}finally{$stream.Dispose()}
 $stream=[FixedInstallerHostileStream]::new([byte[]](1,2,3),3);$stream.Position=1
 try{Expect-Hold {$null=Read-Current $stream} $code;Require ($stream.Reads -eq 0 -and $stream.Sentinels -eq 0) 'nonzero start refused';$checked++}finally{$stream.Dispose()}
}
$sourceNodes=@($installerAst.FindAll({param($node) $node -is [Management.Automation.Language.ForEachStatementAst] -and $node.Variable.VariablePath.UserPath -ceq 'key'},$true))
$refNodes=@($installerAst.FindAll({param($node) $node -is [Management.Automation.Language.ForEachStatementAst] -and $node.Variable.VariablePath.UserPath -ceq 'pair'},$true))
Require ($sourceNodes.Count -eq 1 -and $refNodes.Count -eq 1) 'exact production loops selected'
$sourceLoop=[scriptblock]::Create($sourceNodes[0].Extent.Text)
$refLoop=[scriptblock]::Create($refNodes[0].Extent.Text)
$sourceRoot=[IO.Path]::Combine($root,'sources')
[void][IO.Directory]::CreateDirectory([IO.Path]::Combine($sourceRoot,'scripts'))
$records=@{}
$lf=[Text.Encoding]::UTF8.GetBytes((('x'+[char]10)*699050))
$crlf=[Text.Encoding]::UTF8.GetBytes((('x'+[char]13+[char]10)*699050))
$gitTotal=0
for($index=0;$index -lt 6;$index++){
 $key='scripts/member-'+$index+'.mjs'
 $body=$crlf
 if($index -eq 4){$body=[byte[]](1,2,3,4,5,6,7,8)}elseif($index -eq 5){$body=[byte[]](9)}
 [IO.File]::WriteAllBytes([IO.Path]::Combine($sourceRoot,$key),$body)
 $gitBytes=$body
 if($index -lt 4){$gitBytes=$lf}
 $records[$key]=[pscustomobject]@{Path=$key;GitBlobSha=('a'*40);GitMode='100644';Sha256=(Get-Digest $gitBytes);MaterializedSha256=(Get-Digest $body)}
 if($index -lt 5){$gitTotal+=$gitBytes.Length}
}
foreach($count in @(5,6)){
 $handles=[Collections.Generic.List[IO.FileStream]]::new()
 $manifest=[ordered]@{Files=@()};$closureText='';[long]$materializedTotal=0
 # Deliberately different from physical bytes, as in an LF -> CRLF checkout.
 $total=$gitTotal
 [string[]]$orderedPaths=@(0..($count-1)|ForEach-Object{'scripts/member-'+$_+'.mjs'})
 try{
  if($count -eq 5){. $sourceLoop}
  else{
   $held=$false
   try{. $sourceLoop}catch{if($_.Exception.Message -cne 'FIXED_INSTALL_CANONICAL_BYTES_CHANGED'){throw};$held=$true}
   Require $held 'aggregate overlimit refused'
   Require ($handles.Count -eq 6 -and $handles[5].Position -eq 0) 'aggregate offending stream not read'
  }
  Require ($materializedTotal -eq 8388608 -and $total -lt $materializedTotal) 'independent materialized budget'
  $checked++
 }finally{foreach($handle in $handles){$handle.Dispose()}}
}
[void][IO.Directory]::CreateDirectory([IO.Path]::Combine($sourceRoot,'.git/refs/heads'))
$ExpectedMain='a'*40
$headPath=[IO.Path]::Combine($sourceRoot,'.git/HEAD')
$mainPath=[IO.Path]::Combine($sourceRoot,'.git/refs/heads/main')
foreach($variant in @('lf','crlf','utf8-bom','utf16-bom','exact-limit','oversized-head','oversized-main')){
 $ending=if($variant -eq 'crlf'){[string][char]13+[char]10}else{[string][char]10}
 $encoding=if($variant -eq 'utf16-bom'){[Text.Encoding]::Unicode}else{[Text.UTF8Encoding]::new($variant -eq 'utf8-bom')}
 [IO.File]::WriteAllText($headPath,'ref: refs/heads/main'+$ending,$encoding)
 [IO.File]::WriteAllText($mainPath,$ExpectedMain+$ending,$encoding)
 if($variant -eq 'exact-limit'){$prefix='ref: refs/heads/main';[IO.File]::WriteAllText($headPath,$prefix+(' '*(4096-$prefix.Length)),[Text.UTF8Encoding]::new($false))}
 if($variant -like 'oversized-*'){
  $large=if($variant -eq 'oversized-head'){$headPath}else{$mainPath}
  $writer=[IO.File]::Open($large,'Open','Write','None');try{$writer.SetLength(4097)}finally{$writer.Dispose()}
 }
 $handles=[Collections.Generic.List[IO.FileStream]]::new()
 try{
  if($variant -like 'oversized-*'){
   $held=$false;try{. $refLoop}catch{if($_.Exception.Message -cne 'FIXED_INSTALL_REF_CHANGED'){throw};$held=$true}
   Require $held 'ref cap refused'
   Require ($handles[$handles.Count-1].Position -eq 0) 'oversized ref not read'
  }else{. $refLoop;Require ($handles.Count -eq 2) 'both refs verified'}
  $checked++
 }finally{foreach($handle in $handles){$handle.Dispose()}}
}
[Console]::WriteLine('FIXED_READ_BOUNDS_OK='+$checked)
`.replace('__ROOT__',literal(directory)).replace('__INSTALLER__',literal(path)).replace('__BOOTSTRAP__',literal(bootstrapPath));
  assert.equal(runBoundedWindowsFixture(directory,script),'FIXED_READ_BOUNDS_OK=31');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('factory-generated bootstrap authenticates bounded input and refuses oversized or changed payload without installer authority',
 {skip:process.platform!=='win32'},()=>{
 const directory=mkdtempSync(join(tmpdir(),'fixed-bootstrap-input-'));
 try{
  const candidate=boundedReadCandidateFixture();
  const payloadPath=join(directory,'payload.json');
  const generatedPath=join(directory,'generated-bootstrap.ps1');
  const originalLiteral=literal(candidate.payloadPath);
  assert.equal(candidate.script.split(originalLiteral).length,2);
  // Only the fixture's data location changes; execute the factory's real read,
  // digest and entry-authentication body, with a harmless authenticated entry.
  writeFileSync(generatedPath,candidate.script.replace(originalLiteral,literal(payloadPath)),'utf8');
  const wrapper="$ErrorActionPreference='Stop'\ntry { & "+literal(generatedPath)+" } catch { [Console]::WriteLine('BLOCKED='+$_.Exception.Message) }";
  writeFileSync(payloadPath,candidate.payloadBytes);
  assert.equal(runBoundedWindowsFixture(directory,wrapper),'FIXED_BOOTSTRAP_FIXTURE_ENTRY');
  writeFileSync(payloadPath,candidate.payloadBytes.subarray(0,candidate.payloadBytes.length-1));
  assert.equal(runBoundedWindowsFixture(directory,wrapper),'BLOCKED=FIXED_BOOTSTRAP_INPUT_CHANGED');
  const changed=Buffer.from(candidate.payloadBytes);changed[0]^=1;
  writeFileSync(payloadPath,changed);
  assert.equal(runBoundedWindowsFixture(directory,wrapper),'BLOCKED=FIXED_BOOTSTRAP_INPUT_CHANGED');
  writeFileSync(payloadPath,Buffer.alloc(16777217));
  assert.equal(runBoundedWindowsFixture(directory,wrapper),'BLOCKED=FIXED_BOOTSTRAP_INPUT_UNSAFE');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
