import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  EXPRESS_COMMAND_OPERATION,
  EXPRESS_COMMAND_TTL_MS,
  buildExpressCommandRecordV1,
  submitExpressCommandV1,
  validateDurableMailboxReceiptV1,
  validateExpressCommandRecordV1,
} from './expressCommandMailboxV1.mjs';
import {
  drainExpressCommandMailboxV1,
  EXPRESS_GUARDIAN_RETRY_DELAYS_MS,
  listExistingExpressDurableReceiptNamesV1,
  processExpressCommandV1,
  reconcileDurableReceiptV1,
  shouldRetryGuardianReconciliationV1,
} from '../../scripts/battle-bridge-express-command-mailbox.mjs';

const REPO = 'C:\\repo';
const NOW = '2026-09-28T11:30:00.000Z';

async function workspace() {
  return mkdtemp(join(tmpdir(), 'stephanos-express-mailbox-'));
}

function command(overrides = {}) {
  return buildExpressCommandRecordV1({
    commandId: 'express-test-001',
    missionId: 'mission-test-001',
    operation: EXPRESS_COMMAND_OPERATION.PING,
    payload: {},
    ...overrides,
  }, { timestampUtc: overrides.timestampUtc || NOW });
}
function durableReceipt(commandId, overrides = {}) {
  const proofRef = 'receipts/github-command-mailbox/' + commandId + '.json';
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: commandId,
    operation: 'READ_SHARED_WORKSPACE_STATUS',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    state: 'DONE',
    proofRefs: [proofRef],
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    ...overrides,
  };
}

test('express command contract accepts ping but refuses an arbitrary operation', () => {
  const ping = command();
  assert.equal(ping.ok, true);
  assert.equal(ping.record.operation, 'PING');
  assert.equal(ping.record.mergeAuthority, false);
  assert.equal(ping.record.arbitraryShellAllowed, false);

  const raw = command({
    commandId: 'express-test-raw',
    operation: 'RUN_SHELL',
    payload: { command: 'whoami' },
  });
  assert.equal(raw.ok, false);
  assert.ok(raw.blockers.includes('express-operation-not-allowlisted'));
});

