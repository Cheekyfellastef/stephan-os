import assert from 'node:assert/strict';
import test from 'node:test';

import { MAILBOX_RECEIPT_INDEX_GITHUB_MARKER, MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES, createMailboxReceiptIndexRecord } from './mailboxReceiptIndex.mjs';
import {
  buildTrustedMailboxReceiptIndexGitHubBodyV2,
  buildTrustedMailboxReceiptTruthIssueBody,
  extractRetiredMailboxTerminalReceiptsFromTruthIssueBody,
  createTrustedMailboxReceiptIndexFromGitHubComments,
  extractTrustedMailboxCommandComment,
  extractTrustedMailboxReceiptComment,
  findTrustedMailboxReceiptIndexComment,
} from './mailboxReceiptIndexGitHubMirror.mjs';

const OWNER = 'Cheekyfellastef';
const HEAD = 'b3aca072a1c66555a1a2d3b4343f218af8d33ef4';
const REQUEST_ID = 'receipt-index-mirror-20260717T2045Z';
const CANONICAL_MAILBOX_ISSUE = 3149;

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: REQUEST_ID,
    operation: 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-07-17T21:45:00.000Z',
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: REQUEST_ID,
    operation: 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    branch: 'main',
    state: 'DONE',
    acceptedAt: '2026-07-17T20:45:00.000Z',
    heartbeatAt: '2026-07-17T20:46:00.000Z',
    completedAt: '2026-07-17T20:46:00.000Z',
    proofRefs: [`receipts/github-command-mailbox/${REQUEST_ID}.json`],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_PASS',
        sourceHead: HEAD,
        branch: 'main',
        expectedHeadMatch: true,
        monitorCount: 13,
        executedCount: 13,
        proofWrittenToSharedWorkspace: true,
        machinePath: 'C:\\Users\\Stephan Callear\\secret.json',
      },
    },
    ...overrides,
  };
}

function commandComment(value = command(), user = OWNER) {
  return {
    id: 1,
    user: { login: user },
    body: `\`\`\`stephanos-battle-bridge-command\n${JSON.stringify(value)}\n\`\`\``,
  };
}

