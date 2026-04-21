import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { srcRoot } from '../test/renderHarness.mjs';

const source = fs.readFileSync(path.join(srcRoot, 'components/ProviderToggle.jsx'), 'utf8');

test('provider secret save still calls backend PUT even when draft config save fails', () => {
  assert.match(source, /if\s*\(!saveResult\?\.ok\s*&&\s*!pendingSecret\)\s*\{\s*return;\s*\}/m);
  assert.match(source, /setLocalProviderSecret\(providerKey,\s*pendingSecret,\s*runtimeConfig\)/m);
});

test('provider secret draft clears only after successful backend confirmation', () => {
  const saveCallIndex = source.indexOf('setLocalProviderSecret(providerKey, pendingSecret, runtimeConfig)');
  const clearDraftIndex = source.indexOf("setSecretDrafts((prev) => ({ ...prev, [providerKey]: '' }))");
  assert.ok(saveCallIndex >= 0, 'expected backend secret save call');
  assert.ok(clearDraftIndex > saveCallIndex, 'secret draft should clear only after backend save path');
});

test('provider secret clear uses backend DELETE helper', () => {
  assert.match(source, /const clearResult = await clearLocalProviderSecret\(providerKey,\s*runtimeConfig\);/m);
});

test('hosted cloud cognition pane includes explicit save and provider test actions', () => {
  assert.match(source, /Save Hosted Cloud Cognition/);
  assert.match(source, /Test Hosted Provider/);
  assert.match(source, /Unsaved changes/);
});
