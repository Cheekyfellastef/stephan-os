import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CANONICAL_MAILBOX_ISSUE } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import {
  buildBattleBridgeGitHubCommandReceipt,
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';
import {
  checkpointAcceptedMailboxReceipt,
  checkpointMailboxReceiptPublication,
  createSanitizedMailboxReceiptProjection,
  flushMailboxReceiptPublicationOutbox,
  serializeBoundedReceiptJson,
} from './battle-bridge-github-command-mailbox.mjs';
import { reconcileStaleAcceptedMailboxReceipts } from './battle-bridge-github-command-mailbox-with-receipt-index.mjs';

import {
  atomicWriteJson,
  MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
  MAILBOX_OUTBOX_DEFERRED_SCHEMA,
  MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA,
  MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
  MAILBOX_OUTBOX_LEDGER_SCHEMA,
  MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA,
  MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE,
  MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
  normalizePendingReceiptPublications,
  parseMailboxChildStatus,
  projectMailboxGuardDiagnosticV1,
  pendingReceiptPublicationDigest,
  readJsonObject,
  runMailboxOutboxGuard,
  verifyMailboxOutboxGuardLease,
} from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';

const identityTestNow = new Date('2026-11-06T12:00:00.000Z');

function receiptIdentityCommand(requestId) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId,
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: '1'.repeat(40),
    expiresAt: '2026-11-06T12:10:00.000Z',
    remoteAction: 'status',
  };
}

test('admitted session request identity survives compact receipt and deferred publication', () => {
  const requestId = 'fixture-single-session-receipt-v1';
  const admitted = validateBattleBridgeGitHubCommand(receiptIdentityCommand(requestId), {
    authorLogin: 'Cheekyfellastef',
    now: identityTestNow,
  });
  assert.equal(admitted.ok, true, admitted.blocker);
  const completedAt = identityTestNow.toISOString();
  const receipt = buildBattleBridgeGitHubCommandReceipt({
    command: admitted.command,
    state: 'DONE',
    completedAt,
    blocker: 'fixture-single-session-text',
    result: {
      ok: true,
      requestId: 'fixture-session-token-marker',
      privatePayload: 'x'.repeat(9_000),
    },
  });
  const publicReceipt = JSON.parse(serializeBoundedReceiptJson(receipt, 6_000));
  const compactFallback = JSON.parse(serializeBoundedReceiptJson(receipt, 3_000));
  assert.equal(publicReceipt.githubProjectionTruncated, true);
  const sanitized = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(publicReceipt.requestId, requestId);
  assert.equal(publicReceipt.result.requestId, requestId);
  assert.equal(compactFallback.requestId, requestId);
  assert.equal(compactFallback.result.requestId, requestId);
  assert.equal(publicReceipt.blocker, '');
  assert.equal(sanitized.requestId, requestId);
  assert.equal(sanitized.execution.requestId, requestId);
  assert.equal(sanitized.blocker, '');

  const state = { pendingReceiptPublications: [] };
  let checkpointed;
  checkpointMailboxReceiptPublication(state, receipt, { ok: false }, {
    persist: (snapshot) => { checkpointed = structuredClone(snapshot); },
  });
  const queue = normalizePendingReceiptPublications(checkpointed.pendingReceiptPublications);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].publicationId, `${requestId}:DONE:${completedAt}`);
  assert.equal(queue[0].receipt.requestId, requestId);
});

test('credential-shaped IDs cannot enter execution or deferred rejection receipts', () => {
  const unsafeIds = [
    'fixture-session-token-marker',
    'fixture-secret-marker-v1',
    'fixture-cookie-marker-v1',
    'fixture-ghp-placeholder012345',
    'ghp-session-x',
    'sk-session-x',
    'github_pat-session-x',
  ];
  for (const requestId of unsafeIds) {
    const command = receiptIdentityCommand(requestId);
    const validation = validateBattleBridgeGitHubCommand(command, {
      authorLogin: 'Cheekyfellastef',
      now: identityTestNow,
    });
    assert.equal(validation.blocker, 'COMMAND_REQUEST_ID_PUBLICATION_UNSAFE');
    const rejectedBatch = selectBattleBridgeGitHubCommandBatch([{
      id: 1,
      user: { login: 'Cheekyfellastef' },
      created_at: identityTestNow.toISOString(),
      body: '\`\`\`stephanos-battle-bridge-command\n'
        + JSON.stringify({ ...command, remoteAction: 'unsupported-fixture-action' }) + '\n\`\`\`',
    }], { now: identityTestNow });
    assert.equal(rejectedBatch.ok, true);
    assert.equal(rejectedBatch.commands.length, 0);
    assert.equal(rejectedBatch.terminalRejections.length, 0);
    assert.equal(rejectedBatch.rejected[0].blocker, 'COMMAND_REQUEST_ID_PUBLICATION_UNSAFE');
    const receipt = buildBattleBridgeGitHubCommandReceipt({ command, state: 'BLOCKED' });
    assert.equal(JSON.parse(serializeBoundedReceiptJson(receipt)).requestId, '');
    assert.equal(JSON.parse(serializeBoundedReceiptJson(receipt, 3_000)).result.requestId, '');
    assert.equal(createSanitizedMailboxReceiptProjection(receipt).execution.requestId, '');
    const state = { pendingReceiptPublications: [] };
    assert.throws(() => checkpointMailboxReceiptPublication(state, receipt, { ok: false }, {
      persist: () => assert.fail('invalid publication must not persist'),
    }), /MAILBOX_RECEIPT_PUBLICATION_IDENTITY_UNSAFE/);
    assert.deepEqual(state.pendingReceiptPublications, []);
    assert.throws(() => checkpointAcceptedMailboxReceipt(state, { ...receipt, state: 'ACCEPTED' }, {
      persist: () => assert.fail('unsafe accepted identity must not persist'),
    }), /MAILBOX_ACCEPTED_CHECKPOINT_INVALID/);
  }
});

test('publication holds an unsafe legacy queue before publishing or removing any entry', () => {
  const state = { pendingReceiptPublications: [pending('fixture-single-flight-v1'), pending('ghp-session-x')] };
  const before = structuredClone(state);
  assert.throws(() => flushMailboxReceiptPublicationOutbox(state, {
    publish: () => assert.fail('unsafe queue must not publish'),
    persist: () => assert.fail('unsafe queue must not persist'),
  }), /MAILBOX_PENDING_RECEIPT_IDENTITY_UNSAFE/);
  assert.deepEqual(state, before);
});

