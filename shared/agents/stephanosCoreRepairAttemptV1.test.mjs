import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreRepairAttemptControllerV1, captureCoreRepairAttemptV1,
  readCoreRepairAttemptV1, writeCoreRepairAttemptV1, CORE_REPAIR_ATTEMPT_FILE } from './stephanosCoreRepairAttemptV1.mjs';
import { captureCoreRepairContinuationStatusV1, unknownCoreRepairRequestStatusV1 } from './sovereignMaintenanceAdmissionV1.mjs';

const HEAD = 'a'.repeat(40), NEXT = 'b'.repeat(40), HASH = 'c'.repeat(64);
const intent = { actionId: 'repair-goal-builder-flow', missionId: 'stephanos-core-octopus-self-heal', phase: 'goal-builder' };
function fixture() {
  const f = { time: Date.parse('2026-11-17T10:00:00.000Z'), observer: HEAD, enrollmentId: 'd'.repeat(64), disk: null, slot: null,
    writes: 0, prepares: 0, deliveries: 0, ids: 0, failWrite: false, failRead: false,
    lock: true, admitted: true, legacy: false, lostPrepare: false, lostResponse: false,
    afterPrepare: null, afterDispatch: null, terminalReleased: true, terminalState: 'SUCCEEDED' };
  f.status = request => {
    if (f.failRead) throw new Error('Owner transport unavailable');
    const target = request?.continuation || f.slot?.continuation || null;
    const common = { ...unknownCoreRepairRequestStatusV1({ continuation: target,
      observedAtUtc: new Date(f.time).toISOString(), observerSourceHead: f.observer }),
      historyAuthenticated: true, initialEpochProven: true, enrollmentId: f.enrollmentId, blocker: '', ok: true };
    let raw;
    if (f.legacy) raw = unknownCoreRepairRequestStatusV1({ state: 'LEGACY_HISTORY_UNPROVEN',
      observedAtUtc: new Date(f.time).toISOString(), observerSourceHead: f.observer });
    else if (target && target.enrollmentId !== f.enrollmentId) raw = unknownCoreRepairRequestStatusV1({
      continuation: target, state: 'CONFLICT', blocker: 'CORE_REPAIR_ENROLLMENT_CHANGED',
      observedAtUtc: new Date(f.time).toISOString(), observerSourceHead: f.observer });
    else if (f.slot && request?.continuation && JSON.stringify(target) !== JSON.stringify(f.slot.continuation))
      raw = { ...common, state: 'CONFLICT', blocker: 'CORE_REPAIR_ORIGINAL_IDENTITY_CONFLICT' };
    else if (!f.slot && target) raw = { ...common, state: 'UNKNOWN', blocker: 'CORE_REPAIR_REQUEST_NOT_PREPARED',
      custodyReleased: true, currentAdmissionAvailable: true, nextSequence: target.sequence,
      previousRequestId: target.previousRequestId, sameRequestPreparationAllowed: true };
    else if (!f.slot) raw = { ...common, state: 'READY', custodyReleased: true,
      currentAdmissionAvailable: true, nextSequence: 1 };
    else if (f.slot.state === 'PREPARED') raw = { ...common, state: 'PREPARED',
      sameRequestDeliveryAllowed: f.observer === target.sourceHead };
    else if (f.slot.state === 'RESERVED') raw = { ...common, state: 'RESERVED' };
    else raw = { ...common, state: f.slot.state, terminalProofHash: HASH,
      custodyReleased: f.terminalReleased, currentAdmissionAvailable: f.terminalReleased,
      nextSequence: f.terminalReleased ? target.sequence + 1 : null,
      previousRequestId: f.terminalReleased ? target.requestId : '' };
    const status = captureCoreRepairContinuationStatusV1(raw);
    assert(status, 'fixture must obey actual canonical owner status contract: ' + JSON.stringify(raw));
    return status;
  };
  f.options = () => ({ observerSourceHead: f.observer,
    assertCoreOwner: async () => f.lock,
    readOwnerStatus: async request => f.status(request),
    prepareOwner: async ({ continuation }) => {
      f.prepares++;
      if (!f.slot || f.slot.state !== 'PREPARED') f.slot = { continuation, state: 'PREPARED' };
      else if (continuation.sourceHead !== f.observer) f.slot.state = 'NOT_STARTED';
      if (f.afterPrepare) f.afterPrepare();
      if (f.lostPrepare) throw new Error('Preparation reply lost');
      return f.status({ continuation });
    },
    readAttempt: async () => f.disk ? { ok: true, attempt: structuredClone(f.disk) } : { ok: false, blocker: 'CORE_REPAIR_STATE_MISSING' },
    writeAttempt: async ({ attempt }) => {
      f.writes++;
      if (f.failWrite) throw new Error('Durable write failed');
      f.disk = structuredClone(attempt); return { ok: true };
    },
    requestId: () => 'core-original-' + String(++f.ids).padStart(4, '0'),
    now: () => new Date(f.time).toISOString(),
  });
  f.manager = () => createCoreRepairAttemptControllerV1(f.options());
  f.input = overrides => ({ ...intent, admit: async () => f.admitted,
    dispatch: async original => {
      f.deliveries++; assert.deepEqual(original, f.slot.continuation);
      f.slot.state = f.terminalState;
      if (f.afterDispatch) f.afterDispatch();
      if (f.lostResponse) throw new Error('Execution reply lost');
      return { ok: true, proofHash: 'not-authority' };
    }, ...overrides });
  return f;
}

