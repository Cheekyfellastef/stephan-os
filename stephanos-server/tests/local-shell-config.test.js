import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STEPHANOS_REPO_PATH } from '../../shared/runtime/stephanosRepoShellConfig.mjs';
import { getLocalShellConfig, resolveStephanosRepoPath } from '../config/localShellConfig.js';

test('resolveStephanosRepoPath uses env override when present', () => {
  const resolved = resolveStephanosRepoPath({ STEPHANOS_REPO_ROOT: 'D:\\Repos\\stephan-os' });
  assert.equal(resolved, 'D:\\Repos\\stephan-os');
});

test('resolveStephanosRepoPath falls back to default truth path', () => {
  assert.equal(resolveStephanosRepoPath({}), DEFAULT_STEPHANOS_REPO_PATH);
});

test('getLocalShellConfig reports config source', () => {
  const config = getLocalShellConfig({ REPO_ROOT: 'E:\\Code\\stephan-os' });
  assert.equal(config.repoPath, 'E:\\Code\\stephan-os');
  assert.equal(config.source, 'REPO_ROOT');
  assert.equal(config.windowsOnly, true);
});
