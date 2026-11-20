import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { authenticateSourceCustodyCommissioning } from './originalSourceCustodyCommissioningService.js';

// V2 deliberately rejects all V1 shared-HMAC receipts. The source worker and
// verifier hold only a public key, never the privileged issuer's signing key.
export const ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA = 'stephanos.original-source-writer-custody.v2';
export const ORIGINAL_WRITER_CUSTODY_SIGNATURE_DOMAIN = 'stephanos.original-source-writer-custody.v2\0';
const EXCLUSION_SCHEMA = 'stephanos.original-source-writer-exclusion.v1';
const ISSUER_ID = 'stephanos-windows-job-custody-service';
const EXECUTION_ID = /^critical-[1-9][0-9]*-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^[a-z0-9][a-z0-9._:-]{7,119}$/;
const SID = /^S-1-[1-9][0-9]*(?:-[0-9]+){2,15}$/;
const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_PUBLIC_KEY_BYTES = 4096;
const MAX_AGE_MS = 5 * 60 * 1000;
const text = (x) => String(x ?? '').trim();

function fail() {
  return Object.freeze({ authenticated: false, evidence: null, reason: 'ORIGINAL_CUSTODY_AUTHENTICATION_UNPROVEN' });
}

function withinDirectory(root, path) {
  const delta = relative(root, path);
  return delta && delta !== '..' && !delta.startsWith('..\\') && !delta.startsWith('../') && !isAbsolute(delta);
}

async function readBoundedRegularFile(path, maxBytes) {
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink() || item.size < 1 || item.size > maxBytes) return null;
  const bytes = await readFile(path);
  return bytes.length > 0 && bytes.length <= maxBytes ? bytes : null;
}

function signedPayload(claims) {
  return Buffer.from(ORIGINAL_WRITER_CUSTODY_SIGNATURE_DOMAIN + JSON.stringify(claims), 'utf8');
}