test('legacy or unauthenticated history never initializes clear local state or executes', async () => {
  const f = fixture(); f.legacy = true; const manager = f.manager();
  await manager.restore(); const result = await manager.execute(f.input());
  assert.equal(result.ok, false); assert.equal(f.writes, 0); assert.equal(f.prepares, 0); assert.equal(f.deliveries, 0);
  assert.equal(manager.snapshot().held, true);
});

test('durable local fence precedes owner preparation and executable delivery', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore();
  f.afterPrepare = () => { assert.equal(f.disk.stage, 'DISPATCH_FENCED'); assert.deepEqual(f.disk.continuation, f.slot.continuation); };
  f.afterDispatch = () => assert.equal(f.disk.stage, 'DISPATCH_FENCED');
  const result = await manager.execute(f.input());
  assert.equal(result.ok, true); assert.equal(f.prepares, 1); assert.equal(f.deliveries, 1);
  assert.equal(f.disk.stage, 'SETTLED'); assert.equal(f.disk.terminalProofHash, HASH);
  assert.equal(manager.snapshot().originalOutcomeProven, false);
});

test('persistence failure before prepare produces zero metadata or executable calls', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore(); f.failWrite = true;
  const result = await manager.execute(f.input());
  assert.equal(result.blocker, 'CORE_REPAIR_STATE_PERSISTENCE_FAILED');
  assert.equal(f.prepares, 0); assert.equal(f.deliveries, 0);
});

test('lost preparation response uses exact authenticated readback before one execution', async () => {
  const f = fixture(); f.lostPrepare = true; const manager = f.manager(); await manager.restore();
  const result = await manager.execute(f.input());
  assert.equal(result.ok, true); assert.equal(f.deliveries, 1); assert.equal(f.ids, 1);
});

test('lost execution response is settled by original terminal, not response truth or a replacement ID', async () => {
  const f = fixture(); f.lostResponse = true; const manager = f.manager(); await manager.restore();
  const result = await manager.execute(f.input()); assert.equal(result.ok, true);
  const restarted = f.manager(); await restarted.restore();
  assert.equal(restarted.snapshot().held, false); assert.equal(restarted.snapshot().requestId, result.continuation.requestId);
  assert.equal(f.ids, 1); assert.equal(f.deliveries, 1);
});

test('accepted reservation plus missing response remains held across restart and does not change actions', async () => {
  const f = fixture(); f.terminalState = 'RESERVED'; f.lostResponse = true;
  const manager = f.manager(); await manager.restore(); await manager.execute(f.input());
  f.time += 121000; const restarted = f.manager(); await restarted.restore();
  await restarted.execute(f.input({ actionId: 'repair-battle-bridge', missionId: 'stephanos-core-backend-self-heal', phase: 'backend' }));
  assert.equal(f.deliveries, 1); assert.equal(f.prepares, 1); assert.equal(f.ids, 1);
  assert.equal(restarted.snapshot().held, true); assert.equal(f.disk.continuation.actionId, intent.actionId);
});

