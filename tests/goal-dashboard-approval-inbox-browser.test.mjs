import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';

const dashboardHtml = await readFile(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');
const HEAD = 'd'.repeat(40);

function canonicalDecision({ decisionId, decisionKind, relatedPr = '', expectedHeadSha = '', summary }) {
  return {
    schemaVersion: 'operator-automation-layer.v1',
    kind: 'stephanos.operator_automation.decision',
    decisionId,
    decisionKind,
    status: 'WAITING_FOR_OPERATOR_APPROVAL',
    relatedGoal: relatedPr || '#1281',
    relatedPr,
    expectedHeadSha,
    summary,
    requiresOperator: true,
    exactApprovalText: relatedPr ? `APPROVE MERGE PR ${relatedPr} EXACT HEAD ${expectedHeadSha}` : 'APPROVE SERVICE RESTART',
    exactUnblockAction: '',
    expiresAtUtc: '',
    sharedWorkspaceMessage: {},
  };
}

const projectionDecisions = [
  canonicalDecision({ decisionId: 'merge-pr-2032-dddddddddddd', decisionKind: 'MERGE_APPROVAL', relatedPr: '#2032', expectedHeadSha: HEAD, summary: 'Approve protected merge progression for PR #2032.' }),
  canonicalDecision({ decisionId: 'restart-backend-001', decisionKind: 'SERVICE_RESTART_APPROVAL', summary: 'Restart the bounded backend after proof is ready.' }),
];

const maintenanceActions = [{
  actionId: 'maintain-1287',
  actionClass: 'EVIDENCE_MAINTENANCE',
  relatedGoal: '#1287',
  title: 'Verification Harness evidence',
  summary: 'The saved proof record needs refreshing.',
  exactNextAction: 'Codex and Housekeeper should publish current proof.',
  blockers: ['STALE_PROOF_RECORD'],
  owner: 'codex-housekeeper',
  operatorDecisionRequired: false,
}];

const feed = {
  schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
  state: 'ready',
  reason: 'LIVE_PROGRAMME_PORTFOLIO_CURRENT',
  workspaceRoot: 'C:\\proof\\shared-workspace',
  records: { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [] },
  livePortfolio: { state: 'ready', source: 'LIVE_GITHUB_READ_MODEL', githubOpenPrCount: 1, workspaceGoalCount: 0 },
  projection: {
    portfolioSource: 'LIVE_GITHUB_PLUS_SHARED_WORKSPACE',
    queueDispatcher: { dispatcherState: 'IDLE', capabilityMode: 'AUTOMATED_GUARDED', queueDepth: 0 },
    battleBridgeSupervisor: { overallState: 'CURRENT', services: [] },
    openClawCapabilityLadder: { canRunNow: [], needsApproval: [], blocked: [] },
    captainsBridge: { buildOrchestration: {}, mergePipeline: {}, runtimeHealth: { services: [] }, workspaceDiscovery: { summary: {} } },
    goals: [{ issue: 'PR #2032', title: 'Approval inbox browser fixture', statusTruth: 'CURRENT', proofTruth: 'CURRENT', blockers: [], exactNextAction: 'Review the exact decision.', source: 'github-live-open-pr' }],
    operatorAttention: { approvals: projectionDecisions, maintenanceActions, blockers: [], exactNextAction: 'Review two genuine decisions.' },
  },
};

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Approval browser proof server did not publish a TCP address.');
  return `http://127.0.0.1:${address.port}`;
}

