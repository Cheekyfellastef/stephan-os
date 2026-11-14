import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

// These are transport/preflight contracts, never privileged installation authority.
// The protected native owner must independently verify enrollment, release eligibility,
// the assertion, atomic one-use admission and its retained execution journal.
export const MOBILE_INSTALLATION_CANDIDATE_SCHEMA = 'stephanos.battle-bridge-mobile-installation-candidate.v1';
export const MOBILE_INSTALLATION_ENROLLMENT_SCHEMA = 'stephanos.battle-bridge-mobile-installation-enrollment.v1';
export const MOBILE_INSTALLATION_RECEIPT_SCHEMA = 'stephanos.battle-bridge-mobile-installation-receipt.v1';
export const MOBILE_INSTALLATION_ACTION = 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1';
export const MOBILE_INSTALLATION_TTL_MS = 5 * 60_000;
export const MOBILE_INSTALLATION_RECEIPT_TTL_MS = 2 * 60_000;

const CANDIDATE_KEYS = ['schemaVersion', 'repository', 'issueNumber', 'action', 'requestId', 'nonce',
  'machineHash', 'operatorSid', 'sourceHead', 'sourceTree', 'packageSha256', 'closureSha256',
  'releaseProofSha256', 'enrollmentGeneration', 'requestedAtUtc', 'expiresAtUtc'];
const ENROLLMENT_KEYS = ['schemaVersion', 'machineHash', 'operatorSid', 'generation', 'rpId', 'origin',
  'credentialId', 'publicKeySpki', 'userHandle', 'lastSignCount', 'revoked', 'receiptPublicKeySpki'];
const RECEIPT_KEYS = ['schemaVersion', 'requestId', 'candidateSha256', 'machineHash', 'enrollmentGeneration',
  'sequence', 'state', 'observedAtUtc', 'sourceHead', 'packageSha256', 'retainedProcessId',
  'executionStartedAtUtc', 'installedHelperSha256', 'installationBootId', 'qualifiedBootId', 'reasonCode'];
const HEX64 = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const REQUEST_ID = /^mobile-install-[a-z0-9][a-z0-9-]{7,63}$/;
const SID = /^S-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}$/;
const hash = bytes => createHash('sha256').update(bytes).digest();
const authority = Object.freeze({ executionAuthorityGranted: false, requiresNativeReverification: true });
const fail = code => Object.freeze({ ok: false, ...authority, blockers: Object.freeze([code]) });
const equal = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const uint = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const positive = value => Number.isSafeInteger(value) && value > 0;
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Object.getOwnPropertySymbols(value).length) throw Error('record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length) throw Error('keys');
  const result = {};
  for (const key of keys) {
    const field = descriptors[key];
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable) throw Error('field');
    result[key] = field.value;
  }
  return result;
}

function iso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function bytes(value, min, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3)
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < min || decoded.length > max || decoded.toString('base64url') !== value) throw Error('base64url');
  return decoded;
}

function p256Key(value) {
  const der = bytes(value, 80, 512);
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      || !equal(key.export({ format: 'der', type: 'spki' }), der)) throw Error('key');
  return key;
}

function signature(value) {
  const der = bytes(value, 8, 72);
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw Error('signature');
  let offset = 2;
  for (let index = 0; index < 2; index++) {
    if (der[offset++] !== 2) throw Error('integer');
    const length = der[offset++];
    const start = offset;
    offset += length;
    if (length < 1 || length > 33 || offset > der.length || der[start] & 0x80
        || (length > 1 && der[start] === 0 && !(der[start + 1] & 0x80))
        || (length === 33 && der[start] !== 0)) throw Error('integer');
  }
  if (offset !== der.length) throw Error('trailing');
  return der;
}

function enrollment(input) {
  const e = record(input, ENROLLMENT_KEYS);
  if (e.schemaVersion !== MOBILE_INSTALLATION_ENROLLMENT_SCHEMA || !matches(e.machineHash, HEX64)
      || !matches(e.operatorSid, SID) || !positive(e.generation) || !uint(e.lastSignCount)
      || typeof e.revoked !== 'boolean' || e.revoked) throw Error('enrollment');
  if (typeof e.rpId !== 'string' || e.rpId.length > 253
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(e.rpId)) throw Error('rp');
  if (typeof e.origin !== 'string' || e.origin.length > 1024) throw Error('origin');
  const origin = new URL(e.origin);
  if (origin.protocol !== 'https:' || origin.origin !== e.origin || origin.username || origin.password
      || !(origin.hostname === e.rpId || origin.hostname.endsWith('.' + e.rpId))) throw Error('origin');
  bytes(e.credentialId, 16, 1024); bytes(e.userHandle, 1, 64);
  p256Key(e.publicKeySpki); p256Key(e.receiptPublicKeySpki);
  return e;
}

