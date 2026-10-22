import assert from 'node:assert/strict';
import test from 'node:test';
import { constants, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { R7_OWNER_ENVELOPE_AUDIENCE, R7_OWNER_ENVELOPE_TYPE,
  encryptR7OwnerEnvelopeForUntrustedChallenge as encrypt,
  inspectR7UntrustedOwnerEnvelopeChallenge as inspect } from './r7ProtectedOwnerEnvelopeV1.mjs';
import { R7_FIRST_ROOT_PEER_PURPOSE, R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE,
  R7_INACTIVE_ROOT_PROVISIONING_PURPOSE } from './r7FirstRootOwnerIntakeProposalV1.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const permit = sha('disposable-fixture-permit-only'), nonce = sha('disposable-fixture-nonce-only');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
const der = pair.publicKey.export({ format: 'der', type: 'spki' });
const kid = sha(der), now = Date.now();
const challenge = {
  Audience: R7_OWNER_ENVELOPE_AUDIENCE + [permit, nonce, kid].join(':'),
  PublicSpkiBase64: der.toString('base64'), PublicSpkiSha256: kid,
  IssuedAtUtc: new Date(now - 1000).toISOString(), ExpiresAtUtc: new Date(now + 240000).toISOString(),
};
const credential = ['eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  Buffer.from('{"fixture":true,"neverAnAuthenticCredential":true}').toString('base64url'),
  Buffer.alloc(256, 0x53).toString('base64url')].join('.');
function decrypt(envelope, privateKey = pair.privateKey, expected = challenge) {
  const [header, wrapped, iv, ciphertext, tag] = envelope.split('.');
  assert.equal(header, Buffer.from(JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM',
    kid: expected.PublicSpkiSha256, typ: R7_OWNER_ENVELOPE_TYPE, aud: expected.Audience }), 'ascii').toString('base64url'));
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256' }, Buffer.from(wrapped, 'base64url'));
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    d.setAAD(Buffer.from(header, 'ascii')); d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ciphertext, 'base64url')), d.final()]).toString('ascii');
  } finally { key.fill(0); }
}

test('purpose/recipient-bound compact JWE round trips a disposable credential, without an authority grant', () => {
  const packet = encrypt(challenge, permit, credential), facts = inspect(challenge, permit);
  assert.equal(decrypt(packet), credential);
  assert.equal(packet.includes(credential), false);
  assert.equal(facts.nativeEndpointAuthenticated, false);
  assert.equal(facts.hostAdopted, false);
  assert.equal(facts.rootEnrollmentAuthorized, false);
  assert.equal(facts.canonicalLeaseReleaseAuthorized, false);
  assert.equal(facts.nativeOperationPurpose, R7_FIRST_ROOT_PEER_PURPOSE);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(packet.split('.')[0], 'base64url'))), ['alg','enc','kid','typ','aud']);
});

test('provisioning envelope authenticates its distinct audience; an old envelope cannot be relabeled', () => {
  const provision={...challenge,Audience:challenge.Audience.replace(R7_OWNER_ENVELOPE_AUDIENCE,R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE)};
  const packet=encrypt(provision,permit,credential), facts=inspect(provision,permit);
  assert.equal(facts.nativeOperationPurpose,R7_INACTIVE_ROOT_PROVISIONING_PURPOSE);
  assert.equal(decrypt(packet,pair.privateKey,provision),credential);
  assert.throws(()=>decrypt(packet,pair.privateKey,challenge));
  const oldPacket=encrypt(challenge,permit,credential);
  assert.throws(()=>decrypt(oldPacket,pair.privateKey,provision));
  const altered=oldPacket.split('.');
  altered[0]=packet.split('.')[0];
  assert.throws(()=>decrypt(altered.join('.'),pair.privateKey,provision));
  for(const flag of ['nativeEndpointAuthenticated','hostAdopted','rootEnrollmentAuthorized','canonicalLeaseReleaseAuthorized'])
    assert.equal(facts[flag],false);
  for(const Audience of [provision.Audience+'\n',provision.Audience+':extra',
    provision.Audience.replace(R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE,R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE+R7_OWNER_ENVELOPE_AUDIENCE)])
    assert.throws(()=>encrypt({...provision,Audience},permit,credential));
});

test('each envelope uses independent AEAD key and IV material', () => {
  const first = encrypt(challenge, permit, credential), next = encrypt(challenge, permit, credential);
  assert.notEqual(first, next); assert.notEqual(first.split('.')[1], next.split('.')[1]);
  assert.notEqual(first.split('.')[2], next.split('.')[2]); assert.equal(decrypt(next), credential);
});

