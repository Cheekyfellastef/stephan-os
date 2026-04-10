import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPERIMENTAL_EXPERIENCES, resolveExperienceLaunchUrl } from './experienceRegistry.js';

test('registry exposes Galaxians Lab with relative launch path', () => {
  const entry = EXPERIMENTAL_EXPERIENCES.find((item) => item.id === 'galaxians-lab');

  assert.ok(entry);
  assert.equal(entry.name, 'Galaxians Lab');
  assert.equal(entry.launchPath, '../galaxians-lab/index.html');
});

test('launch URL resolution stays subfolder-safe', () => {
  const entry = EXPERIMENTAL_EXPERIENCES.find((item) => item.id === 'galaxians-lab');
  const url = resolveExperienceLaunchUrl(entry, 'https://example.com/stephan-os/apps/experimental/src/main.js');

  assert.equal(url, 'https://example.com/stephan-os/apps/experimental/galaxians-lab/index.html');
});

test('dist entry bootstraps experimental app from .js module path', async () => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const distIndexPath = path.resolve(dirname, '../dist/index.html');
  const source = await fs.readFile(distIndexPath, 'utf8');

  assert.match(source, /<script type="module" src="\.\.\/src\/main\.js"><\/script>/);
  assert.doesNotMatch(source, /main\.jsx/);
});
