import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { atomicWriteJson, readJsonObject } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { MAILBOX_ROTATION_REQUEST_ID, mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
const SCHEMA = 'stephanos.mailbox-execution-ledger-entry.v1';
const INVENTORY_MAX_ENTRIES = 8192;
const ENTRY_MAX_BYTES = 4096;
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
        const allowed = [...required, 'terminalState', 'terminalProofHash'];
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
        if (path !== location(record.requestId)) deny('REQUEST_PATH_MISMATCH');
        const after = lstatSync(path);
        if (!stable(before, after) || after.nlink !== 1) deny('ENTRY_CHANGED');
        files.set(path, { info: before, digest: mailboxRotationDigest(record) });
        records.push(Object.freeze(record));
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
    has: id => Boolean(read(id)),
    reserve(command) {
      const record = { schemaVersion: SCHEMA, requestId: command.requestId, issueNumber: command.issueNumber,
        phase: 'RESERVED', commandDigest: mailboxRotationDigest(command) };
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
      if (existing.phase === 'RESERVED') atomicWriteJson(location(receipt.requestId), {
        ...existing, phase: 'TERMINAL', terminalState: receipt.state,
        ...(receipt.proofHash === undefined ? {} : { terminalProofHash: receipt.proofHash }),
      }, { maxBytes: 4096 });
      return read(receipt.requestId);
    },
  });
}
