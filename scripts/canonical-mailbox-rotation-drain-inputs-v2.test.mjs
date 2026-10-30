import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, readlinkSync,
  lstatSync, linkSync, symlinkSync, renameSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { MAILBOX_OUTBOX_LEDGER_SCHEMA, MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA,
  MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA, pendingReceiptPublicationDigest,
  resolveMailboxOutboxGuardLockPath, withMailboxOutboxGuardLock } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { withMailboxRotationTransactionTestJournalV2 as withJournal } from './canonical-mailbox-rotation-transaction-v2.mjs';
import { MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2 } from '../shared/agents/canonicalMailboxNativeEvidenceCodecV2.mjs';
import { formatMailboxRotationOwnerControlV2 } from '../shared/agents/canonicalMailboxRotationOwnerControlV2.mjs';
import { mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';

const FIELD = 'mailboxRotationControlTransactionV2';
const hash = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value) + '\n'); }
function descriptor() {
  const consent = { schemaVersion: MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2, repository: 'Cheekyfellastef/stephan-os',
    operatorApproval: 'operator-approved', transitionId: 'fixture-drain-inputs', rotationAction: 'FREEZE', state: 'PRE_MERGE',
    source: { protectedMainHead: 'a'.repeat(40), protectedMainTreeSha: 'b'.repeat(40), installedHead: 'a'.repeat(40),
      installedTreeSha: 'b'.repeat(40), installedClosureSha256: 'c'.repeat(64), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: 'd'.repeat(40), baseSha: 'a'.repeat(40), treeSha: 'e'.repeat(40), mergeCommitSha: null, mergeTreeSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: 100, inventorySha256: 'f'.repeat(64), commentCount: 2500 },
    preparation: { headSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), closureSha256: 'c'.repeat(64), originalFrozenArtifactSha256: null },
    expiresAtUtc: new Date(Date.now() + 300000).toISOString(), probeRequestIds: [] };
  return { consent, origin: { kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber: 3268, commentId: 123456,
    commentBodySha256: hash(formatMailboxRotationOwnerControlV2(consent)), createdAtUtc: new Date(Date.now() - 1000).toISOString() } };
}
function fixture(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'mailbox-drain-inputs-')), root = join(workspace, 'github-command-mailbox');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const state = join(root, 'state.json'), deferred = join(root, 'receipt-publication-deferred-v1.json');
  write(state, { acceptedRequestIds: [], pendingReceiptPublications: [], retained: 'original owner bytes' });
  write(deferred, { schemaVersion: MAILBOX_OUTBOX_LEDGER_SCHEMA, timestampUtc: new Date().toISOString(),
    storeId: '1234567890abcdef1234567890abcdef', headSequence: 0, nextSequence: 0, legacy: null });
  const estate = deferred + '.ledger-v3';
  mkdirSync(join(estate, 'index'), { recursive: true }); mkdirSync(join(estate, 'segments'));
  const run = (operation, fault) => withJournal(workspace, operation, fault ? { fault } : {});
  const journal = run(api => { const prepared = api.prepare(descriptor()); return api.reserve(prepared.journal.generationSha256).journal; });
  return { workspace, root, state, deferred, estate, run, journal,
    env: { ...process.env, STEPHANOS_SHARED_WORKSPACE_ROOT: workspace }, ledger: createMailboxExecutionLedger(root) };
}
function pending(requestId, state = 'DONE', issueNumber = 3149) {
  return { publicationId: requestId + ':' + state, receipt: { requestId, state, issueNumber,
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', operation: 'READ_DEPLOYMENT_STATUS' } };
}
function segmentPath(f, sequence) {
  return join(f.estate, 'segments', String(Math.floor(sequence / 1000)).padStart(13, '0'),
    'segment-' + String(sequence).padStart(16, '0') + '.json');
}
function indexPath(f, publicationId) { const digest = hash(publicationId); return join(f.estate, 'index', digest.slice(0, 2), digest + '.json'); }
function executionPath(f, requestId) { const digest = mailboxRotationDigest(requestId); return join(f.root, 'execution-ledger-v1', digest.slice(0, 2), digest + '.json'); }
function queue(f, entries) {
  const manifest = read(f.deferred); manifest.nextSequence = manifest.headSequence + entries.length; write(f.deferred, manifest);
  entries.forEach((entry, offset) => {
    const sequence = manifest.headSequence + offset, entryDigest = pendingReceiptPublicationDigest(entry);
    write(segmentPath(f, sequence), { schemaVersion: MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA,
      storeId: manifest.storeId, sequence, entryDigest, entry });
    write(indexPath(f, entry.publicationId), { schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
      publicationId: entry.publicationId, entryDigest, status: 'QUEUED', source: 'ledger-v3', sequence });
  });
}
function bytes(root) {
  const result = {};
  function visit(path, prefix = '') {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), key = prefix + name, info = lstatSync(child);
      if (info.isSymbolicLink()) result[key] = 'link:' + readlinkSync(child);
      else if (info.isDirectory()) { result[key] = 'directory'; visit(child, key + '/'); }
      else result[key] = hash(readFileSync(child));
    }
  }
  visit(root); return result;
}
function capture(f, fault) { return f.run(api => api.captureDrainInputs(api.inspect().journal.generationSha256), fault); }
function refusesUnchanged(f, pattern) {
  const before = bytes(f.root); assert.throws(() => capture(f), pattern); assert.deepEqual(bytes(f.root), before);
}
function denied(value) {
  assert.equal(value.storageOnly, true);
  for (const field of ['consentAuthenticated', 'nativeEvidenceAuthenticated', 'nativeExecutionAuthorized', 'freezeCertified',
    'protectedMergeAuthorized', 'sourceSyncAuthorized', 'epochAdoptionAuthorized', 'effectReplayAllowed']) assert.equal(value[field], false, field);
}

