// Run with node tests/spatial-workspace-comfort.browser.mjs [--output-dir <path>].
// Uses an already installed browser; it never installs packages or transmits to a native host.
// BROWSER_CHANNEL=msedge selects installed Microsoft Edge on Windows.
// This script is an explicit browser gate, not an automatically discovered Node test.
import { chromium } from '@playwright/test';
import { DISPLAY_COMFORT_BUTTONS } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import { generateSpatialBridgeIcon } from '../apps/spatial-bridge/tools/build-icons.mjs';
import { mkdir, writeFile, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const repoRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
let proofRoot = resolve(repoRoot, 'test-results/spatial-comfort');
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--output-dir' || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error('Usage: node tests/spatial-workspace-comfort.browser.mjs [--output-dir <path>]');
  }
  proofRoot = resolve(args[++i]);
}
const sourceRoot = resolve(repoRoot, 'apps/spatial-bridge');
let url;
await mkdir(proofRoot, { recursive: true });
// Keep generated proof output out of source control without changing repository policy.
await writeFile(resolve(proofRoot, '.gitignore'), '*\n', { flag: 'wx' }).catch(error => {
  if (error.code !== 'EEXIST') throw error;
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourceSnapshot() {
  const files = (await readdir(sourceRoot)).filter(name => /\.(?:mjs|js|html)$/.test(name));
  return Object.fromEntries(await Promise.all(files.map(async name => [name, digest(await readFile(`${sourceRoot}/${name}`))])));
}
const result = { startedAt: new Date().toISOString(), checks: [], pageErrors: [], consoleErrors: [],
  failedRequests: [], badResponses: [], blockedRequests: [], servedFiles: [], screenshots: [],
  serviceWorkerTested: false, nativeWindowConnected: false, physicalHeadsetVerified: false,
  screenshotVisualReview: 'pending',
  sourceBefore: await sourceSnapshot() };
// Packaging intentionally generates these PNGs rather than committing binaries.
// Use the existing generator in memory so a clean source checkout is testable.
const iconSpecBytes = await readFile(resolve(sourceRoot, 'icons/icon-source.json'));
const iconSpec = JSON.parse(iconSpecBytes);
const packagedIcons = new Map([192, 512].map(size => [
  '/apps/spatial-bridge/icons/icon-' + size + '.png', generateSpatialBridgeIcon(size, iconSpec),
]));
result.packagedIcons = [...packagedIcons].map(([path, bytes]) => ({
  path, sha256: digest(bytes), specSha256: digest(iconSpecBytes), generatedInMemory: true,
}));
let browser, server, deadline;
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'], ['.webmanifest', 'application/manifest+json'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2'],
]);
const insideRoot = path => { const subpath = relative(repoRoot, path); return subpath &&
  !isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith('..' + sep) &&
  !subpath.split(sep).some(segment => segment.startsWith('.')); };

