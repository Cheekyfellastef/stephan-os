import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const mailbox = await readFile(new URL('./protectedWorkflowDispatchMailboxV1.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../.github/workflows/operator-merge-approval-gate.yml', import.meta.url), 'utf8');

test('material operator authorization is distinguishable from the short-lived dispatch transport window', () => {
  assert.match(mailbox, /materialAuthorization/);
  assert.match(mailbox, /authorizationHead/);
  assert.match(mailbox, /authorizationBase/);
  assert.match(mailbox, /allowExpiredMaterialAuthorization|historicalMaterialAuthorization|materialAuthorizationDurable/);
});

test('durable material authorization does not weaken fresh dispatch expiry validation', () => {
  assert.match(mailbox, /PROTECTED_WORKFLOW_DISPATCH_MAX_WINDOW_MS/);
  assert.match(mailbox, /PROTECTED_WORKFLOW_DISPATCH_EXPIRED/);
  assert.match(mailbox, /PROTECTED_WORKFLOW_DISPATCH_EXPIRY_TOO_FAR_AHEAD/);
});

test('protected workflow explicitly opts into historical material authorization only after fetching the exact owner comment', () => {
  assert.match(workflow, /authorization_comment_id/);
  assert.match(workflow, /allowExpiredMaterialAuthorization:\s*true|historicalMaterialAuthorization:\s*true/);
  assert.match(workflow, /validateProtectedWorkflowAuthorizationComment/);
});

test('no durable authorization path grants raw merge, runtime or ruleset authority', () => {
  assert.doesNotMatch(mailbox, /merge_pull_request|ruleset.*update|runtimeMutationAuthority:\s*true/i);
});
