import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIgnitionStatusModel,
  classifyWorkspaceDirt,
  isKnownGeneratedPath,
  parseGitPorcelain,
  renderSplashHtml,
} from './stephanos-ignition-concierge.mjs';

test('classifies generated dist dirt as safe and source dirt as approval-required', () => {
  const status = [
    ' M apps/stephanos/dist/index.html',
    '?? tmp/stephanos-ignition/ignition-splash.html',
    ' M stephanos-ui/src/components/CockpitPanel.jsx',
  ].join('\n');
  const classified = classifyWorkspaceDirt(status);
  assert.equal(classified.safeGenerated.length, 2);
  assert.equal(classified.unsafe.length, 1);
  assert.equal(classified.blocked, true);
  assert.deepEqual(classified.unsafe.map((entry) => entry.path), ['stephanos-ui/src/components/CockpitPanel.jsx']);
});

test('keeps generated allowlist narrow', () => {
  assert.equal(isKnownGeneratedPath('apps/stephanos/dist/assets/index.js'), true);
  assert.equal(isKnownGeneratedPath('stephanos-ui/dist/index.html'), true);
  assert.equal(isKnownGeneratedPath('scripts/build-stephanos-ui.mjs'), false);
  assert.equal(isKnownGeneratedPath('stephanos-ui/src/App.jsx'), false);
});

test('parses renamed porcelain entry by target path', () => {
  assert.deepEqual(parseGitPorcelain('R  old.js -> apps/stephanos/dist/new.js'), [
    { status: 'R ', path: 'apps/stephanos/dist/new.js' },
  ]);
});

test('splash model exposes blocked panel and support snapshot', () => {
  const workspace = classifyWorkspaceDirt(' M scripts/ignite-stephanos-local.mjs');
  const model = buildIgnitionStatusModel({ workspace, phase: 'preflight' });
  const html = renderSplashHtml(model);
  assert.equal(model.state, 'blocked');
  assert.match(model.operatorAction, /Commit, stash, or explicitly approve/);
  assert.match(html, /Stephanos Ignition/);
  assert.match(html, /Copy support snapshot/);
  assert.match(html, /scripts\/ignite-stephanos-local.mjs/);
});
