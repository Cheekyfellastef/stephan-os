import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
  MAILBOX_OUTBOX_DEFERRED_SCHEMA,
  MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA,
  MAILBOX_OUTBOX_MANIFEST_MAX_BYTES,
  MAILBOX_OUTBOX_MAX_ATTEMPTS_PER_CYCLE,
  MAILBOX_OUTBOX_SEGMENT_MAX_BYTES,
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

function deferredRequestIds(path) {
  const record = readJson(path);
  if (record.schemaVersion === MAILBOX_OUTBOX_DEFERRED_SCHEMA) {
    const entries = Array.isArray(record.entries) ? record.entries : record.segments.flat();
    return entries.map((entry) => entry.receipt.requestId);
  }
  return segmentedDeferred(path).entries.map((entry) => entry.receipt.requestId);
}

function segmentedDeferred(path) {
  const manifest = readJson(path);
  const segments = [];
  for (let index = 0; index < manifest.segmentCount; index += 1) {
    segments.push(readJson(join(
      `${path}.segments`,
      manifest.activeSlot,
      `segment-${String(index).padStart(8, '0')}.json`,
    )));
  }
  return { manifest, segments, entries: segments.flatMap((segment) => segment.entries) };
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
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, []);
    assert.deepEqual(deferredRequestIds(f.deferredPath), [
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
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, []);
    assert.deepEqual(deferredRequestIds(f.deferredPath), [
      'mailbox-outbox-fail-b',
      'mailbox-outbox-fail-a',
    ]);
  } finally {
    f.cleanup();
  }
});

test('present non-array canonical debt blocks before child execution without changing either authority store', () => {
  for (const malformedPending of [null, { publicationId: 'authority-bearing-object' }, 'authority-bearing-text']) {
    const f = fixture();
    try {
      const state = {
        consumedRequestIds: ['mailbox-already-consumed'],
        pendingReceiptPublications: malformedPending,
      };
      writeFileSync(f.statePath, JSON.stringify(state, null, 2));
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
      assert.match(result.error, /MAILBOX_OUTBOX_CANONICAL_PENDING_ARRAY_REQUIRED/);
      assert.equal(childCalled, false);
      assert.deepEqual(readJson(f.statePath), state);
      assert.equal(existsSync(f.deferredPath), false);
    } finally {
      f.cleanup();
    }
  }
});

test('post-child non-array canonical debt fails closed and is not overwritten or discarded', () => {
  const f = fixture();
  try {
    writeFileSync(f.statePath, JSON.stringify({ pendingReceiptPublications: [
      pending('mailbox-outbox-post-malformed-a'),
      pending('mailbox-outbox-post-malformed-b'),
    ] }, null, 2));
    const malformedPending = { opaqueAuthorityDebt: ['must', 'remain', 'intact'] };
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
      spawnSyncFn: () => {
        const state = readJson(f.statePath);
        state.pendingReceiptPublications = malformedPending;
        writeFileSync(f.statePath, JSON.stringify(state, null, 2));
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /MAILBOX_OUTBOX_CANONICAL_PENDING_ARRAY_REQUIRED/);
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, malformedPending);
    assert.deepEqual(deferredRequestIds(f.deferredPath), ['mailbox-outbox-post-malformed-b']);
  } finally {
    f.cleanup();
  }
});

test('a crash after the pre-child checkpoint retains the attempted and deferred generations for recovery', () => {
  const f = fixture();
  try {
    writeFileSync(f.statePath, JSON.stringify({ pendingReceiptPublications: [
      pending('mailbox-outbox-crash-a'),
      pending('mailbox-outbox-crash-b'),
      pending('mailbox-outbox-crash-c'),
    ] }, null, 2));
    const crashed = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: f.root,
      pathOverrides: {
        actualRepoRoot: f.root,
        expectedRepoRoot: f.root,
        statePath: f.statePath,
        deferredPath: f.deferredPath,
        childRunnerPath: f.childRunnerPath,
      },
      spawnSyncFn: () => { throw new Error('SIMULATED_CHILD_PROCESS_LOSS'); },
    });
    assert.equal(crashed.ok, false);
    assert.deepEqual(
      readJson(f.statePath).pendingReceiptPublications.map((entry) => entry.receipt.requestId),
      ['mailbox-outbox-crash-a'],
    );
    assert.deepEqual(deferredRequestIds(f.deferredPath), [
      'mailbox-outbox-crash-b',
      'mailbox-outbox-crash-c',
    ]);

    const recovered = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: f.root,
      pathOverrides: {
        actualRepoRoot: f.root,
        expectedRepoRoot: f.root,
        statePath: f.statePath,
        deferredPath: f.deferredPath,
        childRunnerPath: f.childRunnerPath,
      },
      spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'still offline' }),
    });
    assert.equal(recovered.ok, false);
    assert.deepEqual(deferredRequestIds(f.deferredPath), [
      'mailbox-outbox-crash-c',
      'mailbox-outbox-crash-a',
      'mailbox-outbox-crash-b',
    ]);
    assert.equal(new Set(deferredRequestIds(f.deferredPath)).size, 3);
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

test('manifest-controlled path components fail closed before any segment traversal or child execution', () => {
  const f = fixture();
  try {
    const state = { pendingReceiptPublications: [pending('mailbox-outbox-safe-path')] };
    writeFileSync(f.statePath, JSON.stringify(state, null, 2));
    writeFileSync(f.deferredPath, JSON.stringify({
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA,
      timestampUtc: '2026-08-19T19:00:00.000Z',
      activeSlot: '../outside',
      generation: '0123456789abcdef0123456789abcdef',
      segmentCount: 1,
      entryCount: 1,
    }, null, 2));
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
    assert.match(result.error, /MAILBOX_OUTBOX_DEFERRED_MANIFEST_INVALID/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath), state);
  } finally {
    f.cleanup();
  }
});

