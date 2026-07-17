import assert from 'node:assert/strict';
import test from 'node:test';

import { MAILBOX_RECEIPT_INDEX_GITHUB_MARKER, MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES } from './mailboxReceiptIndex.mjs';
import {
  buildTrustedMailboxReceiptIndexGitHubBody,
  createTrustedMailboxReceiptIndexFromGitHubComments,
  extractTrustedMailboxCommandComment,
  extractTrustedMailboxReceiptComment,
  findTrustedMailboxReceiptIndexComment,
} from './mailboxReceiptIndexGitHubMirror.mjs';

const OWNER = 'Cheekyfellastef';
const HEAD = 'b3aca072a1c66555a1a2d3b4343f218af8d33ef4';
const REQUEST_ID = 'receipt-index-mirror-20260717T2045Z';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: REQUEST_ID,
    operation: 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
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
    issueNumber: 1507,
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

test('only owner-authored comments with exact repository, issue and branch identity are accepted', () => {
  assert.equal(extractTrustedMailboxCommandComment(commandComment(), OWNER).expectedHead, HEAD);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(), OWNER).requestId, REQUEST_ID);
  assert.equal(extractTrustedMailboxCommandComment(commandComment(command(), 'attacker'), OWNER), null);
  assert.equal(extractTrustedMailboxReceiptComment(receiptComment(receipt(), 'attacker'), OWNER), null);
  assert.equal(extractTrustedMailboxCommandComment(commandComment(command({ repository: 'other/repo' })), OWNER), null);
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
  const body = buildTrustedMailboxReceiptIndexGitHubBody(record);
  assert.ok(Buffer.byteLength(body, 'utf8') <= MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES);
  assert.match(body, new RegExp(`<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`));
  assert.doesNotMatch(body, /C:\\Users|machinePath|secret\.json/i);
});
