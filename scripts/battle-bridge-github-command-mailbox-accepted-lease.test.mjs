import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER,
  MAILBOX_ACCEPTED_LEASE_MS,
  reconcileStaleAcceptedMailboxReceipts,
} from './battle-bridge-github-command-mailbox-with-receipt-index.mjs';
import { createWindowsSafeMailboxReceiptFilename } from '../shared/agents/windowsSafeMailboxReceiptFilename.mjs';

const HEAD = 'a'.repeat(40);

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'mailbox-accepted-lease-'));
  const mailboxWorkspaceRoot = join(root, 'mailbox-workspace');
  const workspaceRoot = join(root, 'shared-workspace');
  const stateRoot = join(mailboxWorkspaceRoot, 'github-command-mailbox');
  const receiptRoot = join(workspaceRoot, 'receipts', 'github-command-mailbox');
  await mkdir(stateRoot, { recursive: true });
  await mkdir(receiptRoot, { recursive: true });
  const env = {
    STEPHANOS_SHARED_WORKSPACE_ROOT: mailboxWorkspaceRoot,
    STEPHANOS_SHARED_AGENT_WORKSPACE: workspaceRoot,
  };
  try { return await fn({ root, env, stateRoot, receiptRoot }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function acceptedReceipt(requestId, acceptedAt) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId,
    operation: 'READ_SHARED_WORKSPACE_STATUS',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    state: 'ACCEPTED',
    acceptedAt,
    heartbeatAt: acceptedAt,
    completedAt: '',
    expectedHead: HEAD,
    blocker: '',
    proofRefs: [],
    result: null,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
  };
}

