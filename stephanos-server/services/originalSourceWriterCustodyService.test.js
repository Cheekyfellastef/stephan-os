import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as ed25519Sign } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authenticateOriginalWriterExclusionEvidence,
  ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA,
  ORIGINAL_WRITER_CUSTODY_SIGNATURE_DOMAIN,
} from './originalSourceWriterCustodyService.js';
import {
  SOURCE_CUSTODY_COMMISSIONING_SCHEMA,
  SOURCE_CUSTODY_COMMISSIONING_DOMAIN,
} from './originalSourceCustodyCommissioningService.js';

const NOW = Date.parse('2026-10-11T21:00:00.000Z');
const MISSION = 'critical-2962-elastic-goal';
const EXECUTION = MISSION + '-r1-27828c3fdb2c';
const SHA = 'a'.repeat(40);
const expected = (worktreePath) => ({
  missionId: MISSION,
  sourceExecutionId: EXECUTION,
  leaseId: MISSION + '-r7-lease',
  leaseDigest: 'b'.repeat(64),
  repository: 'Cheekyfellastef/stephan-os',
  branch: 'openclaw/elastic-goal-2962',
  headSha: SHA,
  worktreePath,
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'custody-verifier-'));
  const receipts = join(dir, 'receipts');
  const worktreePath = join(dir, 'isolated-source-worktree');
  const keyPath = join(dir, 'public-verification-key.pem');
  await mkdir(receipts);
  await mkdir(worktreePath);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ format: 'pem', type: 'spki' });
  await writeFile(keyPath, publicPem);
  const identity = expected(worktreePath);
  const claims = {
    ...identity,
    platform: 'win32',
    signedAtUtc: new Date(NOW - 1000).toISOString(),
    processStartedAtUtc: new Date(NOW - 4000).toISOString(),
    processExitedAtUtc: new Date(NOW - 2000).toISOString(),
    createdSuspended: true,
    assignedBeforeResume: true,
    killOnJobClose: true,
    breakawayPermitted: false,
    jobClosed: true,
    externalProcessCreationDenied: true,
    worktreeAclIsolated: true,
    wholeWorkerLifetimeCovered: true,
    issuerObservedNoExternalWriters: true,
    isolatedWriterPrincipalSid: 'S-1-5-21-100-200-300-400',
    isolationPolicySha256: 'd'.repeat(64),
    allProcessesExited: true,
    activeProcessCount: 0,
    rootPid: 12345,
    authorityReceiptId: 'custody-windows-job-2962-r1',
  };
  const env = {
    STEPHANOS_SOURCE_CUSTODY_RECEIPTS_DIR: receipts,
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH: keyPath,
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256: createHash('sha256').update(publicPem).digest('hex'),
  };
  // Synthetic independent offline root, deliberately separate from the
  // service signer. Production never generates either key in source/tests.
  const offline = generateKeyPairSync('ed25519');
  const offlinePublic = offline.publicKey.export({ format: 'pem', type: 'spki' });
  const offlinePublicPath = join(dir, 'commissioning-root-public.pem');
  const commissioningPath = join(dir, 'commissioning.json');
  await writeFile(offlinePublicPath, offlinePublic);
  env.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_PATH = offlinePublicPath;
  env.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_SHA256 = createHash('sha256').update(offlinePublic).digest('hex');
  env.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_RECEIPT_PATH = commissioningPath;
  const commissioningClaims = {
    repository: identity.repository, branch: identity.branch,
    worktreePath: identity.worktreePath,
    isolatedWriterPrincipalSid: claims.isolatedWriterPrincipalSid,
    issuerServicePrincipalSid: 'S-1-5-21-100-200-300-401',
    operatorPrincipalSid: 'S-1-5-21-100-200-300-402',
    issuerPublicKeySha256: env.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256,
    isolationPolicySha256: claims.isolationPolicySha256,
    commissionedAtUtc: new Date(NOW - 5000).toISOString(),
    expiresAtUtc: new Date(NOW + 86400_000).toISOString(),
    issuerKeyNotAccessibleToWorker: true,
    operatorCheckoutWriteDeniedToWorker: true,
    outOfJobSourceWriterAccessDenied: true,
    independentOsPrincipalAttestation: true,
  };
  await writeFile(commissioningPath, JSON.stringify({
    schemaVersion: SOURCE_CUSTODY_COMMISSIONING_SCHEMA,
    issuer: 'stephanos-independent-custody-commissioning-root',
    algorithm: 'Ed25519', claims: commissioningClaims,
    signatureBase64: ed25519Sign(null,
      Buffer.from(SOURCE_CUSTODY_COMMISSIONING_DOMAIN + JSON.stringify(commissioningClaims), 'utf8'),
      offline.privateKey).toString('base64'),
  }));
  const receiptPath = join(receipts, EXECUTION + '.json');
  const sign = async (contents = claims, signingKey = privateKey) => {
    const record = {
      schemaVersion: ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA,
      issuer: 'stephanos-windows-job-custody-service',
      claims: contents,
      algorithm: 'Ed25519',
      signatureBase64: ed25519Sign(null,
        Buffer.from(ORIGINAL_WRITER_CUSTODY_SIGNATURE_DOMAIN + JSON.stringify(contents), 'utf8'),
        signingKey).toString('base64'),
    };
    await writeFile(receiptPath, JSON.stringify(record));
  };
  const authenticate = (input, opts = {}) => authenticateOriginalWriterExclusionEvidence(input, identity, {
    env: opts.env || env, now: opts.now || (() => NOW),
  });
  return { dir, identity, claims, env, sign, authenticate, receipts, receiptPath, keyPath, privateKey };
}

