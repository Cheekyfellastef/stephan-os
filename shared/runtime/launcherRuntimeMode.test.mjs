import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLauncherRuntimeMode } from './launcherRuntimeMode.mjs';

test('resolveLauncherRuntimeMode reports local launcher root', () => {
  const result = resolveLauncherRuntimeMode({
    location: { href: 'http://127.0.0.1:4173/' },
  });

  assert.equal(result.mode, 'local');
  assert.equal(result.shellSource, 'launcher-root');
});

test('resolveLauncherRuntimeMode reports hosted dist shell source', () => {
  const result = resolveLauncherRuntimeMode({
    location: { href: 'https://example.github.io/apps/stephanos/dist/index.html' },
  });

  assert.equal(result.mode, 'hosted');
  assert.equal(result.shellSource, 'stephanos-dist');
});