test('accepted recovery retains a historical unsafe identity before writing any receipt', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const state = {
    acceptedRequestIds: ['fixture-session-token-marker'],
    consumedRequestIds: [],
    pendingReceiptPublications: [],
  };
  writeJson(f.statePath, state);
  const before = readFileSync(f.statePath);
  const result = reconcileStaleAcceptedMailboxReceipts({
    env: { STEPHANOS_SHARED_WORKSPACE_ROOT: dirname(dirname(f.statePath)) },
    workspaceRoot: join(f.root, 'canonical-receipts'),
    now: () => identityTestNow,
  });
  assert.equal(result.blocker, 'MAILBOX_ACCEPTED_RECEIPT_IDENTITY_UNSAFE');
  assert.equal(result.reconciledCount, 0);
  assert.deepEqual(readFileSync(f.statePath), before);
  assert.deepEqual(readdirSync(dirname(f.statePath)), ['state.json']);
});

test('stale accepted recovery preserves the admitted ID through reload and a single publication', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const requestId = 'fixture-single-session-accepted-v1';
  const admitted = validateBattleBridgeGitHubCommand(receiptIdentityCommand(requestId), {
    authorLogin: 'Cheekyfellastef',
    now: identityTestNow,
  });
  assert.equal(admitted.ok, true);
  const accepted = buildBattleBridgeGitHubCommandReceipt({
    command: admitted.command,
    state: 'ACCEPTED',
    acceptedAt: identityTestNow.toISOString(),
    heartbeatAt: identityTestNow.toISOString(),
  });
  checkpointAcceptedMailboxReceipt({}, accepted, { persist: (state) => writeJson(f.statePath, state) });
  assert.equal(readJson(f.statePath).lastAcceptedReceipt.requestId, requestId);

  const recovery = reconcileStaleAcceptedMailboxReceipts({
    env: { STEPHANOS_SHARED_WORKSPACE_ROOT: dirname(dirname(f.statePath)) },
    workspaceRoot: join(f.root, 'canonical-receipts'),
    now: () => new Date('2026-11-06T12:30:00.000Z'),
  });
  assert.equal(recovery.expiredCount, 1);
  assert.equal(recovery.replayPerformed, false);
  const recoveredState = readJson(f.statePath);
  assert.deepEqual(recoveredState.acceptedRequestIds, []);
  assert.deepEqual(recoveredState.consumedRequestIds, [requestId]);
  const [entry] = normalizePendingReceiptPublications(recoveredState.pendingReceiptPublications);
  assert.equal(entry.receipt.requestId, requestId);
  assert.equal(entry.receipt.result.requestId, requestId);
  let calls = 0;
  const result = flushMailboxReceiptPublicationOutbox(recoveredState, {
    publish: (receipt) => {
      calls += 1;
      assert.equal(JSON.parse(serializeBoundedReceiptJson(receipt)).requestId, requestId);
      return { ok: true };
    },
    persist: (state) => writeJson(f.statePath, state),
  });
  assert.equal(calls, 1);
  assert.equal(result.publishedCount, 1);
  assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, []);
});

