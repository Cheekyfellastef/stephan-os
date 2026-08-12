import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const readWorkflow = () => fs.readFileSync(workflowUrl, 'utf8').replaceAll('\r\n', '\n');

test('serializes every mutating coordinator trigger through one PR-scoped authority lock', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /\n  plan:\n[\s\S]*STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY:\s*'true'/);
  assert.match(workflow, /targets:\s*\$\{\{ steps\.plan\.outputs\.targets \}\}/);
  assert.match(workflow, /target:\s*\$\{\{ fromJSON\(needs\.plan\.outputs\.targets\) \}\}/);
  assert.match(
    workflow,
    /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}-pr-\$\{\{ matrix\.target\.prNumber \}\}/,
  );
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /STEPHANOS_EXACT_HEAD_REVIEW_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(
    workflow,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/,
  );
  assert.doesNotMatch(workflow, /format\('review-run-/);
  assert.doesNotMatch(workflow, /format\('head-/);
  assert.doesNotMatch(workflow, /format\('coordinator-/);
});

test('keeps verification read-only and plans global scans before per-PR mutation', () => {
  const workflow = readWorkflow();
  assert.match(workflow, /verify:\n[\s\S]*Progress: `VERIFIED_ONLY`/);
  assert.match(workflow, /plan:\n[\s\S]*Discover canonical PR targets without mutation/);
  assert.match(workflow, /coordinate:\n\s+needs: plan/);
  assert.match(workflow, /max-parallel:\s*4/);
});