test('deferred record schemas are explicit and not caller-shaped', () => {
  assert.equal(MAILBOX_OUTBOX_DEFERRED_SCHEMA, 'stephanos.battle-bridge-mailbox-outbox-deferred.v1');
  assert.equal(MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA, 'stephanos.battle-bridge-mailbox-outbox-deferred-manifest.v2');
  assert.equal(MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA, 'stephanos.battle-bridge-mailbox-outbox-deferred-segment.v2');
});

test('legacy aggregate debt is read, deduplicated, and migrated into bounded fixed-slot segments', () => {
  const f = fixture();
  try {
    const duplicate = pending('mailbox-legacy-duplicate');
    const legacy = [
      duplicate,
      structuredClone(duplicate),
      ...Array.from({ length: 501 }, (_, index) => pending(`mailbox-legacy-${String(index).padStart(4, '0')}`)),
    ];
    writeFileSync(f.deferredPath, JSON.stringify({
      schemaVersion: MAILBOX_OUTBOX_DEFERRED_SCHEMA,
      timestampUtc: '2026-08-19T19:00:00.000Z',
      entries: legacy,
    }, null, 2));
    writeFileSync(f.statePath, JSON.stringify({ pendingReceiptPublications: [] }, null, 2));

    const result = runMailboxOutboxGuard({
      platform: 'win32',
      repoRoot: f.root,
      generationIdFn: () => '0123456789abcdef0123456789abcdef',
      pathOverrides: {
        actualRepoRoot: f.root,
        expectedRepoRoot: f.root,
        statePath: f.statePath,
        deferredPath: f.deferredPath,
        childRunnerPath: f.childRunnerPath,
      },
      spawnSyncFn: () => ({ status: 0, stdout: '', stderr: '' }),
    });

    assert.equal(result.ok, true);
    const stored = segmentedDeferred(f.deferredPath);
    assert.equal(stored.manifest.schemaVersion, MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA);
    assert.match(stored.manifest.activeSlot, /^(a|b)$/);
    assert.equal(stored.entries.length, 502);
    assert.equal(new Set(stored.entries.map((entry) => entry.publicationId)).size, 502);
    assert.ok(stored.segments.every((segment) => segment.schemaVersion === MAILBOX_OUTBOX_DEFERRED_SEGMENT_SCHEMA));
    assert.ok(stored.segments.every((segment) => segment.entries.length <= 500));
  } finally {
    f.cleanup();
  }
});

test('an impossible oversized receipt fails closed before canonical state mutation', () => {
  const f = fixture();
  try {
    const state = {
      pendingReceiptPublications: [
        pending('mailbox-outbox-before-oversized'),
        {
          ...pending('mailbox-outbox-oversized'),
          receipt: {
            ...pending('mailbox-outbox-oversized').receipt,
            impossibleUnboundedPayload: 'x'.repeat(MAILBOX_OUTBOX_SEGMENT_MAX_BYTES),
          },
        },
      ],
    };
    writeFileSync(f.statePath, JSON.stringify(state, null, 2));
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
    assert.match(result.error, /MAILBOX_OUTBOX_DEFERRED_ENTRY_TOO_LARGE/);
    assert.equal(childCalled, false);
    assert.deepEqual(readJson(f.statePath), state);
    assert.equal(existsSync(f.deferredPath), false);
  } finally {
    f.cleanup();
  }
});

test('sustained publication outage never wedges command ingress and preserves segmented debt', () => {
  const f = fixture();
  try {
    const initial = Array.from({ length: 500 }, (_, index) => pending(`mailbox-outage-${String(index).padStart(4, '0')}`));
    writeFileSync(f.statePath, JSON.stringify({ pendingReceiptPublications: initial }, null, 2));
    let childCalls = 0;
    for (let cycle = 0; cycle < 125; cycle += 1) {
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
        spawnSyncFn: () => {
          childCalls += 1;
          const state = readJson(f.statePath);
          state.pendingReceiptPublications.push(pending(`mailbox-new-${String(cycle).padStart(4, '0')}`));
          writeFileSync(f.statePath, JSON.stringify(state, null, 2));
          return { status: 0, stdout: '', stderr: '' };
        },
      });
      assert.equal(result.ok, true);
    }

    assert.equal(childCalls, 125);
    assert.deepEqual(readJson(f.statePath).pendingReceiptPublications, []);
    const deferred = segmentedDeferred(f.deferredPath);
    assert.equal(deferred.manifest.schemaVersion, MAILBOX_OUTBOX_DEFERRED_MANIFEST_SCHEMA);
    assert.ok(statSync(f.deferredPath).size <= MAILBOX_OUTBOX_MANIFEST_MAX_BYTES);
    assert.ok(deferred.segments.length > 1);
    assert.ok(deferred.segments.every((segment) => segment.entries.length <= 500));
    assert.ok(deferred.segments.every((segment, index) => {
      const segmentPath = join(
        `${f.deferredPath}.segments`,
        deferred.manifest.activeSlot,
        `segment-${String(index).padStart(8, '0')}.json`,
      );
      return statSync(segmentPath).size <= MAILBOX_OUTBOX_SEGMENT_MAX_BYTES;
    }));
    const ids = deferred.entries.map((entry) => entry.receipt.requestId);
    assert.equal(ids.length, 625);
    assert.equal(new Set(ids).size, 625);
  } finally {
    f.cleanup();
  }
});
