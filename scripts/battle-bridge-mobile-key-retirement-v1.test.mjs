import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readMobileInstallerNativeSourceV1,MOBILE_INSTALL_NATIVE_SOURCE_PATHS_V1} from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';
import {makeFixedRuntimeSourceProofFixtureV1} from './fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs';
import {prepareMobileKeyRetirementReviewV1,MOBILE_KEY_RETIREMENT_INPUT_V1} from './battle-bridge-mobile-key-retirement-review-v1.mjs';
const retirement='scripts/windows/retire-battle-bridge-mobile-key-v1.ps1',preservation='scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const paths=[...MOBILE_INSTALL_NATIVE_SOURCE_PATHS_V1,'shared/agents/sovereignMobileInstallerNativeClosureV1.json',preservation,retirement];
const files=paths.map(path=>({path,content:Buffer.from(source(path))}));
const proof=makeFixedRuntimeSourceProofFixtureV1({files});
const input={schemaVersion:MOBILE_KEY_RETIREMENT_INPUT_V1,sourceInput:{schemaVersion:'stephanos.fixed-runtime-source-package-input.v1',repository:'Cheekyfellastef/stephan-os',
 commit:{sha:proof.head,contentBase64:proof.commit.bytes.toString('base64')},trees:[...proof.trees].map(([sha,b])=>({sha,contentBase64:b.toString('base64')})),
 records:files.map(row=>({path:row.path,blobSha:createHash('sha1').update('blob '+row.content.length+'\0').update(row.content).digest('hex'),contentBase64:row.content.toString('base64')}))},
 expectedMain:proof.head,sourceTree:proof.tree,operatorSid:'S-1-5-21-1-2-3-1001',machineHash:'a'.repeat(64),mode:'Observe',fingerprint:null,keySha256:'b'.repeat(64)};
