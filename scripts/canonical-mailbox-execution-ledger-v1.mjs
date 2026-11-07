import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { setImmediate as yieldDiscovery } from 'node:timers/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, readJsonObject } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { MAILBOX_ROTATION_REQUEST_ID, mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { projectControlTowerRequestObservationV1, projectControlTowerLedgerObservationV1,
  controlTowerBuildObservationUnresolvedV1, createControlTowerRequestObservationV1 } from '../shared/agents/controlTowerRequestObservationV1.mjs';
import { CONTROL_TOWER_BUILD_OPERATION } from '../shared/agents/controlTowerBuildRequestV1.mjs';
const SCHEMA = 'stephanos.mailbox-execution-ledger-entry.v1';
const INVENTORY_MAX_ENTRIES = 8192;
const ENTRY_MAX_BYTES = 4096;
const DISCOVERY_BATCH_SIZE = 128;
const DISCOVERY_MAX_DURATION_MS = 10_000;
const CONTROL_TOWER_IDENTITY = ['requestId', 'runId', 'runAttempt', 'operation', 'sourceHead',
  'artifactId', 'artifactSha256', 'commandDigest', 'createdAtUtc', 'expiresAtUtc', 'acceptedAtUtc'];
const observationHashValid = observation => !observation?.controlSystemStatus
  || observation.observationProofHash === createHash('sha256')
    .update(JSON.stringify(observation.controlSystemStatus)).digest('hex');
const sameIdentity = (before, after) => before.dev === after.dev && before.ino === after.ino
  && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.size === after.size;
const latestObservation = (left, right) => !left || (Date.parse(right.acceptedAtUtc) || 0) > (Date.parse(left.acceptedAtUtc) || 0)
  || (right.acceptedAtUtc === left.acceptedAtUtc && right.runId > left.runId) ? right : left;
