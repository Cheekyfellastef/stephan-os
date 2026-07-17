import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MAILBOX_RECEIPT_INDEX_ACCESS_POLICY,
  readMailboxReceiptIndexForParticipant,
} from './mailboxReceiptIndexAccess.mjs';
import { refreshMailboxReceiptIndex } from './mailboxReceiptIndex.mjs';

const HEAD = 'b3aca072a1c66555a1a2d3b4343f218af8d33ef4';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'mailbox-index-access-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  const timestampUtc = new Date().toISOString();
  await mkdir(repoRoot, { recursive: true });
  const receiptRoot = join(workspaceRoot, 'receipts', 'github-command-mailbox');
  await mkdir(receiptRoot, { recursive: true });
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'mailbox-index-access-20260717T2000Z',
    operation: 'READ_SHARED_WORKSPACE_STATUS',
    branch: 'main',
    expectedHead: HEAD,
    state: 'DONE',
    acceptedAt: timestampUtc,
    heartbeatAt: timestampUtc,
    completedAt: timestampUtc,
    proofRefs: ['receipts/github-command-mailbox/mailbox-index-access-20260717T2000Z.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'SHARED_WORKSPACE_STATUS_READY',
        sourceHead: HEAD,
        branch: 'main',
        expectedHeadMatch: true,
      },
    },
  };
  await writeFile(join(receiptRoot, `${receipt.requestId}.json`), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  await refreshMailboxReceiptIndex({ root: workspaceRoot, repoRoot, timestampUtc });
  try { return await fn({ repoRoot, workspaceRoot }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('unauthenticated and malformed participants fail closed', async () => fixture(async ({ repoRoot, workspaceRoot }) => {
  const unauthenticated = await readMailboxReceiptIndexForParticipant({
    participantId: 'chatgpt',
    authenticated: false,
    root: workspaceRoot,
    repoRoot,
  });
  assert.equal(unauthenticated.ok, false);
  assert.equal(unauthenticated.blocker, 'MAILBOX_RECEIPT_INDEX_AUTHENTICATION_REQUIRED');

  const malformed = await readMailboxReceiptIndexForParticipant({
    participantId: '../escape',
    authenticated: true,
    root: workspaceRoot,
    repoRoot,
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.blocker, 'MAILBOX_RECEIPT_INDEX_PARTICIPANT_ID_INVALID');
}));

test('any authenticated safe Shared Workspace participant receives the same bounded projection', async () => fixture(async ({ repoRoot, workspaceRoot }) => {
  for (const participantId of ['stephanos', 'openclaw', 'chatgpt', 'operator', 'future-agent-42']) {
    const access = await readMailboxReceiptIndexForParticipant({
      participantId,
      authenticated: true,
      root: workspaceRoot,
      repoRoot,
    });
    assert.equal(access.ok, true);
    assert.equal(access.finalVerdict, 'MAILBOX_RECEIPT_INDEX_ACCESS_READY');
    assert.equal(access.requestedByParticipantId, participantId);
    assert.equal(access.projection.recentReceipts[0].sourceHead, HEAD);
    assert.equal(access.projection.arbitraryFilesystemAccess, false);
    assert.equal(access.projection.commandExecutionAccess, false);
    assert.equal(access.projection.sourceMutationAccess, false);
  }
}));

test('access policy exposes one fixed record and no general filesystem or command authority', () => {
  assert.deepEqual(MAILBOX_RECEIPT_INDEX_ACCESS_POLICY, {
    authenticationRequired: true,
    participantIdRequired: true,
    fixedSharedWorkspaceRecord: 'status/battle-bridge-mailbox-receipt-index.json',
    arbitraryFilesystemAccess: false,
    arbitraryPathInputAllowed: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
    mergeAuthority: false,
  });
});
