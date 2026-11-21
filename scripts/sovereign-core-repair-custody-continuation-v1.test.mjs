import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMaintenanceCustodyStoreV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { startSovereignCommanderContinuousRepairGuardian } from './sovereign-commander-http.mjs';
import { captureCoreRepairContinuationV1, captureCoreRepairContinuationStatusV1,
  captureCoreRepairPrepareRequestV1, unknownCoreRepairRequestStatusV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { createCoreRepairAttemptControllerV1 } from '../shared/agents/stephanosCoreRepairAttemptV1.mjs';
import { executeSovereignCommanderCommandV1 } from '../shared/agents/sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1,
  STEPHANOS_EXECUTION_SURFACE } from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';

// The OS compare-and-append and boot witness are explicit fixtures. These tests
// exercise the real signed store and owner; they do not qualify Windows custody.
const HEAD = 'a'.repeat(40), NEXT_HEAD = 'b'.repeat(40), KEY = 'custody-continuation-test-key-'.repeat(3);
const time = Date.now(), now = () => new Date(time).toISOString();
const oldNow = () => new Date(time - 60_000).toISOString();
const oldBoot = { schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash: 'f'.repeat(64),
  bootStartedAtUtc: new Date(time - 86_400_000).toISOString(), observedAtUtc: oldNow() };
const newBoot = { ...oldBoot, bootStartedAtUtc: new Date(time - 30_000).toISOString(), observedAtUtc: now() };
const tuple = (overrides = {}) => ({ schemaVersion: 'stephanos.core-repair-continuation.v1',
  enrollmentId: 'd'.repeat(64), requestId: 'core-original-0001', missionId: 'stephanos-core-octopus-self-heal', relatedIssue: '#2961',
  actionId: 'repair-goal-builder-flow', sourceHead: HEAD, sequence: 1, previousRequestId: '', ...overrides });
const request = value => ({ continuation: value });
const observer = head => ({ observerSourceHead: head || HEAD });
async function fixture(t, { enroll = true } = {}) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'core-custody-continuation-'));
  mkdirSync(join(workspaceRoot, 'status')); mkdirSync(join(workspaceRoot, 'events'));
  t.after(() => rmSync(workspaceRoot, { force: true, recursive: true }));
  let latest = null, nextId = 1, failAppend = false;
  const anchor = { readLatest: () => latest && { ...latest, bytes: Buffer.from(latest.bytes) },
    append(bytes, { expectedRecordId }) {
      if (failAppend || (latest?.eventRecordId ?? null) !== expectedRecordId) throw new Error('fixture CAS denied');
      latest = { bytes: Buffer.from(bytes), eventRecordId: nextId++ };
    } };
  const make = (boot = newBoot, options = {}) => createMaintenanceCustodyStoreV1({ workspaceRoot,
    signingKey: KEY, anchor, bootWitness: boot, readBootWitness: () => boot,
    now: boot === oldBoot ? oldNow : now, ...options });
  const original = make(oldBoot);
  assert.equal(original.prepareIncident({ reservationId: 'legacy-original', operation: 'repair-stephanos' }).ok, true);
  const digest = original.status().digest;
  if (!enroll) { original.release(); return { workspaceRoot, store: original, tuple, make, anchor, fail: v => { failAppend = v; } }; }
  original.close();
  const store = make();
  assert.equal((await store.recoverAfterBoot({ expectedDigest: digest, operatorApproval: 'operator-approved' })).ok, true);
  const enrollmentId = store.readCoreRepairRequestStatus({}, observer()).enrollmentId;
  const boundTuple = overrides => tuple({ enrollmentId, ...overrides });
  return { workspaceRoot, store, tuple: boundTuple, make, anchor, fail: v => { failAppend = v; } };
}
function nativeEvidence(store, continuation, disposition = 'SUCCEEDED') {
  const active = store.status();
  const common = { RequestId: continuation.requestId, Profile: 'MAINTENANCE_GOAL_BUILDER_V1', OwnerPid: process.pid,
    RuntimeSourceHead: continuation.sourceHead, CustodyRecordSha256: active.digest, NativeRecordId: active.anchorRecordId };
  const root = { ...common, SchemaVersion: 'stephanos.fixed-runtime-prepared.v1', RootPid: 812,
    RootCreatedAtUtc: now() };
  const terminal = { ...common, SchemaVersion: 'stephanos.fixed-runtime-job.v1', ExecutionCustodyReleased: true,
    OperationOk: disposition === 'SUCCEEDED', TaskStage: { ExecutionCustodyReleased: true,
      ZeroActiveProcessesObserved: true, ActiveProcesses: 0, RootPid: root.RootPid, RootCreatedAtUtc: root.RootCreatedAtUtc } };
  return { root, terminal };
}
function prepareAndReserve(store, continuation = tuple({ enrollmentId: store.readCoreRepairRequestStatus({}, observer()).enrollmentId })) {
  assert.equal(store.prepareCoreRepairRequest(request(continuation), observer()).state, 'PREPARED');
  assert.equal(store.reserve({ reservationId: continuation.requestId, operation: continuation.actionId, coreContinuation: continuation }).ok, true);
  return continuation;
}
function terminalize(store, continuation, disposition = 'SUCCEEDED') {
  const evidence = nativeEvidence(store, continuation, disposition);
  assert.equal(store.recordNativeRoot(evidence.root).ok, true);
  assert.equal(store.releaseNativeTerminal(evidence.terminal, { coreDisposition: disposition }).ok, true);
  return evidence;
}

