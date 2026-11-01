import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, readJsonObject } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { MAILBOX_ROTATION_REQUEST_ID, mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { projectControlTowerRequestObservationV1, projectControlTowerLedgerObservationV1,
  controlTowerBuildObservationUnresolvedV1 } from '../shared/agents/controlTowerRequestObservationV1.mjs';
import { CONTROL_TOWER_BUILD_OPERATION } from '../shared/agents/controlTowerBuildRequestV1.mjs';
const SCHEMA = 'stephanos.mailbox-execution-ledger-entry.v1';
const INVENTORY_MAX_ENTRIES = 8192;
const ENTRY_MAX_BYTES = 4096;
const CONTROL_TOWER_IDENTITY = ['requestId', 'runId', 'runAttempt', 'operation', 'sourceHead',
  'artifactId', 'artifactSha256', 'commandDigest', 'createdAtUtc', 'expiresAtUtc', 'acceptedAtUtc'];
const observationHashValid = observation => !observation?.controlSystemStatus
  || observation.observationProofHash === createHash('sha256')
    .update(JSON.stringify(observation.controlSystemStatus)).digest('hex');
const sameIdentity = (before, after) => before.dev === after.dev && before.ino === after.ino
  && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.size === after.size;
const latestObservation = (left, right) => !left || (Date.parse(right.acceptedAtUtc) || 0) > (Date.parse(left.acceptedAtUtc) || 0)
  || (right.acceptedAtUtc === left.acceptedAtUtc && right.runId > left.runId) ? right : left;
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
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs
      || record.schemaVersion !== SCHEMA || record.requestId !== id
      || !['RESERVED', 'TERMINAL', 'RETIRED'].includes(record.phase)
      || !Number.isSafeInteger(record.issueNumber) || record.issueNumber <= 0) throw new Error('MAILBOX_EXECUTION_LEDGER_ENTRY_INVALID');
    return record;
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
  return Object.freeze({
    read,
    inventory,
    // A read-only diagnostic of this SAME ledger, never an admission/replay API.
    inspectControlTower(id, options) {
      const record = read(id);
      const observed = projectControlTowerLedgerObservationV1(record, options);
      if (observed?.detailState === 'OBSERVED' && !observationHashValid(observed))
        return projectControlTowerLedgerObservationV1({ ...record, controlTowerObservation: {} }, options);
      return observed;
    },
    // Bounded read-only recovery from THIS ledger closes the reserve-to-status
    // crash window. It is not the proposed mailbox inventory/rotation API and
    // never admits, deletes, completes, freezes or releases a request.
    discoverControlTower({ nowMs = Date.now(), maxEntries = 4096 } = {}) {
      let latestBuildRequestObservation = null, latestControlSystemObservation = null, unresolved = null;
      let count = 0;
      const identities = [];
      const scanNames = (path, max, visit) => {
        directory(path);
        const before = lstatSync(path), handle = opendirSync(path);
        let seen = 0;
        try {
          let entry;
          while ((entry = handle.readSync())) {
            if (++seen > max) throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED');
            visit(entry);
          }
        } finally { handle.closeSync(); }
        const after = lstatSync(path);
        if (!sameIdentity(before, after) || after.isSymbolicLink() || !after.isDirectory())
          throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
        identities.push([path, after]);
      };
      try {
        if (!Number.isFinite(nowMs) || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096)
          throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
        let parent = root;
        while (!existsSync(parent)) parent = dirname(parent);
        directory(parent);
        if (!existsSync(root)) return Object.freeze({ ok: true, blocker: '',
          latestBuildRequestObservation: null, latestControlSystemObservation: null });
        scanNames(root, 256, shard => {
          if (!/^[a-f0-9]{2}$/.test(shard.name) || !shard.isDirectory() || shard.isSymbolicLink())
            throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
          scanNames(join(root, shard.name), maxEntries, entry => {
            if (++count > maxEntries) throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED');
            if (!/^[a-f0-9]{64}\.json$/.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()
              || entry.name.slice(0, 2) !== shard.name) throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
            const path = join(root, shard.name, entry.name), before = lstatSync(path);
            const identity = readJsonObject(path, { maxBytes: 4096 });
            if (typeof identity.requestId !== 'string' || location(identity.requestId) !== path)
              throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
            const record = read(identity.requestId), after = lstatSync(path);
            if (!sameIdentity(before, after) || mailboxRotationDigest(identity) !== mailboxRotationDigest(record))
              throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
            identities.push([path, after]);
            if (!/^control-tower-build-[1-9][0-9]{0,15}-1$/.test(record.requestId)) return;
            const observed = this.inspectControlTower(record.requestId, { nowMs });
            if (!observed) throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
            if (observed.operation === 'OBSERVE_CONTROL_SYSTEM')
              latestControlSystemObservation = latestObservation(latestControlSystemObservation, observed);
            else {
              latestBuildRequestObservation = latestObservation(latestBuildRequestObservation, observed);
              if (controlTowerBuildObservationUnresolvedV1(observed, { nowMs })
                && (!unresolved || observed.runId < unresolved.runId)) unresolved = observed;
            }
          });
        });
        // A terminal rename, substituted directory or concurrent new reservation
        // invalidates the snapshot. The next existing relay poll may retry it.
        for (const [path, before] of identities) if (!sameIdentity(before, lstatSync(path)))
          throw new Error('CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
        return Object.freeze({ ok: true, blocker: '',
          latestBuildRequestObservation: unresolved || latestBuildRequestObservation,
          latestControlSystemObservation });
      } catch (error) {
        return Object.freeze({ ok: false,
          blocker: error?.message === 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED'
            ? error.message : 'CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN',
          latestBuildRequestObservation: null, latestControlSystemObservation: null });
      }
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
    reserve(command, { controlTowerObservation } = {}) {
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
    },
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
