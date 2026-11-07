// Run with node tests/spatial-workspace-comfort.browser.mjs [--output-dir <path>].
// Uses an already installed browser; it never installs packages or transmits to a native host.
// BROWSER_CHANNEL=msedge selects installed Microsoft Edge on Windows.
// This script is an explicit browser gate, not an automatically discovered Node test.
import { chromium } from '@playwright/test';
import { DISPLAY_COMFORT_BUTTONS, SCREEN_BUTTONS } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
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
  syntheticDesktopFixture: null,
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

// Invert the browser's observed drawImage crop, independently of the app's hit-test helper.
// The expected source point is a fixed position in the explicitly synthetic image.
function syntheticFixturePoint(drawing, point) {
  const { crop, destination, sourceWidth, sourceHeight, canvasWidth, canvasHeight } = drawing;
  const numbers = [...crop, ...destination, sourceWidth, sourceHeight, canvasWidth, canvasHeight, point.x, point.y];
  if (!numbers.every(Number.isFinite) || [...crop.slice(2), ...destination.slice(2),
    sourceWidth, sourceHeight, canvasWidth, canvasHeight].some(value => value <= 0)) {
    throw new Error('Invalid synthetic drawing geometry.');
  }
  const x = point.x * sourceWidth, y = point.y * sourceHeight;
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ||
    x < crop[0] || x > crop[0] + crop[2] || y < crop[1] || y > crop[1] + crop[3]) {
    throw new Error('Synthetic target is outside the painted crop.');
  }
  return {
    u: (destination[0] + (x - crop[0]) / crop[2] * destination[2]) / canvasWidth,
    v: (destination[1] + (y - crop[1]) / crop[3] * destination[3]) / canvasHeight,
  };
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
  const syntheticNativeOrigin = 'http://127.0.0.1:4180';
  assert.notEqual(origin, syntheticNativeOrigin, 'Synthetic transport must remain separate from the static server.');
  const syntheticPaths = new Set(['/session', '/windows', '/bind', '/frame', '/input', '/stop']);
  let desktopFixture = null;
  await context.route('**/*', async route => {
    const requested = new URL(route.request().url());
    // Never continue or fetch a native request. During the labelled fixture only,
    // the exact closed HTTP protocol is fulfilled here, before any host connection.
    if (desktopFixture && requested.origin === syntheticNativeOrigin &&
      !requested.search && !requested.hash && syntheticPaths.has(requested.pathname) &&
      ['POST', 'OPTIONS'].includes(route.request().method())) {
      const fixture = desktopFixture, report = fixture.report, request = route.request();
      if (++report.interceptedRequests > 2048) {
        report.unexpectedRequests.push({ path: requested.pathname, reason: 'fixture request budget exceeded' });
        return route.abort('blockedbyclient');
      }
      const headers = {
        'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Spatial-Session',
        'Access-Control-Allow-Private-Network': 'true', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      let payload;
      try {
        if ((request.postData() || '').length > 4096) throw new Error('oversized fixture request');
        payload = request.postDataJSON();
      }
      catch {
        report.unexpectedRequests.push({ path: requested.pathname, reason: 'non-JSON fixture request' });
        return route.abort('blockedbyclient');
      }
      report.requestsByPath[requested.pathname] = (report.requestsByPath[requested.pathname] || 0) + 1;
      let response;
      if (requested.pathname === '/session') response = { token: 'a'.repeat(64) };
      if (requested.pathname === '/windows') response = { windows: fixture.windows };
      if (requested.pathname === '/bind') {
        report.binds.push(payload);
        fixture.boundId = fixture.windows.some(window => window.id === payload.id) ? payload.id : null;
        response = { status: fixture.boundId === null ? 'window-unavailable' : 'connected' };
      }
      if (['/frame', '/input'].includes(requested.pathname) && fixture.boundId === null) {
        report.unexpectedRequests.push({ path: requested.pathname, reason: 'unbound fixture access' });
        return route.abort('blockedbyclient');
      }
      if (requested.pathname === '/frame') {
        response = { status: 'frame', serial: ++report.frameSerial, generation: 1, jpeg: fixture.jpeg };
      }
      if (requested.pathname === '/input') {
        report.inputs.push(payload);
        response = { status: fixture.rejectNextInput ? 'input-rejected' : 'input-posted' };
        fixture.rejectNextInput = false;
      }
      if (requested.pathname === '/stop') { fixture.boundId = null; response = { status: 'stopped' }; }
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(response) });
    }
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
  await check('phone console labels fit and rightmost controls remain reachable', async () => {
    const keyboard = page.locator('[aria-label="Spatial console keyboard preview"]');
    const viewport = page.getByRole('region', { name: 'Console keyboard scroll area', exact: true });
    const layout = await keyboard.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      clippedLabels: [...element.querySelectorAll('button')].filter(button =>
        button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1)
        .map(button => button.textContent),
    }));
    assert.deepEqual(layout.clippedLabels, [], 'Every console keyboard label must fit its button.');
    const scroll = await viewport.evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth }));
    assert.ok(scroll.contentWidth > scroll.width, 'Only the keyboard should scroll horizontally on a phone.');
    for (const name of ['Reset profile', 'Send / Enter']) {
      const button = keyboard.getByRole('button', { name, exact: true });
      await button.focus();
      const bounds = await button.boundingBox(), visible = await viewport.boundingBox();
      assert.ok(bounds.x >= visible.x - 1 && bounds.x + bounds.width <= visible.x + visible.width + 1,
        `${name} must scroll fully into view when focused.`);
    }
    const pageWidth = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(pageWidth.html <= pageWidth.viewport && pageWidth.body <= pageWidth.viewport, JSON.stringify(pageWidth));
    return { ...layout, scroll, pageWidth, image: await shot('spatial-console-phone-end', page.locator('#console-preview')) };
  });
  // The original comfort checks above make no native requests. The following six
  // UI cases use a closed, in-process synthetic transport; they do not establish
  // Windows capture, a ChatGPT session, microphone setup or headset acceptance.
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.notEqual(new URL(origin).port, '4174', 'The fixture must use the normal client endpoint.');
  await page.evaluate(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = { clearRect: prototype.clearRect, fillRect: prototype.fillRect,
      fillText: prototype.fillText, drawImage: prototype.drawImage };
    const capture = { screen: null, keyboard: null, canvases: {}, mediaRequests: 0 };
    const surface = context => context.canvas.width === 3072 && context.canvas.height === 954 ? 'screen' :
      context.canvas.width === 2048 && context.canvas.height === 512 ? 'keyboard' : '';
    const begin = (context, key) => {
      capture.canvases[key] = context.canvas;
      capture[key] = { paint: (capture[key]?.paint || 0) + 1, image: null, texts: [] };
    };
    prototype.clearRect = function (...args) {
      if (surface(this) === 'screen' && args[0] === 0 && args[1] === 0 &&
        args[2] === this.canvas.width && args[3] === this.canvas.height) begin(this, 'screen');
      return original.clearRect.apply(this, args);
    };
    prototype.fillRect = function (...args) {
      if (surface(this) === 'keyboard' && args[0] === 0 && args[1] === 0 &&
        args[2] === this.canvas.width && args[3] === this.canvas.height) begin(this, 'keyboard');
      return original.fillRect.apply(this, args);
    };
    prototype.fillText = function (value, x, y, ...rest) {
      const key = surface(this), record = capture[key];
      if (record) {
        const metrics = this.measureText(String(value));
        record.texts.push({ text: String(value), x, y, width: metrics.width,
          top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent });
      }
      return original.fillText.call(this, value, x, y, ...rest);
    };
    prototype.drawImage = function (image, ...args) {
      if (surface(this) === 'screen' && capture.screen && args.length === 8) {
        capture.screen.image = { crop: args.slice(0, 4), destination: args.slice(4),
          sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
          canvasWidth: this.canvas.width, canvasHeight: this.canvas.height };
      }
      return original.drawImage.call(this, image, ...args);
    };
    const media = navigator.mediaDevices, originalMedia = media?.getUserMedia;
    if (originalMedia) media.getUserMedia = function () {
      capture.mediaRequests++;
      return Promise.reject(new Error('Media access is disabled in synthetic browser acceptance.'));
    };
    capture.restore = () => {
      Object.assign(prototype, original);
      if (originalMedia) media.getUserMedia = originalMedia;
    };
    window.__spatialSyntheticDrawCapture = capture;
  });
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#142840'; ctx.fillRect(0, 0, 1920, 1080);
    ctx.strokeStyle = '#83dcff'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 1904, 1064);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 62px sans-serif';
    ctx.fillText('SYNTHETIC LAYOUT / NO NATIVE WINDOW', 62, 105);
    ctx.font = '34px sans-serif';
    ctx.fillText('Browser fixture only: no real app, microphone, speakers or headset.', 64, 175);
    ctx.fillText('TOP LEFT', 54, 260); ctx.fillText('TOP RIGHT', 1625, 260);
    ctx.fillStyle = '#315775'; ctx.fillRect(1020, 955, 650, 105);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 42px sans-serif';
    ctx.fillText('SYNTHETIC COMPOSER', 1060, 1028);
    ctx.fillStyle = '#a2eaff'; ctx.beginPath(); ctx.arc(1804.8, 1015.2, 50, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#061827'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('VOICE', 1766, 1024);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  const fixtureReport = result.syntheticDesktopFixture = {
    synthetic: true, label: 'SYNTHETIC HTTP WINDOW / FRAME / INPUT FIXTURE',
    nativeWindowConnected: false, physicalHeadsetVerified: false,
    networkForwarding: 'disabled; every admitted fixture request is fulfilled in the test process',
    interceptedRequests: 0, requestsByPath: {}, frameSerial: 0, binds: [], inputs: [],
    windowSnapshots: [], unexpectedRequests: [],
    frame: { width: 1920, height: 1080, sha256: digest(Buffer.from(jpeg, 'base64')),
      generatedInBrowser: true, composer: { x: 0.72, y: 0.94 }, voice: { x: 0.94, y: 0.94 } },
  };
  desktopFixture = { windows: [], jpeg, boundId: null, rejectNextInput: false, report: fixtureReport };
  const keyboard = page.locator('[aria-label="Spatial console keyboard preview"]');
  const screenPreview = page.locator('canvas[aria-label="Spatial console screen preview"]');
  const details = page.locator('details').filter({ has: page.locator('#console-preview') });
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  const key = name => keyboard.getByRole('button', { name, exact: true });
  const setWindows = windows => {
    desktopFixture.windows = windows;
    fixtureReport.windowSnapshots.push(windows.map(window => ({ ...window })));
  };
  async function drawing(expectedCrop) {
    await page.waitForFunction(expected => {
      const image = window.__spatialSyntheticDrawCapture?.screen?.image;
      return image && image.crop.every((value, index) => Math.abs(value - expected[index]) < 0.000001);
    }, expectedCrop);
    return page.evaluate(() => window.__spatialSyntheticDrawCapture.screen.image);
  }
  async function freshPaints() {
    const before = await page.evaluate(() => window.__spatialSyntheticDrawCapture.screen?.paint || 0);
    await page.waitForFunction(paint => window.__spatialSyntheticDrawCapture.screen?.paint >= paint + 2, before);
  }
  async function capturedCanvas(name, kind = 'screen') {
    const encoded = await page.evaluate(surface => window.__spatialSyntheticDrawCapture.canvases[surface].toDataURL('image/png'), kind);
    assert.ok(encoded.startsWith('data:image/png;base64,'));
    const bytes = Buffer.from(encoded.slice('data:image/png;base64,'.length), 'base64');
    const path = proofRoot + '/' + name + '.png';
    await writeFile(path, bytes); result.screenshots.push(path);
    return { path, sha256: digest(bytes), synthetic: true, surface: kind };
  }
  async function postedInput(action) {
    const count = fixtureReport.inputs.length;
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url() === syntheticNativeOrigin + '/input' &&
        response.request().method() === 'POST'),
      action(),
    ]);
    assert.equal(fixtureReport.inputs.length, count + 1, 'One gesture must produce exactly one fixture input.');
    const payload = response.request().postDataJSON();
    assert.equal(payload.generation, 1); assert.equal(payload.sequence, count + 1);
    return { payload, response: await response.json() };
  }
  async function clickFixturePoint(point, painted) {
    await screenPreview.scrollIntoViewIfNeeded();
    const bounds = await screenPreview.boundingBox(), target = syntheticFixturePoint(painted, point);
    await page.mouse.click(bounds.x + bounds.width * target.u, bounds.y + bounds.height * target.v);
    return {
      x: painted.crop[2] / (painted.destination[2] / painted.canvasWidth * bounds.width) / painted.sourceWidth * 1.1,
      y: painted.crop[3] / (painted.destination[3] / painted.canvasHeight * bounds.height) / painted.sourceHeight * 1.1,
    };
  }
  async function provePoint(point, painted) {
    let tolerance;
    const posted = await postedInput(async () => { tolerance = await clickFixturePoint(point, painted); });
    assert.equal(posted.payload.kind, 'click');
    assert.equal(posted.response.status, 'input-posted');
    assert.ok(Math.abs(posted.payload.x - point.x) <= tolerance.x, JSON.stringify(posted.payload));
    assert.ok(Math.abs(posted.payload.y - point.y) <= tolerance.y, JSON.stringify(posted.payload));
    return { expected: point, posted: posted.payload, tolerance };
  }
  async function paintedNotice(pattern) {
    const records = await page.evaluate(() => window.__spatialSyntheticDrawCapture.screen.texts);
    const notice = records.find(record => record.y === 904 && pattern.test(record.text));
    assert.ok(notice, 'Expected visible VR-canvas input notice: ' + pattern);
    assert.ok(notice.x >= 0 && notice.x + notice.width <= 3072 && notice.top >= 0 && notice.bottom <= 954,
      'The input notice must fit inside the actual screen canvas.');
    assert.equal(await page.locator('#window-input-status').innerText(), notice.text,
      'Desktop and VR must project the same input notice.');
    return notice;
  }
  async function blockedInputs(painted, reason) {
    const before = fixtureReport.inputs.length;
    await clickFixturePoint(fixtureReport.frame.composer, painted);
    for (const name of ['Type a', 'Send / Enter', 'Backspace', 'Scroll ↓']) await key(name).click();
    await freshPaints();
    assert.equal(fixtureReport.inputs.length, before, 'An open overlay must block pointer, text, keys and scroll.');
    return { attemptedKinds: ['click', 'text', 'Enter', 'Backspace', 'scroll'],
      forwardedInputs: fixtureReport.inputs.length - before, notice: await paintedNotice(reason) };
  }
  try {
    await check('synthetic window picker refreshes, preserves selection, rejects removal and binds the chosen fixture', async () => {
      await page.locator('#choose-window').click();
      await page.waitForFunction(() => document.querySelector('#window-status').textContent.includes('No open windows'));
      assert.equal(await page.locator('#desktop-window').isDisabled(), true);
      assert.equal(await page.locator('#connect-window').isDisabled(), true);
      const emptyImage = await shot('synthetic-window-picker-empty', page.locator('[aria-label="Spatial ChatGPT console"]'));
      setWindows([{ id: 44, pid: 55, title: 'SYNTHETIC ChatGPT fixture' }, { id: 88, pid: 99, title: 'SYNTHETIC other window' }]);
      await page.waitForFunction(() => document.querySelector('#desktop-window').options.length === 2, undefined, { timeout: 10000 });
      await page.locator('#desktop-window').selectOption('44');
      setWindows([{ id: 88, pid: 99, title: 'SYNTHETIC other window' }, { id: 44, pid: 55, title: 'SYNTHETIC ChatGPT after heartbeat' }]);
      await page.waitForFunction(() => [...document.querySelector('#desktop-window').options].some(option =>
        option.textContent === 'SYNTHETIC ChatGPT after heartbeat'), undefined, { timeout: 10000 });
      assert.equal(await page.locator('#desktop-window').inputValue(), '44');
      assert.equal(await page.locator('#connect-window').isDisabled(), false);
      const selectedImage = await shot('synthetic-window-picker-selected', page.locator('[aria-label="Spatial ChatGPT console"]'));
      setWindows([{ id: 88, pid: 99, title: 'SYNTHETIC other window' }]);
      await page.waitForFunction(() => document.querySelector('#desktop-window').options.length === 1, undefined, { timeout: 10000 });
      assert.equal(await page.locator('#desktop-window').inputValue(), '');
      assert.equal(await page.locator('#connect-window').isDisabled(), true);
      assert.deepEqual(fixtureReport.binds, []);
      setWindows([{ id: 88, pid: 99, title: 'SYNTHETIC other window' }, { id: 44, pid: 55, title: 'SYNTHETIC ChatGPT reselected' }]);
      await page.waitForFunction(() => document.querySelector('#desktop-window').options.length === 2, undefined, { timeout: 10000 });
      await page.locator('#desktop-window').selectOption('44');
      await page.locator('#connect-window').click();
      await drawing([0, 0, 1920, 1080]);
      assert.deepEqual(fixtureReport.binds, [{ id: 44 }]);
      assert.equal(fixtureReport.requestsByPath['/session'], 1, 'Heartbeat discovery must not require another session.');
      assert.ok(fixtureReport.requestsByPath['/windows'] >= 5);
      return { synthetic: true, selectedId: 44, selectedPid: 55, binds: fixtureReport.binds,
        windowResponses: fixtureReport.requestsByPath['/windows'], emptyImage, selectedImage };
    });
    await check('synthetic zoom and View controls reach the bottom composer and Voice with correct coordinates; Fit restores the whole frame', async () => {
      await key('Zoom +').click(); await key('Zoom +').click();
      const centred = await drawing([480, 270, 960, 540]);
      assert.throws(() => syntheticFixturePoint(centred, fixtureReport.frame.composer), /outside the painted crop/);
      for (const name of ['View →', 'View →', 'View ↓', 'View ↓']) await key(name).click();
      const panned = await drawing([960, 540, 960, 540]);
      const composer = await provePoint(fixtureReport.frame.composer, panned);
      const voice = await provePoint(fixtureReport.frame.voice, panned);
      const pannedImage = await capturedCanvas('synthetic-screen-panned');
      await key('Fit').click(); const fitted = await drawing([0, 0, 1920, 1080]);
      const fittedPoint = await provePoint(fixtureReport.frame.composer, fitted);
      const fitImage = await capturedCanvas('synthetic-screen-fit');
      await key('Zoom +').click(); await key('Zoom +').click();
      await drawing([480, 270, 960, 540]); // Fit must reset pan as well as zoom.
      await key('Fit').click(); await drawing([0, 0, 1920, 1080]);
      return { synthetic: true, centredCrop: centred.crop, pannedCrop: panned.crop,
        composer, voice, fittedPoint, pannedImage, fitImage, panResetProven: true };
    });
    await check('synthetic shifted punctuation matches DOM and VR-keyboard labels and forwards the labelled characters', async () => {
      const shifted = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&',
        '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', ';': ':',
        "'": '"', ',': '<', '.': '>', '/': '?' };
      await key('Shift').click(); assert.equal(await key('Shift').getAttribute('aria-pressed'), 'true');
      await freshPaints();
      const painted = await page.evaluate(() => window.__spatialSyntheticDrawCapture.keyboard.texts);
      for (const [unshifted, label] of Object.entries(shifted)) {
        assert.equal(await key('Type ' + label).innerText(), label);
        const control = SCREEN_BUTTONS.find(button => button.id === 'key:' + unshifted);
        assert.ok(control);
        assert.ok(painted.some(text => text.text === label && Math.abs(text.x - (control.x * 2048 + 12)) < 0.001 &&
          Math.abs(text.y - (control.y * 512 + control.h * 512 * 0.64)) < 0.001), 'VR label missing for ' + label);
      }
      const sent = [];
      for (const label of ['!', '?']) {
        const input = await postedInput(() => key('Type ' + label).click());
        assert.equal(input.payload.kind, 'text'); assert.equal(input.payload.text, label);
        assert.equal(input.response.status, 'input-posted'); sent.push(input.payload);
      }
      const image = await capturedCanvas('synthetic-shifted-vr-keyboard', 'keyboard');
      await key('Shift').click(); assert.equal(await key('Shift').getAttribute('aria-pressed'), 'false');
      assert.equal(await key('Type 1').innerText(), '1');
      return { synthetic: true, shiftedLabelsChecked: Object.keys(shifted).length, sent, image };
    });
    await check('synthetic rejected input remains visibly reported on the DOM and actual VR screen canvas', async () => {
      desktopFixture.rejectNextInput = true;
      const rejected = await postedInput(() => key('Type a').click());
      assert.equal(rejected.response.status, 'input-rejected');
      await freshPaints();
      const notice = await paintedNotice(/That input was not accepted/);
      return { synthetic: true, rejected: rejected.payload, notice,
        image: await capturedCanvas('synthetic-input-rejected-screen') };
    });
    await check('synthetic Audio help describes setup honestly and blocks app input until the help closes', async () => {
      const fitted = await drawing([0, 0, 1920, 1080]);
      await key('Audio help').click(); await freshPaints();
      const help = await page.evaluate(() => window.__spatialSyntheticDrawCapture.screen);
      assert.equal(help.image, null);
      assert.ok(help.texts.some(text => text.text === 'AUDIO HELP / HEADSET SETUP'));
      assert.ok(help.texts.some(text => /does not enable or test your microphone or speakers/.test(text.text)));
      assert.ok(help.texts.some(text => /Windows Settings.*Sound.*Input/.test(text.text)));
      assert.ok(help.texts.some(text => /Voice.*dictation.*Availability depends/.test(text.text)));
      for (const text of help.texts) assert.ok(text.x >= 0 && text.x + text.width <= 3072 &&
        text.top >= 0 && text.bottom <= 954, 'Audio-help text must fit: ' + text.text);
      const blocked = await blockedInputs(fitted, /Input paused\. Close Audio help/);
      const image = await capturedCanvas('synthetic-audio-help-screen');
      await key('Audio help').click();
      const restored = await drawing([0, 0, 1920, 1080]);
      const resumed = await provePoint(fixtureReport.frame.composer, restored);
      const mediaRequests = await page.evaluate(() => window.__spatialSyntheticDrawCapture.mediaRequests);
      assert.equal(mediaRequests, 0, 'Opening setup help must not request microphone access.');
      return { synthetic: true, blocked, resumed, mediaRequests, image };
    });
    await check('synthetic Reload confirmation blocks app input and Fit cancels it without reloading', async () => {
      const fitted = await drawing([0, 0, 1920, 1080]), beforeUrl = page.url();
      await key('Reload').click(); await freshPaints();
      assert.equal(await page.evaluate(() => window.__spatialSyntheticDrawCapture.screen.image), null);
      assert.ok(await page.evaluate(() => window.__spatialSyntheticDrawCapture.screen.texts.some(text =>
        text.text === 'SAVE & RELOAD ROOM')));
      const blocked = await blockedInputs(fitted, /Input paused\. Press Fit to cancel Reload/);
      const image = await capturedCanvas('synthetic-reload-confirmation-screen');
      await key('Fit').click();
      const restored = await drawing([0, 0, 1920, 1080]);
      const resumed = await provePoint(fixtureReport.frame.composer, restored);
      assert.equal(page.url(), beforeUrl);
      assert.equal(fixtureReport.requestsByPath['/session'], 1);
      return { synthetic: true, blocked, resumed, roomReloaded: false, image };
    });
  } finally {
    const hasSession = await page.evaluate(() => Boolean(sessionStorage.getItem('stephanos.spatial-window.session.v1')));
    if (hasSession) await Promise.all([
      page.waitForResponse(response => response.url() === syntheticNativeOrigin + '/stop' &&
        response.request().method() === 'POST'),
      page.locator('#disconnect-window').click(),
    ]);
    else await page.locator('#disconnect-window').click();
    await page.waitForFunction(() => !sessionStorage.getItem('stephanos.spatial-window.session.v1'));
    fixtureReport.mediaRequests = await page.evaluate(() => {
      const capture = window.__spatialSyntheticDrawCapture;
      capture.restore(); return capture.mediaRequests;
    });
    fixtureReport.disconnected = /disconnected/i.test(await page.locator('#window-status').innerText());
    assert.equal(fixtureReport.disconnected, true);
    assert.equal(fixtureReport.mediaRequests, 0);
    assert.deepEqual(fixtureReport.unexpectedRequests, []);
    if (result.checks.filter(check => check.name.startsWith('synthetic ')).every(check => check.status === 'PASS')) {
      assert.equal(fixtureReport.inputs.length, 8, 'Only the eight explicit positive/rejected gestures may reach the fixture.');
    }
    desktopFixture = null;
  }
  await check('no JavaScript runtime errors throughout browser interactions', async () => {
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.consoleErrors, [], 'No console errors may be hidden by a passing interaction check.');
    assert.deepEqual(result.badResponses, [], 'All requested local resources must load successfully.');
    assert.deepEqual(result.failedRequests, [], 'No resource requests may fail.');
    assert.deepEqual(result.blockedRequests, [], 'No requests outside static resources and the closed synthetic fixture are allowed.');
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
  if (result.summary.failed || result.summary.fatal || result.deadlineExceeded || result.cleanupError ||
    result.sourceChangedDuringRun.length || result.pageErrors.length || result.consoleErrors.length ||
    result.failedRequests.length || result.badResponses.length || result.blockedRequests.length) process.exitCode = 1;
}
