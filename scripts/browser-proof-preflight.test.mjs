import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBrowserProofPreflight } from './browser-proof-preflight.mjs';

test('browser proof preflight reports no-upstream-tracking-branch clearly', () => {
  const result = evaluateBrowserProofPreflight({
    capture: (args) => {
      if (args[0] === 'branch') return 'feature/no-upstream';
      if (args[0] === 'rev-parse') throw new Error('fatal: no upstream configured');
      throw new Error(`unexpected args: ${args.join(' ')}`);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'no-upstream-tracking-branch');
});

test('browser proof preflight passes when upstream tracking branch exists', () => {
  const result = evaluateBrowserProofPreflight({
    capture: (args) => {
      if (args[0] === 'branch') return 'feature/with-upstream';
      if (args[0] === 'rev-parse') return 'origin/feature/with-upstream';
      throw new Error(`unexpected args: ${args.join(' ')}`);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.upstream, 'origin/feature/with-upstream');
});
