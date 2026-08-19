import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAILBOX_OUTBOX_DEFERRED_SCHEMA,
  MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE,
  mergeMailboxOutboxAfterCycle,
  normalizePendingReceiptPublications,
  planMailboxOutboxCycle,
  runMailboxOutboxGuard,
} from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';

function pending(id, state = 'BLOCKED') {
  return {
    publicationId: `${id}:${state}:2026-08-19T19:00:00.000Z`,
    receipt: {
      schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
      requestId: id,
      operation: 'READ_DEPLOYMENT_STATUS',
      state,
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-mailbox-outbox-'));
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
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('cycle plans at most one publication attempt and defers the rest', () => {
  const a = pending('mailbox-outbox-a');
  const b = pending('mailbox-outbox-b');
  const c = pending('mailbox-outbox-c');
  const plan = planMailboxOutboxCycle({ statePending: [a, b, c] });
  assert.equal(MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE, 1);
  assert.deepEqual(plan.attemptedThisCycle.map((entry) => entry.receipt.requestId), ['mailbox-outbox-a']);
  assert.deepEqual(plan.deferred.map((entry) => entry.receipt.requestId), ['mailbox-outbox-b', 'mailbox-outbox-c']);
});

test('deferred debt is preferred after a crash so one poison receipt cannot monopolise cycles', () => {
  const attemptedLastCycle = pending('mailbox-outbox-poison');
  const deferredA = pending('mailbox-outbox-deferred-a');
  const deferredB = pending('mailbox-outbox-deferred-b');
  const plan = planMailboxOutboxCycle({
    statePending: [attemptedLastCycle],
    deferredPending: [deferredA, deferredB],
  });
  assert.equal(plan.attemptedThisCycle[0].receipt.requestId, 'mailbox-outbox-deferred-a');
  assert.deepEqual(plan.deferred.map((entry) => entry.receipt.requestId), [
    'mailbox-outbox-deferred-b',
    'mailbox-outbox-poison',
  ]);
});

test('post-cycle merge rotates a failed attempted receipt behind older deferred debt without loss', () => {
  const deferredA = pending('mailbox-outbox-old-a');
  const deferredB = pending('mailbox-outbox-old-b');
  const failedAgain = pending('mailbox-outbox-poison');
  const newReceipt = pending('mailbox-outbox-new');
  const merged = mergeMailboxOutboxAfterCycle({
    deferredPending: [deferredA, deferredB],
    statePending: [failedAgain, newReceipt],
  });
  assert.deepEqual(merged.map((entry) => entry.receipt.requestId), [
    'mailbox-outbox-old-a',
    'mailbox-outbox-old-b',
    'mailbox-outbox-poison',
    'mailbox-outbox-new',
  ]);
});

test('duplicate publication ids are deduplicated and malformed debt fails closed', () => {
  const a = pending('mailbox-outbox-dedupe');
  assert.equal(normalizePendingReceiptPublications([a, structuredClone(a)]).length, 1);
  assert.throws(
    () => normalizePendingReceiptPublications([{ publicationId: 'bad', receipt: { requestId: 'bad', state: 'DONE' } }]),
    /MAILBOX_OUTBOX_PENDING_ENTRY_INVALID/,
  );
});

test('guard exposes only one old publication to canonical mailbox, then restores all deferred and new debt', () => {
  const f = fixture();
  try {
    const original = [pending('mailbox-outbox-a'), pending('mailbox-outbox-b'), pending('mailbox-outbox-c')];
    writeFileSync(f.statePath, JSON.stringify({
      consumedRequestIds: [],
      acceptedRequestIds: [],
      pendingReceiptPublications: original,
    }, null, 2));

    let childObserved = null;
    const result = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: f.root,
      now: () => new Date('2026-08-19T19:30:00.000Z'),
      pathOverrides: {
        actualRepoRoot: f.root,
        expectedRepoRoot: f.root,
        statePath: f.statePath,
        deferredPath: f.deferredPath,
        childRunnerPath: f.childRunnerPath,
      },
      spawnSyncFn: () => {
        const during = readJson(f.statePath);
        childObserved = during.pendingReceiptPublications.map((entry) => entry.receipt.requestId);
        // Simulate the first publication failing again while normal command execution
        // creates a fresh terminal receipt publication in the same mailbox cycle.
        during.pendingReceiptPublications = [
          during.pendingReceiptPublications[0],
          pending('mailbox-outbox-new-during-child'),
        ];
        writeFileSync(f.statePath, JSON.stringify(during, null, 2));
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(childObserved, ['mailbox-outbox-a']);
    assert.equal(result.attemptedPublicationCount, 1);
    assert.equal(result.deferredPublicationCountBeforeChild, 2);
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications.map((entry) => entry.receipt.requestId), [
      'mailbox-outbox-b',
      'mailbox-outbox-c',
      'mailbox-outbox-a',
      'mailbox-outbox-new-during-child',
    ]);
    assert.equal(result.commandIngressDelegatedToExistingMailbox, true);
    assert.equal(result.receiptReplayAllowed, false);
  } finally {
    f.cleanup();
  }
});

test('guard restores deferred receipt debt even when canonical mailbox child blocks', () => {
  const f = fixture();
  try {
    writeFileSync(f.statePath, JSON.stringify({ pendingReceiptPublications: [
      pending('mailbox-outbox-fail-a'),
      pending('mailbox-outbox-fail-b'),
    ] }, null, 2));
    const result = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: f.root,
      pathOverrides: {
        actualRepoRoot: f.root,
        expectedRepoRoot: f.root,
        statePath: f.statePath,
        deferredPath: f.deferredPath,
        childRunnerPath: f.childRunnerPath,
      },
      spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'bounded child blocker' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'MAILBOX_CHILD_RUN_BLOCKED');
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications.map((entry) => entry.receipt.requestId), [
      'mailbox-outbox-fail-b',
      'mailbox-outbox-fail-a',
    ]);
  } finally {
    f.cleanup();
  }
});

test('malformed crash-recovery deferred record blocks before child execution and preserves canonical state', () => {
  const f = fixture();
  try {
    const state = { pendingReceiptPublications: [pending('mailbox-outbox-preserved')] };
    writeFileSync(f.statePath, JSON.stringify(state, null, 2));
    writeFileSync(f.deferredPath, JSON.stringify({ schemaVersion: 'wrong', entries: [] }, null, 2));
    let childCalled = false;
    const result = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: f.root,
      pathOverrides: {
        actualRepoRoot: f.root,
        expectedRepoRoot: f.root,
        statePath: f.statePath,
        deferredPath: f.deferredPath,
        childRunnerPath: f.childRunnerPath,
      },
      spawnSyncFn: () => { childCalled = true; return { status: 0 }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'MAILBOX_OUTBOX_GUARD_FAILED');
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath), state);
  } finally {
    f.cleanup();
  }
});

test('deferred record schema is explicit and not caller-shaped', () => {
  assert.equal(MAILBOX_OUTBOX_DEFERRED_SCHEMA, 'stephanos.battle-bridge-mailbox-outbox-deferred.v1');
});
