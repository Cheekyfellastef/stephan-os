import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  projectCoreGateEvidenceV1, planCoreGateStewardV1,
} from './goalConveyorGateStewardV1.mjs';
import { publishSignedCoreGateEvidenceV1 } from './goalBuildGateSignedPublisherV1.mjs';
import { validateSharedWorkspaceRecord } from '../agents/sharedAgentWorkspaceStore.mjs';
import { projectGoalBuildGateObservatoryV1 } from './goalBuildGateObservatoryV1.mjs';
import { projectPublicGoalGateObservatoryV1 } from './goalBuildGatePublicProjectionV1.mjs';

const head = 'a'.repeat(40);
const observedAtUtc = '2026-10-13T13:15:00.000Z';
const nowMs = Date.parse(observedAtUtc);

function raw() {
  return projectCoreGateEvidenceV1({
    sourceHead: head, observedAtUtc,
    state: { daemonHealthy: true, missionWorkerHealthy: true, sovereignCommanderHealthy: true, backendHealthy: true },
    refillSummary: { refillCanonicalProgrammeHeld: true,
      refillCanonicalProgrammeBlockerIdentity: 'lane:elastic-lease-expired-or-not-active' },
    lastRepairBlocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
    lastRepairSourceHead: head,
    nativeRouting: { ok: false, reason: 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID' },
  });
}

test('single Core steward separates 23 independent gates and does not self-authorize', async () => {
  const facts = raw();
  assert.equal(facts.ok, true);
  assert.deepEqual(facts.evidence.gates.map(x => x.id), [3, 7, 8, 9, 13]);
  const shadow = planCoreGateStewardV1({
    sourceHead: head, gates: facts.evidence.gates,
  }, { nowMs });
  assert.equal(shadow.gateCount, 23);
  assert.equal(shadow.mode, 'SHADOW_READ_ONLY');
  assert.equal(shadow.nextAction.gateId, 8);
  assert.equal(shadow.autoExecuteAllowed, false);
  assert.equal(shadow.approvalAuthority, false);
  assert.equal(shadow.leaseOverrideAllowed, false);
  assert.equal(shadow.duplicateControllerAllowed, false);
  const cooldown = planCoreGateStewardV1({
    sourceHead: head, gates: facts.evidence.gates,
  }, { nowMs: nowMs + 5000, previousActionKey: shadow.proofKey, previousAttemptAtMs: nowMs });
  assert.equal(cooldown.nextAction.gateId, 13);
  assert.equal(cooldown.decision, 'PROPOSE_EXISTING_AUTHORITY_ACTION');
  const oneHourLater = planCoreGateStewardV1({ sourceHead: head, gates: facts.evidence.gates },
    { nowMs: nowMs + 60 * 60_000, previousActionKey: shadow.proofKey, previousAttemptAtMs: nowMs });
  assert.equal(oneHourLater.decision, 'PROPOSE_EXISTING_AUTHORITY_ACTION');
  const coreSource = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(coreSource, /previousActionKey: lastGateStewardActionKey/);
  assert.match(coreSource, /previousAttemptAtMs: lastGateStewardAttemptAtMs/);
  assert.match(coreSource, /lastGateStewardAttemptAtMs = proposedAtMs/);
  assert.equal(planCoreGateStewardV1({
    sourceHead: head, gates: facts.evidence.gates,
  }, { nowMs, gamingProtected: true }).nextAction, null);
});

test('unsigned Core facts cannot make the local or public observatory green', () => {
  const payload = raw();
  const fakeCore = { sourceHead: head, goalBuildGateEvidence: payload.evidence };
  const obs = projectGoalBuildGateObservatoryV1({
    statusRecords: [fakeCore], expectedSourceHead: head, nowMs,
  });
  assert.equal(obs.counts.PASS, 0);
  assert.equal(obs.counts.FAIL, 0);
  assert.equal(obs.counts.UNVERIFIED, 23);
  const publicView = projectPublicGoalGateObservatoryV1(fakeCore, { sourceHead: head, nowMs });
  assert.equal(publicView.gates.length, 23);
  assert.equal(publicView.counts.PASS, 0);
  assert.equal(publicView.counts.FAIL, 0);
  assert.equal(publicView.observationStatus, 'UNVERIFIED');
});

test('externally pinned Ed25519 signer makes individual evidence visible, never grants authority', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ format: 'pem', type: 'spki' });
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const records = new Map();
  const write = async (_root, segments, record) => {
    const checked = validateSharedWorkspaceRecord(record, { nowMs });
    assert.equal(checked.valid, true, `${segments.join('/')} ${checked.errors.join(',')}`);
    records.set(segments.join('/'), structuredClone(record));
    return { ok: true };
  };
  const result = await publishSignedCoreGateEvidenceV1({
    root: '/proof-only-workspace', repoRoot: '/repo',
    sourceHead: head, observedAtUtc, coreEvidence: raw().evidence,
    signingPrivateKeyPem: privatePem, write,
  });
  assert.equal(result.ok, true);
  const status = records.get('status/goal-build-gates-current.json');
  const proofs = [...records.entries()].filter(([p]) => p.startsWith('proof/')).map(([,p]) => p);
  assert.equal(proofs.length, 5);
  assert.ok(proofs.every(p => /^goal-gate-(?:[1-9]|1[0-9]|2[0-3])-[a-f0-9]{12}$/.test(p.correlationId)));
  assert.ok(proofs.every(p => p.proofRefs.length === 1 && /^proof\/goal-gate-(?:[1-9]|1[0-9]|2[0-3])\.json$/.test(p.proofRefs[0])));
  assert.ok(status.proofRefs.every(p => /^proof\/goal-gate-(?:[1-9]|1[0-9]|2[0-3])\.json$/.test(p)));
  const authenticated = projectGoalBuildGateObservatoryV1({
    statusRecords: [status], proofRecords: proofs, expectedSourceHead: head,
    trustedPublicKeyPem: pem,
    trustedPublicKeySha256: createHash('sha256').update(pem).digest('hex'),
    nowMs,
  });
  assert.equal(authenticated.observationStatus, 'EVIDENCE_AVAILABLE');
  assert.equal(authenticated.gates[6].status, 'FAIL');
  assert.equal(authenticated.gates[7].status, 'FAIL');
  assert.equal(authenticated.gates[8].status, 'FAIL');
  assert.equal(authenticated.gates[12].status, 'FAIL');
  assert.equal(authenticated.gates[2].status, 'PASS');
  const publicView = projectPublicGoalGateObservatoryV1(null, {
    sourceHead: head, nowMs, verifiedObservatory: authenticated,
  });
  assert.equal(publicView.counts.FAIL, 4);
  assert.equal(publicView.counts.PASS, 1);
  assert.equal(publicView.approvalAuthority, false);
  assert.equal(publicView.mergeAuthority, false);
  assert.equal(publicView.gates[7].proofRef, 'workspace:proof/goal-gate-8');
  assert.equal(publicView.gates[6].typedBlocker, 'LANE:ELASTIC-LEASE-EXPIRED-OR-NOT-ACTIVE');

  const tamperedProofs = proofs.map((p, i) => i === 0 ? { ...p, summary: 'forged' } : p);
  const declined = projectGoalBuildGateObservatoryV1({
    statusRecords: [status], proofRecords: tamperedProofs, expectedSourceHead: head,
    trustedPublicKeyPem: pem,
    trustedPublicKeySha256: createHash('sha256').update(pem).digest('hex'), nowMs,
  });
  assert.equal(declined.counts.PASS, 0);
  assert.equal(declined.counts.FAIL, 0);
  assert.equal(declined.counts.UNVERIFIED, 23);
});
test('no commissioned signing key cannot create a signed gate receipt', async () => {
  let wrote = false;
  const res = await publishSignedCoreGateEvidenceV1({
    sourceHead: head, observedAtUtc, coreEvidence: raw().evidence,
    write: async () => { wrote = true; return { ok: true }; },
  });
  assert.equal(res.ok, false);
  assert.equal(wrote, false);
});

