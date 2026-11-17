// Durable adapter of the existing guardian, not another executor or lease owner.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoalDiscoveryWorkspaceV1 } from '../shared/agents/goalDiscoveryWorkspaceV1.mjs';
import { collectCanonicalIgnitionSourceTruth, evaluateCanonicalIgnitionSourceTruth } from './battle-bridge-ignition-supervisor.mjs';
import { createMaintenanceOsAnchorV1, readMaintenanceLegacyAuditObservationV1 } from './sovereign-maintenance-os-anchor-v1.mjs';
import { readMaintenanceOwnerObservationV2 } from './sovereign-maintenance-owner-observation-v2.mjs';
import { projectMaintenanceSourceDiagnosticV1 } from '../shared/agents/sovereignMaintenanceSourceDiagnosticV1.mjs';
import { projectGoalBuilderChildBlockerV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { captureCoreRepairContinuationV1, captureCoreRepairStatusRequestV1, captureCoreRepairPrepareRequestV1,
  captureCoreRepairContinuationStatusV1, sameCoreRepairContinuationV1, unknownCoreRepairRequestStatusV1,
  CORE_REPAIR_REQUEST_STATUS_SCHEMA_V1, CORE_REPAIR_OWNER_PROTOCOL_V1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';

export const MAINTENANCE_CUSTODY_SCHEMA = 'stephanos.sovereign-maintenance-custody.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const instant = value => typeof value === 'string' && /Z$/.test(value) ? Date.parse(value) : NaN;
const held = blocker => ({ ok: false, blocker, custodyReleased: false });
const json = value => JSON.stringify(value) + '\n';
const NATIVE_MAINTENANCE_PROFILES_V1 = Object.freeze({
  'repair-goal-builder-flow': 'MAINTENANCE_GOAL_BUILDER_V1',
  'prepare-spatial-workspace': 'SPATIAL_WORKSPACE_PREPARE_V1',
});
const CORE_OWNER_SCHEMA = 'stephanos.core-repair-owner-state.v1';
const CORE_TERMINAL_STATES = ['NOT_STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
const hex = (value, length) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const noLaunchProofHash = item => sha(JSON.stringify({ schemaVersion: 'stephanos.core-repair-no-launch-proof.v1',
  continuation: captureCoreRepairContinuationV1(item.continuation), preparedAtUtc: item.preparedAtUtc,
  terminalAtUtc: item.terminalAtUtc, reservationDigest: item.reservationDigest,
  reservationRecordId: item.reservationRecordId, blocker: item.terminalBlocker,
  disposition: 'NOT_STARTED', executionOccurred: false }));
function validCoreOwnerState(value) {
  if (!exactKeys(value, ['schemaVersion', 'enrollmentId', 'machineHash', 'bootStartedAtUtc', 'request'])
      || value.schemaVersion !== CORE_OWNER_SCHEMA || !hex(value.enrollmentId, 64) || !hex(value.machineHash, 64)
      || !Number.isFinite(instant(value.bootStartedAtUtc))) return false;
  const item = value.request;
  if (item === null) return true;
  if (!exactKeys(item, ['continuation', 'state', 'preparedAtUtc', 'terminalAtUtc', 'reservationDigest',
    'reservationRecordId', 'terminalProofHash', 'terminalBlocker', 'custodyReleased'])
      || !captureCoreRepairContinuationV1(item.continuation)
      || item.continuation.enrollmentId !== value.enrollmentId
      || !['PREPARED', 'RESERVED', 'UNKNOWN', ...CORE_TERMINAL_STATES].includes(item.state)
      || !Number.isFinite(instant(item.preparedAtUtc))
      || (item.terminalAtUtc !== '' && !Number.isFinite(instant(item.terminalAtUtc)))
      || (item.reservationDigest !== '' && !hex(item.reservationDigest, 64))
      || (item.reservationRecordId !== null && (!Number.isSafeInteger(item.reservationRecordId) || item.reservationRecordId < 1))
      || (item.terminalProofHash !== '' && !hex(item.terminalProofHash, 64))
      || typeof item.terminalBlocker !== 'string' || !/^(?:[A-Z0-9][A-Z0-9._:-]{0,159})?$/.test(item.terminalBlocker)
      || typeof item.custodyReleased !== 'boolean') return false;
  if (['PREPARED', 'RESERVED'].includes(item.state)
      && (item.custodyReleased || item.terminalAtUtc || item.terminalProofHash || item.reservationDigest || item.reservationRecordId !== null)) return false;
  if (CORE_TERMINAL_STATES.includes(item.state) && (!item.custodyReleased || !item.terminalAtUtc)) return false;
  if (item.state === 'NOT_STARTED' && item.terminalProofHash !== noLaunchProofHash(item)) return false;
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(item.state)
      && (!hex(item.reservationDigest, 64) || !hex(item.terminalProofHash, 64) || item.reservationRecordId === null)) return false;
  return true;
}

export function readMaintenanceRecoverySourceV1() {
  const source = collectCanonicalIgnitionSourceTruth({
    cwd: fileURLToPath(new URL('..', import.meta.url)), platform: process.platform, environment: process.env });
  const verdict = evaluateCanonicalIgnitionSourceTruth(source);
  const head = verdict?.sourceTruth?.head || source.head;
  if (!verdict.ok || !/^[a-f0-9]{40}$/.test(head ?? ''))
    throw Object.assign(new Error('MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN'),
      projectMaintenanceSourceDiagnosticV1(verdict?.blocker?.code, verdict?.blocker?.sourceStep,
        verdict?.blocker?.sourceConfiguration));
  return head;
}

export function validMaintenanceBootWitnessV1(value, nowMs = Date.now()) {
  return value?.schemaVersion === 'stephanos.windows-boot-witness.v1'
    && /^[a-f0-9]{64}$/.test(value.machineHash ?? '')
    && Number.isFinite(instant(value.bootStartedAtUtc))
    && instant(value.bootStartedAtUtc) < instant(value.observedAtUtc)
    && nowMs >= instant(value.observedAtUtc)
    && nowMs - instant(value.observedAtUtc) <= 15_000;
}

export function readMaintenanceBootWitnessV1() {
  if (process.platform !== 'win32') throw new Error('NATIVE_WINDOWS_BOOT_WITNESS_REQUIRED');
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows/read-sovereign-maintenance-boot-witness.ps1', import.meta.url))],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
  if (result.error || result.status !== 0) throw new Error('WINDOWS_BOOT_WITNESS_UNAVAILABLE');
  const value = JSON.parse(result.stdout);
  if (!validMaintenanceBootWitnessV1(value)) throw new Error('WINDOWS_BOOT_WITNESS_INVALID');
  return Object.freeze(value);
}

function directory(path) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('CUSTODY_DIRECTORY_UNSAFE');
}

export function createMaintenanceCustodyStoreV1({ workspaceRoot = resolveGoalDiscoveryWorkspaceV1(),
  signingKey, anchor, bootWitness = readMaintenanceBootWitnessV1(), readBootWitness = readMaintenanceBootWitnessV1,
  now = () => new Date().toISOString(), observeMigrationOwner = readMaintenanceOwnerObservationV2,
  observeLegacyAudit = () => readMaintenanceLegacyAuditObservationV1({ workspaceRoot, signingKey }) } = {}) {
  if (typeof signingKey !== 'string' || signingKey.length < 32) throw new Error('CUSTODY_AUTHENTICATION_REQUIRED');
  if (!validMaintenanceBootWitnessV1(bootWitness, Date.parse(now()))) throw new Error('WINDOWS_BOOT_WITNESS_INVALID');
  bootWitness = Object.freeze({ ...bootWitness });
  const root = resolve(workspaceRoot), statusDir = resolve(root, 'status');
  directory(root); directory(statusDir);
  const path = resolve(statusDir, 'sovereign-commander-maintenance-custody.json');
  // Shared across processes in this boot. Crashes leave this fence behind;
  // only a successor full boot can acquire its own differently named fence.
  const lockPath = resolve(statusDir, 'sovereign-maintenance-'
    + sha(bootWitness.machineHash + bootWitness.bootStartedAtUtc) + '.lock');
  const archive = resolve(root, 'events', 'sovereign-maintenance-custody');
  const ownerId = randomUUID();
  const osAnchor = anchor || createMaintenanceOsAnchorV1({ workspaceRoot: root, signingKey });
  let owned = null;
  const mac = (kind, value) => createHmac('sha256', signingKey)
    .update('stephanos-maintenance-custody-v1\0' + kind + '\0' + JSON.stringify(value)).digest('hex');
  const encode = (kind, value) => json({ [kind]: value, mac: mac(kind, value) });
  const decode = (kind, bytes) => {
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (Object.keys(envelope).sort().join(',') !== [kind, 'mac'].sort().join(',')
        || !/^[a-f0-9]{64}$/.test(envelope.mac ?? '')
        || !timingSafeEqual(Buffer.from(envelope.mac, 'hex'), Buffer.from(mac(kind, envelope[kind]), 'hex')))
      throw new Error('CUSTODY_RECORD_AUTHENTICATION_FAILED');
    return envelope[kind];
  };
  const read = () => {
    // The OS-owned append log is the rollback anchor. The JSON file is only a
    // replaceable projection; replaying/deleting it cannot erase a newer hold.
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64 * 1024)
        throw new Error('CUSTODY_RECORD_UNSAFE');
    }
    const latest = osAnchor.readLatest();
    if (!latest) return null;
    const bytes = latest.bytes, record = decode('record', bytes);
    if (record.schemaVersion !== MAINTENANCE_CUSTODY_SCHEMA || !['ACTIVE', 'IDLE'].includes(record.phase)
        || !record.reservationId || !record.ownerId || !record.operation
        || !Number.isFinite(instant(record.startedAtUtc)) || !record.bootWitness
        || !/^[a-f0-9]{64}$/.test(record.bootWitness.machineHash ?? ''))
      throw new Error('CUSTODY_RECORD_INVALID');
    if (Object.hasOwn(record, 'coreRepairContinuation')
        && (!validCoreOwnerState(record.coreRepairContinuation)
          || record.coreRepairContinuation.machineHash !== record.bootWitness.machineHash))
      throw new Error('CORE_REPAIR_OWNER_STATE_INVALID');
    if (Object.hasOwn(record, 'coreRepairHistoryUnproven') && record.coreRepairHistoryUnproven !== true)
      throw new Error('CORE_REPAIR_HISTORY_FENCE_INVALID');
    return { record, digest: sha(bytes), anchorRecordId: latest.eventRecordId };
  };
  const status = () => {
    try {
      const current = read();
      return { held: !current || current.record.phase === 'ACTIVE' || existsSync(lockPath),
        digest: current?.digest || '', reservationId: current?.record.reservationId || '',
        anchorRecordId: current?.anchorRecordId || null,
        blocker: !current ? 'MAINTENANCE_CUSTODY_STATE_MISSING'
          : current.record.phase === 'ACTIVE' || existsSync(lockPath) ? 'MAINTENANCE_CUSTODY_RESERVED' : '' };
    } catch { return { held: true, digest: '', blocker: 'MAINTENANCE_CUSTODY_STATE_UNPROVEN' }; }
  };
  const write = (record, initial, expectedRecordId) => {
    const bytes = Buffer.from(encode('record', record));
    if (bytes.length > 15000) throw new Error('CUSTODY_RECORD_UNBOUNDED');
    const target = initial ? path : path + '.' + ownerId + '.tmp';
    const fd = openSync(target, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); }
    finally { closeSync(fd); }
    if (!initial) renameSync(target, path);
    osAnchor.append(bytes, { expectedRecordId }); // Atomic native compare-and-append before admission.
    return sha(bytes);
  };
  const acquire = () => {
    const fd = openSync(lockPath, 'wx', 0o600);
    try { fsyncSync(fd); return fd; } catch (error) { closeSync(fd); throw error; }
  };
  const unlock = fd => { closeSync(fd); unlinkSync(lockPath); };
  const reserve = ({ reservationId, operation, incident = null, coreContinuation = null }, initial = false) => {
    if (owned) return held('MAINTENANCE_CUSTODY_RESERVED');
    let fd;
    try {
      fd = acquire();
      const previous = read();
      if (initial ? previous !== null : !previous || previous.record.phase !== 'IDLE') {
        unlock(fd); fd = undefined; return held('MAINTENANCE_CUSTODY_RESERVED');
      }
      const captured = coreContinuation === null ? null : captureCoreRepairContinuationV1(coreContinuation);
      const slot = previous?.record.coreRepairContinuation;
      if (!captured && slot?.request?.continuation.requestId === reservationId) {
        unlock(fd); fd = undefined; return held('CORE_REPAIR_CORRELATION_REQUIRED');
      }
      if (coreContinuation !== null && (!captured || reservationId !== captured.requestId || operation !== captured.actionId
          || captured.enrollmentId !== slot?.enrollmentId
          || previous?.record.coreRepairHistoryUnproven === true || previous?.record.incident?.coreProtocolHistoryUnproven === true
          || slot?.request?.state !== 'PREPARED' || !sameCoreRepairContinuationV1(slot.request.continuation, captured))) {
        unlock(fd); fd = undefined; return held('CORE_REPAIR_REQUEST_NOT_PREPARED');
      }
      const record = { schemaVersion: MAINTENANCE_CUSTODY_SCHEMA, phase: 'ACTIVE',
        reservationId, operation, nonce: randomUUID(), ownerId, ownerPid: process.pid,
        startedAtUtc: now(), bootWitness, ...(incident ? { incident } : {}),
        ...(slot ? { coreRepairContinuation: captured
          ? { ...slot, request: { ...slot.request, state: 'RESERVED' } } : slot } : {}),
        ...(previous?.record.coreRepairHistoryUnproven === true || previous?.record.incident?.coreProtocolHistoryUnproven === true
          ? { coreRepairHistoryUnproven: true } : {}) };
      const digest = write(record, initial, previous?.anchorRecordId ?? null);
      owned = { fd, record, digest };
      return { ok: true, digest };
    } catch (error) {
      // Never remove a fence after an uncertain write; no execution was admitted.
      if (fd !== undefined) closeSync(fd);
      return held(error?.message === 'MAINTENANCE_OS_JOURNAL_CAPACITY_UNAVAILABLE'
        ? 'MAINTENANCE_CUSTODY_JOURNAL_CAPACITY_UNAVAILABLE' : 'MAINTENANCE_CUSTODY_RESERVATION_UNPROVEN');
    }
  };
  const release = (terminalEvidence = null, coreSettlement = null) => {
    if (!owned) return held('MAINTENANCE_CUSTODY_NOT_OWNED');
    try {
      const current = read();
      if (current?.digest !== owned.digest || current.record.ownerId !== ownerId)
        return held('MAINTENANCE_CUSTODY_OWNER_CHANGED');
      const slot = owned.record.coreRepairContinuation;
      const correlated = slot?.request?.state === 'RESERVED'
        && slot.request.continuation.requestId === owned.record.reservationId;
      if (correlated && !coreSettlement) return held('CORE_REPAIR_TERMINAL_DISPOSITION_UNPROVEN');
      const settled = correlated ? { ...slot.request,
        state: coreSettlement.state, custodyReleased: true, terminalAtUtc: now(),
        reservationDigest: owned.digest, reservationRecordId: current.anchorRecordId,
        terminalProofHash: terminalEvidence?.sha256 || '', terminalBlocker: coreSettlement.blocker || '' } : null;
      if (settled?.state === 'NOT_STARTED') settled.terminalProofHash = noLaunchProofHash(settled);
      write({ ...owned.record, phase: 'IDLE', terminalAtUtc: now(), terminalAdmission: 'KNOWN_TERMINAL',
        ...(terminalEvidence ? { terminalEvidence } : {}),
        ...(correlated ? { coreRepairContinuation: { ...slot, request: settled } } : {}) },
        false, current.anchorRecordId);
      unlock(owned.fd); owned = null;
      return { ok: true };
    } catch { return held('MAINTENANCE_CUSTODY_RELEASE_UNPROVEN'); }
  };
  const archiveOwnedNativeEvidence = (kind, evidence, coreDisposition = null) => {
    if (!owned) return held('MAINTENANCE_CUSTODY_NOT_OWNED');
    try {
      const current = read();
      if (current?.digest !== owned.digest || current.record.ownerId !== ownerId
          || evidence?.RequestId !== owned.record.reservationId
          || evidence?.OwnerPid !== process.pid
          || evidence?.CustodyRecordSha256 !== owned.digest
          || evidence?.NativeRecordId !== current.anchorRecordId)
        return held('MAINTENANCE_NATIVE_EVIDENCE_OWNER_CHANGED');
      const receipt = { schemaVersion: 'stephanos.maintenance-native-evidence.v1', kind,
        originalDigest: owned.digest, nativeRecordId: current.anchorRecordId,
        reservationId: owned.record.reservationId, ownerId, capturedAtUtc: now(), evidence,
        ...(owned.record.coreRepairContinuation?.request?.state === 'RESERVED'
          && owned.record.coreRepairContinuation.request.continuation.requestId === owned.record.reservationId
          ? { coreContinuation: owned.record.coreRepairContinuation.request.continuation,
            ...(kind === 'terminal' ? { coreDisposition } : {}) } : {}) };
      const bytes = Buffer.from(encode('receipt', receipt));
      if (bytes.length > 65536) return held('MAINTENANCE_NATIVE_EVIDENCE_UNBOUNDED');
      if (!existsSync(archive)) mkdirSync(archive);
      directory(archive);
      const fileName = 'native-' + kind + '-' + owned.digest + '.json';
      const fd = openSync(resolve(archive, fileName), 'wx', 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      if (read()?.digest !== owned.digest) return held('MAINTENANCE_NATIVE_EVIDENCE_OWNER_CHANGED');
      return { ok: true, evidenceRef: 'events/sovereign-maintenance-custody/' + fileName,
        evidenceSha256: sha(bytes) };
    } catch { return held('MAINTENANCE_NATIVE_EVIDENCE_ARCHIVE_UNPROVEN'); }
  };
  // Existing guardian calls these only after its private transport adjudication.
  // They add bounded signed evidence, never a public execution/recovery lane.
  const nativeProfileMatchesOwnedOperation = evidence => owned
    && Object.hasOwn(NATIVE_MAINTENANCE_PROFILES_V1, owned.record.operation)
    && evidence?.Profile === NATIVE_MAINTENANCE_PROFILES_V1[owned.record.operation];
  const terminalBlockerFor = (disposition, continuation, evidence) => {
    if (disposition === 'SUCCEEDED') return '';
    if (disposition === 'UNPROVEN') return 'CORE_REPAIR_OPERATION_OUTCOME_UNPROVEN';
    if (disposition === 'CANCELLED') return 'FIXED_RUNTIME_OPERATION_CANCELLED';
    return projectGoalBuilderChildBlockerV1(continuation.actionId, evidence.TaskStage?.Output)
      || (typeof evidence.Reason === 'string' && /^[A-Z0-9][A-Z0-9._:-]{0,159}$/.test(evidence.Reason)
        ? evidence.Reason : 'CORE_REPAIR_OPERATION_FAILED');
  };
  const recordNativeRoot = evidence => {
    if (evidence?.SchemaVersion !== 'stephanos.fixed-runtime-prepared.v1'
        || !nativeProfileMatchesOwnedOperation(evidence)
        || !Number.isSafeInteger(evidence.RootPid) || evidence.RootPid <= 0
        || !Number.isFinite(instant(evidence.RootCreatedAtUtc)))
      return held('MAINTENANCE_NATIVE_ROOT_UNPROVEN');
    return archiveOwnedNativeEvidence('root', evidence);
  };
  const releaseNativeTerminal = (evidence, { coreDisposition = null } = {}) => {
    if (evidence?.SchemaVersion !== 'stephanos.fixed-runtime-job.v1'
        || !nativeProfileMatchesOwnedOperation(evidence)
        || evidence.ExecutionCustodyReleased !== true
        || evidence.TaskStage?.ExecutionCustodyReleased !== true
        || evidence.TaskStage?.ZeroActiveProcessesObserved !== true
        || evidence.TaskStage?.ActiveProcesses !== 0)
      return held('MAINTENANCE_NATIVE_TERMINAL_UNPROVEN');
    const request = owned?.record.coreRepairContinuation?.request;
    const correlated = request?.state === 'RESERVED' && request.continuation.requestId === owned?.record.reservationId;
    if (correlated && (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNPROVEN'].includes(coreDisposition)
        || evidence.RuntimeSourceHead !== request.continuation.sourceHead))
      return held('CORE_REPAIR_TERMINAL_DISPOSITION_UNPROVEN');
    const archived = archiveOwnedNativeEvidence('terminal', evidence, coreDisposition);
    if (!archived.ok) return archived;
    // Failure of the operation stays in the archive; zero only releases custody.
    return { ...release({ ref: archived.evidenceRef, sha256: archived.evidenceSha256 }, correlated ? {
      state: coreDisposition === 'UNPROVEN' ? 'UNKNOWN' : coreDisposition,
      blocker: terminalBlockerFor(coreDisposition, request.continuation, evidence),
    } : null),
      terminalEvidenceRef: archived.evidenceRef, terminalEvidenceSha256: archived.evidenceSha256 };
  };
  // Called only after this guardian consumes the native adapter's private,
  // one-use prelaunch exclusion. No public clear or cancel endpoint exists.
  const releaseCoreRepairPrelaunch = () => {
    const request = owned?.record.coreRepairContinuation?.request;
    if (request?.state !== 'RESERVED' || request.continuation.requestId !== owned?.record.reservationId)
      return held('CORE_REPAIR_PRELAUNCH_EXCLUSION_UNPROVEN');
    return release(null, { state: 'NOT_STARTED', blocker: 'CORE_REPAIR_NATIVE_PRELAUNCH_EXCLUDED' });
  };
  const readNativeArchive = (kind, digest) => {
    if (!hex(digest, 64)) throw new Error('CORE_REPAIR_NATIVE_LOCATOR_INVALID');
    directory(archive);
    const target = resolve(archive, 'native-' + kind + '-' + digest + '.json');
    const before = lstatSync(target);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 65536)
      throw new Error('CORE_REPAIR_NATIVE_ARCHIVE_UNSAFE');
    const fd = openSync(target, 'r');
    try {
      const opened = fstatSync(fd);
      if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile() || opened.nlink !== 1 || opened.size > 65536)
        throw new Error('CORE_REPAIR_NATIVE_ARCHIVE_CHANGED');
      const buffer = Buffer.alloc(65537);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, length);
        if (count === 0) break;
        length += count;
      }
      const bytes = buffer.subarray(0, length), after = lstatSync(target), final = fstatSync(fd);
      if (length > 65536 || bytes.length !== opened.size || after.ino !== opened.ino || after.dev !== opened.dev
          || after.isSymbolicLink() || !after.isFile() || after.nlink !== 1
          || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
          || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs || final.nlink !== 1)
        throw new Error('CORE_REPAIR_NATIVE_ARCHIVE_CHANGED');
      return { receipt: decode('receipt', bytes), digest: sha(bytes) };
    } finally { closeSync(fd); }
  };
  const nativeTerminalFor = (current, item) => {
    const active = item.state === 'RESERVED' && current.record.phase === 'ACTIVE'
      && current.record.reservationId === item.continuation.requestId;
    const digest = active ? current.digest : item.reservationDigest;
    const recordId = active ? current.anchorRecordId : item.reservationRecordId;
    const terminal = readNativeArchive('terminal', digest), rootReceipt = readNativeArchive('root', digest).receipt;
    const receipt = terminal.receipt, evidence = receipt.evidence, rootEvidence = rootReceipt.evidence;
    for (const [kind, proof] of [['terminal', receipt], ['root', rootReceipt]]) {
      if (proof.schemaVersion !== 'stephanos.maintenance-native-evidence.v1' || proof.kind !== kind
          || proof.originalDigest !== digest || proof.nativeRecordId !== recordId
          || proof.reservationId !== item.continuation.requestId
          || !sameCoreRepairContinuationV1(proof.coreContinuation, item.continuation)
          || proof.evidence?.CustodyRecordSha256 !== digest || proof.evidence?.NativeRecordId !== recordId
          || proof.evidence?.RequestId !== item.continuation.requestId
          || proof.evidence?.RuntimeSourceHead !== item.continuation.sourceHead
          || proof.evidence?.Profile !== NATIVE_MAINTENANCE_PROFILES_V1[item.continuation.actionId])
        throw new Error('CORE_REPAIR_NATIVE_HISTORY_UNBOUND');
    }
    if (receipt.ownerId !== rootReceipt.ownerId || evidence.OwnerPid !== rootEvidence.OwnerPid
        || evidence.SchemaVersion !== 'stephanos.fixed-runtime-job.v1'
        || rootEvidence.SchemaVersion !== 'stephanos.fixed-runtime-prepared.v1'
        || evidence.ExecutionCustodyReleased !== true || evidence.TaskStage?.ExecutionCustodyReleased !== true
        || evidence.TaskStage?.ZeroActiveProcessesObserved !== true || evidence.TaskStage?.ActiveProcesses !== 0
        || evidence.TaskStage?.RootPid !== rootEvidence.RootPid || evidence.TaskStage?.RootCreatedAtUtc !== rootEvidence.RootCreatedAtUtc
        || !['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNPROVEN'].includes(receipt.coreDisposition)
        || (!active && item.terminalProofHash && terminal.digest !== item.terminalProofHash))
      throw new Error('CORE_REPAIR_NATIVE_TERMINAL_UNPROVEN');
    const blocker = terminalBlockerFor(receipt.coreDisposition, item.continuation, evidence);
    if (!active && item.state !== 'UNKNOWN' && (item.terminalBlocker !== blocker || item.state !== receipt.coreDisposition))
      throw new Error('CORE_REPAIR_NATIVE_DISPOSITION_UNBOUND');
    return { state: receipt.coreDisposition === 'UNPROVEN' ? 'UNKNOWN' : receipt.coreDisposition,
      terminalProofHash: terminal.digest, blocker };
  };
  const coreItemSettled = (current, item) => {
    if (!item) return true;
    if (!item.custodyReleased) return false;
    if (item.state === 'NOT_STARTED') return true; // The signed no-launch proof was validated by read().
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(item.state)) {
      try { return CORE_TERMINAL_STATES.includes(nativeTerminalFor(current, item).state); } catch { return false; }
    }
    return false;
  };
  const readCoreRepairRequestStatus = (raw = {}, { observerSourceHead = '' } = {}) => {
    const request = captureCoreRepairStatusRequestV1(raw);
    const negative = (blocker, state = 'UNKNOWN', continuation = request?.continuation || null) =>
      unknownCoreRepairRequestStatusV1({ continuation, observedAtUtc: now(), observerSourceHead, state, blocker });
    if (!request) return negative('CORE_REPAIR_REQUEST_INVALID');
    try {
      const current = read(), slot = current?.record.coreRepairContinuation;
      if (!slot || current.record.coreRepairHistoryUnproven === true || current.record.incident?.coreProtocolHistoryUnproven === true)
        return negative('CORE_REPAIR_LEGACY_HISTORY_UNPROVEN', 'LEGACY_HISTORY_UNPROVEN');
      const item = slot.request, continuation = request.continuation || item?.continuation || null;
      if (continuation && continuation.enrollmentId !== slot.enrollmentId)
        return negative('CORE_REPAIR_ENROLLMENT_CHANGED', 'CONFLICT', continuation);
      if (!hex(observerSourceHead, 40)) return negative('CORE_REPAIR_OBSERVER_SOURCE_UNPROVEN', 'UNKNOWN', continuation);
      const available = current.record.phase === 'IDLE' && !existsSync(lockPath);
      const base = { schemaVersion: CORE_REPAIR_REQUEST_STATUS_SCHEMA_V1, ok: true,
        state: 'UNKNOWN', continuation, observedAtUtc: now(), observerSourceHead,
        historyAuthenticated: true, custodyReleased: false, currentAdmissionAvailable: false,
        nextSequence: null, previousRequestId: '', terminalProofHash: '', blocker: '',
        sameRequestDeliveryAllowed: false, sameRequestPreparationAllowed: false,
        ownerProtocolVersion: CORE_REPAIR_OWNER_PROTOCOL_V1, preparationRequired: true,
        initialEpochProven: true, enrollmentId: slot.enrollmentId,
        replayAllowed: false, readOnly: true, executionAuthority: false };
      const finish = fields => captureCoreRepairContinuationStatusV1({ ...base, ...fields })
        || negative('CORE_REPAIR_STATUS_PROJECTION_INVALID', 'UNKNOWN', continuation);
      if (!continuation) return finish(available ? { state: 'READY', custodyReleased: true,
        currentAdmissionAvailable: true, nextSequence: 1 } : { ok: false, blocker: 'MAINTENANCE_CUSTODY_RESERVED' });
      if (!item || !sameCoreRepairContinuationV1(item.continuation, continuation)) {
        const next = coreItemSettled(current, item);
        const nextSequence = item ? item.continuation.sequence + 1 : 1;
        const previousRequestId = item?.continuation.requestId || '';
        if (next && continuation.sequence === nextSequence && continuation.previousRequestId === previousRequestId) {
          if (item && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(item.state)) nativeTerminalFor(current, item);
          const canPrepare = available && continuation.sourceHead === observerSourceHead;
          return finish({ ok: canPrepare, blocker: canPrepare ? 'CORE_REPAIR_REQUEST_NOT_PREPARED'
              : available ? 'CORE_REPAIR_SOURCE_ADVANCED' : 'MAINTENANCE_CUSTODY_RESERVED',
            sameRequestPreparationAllowed: canPrepare, custodyReleased: canPrepare,
            currentAdmissionAvailable: canPrepare, nextSequence: canPrepare ? nextSequence : null,
            previousRequestId: canPrepare ? previousRequestId : '' });
        }
        return finish({ ok: false, state: item && continuation.sequence < item.continuation.sequence ? 'SUPERSEDED' : 'CONFLICT',
          blocker: 'CORE_REPAIR_ORIGINAL_IDENTITY_CONFLICT' });
      }
      if (item.state === 'PREPARED') return finish({ state: 'PREPARED',
        sameRequestDeliveryAllowed: available && observerSourceHead === continuation.sourceHead,
        blocker: !available ? 'MAINTENANCE_CUSTODY_RESERVED'
          : observerSourceHead !== continuation.sourceHead ? 'CORE_REPAIR_SOURCE_ADVANCED' : '' });
      if (item.state === 'RESERVED') {
        try { return finish({ ...nativeTerminalFor(current, item), blocker: 'CORE_REPAIR_CUSTODY_RELEASE_UNPROVEN' }); }
        catch { return finish({ state: 'RESERVED', blocker: 'CORE_REPAIR_NATIVE_TERMINAL_UNPROVEN' }); }
      }
      let terminal = { state: item.state, terminalProofHash: item.terminalProofHash };
      if (item.reservationDigest && item.state !== 'NOT_STARTED') {
        try { terminal = nativeTerminalFor(current, item); }
        catch (error) { if (item.state !== 'UNKNOWN') throw error; }
      }
      const exhausted = continuation.sequence >= 1_000_000_000;
      const mayAdvance = CORE_TERMINAL_STATES.includes(terminal.state) && item.custodyReleased && available && !exhausted;
      return finish({ ...terminal, custodyReleased: item.custodyReleased,
        currentAdmissionAvailable: mayAdvance, nextSequence: mayAdvance ? continuation.sequence + 1 : null,
        previousRequestId: mayAdvance ? continuation.requestId : '',
        blocker: terminal.blocker || item.terminalBlocker || (!available ? 'MAINTENANCE_CUSTODY_RESERVED'
          : exhausted ? 'CORE_REPAIR_SEQUENCE_EXHAUSTED'
          : terminal.state === 'UNKNOWN' ? 'CORE_REPAIR_OPERATION_OUTCOME_UNPROVEN' : '') });
    } catch { return negative('CORE_REPAIR_AUTHENTICATED_HISTORY_UNPROVEN'); }
  };
  const prepareCoreRepairRequest = (raw, { observerSourceHead = '', prelaunchRefusal = '' } = {}) => {
    const request = captureCoreRepairPrepareRequestV1(raw);
    if (!request) return unknownCoreRepairRequestStatusV1({ observedAtUtc: now(), blocker: 'CORE_REPAIR_REQUEST_INVALID' });
    const before = readCoreRepairRequestStatus(request, { observerSourceHead });
    // Only fixed internal owner refusals are accepted here. The authenticated
    // prepare tool supplies no refusal argument and grants no clear authority.
    const refusal = ['CORE_REPAIR_NATIVE_WINDOWS_QUALIFICATION_REQUIRED', 'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED',
      'CORE_REPAIR_NATIVE_QUALIFICATION_UNPROVEN'].includes(prelaunchRefusal) ? prelaunchRefusal : '';
    const staleSource = before.historyAuthenticated && before.observerSourceHead !== request.continuation.sourceHead;
    const retirePrepared = before.state === 'PREPARED' && before.historyAuthenticated && (staleSource || Boolean(refusal));
    // A durable local intent can outlive its source before PREPARE reaches us.
    // Enforced prepare-before-execute makes the authenticated next empty slot
    // a no-launch proof, but only a signed CAS tombstone closes delayed sends.
    const retireUnprepared = before.state === 'UNKNOWN' && staleSource
      && before.blocker === 'CORE_REPAIR_SOURCE_ADVANCED';
    const retire = retirePrepared || retireUnprepared;
    if (!before.sameRequestPreparationAllowed && !retire) return before;
    if (owned) return before;
    let fd, mutationStarted = false;
    try {
      fd = acquire();
      const current = read(), slot = current?.record.coreRepairContinuation;
      if (!slot || current.record.phase !== 'IDLE' || current.record.coreRepairHistoryUnproven === true
          || current.record.incident?.coreProtocolHistoryUnproven === true)
        throw new Error('CORE_REPAIR_PREPARE_OWNER_UNAVAILABLE');
      const item = slot.request, continuation = request.continuation;
      if (continuation.enrollmentId !== slot.enrollmentId) throw new Error('CORE_REPAIR_ENROLLMENT_CHANGED');
      const samePrepared = item?.state === 'PREPARED' && sameCoreRepairContinuationV1(item.continuation, continuation);
      const exactNext = coreItemSettled(current, item)
        && continuation.sequence === (item ? item.continuation.sequence + 1 : 1)
        && continuation.previousRequestId === (item?.continuation.requestId || '');
      if (retire ? !samePrepared && !(retireUnprepared && exactNext)
        : !exactNext || continuation.sourceHead !== observerSourceHead)
        throw new Error('CORE_REPAIR_PREPARE_IDENTITY_CHANGED');
      const capturedAtUtc = now();
      const bound = samePrepared ? item : {
        continuation, state: 'PREPARED', preparedAtUtc: capturedAtUtc, terminalAtUtc: '', reservationDigest: '',
        reservationRecordId: null, terminalProofHash: '', terminalBlocker: '', custodyReleased: false };
      const prepared = retire ? { ...bound, state: 'NOT_STARTED', custodyReleased: true, terminalAtUtc: capturedAtUtc,
        terminalBlocker: observerSourceHead !== continuation.sourceHead
          ? samePrepared ? 'CORE_REPAIR_SOURCE_ADVANCED_BEFORE_RESERVATION' : 'CORE_REPAIR_SOURCE_ADVANCED_BEFORE_PREPARATION'
          : refusal } : bound;
      if (retire) prepared.terminalProofHash = noLaunchProofHash(prepared);
      mutationStarted = true;
      write({ ...current.record, coreRepairContinuation: { ...slot, request: prepared } }, false, current.anchorRecordId);
      unlock(fd); fd = undefined;
      return readCoreRepairRequestStatus(request, { observerSourceHead });
    } catch {
      if (fd !== undefined) { if (mutationStarted) closeSync(fd); else unlock(fd); }
      return unknownCoreRepairRequestStatusV1({ continuation: request.continuation, observedAtUtc: now(),
        observerSourceHead, blocker: 'CORE_REPAIR_PREPARATION_UNPROVEN' });
    }
  };
  const recoverAfterBoot = async ({ expectedDigest, operatorApproval }) => {
    if (operatorApproval !== 'operator-approved' || !/^[a-f0-9]{64}$/.test(expectedDigest ?? ''))
      return held('MAINTENANCE_CUSTODY_EXACT_APPROVAL_REQUIRED');
    let lock;
    try {
      lock = acquire();
      const current = read();
      if (!current || current.record.phase !== 'ACTIVE' || current.digest !== expectedDigest)
        return held('MAINTENANCE_CUSTODY_DIGEST_CHANGED');
      const witness = await readBootWitness(), pinned = current.record.bootWitness;
      if (!validMaintenanceBootWitnessV1(witness, Date.parse(now()))
          || witness.machineHash !== pinned.machineHash
          || !Number.isFinite(instant(pinned.observedAtUtc))
          || instant(witness.bootStartedAtUtc) <= instant(pinned.observedAtUtc)
          || witness.bootStartedAtUtc === pinned.bootStartedAtUtc)
        return held('MAINTENANCE_CUSTODY_NEW_BOOT_UNPROVEN');
      if (bootWitness.bootStartedAtUtc !== witness.bootStartedAtUtc
          || bootWitness.machineHash !== witness.machineHash)
        return held('MAINTENANCE_CUSTODY_SUCCESSOR_OWNER_UNPROVEN');
      if (read()?.digest !== expectedDigest) return held('MAINTENANCE_CUSTODY_DIGEST_CHANGED');
      directory(resolve(root, 'events'));
      if (!existsSync(archive)) mkdirSync(archive);
      directory(archive);
      const receipt = { schemaVersion: 'stephanos.sovereign-maintenance-custody-recovery.v1',
        original: current.record, originalDigest: expectedDigest, successorOwnerId: ownerId,
        successorPid: process.pid, bootWitness: witness, recoveredAtUtc: now(),
        historicalOutcome: 'UNKNOWN', originalR7Authority: false, sourceLeaseReleased: false,
        exclusion: 'ORIGINAL_PROCESSES_ENDED_ACROSS_VERIFIED_FULL_BOOT' };
      const auditBytes = encode('receipt', receipt);
      const auditFd = openSync(resolve(archive, expectedDigest + '-' + ownerId + '.json'), 'wx', 0o600);
      try { writeFileSync(auditFd, auditBytes); fsyncSync(auditFd); } finally { closeSync(auditFd); }
      if (read()?.digest !== expectedDigest) return held('MAINTENANCE_CUSTODY_DIGEST_CHANGED');
      // Only the existing authenticated same-machine successor-boot recovery
      // can establish the protocol epoch. Ordinary IDLE and replaced/lost
      // journal projections never prove an empty historical Core slot.
      let coreRepairContinuation = current.record.coreRepairContinuation;
      const migrationUnknown = current.record.coreRepairHistoryUnproven === true || current.record.incident?.coreProtocolHistoryUnproven === true
        || ['AUDIT_LOSS_REPREPARATION', 'RETAINED_JOURNAL_MIGRATION'].includes(current.record.incident?.kind);
      if (!coreRepairContinuation && !migrationUnknown) coreRepairContinuation = {
        schemaVersion: CORE_OWNER_SCHEMA, enrollmentId: sha(auditBytes), machineHash: witness.machineHash,
        bootStartedAtUtc: witness.bootStartedAtUtc, request: null,
      };
      if (coreRepairContinuation?.request?.state === 'RESERVED') coreRepairContinuation = {
        ...coreRepairContinuation, request: { ...coreRepairContinuation.request, state: 'UNKNOWN',
          custodyReleased: true, terminalAtUtc: now(), reservationDigest: current.digest,
          reservationRecordId: current.anchorRecordId, terminalBlocker: 'CORE_REPAIR_OUTCOME_UNKNOWN_AFTER_SUCCESSOR_BOOT' },
      };
      write({ ...current.record, phase: 'IDLE', terminalAtUtc: now(),
        terminalAdmission: 'SUCCESSOR_FULL_BOOT', recoveryReceiptDigest: sha(auditBytes), recoveryBootWitness: witness,
        ...(migrationUnknown ? { coreRepairHistoryUnproven: true } : {}),
        ...(coreRepairContinuation ? { coreRepairContinuation } : {}) },
        false, current.anchorRecordId);
      unlock(lock); lock = undefined;
      return { ok: true, custodyReleased: true, receiptDigest: sha(auditBytes),
        reservationId: current.record.reservationId, historicalOutcome: 'UNKNOWN', originalR7Authority: false };
    } catch { return held('MAINTENANCE_CUSTODY_RECOVERY_UNPROVEN'); }
    finally { if (lock !== undefined) { try { unlock(lock); } catch { /* Retained fence fails closed. */ } } }
  };
  const prepareFromAuditLoss = async ({ expectedDigest, expectedReservationId, operatorApproval,
    expectedOwnerDigest, expectedMain } = {}, retainedMigration = false) => {
    if (operatorApproval !== 'operator-approved' || !/^[a-f0-9]{64}$/.test(expectedDigest ?? '')
        || typeof expectedReservationId !== 'string' || !expectedReservationId)
      return held('MAINTENANCE_AUDIT_LOSS_EXACT_APPROVAL_REQUIRED');
    if (owned) return held('MAINTENANCE_CUSTODY_RESERVED');
    if (retainedMigration && (!/^[a-f0-9]{64}$/.test(expectedOwnerDigest ?? '') || !/^[a-f0-9]{40}$/.test(expectedMain ?? '')))
      return held('MAINTENANCE_MIGRATION_OWNER_BINDING_REQUIRED');
    const validOwner = owner => owner && owner.digest === expectedOwnerDigest
      && sha(JSON.stringify(owner.observation)) === owner.digest
      && owner.observation.schemaVersion === 'stephanos.maintenance-held-owner-observation.v2'
      && owner.observation.timeoutCustodyHeld === true && owner.observation.running === false
      && owner.observation.maintenanceInFlight === false && owner.observation.scheduled === false
      && Number.isSafeInteger(owner.observation.pid) && owner.observation.pid > 0
      && Number.isFinite(instant(owner.observedAtUtc))
      && Date.parse(now()) >= instant(owner.observedAtUtc)
      && Date.parse(now()) - instant(owner.observedAtUtc) <= 15_000
      && instant(owner.observation.createdAtUtc) >= instant(bootWitness.bootStartedAtUtc);
    let fd, mutationStarted = false;
    try {
      fd = acquire();
      // Missing is not idle. This operation creates only a new ACTIVE fence;
      // its later-boot recovery must exclude ALL potentially lost executions.
      // A corrupt/unreadable/newer anchor throws or refuses, never bootstraps.
      if (read() !== null) { unlock(fd); fd = undefined; return held('MAINTENANCE_AUDIT_ANCHOR_PRESENT'); }
      if ((await observeLegacyAudit())?.present !== false) throw new Error('LEGACY_AUTHORITY_NOT_ABSENT');
      const ownerBefore = retainedMigration ? await observeMigrationOwner() : null;
      if (retainedMigration && !validOwner(ownerBefore)) throw new Error('MIGRATION_OWNER_CHANGED');
      const witness = await readBootWitness();
      if (!validMaintenanceBootWitnessV1(witness, Date.parse(now()))
          || witness.machineHash !== bootWitness.machineHash
          || witness.bootStartedAtUtc !== bootWitness.bootStartedAtUtc)
        throw new Error('PREPARATION_BOOT_UNPROVEN');
      const bytes = readFileSync(path);
      if (bytes.length > 15000 || sha(bytes) !== expectedDigest)
        throw new Error('PROJECTION_CHANGED');
      const original = decode('record', bytes);
      if (original.schemaVersion !== MAINTENANCE_CUSTODY_SCHEMA
          || !(retainedMigration ? ['ACTIVE', 'IDLE'] : ['ACTIVE']).includes(original.phase)
          || original.reservationId !== expectedReservationId)
        throw new Error('PROJECTION_IDENTITY_UNPROVEN');
      if (Object.hasOwn(original, 'coreRepairContinuation') && !validCoreOwnerState(original.coreRepairContinuation))
        throw new Error('CORE_REPAIR_ORIGINAL_HISTORY_INVALID');
      directory(resolve(root, 'events'));
      if (!existsSync(archive)) mkdirSync(archive);
      directory(archive);
      const receipt = { schemaVersion: retainedMigration ? 'stephanos.maintenance-retained-migration-preparation.v2'
        : 'stephanos.maintenance-audit-loss-preparation.v1',
        original, originalEnvelopeBase64: bytes.toString('base64'), originalDigest: expectedDigest, projectionFreshness: 'UNPROVEN',
        historicalOutcome: 'UNKNOWN', sourceLeaseReleased: false,
        preparedAtUtc: now(), bootWitness: witness, successorOwnerId: ownerId,
        ...(retainedMigration ? { heldOwnerObservation: ownerBefore, sourceHead: expectedMain, priorIdleIsFreshnessProof: false } : {}) };
      const auditBytes = encode('receipt', receipt);
      if (Buffer.byteLength(auditBytes) > 64 * 1024) throw new Error('AUDIT_LOSS_ARCHIVE_UNBOUNDED');
      mutationStarted = true;
      const auditFd = openSync(resolve(archive, (retainedMigration ? 'retained-migration-' : 'audit-loss-')
        + expectedDigest + '-' + ownerId + '.json'), 'wx', 0o600);
      try { writeFileSync(auditFd, auditBytes); fsyncSync(auditFd); } finally { closeSync(auditFd); }
      // Recheck the captured projection and OS authority after durable archive.
      const ownerAfter = retainedMigration ? await observeMigrationOwner() : null;
      const legacyAfter = await observeLegacyAudit();
      const authorityAfter = read();
      // No asynchronous observation may follow the final projection comparison.
      if (authorityAfter !== null || legacyAfter?.present !== false
          || (retainedMigration && !validOwner(ownerAfter)) || sha(readFileSync(path)) !== expectedDigest)
        throw new Error('AUDIT_LOSS_PREPARATION_RACED');
      const record = { schemaVersion: MAINTENANCE_CUSTODY_SCHEMA, phase: 'ACTIVE',
        reservationId: expectedReservationId, operation: 'repair-stephanos',
        nonce: randomUUID(), ownerId, ownerPid: process.pid, startedAtUtc: now(), bootWitness: witness,
        incident: { kind: retainedMigration ? 'RETAINED_JOURNAL_MIGRATION' : 'AUDIT_LOSS_REPREPARATION',
          ...(retainedMigration ? { heldOwnerDigest: expectedOwnerDigest, sourceHead: expectedMain } : {}), originalProjectionDigest: expectedDigest,
          projectionFreshness: 'UNPROVEN', historicalOutcome: 'UNKNOWN',
          preparationReceiptDigest: sha(auditBytes), coreProtocolHistoryUnproven: true },
        coreRepairHistoryUnproven: true,
        ...(original.coreRepairContinuation ? { coreRepairContinuation: original.coreRepairContinuation } : {}) };
      const digest = write(record, false, null);
      if (retainedMigration) {
        let ownerStillBound = false;
        try { ownerStillBound = validOwner(await observeMigrationOwner()); } catch { /* Retain real ACTIVE. */ }
        if (!ownerStillBound) {
          closeSync(fd); fd = undefined;
          return { ok: false, prepared: true, digest, custodyReleased: false, requiresLaterFullBoot: true,
            blocker: 'MAINTENANCE_MIGRATION_OWNER_CHANGED_RETAIN_HOLD' };
        }
      }
      // Never give this process release authority: preparation does not prove
      // prior process extinction. Retain the boot fence even after close().
      closeSync(fd); fd = undefined;
      return { ok: true, prepared: true, digest, reservationId: expectedReservationId,
        custodyReleased: false, historicalOutcome: 'UNKNOWN', sourceLeaseReleased: false,
        requiresLaterFullBoot: true, receiptDigest: sha(auditBytes) };
    } catch {
      if (fd !== undefined) {
        if (mutationStarted) closeSync(fd); // Uncertain writes retain the fence.
        else unlock(fd); // A known pre-write refusal must not strand admission.
      }
      return held('MAINTENANCE_AUDIT_LOSS_PREPARATION_UNPROVEN');
    }
  };
  const prepareAfterAuditLoss = request => prepareFromAuditLoss(request, false);
  const prepareRetainedMigration = request => prepareFromAuditLoss(request, true);
  const preparedRecoveryEligible = () => {
    try {
      const current = read();
      const incident = current?.record?.incident;
      return Boolean(current && current.record.phase === 'ACTIVE'
        && incident?.kind === 'RETAINED_JOURNAL_MIGRATION'
        && /^[a-f0-9]{64}$/.test(incident?.preparationReceiptDigest ?? '')
        && /^[a-f0-9]{64}$/.test(incident?.heldOwnerDigest ?? '')
        && /^[a-f0-9]{40}$/.test(incident?.sourceHead ?? '')
        && /^[a-f0-9]{64}$/.test(incident?.originalProjectionDigest ?? '')
        && incident?.historicalOutcome === 'UNKNOWN'
        && incident?.projectionFreshness === 'UNPROVEN');
    } catch { return false; }
  };
  const recoverPreparedAfterBoot = async () => {
    let current;
    try { current = read(); } catch { return held('MAINTENANCE_PREPARED_RECOVERY_UNPROVEN'); }
    if (!preparedRecoveryEligible()) return held('MAINTENANCE_PREPARED_RECOVERY_UNPROVEN');
    // The ACTIVE retained-migration record exists only after the exact
    // operator-approved preparation path has durably archived its receipt.
    // A successor boot may consume that prior authorization, but may not
    // create or widen it. recoverAfterBoot still rechecks digest + full boot.
    return recoverAfterBoot({ expectedDigest: current.digest, operatorApproval: 'operator-approved' });
  };
  return Object.freeze({ status, reserve, release, recordNativeRoot, releaseNativeTerminal, releaseCoreRepairPrelaunch,
    readCoreRepairRequestStatus, prepareCoreRepairRequest,
    recoverAfterBoot, preparedRecoveryEligible, recoverPreparedAfterBoot, prepareAfterAuditLoss, prepareRetainedMigration,
    // This only ADDS an ACTIVE fence. The fixed migration adapter independently
    // checks the exact live held owner/report before calling it. No idle seed.
    prepareIncident: request => reserve(request, true),
    close: () => { if (owned) { try { closeSync(owned.fd); } catch {} owned = null; } } });
}
