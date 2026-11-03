import { createHash } from 'node:crypto';
import { R7_FIRST_ROOT_INTAKE_WORKFLOW, R7_FIRST_ROOT_PEER_PURPOSE } from './r7FirstRootOwnerIntakeProposalV1.mjs';
import { describeR7UntrustedOwnerEnvelopeChallenge } from './r7ProtectedOwnerEnvelopeV1.mjs';

// Explicit endpoint-enrollment proposal, not an already adopted host policy.
// Neither this transcript nor its hash authenticates an OS process or consent.
export const R7_NATIVE_OWNER_PAIRING_SCHEMA='stephanos.r7-native-owner-peer-pairing.v1';
export const R7_NATIVE_OWNER_PAIRING_DOMAIN='stephanos.r7.native-owner-peer-pairing.v1\0';
export const R7_NATIVE_OWNER_PAIRING_PURPOSE=R7_FIRST_ROOT_PEER_PURPOSE;
export const R7_NATIVE_OWNER_PAIRING_FIELDS=Object.freeze(['schemaVersion','purpose','repository',
  'workflowRef','expectedMain','runId','runAttempt','permitSha256','nativeAudience',
  'nativeRecipientSpkiSha256','nativeIssuedAtUtc','nativeExpiresAtUtc']);
const hex=(value,length)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value)&&!/^0+$/.test(value);
const fail=()=>{throw new Error('R7_NATIVE_OWNER_PAIRING_BINDING_INVALID');};
const builtPairings=new WeakSet();

// Use a retained native challenge and actual run context at a real boundary.
// Offline fixtures may encode expired windows; freshness must be checked again
// before owner enrollment, credential request and native one-use consumption.
export function buildR7NativeOwnerPeerPairing(challenge,context) {
  const keys=['expectedMain','runId','runAttempt','permitSha256'];
  if(!context||typeof context!=='object'||Array.isArray(context)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(context))
    ||Reflect.ownKeys(context).length!==keys.length)fail();
  const descriptors=Object.getOwnPropertyDescriptors(context);
  if(!keys.every(key=>Object.hasOwn(descriptors,key)&&Object.hasOwn(descriptors[key],'value')&&descriptors[key].enumerable))fail();
  if(!hex(context.expectedMain,40)||!hex(context.permitSha256,64)||context.runAttempt!=='1'
    ||typeof context.runId!=='string'||!/^[1-9][0-9]{0,19}$/.test(context.runId)
    ||BigInt(context.runId)>18446744073709551615n)fail();
  const described=describeR7UntrustedOwnerEnvelopeChallenge(challenge,context.permitSha256);
  const values=Object.freeze({
    schemaVersion:R7_NATIVE_OWNER_PAIRING_SCHEMA,purpose:described.nativeOperationPurpose,
    repository:'Cheekyfellastef/stephan-os',workflowRef:R7_FIRST_ROOT_INTAKE_WORKFLOW,
    expectedMain:context.expectedMain,runId:context.runId,runAttempt:context.runAttempt,
    permitSha256:context.permitSha256,nativeAudience:described.audience,
    nativeRecipientSpkiSha256:described.recipientSpkiSha256,
    nativeIssuedAtUtc:challenge.IssuedAtUtc,nativeExpiresAtUtc:challenge.ExpiresAtUtc,
  });
  const wire=JSON.stringify(values);
  if(!Object.values(values).every(value=>typeof value==='string'&&/^[\x20-\x7e]+$/.test(value))
    ||Object.keys(values).join('|')!==R7_NATIVE_OWNER_PAIRING_FIELDS.join('|'))fail();
  const fingerprint=createHash('sha256').update(R7_NATIVE_OWNER_PAIRING_DOMAIN,'ascii').update(wire,'utf8').digest('hex');
  const pairing=Object.freeze({wire,fingerprint,
    approvalComment:values.purpose+':'+fingerprint,
    runUrl:'https://github.com/Cheekyfellastef/stephan-os/actions/runs/'+context.runId+'/attempts/1',
    values,nativeEndpointAuthenticated:false,ownerEnrollmentAuthenticated:false,
    osConsentProven:false,hostPolicyAdopted:false,rootEnrollmentAuthorized:false,
    canonicalLeaseReleaseAuthorized:false,
  });
  builtPairings.add(pairing);
  return pairing;
}

// Match only after the caller has authenticated the actual owner and current
// protected-environment review via authoritative GitHub records. Text alone is
// not a decision, native proof or grant; no normalization/aliases are accepted.
export function matchesR7OwnerPeerEnrollmentComment(actual,pairing) {
  // Only this module's immutable, validated transcript is accepted. A supplied
  // purpose, altered clone or fingerprint alone cannot select an operation.
  return typeof actual==='string'&&builtPairings.has(pairing)
    &&actual===pairing.approvalComment;
}
