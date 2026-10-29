/**
 * Source regression and read-only browser inspection contract for goal #2664.
 * This module never launches a browser, server, fixture, process or canonical
 * state. Source tests cannot establish responsive/browser acceptance.
 * The guarded-context helper requires an already owned browser; inspection
 * requires its page supplied by an independently
 * resource/custody-qualified executor, serving the exact UI head and admitted
 * long-content data. Neither page arguments nor environment values grant that
 * authority. The denied synthetic local-file fixture is never a valid target.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { auditCardLayout, extractCardLayout } from './workspace-card-layout-audit.test.mjs';

const css = readFileSync(new URL('../shared/styles/stephanos-card-layout.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../stephanos-ui/src/main.jsx', import.meta.url), 'utf8');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selectors, body]) => ({
    selectors: selectors.split(',').map(value => value.trim()),
    declarations: Object.fromEntries(body.split(';').filter(value => value.trim()).map(value => {
      const colon = value.indexOf(':');
      return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
    })),
  }));
const rule = selector => {
  const matches = rules.filter(entry => entry.selectors.includes(selector));
  assert.equal(matches.length, 1, 'One shared rule expected for ' + selector);
  return matches[0].declarations;
};
const CARD_SELECTORS = [
  '.uplift-workspace', '.uplift-deck-card', '.uplift-stat-deck > article',
  '.uplift-agent-node', '.agent-constellation-card', '.agent-uplift-queue-card',
  '.agent-passport-grid > article',
];
const CHILD_SELECTORS = [
  '.uplift-workspace > *', '.uplift-deck-card > *', '.uplift-agent-node > *',
  '.agent-constellation-card > *', '.agent-uplift-queue-card > *', '.agent-uplift-queue-head > *',
];
const GRID_PREFERENCES = [
  ['.uplift-constellation', 190], ['.agent-constellation-grid', 235],
  ['.agent-stat-deck', 145], ['.agent-uplift-queue-grid', 285],
  ['.agent-passport-grid', 190], ['.uplift-constellation.flywheel-constellation--large', 230],
];
const LONG_NAME = /\S{40,}/;
const HASH = /[a-f0-9]{40,}/i;
const PROOF_COUNT = /\b\d{5,}\s+proof/;

export const CARD_LAYOUT_VIEWPORTS = Object.freeze([
  { width: 1280, height: 720 }, { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }, { width: 960, height: 900 },
  { width: 640, height: 900 }, { width: 375, height: 900 },
].map(Object.freeze));
export const CARD_LAYOUT_SURFACES = Object.freeze([
  { surface: 'agents', testId: 'agents-uplift-workspace',
    names: '.agent-constellation-copy strong', ids: '.agent-constellation-copy em',
    requireProofCount: true, cards: CARD_SELECTORS.join(',') },
  { surface: 'flywheel', testId: 'flywheel-uplift-workspace',
    names: '.uplift-agent-node strong', ids: '.uplift-agent-node span',
    cards: CARD_SELECTORS.join(',') },
  { surface: 'skill-forge', testId: 'skill-forge-observatory',
    names: '.skill-blueprint-card strong,.skill-agent-card strong,.skill-timeline-row strong',
    ids: '.skill-blueprint-card small,.skill-blueprint-detail dd,.skill-agent-card small',
    cards: [...CARD_SELECTORS, '.skill-panel', '.skill-metrics > article',
      '.skill-agent-card', '.skill-blueprint-card', '.skill-blueprint-detail', '.skill-timeline-row'].join(',') },
].map(Object.freeze));

/**
 * Collect one case only from the guarded context above: no navigation, resize, API fetch, data/style
 * injection or resource startup. The caller owns prior admission, actual-asset
 * identity, fixture provenance, viewport, screenshots and later adjudication.
 * Valid metadata is necessary but does not prove the served asset bytes.
 */

