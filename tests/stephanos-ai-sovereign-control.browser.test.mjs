import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { CONTROL_WORKFLOW_URL } from '../apps/stephanos-ai/controlSurface.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(ROOT, '.' + pathname);
      const rel = relative(ROOT, file);
      if (!rel || rel.startsWith('..') || !TYPES[extname(file)]) throw Error('INVALID_FILE');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)], 'Cache-Control': 'no-store' }); res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
function response(operation = 'OBSERVE_CONTROL_SYSTEM') {
  const now = Date.now();
  return { success: true, output_text: 'Commander is reachable; its repair loop has no next cycle scheduled. No action has been submitted.',
    data: {
      conversation_routing: { routeState: 'CONTROL_REPLY', responder: { id: 'stephanos', label: 'Stephanos control' },
        selectedContributors: [], directParticipantDispatchProven: false },
      sovereign_control_conversation: {
        schemaVersion: 'stephanos.sovereign-control-conversation.v1', observedAtUtc: new Date(now).toISOString(),
        responseSource: 'CANONICAL_CONTROL_OBSERVATIONS', readOnly: true, modelInvoked: false,
        nativeActionSubmitted: false, directParticipantDispatchProven: false,
        controlTower: { latestRequestObservation: { requestId: 'control-tower-build-123-1', state: 'RESERVED', historical: true } },
        handoff: { handoffId: '12345678-1234-4123-8123-123456789abc', state: 'NOT_SUBMITTED', requestSubmitted: false, executionAuthority: false,
          authenticatedOwnerSubmissionRequired: true, singleAuthenticatedRunRequired: true, reusableAuthority: false,
          operation, workflowUrl: CONTROL_WORKFLOW_URL, workflowRef: 'main', workflowInputs: { operation },
          createdAtUtc: new Date(now).toISOString(), expiresAtUtc: new Date(now + 600000).toISOString(), submissionBlockedReason: '' },
      },
    },
  };
}

// These prove browser behavior against explicit HTTP fixtures, not Battle Bridge execution.
test('desktop control conversations keep prompt intent, provenance and unresolved receipts; no action is dispatched', async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.STEPHANOS_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.STEPHANOS_BROWSER_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:8787/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ json: response(), headers: { 'access-control-allow-origin': '*' } });
    });
    await page.route('http://127.0.0.1:8787/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ json: response(), headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(server.origin + '/apps/stephanos-ai/index.html');
    await page.getByRole('button', { name: /Control Tower.*Control status/ }).click();
    await page.locator('#prompt').fill('/sovereign inspect the native control system');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByLabel('Sovereign control receipt')).toBeVisible();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.prompt, '/sovereign inspect the native control system');
    assert.equal(requests[0].body.runtimeContext.participantTarget, 'control-tower');
    await expect(page.locator('.message.assistant .meta')).toContainText('Stephanos control');
    await expect(page.getByLabel('Sovereign control receipt')).toContainText('Accepted · outcome unproven');
    await expect(page.getByLabel('Sovereign control receipt')).toContainText('Prepared · not submitted');
    await expect(page.locator('#presenceTruth')).toContainText('native action not submitted');
    await expect(page.getByRole('link', { name: 'Open authorised Control Tower' })).toHaveAttribute('href', CONTROL_WORKFLOW_URL);
    await expect(page.getByRole('link', { name: 'Open authorised Control Tower' })).toHaveAttribute('rel', 'noopener noreferrer');
    assert.deepEqual(errors, []);
    if (process.env.STEPHANOS_CONTROL_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.STEPHANOS_CONTROL_BROWSER_SCREENSHOT, fullPage: true });
    await page.context().route(CONTROL_WORKFLOW_URL, route => route.fulfill({ contentType: 'text/html', body: '<title>Existing workflow fixture</title><p>Owner must choose and submit the request.</p>' }));
    const opened = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Open authorised Control Tower' }).click();
    const workflow = await opened;
    await expect(workflow).toHaveURL(CONTROL_WORKFLOW_URL);
    assert.equal(requests.length, 1, 'opening a handoff must not send another backend request');
    await workflow.close();
  } finally { await browser?.close(); await server.close(); }
});