// This is a verifier, NOT the OS custody issuer. A Job Object can lose writers
// created via WMI Win32_Process.Create or other out-of-job mechanisms. A
// separately privileged issuer must prove denied external process creation,
// worktree ACL isolation, and custody of the *whole* source worker lifetime.
// With no such issuer and no authentic historic receipt, fail-closed SAFE_HOLD.
export async function authenticateOriginalWriterExclusionEvidence(
  _untrustedPublicEvidence,
  expected = {},
  { env = process.env, now = () => Date.now() } = {},
) {
  try {
    const id = text(expected.sourceExecutionId);
    const receiptRoot = text(env.STEPHANOS_SOURCE_CUSTODY_RECEIPTS_DIR);
    const publicKeyPath = text(env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH);
    const expectedPublicKeySha256 = text(env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256).toLowerCase();
    const worktree = text(expected.worktreePath);
    if (!EXECUTION_ID.test(id) || !receiptRoot || !publicKeyPath || !SHA64.test(expectedPublicKeySha256) || !worktree
      || !isAbsolute(receiptRoot) || !isAbsolute(publicKeyPath) || !isAbsolute(worktree)
      || !SHA40.test(text(expected.headSha)) || !SHA64.test(text(expected.leaseDigest))) return fail();

    const root = resolve(receiptRoot);
    const authenticRoot = await realpath(root);
    const keyBytes = await readBoundedRegularFile(resolve(publicKeyPath), MAX_PUBLIC_KEY_BYTES);
    if (!keyBytes || createHash('sha256').update(keyBytes).digest('hex') !== expectedPublicKeySha256) return fail();
    const key = createPublicKey(keyBytes);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') return fail();

    const receiptPath = resolve(join(root, id + '.json'));
    if (!withinDirectory(root, receiptPath)) return fail();
    const realReceipt = await realpath(receiptPath);
    if (!withinDirectory(authenticRoot, realReceipt)) return fail();
    const bytes = await readBoundedRegularFile(receiptPath, MAX_RECEIPT_BYTES);
    if (!bytes) return fail();
    const record = JSON.parse(bytes.toString('utf8'));
    const claims = record?.claims;
    const signatureBase64 = text(record?.signatureBase64);
    const signature = Buffer.from(signatureBase64, 'base64');
    if (record?.schemaVersion !== ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA
      || record?.issuer !== ISSUER_ID || record?.algorithm !== 'Ed25519'
      || !claims || typeof claims !== 'object' || Array.isArray(claims)
      || signature.length !== 64 || signature.toString('base64') !== signatureBase64
      || !verify(null, signedPayload(claims), key, signature)) return fail();

    const signedAt = Date.parse(text(claims.signedAtUtc));
    const start = Date.parse(text(claims.processStartedAtUtc));
    const end = Date.parse(text(claims.processExitedAtUtc));
    const clock = typeof now === 'function' ? now() : Date.now();
    if (![signedAt, start, end, clock].every(Number.isFinite)
      || start > end || end > signedAt || signedAt > clock
      || clock - signedAt > MAX_AGE_MS) return fail();

    // Job member count alone never proves absence of WMI/COM-launched writers.
    // These additional positive assertions must come from the privileged
    // issuer's *independent OS principal*, not Node tests or the mailbox.
    if (claims.missionId !== expected.missionId
      || claims.sourceExecutionId !== id
      || claims.leaseId !== expected.leaseId
      || claims.leaseDigest !== expected.leaseDigest
      || claims.repository !== expected.repository
      || claims.branch !== expected.branch
      || claims.headSha !== expected.headSha
      || resolve(text(claims.worktreePath)) !== resolve(worktree)
      || claims.platform !== 'win32'
      || claims.createdSuspended !== true
      || claims.assignedBeforeResume !== true
      || claims.killOnJobClose !== true
      || claims.breakawayPermitted !== false
      || claims.jobClosed !== true
      || claims.allProcessesExited !== true
      || claims.activeProcessCount !== 0
      || claims.externalProcessCreationDenied !== true
      || claims.worktreeAclIsolated !== true
      || claims.wholeWorkerLifetimeCovered !== true
      || claims.issuerObservedNoExternalWriters !== true
      || !SID.test(text(claims.isolatedWriterPrincipalSid))
      || !SHA64.test(text(claims.isolationPolicySha256))
      || !Number.isSafeInteger(claims.rootPid) || claims.rootPid < 1
      || !RECEIPT_ID.test(text(claims.authorityReceiptId))) return fail();

    // A possession of the issuer private key alone cannot confer historical
    // custody authority: independently signed OS commissioning must predate
    // this precise source process launch. Neither proof may be caller-supplied.
    const commissioned = await authenticateSourceCustodyCommissioning({
      repository: expected.repository, branch: expected.branch,
      worktreePath: worktree, isolatedWriterPrincipalSid: claims.isolatedWriterPrincipalSid,
      isolationPolicySha256: claims.isolationPolicySha256,
      processStartedAtUtc: claims.processStartedAtUtc,
    }, { env });
    if (commissioned.authenticated !== true) return fail();

    const evidence = Object.freeze({
      schemaVersion: EXCLUSION_SCHEMA,
      missionId: claims.missionId,
      sourceExecutionId: claims.sourceExecutionId,
      leaseId: claims.leaseId,
      leaseDigest: claims.leaseDigest,
      repository: claims.repository,
      branch: claims.branch,
      headSha: claims.headSha,
      worktreePath: resolve(worktree),
      verdict: 'NO_SOURCE_WRITING_DESCENDANTS',
      authorityReceiptId: claims.authorityReceiptId,
      authorityReceiptSha256: createHash('sha256').update(bytes).digest('hex'),
      commissioningReceiptSha256: commissioned.commissioningReceiptSha256,
    });
    return Object.freeze({ authenticated: true, evidence });
  } catch {
    return fail();
  }
}
