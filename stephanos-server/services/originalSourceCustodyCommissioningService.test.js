import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateSourceCustodyCommissioning as check,
  SOURCE_CUSTODY_COMMISSIONING_DOMAIN as domain,
  SOURCE_CUSTODY_COMMISSIONING_SCHEMA as schema } from './originalSourceCustodyCommissioningService.js';

const iso='S-1-5-21-100-200-300-401';
const operator='S-1-5-21-100-200-300-402';
const issuer='S-1-5-21-100-200-300-403';
const started='2026-10-12T16:00:00.000Z';
const digest = x=>createHash('sha256').update(x).digest('hex');
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'stephanos-issuer-commissioning-'));
  const isolated=join(dir,'isolated-worktree');
  await mkdir(isolated);
  const root=generateKeyPairSync('ed25519');
  const service=generateKeyPairSync('ed25519');
  const rootPem=root.publicKey.export({format:'pem',type:'spki'});
  const servicePem=service.publicKey.export({format:'pem',type:'spki'});
  const recordPath=join(dir,'offline-commissioning.json');
  const rootKey=join(dir,'offline-root-public.pem');
  const serviceKey=join(dir,'service-public.pem');
  await writeFile(rootKey,rootPem);
  await writeFile(serviceKey,servicePem);
  const env={
    STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_RECEIPT_PATH:recordPath,
    STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_PATH:rootKey,
    STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_SHA256:digest(rootPem),
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH:serviceKey,
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256:digest(servicePem),
  };
  const identity={
    repository:'Cheekyfellastef/stephan-os',
    branch:'main',worktreePath:isolated,isolatedWriterPrincipalSid:iso,
    isolationPolicySha256:'a'.repeat(64),processStartedAtUtc:started,
  };
  const claims={
    repository:identity.repository,branch:identity.branch,worktreePath:identity.worktreePath,
    isolatedWriterPrincipalSid:iso,issuerServicePrincipalSid:issuer,operatorPrincipalSid:operator,
    issuerPublicKeySha256:env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256,
    isolationPolicySha256:identity.isolationPolicySha256,
    commissionedAtUtc:'2026-10-12T15:59:00.000Z',
    expiresAtUtc:'2026-10-13T15:59:00.000Z',
    issuerKeyNotAccessibleToWorker:true,
    operatorCheckoutWriteDeniedToWorker:true,
    outOfJobSourceWriterAccessDenied:true,
    independentOsPrincipalAttestation:true,
  };
  async function emit(fields=claims,signingKey=root.privateKey){
    await writeFile(recordPath,JSON.stringify({
      schemaVersion:schema,issuer:'stephanos-independent-custody-commissioning-root',
      algorithm:'Ed25519',claims:fields,
      signatureBase64:sign(null,Buffer.from(domain+JSON.stringify(fields)),signingKey).toString('base64'),
    }));
  }
  return {dir,isolated,root,service,env,identity,claims,emit,recordPath};
}
test('distinct offline Ed25519 commissioning root signs only a pre-existing isolated-writer policy, never lease authority',async()=>{
  const f=await fixture();
  try{await f.emit();const result=await check(f.identity,{env:f.env});
    assert.equal(result.authenticated,true);assert.equal(result.authority,false);
    assert.equal(result.sourceWriterExclusionProven,false);
    assert.equal(result.leaseReleaseAllowed,false);
  } finally {await rm(f.dir,{recursive:true,force:true});}
});
test('without independent commissioning root and receipt, fail closed',async()=>{
  const f=await fixture();
  try{for(const env of [{},f.env]){const r=await check(f.identity,{env});
    assert.equal(r.authenticated,false);assert.equal(r.leaseReleaseAllowed,undefined);}
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('no historical retroactive commissioning or long-lived unbounded authorisation',async()=>{
  const f=await fixture();
  try{for(const c of [
      {...f.claims,commissionedAtUtc:'2026-10-12T16:01:00.000Z'},
      {...f.claims,commissionedAtUtc:'2026-10-12T16:00:00.000Z'},
      {...f.claims,expiresAtUtc:'2026-12-02T15:59:00.000Z'},
      {...f.claims,expiresAtUtc:'2026-10-12T15:59:00.000Z'},
    ]){await f.emit(c);assert.equal((await check(f.identity,{env:f.env})).authenticated,false);}
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('service key, signer identity, source identity and claimed isolation are all independent gates',async()=>{
  const f=await fixture();
  try{for(const change of [
    {isolatedWriterPrincipalSid:operator},{issuerServicePrincipalSid:iso},
    {operatorPrincipalSid:issuer},{issuerKeyNotAccessibleToWorker:false},
    {operatorCheckoutWriteDeniedToWorker:false},{outOfJobSourceWriterAccessDenied:false},
    {independentOsPrincipalAttestation:false},
    {issuerPublicKeySha256:'c'.repeat(64)},{isolationPolicySha256:'d'.repeat(64)},
    {repository:'another/repository'},{branch:'different'},{worktreePath:f.dir},
  ]){await f.emit({...f.claims,...change});assert.equal((await check(f.identity,{env:f.env})).authenticated,false,Object.keys(change)[0]);}
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('source worker key cannot be used as root and signatures cannot be replayed or edited',async()=>{
  const f=await fixture();
  try{await f.emit();const forged=generateKeyPairSync('ed25519');
    await f.emit(f.claims,forged.privateKey);
    assert.equal((await check(f.identity,{env:f.env})).authenticated,false);
    await f.emit();
    const alias={...f.env,STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_PATH:f.env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH,STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_SHA256:f.env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256};
    assert.equal((await check(f.identity,{env:alias})).authenticated,false);
    assert.equal((await check({...f.identity,worktreePath:f.dir},{env:f.env})).authenticated,false);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