test('owner lookup failure invalidates previous retry permission instead of reusing stale readiness', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore();
  f.afterPrepare = () => { f.admitted = false; };
  await manager.execute(f.input()); assert.equal(f.deliveries, 0);
  f.time += 121000; f.admitted = true; f.failRead = true;
  const result = await manager.execute(f.input());
  assert.equal(result.ok, false); assert.equal(f.deliveries, 0); assert.equal(f.prepares, 1);
});

test('missing local state recovers exact PREPARED original from owner after a Core restart', async () => {
  const f = fixture(), first = f.manager(); await first.restore();
  f.afterPrepare = () => { f.admitted = false; }; await first.execute(f.input());
  const original = structuredClone(f.disk.continuation); f.disk = null; f.time += 121000;
  f.admitted = true; f.afterPrepare = null;
  const restarted = f.manager(); await restarted.restore();
  assert.deepEqual(f.disk.continuation, original); assert.equal(f.disk.createdAtUtc, null);
  const result = await restarted.execute(f.input());
  assert.equal(result.ok, true); assert.equal(f.ids, 1); assert.equal(f.deliveries, 1);
});

test('terminal execution without separate release never clears the mutation hold', async () => {
  const f = fixture(); f.terminalReleased = false; const manager = f.manager(); await manager.restore();
  const result = await manager.execute(f.input()); assert.equal(result.ok, false);
  assert.equal(manager.snapshot().held, true); assert.equal(f.disk.stage, 'RESULT_UNPROVEN');
  f.terminalReleased = true; await manager.reconcile();
  assert.equal(manager.snapshot().held, false); assert.equal(f.disk.stage, 'SETTLED'); assert.equal(f.deliveries, 1);
});

test('source advance retires original PREPARED through metadata and preserves the original source', async () => {
  const f = fixture(), first = f.manager(); await first.restore();
  f.afterPrepare = () => { f.admitted = false; }; await first.execute(f.input());
  const original = structuredClone(f.disk.continuation); f.observer = NEXT; f.afterPrepare = null;
  const restarted = f.manager(); await restarted.restore(); await restarted.reconcile();
  assert.equal(f.deliveries, 0); assert.equal(f.disk.stage, 'SETTLED');
  assert.equal(f.disk.terminalState, 'NOT_STARTED'); assert.deepEqual(f.disk.continuation, original);
  assert.equal(f.disk.observerSourceHead, NEXT); assert.equal(f.disk.continuation.sourceHead, HEAD);
});

for (const gate of ['lock', 'admitted']) {
  test(gate + ' lost after prepare prevents executable POST and retains the original', async () => {
    const f = fixture(), manager = f.manager(); await manager.restore(); f.afterPrepare = () => { f[gate] = false; };
    await manager.execute(f.input()); assert.equal(f.prepares, 1); assert.equal(f.deliveries, 0);
    assert.equal(f.disk.stage, 'DISPATCH_FENCED'); assert.equal(manager.snapshot().held, true);
  });
}

test('post-execution persistence failure retains the original fence for later authenticated recovery', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore(); f.afterDispatch = () => { f.failWrite = true; };
  const result = await manager.execute(f.input()); assert.equal(result.ok, false); assert.equal(f.disk.stage, 'DISPATCH_FENCED');
  f.failWrite = false; const restarted = f.manager(); await restarted.restore();
  assert.equal(f.disk.stage, 'SETTLED'); assert.equal(f.ids, 1); assert.equal(f.deliveries, 1);
});

test('same-process concurrency preserves the pending request and exposes held state while IO is pending', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore();
  let finish; const delivered = new Promise(resolve => { finish = resolve; });
  const active = manager.execute(f.input({ dispatch: async () => { f.deliveries++; await delivered; f.slot.state = 'SUCCEEDED'; } }));
  for (let i = 0; i < 30 && f.deliveries === 0; i++) await Promise.resolve();
  assert.equal(manager.snapshot().held, true);
  const rival = await manager.execute(f.input()); assert.equal(rival.blocker, 'CORE_REPAIR_CONTINUATION_BUSY');
  finish(); await active; assert.equal(f.deliveries, 1); assert.equal(f.ids, 1);
});

