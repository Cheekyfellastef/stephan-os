import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIgniteReply, normalizeIgniteCommand } from './command.mjs';

test('normalizes blank or multiline ignite commands for display only', () => {
  assert.equal(normalizeIgniteCommand(''), 'npm run stephanos:ignite');
  assert.equal(normalizeIgniteCommand('npm run stephanos:ignite\n-- --check'), 'npm run stephanos:ignite -- --check');
});

test('builds a non-execution operator handoff reply', () => {
  const reply = buildIgniteReply('npm run stephanos:ignite');
  assert.match(reply, /operator-run and approval-gated/);
  assert.match(reply, /npm run stephanos:ignite/);
  assert.match(reply, /does not execute ignition or mutate/);
});
