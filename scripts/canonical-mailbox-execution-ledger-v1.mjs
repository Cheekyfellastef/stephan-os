import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { atomicWriteJson } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { MAILBOX_ROTATION_REQUEST_ID, mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
const SCHEMA = 'stephanos.mailbox-execution-ledger-entry.v1';
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
  return Object.freeze({
    read,
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
