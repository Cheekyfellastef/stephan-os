import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash,generateKeyPairSync } from 'node:crypto';
import { buildR7NativeOwnerPeerPairing as build, matchesR7OwnerPeerEnrollmentComment as matches,
  R7_NATIVE_OWNER_PAIRING_FIELDS } from './r7NativeOwnerPeerPairingV1.mjs';
import { inspectR7UntrustedOwnerEnvelopeChallenge } from './r7ProtectedOwnerEnvelopeV1.mjs';
import { R7_FIRST_ROOT_INTAKE_AUDIENCE as peerPrefix, R7_FIRST_ROOT_PEER_PURPOSE as peerPurpose,
  R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE as provisioningPrefix,
  R7_INACTIVE_ROOT_PROVISIONING_PURPOSE as provisioningPurpose } from './r7FirstRootOwnerIntakeProposalV1.mjs';
const f=JSON.parse(readFileSync(new URL('./r7NativeOwnerPeerPairingV1.fixture.json',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('exact twelve-field UTF8 wire and domain-separated golden fingerprint match the native contract',()=>{
  const p=build(f.challenge,f.context);
  assert.equal(p.wire,f.expectedWire);assert.equal(Buffer.byteLength(p.wire),892);
  assert.equal(p.fingerprint,'442ba74864242c8139ee8e760d6846ba4646c585980aa557ff73c770d29cb22b');
  assert.equal(p.approvalComment,f.expectedComment);assert.equal(p.runUrl,f.expectedRunUrl);
  assert.deepEqual(Object.keys(JSON.parse(p.wire)),[...R7_NATIVE_OWNER_PAIRING_FIELDS]);
  assert.ok(Object.values(JSON.parse(p.wire)).every(value=>typeof value==='string'));
  assert.equal(p.nativeEndpointAuthenticated,false);assert.equal(p.ownerEnrollmentAuthenticated,false);
  assert.equal(p.osConsentProven,false);assert.equal(p.hostPolicyAdopted,false);
  assert.equal(p.rootEnrollmentAuthorized,false);assert.equal(p.canonicalLeaseReleaseAuthorized,false);
});

test('inactive-root provisioning has a separate native golden and cannot inherit peer-only approval',()=>{
  const peer=build(f.challenge,f.context);
  const challenge={...f.challenge,Audience:f.challenge.Audience.replace(peerPrefix,provisioningPrefix)};
  const provision=build(challenge,f.context);
  assert.equal(provision.values.purpose,provisioningPurpose);
  assert.equal(provision.wire,f.expectedWire.replace(peerPurpose,provisioningPurpose).replace(peerPrefix,provisioningPrefix));
  assert.equal(Buffer.byteLength(provision.wire),899);
  assert.equal(provision.fingerprint,'4bb41bf002c2631316e413587d60ed20cf8e99d42d027610479961c5983587ba');
  assert.equal(provision.approvalComment,provisioningPurpose+':'+provision.fingerprint);
  assert.equal(matches(provision.approvalComment,provision),true);
  assert.notEqual(provision.fingerprint,peer.fingerprint);
  for(const [text,proposal] of [[peer.approvalComment,provision],[provision.approvalComment,peer],
    [peerPurpose+':'+provision.fingerprint,provision],[provisioningPurpose+':'+peer.fingerprint,peer]])
    assert.equal(matches(text,proposal),false);
  for(const flag of ['nativeEndpointAuthenticated','ownerEnrollmentAuthenticated','osConsentProven',
    'hostPolicyAdopted','rootEnrollmentAuthorized','canonicalLeaseReleaseAuthorized'])assert.equal(provision[flag],false);
});

test('purpose aliases and caller-made transcripts cannot select the inactive-root operation',()=>{
  const p=build(f.challenge,f.context);
  for(const audience of [
    f.challenge.Audience.replace(peerPrefix,provisioningPrefix.toUpperCase()),
    f.challenge.Audience.replace(peerPrefix,peerPrefix+provisioningPrefix),
    f.challenge.Audience.replace(peerPrefix,provisioningPrefix+'peer:'),
    f.challenge.Audience.replace(peerPrefix,provisioningPrefix.replace(':v1:',':v10:')),
  ])assert.throws(()=>build({...f.challenge,Audience:audience},f.context));
  assert.throws(()=>build({...f.challenge,purpose:provisioningPurpose},f.context));
  assert.throws(()=>build(f.challenge,{...f.context,purpose:provisioningPurpose}));
  assert.equal(matches(p.approvalComment,{...p}),false);
  assert.equal(matches(provisioningPurpose+':'+p.fingerprint,{...p,
    values:{...p.values,purpose:provisioningPurpose},approvalComment:provisioningPurpose+':'+p.fingerprint}),false);
  assert.equal(matches(p.approvalComment,{fingerprint:p.fingerprint}),false);
  assert.equal(matches(p.approvalComment,null),false);
});

test('source/run/permit/nonce/key/time changes alter the enrolled peer rather than inheriting its decision',()=>{
  const first=build(f.challenge,f.context);
  const variants=[
    [{...f.challenge},{...f.context,runId:'123456789013'}],
    [{...f.challenge},{...f.context,expectedMain:'e'.repeat(40)}],
    [{...f.challenge,Audience:f.challenge.Audience.replace(f.context.permitSha256,'d'.repeat(64))},{...f.context,permitSha256:'d'.repeat(64)}],
    [{...f.challenge,Audience:f.challenge.Audience.replace('c'.repeat(64),'e'.repeat(64))},{...f.context}],
    [{...f.challenge,IssuedAtUtc:'2026-10-21T21:30:00.001Z'},{...f.context}],
    [{...f.challenge,ExpiresAtUtc:'2026-10-21T21:34:59.999Z'},{...f.context}],
  ];
  const key=generateKeyPairSync('rsa',{modulusLength:2048,publicExponent:65537}).publicKey;
  const der=key.export({format:'der',type:'spki'}),kid=sha(der);
  variants.push([{...f.challenge,PublicSpkiBase64:der.toString('base64'),PublicSpkiSha256:kid,
    Audience:f.challenge.Audience.replace(f.challenge.PublicSpkiSha256,kid)},{...f.context}]);
  for(const [challenge,context] of variants){const changed=build(challenge,context);
    assert.notEqual(changed.fingerprint,first.fingerprint);assert.equal(matches(first.approvalComment,changed),false);}
});

test('comment syntax is exact endpoint enrollment only; whitespace, aliases and replayed fingerprints fail',()=>{
  const p=build(f.challenge,f.context);assert.equal(matches(p.approvalComment,p),true);
  for(const text of [' '+p.approvalComment,p.approvalComment+'\n',p.approvalComment.toLowerCase(),
    p.approvalComment.replace(p.fingerprint,p.fingerprint.toUpperCase()),'approved',
    'PHYSICAL_CUSTODY_VERIFIED:'+p.fingerprint])assert.equal(matches(text,p),false);
  // Matching text is deliberately NOT an authenticated owner or OS decision.
  assert.equal(p.ownerEnrollmentAuthenticated,false);assert.equal(p.osConsentProven,false);
});

test('context encoding has closed data fields, exact attempt and bounded positive u64 identity',()=>{
  for(const changes of [{runAttempt:'2'},{runAttempt:1},{runId:'0'},{runId:'01'},
    {runId:'18446744073709551616'},{runId:789},{expectedMain:'0'.repeat(40)},
    {permitSha256:'A'.repeat(64)},{extraField:'true'}])assert.throws(()=>build(f.challenge,{...f.context,...changes}));
  assert.equal(build(f.challenge,{...f.context,runId:'18446744073709551615'}).values.runId,'18446744073709551615');
  let read=false;const getter={...f.context};Object.defineProperty(getter,'runId',{enumerable:true,get(){read=true;return f.context.runId;}});
  assert.throws(()=>build(f.challenge,getter));assert.equal(read,false);
});

test('SPKI/audience semantic validation precedes hashing; old windows are vectors, never freshness proof',()=>{
  assert.throws(()=>build({...f.challenge,PublicSpkiBase64:f.challenge.PublicSpkiBase64+'\n'},f.context));
  assert.throws(()=>build({...f.challenge,PublicSpkiSha256:'d'.repeat(64)},f.context));
  assert.throws(()=>build({...f.challenge,ExpiresAtUtc:'2026-10-21T21:35:00.001Z'},f.context));
  assert.throws(()=>build({...f.challenge,IssuedAtUtc:'2026-10-21T21:30:00Z'},f.context));
  const old={...f.challenge,IssuedAtUtc:'2001-01-01T00:00:00.000Z',ExpiresAtUtc:'2001-01-01T00:05:00.000Z'};
  assert.equal(build(old,f.context).nativeEndpointAuthenticated,false);
  assert.throws(()=>inspectR7UntrustedOwnerEnvelopeChallenge(old,f.context.permitSha256));
});
