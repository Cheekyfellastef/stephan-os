import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MAILBOX_RECEIPT_INDEX_FILENAME,
  MAILBOX_RECEIPT_INDEX_GITHUB_MARKER,
  MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES,
  MAILBOX_RECEIPT_INDEX_PARTICIPANT_ID,
  MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION,
  MAILBOX_RECEIPT_INDEX_STATUS_ID,
  buildMailboxReceiptIndexGitHubBody,
  createMailboxReceiptIndexFromGitHubComments,
  createMailboxReceiptIndexProjection,
  createMailboxReceiptIndexRecord,
  findMailboxReceiptIndexComment,
  loadMailboxReceiptsFromSharedWorkspace,
  readMailboxReceiptIndex,
  refreshMailboxReceiptIndex,
  sanitizeMailboxReceiptForIndex,
} from './mailboxReceiptIndex.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  createWindowsSafeMailboxReceiptFilename,
  getReadableMailboxReceiptFilenames,
} from './windowsSafeMailboxReceiptFilename.mjs';

const HEAD = '8517ef3cc89e5ab6c191c550cc729227b3089e42';
const LATER_HEAD = 'b3aca072a1c66555a1a2d3b4343f218af8d33ef4';

function receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'deploy-pr1549-20260717T1940Z',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    branch: 'main',
    state: 'DONE',
    acceptedAt: '2026-07-17T19:40:00.000Z',
    heartbeatAt: '2026-07-17T19:41:00.000Z',
    completedAt: '2026-07-17T19:41:00.000Z',
    expectedHead: HEAD,
    blocker: '',
    proofRefs: ['receipts/github-command-mailbox/deploy-pr1549-20260717T1940Z.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'UPDATE_STEPHANOS_FROM_CHAT',
      requestId: 'deploy-pr1549-20260717T1940Z',
      result: {
        ok: true,
        finalVerdict: 'SYNC_FAST_FORWARD_APPLIED',
        sourceHead: HEAD,
        branch: 'main',
        expectedHeadMatch: true,
        proofWrittenToSharedWorkspace: true,
        proofRefs: ['proof/deployment-head.json'],
        rawPayload: 'must-not-survive',
        machinePath: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
        apiToken: 'ghp_must_not_survive',
      },
    },
    ...overrides,
  };
}