test('closed model rejects getters, coercion, unknown fields and contradictory authority without reading caller accessors', () => {
  let calls = 0;
  assert.equal(captureCoreRepairContinuationV1({ ...tuple(), sourceHead: 0 }), null);
  assert.equal(captureCoreRepairContinuationV1({ ...tuple(), extra: true }), null);
  const getter = { ...tuple() }; Object.defineProperty(getter, 'sourceHead', { get() { calls++; return HEAD; } });
  assert.equal(captureCoreRepairContinuationV1(getter), null); assert.equal(calls, 0);
  assert.equal(captureCoreRepairPrepareRequestV1({}), null);
  assert.equal(captureCoreRepairPrepareRequestV1({ ...request(tuple()), shell: 'x' }), null);
  assert.ok(Object.isFrozen(captureCoreRepairContinuationV1(tuple())));
  const unknown = unknownCoreRepairRequestStatusV1({ continuation: tuple(), observedAtUtc: now() });
  assert.ok(captureCoreRepairContinuationStatusV1(unknown));
  for (const changed of [{ sameRequestDeliveryAllowed: true }, { historyAuthenticated: true },
    { currentAdmissionAvailable: true }, { preparationRequired: false }, { initialEpochProven: true },
    { replayAllowed: true }, { executionAuthority: true }, { state: 'NOT_STARTED' }])
    assert.equal(captureCoreRepairContinuationStatusV1({ ...unknown, ...changed }), null);
});

test('ordinary signed legacy IDLE never enrolls or authorizes a Core prepare', async t => {
  const { store, tuple } = await fixture(t, { enroll: false });
  const before = store.status().digest;
  assert.equal(store.readCoreRepairRequestStatus({}, observer()).state, 'LEGACY_HISTORY_UNPROVEN');
  assert.equal(store.prepareCoreRepairRequest(request(tuple()), observer()).state, 'LEGACY_HISTORY_UNPROVEN');
  assert.equal(store.status().digest, before);
  assert.equal(store.reserve({ reservationId: tuple().requestId, operation: tuple().actionId, coreContinuation: tuple() }).ok, false);
  assert.equal(store.status().held, false);
});

test('successor full-boot epoch is empty READY; original unprepared query permits metadata prepare only', async t => {
  const { store, tuple } = await fixture(t);
  const ready = store.readCoreRepairRequestStatus({}, observer());
  assert.equal(ready.state, 'READY'); assert.equal(ready.preparationRequired, true);
  assert.equal(ready.initialEpochProven, true); assert.match(ready.enrollmentId, /^[a-f0-9]{64}$/);
  assert.equal(ready.nextSequence, 1); assert.equal(ready.continuation, null);
  const original = store.readCoreRepairRequestStatus(request(tuple()), observer());
  assert.equal(original.state, 'UNKNOWN'); assert.deepEqual(original.continuation, tuple());
  assert.equal(original.sameRequestPreparationAllowed, true); assert.equal(original.sameRequestDeliveryAllowed, false);
  assert.equal(original.nextSequence, 1);
  assert.equal(store.reserve({ reservationId: tuple().requestId, operation: tuple().actionId, coreContinuation: tuple() }).ok, false);
  assert.equal(store.readCoreRepairRequestStatus({}, { observerSourceHead: '' }).historyAuthenticated, false);
});

test('lost prepare response and owner restart preserve exact PREPARED identity; same tuple deduplicates without another write', async t => {
  const { store, tuple, make } = await fixture(t);
  assert.equal(store.prepareCoreRepairRequest(request(tuple()), observer()).state, 'PREPARED');
  const digest = store.status().digest; store.close();
  const successor = make();
  const proof = successor.readCoreRepairRequestStatus({}, observer());
  assert.equal(proof.state, 'PREPARED'); assert.deepEqual(proof.continuation, tuple());
  assert.equal(proof.sameRequestDeliveryAllowed, true);
  assert.equal(successor.prepareCoreRepairRequest(request(tuple()), observer()).state, 'PREPARED');
  assert.equal(successor.status().digest, digest);
  assert.equal(successor.prepareCoreRepairRequest(request(tuple({ requestId: 'core-conflict-0001' })), observer()).state, 'CONFLICT');
  assert.equal(successor.status().digest, digest);
});

