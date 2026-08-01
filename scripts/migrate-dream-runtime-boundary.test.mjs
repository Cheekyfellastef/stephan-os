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
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(received.operatorApproval, 'operator-approved-dream-migration');
  assert.equal(received.sourceHead, HEAD);
  assert.match(received.repoRoot, /tmp[\\/]repo$/);
  assert.equal(headReads, 2);
});

test('copy mode fails closed when source head changes during migration', async () => {
  const heads = [HEAD, 'b'.repeat(40)];
  const result = await runDreamMigrationCli(['--copy', '--operator-approved', '--repo-root=/tmp/repo'], {
    sourceHeadFn: async () => heads.shift(),
    executeFn: async () => ({ ok: true, finalVerdict: 'DREAM_RUNTIME_COPY_HASH_VERIFIED' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  assert.equal(result.blocker, 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED');
  assert.equal(result.sourceHeadBefore, HEAD);
  assert.equal(result.sourceHeadAfter, 'b'.repeat(40));
});

test('copy mode derives source head through fixed git argv only', async () => {
  let invocation = null;
  const sourceHead = await resolveDreamMigrationSourceHead('/bounded/repo', async (...args) => {
    invocation = args;
    return { stdout: `${HEAD}\n` };
  });
  assert.equal(sourceHead, HEAD);
  assert.equal(invocation[0], 'git');
  assert.deepEqual(invocation[1], ['-C', '/bounded/repo', 'rev-parse', 'HEAD']);
  await assert.rejects(
    () => resolveDreamMigrationSourceHead('/bounded/repo', async () => ({ stdout: '../not-a-head' })),
    /DREAM_VERSIONED_SOURCE_HEAD_UNAVAILABLE/,
  );
});
