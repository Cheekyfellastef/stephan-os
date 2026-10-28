import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMaintenanceCustodyStoreV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { runMaintenanceCustodyRecoveryV1 } from './sovereign-maintenance-custody-recovery.mjs';
const key = 'fixture-retained-migration-key-'.repeat(3), head = 'c'.repeat(40);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'retained-migration-cli-'));
  mkdirSync(join(root, 'status')); mkdirSync(join(root, 'events'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const boot = { schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash: 'a'.repeat(64),
    bootStartedAtUtc: new Date(Date.now() - 86400_000).toISOString(), observedAtUtc: new Date().toISOString() };
  let latest = null, sequence = 0;
  const anchor = { readLatest: () => latest,
    append: (bytes, { expectedRecordId }) => {
      assert.equal(latest?.eventRecordId ?? null, expectedRecordId);
      latest = { bytes: Buffer.from(bytes), eventRecordId: ++sequence }; return latest;
    } };
  const s = createMaintenanceCustodyStoreV1({ workspaceRoot: root, signingKey: key, anchor, bootWitness: boot });
  s.prepareIncident({ reservationId: 'old-authenticated-idle', operation: 'repair-stephanos' }); s.release(); s.close();
  latest = null;
  const bytes = readFileSync(join(root, 'status', 'sovereign-commander-maintenance-custody.json'));
  const observation = { schemaVersion: 'stephanos.maintenance-held-owner-observation.v2',
    pid: 12, createdAtUtc: new Date(Date.now() - 60_000).toISOString(),
    commandSha256: 'd'.repeat(64), imageSha256: 'e'.repeat(64),
    lastCycleId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastStartedAtUtc: new Date().toISOString(),
    timeoutCustodyHeld: true, running: false, maintenanceInFlight: false, scheduled: false };
  const owner = { observation, digest: createHash('sha256').update(JSON.stringify(observation)).digest('hex'),
    observedAtUtc: new Date().toISOString() };
  const options = { workspaceRoot: root, anchor, tokenReader: async () => key,
    bootReader: async () => ({ ...boot, observedAtUtc: new Date().toISOString() }),
    ownerObserver: async () => ({ ...owner, observedAtUtc: new Date().toISOString() }),
    observeLegacyAudit: () => ({ present: false }), sourceReader: () => head,
    fetchFn: () => { throw new Error('OLD_OWNER_MUTATING_ENDPOINT_MUST_NOT_BE_CALLED'); } };
  return { root, bytes, options, owner, head, readAnchor: () => latest,
    approved: { expectedDigest: createHash('sha256').update(bytes).digest('hex'),
      expectedCycle: 'old-authenticated-idle', expectedOwnerDigest: owner.digest,
      expectedMain: head, operatorApproval: 'operator-approved' } };
}
test('read-only migration inspection authenticates provenance but never labels stale IDLE fresh', async t => {
  const f = fixture(t), r = await runMaintenanceCustodyRecoveryV1({ ...f.options, mode: 'inspect-retained-migration' });
  assert.equal(r.ok, true); assert.equal(r.projectionPhase, 'IDLE'); assert.equal(r.projectionFreshness, 'UNPROVEN');
  assert.equal(r.custodyReleased, false); assert.equal(f.readAnchor(), null);
  assert.deepEqual(readFileSync(join(f.root, 'status', 'sovereign-commander-maintenance-custody.json')), f.bytes);
});
test('new fixed local preparation preserves old HTTP pin and only journals ACTIVE', async t => {
  const f = fixture(t), r = await runMaintenanceCustodyRecoveryV1({
    ...f.options, ...f.approved, mode: 'prepare-retained-migration' });
  assert.equal(r.ok, true); assert.equal(r.prepared, true); assert.equal(r.custodyReleased, false);
  assert.equal(r.requiresLaterFullBoot, true); assert.equal(r.pcRestartAllowed, false);
  assert.equal(r.persistentCustody.held, true); assert.equal(JSON.parse(f.readAnchor().bytes).record.phase, 'ACTIVE');
});
test('missing exact approval/owner/source binding stops before retained preparation', async t => {
  for (const change of [{ operatorApproval: '' }, { expectedDigest: 'f'.repeat(64) },
    { expectedCycle: 'other' }, { expectedOwnerDigest: 'f'.repeat(64) }, { expectedMain: 'f'.repeat(40) }]) {
    const f = fixture(t), r = await runMaintenanceCustodyRecoveryV1({
      ...f.options, ...f.approved, ...change, mode: 'prepare-retained-migration' });
    assert.equal(r.ok, false); assert.equal(f.readAnchor(), null);
  }
});
test('source movement after preparation retains the real ACTIVE digest instead of claiming recovery', async t => {
  const f = fixture(t); let reads = 0;
  const r = await runMaintenanceCustodyRecoveryV1({ ...f.options, ...f.approved,
    sourceReader: () => ++reads > 1 ? 'f'.repeat(40) : head, mode: 'prepare-retained-migration' });
  assert.equal(r.ok, false); assert.equal(r.prepared, true); assert.equal(r.persistentCustody.held, true);
  assert.match(r.digest, /^[a-f0-9]{64}$/); assert.equal(r.custodyReleased, false);
});