test('at-most-one reservation survives lost execution response, new sessions and owner restart', async t => {
  const { store, tuple, make } = await fixture(t), continuation = prepareAndReserve(store);
  const digest = store.status().digest;
  assert.equal(store.reserve({ reservationId: continuation.requestId, operation: continuation.actionId, coreContinuation: continuation }).ok, false);
  assert.equal(store.release().ok, false, 'generic release cannot invent correlated disposition');
  store.close(); const successor = make();
  const proof = successor.readCoreRepairRequestStatus(request(continuation), observer());
  assert.equal(proof.state, 'RESERVED'); assert.equal(proof.sameRequestDeliveryAllowed, false);
  assert.equal(successor.prepareCoreRepairRequest(request(continuation), observer()).state, 'RESERVED');
  assert.equal(successor.status().digest, digest);
});

test('source advance retires exact PREPARED under metadata CAS, never a reserved or conflicting request', async t => {
  const { store, tuple } = await fixture(t), continuation = tuple();
  store.prepareCoreRepairRequest(request(continuation), observer());
  const observed = store.readCoreRepairRequestStatus(request(continuation), observer(NEXT_HEAD));
  assert.equal(observed.state, 'PREPARED'); assert.equal(observed.sameRequestDeliveryAllowed, false);
  const retired = store.prepareCoreRepairRequest(request(continuation), observer(NEXT_HEAD));
  assert.equal(retired.state, 'NOT_STARTED'); assert.equal(retired.custodyReleased, true);
  assert.equal(retired.currentAdmissionAvailable, true); assert.match(retired.terminalProofHash, /^[a-f0-9]{64}$/);
  assert.equal(retired.continuation.sourceHead, HEAD); assert.equal(retired.observerSourceHead, NEXT_HEAD);
  assert.equal(store.reserve({ reservationId: continuation.requestId, operation: continuation.actionId, coreContinuation: continuation }).ok, false);
  const second = tuple({ requestId: 'core-next-0002', sequence: 2, previousRequestId: continuation.requestId, sourceHead: NEXT_HEAD });
  assert.equal(store.prepareCoreRepairRequest(request(second), observer(NEXT_HEAD)).state, 'PREPARED');
  assert.equal(store.reserve({ reservationId: second.requestId, operation: second.actionId, coreContinuation: second }).ok, true);
  const before = store.status().digest;
  assert.equal(store.prepareCoreRepairRequest(request(second), observer(HEAD)).state, 'RESERVED');
  assert.equal(store.status().digest, before); store.close();
});

test('unrelated maintenance preserves PREPARED and defers retirement while its native reservation is ACTIVE', async t => {
  const { store, tuple } = await fixture(t);
  store.prepareCoreRepairRequest(request(tuple()), observer());
  assert.equal(store.reserve({ reservationId: 'unrelated-guardian', operation: 'repair-stephanos' }).ok, true);
  const digest = store.status().digest;
  assert.equal(store.prepareCoreRepairRequest(request(tuple()), observer(NEXT_HEAD)).state, 'PREPARED');
  assert.equal(store.status().digest, digest);
  assert.equal(store.release().ok, true);
  assert.equal(store.readCoreRepairRequestStatus({}, observer()).state, 'PREPARED');
  assert.equal(store.prepareCoreRepairRequest(request(tuple()), observer(NEXT_HEAD)).state, 'NOT_STARTED');
});

test('signed native terminal survives arbitrary newer unrelated guardian reservations with original source identity', async t => {
  for (const disposition of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNPROVEN']) {
    const { store, tuple, make } = await fixture(t), continuation = prepareAndReserve(store);
    terminalize(store, continuation, disposition);
    for (let i = 0; i < 4; i++) {
      assert.equal(store.reserve({ reservationId: 'unrelated-cycle-' + i, operation: 'repair-stephanos' }).ok, true);
      assert.equal(store.release().ok, true);
    }
    store.close(); const successor = make(), proof = successor.readCoreRepairRequestStatus(request(continuation), observer(NEXT_HEAD));
    assert.equal(proof.state, disposition === 'UNPROVEN' ? 'UNKNOWN' : disposition);
    assert.equal(proof.custodyReleased, true); assert.equal(proof.currentAdmissionAvailable, disposition !== 'UNPROVEN');
    assert.deepEqual(proof.continuation, continuation); assert.equal(proof.observerSourceHead, NEXT_HEAD);
    assert.match(proof.terminalProofHash, /^[a-f0-9]{64}$/);
  }
});

test('terminal archive before failed native release proves outcome separately from admission', async t => {
  const { store, tuple, make, fail } = await fixture(t), continuation = prepareAndReserve(store);
  const evidence = nativeEvidence(store, continuation);
  assert.equal(store.recordNativeRoot(evidence.root).ok, true); fail(true);
  const released = store.releaseNativeTerminal(evidence.terminal, { coreDisposition: 'SUCCEEDED' });
  assert.equal(released.ok, false); store.close(); fail(false);
  const proof = make().readCoreRepairRequestStatus(request(continuation), observer());
  assert.equal(proof.state, 'SUCCEEDED'); assert.equal(proof.custodyReleased, false);
  assert.equal(proof.currentAdmissionAvailable, false); assert.equal(proof.nextSequence, null);
  assert.equal(proof.sameRequestDeliveryAllowed, false);
});

