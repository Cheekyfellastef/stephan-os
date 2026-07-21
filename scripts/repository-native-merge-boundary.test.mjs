import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publishScript = new URL('./repository-native-publish-merge-lane.mjs', import.meta.url);
const approvedMergeScript = new URL('./repository-native-approved-merge.mjs', import.meta.url);

test('ordinary publication path cannot mark ready or merge', async () => {
  const source = await readFile(publishScript, 'utf8');
  assert.match(source, /--draft/);
  assert.match(source, /AWAITING_OPERATOR_APPROVAL/);
  assert.match(source, /mergeAuthority: false/);
  assert.doesNotMatch(source, /\['pr', 'ready'/);
  assert.doesNotMatch(source, /\['pr', 'merge'/);
  assert.doesNotMatch(source, /APPROVE_REPOSITORY_NATIVE_EXACT_HEAD_MERGE/);
});

test('only approved merge path validates, consumes and exact-head merges', async () => {
  const source = await readFile(approvedMergeScript, 'utf8');
  assert.match(source, /validateOperatorMergeApproval/);
  assert.match(source, /stephanos-operator-merge-approval-consumed/);
  assert.match(source, /already consumed/);
  assert.match(source, /--match-head-commit/);
  assert.match(source, /reviewThreads/);
  assert.match(source, /gh', \['pr', 'checks'/);
  assert.match(source, /gh', \['pr', 'ready'/);
  assert.match(source, /gh', \['pr', 'merge'/);
});
