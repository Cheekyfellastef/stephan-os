import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW_URL = new URL('../../.github/workflows/mailbox-receipt-index.yml', import.meta.url);

function workflowSource() {
  return readFileSync(WORKFLOW_URL, 'utf8');
}

test('mailbox receipt mirror serializes rapid receipt events without cancelling terminal truth', () => {
  const source = workflowSource();
  assert.match(source, /group:\s*mailbox-receipt-index-\$\{\{ github\.event\.pull_request\.number \|\| 'mirror' \}\}/);
  assert.match(source, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(source, /cancel-in-progress:\s*true/);
});

test('mailbox receipt mirror remains bound to the canonical rollover issue and trusted receipt marker', () => {
  const source = workflowSource();
  assert.match(source, /github\.event\.issue\.number == 2158/);
  assert.match(source, /github\.event\.comment\.user\.login == github\.repository_owner/);
  assert.match(source, /stephanos-battle-bridge-command-receipt/);
});
