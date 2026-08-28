import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOperatorDecision } from '../../shared/agents/operatorAutomationLayer.mjs';
import {
  fingerprintOperatorDecision,
  readOperatorApprovalInbox,
  recordOperatorApprovalDecision,
} from './operatorApprovalInboxService.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = 'b'.repeat(40);
const NOW_MS = Date.parse('2026-08-27T10:00:00.000Z');

function decision() {
  return createOperatorDecision({
    decisionId: 'merge-pr-2032-bbbbbbbbbbbb',
    decisionKind: 'MERGE_APPROVAL',
    relatedGoal: 'PR #2032',
    relatedPr: '#2032',
    expectedHeadSha: HEAD,
    summary: 'Approve protected merge progression for PR #2032.',
  });
}

function feed(root, approval = decision()) {
  return {
    state: 'ready',
    reason: 'LIVE_PROGRAMME_PORTFOLIO_CURRENT',
    workspaceRoot: root,
    projection: {
      goals: [{ source: 'github-live-open-pr', prNumber: 2032, exactHead: HEAD, statusTruth: 'CURRENT', proofTruth: 'CURRENT' }],
      operatorAttention: {
        approvals: [approval],
        maintenanceActions: [{ actionId: 'maintain-1287', owner: 'codex-housekeeper', operatorDecisionRequired: false }],
      },
    },
  };
}

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'operator-approval-inbox-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'shared-workspace');
  return { root, options: { feed: feed(root), root, repoRoot: REPO_ROOT, nowMs: NOW_MS } };
}

test('inbox exposes human decision cards and separates routine maintenance', async (t) => {
  const { options } = await fixture(t);
  const inbox = await readOperatorApprovalInbox(options);

  assert.equal(inbox.pendingCount, 1);
  assert.equal(inbox.decisions[0].title, 'Protected merge #2032');
  assert.match(inbox.decisions[0].question, /version bbbbbbbb/);
  assert.equal(inbox.decisions[0].protectedFollowUpRequired, true);
  assert.equal(inbox.maintenanceActions[0].owner, 'codex-housekeeper');
  assert.equal(inbox.actionExecutionAllowed, false);
});

test('approve writes one exact-decision receipt and a Stephanos handoff, then retries idempotently', async (t) => {
  const { root, options } = await fixture(t);
  const request = decision();
  const input = {
    decisionId: request.decisionId,
    action: 'APPROVE',
    commandId: 'operator-click-001',
    requestFingerprint: fingerprintOperatorDecision(request),
    reason: '',
  };

  const first = await recordOperatorApprovalDecision(input, options);
  const second = await recordOperatorApprovalDecision(input, options);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.actionExecuted, false);
  assert.equal(first.protectedFollowUpRequired, true);
  assert.equal(second.duplicate, true);

  const receiptNames = (await readdir(join(root, 'receipts'))).filter((name) => name.startsWith('operator-decision-') && name.endsWith('.json'));
  const handoffNames = (await readdir(join(root, 'inbox'))).filter((name) => name.endsWith('-stephanos.json'));
  assert.equal(receiptNames.length, 1);
  assert.equal(handoffNames.length, 1);
  const handoff = JSON.parse(await readFile(join(root, 'inbox', handoffNames[0]), 'utf8'));
  assert.equal(handoff.toParticipantId, 'stephanos');
  const handoffBody = JSON.parse(handoff.body);
  assert.equal(handoffBody.actionExecuted, false);
  assert.equal(handoffBody.codexMeterRequired, false);
  assert.equal(handoffBody.reconciliationAuthority, 'durable-flywheel-controller');
  assert.equal(handoffBody.capacityRouterSchemaVersion, 'stephanos.mission-controller-capacity-router.v1');

  const refreshed = await readOperatorApprovalInbox(options);
  assert.equal(refreshed.pendingCount, 0);
  assert.equal(refreshed.decisions[0].status, 'APPROVED');
});

test('a failed Stephanos handoff leaves an unrouted outbox receipt and remains safely retryable', async (t) => {
  const { root, options } = await fixture(t);
  const request = decision();
  const input = {
    decisionId: request.decisionId,
    action: 'APPROVE',
    commandId: 'operator-click-outbox-retry',
    requestFingerprint: fingerprintOperatorDecision(request),
    reason: '',
  };

  await assert.rejects(
    () => recordOperatorApprovalDecision(input, {
      ...options,
      writeHandoff: async () => ({ ok: false, reason: 'TEST_HANDOFF_WRITE_FAILED' }),
    }),
    (error) => error?.statusCode === 503 && error?.code === 'STEPHANOS_HANDOFF_FAILED',
  );

  const namesAfterFailure = await readdir(join(root, 'receipts'));
  assert.equal(namesAfterFailure.filter((name) => name.endsWith('.pending.json')).length, 1);
  assert.equal(namesAfterFailure.filter((name) => name.startsWith('operator-decision-') && !name.endsWith('.pending.json')).length, 0);
  const pending = JSON.parse(await readFile(join(root, 'receipts', namesAfterFailure.find((name) => name.endsWith('.pending.json'))), 'utf8'));
  assert.equal(pending.routedToCodex, false);
  assert.equal(pending.routedToStephanos, false);
  const inboxAfterFailure = await readOperatorApprovalInbox(options);
  assert.equal(inboxAfterFailure.pendingCount, 1);
  assert.equal(inboxAfterFailure.decisions[0].receipt, null);
  assert.equal(inboxAfterFailure.decisions[0].actionable, true);
  assert.equal((await readdir(join(root, 'inbox'))).filter((name) => name.endsWith('-stephanos.json')).length, 0);
  await assert.rejects(
    () => recordOperatorApprovalDecision({ ...input, action: 'DENY', commandId: 'operator-click-outbox-conflict' }, options),
    (error) => error?.statusCode === 409 && error?.code === 'DECISION_ALREADY_RECORDED',
  );

  const recovered = await recordOperatorApprovalDecision(input, options);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.duplicate, true);
  assert.equal(recovered.routedToCodex, false);
  assert.equal(recovered.routedToStephanos, true);
  const namesAfterRecovery = await readdir(join(root, 'receipts'));
  assert.equal(namesAfterRecovery.filter((name) => name.endsWith('.pending.json')).length, 0);
  assert.equal(namesAfterRecovery.filter((name) => name.startsWith('operator-decision-') && name.endsWith('.json')).length, 1);
  const refreshed = await readOperatorApprovalInbox(options);
  assert.equal(refreshed.pendingCount, 0);
  assert.equal(refreshed.decisions[0].receipt.routedToCodex, false);
  assert.equal(refreshed.decisions[0].receipt.routedToStephanos, true);
});