test('original terminal must authenticate both root and terminal; corrupt, missing or oversized archives cannot authorize a next identity', async t => {
  for (const kind of ['root-missing', 'terminal-corrupt', 'terminal-oversize']) {
    const { store, tuple, workspaceRoot } = await fixture(t), continuation = prepareAndReserve(store);
    terminalize(store, continuation);
    const archive = join(workspaceRoot, 'events', 'sovereign-maintenance-custody');
    const filename = readdirSync(archive).find(name => name.startsWith(kind === 'root-missing' ? 'native-root-' : 'native-terminal-'));
    if (kind === 'root-missing') unlinkSync(join(archive, filename));
    else writeFileSync(join(archive, filename), kind === 'terminal-corrupt' ? '{}' : Buffer.alloc(65537));
    const proof = store.readCoreRepairRequestStatus(request(continuation), observer());
    assert.equal(proof.historyAuthenticated, false); assert.equal(proof.currentAdmissionAvailable, false);
    const next = tuple({ requestId: 'core-next-0002', sequence: 2, previousRequestId: continuation.requestId });
    assert.equal(store.prepareCoreRepairRequest(request(next), observer()).sameRequestPreparationAllowed, false);
    assert.equal(store.prepareCoreRepairRequest(request(next), observer()).currentAdmissionAvailable, false);
  }
});

test('lost/replayed JSON projection cannot erase newer PREPARED; loss of authoritative anchor cannot enroll empty history', async t => {
  const { store, tuple, make, workspaceRoot, anchor } = await fixture(t);
  const path = join(workspaceRoot, 'status', 'sovereign-commander-maintenance-custody.json'), idle = readFileSync(path);
  store.prepareCoreRepairRequest(request(tuple()), observer()); writeFileSync(path, idle);
  assert.equal(make().readCoreRepairRequestStatus({}, observer()).state, 'PREPARED');
  unlinkSync(path); assert.equal(make().readCoreRepairRequestStatus({}, observer()).state, 'PREPARED');
  anchor.readLatest = () => null;
  const proof = make().readCoreRepairRequestStatus({}, observer());
  assert.equal(proof.state, 'LEGACY_HISTORY_UNPROVEN'); assert.equal(proof.initialEpochProven, false);
});

test('old tuple cannot reclaim the slot after native terminal and a later prepared sequence', async t => {
  const { store, tuple } = await fixture(t), first = prepareAndReserve(store);
  terminalize(store, first);
  const second = tuple({ requestId: 'core-next-0002', sequence: 2, previousRequestId: first.requestId });
  assert.equal(store.prepareCoreRepairRequest(request(second), observer()).state, 'PREPARED');
  assert.equal(store.prepareCoreRepairRequest(request(first), observer()).state, 'SUPERSEDED');
  assert.equal(store.reserve({ reservationId: first.requestId, operation: first.actionId, coreContinuation: first }).ok, false);
  assert.deepEqual(store.readCoreRepairRequestStatus({}, observer()).continuation, second);
});

test('stale owner CAS loses against another prepare and never overwrites winner even if workspace lock is replaced', async t => {
  const { store, tuple, make, anchor, workspaceRoot } = await fixture(t), other = make();
  const read = anchor.readLatest; let interleaved = false, reads = 0, result;
  anchor.readLatest = () => {
    const snapshot = read();
    // One read projects eligibility; the second is inside the acquired lock.
    if (++reads === 2 && !interleaved) {
      interleaved = true;
      unlinkSync(join(workspaceRoot, 'status', readdirSync(join(workspaceRoot, 'status')).find(name => name.endsWith('.lock') && !name.includes('never'))));
      result = other.prepareCoreRepairRequest(request(tuple({ requestId: 'core-winner-0001' })), observer());
    }
    return snapshot;
  };
  // The earlier legacy-boot lock is retained deliberately. Select only current
  // boot's existing file in the race below by removing that historical fixture.
  for (const name of readdirSync(join(workspaceRoot, 'status')).filter(name => name.endsWith('.lock'))) unlinkSync(join(workspaceRoot, 'status', name));
  const lost = store.prepareCoreRepairRequest(request(tuple()), observer());
  assert.equal(result.state, 'PREPARED'); assert.equal(lost.sameRequestDeliveryAllowed, false);
  assert.equal(other.readCoreRepairRequestStatus({}, observer()).continuation.requestId, 'core-winner-0001');
});

