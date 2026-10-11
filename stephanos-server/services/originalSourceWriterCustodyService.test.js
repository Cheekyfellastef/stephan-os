import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authenticateOriginalWriterExclusionEvidence,
  ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA,
} from './originalSourceWriterCustodyService.js';

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
  const keyPath = join(dir, 'verification-key');
  await mkdir(receipts);
  await mkdir(worktreePath);
  const key = Buffer.from('synthetic-test-only-issuer-key-32-bytes-minimum!!!!');
  await writeFile(keyPath, key);
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
    jobClosed: false,
    allProcessesExited: true,
    activeProcessCount: 0,
    rootPid: 12345,
    authorityReceiptId: 'custody-windows-job-2962-r1',
  };
  const env = {
    STEPHANOS_SOURCE_CUSTODY_RECEIPTS_DIR: receipts,
    STEPHANOS_SOURCE_CUSTODY_VERIFIER_KEY_PATH: keyPath,
  };
  const receiptPath = join(receipts, EXECUTION + '.json');
  const sign = async (contents = claims, keyBytes = key) => {
    const record = {
      schemaVersion: ORIGINAL_WRITER_CUSTODY_RECEIPT_SCHEMA,
      issuer: 'stephanos-windows-job-custody-service',
      claims: contents,
      hmacSha256: createHmac('sha256', keyBytes)
        .update(JSON.stringify(contents), 'utf8').digest('hex'),
    };
    await writeFile(receiptPath, JSON.stringify(record));
  };
  const authenticate = (input, opts = {}) => authenticateOriginalWriterExclusionEvidence(input, identity, {
    env: opts.env || env, now: opts.now || (() => NOW),
  });
  return { dir, identity, claims, env, sign, authenticate, receipts, receiptPath, keyPath };
}

test('test-only synthetic OS claim validates exact identity and HMAC with no public control over evidence', async () => {
  const f = await fixture();
  try {
    await f.sign();
    const good = await f.authenticate({ verdict: 'FORGED_PUBLIC_VERDICT' });
    assert.equal(good.authenticated, true);
    assert.equal(good.evidence.sourceExecutionId, EXECUTION);
    assert.equal(good.evidence.authorityReceiptSha256.length, 64);
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
      { STEPHANOS_SOURCE_CUSTODY_VERIFIER_KEY_PATH: f.keyPath }]) {
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
    await f.sign(f.claims, Buffer.from('untrusted-different-issuer-key-for-negative-test'));
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
      { jobClosed: true }, { allProcessesExited: false },
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

test('invalid issuer schema, oversized JSON and invalid HMAC are terminal refusals', async () => {
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