test('approve and deny stay available when the Codex meter is empty', async (t) => {
  const approvedFixture = await fixture(t);
  const approvedRequest = decision();
  const approved = await recordOperatorApprovalDecision({
    decisionId: approvedRequest.decisionId,
    action: 'APPROVE',
    commandId: 'operator-click-zero-codex-approve',
    requestFingerprint: fingerprintOperatorDecision(approvedRequest),
  }, {
    ...approvedFixture.options,
    codexStatus: { remainingPercent: 0, availability: 'METER_STALLED' },
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.routedToStephanos, true);
  assert.equal(approved.routedToCodex, false);
  assert.equal(approved.codexMeterRequired, false);

  const deniedFixture = await fixture(t);
  const deniedRequest = decision();
  const denied = await recordOperatorApprovalDecision({
    decisionId: deniedRequest.decisionId,
    action: 'DENY',
    commandId: 'operator-click-zero-codex-deny',
    requestFingerprint: fingerprintOperatorDecision(deniedRequest),
  }, {
    ...deniedFixture.options,
    codexStatus: { remainingPercent: 0, availability: 'METER_STALLED' },
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.resultingStatus, 'REJECTED');
  assert.equal(denied.routedToStephanos, true);
  assert.equal(denied.codexMeterRequired, false);
});

test('a conflicting second decision and a stale fingerprint both fail closed', async (t) => {
  const { options } = await fixture(t);
  const request = decision();
  const base = {
    decisionId: request.decisionId,
    commandId: 'operator-click-002',
    requestFingerprint: fingerprintOperatorDecision(request),
  };
  await recordOperatorApprovalDecision({ ...base, action: 'APPROVE' }, options);
  await assert.rejects(
    () => recordOperatorApprovalDecision({ ...base, commandId: 'operator-click-003', action: 'DENY' }, options),
    (error) => error?.statusCode === 409 && error?.code === 'DECISION_ALREADY_RECORDED',
  );

  const another = await fixture(t);
  await assert.rejects(
    () => recordOperatorApprovalDecision({ ...base, action: 'APPROVE', requestFingerprint: 'c'.repeat(64) }, another.options),
    (error) => error?.statusCode === 409 && error?.code === 'STALE_DECISION',
  );
});

test('non-merge decision controls fail closed when the feed is stale', async (t) => {
  const { root, options } = await fixture(t);
  const restart = createOperatorDecision({
    decisionId: 'restart-backend-001',
    decisionKind: 'SERVICE_RESTART_APPROVAL',
    relatedGoal: '#1281',
    exactApprovalText: 'APPROVE SERVICE RESTART',
    summary: 'Restart the bounded backend.',
  });
  const staleFeed = { ...feed(root, restart), state: 'stale', reason: 'STALE_WORKSPACE_RECORDS' };
  const staleOptions = { ...options, feed: staleFeed };
  const inbox = await readOperatorApprovalInbox(staleOptions);
  assert.equal(inbox.decisions[0].pending, true);
  assert.equal(inbox.decisions[0].actionable, false);
  await assert.rejects(
    () => recordOperatorApprovalDecision({
      decisionId: restart.decisionId,
      action: 'APPROVE',
      commandId: 'operator-click-stale',
      requestFingerprint: fingerprintOperatorDecision(restart),
    }, staleOptions),
    (error) => error?.statusCode === 409 && error?.code === 'DECISION_EVIDENCE_NOT_CURRENT',
  );
});

test('expired decisions remain visible but cannot write a receipt', async (t) => {
  const { root, options } = await fixture(t);
  const expired = createOperatorDecision({
    decisionId: 'restart-backend-expired',
    decisionKind: 'SERVICE_RESTART_APPROVAL',
    relatedGoal: '#1281',
    exactApprovalText: 'APPROVE SERVICE RESTART',
    expiresAtUtc: '2026-08-27T09:59:59.000Z',
    summary: 'Restart the bounded backend.',
  });
  const expiredOptions = { ...options, feed: feed(root, expired) };
  const inbox = await readOperatorApprovalInbox(expiredOptions);
  assert.equal(inbox.decisions[0].pending, true);
  assert.equal(inbox.decisions[0].actionable, false);
  await assert.rejects(
    () => recordOperatorApprovalDecision({
      decisionId: expired.decisionId,
      action: 'DENY',
      commandId: 'operator-click-expired',
      requestFingerprint: fingerprintOperatorDecision(expired),
    }, expiredOptions),
    (error) => error?.code === 'DECISION_EVIDENCE_NOT_CURRENT',
  );
});