function githubReceiptComment(value, id = 100) {
  return {
    id,
    body: `<!-- stephanos-battle-bridge-command-receipt -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,
  };
}

async function workspaceFixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'mailbox-receipt-index-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(join(workspaceRoot, 'receipts', 'github-command-mailbox'), { recursive: true });
  try { return await fn({ root, repoRoot, workspaceRoot }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function writeReceipt(workspaceRoot, value) {
  const target = join(
    workspaceRoot,
    'receipts',
    'github-command-mailbox',
    createWindowsSafeMailboxReceiptFilename(value.requestId),
  );
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

test('loads receipts whose Windows-safe filenames hash reserved or colon-bearing request IDs', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  const values = [
    receipt({ requestId: 'CON.proof' }),
    receipt({ requestId: 'proof:2026-07-30T20:00:00Z' }),
  ];
  for (const value of values) await writeReceipt(workspaceRoot, value);
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root: workspaceRoot, repoRoot });
  assert.equal(loaded.ok, true);
  assert.deepEqual(
    loaded.receipts.map((value) => value.requestId).sort(),
    values.map((value) => value.requestId).sort(),
  );
}));

test('loads validated legacy receipt filenames so active upgrade state does not disappear', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  const receiptRoot = join(workspaceRoot, 'receipts', 'github-command-mailbox');
  assert.deepEqual(
    getReadableMailboxReceiptFilenames('CON.proof').slice(1),
    [
      `request-${createHash('sha256').update('CON.proof').digest('hex').slice(0, 32)}.json`,
      'CON.proof.json',
    ],
  );
  assert.equal(getReadableMailboxReceiptFilenames('Request-safe-0001')[1], 'Request-safe-0001.json');
  const values = [
    receipt({
      requestId: 'CON.proof',
      state: 'ACCEPTED',
      heartbeatAt: '2026-07-17T20:00:00.000Z',
      completedAt: '',
      result: null,
    }),
    receipt({ requestId: 'proof:2026-07-30T20:00:00Z' }),
    receipt({ requestId: 'Request-safe-0001' }),
  ];
  for (const value of values) {
    const canonical = createWindowsSafeMailboxReceiptFilename(value.requestId);
    const legacy = getReadableMailboxReceiptFilenames(value.requestId)
      .find((filename) => filename !== canonical);
    assert.ok(legacy);
    await writeFile(join(receiptRoot, legacy), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root: workspaceRoot, repoRoot });
  assert.deepEqual(
    loaded.receipts.map((value) => value.requestId).sort(),
    values.map((value) => value.requestId).sort(),
  );
  const record = createMailboxReceiptIndexRecord({
    receipts: loaded.receipts,
    timestampUtc: '2026-07-30T20:01:00.000Z',
  });
  assert.equal(record.status, 'ACTIVE');
  assert.equal(record.activeReceipt.requestId, 'CON.proof');
}));

test('fallback hashes cannot alias valid raw request ids and both receipts remain loadable', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  const unsafeRequestId = 'proof:2026-07-30T20:00:00Z';
  const digest = createHash('sha256').update(unsafeRequestId).digest('hex').slice(0, 32);
  const legacyFilename = `request-${digest}.json`;
  const formerlyAliasedRawId = `request-${digest}`;
  const rawFilename = createWindowsSafeMailboxReceiptFilename(formerlyAliasedRawId);
  assert.notEqual(legacyFilename, rawFilename);
  assert.match(rawFilename, /^_request-[0-9a-f]{32}\.json$/);
  assert.equal(
    getReadableMailboxReceiptFilenames(formerlyAliasedRawId).includes(legacyFilename),
    true,
  );

  const receiptRoot = join(workspaceRoot, 'receipts', 'github-command-mailbox');
  const legacyReceipt = receipt({ requestId: unsafeRequestId });
  await writeFile(
    join(receiptRoot, legacyFilename),
    `${JSON.stringify(legacyReceipt, null, 2)}\n`,
    'utf8',
  );
  await writeReceipt(workspaceRoot, receipt({ requestId: formerlyAliasedRawId }));
  assert.equal(
    JSON.parse(await readFile(join(receiptRoot, legacyFilename), 'utf8')).requestId,
    unsafeRequestId,
  );
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root: workspaceRoot, repoRoot });
  assert.deepEqual(
    loaded.receipts.map((value) => value.requestId).sort(),
    [unsafeRequestId, formerlyAliasedRawId].sort(),
  );
}));

test('case-distinct request ids use case-distinct Windows filenames and remain independently loadable', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  const values = [
    receipt({ requestId: 'Request-safe-0001' }),
    receipt({ requestId: 'request-safe-0001' }),
  ];
  const filenames = values.map((value) => createWindowsSafeMailboxReceiptFilename(value.requestId));
  assert.notEqual(filenames[0].toLowerCase(), filenames[1].toLowerCase());
  for (const value of values) await writeReceipt(workspaceRoot, value);
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root: workspaceRoot, repoRoot });
  assert.deepEqual(
    loaded.receipts.map((value) => value.requestId).sort(),
    values.map((value) => value.requestId).sort(),
  );
}));

test('rejects a matching fallback-hash filename when the embedded request id is missing or invalid', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  const receiptRoot = join(workspaceRoot, 'receipts', 'github-command-mailbox');
  for (const requestId of ['', '../invalid']) {
    await writeFile(
      join(receiptRoot, createWindowsSafeMailboxReceiptFilename(requestId)),
      `${JSON.stringify(requestId ? { requestId } : {})}\n`,
      'utf8',
    );
  }
  const conLegacy = getReadableMailboxReceiptFilenames('CON.proof')
    .find((filename) => filename !== createWindowsSafeMailboxReceiptFilename('CON.proof'));
  await writeFile(
    join(receiptRoot, conLegacy),
    `${JSON.stringify(receipt({ requestId: 'AUX.proof' }))}\n`,
    'utf8',
  );
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root: workspaceRoot, repoRoot });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.receipts, []);
}));

test('sanitization retains bounded evidence and removes raw payloads, machine paths and secret-shaped data', () => {
  const projected = sanitizeMailboxReceiptForIndex(receipt({
    proofRefs: [
      'receipts/github-command-mailbox/deploy-pr1549-20260717T1940Z.json',
      'C:\\Users\\Stephan Callear\\secret.json',
      '../escape.json',
      '.env',
    ],
  }));
  assert.equal(projected.requestId, 'deploy-pr1549-20260717T1940Z');
  assert.equal(projected.state, 'DONE');
  assert.equal(projected.expectedHead, HEAD);
  assert.equal(projected.sourceHead, HEAD);
  assert.equal(projected.expectedHeadMatch, true);
  assert.equal(projected.finalVerdict, 'SYNC_FAST_FORWARD_APPLIED');
  assert.equal(projected.proofWrittenToSharedWorkspace, true);
  assert.deepEqual(projected.proofRefs, [
    'receipts/github-command-mailbox/deploy-pr1549-20260717T1940Z.json',
    'proof/deployment-head.json',
  ]);
  const json = JSON.stringify(projected);
  assert.doesNotMatch(json, /rawPayload|machinePath|apiToken|C:\\Users|\.env|\.\.\//i);
});

test('index deduplicates each request to its latest receipt and separates active from recent', () => {
  const accepted = receipt({
    requestId: 'deploy-pr1549-20260717T1940Z',
    state: 'ACCEPTED',
    heartbeatAt: '2026-07-17T19:40:00.000Z',
    completedAt: '',
    result: null,
  });
  const completed = receipt();
  const active = receipt({
    requestId: 'monitor-canary-20260717T1942Z',
    operation: 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    state: 'RUNNING',
    acceptedAt: '2026-07-17T19:42:00.000Z',
    heartbeatAt: '2026-07-17T19:43:00.000Z',
    completedAt: '',
    expectedHead: LATER_HEAD,
    result: null,
  });
  const record = createMailboxReceiptIndexRecord({
    receipts: [accepted, completed, active],
    timestampUtc: '2026-07-17T19:43:00.000Z',
  });
  assert.equal(record.statusId, MAILBOX_RECEIPT_INDEX_STATUS_ID);
  assert.equal(record.participantId, MAILBOX_RECEIPT_INDEX_PARTICIPANT_ID);
  assert.equal(record.receiptIndexSchemaVersion, MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION);
  assert.equal(record.status, 'ACTIVE');
  assert.equal(record.activeReceipt.requestId, 'monitor-canary-20260717T1942Z');
  assert.equal(record.recentReceipts.length, 1);
  assert.equal(record.recentReceipts[0].requestId, 'deploy-pr1549-20260717T1940Z');
  assert.equal(record.recentReceipts[0].state, 'DONE');
  assert.equal(record.indexedReceiptCount, 2);
  assert.equal(validateSharedWorkspaceRecord(record, { nowMs: Date.parse(record.timestampUtc) }).valid, true);
});

test('the same bounded projection is explicitly available to every registered participant class', () => {
  const record = createMailboxReceiptIndexRecord({ receipts: [receipt()], timestampUtc: '2026-07-17T19:44:00.000Z' });
  const projection = createMailboxReceiptIndexProjection(record);
  assert.deepEqual(projection.consumerIds, ['stephanos', 'openclaw', 'chatgpt', 'operator', 'future-agents']);
  assert.equal(projection.authoritativeSource, 'Shared Workspace');
  assert.equal(projection.accessMode, 'bounded-read');
  assert.equal(projection.recentReceipts[0].sourceHead, HEAD);
  assert.equal(projection.recentReceipts[0].finalVerdict, 'SYNC_FAST_FORWARD_APPLIED');
  assert.equal(projection.arbitraryFilesystemAccess, false);
  assert.equal(projection.commandExecutionAccess, false);
  assert.equal(projection.sourceMutationAccess, false);
});

test('refresh writes one fixed authoritative Shared Workspace status record and read returns its safe projection', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  await writeReceipt(workspaceRoot, receipt());
  const timestampUtc = '2026-07-17T19:45:00.000Z';
  const refreshed = await refreshMailboxReceiptIndex({
    root: workspaceRoot,
    repoRoot,
    timestampUtc,
  });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.finalVerdict, 'MAILBOX_RECEIPT_INDEX_READY');
  const read = await readMailboxReceiptIndex({
    root: workspaceRoot,
    repoRoot,
    nowMs: Date.parse(timestampUtc),
  });
  assert.equal(read.ok, true);
  assert.equal(read.finalVerdict, 'MAILBOX_RECEIPT_INDEX_READ_READY');
  assert.equal(read.stale, false);
  assert.equal(read.projection.recentReceipts[0].requestId, receipt().requestId);
  assert.equal(read.projection.recentReceipts[0].sourceHead, HEAD);
  assert.equal(read.arbitraryFilesystemAccess, false);
  assert.equal(read.commandExecutionAccess, false);
  assert.equal(read.sourceMutationAccess, false);
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root: workspaceRoot, repoRoot });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.receipts.length, 1);
  const statusPath = join(workspaceRoot, 'status', MAILBOX_RECEIPT_INDEX_FILENAME);
  assert.equal((await import('node:fs')).existsSync(statusPath), true);
}));

test('stale authoritative receipt indexes fail closed while retaining only the bounded projection', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  await writeReceipt(workspaceRoot, receipt());
  const timestampUtc = '2026-07-17T19:45:00.000Z';
  await refreshMailboxReceiptIndex({ root: workspaceRoot, repoRoot, timestampUtc });
  const stale = await readMailboxReceiptIndex({
    root: workspaceRoot,
    repoRoot,
    nowMs: Date.parse('2026-07-17T19:45:02.000Z'),
    staleAfterMs: 1_000,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.blocker, 'MAILBOX_RECEIPT_INDEX_STALE');
  assert.equal(stale.finalVerdict, 'MAILBOX_RECEIPT_INDEX_STALE');
  assert.equal(stale.stale, true);
  assert.equal(stale.projection.recentReceipts[0].requestId, receipt().requestId);
  assert.equal(stale.arbitraryFilesystemAccess, false);
  assert.equal(stale.commandExecutionAccess, false);
  assert.equal(stale.sourceMutationAccess, false);
}));

test('bounded loading selects newest receipt files by metadata rather than request-id order', async () => workspaceFixture(async ({ repoRoot, workspaceRoot }) => {
  const oldReceipt = receipt({
    requestId: 'z-old-receipt-20260717T1900Z',
    completedAt: '2026-07-17T19:00:00.000Z',
  });
  const newReceipt = receipt({
    requestId: 'a-new-receipt-20260717T2000Z',
    completedAt: '2026-07-17T20:00:00.000Z',
  });
  const oldPath = await writeReceipt(workspaceRoot, oldReceipt);
  const newPath = await writeReceipt(workspaceRoot, newReceipt);
  const oldTime = new Date('2026-07-17T19:00:00.000Z');
  const newTime = new Date('2026-07-17T20:00:00.000Z');
  await utimes(oldPath, oldTime, oldTime);
  await utimes(newPath, newTime, newTime);
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({
    root: workspaceRoot,
    repoRoot,
    maxFiles: 1,
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.receipts.length, 1);
  assert.equal(loaded.receipts[0].requestId, newReceipt.requestId);
}));

test('receipt loading is fixed to the canonical receipt directory and rejects a workspace inside the repository', async () => workspaceFixture(async ({ repoRoot }) => {
  const blocked = await loadMailboxReceiptsFromSharedWorkspace({ root: repoRoot, repoRoot });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'WORKSPACE_PATH_INSIDE_REPOSITORY');
  assert.deepEqual(blocked.receipts, []);
}));

test('GitHub receipt comments produce one compact bounded mirror and ignore unrelated or malformed comments', () => {
  const comments = [
    { id: 1, body: 'human discussion' },
    githubReceiptComment(receipt({ state: 'ACCEPTED', completedAt: '', result: null }), 2),
    githubReceiptComment(receipt(), 3),
    { id: 4, body: '<!-- stephanos-battle-bridge-command-receipt -->\n```json\nnot-json\n```' },
  ];
  const record = createMailboxReceiptIndexFromGitHubComments(comments, { timestampUtc: '2026-07-17T19:46:00.000Z' });
  assert.equal(record.indexedReceiptCount, 1);
  assert.equal(record.activeReceipt, null);
  assert.equal(record.recentReceipts[0].state, 'DONE');
  const body = buildMailboxReceiptIndexGitHubBody(record);
  assert.match(body, new RegExp(`<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`));
  assert.ok(Buffer.byteLength(body, 'utf8') <= MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES);
  assert.doesNotMatch(body, /C:\\Users|rawPayload|apiToken|\.env|\.\.\//i);
});

test('compact mirror lookup returns the single maintained index comment rather than receipt history', () => {
  const indexComment = { id: 99, body: `<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->\n\`\`\`json\n{}\n\`\`\`` };
  assert.equal(findMailboxReceiptIndexComment([
    githubReceiptComment(receipt(), 1),
    indexComment,
    { id: 100, body: 'other' },
  ]), indexComment);
  assert.equal(findMailboxReceiptIndexComment([{ id: 1, body: 'other' }]), null);
});
