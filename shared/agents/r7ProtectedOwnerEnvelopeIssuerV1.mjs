import { createHash } from 'node:crypto';
import { createR7ProtectedOwnerSourceReadback, r7OwnerPeerFromSourceInput } from './r7ProtectedOwnerSourceReadbackV1.mjs';
import { encryptR7OwnerEnvelopeForUntrustedChallenge, inspectR7UntrustedOwnerEnvelopeChallenge } from './r7ProtectedOwnerEnvelopeV1.mjs';
import { readBoundedPersonalRepositoryResponseBody } from './operatorPersonalRepositoryMergeV1.mjs';

// Candidate policy implementation, not an installed authority. The fixed trusted
// Actions caller maps its runner-supplied broker context ONLY after the actual
// current source/owner enrollment readback. Caller booleans/receipts never grant
// permission. Native signature verification and a separate native OS decision
// remain mandatory; this transport cannot attest custody or enroll a root.
const fail=code=>{throw new Error(code);};
const need=(condition,code)=>{if(!condition)fail(code);};
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const FALSE_AUTHORITY=Object.freeze({nativeOsDecisionAuthenticated:false,hostCustodyAuthenticated:false,
  ownerWorkflowSignatureVerified:false,hostAdopted:false,rootEnrollmentAuthorized:false,
  serviceInstallationAuthorized:false,canonicalLeaseReleaseAuthorized:false});
const response=(classification,blocker,extra={})=>Object.freeze({schemaVersion:'stephanos.r7-protected-owner-envelope-issuer.v1',
  classification,blockers:[blocker],...FALSE_AUTHORITY,...extra});

export function r7OwnerBrokerRequestUrl(runtimeUrl,audience) {
  need(typeof runtimeUrl==='string'&&runtimeUrl.length<=4096&&/^[\x21-\x7e]+$/.test(runtimeUrl),
    'R7_OWNER_BROKER_URL');
  let url;try{url=new URL(runtimeUrl);}catch{fail('R7_OWNER_BROKER_URL');}
  // The runner, not workflow inputs, supplies GenerateIdTokenUrl. Restrict its
  // service namespace as an additional defense; redirects are never followed.
  need(url.href===runtimeUrl&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash
    &&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.actions\.githubusercontent\.com$/.test(url.hostname)
    &&/^\/[A-Za-z0-9_./-]+$/.test(url.pathname)&&/(?:^|\/)idtoken(?:\/|$)/i.test(url.pathname)
    &&url.searchParams.getAll('audience').length===0, 'R7_OWNER_BROKER_URL');
  need(typeof audience==='string'&&audience.length<=512&&/^[\x21-\x7e]+$/.test(audience),'R7_OWNER_BROKER_AUDIENCE');
  url.searchParams.append('audience',audience);
  return url.href;
}