function pending(id, state = 'BLOCKED', extra = {}) {
  return {
    publicationId: `${id}:${state}:2026-08-19T19:00:00.000Z`,
    receipt: {
      schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
      requestId: id,
      operation: 'READ_DEPLOYMENT_STATUS',
      state,
      ...extra,
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-mailbox-ledger-'));
  const stateRoot = join(root, 'workspace', 'github-command-mailbox');
  mkdirSync(stateRoot, { recursive: true });
  const statePath = join(stateRoot, 'state.json');
  const deferredPath = join(stateRoot, 'receipt-publication-deferred-v1.json');
  const childRunnerPath = join(root, 'child.mjs');
  writeFileSync(childRunnerPath, 'process.exitCode = 0;\n', 'utf8');
  return {
    root,
    statePath,
    deferredPath,
    childRunnerPath,
    paths: {
      actualRepoRoot: root,
      expectedRepoRoot: root,
      statePath,
      deferredPath,
      childRunnerPath,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function sequenceText(sequence) {
  return String(sequence).padStart(16, '0');
}

function ledgerSegmentPath(deferredPath, sequence) {
  return join(
    `${deferredPath}.ledger-v3`,
    'segments',
    String(Math.floor(sequence / 1000)).padStart(13, '0'),
    `segment-${sequenceText(sequence)}.json`,
  );
}

function ledgerIndexPath(deferredPath, publicationId) {
  const digest = createHash('sha256').update(publicationId, 'utf8').digest('hex');
  return join(`${deferredPath}.ledger-v3`, 'index', digest.slice(0, 2), `${digest}.json`);
}

function activeLedgerEntries(deferredPath) {
  const manifest = readJson(deferredPath);
  assert.equal(manifest.schemaVersion, MAILBOX_OUTBOX_LEDGER_SCHEMA);
  const entries = [];
  for (let sequence = manifest.headSequence; sequence < manifest.nextSequence; sequence += 1) {
    entries.push(readJson(ledgerSegmentPath(deferredPath, sequence)).entry);
  }
  return entries;
}

function activeLedgerIds(deferredPath) {
  return activeLedgerEntries(deferredPath).map((entry) => entry.receipt.requestId);
}

function runGuard(f, options = {}) {
  return runMailboxOutboxGuard({
    platform: 'win32',
    repoRoot: f.root,
    pathOverrides: f.paths,
    processIdentityFn: (pid) => pid === process.pid
      ? { state: 'known', bootId: 'test-boot-current', processStartId: 'test-process-current' }
      : { state: 'dead' },
    ...options,
  });
}

test('typed guard diagnostics distinguish untouched invalid debt before and after child invocation', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const now = () => new Date('2026-11-07T15:20:00.000Z');
  const invalid = { publicationId: 'fixture-original-publication', receipt: { requestId: '', state: 'DONE' } };
  writeJson(f.statePath, { acceptedRequestIds: [], consumedRequestIds: [], pendingReceiptPublications: [invalid] });
  const before = readFileSync(f.statePath);
  let invoked = 0;
  const denied = runGuard(f, { now, spawnSyncFn: () => { invoked++; throw Error('unexpected child'); } });
  assert.equal(invoked, 0);
  assert.equal(denied.blocker, 'MAILBOX_OUTBOX_GUARD_FAILED');
  assert.equal(denied.guardDiagnostic.reasonCode, 'MAILBOX_OUTBOX_PENDING_ENTRY_INVALID');
  assert.equal(denied.guardDiagnostic.stage, 'STATE_VALIDATION');
  assert.equal(denied.guardDiagnostic.outcome, 'GUARD_BLOCKED');
  assert.equal(denied.guardDiagnostic.childInvocationAttempted, false);
  assert.equal(denied.guardDiagnostic.observedAtUtc, now().toISOString());
  assert.deepEqual(readFileSync(f.statePath), before);
  assert.equal(existsSync(f.deferredPath), false);
  assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), false);
  writeJson(f.statePath, { acceptedRequestIds: [], consumedRequestIds: [], pendingReceiptPublications: [] });
  let postChildBytes;
  const after = runGuard(f, { now, spawnSyncFn: () => {
    invoked++;
    writeJson(f.statePath, { acceptedRequestIds: [], consumedRequestIds: [], pendingReceiptPublications: [invalid] });
    postChildBytes = readFileSync(f.statePath);
    return { status: 0, stdout: '{}', stderr: '' };
  } });
  assert.equal(invoked, 1);
  assert.equal(after.guardDiagnostic.reasonCode, 'MAILBOX_OUTBOX_PENDING_ENTRY_INVALID');
  assert.equal(after.guardDiagnostic.stage, 'POST_CHILD_VALIDATION');
  assert.equal(after.guardDiagnostic.childInvocationAttempted, true);
  assert.deepEqual(readFileSync(f.statePath), postChildBytes);
});

test('typed guard diagnostics preserve single-flight busy and disclose no unknown error text', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const now = () => new Date('2026-11-07T15:20:00.000Z');
  writeJson(f.statePath, { pendingReceiptPublications: [] });
  let nested;
  const completed = runGuard(f, { now, spawnSyncFn: () => {
    nested = runGuard(f, { now, spawnSyncFn: () => { throw Error('overlapping child'); } });
    return { status: 0, stdout: '{}', stderr: '' };
  } });
  assert.equal(completed.ok, true);
  assert.equal(completed.guardDiagnostic.outcome, 'CHILD_SUCCEEDED');
  assert.equal(completed.guardDiagnostic.reasonCode, 'NONE');
  assert.equal(completed.guardDiagnostic.childInvocationAttempted, true);
  assert.equal(nested.ok, false);
  assert.equal(nested.guardDiagnostic.outcome, 'GUARD_BUSY');
  assert.equal(nested.guardDiagnostic.stage, 'LOCK');
  assert.equal(nested.guardDiagnostic.reasonCode, 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING');
  assert.equal(nested.guardDiagnostic.childInvocationAttempted, false);
  const secret = 'private-token=fixture C:\\private\\fixture.json';
  const unknown = runGuard(f, { now, spawnSyncFn: () => { throw Error(secret); } });
  assert.equal(unknown.guardDiagnostic.stage, 'CHILD_INVOCATION');
  assert.equal(unknown.guardDiagnostic.reasonCode, 'MAILBOX_GUARD_FAILURE_UNCLASSIFIED');
  assert.equal(unknown.guardDiagnostic.childInvocationAttempted, true);
  assert.equal(JSON.stringify(unknown.guardDiagnostic).includes('private-token=fixture'), false);
});

test('guard diagnostic projection rejects open fields, accessors and inconsistent execution stages', () => {
  const valid = { schemaVersion: 'stephanos.mailbox-guard-diagnostic.v1',
    observedAtUtc: '2026-11-07T15:20:00.000Z', stage: 'STATE_VALIDATION',
    outcome: 'GUARD_BLOCKED', reasonCode: 'MAILBOX_OUTBOX_PENDING_ENTRY_INVALID', childInvocationAttempted: false };
  assert.deepEqual(projectMailboxGuardDiagnosticV1(valid), valid);
  for (const value of [null, [], { ...valid, requestId: 'private-request' },
    { ...valid, reasonCode: 'PRIVATE_SECRET_VALUE' }, { ...valid, stage: 'INVENTED' },
    { ...valid, outcome: 'CHILD_SUCCEEDED' }, { ...valid, childInvocationAttempted: true },
    { ...valid, observedAtUtc: 'not-a-date' }, { ...valid, reasonCode: 'NONE' },
    { ...valid, outcome: 'GUARD_BUSY' }, Object.assign(Object.create({ private: true }), valid)]) {
    assert.equal(projectMailboxGuardDiagnosticV1(value), null);
  }
  let reads = 0;
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'reasonCode', { enumerable: true, get() { reads++; return valid.reasonCode; } });
  assert.equal(projectMailboxGuardDiagnosticV1(accessor), null);
  assert.equal(reads, 0);
});

function writeLedgerFixture(f, entries, { headSequence = 0, storeId = '0123456789abcdef0123456789abcdef' } = {}) {
  const manifest = {
    schemaVersion: MAILBOX_OUTBOX_LEDGER_SCHEMA,
    timestampUtc: '2026-08-19T19:00:00.000Z',
    storeId,
    headSequence,
    nextSequence: headSequence + entries.length,
    legacy: null,
  };
  writeJson(f.deferredPath, manifest);
  entries.forEach((entry, offset) => {
    const sequence = headSequence + offset;
    const entryDigest = pendingReceiptPublicationDigest(entry);
    writeJson(ledgerSegmentPath(f.deferredPath, sequence), {
      schemaVersion: MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA,
      storeId,
      sequence,
      entryDigest,
      entry,
    });
    writeJson(ledgerIndexPath(f.deferredPath, entry.publicationId), {
      schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
      publicationId: entry.publicationId,
      entryDigest,
      status: 'QUEUED',
      source: 'ledger-v3',
      sequence,
    });
  });
}

test('one-attempt contract and canonical normalization reject conflicting publication identities', () => {
  const a = pending('mailbox-outbox-a');
  assert.equal(MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE, 1);
  assert.equal(normalizePendingReceiptPublications([a, structuredClone(a)]).length, 1);

  const semanticallyIdentical = {
    receipt: { state: 'BLOCKED', operation: 'READ_DEPLOYMENT_STATUS', requestId: 'mailbox-outbox-a', schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1' },
    publicationId: a.publicationId,
  };
  assert.equal(normalizePendingReceiptPublications([a, semanticallyIdentical]).length, 1);
  assert.throws(
    () => normalizePendingReceiptPublications([a, { ...a, receipt: { ...a.receipt, blocker: 'DIFFERENT_AUTHORITY' } }]),
    /MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT/,
  );
});

test('guard exposes one head, then incrementally rotates it behind old and newly-created debt', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [
      pending('mailbox-outbox-a'),
      pending('mailbox-outbox-b'),
      pending('mailbox-outbox-c'),
    ] });
    let childObserved = null;
    const result = runGuard(f, {
      spawnSyncFn: () => {
        const state = readJson(f.statePath);
        childObserved = state.pendingReceiptPublications.map((entry) => entry.receipt.requestId);
        state.pendingReceiptPublications.push(pending('mailbox-outbox-new'));
        writeJson(f.statePath, state);
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(childObserved, ['mailbox-outbox-a']);
    assert.equal(result.attemptedPublicationCount, 1);
    assert.equal(result.deferredPublicationCountBeforeChild, 2);
    assert.equal(result.pendingPublicationCountAfterChild, 4);
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, []);
    assert.deepEqual(activeLedgerIds(f.deferredPath), [
      'mailbox-outbox-b',
      'mailbox-outbox-c',
      'mailbox-outbox-a',
      'mailbox-outbox-new',
    ]);
    assert.equal(result.preIngressIo.segmentReads, 1);
    assert.equal(result.preIngressIo.segmentWrites, 3);
  } finally {
    f.cleanup();
  }
});

