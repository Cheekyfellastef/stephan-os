import assert from 'node:assert/strict';
import test from 'node:test';

import { createMailboxReceiptIndexRecord } from './mailboxReceiptIndex.mjs';
import {
  MAILBOX_RECEIPT_GITHUB_TRUTH_ISSUE,
  MAILBOX_RECEIPT_GITHUB_TRUTH_MARKER,
  MAILBOX_RECEIPT_GITHUB_TRUTH_TITLE,
  buildTrustedMailboxReceiptTruthIssueBody,
} from './mailboxReceiptIndexGitHubMirror.mjs';

const HEAD = 'a'.repeat(40);
const TIMESTAMP = '2026-07-21T15:00:00.000Z';

function deploymentReceipt() {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'truth-proof-0001',
    operation: 'READ_DEPLOYMENT_STATUS',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    expectedHead: HEAD,
    state: 'DONE',
    acceptedAt: TIMESTAMP,
    heartbeatAt: TIMESTAMP,
    completedAt: TIMESTAMP,
    proofRefs: ['receipts/github-command-mailbox/truth-proof-0001.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'READ_DEPLOYMENT_STATUS',
      requestId: 'truth-proof-0001',
      result: {
        ok: true,
        finalVerdict: 'DEPLOYMENT_STATUS_READY',
        sourceHead: HEAD,
        branch: 'main',
        expectedHeadMatch: true,
        proofRefs: ['proof/deployment/truth-proof-0001.json'],
      },
    },
  };
}

test('dedicated mailbox receipt truth issue identity is fixed and source controlled', () => {
  assert.equal(MAILBOX_RECEIPT_GITHUB_TRUTH_ISSUE, 1575);
  assert.equal(MAILBOX_RECEIPT_GITHUB_TRUTH_TITLE, 'Telemetry: Battle Bridge mailbox receipt truth');
  assert.equal(MAILBOX_RECEIPT_GITHUB_TRUTH_MARKER, 'stephanos-battle-bridge-receipt-index-truth');
});

test('truth issue body exposes the bounded sanitized latest receipt projection', () => {
  const record = createMailboxReceiptIndexRecord({
    receipts: [deploymentReceipt()],
    timestampUtc: TIMESTAMP,
  });
  const body = buildTrustedMailboxReceiptTruthIssueBody(record);
  const match = body.match(/```json\s*([\s\S]*?)```/i);

  assert.match(body, new RegExp(`<!-- ${MAILBOX_RECEIPT_GITHUB_TRUTH_MARKER} -->`));
  assert.ok(match, 'truth issue body must contain one JSON projection');
  assert.ok(Buffer.byteLength(body, 'utf8') < 10 * 1024, 'truth issue body must remain bounded');

  const projection = JSON.parse(match[1]);
  assert.equal(projection.status, 'READY');
  assert.equal(projection.activeReceipt, null);
  assert.equal(projection.recentReceipts[0].requestId, 'truth-proof-0001');
  assert.equal(projection.recentReceipts[0].sourceHead, HEAD);
  assert.equal(projection.recentReceipts[0].expectedHead, HEAD);
  assert.equal(projection.recentReceipts[0].expectedHeadMatch, true);
  assert.equal(projection.recentReceipts[0].finalVerdict, 'DEPLOYMENT_STATUS_READY');
  assert.equal(projection.arbitraryFilesystemAccess, false);
  assert.equal(projection.commandExecutionAccess, false);
  assert.equal(projection.sourceMutationAccess, false);
  assert.doesNotMatch(body, /secret|token|password|credential/i);
});
