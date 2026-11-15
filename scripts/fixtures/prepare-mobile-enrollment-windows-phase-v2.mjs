import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
if(process.platform!=='win32')throw Error('WINDOWS_FIXTURE_HOST_REQUIRED');
const {makeFixedRuntimeSourceProofFixtureV1}=await import(pathToFileURL(join(root,'scripts/fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs')));
const {FIXED_RUNTIME_SOURCE_PATHS_V1}=await import(pathToFileURL(join(root,'scripts/sovereign-fixed-runtime-installer-candidate-v1.mjs')));
const {prepareMobileInstallBootstrapReviewV1,MOBILE_BOOTSTRAP_INPUT_V1,MOBILE_SETUP_INPUT_V1}=await import(pathToFileURL(join(root,'scripts/battle-bridge-mobile-install-enrollment-bootstrap-v1.mjs')));
const {MOBILE_ENROLLMENT_REVIEW_INPUT_V1}=await import(pathToFileURL(join(root,'scripts/battle-bridge-mobile-install-enrollment-review-v1.mjs')));
const declaration=JSON.parse(readFileSync(join(root,'shared/agents/sovereignMobileInstallerNativeClosureV1.json')));
const entry='scripts/windows/install-battle-bridge-mobile-installer-v1.ps1',preserve='scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1',retire='scripts/windows/retire-battle-bridge-mobile-key-v1.ps1';
const nativePaths=[...declaration.paths,entry,'shared/agents/sovereignMobileInstallerNativeClosureV1.json'];
const allPaths=[...new Set([...FIXED_RUNTIME_SOURCE_PATHS_V1,...nativePaths,preserve,retire])];
// Derive the real invoking Windows target. These synthetic proof inputs never
// qualify a production source, phone/device, release or installation.
const ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const observe=String.raw`$ErrorActionPreference='Stop';$id=[Security.Principal.WindowsIdentity]::GetCurrent();try{$sid=$id.User.Value}finally{$id.Dispose()};$r=[Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64');try{$k=$r.OpenSubKey('SOFTWARE\Microsoft\Cryptography',$false);try{$g=$k.GetValue('MachineGuid')}finally{$k.Dispose()}}finally{$r.Dispose()};$h=[Security.Cryptography.SHA256]::Create();try{$m=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($g.ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};[Console]::Write((@{sid=$sid;machine=$m;temporaryRoot=[IO.Path]::GetTempPath()}|ConvertTo-Json -Compress))`;
const observation=spawnSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(observe,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:8192});
if(observation.status!==0)throw Error('WINDOWS_FIXTURE_TARGET_OBSERVATION_FAILED');
const target=JSON.parse(observation.stdout),sid=target.sid,machine=target.machine;
if(!/^S-1-5-21-[0-9-]+$/.test(sid)||!/^[a-f0-9]{64}$/.test(machine)||typeof target.temporaryRoot!=='string')throw Error('WINDOWS_FIXTURE_TARGET_UNPROVEN');
const suite=randomBytes(16).toString('hex'),out=join(target.temporaryRoot,'StephanosMobileEnrollmentFixture-'+suite);mkdirSync(out);
const phases=['COMPLETE','PREFLIGHT','ROOT','HELPER','KEY','KEY_RETIRE_UNKNOWN','ENROLLMENT','AUTHORIZATION','RELEASE','WAL','GENESIS','TASK','CERTIFICATE','READBACK'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const rows=[];
for(const phase of phases) {
 const id=randomBytes(16).toString('hex'),fixtureRoot='C:\\Program Files\\Stephanos\\MobileInstallFixture-'+id;
 const log='CF'+id,source='StephanosFixture'+id,keyName='Stephanos.MobileInstallFixture.'+id+'.Receipt',task='Stephanos Mobile Installer Fixture '+id,pipe='Stephanos.MobileInstallFixture.'+id;
 const transforms=[['C:\\Program Files\\Stephanos\\SovereignMobileInstallerV1',fixtureRoot],['Stephanos.SovereignMobileInstallerV1.Receipt',keyName],['Stephanos Mobile Runtime Installer V1',task],['Stephanos.SovereignMobileInstallerV1',pipe],['Stephanos Maintenance Custody',log],['StephanosMaintenanceCustody',source],['SovereignMobileInstallerV1.failed-','MobileInstallFixture-'+id+'.failed-'],['SovereignMobileInstallerV1','MobileInstallFixture-'+id]];
 const transform=s=>transforms.reduce((s,[a,b])=>s.replaceAll(a,b),s.replaceAll('\r\n','\n'));
 const files=allPaths.map(path=>({path,content:Buffer.from(transform(readFileSync(join(root,path),'utf8')))}));
 const provisioning=files.find(x=>x.path.endsWith('SovereignMobileInstallProvisioningV1.cs'));
 // Only the isolated compiled fixture exposes this positive readback at its own
 // fixed helper identity. No production input, arbitrary mode or root exists.
 provisioning.content=Buffer.concat([provisioning.content,Buffer.from(`
namespace Stephanos.Sovereign {public static class IsolatedEnrollmentProof {
 public static int Run(){string stage="files";try{
  using(var files=CoreJobCustodyV1.OpenMobileEnrollmentFilesV1()) {
   stage="release";using(var permit=SovereignMobileInstallReleaseV1.OpenProtected()) {
    stage="certificate";using(var sha=System.Security.Cryptography.SHA256.Create())
     MobileInstallQualifiedEnrollmentV1.VerifyCertificateV2(files.Certificate,files.Binding.ReceiptPublicKeySpki,
      System.BitConverter.ToString(sha.ComputeHash(files.HelperBytes)).Replace("-","").ToLowerInvariant(),files.Binding,permit,files.Authorization);
   }
  }
  stage="anchor";using(var anchor=SovereignMobileInstallAnchorV1.OpenProtected()){}
  stage="journal";using(var journal=SovereignMobileInstallJournalV1.OpenProtected()){}
  stage="qualified";using(var q=MobileInstallQualifiedEnrollmentV1.OpenProtected()){}
  System.Console.WriteLine("ISOLATED_NATIVE_QUALIFIED_READBACK_OK");return 0;
 }catch(System.Exception error){System.Console.WriteLine("ISOLATED_NATIVE_HELD:"+stage+":"+error.ToString());return 73;}}
}}\n`)]);
 const entryCs=files.find(x=>x.path.endsWith('SovereignMobileInstallEntryV1.cs'));
 let cs=entryCs.content.toString();
 const main=/((?:public )?static int Main\(string\[\] args\)\s*\{)/;
 if(!main.test(cs))throw Error('EXACT_MAIN_SEAM_MISSING');
 cs=cs.replace(main,'$1\n      if(System.Environment.GetEnvironmentVariable("STEPHANOS_ISOLATED_PROOF")=="'+id+'")return IsolatedEnrollmentProof.Run();');entryCs.content=Buffer.from(cs);
 let script=files.find(x=>x.path===entry).content.toString();
 const stops={
 PREFLIGHT:'# From this boundary all effects target',ROOT:'$parameters=[CodeDom.Compiler.CompilerParameters]::new()',
 HELPER:'$proof=Confirm-MobileEnrollmentDevice $assembly',KEY:"$proposed['receiptPublicKeySpki']=$receiptSpki",
 ENROLLMENT:"Write-MobileNew 'enrollment-authorization.v2'",AUTHORIZATION:"foreach($name in @('release.pin'",
 RELEASE:'$binding=$assertion.GetMethod',WAL:'$anchor=$assembly.GetType',GENESIS:'[void]$authorizationType.GetMethod',
 TASK:"$certificateSha=$provision.GetMethod",CERTIFICATE:"[void]$assembly.GetType('Stephanos.Sovereign.CoreJobCustodyV1',$true).GetMethod('VerifyManualEnrollmentReadbackV2'",READBACK:"[Console]::WriteLine('MOBILE_INSTALLER_ENROLLMENT_STAGED_V1="};
 if(phase!=='COMPLETE') {
  const needle=stops[phase==='KEY_RETIRE_UNKNOWN'?'KEY':phase];if(!needle || script.split(needle).length!==2)throw Error('STOP_SEAM_'+phase);
  script=script.replace(needle,"throw 'ISOLATED_STOP_"+phase+"'\n"+needle);
 }
 files.find(x=>x.path===entry).content=Buffer.from(script);
 if(phase==='KEY_RETIRE_UNKNOWN') {
  const row=files.find(x=>x.path===retire),text=row.content.toString(),needle='key.Delete();SovereignMobileInstallProvisioningV1.AssertFreshEnrollmentBoundaryV2();';
  if(text.split(needle).length!==2)throw Error('EXACT_RETIREMENT_FAULT_SEAM_REQUIRED');
  row.content=Buffer.from(text.replace(needle,'key.Delete();if(System.DateTime.UtcNow.Ticks>0)throw new InvalidOperationException("ISOLATED_POST_DELETE_READBACK_UNKNOWN");'));
 }
 const inputFor=selected=>{const f=makeFixedRuntimeSourceProofFixtureV1({files:files.filter(x=>selected.includes(x.path)),extras:files.filter(x=>!selected.includes(x.path))});return {fixture:f,input:{schemaVersion:'stephanos.fixed-runtime-source-package-input.v1',repository:'Cheekyfellastef/stephan-os',commit:{sha:f.head,contentBase64:f.commit.bytes.toString('base64')},trees:[...f.trees].map(([sha,b])=>({sha,contentBase64:b.toString('base64')})),records:files.filter(x=>selected.includes(x.path)).map(x=>({path:x.path,blobSha:createHash('sha1').update('blob '+x.content.length+'\0').update(x.content).digest('hex'),contentBase64:x.content.toString('base64')}))}}};
 const runtime=inputFor(FIXED_RUNTIME_SOURCE_PATHS_V1),native=inputFor(nativePaths);
 if(runtime.fixture.head!==native.fixture.head)throw Error('FIXTURE_GIT_DIVERGED');
 const device=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),spki=device.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const enrollment={schemaVersion:'stephanos.battle-bridge-mobile-installation-enrollment.v1',machineHash:machine,operatorSid:sid,generation:1,rpId:'fixture.invalid',origin:'https://fixture.invalid',credentialId:Buffer.alloc(24,7).toString('base64url'),publicKeySpki:spki,userHandle:Buffer.from('isolated-fixture').toString('base64url'),lastSignCount:0,revoked:false,receiptPublicKeySpki:spki};
 const now=Date.now(),setup={schemaVersion:MOBILE_SETUP_INPUT_V1,nativeSourceInput:native.input,proposedEnrollmentJson:JSON.stringify(enrollment),nonce:randomBytes(32).toString('hex'),issuedAtUtc:new Date(now-1000).toISOString(),expiresAtUtc:new Date(now+899000).toISOString(),reviewInput:{schemaVersion:MOBILE_ENROLLMENT_REVIEW_INPUT_V1,sourceInput:runtime.input,expectedMain:runtime.fixture.head,sourceTree:runtime.fixture.tree,operatorSid:sid,machineHash:machine,enrollmentGeneration:1,releaseEvidenceBase64:Buffer.from('{"syntheticFixture":true,"authority":false}').toString('base64')}};
 const {prepareMobileInstallSetupReviewV1}=await import(pathToFileURL(join(root,'scripts/battle-bridge-mobile-install-enrollment-bootstrap-v1.mjs')));
 const desc=prepareMobileInstallSetupReviewV1(JSON.stringify(setup));
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:desc.publicKey.challenge,origin:enrollment.origin})),auth=Buffer.concat([createHash('sha256').update(enrollment.rpId).digest(),Buffer.from([5,0,0,0,1])]);
 const assertion={type:'public-key',id:enrollment.credentialId,rawId:enrollment.credentialId,response:{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:sign('sha256',Buffer.concat([auth,createHash('sha256').update(client).digest()]),device.privateKey).toString('base64url'),userHandle:null}};
 const prepared=prepareMobileInstallBootstrapReviewV1(JSON.stringify({schemaVersion:MOBILE_BOOTSTRAP_INPUT_V1,setupInput:setup,deviceAssertionJson:JSON.stringify(assertion)}));
 const payload=Buffer.from(prepared.privateCandidate.payloadBase64,'base64');
 writeFileSync(join(out,id+'.json'),payload);
 const recovery=Buffer.from(JSON.stringify({records:files.filter(x=>[...declaration.paths,'shared/agents/sovereignMobileInstallerNativeClosureV1.json',preserve,retire].includes(x.path)).map(x=>({Path:x.path,ContentBase64:x.content.toString('base64'),Sha256:sha(x.content)}))}));
 const manifest={id,phase,root:fixtureRoot,key:keyName,task,pipe,log,source,head:native.fixture.head,tree:native.fixture.tree,payloadSha256:sha(payload),recoverySha256:sha(recovery),filesSha256:sha(Buffer.concat(files.map(x=>x.content)))};
 // Reuse exact source-admitted native records for retirement fixture compilation.
 writeFileSync(join(out,id+'-recovery.json'),recovery);
 rows.push(manifest);
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({schemaVersion:'stephanos.isolated-mobile-enrollment-phase-proof.v1',suite,operatorSid:sid,machineHash:machine,productionMutation:false,rows},null,2));
console.log(JSON.stringify({directory:out,suite,manifestSha256:sha(readFileSync(join(out,'manifest.json'))),phaseCount:rows.length,
  controllerPath:join(root,'scripts/windows/test-mobile-enrollment-windows-phase-v2.ps1'),productionMutation:false}));