test('present non-array canonical debt blocks before child and post-child malformed debt remains untouched', () => {
  const before = fixture();
  try {
    const state = { pendingReceiptPublications: { opaque: 'authority' } };
    writeJson(before.statePath, state);
    let childCalled = false;
    const result = runGuard(before, { spawnSyncFn: () => { childCalled = true; return { status: 0 }; } });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_CANONICAL_PENDING_ARRAY_REQUIRED/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(before.statePath), state);
    assert.equal(existsSync(before.deferredPath), false);
  } finally {
    before.cleanup();
  }

  const after = fixture();
  try {
    writeJson(after.statePath, { pendingReceiptPublications: [pending('mailbox-post-a'), pending('mailbox-post-b')] });
    const malformed = { opaqueAuthorityDebt: ['must', 'remain'] };
    const result = runGuard(after, {
      spawnSyncFn: () => {
        const state = readJson(after.statePath);
        state.pendingReceiptPublications = malformed;
        writeJson(after.statePath, state);
        return { status: 0 };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_CANONICAL_PENDING_ARRAY_REQUIRED/);
    assert.deepEqual(readJson(after.statePath).pendingReceiptPublications, malformed);
    assert.deepEqual(activeLedgerIds(after.deferredPath), ['mailbox-post-a', 'mailbox-post-b']);
  } finally {
    after.cleanup();
  }
});

test('bounded transaction journal completes after a simulated crash without debt loss', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [pending('mailbox-crash-a'), pending('mailbox-crash-b')] });
    let childCalled = false;
    const crashed = runGuard(f, {
      faultFn: (stage) => {
        if (stage === 'after-ledger-transaction') throw new Error('SIMULATED_POWER_LOSS');
      },
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(crashed.ok, false);
    assert.match(crashed.error, /SIMULATED_POWER_LOSS/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications.map((entry) => entry.receipt.requestId), [
      'mailbox-crash-a',
      'mailbox-crash-b',
    ]);
    assert.equal(existsSync(`${f.deferredPath}.transaction-v3.json`), true);

    const recovered = runGuard(f, {
      spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'still offline' }),
    });
    assert.equal(recovered.ok, false);
    assert.equal(recovered.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(existsSync(`${f.deferredPath}.transaction-v3.json`), false);
    assert.deepEqual(activeLedgerIds(f.deferredPath), ['mailbox-crash-b', 'mailbox-crash-a']);
    assert.equal(new Set(activeLedgerEntries(f.deferredPath).map((entry) => entry.publicationId)).size, 2);
  } finally {
    f.cleanup();
  }
});

test('post-child crash after future segments resumes from intent without a sequence wedge', () => {
  const f = fixture();
  try {
    const retry = pending('mailbox-post-crash-a');
    const queued = pending('mailbox-post-crash-b');
    const created = pending('mailbox-post-crash-new');
    writeJson(f.statePath, { pendingReceiptPublications: [retry, queued] });
    let childRan = false;
    const crashed = runGuard(f, {
      spawnSyncFn: () => {
        const state = readJson(f.statePath);
        state.pendingReceiptPublications.push(created);
        writeJson(f.statePath, state);
        childRan = true;
        return { status: 1 };
      },
      faultFn: (stage) => {
        if (childRan && stage === 'after-ledger-segments') throw new Error('SIMULATED_POST_CHILD_POWER_LOSS');
      },
    });
    assert.equal(crashed.ok, false);
    assert.match(crashed.error, /SIMULATED_POST_CHILD_POWER_LOSS/);
    assert.equal(existsSync(`${f.deferredPath}.transaction-v3.json`), true);

    const recovered = runGuard(f, {
      spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'still offline' }),
    });
    assert.equal(recovered.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.doesNotMatch(String(recovered.error || ''), /MAILBOX_OUTBOX_LEDGER_FUTURE_SEGMENT_CONFLICT/);
    assert.equal(existsSync(`${f.deferredPath}.transaction-v3.json`), false);
    assert.deepEqual(activeLedgerIds(f.deferredPath), [
      'mailbox-post-crash-a',
      'mailbox-post-crash-new',
      'mailbox-post-crash-b',
    ]);
    assert.equal(new Set(activeLedgerEntries(f.deferredPath).map((entry) => entry.publicationId)).size, 3);
  } finally {
    f.cleanup();
  }
});

test('legacy v1 debt migrates once into v3 without collapsing a conflicting identity', () => {
  const f = fixture();
  try {
    const a = pending('mailbox-legacy-a');
    writeJson(f.deferredPath, {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SCHEMA,
      entries: [a, structuredClone(a), pending('mailbox-legacy-b')],
    });
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    const result = runGuard(f, { spawnSyncFn: () => ({ status: 1 }) });
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(readJson(f.deferredPath).schemaVersion, MAILBOX_OUTBOX_LEDGER_SCHEMA);
    assert.deepEqual(activeLedgerIds(f.deferredPath), ['mailbox-legacy-b', 'mailbox-legacy-a']);
  } finally {
    f.cleanup();
  }

  const conflict = fixture();
  try {
    const a = pending('mailbox-legacy-conflict');
    writeJson(conflict.deferredPath, {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SCHEMA,
      entries: [a, { ...a, receipt: { ...a.receipt, blocker: 'DIFFERENT' } }],
    });
    const original = readFileSync(conflict.deferredPath, 'utf8');
    let childCalled = false;
    const result = runGuard(conflict, { spawnSyncFn: () => { childCalled = true; return { status: 0 }; } });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT/);
    assert.equal(childCalled, false);
    assert.equal(readFileSync(conflict.deferredPath, 'utf8'), original);
  } finally {
    conflict.cleanup();
  }
});