test('approval tab renders genuine decisions separately and sends approve and deny receipts', async (t) => {
  const recorded = new Map();
  const posts = [];
  const inbox = () => ({
    schemaVersion: 'stephanos.operator-approval-inbox.v1',
    state: 'ready',
    reason: 'LIVE_PROGRAMME_PORTFOLIO_CURRENT',
    pendingCount: 2 - recorded.size,
    resolvedCount: recorded.size,
    maintenanceActions,
    exactNextAction: recorded.size === 2 ? 'No operator decision is waiting.' : 'Review each genuine decision.',
    decisions: [
      {
        decisionId: projectionDecisions[0].decisionId,
        decisionKind: 'MERGE_APPROVAL',
        title: 'Protected merge #2032',
        question: 'Should Stephanos continue the protected merge process for #2032 at version dddddddd?',
        summary: projectionDecisions[0].summary,
        relatedPr: '#2032', expectedHeadSha: HEAD, expectedVersion: 'dddddddd', riskLevel: 'HIGH',
        status: recorded.get(projectionDecisions[0].decisionId)?.status || 'WAITING_FOR_OPERATOR_APPROVAL',
        pending: !recorded.has(projectionDecisions[0].decisionId),
        actionable: !recorded.has(projectionDecisions[0].decisionId),
        approveEffect: 'Records your decision for Stephanos. The protected gate is still required.',
        denyEffect: 'Records do not continue.', protectedFollowUpRequired: true, requestFingerprint: 'a'.repeat(64),
        receipt: recorded.get(projectionDecisions[0].decisionId)?.receipt || null,
      },
      {
        decisionId: projectionDecisions[1].decisionId,
        decisionKind: 'SERVICE_RESTART_APPROVAL',
        title: 'Restart a Stephanos service',
        question: 'Should Stephanos continue with this service restart request?',
        summary: projectionDecisions[1].summary,
        relatedGoal: '#1281', expectedVersion: '', riskLevel: 'CONSEQUENTIAL',
        status: recorded.get(projectionDecisions[1].decisionId)?.status || 'WAITING_FOR_OPERATOR_APPROVAL',
        pending: !recorded.has(projectionDecisions[1].decisionId),
        actionable: !recorded.has(projectionDecisions[1].decisionId),
        approveEffect: 'Records your decision and sends a bounded handoff to Stephanos.',
        denyEffect: 'Records do not continue.', protectedFollowUpRequired: false, requestFingerprint: 'b'.repeat(64),
        receipt: recorded.get(projectionDecisions[1].decisionId)?.receipt || null,
      },
    ],
  });

  const server = createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (path === '/apps/goal-dashboard/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(dashboardHtml);
      return;
    }
    if (path === '/api/shared-workspace/dashboard-feed') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(feed));
      return;
    }
    if (path === '/api/operator-approvals' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(inbox()));
      return;
    }
    const match = path.match(/^\/api\/operator-approvals\/([^/]+)\/decision$/);
    if (match && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const decisionId = decodeURIComponent(match[1]);
      posts.push({ decisionId, payload });
      const status = payload.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      recorded.set(decisionId, { status, receipt: { receiptId: `receipt-${decisionId}`, action: payload.action, timestampUtc: '2026-08-27T10:00:00.000Z', routedToCodex: false, routedToStephanos: true, codexMeterRequired: false } });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true, decisionId, action: payload.action, resultingStatus: status, routedToCodex: false, routedToStephanos: true, codexMeterRequired: false, actionExecuted: false, protectedActionAuthorityGranted: false, protectedFollowUpRequired: decisionId.startsWith('merge-pr-') }));
      return;
    }
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
  });

  let browser = null;
  try {
    const origin = await listen(server);
    try {
      browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    } catch (error) {
      if (/Executable doesn't exist|browser executable/i.test(String(error?.message || error))) {
        t.skip('A Playwright-compatible browser executable is required for approval inbox proof.');
        return;
      }
      throw error;
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${origin}/apps/goal-dashboard/index.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#approval-pending-count')?.textContent === '2');

    await page.getByRole('tab', { name: 'Approvals' }).click();
    assert.equal(new URL(page.url()).hash, '#approvals');
    assert.equal(await page.locator('[data-dashboard-page="approvals"]').first().isVisible(), true);
    assert.equal(await page.locator('.decision-card').count(), 2);
    assert.equal(await page.locator('.maintenance-card').count(), 1);
    assert.equal(await page.locator('#kpi-gates').textContent(), '2');
    assert.match(await page.locator('.maintenance-card').textContent(), /No approval needed/);

    const mergeCard = page.locator('.decision-card').filter({ hasText: 'Protected merge #2032' });
    await mergeCard.getByRole('button', { name: 'Approve' }).click();
    await page.waitForFunction(() => document.querySelector('#approval-resolved-count')?.textContent === '1');

    const restartCard = page.locator('.decision-card').filter({ hasText: 'Restart a Stephanos service' });
    await restartCard.locator('textarea').fill('Do not restart until the live proof is current.');
    await restartCard.getByRole('button', { name: 'Deny' }).click();
    await page.waitForFunction(() => document.querySelector('#approval-resolved-count')?.textContent === '2');

    assert.equal(posts.length, 2);
    assert.equal(posts[0].payload.action, 'APPROVE');
    assert.equal(posts[0].payload.requestFingerprint, 'a'.repeat(64));
    assert.equal(posts[1].payload.action, 'DENY');
    assert.equal(posts[1].payload.reason, 'Do not restart until the live proof is current.');
    assert.match(posts[0].payload.commandId, /^dashboard-/);
    assert.equal(await page.locator('.decision-card[data-status="APPROVED"]').count(), 1);
    assert.equal(await page.locator('.decision-card[data-status="REJECTED"]').count(), 1);
    assert.match(await page.locator('.decision-card[data-status="APPROVED"]').textContent(), /did not use the Codex meter/);
    assert.deepEqual(consoleErrors, []);
    assert.ok((await page.screenshot({ fullPage: true })).length > 10_000);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
