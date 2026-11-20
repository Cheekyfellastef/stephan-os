import { randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createSharedWorkspaceStatusRecord, validateSharedWorkspaceRecord, writeAtomicJson, SHARED_WORKSPACE_RECORD_KINDS,
} from './sharedAgentWorkspaceStore.mjs';
import {
  captureCoreRepairContinuationV1, captureCoreRepairContinuationStatusV1,
} from './sovereignMaintenanceAdmissionV1.mjs';

export const CORE_REPAIR_ATTEMPT_SCHEMA = 'stephanos.core-repair-attempt.v1';
export const CORE_REPAIR_ATTEMPT_FILE = 'stephanos-core-repair-attempt-current.json';
const PHASES = new Set(['backend', 'goal-builder', 'control-plane', 'goal-builder-retry', 'recovered']);
const STAGES = new Set(['READY', 'DISPATCH_FENCED', 'RESULT_UNPROVEN', 'SETTLED']);
const TERMINALS = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'NOT_STARTED']);
const MAX_BYTES = 16_384;
const SHA = /^[a-f0-9]{40}$/;
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export function captureCoreRepairAttemptV1(value) {
  if (!exact(value, ['schemaVersion', 'observerSourceHead', 'stage', 'continuation', 'phase',
    'createdAtUtc', 'lastDeliveryAtUtc', 'deliveryCount', 'terminalState', 'terminalProofHash'])) return null;
  const continuation = value.continuation === null ? null : captureCoreRepairContinuationV1(value.continuation);
  if (value.schemaVersion !== CORE_REPAIR_ATTEMPT_SCHEMA || !SHA.test(value.observerSourceHead)
    || !STAGES.has(value.stage) || !PHASES.has(value.phase)
    || (value.continuation !== null && !continuation)
    || (value.createdAtUtc !== null && !utc(value.createdAtUtc))
    || (value.lastDeliveryAtUtc !== null && !utc(value.lastDeliveryAtUtc))
    || !Number.isSafeInteger(value.deliveryCount) || value.deliveryCount < 0 || value.deliveryCount > 1e9
    || (value.terminalState !== '' && !TERMINALS.has(value.terminalState))
    || (value.terminalProofHash !== '' && !/^[a-f0-9]{64}$/.test(value.terminalProofHash))
    || (value.stage !== 'READY' && !continuation)
    || (value.stage === 'SETTLED' && (!TERMINALS.has(value.terminalState) || !value.terminalProofHash))
    || (value.stage === 'READY' && (continuation || value.deliveryCount !== 0 || value.terminalState || value.terminalProofHash))) return null;
  return Object.freeze({ ...value, continuation });
}

// A missing file is not an empty execution history. It can only be rebuilt
// from the original authenticated owner's retained request, or initialized by
// the existing independently qualified migration/installation boundary.
export async function readCoreRepairAttemptV1({ workspaceRoot }) {
  const path = resolve(workspaceRoot, 'status', CORE_REPAIR_ATTEMPT_FILE);
  let handle;
  try {
    for (const entry of [resolve(workspaceRoot), resolve(workspaceRoot, 'status')]) {
      const info = await lstat(entry);
      if (!info.isDirectory() || info.isSymbolicLink()) return { ok: false, blocker: 'CORE_REPAIR_STATE_UNSAFE' };
    }
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_BYTES)
      return { ok: false, blocker: 'CORE_REPAIR_STATE_UNSAFE' };
    handle = await open(path, 'r');
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== before.dev || actual.ino !== before.ino
      || actual.size > MAX_BYTES) return { ok: false, blocker: 'CORE_REPAIR_STATE_CHANGED' };
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > MAX_BYTES) return { ok: false, blocker: 'CORE_REPAIR_STATE_OVERSIZED' };
    const after = await handle.stat(), canonical = await lstat(path);
    if (after.size !== actual.size || after.mtimeMs !== actual.mtimeMs || after.ctimeMs !== actual.ctimeMs
      || canonical.isSymbolicLink() || !canonical.isFile() || canonical.nlink !== 1
      || canonical.dev !== actual.dev || canonical.ino !== actual.ino || canonical.size !== length
      || canonical.mtimeMs !== actual.mtimeMs || canonical.ctimeMs !== actual.ctimeMs)
      return { ok: false, blocker: 'CORE_REPAIR_STATE_CHANGED' };
    const record = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    if (!validateSharedWorkspaceRecord(record).valid || record.kind !== SHARED_WORKSPACE_RECORD_KINDS.STATUS
      || record.statusId !== 'stephanos-core-repair-attempt-current' || record.participantId !== 'stephanos-core'
      || record.relatedIssue !== '#2961') return { ok: false, blocker: 'CORE_REPAIR_STATE_INVALID' };
    const attempt = captureCoreRepairAttemptV1(record.coreRepairAttempt);
    return attempt ? { ok: true, attempt } : { ok: false, blocker: 'CORE_REPAIR_STATE_INVALID' };
  } catch (error) {
    return { ok: false, blocker: error?.code === 'ENOENT' ? 'CORE_REPAIR_STATE_MISSING' : 'CORE_REPAIR_STATE_INVALID' };
  } finally { if (handle) await handle.close(); }
}

