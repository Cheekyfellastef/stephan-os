import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStephanosLocalUrls,
  createStephanosRuntimeTargets,
  getStephanosPreferredRuntimeTarget,
  resolveStephanosLocalUrls,
  resolveStephanosServePort,
} from '../shared/runtime/stephanosLocalUrls.mjs';

test('createStephanosLocalUrls formats the canonical local dist runtime URLs', () => {
  const urls = createStephanosLocalUrls();

  assert.equal(urls.runtimeUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/');
  assert.equal(urls.runtimeIndexUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
  assert.equal(urls.launcherShellUrl, 'http://127.0.0.1:4173/');
  assert.equal(urls.healthUrl, 'http://127.0.0.1:4173/__stephanos/health');
});

test('createStephanosRuntimeTargets exposes both dev and dist runtime targets', () => {
  const targets = createStephanosRuntimeTargets();

  assert.deepEqual(
    targets.map((target) => ({ kind: target.kind, url: target.url })),
    [
      { kind: 'dev', url: 'http://localhost:5173/' },
      { kind: 'dev', url: 'http://127.0.0.1:5173/' },
      { kind: 'dist', url: 'http://127.0.0.1:4173/apps/stephanos/dist/' },
    ],
  );
});

test('getStephanosPreferredRuntimeTarget prefers the dev runtime when present', () => {
  const targets = createStephanosRuntimeTargets();

  assert.equal(getStephanosPreferredRuntimeTarget(targets)?.url, 'http://localhost:5173/');
  assert.equal(
    getStephanosPreferredRuntimeTarget(targets.filter((target) => target.kind === 'dist'))?.url,
    'http://127.0.0.1:4173/apps/stephanos/dist/',
  );
});

test('resolveStephanosServePort recovers the port from malformed runtime URL text', () => {
  assert.equal(
    resolveStephanosServePort('http://127.0.1.4173/apps/stephanos/dist/'),
    4173,
  );
});

test('resolveStephanosLocalUrls normalizes malformed local runtime URL inputs back to the canonical dist URL', () => {
  const urls = resolveStephanosLocalUrls('http://127.0.1.4173/apps/stephanos/dist/');

  assert.equal(urls.runtimeUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/');
  assert.equal(urls.healthUrl, 'http://127.0.0.1:4173/__stephanos/health');
});