test('inert exact-key retirement preparation binds every fixed Git member and grants no live authority',()=>{
 const prepared=prepareMobileKeyRetirementReviewV1(JSON.stringify(input));
 assert.equal(prepared.operation,'RETIRE_UNQUALIFIED_MOBILE_RECEIPT_KEY_V1');
 assert.equal(prepared.installability,'NOT_INSTALLABLE');assert.ok(Object.values(prepared.authority).every(x=>x===false));
 const payload=JSON.parse(Buffer.from(prepared.privateCandidate.payloadBase64,'base64'));
 assert.equal(payload.Records.length,20);assert.equal(payload.KeySha256,input.keySha256);
 assert.equal(createHash('sha256').update(Buffer.from(prepared.privateCandidate.payloadBase64,'base64')).digest('hex'),prepared.privateCandidate.payloadSha256);
 const exact=prepareMobileKeyRetirementReviewV1(JSON.stringify({...input,mode:'Retire',fingerprint:'c'.repeat(64)}));
 assert.ok(exact.requiredGates.includes('EXACT_UNQUALIFIED_KEY_RETIREMENT_APPROVAL'));
 assert.match(exact.privateCandidate.script,/-Mode 'Retire' -OperatorApproved/);
 let vectors=0;
 for(const [field,value] of Object.entries({expectedMain:'f'.repeat(40),sourceTree:'f'.repeat(40),operatorSid:'SYSTEM',machineHash:'wrong',mode:'Reset',fingerprint:'a'.repeat(64),keySha256:'bad',keyName:'chosen'})){
  assert.throws(()=>prepareMobileKeyRetirementReviewV1(JSON.stringify({...input,[field]:value})));vectors++;
 }
 for(const mutate of [row=>row.sourceInput.records.pop(),row=>row.sourceInput.records[0].contentBase64=Buffer.from('changed').toString('base64'),row=>row.sourceInput.records.push({...row.sourceInput.records[0]})]){
  const row=structuredClone(input);mutate(row);assert.throws(()=>prepareMobileKeyRetirementReviewV1(JSON.stringify(row)));vectors++;
 }
 assert.equal(vectors,11);
});
test('the exact retirement adapter compiles with authenticated native and shared preservation primitives without invoking any factory',
 {skip:process.platform!=='win32',timeout:40000},()=>{
 const native=readMobileInstallerNativeSourceV1().map(x=>x.bytes.toString('utf8')).join('\n');
 const extract=text=>text.split("$native=@'\n")[1]?.split("\n'@\n")[0];
 const preserved=extract(source(preservation)),retired=extract(source(retirement));assert.ok(preserved&&retired);
 const dir=mkdtempSync(join(tmpdir(),'stephanos-retirement-compile-')),file=join(dir,'source.cs');
 try{
  writeFileSync(file,native+'\n'+preserved+'\n'+retired);
  const script="$ErrorActionPreference='Stop';Add-Type -TypeDefinition ([IO.File]::ReadAllText('"+file.replaceAll("'","''")+"')) -ReferencedAssemblies 'System','System.Core','System.Management','System.Web.Extensions','Microsoft.CSharp' -ErrorAction Stop;[Console]::Write('RETIREMENT_COMPILE_ONLY_OK')";
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:16000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'RETIREMENT_COMPILE_ONLY_OK');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the native fresh-enrollment boundary shares exact missing-task admission and refuses existing or ambiguous results',
 {skip:process.platform!=='win32',timeout:40000},()=>{
 const fixture=String.raw`namespace Stephanos.Sovereign {
  public sealed class EnrollmentTaskAbsenceProbeV2 {
   public string Mode;public object Folder;public string Missing;
   public object GetTask(string name) {
    if(name!=MobileInstallQualifiedEnrollmentV1.TaskName)throw new System.InvalidOperationException("FIXED_TASK_NAME_REQUIRED");
    switch(Mode) {
     case "actual":return ((dynamic)Folder).GetTask(Missing);
     case "io":throw new System.IO.FileNotFoundException();
     case "com":throw new System.Runtime.InteropServices.COMException("missing",unchecked((int)0x80070002));
     case "denied":throw new System.Runtime.InteropServices.COMException("denied",unchecked((int)0x80070005));
     case "directory":throw new System.IO.DirectoryNotFoundException();
     case "nested":throw new System.ArgumentException("unrelated",new System.IO.FileNotFoundException());
     case "unknown":throw new System.InvalidOperationException();
     case "null":return null;
     default:return this;
    }
   }
  }
  public static class EnrollmentTaskAbsenceFixtureV2 {
   public static int Run(object folder,string missing) {
    var probe=new EnrollmentTaskAbsenceProbeV2 {Folder=folder,Missing=missing};int count=0;
    foreach(string mode in new[]{"actual","io","com","denied","directory","nested","unknown","null","existing"}) {
     probe.Mode=mode;bool absent=false;try{CoreJobCustodyV1.ReadAbsentMobileTaskV2(probe);absent=true;}catch{}
     if(absent!=(mode=="actual" || mode=="io" || mode=="com"))throw new System.InvalidOperationException("TASK_ABSENCE_VECTOR:"+mode);count++;
    }
    using(var identity=System.Security.Principal.WindowsIdentity.GetCurrent()) {
     string sid=identity.User.Value;
     foreach(string owner in new[]{sid,identity.Name,identity.Name.Substring(identity.Name.LastIndexOf('\\')+1)}) {
      CoreJobCustodyV1.VerifyMobileTaskPrincipalV2(owner,sid);count++;
     }
     foreach(string owner in new[]{null,"", "S-1-5-18"}) {
      bool refused=false;try{CoreJobCustodyV1.VerifyMobileTaskPrincipalV2(owner,sid);}catch{refused=true;}
      if(!refused)throw new System.InvalidOperationException("TASK_PRINCIPAL_IDENTITY_NOT_VERIFIED");count++;
     }
    }
    return count;
   }
  }
 }`;
 const dir=mkdtempSync(join(tmpdir(),'stephanos-enrollment-task-')),file=join(dir,'source.cs');
 try{
  writeFileSync(file,readMobileInstallerNativeSourceV1().map(x=>x.bytes.toString('utf8')).join('\n')+'\n'+fixture);
  const script="$ErrorActionPreference='Stop';Add-Type -TypeDefinition ([IO.File]::ReadAllText('"+file.replaceAll("'","''")+"')) -ReferencedAssemblies 'System','System.Core','System.Management','System.Web.Extensions','Microsoft.CSharp' -ErrorAction Stop;$service=New-Object -ComObject Schedule.Service;$folder=$null;try{$service.Connect();$folder=$service.GetFolder('\\');[Console]::Write([Stephanos.Sovereign.EnrollmentTaskAbsenceFixtureV2]::Run($folder,('Stephanos absent fixture '+[Guid]::NewGuid().ToString('N'))))}finally{foreach($com in @($folder,$service)){if($null -ne $com){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com)}}}";
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:16000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'15');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('retirement is a separate closed manual operation and never adopts an unqualified helper or creates an enrollment',()=>{
 const text=source(retirement);
 assert.match(text,/key\.Delete\(\);SovereignMobileInstallProvisioningV1\.AssertFreshEnrollmentBoundaryV2\(\)/);
 assert.match(text,/PublicFingerprint\(key\)!=publicHash/);
 assert.match(text,/MOBILE_RETIRE_UNKNOWN_INSPECT_ONLY_NO_RETRY/);
 assert.match(text,/KeyOnlySnapshot\(root,state,helper,acl\)!=snapshot/);
 assert.doesNotMatch(text,/LoadFrom|Import-CliXml|CreateReceiptKeyForEnrollment|SealEnrollmentCertificate|Directory\.Delete|File\.Delete|ClearEventLog|NCryptDeleteKey|Task\.Run/);
});