test('legacy v1 migration has a fixed work cap and leaves oversized authority debt untouched', () => {
  const f = fixture();
  try {
    const entries = Array.from(
      { length: 501 },
      (_, index) => pending(`mailbox-legacy-work-${String(index).padStart(4, '0')}`),
    );
    writeJson(f.deferredPath, {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SCHEMA,
      entries,
    });
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    const originalDeferred = readFileSync(f.deferredPath, 'utf8');
    const originalState = readFileSync(f.statePath, 'utf8');
    let childCalled = false;
    const result = runGuard(f, {
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_LEGACY_V1_MIGRATION_WORK_LIMIT_EXCEEDED/);
    assert.equal(childCalled, false);
    assert.equal(readFileSync(f.deferredPath, 'utf8'), originalDeferred);
    assert.equal(readFileSync(f.statePath, 'utf8'), originalState);
    assert.equal(existsSync(`${f.deferredPath}.ledger-v3`), false);
  } finally {
    f.cleanup();
  }
});

test('an incompatible future segment fails closed instead of being overwritten', () => {
  const f = fixture();
  try {
    writeLedgerFixture(f, []);
    const manifest = readJson(f.deferredPath);
    const orphan = pending('mailbox-incompatible-orphan');
    writeJson(ledgerSegmentPath(f.deferredPath, 0), {
      schemaVersion: MAILBOX_OUTBOX_LEDGER_SEGMENT_SCHEMA,
      storeId: manifest.storeId,
      sequence: 0,
      entryDigest: pendingReceiptPublicationDigest(orphan),
      entry: orphan,
    });
    const canonical = { pendingReceiptPublications: [pending('mailbox-authority-debt')] };
    writeJson(f.statePath, canonical);
    const originalManifest = readFileSync(f.deferredPath, 'utf8');
    const originalSegment = readFileSync(ledgerSegmentPath(f.deferredPath, 0), 'utf8');
    let childCalled = false;
    const result = runGuard(f, {
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_LEDGER_FUTURE_SEGMENT_CONFLICT/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath), canonical);
    assert.equal(readFileSync(f.deferredPath, 'utf8'), originalManifest);
    assert.equal(readFileSync(ledgerSegmentPath(f.deferredPath, 0), 'utf8'), originalSegment);
  } finally {
    f.cleanup();
  }
});

test('canonical debt conflicting with an indexed publication identity blocks across cycles', () => {
  const f = fixture();
  try {
    const authority = pending('mailbox-cross-cycle-conflict');
    writeLedgerFixture(f, [authority]);
    const conflicting = {
      ...authority,
      receipt: { ...authority.receipt, blocker: 'DIFFERENT_AUTHORITY' },
    };
    const canonical = { pendingReceiptPublications: [conflicting] };
    writeJson(f.statePath, canonical);
    const originalManifest = readFileSync(f.deferredPath, 'utf8');
    let childCalled = false;
    const result = runGuard(f, {
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_PUBLICATION_ID_CONFLICT/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath), canonical);
    assert.equal(readFileSync(f.deferredPath, 'utf8'), originalManifest);
  } finally {
    f.cleanup();
  }
});

test('same-digest queued indexes must resolve to reachable ledger debt before canonical state is cleared', () => {
  const f = fixture();
  try {
    const entry = pending('mailbox-unreachable-index');
    const entryDigest = pendingReceiptPublicationDigest(entry);
    writeLedgerFixture(f, []);
    writeJson(ledgerIndexPath(f.deferredPath, entry.publicationId), {
      schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
      publicationId: entry.publicationId,
      entryDigest,
      status: 'QUEUED',
      source: 'ledger-v3',
      sequence: 999,
    });
    writeJson(f.statePath, { pendingReceiptPublications: [entry] });
    let childCalled = false;
    const result = runGuard(f, {
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_LEDGER_INDEX_UNREACHABLE/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, [entry]);
    assert.equal(readJson(f.deferredPath).headSequence, 0);
    assert.equal(readJson(f.deferredPath).nextSequence, 0);
  } finally {
    f.cleanup();
  }
});

test('legacy collapse rejects an unreachable same-digest queued ledger index', () => {
  const f = fixture();
  try {
    const generation = 'abcdef0123456789abcdef0123456789';
    const entry = pending('mailbox-legacy-unreachable-index');
    const entryDigest = pendingReceiptPublicationDigest(entry);
    writeJson(f.deferredPath, {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
      timestampUtc: '2026-08-19T19:00:00.000Z',
      activeSlot: 'a',
      generation,
      segmentCount: 1,
      entryCount: 1,
    });
    writeJson(join(`${f.deferredPath}.segments`, 'a', 'segment-00000000.json'), {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA,
      generation,
      segmentIndex: 0,
      entries: [entry],
    });
    writeJson(ledgerIndexPath(f.deferredPath, entry.publicationId), {
      schemaVersion: MAILBOX_OUTBOX_LEDGER_INDEX_SCHEMA,
      publicationId: entry.publicationId,
      entryDigest,
      status: 'QUEUED',
      source: 'ledger-v3',
      sequence: 999,
    });
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    let childCalled = false;
    const result = runGuard(f, {
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_LEDGER_INDEX_UNREACHABLE/);
    assert.equal(childCalled, false);
    const manifest = readJson(f.deferredPath);
    assert.equal(manifest.legacy.remainingEntryCount, 1);
    assert.equal(manifest.legacy.entryOffset, 0);
  } finally {
    f.cleanup();
  }
});

test('v2 migration advances one bounded legacy segment entry while new debt waits in v3', () => {
  const f = fixture();
  try {
    const generation = 'abcdef0123456789abcdef0123456789';
    const legacyEntries = [pending('mailbox-v2-a'), pending('mailbox-v2-b'), pending('mailbox-v2-c')];
    writeJson(f.deferredPath, {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
      timestampUtc: '2026-08-19T19:00:00.000Z',
      activeSlot: 'a',
      generation,
      segmentCount: 1,
      entryCount: legacyEntries.length,
    });
    writeJson(join(`${f.deferredPath}.segments`, 'a', 'segment-00000000.json'), {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA,
      generation,
      segmentIndex: 0,
      entries: legacyEntries,
    });
    writeJson(f.statePath, { pendingReceiptPublications: [pending('mailbox-v3-new')] });
    let observed = null;
    const result = runGuard(f, {
      spawnSyncFn: () => {
        observed = readJson(f.statePath).pendingReceiptPublications[0].receipt.requestId;
        return { status: 1 };
      },
    });
    assert.equal(observed, 'mailbox-v2-a');
    assert.equal(result.preIngressIo.segmentReads, 1);
    const manifest = readJson(f.deferredPath);
    assert.equal(manifest.schemaVersion, MAILBOX_OUTBOX_LEDGER_SCHEMA);
    assert.equal(manifest.legacy.remainingEntryCount, 2);
    assert.equal(manifest.legacy.entryOffset, 1);
    assert.deepEqual(activeLedgerIds(f.deferredPath), ['mailbox-v3-new', 'mailbox-v2-a']);
  } finally {
    f.cleanup();
  }
});

test('pre-ingress segment IO is constant with a thousand-item historical queue', () => {
  const f = fixture();
  try {
    const entries = Array.from({ length: 1000 }, (_, index) => pending(`mailbox-large-${String(index).padStart(4, '0')}`));
    writeLedgerFixture(f, entries, { headSequence: 50_000 });
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    const result = runGuard(f, { spawnSyncFn: () => ({ status: 1 }) });
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(result.preIngressIo.segmentReads, 1);
    assert.equal(result.preIngressIo.segmentWrites, 0);
    assert.ok(result.preIngressIo.indexReads <= 2);
    assert.equal(result.pendingPublicationCountAfterChild, 1000);
    const manifest = readJson(f.deferredPath);
    assert.equal(manifest.headSequence, 50_001);
    assert.equal(manifest.nextSequence, 51_001);
  } finally {
    f.cleanup();
  }
});

test('pre-ingress work does not enumerate a million-item historical ledger', () => {
  const f = fixture();
  try {
    const headSequence = 50_000;
    const logicalDebtCount = 1_000_000;
    writeLedgerFixture(f, [pending('mailbox-million-head')], { headSequence });
    const manifest = readJson(f.deferredPath);
    manifest.nextSequence = headSequence + logicalDebtCount;
    writeJson(f.deferredPath, manifest);
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    const result = runGuard(f, { spawnSyncFn: () => ({ status: 1 }) });
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(result.preIngressIo.segmentReads, 1);
    assert.equal(result.preIngressIo.segmentWrites, 0);
    assert.ok(result.preIngressIo.indexReads <= 2);
    assert.equal(result.pendingPublicationCountAfterChild, logicalDebtCount);
    const after = readJson(f.deferredPath);
    assert.equal(after.headSequence, headSequence + 1);
    assert.equal(after.nextSequence, headSequence + logicalDebtCount + 1);
  } finally {
    f.cleanup();
  }
});

test('oversized state and segment files are rejected from lstat size before payload allocation', () => {
  const stateFixture = fixture();
  try {
    writeFileSync(
      stateFixture.statePath,
      `{"pendingReceiptPublications":[],"padding":"${'x'.repeat((32 * 1024 * 1024) + 1)}"}`,
      'utf8',
    );
    let childCalled = false;
    const result = runGuard(stateFixture, { spawnSyncFn: () => { childCalled = true; return { status: 0 }; } });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_JSON_TOO_LARGE/);
    assert.equal(result.ledgerIo.jsonReads, 0);
    assert.equal(childCalled, false);
  } finally {
    stateFixture.cleanup();
  }

  const segmentFixture = fixture();
  try {
    const entry = pending('mailbox-oversized-segment');
    writeLedgerFixture(segmentFixture, [entry]);
    writeFileSync(
      ledgerSegmentPath(segmentFixture.deferredPath, 0),
      `{"padding":"${'x'.repeat(MAILBOX_OUTBOX_SEGMENT_MAX_BYTES)}"}`,
      'utf8',
    );
    writeJson(segmentFixture.statePath, { pendingReceiptPublications: [] });
    let childCalled = false;
    const result = runGuard(segmentFixture, { spawnSyncFn: () => { childCalled = true; return { status: 0 }; } });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_JSON_TOO_LARGE/);
    assert.equal(result.ledgerIo.segmentReads, 0);
    assert.equal(childCalled, false);
  } finally {
    segmentFixture.cleanup();
  }
});

test('bounded JSON reads bind the capped file descriptor before allocating or reading payload bytes', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { safe: true });
    const originalPath = `${f.statePath}.original`;
    let payloadRead = false;
    assert.throws(() => readJsonObject(f.statePath, {
      maxBytes: 64,
      openFile(path, flags) {
        renameSync(path, originalPath);
        writeFileSync(path, `${JSON.stringify({ padding: 'x'.repeat(4096) })}\n`, 'utf8');
        return openSync(path, flags);
      },
      readFile(...args) {
        payloadRead = true;
        return readSync(...args);
      },
    }), /MAILBOX_OUTBOX_FILE_IDENTITY_CHANGED/);
    assert.equal(payloadRead, false);
  } finally {
    f.cleanup();
  }
});