test('actual HTTP guardian refuses unprepared executable and settles fixed prelaunch refusal without any executor', async t => {
  const { store, tuple } = await fixture(t);
  const guardian = startSovereignCommanderContinuousRepairGuardian({ enabled: false, custodyStore: store,
    readContinuationSourceHead: () => HEAD, spawnImpl: () => assert.fail('native execution is not qualified by fixture') });
  t.after(() => guardian.stop());
  const continuation = tuple(), repoRoot = resolve(import.meta.dirname, '..');
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER, actionId: continuation.requestId,
    missionId: continuation.missionId, relatedIssue: continuation.relatedIssue,
    operation: 'MAINTENANCE_ACTION', payload: { actionId: continuation.actionId },
  });
  const execute = () => executeSovereignCommanderCommandV1(envelope, { repoRoot, coreContinuation: continuation,
    withMaintenanceOwner: (command, _run, context) => guardian.withMaintenanceOwner(command,
      () => assert.fail('correlated request must not enter legacy direct child'), context) });
  const unprepared = await execute();
  assert.equal(unprepared.ok, false); assert.equal(unprepared.coreRequestStatus.state, 'UNKNOWN');
  assert.equal(guardian.prepareMaintenanceRequest(request(continuation)).state, 'PREPARED');
  const refused = await execute();
  assert.equal(refused.blocker, 'CORE_REPAIR_NATIVE_WINDOWS_QUALIFICATION_REQUIRED');
  assert.equal(refused.coreRequestStatus.state, 'NOT_STARTED'); assert.deepEqual(refused.coreContinuation, continuation);
  assert.match(refused.coreRequestStatus.terminalProofHash, /^[a-f0-9]{64}$/);
  const digest = store.status().digest;
  assert.equal((await execute()).coreRequestStatus.state, 'NOT_STARTED');
  assert.equal(store.status().digest, digest);
});

test('real signed NOT_STARTED readback settles Core continuation after local file loss', async t => {
  const { store, tuple } = await fixture(t), continuation = tuple();
  store.prepareCoreRepairRequest(request(continuation), observer());
  store.prepareCoreRepairRequest(request(continuation), observer(NEXT_HEAD));
  let saved;
  const controller = createCoreRepairAttemptControllerV1({ observerSourceHead: NEXT_HEAD,
    assertCoreOwner: async () => true,
    readOwnerStatus: async raw => store.readCoreRepairRequestStatus(raw, observer(NEXT_HEAD)),
    prepareOwner: async raw => store.prepareCoreRepairRequest(raw, observer(NEXT_HEAD)),
    readAttempt: async () => ({ ok: false, blocker: 'CORE_REPAIR_STATE_MISSING' }),
    writeAttempt: async value => { saved = value.attempt; return { ok: true }; }, now });
  await controller.restore();
  assert.equal(saved.stage, 'SETTLED'); assert.equal(saved.terminalState, 'NOT_STARTED');
  assert.deepEqual(saved.continuation, continuation); assert.match(saved.terminalProofHash, /^[a-f0-9]{64}$/);
});

test('authenticated FAILED readback retains the exact closed child blocker through owner restart and Core settlement', async t => {
  const { store, tuple, make } = await fixture(t), continuation = prepareAndReserve(store);
  const evidence = nativeEvidence(store, continuation, 'FAILED');
  evidence.terminal.TaskStage.Output = 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=' + JSON.stringify({
    schemaVersion: 'stephanos.sovereign-commander-goal-builder-repair.v1', ok: false,
    finalVerdict: 'SOVEREIGN_GOAL_BUILDER_ORIGINAL_OWNER_RECOVERY_REQUIRED',
    canonicalGoalFabricOnly: true, duplicateSchedulerAllowed: false, mergeAuthority: false,
    arbitraryShellAllowed: false, blocker: 'CORE_PROCESS_INVENTORY_UNPROVEN',
  });
  assert.equal(store.recordNativeRoot(evidence.root).ok, true);
  assert.equal(store.releaseNativeTerminal(evidence.terminal, { coreDisposition: 'FAILED' }).ok, true);
  store.close(); const successor = make();
  const proof = successor.readCoreRepairRequestStatus(request(continuation), observer());
  assert.equal(proof.state, 'FAILED'); assert.equal(proof.blocker, 'CORE_PROCESS_INVENTORY_UNPROVEN');
  let saved;
  const controller = createCoreRepairAttemptControllerV1({ observerSourceHead: HEAD,
    assertCoreOwner: async () => true, readOwnerStatus: async raw => successor.readCoreRepairRequestStatus(raw, observer()),
    prepareOwner: async raw => successor.prepareCoreRepairRequest(raw, observer()),
    readAttempt: async () => ({ ok: false, blocker: 'CORE_REPAIR_STATE_MISSING' }),
    writeAttempt: async value => { saved = value.attempt; return { ok: true }; }, now });
  await controller.restore();
  assert.equal(saved.stage, 'SETTLED'); assert.equal(saved.terminalState, 'FAILED');
});

test('successor boot retains unresolved original identity and separates outcome UNKNOWN from proven physical exclusion', async t => {
  const { store, tuple, make } = await fixture(t), continuation = prepareAndReserve(store);
  const digest = store.status().digest; store.close();
  const later = { ...newBoot, bootStartedAtUtc: new Date(time + 30_000).toISOString(), observedAtUtc: new Date(time + 60_000).toISOString() };
  const successor = make(later, { now: () => later.observedAtUtc });
  assert.equal((await successor.recoverAfterBoot({ expectedDigest: digest, operatorApproval: 'operator-approved' })).ok, true);
  const proof = successor.readCoreRepairRequestStatus({}, observer(NEXT_HEAD));
  assert.equal(proof.state, 'UNKNOWN'); assert.deepEqual(proof.continuation, continuation);
  assert.equal(proof.historyAuthenticated, true); assert.equal(proof.custodyReleased, true);
  assert.equal(proof.currentAdmissionAvailable, false); assert.equal(proof.nextSequence, null);
  assert.equal(proof.sameRequestDeliveryAllowed, false);
});