export async function writeCoreRepairAttemptV1({ workspaceRoot, repoRoot, attempt, nowUtc }) {
  const captured = captureCoreRepairAttemptV1(attempt);
  if (!captured) return { ok: false, blocker: 'CORE_REPAIR_STATE_INVALID' };
  const record = { ...createSharedWorkspaceStatusRecord({
    statusId: 'stephanos-core-repair-attempt-current', participantId: 'stephanos-core',
    timestampUtc: nowUtc, relatedIssue: '#2961', status: captured.stage,
    summary: 'Original Core maintenance attempt retained; this record grants no native authority.',
    proofRefs: [],
  }), coreRepairAttempt: captured };
  return writeAtomicJson(workspaceRoot, ['status', CORE_REPAIR_ATTEMPT_FILE], record, { repoRoot, durable: true });
}

export function createCoreRepairAttemptControllerV1({ workspaceRoot, repoRoot, observerSourceHead,
  assertCoreOwner, readOwnerStatus, prepareOwner, readAttempt = readCoreRepairAttemptV1, writeAttempt = writeCoreRepairAttemptV1,
  now = () => new Date().toISOString(), requestId = () => 'core-repair-' + randomUUID(), cooldownMs = 120_000,
} = {}) {
  if (!SHA.test(observerSourceHead || '') || typeof assertCoreOwner !== 'function' || typeof readOwnerStatus !== 'function'
    || typeof prepareOwner !== 'function')
    throw new Error('CORE_REPAIR_CONTROLLER_CONFIGURATION_INVALID');
  let attempt = null, owner = null, blocker = 'CORE_REPAIR_CONTINUATION_NOT_RESTORED', busy = false, restored = false;
  const hold = code => { blocker = code; return Object.freeze({ ok: false, attempted: false, blocker: code }); };
  // This is selection metadata for the existing daemon, never permission to
  // deliver. execute() must freshly authenticate the same original owner and
  // reapply current source, lock, action, resource and cooldown admission.
  const pendingAttempt = () => restored && attempt?.continuation && attempt.stage !== 'SETTLED'
    ? Object.freeze({ continuation: attempt.continuation, phase: attempt.phase }) : null;
  const snapshot = () => Object.freeze({ schemaVersion: 'stephanos.core-repair-continuation-summary.v1',
    restored, held: Boolean(blocker) || busy || Boolean(attempt?.continuation && attempt.stage !== 'SETTLED'),
    blocker: blocker || (busy || (attempt?.continuation && attempt.stage !== 'SETTLED') ? 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN' : ''),
    requestId: attempt?.continuation?.requestId || '',
    requestedSourceHead: attempt?.continuation?.sourceHead || '', observerSourceHead,
    stage: attempt?.stage || 'UNKNOWN', deliveryCount: attempt?.deliveryCount || 0,
    terminalState: attempt?.terminalState || '', custodyReleased: owner?.custodyReleased === true,
    currentAdmissionAvailable: owner?.currentAdmissionAvailable === true,
    originalOutcomeProven: false, executionAuthority: false, replayAllowed: false });
  async function locked(fn) {
    if (busy) return Object.freeze({ ok: false, attempted: false, blocker: 'CORE_REPAIR_CONTINUATION_BUSY' });
    busy = true;
    try { return await fn(); } finally { busy = false; }
  }
  async function persist(next) {
    if (!(await assertCoreOwner())) return hold('STEPHANOS_CORE_OWNER_OR_SOURCE_CHANGED_HELD');
    const captured = captureCoreRepairAttemptV1(next);
    if (!captured) return hold('CORE_REPAIR_STATE_INVALID');
    try {
      const result = await writeAttempt({ workspaceRoot, repoRoot, attempt: captured, nowUtc: now() });
      if (result?.ok !== true) return hold('CORE_REPAIR_STATE_PERSISTENCE_FAILED');
      attempt = captured; return { ok: true };
    } catch { return hold('CORE_REPAIR_STATE_PERSISTENCE_FAILED'); }
  }
  function freshStatus(result) {
    const captured = captureCoreRepairContinuationStatusV1(result);
    return captured && captured.historyAuthenticated === true && captured.preparationRequired === true
      && captured.initialEpochProven === true && captured.observerSourceHead === observerSourceHead
      && utc(captured.observedAtUtc) && Date.parse(captured.observedAtUtc) <= Date.parse(now()) + 1000
      && Date.parse(now()) - Date.parse(captured.observedAtUtc) <= 30_000 ? captured : null;
  }
  async function recoverUnpreparedLoser(conflict) {
    const loser = attempt?.continuation;
    if (!loser || conflict.state !== 'CONFLICT' || !same(conflict.continuation, loser)
      || conflict.enrollmentId !== loser.enrollmentId) return null;
    const winnerMatches = status => status && status.enrollmentId === loser.enrollmentId
      && status.continuation?.enrollmentId === loser.enrollmentId
      && ['PREPARED', 'RESERVED', 'NOT_STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(status.state)
      && status.continuation.sequence === loser.sequence
      && status.continuation.previousRequestId === loser.previousRequestId
      && status.continuation.requestId !== loser.requestId;
    try {
      const latest = freshStatus(await readOwnerStatus({}));
      if (!winnerMatches(latest)) return null;
      const repeatedConflict = freshStatus(await readOwnerStatus({ continuation: loser }));
      if (repeatedConflict?.state !== 'CONFLICT' || repeatedConflict.enrollmentId !== loser.enrollmentId
        || !same(repeatedConflict.continuation, loser)) return null;
      const repeatedLatest = freshStatus(await readOwnerStatus({}));
      if (!winnerMatches(repeatedLatest) || !same(repeatedLatest.continuation, latest.continuation)) return null;
      // The authenticated owner's CAS never binds two tuples at one sequence
      // within one enrollment. This proves the local loser was never PREPARED
      // or executable. Adopt only that owner's retained original, not a new ID.
      const recovered = { schemaVersion: CORE_REPAIR_ATTEMPT_SCHEMA, observerSourceHead,
        stage: 'RESULT_UNPROVEN', continuation: repeatedLatest.continuation, phase: 'recovered',
        createdAtUtc: null, lastDeliveryAtUtc: null, deliveryCount: 0, terminalState: '', terminalProofHash: '' };
      return (await persist(recovered)).ok ? repeatedLatest : null;
    } catch { return null; }
  }
  async function observe() {
    // A failed new query must invalidate the previous reply. In particular,
    // a cached same-request-delivery permission cannot survive transport loss.
    owner = null;
    let result;
    try { result = await readOwnerStatus(attempt?.continuation ? { continuation: attempt.continuation } : {}); }
    catch { return hold('CORE_REPAIR_OWNER_STATUS_UNAVAILABLE'); }
    let captured = freshStatus(result);
    if (!captured) return hold('CORE_REPAIR_OWNER_STATUS_UNPROVEN');
    if (captured.state === 'CONFLICT') captured = await recoverUnpreparedLoser(captured) || captured;
    owner = captured;
    if (attempt?.continuation && !same(attempt.continuation, captured.continuation))
      return hold('CORE_REPAIR_ORIGINAL_REQUEST_UNPROVEN');
    if ((!attempt || attempt.stage === 'READY') && captured.continuation) {
      const recovered = { schemaVersion: CORE_REPAIR_ATTEMPT_SCHEMA, observerSourceHead,
        stage: 'RESULT_UNPROVEN', continuation: captured.continuation, phase: 'recovered',
        createdAtUtc: null, lastDeliveryAtUtc: null, deliveryCount: 0, terminalState: '', terminalProofHash: '' };
      if (!(await persist(recovered)).ok) return { ok: false, blocker };
    }
    if (!attempt && captured.state === 'READY' && captured.continuation === null
      && captured.preparationRequired === true && captured.initialEpochProven === true
      && captured.currentAdmissionAvailable === true && captured.nextSequence === 1) {
      if (!(await persist({ schemaVersion: CORE_REPAIR_ATTEMPT_SCHEMA, observerSourceHead, stage: 'READY',
        continuation: null, phase: 'recovered', createdAtUtc: null, lastDeliveryAtUtc: null,
        deliveryCount: 0, terminalState: '', terminalProofHash: '' })).ok) return { ok: false, blocker };
    }
    if (!attempt) return hold('CORE_REPAIR_LOCAL_HISTORY_MIGRATION_REQUIRED');
    if (captured.continuation && TERMINALS.has(captured.state) && captured.custodyReleased === true
      && /^[a-f0-9]{64}$/.test(captured.terminalProofHash || '')) {
      if (attempt.stage !== 'SETTLED' || attempt.terminalState !== captured.state
        || attempt.terminalProofHash !== captured.terminalProofHash) {
        if (!(await persist({ ...attempt, observerSourceHead, stage: 'SETTLED', terminalState: captured.state,
          terminalProofHash: captured.terminalProofHash })).ok) return { ok: false, blocker };
      }
      blocker = captured.currentAdmissionAvailable === true ? '' : 'CORE_REPAIR_CURRENT_ADMISSION_HELD';
      return { ok: !blocker, blocker, owner: captured };
    }
    if (attempt.stage === 'READY' && captured.state === 'READY' && captured.continuation === null
      && captured.currentAdmissionAvailable === true) { blocker = ''; return { ok: true, owner: captured }; }
    return hold(captured.blocker || 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN');
  }
  const restore = () => locked(async () => {
    let local;
    try { local = await readAttempt({ workspaceRoot, repoRoot }); } catch { local = null; }
    attempt = local?.ok === true ? captureCoreRepairAttemptV1(local.attempt) : null;
    restored = true;
    return observe();
  });
  const reconcile = () => locked(async () => {
    if (!restored) return hold('CORE_REPAIR_CONTINUATION_NOT_RESTORED');
    const observation = await observe();
    // Repeating the same metadata preparation may durably refuse a stale
    // PREPARED request or the exact unprepared next slot. Only the owner can
    // sign the no-launch CAS tombstone; unknown native outcomes stay held and
    // no executable stale-source request is sent to manufacture that proof.
    const stalePreparation = owner?.state === 'PREPARED'
      || (owner?.state === 'UNKNOWN' && owner.historyAuthenticated === true
        && owner.blocker === 'CORE_REPAIR_SOURCE_ADVANCED');
    if (stalePreparation && attempt?.continuation
      && same(owner.continuation, attempt.continuation)
      && owner.enrollmentId === attempt.continuation.enrollmentId
      && attempt.continuation.sourceHead !== observerSourceHead && await assertCoreOwner()) {
      try { await prepareOwner({ continuation: attempt.continuation }); } catch { /* Keep the original hold. */ }
      return observe();
    }
    return observation;
  });
  const execute = input => locked(async () => {
    if (!restored) return hold('CORE_REPAIR_CONTINUATION_NOT_RESTORED');
    if (!(await assertCoreOwner())) return hold('STEPHANOS_CORE_OWNER_OR_SOURCE_CHANGED_HELD');
    await observe();
    if (!owner) return hold(blocker || 'CORE_REPAIR_OWNER_STATUS_UNPROVEN');
    const pending = attempt?.continuation && attempt.stage !== 'SETTLED';
    let continuation;
    if (pending) {
      continuation = attempt.continuation;
      if (!same(owner.continuation, continuation)
        || continuation.actionId !== input.actionId || continuation.missionId !== input.missionId
        || !['PREPARED', 'UNKNOWN'].includes(owner.state)
        || (owner.state === 'UNKNOWN' && owner.sameRequestPreparationAllowed !== true))
        return hold(blocker || 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN');
      if (attempt.lastDeliveryAtUtc && Date.parse(now()) - Date.parse(attempt.lastDeliveryAtUtc) < cooldownMs)
        return hold('CORE_REPAIR_SAME_REQUEST_COOLDOWN');
    } else {
      if (blocker || !attempt || !owner || owner.currentAdmissionAvailable !== true
        || !Number.isSafeInteger(owner.nextSequence)) return hold(blocker || 'CORE_REPAIR_CURRENT_ADMISSION_HELD');
      continuation = captureCoreRepairContinuationV1({ schemaVersion: 'stephanos.core-repair-continuation.v1',
        requestId: requestId(), missionId: input.missionId, relatedIssue: '#2961', actionId: input.actionId,
        sourceHead: observerSourceHead, enrollmentId: owner.enrollmentId,
        sequence: owner.nextSequence, previousRequestId: owner.previousRequestId });
      if (!continuation || !PHASES.has(input.phase)) return hold('CORE_REPAIR_INTENT_INVALID');
    }
    if (typeof input.dispatch !== 'function' || typeof input.admit !== 'function')
      return hold('CORE_REPAIR_INTENT_INVALID');
    if ((await input.admit()) !== true)
      return hold('CORE_REPAIR_CURRENT_ADMISSION_UNPROVEN');
    const next = { schemaVersion: CORE_REPAIR_ATTEMPT_SCHEMA, observerSourceHead, stage: 'DISPATCH_FENCED',
      continuation, phase: pending ? attempt.phase : input.phase,
      createdAtUtc: pending ? attempt.createdAtUtc : now(), lastDeliveryAtUtc: now(),
      deliveryCount: pending ? attempt.deliveryCount + 1 : 1, terminalState: '', terminalProofHash: '' };
    if (!(await persist(next)).ok) return { ok: false, attempted: false, blocker };
    // PREPARED is metadata in the original OS-anchored owner. The executable
    // endpoint rejects every tuple that did not pass this durable CAS. A lost
    // preparation response is reconciled by readback, never treated as empty.
    try { await prepareOwner({ continuation }); } catch { /* Read the original owner below. */ }
    await observe();
    if (attempt?.stage === 'SETTLED' && same(attempt.continuation, continuation)) {
      return Object.freeze({ ok: attempt.terminalState === 'SUCCEEDED' && !blocker, attempted: false,
        continuation, blocker: blocker || owner?.blocker || '',
        finalVerdict: 'CORE_REPAIR_ORIGINAL_ATTEMPT_' + attempt.terminalState,
        proofHash: attempt.terminalProofHash, custodyReleased: owner?.custodyReleased === true,
        originalOutcomeProven: false });
    }
    if (!owner || !same(owner.continuation, continuation) || owner.state !== 'PREPARED'
      || owner.sameRequestDeliveryAllowed !== true || owner.preparationRequired !== true
      || owner.initialEpochProven !== true)
      return Object.freeze({ ok: false, attempted: false, blocker: blocker || 'CORE_REPAIR_PREPARATION_UNPROVEN', continuation });
    if ((await input.admit()) !== true || !(await assertCoreOwner())
      || continuation.sourceHead !== observerSourceHead)
      return hold('CORE_REPAIR_CURRENT_ADMISSION_UNPROVEN');
    blocker = 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN';
    // A response, exception or child maintenance success is not release proof.
    // Only authenticated exact-request readback may settle this durable fence.
    let delivery;
    try { delivery = await input.dispatch(continuation); }
    catch { delivery = null; }
    const deliveredAttempt = attempt;
    if (!(await persist({ ...attempt, stage: 'RESULT_UNPROVEN' })).ok)
      return { ok: false, attempted: true, blocker, continuation };
    await observe();
    const settled = attempt?.stage === 'SETTLED' && same(attempt.continuation, continuation);
    return Object.freeze({ ok: settled && attempt.terminalState === 'SUCCEEDED' && !blocker,
      attempted: true, continuation, blocker: blocker || (settled ? owner?.blocker || '' : 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN'),
      finalVerdict: settled ? 'CORE_REPAIR_ORIGINAL_ATTEMPT_' + attempt.terminalState : 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN',
      proofHash: settled ? attempt.terminalProofHash : '', deliveryObserved: delivery != null,
      deliveryCount: deliveredAttempt.deliveryCount, custodyReleased: owner?.custodyReleased === true,
      originalOutcomeProven: false });
  });
  const runAffectedWork = ({ admit, run } = {}) => locked(async () => {
    if (!restored) return hold('CORE_REPAIR_CONTINUATION_NOT_RESTORED');
    await observe();
    if (!owner || blocker || (attempt?.continuation && attempt.stage !== 'SETTLED'))
      return hold(blocker || 'CORE_REPAIR_ORIGINAL_RESULT_UNPROVEN');
    if (typeof admit !== 'function' || typeof run !== 'function'
      || (await admit()) !== true || !(await assertCoreOwner()))
      return hold('CORE_REPAIR_CURRENT_ADMISSION_UNPROVEN');
    // Process-local serialization inside the already locked Core. This is not
    // a native lease or admission grant: each existing downstream owner still
    // enforces its own custody/resource rules. Maintenance cannot become
    // uncertain halfway through this Core's admission/release work.
    return { ok: true, result: await run() };
  });
  return Object.freeze({ restore, reconcile, execute, runAffectedWork, pendingAttempt, snapshot });
}
