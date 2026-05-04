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