function receiptComment(value = receipt(), user = OWNER) {
  return {
    id: 2,
    user: { login: user },
    body: `<!-- stephanos-battle-bridge-command-receipt -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``,
  };
}

test('only owner-authored comments with exact repository, active issue and branch identity are accepted', () => {
  assert.equal(extractTrustedMailboxCommandComment(commandComment(), OWNER).expectedHead, HEAD);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(), OWNER).requestId, REQUEST_ID);
  assert.equal(extractTrustedMailboxCommandComment(commandComment(command(), 'attacker'), OWNER), null);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(receipt(), 'attacker'), OWNER), null);
  assert.equal(extractTrustedMailboxCommandComment(commandComment(command({ repository: 'other/repo' })), OWNER), null);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(receipt({ issueNumber: 1507 })), OWNER), null);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(receipt({ issueNumber: 999 })), OWNER), null);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(receipt({ branch: 'feature' })), OWNER), null);
});

test('compact receipt recovers its exact expected head from the matching trusted command', () => {
  const compactReceipt = receipt({ expectedHead: undefined });
  const record = createTrustedMailboxReceiptIndexFromGitHubComments([
    commandComment(),
    receiptComment(compactReceipt),
    receiptComment(receipt({ requestId: 'attacker-receipt-20260717T2046Z' }), 'attacker'),
  ], {
    ownerLogin: OWNER,
    timestampUtc: '2026-07-17T20:47:00.000Z',
  });
  assert.equal(record.indexedReceiptCount, 1);
  assert.equal(record.recentReceipts[0].requestId, REQUEST_ID);
  assert.equal(record.recentReceipts[0].expectedHead, HEAD);
  assert.equal(record.recentReceipts[0].sourceHead, HEAD);
  assert.equal(record.recentReceipts[0].expectedHeadMatch, true);
  assert.equal(record.recentReceipts[0].finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_PASS');
});

test('single index comment selection ignores attacker and owner lookalikes', () => {
  const attacker = {
    id: 10,
    user: { login: 'attacker' },
    body: `<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`,
  };
  const ownerLookalike = {
    id: 11,
    user: { login: OWNER },
    body: `<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`,
  };
  const trusted = {
    id: 12,
    user: { login: 'github-actions[bot]' },
    body: `<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`,
  };
  assert.equal(findTrustedMailboxReceiptIndexComment([attacker, ownerLookalike, trusted]), trusted);
  assert.equal(findTrustedMailboxReceiptIndexComment([attacker, ownerLookalike]), null);
});

test('trusted mirror body remains bounded and excludes raw machine data', () => {
  const record = createTrustedMailboxReceiptIndexFromGitHubComments([
    commandComment(),
    receiptComment(),
  ], {
    ownerLogin: OWNER,
    timestampUtc: '2026-07-17T20:47:00.000Z',
  });
  const body = buildTrustedMailboxReceiptIndexGitHubBodyV2(record);
  assert.ok(Buffer.byteLength(body, 'utf8') <= MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES);
  assert.match(body, new RegExp(`<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`));
  assert.doesNotMatch(body, /C:\\Users|machinePath|secret\.json/i);
});


test('successor carries bounded retired terminal provenance without replaying or activating old commands', () => {
  const oldId = 'historic-owner-command-20261019T2100Z';
  const oldTerminal = {
    ...receipt({ requestId: oldId, state: 'BLOCKED',
      acceptedAt: '2026-10-19T20:58:00.000Z',
      completedAt: '2026-10-19T21:00:00.000Z',
      blocker: 'FIXED_PROCESS_EXIT_1', issueNumber: 2808 }),
    proofRefs: ['receipts/github-command-mailbox/historic-owner-command.json'],
  };
  // The prior truth issue stores already sanitised projections, not old raw commands.
  const historyRecord = createMailboxReceiptIndexRecord({
    receipts: [oldTerminal, receipt({ requestId: 'old-pending-20261019T2059Z',
      issueNumber: 2808, state: 'ACCEPTED', completedAt: '' })],
    timestampUtc: '2026-10-19T21:10:00.000Z',
  });
  const historyBody = buildTrustedMailboxReceiptTruthIssueBody(historyRecord);
  const carried = extractRetiredMailboxTerminalReceiptsFromTruthIssueBody(historyBody);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].requestId, oldId);
  assert.equal(carried[0].state, 'BLOCKED');
  const successor = createTrustedMailboxReceiptIndexFromGitHubComments(
    [commandComment(), receiptComment()],
    { ownerLogin: OWNER, timestampUtc: '2026-10-20T00:20:00.000Z',
      priorTruthIssueBody: historyBody },
  );
  assert.equal(successor.indexedReceiptCount, 2);
  assert.equal(successor.activeReceipt, null);
  assert.ok(successor.recentReceipts.some(x => x.requestId === oldId));
  assert.ok(successor.recentReceipts.some(x => x.requestId === REQUEST_ID));
  assert.equal(successor.recentReceipts.find(x => x.requestId === oldId).state, 'BLOCKED');
  assert.doesNotMatch(buildTrustedMailboxReceiptTruthIssueBody(successor), /secret\\.json/);
});

test('malformed prior truth blocks overwrite rather than silently erasing retired receipts', () => {
  const options = { ownerLogin: OWNER, timestampUtc: '2026-10-20T00:25:00.000Z' };
  for (const priorTruthIssueBody of [
    '', '[]', '<!-- stephanos-battle-bridge-receipt-index-truth -->\\n\\x60\\x60\\x60json\\n{}\\n\\x60\\x60\\x60',
    '<!-- stephanos-battle-bridge-receipt-index-truth -->\\n\\x60\\x60\\x60json\\n{"schemaVersion":"stephanos.mailbox-receipt-index.v1","recentReceipts":null}\\n\\x60\\x60\\x60',
    'x'.repeat(17 * 1024),
  ]) {
    assert.throws(
      () => createTrustedMailboxReceiptIndexFromGitHubComments([], { ...options, priorTruthIssueBody }),
      /RETIRED_MAILBOX_RECEIPT_TRUTH_UNVERIFIED/,
    );
  }
});
