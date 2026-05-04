import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_ASSETS, WORLD_LAYERS, validateWorldDataset } from '../apps/world-workspace/world-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('world workspace is registered in apps index', () => {
  const appsIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/index.json'), 'utf8'));
  assert.ok(appsIndex.includes('world-workspace'));
});

test('world workspace dataset validation passes', () => {
  const result = validateWorldDataset();
  assert.equal(result.ok, true, result.issues.join('; '));
  assert.ok(WORLD_LAYERS.length >= 6);
  assert.ok(WORLD_ASSETS.length >= 8);
});

test('world workspace import map pins and maps three + addons', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'apps/world-workspace/index.html'), 'utf8');
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /"three"\s*:\s*"https:\/\/unpkg\.com\/three@0\.164\.1\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/"\s*:\s*"https:\/\/unpkg\.com\/three@0\.164\.1\/examples\/jsm\/"/);
});

test('world workspace runtime imports resolve through import-map specifiers', () => {
  const js = fs.readFileSync(path.join(repoRoot, 'apps/world-workspace/world.js'), 'utf8');
  assert.match(js, /await import\('three'\)/);
  assert.match(js, /await import\('three\/addons\/controls\/OrbitControls\.js'\)/);
  assert.doesNotMatch(js, /await import\('https:\/\/unpkg\.com\/three/);
});
