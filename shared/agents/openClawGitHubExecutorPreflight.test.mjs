import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGitExecutorPreflight } from './openClawGitHubExecutorPreflight.mjs';

test('commit push and open PR require the exact authorized branch', () => {
  for (const operation of ['commit', 'push', 'open-pr']) {
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
    expectedChangedFiles: ['approved-file.mjs'],
    actualChangedFiles: ['approved-file.mjs'],
  });
  assert.equal(result.finalVerdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /empty Git index/i);
});

test('commit push and open PR require the complete signed change set', () => {
  for (const operation of ['commit', 'push', 'open-pr']) {
    const result = evaluateGitExecutorPreflight({
      operation,
      expectedBranch: 'openclaw/mission-1',
      actualBranch: 'openclaw/mission-1',
      expectedChangedFiles: ['shared/agents/example.mjs'],
      actualChangedFiles: ['shared/agents/example.mjs', 'tests/unapproved.test.mjs'],
    });
    assert.equal(result.finalVerdict, 'BLOCKED');
    assert.match(result.blockers.join(' '), /signed changed file set/i);
  }
});