test('phone can select Control Tower and a delayed reply cannot mark another target as observed', async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.STEPHANOS_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.STEPHANOS_BROWSER_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    let release;
    let started;
    const pending = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { started = resolve; });
    await page.route(/http:\/\/(localhost|127\.0\.0\.1):8787\//, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      started(); await pending;
      return route.fulfill({ json: response(), headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(server.origin + '/apps/stephanos-ai/index.html');
    await page.getByLabel('Conversation target').selectOption('control-tower');
    await expect(page.locator('#targetTitle')).toHaveText('Control Tower');
    await page.locator('#prompt').fill('Inspect the native control system.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await seen;
    await page.getByLabel('Conversation target').selectOption('research');
    release();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
    await expect(page.locator('#targetTitle')).toHaveText('Research');
    await expect(page.locator('#lastResponse')).toHaveText('none');
    await page.getByLabel('Conversation target').selectOption('control-tower');
    await expect(page.getByLabel('Sovereign control receipt')).toBeVisible();
    await expect(page.locator('#lastResponse')).toHaveText('control service · no model used');
    const dimensions = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth,
      composer: document.getElementById('composer').getBoundingClientRect().bottom }));
    assert.ok(dimensions.page <= dimensions.width, 'phone must not overflow horizontally');
    assert.ok(dimensions.composer <= 844, 'composer must remain reachable');
  } finally { await browser?.close(); await server.close(); }
});


test('one explicit local operator click requests the fixed workflow once; an inert chat reply cannot dispatch', async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.STEPHANOS_BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.STEPHANOS_BROWSER_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const posts = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route(/http:\/\/(localhost|127\.0\.0\.1):8787\//, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      const url = route.request().url();
      if (url.endsWith('/api/ai/control-tower/dispatch')) {
        posts.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
        return route.fulfill({ status: 202, json: {
          schemaVersion: 'stephanos.control-tower-operator-dispatch.v1',
          ok: true, state: 'DISPATCH_ACCEPTED_UNCORRELATED',
          workflowRequestAccepted: true, nativeActionSubmitted: false,
        }, headers: { 'access-control-allow-origin': '*' } });
      }
      const value = response('OBSERVE_CONTROL_SYSTEM');
      value.data.control_operator_intent = {
        schemaVersion: 'stephanos.control-tower-operator-dispatch.v1',
        handoffId: value.data.sovereign_control_conversation.handoff.handoffId,
        operation: 'OBSERVE_CONTROL_SYSTEM', sourceHead: 'a'.repeat(40),
        expiresAtUtc: new Date(Date.now() + 60000).toISOString(),
        signature: 'b'.repeat(64), operatorClickRequired: true,
        workflowRequestAccepted: false, nativeActionSubmitted: false,
      };
      return route.fulfill({ status: 200, json: value,
        headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(server.origin + '/apps/stephanos-ai/index.html');
    await page.getByLabel('Conversation target').selectOption('control-tower');
    await page.locator('#prompt').fill('Inspect the native control system.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('button', { name: 'Approve and request inspection' })).toBeVisible();
    assert.equal(posts.length, 0, 'read-only chat itself cannot dispatch');
    await page.getByRole('button', { name: 'Approve and request inspection' }).click();
    await expect(page.getByLabel('Sovereign control receipt')).toContainText('GitHub accepted the request');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.operation, 'OBSERVE_CONTROL_SYSTEM');
    assert.equal(posts[0].body.sourceHead, 'a'.repeat(40));
    assert.equal(posts[0].headers['x-stephanos-operator-click'], 'confirmed-v1');
    assert.deepEqual(Object.keys(posts[0].body).sort(),
      ['schemaVersion', 'handoffId', 'operation', 'sourceHead', 'expiresAtUtc', 'signature'].sort());
    assert.equal(await page.getByRole('button', { name: 'Approve and request inspection' }).count(), 0,
      'spent handoff cannot be resubmitted');
    assert.equal(await page.getByRole('link', { name: 'Open authorised Control Tower' }).count(), 1,
      'original owner-workflow fallback remains visible');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
