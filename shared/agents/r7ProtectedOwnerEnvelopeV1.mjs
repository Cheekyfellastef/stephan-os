import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';
import { r7FirstRootRecipientSpkiDigest, R7_FIRST_ROOT_INTAKE_AUDIENCE,
  parseR7NativeOwnerAudience } from './r7FirstRootOwnerIntakeProposalV1.mjs';

// Encryption mechanics only. This neither authenticates a native challenge nor
// obtains an OIDC credential. The protected producer must authenticate the native
// handoff before requesting a real credential. RSA possession is not admission.
export const R7_OWNER_ENVELOPE_TYPE = 'stephanos.r7-first-root-owner-token.v1';
export const R7_OWNER_ENVELOPE_AUDIENCE = R7_FIRST_ROOT_INTAKE_AUDIENCE;
export const R7_OWNER_ENVELOPE_MAX_PLAINTEXT_BYTES = 32768;
export const R7_OWNER_ENVELOPE_MAX_CHARACTERS = 49152;

const fail = code => { throw new Error('R7_OWNER_ENVELOPE_' + code); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
const stamp = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

function dataRecord(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).length !== names.length) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return names.every(name => Object.hasOwn(descriptors, name)
    && Object.hasOwn(descriptors[name], 'value') && descriptors[name].enumerable);
}

// Same five public fields as OriginalR7OwnerTransportChallenge. Validity here
// means consistency of UNTRUSTED transport inputs, never native authentication.
export function describeR7UntrustedOwnerEnvelopeChallenge(challenge, expectedPermitSha256) {
  if (!dataRecord(challenge, ['Audience', 'PublicSpkiBase64', 'PublicSpkiSha256', 'IssuedAtUtc', 'ExpiresAtUtc'])
      || !hex(expectedPermitSha256) || !hex(challenge.PublicSpkiSha256)) fail('CHALLENGE_SHAPE');
  const audience = challenge.Audience;
  const binding = parseR7NativeOwnerAudience(audience);
  if (!binding || binding.permitSha256 !== expectedPermitSha256
      || binding.recipientSpkiSha256 !== challenge.PublicSpkiSha256) fail('CHALLENGE_BINDING');
  if (!stamp(challenge.IssuedAtUtc) || !stamp(challenge.ExpiresAtUtc)
      || Date.parse(challenge.ExpiresAtUtc) <= Date.parse(challenge.IssuedAtUtc)
      || Date.parse(challenge.ExpiresAtUtc) - Date.parse(challenge.IssuedAtUtc) > 300000) fail('CHALLENGE_VALIDITY');
  const encoded = challenge.PublicSpkiBase64;
  const recipientDigest=r7FirstRootRecipientSpkiDigest(encoded);
  if(!recipientDigest||recipientDigest!==challenge.PublicSpkiSha256)fail('RECIPIENT_BINDING');
  const der = Buffer.from(encoded, 'base64');
  let key;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    // Profile and canonical DER were already validated by the shared intake
    // predicate above. Instantiate the same public key for encryption only.
  } catch { fail('RECIPIENT_PROFILE'); }
  return Object.freeze({
    audience, nativeOperationPurpose: binding.purpose, recipientSpkiSha256: challenge.PublicSpkiSha256,
    expiresAtUtc: challenge.ExpiresAtUtc, key,
    nativeEndpointAuthenticated: false, hostAdopted: false,
    rootEnrollmentAuthorized: false, canonicalLeaseReleaseAuthorized: false,
  });
}

// A producer must check the original window with its actual current clock.
// The descriptive encoder above is also used for non-live cross-language
// vectors; it deliberately cannot claim freshness or endpoint authentication.
export function inspectR7UntrustedOwnerEnvelopeChallenge(challenge, expectedPermitSha256) {
  const inspected=describeR7UntrustedOwnerEnvelopeChallenge(challenge,expectedPermitSha256);
  const now=Date.now();
  if(Date.parse(challenge.IssuedAtUtc)>now||Date.parse(challenge.ExpiresAtUtc)<=now)fail('CHALLENGE_VALIDITY');
  return inspected;
}

export function encryptR7OwnerEnvelopeForUntrustedChallenge(challenge, expectedPermitSha256, ownerJwt) {
  let plaintext, contentKey;
  try {
    const inspected = inspectR7UntrustedOwnerEnvelopeChallenge(challenge, expectedPermitSha256);
    if (typeof ownerJwt !== 'string' || ownerJwt.length < 32
        || ownerJwt.length > R7_OWNER_ENVELOPE_MAX_PLAINTEXT_BYTES
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ownerJwt)) fail('COMPACT_CREDENTIAL_REQUIRED');
    plaintext = Buffer.from(ownerJwt, 'ascii');
    // Exact order/ASCII wire is shared with the reviewed native Header method.
    const header = Buffer.from(JSON.stringify({
      alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: inspected.recipientSpkiSha256,
      typ: R7_OWNER_ENVELOPE_TYPE, aud: inspected.audience,
    }), 'ascii').toString('base64url');
    contentKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', contentKey, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(header, 'ascii'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrapped = publicEncrypt({ key: inspected.key, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256' }, contentKey);
    const envelope = [header, wrapped.toString('base64url'), iv.toString('base64url'),
      ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    if (wrapped.length !== 256 || envelope.length > R7_OWNER_ENVELOPE_MAX_CHARACTERS) fail('ENVELOPE_BOUND');
    return envelope;
  } catch (error) {
    if (error instanceof Error && /^R7_OWNER_ENVELOPE_[A-Z_]+$/.test(error.message)) throw error;
    fail('ENCRYPTION_FAILED');
  } finally {
    // Clear owned plaintext/key buffers. JS strings and provider scratch memory
    // are not claimed to be hardware-erased. No credential is logged or stored.
    plaintext?.fill(0);
    contentKey?.fill(0);
  }
}
