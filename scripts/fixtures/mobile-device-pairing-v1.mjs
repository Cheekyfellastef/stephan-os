// Test-only real ES256/CBOR producer. Never included in a production closure.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mobileDevicePairingCreateOptionsV1, mobileDevicePairingSetupDescriptorV1 }
  from '../../shared/agents/battleBridgeMobileInstallationV1.mjs';

const hash = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
function head(major, size) {
  if (size < 24) return Buffer.from([major * 32 + size]);
  if (size < 256) return Buffer.from([major * 32 + 24, size]);
  if (size < 65536) { const out = Buffer.alloc(3); out[0] = major * 32 + 25; out.writeUInt16BE(size, 1); return out; }
  const out = Buffer.alloc(5); out[0] = major * 32 + 26; out.writeUInt32BE(size, 1); return out;
}
export function encodeMobileDevicePairingCborFixtureV1(value) {
  const encode = encodeMobileDevicePairingCborFixtureV1;
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const raw = Buffer.from(value); return Buffer.concat([head(3, raw.length), raw]); }
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, child]) => [encode(key), encode(child)])]);
  throw Error('UNSUPPORTED_PAIRING_FIXTURE_CBOR_VALUE');
}

export function makeMobileDevicePairingFixtureV1(context, {
  nowMs = Date.now(), registrationCounter = 0, keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  credentialId = Buffer.alloc(32, 7),
} = {}) {
  const cbor = encodeMobileDevicePairingCborFixtureV1, options = { nowMs };
  const publicKeyJwk = keyPair.publicKey.export({ format: 'jwk' });
  const defaultCose = () => new Map([[1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(publicKeyJwk.x, 'base64url')], [-3, Buffer.from(publicKeyJwk.y, 'base64url')]]);
  function makeRegistration({ ctx = context, client = {}, rawClient, rp = ctx.rpId, flags = 0x45, count = registrationCounter,
    credential = credentialId, cose = defaultCose(), coseWire, authSuffix = Buffer.alloc(0), attestation,
    fmt = 'none', attStmt = new Map(), attestationExtra = [] } = {}) {
    const fixed = Buffer.alloc(55); hash(rp).copy(fixed); fixed[32] = flags; fixed.writeUInt32BE(count, 33); fixed.writeUInt16BE(credential.length, 53);
    const auth = Buffer.concat([fixed, credential, coseWire ?? cbor(cose), authSuffix]);
    const clientBytes = Buffer.from(rawClient ?? JSON.stringify({ type: 'webauthn.create',
      challenge: mobileDevicePairingCreateOptionsV1(ctx, options).publicKey?.challenge, origin: ctx.origin, crossOrigin: false, ...client }));
    return { type: 'public-key', id: b64(credential), rawId: b64(credential), response: { clientDataJSON: b64(clientBytes),
      attestationObject: b64(attestation ?? cbor(new Map([['fmt', fmt], ['authData', auth], ['attStmt', attStmt], ...attestationExtra]))) } };
  }
  const registration = makeRegistration();
  function assertion({ ctx = context, reg = registration, client = {}, rawClient, rp = ctx.rpId, flags = 5,
    counter = registrationCounter === 0 ? 0 : Math.min(0xffffffff, registrationCounter + 1), count = counter,
    key = keyPair.privateKey, userHandle = ctx.userHandle } = {}) {
    const prepared = mobileDevicePairingSetupDescriptorV1(ctx, reg, options);
    if (!prepared.ok) throw Error('PAIRING_FIXTURE_SETUP_DESCRIPTOR_REFUSED:' + prepared.blockers.join(','));
    const clientBytes = Buffer.from(rawClient ?? JSON.stringify({ type: 'webauthn.get', challenge: prepared.publicKey.challenge,
      origin: ctx.origin, crossOrigin: false, ...client }));
    const auth = Buffer.alloc(37); hash(rp).copy(auth); auth[32] = flags; auth.writeUInt32BE(count, 33);
    return { type: 'public-key', id: reg.id, rawId: reg.rawId, response: { clientDataJSON: b64(clientBytes),
      authenticatorData: b64(auth), signature: sign('sha256', Buffer.concat([auth, hash(clientBytes)]), key).toString('base64url'), userHandle } };
  }
  return { registration, assertion, makeRegistration, publicKeyJwk,
    publicKeySpki: keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    credentialId: registration.id, registrationCounter };
}
