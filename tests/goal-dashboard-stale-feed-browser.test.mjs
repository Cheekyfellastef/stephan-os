import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';

const dashboardHtml = await readFile(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');

const staleFeed = {
  schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
  state: 'stale',
  reason: 'STALE_WORKSPACE_RECORDS',
  workspaceRoot: 'C:\\proof\\shared-workspace',
  exactNextAction: 'Refresh stale proof records.',
  records: {
    goalRecords: [],
    statusRecords: [{ statusId: 'status-1' }],
    proofRecords: [{ proofId: 'proof-1' }],
    capabilityRecords: [{ capabilityId: 'capability-1' }],
  },
  livePortfolio: {
    state: 'ready',
    source: 'LIVE_GITHUB_READ_MODEL',
    githubOpenPrCount: 2,
    workspaceGoalCount: 1,
  },
  projection: {
    portfolioSource: 'BASE_PROJECTION_FALLBACK',
    queueDispatcher: {
      dispatcherState: 'IDLE',
      capabilityMode: 'AUTOMATED_GUARDED',
      queueDepth: 2,
      currentJob: 'job-42',
    },
    battleBridgeSupervisor: {
      overallState: 'ATTENTION_REQUIRED',
      services: [{ serviceId: 'backend', state: 'STALE' }],
    },
    openClawCapabilityLadder: {
      canRunNow: ['repo_scout', 'test_runner'],
      needsApproval: ['approval_gated_writer'],
      blocked: ['pr_helper'],
      exactNextAction: 'Run a bounded scout.',
    },
    captainsBridge: {
      activeLane: { laneId: 'lane-42' },
      exactNextAction: 'Resolve the current blocker.',
      milestone: { status: 'complete_guarded', implementedGoals: ['G10', 'G11'] },
      buildOrchestration: {
        phase: 'BLOCKED',
        actor: 'OPERATOR_NEEDED',
        selectedGoal: 'G13',
        selectedLane: 'lane-42',
        signals: { BLOCKER: true, OPERATOR_NEEDED: true, CODEX_NEEDED: false },
      },
      mergePipeline: {
        phase: 'PROOF',
        prNumber: 2027,
        headSha: '0b8321de6e5a42dc3ab06c1b02c8f2c14376ecf0',
        missingEvidence: ['INDEPENDENT_REVIEW'],
        finalVerdict: 'CAPTAINS_BRIDGE_MERGE_PIPELINE_HELD',
      },
      runtimeHealth: {
        overallTrafficLight: 'AMBER',
        services: [
          { serviceId: 'mission-worker', trafficLight: 'AMBER', freshness: 'STALE' },
          { serviceId: 'shared-workspace-feed', trafficLight: 'AMBER', freshness: 'STALE' },
          { serviceId: 'dashboard', trafficLight: 'AMBER', freshness: 'STALE' },
        ],
      },
      operatorTimeline: {
        events: [{ title: 'Independent review launched', timestampUtc: '2026-08-27T08:59:55Z', detail: 'Exact-head review.' }],
        exactNextAction: 'Wait for the immutable review receipt.',
      },
      workspaceDiscovery: {
        summary: { active: 1, blocked: 1, stale: 1, orphaned: 0 },
        finalVerdict: 'WORKSPACE_DISCOVERY_PROJECTED',
      },
    },
    goals: [{
      issue: '#1291',
      title: 'Battle Bridge Supervisor',
      statusTruth: 'STALE',
      proofTruth: 'STALE',
      summary: 'Served stale browser proof fixture.',
      blockers: ['STALE_STATUS_RECORD'],
      exactNextAction: 'Refresh proof.',
    }],
    operatorAttention: {
      blockers: ['STALE_STATUS_RECORD'],
      exactNextAction: 'Refresh stale proof records.',
    },
  },
};

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser proof server did not publish a TCP address.');
  return `http://127.0.0.1:${address.port}`;
}