export function normalizeMobileInstallationCandidateV1(input, { nowMs = Date.now(), enforceFreshness = true } = {}) {
  try {
    const c = record(input, CANDIDATE_KEYS);
    if (!Number.isFinite(nowMs) || c.schemaVersion !== MOBILE_INSTALLATION_CANDIDATE_SCHEMA
        || c.repository !== 'Cheekyfellastef/stephan-os' || c.issueNumber !== 1814
        || c.action !== MOBILE_INSTALLATION_ACTION || !matches(c.requestId, REQUEST_ID)
        || !matches(c.operatorSid, SID) || !positive(c.enrollmentGeneration)
        || !matches(c.sourceHead, HEAD) || !matches(c.sourceTree, HEAD)
        || !['nonce', 'machineHash', 'packageSha256', 'closureSha256', 'releaseProofSha256'].every(key => matches(c[key], HEX64))
        || !iso(c.requestedAtUtc) || !iso(c.expiresAtUtc)) return fail('CANDIDATE_INVALID');
    const issued = Date.parse(c.requestedAtUtc), expiry = Date.parse(c.expiresAtUtc);
    if (expiry <= issued || expiry - issued > MOBILE_INSTALLATION_TTL_MS) return fail('CANDIDATE_WINDOW_INVALID');
    if (enforceFreshness && (issued > nowMs || expiry <= nowMs)) return fail('CANDIDATE_NOT_FRESH');
    return Object.freeze({ ok: true, ...authority, candidate: Object.freeze(c), blockers: Object.freeze([]) });
  } catch { return fail('CANDIDATE_INVALID'); }
}

export function mobileInstallationCandidateDigestV1(candidate) {
  const result = normalizeMobileInstallationCandidateV1(candidate, { enforceFreshness: false });
  return result.ok ? hash(JSON.stringify(result.candidate)).toString('hex') : '';
}

// Public credential data inspection for the separately approved initial setup.
// A well-formed proposed enrollment is never protected enrollment or authority.
export function inspectMobileInstallationEnrollmentDataV1(value) {
  try { return Object.freeze({ ok: true, enrollment: Object.freeze(enrollment(value)),
    enrollmentQualified: false, executionAuthorityGranted: false }); }
  catch { return Object.freeze({ ok: false, enrollment: null,
    enrollmentQualified: false, executionAuthorityGranted: false }); }
}

export function mobileInstallationChallengeV1(candidate) {
  const digest = mobileInstallationCandidateDigestV1(candidate);
  return digest ? hash('stephanos.mobile-installation-approval.v1\0' + digest).toString('base64url') : '';
}

function bound(c, e) {
  return c.machineHash === e.machineHash && c.operatorSid === e.operatorSid && c.enrollmentGeneration === e.generation;
}

export function mobileInstallationRequestOptionsV1(candidate, protectedEnrollment, { nowMs = Date.now() } = {}) {
  const normalized = normalizeMobileInstallationCandidateV1(candidate, { nowMs });
  if (!normalized.ok) return normalized;
  try {
    const e = enrollment(protectedEnrollment);
    if (!bound(normalized.candidate, e)) return fail('ENROLLMENT_BINDING_MISMATCH');
    return Object.freeze({ ok: true, ...authority, publicKey: Object.freeze({
      challenge: mobileInstallationChallengeV1(normalized.candidate), rpId: e.rpId,
      allowCredentials: Object.freeze([Object.freeze({ type: 'public-key', id: e.credentialId })]),
      userVerification: 'required', timeout: Math.min(60_000, Date.parse(candidate.expiresAtUtc) - nowMs),
    }), blockers: Object.freeze([]) });
  } catch { return fail('ENROLLMENT_UNPROVEN'); }
}

// A small flat JSON reader refuses duplicate/unknown keys and ambiguous client data.
// This version requests no extensions; new WebAuthn client fields require review.
function clientData(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const stringToken = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  let offset = 0;
  const out = Object.create(null);
  const whitespace = () => { while (/[\t\n\r ]/.test(text[offset] ?? 'x')) offset++; };
  const readString = () => {
    stringToken.lastIndex = offset; const found = stringToken.exec(text);
    if (!found) throw Error('json'); offset = stringToken.lastIndex; return JSON.parse(found[0]);
  };
  whitespace(); if (text[offset++] !== '{') throw Error('json'); whitespace();
  while (text[offset] !== '}') {
    const key = readString();
    if (!['type', 'challenge', 'origin', 'crossOrigin'].includes(key) || Object.hasOwn(out, key)) throw Error('json-key');
    whitespace(); if (text[offset++] !== ':') throw Error('json'); whitespace();
    if (text[offset] === '"') out[key] = readString();
    else if (text.slice(offset, offset + 5) === 'false') { out[key] = false; offset += 5; }
    else if (text.slice(offset, offset + 4) === 'true') { out[key] = true; offset += 4; }
    else throw Error('json-value');
    whitespace();
    if (text[offset] === '}') break;
    if (text[offset++] !== ',') throw Error('json'); whitespace();
    if (text[offset] === '}') throw Error('json');
  }
  offset++; whitespace(); if (offset !== text.length) throw Error('json');
  return out;
}