test('authority widening invalidates an otherwise valid express record', () => {
  const built = command({ commandId: 'express-test-authority' });
  const widened = { ...built.record, mergeAuthority: true };
  const validation = validateExpressCommandRecordV1(widened, {
    nowMs: Date.parse(NOW),
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.blockers.includes('express-authority-widened'));
});
test('ping is processed once and duplicate delivery is suppressed', async () => {
  const root = await workspace();
  const built = command({ commandId: 'express-test-ping-once' });
  assert.equal(built.ok, true);

  const first = await processExpressCommandV1(root, built.record, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(first.ok, true);
  assert.equal(first.reason, 'EXPRESS_PING_ACKNOWLEDGED');
  assert.equal(first.guardian.deliveryClass, 'EXPRESS_ONLY');

  const second = await processExpressCommandV1(root, built.record, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(second.ok, true);
  assert.equal(second.duplicateSuppressed, true);
  assert.equal(second.reason, 'EXPRESS_COMMAND_ALREADY_PROCESSED');
});
test('handoff enters the canonical shared workspace inbox with proof', async () => {
  const root = await workspace();
  const built = command({
    commandId: 'express-test-handoff',
    operation: EXPRESS_COMMAND_OPERATION.HANDOFF,
    relatedIssue: 2486,
    recipient: 'stephanos',
    payload: { intent: 'continue canonical goal execution' },
  });
  assert.equal(built.ok, true);

  const result = await processExpressCommandV1(root, built.record, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(result.ok, true);

  const handoff = JSON.parse(await readFile(
    join(root, 'inbox', 'express-handoff-express-test-handoff.json'),
    'utf8',
  ));
  assert.equal(handoff.correlationId, 'express-test-handoff');
  assert.equal(handoff.toParticipantId, 'stephanos');
  assert.equal(handoff.relatedIssue, '#2486');
  assert.deepEqual(handoff.proofRefs, ['proof/express-ingress-express-test-handoff.json']);
  const proof = JSON.parse(await readFile(
    join(root, 'proof', 'express-ingress-express-test-handoff.json'),
    'utf8',
  ));
  assert.equal(proof.status, 'OBSERVED');
  assert.match(proof.summary, /grants no scheduler authority/i);
});
test('express transport cannot directly admit scheduler goals', async () => {
  const root = await workspace();
  const built = command({
    commandId: 'express-test-goal-blocked',
    operation: 'ADMIT_GOAL',
    relatedIssue: 2487,
    payload: {
      issueNumber: 2487,
      title: 'This must remain scheduler-governed',
      repository: 'Cheekyfellastef/stephan-os',
    },
  });
  assert.equal(built.ok, false);
  assert.ok(built.blockers.includes('express-operation-not-allowlisted'));
  await assert.rejects(
    readFile(join(root, 'goals', 'goal-2487.json'), 'utf8'),
    { code: 'ENOENT' },
  );
});

test('Path Guardian reports BOTH after the durable mailbox receipt appears', async () => {
  const root = await workspace();
  const built = command({ commandId: 'express-test-both' });
  const durableRoot = join(root, 'receipts', 'github-command-mailbox');
  await mkdir(durableRoot, { recursive: true });
  await writeFile(
    join(durableRoot, 'express-test-both.json'),
    JSON.stringify(durableReceipt('express-test-both')),
    'utf8',
  );

  const result = await processExpressCommandV1(root, built.record, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.guardian.deliveryClass, 'BOTH');
  assert.deepEqual(result.guardian.routes, ['EXPRESS', 'DURABLE']);
  assert.equal(
    result.guardian.durableProofRef,
    'receipts/github-command-mailbox/express-test-both.json',
  );
});

test('drain consumes completed commands into archive instead of rescanning forever', async () => {
  const root = await workspace();
  const built = command({ commandId: 'express-test-archive' });
  await mkdir(join(root, 'commands'), { recursive: true });
  await writeFile(
    join(root, 'commands', 'express-command-express-test-archive.json'),
    JSON.stringify(built.record),
    'utf8',
  );

  const drained = await drainExpressCommandMailboxV1(root, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(drained.ok, true);
  assert.equal(drained.processed.length, 1);
  assert.equal(drained.processed[0].archive.ok, true);

  const archived = JSON.parse(await readFile(
    join(root, 'archive', 'express-command-express-test-archive.json'),
    'utf8',
  ));
  assert.equal(archived.commandId, 'express-test-archive');
  await assert.rejects(
    readFile(join(root, 'commands', 'express-command-express-test-archive.json'), 'utf8'),
    { code: 'ENOENT' },
  );
});

test('late durable delivery upgrades an archived express command to BOTH', async () => {
  const root = await workspace();
  const built = command({ commandId: 'express-test-late-durable' });
  await mkdir(join(root, 'commands'), { recursive: true });
  await writeFile(
    join(root, 'commands', 'express-command-express-test-late-durable.json'),
    JSON.stringify(built.record),
    'utf8',
  );
  const drained = await drainExpressCommandMailboxV1(root, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(drained.processed[0].guardian.deliveryClass, 'EXPRESS_ONLY');


  const durableRoot = join(root, 'receipts', 'github-command-mailbox');
  await mkdir(durableRoot, { recursive: true });
  await writeFile(
    join(durableRoot, 'express-test-late-durable.json'),
    JSON.stringify(durableReceipt('express-test-late-durable')),
    'utf8',
  );

  const reconciled = await reconcileDurableReceiptV1(
    root,
    'express-test-late-durable.json',
    { repoRoot: REPO, nowMs: Date.parse(NOW), timestampUtc: NOW },
  );
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.reason, 'EXPRESS_PATH_GUARDIAN_BOTH_OBSERVED');
  assert.equal(reconciled.guardian.deliveryClass, 'BOTH');
});

test('canonical submit API writes a validated command into the hot mailbox', async () => {
  const root = await workspace();
  const submitted = await submitExpressCommandV1(root, {
    commandId: 'express-test-submit',
    missionId: 'mission-test-submit',
    operation: EXPRESS_COMMAND_OPERATION.PING,
    payload: {},
  }, {
    repoRoot: REPO,
    timestampUtc: NOW,
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.reason, 'EXPRESS_COMMAND_SUBMITTED');

  const record = JSON.parse(await readFile(
    join(root, 'commands', 'express-command-express-test-submit.json'),
    'utf8',
  ));
  assert.equal(record.commandId, 'express-test-submit');
  assert.equal(record.sourceTransport, 'REMOTE_COMMANDER');
});

test('expired express commands fail closed instead of replaying after restart', () => {
  const built = command({ commandId: 'express-test-expired' });
  const validation = validateExpressCommandRecordV1(built.record, {
    nowMs: Date.parse(NOW) + EXPRESS_COMMAND_TTL_MS + 1,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.blockers.includes('express-command-expired'));

  const auditOnly = validateExpressCommandRecordV1(built.record, {
    nowMs: Date.parse(NOW) + EXPRESS_COMMAND_TTL_MS + 1,
    allowExpired: true,
  });
  assert.equal(auditOnly.ok, true);
});

test('durable delivery requires canonical receipt identity and proof', () => {
  const valid = validateDurableMailboxReceiptV1(
    durableReceipt('express-test-durable-validation'),
    'express-test-durable-validation',
  );
  assert.equal(valid.ok, true);

  const empty = validateDurableMailboxReceiptV1({}, 'express-test-durable-validation');
  assert.equal(empty.ok, false);
  assert.ok(empty.blockers.includes('durable-receipt-schema-invalid'));

  const mismatched = validateDurableMailboxReceiptV1(
    durableReceipt('different-command'),
    'express-test-durable-validation',
  );
  assert.equal(mismatched.ok, false);
  assert.ok(mismatched.blockers.includes('durable-receipt-request-identity-mismatch'));
});

test('restart reconciliation discovers only durable receipts for archived express commands', async () => {
  const root = await workspace();
  await mkdir(join(root, 'archive'), { recursive: true });
  await mkdir(join(root, 'receipts', 'github-command-mailbox'), { recursive: true });
  const built = command({ commandId: 'express-test-restart-reconcile' });
  await writeFile(
    join(root, 'archive', 'express-command-express-test-restart-reconcile.json'),
    JSON.stringify(built.record),
    'utf8',
  );
  await writeFile(
    join(root, 'receipts', 'github-command-mailbox', 'express-test-restart-reconcile.json'),
    JSON.stringify(durableReceipt('express-test-restart-reconcile')),
    'utf8',
  );
  await writeFile(
    join(root, 'receipts', 'github-command-mailbox', 'unrelated.json'),
    JSON.stringify(durableReceipt('unrelated')),
    'utf8',
  );

  const names = await listExistingExpressDurableReceiptNamesV1(root, { repoRoot: REPO });
  assert.deepEqual(names, ['express-test-restart-reconcile.json']);
});

test('guardian reconciliation retry is bounded', () => {
  const notConfirmed = { ok: true, reason: 'EXPRESS_PATH_GUARDIAN_DURABLE_NOT_CONFIRMED' };
  assert.equal(shouldRetryGuardianReconciliationV1(notConfirmed, 0), true);
  assert.equal(
    shouldRetryGuardianReconciliationV1(notConfirmed, EXPRESS_GUARDIAN_RETRY_DELAYS_MS.length),
    false,
  );
  assert.equal(shouldRetryGuardianReconciliationV1({ ok: true, reason: 'EXPRESS_PATH_GUARDIAN_BOTH_OBSERVED' }, 0), false);
});
