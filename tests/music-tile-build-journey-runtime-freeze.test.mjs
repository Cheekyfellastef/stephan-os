import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('build journey includes freeze diagnostics and safe render wrappers', () => {
  assert.match(source, /buildJourney:start/);
  assert.match(source, /renderAll:start/);
  assert.match(source, /renderAll:end/);
  assert.match(source, /saveState:start/);
  assert.match(source, /saveState:end/);
  assert.match(source, /caught error message and stack/);
  assert.match(source, /safeRenderAll\(/);
});

test('y do i normalization and status messaging are preserved', () => {
  assert.match(source, /lower === 'y do i' \|\| lower === 'ydoi'\s*\? 'Y do I'/);
  assert.match(source, /Y do I recognised\. Local candidate bank limited; showing Spotify search-led candidates\./);
});

test('build journey terminal status outcomes include fallback and failure', () => {
  assert.match(source, /Built \$\{state\.candidates\.length\} candidates for/);
  assert.match(source, /No artist bank found, broad fallback used/);
  assert.match(source, /No candidates found/);
  assert.match(source, /Build failed: .*fallback used/);
});
