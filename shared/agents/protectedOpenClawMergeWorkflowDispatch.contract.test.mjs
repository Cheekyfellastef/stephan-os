import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('protected merge contracts retain the fixed workflow target and forbid direct merge calls', () => {
  const source = readFileSync(new URL('./protectedOpenClawMergeMailboxAdapter.mjs', import.meta.url), 'utf8');
  assert.match(source, /PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE = 'clean-independent'/);
  assert.match(source, /PROTECTED_OPERATOR_MERGE_WORKFLOW = 'operator-merge-approval-gate\.yml'/);
  assert.match(source, /'workflow', 'run', PROTECTED_OPERATOR_MERGE_WORKFLOW/);
  assert.match(source, /PROTECTED_OPERATOR_MERGE_WORKFLOW_MODE = 'user-owned-protected-squash'/);
  // Actual clean-mode handoff and zero child execution are exercised in the canonical provenance suite.
  assert.doesNotMatch(source, /\['pr',\s*'merge'/);
  assert.doesNotMatch(source, /api[^\n]*\/merge[^\n]*-X[^\n]*PUT/i);
});
