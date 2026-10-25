// Durable adapter of the existing guardian, not another executor or lease owner.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoalDiscoveryWorkspaceV1 } from '../shared/agents/goalDiscoveryWorkspaceV1.mjs';
import { collectCanonicalIgnitionSourceTruth, evaluateCanonicalIgnitionSourceTruth } from './battle-bridge-ignition-supervisor.mjs';
import { createMaintenanceOsAnchorV1 } from './sovereign-maintenance-os-anchor-v1.mjs';
import { projectMaintenanceSourceDiagnosticV1 } from '../shared/agents/sovereignMaintenanceSourceDiagnosticV1.mjs';

export const MAINTENANCE_CUSTODY_SCHEMA = 'stephanos.sovereign-maintenance-custody.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const instant = value => typeof value === 'string' && /Z$/.test(value) ? Date.parse(value) : NaN;
const held = blocker => ({ ok: false, blocker, custodyReleased: false });
const json = value => JSON.stringify(value) + '\n';

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
  now = () => new Date().toISOString() } = {}) {
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
  const reserve = ({ reservationId, operation, incident = null }, initial = false) => {
    if (owned) return held('MAINTENANCE_CUSTODY_RESERVED');
    let fd;
    try {
      fd = acquire();
      const previous = read();
      if (initial ? previous !== null : !previous || previous.record.phase !== 'IDLE') {
        unlock(fd); fd = undefined; return held('MAINTENANCE_CUSTODY_RESERVED');
      }
      const record = { schemaVersion: MAINTENANCE_CUSTODY_SCHEMA, phase: 'ACTIVE',
        reservationId, operation, nonce: randomUUID(), ownerId, ownerPid: process.pid,
        startedAtUtc: now(), bootWitness, ...(incident ? { incident } : {}) };
      const digest = write(record, initial, previous?.anchorRecordId ?? null);
      owned = { fd, record, digest };
      return { ok: true, digest };
    } catch {
      // Never remove a fence after an uncertain write; no execution was admitted.
      if (fd !== undefined) closeSync(fd);
      return held('MAINTENANCE_CUSTODY_RESERVATION_UNPROVEN');
    }
  };
  const release = () => {
    if (!owned) return held('MAINTENANCE_CUSTODY_NOT_OWNED');
    try {
      const current = read();
      if (current?.digest !== owned.digest || current.record.ownerId !== ownerId)
        return held('MAINTENANCE_CUSTODY_OWNER_CHANGED');
      write({ ...owned.record, phase: 'IDLE', terminalAtUtc: now(), terminalAdmission: 'KNOWN_TERMINAL' },
        false, current.anchorRecordId);
      unlock(owned.fd); owned = null;
      return { ok: true };
    } catch { return held('MAINTENANCE_CUSTODY_RELEASE_UNPROVEN'); }
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
      write({ ...current.record, phase: 'IDLE', terminalAtUtc: now(),
        terminalAdmission: 'SUCCESSOR_FULL_BOOT', recoveryReceiptDigest: sha(auditBytes), recoveryBootWitness: witness },
        false, current.anchorRecordId);
      unlock(lock); lock = undefined;
      return { ok: true, custodyReleased: true, receiptDigest: sha(auditBytes),
        reservationId: current.record.reservationId, historicalOutcome: 'UNKNOWN', originalR7Authority: false };
    } catch { return held('MAINTENANCE_CUSTODY_RECOVERY_UNPROVEN'); }
    finally { if (lock !== undefined) { try { unlock(lock); } catch { /* Retained fence fails closed. */ } } }
  };
  return Object.freeze({ status, reserve, release, recoverAfterBoot,
    // This only ADDS an ACTIVE fence. The fixed migration adapter independently
    // checks the exact live held owner/report before calling it. No idle seed.
    prepareIncident: request => reserve(request, true),
    close: () => { if (owned) { try { closeSync(owned.fd); } catch {} owned = null; } } });
}
