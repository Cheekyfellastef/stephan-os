import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

// This is a SECOND signature trust root, never an issuer or an OS probe.
// The separately protected operator/root key must commission the Windows
// issuer and isolated source-worker principal BEFORE a source action starts.
export const SOURCE_CUSTODY_COMMISSIONING_SCHEMA = 'stephanos.source-custody-commissioning.v1';
export const SOURCE_CUSTODY_COMMISSIONING_DOMAIN = 'stephanos.source-custody-commissioning.v1\0';
const SHA = /^[a-f0-9]{64}$/;
const SID = /^S-1-[1-9][0-9]*(?:-[0-9]+){2,15}$/;
const fail = () => Object.freeze({ authenticated: false, blocker: 'SOURCE_CUSTODY_COMMISSIONING_UNPROVEN', authority: false });
const text = value => String(value ?? '').trim();
const strictInstant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN;
};
async function regularFile(path, max) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size < 1 || st.size > max) return null;
  const content = await readFile(path);
  return content.length <= max ? content : null;
}
function contained(root, path) {
  const delta = relative(root, path);
  return delta && delta !== '..' && !delta.startsWith('../') && !delta.startsWith('..\\') && !isAbsolute(delta);
}

// Untrusted caller data never selects file paths, verification keys or issuer.
// A TRUE result authenticates only a *commissioning policy record*. It cannot
// establish that a Windows Job Object has exited or that #2962 is safe to release.
export async function authenticateSourceCustodyCommissioning(expected = {}, { env = process.env } = {}) {
  try {
    const recordPath = text(env.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_RECEIPT_PATH);
    const trustedRootPath = text(env.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_PATH);
    const rootDigest = text(env.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_SHA256).toLowerCase();
    const serviceKeyDigest = text(env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256).toLowerCase();
    const issuerKeyPath = text(env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH);
    const workerSid = text(expected.isolatedWriterPrincipalSid);
    const worktreePath = text(expected.worktreePath);
    if (![recordPath, trustedRootPath, issuerKeyPath, worktreePath].every(isAbsolute)
      || !SHA.test(rootDigest) || !SHA.test(serviceKeyDigest)
      || !SHA.test(text(expected.isolationPolicySha256)) || !SID.test(workerSid)) return fail();
    const paths = [recordPath, trustedRootPath, issuerKeyPath].map(path => resolve(path));
    const isolated = resolve(worktreePath);
    // Nothing executable, no signer key, and no receipt path in the source worktree.
    if (paths.some(path => contained(isolated, path) || path === isolated)) return fail();
    const [receiptBytes, rootBytes, serviceBytes] = await Promise.all([
      regularFile(paths[0], 12 * 1024),
      regularFile(paths[1], 4096),
      regularFile(paths[2], 4096),
    ]);
    if (!receiptBytes || !rootBytes || !serviceBytes) return fail();
    if (createHash('sha256').update(rootBytes).digest('hex') !== rootDigest
      || createHash('sha256').update(serviceBytes).digest('hex') !== serviceKeyDigest) return fail();
    const root = createPublicKey(rootBytes);
    const service = createPublicKey(serviceBytes);
    if (root.asymmetricKeyType !== 'ed25519' || service.asymmetricKeyType !== 'ed25519') return fail();
    // Reject reused or substituted trusted roots, even with a valid Ed25519 signature.
    if (root.export({ format: 'der', type: 'spki' }).equals(service.export({ format: 'der', type: 'spki' }))) return fail();
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const claims = receipt?.claims;
    const sig64 = text(receipt?.signatureBase64);
    const signature = Buffer.from(sig64, 'base64');
    if (receipt?.schemaVersion !== SOURCE_CUSTODY_COMMISSIONING_SCHEMA
      || receipt?.issuer !== 'stephanos-independent-custody-commissioning-root'
      || receipt?.algorithm !== 'Ed25519'
      || !claims || typeof claims !== 'object' || Array.isArray(claims)
      || signature.length !== 64 || signature.toString('base64') !== sig64
      || !verify(null, Buffer.from(SOURCE_CUSTODY_COMMISSIONING_DOMAIN + JSON.stringify(claims), 'utf8'), root, signature)) return fail();
    const commissioned = strictInstant(claims.commissionedAtUtc);
    const expires = strictInstant(claims.expiresAtUtc);
    const started = strictInstant(text(expected.processStartedAtUtc));
    if (![commissioned, expires, started].every(Number.isFinite)
      || !(commissioned < started && started < expires)
      || expires - commissioned > 30 * 86400_000
      || claims.repository !== expected.repository
      || claims.branch !== expected.branch
      || resolve(text(claims.worktreePath)) !== isolated
      || claims.issuerPublicKeySha256 !== serviceKeyDigest
      || claims.isolationPolicySha256 !== expected.isolationPolicySha256
      || claims.isolatedWriterPrincipalSid !== workerSid
      || !SID.test(text(claims.issuerServicePrincipalSid))
      || !SID.test(text(claims.operatorPrincipalSid))
      || claims.issuerServicePrincipalSid === workerSid
      || claims.operatorPrincipalSid === workerSid
      || claims.operatorPrincipalSid === claims.issuerServicePrincipalSid
      || claims.issuerKeyNotAccessibleToWorker !== true
      || claims.operatorCheckoutWriteDeniedToWorker !== true
      || claims.outOfJobSourceWriterAccessDenied !== true
      || claims.independentOsPrincipalAttestation !== true) return fail();
    return Object.freeze({
      authenticated: true,
      blocker: '',
      commissioningReceiptSha256: createHash('sha256').update(receiptBytes).digest('hex'),
      // This does not authenticate writer exclusion, quarantine or lease release.
      authority: false,
      sourceWriterExclusionProven: false,
      leaseReleaseAllowed: false,
    });
  } catch { return fail(); }
}