test('altering ciphertext, tag, header, or recipient cannot recover the credential', () => {
  const packet = encrypt(challenge, permit, credential);
  for (const index of [0, 1, 2, 3, 4]) {
    const parts = packet.split('.'), bytes = Buffer.from(parts[index], 'base64url');
    bytes[0] ^= 1; parts[index] = bytes.toString('base64url');
    assert.throws(() => decrypt(parts.join('.')));
  }
  const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => decrypt(packet, wrong.privateKey));
});

test('whole-challenge and permit/nonce/recipient bindings reject substitution and zero identities', () => {
  for (const c of [
    { ...challenge, Audience: challenge.Audience.replace(permit, sha('different-permit')) },
    { ...challenge, Audience: challenge.Audience.replace(nonce, '0'.repeat(64)) },
    { ...challenge, Audience: challenge.Audience.replace(kid, sha('different-kid')) },
    { ...challenge, PublicSpkiSha256: sha('different-key') },
    { ...challenge, Audience: challenge.Audience.replace(R7_OWNER_ENVELOPE_AUDIENCE, 'other-purpose:') },
    { ...challenge, PublicSpkiBase64: challenge.PublicSpkiBase64 + '\n' },
    { ...challenge, PublicSpkiBase64: challenge.PublicSpkiBase64.replace(/=+$/, '') + '=' },
    { ...challenge, AdditionalAuthority: true },
  ]) assert.throws(() => encrypt(c, permit, credential), /^Error: R7_OWNER_ENVELOPE_/);
  assert.throws(() => encrypt(challenge, '0'.repeat(64), credential));
});

test('non-RSA2048/65537 and alternate DER encodings are refused', () => {
  for (const options of [{ modulusLength: 1024 }, { modulusLength: 3072 }, { modulusLength: 2048, publicExponent: 3 }]) {
    const keys = generateKeyPairSync('rsa', options), bytes = keys.publicKey.export({ format: 'der', type: 'spki' });
    const hash = sha(bytes), c = { ...challenge, PublicSpkiBase64: bytes.toString('base64'), PublicSpkiSha256: hash,
      Audience: R7_OWNER_ENVELOPE_AUDIENCE + [permit, nonce, hash].join(':') };
    assert.throws(() => encrypt(c, permit, credential), /^Error: R7_OWNER_ENVELOPE_/);
  }
  const bytes = Buffer.concat([der, Buffer.from([0])]), hash = sha(bytes);
  assert.throws(() => encrypt({ ...challenge, PublicSpkiBase64: bytes.toString('base64'), PublicSpkiSha256: hash,
    Audience: R7_OWNER_ENVELOPE_AUDIENCE + [permit,nonce,hash].join(':') }, permit, credential));
});

test('expired, future, malformed, over-five-minute and reversed challenges hold', () => {
  for (const times of [
    { IssuedAtUtc: new Date(now - 6000).toISOString(), ExpiresAtUtc: new Date(now - 1).toISOString() },
    { IssuedAtUtc: new Date(now + 60000).toISOString() },
    { IssuedAtUtc: new Date(now - 1000).toISOString(), ExpiresAtUtc: new Date(now + 300001).toISOString() },
    { IssuedAtUtc: '2026-02-31T00:00:00.000Z' },
    { ExpiresAtUtc: challenge.IssuedAtUtc },
    { ExpiresAtUtc: '2026-10-21T21:00:00Z' },
  ]) assert.throws(() => encrypt({ ...challenge, ...times }, permit, credential), /^Error: R7_OWNER_ENVELOPE_/);
});

test('credential bounds and safe fixed errors do not disclose invalid input', () => {
  for (const value of ['', 'x.y.z', credential + '\n', credential + 'é', 'a'.repeat(32768) + '.b.c',
    credential.replace('.', '..'), credential + '=']) {
    assert.throws(() => encrypt(challenge, permit, value), error =>
      /^R7_OWNER_ENVELOPE_[A-Z_]+$/.test(error.message)
        && (value.length === 0 || !error.message.includes(value.slice(0,20))));
  }
  const longest = 'a'.repeat(32764) + '.b.c';
  assert.equal(longest.length,32768); assert.equal(decrypt(encrypt(challenge,permit,longest)),longest);
});

test('challenge inspection cannot execute accessors or accept prototype/symbol fields', () => {
  let getterRead = false;
  const accessor = { ...challenge }; Object.defineProperty(accessor, 'Audience', { enumerable: true, get() { getterRead=true; return challenge.Audience; } });
  assert.throws(() => encrypt(accessor,permit,credential)); assert.equal(getterRead,false);
  assert.throws(() => encrypt(Object.assign(Object.create({ claim:true }),challenge),permit,credential));
  assert.throws(() => encrypt({ ...challenge, [Symbol('hidden')]:true },permit,credential));
});
