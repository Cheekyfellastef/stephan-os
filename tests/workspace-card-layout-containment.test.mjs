/**
 * Source regression and read-only browser inspection contract for goal #2664.
 * This module never creates a browser, server, fixture, process or canonical
 * state. Source tests cannot establish responsive/browser acceptance.
 * inspectAdmittedCardLayout requires a page already supplied by an independently
 * resource/custody-qualified executor, serving the exact UI head and admitted
 * long-content data. Neither page arguments nor environment values grant that
 * authority. The denied synthetic local-file fixture is never a valid target.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
 * Collect one matrix case without navigation, resize, API fetch, data/style
 * injection or resource startup. The caller owns prior admission, actual-asset
 * identity, fixture provenance, viewport, screenshots and later adjudication.
 * Valid metadata is necessary but does not prove the served asset bytes.
 */
export async function inspectAdmittedCardLayout(page, {
  surface, expectedUrl, expectedHead, expectedFingerprint, viewport,
} = {}) {
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
  assert.equal(url.searchParams.get('surface'), surface);
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

console.info('STEPHANOS_CARD_LAYOUT_BROWSER_PROOF=NOT_RUN; SOURCE_TESTS_ONLY; '
  + 'separately admitted actual-head app, fixture, resource/custody and visual receipts required.');