export function createR7ProtectedOwnerEnvelopeIssuer(options={}) {
  need(options&&Object.keys(options).sort().join('|')==='githubReadToken|runnerBrokerContext'
    &&typeof options.runnerBrokerContext==='function','R7_OWNER_ISSUER_CONTEXT');
  const source=createR7ProtectedOwnerSourceReadback({githubReadToken:options.githubReadToken});
  const brokerContext=options.runnerBrokerContext;
  const request=globalThis.fetch.bind(globalThis);
  let consumed=false;
  return Object.freeze({async issue(wire,nativeWindowWire) {
    if(consumed)return response('R7_OWNER_ENVELOPE_ISSUANCE_HELD','R7_OWNER_ISSUER_ALREADY_CONSUMED');
    // Terminal even when the response/transport result is unknown. No automatic
    // replay or alternate provider attempt may mint another credential.
    consumed=true;
    let body;
    try {
      const input=JSON.parse(wire),peer=r7OwnerPeerFromSourceInput(input,nativeWindowWire);
      const before=await source.authorizePeer(wire,nativeWindowWire);
      need(before.ownerPeerEnrollmentAuthenticated===true
        &&before.classification==='R7_OWNER_EPHEMERAL_PEER_ENROLLMENT_AUTHENTICATED_NATIVE_DECISION_REQUIRED'
        &&before.inputSha256===digest(wire)&&before.peerBindingFingerprint===peer.pairing.fingerprint
        &&before.nativeOperationPurpose===peer.pairing.values.purpose,
      'R7_OWNER_ACTUAL_PEER_ENROLLMENT_REQUIRED');
      inspectR7UntrustedOwnerEnvelopeChallenge(peer.challenge,input.permitSha256);
      // This callback is the trusted wrapper's explicit runner mapping. It is
      // deliberately invoked after admission, and is not an authority issuer.
      const runtime=brokerContext();
      need(runtime&&Object.keys(runtime).sort().join('|')==='requestToken|requestUrl'
        &&typeof runtime.requestToken==='string'&&runtime.requestToken.length>=8
        &&runtime.requestToken.length<=16384&&/^[\x21-\x7e]+$/.test(runtime.requestToken),
      'R7_OWNER_BROKER_CONTEXT');
      const url=r7OwnerBrokerRequestUrl(runtime.requestUrl,peer.challenge.Audience);
      const received=await request(url,{method:'GET',redirect:'manual',
        headers:{Accept:'application/json',Authorization:'Bearer '+runtime.requestToken},signal:AbortSignal.timeout(10000)});
      try {
        need(received.status===200&&received.url===url&&received.redirected===false,'R7_OWNER_BROKER_RESPONSE');
        need(/^application\/json(?:;|$)/i.test(received.headers.get('content-type')||''),'R7_OWNER_BROKER_MEDIA');
        const length=received.headers.get('content-length');
        need(length===null||(/^[0-9]+$/.test(length)&&Number(length)<=65536),'R7_OWNER_BROKER_BODY_BOUND');
        body=await readBoundedPersonalRepositoryResponseBody(received,65536);
        const object=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
        need(object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).join('|')==='value'
          &&typeof object.value==='string'&&object.value.length>=32&&object.value.length<=32768
          &&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(object.value),'R7_OWNER_BROKER_COMPACT_RESPONSE');
        // Re-read the actual authority after the credential request. Failure or
        // main/owner/environment movement discards delivery, never retries mint.
        const after=await source.authorizePeer(wire,nativeWindowWire);
        need(after.ownerPeerEnrollmentAuthenticated===true&&after.inputSha256===before.inputSha256
          &&after.peerBindingFingerprint===before.peerBindingFingerprint
          &&after.nativeOperationPurpose===before.nativeOperationPurpose
          &&after.protectedOwnerBindingSha256===before.protectedOwnerBindingSha256,
        'R7_OWNER_ENROLLMENT_CHANGED_AFTER_REQUEST');
        const envelope=encryptR7OwnerEnvelopeForUntrustedChallenge(peer.challenge,input.permitSha256,object.value);
        return response('R7_OWNER_ENCRYPTED_ENVELOPE_PREPARED_NATIVE_VERIFICATION_REQUIRED',
          'R7_NATIVE_SIGNATURE_OS_DECISION_AND_CUSTODY_REQUIRED',{
            ownerPeerEnrollmentAuthenticated:true,providerBrokerResponseObserved:true,
            nativeOperationPurpose:peer.pairing.values.purpose,
            peerBindingFingerprint:peer.pairing.fingerprint,peerApprovalComment:peer.pairing.approvalComment,
            peerRunUrl:peer.pairing.runUrl,inputSha256:before.inputSha256,
            protectedOwnerBindingSha256:before.protectedOwnerBindingSha256,
            envelopeSha256:digest(envelope),nativeChallengeExpiresAtUtc:peer.challenge.ExpiresAtUtc,envelope,
          });
      } finally {try{await received.body?.cancel();}catch{}}
    } catch {
      // No provider response, request URL, credential, arbitrary exception or
      // unverified caller content enters logs or failure artifacts.
      return response('R7_OWNER_ENVELOPE_ISSUANCE_HELD','R7_OWNER_ENVELOPE_ISSUANCE_FAILED_CLOSED');
    } finally {body?.fill(0);}
  }});
}