test('served Goal Dashboard visibly distinguishes and renders a stale canonical feed', async (t) => {
  const server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (path === '/apps/goal-dashboard/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(dashboardHtml);
      return;
    }
    if (path === '/api/shared-workspace/dashboard-feed') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(staleFeed));
      return;
    }
    if (path === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{}');
  });

  let browser = null;
  try {
    const origin = await listen(server);
    try {
      browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    } catch (error) {
      if (/Executable doesn't exist|browser executable/i.test(String(error?.message || error))) {
        t.skip('A Playwright-compatible browser executable is required for served DOM proof.');
        return;
      }
      throw error;
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    const pageErrors = [];
    const requestFailures = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('requestfailed', request => requestFailures.push(`${request.url()}: ${request.failure()?.errorText || 'unknown failure'}`));
    await page.goto(`${origin}/apps/goal-dashboard/index.html`, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => document.querySelector('#source-badge')?.textContent === 'STALE', null, { timeout: 10_000 });
    } catch (error) {
      const observed = await page.evaluate(() => ({
        badge: document.querySelector('#source-badge')?.textContent,
        goalData: document.querySelector('#goal-data-source')?.textContent,
        endpoint: document.querySelector('[data-live-telemetry-field="dashboard-feed-endpoint"]')?.textContent,
      }));
      throw new Error(`Served stale feed did not render: ${JSON.stringify({ observed, consoleErrors, pageErrors, requestFailures })}`, { cause: error });
    }

    const badge = page.locator('#source-badge');
    assert.equal(await badge.isVisible(), true);
    assert.equal(await badge.textContent(), 'STALE');
    assert.equal(await badge.getAttribute('data-truth'), 'STALE');
    assert.equal(await page.locator('#goal-grid').getAttribute('data-goal-dashboard-source-state'), 'live-shared-workspace');
    assert.equal(await page.locator('#goal-grid').getAttribute('data-goal-dashboard-feed-state'), 'stale');
    assert.equal(await page.locator('#goal-grid .goal-card').count(), 1);
    assert.equal(await page.locator('#goal-grid .goal-card h3').textContent(), 'Battle Bridge Supervisor');
    assert.match(await page.locator('#goal-grid .goal-card .human-status').textContent(), /Progress: Needs refreshing/);
    assert.match(await page.locator('#goal-grid .goal-card .human-status').textContent(), /Evidence: Needs refreshing/);
    assert.match(await page.locator('#goal-grid .goal-card .human-blocker').textContent(), /saved status record is out of date/i);
    assert.match(await page.locator('#goal-grid .goal-card .technical-details').textContent(), /Status STALE · Proof STALE/);
    assert.equal(await page.locator('[data-live-telemetry-field="telemetry-blocker"]').textContent(), 'STALE_WORKSPACE_RECORDS');
    assert.equal(await page.locator('#source-mesh .source-node').count(), 9);
    assert.equal(await page.locator('[data-source-id="shared-workspace"] output').textContent(), 'Needs refreshing');
    assert.match(await page.locator('[data-source-id="shared-workspace"] .plain-language').textContent(), /records are connected.*old.*refreshing/i);
    assert.match(await page.locator('[data-source-id="shared-workspace"] .technical-details').textContent(), /STALE · STALE_WORKSPACE_RECORDS/);
    assert.equal(await page.locator('[data-source-id="shared-workspace"]').getAttribute('data-truth'), 'STALE');
    assert.equal(await page.locator('[data-source-id="live-portfolio"] output').textContent(), 'Needs refreshing');
    assert.match(await page.locator('[data-source-id="live-portfolio"] .plain-language').textContent(), /GitHub is connected.*2 open pull requests/i);
    assert.equal(await page.locator('[data-source-id="live-portfolio"]').getAttribute('data-truth'), 'STALE');
    const openClawCopy = await page.locator('[data-source-id="openclaw"] .plain-language').textContent();
    assert.match(openClawCopy, /capacity report needs refreshing.*last listed 2 runnable/i);
    assert.doesNotMatch(openClawCopy, /can run now/i);
    assert.match(await page.locator('[data-source-id="dispatcher"] .plain-language').textContent(), /2 jobs waiting/i);
    assert.match(await page.locator('[data-source-id="merge-pipeline"] .plain-language').textContent(), /Pull request #2027/i);
    assert.match(await page.locator('#movement-list').textContent(), /Independent review launched/);
    assert.match(await page.locator('#timeline').textContent(), /Wait for the immutable review receipt/);
    assert.equal(await page.locator('[data-runtime="worker"]').getAttribute('data-truth'), 'STALE');
    assert.equal(await page.locator('[data-health="scheduler"]').getAttribute('data-truth'), 'STALE');
    assert.equal(await page.locator('[data-health="review"]').getAttribute('data-truth'), 'STALE');
    assert.equal(await page.locator('[data-health="openclaw"]').getAttribute('data-truth'), 'STALE');
    assert.equal(await page.locator('[data-health="autonomy"]').getAttribute('data-truth'), 'CONFLICTING');
    assert.equal(await page.locator('[data-live-telemetry-field="active-goal-queue"]').textContent(), 'job-42');
    assert.equal(await page.locator('[data-live-telemetry-field="active-proof-lane"]').textContent(), 'lane-42');
    assert.match(await page.locator('#truth-boundary').textContent(), /Live backend projection loaded in read-only mode/);

    await page.getByRole('tab', { name: 'Goals' }).click();
    assert.equal(new URL(page.url()).hash, '#goals');
    assert.equal(await page.getByRole('tab', { name: 'Goals' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-dashboard-page="goals"]').isVisible(), true);
    assert.equal(await page.locator('[data-dashboard-page="overview"]').first().isVisible(), false);
    assert.match(await page.locator('#dashboard-view-description').textContent(), /what it means.*what is in the way.*what happens next/i);

    await page.getByRole('tab', { name: 'Runtime' }).click();
    assert.equal(new URL(page.url()).hash, '#runtime');
    assert.equal(await page.locator('[data-dashboard-page="runtime"]').first().isVisible(), true);
    assert.equal(await page.locator('[data-dashboard-page="goals"]').isVisible(), false);

    await page.goBack();
    await page.waitForFunction(() => location.hash === '#goals');
    assert.equal(await page.getByRole('tab', { name: 'Goals' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-dashboard-page="goals"]').isVisible(), true);
    assert.ok((await page.screenshot({ fullPage: true })).length > 10_000);
    assert.deepEqual(consoleErrors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