// Same-process loopback hosting avoids dependence on another executor's network namespace.
// Static source only: no request bodies, execution endpoint, directory listing or external fetch.
async function startStaticServer() {
  let requests = 0;
  server = createServer(async (request, response) => {
    const reject = status => { response.writeHead(status, { 'Cache-Control': 'no-store' }); response.end(); };
    try {
      if (++requests > 2048) return reject(429);
      if (!['GET', 'HEAD'].includes(request.method)) return reject(405);
      const authority = '127.0.0.1:' + server.address().port;
      if (request.headers.host !== authority) return reject(400);
      if (String(request.url).length > 2048) return reject(414);
      const requestedUrl = new URL(request.url, 'http://' + authority);
      if (requestedUrl.origin !== 'http://' + authority) return reject(403);
      const requested = decodeURIComponent(requestedUrl.pathname);
      if (/[\\\x00:]/.test(requested) || requested.split('/').some(segment => segment.startsWith('.'))) return reject(403);
      if (packagedIcons.has(requested)) {
        const bytes = packagedIcons.get(requested);
        response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : bytes);
        return;
      }
      let path = resolve(repoRoot, '.' + requested);
      if (!insideRoot(path)) return reject(403);
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      path = await realpath(path);
      if (!insideRoot(path)) return reject(403);
      const contentType = contentTypes.get(extname(path).toLowerCase());
      if (!contentType) return reject(404);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) return reject(413);
      const bytes = await readFile(path);
      if (bytes.length > 8 * 1024 * 1024) return reject(413);
      result.servedFiles.push({ path: relative(repoRoot, path).split(sep).join('/'), sha256: digest(bytes), size: bytes.length });
      response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { if (!response.headersSent) reject(404); else response.destroy(); }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return 'http://127.0.0.1:' + server.address().port;
}
async function check(name, task) {
  try { const detail = await task(); result.checks.push({ name, status: 'PASS', detail }); }
  catch (error) { result.checks.push({ name, status: 'FAIL', error: String(error.stack || error) }); }
}
try {
  const origin = await startStaticServer();
  url = origin + '/apps/spatial-bridge/quest-entry.html'; result.url = url;
  const channel = process.env.BROWSER_CHANNEL || '';
  if (channel && channel !== 'msedge') throw new Error('BROWSER_CHANNEL must be unset or msedge.');
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), timeout: 30_000,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--enable-unsafe-swiftshader'] });
  result.browser = { version: browser.version(), channel: channel || 'chromium' };
  deadline = setTimeout(() => { result.deadlineExceeded = true; void browser.close().catch(() => {}); }, 180_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1,
    reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const requested = new URL(route.request().url());
    if (requested.origin === origin || requested.protocol === 'data:') return route.continue();
    result.blockedRequests.push({ origin: requested.origin, path: requested.pathname });
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    const requested = new URL(socket.url());
    result.blockedRequests.push({ origin: requested.origin, path: requested.pathname, kind: 'websocket' });
    socket.close();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(20_000);
  page.on('pageerror', error => result.pageErrors.push(String(error.stack || error)));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) result.badResponses.push({ url: response.url(), status: response.status() }); });
  await check('page initializes all comfort controls', async () => {
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => document.querySelector('#comfort-save-status')?.textContent.length > 0);
    assert.equal(await page.title(), 'Stephanos Spatial Workspace');
    for (const id of ['comfort-seated', 'comfort-standing', 'comfort-height', 'comfort-tilt', 'comfort-reset', 'comfort-preview']) {
      assert.equal(await page.locator(`#${id}`).count(), 1, id);
    }
    return { saveStatus: await page.locator('#comfort-save-status').innerText(), session: await page.locator('#session-status').innerText() };
  });
  async function range(id, value) {
    await page.locator(`#${id}`).evaluate((element, requested) => {
      element.value = String(requested);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  async function expectProfile(mode, height, tilt) {
    assert.equal(await page.locator(`#comfort-${mode}`).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(`#comfort-${mode === 'seated' ? 'standing' : 'seated'}`).getAttribute('aria-pressed'), 'false');
    assert.equal(Number(await page.locator('#comfort-height').inputValue()), height);
    assert.equal(Number(await page.locator('#comfort-tilt').inputValue()), tilt);
    assert.equal(await page.locator('#comfort-height-value').innerText(), `${height >= 0 ? '+' : ''}${height} cm`);
    assert.ok((await page.locator('#comfort-tilt-value').innerText()).startsWith(`${tilt.toFixed(1)}°`));
  }
  async function shot(name, locator = page.locator('#holodeck-canvas')) {
    const path = `${proofRoot}/${name}.png`;
    await locator.screenshot({ path });
    result.screenshots.push(path);
    return { path, sha256: digest(await readFile(path)) };
  }
  await check('WebGL context is available and captures the existing room for visual review', async () => {
    assert.doesNotMatch(await page.locator('#preview-status').innerText(), /unavailable/i);
    const contextState = await page.locator('#holodeck-canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl');
      return { width: canvas.width, height: canvas.height, webgl: Boolean(gl), lost: gl?.isContextLost(),
        vendor: gl?.getParameter(gl.VENDOR), renderer: gl?.getParameter(gl.RENDERER),
        glError: gl?.getError(), attributes: gl?.getContextAttributes() };
    });
    assert.equal(contextState.webgl, true); assert.equal(contextState.lost, false); assert.equal(contextState.glError, 0);
    assert.ok(contextState.width > 600 && contextState.height > 200);
    return { ...contextState, image: await shot('spatial-room-initial') };
  });
  await check('seated and standing profiles restore independently across switches and reload', async () => {
    await page.locator('#comfort-seated').click(); await range('comfort-height', 35); await range('comfort-tilt', 37);
    await expectProfile('seated', 35, 37);
    await page.locator('#comfort-standing').click(); await range('comfort-height', -5); await range('comfort-tilt', 72);
    await expectProfile('standing', -5, 72);
    await page.locator('#comfort-seated').click(); await expectProfile('seated', 35, 37);
    await page.locator('#comfort-standing').click(); await expectProfile('standing', -5, 72);
    await page.reload({ waitUntil: 'networkidle' }); await expectProfile('standing', -5, 72);
    await page.locator('#comfort-seated').click(); await expectProfile('seated', 35, 37);
    await page.reload({ waitUntil: 'networkidle' }); await expectProfile('seated', 35, 37);
    return await page.evaluate(() => JSON.parse(localStorage.getItem('stephanos.spatial.holodeck.comfort.v1')));
  });
  await check('reset affects only the current profile and survives reload', async () => {
    await page.locator('#comfort-standing').click(); await page.locator('#comfort-reset').click();
    await expectProfile('standing', 0, 0);
    await page.locator('#comfort-seated').click(); await expectProfile('seated', 35, 37);
    await page.reload({ waitUntil: 'networkidle' }); await expectProfile('seated', 35, 37);
    await page.locator('#comfort-standing').click(); await expectProfile('standing', 0, 0);
    await range('comfort-height', -5); await range('comfort-tilt', 72);
    await page.locator('#comfort-seated').click();
    return { resetProfile: 'standing', retainedSeated: { heightCm: 35, tiltDegrees: 37 } };
  });
  await check('range controls support native keyboard input and visible precise values', async () => {
    await page.locator('#comfort-tilt').focus(); await page.keyboard.press('ArrowRight');
    await expectProfile('seated', 35, 37.1);
    await page.keyboard.press('ArrowLeft'); await expectProfile('seated', 35, 37);
    await page.locator('#comfort-raise').click(); await expectProfile('seated', 36, 37);
    await page.locator('#comfort-lower').click(); await expectProfile('seated', 35, 37);
    return { tiltStep: 0.1, heightStepCm: 1 };
  });
  await check('desktop controls fit the page without horizontal overflow', async () => {
    const widths = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(widths.html <= widths.viewport && widths.body <= widths.viewport, JSON.stringify(widths));
    return { ...widths, image: await shot('spatial-comfort-desktop', page.locator('[aria-label="Seated and standing comfort"]')) };
  });
  await check('keyboard inspection captures flat, intermediate and vertical positions for visual review', async () => {
    await page.locator('#comfort-preview').click();
    assert.equal(await page.locator('#comfort-preview').getAttribute('aria-pressed'), 'true');
    const images = [];
    for (const angle of [0, 37, 90]) {
      await range('comfort-tilt', angle);
      await page.locator('#holodeck-canvas').scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      images.push({ angle, ...await shot(`spatial-keyboard-${angle}`) });
    }
    assert.equal(new Set(images.map(item => item.sha256)).size, 3, 'all three renders should differ');
    await range('comfort-tilt', 37);
    return images;
  });
  await check('console desktop preview uses local comfort actions without a connected native window', async () => {
    const details = page.locator('details').filter({ has: page.locator('#console-preview') });
    if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
    const keyboard = page.locator('[aria-label="Spatial console keyboard preview"]');
    await keyboard.getByRole('button', { name: 'Standing', exact: true }).click(); await expectProfile('standing', -5, 72);
    await keyboard.getByRole('button', { name: 'Height +', exact: true }).click(); await expectProfile('standing', -4, 72);
    await keyboard.getByRole('button', { name: 'Flat', exact: true }).click(); await expectProfile('standing', -4, 0);
    await keyboard.getByRole('button', { name: 'Seated', exact: true }).click(); await expectProfile('seated', 35, 37);
    assert.match(await page.locator('#window-status').innerText(), /not connected|No window|Choose/i);
    return { image: await shot('spatial-console-desktop', page.locator('#console-preview')) };
  });
  await check('upright display controls adjust comfort without clicking through to a native app', async () => {
    const canvas = page.locator('canvas[aria-label="Spatial console screen preview"]');
    await canvas.scrollIntoViewIfNeeded();
    async function displayControl(id) {
      const control = DISPLAY_COMFORT_BUTTONS.find(button => button.id === id);
      assert.ok(control, id);
      const bounds = await canvas.boundingBox();
      await page.mouse.click(bounds.x + bounds.width * (control.x + control.w / 2),
        bounds.y + bounds.height * (control.y + control.h / 2));
    }
    await displayControl('height-up'); await expectProfile('seated', 36, 37);
    await displayControl('tilt-vertical'); await expectProfile('seated', 36, 90);
    await displayControl('mode-standing'); await expectProfile('standing', -4, 0);
    await displayControl('mode-seated'); await expectProfile('seated', 36, 90);
    await page.reload({ waitUntil: 'networkidle' }); await expectProfile('seated', 36, 90);
    await range('comfort-height', 35); await range('comfort-tilt', 37);
    return { localDisplayActions: ['height-up', 'tilt-vertical', 'mode-standing', 'mode-seated'], retainedAfterReload: true };
  });
  await check('phone layout preserves controls and has no horizontal page overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#comfort-standing').click(); await expectProfile('standing', -4, 0);
    await page.locator('#comfort-seated').click(); await expectProfile('seated', 35, 37);
    const widths = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(widths.html <= widths.viewport && widths.body <= widths.viewport, JSON.stringify(widths));
    await shot('spatial-comfort-phone', page.locator('[aria-label="Seated and standing comfort"]'));
    const details = page.locator('details').filter({ has: page.locator('#console-preview') });
    if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
    const expanded = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(expanded.html <= expanded.viewport && expanded.body <= expanded.viewport, JSON.stringify(expanded));
    return { collapsed: widths, expanded, image: await shot('spatial-console-phone', page.locator('#console-preview')) };
  });
  await check('no JavaScript runtime errors throughout browser interactions', async () => {
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.badResponses, [], 'All requested local resources must load successfully.');
    assert.deepEqual(result.failedRequests, [], 'No resource requests may fail.');
    assert.deepEqual(result.blockedRequests, [], 'The proof must not attempt external or native-host requests.');
    return { pageErrors: result.pageErrors.length, resourceErrors: result.badResponses.length, consoleErrors: result.consoleErrors.length };
  });
  await context.close();
} catch (error) {
  result.fatalError = String(error.stack || error);
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(error => { result.cleanupError = String(error); });
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  result.sourceAfter = await sourceSnapshot();
  result.sourceChangedDuringRun = [...new Set([...Object.keys(result.sourceBefore), ...Object.keys(result.sourceAfter)])]
    .filter(name => result.sourceBefore[name] !== result.sourceAfter[name]);
  result.finishedAt = new Date().toISOString();
  result.summary = { passed: result.checks.filter(c => c.status === 'PASS').length,
    failed: result.checks.filter(c => c.status === 'FAIL').length, fatal: Boolean(result.fatalError), deadlineExceeded: Boolean(result.deadlineExceeded) };
  await writeFile(`${proofRoot}/spatial-comfort-browser-proof.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result.summary, sourceChangedDuringRun: result.sourceChangedDuringRun,
    failures: result.checks.filter(c => c.status === 'FAIL'), fatalError: result.fatalError,
    pageErrors: result.pageErrors, badResponses: result.badResponses,
    screenshots: result.screenshots, results: `${proofRoot}/spatial-comfort-browser-proof.json` }, null, 2));
  if (result.summary.failed || result.summary.fatal || result.deadlineExceeded || result.cleanupError || result.sourceChangedDuringRun.length) process.exitCode = 1;
}
