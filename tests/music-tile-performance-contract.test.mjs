import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const performanceCss = readFileSync(new URL('../apps/music-tile/performance.css', import.meta.url), 'utf8');
const performanceCssWithoutComments = performanceCss.replace(/\/\*[\s\S]*?\*\//g, '');

test('Music Tile loads the compositor safety layer after its canonical stylesheet', () => {
  const canonical = html.indexOf('href="./style.css"');
  const performance = html.indexOf('href="./performance.css"');
  assert.ok(canonical >= 0, 'canonical stylesheet must remain present');
  assert.ok(performance > canonical, 'performance layer must load after the canonical stylesheet');
});

test('large filtered ambient layers no longer repaint on every animation frame', () => {
  assert.match(performanceCss, /\.aurora\s*\{[\s\S]*animation:\s*none\s*!important;[\s\S]*filter:\s*none\s*!important;/);
  assert.match(performanceCss, /\.cockpit-header\s*\{[\s\S]*backdrop-filter:\s*none\s*!important;/);
  assert.match(performanceCss, /\.signal-orbit\s*\{[\s\S]*filter:\s*none\s*!important;[\s\S]*contain:\s*layout style;/);
  assert.doesNotMatch(performanceCss, /\.signal-orbit\s*\{[\s\S]*contain:[^;]*\bpaint\b/);
  assert.match(performanceCss, /\.signal-orbit::before\s*\{[\s\S]*filter:\s*none\s*!important;/);
  assert.match(performanceCss, /\.orbit-core\s*\{[\s\S]*backdrop-filter:\s*none\s*!important;/);
});

test('remaining hero motion is transform-only and reduced-motion aware', () => {
  assert.match(performanceCss, /\.orbit-ring--outer,[\s\S]*will-change:\s*transform;/);
  assert.match(performanceCss, /@media \(prefers-reduced-motion: reduce\), \(update: slow\)/);
  assert.match(performanceCss, /\.orbit-ring--inner[\s\S]*animation:\s*none\s*!important;/);
});

test('performance layer cannot replace or restyle playback-bearing Music Tile nodes', () => {
  assert.doesNotMatch(performanceCssWithoutComments, /iframe|player-deck-card|listening-deck|listening-room|rating-button|data-rating/i);
});