test('independent per-gate cooldown does not park native capacity behind original custody HOLD', async () => {
  const gates = raw().evidence.gates;
  const base = { sourceHead: head, gates };
  const first = planCoreGateStewardV1(base, { nowMs });
  assert.equal(first.nextAction.gateId, 8);
  const ledger = [{ key: first.proofKey, atMs: nowMs }];
  const second = planCoreGateStewardV1(base, {
    nowMs: nowMs + 1000, previousAttempts: ledger,
    previousActionKey: first.proofKey, previousAttemptAtMs: nowMs,
  });
  assert.equal(second.decision, 'PROPOSE_EXISTING_AUTHORITY_ACTION');
  assert.equal(second.nextAction.gateId, 13);
  assert.deepEqual(second.coolingGateIds, [8]);
  ledger.push({ key: second.proofKey, atMs: nowMs + 1000 });
  const third = planCoreGateStewardV1(base, {
    nowMs: nowMs + 2000, previousAttempts: ledger,
  });
  assert.equal(third.nextAction.gateId, 7);
  // All independently observed failures have separate cooldowns, without
  // turning a proposal into an execution or an authority grant.
  ledger.push({ key: third.proofKey, atMs: nowMs + 2000 });
  const fourth = planCoreGateStewardV1(base, {
    nowMs: nowMs + 3000, previousAttempts: ledger,
  });
  assert.equal(fourth.nextAction.gateId, 9);
  ledger.push({ key: fourth.proofKey, atMs: nowMs + 3000 });
  const allCooling = planCoreGateStewardV1(base, {
    nowMs: nowMs + 4000, previousAttempts: ledger,
  });
  assert.equal(allCooling.nextAction, null);
  assert.equal(allCooling.decision, 'SAME_EVIDENCE_COOLDOWN');
  assert.ok(allCooling.retryAfterMs > 0);
  assert.equal(allCooling.autoExecuteAllowed, false);
  assert.equal(allCooling.leaseOverrideAllowed, false);
  const sourceChanged = planCoreGateStewardV1({ sourceHead: 'b'.repeat(40), gates },
    { nowMs: nowMs + 4000, previousAttempts: ledger });
  assert.equal(sourceChanged.nextAction, null);
  assert.equal(sourceChanged.decision, 'AWAIT_FRESH_GATE_PROOF');
  const coreSource = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(coreSource, /previousAttempts: lastGateStewardAttempts/);
  assert.match(coreSource, /lastGateStewardAttempts = \[/);
  assert.match(coreSource, /\.slice\(-23\)/);
});
