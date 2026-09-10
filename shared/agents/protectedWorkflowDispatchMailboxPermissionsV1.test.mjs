import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/protected-workflow-dispatch-mailbox.yml', import.meta.url),
  'utf8',
);

test('protected workflow dispatcher carries the GitHub permissions required for ready-for-review', () => {
  assert.match(workflow, /permissions:\n  actions: write\n  contents: write\n  issues: write\n  pull-requests: write/);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.equal((workflow.match(/pull-requests: write/g) || []).length, 1);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /node scripts\/dispatch-protected-merge-from-mailbox\.mjs/);
  assert.doesNotMatch(workflow, /contents: read/);
});
