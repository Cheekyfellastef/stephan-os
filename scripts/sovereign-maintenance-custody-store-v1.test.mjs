import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMaintenanceCustodyStoreV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { startSovereignCommanderContinuousRepairGuardian as startActualGuardian } from './sovereign-commander-http.mjs';

// Legacy terminal protocol fixtures exercise the actual guardian with an
// explicit non-native transport. They never qualify a Windows runtime profile.
const startSovereignCommanderContinuousRepairGuardian = options => startActualGuardian({
  spawnImpl: () => assert.fail('manual custody fixture must not spawn'), ...options,
});

const machineHash = 'a'.repeat(64);
const clock = Date.now();
const oldNow = new Date(clock - 60_000).toISOString();
const now = () => new Date(clock).toISOString();
const oldBoot = { schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash,
  bootStartedAtUtc: new Date(clock - 86400_000).toISOString(), observedAtUtc: oldNow };
const newBoot = { ...oldBoot, bootStartedAtUtc: new Date(clock - 30_000).toISOString(), observedAtUtc: now() };
const anchors = new Map();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sovereign-custody-'));
  mkdirSync(join(root, 'status')); mkdirSync(join(root, 'events'));
  let latest = null, recordId = 0;
  anchors.set(root, { readLatest: () => latest && { ...latest, bytes: Buffer.from(latest.bytes) },
    lose: () => { latest = null; },
    append: (bytes, { expectedRecordId }) => {
      if ((latest?.eventRecordId ?? null) !== expectedRecordId) throw new Error('fixture native compare failed');
      latest = { bytes: Buffer.from(bytes), eventRecordId: ++recordId }; return latest;
    } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function store(root, bootWitness = oldBoot, overrides = {}) {
  return createMaintenanceCustodyStoreV1({ workspaceRoot: root, bootWitness,
    anchor: anchors.get(root),
    signingKey: 'fixture-sovereign-token-'.repeat(3), observeLegacyAudit: () => ({ present: false }),
    now: bootWitness === oldBoot ? () => oldNow : now, readBootWitness: () => bootWitness, ...overrides });
}
const reservation = { reservationId: 'original-cycle', operation: 'repair-stephanos' };
const approved = expectedDigest => ({ expectedDigest, operatorApproval: 'operator-approved' });

test('lost audit authority can only prepare ACTIVE; a boot later than preparation is required', async t => {
  const root = fixture(t), original = store(root);
  original.prepareIncident(reservation);
  const originalBytes = readFileSync(join(root, 'status', 'sovereign-commander-maintenance-custody.json'));
  const oldDigest = original.status().digest; original.close(); anchors.get(root).lose();
  const preparation = store(root, newBoot);
  assert.equal((await preparation.recoverAfterBoot(approved(oldDigest))).ok, false);
  const result = await preparation.prepareAfterAuditLoss({ ...approved(oldDigest), expectedReservationId: reservation.reservationId });
  assert.equal(result.ok, true); assert.equal(result.custodyReleased, false);
  assert.equal(result.requiresLaterFullBoot, true); assert.notEqual(result.digest, oldDigest);
  assert.equal(preparation.status().held, true);
  assert.equal(preparation.release().ok, false); preparation.close();
  assert.equal((await store(root, newBoot).recoverAfterBoot(approved(result.digest))).ok, false);
  const laterClock = clock + 60_000;
  const later = { ...newBoot, bootStartedAtUtc: new Date(clock + 30_000).toISOString(), observedAtUtc: new Date(laterClock).toISOString() };
  const successor = store(root, later, { now: () => later.observedAtUtc, readBootWitness: () => later });
  assert.equal((await successor.recoverAfterBoot(approved(result.digest))).ok, true);
  assert.equal(successor.status().held, false);
  const receipts = readdirSync(join(root, 'events', 'sovereign-maintenance-custody'));
  const archive = JSON.parse(readFileSync(join(root, 'events', 'sovereign-maintenance-custody', receipts.find(x => x.startsWith('audit-loss-'))))).receipt;
  assert.equal(archive.original.reservationId, reservation.reservationId);
  assert.equal(archive.originalDigest, oldDigest); assert.equal(archive.projectionFreshness, 'UNPROVEN');
  assert.deepEqual(Buffer.from(archive.originalEnvelopeBase64, 'base64'), originalBytes);
  assert.equal(archive.historicalOutcome, 'UNKNOWN'); assert.equal(archive.sourceLeaseReleased, false);
});

test('audit-loss preparation refuses present/corrupt authority, changed projection, absent approval and failed archive', async t => {
  for (const scenario of ['present', 'corrupt-anchor', 'changed', 'unapproved', 'foreign-cycle', 'archive-failed']) {
    const root = fixture(t), original = store(root); original.prepareIncident(reservation);
    const digest = original.status().digest; original.close();
    if (scenario !== 'present') anchors.get(root).lose();
    if (scenario === 'corrupt-anchor') anchors.get(root).readLatest = () => { throw new Error('untrusted'); };
    if (scenario === 'changed') writeFileSync(join(root, 'status', 'sovereign-commander-maintenance-custody.json'), '{}');
    if (scenario === 'archive-failed') writeFileSync(join(root, 'events', 'sovereign-maintenance-custody'), 'preserve me');
    const successor = store(root, newBoot);
    const result = await successor.prepareAfterAuditLoss({ ...approved(digest), expectedReservationId: reservation.reservationId,
      ...(scenario === 'unapproved' ? { operatorApproval: undefined } : {}),
      ...(scenario === 'foreign-cycle' ? { expectedReservationId: 'foreign-cycle' } : {}) });
    assert.equal(result.ok, false, scenario); assert.equal(successor.status().held, true, scenario);
    assert.equal(successor.release().ok, false); successor.close();
  }
});

test('audit-loss preparation retains exclusive custody while awaiting a fresh native boot observation', async t => {
  const root = fixture(t), original = store(root); original.prepareIncident(reservation);
  const digest = original.status().digest; original.close(); anchors.get(root).lose();
  let complete;
  const first = store(root, newBoot, { readBootWitness: () => new Promise(resolve => { complete = resolve; }) });
  const pending = first.prepareAfterAuditLoss({ ...approved(digest), expectedReservationId: reservation.reservationId });
  const other = store(root, newBoot);
  assert.equal((await other.prepareAfterAuditLoss({ ...approved(digest), expectedReservationId: reservation.reservationId })).ok, false);
  assert.equal(other.reserve(reservation).ok, false);
  complete(newBoot); assert.equal((await pending).ok, true);
  assert.equal(first.release().ok, false);
});

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

test('replaying old authenticated IDLE bytes cannot erase the newer OS-anchored ACTIVE incident', async t => {
  const root = fixture(t), original = store(root);
  original.prepareIncident(reservation); original.release();
  const path = join(root, 'status', 'sovereign-commander-maintenance-custody.json');
  const idleBytes = readFileSync(path);
  original.reserve({ reservationId: 'interrupted-newer-cycle', operation: 'repair-ui-4173' });
  const activeDigest = original.status().digest;
  original.close(); writeFileSync(path, idleBytes);
  const successor = store(root, newBoot);
  assert.equal(successor.status().held, true);
  assert.equal(successor.status().reservationId, 'interrupted-newer-cycle');
  assert.equal(successor.status().digest, activeDigest);
  assert.equal(successor.reserve(reservation).ok, false);
  assert.equal((await successor.recoverAfterBoot(approved(createHash('sha256').update(idleBytes).digest('hex')))).ok, false);
  assert.equal((await successor.recoverAfterBoot(approved(activeDigest))).ok, true);
});

test('replacing the workspace fence between two IDLE reads admits only the native compare winner', t => {
  const root = fixture(t), seed = store(root);
  seed.prepareIncident(reservation); seed.release();
  const native = anchors.get(root), originalRead = native.readLatest;
  const first = store(root), second = store(root);
  let secondResult, interleaved = false;
  native.readLatest = () => {
    const snapshot = originalRead();
    if (!interleaved) {
      interleaved = true;
      const fence = readdirSync(join(root, 'status')).find(name => name.endsWith('.lock'));
      unlinkSync(join(root, 'status', fence));
      secondResult = second.reserve({ reservationId: 'second-winner', operation: 'repair-ui-4173' });
    }
    return snapshot;
  };
  const firstResult = first.reserve({ reservationId: 'first-stale-reader', operation: 'repair-ui-4173' });
  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.ok, false);
  assert.equal(second.status().reservationId, 'second-winner');
  assert.equal(second.release().ok, true);
  first.close(); second.close();
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

function heldOwner(boot) {
  const observation = { schemaVersion: 'stephanos.maintenance-held-owner-observation.v2',
    pid: 7001, createdAtUtc: new Date(Date.parse(boot.bootStartedAtUtc) + 1).toISOString(),
    commandSha256: 'd'.repeat(64), imageSha256: 'e'.repeat(64),
    lastCycleId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastStartedAtUtc: boot.observedAtUtc,
    timeoutCustodyHeld: true, running: false, maintenanceInFlight: false, scheduled: false };
  return { observation, digest: createHash('sha256').update(JSON.stringify(observation)).digest('hex'),
    observedAtUtc: boot.observedAtUtc };
}
test('retained migration archives stale IDLE but only creates ACTIVE and requires another full boot', async t => {
  const root = fixture(t), first = store(root); first.prepareIncident(reservation); first.release(); first.close();
  const p = join(root, 'status', 'sovereign-commander-maintenance-custody.json'), original = readFileSync(p);
  const expectedDigest = createHash('sha256').update(original).digest('hex'); anchors.get(root).lose();
  const owner = heldOwner(newBoot);
  const migration = store(root, newBoot, { observeMigrationOwner: () => owner });
  const r = await migration.prepareRetainedMigration({ ...approved(expectedDigest),
    expectedReservationId: reservation.reservationId, expectedOwnerDigest: owner.digest, expectedMain: 'c'.repeat(40) });
  assert.equal(r.ok, true); assert.equal(r.custodyReleased, false); assert.equal(r.requiresLaterFullBoot, true);
  assert.equal(migration.status().held, true); assert.equal(migration.release().ok, false);
  assert.equal(JSON.parse(readFileSync(p)).record.phase, 'ACTIVE');
  assert.equal((await migration.recoverAfterBoot(approved(r.digest))).ok, false);
  const archived = readdirSync(join(root, 'events', 'sovereign-maintenance-custody')).find(x => x.startsWith('retained-migration-'));
  const receipt = JSON.parse(readFileSync(join(root, 'events', 'sovereign-maintenance-custody', archived))).receipt;
  assert.deepEqual(Buffer.from(receipt.originalEnvelopeBase64, 'base64'), original);
  assert.equal(receipt.original.phase, 'IDLE'); assert.equal(receipt.priorIdleIsFreshnessProof, false);
  assert.equal(receipt.heldOwnerObservation.digest, owner.digest); assert.equal(receipt.historicalOutcome, 'UNKNOWN');
  migration.close();
  const later = { ...newBoot, bootStartedAtUtc: new Date(clock + 30_000).toISOString(),
    observedAtUtc: new Date(clock + 60_000).toISOString() };
  const successor = store(root, later, { now: () => later.observedAtUtc, readBootWitness: () => later });
  assert.equal((await successor.recoverAfterBoot(approved(r.digest))).ok, true);
  assert.equal(successor.status().held, false);
});
test('prepared retained migration auto-recovers after successor full boot without a second approval token', async t => {
  const root = fixture(t), first = store(root);
  first.prepareIncident(reservation); first.release(); first.close();
  const p = join(root, 'status', 'sovereign-commander-maintenance-custody.json');
  const original = readFileSync(p);
  const expectedDigest = createHash('sha256').update(original).digest('hex');
  anchors.get(root).lose();
  const owner = heldOwner(newBoot);
  const migration = store(root, newBoot, { observeMigrationOwner: () => owner });
  const prepared = await migration.prepareRetainedMigration({
    ...approved(expectedDigest),
    expectedReservationId: reservation.reservationId,
    expectedOwnerDigest: owner.digest,
    expectedMain: 'c'.repeat(40),
  });
  assert.equal(prepared.ok, true);
  migration.close();

  const later = { ...newBoot,
    bootStartedAtUtc: new Date(clock + 30_000).toISOString(),
    observedAtUtc: new Date(clock + 60_000).toISOString() };
  const successor = store(root, later, { now: () => later.observedAtUtc, readBootWitness: () => later });
  const recovered = await successor.recoverPreparedAfterBoot();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.custodyReleased, true);
  assert.equal(successor.status().held, false);
});

test('unprepared ACTIVE custody never auto-recovers merely because a later boot exists', async t => {
  const root = fixture(t), original = store(root);
  original.prepareIncident(reservation);
  original.close();
  const successor = store(root, newBoot);
  const result = await successor.recoverPreparedAfterBoot();
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAINTENANCE_PREPARED_RECOVERY_UNPROVEN');
  assert.equal(successor.status().held, true);
});

test('guardian startup resumes scheduling only after prepared custody auto-recovery succeeds', async () => {
  const timers = [];
  let recoverCalls = 0;
  const timerFactory = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  const custodyStore = {
    status: () => ({ held: true, digest: 'a'.repeat(64), reservationId: 'prepared-cycle' }),
    preparedRecoveryEligible: () => true,
    recoverPreparedAfterBoot: async () => {
      recoverCalls += 1;
      return { ok: true, custodyReleased: true, reservationId: 'prepared-cycle' };
    },
    close() {},
  };
  const guardian = startActualGuardian({
    custodyStore,
    enabled: true,
    spawnImpl: () => assert.fail('startup recovery must not spawn before the scheduled repair tick'),
    startDelayMs: 5000,
    setTimeoutImpl: timerFactory,
    clearTimeoutImpl() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recoverCalls, 1);
  assert.equal(guardian.status().timeoutCustodyHeld, false);
  assert.equal(guardian.status().maintenanceInFlight, false);
  assert.equal(guardian.status().scheduled, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);
  guardian.stop();

  const blockedTimers = [];
  const held = startActualGuardian({
    custodyStore: {
      status: () => ({ held: true, digest: 'b'.repeat(64), reservationId: 'unprepared-cycle' }),
      preparedRecoveryEligible: () => false,
      recoverPreparedAfterBoot: async () => ({ ok: false, blocker: 'MAINTENANCE_PREPARED_RECOVERY_UNPROVEN' }),
      close() {},
    },
    enabled: true,
    spawnImpl: () => assert.fail('unprepared custody must not spawn'),
    setTimeoutImpl: (fn, delay) => {
      const timer = { fn, delay, unref() {} };
      blockedTimers.push(timer);
      return timer;
    },
    clearTimeoutImpl() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(held.status().timeoutCustodyHeld, true);
  assert.equal(held.status().scheduled, false);
  assert.equal(blockedTimers.length, 0);
  held.stop();

  let disabledRecoverCalls = 0;
  const disabledTimers = [];
  const disabled = startActualGuardian({
    custodyStore: {
      status: () => ({ held: true, digest: 'c'.repeat(64), reservationId: 'prepared-disabled-cycle' }),
      preparedRecoveryEligible: () => true,
      recoverPreparedAfterBoot: async () => {
        disabledRecoverCalls += 1;
        return { ok: true, custodyReleased: true, reservationId: 'prepared-disabled-cycle' };
      },
      close() {},
    },
    enabled: false,
    spawnImpl: () => assert.fail('disabled repair scheduler must not spawn'),
    setTimeoutImpl: (fn, delay) => {
      const timer = { fn, delay, unref() {} };
      disabledTimers.push(timer);
      return timer;
    },
    clearTimeoutImpl() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disabledRecoverCalls, 1);
  assert.equal(disabled.status().timeoutCustodyHeld, false);
  assert.equal(disabled.status().enabled, false);
  assert.equal(disabled.status().scheduled, false);
  assert.equal(disabledTimers.length, 0);
  disabled.stop();
});

test('retained migration refuses legacy authority, owner drift, wrong source binding and changed projection', async t => {
  for (const scenario of ['legacy-present', 'legacy-unreadable', 'owner-drift', 'owner-running',
    'missing-owner-binding', 'source-invalid', 'projection-changed', 'anchor-append-failed']) {
    const root = fixture(t), first = store(root); first.prepareIncident(reservation); first.release(); first.close();
    const p = join(root, 'status', 'sovereign-commander-maintenance-custody.json');
    const expectedDigest = createHash('sha256').update(readFileSync(p)).digest('hex'); anchors.get(root).lose();
    let observations = 0; const owner = heldOwner(newBoot);
    if (scenario === 'anchor-append-failed') anchors.get(root).append = () => { throw new Error('capacity'); };
    const m = store(root, newBoot, {
      observeLegacyAudit: () => { if (scenario === 'legacy-unreadable') throw new Error('unreadable');
        return { present: scenario === 'legacy-present' }; },
      observeMigrationOwner: () => {
        observations++;
        if (scenario === 'projection-changed' && observations === 2) writeFileSync(p, '{}');
        if (scenario === 'owner-drift' && observations > 1) return { ...owner, digest: 'f'.repeat(64) };
        if (scenario === 'owner-running') return { ...owner, observation: { ...owner.observation, running: true } };
        return owner;
      } });
    const r = await m.prepareRetainedMigration({ ...approved(expectedDigest),
      expectedReservationId: reservation.reservationId,
      expectedOwnerDigest: scenario === 'missing-owner-binding' ? '' : owner.digest,
      expectedMain: scenario === 'source-invalid' ? 'unbound' : 'c'.repeat(40) });
    assert.equal(r.ok, false, scenario); assert.equal(m.status().held, true, scenario);
    assert.equal(m.reserve(reservation).ok, false, scenario); assert.equal(m.release().ok, false, scenario); m.close();
  }
});
test('bounded adversarial model traces never admit execution from missing or replayed workspace state', async t => {
  for (let seed = 1; seed <= 12; seed++) {
    const root = fixture(t); let tick = clock, witness = { ...oldBoot, observedAtUtc: new Date(tick).toISOString() };
    const make = () => store(root, witness, { now: () => new Date(tick).toISOString(),
      readBootWitness: () => ({ ...witness, observedAtUtc: new Date(tick).toISOString() }),
      observeMigrationOwner: () => heldOwner({ ...witness, observedAtUtc: new Date(tick).toISOString() }) });
    let s = make(), state = seed, savedIdle = null;
    s.prepareIncident(reservation); s.release(); s.close(); s = make();
    for (let step = 0; step < 30; step++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const action = state % 7, p = join(root, 'status', 'sovereign-commander-maintenance-custody.json');
      const prior = anchors.get(root).readLatest();
      if (action === 0) {
        const r = s.reserve({ reservationId: 'trace-' + seed + '-' + step, operation: 'repair-stephanos' });
        if (r.ok) assert.equal(JSON.parse(prior.bytes).record.phase, 'IDLE');
        else assert.equal(r.custodyReleased, false);
      } else if (action === 1) s.release();
      else if (action === 2) { anchors.get(root).lose(); assert.equal(s.status().held, true); }
      else if (action === 3) {
        const projected = readFileSync(p);
        if (JSON.parse(projected).record.phase === 'IDLE') savedIdle = projected;
        else if (savedIdle) { writeFileSync(p, savedIdle);
          if (prior && JSON.parse(prior.bytes).record.phase === 'ACTIVE') assert.equal(s.status().held, true); }
      } else if (action === 4) {
        s.close(); tick += 60_000;
        witness = { ...witness, bootStartedAtUtc: new Date(tick - 1000).toISOString(), observedAtUtc: new Date(tick).toISOString() };
        s = make();
      } else if (action === 5) {
        const projection = readFileSync(p), parsed = JSON.parse(projection).record, owner = heldOwner(witness);
        const r = await s.prepareRetainedMigration({ ...approved(createHash('sha256').update(projection).digest('hex')),
          expectedReservationId: parsed.reservationId, expectedOwnerDigest: owner.digest, expectedMain: 'c'.repeat(40) });
        if (r.ok) { assert.equal(s.status().held, true); assert.equal(s.release().ok, false); }
      } else {
        const status = s.status();
        const r = await s.recoverAfterBoot(approved(status.digest || 'a'.repeat(64)));
        if (r.ok) assert.equal(s.status().held, false);
      }
      const current = anchors.get(root).readLatest();
      if (!current || JSON.parse(current.bytes).record.phase === 'ACTIVE') assert.equal(s.status().held, true);
    }
    s.close();
  }
});

test('post-append owner change preserves the actual prepared ACTIVE digest', async t => {
  const root = fixture(t), first = store(root); first.prepareIncident(reservation); first.release(); first.close();
  const bytes = readFileSync(join(root, 'status', 'sovereign-commander-maintenance-custody.json'));
  anchors.get(root).lose(); const owner = heldOwner(newBoot); let calls = 0;
  const m = store(root, newBoot, { observeMigrationOwner: () => ++calls < 3 ? owner : { ...owner, digest: 'f'.repeat(64) } });
  const r = await m.prepareRetainedMigration({ ...approved(createHash('sha256').update(bytes).digest('hex')),
    expectedReservationId: reservation.reservationId, expectedOwnerDigest: owner.digest, expectedMain: 'c'.repeat(40) });
  assert.equal(r.ok, false); assert.equal(r.prepared, true); assert.equal(r.digest, m.status().digest);
  assert.equal(m.status().held, true); assert.equal(m.release().ok, false); m.close();
});

test('closed capacity refusal admits no reservation and preserves the prior native authority', t => {
  const root = fixture(t), s = store(root); s.prepareIncident(reservation); s.release();
  const prior = anchors.get(root).readLatest();
  anchors.get(root).append = () => { throw new Error('MAINTENANCE_OS_JOURNAL_CAPACITY_UNAVAILABLE'); };
  const r = s.reserve({ reservationId: 'must-not-run', operation: 'repair-stephanos' });
  assert.equal(r.ok, false); assert.equal(r.blocker, 'MAINTENANCE_CUSTODY_JOURNAL_CAPACITY_UNAVAILABLE');
  assert.equal(s.status().held, true); assert.deepEqual(anchors.get(root).readLatest(), prior); s.close();
});


test('native failed operation retains signed terminal evidence before releasing proven zero', t => {
  const root=fixture(t), owner=store(root); owner.prepareIncident(reservation);
  const state=owner.status();
  const common={RequestId:reservation.reservationId,OwnerPid:process.pid,
    CustodyRecordSha256:state.digest,NativeRecordId:state.anchorRecordId,
    Profile:'MAINTENANCE_GOAL_BUILDER_V1'};
  assert.equal(owner.recordNativeRoot({...common,SchemaVersion:'stephanos.fixed-runtime-prepared.v1',
    RootPid:1234,RootCreatedAtUtc:oldNow}).ok,true);
  const terminal={...common,SchemaVersion:'stephanos.fixed-runtime-job.v1',
    OperationOk:false,Reason:'DEADLINE_CANCELLED',ExecutionCustodyReleased:true,
    TaskStage:{ExecutionCustodyReleased:true,ZeroActiveProcessesObserved:true,ActiveProcesses:0}};
  const released=owner.releaseNativeTerminal(terminal);
  assert.equal(released.ok,true); assert.equal(owner.status().held,false);
  const receipt=JSON.parse(readFileSync(join(root,released.terminalEvidenceRef),'utf8'));
  assert.equal(receipt.receipt.evidence.OperationOk,false);
  assert.equal(receipt.receipt.evidence.Reason,'DEADLINE_CANCELLED');
  assert.match(receipt.mac,/^[a-f0-9]{64}$/);
  const anchored=JSON.parse(anchors.get(root).readLatest().bytes).record;
  assert.equal(anchored.terminalEvidence.sha256,released.terminalEvidenceSha256);
});

test('foreign native terminal and failed archive preserve the original hold', t => {
  for(const scenario of ['foreign','archive']) {
    const root=fixture(t), owner=store(root); owner.prepareIncident(reservation);
    const state=owner.status();
    if(scenario==='archive') writeFileSync(join(root,'events','sovereign-maintenance-custody'),'retain');
    const result=owner.releaseNativeTerminal({SchemaVersion:'stephanos.fixed-runtime-job.v1',
      Profile:'MAINTENANCE_GOAL_BUILDER_V1',RequestId:reservation.reservationId,OwnerPid:process.pid,
      CustodyRecordSha256:scenario==='foreign'?'f'.repeat(64):state.digest,NativeRecordId:state.anchorRecordId,
      ExecutionCustodyReleased:true,TaskStage:{ExecutionCustodyReleased:true,ZeroActiveProcessesObserved:true,ActiveProcesses:0}});
    assert.equal(result.ok,false);assert.equal(owner.status().held,true);assert.equal(owner.status().digest,state.digest);
    owner.close();
  }
});
