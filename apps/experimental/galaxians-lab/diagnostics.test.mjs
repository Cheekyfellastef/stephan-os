import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatGalaxiansLabDiagnostics,
  isGalaxiansLabDiagnosticsKey,
} from './diagnostics.mjs';

const ready = {
  mode: 'deluxe',
  imageStatus: 'ready',
  frameIndex: 1,
  frameCount: 2,
  loadedFrames: 2,
  sourceWidth: 12,
  sourceHeight: 13,
  scale: 4,
  frameMs: 400,
};

test('debug readout reports the real two-frame experimental rendering geometry', () => {
  assert.equal(formatGalaxiansLabDiagnostics(ready), [
    'Sprite: Sprite frames ready',
    'Palette: deluxe',
    'Frame: 2 of 2',
    'Crop: 12 x 13 source pixels',
    'Rendered sprite: 48 x 52 pixels (4x nearest-neighbour)',
    'Animation: 400 ms per frame (2 frames)',
    'Scope: experimental lab only; original game unchanged',
  ].join('\n'));
});

test('loading, missing frames and failures do not claim an active sprite frame', () => {
  assert.match(formatGalaxiansLabDiagnostics({ ...ready, imageStatus: 'loading' }), /Frame: Unavailable/);
  assert.match(formatGalaxiansLabDiagnostics({ ...ready, loadedFrames: 1 }), /Frame: Unavailable/);
  assert.match(formatGalaxiansLabDiagnostics({ ...ready, imageStatus: 'error' }), /Sprite: Sprite sheet failed to load/);
  assert.match(formatGalaxiansLabDiagnostics({ ...ready, imageStatus: 'error' }), /Frame: Unavailable/);
});

test('invalid external values fail visibly instead of rendering fabricated measurements', () => {
  const display = formatGalaxiansLabDiagnostics({ ...ready, mode: '<script>', frameIndex: 7, scale: 0, frameMs: -2 });
  assert.match(display, /Palette: unknown/);
  assert.match(display, /Frame: Unavailable/);
  assert.match(display, /Rendered sprite: Unavailable/);
  assert.match(display, /Animation: Unavailable/);
  assert.doesNotMatch(display, /script|NaN|undefined/);
});

test('F1 toggles without modifiers; key repeats and unrelated keys are ignored', () => {
  assert.equal(isGalaxiansLabDiagnosticsKey({ key: 'F1' }), true);
  for (const change of [{ key: 'F2' }, { repeat: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(isGalaxiansLabDiagnosticsKey({ key: 'F1', ...change }), false);
  }
  assert.equal(isGalaxiansLabDiagnosticsKey(null), false);
});

test('independently expanded Diagnostics toggle is never part of palette mode button state updates', () => {
  const js = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(js, /const modeButtons = Array\.from\(document\.querySelectorAll\('\.mode-btn\[data-mode\]'\)\)/);
  assert.match(js, /button\.classList\.toggle\('is-active', button\.dataset\.mode === mode\)/);
  for (const mode of ['original', 'basic', 'deluxe']) {
    assert.match(html, new RegExp('data-mode="' + mode + '" class="mode-btn'));
  }
  const diagnosticButton = html.match(/<button\b[^>]*id="lab-diagnostics-toggle"[^>]*>/);
  assert.ok(diagnosticButton, 'the separate Diagnostics control must exist');
  assert.match(diagnosticButton[0], /class="mode-btn"/);
  assert.doesNotMatch(diagnosticButton[0], /data-mode=/);
  assert.match(diagnosticButton[0], /aria-expanded="false"/);
});