test('atomic JSON writes reject a replaced parent before publishing into the redirected directory', () => {
  const f = fixture();
  try {
    const parentPath = join(f.root, 'stable-parent');
    const movedParentPath = join(f.root, 'stable-parent-original');
    const targetPath = join(parentPath, 'record.json');
    mkdirSync(parentPath);
    assert.throws(() => atomicWriteJson(targetPath, { safe: true }, {
      beforeTemporaryOpenFn() {
        renameSync(parentPath, movedParentPath);
        mkdirSync(parentPath);
      },
    }), /MAILBOX_OUTBOX_DIRECTORY_IDENTITY_CHANGED/);
    assert.equal(existsSync(targetPath), false);
    assert.deepEqual(readdirSync(parentPath), []);
    assert.deepEqual(readdirSync(movedParentPath), []);
  } finally {
    f.cleanup();
  }
});

test('guard publishes only bounded child blocker fields when the guarded mailbox child fails', () => {
  const parsed = parseMailboxChildStatus(JSON.stringify({
    ok: false,
    blocker: 'MAILBOX_ACCEPTED_LEASE_EXPIRED',
    finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    mailboxBlocker: 'MAILBOX_ACCEPTED_LEASE_EXPIRED',
    indexBlocker: '',
    privatePath: 'C:/private',
    secret: 'must-not-leak',
  }));
  assert.deepEqual(parsed, {
    blocker: 'MAILBOX_ACCEPTED_LEASE_EXPIRED',
    finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
    mailboxBlocker: 'MAILBOX_ACCEPTED_LEASE_EXPIRED',
    indexBlocker: '',
    mailboxSelectedCount: 0,
    mailboxReadyCount: 0,
    mailboxDeferredCount: 0,
    mailboxControlCount: 0,
    mailboxObservationCount: 0,
    mailboxBlockedCount: 0,
    mailboxMaxConcurrencyObserved: 0,
  });

  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    const result = runGuard(f, {
      spawnSyncFn: () => ({
        status: 1,
        stdout: JSON.stringify({
          ok: false,
          blocker: 'MAILBOX_ACCEPTED_LEASE_EXPIRED',
          finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED',
          mailboxBlocker: 'MAILBOX_ACCEPTED_LEASE_EXPIRED',
          privatePath: 'C:/private',
        }),
        stderr: '',
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'MAILBOX_ACCEPTED_LEASE_EXPIRED');
    assert.equal(result.childBlocker, 'MAILBOX_ACCEPTED_LEASE_EXPIRED');
    assert.equal(result.childFinalVerdict, 'MAILBOX_WITH_RECEIPT_INDEX_BLOCKED');
    assert.equal(result.childMailboxBlocker, 'MAILBOX_ACCEPTED_LEASE_EXPIRED');
    assert.equal(result.childIndexBlocker, '');
    assert.doesNotMatch(JSON.stringify(result), /C:\/private/);
  } finally {
    f.cleanup();
  }
});

test('guard exposes only bounded mailbox activity counters for relay cadence decisions', () => {
  const parsed = parseMailboxChildStatus(JSON.stringify({
    ok: true,
    finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_READY',
    mailboxSelectedCount: 3,
    mailboxReadyCount: 2,
    mailboxDeferredCount: 1,
    mailboxControlCount: 1,
    mailboxObservationCount: 1,
    mailboxBlockedCount: 1,
    mailboxMaxConcurrencyObserved: 2,
    secret: 'must-not-leak',
  }));
  assert.equal(parsed.mailboxSelectedCount, 3);
  assert.equal(parsed.mailboxReadyCount, 2);
  assert.equal(parsed.mailboxDeferredCount, 1);
  assert.equal(parsed.mailboxControlCount, 1);
  assert.equal(parsed.mailboxObservationCount, 1);
  assert.equal(parsed.mailboxBlockedCount, 1);
  assert.equal(parsed.mailboxMaxConcurrencyObserved, 2);

  const invalid = parseMailboxChildStatus(JSON.stringify({
    mailboxSelectedCount: -1,
    mailboxReadyCount: Number.MAX_SAFE_INTEGER,
    mailboxControlCount: 'not-a-number',
  }));
  assert.equal(invalid.mailboxSelectedCount, 0);
  assert.equal(invalid.mailboxReadyCount, 0);
  assert.equal(invalid.mailboxControlCount, 0);
});

test('single-writer lock blocks overlap and recovers one dead stale owner without a permanent wedge', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [pending('mailbox-lock-a')] });
    let nested = null;
    let nestedChildCalled = false;
    const outer = runGuard(f, {
      lockTokenFn: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spawnSyncFn: () => {
        nested = runGuard(f, {
          lockTokenFn: () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          spawnSyncFn: () => { nestedChildCalled = true; return { status: 0 }; },
        });
        return { status: 1 };
      },
    });
    assert.equal(outer.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(nested.ok, false);
    assert.match(nested.error, /MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING/);
    assert.equal(nestedChildCalled, false);
    assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), false);

    writeJson(`${f.deferredPath}.lock-v1.json`, {
      schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
      token: 'cccccccccccccccccccccccccccccccc',
      pid: 999_999,
      ownerBootId: 'test-boot-old',
      ownerProcessStartId: 'test-process-old',
      acquiredAtUtc: '2026-08-19T18:00:00.000Z',
    });
    const recovered = runGuard(f, {
      now: () => new Date('2026-08-19T19:00:00.000Z'),
      lockTokenFn: () => 'dddddddddddddddddddddddddddddddd',
      processIdentityFn: (pid) => pid === process.pid
        ? { state: 'known', bootId: 'test-boot-current', processStartId: 'test-process-current' }
        : { state: 'dead' },
      staleAfterMs: 60_000,
      spawnSyncFn: () => ({ status: 1 }),
    });
    assert.equal(recovered.staleLockRecovered, true);
    assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), false);
  } finally {
    f.cleanup();
  }
});