test('fixed original estate capture is immutable, read-only and still incomplete when every local debt count is zero', t => {
  const f = fixture(t), before = bytes(f.root), report = capture(f), result = report.drainInputCandidate;
  denied(report); denied(result); assert.equal(report.readOnly, true);
  assert.equal(result.localCaptureComplete, true); assert.equal(result.fullDrainProofComplete, false);
  assert.equal(result.counts.acceptedCount, 0); assert.equal(result.counts.segmentedPublicationCount, 0);
  assert.equal(result.counts.reservedCount, 1); assert.equal(result.counts.currentRotationReservationCount, 1);
  for (const field of ['ordinaryReceiptDebtCount', 'historyPendingBeforeCount', 'historyPendingAfterCount',
    'orphanAcceptedCount', 'actionPendingAggregateCount', 'actionBlockingCount']) assert.equal(result[field], null, field);
  for (const field of ['publicHistoryAuthenticated', 'actionsAuthenticated', 'installedSourceAuthenticated', 'nativeProducerQualified'])
    assert.equal(result[field], false, field);
  assert.equal(result.journalGenerationSha256, f.journal.generationSha256);
  assert.match(result.guardGenerationSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => { result.counts.reservedCount = 0; }, TypeError);
  assert.deepEqual(bytes(f.root), before);
});
test('inline head duplication, later segmented debt and every original reservation remain visible', t => {
  const f = fixture(t), first = pending('ordinary-command-one', 'ACCEPTED'), later = pending('ordinary-command-two');
  f.ledger.reserve({ requestId: first.receipt.requestId, issueNumber: 3149 });
  f.ledger.reserve({ requestId: 'unlisted-original-reservation', issueNumber: 3149 });
  const state = read(f.state); state.acceptedRequestIds = [first.receipt.requestId]; state.pendingReceiptPublications = [first]; write(f.state, state);
  queue(f, [first, later]); const before = bytes(f.root), result = capture(f).drainInputCandidate;
  assert.equal(result.counts.acceptedCount, 1); assert.equal(result.counts.inlinePublicationCount, 1);
  assert.equal(result.counts.segmentedPublicationCount, 2); assert.equal(result.counts.distinctPublicationCount, 2);
  assert.equal(result.counts.reservedCount, 3); assert.equal(result.counts.currentRotationReservationCount, 1);
  assert.equal(result.ordinaryReceiptDebtCount, null); denied(result); assert.deepEqual(bytes(f.root), before);
});
test('legacy tombstones and other epochs stay in the local ledger inventory without upgrades or exclusions', t => {
  const f = fixture(t); f.ledger.importHistorical('historical-terminal-one', 2808, 'TERMINAL');
  f.ledger.importHistorical('historical-retired-one', 2808, 'RETIRED'); f.ledger.importHistorical('historical-reserved-one', 3149, 'RESERVED');
  const before = bytes(f.root), report = capture(f).drainInputCandidate;
  assert.deepEqual([report.counts.reservedCount, report.counts.terminalCount, report.counts.retiredCount], [2, 1, 1]);
  assert.deepEqual(bytes(f.root), before);
});
test('stale journal generation and uncertain effect intent cannot produce drain inputs', t => {
  const f = fixture(t), before = bytes(f.root);
  assert.throws(() => f.run(api => api.captureDrainInputs('0'.repeat(64))), /GENERATION_CHANGED/);
  assert.deepEqual(bytes(f.root), before);
  f.run(api => api.beginLocalEffect(f.journal.generationSha256)); refusesUnchanged(f, /DRAIN_EFFECT_INTENT_UNCERTAIN/);
});
test('current control reservation must still exist with exact original binding', t => {
  const f = fixture(t), path = executionPath(f, f.journal.requestId), record = read(path);
  record.commandDigest = '9'.repeat(64); write(path, record); refusesUnchanged(f, /RESERVATION_MISMATCH/);
});
test('a divergent applied state cannot be hidden by an otherwise readable local debt estate', t => {
  const f = fixture(t);
  f.run(api => { const intent = api.beginLocalEffect(f.journal.generationSha256); api.commitLocalEffect(intent.effectToken); });
  const state = read(f.state); state.mailboxRotation.phase = 'FROZEN'; write(f.state, state);
  refusesUnchanged(f, /APPLIED_GENERATION_UNPROVEN/);
});
test('execution inventory itself never creates a missing store or infers it empty', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'mailbox-missing-execution-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  assert.throws(() => createMailboxExecutionLedger(workspace).inventory(), /ENOENT/);
  assert.deepEqual(readdirSync(workspace), []);
});
for (const field of ['acceptedRequestIds', 'pendingReceiptPublications']) test('missing ' + field + ' is not inferred empty', t => {
  const f = fixture(t), state = read(f.state); delete state[field]; write(f.state, state); refusesUnchanged(f, /STATE_INCOMPLETE/);
});
for (const target of ['state', 'deferred', 'estate', 'segments', 'index', 'execution']) test('missing ' + target + ' store refuses without creating or initializing it', t => {
  const f = fixture(t), path = target === 'segments' || target === 'index' ? join(f.estate, target)
    : target === 'execution' ? join(f.root, 'execution-ledger-v1') : f[target];
  rmSync(path, { recursive: true, force: true }); refusesUnchanged(f); assert.equal(existsSync(path), false);
});
for (const suffix of ['.transaction-v3.json', '.transaction-v3.json.tmp-fixture', '.tmp-fixture'])
  test('pending outbox intent ' + suffix + ' is retained without recovery', t => {
    const f = fixture(t); write(f.deferred + suffix, { retained: 'uncertain original write' }); refusesUnchanged(f, /RECOVERY_REQUIRED/);
  });