function validateLedgerRecord(record, id) {
  if (record.schemaVersion !== SCHEMA || record.requestId !== id
    || !['RESERVED', 'TERMINAL', 'RETIRED'].includes(record.phase)
    || !Number.isSafeInteger(record.issueNumber) || record.issueNumber <= 0)
    throw new Error('MAILBOX_EXECUTION_LEDGER_ENTRY_INVALID');
  return record;
}
function observeControlTowerRecord(record, options) {
  const observed = projectControlTowerLedgerObservationV1(record, options);
  if (observed?.detailState === 'OBSERVED' && !observationHashValid(observed))
    return projectControlTowerLedgerObservationV1({ ...record, controlTowerObservation: {} }, options);
  return observed;
}
function directory(path, create = false) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, component);
    if (!existsSync(current) && create) mkdirSync(current);
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('MAILBOX_EXECUTION_LEDGER_DIRECTORY_UNSAFE');
  }
}
export function createMailboxExecutionLedger(mailboxStateRoot) {
  const root = join(resolve(mailboxStateRoot), 'execution-ledger-v1');
  const location = id => {
    if (!MAILBOX_ROTATION_REQUEST_ID.test(id || '')) throw new Error('MAILBOX_EXECUTION_LEDGER_REQUEST_INVALID');
    const hash = mailboxRotationDigest(id);
    return join(root, hash.slice(0,2), `${hash}.json`);
  };
  const read = id => {
    const path = location(id);
    // Missing ledger parents are allowed only as absence; existing linked parents
    // or files never become a clean miss.
    let parent = dirname(path);
    while (!existsSync(parent)) parent = dirname(parent);
    directory(parent);
    if (!existsSync(path)) return null;
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 4096) throw new Error('MAILBOX_EXECUTION_LEDGER_ENTRY_UNSAFE');
    const record = JSON.parse(readFileSync(path, 'utf8'));
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs)
      throw new Error('MAILBOX_EXECUTION_LEDGER_ENTRY_INVALID');
    return validateLedgerRecord(record, id);
  };
  const insert = (id, record) => {
    if (Buffer.byteLength(`${JSON.stringify(record)}\n`, 'utf8') > 4096)
      throw new Error('MAILBOX_EXECUTION_LEDGER_ENTRY_TOO_LARGE');
    const path = location(id); directory(dirname(path), true);
    let fd;
    try { fd = openSync(path, 'wx', 0o600); writeFileSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd); }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    finally { if (fd !== undefined) closeSync(fd); }
    return true;
  };
  function inventory() {
    // Other original consumers can write this ledger outside the outbox lock.
    // This bounded readback is a local observation, never a serialization claim.
    // Missing directories are unknown: inventory must not create or import them.
    directory(root);
    const dirs = new Map(), files = new Map(), records = [];
    const deny = reason => { throw Error('MAILBOX_EXECUTION_LEDGER_INVENTORY_' + reason); };
    const stable = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
      && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
    function freezeRecord(value) {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeRecord(child);
        Object.freeze(value);
      }
      return value;
    }
    function list(path, limit) {
      directory(path);
      const before = lstatSync(path), prior = dirs.get(path);
      if (prior && !stable(prior.info, before)) deny('DIRECTORY_CHANGED');
      const names = [], stream = opendirSync(path);
      try {
        for (;;) {
          const entry = stream.readSync(); if (!entry) break;
          if (names.length >= limit) deny('LIMIT');
          names.push(entry.name);
        }
      } finally { stream.closeSync(); }
      names.sort();
      if (!stable(before, lstatSync(path)) || (prior && JSON.stringify(prior.names) !== JSON.stringify(names))) deny('DIRECTORY_CHANGED');
      dirs.set(path, { info: before, names });
      return names;
    }
    for (const bucket of list(root, 256)) {
      if (!/^[a-f0-9]{2}$/.test(bucket)) deny('PATH_INVALID');
      const bucketPath = join(root, bucket);
      for (const name of list(bucketPath, INVENTORY_MAX_ENTRIES - records.length)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) deny('PATH_INVALID');
        const path = join(bucketPath, name), before = lstatSync(path);
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
          || before.size <= 0 || before.size > ENTRY_MAX_BYTES) deny('ENTRY_UNSAFE');
        const record = readJsonObject(path, { maxBytes: ENTRY_MAX_BYTES });
        const required = ['schemaVersion', 'requestId', 'issueNumber', 'phase', 'commandDigest'];
        const allowed = [...required, 'terminalState', 'terminalProofHash', 'controlTowerObservation'];
        if (!required.every(key => Object.hasOwn(record, key)) || Object.keys(record).some(key => !allowed.includes(key))
          || record.schemaVersion !== SCHEMA || typeof record.requestId !== 'string'
          || !MAILBOX_ROTATION_REQUEST_ID.test(record.requestId)
          || !Number.isSafeInteger(record.issueNumber) || record.issueNumber <= 0
          || !['RESERVED', 'TERMINAL', 'RETIRED'].includes(record.phase)
          || typeof record.commandDigest !== 'string' || !/^(?:[a-f0-9]{64})?$/.test(record.commandDigest)
          || (Object.hasOwn(record, 'terminalState') && (record.phase !== 'TERMINAL' || !['DONE', 'BLOCKED'].includes(record.terminalState)))
          || (Object.hasOwn(record, 'terminalProofHash') && (record.phase !== 'TERMINAL'
            || !['DONE', 'BLOCKED'].includes(record.terminalState) || typeof record.terminalProofHash !== 'string'
            || !/^[a-f0-9]{64}$/.test(record.terminalProofHash)))) deny('ENTRY_INVALID');
        if (Object.hasOwn(record, 'controlTowerObservation')) {
          const observation = projectControlTowerRequestObservationV1(record.controlTowerObservation,
            { requestId: record.requestId, commandDigest: record.commandDigest });
          // Reuse the canonical metadata/ledger validators and require the exact
          // stored projection. Unknown nested fields cannot disappear during
          // validation; the complete original record remains in both read hashes.
          if (!observation || observation.commandDigest !== record.commandDigest
            || projectControlTowerLedgerObservationV1(record)?.detailState !== 'OBSERVED'
            || (observation.operation === 'OBSERVE_CONTROL_SYSTEM' && Object.hasOwn(record, 'terminalProofHash'))
            || !observationHashValid(observation)
            || mailboxRotationDigest(observation) !== mailboxRotationDigest(record.controlTowerObservation)) deny('ENTRY_INVALID');
        }
        if (path !== location(record.requestId)) deny('REQUEST_PATH_MISMATCH');
        const after = lstatSync(path);
        if (!stable(before, after) || after.nlink !== 1) deny('ENTRY_CHANGED');
        files.set(path, { info: before, digest: mailboxRotationDigest(record) });
        records.push(freezeRecord(record));
      }
    }
    // Re-read the complete observed estate, including actual file handles via
    // readJsonObject, and enumerate names again while the observation is open.
    for (const [path, item] of files) {
      directory(dirname(path));
      const before = lstatSync(path);
      if (!stable(item.info, before) || before.nlink !== 1
        || mailboxRotationDigest(readJsonObject(path, { maxBytes: ENTRY_MAX_BYTES })) !== item.digest
        || !stable(item.info, lstatSync(path))) deny('ENTRY_CHANGED');
    }
    for (const [path, item] of dirs) list(path, item.names.length);
    records.sort((a, b) => a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0);
    const counts = Object.freeze(Object.fromEntries(['RESERVED', 'TERMINAL', 'RETIRED']
      .map(phase => [phase, records.filter(record => record.phase === phase).length])));
    const identity = info => [info.dev, info.ino, info.nlink, info.size, info.mtimeMs, info.ctimeMs];
    const compare = ([a], [b]) => a < b ? -1 : a > b ? 1 : 0;
    const physicalIdentitySha256 = mailboxRotationDigest({
      files: [...files].map(([path, item]) => [path, identity(item.info)]).sort(compare),
      directories: [...dirs].map(([path, item]) => [path, identity(item.info)]).sort(compare),
    });
    return Object.freeze({ records: Object.freeze(records), recordCount: records.length, counts,
      physicalIdentitySha256, inventorySha256: mailboxRotationDigest({ records, physicalIdentitySha256 }),
      localObservationOnly: true, executionAuthorized: false });
  }
  function reserve(command, { controlTowerObservation } = {}) {
      const record = { schemaVersion: SCHEMA, requestId: command.requestId, issueNumber: command.issueNumber,
        phase: 'RESERVED', commandDigest: mailboxRotationDigest(command) };
      if (controlTowerObservation !== undefined) {
        const observation = projectControlTowerRequestObservationV1(controlTowerObservation,
          { requestId: command.requestId, commandDigest: record.commandDigest });
        if (command.issueNumber !== 2315 || !observation || observation.state !== 'RESERVED'
          || CONTROL_TOWER_IDENTITY.filter(key => !['commandDigest', 'acceptedAtUtc'].includes(key))
            .some(key => observation[key] !== command[key]))
          throw new Error('MAILBOX_EXECUTION_CONTROL_TOWER_OBSERVATION_INVALID');
        record.controlTowerObservation = observation;
      }
      if (!insert(command.requestId, record)) throw new Error('MAILBOX_EXECUTION_REQUEST_ALREADY_SEEN');
      return record;
  }

  async function scanControlTower({ nowMs = Date.now(), batchSize = DISCOVERY_BATCH_SIZE,
      maxDurationMs = DISCOVERY_MAX_DURATION_MS, maxEntries } = {}, admission = null) {
      let latestBuildRequestObservation = null, latestControlSystemObservation = null, unresolved = null;
      let count = 0, batchWork = 0, reservationAttempted = false, admittedAt, clockSampledAt;
      const command = admission ? JSON.parse(JSON.stringify(admission.command)) : null;
      const success = () => {
        const observations = { ok: true, blocker: '',
          latestBuildRequestObservation: unresolved || latestBuildRequestObservation,
          latestControlSystemObservation };
        if (!admission) return Object.freeze(observations);
        if (unresolved) return Object.freeze({ ...observations,
          blocker: 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED', reservation: null, reservationAttempted: false });
        // The injected clock ran before closing verification. Account for the
        // uninterrupted closing time without invoking caller code again.
        const closingElapsedMs = Math.ceil(performance.now() - clockSampledAt);
        if (!Number.isFinite(admittedAt) || !Number.isFinite(closingElapsedMs)
          || closingElapsedMs < 0 || Date.parse(command.expiresAtUtc) <= admittedAt + closingElapsedMs)
          throw Error('CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED');
        const observation = createControlTowerRequestObservationV1(command, {
          commandDigest: mailboxRotationDigest(command), acceptedAtUtc: new Date(admittedAt).toISOString(), nowMs: admittedAt,
        });
        if (!observation) throw Error('CONTROL_TOWER_BUILD_REQUEST_OBSERVATION_INVALID');
        // This is the original create-once writer. No Promise or caller code may
        // run between the final verified read-set, refusal and this reservation.
        reservationAttempted = true;
        const reservation = reserve(command, { controlTowerObservation: observation });
        return Object.freeze({ ...observations, reservation, reservationAttempted: true });
      };
      const sourceBeforeClose = async () => {
        if (admission) {
          if (await admission.readSourceHead() !== command.sourceHead)
            throw Error('CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED');
          // All explicitly supplied callbacks finish before the final read-set
          // proof. Even a reentrant clock writer must be detected by that proof.
          admittedAt = admission.now();
          clockSampledAt = performance.now();
        }
      };
      const started = performance.now(), directories = new Map(), transcripts = new Map();
      const unproven = () => { throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN'); };
      const bound = () => { throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED'); };
      const budget = () => { if (performance.now() - started >= maxDurationMs) bound(); };
      const checkpoint = async () => {
        budget();
        if (++batchWork >= batchSize) { batchWork = 0; await yieldDiscovery(); budget(); }
      };
      // Precise identities keep the scan's retained memory independent of history.
      // These transcripts are ephemeral read-set checks, never an authority index.
      const identity = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.nlink]
        .map(value => { if (typeof value !== 'bigint') unproven(); return String(value); });
      const same = (left, right) => JSON.stringify(identity(left)) === JSON.stringify(identity(right));
      const inspectDirectory = path => {
        const info = lstatSync(path, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink()) unproven();
        const previous = directories.get(path);
        if (previous && !same(previous, info)) unproven();
        if (!previous) directories.set(path, info);
        return info;
      };
      const inspectEntry = path => {
        const info = lstatSync(path, { bigint: true });
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n
          || info.size < 1n || info.size > BigInt(ENTRY_MAX_BYTES)) unproven();
        return info;
      };
      const readEntry = (path, before) => {
        const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
          const opened = fstatSync(descriptor, { bigint: true });
          if (!same(before, opened)) unproven();
          const bytes = Buffer.alloc(ENTRY_MAX_BYTES + 1);
          const length = readSync(descriptor, bytes, 0, bytes.length, 0);
          if (BigInt(length) !== before.size || !same(before, fstatSync(descriptor, { bigint: true }))) unproven();
          const record = JSON.parse(bytes.subarray(0, length).toString('utf8'));
          if (typeof record?.requestId !== 'string' || location(record.requestId) !== path) unproven();
          return validateLedgerRecord(record, record.requestId);
        } finally { closeSync(descriptor); }
      };
      function* shardEntries(shard) {
        budget();
        const path = join(root, shard);
        inspectDirectory(path);
        const handle = opendirSync(path, { bufferSize: batchSize });
        try {
          let entry;
          while ((entry = handle.readSync())) {
            budget();
            if (!/^[a-f0-9]{64}\.json$/.test(entry.name) || entry.name.slice(0, 2) !== shard
              || !entry.isFile() || entry.isSymbolicLink()) unproven();
            const entryPath = join(path, entry.name);
            yield { name: entry.name, path: entryPath, before: inspectEntry(entryPath) };
          }
        } finally { handle.closeSync(); }
        inspectDirectory(path);
      }
      const scanShard = async shard => {
        const hash = createHash('sha256'); let entries = 0;
        for (const entry of shardEntries(shard)) {
          if (maxEntries !== undefined && ++count > maxEntries) bound();
          const record = readEntry(entry.path, entry.before);
          if (!same(entry.before, inspectEntry(entry.path))) unproven();
          if (/^control-tower-build-[1-9][0-9]{0,15}-1$/.test(record.requestId)) {
            const observed = observeControlTowerRecord(record, { nowMs });
            if (!observed) unproven();
            if (observed.operation === 'OBSERVE_CONTROL_SYSTEM')
              latestControlSystemObservation = latestObservation(latestControlSystemObservation, observed);
            else {
              latestBuildRequestObservation = latestObservation(latestBuildRequestObservation, observed);
              if (controlTowerBuildObservationUnresolvedV1(observed, { nowMs })
                && (!unresolved || observed.runId < unresolved.runId)) unresolved = observed;
            }
          }
          hash.update(JSON.stringify([entry.name, ...identity(entry.before)]) + '\n'); entries++;
          await checkpoint();
        }
        transcripts.set(join(root, shard), JSON.stringify([entries, hash.digest('hex')]));
      };
      // Closing verification deliberately has no asynchronous boundary. This
      // preserves the original synchronous read-set check while retaining only
      // fixed-size shard transcripts, rather than one object per historical row.
      const verifyShard = shard => {
        const hash = createHash('sha256'); let entries = 0;
        for (const entry of shardEntries(shard)) {
          hash.update(JSON.stringify([entry.name, ...identity(entry.before)]) + '\n'); entries++;
        }
        if (transcripts.get(join(root, shard)) !== JSON.stringify([entries, hash.digest('hex')])) unproven();
      };
      try {
        if (!Number.isFinite(nowMs) || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 4096
          || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > DISCOVERY_MAX_DURATION_MS
          || (maxEntries !== undefined && (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096)))
          unproven();
        if (admission && (command?.operation !== CONTROL_TOWER_BUILD_OPERATION || command.issueNumber !== 2315
          || typeof admission.readSourceHead !== 'function' || typeof admission.now !== 'function')) unproven();
        budget();
        let parent = root;
        while (!existsSync(parent)) parent = dirname(parent);
        directory(parent);
        if (!existsSync(root)) {
          if (!admission) return success();
          // A missing estate must not cross an await into a cached empty grant.
          inspectDirectory(parent);
          await sourceBeforeClose(); budget();
          inspectDirectory(parent);
          if (existsSync(root)) unproven();
          return success();
        }
        inspectDirectory(root);
        const shards = [], handle = opendirSync(root, { bufferSize: 256 });
        try {
          let entry;
          while ((entry = handle.readSync())) {
            if (shards.length >= 256 || !/^[a-f0-9]{2}$/.test(entry.name)
              || !entry.isDirectory() || entry.isSymbolicLink()) unproven();
            shards.push(entry.name);
          }
        } finally { handle.closeSync(); }
        inspectDirectory(root);
        shards.sort();
        for (const shard of shards) await scanShard(shard);
        // Drain queued in-process writers BEFORE the final uninterrupted proof.
        await yieldDiscovery(); budget();
        await sourceBeforeClose(); budget();
        // Admitted ledger writers use create-once insertion or atomic rename;
        // directory checks also catch those external writers after an early
        // file check. This remains an observation, not global serialization
        // against arbitrary actors bypassing the original ledger write API.
        for (const shard of shards) verifyShard(shard);
        directory(root);
        for (const path of directories.keys()) { budget(); inspectDirectory(path); }
        budget();
        return success();
      } catch (error) {
        return Object.freeze({ ok: false,
          blocker: reservationAttempted ? 'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN'
            : ['CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED', 'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED',
              'CONTROL_TOWER_BUILD_REQUEST_OBSERVATION_INVALID'].includes(error?.message)
              ? error.message : 'CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN',
          latestBuildRequestObservation: null, latestControlSystemObservation: null,
          ...(admission ? { reservation: null, reservationAttempted } : {}) });
      }
  }

  return Object.freeze({
    read,
    inventory,
    // A read-only diagnostic of this SAME ledger, never an admission/replay API.
    inspectControlTower(id, options) {
      return observeControlTowerRecord(read(id), options);
    },
    // Bounded read-only recovery from THIS ledger closes the reserve-to-status
    // crash window. It is not the proposed mailbox inventory/rotation API and
    // never admits, deletes, completes, freezes or releases a request.
    discoverControlTower(options) { return scanControlTower(options); },
    // Explicitly mutating BUILD admission, using the SAME original ledger.
    // Original consumer/source adapters remain trusted internal dependencies;
    // no caller-supplied command field grants execution or custody authority.
    discoverAndReserveControlTower(command, { readSourceHead, now = Date.now, ...options } = {}) {
      return scanControlTower(options, { command, readSourceHead, now });
    },
    retireLegacyControlTowerReservation({ request, nowMs = Date.now() } = {}) {
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || request.operation !== CONTROL_TOWER_BUILD_OPERATION
        || request.requestId !== 'control-tower-build-' + request.runId + '-1'
        || !Number.isSafeInteger(request.runId) || request.runId <= 0
        || typeof request.sourceHead !== 'string' || !/^[a-f0-9]{40}$/.test(request.sourceHead)
        || !Number.isFinite(nowMs) || !Number.isFinite(Date.parse(request.expiresAtUtc))
        || Date.parse(request.expiresAtUtc) > nowMs
        || ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed']
          .some(flag => request[flag] !== false))
        throw new Error('CONTROL_TOWER_LEGACY_RESERVATION_RETIREMENT_INVALID');
      const existing = read(request.requestId);
      const expectedDigest = mailboxRotationDigest({ ...request, issueNumber: 2315 });
      if (!existing || existing.issueNumber !== 2315 || existing.phase !== 'RESERVED'
        || existing.controlTowerObservation !== undefined || existing.terminalState !== undefined
        || existing.terminalProofHash !== undefined || existing.commandDigest !== expectedDigest)
        throw new Error('CONTROL_TOWER_LEGACY_RESERVATION_BINDING_UNPROVEN');
      atomicWriteJson(location(request.requestId), {
        ...existing, phase: 'TERMINAL', terminalState: 'BLOCKED',
      }, { maxBytes: 4096, space: 0 });
      return read(request.requestId);
    },
    has: id => Boolean(read(id)),
    reserve,
    importHistorical(requestId, issueNumber, phase) {
      if (!['TERMINAL', 'RETIRED', 'RESERVED'].includes(phase)) throw new Error('MAILBOX_EXECUTION_LEDGER_PHASE_INVALID');
      const existing = read(requestId);
      if (existing) return existing; // Never downgrade or rewrite an existing claim.
      insert(requestId, { schemaVersion: SCHEMA, requestId, issueNumber, phase, commandDigest: '' });
      return read(requestId);
    },
    complete(receipt) {
      if (!['DONE', 'BLOCKED'].includes(receipt?.state)) throw new Error('MAILBOX_EXECUTION_TERMINAL_REQUIRED');
      if (receipt.proofHash !== undefined && !/^[a-f0-9]{64}$/.test(receipt.proofHash))
        throw new Error('MAILBOX_EXECUTION_TERMINAL_PROOF_INVALID');
      const existing = read(receipt.requestId);
      if (!existing) return this.importHistorical(receipt.requestId, receipt.issueNumber, 'TERMINAL');
      if (existing.issueNumber !== receipt.issueNumber) throw new Error('MAILBOX_EXECUTION_LEDGER_EPOCH_CONFLICT');
      let observation;
      if (existing.controlTowerObservation !== undefined) {
        if (projectControlTowerLedgerObservationV1(existing)?.detailState !== 'OBSERVED')
          throw new Error('MAILBOX_EXECUTION_CONTROL_TOWER_TERMINAL_INVALID');
        const initial = projectControlTowerRequestObservationV1(existing.controlTowerObservation,
          { requestId: existing.requestId, commandDigest: existing.commandDigest });
        observation = projectControlTowerRequestObservationV1(receipt.controlTowerObservation,
          { requestId: existing.requestId, commandDigest: existing.commandDigest });
        if (!initial || !observation || !observationHashValid(initial) || !observationHashValid(observation)
          || !['WAKE_COMPLETED', 'WAKE_BLOCKED', 'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED'].includes(observation.state)
          || receipt.state !== (observation.state.endsWith('_COMPLETED') ? 'DONE' : 'BLOCKED')
          || CONTROL_TOWER_IDENTITY.some(key => observation[key] !== initial[key])
          || Date.parse(observation.observedAtUtc) < Date.parse(initial.observedAtUtc)
          || (observation.operation === 'OBSERVE_CONTROL_SYSTEM' && receipt.proofHash !== undefined)
          || (observation.state === 'WAKE_COMPLETED' && observation.wakeProofHash !== receipt.proofHash))
          throw new Error('MAILBOX_EXECUTION_CONTROL_TOWER_TERMINAL_INVALID');
        if (existing.phase === 'TERMINAL' && mailboxRotationDigest(observation) !== mailboxRotationDigest(initial))
          throw new Error('MAILBOX_EXECUTION_CONTROL_TOWER_TERMINAL_IMMUTABLE');
      } else if (receipt.controlTowerObservation !== undefined) {
        // A legacy reservation has no durable authenticated request metadata.
        // Never retrofit its original time/head from a new observation.
        throw new Error('MAILBOX_EXECUTION_CONTROL_TOWER_LEGACY_BINDING_UNPROVEN');
      }
      if (existing.phase === 'RESERVED') atomicWriteJson(location(receipt.requestId), {
        ...existing, phase: 'TERMINAL', terminalState: receipt.state,
        ...(receipt.proofHash === undefined ? {} : { terminalProofHash: receipt.proofHash }),
        ...(observation ? { controlTowerObservation: observation } : {}),
      }, { maxBytes: 4096, space: 0 });
      return read(receipt.requestId);
    },
  });
}
