import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDreamMigrationArgs,
  resolveDreamMigrationSourceHead,
  runDreamMigrationCli,
} from './migrate-dream-runtime-boundary.mjs';

const HEAD = 'a'.repeat(40);

test('Dream migration CLI defaults to read-only plan', () => {
  const parsed = parseDreamMigrationArgs([]);
  assert.equal(parsed.mode, 'plan');
  assert.equal(parsed.operatorApproved, false);
});

test('copy mode forwards approval only when explicitly supplied', async () => {
  let received = null;
  let headReads = 0;
  const result = await runDreamMigrationCli(['--copy', '--operator-approved', '--repo-root=/tmp/repo'], {
    sourceHeadFn: async () => {
      headReads += 1;
      return HEAD;
    },
    executeFn: async (input) => {
      received = input;
      assert.equal(await input.sourceHeadVerifierFn(input.repoRoot), HEAD);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(received.operatorApproval, 'operator-approved-dream-migration');
  assert.equal(received.sourceHead, HEAD);
  assert.match(received.repoRoot, /tmp[\\/]repo$/);
  assert.equal(headReads, 2);
});

test('copy mode delegates source-head drift to the ownership-aware executor transaction', async () => {
  const heads = [HEAD, 'b'.repeat(40)];
  const result = await runDreamMigrationCli(['--copy', '--operator-approved', '--repo-root=/tmp/repo'], {
    sourceHeadFn: async () => heads.shift(),
    executeFn: async (input) => {
      const observed = await input.sourceHeadVerifierFn(input.repoRoot);
      return observed === input.sourceHead
        ? { ok: true, finalVerdict: 'DREAM_RUNTIME_COPY_HASH_VERIFIED' }
        : { ok: false, finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED', blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
});

test('copy mode derives source head through fixed git argv only', async () => {
  const invocations = [];
  const sourceHead = await resolveDreamMigrationSourceHead('/bounded/repo', async (...args) => {
    invocations.push(args);
    return { stdout: invocations.length === 1 ? `${HEAD}\n` : '' };
  });
  assert.equal(sourceHead, HEAD);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0][0], 'git');
  assert.deepEqual(invocations[0][1], ['-C', '/bounded/repo', 'rev-parse', 'HEAD']);
  assert.deepEqual(invocations[1][1], [
    '-C', '/bounded/repo',
    'status',
    '--porcelain=v2',
    '--untracked-files=no',
    '--ignore-submodules=none',
    '--',
    '.',
    ':(exclude)memory/.dreams/**',
    ':(exclude)memory/dreaming/**',
  ]);
  await assert.rejects(
    () => resolveDreamMigrationSourceHead('/bounded/repo', async () => ({ stdout: '../not-a-head' })),
    /DREAM_VERSIONED_SOURCE_HEAD_UNAVAILABLE/,
  );
});

test('copy mode rejects tracked implementation dirt before binding source head', async () => {
  let invocationCount = 0;
  await assert.rejects(
    () => resolveDreamMigrationSourceHead('/bounded/repo', async () => {
      invocationCount += 1;
      return invocationCount === 1
        ? { stdout: `${HEAD}\n` }
        : { stdout: '1 .M N... scripts/migrate-dream-runtime-boundary.mjs\n' };
    }),
    /DREAM_VERSIONED_SOURCE_DIRTY/,
  );
  assert.equal(invocationCount, 2);
});