const preparedContexts = new WeakMap();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function blocked(message) {
  const error = new TypeError('CARD_LAYOUT_BROWSER_PROOF_NOT_RUN_BLOCKED: ' + message);
  error.code = 'CARD_LAYOUT_BROWSER_PROOF_NOT_RUN_BLOCKED';
  throw error;
}
function boundInputs({ admission, fixtureContract, assetManifest } = {}) {
  if (!admission || !fixtureContract || !assetManifest
    || typeof admission !== 'object' || typeof fixtureContract !== 'object' || typeof assetManifest !== 'object')
    blocked('resource/fixture/asset bindings required');
  for (const key of ['resourceId', 'ownerTaskId', 'browserLaunchId', 'fixtureContractId']) {
    if (typeof admission[key] !== 'string' || !admission[key].trim()) blocked('missing ' + key);
  }
  for (const key of ['custodyProofSha256', 'serverConfigProofSha256', 'fixtureSha256', 'assetManifestSha256']) {
    if (!/^[a-f0-9]{64}$/i.test(admission[key] || '')) blocked('missing exact ' + key);
  }
  if (!/^[a-f0-9]{40}$/i.test(admission.sourceHead || '')
    || !/^[a-f0-9]{64}$/i.test(admission.sourceFingerprint || '')) blocked('exact source identity required');
  if (admission.custodyState !== 'QUALIFIED' || admission.serverProxyDisabled !== true)
    blocked('independently qualified custody and no-proxy server receipt required');
  const expires = Date.parse(admission.expiresAtUtc || '');
  if (!Number.isFinite(expires) || expires <= Date.now()) blocked('resource admission expired or unavailable');
  let origin;
  try { origin = new URL(admission.qaOrigin); } catch { blocked('invalid admitted origin'); }
  if (!['http:', 'https:'].includes(origin.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    || !origin.port || ['4173', '5173', '8787'].includes(origin.port)
    || origin.username || origin.password || origin.href !== origin.origin + '/')
    blocked('distinct admitted loopback origin required');
  if (!['/index.html', '/apps/stephanos/dist/index.html'].includes(admission.pathname))
    blocked('unadmitted actual-app mount');
  if (fixtureContract.id !== admission.fixtureContractId
    || fixtureContract.resourceId !== admission.resourceId
    || fixtureContract.sourceHead !== admission.sourceHead
    || fixtureContract.qaOrigin !== origin.origin
    || assetManifest.sourceHead !== admission.sourceHead
    || assetManifest.sourceFingerprint !== admission.sourceFingerprint
    || digest(fixtureContract) !== admission.fixtureSha256
    || digest(assetManifest) !== admission.assetManifestSha256)
    blocked('conflicting resource/source/fixture/asset identities');
  if (!Array.isArray(assetManifest.assets) || !assetManifest.assets.length
    || !Array.isArray(fixtureContract.responses) || !fixtureContract.responses.length)
    blocked('qualified asset and fixture inventories required');
  const prefix = admission.pathname.slice(0, admission.pathname.lastIndexOf('/') + 1);
  const assetPaths = new Set([admission.pathname, prefix + 'stephanos-build.json']);
  for (const asset of assetManifest.assets) {
    if (!asset || typeof asset.pathname !== 'string'
      || new URL(asset.pathname, origin).pathname !== asset.pathname
      || !asset.pathname.startsWith(prefix + 'assets/')
      || !/\.(?:m?js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|ico)$/i.test(asset.pathname)
      || !/^[a-f0-9]{64}$/i.test(asset.sha256 || '') || assetPaths.has(asset.pathname))
      blocked('invalid or duplicate asset binding');
    assetPaths.add(asset.pathname);
  }
  const responses = new Map();
  if (fixtureContract.responses.length > 2) blocked('fixture route scope widened');
  for (const fixture of fixtureContract.responses) {
    if (!fixture || typeof fixture.url !== 'string') blocked('fixture URL required');
    let url;
    try { url = new URL(fixture.url); } catch { blocked('invalid fixture URL'); }
    const query = [...url.searchParams.entries()];
    const dashboard = url.pathname === '/api/shared-workspace/dashboard-feed'
      && query.length === 1 && url.searchParams.get('scope') === 'full-history';
    const hydration = url.pathname === '/api/shared-workspace/hydrate'
      && query.length === 2 && url.searchParams.get('workspace') === 'flywheel'
      && url.searchParams.get('datasets') === 'dashboard';
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !(url.origin === origin.origin || url.port === '8787')
      || fixture.method !== 'GET' || (!dashboard && !hydration)
      || !Number.isInteger(fixture.status) || fixture.status < 200 || fixture.status > 599
      || typeof fixture.body !== 'string' || fixture.body.length > 1_000_000
      || responses.has(url.href)) blocked('unadmitted fixture request/response');
    try { JSON.parse(fixture.body); } catch { blocked('fixture JSON unavailable'); }
    responses.set(url.href, { status: fixture.status, body: fixture.body });
  }
  return { resourceId: admission.resourceId, sourceHead: admission.sourceHead,
    sourceFingerprint: admission.sourceFingerprint, origin: origin.origin,
    pathname: admission.pathname, expires, assetPaths, responses,
    fixtureContractId: fixtureContract.id, browserLaunchId: admission.browserLaunchId };
}

