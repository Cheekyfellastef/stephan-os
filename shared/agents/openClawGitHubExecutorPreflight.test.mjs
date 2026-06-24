import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGitExecutorPreflight } from './openClawGitHubExecutorPreflight.mjs';

test('commit and push require the exact authorized branch', () => {
  for (const operation of ['commit', 'push']) {
    const blocked = evaluateGitExecutorPreflight({
      operation,
      expectedBranch: 'openclaw/mission-1',
      actualBranch: 'main',
    });
    assert.equal(blocked.finalVerdict, 'BLOCKED');

    const passed = evaluateGitExecutorPreflight({
      operation,
      expectedBranch: 'openclaw/mission-1',
      actualBranch: 'openclaw/mission-1',
    });
    assert.equal(passed.finalVerdict, 'PREFLIGHT_PASS');
  }
});

test('commit rejects files staged before authorization execution', () => {
  const result = evaluateGitExecutorPreflight({
    operation: 'commit',
    expectedBranch: 'openclaw/mission-1',
    actualBranch: 'openclaw/mission-1',
    stagedFiles: ['unapproved-file.mjs'],
  });
  assert.equal(result.finalVerdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /empty Git index/i);
});