test('power-cut empty guard lock is reclaimed only after the full stale window', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    const lock = `${f.deferredPath}.lock-v1.json`;
    writeFileSync(lock, '');
    const oldTime = new Date('2026-10-06T11:30:00.000Z');
    utimesSync(lock, oldTime, oldTime);

    const recovered = runGuard(f, {
      now: () => new Date('2026-10-06T12:00:00.000Z'),
      lockTokenFn: () => '45454545454545454545454545454545',
      staleAfterMs: 20 * 60 * 1000,
      processIdentityFn: (pid) => pid === process.pid
        ? { state: 'known', bootId: 'windows-boot-current', processStartId: 'windows-process-current' }
        : { state: 'unknown' },
      spawnSyncFn: () => ({ status: 1 }),
    });

    assert.equal(recovered.staleLockRecovered, true);
    assert.equal(recovered.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(existsSync(lock), false);

    writeFileSync(lock, '');
    const recentTime = new Date('2026-10-06T11:55:00.000Z');
    utimesSync(lock, recentTime, recentTime);
    const recent = runGuard(f, {
      now: () => new Date('2026-10-06T12:00:00.000Z'),
      lockTokenFn: () => '67676767676767676767676767676767',
      staleAfterMs: 20 * 60 * 1000,
      processIdentityFn: (pid) => pid === process.pid
        ? { state: 'known', bootId: 'windows-boot-current', processStartId: 'windows-process-current' }
        : { state: 'unknown' },
      spawnSyncFn: () => ({ status: 1 }),
    });
    assert.equal(recent.ok, false);
    assert.match(recent.error, /MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING/);
    assert.equal(existsSync(lock), true);
  } finally {
    f.cleanup();
  }
});

test('prior-boot stale guard owner is reclaimed even when the historical PID probe is inconclusive', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    writeJson(`${f.deferredPath}.lock-v1.json`, {
      schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
      token: '34343434343434343434343434343434',
      pid: 42424,
      ownerBootId: 'windows-boot-prior',
      ownerProcessStartId: 'windows-process-prior',
      acquiredAtUtc: '2026-10-06T11:59:40.000Z',
    });

    const result = runGuard(f, {
      now: () => new Date('2026-10-06T12:00:00.000Z'),
      lockTokenFn: () => '56565656565656565656565656565656',
      staleAfterMs: 20 * 60 * 1000,
      processIdentityFn: (pid) => pid === process.pid
        ? { state: 'known', bootId: 'windows-boot-current', processStartId: 'windows-process-current' }
        : { state: 'unknown' },
      spawnSyncFn: () => ({ status: 1 }),
    });

    assert.equal(result.staleLockRecovered, true);
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), false);
  } finally {
    f.cleanup();
  }
});

test('same-boot stale guard stays fail-closed when the owner PID identity is inconclusive', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    writeJson(`${f.deferredPath}.lock-v1.json`, {
      schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
      token: '78787878787878787878787878787878',
      pid: 52525,
      ownerBootId: 'windows-boot-current',
      ownerProcessStartId: 'windows-process-unknown',
      acquiredAtUtc: '2026-10-06T10:00:00.000Z',
    });

    const result = runGuard(f, {
      now: () => new Date('2026-10-06T12:00:00.000Z'),
      lockTokenFn: () => '90909090909090909090909090909090',
      staleAfterMs: 60_000,
      processIdentityFn: (pid) => pid === process.pid
        ? { state: 'known', bootId: 'windows-boot-current', processStartId: 'windows-process-current' }
        : { state: 'unknown' },
      spawnSyncFn: () => ({ status: 1 }),
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING/);
    assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), true);
  } finally {
    f.cleanup();
  }
});