/**
 * Consume an externally authenticated manual QA/resource packet; these shape
 * checks do NOT authenticate operator approval or grant execution authority.
 * The caller must independently establish that authority and browser ownership.
 * A fresh context blocks service workers and installs HTTP AND WebSocket routing
 * before any page exists. No browser/server startup or navigation occurs here.
 */
export async function prepareAdmittedCardLayoutContext(browser, inputs) {
  const binding = boundInputs(inputs); // Missing admission fails before resources.
  if (typeof browser?.newContext !== 'function') blocked('admitted browser capability missing');
  const context = await browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1 });
  try {
    if (typeof context.route !== 'function' || typeof context.routeWebSocket !== 'function'
      || typeof context.pages !== 'function' || context.pages().length)
      blocked('HTTP/WebSocket pre-navigation isolation capability missing');
    const blockedRequests = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (binding.expires <= Date.now()) {
        blockedRequests.push({ kind: 'EXPIRED_RESOURCE_ADMISSION' });
        await route.abort('blockedbyclient');
        return;
      }
      const fixture = binding.responses.get(url.href);
      if (request.method() === 'GET' && fixture) {
        await route.fulfill({ status: fixture.status, body: fixture.body,
          contentType: 'application/json', headers: { 'access-control-allow-origin': binding.origin } });
      } else if (request.method() === 'OPTIONS' && fixture
        && request.headers()['access-control-request-method'] === 'GET') {
        await route.fulfill({ status: 204, body: '', headers: {
          'access-control-allow-origin': binding.origin, 'access-control-allow-methods': 'GET',
          'access-control-allow-headers': 'content-type,accept' } });
      } else if (request.method() === 'GET' && url.origin === binding.origin
        && binding.assetPaths.has(url.pathname)
        && (url.pathname === binding.pathname
          ? [...url.searchParams.entries()].length === 1
            && [...url.searchParams.keys()].every(key => key === 'surface')
            && CARD_LAYOUT_SURFACES.some(value => value.surface === url.searchParams.get('surface'))
          : !url.search)) {
        await route.continue(); // Exact owned asset surface only; never backend.
      } else {
        blockedRequests.push({ kind: 'HTTP', method: request.method(), origin: url.origin, path: url.pathname });
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket(() => true, async socket => {
      blockedRequests.push({ kind: 'WEBSOCKET' });
      await socket.close(); // No connectToServer: no actual backend connection.
    });
    if (context.pages().length) blocked('page existed before both isolation guards');
    preparedContexts.set(context, { ...binding, blockedRequests });
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function inspectAdmittedCardLayout(page, {
  surface, expectedUrl, expectedHead, expectedFingerprint, viewport,
} = {}) {
  const binding = preparedContexts.get(page?.context?.());
  if (!binding || binding.expires <= Date.now()) blocked('page is not in a current guarded resource context');
  if (expectedHead !== binding.sourceHead || expectedFingerprint !== binding.sourceFingerprint)
    blocked('inspection head differs from admitted source');
  const config = CARD_LAYOUT_SURFACES.find(entry => entry.surface === surface);
  assert.ok(config, 'Explicit supported surface required.');
  assert.match(expectedHead || '', /^[a-f0-9]{40}$/i);
  assert.match(expectedFingerprint || '', /^[a-f0-9]{64}$/i);
  const url = new URL(expectedUrl);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'No file/data/browser protocol.');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.username + url.password, '', 'No embedded credentials.');
  assert.ok(!['4173', '5173', '8787'].includes(url.port) && url.port,
    'A separately admitted distinct loopback port is required.');
  assert.ok(['/index.html', '/apps/stephanos/dist/index.html'].includes(url.pathname),
    'Bind the actual admitted application mount, not a synthetic specimen.');
  assert.equal([...url.searchParams.entries()].length, 1, 'Only the admitted surface query is allowed.');
  assert.equal(url.searchParams.get('surface'), surface);
  if (url.origin !== binding.origin || url.pathname !== binding.pathname)
    blocked('inspection origin/path differs from resource admission');
  assert.equal(page.url(), url.href, 'Page differs from the admitted exact URL.');
  assert.ok(CARD_LAYOUT_VIEWPORTS.some(value =>
    value.width === viewport?.width && value.height === viewport?.height));
  const build = await page.evaluate(() =>
    JSON.parse(document.querySelector('#stephanos-build-metadata')?.textContent || 'null'));
  assert.equal(build?.gitCommit?.toLowerCase(), expectedHead.toLowerCase());
  assert.equal(build?.sourceFingerprint?.toLowerCase(), expectedFingerprint.toLowerCase());
  const workspace = page.getByTestId(config.testId);
  assert.equal(await workspace.count(), 1, 'One actual application workspace required.');
  assert.ok(await workspace.isVisible(), 'Workspace must already be visible.');
  const names = await workspace.locator(config.names).allTextContents();
  const ids = await workspace.locator(config.ids).allTextContents();
  const text = await workspace.textContent();
  assert.ok(names.some(value => LONG_NAME.test(value)), 'Missing admitted long-name specimen.');
  assert.ok(ids.some(value => HASH.test(value)), 'Missing admitted hash/ID specimen.');
  if (config.requireProofCount) assert.match(text || '', PROOF_COUNT);
  assert.match(text || '', /UNKNOWN|STALE|UNREACHABLE/, 'Truthful unavailable-state specimen required.');
  const snapshot = await page.evaluate(extractCardLayout, {
    rootSelector: '[data-testid="' + config.testId + '"]', cardSelector: config.cards,
  });
  const report = auditCardLayout(snapshot);
  assert.deepEqual({ width: snapshot.viewport.width, height: snapshot.viewport.height }, viewport);
  assert.equal(report.coverage, 'MEASURED', 'Empty geometry cannot pass.');
  assert.ok(report.cardCount >= 2, 'Parent and nested boundaries required.');
  const containment = await workspace.evaluate(root => {
    const child = root.getBoundingClientRect(), parent = root.parentElement.getBoundingClientRect();
    return { child: { left: child.left, right: child.right },
      parent: { left: parent.left, right: parent.right } };
  });
  assert.ok(containment.child.left >= containment.parent.left - 1
    && containment.child.right <= containment.parent.right + 1, 'Workspace exceeds its pane.');
  const modifierTracks = await workspace.locator(
    '.uplift-constellation.flywheel-constellation--large').evaluateAll(grids => grids.map(grid => {
    const style = getComputedStyle(grid);
    return { contentWidth: grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      gap: parseFloat(style.columnGap) || 0, items: grid.querySelectorAll('.uplift-agent-node').length,
      template: style.gridTemplateColumns,
      tracks: style.gridTemplateColumns.split(/\s+/).map(track => parseFloat(track)) };
  }));
  for (const grid of modifierTracks) {
    assert.ok(grid.tracks.length && grid.tracks.every(Number.isFinite),
      'Unqualified grid syntax requires explicit adjudication.');
    const tracks = grid.tracks.filter(value => value > 0);
    assert.ok(tracks.length && grid.items > 0);
    assert.ok(tracks.every(value => value >= Math.min(230, grid.contentWidth) - 1
      && value <= grid.contentWidth + 1), 'Flywheel 230px intent or container bound changed.');
    assert.equal(tracks.length, Math.min(grid.items,
      Math.max(1, Math.floor((grid.contentWidth + grid.gap + 0.01) / (230 + grid.gap)))));
  }
  // All geometry findings and affordances remain intact; no font/ellipsis waiver.
  return { evidenceClass: 'GEOMETRY_ONLY', acceptance: 'UNPROVEN',
    expectedHead, expectedFingerprint, build, snapshot, report, containment, modifierTracks,
    isolation: { resourceId: binding.resourceId, fixtureContractId: binding.fixtureContractId,
      browserLaunchId: binding.browserLaunchId, httpAndWebSocketGuards: 'BEFORE_FIRST_PAGE',
      serviceWorkers: 'BLOCKED', blockedRequests: [...binding.blockedRequests] },
    modifierCoverage: modifierTracks.length ? 'MEASURED' : 'ABSENT_FROM_SOURCE_VARIANT',
    remainingProof: ['actual served-asset identity', 'fixture provenance', 'font readiness',
      'screenshots and visual adjudication', 'all findings/affordances', 'affected interactions'] };
}

