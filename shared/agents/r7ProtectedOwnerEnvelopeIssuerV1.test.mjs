import assert from 'node:assert/strict';
import test from 'node:test';
import { constants,createDecipheriv,createHash,generateKeyPairSync,privateDecrypt } from 'node:crypto';
import { currentFixture,READ_ONLY_FAKE } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
import { API } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
import { buildR7OwnerSourceReadbackInput,r7OwnerPeerFromSourceInput } from './r7ProtectedOwnerSourceReadbackV1.mjs';
import { createR7ProtectedOwnerEnvelopeIssuer as create,r7OwnerBrokerRequestUrl as url } from './r7ProtectedOwnerEnvelopeIssuerV1.mjs';
import { R7_FIRST_ROOT_INTAKE_AUDIENCE as peerPrefix, R7_FIRST_ROOT_PEER_PURPOSE as peerPurpose,
  R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE as provisioningPrefix,
  R7_INACTIVE_ROOT_PROVISIONING_PURPOSE as provisioningPurpose } from './r7FirstRootOwnerIntakeProposalV1.mjs';

const BROKER='https://vstoken.actions.githubusercontent.com/test/idtoken?api-version=2.0';
const FAKE='fixture-not-a-real-provider-credential';
const JWT='Zml4dHVyZS1ub3QtYW4taXNzdWVy.c3ludGhldGljLW5vbi1wcm9kdWN0aW9u.c2lnbmF0dXJl';
function setup(keyPair,prefix=peerPrefix) {
  const f=currentFixture();
  f.event.inputs.r7_native_challenge_audience=f.event.inputs.r7_native_challenge_audience.replace(peerPrefix,prefix);
  if(keyPair){const der=keyPair.publicKey.export({format:'der',type:'spki'});
    const digest=createHash('sha256').update(der).digest('hex');
    f.event.inputs.r7_native_recipient_spki_base64=der.toString('base64');
    f.event.inputs.r7_native_challenge_audience=f.event.inputs.r7_native_challenge_audience.replace(/[a-f0-9]{64}$/,digest);}
  const wire=buildR7OwnerSourceReadbackInput(f.event,f.runtime);
  const peer=r7OwnerPeerFromSourceInput(JSON.parse(wire),f.nativeWindowWire);
  f.resources.get(API+'/actions/runs/789/approvals')[0].comment=peer.pairing.approvalComment;
  return {...f,wire,peer};
}
async function run(f,change=()=>{},after=()=>{}) {
  let supplied=0,requested=0;
  const prior=globalThis.fetch;
  const context={requestUrl:BROKER,requestToken:FAKE};
  const provider={status:200,type:'application/json',redirected:false,bytes:Buffer.from(JSON.stringify({value:JWT}))};
  change(f,provider,context);
  globalThis.fetch=async(address,options)=>{
    if(address.startsWith('https://vstoken.actions.githubusercontent.com/')) {
      requested++;assert.equal(supplied,1);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
      assert.equal(options.headers.Authorization,'Bearer '+FAKE);
      assert.equal(new URL(address).searchParams.get('audience'),f.peer.challenge.Audience);
      after(f);
      return f.response(address,provider.bytes,provider);
    }
    return f.fetch(address,options);
  };
  try {
    const issuer=create({githubReadToken:READ_ONLY_FAKE,runnerBrokerContext:()=>{supplied++;return context;}});
    const result=await issuer.issue(f.wire,f.nativeWindowWire);
    const again=await issuer.issue(f.wire,f.nativeWindowWire);
    assert.equal(again.blockers[0],'R7_OWNER_ISSUER_ALREADY_CONSUMED');
    return {result,supplied,requested};
  } finally {globalThis.fetch=prior;}
}
function held(out){assert.equal(out.result.classification,'R7_OWNER_ENVELOPE_ISSUANCE_HELD');
  assert.equal(Object.hasOwn(out.result,'envelope'),false);
  assert.equal(JSON.stringify(out).includes(FAKE),false);assert.equal(JSON.stringify(out).includes(JWT),false);}

for(const [prefix,purpose] of [[peerPrefix,peerPurpose],[provisioningPrefix,provisioningPurpose]])
test('actual '+purpose+' readback gates one bound broker request without claiming native adoption',async()=>{
  const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicExponent:65537}),f=setup(pair,prefix);
  const out=await run(f);
  assert.equal(out.result.classification,'R7_OWNER_ENCRYPTED_ENVELOPE_PREPARED_NATIVE_VERIFICATION_REQUIRED',JSON.stringify(out));
  assert.equal(out.supplied,1);assert.equal(out.requested,1);
  assert.equal(out.result.ownerPeerEnrollmentAuthenticated,true);assert.equal(out.result.providerBrokerResponseObserved,true);
  assert.equal(out.result.nativeOperationPurpose,purpose);
  assert.equal(out.result.peerApprovalComment,purpose+':'+out.result.peerBindingFingerprint);
  for(const flag of ['nativeOsDecisionAuthenticated','hostCustodyAuthenticated','ownerWorkflowSignatureVerified',
    'hostAdopted','rootEnrollmentAuthorized','serviceInstallationAuthorized','canonicalLeaseReleaseAuthorized'])assert.equal(out.result[flag],false);
  const parts=out.result.envelope.split('.');assert.equal(parts.length,5);
  assert.equal(JSON.stringify(out).includes(JWT),false);
  const [header,wrapped,iv,ciphertext,tag]=parts;
  assert.equal(JSON.parse(Buffer.from(header,'base64url')).aud,f.peer.challenge.Audience);
  const key=privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(wrapped,'base64url'));
  try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'),{authTagLength:16});
    decipher.setAAD(Buffer.from(header,'ascii'));decipher.setAuthTag(Buffer.from(tag,'base64url'));
    assert.equal(Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('ascii'),JWT);
  }finally{key.fill(0);}
});

