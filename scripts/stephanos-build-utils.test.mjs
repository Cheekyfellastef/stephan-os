import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { getStephanosFingerprintSourceFiles, repoRoot } from './stephanos-build-utils.mjs';

test('Stephanos dist fingerprint includes shared runtime and shared AI source trees', () => {
  const files = getStephanosFingerprintSourceFiles()
    .map((absolutePath) => path.relative(repoRoot, absolutePath).replace(/\\/g, '/'));

  assert.ok(files.includes('shared/runtime/runtimeStatusModel.mjs'));
  assert.ok(files.includes('shared/runtime/stephanosHomeNode.mjs'));
  assert.ok(files.includes('shared/ai/providerDefaults.mjs'));
  assert.ok(files.includes('stephanos-ui/src/App.jsx'));
  assert.ok(files.includes('package.json'));
});