test('synthetic isolated-issuer Ed25519 fixture validates exact identity without public control over evidence', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const good = await f.authenticate({ verdict: 'FORGED_PUBLIC_VERDICT' });
    assert.equal(good.authenticated, true);
    assert.equal(good.evidence.sourceExecutionId, EXECUTION);
    assert.equal(good.evidence.authorityReceiptSha256.length, 64);
    assert.equal(good.evidence.commissioningReceiptSha256.length, 64);
    assert.equal(good.evidence.worktreePath, f.identity.worktreePath);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('historical missing issuer receipt stays SAFE_HOLD despite caller claims', async () => {
  const f = await fixture();
  try {
    const result = await f.authenticate({ verdict: 'NO_SOURCE_WRITING_DESCENDANTS', authenticated: true });
    assert.equal(result.authenticated, false);
    assert.equal(result.evidence, null);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('no configured separate issuer root and key means no automatic historical authorization', async () => {
  const f = await fixture();
  try {
    await f.sign();
    for (const env of [{}, { STEPHANOS_SOURCE_CUSTODY_RECEIPTS_DIR: f.receipts },
      { STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_PATH: f.keyPath }]) {
      const result = await f.authenticate(null, { env });
      assert.equal(result.authenticated, false);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('tampering claims after signing or substituting issuer key fails closed', async () => {
  const f = await fixture();
  try {
    await f.sign();
    let raw = await (await import('node:fs/promises')).readFile(f.receiptPath, 'utf8');
    await writeFile(f.receiptPath, raw.replace('12345', '12346'));
    assert.equal((await f.authenticate(null)).authenticated, false);
    const impostor = generateKeyPairSync('ed25519');
    await f.sign(f.claims, impostor.privateKey);
    assert.equal((await f.authenticate(null)).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('cross-lease, cross-worktree and exact-head replays are denied even if signed', async () => {
  const f = await fixture();
  try {
    for (const changed of [
      { leaseDigest: 'c'.repeat(64) }, { leaseId: MISSION + '-r9-lease' },
      { worktreePath: join(f.dir, 'other-worktree') },
      { headSha: 'd'.repeat(40) }, { sourceExecutionId: MISSION + '-r2-27828c3fdb2c' },
      { repository: 'attacker/repo' }, { branch: 'attacker/branch' },
    ]) {
      await f.sign({ ...f.claims, ...changed });
      assert.equal((await f.authenticate(null)).authenticated, false, Object.keys(changed)[0]);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('job lifecycle violations, PID ambiguity and premature job close never yield writer-exclusion proof', async () => {
  const f = await fixture();
  try {
    for (const changed of [
      { createdSuspended: false }, { assignedBeforeResume: false },
      { killOnJobClose: false }, { breakawayPermitted: true },
      { jobClosed: false }, { allProcessesExited: false },
      { externalProcessCreationDenied: false },
      { worktreeAclIsolated: false },
      { wholeWorkerLifetimeCovered: false },
      { issuerObservedNoExternalWriters: false },
      { isolatedWriterPrincipalSid: '' },
      { isolationPolicySha256: '' },
      { activeProcessCount: 1 }, { rootPid: 0 },
      { processExitedAtUtc: new Date(NOW - 5000).toISOString() },
    ]) {
      await f.sign({ ...f.claims, ...changed });
      assert.equal((await f.authenticate(null)).authenticated, false, Object.keys(changed)[0]);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('stale or future signatures cannot release old source attempts', async () => {
  const f = await fixture();
  try {
    await f.sign();
    assert.equal((await f.authenticate(null, { now: () => NOW + 300001 })).authenticated, false);
    assert.equal((await f.authenticate(null, { now: () => NOW - 2000 })).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('symlinked receipt and path traversal never become a trusted custody issuer', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const otherPath = join(f.dir, 'other.json');
    const bytes = await (await import('node:fs/promises')).readFile(f.receiptPath);
    await rm(f.receiptPath);
    await writeFile(otherPath, bytes);
    await symlink(otherPath, f.receiptPath);
    assert.equal((await f.authenticate(null)).authenticated, false);
    const unknown = await authenticateOriginalWriterExclusionEvidence(null,
      { ...f.identity, sourceExecutionId: '../outside' }, { env: f.env, now: () => NOW });
    assert.equal(unknown.authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('invalid issuer schema, oversized JSON and invalid Ed25519 signatures are terminal refusals', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const bytes = JSON.parse(await (await import('node:fs/promises')).readFile(f.receiptPath, 'utf8'));
    await writeFile(f.receiptPath, JSON.stringify({ ...bytes, issuer: 'fake-custodian' }));
    assert.equal((await f.authenticate(null)).authenticated, false);
    await writeFile(f.receiptPath, 'x'.repeat(17000));
    assert.equal((await f.authenticate(null)).authenticated, false);
    await writeFile(f.receiptPath, '{invalid');
    assert.equal((await f.authenticate(null)).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test('old symmetric-HMAC receipt schema is never accepted even with otherwise matching claims', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const data = JSON.parse(await (await import('node:fs/promises')).readFile(f.receiptPath, 'utf8'));
    data.schemaVersion = 'stephanos.original-source-writer-custody.v1';
    data.hmacSha256 = 'a'.repeat(64);
    await writeFile(f.receiptPath, JSON.stringify(data));
    assert.equal((await f.authenticate(null)).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('Job Object zero count never substitutes for separately signed external-writer exclusion', async () => {
  const f = await fixture();
  try {
    for (const removed of [
      'externalProcessCreationDenied', 'worktreeAclIsolated',
      'wholeWorkerLifetimeCovered', 'issuerObservedNoExternalWriters',
      'isolatedWriterPrincipalSid', 'isolationPolicySha256',
    ]) {
      const claims = { ...f.claims };
      delete claims[removed];
      await f.sign(claims);
      const proof = await f.authenticate({ authenticated: true, verdict: 'NO_SOURCE_WRITING_DESCENDANTS' });
      assert.equal(proof.authenticated, false, removed);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('public verifier key alone cannot mint a receipt without independently isolated Ed25519 private key', async () => {
  const f = await fixture();
  try {
    const publicPem = await (await import('node:fs/promises')).readFile(f.keyPath);
    await f.sign();
    const valid = JSON.parse(await (await import('node:fs/promises')).readFile(f.receiptPath, 'utf8'));
    assert.equal((await f.authenticate(null)).authenticated, true);
    valid.claims.activeProcessCount = 1;
    await writeFile(f.receiptPath, JSON.stringify(valid));
    assert.equal((await f.authenticate(null)).authenticated, false);
    const attacker = generateKeyPairSync('ed25519');
    await f.sign(f.claims, attacker.privateKey);
    assert.equal((await f.authenticate(null)).authenticated, false);
    assert.match(publicPem.toString(), /BEGIN PUBLIC KEY/);
    assert.doesNotMatch(publicPem.toString(), /PRIVATE KEY/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test('public-key fingerprint is a separate expected trust anchor, not a replaceable receipt-side key', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const altered = { ...f.env, STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256: '0'.repeat(64) };
    assert.equal((await f.authenticate(null, { env: altered })).authenticated, false);
    const omitted = { ...f.env };
    delete omitted.STEPHANOS_SOURCE_CUSTODY_VERIFIER_PUBLIC_KEY_SHA256;
    assert.equal((await f.authenticate(null, { env: omitted })).authenticated, false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' });
    await writeFile(f.keyPath, other);
    assert.equal((await f.authenticate(null)).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('issuer signature without independent pre-execution commissioning remains SAFE_HOLD', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const noRoot = { ...f.env };
    delete noRoot.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_ROOT_PUBLIC_KEY_PATH;
    assert.equal((await f.authenticate(null, { env: noRoot })).authenticated, false);
    const noReceipt = { ...f.env };
    delete noReceipt.STEPHANOS_SOURCE_CUSTODY_COMMISSIONING_RECEIPT_PATH;
    assert.equal((await f.authenticate(null, { env: noReceipt })).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
