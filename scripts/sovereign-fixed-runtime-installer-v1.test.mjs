import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FIXED_RUNTIME_SOURCE_PATHS_V1,buildFixedRuntimeInstallerCandidateV1} from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
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
  return {path,contentBase64:bytes.toString('base64'),blobSha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),materializedSha256:createHash('sha256').update(bytes).digest('hex')};
 });
 const input={expectedMain:'a'.repeat(40),sourceTree:'b'.repeat(40),operatorSid:'S-1-5-21-1-2-3-1001',records};
 const candidate=buildFixedRuntimeInstallerCandidateV1(input);
 assert.ok(candidate.encodedCommand.length<30000);
 assert.equal(candidate.independentSourceAuthorityProven,false);assert.equal(candidate.operatorApprovalProven,false);
 assert.equal(candidate.installed,false);assert.equal(candidate.custodyReleased,false);
 assert.equal(createHash('sha256').update(candidate.payloadBytes).digest('hex'),candidate.payloadSha256);
 assert.match(candidate.payloadPath,/StephanosFixedRuntimeInstall-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json$/);
 const payload=JSON.parse(candidate.payloadBytes.toString('utf8'));
 assert.equal(payload.Records[0].MaterializedSha256,records.find(row=>row.path===payload.Records[0].Path).materializedSha256);
 const crlfBound=records.map((row,i)=>i===0?{...row,materializedSha256:'e'.repeat(64)}:row);
 const crlfCandidate=buildFixedRuntimeInstallerCandidateV1({...input,records:crlfBound});
 assert.equal(JSON.parse(crlfCandidate.payloadBytes.toString('utf8')).Records.find(row=>row.Path===records[0].path).MaterializedSha256,'e'.repeat(64));
 assert.equal(candidate.environment.NODE_OPTIONS,undefined);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:[...records,records[0]]}),/EXACT_SOURCE_REQUIRED/);
 const badMaterialized=records.map((row,i)=>i===0?{...row,materializedSha256:'bad'}:row);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:badMaterialized}),/SOURCE_RECORD_INVALID/);
 const corrupt=records.map((row,i)=>i===0?{...row,blobSha:'f'.repeat(40)}:row);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:corrupt}),/SOURCE_BLOB_MISMATCH/);
 const rebound=records.map((row,i)=>i===0?{...row,path:'scripts/../../outside.mjs'}:row);
 assert.throws(()=>buildFixedRuntimeInstallerCandidateV1({...input,records:rebound}),/SOURCE_RECORD_INVALID/);
});


test('fixed manifest covers current static and literal dynamic imports plus custody runtime-read inputs',()=>{
 const output=execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000});
 const result=JSON.parse(output);assert.ok(result.memberCount<=258);
  assert.equal(result.memberCount,258);
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-ignition-diagnosis.mjs'));
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-persistent-runtime-repair.mjs'));assert.deepEqual(result.missing,[]);
 assert.deepEqual(result.bare,[]);assert.equal(result.repositoryModulesEvaluated,false);
});


test('custody design source remains strict UTF8 for the independent reviewer',()=>{
 const bytes=readFileSync(new URL('../docs/architecture/sovereign-fixed-runtime-job-custody-v1.md',import.meta.url));
 assert.doesNotThrow(()=>new TextDecoder('utf-8',{fatal:true}).decode(bytes));
});
