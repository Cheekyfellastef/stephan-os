import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {FIXED_RUNTIME_SOURCE_PATHS_V1,FIXED_RUNTIME_SOURCE_MEMBER_LIMIT_V1,buildFixedRuntimeInstallerCandidateV1,fixedRuntimeGitClosureSha256V1} from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
  assert.equal(result.memberCount,266);
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-ignition-diagnosis.mjs'));
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-persistent-runtime-repair.mjs'));assert.deepEqual(result.missing,[]);
 assert.deepEqual(result.bare,[]);assert.equal(result.repositoryModulesEvaluated,false);
});


test('custody design source remains strict UTF8 for the independent reviewer',()=>{
 const bytes=readFileSync(new URL('../docs/architecture/sovereign-fixed-runtime-job-custody-v1.md',import.meta.url));
 assert.doesNotThrow(()=>new TextDecoder('utf-8',{fatal:true}).decode(bytes));
});

test('actual protected installer rejects unsafe packed or loose main refs in isolated Windows fixture',
  {skip:process.platform!=='win32',timeout:30000},()=>{
  const source=readFileSync(path,'utf8');
  const physicalStart=source.indexOf('function Assert-Physical(');
  const physicalEnd=source.indexOf('function Assert-Protected(',physicalStart);
  const fixedStart=source.indexOf('function Test-FixedRefPresent(');
  const fixedEnd=source.indexOf('function Get-Digest(',fixedStart);
  assert.ok(physicalStart>0 && physicalEnd>physicalStart && fixedStart>0 && fixedEnd>fixedStart);
  const physical=source.slice(physicalStart,physicalEnd),refs=source.slice(fixedStart,fixedEnd);
  assert.ok(refs.includes('function Assert-FixedGitRef('));
  const root=mkdtempSync(join(tmpdir(),'stph-fixed-ref-'));
  const driver=join(root,'ref-probe.ps1');
  const script=String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$sourceRoot=[IO.Path]::Combine(__ROOT__,'repository')
[void][IO.Directory]::CreateDirectory($sourceRoot)
[void][IO.Directory]::CreateDirectory([IO.Path]::Combine($sourceRoot,'.git'))
$handles=[Collections.Generic.List[IO.FileStream]]::new()
__PHYSICAL__
__REFS__
function Close-Pins {foreach($handle in $handles){$handle.Dispose()};$handles.Clear()}
$script:count=0
function Invoke-FixedCase([bool]$allowed,[scriptblock]$action){
 $accepted=$false
 try{& $action;$accepted=$true}catch{if($allowed){throw}}finally{Close-Pins}
 if($accepted -ne $allowed){throw 'FIXED_INSTALL_PACKED_CASE_UNEXPECTED'}
 $script:count++
}
$a='a'*40;$b='b'*40;$nl=[char]10;$utf8=[Text.UTF8Encoding]::new($false,$true)
$packed=[IO.Path]::Combine($sourceRoot,'.git','packed-refs')
$good=$a+' refs/heads/main'+$nl+$a+' refs/remotes/origin/main'+$nl
[IO.File]::WriteAllText($packed,$good,$utf8)
Invoke-FixedCase $true {Assert-FixedGitRef 'refs/heads/main' $a}
Invoke-FixedCase $true {Assert-FixedGitRef 'refs/remotes/origin/main' $a}
[IO.File]::WriteAllText($packed,('# pack-refs with: peeled'+$nl+$b+' refs/tags/demo'+$nl+'^'+$b+$nl+$good),$utf8)
Invoke-FixedCase $true {Assert-FixedGitRef 'refs/heads/main' $a}
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/heads/main' $b}
[IO.File]::WriteAllText($packed,($good+$a+' refs/heads/main'+$nl),$utf8)
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/heads/main' $a}
[IO.File]::WriteAllText($packed,($a+' refs/heads/main'+$nl),$utf8)
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/remotes/origin/main' $a}
[IO.File]::WriteAllText($packed,($good+'bad-record'+$nl),$utf8)
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/heads/main' $a}
[IO.File]::WriteAllText($packed,($good+$a+' refs/heads/../main'+$nl),$utf8)
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/heads/main' $a}
[IO.File]::WriteAllBytes($packed,[byte[]]::new(1048577))
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/heads/main' $a}
$loose=[IO.Path]::Combine($sourceRoot,'.git','refs','heads','main')
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($loose))
[IO.File]::WriteAllText($loose,($a+$nl),$utf8)
[IO.File]::WriteAllText($packed,($b+' refs/heads/main'+$nl),$utf8)
Invoke-FixedCase $true {Assert-FixedGitRef 'refs/heads/main' $a}
[IO.File]::WriteAllText($loose,($b+$nl),$utf8)
Invoke-FixedCase $false {Assert-FixedGitRef 'refs/heads/main' $a}
if($script:count -ne 11){throw 'FIXED_INSTALL_PACKED_TEST_COUNT'}
[Console]::WriteLine('FIXED_INSTALL_PACKED_CASES_PASS_'+$script:count)
`;
  const escaped="'"+root.replaceAll("'","''")+"'";
  const driverBody=script.replace('__ROOT__',()=>escaped)
    .replace('__PHYSICAL__',()=>physical)
    .replace('__REFS__',()=>refs);
  writeFileSync(driver,driverBody,{encoding:'utf8',flag:'wx'});
  const bootstrap="$ErrorActionPreference='Stop';$s=[IO.File]::ReadAllText('"
    +driver.replaceAll("'","''")+"');& ([scriptblock]::Create($s))";
  let output;
  try{
    output=execFileSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
      Buffer.from(bootstrap,'utf16le').toString('base64')],
      {encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:8192});
  }finally{rmSync(root,{recursive:true,force:true});}
  assert.equal(output.trim(),'FIXED_INSTALL_PACKED_CASES_PASS_11');
});
