import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStephanosLocalUrls,
  resolveStephanosLocalUrls,
  resolveStephanosServePort,
} from '../shared/runtime/stephanosLocalUrls.mjs';

test('createStephanosLocalUrls formats the canonical local runtime URLs', () => {
  const urls = createStephanosLocalUrls();

  assert.equal(urls.runtimeUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/');
  assert.equal(urls.runtimeIndexUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
  assert.equal(urls.launcherShellUrl, 'http://127.0.0.1:4173/');
  assert.equal(urls.healthUrl, 'http://127.0.0.1:4173/__stephanos/health');
});

test('resolveStephanosServePort recovers the port from malformed runtime URL text', () => {
  assert.equal(
    resolveStephanosServePort('http://127.0.1.4173/apps/stephanos/dist/'),
    4173,
  );
});

test('resolveStephanosLocalUrls normalizes malformed local runtime URL inputs back to the canonical URL', () => {
  const urls = resolveStephanosLocalUrls('http://127.0.1.4173/apps/stephanos/dist/');

  assert.equal(urls.runtimeUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/');
  assert.equal(urls.healthUrl, 'http://127.0.0.1:4173/__stephanos/health');
});
