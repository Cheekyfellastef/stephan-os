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
  projection: {
    portfolioSource: 'BASE_PROJECTION_FALLBACK',
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
    assert.match(await page.locator('#goal-grid .goal-card .meta').textContent(), /Status STALE · Proof STALE/);
    assert.equal(await page.locator('[data-live-telemetry-field="telemetry-blocker"]').textContent(), 'STALE_WORKSPACE_RECORDS');
    assert.ok((await page.screenshot({ fullPage: true })).length > 10_000);
    assert.deepEqual(consoleErrors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
