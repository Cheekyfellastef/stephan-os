import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDreamMigrationArgs, runDreamMigrationCli } from './migrate-dream-runtime-boundary.mjs';

test('Dream migration CLI defaults to read-only plan', () => {
  const parsed = parseDreamMigrationArgs([]);
  assert.equal(parsed.mode, 'plan');
  assert.equal(parsed.operatorApproved, false);
});

test('copy mode forwards approval only when explicitly supplied', async () => {
  let received = null;
  const result = await runDreamMigrationCli(['--copy', '--operator-approved', '--repo-root=/tmp/repo'], {
    executeFn: async (input) => {
      received = input;
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(received.operatorApproval, 'operator-approved-dream-migration');
  assert.match(received.repoRoot, /tmp[\\/]repo$/);
});
