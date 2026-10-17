import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink, link, rename, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authenticateLegacyOrphanQuarantine as check,
  LEGACY_ORPHAN_QUARANTINE_SCHEMA as schema,
  LEGACY_ORPHAN_WITNESS_DOMAIN as osDomain,
  LEGACY_ORPHAN_APPROVAL_DOMAIN as approvalDomain,
} from './legacyOriginalSourceOrphanQuarantineV1.js';

const NOW = Date.parse('2026-10-12T17:00:00.000Z');
const digest = x => createHash('sha256').update(x).digest('hex');
const WITNESS_SID = 'S-1-5-21-100-200-300-406';
const OPERATOR_SID = 'S-1-5-21-100-200-300-407';
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'stephanos-legacy-quarantine-'));
  const checkoutDirectory = join(dir, 'source-worktree');
  await mkdir(checkoutDirectory);
  // Windows temp roots may be reached through a case/alias variant.
  // The production verifier requires an exact canonical named worktree.
  const worktreePath = await realpath(checkoutDirectory);
  const witness = generateKeyPairSync('ed25519');
  const operator = generateKeyPairSync('ed25519');
  const witnessPem = witness.publicKey.export({ format: 'pem', type: 'spki' });
  const operatorPem = operator.publicKey.export({ format: 'pem', type: 'spki' });
  const evidence = join(dir, 'evidence.json');
  const witnessKey = join(dir, 'witness-public.pem');
  const operatorKey = join(dir, 'operator-public.pem');
  await writeFile(witnessKey, witnessPem);
  await writeFile(operatorKey, operatorPem);
  const env = {
    STEPHANOS_LEGACY_ORPHAN_EVIDENCE_PATH: evidence,
    STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_PATH: witnessKey,
    STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_PATH: operatorKey,
    STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_SHA256: digest(witnessPem),
    STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_SHA256: digest(operatorPem),
  };
  const expected = {
    repository: 'Cheekyfellastef/stephan-os',
    missionId: 'critical-2962-elastic-goal',
    leaseId: 'critical-2962-elastic-goal-r7-lease',
    revision: 7,
    originalLeaseDigest: 'a'.repeat(64),
    headSha: 'b'.repeat(40),
    sourceRevision: 'c'.repeat(40),
    sourceExecutionId: 'critical-2962-elastic-goal-r1-123456abcdef',
    commandId: 'quarantine-r7-unique-01',
    requestId: 'operator-approved-quarantine-r7-01',
    branch: 'openclaw/elastic-goal-2962',
    worktreePath,
  };
  const witnessClaims = {
    repository: expected.repository, missionId: expected.missionId,
    leaseId: expected.leaseId, revision: expected.revision,
    originalLeaseDigest: expected.originalLeaseDigest,
    branch: expected.branch, headSha: expected.headSha,
    sourceRevision: expected.sourceRevision, worktreePath: expected.worktreePath,
    sourceExecutionId: expected.sourceExecutionId,
    historicalTerminalReceiptPresent: false,
    historicalTerminalReceiptReconstructed: false,
    historicalExecutionOutcome: 'UNKNOWN',
    containmentEffectiveAtUtc: '2026-10-12T16:58:00.000Z',
    observedAtUtc: '2026-10-12T16:59:00.000Z',
    signedAtUtc: '2026-10-12T16:59:20.000Z',
    activeOriginalSourceWriters: 0,
    oldWriterAccessRevoked: true,
    outOfJobExecutionRevoked: true,
    wmiComRelaunchDenied: true,
    scheduledTaskRelaunchDenied: true,
    sourceWriteAccessDeniedToOriginalPrincipals: true,
    testedOldPrincipalWriteDenied: true,
    knownWorkerQueuesQuiesced: true,
    containmentRemainsEnforced: true,
    independentOsWitnessSid: WITNESS_SID,
    osEvidenceDigest: 'd'.repeat(64),
    denyAclPolicyDigest: 'e'.repeat(64),
    protectedWitnessLogId: 'os-witness-log-20261012-2962',
  };
  const signPart = (claims, key, domain) => ({
    algorithm: 'Ed25519', claims,
    signatureBase64: sign(null,
      Buffer.from(domain + JSON.stringify(claims), 'utf8'), key).toString('base64'),
  });
  async function emit({ witnessChanges = {}, approvalChanges = {},
    witnessSigner = witness.privateKey, approvalSigner = operator.privateKey } = {}) {
    const osWitness = signPart({ ...witnessClaims, ...witnessChanges }, witnessSigner, osDomain);
    const operatorClaims = {
      repository: expected.repository, missionId: expected.missionId,
      leaseId: expected.leaseId, revision: 7, originalLeaseDigest: expected.originalLeaseDigest,
      witnessDigest: digest(Buffer.from(JSON.stringify(osWitness), 'utf8')),
      commandId: expected.commandId, requestId: expected.requestId,
      approvedAtUtc: '2026-10-12T16:59:40.000Z',
      historicalOutcomeRemainsUnknown: true, deferGoalNotComplete: true,
      operatorApprovalKind: 'QUARANTINE_ORIGINAL_EXECUTION_ONLY',
      operatorSid: OPERATOR_SID,
      ...approvalChanges,
    };
    const operatorApproval = signPart(operatorClaims, approvalSigner, approvalDomain);
    await writeFile(evidence, JSON.stringify({
      schemaVersion: schema, osWitness, operatorApproval,
    }));
  }
  const inspect = (e = expected, cfg = env, time = NOW) =>
    check(e, { env: cfg, now: () => time });
  return { dir, env, expected, inspect, emit, evidence, witnessKey, operatorKey, witnessClaims };
}
test('two valid independent signatures produce readiness only, no lease or source authority', async () => {
  const f = await fixture();
  try {
    await f.emit();
    const r = await f.inspect();
    assert.equal(r.authenticated, true, r.blocker);
    assert.equal(r.classification, 'LEGACY_ORPHAN_PROSPECTIVE_CONTAINMENT_VERIFIED');
    assert.equal(r.leaseReleaseAuthority, false);
    assert.equal(r.sourceMutationAuthority, false);
    assert.equal(r.goalComplete, false);
    assert.equal(r.historicalExecutionOutcome, 'UNKNOWN');
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('missing evidence, missing digest, absent trust root and source-inside receipt HOLD', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit();
    assert.equal((await f.inspect({ ...f.expected, originalLeaseDigest: undefined })).authenticated, false);
    assert.equal((await f.inspect(f.expected, { ...f.env, STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_PATH: '' })).authenticated, false);
    assert.equal((await f.inspect(f.expected, { ...f.env,
      STEPHANOS_LEGACY_ORPHAN_EVIDENCE_PATH: join(f.expected.worktreePath, 'evidence.json'),
    })).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('new identity and lease binding cannot authorize other missions, revisions or heads', async () => {
  const f = await fixture();
  try {
    await f.emit();
    for (const change of [
      { missionId: 'critical-2955-elastic-goal' },
      { revision: 6 }, { leaseId: 'critical-2962-elastic-goal-r8-lease' },
      { sourceExecutionId: 'critical-2962-elastic-goal-r2-123456abcdef' },
      { originalLeaseDigest: 'f'.repeat(64) },
      { headSha: 'a'.repeat(40) }, { sourceRevision: 'a'.repeat(40) },
      { branch: 'some-other-branch' }, { requestId: 'another-request-012345' },
    ]) {
      const observed = await f.inspect({ ...f.expected, ...change });
      assert.equal(observed.authenticated, false, Object.keys(change)[0]);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('missing original history is never rewritten as completed; OS containment failures HOLD', async () => {
  const f = await fixture();
  try {
    for (const change of [
      { historicalTerminalReceiptPresent: true },
      { historicalTerminalReceiptReconstructed: true },
      { historicalExecutionOutcome: 'COMPLETED' },
      { historicalExecutionOutcome: 'FAILED' },
      { activeOriginalSourceWriters: 1 },
      { oldWriterAccessRevoked: false },
      { outOfJobExecutionRevoked: false },
      { wmiComRelaunchDenied: false },
      { scheduledTaskRelaunchDenied: false },
      { sourceWriteAccessDeniedToOriginalPrincipals: false },
      { testedOldPrincipalWriteDenied: false },
      { knownWorkerQueuesQuiesced: false },
      { containmentRemainsEnforced: false },
      { osEvidenceDigest: '' },
      { denyAclPolicyDigest: '' },
    ]) {
      await f.emit({ witnessChanges: change });
      const r = await f.inspect();
      assert.equal(r.authenticated, false, Object.keys(change)[0]);
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('independent operator signature is not replaceable with OS witness or compromised key', async () => {
  const f = await fixture();
  try {
    const impostor = generateKeyPairSync('ed25519');
    await f.emit({ approvalSigner: impostor.privateKey });
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit({ witnessSigner: impostor.privateKey });
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit({ approvalChanges: { operatorSid: WITNESS_SID } });
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit({ approvalChanges: { deferGoalNotComplete: false } });
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit({ approvalChanges: { historicalOutcomeRemainsUnknown: false } });
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit({ approvalChanges: { operatorApprovalKind: 'FORCE_RELEASE' } });
    assert.equal((await f.inspect()).authenticated, false);
    await f.emit();
    assert.equal((await f.inspect(f.expected, { ...f.env,
      STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_PATH: f.operatorKey,
      STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_SHA256: f.env.STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_SHA256,
    })).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('evidence freshness and monotonic timestamp order are enforced', async () => {
  const f = await fixture();
  try {
    await f.emit();
    assert.equal((await f.inspect(f.expected, f.env, NOW + 10 * 60_000)).authenticated, false);
    assert.equal((await f.inspect(f.expected, f.env, NOW - 40_000)).authenticated, false);
    for (const change of [
      { containmentEffectiveAtUtc: '2026-10-12T16:59:10.000Z' },
      { observedAtUtc: '2026-10-12T17:00:01.000Z' },
      { signedAtUtc: '2026-10-12T17:01:00.000Z' },
    ]) {
      await f.emit({ witnessChanges: change });
      assert.equal((await f.inspect()).authenticated, false);
    }
    await f.emit({ approvalChanges: { approvedAtUtc: '2026-10-12T16:58:00.000Z' } });
    assert.equal((await f.inspect()).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test('symlinked or in-checkout trusted file cannot be used as rescue evidence', async () => {
  const f = await fixture();
  try {
    await f.emit();
    const alias = join(f.dir, 'alias.json');
    await symlink(f.evidence, alias);
    assert.equal((await f.inspect(f.expected, { ...f.env,
      STEPHANOS_LEGACY_ORPHAN_EVIDENCE_PATH: alias,
    })).authenticated, false);
    assert.equal((await f.inspect(f.expected, { ...f.env,
      STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_PATH: f.operatorKey,
    })).authenticated, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('hard-linked custody evidence or trust root cannot satisfy external-path protection', async () => {
  const f = await fixture();
  try {
    await f.emit();
    assert.equal((await f.inspect()).authenticated, true);
    const linkedEvidence = join(f.expected.worktreePath, 'linked-evidence.json');
    await link(f.evidence, linkedEvidence);
    const deniedEvidence = await f.inspect();
    assert.equal(deniedEvidence.authenticated, false);
    assert.equal(deniedEvidence.leaseReleaseAuthority, false);
    await rm(linkedEvidence);

    const linkedKey = join(f.expected.worktreePath, 'linked-public-key.pem');
    await link(f.witnessKey, linkedKey);
    const deniedKey = await f.inspect();
    assert.equal(deniedKey.authenticated, false);
    assert.equal(deniedKey.leaseReleaseAuthority, false);
    await rm(linkedKey);
    assert.equal((await f.inspect()).authenticated, true);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('renamed-away trusted receipt and substituted symlink fail closed', async () => {
  const f = await fixture();
  try {
    await f.emit();
    assert.equal((await f.inspect()).authenticated, true);
    const movedEvidence = join(f.dir, 'moved-evidence.json');
    await rename(f.evidence, movedEvidence);
    await symlink(movedEvidence, f.evidence);
    const denied = await f.inspect();
    assert.equal(denied.authenticated, false);
    assert.equal(denied.leaseReleaseAuthority, false);
    assert.equal(denied.sourceMutationAuthority, false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