test('cross-purpose approvals never request broker context even with the matching challenge fingerprint',async()=>{
  for(const [prefix,wrongPurpose] of [[provisioningPrefix,peerPurpose],[peerPrefix,provisioningPurpose]]){
    const f=setup(undefined,prefix);
    const out=await run(f,state=>{
      state.resources.get(API+'/actions/runs/789/approvals')[0].comment=wrongPurpose+':'+state.peer.pairing.fingerprint;
    });
    held(out);assert.equal(out.supplied,0);assert.equal(out.requested,0);
  }
});

test('a provision request discards its credential if the owner purpose changes after mint',async()=>{
  const out=await run(setup(undefined,provisioningPrefix),()=>{},f=>{
    f.resources.get(API+'/actions/runs/789/approvals')[0].comment=peerPurpose+':'+f.peer.pairing.fingerprint;
  });
  held(out);assert.equal(out.supplied,1);assert.equal(out.requested,1);
});

test('unapproved/ordinary-approved/wrong-run endpoints never map or request provider context',async()=>{
  for(const change of [
    f=>{f.resources.get(API+'/actions/runs/789/approvals')[0].comment='approved';},
    f=>{f.resources.get(API+'/actions/runs/789/approvals')[0].comment+=' ';},
    f=>{f.run.run_attempt=2;},
    f=>{f.resources.get(API+'/git/ref/heads/main').object.sha='e'.repeat(40);},
    f=>{f.resources.get(API+'/pulls/3178').merged=false;},
    f=>{f.nativeWindowWire=JSON.stringify({IssuedAtUtc:'2000-01-01T00:00:00.000Z',ExpiresAtUtc:'2000-01-01T00:05:00.000Z'});},
  ]) {const out=await run(setup(),change);held(out);assert.equal(out.supplied,0);assert.equal(out.requested,0);}
});

test('runtime broker origin is bounded independently of workflow inputs; no arbitrary credential exfiltration',()=>{
  const aud='fixture:audience';assert.equal(new URL(url(BROKER,aud)).searchParams.get('audience'),aud);
  for(const bad of [
    'http://vstoken.actions.githubusercontent.com/idtoken',
    'https://vstoken.actions.githubusercontent.com.evil.invalid/idtoken',
    'https://actions.githubusercontent.com/idtoken',
    'https://a.b.actions.githubusercontent.com/idtoken',
    'https://vstoken.actions.githubusercontent.com:444/idtoken',
    'https://user@vstoken.actions.githubusercontent.com/idtoken',
    'https://vstoken.actions.githubusercontent.com/idtoken#fragment',
    'https://vstoken.actions.githubusercontent.com/other',
    BROKER+'&audience=other',BROKER+'&audience=one&audience=two',
    'https://vstoken.actions.githubusercontent.com/a/../idtoken',
    'https://vstoken.actions.githubusercontent.com/%69dtoken',BROKER+'\n',
  ])assert.throws(()=>url(bad,aud),/R7_OWNER_BROKER_URL/);
});

test('changed authority after mint discards delivery without a second credential request',async()=>{
  for(const after of [
    f=>{f.resources.get(API+'/actions/runs/789/approvals')[0].comment='revoked';},
    f=>{f.resources.get(API+'/git/ref/heads/main').object.sha='e'.repeat(40);},
    f=>{f.ownerJob.status='completed';f.ownerJob.conclusion='failure';},
    f=>{f.resources.get(API+'/environments/operator-merge-approval').can_admins_bypass=true;},
  ]){const out=await run(setup(),()=>{},after);held(out);assert.equal(out.requested,1);}
});

test('provider redirects, invalid bodies and response bounds fail closed and never leak response bytes',async()=>{
  for(const change of [
    (f,p)=>{p.status=403;},(f,p)=>{p.redirected=true;},(f,p)=>{p.type='text/html';},
    (f,p)=>{p.bytes=Buffer.from('{"value":"'+JWT+'","other":"'+FAKE+'"}');},
    (f,p)=>{p.bytes=Buffer.from('{"value":"'+FAKE+'"}');},
    (f,p)=>{p.bytes=Buffer.from('broken '+FAKE);},
    (f,p)=>{p.bytes=Buffer.alloc(65537,65);},
    (f,p,c)=>{c.requestUrl='https://attacker.invalid/idtoken';},
    (f,p,c)=>{c.requestToken='bad\nheader';},
  ])held(await run(setup(),change));
});

test('no supplied receipt/boolean/transport override can replace internal actual source authentication',()=>{
  for(const options of [
    {githubReadToken:READ_ONLY_FAKE,runnerBrokerContext:{requestUrl:BROKER,requestToken:FAKE}},
    {githubReadToken:READ_ONLY_FAKE,runnerBrokerContext:()=>({}),ownerPeerEnrollmentAuthenticated:true},
    {githubReadToken:READ_ONLY_FAKE,runnerBrokerContext:()=>({}),fetch:()=>{}},
  ])assert.throws(()=>create(options),/R7_OWNER_ISSUER_CONTEXT/);
});
