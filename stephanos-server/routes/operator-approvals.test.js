import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createOperatorDecision } from '../../shared/agents/operatorAutomationLayer.mjs';
import { fingerprintOperatorDecision } from '../services/operatorApprovalInboxService.js';
import { createOperatorApprovalsRouter } from './operator-approvals.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = 'e'.repeat(40);

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

test('approval API is closed-world and records a bounded handoff without executing the action', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'operator-approval-route-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'shared-workspace');
  const decision = createOperatorDecision({
    decisionId: 'merge-pr-2032-eeeeeeeeeeee',
    decisionKind: 'MERGE_APPROVAL',
    relatedGoal: 'PR #2032',
    relatedPr: '#2032',
    expectedHeadSha: HEAD,
    summary: 'Approve protected merge progression for PR #2032.',
  });
  const feed = {
    state: 'ready',
    reason: 'LIVE_PROGRAMME_PORTFOLIO_CURRENT',
    workspaceRoot: root,
    projection: {
      goals: [{ source: 'github-live-open-pr', prNumber: 2032, exactHead: HEAD, statusTruth: 'CURRENT', proofTruth: 'CURRENT' }],
      operatorAttention: { approvals: [decision], maintenanceActions: [] },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/operator-approvals', createOperatorApprovalsRouter({ feed, root, repoRoot: REPO_ROOT, nowMs: Date.parse('2026-08-27T10:00:00.000Z') }));
  const { server, origin } = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const inboxResponse = await fetch(`${origin}/api/operator-approvals`);
  const inbox = await inboxResponse.json();
  assert.equal(inboxResponse.status, 200);
  assert.equal(inbox.pendingCount, 1);
  assert.equal(inbox.decisions[0].actionable, true);

  const rejectedResponse = await fetch(`${origin}/api/operator-approvals/${decision.decisionId}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'APPROVE',
      commandId: 'route-click-001',
      requestFingerprint: fingerprintOperatorDecision(decision),
      arbitraryCommand: 'merge now',
    }),
  });
  const rejected = await rejectedResponse.json();
  assert.equal(rejectedResponse.status, 400);
  assert.equal(rejected.error, 'UNEXPECTED_DECISION_FIELD');
  assert.equal(rejected.actionExecuted, false);

  const acceptedResponse = await fetch(`${origin}/api/operator-approvals/${decision.decisionId}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'APPROVE',
      commandId: 'route-click-001',
      requestFingerprint: fingerprintOperatorDecision(decision),
      reason: '',
    }),
  });
  const accepted = await acceptedResponse.json();
  assert.equal(acceptedResponse.status, 200);
  assert.equal(accepted.routedToCodex, false);
  assert.equal(accepted.routedToStephanos, true);
  assert.equal(accepted.codexMeterRequired, false);
  assert.equal(accepted.actionExecuted, false);
  assert.equal(accepted.protectedActionAuthorityGranted, false);
  assert.equal(accepted.protectedFollowUpRequired, true);
});