test('actual bounded file reader retains missing, oversized, corrupt and linked history as unknown', async t => {
  const root = await mkdtemp(join(tmpdir(), 'core-repair-state-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'status'));
  assert.equal((await readCoreRepairAttemptV1({ workspaceRoot: root })).ok, false);
  const path = join(root, 'status', CORE_REPAIR_ATTEMPT_FILE);
  await writeFile(path, 'x'.repeat(16385)); assert.equal((await readCoreRepairAttemptV1({ workspaceRoot: root })).ok, false);
  await writeFile(path, '{'); assert.equal((await readCoreRepairAttemptV1({ workspaceRoot: root })).ok, false);
  await rm(path); await writeFile(join(root, 'other.json'), '{}'); await symlink(join(root, 'other.json'), path);
  assert.equal((await readCoreRepairAttemptV1({ workspaceRoot: root })).blocker, 'CORE_REPAIR_STATE_UNSAFE');
});

test('slow affected Flywheel work excludes maintenance until its original phases finish', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore();
  let finish, entered = false;
  const pause = new Promise(resolve => { finish = resolve; });
  const affected = manager.runAffectedWork({ admit: async () => true,
    run: async () => { entered = true; await pause; return 'original-phase-completed'; } });
  for (let i = 0; i < 30 && !entered; i++) await Promise.resolve();
  assert.equal(entered, true);
  const maintenance = await manager.execute(f.input());
  assert.equal(maintenance.ok, false); assert.equal(f.prepares, 0); assert.equal(f.deliveries, 0);
  finish(); assert.equal((await affected).result, 'original-phase-completed');
  const result = await manager.execute(f.input()); assert.equal(result.ok, true); assert.equal(f.deliveries, 1);
});

test('uncertain maintenance prevents affected Flywheel entry while its independent caller can still publish learning', async () => {
  const f = fixture(); f.terminalState = 'RESERVED'; const manager = f.manager(); await manager.restore();
  await manager.execute(f.input()); let calls = 0;
  const result = await manager.runAffectedWork({ admit: async () => true, run: async () => { calls++; } });
  assert.equal(result.ok, false); assert.equal(calls, 0); assert.equal(f.deliveries, 1);
});

test('real durable workspace writer and reader round-trip exact pending identity without expiring it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'core-repair-roundtrip-')); t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(), manager = f.manager(); await manager.restore(); f.afterPrepare = () => { f.admitted = false; };
  await manager.execute(f.input());
  const written = await writeCoreRepairAttemptV1({ workspaceRoot: root, repoRoot: process.cwd(), attempt: f.disk,
    nowUtc: '2026-01-01T00:00:00.000Z' }); assert.equal(written.ok, true, JSON.stringify(written));
  const read = await readCoreRepairAttemptV1({ workspaceRoot: root }); assert.equal(read.ok, true, JSON.stringify(read));
  assert.deepEqual(read.attempt, captureCoreRepairAttemptV1(f.disk));
});

for (const state of ['PREPARED', 'RESERVED']) {
  test('delayed original preparation wins CAS and recovers its exact ' + state + ' tuple after a local losing fence', async () => {
    const f = fixture(), first = f.manager(); await first.restore();
    f.afterPrepare = () => { f.admitted = false; }; await first.execute(f.input());
    const winner = structuredClone(f.disk.continuation);
    // Model lost local state followed by a new local fence, while the older
    // delayed PREPARE won the actual owner's same-epoch/sequence CAS.
    f.disk.continuation = { ...winner, requestId: 'core-local-loser-0002' };
    f.slot = { continuation: winner, state };
    const restarted = f.manager(); await restarted.restore();
    assert.deepEqual(f.disk.continuation, winner); assert.equal(f.disk.phase, 'recovered');
    assert.equal(f.disk.createdAtUtc, null); assert.equal(f.deliveries, 0);
    assert.equal(restarted.snapshot().held, true);
    f.admitted = true; f.afterPrepare = null; f.time += 121000;
    await restarted.execute(f.input());
    assert.equal(f.deliveries, state === 'PREPARED' ? 1 : 0);
    assert.equal(f.ids, 1); assert.deepEqual(f.disk.continuation, winner);
  });
}

