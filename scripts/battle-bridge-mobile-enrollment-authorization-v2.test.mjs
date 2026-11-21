import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readMobileInstallerNativeSourceV1} from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const nativeRunner=String.raw`namespace Stephanos.Sovereign {
 public static class MobileAuthorizationDataFixtureV2 {
  public static string Digest(string raw){return SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(raw).CredentialBindingSha256;}
  public static string Run(string raw) {
   var json=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=1048576,RecursionLimit=16};
   var input=(System.Collections.Generic.Dictionary<string,object>)json.DeserializeObject(raw);
   var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1((string)input["binding"]);
   var fields=new System.Collections.Generic.Dictionary<string,string>();
   foreach(var field in (System.Collections.Generic.Dictionary<string,object>)input["permit"])fields.Add(field.Key,(string)field.Value);
   var rows=new System.Collections.Generic.List<object>();
   using(var permit=new MobileInstallReleaseInspectionV1(true,"SYNTHETIC_AUTHORIZATION_DATA_ONLY",fields)) {
    foreach(object item in (object[])input["rows"]) {
     var row=(System.Collections.Generic.Dictionary<string,object>)item;bool ok=false;string reason="";
     try {
      var context=MobileInstallEnrollmentAuthorizationV2.ReadHistorical((string)row["raw"],binding,permit);
      var at=System.DateTime.ParseExact((string)row["at"],"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.AssumeUniversal|System.Globalization.DateTimeStyles.AdjustToUniversal);
      context.VerifySigningTime(at);
      if(row.ContainsKey("certificate"))MobileInstallQualifiedEnrollmentV1.VerifyCertificateV2((string)row["certificate"],binding.ReceiptPublicKeySpki,new string('7',64),binding,permit,context);
      ok=true;
     }catch(System.InvalidOperationException error){reason=error.Message;}
     rows.Add(new {name=row["name"],ok,reason});
    }
   }
   return json.Serialize(rows);
  }
 }
}`;
test('durable authorization independently binds actual receipt key, setup proof, source, counter and native signing window',
 {skip:process.platform!=='win32',timeout:45000},t=>{
 const device=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),receipt=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const spki=key=>key.export({type:'spki',format:'der'}).toString('base64url'),now=Date.now()-3000,iso=x=>new Date(x).toISOString();
 const proposed={schemaVersion:'stephanos.battle-bridge-mobile-installation-enrollment.v1',machineHash:'2'.repeat(64),operatorSid:'S-1-5-21-1-2-3-1001',generation:1,rpId:'fixture.invalid',origin:'https://fixture.invalid',credentialId:Buffer.alloc(24,7).toString('base64url'),publicKeySpki:spki(device.publicKey),userHandle:Buffer.from('fixture').toString('base64url'),lastSignCount:0,revoked:false,receiptPublicKeySpki:spki(device.publicKey)};
 const actual={...proposed,lastSignCount:1,receiptPublicKeySpki:spki(receipt.publicKey)};
 const context={schemaVersion:'stephanos.mobile-installer-enrollment-authorization.v2',sourceHead:'a'.repeat(40),sourceTree:'b'.repeat(40),packageSha256:'3'.repeat(64),releaseProofSha256:'5'.repeat(64),setupDescriptor:'',proposedEnrollment:JSON.stringify(proposed),deviceAssertion:'',actualEnrollment:JSON.stringify(actual),acceptedAtUtc:iso(now)};
 const descriptor={schemaVersion:'stephanos.mobile-installer-setup-descriptor.v1',repository:'Cheekyfellastef/stephan-os',sourceHead:context.sourceHead,sourceTree:context.sourceTree,machineHash:proposed.machineHash,operatorSid:proposed.operatorSid,enrollmentGeneration:1,packageSha256:context.packageSha256,releaseProofSha256:context.releaseProofSha256,proposedEnrollmentSha256:digest(context.proposedEnrollment),nonce:'8'.repeat(64),issuedAtUtc:iso(now-1000),expiresAtUtc:iso(now+600000)};
 context.setupDescriptor=JSON.stringify(descriptor);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:createHash('sha256').update('stephanos.mobile-install-enrollment-proof.v1\0'+context.setupDescriptor).digest('base64url'),origin:proposed.origin})),auth=Buffer.concat([createHash('sha256').update(proposed.rpId).digest(),Buffer.from([5,0,0,0,1])]);
 context.deviceAssertion=JSON.stringify({type:'public-key',id:proposed.credentialId,rawId:proposed.credentialId,response:{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:sign('sha256',Buffer.concat([auth,createHash('sha256').update(client).digest()]),device.privateKey).toString('base64url'),userHandle:null}});
 const permit={machineHash:actual.machineHash,operatorSid:actual.operatorSid,enrollmentGeneration:'1',sourceHead:context.sourceHead,sourceTree:context.sourceTree,packageSha256:context.packageSha256,closureSha256:'4'.repeat(64),releaseProofSha256:context.releaseProofSha256,bootstrapSha256:'6'.repeat(64)};
 const rows=[{name:'actual receipt replacement and baseline counter valid',raw:JSON.stringify(context),at:iso(now+1000),ok:true}];
 const add=(name,change,at=iso(now+1000),ok=false)=>{const c=structuredClone(context);change(c);rows.push({name,raw:JSON.stringify(c),at,ok});};
 for(const [key,value] of Object.entries({sourceHead:'f'.repeat(40),sourceTree:'f'.repeat(40),packageSha256:'f'.repeat(64),releaseProofSha256:'f'.repeat(64),schemaVersion:'other',acceptedAtUtc:iso(now+700000),extra:true}))add('changed '+key,c=>{c[key]=value;});
 for(const [key,value] of Object.entries({machineHash:'f'.repeat(64),operatorSid:'S-1-5-21-1-2-3-1002',generation:2,publicKeySpki:spki(receipt.publicKey),receiptPublicKeySpki:spki(device.publicKey),lastSignCount:0,revoked:true}))add('actual enrollment '+key,c=>{c.actualEnrollment=JSON.stringify({...actual,[key]:value});});
 add('expired before signing',()=>{},descriptor.expiresAtUtc);
 add('clock moved backwards',()=>{},iso(now-1));
 add('fresh timestamp cannot renew old authorization',c=>{c.acceptedAtUtc=iso(now+600001);},iso(now+600002));
 add('setup signature changed',c=>{const a=JSON.parse(c.deviceAssertion);a.response.signature=a.response.signature.slice(0,-2)+'AA';c.deviceAssertion=JSON.stringify(a);});
 add('descriptor nonce changed',c=>{c.setupDescriptor=JSON.stringify({...descriptor,nonce:'9'.repeat(64)});});
 const canonical=JSON.stringify(context);
 rows.push({name:'exact 64 KiB authorization data remains bounded',raw:canonical+' '.repeat(65536-Buffer.byteLength(canonical)),at:iso(now+1000),ok:true});
 rows.push({name:'over 64 KiB authorization refused',raw:canonical+' '.repeat(65537-Buffer.byteLength(canonical)),at:iso(now+1000),ok:false});
 rows.push({name:'duplicate authorization key refused',raw:canonical.replace('"acceptedAtUtc":','"acceptedAtUtc":"'+context.acceptedAtUtc+'","acceptedAtUtc":'),at:iso(now+1000),ok:false});
 rows.push({name:'escaped duplicate authorization key refused',raw:canonical.replace('"acceptedAtUtc":','"acceptedAt\\u0055tc":"'+context.acceptedAtUtc+'","acceptedAtUtc":'),at:iso(now+1000),ok:false});
 const dir=mkdtempSync(join(tmpdir(),'stephanos-auth-data-')),code=join(dir,'source.cs'),input=join(dir,'input.json');
 const literal=x=>"'"+x.replaceAll("'","''")+"'";
 const run=body=>spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';Add-Type -TypeDefinition ([IO.File]::ReadAllText("+literal(code)+")) -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;"+body,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:35000,maxBuffer:20000});
 try {
  writeFileSync(code,readMobileInstallerNativeSourceV1().map(x=>x.bytes.toString('utf8')).join('\n')+'\n'+nativeRunner);
  writeFileSync(input,JSON.stringify(actual));
  const first=run('[Console]::Write([Stephanos.Sovereign.MobileAuthorizationDataFixtureV2]::Digest([IO.File]::ReadAllText('+literal(input)+')))');assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/^[a-f0-9]{64}$/);
  const fields={repository:'Cheekyfellastef/stephan-os',machineHash:actual.machineHash,operatorSid:actual.operatorSid,generation:'1',credentialBindingSha256:first.stdout,receiptPublicKeySpki:actual.receiptPublicKeySpki,helperSha256:'7'.repeat(64),sourceHead:permit.sourceHead,sourceTree:permit.sourceTree,packageSha256:permit.packageSha256,closureSha256:permit.closureSha256,releaseProofSha256:permit.releaseProofSha256,bootstrapSha256:permit.bootstrapSha256,qualificationEvidenceSha256:permit.releaseProofSha256,authorizationSha256:digest(JSON.stringify(context)),issuedAtUtc:iso(now+1000)};
  const cert=(changes={},v2=true)=>{const f={...fields,...changes};if(!v2)delete f.authorizationSha256;const body='STEPHANOS_MOBILE_INSTALL_ENROLLMENT_V'+(v2?'2':'1')+'\n'+Object.entries(f).map(([k,v])=>k+'='+v+'\n').join('');return body+'signature='+sign('sha256',Buffer.from('stephanos.mobile-install-enrollment-certificate.v'+(v2?'2':'1')+'\0'+body),{key:receipt.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')+'\n';};
  for(const [name,wire,ok] of [['signed V2 exact context',cert(),true],['signed different authorization',cert({authorizationSha256:'f'.repeat(64)}),false],['fresh signature after expiry',cert({issuedAtUtc:descriptor.expiresAtUtc}),false],['legacy structural certificate never qualifies',cert({},false),false]])rows.push({name,raw:JSON.stringify(context),at:iso(now+1000),certificate:wire,ok});
  writeFileSync(input,JSON.stringify({binding:JSON.stringify(actual),permit,rows}));
  const result=run('[Console]::Write([Stephanos.Sovereign.MobileAuthorizationDataFixtureV2]::Run([IO.File]::ReadAllText('+literal(input)+')))');assert.equal(result.status,0,result.stderr);
  const observed=JSON.parse(result.stdout);assert.equal(observed.length,rows.length);for(let i=0;i<rows.length;i++){assert.equal(observed[i].name,rows[i].name);assert.equal(observed[i].ok,rows[i].ok,JSON.stringify(observed[i]));}
  t.diagnostic(rows.length+' real native context/signature/window vectors; synthetic keys only, no protected factory invoked');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