async function writeState(stateRoot, state) {
  await writeFile(join(stateRoot, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function writeReceipt(receiptRoot, receipt) {
  const filename = createWindowsSafeMailboxReceiptFilename(receipt.requestId);
  await writeFile(join(receiptRoot, filename), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return join(receiptRoot, filename);
}

test('stale ACCEPTED ownership is terminalized without replay and queued for publication', async () => fixture(async ({ env, stateRoot, receiptRoot }) => {
  const requestId = 'accepted-stale-request-1';
  const receipt = acceptedReceipt(requestId, '2026-09-09T12:00:00.000Z');
  await writeState(stateRoot, {
    consumedRequestIds: [],
    acceptedRequestIds: [requestId],
    lastAcceptedReceipt: receipt,
    pendingReceiptPublications: [],
  });
  const receiptPath = await writeReceipt(receiptRoot, receipt);

  const result = reconcileStaleAcceptedMailboxReceipts({
    env,
    workspaceRoot: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    now: () => new Date('2026-09-09T12:21:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.expiredCount, 1);
  assert.equal(result.reconciledCount, 1);
  assert.equal(result.replayPerformed, false);
  assert.equal(result.duplicateMutationAllowed, false);

  const state = JSON.parse(await readFile(join(stateRoot, 'state.json'), 'utf8'));
  assert.deepEqual(state.acceptedRequestIds, []);
  assert.deepEqual(state.consumedRequestIds, [requestId]);
  assert.equal(state.pendingReceiptPublications.length, 1);
  assert.equal(state.pendingReceiptPublications[0].receipt.state, 'BLOCKED');
  assert.equal(state.pendingReceiptPublications[0].receipt.blocker, MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER);

  const terminal = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(terminal.state, 'BLOCKED');
  assert.equal(terminal.blocker, MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER);
  assert.equal(terminal.result.result.replayPerformed, false);
  assert.equal(terminal.result.result.duplicateMutationAllowed, false);
}));

test('fresh ACCEPTED ownership keeps duplicate suppression until its fixed lease expires', async () => fixture(async ({ env, stateRoot, receiptRoot }) => {
  const requestId = 'accepted-fresh-request-1';
  const receipt = acceptedReceipt(requestId, '2026-09-09T12:02:00.000Z');
  await writeState(stateRoot, {
    consumedRequestIds: [],
    acceptedRequestIds: [requestId],
    lastAcceptedReceipt: receipt,
  });
  await writeReceipt(receiptRoot, receipt);

  const result = reconcileStaleAcceptedMailboxReceipts({
    env,
    workspaceRoot: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    now: () => new Date('2026-09-09T12:21:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.freshCount, 1);
  assert.equal(result.expiredCount, 0);
  const state = JSON.parse(await readFile(join(stateRoot, 'state.json'), 'utf8'));
  assert.deepEqual(state.acceptedRequestIds, [requestId]);
  assert.deepEqual(state.consumedRequestIds, []);
}));

test('terminal local truth clears stranded accepted state without executing again', async () => fixture(async ({ env, stateRoot, receiptRoot }) => {
  const requestId = 'accepted-terminal-request-1';
  const receipt = {
    ...acceptedReceipt(requestId, '2026-09-09T12:00:00.000Z'),
    state: 'DONE',
    heartbeatAt: '2026-09-09T12:00:05.000Z',
    completedAt: '2026-09-09T12:00:05.000Z',
    result: { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', result: { ok: true } },
  };
  await writeState(stateRoot, {
    consumedRequestIds: [],
    acceptedRequestIds: [requestId],
    lastAcceptedReceipt: acceptedReceipt(requestId, '2026-09-09T12:00:00.000Z'),
  });
  await writeReceipt(receiptRoot, receipt);

  const result = reconcileStaleAcceptedMailboxReceipts({
    env,
    workspaceRoot: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    now: () => new Date('2026-09-09T12:21:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reconciledCount, 1);
  assert.equal(result.expiredCount, 0);
  assert.equal(result.replayPerformed, false);
  const state = JSON.parse(await readFile(join(stateRoot, 'state.json'), 'utf8'));
  assert.deepEqual(state.acceptedRequestIds, []);
  assert.deepEqual(state.consumedRequestIds, [requestId]);
}));

test('missing accepted receipt fails closed after the lease instead of replaying an unknown mutation', async () => fixture(async ({ env, stateRoot }) => {
  const requestId = 'accepted-missing-request-1';
  await writeState(stateRoot, {
    consumedRequestIds: [],
    acceptedRequestIds: [requestId],
    pendingReceiptPublications: [],
  });

  const result = reconcileStaleAcceptedMailboxReceipts({
    env,
    workspaceRoot: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    now: () => new Date('2026-09-09T12:21:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.expiredCount, 1);
  assert.equal(result.replayPerformed, false);
  const state = JSON.parse(await readFile(join(stateRoot, 'state.json'), 'utf8'));
  assert.deepEqual(state.acceptedRequestIds, []);
  assert.deepEqual(state.consumedRequestIds, [requestId]);
  assert.equal(state.lastReceipt.operation, 'UNKNOWN');
  assert.equal(state.lastReceipt.blocker, MAILBOX_ACCEPTED_LEASE_EXPIRED_BLOCKER);
}));

test('accepted lease cannot be shortened below the fixed production recovery boundary', async () => fixture(async ({ env, stateRoot }) => {
  await writeState(stateRoot, { consumedRequestIds: [], acceptedRequestIds: [] });
  const result = reconcileStaleAcceptedMailboxReceipts({
    env,
    workspaceRoot: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    now: () => new Date('2026-09-09T12:21:00.000Z'),
    leaseMs: MAILBOX_ACCEPTED_LEASE_MS - 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_ACCEPTED_LEASE_CONFIG_INVALID');
}));

test('invalid persisted mailbox state blocks instead of silently forgetting accepted ownership', async () => fixture(async ({ env, stateRoot }) => {
  await writeFile(join(stateRoot, 'state.json'), '{not-json', 'utf8');
  const result = reconcileStaleAcceptedMailboxReceipts({
    env,
    workspaceRoot: env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    now: () => new Date('2026-09-09T12:21:00.000Z'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_STATE_INVALID');
}));
