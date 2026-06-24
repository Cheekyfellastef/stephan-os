import { createHash, sign, verify } from 'node:crypto';

const AUTHORIZATION_SCHEMA = 'stephanos.openclaw-github-authorization.v1';
const AUTHORIZATION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function canonicalAuthorizationClaims(claims) {
  return JSON.stringify(canonicalize(claims));
}

export function authorizationClaimsSha256(claims) {
  return createHash('sha256').update(canonicalAuthorizationClaims(claims), 'utf8').digest('hex');
}

function validateClaims(claims, now = new Date()) {
  const blockers = [];
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    return ['Authorization claims must be an object.'];
  }
  if (!AUTHORIZATION_ID_PATTERN.test(text(claims.authorizationId).toLowerCase())) {
    blockers.push('Authorization id is missing or invalid.');
  }
  if (!text(claims.missionId)) blockers.push('Mission id is required.');
  if (!text(claims.operation)) blockers.push('Operation is required.');
  if (claims.singleUse !== true) blockers.push('Authorization must be single-use.');
  const issuedAt = Date.parse(text(claims.issuedAt));
  const expiresAt = Date.parse(text(claims.expiresAt));
  const nowMs = now.getTime();
  if (!Number.isFinite(issuedAt)) blockers.push('Authorization issuedAt is invalid.');
  if (!Number.isFinite(expiresAt)) blockers.push('Authorization expiresAt is invalid.');
  if (Number.isFinite(issuedAt) && issuedAt > nowMs + 60_000) blockers.push('Authorization is not valid yet.');
  if (Number.isFinite(expiresAt) && expiresAt <= nowMs) blockers.push('Authorization has expired.');
  if (Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && expiresAt - issuedAt > 24 * 60 * 60 * 1000) {
    blockers.push('Authorization lifetime exceeds 24 hours.');
  }
  return blockers;
}

export function issueOpenClawGitHubAuthorization(claims, privateKeyPem, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const blockers = validateClaims(claims, now);
  if (blockers.length) {
    return { finalVerdict: 'BLOCKED', blockers };
  }
  const canonical = canonicalAuthorizationClaims(claims);
  const signature = sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem).toString('base64');
  return {
    schemaVersion: AUTHORIZATION_SCHEMA,
    algorithm: 'Ed25519',
    claims,
    claimsSha256: authorizationClaimsSha256(claims),
    signature,
    finalVerdict: 'STEPHANOS_AUTHORIZATION_ISSUED',
  };
}

export function verifyOpenClawGitHubAuthorization(envelope, publicKeyPem, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const blockers = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { finalVerdict: 'BLOCKED', blockers: ['Authorization envelope must be an object.'], claims: null };
  }
  if (envelope.schemaVersion !== AUTHORIZATION_SCHEMA) blockers.push('Authorization schema is unsupported.');
  if (envelope.algorithm !== 'Ed25519') blockers.push('Authorization algorithm is unsupported.');
  blockers.push(...validateClaims(envelope.claims, now));
  const expectedHash = envelope.claims ? authorizationClaimsSha256(envelope.claims) : '';
  if (text(envelope.claimsSha256) !== expectedHash) blockers.push('Authorization claims hash does not match.');
  let signatureValid = false;
  try {
    signatureValid = verify(
      null,
      Buffer.from(canonicalAuthorizationClaims(envelope.claims), 'utf8'),
      publicKeyPem,
      Buffer.from(text(envelope.signature), 'base64'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) blockers.push('Authorization signature is invalid.');
  return {
    finalVerdict: blockers.length ? 'BLOCKED' : 'STEPHANOS_AUTHORIZATION_VERIFIED',
    blockers,
    claims: blockers.length ? null : envelope.claims,
    authorizationId: text(envelope.claims?.authorizationId).toLowerCase(),
    claimsSha256: expectedHash,
  };
}