test('a different enrollment or predecessor cannot justify replacing the local original', async () => {
  for (const change of ['enrollment', 'sequence', 'predecessor']) {
    const f = fixture(), first = f.manager(); await first.restore();
    f.afterPrepare = () => { f.admitted = false; }; await first.execute(f.input());
    const local = structuredClone(f.disk.continuation);
    if (change === 'enrollment') f.enrollmentId = 'e'.repeat(64);
    const continuation = { ...local, requestId: 'core-foreign-original-0002', enrollmentId: f.enrollmentId };
    if (change === 'sequence') { continuation.sequence = 2; continuation.previousRequestId = local.requestId; }
    if (change === 'predecessor') {
      f.disk.continuation = { ...local, sequence: 2, previousRequestId: 'core-predecessor-local' };
      continuation.sequence = 2; continuation.previousRequestId = 'core-predecessor-foreign';
    }
    const retained = structuredClone(f.disk.continuation);
    f.slot = { continuation, state: 'PREPARED' };
    const restarted = f.manager(); await restarted.restore();
    assert.deepEqual(f.disk.continuation, retained, change); assert.equal(restarted.snapshot().held, true);
    assert.equal(f.deliveries, 0); assert.equal(f.prepares, 1);
  }
});

test('changing or unavailable owner readback cannot adopt a previously observed winner', async () => {
  for (const failure of ['changed', 'unavailable', 'owner-lost']) {
    const f = fixture(), first = f.manager(); await first.restore();
    f.afterPrepare = () => { f.admitted = false; }; await first.execute(f.input());
    const original = structuredClone(f.disk.continuation);
    f.disk.continuation = { ...original, requestId: 'core-local-loser-0002' };
    const local = structuredClone(f.disk.continuation), options = f.options(); let latestReads = 0;
    options.readOwnerStatus = async request => {
      if (!request.continuation && ++latestReads === 2) {
        if (failure === 'unavailable') throw new Error('Second latest read unavailable');
        if (failure === 'changed') f.slot.continuation = { ...original, requestId: 'core-different-winner-0003' };
        if (failure === 'owner-lost') f.lock = false;
      }
      return f.status(request);
    };
    const restarted = createCoreRepairAttemptControllerV1(options); await restarted.restore();
    assert.deepEqual(f.disk.continuation, local, failure); assert.equal(restarted.snapshot().held, true);
    assert.equal(f.deliveries, 0); assert.equal(f.prepares, 1);
  }
});

test('owner lost during the final asynchronous admission cannot dispatch a prepared request', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore(); let checks = 0;
  const result = await manager.execute(f.input({ admit: async () => {
    if (++checks === 2) f.lock = false;
    return true;
  } }));
  assert.equal(result.ok, false); assert.equal(f.prepares, 1); assert.equal(f.deliveries, 0);
  assert.equal(f.disk.stage, 'DISPATCH_FENCED'); assert.equal(manager.snapshot().held, true);
});

test('owner lost during affected-work admission cannot enter any affected phase', async () => {
  const f = fixture(), manager = f.manager(); await manager.restore(); let entered = 0;
  const result = await manager.runAffectedWork({ admit: async () => { f.lock = false; return true; },
    run: async () => { entered++; } });
  assert.equal(result.ok, false); assert.equal(entered, 0); assert.equal(f.deliveries, 0);
});

