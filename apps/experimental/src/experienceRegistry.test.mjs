import test from 'node:test';
import assert from 'node:assert/strict';

import { EXPERIMENTAL_EXPERIENCES, resolveExperienceLaunchUrl } from './experienceRegistry.js';

test('registry exposes Galaxians Lab with relative launch path', () => {
  const entry = EXPERIMENTAL_EXPERIENCES.find((item) => item.id === 'galaxians-lab');

  assert.ok(entry);
  assert.equal(entry.name, 'Galaxians Lab');
  assert.equal(entry.launchPath, '../galaxians-lab/index.html');
});

test('launch URL resolution stays subfolder-safe', () => {
  const entry = EXPERIMENTAL_EXPERIENCES.find((item) => item.id === 'galaxians-lab');
  const url = resolveExperienceLaunchUrl(entry, 'https://example.com/stephan-os/apps/experimental/src/main.jsx');

  assert.equal(url, 'https://example.com/stephan-os/apps/experimental/galaxians-lab/index.html');
});
