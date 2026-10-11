import { createHmac, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA = 'stephanos.original-source-writer-custody.v1';
const EXCLUSION_SCHEMA = 'stephanos.original-source-writer-exclusion.v1';
const ISSUER_ID = 'stephanos-windows-job-custody-service';
const EXECUTION_ID = /^critical-[1-9][0-9]*-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^[a-z0-9][a-z0-9._:-]{7,119}$/;
const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_KEY_BYTES = 4096;
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
  return bytes.length && bytes.length <= maxBytes ? bytes : null;
}

// This verifier never creates custody attestations, opens processes, or signs
// receipts. Only an independently permission-isolated Windows Job Object
// custodian can produce the positive proof; missing legacy receipts fail shut.
export async function authenticateOriginalWriterExclusionEvidence(
  _untrustedPublicEvidence,
  expected = {},
  { env = process.env, now = () => Date.now() } = {},
) {
  try {
    const id = text(expected.sourceExecutionId);
    const receiptRoot = text(env.STEPHANOS_SOURCE_CUSTODY_RECEIPTS_DIR);
    const keyPath = text(env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_KEY_PATH);
    const worktree = text(expected.worktreePath);
    if (!EXECUTION_ID.test(id) || !receiptRoot || !keyPath || !worktree
      || !isAbsolute(receiptRoot) || !isAbsolute(keyPath) || !isAbsolute(worktree)
      || !SHA40.test(text(expected.headSha)) || !SHA64.test(text(expected.leaseDigest))) return fail();

    const root = resolve(receiptRoot);
    const authenticRoot = await realpath(root);
    const key = await readBoundedRegularFile(resolve(keyPath), MAX_KEY_BYTES);
    if (!key || key.length < 32 || key.length > 128) return fail();
    const receiptPath = resolve(join(root, id + '.json'));
    if (!withinDirectory(root, receiptPath)) return fail();
    const realReceipt = await realpath(receiptPath);
    if (!withinDirectory(authenticRoot, realReceipt)) return fail();
    const bytes = await readBoundedRegularFile(receiptPath, MAX_RECEIPT_BYTES);
    if (!bytes) return fail();
    const record = JSON.parse(bytes.toString('utf8'));
    const claims = record?.claims;
    const signature = text(record?.hmacSha256).toLowerCase();
    if (record?.schemaVersion !== ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA
      || record?.issuer !== ISSUER_ID || !SHA64.test(signature)
      || !claims || typeof claims !== 'object' || Array.isArray(claims)) return fail();

    const actual = createHmac('sha256', key).update(JSON.stringify(claims), 'utf8').digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) return fail();

    const signedAt = Date.parse(text(claims.signedAtUtc));
    const start = Date.parse(text(claims.processStartedAtUtc));
    const end = Date.parse(text(claims.processExitedAtUtc));
    const clock = typeof now === 'function' ? now() : Date.now();
    if (![signedAt, start, end, clock].every(Number.isFinite)
      || start > end || end > signedAt || signedAt > clock
      || clock - signedAt > MAX_AGE_MS) return fail();

    // None of these assertions may originate in the command packet. HMAC alone
    // is not OS proof; the separately protected issuer must bind the entire
    // non-breakaway Windows job lifecycle before signing these assertions.
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
      || claims.jobClosed === true
      || claims.allProcessesExited !== true
      || claims.activeProcessCount !== 0
      || !Number.isSafeInteger(claims.rootPid) || claims.rootPid < 1
      || !RECEIPT_ID.test(text(claims.authorityReceiptId))) return fail();

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
      authorityReceiptSha256: signature,
    });
    return Object.freeze({ authenticated: true, evidence });
  } catch {
    return fail();
  }
}