test('full-boot exclusion can combine with original archived terminal after failed release, without relaunch', async t => {
  const { store, tuple, make, fail } = await fixture(t), continuation = prepareAndReserve(store);
  const evidence = nativeEvidence(store, continuation);
  store.recordNativeRoot(evidence.root); const digest = store.status().digest;
  fail(true); assert.equal(store.releaseNativeTerminal(evidence.terminal, { coreDisposition: 'SUCCEEDED' }).ok, false);
  store.close(); fail(false);
  const later = { ...newBoot, bootStartedAtUtc: new Date(time + 30_000).toISOString(), observedAtUtc: new Date(time + 60_000).toISOString() };
  const successor = make(later, { now: () => later.observedAtUtc });
  assert.equal((await successor.recoverAfterBoot({ expectedDigest: digest, operatorApproval: 'operator-approved' })).ok, true);
  const proof = successor.readCoreRepairRequestStatus(request(continuation), observer(NEXT_HEAD));
  assert.equal(proof.state, 'SUCCEEDED'); assert.equal(proof.custodyReleased, true);
  const next = tuple({ requestId: 'core-next-0002', sequence: 2, previousRequestId: continuation.requestId, sourceHead: NEXT_HEAD });
  assert.equal(successor.prepareCoreRepairRequest(request(next), observer(NEXT_HEAD)).state, 'PREPARED');
});

test('prelaunch exclusion signs a no-launch tombstone; it cannot be confused with plain release or late execution', async t => {
  const { store, tuple } = await fixture(t), continuation = prepareAndReserve(store);
  assert.equal(store.release().ok, false);
  assert.equal(store.releaseCoreRepairPrelaunch().ok, true);
  const proof = store.readCoreRepairRequestStatus(request(continuation), observer());
  assert.equal(proof.state, 'NOT_STARTED'); assert.match(proof.terminalProofHash, /^[a-f0-9]{64}$/);
  assert.equal(proof.custodyReleased, true); assert.equal(proof.nextSequence, 2);
  assert.equal(store.releaseCoreRepairPrelaunch().ok, false);
  assert.equal(store.reserve({ reservationId: continuation.requestId, operation: continuation.actionId, coreContinuation: continuation }).ok, false);
});

test('audit-loss projection cannot reset an enrolled Core slot even after later boot and unrelated guardian work', async t => {
  const { store, tuple, make, anchor } = await fixture(t);
  store.prepareCoreRepairRequest(request(tuple()), observer());
  assert.equal(store.reserve({ reservationId: 'unrelated-at-loss', operation: 'repair-stephanos' }).ok, true);
  const digest = store.status().digest; store.close();
  let latest = null, recordId = 1000;
  anchor.append = (bytes, { expectedRecordId }) => {
    if ((latest?.eventRecordId ?? null) !== expectedRecordId) throw new Error('CAS');
    latest = { bytes: Buffer.from(bytes), eventRecordId: ++recordId };
  };
  anchor.readLatest = () => latest;
  const preparationBoot = { ...newBoot, bootStartedAtUtc: new Date(time + 30_000).toISOString(), observedAtUtc: new Date(time + 60_000).toISOString() };
  const prepared = make(preparationBoot, { now: () => preparationBoot.observedAtUtc, observeLegacyAudit: () => ({ present: false }) });
  const preparation = await prepared.prepareAfterAuditLoss({ expectedDigest: digest,
    expectedReservationId: 'unrelated-at-loss', operatorApproval: 'operator-approved' });
  assert.equal(preparation.ok, true); prepared.close();
  const recoveryBoot = { ...newBoot, bootStartedAtUtc: new Date(time + 90_000).toISOString(), observedAtUtc: new Date(time + 120_000).toISOString() };
  const recovered = make(recoveryBoot, { now: () => recoveryBoot.observedAtUtc });
  assert.equal((await recovered.recoverAfterBoot({ expectedDigest: preparation.digest, operatorApproval: 'operator-approved' })).ok, true);
  for (let i = 0; i < 3; i++) {
    assert.equal(recovered.reserve({ reservationId: 'unrelated-after-loss-' + i, operation: 'repair-stephanos' }).ok, true);
    assert.equal(recovered.release().ok, true);
  }
  const proof = recovered.readCoreRepairRequestStatus({}, observer());
  assert.equal(proof.initialEpochProven, false); assert.equal(proof.state, 'LEGACY_HISTORY_UNPROVEN');
  assert.equal(recovered.reserve({ reservationId: tuple().requestId, operation: tuple().actionId, coreContinuation: tuple() }).ok, false);
});

