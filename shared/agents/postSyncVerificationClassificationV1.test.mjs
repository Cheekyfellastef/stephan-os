import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODEX_DISPATCH_TEST_ARGS,
  syncCodexDispatchBridge,
} from './codexDispatchHostOps.mjs';

const HEAD = 'a'.repeat(40);

function nodeTestCommand(nodeCommand = 'node.exe') {
  return `${nodeCommand} ${CODEX_DISPATCH_TEST_ARGS.join(' ')}`;
}

function scriptedSpawn(script) {
  const queues = new Map(Object.entries(script).map(([key, values]) => [
    key,
    Array.isArray(values) ? [...values] : [values],
  ]));
  return (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    const queue = queues.get(key);
    if (!queue?.length) throw new Error(`Unexpected command: ${key}`);
    const value = queue.shift();
    return {
      status: value.status ?? 0,
      stdout: value.stdout ?? '',
      stderr: value.stderr ?? '',
      signal: value.signal ?? null,
      error: value.error,
    };
  };
}

test('exact source convergence remains explicit when deterministic post-sync verification fails', () => {
  const failingTest = 'approved post-sync verification boundary';
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: `${HEAD}\n` }, { stdout: `${HEAD}\n` }],
    'git status --porcelain=v1 --untracked-files=all': [{ stdout: '' }, { stdout: '' }],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: `${HEAD}\n` },
    [`git rev-list --left-right --count HEAD...${HEAD}`]: { stdout: '0\t0\n' },
    [nodeTestCommand()]: {
      status: 1,
      stdout: [
        `not ok 1 - ${failingTest}`,
        '# tests 1',
        '# pass 0',
        '# fail 1',
        '# cancelled 0',
        '# skipped 0',
        '# todo 0',
        '',
      ].join('\n'),
      stderr: 'C:\\private\\machine\\path\\must-not-be-projected secret diagnostic',
    },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    nodeCommand: 'node.exe',
    spawnSyncFn,
  });

  assert.equal(result.ok, false);
  assert.equal(result.afterHead, HEAD);
  assert.equal(result.approvedTargetHead, HEAD);
  assert.equal(result.sourceConverged, true);
  assert.equal(result.verificationPassed, false);
  assert.equal(result.blocker, 'POST_SYNC_VERIFICATION_TEST_FAILURE');
  assert.deepEqual(result.verification, {
    ok: false,
    summaryComplete: true,
    failCount: 1,
    failingTests: [failingTest],
  });
  assert.doesNotMatch(JSON.stringify(result.verification), /private|machine|path|secret|diagnostic/i);
});
