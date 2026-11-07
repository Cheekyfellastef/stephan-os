import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSovereignMcpSessionConfigV1, captureSovereignMcpSessionConfigArgumentsV1,
  captureSovereignMcpSessionConfigSnapshotV1, countSovereignSubmittedLinesV1,
  SOVEREIGN_MCP_SESSION_CONFIG_DEFAULTS_V1,
} from './sovereignMcpSessionConfigV1.mjs';

const set = (service, key, value, expectedRevision) => service.execute('SET_CONFIG_VALUE', { key, value, expectedRevision });

test('defaults preserve original hard read cap and byte-only writes without persistent state', () => {
  const service = createSovereignMcpSessionConfigV1();
  const snapshot = service.getSnapshot();
  assert.deepEqual(snapshot.values, SOVEREIGN_MCP_SESSION_CONFIG_DEFAULTS_V1);
  assert.equal(snapshot.revision, 0); assert.equal(snapshot.persistent, false);
  assert.equal(snapshot.scope, 'THIS_PRIVATE_MCP_SESSION');
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.values));
  assert.deepEqual(captureSovereignMcpSessionConfigSnapshotV1(snapshot), snapshot);
  service.dispose();
});

test('CAS commits once, reports exact before/after and permits rollback through current revision', async () => {
  const service = createSovereignMcpSessionConfigV1();
  const previous = service.getSnapshot();
  const [first, stale] = await Promise.all([
    Promise.resolve().then(() => set(service, 'fileReadLineLimit', 3, 0)),
    Promise.resolve().then(() => set(service, 'fileReadLineLimit', 7, 0)),
  ]);
  assert.equal(first.ok, true); assert.equal(first.revision, 1);
  assert.deepEqual(first.change, { key: 'fileReadLineLimit', previousValue: 1000, value: 3, previousRevision: 0, changed: true });
  assert.equal(stale.ok, false); assert.equal(stale.blocker, 'SOVEREIGN_SESSION_CONFIG_REVISION_CONFLICT');
  assert.equal(stale.currentRevision, 1); assert.equal(service.getSnapshot().values.fileReadLineLimit, 3);
  assert.equal(previous.values.fileReadLineLimit, 1000, 'earlier snapshots never change');
  const rollback = set(service, 'fileReadLineLimit', first.change.previousValue, 1);
  assert.equal(rollback.ok, true); assert.equal(rollback.revision, 2); assert.equal(rollback.values.fileReadLineLimit, 1000);
  const noChange = set(service, 'fileReadLineLimit', 1000, 2);
  assert.equal(noChange.change.changed, false); assert.equal(noChange.revision, 2);
  service.dispose();
});

test('write null resets only the same session to original byte-only semantics', () => {
  const left = createSovereignMcpSessionConfigV1(), right = createSovereignMcpSessionConfigV1();
  assert.equal(set(left, 'fileWriteLineLimit', 2, 0).ok, true);
  assert.equal(left.getSnapshot().values.fileWriteLineLimit, 2);
  assert.equal(right.getSnapshot().values.fileWriteLineLimit, null);
  const reset = set(left, 'fileWriteLineLimit', null, 1);
  assert.equal(reset.ok, true); assert.equal(reset.change.previousValue, 2); assert.equal(reset.values.fileWriteLineLimit, null);
  assert.equal(right.getSnapshot().revision, 0);
  left.dispose(); right.dispose();
});

test('strict allowed keys, typed bounds and revision cannot be widened by hidden properties or getters', () => {
  const good = { key: 'fileReadLineLimit', value: 20, expectedRevision: 0 };
  const service = createSovereignMcpSessionConfigV1();
  let observed = 0;
  const getter = { ...good };
  Object.defineProperty(getter, 'value', { get() { observed++; throw Error('must not evaluate'); } });
  const cases = [null, [], Object.create(good), getter, { ...good, [Symbol('capability')]: true },
    { ...good, expectedRevision: '0' }, { ...good, expectedRevision: -1 }, { ...good, expectedRevision: 0.5 },
    { ...good, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...good, value: '20' },
    { ...good, value: null }, { ...good, value: 0 }, { ...good, value: 1001 }, { ...good, value: NaN },
    { ...good, value: Infinity }, { ...good, value: false }, { ...good, value: { nested: 1 } },
    { ...good, key: 'fileWriteLineLimit', value: 10001 }, { ...good, key: 'FileReadLineLimit' },
    { key: 'fileReadLineLimit', value: 2 }, { ...good, sessionId: 'peer' }, { ...good, scope: 'GLOBAL' },
    { ...good, persistent: true }, { ...good, path: 'C:\\config.json' }, { ...good, service: service },
    ...['allowedDirectories', 'defaultShell', 'blockedCommands', 'environment', 'token', 'mergeAuthority',
      'sourceLease', 'telemetryEnabled', 'searchPageSize', '__proto__', 'constructor'].map(key => ({ ...good, key })),
  ];
  for (const args of cases) {
    assert.equal(captureSovereignMcpSessionConfigArgumentsV1(args), null);
    assert.equal(service.execute('SET_CONFIG_VALUE', args).ok, false);
  }
  assert.equal(observed, 0); assert.equal(service.getSnapshot().revision, 0);
  assert.deepEqual(service.getSnapshot().values, SOVEREIGN_MCP_SESSION_CONFIG_DEFAULTS_V1);
  service.dispose();
});

test('captured config state rejects invalid or externally mutable policy snapshots', () => {
  const service = createSovereignMcpSessionConfigV1();
  const original = service.getSnapshot();
  for (const patch of [{ persistent: true }, { scope: 'GLOBAL' }, { revision: -1 },
    { values: { fileReadLineLimit: 1001, fileWriteLineLimit: null } },
    { values: { fileReadLineLimit: 1, fileWriteLineLimit: 10001 } },
    { values: { fileReadLineLimit: 1 } }, { unexpected: true }])
    assert.equal(captureSovereignMcpSessionConfigSnapshotV1({ ...original, ...patch }), null);
  const mutable = { ...original, values: { ...original.values } };
  const captured = captureSovereignMcpSessionConfigSnapshotV1(mutable);
  mutable.values.fileReadLineLimit = 1;
  assert.equal(captured.values.fileReadLineLimit, 1000);
  service.dispose();
});

test('logical submitted lines treat CRLF once, final delimiters explicitly, and empty replacement as zero lines', () => {
  for (const [text, lines] of [['', 0], ['a', 1], ['a\n', 1], ['\n', 1], ['\n\n', 2],
    ['a\nb', 2], ['a\r\nb', 2], ['a\rb', 2], ['a\r\n', 1], ['a\r\nb\nc\r', 3]])
    assert.equal(countSovereignSubmittedLinesV1(text), lines, JSON.stringify(text));
  assert.equal(countSovereignSubmittedLinesV1('a\nb\nc\nd', 1), 2, 'bounded rejection need not scan the rest');
});

test('close discards session state and cannot be used to reset or resurrect it', () => {
  const service = createSovereignMcpSessionConfigV1(); set(service, 'fileWriteLineLimit', 1, 0);
  service.dispose(); service.dispose();
  assert.equal(service.getSnapshot().blocker, 'SOVEREIGN_SESSION_CONFIG_CLOSED');
  assert.equal(set(service, 'fileWriteLineLimit', null, 1).blocker, 'SOVEREIGN_SESSION_CONFIG_CLOSED');
  assert.equal(captureSovereignMcpSessionConfigSnapshotV1(service.getSnapshot()), null);
});