test('old protocol request cannot replay after an older guardian drops the slot and a later qualified epoch enrolls', async t => {
  const { store, tuple, make, anchor } = await fixture(t), original = prepareAndReserve(store, tuple());
  terminalize(store, original); store.close();
  // Explicit old-version signer fixture: pre-protocol reserve wrote a fresh
  // ACTIVE native record without knowing the continuation extension. The real
  // anchor still enforces compare-and-append; no workspace replay is accepted.
  const prior = anchor.readLatest(), oldRecord = JSON.parse(prior.bytes).record;
  delete oldRecord.coreRepairContinuation;
  Object.assign(oldRecord, { phase: 'ACTIVE', reservationId: 'legacy-version-new-reservation',
    operation: 'repair-stephanos', ownerId: 'older-owner', bootWitness: newBoot, startedAtUtc: now() });
  const mac = createHmac('sha256', KEY).update('stephanos-maintenance-custody-v1\0record\0' + JSON.stringify(oldRecord)).digest('hex');
  const bytes = Buffer.from(JSON.stringify({ record: oldRecord, mac }) + '\n');
  anchor.append(bytes, { expectedRecordId: prior.eventRecordId });
  const later = { ...newBoot, bootStartedAtUtc: new Date(time + 30_000).toISOString(), observedAtUtc: new Date(time + 60_000).toISOString() };
  const successor = make(later, { now: () => later.observedAtUtc });
  assert.equal((await successor.recoverAfterBoot({ expectedDigest: createHash('sha256').update(bytes).digest('hex'),
    operatorApproval: 'operator-approved' })).ok, true);
  const ready = successor.readCoreRepairRequestStatus({}, observer());
  assert.equal(ready.state, 'READY'); assert.notEqual(ready.enrollmentId, original.enrollmentId);
  const rejected = successor.prepareCoreRepairRequest(request(original), observer());
  assert.equal(rejected.blocker, 'CORE_REPAIR_ENROLLMENT_CHANGED'); assert.equal(rejected.historyAuthenticated, false);
  assert.equal(rejected.sameRequestPreparationAllowed, false); assert.equal(rejected.sameRequestDeliveryAllowed, false);
  assert.equal(successor.reserve({ reservationId: original.requestId, operation: original.actionId, coreContinuation: original }).ok, false);
  assert.equal(successor.readCoreRepairRequestStatus({}, observer()).continuation, null);
});

test('delayed original PREPARE winning after local loss proves same-epoch sequence loser never admitted', async t => {
  const { store, tuple } = await fixture(t), original = tuple(), localReplacement = tuple({ requestId: 'core-new-local-0001' });
  const ready = store.readCoreRepairRequestStatus({}, observer());
  assert.equal(ready.state, 'READY'); // New local intent could be fenced here.
  assert.equal(store.prepareCoreRepairRequest(request(original), observer()).state, 'PREPARED');
  const loser = store.prepareCoreRepairRequest(request(localReplacement), observer());
  assert.equal(loser.state, 'CONFLICT'); assert.equal(loser.historyAuthenticated, true);
  const winner = store.readCoreRepairRequestStatus({}, observer());
  assert.equal(loser.enrollmentId, winner.enrollmentId);
  assert.equal(loser.continuation.sequence, winner.continuation.sequence);
  assert.equal(loser.continuation.previousRequestId, winner.continuation.previousRequestId);
  assert.notDeepEqual(loser.continuation, winner.continuation);
  assert.deepEqual(winner.continuation, original);
  assert.equal(store.reserve({ reservationId: localReplacement.requestId, operation: localReplacement.actionId,
    coreContinuation: localReplacement }).ok, false);
  assert.equal(store.reserve({ reservationId: original.requestId, operation: original.actionId, coreContinuation: original }).ok, true);
  store.close();
});