test('shared card primitives can shrink and wrap within the enclosing pane', () => {
  for (const selector of CARD_SELECTORS) assert.deepEqual(rule(selector), {
    'min-inline-size': '0', 'max-inline-size': '100%', 'overflow-wrap': 'anywhere',
  });
  for (const selector of CHILD_SELECTORS) assert.deepEqual(rule(selector), {
    'min-inline-size': '0', 'max-inline-size': '100%',
  });
});
test('existing preferred track widths are bounded rather than replaced by generic sizes', () => {
  for (const [selector, width] of GRID_PREFERENCES) assert.deepEqual(rule(selector), {
    'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, ' + width + 'px), 1fr))',
  });
});
test('large Flywheel modifier remains 230px with stronger matching specificity', () => {
  assert.equal(rule('.uplift-constellation.flywheel-constellation--large')['grid-template-columns'],
    'repeat(auto-fit, minmax(min(100%, 230px), 1fr))');
  assert.notEqual(rule('.uplift-constellation')['grid-template-columns'],
    rule('.uplift-constellation.flywheel-constellation--large')['grid-template-columns']);
});
test('containment source cannot conceal overflow or change unproven font/interaction semantics', () => {
  const allowed = new Set(['min-inline-size', 'max-inline-size', 'overflow-wrap', 'grid-template-columns']);
  assert.equal(rules.length, 8);
  const selectors = new Set([...CARD_SELECTORS, ...CHILD_SELECTORS, ...GRID_PREFERENCES.map(([value]) => value)]);
  for (const entry of rules) for (const selector of entry.selectors)
    assert.ok(selectors.has(selector), 'Unadmitted selector: ' + selector);
  for (const entry of rules) for (const property of Object.keys(entry.declarations))
    assert.ok(allowed.has(property), 'Unadmitted behavior: ' + property);
  assert.doesNotMatch(css, /!important|@import|url\(/i);
});
test('entry imports the shared contract once after its existing theme', () => {
  const path = '../../shared/styles/stephanos-card-layout.css';
  assert.equal(main.split(path).length - 1, 1);
  assert.ok(main.indexOf('import "' + path + '";') > main.indexOf('import "./styles.css";'));
});
test('stress matchers distinguish real unbroken text/counts from escaped literals', () => {
  assert.ok(LONG_NAME.test('N'.repeat(40)));
  assert.ok(!LONG_NAME.test('N'.repeat(39)));
  assert.ok(!LONG_NAME.test(('N'.repeat(20) + ' ').repeat(3)));
  assert.ok(HASH.test('a'.repeat(40)));
  assert.ok(PROOF_COUNT.test('12345 proof'));
  assert.ok(!PROOF_COUNT.test('1234 proof'));
  assert.ok(!PROOF_COUNT.test('x12345 proof'));
  assert.ok(!PROOF_COUNT.test(String.raw`\b12345\sproof`));
});
test('responsive contract covers the three actual surfaces at six viewport sizes', () => {
  assert.deepEqual(CARD_LAYOUT_SURFACES.map(value => value.surface), ['agents', 'flywheel', 'skill-forge']);
  assert.equal(CARD_LAYOUT_SURFACES.length * CARD_LAYOUT_VIEWPORTS.length, 18);
  assert.equal(new Set(CARD_LAYOUT_VIEWPORTS.map(value => value.width + 'x' + value.height)).size, 6);
});

test('missing physical resource/fixture bindings fail before context creation', async () => {
  let contexts = 0;
  const browser = { newContext: async () => { contexts += 1; throw new Error('must not run'); } };
  await assert.rejects(prepareAdmittedCardLayoutContext(browser, {}),
    error => error.code === 'CARD_LAYOUT_BROWSER_PROOF_NOT_RUN_BLOCKED');
  assert.equal(contexts, 0);
});
test('an arbitrary existing page is not a guarded actual-app proof target', async () => {
  let reads = 0;
  const page = { context: () => ({}), evaluate: () => { reads += 1; } };
  await assert.rejects(inspectAdmittedCardLayout(page, {}),
    error => error.code === 'CARD_LAYOUT_BROWSER_PROOF_NOT_RUN_BLOCKED');
  assert.equal(reads, 0);
});

console.info('STEPHANOS_CARD_LAYOUT_BROWSER_PROOF=NOT_RUN; SOURCE_TESTS_ONLY; '
  + 'separately admitted actual-head app, fixture, resource/custody and visual receipts required.');