export function verifyMobileInstallationAssertionV1({ candidate, enrollment: protectedEnrollment, assertion }, { nowMs = Date.now() } = {}) {
  const normalized = normalizeMobileInstallationCandidateV1(candidate, { nowMs });
  if (!normalized.ok) return normalized;
  try {
    const e = enrollment(protectedEnrollment), c = normalized.candidate;
    if (!bound(c, e)) return fail('ENROLLMENT_BINDING_MISMATCH');
    const a = record(assertion, ['type', 'id', 'rawId', 'response']);
    const r = record(a.response, ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle']);
    if (a.type !== 'public-key' || a.id !== e.credentialId || a.rawId !== e.credentialId
        || (r.userHandle !== null && r.userHandle !== e.userHandle)) return fail('CREDENTIAL_MISMATCH');
    const rawClient = bytes(r.clientDataJSON, 32, 4096), data = clientData(rawClient);
    if (data.type !== 'webauthn.get' || data.origin !== e.origin
        || (Object.hasOwn(data, 'crossOrigin') && data.crossOrigin !== false)
        || data.challenge !== mobileInstallationChallengeV1(c)) return fail('CLIENT_BINDING_MISMATCH');
    const auth = bytes(r.authenticatorData, 37, 37), flags = auth[32];
    if (!equal(auth.subarray(0, 32), hash(e.rpId)) || (flags & 5) !== 5
        || (flags & 0xe2) !== 0 || ((flags & 0x10) !== 0 && (flags & 8) === 0)) return fail('AUTHENTICATOR_POLICY_REFUSED');
    const signCount = auth.readUInt32BE(33);
    if ((e.lastSignCount !== 0 || signCount !== 0) && signCount <= e.lastSignCount) return fail('SIGN_COUNTER_ROLLBACK');
    if (!verify('sha256', Buffer.concat([auth, hash(rawClient)]), p256Key(e.publicKeySpki), signature(r.signature))) return fail('SIGNATURE_INVALID');
    return Object.freeze({ ok: true, ...authority, approvalVerified: true,
      requestId: c.requestId, candidateSha256: mobileInstallationCandidateDigestV1(c), signCount,
      blockers: Object.freeze([]) });
  } catch { return fail('ASSERTION_INVALID'); }
}

const STATE_TEXT = Object.freeze({
  SETUP_REQUIRED: ['Initial Windows setup required', 'The protected installer has not been verified.'],
  SIGN_IN_REQUIRED: ['Waiting for Windows sign-in', 'The approved installer requires a signed-in Windows session.'],
  AWAITING_APPROVAL: ['Ready for your approval', 'Review this exact installation before approving it.'],
  APPROVAL_RECORDED: ['Approval received', 'Windows has recorded approval; installation has not started.'],
  STARTING: ['Starting installation', 'Windows has claimed this request and is preparing the installer.'],
  INSTALLING: ['Installing', 'The protected installer has started for this request.'],
  INSTALLED_PENDING_BOOT: ['Installed — restart required', 'Installation is verified. Restart and qualification remain separate.'],
  READY: ['Ready', 'The installed runtime passed its required later-boot qualification.'],
  FAILED: ['Installation failed', 'The installer reported a failure. Retain this request when investigating.'],
  CANCELLED: ['Installation cancelled', 'Windows confirmed cancellation.'],
  BLOCKED: ['Installation needs attention', 'Windows refused or held this operation.'],
  UNKNOWN: ['Outcome not yet confirmed', 'Reconnect to check this same request. Do not start another installation.'],
});

export function canonicalMobileInstallationReceiptV1(input) {
  try {
    const payload = record(input, RECEIPT_KEYS);
    if (!Object.values(payload).every(value => value === null || typeof value === 'number'
      || (typeof value === 'string' && value.length <= 256))) return '';
    return JSON.stringify(payload);
  } catch { return ''; }
}

function projection(state, extra = {}) {
  const blockers = ['UNKNOWN', 'BLOCKED', 'SETUP_REQUIRED', 'SIGN_IN_REQUIRED', 'FAILED'].includes(state)
    && extra.reasonCode ? [extra.reasonCode] : [];
  return Object.freeze({ state, title: STATE_TEXT[state][0], description: STATE_TEXT[state][1],
    canApprove: false, requestId: null, observedAtUtc: null, blockers: Object.freeze(blockers),
    receiptVerified: false, sequence: null, sourceHead: null, packageSha256: null,
    nativeReceiptVerified: false, executionAuthorityGranted: false, ...extra });
}

// Enrollment is an internal trust input read from protected configuration, never
// accepted from HTTP. minimumSequence is the existing owner's retained watermark.
export function projectMobileInstallationV1({ candidate = null, enrollment: protectedEnrollment = null, receipt = null } = {},
  { nowMs = Date.now(), minimumSequence = 0 } = {}) {
  if (!protectedEnrollment) return projection('SETUP_REQUIRED', { reasonCode: 'ENROLLMENT_UNPROVEN' });
  try {
    const e = enrollment(protectedEnrollment);
    const normalized = normalizeMobileInstallationCandidateV1(candidate, { nowMs, enforceFreshness: false });
    if (!normalized.ok || !bound(normalized.candidate, e)) return projection('UNKNOWN', { reasonCode: 'CANDIDATE_UNPROVEN' });
    const c = normalized.candidate, envelope = record(receipt, ['payload', 'signature']), p = record(envelope.payload, RECEIPT_KEYS);
    const canonical = canonicalMobileInstallationReceiptV1(p);
    if (!canonical || !verify('sha256', Buffer.from(canonical), p256Key(e.receiptPublicKeySpki), signature(envelope.signature))) throw Error('signature');
    if (!Number.isFinite(nowMs) || !Number.isSafeInteger(minimumSequence) || minimumSequence < 0
        || p.schemaVersion !== MOBILE_INSTALLATION_RECEIPT_SCHEMA || !positive(p.sequence) || p.sequence < minimumSequence
        || p.requestId !== c.requestId || p.candidateSha256 !== mobileInstallationCandidateDigestV1(c)
        || p.machineHash !== c.machineHash || p.enrollmentGeneration !== e.generation
        || p.sourceHead !== c.sourceHead || p.packageSha256 !== c.packageSha256
        || !Object.hasOwn(STATE_TEXT, p.state) || !iso(p.observedAtUtc)
        || Date.parse(p.observedAtUtc) > nowMs || nowMs - Date.parse(p.observedAtUtc) > MOBILE_INSTALLATION_RECEIPT_TTL_MS
        || Date.parse(p.observedAtUtc) < Date.parse(c.requestedAtUtc)
        || typeof p.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(p.reasonCode)) throw Error('receipt');
    const start = p.executionStartedAtUtc;
    if ((p.retainedProcessId !== null && (!positive(p.retainedProcessId) || p.retainedProcessId > 0xffffffff))
        || (start !== null && (!iso(start) || Date.parse(start) < Date.parse(c.requestedAtUtc) || Date.parse(start) > Date.parse(p.observedAtUtc)))
        || !['installedHelperSha256', 'installationBootId', 'qualifiedBootId'].every(key => p[key] === null || matches(p[key], HEX64))) throw Error('evidence');
    if (['INSTALLING', 'INSTALLED_PENDING_BOOT', 'READY'].includes(p.state) && (p.retainedProcessId === null || start === null)) throw Error('execution');
    if (['INSTALLED_PENDING_BOOT', 'READY'].includes(p.state) && (p.installedHelperSha256 === null || p.installationBootId === null)) throw Error('installation');
    if (p.state === 'READY' && (p.qualifiedBootId === null || p.qualifiedBootId === p.installationBootId)) throw Error('qualification');
    const fresh = normalizeMobileInstallationCandidateV1(c, { nowMs }).ok;
    if (p.state === 'AWAITING_APPROVAL' && !fresh) return projection('BLOCKED', {
      reasonCode: 'CANDIDATE_NOT_FRESH', requestId: c.requestId, nativeReceiptVerified: true, receiptVerified: true,
      candidateSha256: p.candidateSha256, sourceHead: p.sourceHead, packageSha256: p.packageSha256,
      sequence: p.sequence, observedAtUtc: p.observedAtUtc });
    return projection(p.state, { canApprove: p.state === 'AWAITING_APPROVAL', nativeReceiptVerified: true, receiptVerified: true,
      requestId: c.requestId, candidateSha256: p.candidateSha256, sourceHead: p.sourceHead,
      packageSha256: p.packageSha256, sequence: p.sequence, observedAtUtc: p.observedAtUtc, reasonCode: p.reasonCode });
  } catch { return projection('UNKNOWN', { reasonCode: 'NATIVE_RECEIPT_UNPROVEN' }); }
}