test('source advances after the durable local fence but before PREPARE: actual owner metadata settles the original without execution', async t => {
  const { store, tuple, anchor } = await fixture(t), continuation = tuple();
  let local = { schemaVersion: 'stephanos.core-repair-attempt.v1', observerSourceHead: HEAD,
    stage: 'DISPATCH_FENCED', continuation, phase: 'goal-builder', createdAtUtc: oldNow(),
    lastDeliveryAtUtc: oldNow(), deliveryCount: 1, terminalState: '', terminalProofHash: '' };
  let preparations = 0;
  const manager = createCoreRepairAttemptControllerV1({ observerSourceHead: NEXT_HEAD,
    assertCoreOwner: async () => true, now,
    readOwnerStatus: async raw => store.readCoreRepairRequestStatus(raw, observer(NEXT_HEAD)),
    prepareOwner: async raw => { preparations++; return store.prepareCoreRepairRequest(raw, observer(NEXT_HEAD)); },
    readAttempt: async () => ({ ok: true, attempt: local }),
    writeAttempt: async ({ attempt }) => { local = attempt; return { ok: true }; },
  });
  await manager.restore();
  assert.equal(manager.snapshot().held, true); assert.equal(preparations, 0);
  assert.equal(store.readCoreRepairRequestStatus(request(continuation), observer(NEXT_HEAD)).state, 'UNKNOWN');
  await manager.reconcile();
  assert.equal(preparations, 1); assert.equal(local.stage, 'SETTLED'); assert.equal(local.terminalState, 'NOT_STARTED');
  assert.deepEqual(local.continuation, continuation); assert.equal(local.createdAtUtc, oldNow());
  assert.equal(local.observerSourceHead, NEXT_HEAD); assert.match(local.terminalProofHash, /^[a-f0-9]{64}$/);
  const native = JSON.parse(anchor.readLatest().bytes).record.coreRepairContinuation.request;
  assert.equal(native.state, 'NOT_STARTED'); assert.equal(native.preparedAtUtc, now()); assert.equal(native.terminalAtUtc, now());
  assert.equal(native.reservationDigest, ''); assert.equal(native.reservationRecordId, null);
  assert.equal(native.terminalBlocker, 'CORE_REPAIR_SOURCE_ADVANCED_BEFORE_PREPARATION');
  assert.equal(manager.pendingAttempt(), null); assert.equal(manager.snapshot().held, false);
  assert.equal(store.prepareCoreRepairRequest(request(continuation), observer()).state, 'NOT_STARTED');
  assert.equal(store.reserve({ reservationId: continuation.requestId, operation: continuation.actionId, coreContinuation: continuation }).ok, false);
});

test('unprepared stale-source retirement retains a delayed same-tuple PREPARED winner or refuses its RESERVED successor', async t => {
  for (const race of ['same-prepared', 'same-reserved', 'different-prepared']) {
    const { store, tuple, make, anchor } = await fixture(t), original = tuple(), other = make();
    const read = anchor.readLatest;
    let raced = false, raceDigest = '';
    anchor.readLatest = () => {
      const snapshot = read();
      if (!raced) {
        raced = true;
        const competing = race === 'different-prepared' ? tuple({ requestId: 'core-other-next-0001' }) : original;
        assert.equal(other.prepareCoreRepairRequest(request(competing), observer()).state, 'PREPARED');
        if (race === 'same-reserved') assert.equal(other.reserve({ reservationId: original.requestId,
          operation: original.actionId, coreContinuation: original }).ok, true);
        raceDigest = other.status().digest;
      }
      return snapshot;
    };
    const result = store.prepareCoreRepairRequest(request(original), observer(NEXT_HEAD));
    if (race === 'same-prepared') {
      assert.equal(result.state, 'NOT_STARTED'); assert.deepEqual(result.continuation, original);
      assert.equal(result.blocker, 'CORE_REPAIR_SOURCE_ADVANCED_BEFORE_RESERVATION');
    } else {
      assert.equal(result.sameRequestDeliveryAllowed, false); assert.equal(other.status().digest, raceDigest);
      const retained = other.readCoreRepairRequestStatus({}, observer(NEXT_HEAD));
      assert.equal(retained.state, race === 'same-reserved' ? 'RESERVED' : 'PREPARED');
      assert.equal(retained.continuation.requestId, race === 'same-reserved' ? original.requestId : 'core-other-next-0001');
    }
    other.close();
  }
});

test('unprepared stale-source retirement revalidates the settled predecessor and preserves invalid or unrelated history', async t => {
  for (const failure of ['none', 'archive-lost', 'epoch', 'sequence', 'predecessor', 'observer-source', 'unreleased']) {
    const { store, tuple, workspaceRoot, anchor } = await fixture(t), first = prepareAndReserve(store, tuple());
    if (failure !== 'unreleased') terminalize(store, first);
    const next = tuple({ requestId: 'core-stale-next-0002', sequence: 2, previousRequestId: first.requestId,
      ...(failure === 'epoch' ? { enrollmentId: 'e'.repeat(64) } : {}),
      ...(failure === 'sequence' ? { sequence: 3 } : {}),
      ...(failure === 'predecessor' ? { previousRequestId: 'core-foreign-predecessor' } : {}),
    });
    if (failure === 'archive-lost') {
      const archive = join(workspaceRoot, 'events', 'sovereign-maintenance-custody');
      unlinkSync(join(archive, readdirSync(archive).find(name => name.startsWith('native-terminal-'))));
    }
    const before = store.status().digest;
    const result = store.prepareCoreRepairRequest(request(next), { observerSourceHead: failure === 'observer-source' ? '' : NEXT_HEAD });
    if (failure === 'none') {
      assert.equal(result.state, 'NOT_STARTED'); assert.deepEqual(result.continuation, next); assert.equal(result.nextSequence, 3);
      const stored = JSON.parse(anchor.readLatest().bytes).record.coreRepairContinuation.request;
      assert.equal(stored.reservationDigest, ''); assert.equal(stored.reservationRecordId, null);
    } else {
      assert.equal(store.status().digest, before, failure); assert.equal(result.sameRequestDeliveryAllowed, false, failure);
      assert.notEqual(result.state, 'NOT_STARTED', failure);
    }
    store.close();
  }
});
