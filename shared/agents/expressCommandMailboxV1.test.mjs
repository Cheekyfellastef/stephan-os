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
  validateExpressCommandRecordV1,
} from './expressCommandMailboxV1.mjs';
import {
  drainExpressCommandMailboxV1,
  processExpressCommandV1,
  reconcileDurableReceiptV1,
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
});
test('goal admission converges on the canonical Goal Store', async () => {
  const root = await workspace();
  const goalPayload = {
    issueNumber: 2487,
    title: 'Express command mailbox convergence proof',
    repository: 'Cheekyfellastef/stephan-os',
    prerequisites: [],
    priority: 80,
    criticalPathWeight: 90,
    reversibility: 'REVERSIBLE',
  };
  const first = command({
    commandId: 'express-test-goal-a',
    missionId: 'goal-2487',
    operation: EXPRESS_COMMAND_OPERATION.ADMIT_GOAL,
    relatedIssue: 2487,
    payload: goalPayload,
  });
  const firstResult = await processExpressCommandV1(root, first.record, {
    repoRoot: REPO,
    nowMs: Date.parse(NOW),
    timestampUtc: NOW,
  });
  assert.equal(firstResult.ok, true);

  const goal = JSON.parse(await readFile(join(root, 'goals', 'goal-2487.json'), 'utf8'));
  assert.equal(goal.issueNumber, 2487);
  assert.equal(goal.title, goalPayload.title);
  const later = '2026-09-28T11:31:00.000Z';
  const second = command({
    commandId: 'express-test-goal-b',
    missionId: 'goal-2487',
    operation: EXPRESS_COMMAND_OPERATION.ADMIT_GOAL,
    relatedIssue: 2487,
    payload: goalPayload,
    timestampUtc: later,
  });
  const secondResult = await processExpressCommandV1(root, second.record, {
    repoRoot: REPO,
    nowMs: Date.parse(later),
    timestampUtc: later,
  });
  assert.equal(secondResult.ok, true);
  assert.equal(
    secondResult.reason,
    'EXPRESS_GOAL_ALREADY_ADMITTED_BY_OTHER_PATH',
  );

  const unchanged = JSON.parse(await readFile(join(root, 'goals', 'goal-2487.json'), 'utf8'));
  assert.equal(unchanged.timestampUtc, NOW);
});
test('Path Guardian reports BOTH after the durable mailbox receipt appears', async () => {
  const root = await workspace();
  const built = command({ commandId: 'express-test-both' });
  const durableRoot = join(root, 'receipts', 'github-command-mailbox');
  await mkdir(durableRoot, { recursive: true });
  await writeFile(
    join(durableRoot, 'express-test-both.json'),
    JSON.stringify({ requestId: 'express-test-both', ok: true }),
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
  await writeFile(join(durableRoot, 'express-test-late-durable.json'), '{}', 'utf8');

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
