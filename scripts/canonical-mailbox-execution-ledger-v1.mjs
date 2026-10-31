import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, readJsonObject } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { MAILBOX_ROTATION_REQUEST_ID, mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { projectControlTowerRequestObservationV1, projectControlTowerLedgerObservationV1,
  controlTowerBuildObservationUnresolvedV1 } from '../shared/agents/controlTowerRequestObservationV1.mjs';
const SCHEMA = 'stephanos.mailbox-execution-ledger-entry.v1';
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
  return Object.freeze({
    read,
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