test('pending state write is retained without recovery', t => {
  const f = fixture(t); write(f.state + '.tmp-fixture', { retained: true }); refusesUnchanged(f, /RECOVERY_REQUIRED/);
});
test('legacy migration state remains held and is never migrated by capture', t => {
  const f = fixture(t), manifest = read(f.deferred);
  manifest.legacy = { kind: 'segmented-v2', activeSlot: 'a', generation: 'a'.repeat(32), segmentCount: 1,
    segmentIndex: 0, entryOffset: 0, remainingEntryCount: 1 };
  write(f.deferred, manifest); refusesUnchanged(f, /RECOVERY_REQUIRED/);
});
for (const target of ['state', 'deferred', 'segment', 'index', 'execution']) test('hard-linked ' + target + ' cannot enter the capture', t => {
  const f = fixture(t), entry = pending('ordinary-hardlink-one'); queue(f, [entry]);
  if (target === 'execution') f.ledger.importHistorical('unrelated-linked-terminal', 3149, 'TERMINAL');
  const path = target === 'segment' ? segmentPath(f, 0) : target === 'index' ? indexPath(f, entry.publicationId)
    : target === 'execution' ? executionPath(f, 'unrelated-linked-terminal') : f[target];
  linkSync(path, join(f.workspace, 'second-link')); refusesUnchanged(f, /LINKED|UNSAFE|RESERVATION/);
});
for (const target of ['segments', 'index', 'execution']) test('linked ' + target + ' parent cannot substitute another estate', t => {
  const f = fixture(t), path = target === 'execution' ? join(f.root, 'execution-ledger-v1') : join(f.estate, target);
  const moved = join(f.workspace, 'retained-original'); renameSync(path, moved); symlinkSync(moved, path, 'junction');
  refusesUnchanged(f, /DIRECTORY/);
});
test('a declared missing segment is incomplete, not a zero-debt observation', t => {
  const f = fixture(t), manifest = read(f.deferred); manifest.nextSequence = 1; write(f.deferred, manifest);
  refusesUnchanged(f, /SEGMENT_INVENTORY_INCOMPLETE/);
});
test('future segments outside the manifest are not silently ignored', t => {
  const f = fixture(t); queue(f, [pending('ordinary-future-one')]);
  const manifest = read(f.deferred); manifest.nextSequence = 0; write(f.deferred, manifest);
  refusesUnchanged(f, /SEGMENT_OUTSIDE_MANIFEST/);
});
test('an orphan QUEUED index cannot coexist with a supposedly empty manifest', t => {
  const f = fixture(t), entry = pending('ordinary-orphan-one');
  write(indexPath(f, entry.publicationId), { schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
    publicationId: entry.publicationId, entryDigest: pendingReceiptPublicationDigest(entry), status: 'QUEUED', source: 'ledger-v3', sequence: 0 });
  refusesUnchanged(f, /ORPHAN_QUEUED_INDEX/);
});
test('completed index history is retained and its actual hashed filename is checked', t => {
  const f = fixture(t), entry = pending('ordinary-completed-one'), path = indexPath(f, entry.publicationId);
  write(path, { schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA, publicationId: entry.publicationId,
    entryDigest: pendingReceiptPublicationDigest(entry), status: 'COMPLETED', source: 'ledger-v3', sequence: null });
  assert.equal(capture(f).drainInputCandidate.counts.segmentedPublicationCount, 0);
  renameSync(path, join(dirname(path), '0'.repeat(64) + '.json')); refusesUnchanged(f, /INDEX_PATH_INVALID/);
});
for (const field of ['requestId', 'state']) test('legacy receipt coercion of ' + field + ' is refused at the new capture boundary', t => {
  const f = fixture(t), state = read(f.state), entry = pending('ordinary-coercion-one');
  entry.receipt[field] = [entry.receipt[field]]; state.pendingReceiptPublications = [entry]; write(f.state, state);
  refusesUnchanged(f, /PUBLICATION_INVALID/);
});
test('legacy manifest and completed-index digest coercions are refused at the new boundary', t => {
  const f = fixture(t), manifest = read(f.deferred); manifest.storeId = [manifest.storeId]; write(f.deferred, manifest);
  refusesUnchanged(f, /MANIFEST_INVALID/);
  manifest.storeId = manifest.storeId[0]; write(f.deferred, manifest);
  const entry = pending('ordinary-index-coercion');
  write(indexPath(f, entry.publicationId), { schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
    publicationId: entry.publicationId, entryDigest: ['a'.repeat(64)], status: 'COMPLETED', source: 'ledger-v3', sequence: null });
  refusesUnchanged(f, /INDEX_INVALID/);
});
test('foreign publication epoch and accepted-without-original-ledger both refuse without altering debt', t => {
  const f = fixture(t); queue(f, [pending('ordinary-foreign-epoch', 'DONE', 3258)]); refusesUnchanged(f, /PUBLICATION_EPOCH_MISMATCH/);
  queue(f, [pending('ordinary-foreign-epoch')]); const state = read(f.state); state.acceptedRequestIds = ['missing-original-reservation']; write(f.state, state);
  refusesUnchanged(f, /ACCEPTED_LEDGER_UNPROVEN/);
});
for (const [name, mutate] of [
  ['request', r => { r.requestId = 'substituted-original-request'; }], ['epoch', r => { r.issueNumber = '3149'; }],
  ['phase', r => { r.phase = 'DONE'; }], ['nested-proof', r => { r.terminalProofHash = ['a'.repeat(64)]; }],
  ['unknown-field', r => { r.callerAuthority = true; }],
]) test('execution ledger inventory refuses ' + name + ' corruption in an unrelated original entry', t => {
  const f = fixture(t), id = 'historical-reviewed-terminal'; f.ledger.importHistorical(id, 3149, 'TERMINAL');
  const path = executionPath(f, id), record = read(path); record.terminalState = 'DONE'; mutate(record); write(path, record);
  refusesUnchanged(f, /INVENTORY_(ENTRY_INVALID|REQUEST_PATH_MISMATCH)/);
});
test('execution inventory refuses wrong hashed bucket and oversized entries', t => {
  const f = fixture(t), id = 'historical-size-terminal'; f.ledger.importHistorical(id, 3149, 'TERMINAL');
  const path = executionPath(f, id), wrongBucket = join(f.root, 'execution-ledger-v1', dirname(path).endsWith('00') ? '01' : '00');
  mkdirSync(wrongBucket, { recursive: true }); const moved = join(wrongBucket, path.split(/[\\/]/).at(-1)); renameSync(path, moved);
  refusesUnchanged(f, /REQUEST_PATH_MISMATCH/); renameSync(moved, path);
  writeFileSync(path, 'x'.repeat(4097)); refusesUnchanged(f, /ENTRY_UNSAFE/);
});
test('manifest cursor overflow is refused before reading a partial range', t => {
  const f = fixture(t), manifest = read(f.deferred); manifest.nextSequence = 501; write(f.deferred, manifest);
  refusesUnchanged(f, /INVENTORY_LIMIT/);
});
test('directory enumeration stops at its finite index-bucket limit', t => {
  const f = fixture(t);
  for (let i = 0; i < 257; i++) mkdirSync(join(f.estate, 'index', i.toString(16).padStart(2, '0')));
  refusesUnchanged(f, /INVENTORY_LIMIT/);
});
test('full execution inventory refuses overflow without returning a partial count', t => {
  const f = fixture(t);
  for (let i = 0; i < 8192; i++) {
    const requestId = 'historical-overflow-' + i;
    write(executionPath(f, requestId), { schemaVersion: 'stephanos.mailbox-execution-ledger-entry.v1', requestId,
      issueNumber: 2808, phase: 'RETIRED', commandDigest: '' });
  }
  refusesUnchanged(f, /INVENTORY_LIMIT/);
});
for (const target of ['state', 'manifest', 'other-reservation', 'same-bytes-new-file'])
  test('capture detects ' + target + ' movement and preserves the external writer bytes', t => {
    const f = fixture(t), requestId = 'other-concurrent-reservation'; f.ledger.reserve({ requestId, issueNumber: 3149 });
    let afterMutation;
    assert.throws(() => capture(f, event => {
      if (event !== 'after-drain-inputs-capture') return;
      if (target === 'state') { const state = read(f.state); state.retained = 'external state writer'; write(f.state, state); }
      if (target === 'manifest') { const manifest = read(f.deferred); manifest.storeId = '9'.repeat(32); write(f.deferred, manifest); }
      if (target === 'other-reservation') f.ledger.complete({ requestId, issueNumber: 3149, state: 'DONE' });
      if (target === 'same-bytes-new-file') {
        const payload = readFileSync(f.state), moved = join(f.workspace, 'old-state'); renameSync(f.state, moved); writeFileSync(f.state, payload);
      }
      afterMutation = bytes(f.root);
      delete afterMutation['receipt-publication-deferred-v1.json.lock-v1.json'];
    }), /DRAIN_(INVENTORY_CHANGED|STATE_CHANGED)|STATE_CHANGED/);
    assert.deepEqual(bytes(f.root), afterMutation);
  });
