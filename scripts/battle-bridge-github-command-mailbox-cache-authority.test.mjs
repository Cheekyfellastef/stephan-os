import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyFreshSelectedMailboxCommand } from './battle-bridge-github-command-mailbox.mjs';

const selected = Object.freeze({
  commentId: 1234,
  commentUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/2590#issuecomment-1234',
  command: Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'fresh-authority-test-0001',
    operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2590,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: 'a'.repeat(40),
  }),
  partition: 'OBSERVATION',
});

test('cached mailbox discovery must be rebound to one fresh exact GitHub comment before execution', () => {
  let reads = 0;
  const result = verifyFreshSelectedMailboxCommand(selected, {
    readComment: (commentId) => {
      reads += 1;
      assert.equal(commentId, 1234);
      return { id: 1234, body: 'fresh remote comment' };
    },
    selectBatch: () => ({
      ok: true,
      commands: [selected],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_FRESH_COMMENT_VERIFIED');
  assert.equal(reads, 1);
});

test('fresh GitHub command identity mismatch fails closed instead of trusting the cache', () => {
  const result = verifyFreshSelectedMailboxCommand(selected, {
    readComment: () => ({ id: 1234, body: 'changed remote comment' }),
    selectBatch: () => ({
      ok: true,
      commands: [{
        ...selected,
        command: { ...selected.command, requestId: 'different-command' },
      }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'COMMAND_FRESH_COMMENT_IDENTITY_MISMATCH');
});