test('stale unprepared local intent uses metadata-only reconciliation and retains truthful local identity', async () => {
  const f = fixture(); f.observer = NEXT;
  const continuation = { schemaVersion: 'stephanos.core-repair-continuation.v1', enrollmentId: f.enrollmentId,
    requestId: 'core-fenced-before-prepare', missionId: intent.missionId, relatedIssue: '#2961',
    actionId: intent.actionId, sourceHead: HEAD, sequence: 1, previousRequestId: '' };
  const createdAtUtc = new Date(f.time - 60000).toISOString();
  f.disk = { schemaVersion: 'stephanos.core-repair-attempt.v1', observerSourceHead: HEAD,
    stage: 'DISPATCH_FENCED', continuation, phase: intent.phase, createdAtUtc,
    lastDeliveryAtUtc: createdAtUtc, deliveryCount: 1, terminalState: '', terminalProofHash: '' };
  let status = captureCoreRepairContinuationStatusV1({ ...unknownCoreRepairRequestStatusV1({
    continuation, observedAtUtc: new Date(f.time).toISOString(), observerSourceHead: NEXT }),
    historyAuthenticated: true, initialEpochProven: true, enrollmentId: f.enrollmentId,
    blocker: 'CORE_REPAIR_SOURCE_ADVANCED' });
  assert(status);
  const options = { ...f.options(), readOwnerStatus: async () => status,
    prepareOwner: async request => {
      f.prepares++; assert.deepEqual(request, { continuation });
      status = captureCoreRepairContinuationStatusV1({ ...status, ok: true, state: 'NOT_STARTED',
        custodyReleased: true, currentAdmissionAvailable: true, nextSequence: 2,
        previousRequestId: continuation.requestId, terminalProofHash: HASH,
        blocker: 'CORE_REPAIR_SOURCE_ADVANCED_BEFORE_PREPARATION' });
      assert(status); throw new Error('Metadata reply lost after authentic tombstone');
    } };
  const manager = createCoreRepairAttemptControllerV1(options);
  await manager.restore(); assert.equal(f.prepares, 0);
  await manager.reconcile();
  assert.equal(f.prepares, 1); assert.equal(f.deliveries, 0); assert.equal(f.ids, 0);
  assert.equal(f.disk.stage, 'SETTLED'); assert.equal(f.disk.terminalState, 'NOT_STARTED');
  assert.deepEqual(f.disk.continuation, continuation); assert.equal(f.disk.createdAtUtc, createdAtUtc);
  assert.equal(f.disk.observerSourceHead, NEXT); assert.equal(manager.snapshot().held, false);
  await manager.reconcile(); assert.equal(f.prepares, 1);
});

test('stale-source reconciliation cannot retire unknown execution, unauthenticated history, a current source, or a lost Core owner', async () => {
  for (const reason of ['unknown-execution', 'reserved', 'unauthenticated', 'same-source', 'owner-lost']) {
    const f = fixture(); f.observer = reason === 'same-source' ? HEAD : NEXT;
    const continuation = { schemaVersion: 'stephanos.core-repair-continuation.v1', enrollmentId: f.enrollmentId,
      requestId: 'core-fenced-before-prepare', missionId: intent.missionId, relatedIssue: '#2961',
      actionId: intent.actionId, sourceHead: HEAD, sequence: 1, previousRequestId: '' };
    const createdAtUtc = new Date(f.time - 60000).toISOString();
    f.disk = { schemaVersion: 'stephanos.core-repair-attempt.v1', observerSourceHead: HEAD,
      stage: 'DISPATCH_FENCED', continuation, phase: intent.phase, createdAtUtc,
      lastDeliveryAtUtc: createdAtUtc, deliveryCount: 1, terminalState: '', terminalProofHash: '' };
    const negative = unknownCoreRepairRequestStatusV1({ continuation,
      observedAtUtc: new Date(f.time).toISOString(), observerSourceHead: f.observer,
      blocker: 'CORE_REPAIR_SOURCE_ADVANCED' });
    const status = reason === 'unauthenticated' ? negative : captureCoreRepairContinuationStatusV1({ ...negative,
      state: reason === 'reserved' ? 'RESERVED' : 'UNKNOWN', historyAuthenticated: true,
      initialEpochProven: true, enrollmentId: f.enrollmentId,
      ...(reason === 'unknown-execution' ? { custodyReleased: true, terminalProofHash: HASH,
        blocker: 'CORE_REPAIR_OPERATION_OUTCOME_UNPROVEN' } : {}),
    });
    assert(status, reason); if (reason === 'owner-lost') f.lock = false;
    const local = structuredClone(f.disk);
    const manager = createCoreRepairAttemptControllerV1({ ...f.options(), readOwnerStatus: async () => status,
      prepareOwner: async () => { f.prepares++; throw new Error('Unexpected retirement'); } });
    await manager.restore(); await manager.reconcile();
    assert.equal(f.prepares, 0, reason); assert.equal(f.deliveries, 0, reason);
    assert.deepEqual(f.disk, local, reason); assert.equal(manager.snapshot().held, true, reason);
  }
});