test('proven-dead guard owner is reclaimed after a short grace without waiting the full stale lease', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    writeJson(`${f.deferredPath}.lock-v1.json`, {
      schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
      token: 'abababababababababababababababab',
      pid: 999_998,
      ownerBootId: 'test-boot-dead',
      ownerProcessStartId: 'test-process-dead',
      acquiredAtUtc: '2026-08-19T18:59:40.000Z',
    });

    const result = runGuard(f, {
      now: () => new Date('2026-08-19T19:00:00.000Z'),
      lockTokenFn: () => 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      staleAfterMs: 20 * 60 * 1000,
      processIdentityFn: (pid) => pid === process.pid
        ? { state: 'known', bootId: 'test-boot-current', processStartId: 'test-process-current' }
        : { state: 'dead' },
      spawnSyncFn: () => ({ status: 1 }),
    });

    assert.equal(result.staleLockRecovered, true);
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), false);
  } finally {
    f.cleanup();
  }
});

test('guard delegates one parent-bound lease and the lease expires when the guard releases its lock', () => {
  const f = fixture();
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    let delegatedEnv = null;
    let liveLease = null;
    const result = runGuard(f, {
      env: { ...process.env, STEPHANOS_SHARED_WORKSPACE_ROOT: dirname(dirname(f.statePath)) },
      spawnSyncFn: (_command, _args, options) => {
        delegatedEnv = options.env;
        liveLease = verifyMailboxOutboxGuardLease({ env: delegatedEnv, parentPid: process.pid });
        return { status: 1 };
      },
    });
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.equal(liveLease.ok, true);
    assert.equal(liveLease.guardPid, process.pid);
    const expiredLease = verifyMailboxOutboxGuardLease({ env: delegatedEnv, parentPid: process.pid });
    assert.equal(expiredLease.ok, false);
    assert.equal(expiredLease.blocker, 'MAILBOX_OUTBOX_GUARD_LEASE_UNPROVEN');
  } finally {
    f.cleanup();
  }
});

test('stale lock recovery distinguishes PID reuse and does not trust a future claimed timestamp', () => {
  const f = fixture();
  const currentIdentity = { state: 'known', bootId: 'test-boot-current', processStartId: 'test-process-current' };
  try {
    writeJson(f.statePath, { pendingReceiptPublications: [] });
    writeJson(`${f.deferredPath}.lock-v1.json`, {
      schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
      token: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      pid: 4242,
      ownerBootId: 'test-boot-current',
      ownerProcessStartId: 'test-process-original',
      acquiredAtUtc: '2026-08-19T18:00:00.000Z',
    });
    const reusedPid = runGuard(f, {
      now: () => new Date('2026-08-19T19:00:00.000Z'),
      lockTokenFn: () => 'ffffffffffffffffffffffffffffffff',
      staleAfterMs: 60_000,
      processIdentityFn: (pid) => {
        if (pid === process.pid) return currentIdentity;
        if (pid === 4242) return { state: 'known', bootId: 'test-boot-current', processStartId: 'test-process-reused' };
        return { state: 'dead' };
      },
      spawnSyncFn: () => ({ status: 1 }),
    });
    assert.equal(reusedPid.staleLockRecovered, true);

    const observedNow = new Date(Date.now() + (2 * 60 * 60 * 1000));
    writeJson(`${f.deferredPath}.lock-v1.json`, {
      schemaVersion: 'stephanos.battle-bridge-mailbox-outbox-lock.v1',
      token: '11111111111111111111111111111111',
      pid: 5252,
      ownerBootId: 'test-boot-old',
      ownerProcessStartId: 'test-process-old',
      acquiredAtUtc: new Date(observedNow.getTime() + (24 * 60 * 60 * 1000)).toISOString(),
    });
    const futureFilesystemTime = new Date(observedNow.getTime() + (48 * 60 * 60 * 1000));
    utimesSync(`${f.deferredPath}.lock-v1.json`, futureFilesystemTime, futureFilesystemTime);
    const futureTimestamp = runGuard(f, {
      now: () => observedNow,
      lockTokenFn: () => '22222222222222222222222222222222',
      staleAfterMs: 60_000,
      processIdentityFn: (pid) => pid === process.pid ? currentIdentity : { state: 'dead' },
      spawnSyncFn: () => ({ status: 1 }),
    });
    assert.equal(futureTimestamp.staleLockRecovered, true);
    assert.equal(existsSync(`${f.deferredPath}.lock-v1.json`), false);
  } finally {
    f.cleanup();
  }
});

test('manifest-controlled legacy path components fail closed before traversal or child execution', () => {
  const f = fixture();
  try {
    const state = { pendingReceiptPublications: [pending('mailbox-safe-path')] };
    writeJson(f.statePath, state);
    writeJson(f.deferredPath, {
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
      activeSlot: '../outside',
      generation: '0123456789abcdef0123456789abcdef',
      segmentCount: 1,
      entryCount: 1,
    });
    let childCalled = false;
    const result = runGuard(f, { spawnSyncFn: () => { childCalled = true; return { status: 0 }; } });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_DEFERRED_MANIFEST_INVALID/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath), state);
  } finally {
    f.cleanup();
  }
});

test('fixed receipt-store paths and ledger directories reject path redirection', () => {
  const redirected = fixture();
  try {
    const external = join(redirected.root, 'external-ledger-target');
    mkdirSync(external, { recursive: true });
    symlinkSync(external, `${redirected.deferredPath}.ledger-v3`, 'dir');
    const state = { pendingReceiptPublications: [pending('mailbox-path-redirection')] };
    writeJson(redirected.statePath, state);
    let childCalled = false;
    const result = runGuard(redirected, {
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_DIRECTORY_IDENTITY_INVALID/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(redirected.statePath), state);
    assert.deepEqual(readdirSync(external), []);
  } finally {
    redirected.cleanup();
  }

  const renamed = fixture();
  try {
    let childCalled = false;
    const result = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: renamed.root,
      pathOverrides: {
        ...renamed.paths,
        deferredPath: join(dirname(renamed.deferredPath), 'caller-selected-debt.json'),
      },
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'MAILBOX_OUTBOX_STORE_PATH_INVALID');
    assert.equal(childCalled, false);
  } finally {
    renamed.cleanup();
  }
});