test('guard snapshot closure expires after normal and thenable callbacks and accepts no caller arguments', t => {
  const f = fixture(t); let retained;
  withMailboxOutboxGuardLock((_lock, snapshot) => {
    retained = snapshot; const local = snapshot(); assert.match(local.inventorySha256, /^[a-f0-9]{64}$/);
    assert.equal(local.storageOnly, true); assert.equal(local.freezeCertified, false); assert.equal(local.fullDrainProofComplete, false);
    assert.throws(() => snapshot({ path: '/caller-choice' }), /ARGUMENTS_NOT_ALLOWED/);
  }, { env: f.env });
  assert.throws(() => retained(), /SESSION_CLOSED/);
  assert.throws(() => withMailboxOutboxGuardLock((_lock, snapshot) => { retained = snapshot; return Promise.resolve(); }, { env: f.env }), /SYNCHRONOUS_OPERATION_REQUIRED/);
  assert.throws(() => retained(), /SESSION_CLOSED/);
});
test('lost original guard refuses capture and does not remove a foreign replacement lock', t => {
  const f = fixture(t), lockPath = resolveMailboxOutboxGuardLockPath({ env: f.env });
  assert.throws(() => withMailboxOutboxGuardLock((_lock, snapshot) => {
    const lock = read(lockPath); lock.token = '0'.repeat(32); write(lockPath, lock);
    assert.throws(() => snapshot(), /LOCK_LOST/);
  }, { env: f.env }), /LOCK_LOST/);
  assert.equal(read(lockPath).token, '0'.repeat(32));
});
