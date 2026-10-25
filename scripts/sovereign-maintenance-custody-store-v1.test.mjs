import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMaintenanceCustodyStoreV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { startSovereignCommanderContinuousRepairGuardian } from './sovereign-commander-http.mjs';

const machineHash = 'a'.repeat(64);
const clock = Date.now();
const oldNow = new Date(clock - 60_000).toISOString();
const now = () => new Date(clock).toISOString();
const oldBoot = { schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash,
  bootStartedAtUtc: new Date(clock - 86400_000).toISOString(), observedAtUtc: oldNow };
const newBoot = { ...oldBoot, bootStartedAtUtc: new Date(clock - 30_000).toISOString(), observedAtUtc: now() };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sovereign-custody-'));
  mkdirSync(join(root, 'status')); mkdirSync(join(root, 'events'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function store(root, bootWitness = oldBoot, overrides = {}) {
  return createMaintenanceCustodyStoreV1({ workspaceRoot: root, bootWitness,
    signingKey: 'fixture-sovereign-token-'.repeat(3),
    now: bootWitness === oldBoot ? () => oldNow : now, readBootWitness: () => bootWitness, ...overrides });
}
const reservation = { reservationId: 'original-cycle', operation: 'repair-stephanos' };
const approved = expectedDigest => ({ expectedDigest, operatorApproval: 'operator-approved' });

test('missing state, changed keys, and unsigned replacement never mean idle', t => {
  const root = fixture(t), original = store(root);
  assert.equal(original.status().held, true);
  assert.equal(original.reserve(reservation).ok, false);
  original.prepareIncident(reservation);
  const path = join(root, 'status', 'sovereign-commander-maintenance-custody.json');
  const envelope = JSON.parse(readFileSync(path));
  original.close();
  assert.equal(store(root, oldBoot, { signingKey: 'foreign-key-'.repeat(6) }).status().held, true);
  envelope.record.phase = 'IDLE'; writeFileSync(path, JSON.stringify(envelope));
  assert.equal(store(root).status().held, true);
  unlinkSync(path);
  assert.equal(store(root).status().held, true);
});

test('exclusive persistent reservation precedes execution and survives owner death', t => {
  const root = fixture(t); const first = store(root); const second = store(root);
  assert.equal(first.prepareIncident(reservation).ok, true);
  assert.equal(second.reserve(reservation).ok, false);
  assert.equal(second.release().ok, false);
  first.close();
  assert.equal(second.status().held, true);
  assert.equal(second.reserve(reservation).ok, false);
});

test('only the original exact owner can release a known terminal reservation', t => {
  const root = fixture(t); const first = store(root);
  assert.equal(first.prepareIncident(reservation).ok, true);
  assert.equal(first.release().ok, true);
  assert.equal(first.status().held, false);
  assert.equal(first.reserve({ ...reservation, reservationId: 'next-cycle' }).ok, true);
  first.close();
});

test('same-boot reload, foreign machine, stale witness and digest substitution cannot recover custody', async t => {
  const root = fixture(t); const original = store(root);
  original.prepareIncident(reservation); const digest = original.status().digest; original.close();
  for (const witness of [oldBoot, { ...newBoot, machineHash: 'b'.repeat(64) },
    { ...newBoot, observedAtUtc: new Date(clock - 16_000).toISOString() }]) {
    const successor = store(root, newBoot, { readBootWitness: () => witness });
    assert.equal((await successor.recoverAfterBoot(approved(digest))).ok, false);
    assert.equal(successor.status().held, true);
  }
  const successor = store(root, newBoot);
  assert.equal((await successor.recoverAfterBoot(approved('f'.repeat(64)))).ok, false);
  assert.equal((await successor.recoverAfterBoot({ expectedDigest: digest })).ok, false);
  assert.equal(successor.status().held, true);
});

test('successor full boot archives original unknown execution before admitting fixed maintenance', async t => {
  const root = fixture(t); const original = store(root);
  original.prepareIncident(reservation); const digest = original.status().digest; original.close();
  const successor = store(root, newBoot);
  const result = await successor.recoverAfterBoot(approved(digest));
  assert.equal(result.ok, true);
  assert.equal(result.historicalOutcome, 'UNKNOWN');
  assert.equal(result.originalR7Authority, false);
  assert.equal(successor.status().held, false);
  const audit = JSON.parse(readFileSync(join(root, 'events', 'sovereign-maintenance-custody',
    readdirSync(join(root, 'events', 'sovereign-maintenance-custody'))[0]))).receipt;
  assert.equal(audit.originalDigest, digest);
  assert.equal(audit.original.reservationId, 'original-cycle');
  assert.equal(audit.sourceLeaseReleased, false);
  assert.equal(successor.reserve({ reservationId: 'ui-4173', operation: 'repair-ui-4173' }).ok, true);
  successor.close();
});

test('recovery is single flight across independent owners while OS evidence is pending', async t => {
  const root = fixture(t); const original = store(root);
  original.prepareIncident(reservation); const digest = original.status().digest; original.close();
  let complete;
  const first = store(root, newBoot, { readBootWitness: () => new Promise(resolve => { complete = resolve; }) });
  const second = store(root, newBoot);
  const pending = first.recoverAfterBoot(approved(digest));
  assert.equal((await second.recoverAfterBoot(approved(digest))).ok, false);
  assert.equal(second.reserve(reservation).ok, false);
  complete(newBoot); assert.equal((await pending).ok, true);
  assert.equal((await second.recoverAfterBoot(approved(digest))).ok, false);
});

test('corrupt state and audit persistence failure both retain custody', async t => {
  const root = fixture(t); const original = store(root);
  original.prepareIncident(reservation); const digest = original.status().digest; original.close();
  writeFileSync(join(root, 'events', 'sovereign-maintenance-custody'), 'not a directory');
  const successor = store(root, newBoot);
  assert.equal((await successor.recoverAfterBoot(approved(digest))).ok, false);
  assert.equal(successor.status().digest, digest);
  writeFileSync(join(root, 'status', 'sovereign-commander-maintenance-custody.json'), '{');
  assert.equal(successor.status().held, true);
  assert.equal(successor.release().ok, false);
});

test('actual guardian persists a timeout fence and a same-boot successor cannot launch the UI', async t => {
  const root = fixture(t); const firstStore = store(root);
  firstStore.prepareIncident(reservation); firstStore.release();
  const scheduled = [];
  const guardian = startSovereignCommanderContinuousRepairGuardian({ custodyStore: firstStore,
    enabled: false, setTimeoutImpl: fn => { scheduled.push(fn); return {}; }, clearTimeoutImpl() {} });
  const command = { commandId: 'manual-ui', plan: { processId: 'repair-ui-4173' } };
  const result = await guardian.withMaintenanceOwner(command, async () => ({ structuredContent: { status: null, errorCode: 'ETIMEDOUT' } }));
  assert.equal(result.ok, false); assert.equal(guardian.status().timeoutCustodyHeld, true);
  guardian.stop();
  const successor = startSovereignCommanderContinuousRepairGuardian({ custodyStore: store(root), enabled: false });
  let launched = false;
  await successor.withMaintenanceOwner(command, async () => { launched = true; });
  assert.equal(launched, false);
  assert.equal(successor.status().timeoutCustodyHeld, true);
  successor.stop();
});

test('actual guardian releases known terminal work but recovery alone never reports repair success', async t => {
  const root = fixture(t); const first = store(root); first.prepareIncident(reservation);
  const digest = first.status().digest; first.close();
  const guardian = startSovereignCommanderContinuousRepairGuardian({ custodyStore: store(root, newBoot), enabled: false });
  assert.equal((await guardian.recoverAfterBoot(approved(digest))).ok, true);
  assert.equal(guardian.status().lastOk, false);
  let launched = false;
  await guardian.withMaintenanceOwner({ commandId: 'ui-after-recovery', plan: { processId: 'repair-ui-4173' } },
    async () => { launched = true; return { structuredContent: { status: 0 } }; });
  assert.equal(launched, true); assert.equal(guardian.status().persistentCustody.held, false);
  guardian.stop();
});

test('restart admission follows the shared terminal-evidence model across adversarial outcomes', async t => {
  const cases = [
    { execution: { status: 0 }, held: false },
    { execution: { status: 1 }, held: false },
    { execution: { status: null }, held: true },
    { execution: { status: 0, signal: 'SIGTERM' }, held: true },
    { execution: { status: 0, errorCode: 'ETIMEDOUT' }, held: true },
    { execution: { status: 0, steps: [{ status: null }] }, held: true },
    { throws: true, held: true },
  ];
  for (const row of cases) {
    const root = fixture(t), firstStore = store(root);
    firstStore.prepareIncident(reservation); firstStore.release();
    const guardian = startSovereignCommanderContinuousRepairGuardian({ custodyStore: firstStore, enabled: false });
    const command = { commandId: 'model-action', plan: { processId: 'repair-ui-4173' } };
    await guardian.withMaintenanceOwner(command, async () => {
      if (row.throws) throw new Error('fixture execution lost');
      return { structuredContent: row.execution };
    });
    assert.equal(guardian.status().timeoutCustodyHeld, row.held);
    guardian.stop();
    const successor = startSovereignCommanderContinuousRepairGuardian({ custodyStore: store(root), enabled: false });
    let launches = 0;
    await successor.withMaintenanceOwner(command, async () => { launches++; return { structuredContent: { status: 0 } }; });
    assert.equal(launches, row.held ? 0 : 1);
    assert.equal(successor.status().timeoutCustodyHeld, row.held);
    successor.stop();
  }
});
